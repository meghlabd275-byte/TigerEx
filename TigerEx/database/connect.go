package database

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/tracelog"
	"golang.org/x/crypto/bcrypt"
)

// Config holds database configuration
type Config struct {
	Host         string
	Port         int
	User         string
	Password     string
	Database     string
	MaxConns     int32
	MinConns     int32
	MaxConnLifetime time.Duration
	HealthCheckPeriod time.Duration
}

// NewConfig creates config from environment or defaults
func NewConfig() *Config {
	return &Config{
		Host:         getEnv("DB_HOST", "localhost"),
		Port:         parseInt(getEnv("DB_PORT", "5432"), 5432),
		User:         getEnv("DB_USER", "tigerex"),
		Password:     getEnv("DB_PASSWORD", "tigerex"),
		Database:     getEnv("DB_NAME", "tigerex"),
		MaxConns:     parseInt(getEnv("DB_MAX_CONNS", "100"), 100),
		MinConns:     parseInt(getEnv("DB_MIN_CONNS", "10"), 10),
		MaxConnLifetime: parseDuration(getEnv("DB_MAX_CONN_LIFETIME", "30m"), 30*time.Minute),
		HealthCheckPeriod: parseDuration(getEnv("DB_HEALTH_CHECK", "1m"), 1*time.Minute),
	}
}

// Connection represents a database connection with pooling
type Connection struct {
	pool *pgxpool.Pool
	mu   sync.RWMutex
	config *Config
}

// NewConnection creates a new database connection
func NewConnection(ctx context.Context, cfg *Config) (*Connection, error) {
	connStr := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=require&pool_max_conns=%d",
		cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Database, cfg.MaxConns,
	)

	// Configure pool
	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	config.MaxConns = cfg.MaxConns
	config.MinConns = cfg.MinConns
	
	// Configure connection lifetime
	config.MaxConnLifetime = cfg.MaxConnLifetime
	
	// Configure health check
	config.HealthCheckPeriod = cfg.HealthCheckPeriod

	// Add logging for queries over 100ms
	config.Tracer = &tracelog.TraceLog{
		Logger: tracelog.NewStdLogger(nil),
		LogTracemsg: true,
		LogParams: true,
		Tracer: pgxpool.NewStdTracer(),
	}

	// Create pool
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Connection{
		pool:   pool,
		config: cfg,
	}, nil
}

// Pool returns the underlying pool
func (c *Connection) Pool() *pgxpool.Pool {
	return c.pool
}

// Close closes the connection pool
func (c *Connection) Close() {
	if c.pool != nil {
		c.pool.Close()
	}
}

// HealthCheck performs a health check
func (c *Connection) HealthCheck(ctx context.Context) error {
	return c.pool.Ping(ctx)
}

// =============================================================================
// USER OPERATIONS
// =============================================================================

// User represents a user in the system
type User struct {
	ID              string    `json:"id"`
	Email          string    `json:"email"`
	Phone          string    `json:"phone"`
	Username       string    `json:"username"`
	PasswordHash   string    `json:"-"`
	KYCLevel       int       `json:"kycLevel"`
	Status         string    `json:"status"`
	CanTrade      bool      `json:"canTrade"`
	CanWithdraw   bool      `json:"canWithdraw"`
	CanDeposit    bool      `json:"canDeposit"`
	Country       string    `json:"country"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// CreateUser creates a new user
func (c *Connection) CreateUser(ctx context.Context, email, username, password, phone, country string) (*User, error) {
	// Hash password with bcrypt
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &User{}
	err = c.pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, phone, country, kyc_level, status)
		VALUES ($1, $2, $3, $4, $5, 0, 'pending')
		RETURNING id, email, username, phone, country, kyc_level, status, can_trade, can_withdraw, can_deposit, created_at, updated_at
	`, email, username, string(hashedPassword), phone, country).Scan(
		&user.ID, &user.Email, &user.Username, &user.Phone, &user.Country, 
		&user.KYCLevel, &user.Status, &user.CanTrade, &user.CanWithdraw, &user.CanDeposit,
		&user.CreatedAt, &user.UpdatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	
	return user, nil
}

// GetUserByID retrieves a user by ID
func (c *Connection) GetUserByID(ctx context.Context, id string) (*User, error) {
	user := &User{}
	err := c.pool.QueryRow(ctx, `
		SELECT id, email, username, phone, country, kyc_level, status, can_trade, can_withdraw, can_deposit, created_at, updated_at
		FROM users WHERE id = $1
	`, id).Scan(
		&user.ID, &user.Email, &user.Username, &user.Phone, &user.Country,
		&user.KYCLevel, &user.Status, &user.CanTrade, &user.CanWithdraw, &user.CanDeposit,
		&user.CreatedAt, &user.UpdatedAt,
	)
	
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	
	return user, nil
}

// GetUserByEmail retrieves a user by email
func (c *Connection) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	user := &User{}
	err := c.pool.QueryRow(ctx, `
		SELECT id, email, username, phone, country, kyc_level, status, can_trade, can_withdraw, can_deposit, created_at, updated_at
		FROM users WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.Username, &user.Phone, &user.Country,
		&user.KYCLevel, &user.Status, &user.CanTrade, &user.CanWithdraw, &user.CanDeposit,
		&user.CreatedAt, &user.UpdatedAt,
	)
	
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	
	return user, nil
}

// VerifyPassword verifies a user's password
func (c *Connection) VerifyPassword(ctx context.Context, email, password string) (*User, error) {
	var id, passwordHash string
	err := c.pool.QueryRow(ctx, `
		SELECT id, password_hash FROM users WHERE email = $1
	`, email).Scan(&id, &passwordHash)
	
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("invalid credentials")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}
	
	return c.GetUserByID(ctx, id)
}

// UpdateUserStatus updates a user's status
func (c *Connection) UpdateUserStatus(ctx context.Context, id, status string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1
	`, id, status)
	
	if err != nil {
		return fmt.Errorf("failed to update user status: %w", err)
	}
	
	return nil
}

// UpdateUserPermissions updates user permissions
func (c *Connection) UpdateUserPermissions(ctx context.Context, id string, canTrade, canWithdraw, canDeposit bool) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE users SET 
			can_trade = $2, 
			can_withdraw = $3, 
			can_deposit = $4,
			updated_at = NOW() 
		WHERE id = $1
	`, id, canTrade, canWithdraw, canDeposit)
	
	if err != nil {
		return fmt.Errorf("failed to update permissions: %w", err)
	}
	
	return nil
}

// =============================================================================
// SESSION OPERATIONS
// =============================================================================

// Session represents a user session
type Session struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	Token        string    `json:"token"`
	RefreshToken string   `json:"refreshToken"`
	IPAddress    string   `json:"ipAddress"`
	UserAgent    string   `json:"userAgent"`
	ExpiresAt    time.Time `json:"expiresAt"`
	CreatedAt    time.Time `json:"createdAt"`
}

// CreateSession creates a new session
func (c *Connection) CreateSession(ctx context.Context, userID, ipAddress, userAgent string) (*Session, error) {
	token := generateToken(32)
	refreshToken := generateToken(32)
	expiresAt := time.Now().Add(7 * 24 * time.Hour) // 7 days

	session := &Session{}
	err := c.pool.QueryRow(ctx, `
		INSERT INTO user_sessions (user_id, token, refresh_token, ip_address, user_agent, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, user_id, token, refresh_token, ip_address, user_agent, expires_at, created_at
	`, userID, token, refreshToken, ipAddress, userAgent, expiresAt).Scan(
		&session.ID, &session.UserID, &session.Token, &session.RefreshToken,
		&session.IPAddress, &session.UserAgent, &session.ExpiresAt, &session.CreatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}
	
	return session, nil
}

// GetSession retrieves a session by token
func (c *Connection) GetSession(ctx context.Context, token string) (*Session, error) {
	session := &Session{}
	err := c.pool.QueryRow(ctx, `
		SELECT id, user_id, token, refresh_token, ip_address, user_agent, expires_at, created_at
		FROM user_sessions WHERE token = $1 AND expires_at > NOW()
	`, token).Scan(
		&session.ID, &session.UserID, &session.Token, &session.RefreshToken,
		&session.IPAddress, &session.UserAgent, &session.ExpiresAt, &session.CreatedAt,
	)
	
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("session not found or expired")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	
	return session, nil
}

// RefreshSession refreshes a session
func (c *Connection) RefreshSession(ctx context.Context, refreshToken string) (*Session, error) {
	// Get existing session
	var userID string
	err := c.pool.QueryRow(ctx, `
		SELECT user_id FROM user_sessions WHERE refresh_token = $1 AND expires_at > NOW()
	`, refreshToken).Scan(&userID)
	
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("session not found or expired")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to refresh session: %w", err)
	}
	
	// Delete old session
	c.pool.Exec(ctx, `DELETE FROM user_sessions WHERE refresh_token = $1`, refreshToken)
	
	// Create new session
	return c.CreateSession(ctx, userID, "", "")
}

// DeleteSession deletes a session
func (c *Connection) DeleteSession(ctx context.Context, token string) error {
	_, err := c.pool.Exec(ctx, `DELETE FROM user_sessions WHERE token = $1`, token)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}
	return nil
}

// DeleteUserSessions deletes all sessions for a user
func (c *Connection) DeleteUserSessions(ctx context.Context, userID string) error {
	_, err := c.pool.Exec(ctx, `DELETE FROM user_sessions WHERE user_id = $1`, userID)
	if err != nil {
		return fmt.Errorf("failed to delete sessions: %w", err)
	}
	return nil
}

// =============================================================================
// ACCOUNT WALLET OPERATIONS
// =============================================================================

// Account represents an account wallet
type Account struct {
	ID          string    `json:"id"`
	UserID     string    `json:"userId"`
	Asset     string    `json:"asset"`
	Balance   float64   `json:"balance"`
	Locked    float64   `json:"locked"`
	Available float64   `json:"available"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateAccount creates a new account
func (c *Connection) CreateAccount(ctx context.Context, userID, asset string) (*Account, error) {
	account := &Account{}
	err := c.pool.QueryRow(ctx, `
		INSERT INTO accounts (user_id, asset, balance, locked)
		VALUES ($1, $2, 0, 0)
		RETURNING id, user_id, asset, balance, locked, available, updated_at
	`, userID, asset).Scan(
		&account.ID, &account.UserID, &account.Asset, &account.Balance,
		&account.Locked, &account.Available, &account.UpdatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}
	
	return account, nil
}

// GetAccount gets an account
func (c *Connection) GetAccount(ctx context.Context, userID, asset string) (*Account, error) {
	account := &Account{}
	err := c.pool.QueryRow(ctx, `
		SELECT id, user_id, asset, balance, locked, available, updated_at
		FROM accounts WHERE user_id = $1 AND asset = $2
	`, userID, asset).Scan(
		&account.ID, &account.UserID, &account.Asset, &account.Balance,
		&account.Locked, &account.Available, &account.UpdatedAt,
	)
	
	if err == pgx.ErrNoRows {
		// Create account if doesn't exist
		return c.CreateAccount(ctx, userID, asset)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	
	account.Available = account.Balance - account.Locked
	return account, nil
}

// CreditAccount credits an account
func (c *Connection) CreditAccount(ctx context.Context, userID, asset string, amount float64) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE accounts SET 
			balance = balance + $3,
			available = balance + $3 - locked,
			updated_at = NOW()
		WHERE user_id = $1 AND asset = $2
	`, userID, asset, amount)
	
	if err != nil {
		return fmt.Errorf("failed to credit account: %w", err)
	}
	
	return nil
}

// DebitAccount debits an account
func (c *Connection) DebitAccount(ctx context.Context, userID, asset string, amount float64) error {
	result, err := c.pool.Exec(ctx, `
		UPDATE accounts SET 
			balance = balance - $3,
			available = balance - $3 - locked,
			updated_at = NOW()
		WHERE user_id = $1 AND asset = $2 AND balance >= $3
	`, userID, asset, amount)
	
	if err != nil {
		return fmt.Errorf("failed to debit account: %w", err)
	}
	
	if result.RowsAffected() == 0 {
		return fmt.Errorf("insufficient balance")
	}
	
	return nil
}

// LockFunds locks funds in an account
func (c *Connection) LockFunds(ctx context.Context, userID, asset string, amount float64) error {
	result, err := c.pool.Exec(ctx, `
		UPDATE accounts SET 
			locked = locked + $3,
			available = balance - (locked + $3),
			updated_at = NOW()
		WHERE user_id = $1 AND asset = $2 AND available >= $3
	`, userID, asset, amount)
	
	if err != nil {
		return fmt.Errorf("failed to lock funds: %w", err)
	}
	
	if result.RowsAffected() == 0 {
		return fmt.Errorf("insufficient available balance")
	}
	
	return nil
}

// UnlockFunds unlocks funds in an account
func (c *Connection) UnlockFunds(ctx context.Context, userID, asset string, amount float64) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE accounts SET 
			locked = locked - $3,
			available = balance - (locked - $3),
			updated_at = NOW()
		WHERE user_id = $1 AND asset = $2 AND locked >= $3
	`, userID, asset, amount)
	
	if err != nil {
		return fmt.Errorf("failed to unlock funds: %w", err)
	}
	
	return nil
}

// GetAccounts gets all accounts for a user
func (c *Connection) GetAccounts(ctx context.Context, userID string) ([]*Account, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, user_id, asset, balance, locked, available, updated_at
		FROM accounts WHERE user_id = $1
	`, userID)
	
	if err != nil {
		return nil, fmt.Errorf("failed to get accounts: %w", err)
	}
	defer rows.Close()
	
	var accounts []*Account
	for rows.Next() {
		account := &Account{}
		if err := rows.Scan(
			&account.ID, &account.UserID, &account.Asset, &account.Balance,
			&account.Locked, &account.Available, &account.UpdatedAt,
		); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	
	return accounts, nil
}

// =============================================================================
// ORDER OPERATIONS
// =============================================================================

// Order represents a trading order
type Order struct {
	ID            string    `json:"id"`
	UserID        string    `json:"userId"`
	AccountID    string    `json:"accountId"`
	Symbol       string    `json:"symbol"`
	Side         string    `json:"side"`
	Type         string    `json:"type"`
	Price        float64   `json:"price"`
	Quantity     float64   `json:"quantity"`
	Filled       float64   `json:"filled"`
	Remaining    float64   `json:"remaining"`
	AvgFillPrice float64   `json:"avgFillPrice"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// CreateOrder creates a new order
func (c *Connection) CreateOrder(ctx context.Context, order *Order) (*Order, error) {
	err := c.pool.QueryRow(ctx, `
		INSERT INTO orders (user_id, account_id, symbol, side, type, price, quantity, filled, remaining, avg_fill_price, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at, updated_at
	`, order.UserID, order.AccountID, order.Symbol, order.Side, order.Type,
		order.Price, order.Quantity, order.Filled, order.Remaining, order.AvgFillPrice,
		order.Status).Scan(&order.ID, &order.CreatedAt, &order.UpdatedAt)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create order: %w", err)
	}
	
	return order, nil
}

// GetOrder gets an order
func (c *Connection) GetOrder(ctx context.Context, id string) (*Order, error) {
	order := &Order{}
	err := c.pool.QueryRow(ctx, `
		SELECT id, user_id, account_id, symbol, side, type, price, quantity, filled, remaining, avg_fill_price, status, created_at, updated_at
		FROM orders WHERE id = $1
	`, id).Scan(
		&order.ID, &order.UserID, &order.AccountID, &order.Symbol, &order.Side,
		&order.Type, &order.Price, &order.Quantity, &order.Filled, &order.Remaining,
		&order.AvgFillPrice, &order.Status, &order.CreatedAt, &order.UpdatedAt,
	)
	
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("order not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get order: %w", err)
	}
	
	return order, nil
}

// UpdateOrder updates an order
func (c *Connection) UpdateOrder(ctx context.Context, id, status string, filled, avgFillPrice float64) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE orders SET 
			status = $2,
			filled = $3,
			remaining = quantity - $3,
			avg_fill_price = $4,
			updated_at = NOW()
		WHERE id = $1
	`, id, status, filled, avgFillPrice)
	
	if err != nil {
		return fmt.Errorf("failed to update order: %w", err)
	}
	
	return nil
}

// CancelOrder cancels an order
func (c *Connection) CancelOrder(ctx context.Context, id string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1
	`, id)
	
	if err != nil {
		return fmt.Errorf("failed to cancel order: %w", err)
	}
	
	return nil
}

// GetOpenOrders gets open orders for a symbol
func (c *Connection) GetOpenOrders(ctx context.Context, userID, symbol string) ([]*Order, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, user_id, account_id, symbol, side, type, price, quantity, filled, remaining, avg_fill_price, status, created_at, updated_at
		FROM orders WHERE user_id = $1 AND symbol = $2 AND status IN ('open', 'partially_filled')
	`, userID, symbol)
	
	if err != nil {
		return nil, fmt.Errorf("failed to get orders: %w", err)
	}
	defer rows.Close()
	
	var orders []*Order
	for rows.Next() {
		order := &Order{}
		if err := rows.Scan(
			&order.ID, &order.UserID, &order.AccountID, &order.Symbol, &order.Side,
			&order.Type, &order.Price, &order.Quantity, &order.Filled, &order.Remaining,
			&order.AvgFillPrice, &order.Status, &order.CreatedAt, &order.UpdatedAt,
		); err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	
	return orders, nil
}

// =============================================================================
// LEDGER OPERATIONS (for transaction history)
// =============================================================================

// LedgerEntry represents a ledger entry
type LedgerEntry struct {
	ID          string    `json:"id"`
	AccountID  string    `json:"accountId"`
	Type      string    `json:"type"`
	Amount    float64   `json:"amount"`
	Balance   float64   `json:"balance"`
	Reference string   `json:"reference"`
	Metadata  string    `json:"metadata"`
	CreatedAt time.Time `json:"createdAt"`
}

// CreateLedgerEntry creates a ledger entry
func (c *Connection) CreateLedgerEntry(ctx context.Context, entry *LedgerEntry) (*LedgerEntry, error) {
	err := c.pool.QueryRow(ctx, `
		INSERT INTO ledger (account_id, type, amount, balance, reference, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at
	`, entry.AccountID, entry.Type, entry.Amount, entry.Balance, entry.Reference, entry.Metadata).Scan(
		&entry.ID, &entry.CreatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create ledger entry: %w", err)
	}
	
	return entry, nil
}

// GetLedgerEntries gets ledger entries for an account
func (c *Connection) GetLedgerEntries(ctx context.Context, accountID string, limit int) ([]*LedgerEntry, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, account_id, type, amount, balance, reference, metadata, created_at
		FROM ledger WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2
	`, accountID, limit)
	
	if err != nil {
		return nil, fmt.Errorf("failed to get ledger: %w", err)
	}
	defer rows.Close()
	
	var entries []*LedgerEntry
	for rows.Next() {
		entry := &LedgerEntry{}
		if err := rows.Scan(
			&entry.ID, &entry.AccountID, &entry.Type, &entry.Amount,
			&entry.Balance, &entry.Reference, &entry.Metadata, &entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	
	return entries, nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// generateToken generates a random token
func generateToken(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// getEnv gets an environment variable or default
func getEnv(key, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

// parseInt parses an integer
func parseInt(val string, def int) int {
	if val == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(val, "%d", &n); err != nil {
		return def
	}
	return n
}

// parseDuration parses a duration
func parseDuration(val string, def time.Duration) time.Duration {
	val = strings.TrimSpace(val)
	if val == "" {
		return def
	}
	d, err := time.ParseDuration(val)
	if err != nil {
		return def
	}
	return d
}