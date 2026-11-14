package exchange

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"tigerex/backend/internal/api"
)

// ErrInsufficientFunds is returned when a debit would drive a balance negative.
var ErrInsufficientFunds = errors.New("insufficient funds")

// ErrInvalidInput is returned for malformed identifiers or amounts.
var ErrInvalidInput = errors.New("invalid input")

// EnsureSchema creates the auxiliary tables this store owns that the base schema
// does not model: an append-only ledger journal and per-user HD address indexes.
// It is idempotent, so it is safe to run on every boot.
func (s *Store) EnsureSchema(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return ErrUnavailable
	}
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS exchange_ledger_entries (
			id          BIGSERIAL PRIMARY KEY,
			user_id     UUID NOT NULL,
			asset       VARCHAR(20) NOT NULL,
			network     VARCHAR(50) NOT NULL,
			kind        VARCHAR(30) NOT NULL,
			amount      DECIMAL(30,15) NOT NULL,
			available_after DECIMAL(30,15) NOT NULL,
			locked_after    DECIMAL(30,15) NOT NULL,
			reference   VARCHAR(120),
			created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS exchange_ledger_entries_user_idx
			ON exchange_ledger_entries (user_id, asset, created_at DESC);

		-- The derivation index is global per (asset, network), not per user: the
		-- BIP-44 path is a function of the index alone, so a per-user index would
		-- hand two users the same address.
		CREATE TABLE IF NOT EXISTS exchange_address_index (
			asset       VARCHAR(20) NOT NULL,
			network     VARCHAR(50) NOT NULL,
			next_index  BIGINT NOT NULL DEFAULT 0,
			updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
			PRIMARY KEY (asset, network)
		);

		CREATE TABLE IF NOT EXISTS exchange_deposit_addresses (
			user_id     UUID NOT NULL,
			asset       VARCHAR(20) NOT NULL,
			network     VARCHAR(50) NOT NULL,
			address     VARCHAR(255) NOT NULL,
			memo        VARCHAR(255),
			derivation_index BIGINT NOT NULL DEFAULT 0,
			created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
			PRIMARY KEY (user_id, asset, network)
		);

		-- The venue's fee account. Fees are withheld from the amount a trader
		-- receives, so this balance is backed by value actually taken, never minted.
		CREATE TABLE IF NOT EXISTS exchange_treasury (
			asset       VARCHAR(20) NOT NULL,
			network     VARCHAR(50) NOT NULL DEFAULT 'main',
			balance     DECIMAL(30,15) NOT NULL DEFAULT 0,
			updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
			PRIMARY KEY (asset, network)
		);

		CREATE TABLE IF NOT EXISTS exchange_treasury_entries (
			id          BIGSERIAL PRIMARY KEY,
			asset       VARCHAR(20) NOT NULL,
			network     VARCHAR(50) NOT NULL,
			kind        VARCHAR(30) NOT NULL,
			amount      DECIMAL(30,15) NOT NULL,
			balance_after DECIMAL(30,15) NOT NULL,
			reference   VARCHAR(120),
			created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
		);

		-- An order's outstanding reservation: the funds it still holds locked.
		-- It is decremented by each fill and released in full when the order
		-- becomes terminal, so a partially filled or cancelled order never
		-- strands a trader's funds.
		ALTER TABLE orders ADD COLUMN IF NOT EXISTS reserved_amount DECIMAL(30,15) NOT NULL DEFAULT 0;
		ALTER TABLE orders ADD COLUMN IF NOT EXISTS reserved_asset VARCHAR(20);
	`)
	if err != nil {
		return fmt.Errorf("ensure exchange schema: %w", err)
	}
	return nil
}

// GetWallets returns every balance row for a user.
func (s *Store) GetWallets(ctx context.Context, userID string) ([]api.Wallet, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) {
		return nil, ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, `
		SELECT user_id, asset, network, available::float8, locked::float8
		  FROM wallets
		 WHERE user_id = $1
		 ORDER BY asset, network`, userID)
	if err != nil {
		return nil, fmt.Errorf("get wallets: %w", err)
	}
	defer rows.Close()

	wallets := []api.Wallet{}
	for rows.Next() {
		var w api.Wallet
		if err := rows.Scan(&w.UserID, &w.Asset, &w.Network, &w.Available, &w.Locked); err != nil {
			return nil, fmt.Errorf("scan wallet: %w", err)
		}
		w.Total = w.Available + w.Locked
		wallets = append(wallets, w)
	}
	return wallets, rows.Err()
}

// GetBalance returns a user's total balance for one asset, summed across every
// network row. An asset can live in more than one row, so a per-row read would
// under-report.
func (s *Store) GetBalance(ctx context.Context, userID, asset string) (*api.Wallet, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" {
		return nil, ErrInvalidInput
	}
	asset = strings.ToUpper(asset)
	var available, locked float64
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(available), 0)::float8, COALESCE(SUM(locked), 0)::float8
		  FROM wallets WHERE user_id = $1 AND asset = $2`, userID, asset).
		Scan(&available, &locked)
	if err != nil {
		return nil, fmt.Errorf("get balance: %w", err)
	}
	return &api.Wallet{
		UserID:    userID,
		Asset:     asset,
		Available: available,
		Locked:    locked,
		Total:     available + locked,
	}, nil
}

// ensureWalletLocked returns the primary (network) balance row for a user and
// asset, creating it if absent. It must be called inside a transaction.
func ensureWalletLocked(ctx context.Context, tx pgx.Tx, userID, asset, network string) error {
	if network == "" {
		network = "main"
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO wallets (user_id, asset, network, available, locked)
		VALUES ($1, $2, $3, 0, 0)
		ON CONFLICT (user_id, asset, network) DO NOTHING`, userID, asset, network)
	return err
}

// Credit adds funds to a user's available balance and records a ledger entry.
func (s *Store) Credit(ctx context.Context, userID, asset, network string, amount float64, reference string) error {
	if err := s.ready(); err != nil {
		return err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" || !finite(amount) || amount <= 0 {
		return ErrInvalidInput
	}
	asset = strings.ToUpper(asset)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if err := ensureWalletLocked(ctx, tx, userID, asset, network); err != nil {
			return fmt.Errorf("ensure wallet: %w", err)
		}
		var available, locked float64
		err := tx.QueryRow(ctx, `
			UPDATE wallets
			   SET available = available + $4, updated_at = NOW()
			 WHERE user_id = $1 AND asset = $2 AND network = $3
			 RETURNING available::float8, locked::float8`,
			userID, asset, networkOr(network), decString(toDec(amount))).
			Scan(&available, &locked)
		if err != nil {
			return fmt.Errorf("credit wallet: %w", err)
		}
		return recordLedger(ctx, tx, userID, asset, networkOr(network), "credit", amount, available, locked, reference)
	})
}

// Debit removes funds from a user's available balance across every network row.
// It fails closed with ErrInsufficientFunds rather than driving a row negative.
func (s *Store) Debit(ctx context.Context, userID, asset string, amount float64, reference string) error {
	if err := s.ready(); err != nil {
		return err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" || !finite(amount) || amount <= 0 {
		return ErrInvalidInput
	}
	asset = strings.ToUpper(asset)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		remaining, err := debitAvailableTx(ctx, tx, userID, asset, amount)
		if err != nil {
			return err
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}
		return nil
	})
}

// debitAvailableTx drains `amount` from the user's available balance across every
// network row, oldest row first, inside an existing transaction. It returns the
// amount it could not cover (zero on success) and writes a ledger entry per row.
func debitAvailableTx(ctx context.Context, tx pgx.Tx, userID, asset string, amount float64) (float64, error) {
	rows, err := tx.Query(ctx, `
		SELECT network, available::float8
		  FROM wallets
		 WHERE user_id = $1 AND asset = $2 AND available > 0
		 ORDER BY network
		 FOR UPDATE`, userID, asset)
	if err != nil {
		return amount, fmt.Errorf("read balances: %w", err)
	}
	type bal struct {
		network string
		avail   float64
	}
	var balances []bal
	for rows.Next() {
		var b bal
		if err := rows.Scan(&b.network, &b.avail); err != nil {
			rows.Close()
			return amount, fmt.Errorf("scan balance: %w", err)
		}
		balances = append(balances, b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return amount, err
	}

	remaining := amount
	for _, b := range balances {
		if remaining <= 0 {
			break
		}
		take := b.avail
		if take > remaining {
			take = remaining
		}
		var available, locked float64
		err := tx.QueryRow(ctx, `
			UPDATE wallets SET available = available - $3, updated_at = NOW()
			 WHERE user_id = $1 AND asset = $2 AND network = $4
			 RETURNING available::float8, locked::float8`,
			userID, asset, decString(toDec(take)), b.network).Scan(&available, &locked)
		if err != nil {
			return remaining, fmt.Errorf("debit row: %w", err)
		}
		if err := recordLedger(ctx, tx, userID, asset, b.network, "debit", -take, available, locked, "withdrawal"); err != nil {
			return remaining, err
		}
		remaining -= take
	}
	return remaining, nil
}

// Lock moves funds from available to locked (e.g. when an order or withdrawal is
// placed). It fails closed when the available total is insufficient.
func (s *Store) Lock(ctx context.Context, userID, asset string, amount float64, reference string) error {
	if err := s.ready(); err != nil {
		return err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" || !finite(amount) || amount <= 0 {
		return ErrInvalidInput
	}
	asset = strings.ToUpper(asset)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		remaining, err := moveAvailableToLocked(ctx, tx, userID, asset, amount, reference)
		if err != nil {
			return err
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}
		return nil
	})
}

// moveAvailableToLocked transfers `amount` from available to locked across rows.
func moveAvailableToLocked(ctx context.Context, tx pgx.Tx, userID, asset string, amount float64, reference string) (float64, error) {
	rows, err := tx.Query(ctx, `
		SELECT network, available::float8 FROM wallets
		 WHERE user_id = $1 AND asset = $2 AND available > 0
		 ORDER BY network FOR UPDATE`, userID, asset)
	if err != nil {
		return amount, fmt.Errorf("read balances: %w", err)
	}
	type bal struct {
		network string
		avail   float64
	}
	var balances []bal
	for rows.Next() {
		var b bal
		if err := rows.Scan(&b.network, &b.avail); err != nil {
			rows.Close()
			return amount, err
		}
		balances = append(balances, b)
	}
	rows.Close()

	remaining := amount
	for _, b := range balances {
		if remaining <= 0 {
			break
		}
		take := b.avail
		if take > remaining {
			take = remaining
		}
		var available, locked float64
		err := tx.QueryRow(ctx, `
			UPDATE wallets
			   SET available = available - $3, locked = locked + $3, updated_at = NOW()
			 WHERE user_id = $1 AND asset = $2 AND network = $4
			 RETURNING available::float8, locked::float8`,
			userID, asset, decString(toDec(take)), b.network).Scan(&available, &locked)
		if err != nil {
			return remaining, err
		}
		if err := recordLedger(ctx, tx, userID, asset, b.network, "lock", -take, available, locked, reference); err != nil {
			return remaining, err
		}
		remaining -= take
	}
	return remaining, nil
}

// Unlock returns locked funds to available.
func (s *Store) Unlock(ctx context.Context, userID, asset string, amount float64, reference string) error {
	if err := s.ready(); err != nil {
		return err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" || !finite(amount) || amount <= 0 {
		return ErrInvalidInput
	}
	asset = strings.ToUpper(asset)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT network, locked::float8 FROM wallets
			 WHERE user_id = $1 AND asset = $2 AND locked > 0
			 ORDER BY network FOR UPDATE`, userID, asset)
		if err != nil {
			return err
		}
		type bal struct {
			network string
			locked  float64
		}
		var balances []bal
		for rows.Next() {
			var b bal
			if err := rows.Scan(&b.network, &b.locked); err != nil {
				rows.Close()
				return err
			}
			balances = append(balances, b)
		}
		rows.Close()

		remaining := amount
		for _, b := range balances {
			if remaining <= 0 {
				break
			}
			take := b.locked
			if take > remaining {
				take = remaining
			}
			var available, locked float64
			err := tx.QueryRow(ctx, `
				UPDATE wallets
				   SET locked = locked - $3, available = available + $3, updated_at = NOW()
				 WHERE user_id = $1 AND asset = $2 AND network = $4
				 RETURNING available::float8, locked::float8`,
				userID, asset, decString(toDec(take)), b.network).Scan(&available, &locked)
			if err != nil {
				return err
			}
			if err := recordLedger(ctx, tx, userID, asset, b.network, "unlock", take, available, locked, reference); err != nil {
				return err
			}
			remaining -= take
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}
		return nil
	})
}

// ConsumeLocked removes locked funds entirely (e.g. a withdrawal that has left
// the venue, or a seized collateral). It never returns them to available.
func (s *Store) ConsumeLocked(ctx context.Context, userID, asset string, amount float64, reference string) error {
	if err := s.ready(); err != nil {
		return err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" || !finite(amount) || amount <= 0 {
		return ErrInvalidInput
	}
	asset = strings.ToUpper(asset)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT network, locked::float8 FROM wallets
			 WHERE user_id = $1 AND asset = $2 AND locked > 0
			 ORDER BY network FOR UPDATE`, userID, asset)
		if err != nil {
			return err
		}
		type bal struct {
			network string
			locked  float64
		}
		var balances []bal
		for rows.Next() {
			var b bal
			if err := rows.Scan(&b.network, &b.locked); err != nil {
				rows.Close()
				return err
			}
			balances = append(balances, b)
		}
		rows.Close()

		remaining := amount
		for _, b := range balances {
			if remaining <= 0 {
				break
			}
			take := b.locked
			if take > remaining {
				take = remaining
			}
			var available, locked float64
			err := tx.QueryRow(ctx, `
				UPDATE wallets
				   SET locked = locked - $3, updated_at = NOW()
				 WHERE user_id = $1 AND asset = $2 AND network = $4
				 RETURNING available::float8, locked::float8`,
				userID, asset, decString(toDec(take)), b.network).Scan(&available, &locked)
			if err != nil {
				return err
			}
			if err := recordLedger(ctx, tx, userID, asset, b.network, "consume_locked", 0, available, locked, reference); err != nil {
				return err
			}
			remaining -= take
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}
		return nil
	})
}

// recordLedger appends an immutable journal entry inside a transaction.
func recordLedger(ctx context.Context, tx pgx.Tx, userID, asset, network, kind string, amount, availableAfter, lockedAfter float64, reference string) error {
	if reference == "" {
		reference = kind
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO exchange_ledger_entries
			(user_id, asset, network, kind, amount, available_after, locked_after, reference)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		userID, asset, network, kind, decString(toDec(amount)),
		decString(toDec(availableAfter)), decString(toDec(lockedAfter)), reference)
	if err != nil {
		return fmt.Errorf("record ledger: %w", err)
	}
	return nil
}

func networkOr(network string) string {
	if network == "" {
		return "main"
	}
	return network
}
