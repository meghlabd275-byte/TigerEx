package services

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrNotFound           = errors.New("not found")
	ErrInvalidOrder       = errors.New("invalid order")
	ErrInvalidInput       = errors.New("invalid input")
	ErrEmailTaken         = errors.New("email already registered")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountDisabled    = errors.New("account is not active")
	ErrRateLimited        = errors.New("rate limited")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrStorageUnavailable = errors.New("durable storage is not configured")
)

// DatabaseConfig is database configuration
type DatabaseConfig struct {
	Host         string
	Port         int
	User         string
	Password     string
	DBName       string
	MaxOpenConns int
	MaxIdleConns int
}

// Database wraps the SQL connection pool.
type Database struct {
	db           *sql.DB
	maxOpenConns int
	maxIdleConns int
}

// NewDatabase creates a new database connection
func NewDatabase(ctx context.Context, cfg DatabaseConfig) (*Database, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName,
	)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(cfg.MaxOpenConns)
	db.SetMaxIdleConns(cfg.MaxIdleConns)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}

	return &Database{db: db, maxOpenConns: cfg.MaxOpenConns, maxIdleConns: cfg.MaxIdleConns}, nil
}

// Ping checks database connectivity.
func (d *Database) Ping(ctx context.Context) error {
	if d.db == nil {
		return ErrStorageUnavailable
	}
	return d.db.PingContext(ctx)
}

// Close closes the database.
func (d *Database) Close() error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

// randomSalt returns a cryptographically random, per-user password salt.
func randomSalt() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(buf), nil
}

// AuthService issues and verifies HS256 access tokens and authenticates users.
type AuthService struct {
	db              *Database
	secret          string
	expirationHours int
}

// NewAuthService refuses a blank or short secret: either would allow token forgery.
func NewAuthService(db *Database, secret string, expirationHours int) (*AuthService, error) {
	if len(strings.TrimSpace(secret)) < 32 {
		return nil, errors.New("JWT secret must be at least 32 characters")
	}
	if expirationHours <= 0 {
		expirationHours = 24
	}
	return &AuthService{db: db, secret: secret, expirationHours: expirationHours}, nil
}

// GenerateToken signs an HS256 JWT whose subject is the user ID.
func (s *AuthService) GenerateToken(userID uuid.UUID) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub": userID.String(),
		"iat": now.Unix(),
		"exp": now.Add(time.Duration(s.expirationHours) * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.secret))
}

// ValidateToken verifies signature, algorithm and expiry, returning the caller identity.
func (s *AuthService) ValidateToken(tokenString string) (uuid.UUID, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(s.secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil || !token.Valid {
		return uuid.Nil, ErrUnauthorized
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return uuid.Nil, ErrUnauthorized
	}
	sub, _ := claims["sub"].(string)
	userID, err := uuid.Parse(sub)
	if err != nil {
		return uuid.Nil, ErrUnauthorized
	}
	return userID, nil
}

// Register creates a durable user account with a bcrypt password hash and a
// per-user salt, returning the new user ID.
func (s *AuthService) Register(ctx context.Context, email, username, password string) (uuid.UUID, error) {
	if s.db == nil || s.db.db == nil {
		return uuid.Nil, ErrStorageUnavailable
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || username == "" || len(password) < 8 {
		return uuid.Nil, ErrInvalidInput
	}

	salt, err := randomSalt()
	if err != nil {
		return uuid.Nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(salt+password), bcrypt.DefaultCost)
	if err != nil {
		return uuid.Nil, err
	}

	userID := uuid.New()
	const q = `
		INSERT INTO users (id, email, username, password_hash, password_salt)
		VALUES ($1, $2, $3, $4, $5)
	`
	if _, err := s.db.db.ExecContext(ctx, q, userID, email, username, string(hash), salt); err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return uuid.Nil, ErrEmailTaken
		}
		return uuid.Nil, fmt.Errorf("create user: %w", err)
	}
	return userID, nil
}

// Authenticate verifies an email/password pair against the durable store.
func (s *AuthService) Authenticate(ctx context.Context, email, password string) (uuid.UUID, error) {
	if s.db == nil || s.db.db == nil {
		return uuid.Nil, ErrStorageUnavailable
	}
	email = strings.ToLower(strings.TrimSpace(email))

	const q = `SELECT id, password_hash, password_salt, status FROM users WHERE email = $1 AND deleted_at IS NULL`
	var (
		id     uuid.UUID
		hash   string
		salt   string
		status string
	)
	err := s.db.db.QueryRowContext(ctx, q, email).Scan(&id, &hash, &salt, &status)
	if errors.Is(err, sql.ErrNoRows) {
		// Burn comparable CPU time so response latency does not reveal whether
		// the email address exists.
		_ = bcrypt.CompareHashAndPassword(
			[]byte("$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv"),
			[]byte(password))
		return uuid.Nil, ErrInvalidCredentials
	}
	if err != nil {
		return uuid.Nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(salt+password)); err != nil {
		return uuid.Nil, ErrInvalidCredentials
	}
	if status != "active" {
		return uuid.Nil, ErrAccountDisabled
	}
	return id, nil
}

// OrderService persists and retrieves orders.
type OrderService struct {
	db    *Database
	redis *redis.Client
}

// NewOrderService creates a new order service
func NewOrderService(db *Database, redisClient *redis.Client) *OrderService {
	return &OrderService{db: db, redis: redisClient}
}

const orderColumns = `o.id, o.user_id, m.symbol, o.side, o.type, o.time_in_force,
	COALESCE(o.price::text,''), COALESCE(o.stop_price::text,''),
	o.quantity::text, o.filled_quantity::text, o.status,
	COALESCE(o.client_order_id,''), o.created_at, o.updated_at`

func scanOrder(row interface{ Scan(...interface{}) error }) (*Order, error) {
	var o Order
	err := row.Scan(
		&o.ID, &o.UserID, &o.Symbol, &o.Side, &o.Type, &o.TimeInForce,
		&o.Price, &o.StopPrice, &o.Quantity, &o.FilledQty, &o.Status,
		&o.ClientOrderID, &o.CreatedAt, &o.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// CreateOrder persists an order. Orders are never acknowledged without durable storage.
func (s *OrderService) CreateOrder(ctx context.Context, userID uuid.UUID, req *OrderRequest) (*Order, error) {
	if s.db == nil || s.db.db == nil {
		return nil, ErrStorageUnavailable
	}
	if req == nil || req.Symbol == "" || req.Quantity == "" {
		return nil, ErrInvalidOrder
	}
	if req.Side != "buy" && req.Side != "sell" {
		return nil, ErrInvalidOrder
	}
	if req.Type == "" {
		req.Type = "limit"
	}
	if req.TimeInForce == "" {
		req.TimeInForce = "GTC"
	}
	if req.Type == "limit" && req.Price == "" {
		return nil, ErrInvalidOrder
	}

	orderID := uuid.New()
	now := time.Now()

	const q = `
		INSERT INTO orders (
			order_id, user_id, market_id, side, type, time_in_force,
			price, stop_price, quantity, filled_quantity, status,
			client_order_id, created_at, updated_at
		)
		SELECT $1, $2, m.id, $3, $4, $5,
		       NULLIF($6,'')::numeric, NULLIF($7,'')::numeric,
		       $8::numeric, 0, 'new', NULLIF($9,''), $10, $10
		FROM markets m WHERE m.symbol = $11
	`
	res, err := s.db.db.ExecContext(ctx, q,
		orderID.String(), userID, req.Side, req.Type, req.TimeInForce,
		req.Price, req.StopPrice, req.Quantity, req.ClientOrderID, now, req.Symbol,
	)
	if err != nil {
		return nil, fmt.Errorf("persist order: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, fmt.Errorf("%w: unknown market %s", ErrInvalidOrder, req.Symbol)
	}

	order := &Order{
		ID:            orderID,
		UserID:        userID,
		Symbol:        req.Symbol,
		Side:          req.Side,
		Type:          req.Type,
		TimeInForce:   req.TimeInForce,
		Price:         req.Price,
		StopPrice:     req.StopPrice,
		Quantity:      req.Quantity,
		FilledQty:     "0",
		Status:        "new",
		ClientOrderID: req.ClientOrderID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if s.redis != nil {
		if data, err := json.Marshal(order); err == nil {
			s.redis.Set(ctx, fmt.Sprintf("order:%s", orderID), data, 24*time.Hour)
		}
		s.redis.SAdd(ctx, fmt.Sprintf("user:%s:orders", userID), orderID.String())
	}

	return order, nil
}

// CancelOrder cancels an order owned by the caller. Ownership is enforced in SQL.
func (s *OrderService) CancelOrder(ctx context.Context, userID, orderID string) error {
	if s.db == nil || s.db.db == nil {
		return ErrStorageUnavailable
	}
	id, err := uuid.Parse(orderID)
	if err != nil {
		return ErrInvalidOrder
	}

	res, err := s.db.db.ExecContext(ctx,
		`UPDATE orders SET status = 'canceled', updated_at = $1
		 WHERE id = $2 AND user_id = $3 AND status IN ('new', 'partially_filled')`,
		time.Now(), id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}

	if s.redis != nil {
		s.redis.Del(ctx, fmt.Sprintf("order:%s", orderID))
		s.redis.SRem(ctx, fmt.Sprintf("user:%s:orders", userID), orderID)
	}
	return nil
}

// GetOrder returns a single order owned by the caller.
func (s *OrderService) GetOrder(ctx context.Context, userID, orderID string) (*Order, error) {
	if s.db == nil || s.db.db == nil {
		return nil, ErrStorageUnavailable
	}
	id, err := uuid.Parse(orderID)
	if err != nil {
		return nil, ErrInvalidOrder
	}
	return scanOrder(s.db.db.QueryRowContext(ctx,
		`SELECT `+orderColumns+` FROM orders o JOIN markets m ON m.id = o.market_id
		 WHERE o.id = $1 AND o.user_id = $2`, id, userID))
}

// GetUserOrders returns every order belonging to the caller, newest first.
func (s *OrderService) GetUserOrders(ctx context.Context, userID string) ([]Order, error) {
	if s.db == nil || s.db.db == nil {
		return nil, ErrStorageUnavailable
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil, ErrInvalidOrder
	}

	rows, err := s.db.db.QueryContext(ctx,
		`SELECT `+orderColumns+` FROM orders o JOIN markets m ON m.id = o.market_id
		 WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 500`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orders := make([]Order, 0)
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, *o)
	}
	return orders, rows.Err()
}

// MarketService serves market data from the configured stores.
type MarketService struct {
	db    *Database
	redis *redis.Client
}

// NewMarketService creates a new market service
func NewMarketService(db *Database, redisClient *redis.Client) *MarketService {
	return &MarketService{db: db, redis: redisClient}
}

// GetTicker returns the most recently recorded ticker for a symbol. It never
// fabricates a price: with no recorded market data the caller receives ErrNotFound.
func (s *MarketService) GetTicker(ctx context.Context, symbol string) (*Ticker, error) {
	if s.redis != nil {
		if data, err := s.redis.Get(ctx, fmt.Sprintf("ticker:%s", symbol)).Bytes(); err == nil {
			var t Ticker
			if json.Unmarshal(data, &t) == nil && t.Symbol != "" {
				return &t, nil
			}
		}
	}

	if s.db == nil || s.db.db == nil {
		return nil, ErrNotFound
	}

	const q = `
		SELECT m.symbol, t.last_price::text, t.price_change::text,
		       t.price_change_percent::text, t.volume_24h::text, t.quote_volume_24h::text,
		       t.high_24h::text, t.low_24h::text,
		       EXTRACT(EPOCH FROM t.timestamp)::bigint
		FROM markets m
		JOIN market_tickers t ON t.market_id = m.id
		WHERE m.symbol = $1
		ORDER BY t.timestamp DESC
		LIMIT 1
	`
	var t Ticker
	err := s.db.db.QueryRowContext(ctx, q, symbol).Scan(
		&t.Symbol, &t.Price, &t.PriceChange, &t.PriceChangePercent,
		&t.Volume24h, &t.QuoteVolume24h, &t.High24h, &t.Low24h, &t.LastUpdate,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// SetTicker caches the latest ticker for a symbol.
func (s *MarketService) SetTicker(ctx context.Context, symbol string, ticker *Ticker) error {
	if s.redis == nil {
		return ErrStorageUnavailable
	}
	data, err := json.Marshal(ticker)
	if err != nil {
		return err
	}
	return s.redis.Set(ctx, fmt.Sprintf("ticker:%s", symbol), data, 1*time.Second).Err()
}
