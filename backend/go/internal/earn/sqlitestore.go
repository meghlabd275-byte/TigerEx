package earn

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// SQLiteStore is a durable Store backed by SQLite. It suits a single-node
// deployment and tests. A multi-node deployment needs a shared database, but
// the schema and SQL here are portable to Postgres.
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens (or creates) the database at path and applies the
// schema.
func NewSQLiteStore(path string) (*SQLiteStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("database path is required")
	}
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("opening earn database: %w", err)
	}
	// SQLite serialises writes; a single connection avoids "database is
	// locked" errors under concurrent requests.
	db.SetMaxOpenConns(1)

	store := &SQLiteStore{db: db}
	if err := store.ensureSchema(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

// Close releases the database handle.
func (s *SQLiteStore) Close() error { return s.db.Close() }

const earnSchema = `
CREATE TABLE IF NOT EXISTS savings_products (
    id         TEXT PRIMARY KEY,
    asset      TEXT NOT NULL,
    type       TEXT NOT NULL,
    apy        REAL NOT NULL,
    min_amount REAL NOT NULL DEFAULT 0,
    lock_days  INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS savings_positions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    asset           TEXT NOT NULL,
    principal       REAL NOT NULL,
    apy             REAL NOT NULL,
    accrued         REAL NOT NULL DEFAULT 0,
    start_at        INTEGER NOT NULL,
    unlock_at       INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',
    last_accrual_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_savings_positions_user ON savings_positions(user_id);

CREATE TABLE IF NOT EXISTS lend_positions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    asset           TEXT NOT NULL,
    principal       REAL NOT NULL,
    apy             REAL NOT NULL,
    accrued         REAL NOT NULL DEFAULT 0,
    start_at        INTEGER NOT NULL,
    last_accrual_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lend_positions_user ON lend_positions(user_id);

CREATE TABLE IF NOT EXISTS borrow_positions (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL,
    asset            TEXT NOT NULL,
    principal        REAL NOT NULL,
    apy              REAL NOT NULL,
    accrued          REAL NOT NULL DEFAULT 0,
    collateral_asset TEXT NOT NULL,
    collateral       REAL NOT NULL,
    ltv              REAL NOT NULL,
    start_at         INTEGER NOT NULL,
    last_accrual_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_borrow_positions_user ON borrow_positions(user_id);

CREATE TABLE IF NOT EXISTS sub_accounts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_sub_accounts_user ON sub_accounts(user_id);
`

func (s *SQLiteStore) ensureSchema(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, earnSchema); err != nil {
		return fmt.Errorf("applying earn schema: %w", err)
	}
	return nil
}

// --- savings products ------------------------------------------------------

func (s *SQLiteStore) ListSavingsProducts(ctx context.Context) ([]SavingsProduct, error) {
	const q = `SELECT id, asset, type, apy, min_amount, lock_days, status FROM savings_products ORDER BY asset, id`
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("listing savings products: %w", err)
	}
	defer rows.Close()

	var out []SavingsProduct
	for rows.Next() {
		var p SavingsProduct
		if err := rows.Scan(&p.ID, &p.Asset, &p.Type, &p.APY, &p.MinAmount, &p.LockDays, &p.Status); err != nil {
			return nil, fmt.Errorf("scanning savings product: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) GetSavingsProduct(ctx context.Context, id string) (*SavingsProduct, error) {
	const q = `SELECT id, asset, type, apy, min_amount, lock_days, status FROM savings_products WHERE id = ?`
	var p SavingsProduct
	err := s.db.QueryRowContext(ctx, q, id).
		Scan(&p.ID, &p.Asset, &p.Type, &p.APY, &p.MinAmount, &p.LockDays, &p.Status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrProductNotFound
		}
		return nil, fmt.Errorf("loading savings product: %w", err)
	}
	return &p, nil
}

func (s *SQLiteStore) UpsertSavingsProduct(ctx context.Context, product *SavingsProduct) error {
	const q = `
		INSERT INTO savings_products (id, asset, type, apy, min_amount, lock_days, status)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			asset = excluded.asset, type = excluded.type, apy = excluded.apy,
			min_amount = excluded.min_amount, lock_days = excluded.lock_days, status = excluded.status
	`
	_, err := s.db.ExecContext(ctx, q, product.ID, product.Asset, product.Type, product.APY,
		product.MinAmount, product.LockDays, product.Status)
	if err != nil {
		return fmt.Errorf("upserting savings product: %w", err)
	}
	return nil
}

// --- savings positions -----------------------------------------------------

const savingsColumns = `id, user_id, product_id, asset, principal, apy, accrued, start_at, unlock_at, status, last_accrual_at`

func scanSavingsPosition(scanner interface{ Scan(...any) error }) (*SavingsPosition, error) {
	var p SavingsPosition
	err := scanner.Scan(&p.ID, &p.UserID, &p.ProductID, &p.Asset, &p.Principal, &p.APY,
		&p.Accrued, &p.StartAt, &p.UnlockAt, &p.Status, &p.LastAccrualAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *SQLiteStore) ListSavingsPositions(ctx context.Context, userID string) ([]SavingsPosition, error) {
	q := `SELECT ` + savingsColumns + ` FROM savings_positions WHERE user_id = ? ORDER BY start_at DESC`
	rows, err := s.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("listing savings positions: %w", err)
	}
	defer rows.Close()

	var out []SavingsPosition
	for rows.Next() {
		p, err := scanSavingsPosition(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning savings position: %w", err)
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) GetSavingsPosition(ctx context.Context, id string) (*SavingsPosition, error) {
	q := `SELECT ` + savingsColumns + ` FROM savings_positions WHERE id = ?`
	p, err := scanSavingsPosition(s.db.QueryRowContext(ctx, q, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPositionNotFound
		}
		return nil, fmt.Errorf("loading savings position: %w", err)
	}
	return p, nil
}

func (s *SQLiteStore) CreateSavingsPosition(ctx context.Context, p *SavingsPosition) error {
	const q = `
		INSERT INTO savings_positions (` + savingsColumns + `)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := s.db.ExecContext(ctx, q, p.ID, p.UserID, p.ProductID, p.Asset, p.Principal, p.APY,
		p.Accrued, p.StartAt, p.UnlockAt, p.Status, p.LastAccrualAt)
	if err != nil {
		return fmt.Errorf("creating savings position: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateSavingsPosition(ctx context.Context, p *SavingsPosition) error {
	const q = `
		UPDATE savings_positions SET principal = ?, accrued = ?, status = ?, last_accrual_at = ?
		WHERE id = ?
	`
	tag, err := s.db.ExecContext(ctx, q, p.Principal, p.Accrued, p.Status, p.LastAccrualAt, p.ID)
	if err != nil {
		return fmt.Errorf("updating savings position: %w", err)
	}
	if n, _ := tag.RowsAffected(); n == 0 {
		return ErrPositionNotFound
	}
	return nil
}

// --- lend positions --------------------------------------------------------

const lendColumns = `id, user_id, asset, principal, apy, accrued, start_at, last_accrual_at`

func (s *SQLiteStore) ListLendPositions(ctx context.Context, userID string) ([]LendPosition, error) {
	q := `SELECT ` + lendColumns + ` FROM lend_positions WHERE user_id = ? ORDER BY start_at DESC`
	rows, err := s.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("listing lend positions: %w", err)
	}
	defer rows.Close()

	var out []LendPosition
	for rows.Next() {
		var p LendPosition
		if err := rows.Scan(&p.ID, &p.UserID, &p.Asset, &p.Principal, &p.APY, &p.Accrued, &p.StartAt, &p.LastAccrualAt); err != nil {
			return nil, fmt.Errorf("scanning lend position: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) GetLendPosition(ctx context.Context, id string) (*LendPosition, error) {
	q := `SELECT ` + lendColumns + ` FROM lend_positions WHERE id = ?`
	var p LendPosition
	err := s.db.QueryRowContext(ctx, q, id).
		Scan(&p.ID, &p.UserID, &p.Asset, &p.Principal, &p.APY, &p.Accrued, &p.StartAt, &p.LastAccrualAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPositionNotFound
		}
		return nil, fmt.Errorf("loading lend position: %w", err)
	}
	return &p, nil
}

func (s *SQLiteStore) CreateLendPosition(ctx context.Context, p *LendPosition) error {
	const q = `INSERT INTO lend_positions (` + lendColumns + `) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := s.db.ExecContext(ctx, q, p.ID, p.UserID, p.Asset, p.Principal, p.APY, p.Accrued, p.StartAt, p.LastAccrualAt)
	if err != nil {
		return fmt.Errorf("creating lend position: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateLendPosition(ctx context.Context, p *LendPosition) error {
	const q = `UPDATE lend_positions SET accrued = ?, last_accrual_at = ? WHERE id = ?`
	tag, err := s.db.ExecContext(ctx, q, p.Accrued, p.LastAccrualAt, p.ID)
	if err != nil {
		return fmt.Errorf("updating lend position: %w", err)
	}
	if n, _ := tag.RowsAffected(); n == 0 {
		return ErrPositionNotFound
	}
	return nil
}

// --- borrow positions ------------------------------------------------------

const borrowColumns = `id, user_id, asset, principal, apy, accrued, collateral_asset, collateral, ltv, start_at, last_accrual_at`

func (s *SQLiteStore) ListBorrowPositions(ctx context.Context, userID string) ([]BorrowPosition, error) {
	q := `SELECT ` + borrowColumns + ` FROM borrow_positions WHERE user_id = ? ORDER BY start_at DESC`
	rows, err := s.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("listing borrow positions: %w", err)
	}
	defer rows.Close()

	var out []BorrowPosition
	for rows.Next() {
		var p BorrowPosition
		if err := rows.Scan(&p.ID, &p.UserID, &p.Asset, &p.Principal, &p.APY, &p.Accrued,
			&p.CollateralAsset, &p.Collateral, &p.LTV, &p.StartAt, &p.LastAccrualAt); err != nil {
			return nil, fmt.Errorf("scanning borrow position: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) GetBorrowPosition(ctx context.Context, id string) (*BorrowPosition, error) {
	q := `SELECT ` + borrowColumns + ` FROM borrow_positions WHERE id = ?`
	var p BorrowPosition
	err := s.db.QueryRowContext(ctx, q, id).
		Scan(&p.ID, &p.UserID, &p.Asset, &p.Principal, &p.APY, &p.Accrued,
			&p.CollateralAsset, &p.Collateral, &p.LTV, &p.StartAt, &p.LastAccrualAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPositionNotFound
		}
		return nil, fmt.Errorf("loading borrow position: %w", err)
	}
	return &p, nil
}

func (s *SQLiteStore) CreateBorrowPosition(ctx context.Context, p *BorrowPosition) error {
	const q = `INSERT INTO borrow_positions (` + borrowColumns + `) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := s.db.ExecContext(ctx, q, p.ID, p.UserID, p.Asset, p.Principal, p.APY, p.Accrued,
		p.CollateralAsset, p.Collateral, p.LTV, p.StartAt, p.LastAccrualAt)
	if err != nil {
		return fmt.Errorf("creating borrow position: %w", err)
	}
	return nil
}

func (s *SQLiteStore) UpdateBorrowPosition(ctx context.Context, p *BorrowPosition) error {
	const q = `UPDATE borrow_positions SET accrued = ?, last_accrual_at = ? WHERE id = ?`
	tag, err := s.db.ExecContext(ctx, q, p.Accrued, p.LastAccrualAt, p.ID)
	if err != nil {
		return fmt.Errorf("updating borrow position: %w", err)
	}
	if n, _ := tag.RowsAffected(); n == 0 {
		return ErrPositionNotFound
	}
	return nil
}

// --- sub-accounts ----------------------------------------------------------

func (s *SQLiteStore) ListSubAccounts(ctx context.Context, userID string) ([]SubAccount, error) {
	const q = `SELECT id, user_id, name, email, status, created_at FROM sub_accounts WHERE user_id = ? ORDER BY created_at`
	rows, err := s.db.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("listing sub-accounts: %w", err)
	}
	defer rows.Close()

	var out []SubAccount
	for rows.Next() {
		var a SubAccount
		if err := rows.Scan(&a.ID, &a.UserID, &a.Name, &a.Email, &a.Status, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning sub-account: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) CreateSubAccount(ctx context.Context, sub *SubAccount) error {
	const q = `INSERT INTO sub_accounts (id, user_id, name, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := s.db.ExecContext(ctx, q, sub.ID, sub.UserID, sub.Name, sub.Email, sub.Status, sub.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrDuplicateSubAccount
		}
		return fmt.Errorf("creating sub-account: %w", err)
	}
	return nil
}

func (s *SQLiteStore) DeleteSubAccount(ctx context.Context, userID, id string) error {
	tag, err := s.db.ExecContext(ctx, `DELETE FROM sub_accounts WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("deleting sub-account: %w", err)
	}
	if n, _ := tag.RowsAffected(); n == 0 {
		return errors.New("sub-account not found")
	}
	return nil
}

var _ Store = (*SQLiteStore)(nil)
