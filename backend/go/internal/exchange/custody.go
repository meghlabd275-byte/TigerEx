package exchange

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"tigerex/backend/internal/api"
)

// DepositAddress is a user's assigned deposit address for an asset/network.
type DepositAddress struct {
	Asset   string `json:"asset"`
	Network string `json:"network"`
	Address string `json:"address"`
	Memo    string `json:"memo,omitempty"`
}

// WithdrawalRequest is a withdrawal submission from the HTTP layer.
type WithdrawalRequest struct {
	UserID  string
	Asset   string
	Network string
	Amount  float64
	Fee     float64
	Address string
	Memo    string
}

// GetDepositAddress returns the user's deposit address for an asset/network,
// deriving and persisting a fresh one on first request. The derivation index is
// allocated atomically under a row lock so two concurrent requests cannot be
// handed the same index and thus the same address.
func (s *Store) GetDepositAddress(ctx context.Context, userID, asset, network string) (*DepositAddress, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) || strings.TrimSpace(asset) == "" {
		return nil, ErrInvalidInput
	}
	if s.hd == nil {
		return nil, fmt.Errorf("%w: HD wallet is not configured", ErrUnavailable)
	}
	asset = strings.ToUpper(asset)
	network = networkOr(strings.ToLower(strings.TrimSpace(network)))

	// Fast path: an address already assigned.
	var existing DepositAddress
	err := s.pool.QueryRow(ctx, `
		SELECT asset, network, address, COALESCE(memo,'')
		  FROM exchange_deposit_addresses
		 WHERE user_id = $1 AND asset = $2 AND network = $3`,
		userID, asset, network).Scan(&existing.Asset, &existing.Network, &existing.Address, &existing.Memo)
	if err == nil {
		return &existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("read deposit address: %w", err)
	}

	var addr DepositAddress
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		// Serialise concurrent requests for the same user/asset/network so they
		// cannot each allocate a distinct index and race on the address row.
		if _, err := tx.Exec(ctx, `
			SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2 || ':' || $3))`,
			userID, asset, network); err != nil {
			return err
		}
		// Re-check inside the transaction in case a concurrent request won.
		var have string
		err := tx.QueryRow(ctx, `
			SELECT address FROM exchange_deposit_addresses
			 WHERE user_id = $1 AND asset = $2 AND network = $3 FOR UPDATE`,
			userID, asset, network).Scan(&have)
		if err == nil {
			addr = DepositAddress{Asset: asset, Network: network, Address: have}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		// Allocate the next derivation index atomically. It is global per
		// (asset, network) so two users can never be handed the same address.
		var index int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO exchange_address_index (asset, network, next_index)
			VALUES ($1, $2, 1)
			ON CONFLICT (asset, network)
			DO UPDATE SET next_index = exchange_address_index.next_index + 1, updated_at = NOW()
			RETURNING next_index - 1`,
			asset, network).Scan(&index); err != nil {
			return fmt.Errorf("allocate address index: %w", err)
		}

		address, err := s.hd.deriveAddress(network, uint32(index))
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO exchange_deposit_addresses
				(user_id, asset, network, address, derivation_index)
			VALUES ($1, $2, $3, $4, $5)`,
			userID, asset, network, address, index); err != nil {
			return fmt.Errorf("store deposit address: %w", err)
		}
		addr = DepositAddress{Asset: asset, Network: network, Address: address}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &addr, nil
}

// CreateWithdrawal reserves the amount plus fee, records the withdrawal as
// pending, and consumes the reservation in the same transaction. The funds leave
// the user's balance only once the request is accepted; a rejected request is
// refunded by RejectWithdrawal.
func (s *Store) CreateWithdrawal(ctx context.Context, req *WithdrawalRequest) (*api.Withdrawal, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if req == nil || !isUUID(req.UserID) || strings.TrimSpace(req.Asset) == "" || strings.TrimSpace(req.Address) == "" {
		return nil, ErrInvalidInput
	}
	if !finite(req.Amount) || req.Amount <= 0 || !finite(req.Fee) || req.Fee < 0 {
		return nil, ErrInvalidInput
	}
	asset := strings.ToUpper(req.Asset)

	// Whitelist policy: once a user has approved any address for the asset,
	// withdrawals to any other address are refused.
	allowed, err := s.IsWithdrawalAddressAllowed(ctx, req.UserID, asset, req.Address)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, fmt.Errorf("%w: address is not on the withdrawal whitelist", ErrInvalidInput)
	}

	net := req.Amount - req.Fee
	if net <= 0 {
		return nil, fmt.Errorf("%w: fee exceeds amount", ErrInvalidInput)
	}

	var w *api.Withdrawal
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		if err := ensureWalletLocked(ctx, tx, req.UserID, asset, "main"); err != nil {
			return err
		}
		// Lock then consume: the reservation backs the withdrawal while it is
		// pending, and is consumed when it is accepted for processing.
		remaining, err := moveAvailableToLocked(ctx, tx, req.UserID, asset, req.Amount, "withdrawal_lock")
		if err != nil {
			return err
		}
		if remaining > 0 {
			return ErrInsufficientFunds
		}
		if err := consumeLockedTx(ctx, tx, req.UserID, asset, req.Amount, "withdrawal_consume"); err != nil {
			return err
		}

		row := tx.QueryRow(ctx, `
			INSERT INTO withdrawals
				(user_id, asset, amount, fee, net_amount, address, memo, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
			RETURNING id, user_id, asset, amount::float8, fee::float8,
			          net_amount::float8, address, COALESCE(txid,''), status,
			          EXTRACT(EPOCH FROM created_at)::bigint`,
			req.UserID, asset, decString(toDec(req.Amount)), decString(toDec(req.Fee)),
			decString(toDec(net)), req.Address, nullIfEmpty(req.Memo))
		var out api.Withdrawal
		if err := row.Scan(&out.ID, &out.UserID, &out.Asset, &out.Amount, &out.Fee,
			&out.NetAmount, &out.Address, &out.TXID, &out.Status, &out.Timestamp); err != nil {
			return fmt.Errorf("create withdrawal: %w", err)
		}
		w = &out
		return nil
	})
	if err != nil {
		return nil, err
	}
	return w, nil
}

// GetWithdrawals returns a user's withdrawal history, newest first.
func (s *Store) GetWithdrawals(ctx context.Context, userID string, limit int) ([]api.Withdrawal, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) {
		return nil, ErrInvalidInput
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, asset, amount::float8, fee::float8, net_amount::float8,
		       address, COALESCE(txid,''), status,
		       EXTRACT(EPOCH FROM created_at)::bigint,
		       COALESCE(EXTRACT(EPOCH FROM processed_at)::bigint, 0)
		  FROM withdrawals WHERE user_id = $1
		 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("get withdrawals: %w", err)
	}
	defer rows.Close()

	out := []api.Withdrawal{}
	for rows.Next() {
		var w api.Withdrawal
		if err := rows.Scan(&w.ID, &w.UserID, &w.Asset, &w.Amount, &w.Fee, &w.NetAmount,
			&w.Address, &w.TXID, &w.Status, &w.Timestamp, &w.ProcessedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// GetDeposits returns a user's deposit history, newest first.
func (s *Store) GetDeposits(ctx context.Context, userID string, limit int) ([]api.Deposit, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if !isUUID(userID) {
		return nil, ErrInvalidInput
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, asset, amount::float8, address, COALESCE(txid,''),
		       confirmations, status, EXTRACT(EPOCH FROM created_at)::bigint
		  FROM deposits WHERE user_id = $1
		 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("get deposits: %w", err)
	}
	defer rows.Close()

	out := []api.Deposit{}
	for rows.Next() {
		var d api.Deposit
		if err := rows.Scan(&d.ID, &d.UserID, &d.Asset, &d.Amount, &d.Address,
			&d.TXID, &d.Confirmations, &d.Status, &d.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// IsWithdrawalAddressAllowed enforces the withdrawal whitelist policy against
// the canonical withdrawal_addresses table (the same rows internal/auth writes).
// When the user has approved no addresses the address is allowed (the feature is
// opt-in); once any address is approved, only approved addresses are permitted.
func (s *Store) IsWithdrawalAddressAllowed(ctx context.Context, userID, asset, address string) (bool, error) {
	if err := s.ready(); err != nil {
		return false, err
	}
	if !isUUID(userID) {
		return false, ErrInvalidInput
	}
	var approved int
	if err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM withdrawal_addresses
 WHERE user_id = $1 AND asset = $2`, userID, strings.ToUpper(asset)).Scan(&approved); err != nil {
		return false, err
	}
	if approved == 0 {
		return true, nil
	}
	var match int
	if err := s.pool.QueryRow(ctx, `
SELECT COUNT(*) FROM withdrawal_addresses
 WHERE user_id = $1 AND asset = $2 AND address = $3`,
		userID, strings.ToUpper(asset), address).Scan(&match); err != nil {
		return false, err
	}
	return match > 0, nil
}

// consumeLockedTx removes locked funds inside an existing transaction.
func consumeLockedTx(ctx context.Context, tx pgx.Tx, userID, asset string, amount float64, reference string) error {
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
			UPDATE wallets SET locked = locked - $3, updated_at = NOW()
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
}

// ValidateAddress performs a syntactic check of a crypto address for the asset.
func ValidateAddress(asset, address string) bool {
	address = strings.TrimSpace(address)
	if address == "" {
		return false
	}
	switch strings.ToUpper(asset) {
	case "BTC":
		if strings.HasPrefix(address, "1") || strings.HasPrefix(address, "3") {
			return len(address) >= 26 && len(address) <= 35
		}
		return strings.HasPrefix(address, "bc1") && len(address) >= 14 && len(address) <= 74
	case "ETH", "USDT", "USDC", "BNB", "MATIC", "AVAX", "TGR":
		return strings.HasPrefix(address, "0x") && len(address) == 42 && isHex(address[2:])
	default:
		// Unknown asset: accept any non-empty address so a new asset is not
		// blocked, but the whitelist and the signer remain the real controls.
		return len(address) >= 8
	}
}

func isHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return len(s) > 0
}

func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
