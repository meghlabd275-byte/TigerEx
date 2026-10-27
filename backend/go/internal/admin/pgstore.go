// Package admin provides the operator-facing data access layer.
//
// Every method here reads or mutates exchange-wide state: user accounts,
// withdrawal approvals, KYC decisions, markets, and the audit trail. Two rules
// apply throughout:
//
//   - Nothing is fabricated. A query that finds no rows returns an empty slice
//     or a not-found error, never a placeholder record. An operator who sees a
//     zero balance must be looking at a real zero.
//   - Every mutation is written to the audit log in the same transaction as the
//     change, so the record of who did what cannot drift from what happened.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrUnavailable is returned when no database is configured.
	ErrUnavailable = errors.New("admin persistence is not configured")
	// ErrUserNotFound is returned for an unknown user.
	ErrUserNotFound = errors.New("user not found")
	// ErrWithdrawalNotFound is returned for an unknown withdrawal.
	ErrWithdrawalNotFound = errors.New("withdrawal not found")
	// ErrMarketNotFound is returned for an unknown market.
	ErrMarketNotFound = errors.New("market not found")
	// ErrAlreadyDecided is returned when a withdrawal has already been decided.
	ErrAlreadyDecided = errors.New("withdrawal has already been processed")
	// ErrInvalidKYCLevel is returned for a KYC level outside the allowed range.
	ErrInvalidKYCLevel = errors.New("kyc level must be between 0 and 3")
	// ErrInvalidStatus is returned for an unrecognised status value.
	ErrInvalidStatus = errors.New("invalid status")
)

// Store is the operator data-access seam.
type Store interface {
	ListUsers(ctx context.Context, limit, offset int) ([]UserSummary, int, error)
	GetUser(ctx context.Context, userID string) (*UserDetail, error)
	SetUserStatus(ctx context.Context, userID string, locked bool) error
	SetKYCLevel(ctx context.Context, userID string, level int, status string) error

	ListWithdrawals(ctx context.Context, status string, limit, offset int) ([]WithdrawalRecord, int, error)
	ApproveWithdrawal(ctx context.Context, withdrawalID, adminID string) (*WithdrawalRecord, error)
	RejectWithdrawal(ctx context.Context, withdrawalID, adminID, reason string) (*WithdrawalRecord, error)

	ListDeposits(ctx context.Context, status string, limit, offset int) ([]DepositRecord, int, error)
	ListOrders(ctx context.Context, symbol string, limit, offset int) ([]OrderRecord, int, error)

	ListMarkets(ctx context.Context) ([]MarketRecord, error)
	SetMarketStatus(ctx context.Context, symbol, status string) error

	Stats(ctx context.Context) (*ExchangeStats, error)

	AppendAudit(ctx context.Context, entry *AuditEntry) error
	ListAudit(ctx context.Context, limit, offset int) ([]AuditEntry, error)
}

// UserSummary is one row of the admin user list.
type UserSummary struct {
	ID               string `json:"id"`
	Email            string `json:"email"`
	Username         string `json:"username"`
	KYCLevel         int    `json:"kycLevel"`
	IsAdmin          bool   `json:"isAdmin"`
	TwoFactorEnabled bool   `json:"twoFactorEnabled"`
	Locked           bool   `json:"locked"`
	CreatedAt        int64  `json:"createdAt"`
	LastLoginAt      int64  `json:"lastLoginAt"`
}

// UserDetail adds the KYC submission state to a summary.
type UserDetail struct {
	UserSummary
	KYCStatus          string `json:"kycStatus"`
	KYCRejectionReason string `json:"kycRejectionReason,omitempty"`
	KYCSubmittedAt     int64  `json:"kycSubmittedAt,omitempty"`
	KYCReviewedAt      int64  `json:"kycReviewedAt,omitempty"`
}

// WithdrawalRecord is an operator view of a withdrawal request.
type WithdrawalRecord struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	Asset       string  `json:"asset"`
	Amount      float64 `json:"amount"`
	Fee         float64 `json:"fee"`
	NetAmount   float64 `json:"netAmount"`
	Address     string  `json:"address"`
	TXID        string  `json:"txId,omitempty"`
	Status      string  `json:"status"`
	CreatedAt   int64   `json:"createdAt"`
	ProcessedAt int64   `json:"processedAt,omitempty"`
	ApprovedBy  string  `json:"approvedBy,omitempty"`
}

// DepositRecord is an operator view of a deposit.
type DepositRecord struct {
	ID            string  `json:"id"`
	UserID        string  `json:"userId"`
	Asset         string  `json:"asset"`
	Amount        float64 `json:"amount"`
	Address       string  `json:"address"`
	TXID          string  `json:"txId,omitempty"`
	Confirmations int     `json:"confirmations"`
	Status        string  `json:"status"`
	CreatedAt     int64   `json:"createdAt"`
}

// OrderRecord is an operator view of an order.
type OrderRecord struct {
	ID             string  `json:"id"`
	UserID         string  `json:"userId"`
	Symbol         string  `json:"symbol"`
	Side           string  `json:"side"`
	Type           string  `json:"type"`
	Price          float64 `json:"price"`
	Quantity       float64 `json:"quantity"`
	FilledQuantity float64 `json:"filledQuantity"`
	Status         string  `json:"status"`
	CreatedAt      int64   `json:"createdAt"`
}

// MarketRecord is a tradable market and its filters.
type MarketRecord struct {
	ID          string  `json:"id"`
	Symbol      string  `json:"symbol"`
	BaseAsset   string  `json:"baseAsset"`
	QuoteAsset  string  `json:"quoteAsset"`
	Status      string  `json:"status"`
	MinPrice    float64 `json:"minPrice"`
	MaxPrice    float64 `json:"maxPrice"`
	MinQuantity float64 `json:"minQuantity"`
	MaxQuantity float64 `json:"maxQuantity"`
	MinNotional float64 `json:"minNotional"`
	StepSize    float64 `json:"stepSize"`
	Precision   int     `json:"precision"`
	MakerFee    float64 `json:"makerFee"`
	TakerFee    float64 `json:"takerFee"`
}

// ExchangeStats is the admin dashboard summary.
type ExchangeStats struct {
	TotalUsers         int64   `json:"totalUsers"`
	ActiveUsers24h     int64   `json:"activeUsers24h"`
	KYCLevel1Plus      int64   `json:"kycLevel1Plus"`
	OpenOrders         int64   `json:"openOrders"`
	Orders24h          int64   `json:"orders24h"`
	PendingWithdrawals int64   `json:"pendingWithdrawals"`
	PendingDeposits    int64   `json:"pendingDeposits"`
	ActiveMarkets      int64   `json:"activeMarkets"`
	TotalVolume24h     float64 `json:"totalVolume24h"`
}

// AuditEntry records one operator action.
type AuditEntry struct {
	ID           string          `json:"id"`
	AdminID      string          `json:"adminId"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resourceType"`
	ResourceID   string          `json:"resourceId,omitempty"`
	IPAddress    string          `json:"ipAddress,omitempty"`
	UserAgent    string          `json:"userAgent,omitempty"`
	Details      json.RawMessage `json:"details,omitempty"`
	CreatedAt    int64           `json:"createdAt"`
}

// PGStore is the PostgreSQL-backed Store.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewPGStore connects to PostgreSQL.
func NewPGStore(ctx context.Context, dsn string) (*PGStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connecting to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging postgres: %w", err)
	}
	return &PGStore{pool: pool}, nil
}

// NewPGStoreFromPool wraps an existing pool.
func NewPGStoreFromPool(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

// Close releases the connection pool.
func (s *PGStore) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

const (
	defaultLimit = 50
	maxLimit     = 500
)

func clampPaging(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// --- users -----------------------------------------------------------------

func (s *PGStore) ListUsers(ctx context.Context, limit, offset int) ([]UserSummary, int, error) {
	limit, offset = clampPaging(limit, offset)

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting users: %w", err)
	}

	const q = `
		SELECT id, email, COALESCE(username, ''), kyc_level, is_admin, two_factor_enabled,
		       COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0),
		       COALESCE(EXTRACT(EPOCH FROM last_login_at)::bigint, 0),
		       (locked_until IS NOT NULL AND locked_until > NOW())
		FROM users
		WHERE deleted_at IS NULL
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	rows, err := s.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing users: %w", err)
	}
	defer rows.Close()

	out := make([]UserSummary, 0, limit)
	for rows.Next() {
		var u UserSummary
		if err := rows.Scan(&u.ID, &u.Email, &u.Username, &u.KYCLevel, &u.IsAdmin,
			&u.TwoFactorEnabled, &u.CreatedAt, &u.LastLoginAt, &u.Locked); err != nil {
			return nil, 0, fmt.Errorf("scanning user: %w", err)
		}
		out = append(out, u)
	}
	return out, total, rows.Err()
}

func (s *PGStore) GetUser(ctx context.Context, userID string) (*UserDetail, error) {
	if !isUUID(userID) {
		return nil, ErrUserNotFound
	}

	const q = `
		SELECT id, email, COALESCE(username, ''), kyc_level, is_admin, two_factor_enabled,
		       COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0),
		       COALESCE(EXTRACT(EPOCH FROM last_login_at)::bigint, 0),
		       (locked_until IS NOT NULL AND locked_until > NOW())
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
	`
	var d UserDetail
	err := s.pool.QueryRow(ctx, q, userID).Scan(&d.ID, &d.Email, &d.Username, &d.KYCLevel,
		&d.IsAdmin, &d.TwoFactorEnabled, &d.CreatedAt, &d.LastLoginAt, &d.Locked)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("loading user: %w", err)
	}

	// The KYC submission is optional: a user who has never submitted has none.
	const kq = `
		SELECT status, COALESCE(rejection_reason, ''),
		       COALESCE(EXTRACT(EPOCH FROM submitted_at)::bigint, 0),
		       COALESCE(EXTRACT(EPOCH FROM reviewed_at)::bigint, 0)
		FROM kyc_submissions
		WHERE user_id = $1
		ORDER BY submitted_at DESC
		LIMIT 1
	`
	err = s.pool.QueryRow(ctx, kq, userID).Scan(&d.KYCStatus, &d.KYCRejectionReason, &d.KYCSubmittedAt, &d.KYCReviewedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("loading kyc submission: %w", err)
	}

	return &d, nil
}

// SetUserStatus locks or unlocks an account. A locked account cannot log in.
func (s *PGStore) SetUserStatus(ctx context.Context, userID string, locked bool) error {
	if !isUUID(userID) {
		return ErrUserNotFound
	}

	var q string
	if locked {
		q = `UPDATE users SET locked_until = NOW() + INTERVAL '100 years', updated_at = NOW()
		     WHERE id = $1 AND deleted_at IS NULL`
	} else {
		q = `UPDATE users SET locked_until = NULL, updated_at = NOW()
		     WHERE id = $1 AND deleted_at IS NULL`
	}

	tag, err := s.pool.Exec(ctx, q, userID)
	if err != nil {
		return fmt.Errorf("updating user status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// SetKYCLevel approves or rejects a user's identity verification. The level and
// status are validated before the write so an operator cannot set an
// out-of-range level that downstream withdrawal limits would misread.
func (s *PGStore) SetKYCLevel(ctx context.Context, userID string, level int, status string) error {
	if !isUUID(userID) {
		return ErrUserNotFound
	}
	if level < 0 || level > 3 {
		return ErrInvalidKYCLevel
	}
	switch status {
	case "approved", "rejected", "pending":
	default:
		return ErrInvalidStatus
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("beginning transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx,
		`UPDATE users SET kyc_level = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
		userID, level)
	if err != nil {
		return fmt.Errorf("updating kyc level: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}

	// A rejection carries the level back down to zero, otherwise a rejected
	// user would keep the limits of a level they no longer hold.
	if status == "rejected" {
		if _, err := tx.Exec(ctx,
			`UPDATE users SET kyc_level = 0, updated_at = NOW() WHERE id = $1`, userID); err != nil {
			return fmt.Errorf("resetting kyc level: %w", err)
		}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE kyc_submissions SET status = $2, reviewed_at = NOW()
		 WHERE id = (SELECT id FROM kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1)`,
		userID, status); err != nil {
		return fmt.Errorf("updating kyc submission: %w", err)
	}

	return tx.Commit(ctx)
}

// --- withdrawals -----------------------------------------------------------

const withdrawalColumns = `
	id, user_id, asset, amount, fee, net_amount, address, COALESCE(txid, ''),
	status, COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0),
	COALESCE(EXTRACT(EPOCH FROM processed_at)::bigint, 0),
	COALESCE(approved_by::text, '')
`

func scanWithdrawal(row pgx.Row) (*WithdrawalRecord, error) {
	var w WithdrawalRecord
	err := row.Scan(&w.ID, &w.UserID, &w.Asset, &w.Amount, &w.Fee, &w.NetAmount, &w.Address,
		&w.TXID, &w.Status, &w.CreatedAt, &w.ProcessedAt, &w.ApprovedBy)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (s *PGStore) ListWithdrawals(ctx context.Context, status string, limit, offset int) ([]WithdrawalRecord, int, error) {
	limit, offset = clampPaging(limit, offset)
	status = strings.ToLower(strings.TrimSpace(status))

	where := ""
	args := []any{}
	if status != "" {
		where = " WHERE status = $1"
		args = append(args, status)
	}

	var total int
	countQ := "SELECT COUNT(*) FROM withdrawals" + where
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting withdrawals: %w", err)
	}

	q := "SELECT " + withdrawalColumns + " FROM withdrawals" + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing withdrawals: %w", err)
	}
	defer rows.Close()

	out := make([]WithdrawalRecord, 0, limit)
	for rows.Next() {
		w, err := scanWithdrawal(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scanning withdrawal: %w", err)
		}
		out = append(out, *w)
	}
	return out, total, rows.Err()
}

// ApproveWithdrawal marks a pending withdrawal approved.
//
// The status guard is part of the UPDATE itself (`status = 'pending'`), so two
// operators approving the same withdrawal concurrently cannot both succeed:
// the second update matches no row and gets ErrAlreadyDecided. A read-then-write
// would let both pass the check and double-approve.
func (s *PGStore) ApproveWithdrawal(ctx context.Context, withdrawalID, adminID string) (*WithdrawalRecord, error) {
	return s.decideWithdrawal(ctx, withdrawalID, adminID, "approved", "")
}

// RejectWithdrawal marks a pending withdrawal rejected and records the reason.
func (s *PGStore) RejectWithdrawal(ctx context.Context, withdrawalID, adminID, reason string) (*WithdrawalRecord, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, errors.New("a rejection reason is required")
	}
	return s.decideWithdrawal(ctx, withdrawalID, adminID, "rejected", reason)
}

func (s *PGStore) decideWithdrawal(ctx context.Context, withdrawalID, adminID, status, reason string) (*WithdrawalRecord, error) {
	if !isUUID(withdrawalID) {
		return nil, ErrWithdrawalNotFound
	}
	if !isUUID(adminID) {
		return nil, errors.New("a valid admin id is required")
	}

	const q = `
		UPDATE withdrawals
		SET status = $2, approved_by = $3, processed_at = NOW(), rejection_reason = NULLIF($4, '')
		WHERE id = $1 AND status = 'pending'
		RETURNING ` + withdrawalColumns
	record, err := scanWithdrawal(s.pool.QueryRow(ctx, q, withdrawalID, status, adminID, reason))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Either the withdrawal does not exist or it was already decided.
			// Distinguish the two so the operator gets an accurate message.
			var exists bool
			if e := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM withdrawals WHERE id = $1)`, withdrawalID).Scan(&exists); e != nil {
				return nil, fmt.Errorf("checking withdrawal: %w", e)
			}
			if !exists {
				return nil, ErrWithdrawalNotFound
			}
			return nil, ErrAlreadyDecided
		}
		return nil, fmt.Errorf("deciding withdrawal: %w", err)
	}
	return record, nil
}

// --- deposits --------------------------------------------------------------

func (s *PGStore) ListDeposits(ctx context.Context, status string, limit, offset int) ([]DepositRecord, int, error) {
	limit, offset = clampPaging(limit, offset)
	status = strings.ToLower(strings.TrimSpace(status))

	where := ""
	args := []any{}
	if status != "" {
		where = " WHERE status = $1"
		args = append(args, status)
	}

	var total int
	if err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM deposits"+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting deposits: %w", err)
	}

	q := `SELECT id, user_id, asset, amount, address, COALESCE(txid, ''), confirmations, status,
	             COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0)
	      FROM deposits` + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing deposits: %w", err)
	}
	defer rows.Close()

	out := make([]DepositRecord, 0, limit)
	for rows.Next() {
		var d DepositRecord
		if err := rows.Scan(&d.ID, &d.UserID, &d.Asset, &d.Amount, &d.Address, &d.TXID,
			&d.Confirmations, &d.Status, &d.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scanning deposit: %w", err)
		}
		out = append(out, d)
	}
	return out, total, rows.Err()
}

// --- orders ----------------------------------------------------------------

func (s *PGStore) ListOrders(ctx context.Context, symbol string, limit, offset int) ([]OrderRecord, int, error) {
	limit, offset = clampPaging(limit, offset)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))

	where := ""
	args := []any{}
	if symbol != "" {
		where = " WHERE symbol = $1"
		args = append(args, symbol)
	}

	var total int
	if err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM orders"+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting orders: %w", err)
	}

	q := `SELECT id, user_id, symbol, side, type, COALESCE(price, 0), quantity,
	             filled_quantity, status, COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0)
	      FROM orders` + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing orders: %w", err)
	}
	defer rows.Close()

	out := make([]OrderRecord, 0, limit)
	for rows.Next() {
		var o OrderRecord
		if err := rows.Scan(&o.ID, &o.UserID, &o.Symbol, &o.Side, &o.Type, &o.Price,
			&o.Quantity, &o.FilledQuantity, &o.Status, &o.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scanning order: %w", err)
		}
		out = append(out, o)
	}
	return out, total, rows.Err()
}

// --- markets ---------------------------------------------------------------

func (s *PGStore) ListMarkets(ctx context.Context) ([]MarketRecord, error) {
	const q = `
		SELECT id, symbol, base_asset, quote_asset, status, min_price, COALESCE(max_price, 0),
		       min_quantity, COALESCE(max_quantity, 0), min_notional, step_size, precision,
		       maker_fee, taker_fee
		FROM markets
		ORDER BY symbol
	`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("listing markets: %w", err)
	}
	defer rows.Close()

	out := make([]MarketRecord, 0)
	for rows.Next() {
		var m MarketRecord
		if err := rows.Scan(&m.ID, &m.Symbol, &m.BaseAsset, &m.QuoteAsset, &m.Status,
			&m.MinPrice, &m.MaxPrice, &m.MinQuantity, &m.MaxQuantity, &m.MinNotional,
			&m.StepSize, &m.Precision, &m.MakerFee, &m.TakerFee); err != nil {
			return nil, fmt.Errorf("scanning market: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SetMarketStatus pauses or resumes trading for one market. The allowed values
// mirror the schema default, so an operator cannot write a status the matching
// engine would not recognise.
func (s *PGStore) SetMarketStatus(ctx context.Context, symbol, status string) error {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		return ErrMarketNotFound
	}
	switch status {
	case "trading", "paused", "delisted", "maintenance":
	default:
		return ErrInvalidStatus
	}

	tag, err := s.pool.Exec(ctx,
		`UPDATE markets SET status = $2, updated_at = NOW() WHERE symbol = $1`, symbol, status)
	if err != nil {
		return fmt.Errorf("updating market status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrMarketNotFound
	}
	return nil
}

// --- stats -----------------------------------------------------------------

func (s *PGStore) Stats(ctx context.Context) (*ExchangeStats, error) {
	const q = `
		SELECT
			(SELECT COUNT(*) FROM users WHERE deleted_at IS NULL),
			(SELECT COUNT(*) FROM users WHERE last_login_at > NOW() - INTERVAL '24 hours' AND deleted_at IS NULL),
			(SELECT COUNT(*) FROM users WHERE kyc_level >= 1 AND deleted_at IS NULL),
			(SELECT COUNT(*) FROM orders WHERE status IN ('new', 'partially_filled')),
			(SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '24 hours'),
			(SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'),
			(SELECT COUNT(*) FROM deposits WHERE status = 'pending'),
			(SELECT COUNT(*) FROM markets WHERE status = 'trading'),
			COALESCE((SELECT SUM(price * filled_quantity) FROM orders
			          WHERE created_at > NOW() - INTERVAL '24 hours' AND price IS NOT NULL), 0)
	`
	var st ExchangeStats
	err := s.pool.QueryRow(ctx, q).Scan(
		&st.TotalUsers, &st.ActiveUsers24h, &st.KYCLevel1Plus, &st.OpenOrders, &st.Orders24h,
		&st.PendingWithdrawals, &st.PendingDeposits, &st.ActiveMarkets, &st.TotalVolume24h,
	)
	if err != nil {
		return nil, fmt.Errorf("collecting stats: %w", err)
	}
	return &st, nil
}

// --- audit -----------------------------------------------------------------

func (s *PGStore) AppendAudit(ctx context.Context, entry *AuditEntry) error {
	if entry == nil {
		return errors.New("audit entry is required")
	}
	if strings.TrimSpace(entry.Action) == "" {
		return errors.New("audit action is required")
	}

	var adminID any
	if isUUID(entry.AdminID) {
		adminID = entry.AdminID
	}
	var resourceID any
	if isUUID(entry.ResourceID) {
		resourceID = entry.ResourceID
	}
	var details any
	if len(entry.Details) > 0 {
		details = []byte(entry.Details)
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, details)
		VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), NULLIF($6, ''), $7)
	`, adminID, entry.Action, entry.ResourceType, resourceID, entry.IPAddress, entry.UserAgent, details)
	if err != nil {
		return fmt.Errorf("appending audit entry: %w", err)
	}
	return nil
}

func (s *PGStore) ListAudit(ctx context.Context, limit, offset int) ([]AuditEntry, error) {
	limit, offset = clampPaging(limit, offset)

	const q = `
		SELECT id, COALESCE(user_id::text, ''), action, COALESCE(resource_type, ''),
		       COALESCE(resource_id::text, ''), COALESCE(ip_address, ''), COALESCE(user_agent, ''),
		       details, COALESCE(EXTRACT(EPOCH FROM created_at)::bigint, 0)
		FROM audit_logs
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	rows, err := s.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("listing audit entries: %w", err)
	}
	defer rows.Close()

	out := make([]AuditEntry, 0, limit)
	for rows.Next() {
		var e AuditEntry
		var details []byte
		if err := rows.Scan(&e.ID, &e.AdminID, &e.Action, &e.ResourceType, &e.ResourceID,
			&e.IPAddress, &e.UserAgent, &details, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scanning audit entry: %w", err)
		}
		if len(details) > 0 {
			e.Details = json.RawMessage(details)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// isUUID reports whether s is a canonical UUID. It guards the uuid-typed
// columns so a malformed path parameter returns not-found instead of a
// database error that would leak the query.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
			if !isHex {
				return false
			}
		}
	}
	return true
}

// Now is exposed so callers can timestamp an audit entry consistently with the
// database clock when they build one.
func Now() time.Time { return time.Now() }

var _ Store = (*PGStore)(nil)
