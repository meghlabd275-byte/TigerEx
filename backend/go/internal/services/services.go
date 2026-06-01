package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/go-redis/redis/v9"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

var ErrNotFound = fmt.Errorf("not found")
var ErrInvalidOrder = fmt.Errorf("invalid order")
var ErrInsufficientBalance = fmt.Errorf("insufficient balance")
var ErrRateLimited = fmt.Errorf("rate limited")

// DatabaseConfig is database configuration
type DatabaseConfig struct {
	Host         string
	Port         int
	User         string
	Password    string
	DBName       string
	MaxOpenConns int
	MaxIdleConns int
}

// Database is the database connection wrapper
type Database struct {
	db          *sql.DB
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
		return nil, err
	}

	return &Database{db: db, maxOpenConns: cfg.MaxOpenConns, maxIdleConns: cfg.MaxIdleConns}, nil
}

// CreateUser creates a new user
func (d *Database) CreateUser(ctx context.Context, user interface{}) error {
	// Simplified: we'd iterate over fields
	log.Printf("Creating user: %v", user)
	return nil
}

// GetUserByEmail gets user by email
func (d *Database) GetUserByEmail(ctx context.Context, email string) (interface{}, error) {
	return nil, nil
}

// AuthService handles authentication
type AuthService struct {
	secret          string
	expirationHours int
}

// NewAuthService creates a new auth service
func NewAuthService(secret string, expirationHours int) *AuthService {
	return &AuthService{
		secret:          secret,
		expirationHours: expirationHours,
	}
}

// GenerateToken generates a JWT token
func (s *AuthService) GenerateToken(user interface{}) (string, error) {
	// Simplified for demo
	return uuid.New().String(), nil
}

// ValidateToken validates a JWT token
func (s *AuthService) ValidateToken(tokenString string) (*jwt.MapClaims, error) {
	// In production, parse and validate JWT
	// Return simplified claims
	claims := &jwt.MapClaims{
		"user_id": "demo-user",
	}
	return claims, nil
}

// OrderService handles order management
type OrderService struct {
	db          *Database
	redis       *redis.Client
	balances    map[string]map[string]string
	orderCount  int
}

// NewOrderService creates a new order service
func NewOrderService(db *Database, redis *redis.Client) *OrderService {
	svc := &OrderService{
		db:       db,
		redis:    redis,
		balances: make(map[string]map[string]string),
	}
	
	// Initialize demo balances
	svc.balances["demo-user"] = map[string]string{
		"USDT": "1000000",
		"BTC":  "10",
		"ETH":  "100",
	}
	
	return svc
}

// CreateOrder creates a new order
func (s *OrderService) CreateOrder(ctx context.Context, userID string, req interface{}) (interface{}, error) {
	// This would parse the request properly
	// For now, return a simple order
	
	orderID := uuid.New().String()
	order := map[string]interface{}{
		"id":                orderID,
		"user_id":           userID,
		"symbol":            "BTCUSDT",
		"side":              "buy",
		"type":              "limit",
		"price":             "50000",
		"quantity":          "0.1",
		"filled_quantity":  "0",
		"status":            "new",
		"time_in_force":     "good_till_cancel",
		"created_at":        time.Now().Unix(),
		"updated_at":        time.Now().Unix(),
	}
	
	// Store in Redis
	if s.redis != nil {
		key := fmt.Sprintf("order:%s", orderID)
		data, _ := json.Marshal(order)
		s.redis.Set(ctx, key, data, 24*time.Hour)
		
		// Index by user
		s.redis.SAdd(ctx, fmt.Sprintf("user:%s:orders", userID), orderID)
	}
	
	s.orderCount++
	log.Printf("Created order %s for user %s", orderID, userID)
	
	return order, nil
}

// CancelOrder cancels an order
func (s *OrderService) CancelOrder(ctx context.Context, userID, orderID string) error {
	// Verify ownership by checking Redis
	if s.redis != nil {
		key := fmt.Sprintf("order:%s", orderID)
		data, err := s.redis.Get(ctx, key).Bytes()
		if err != nil {
			return ErrNotFound
		}
		
		var order map[string]interface{}
		json.Unmarshal(data, &order)
		
		if order["user_id"] != userID {
			return fmt.Errorf("unauthorized")
		}
		
		order["status"] = "cancelled"
		order["updated_at"] = time.Now().Unix()
		
		newData, _ := json.Marshal(order)
		s.redis.Set(ctx, key, newData, 24*time.Hour)
		
		// Remove from user's orders
		s.redis.SRem(ctx, fmt.Sprintf("user:%s:orders", userID), orderID)
	}
	
	log.Printf("Cancelled order %s", orderID)
	return nil
}

// GetOrder gets an order
func (s *OrderService) GetOrder(ctx context.Context, userID, orderID string) (interface{}, error) {
	if s.redis == nil {
		return map[string]interface{}{"id": orderID}, nil
	}
	
	key := fmt.Sprintf("order:%s", orderID)
	data, err := s.redis.Get(ctx, key).Bytes()
	if err != nil {
		return nil, ErrNotFound
	}
	
	var order map[string]interface{}
	json.Unmarshal(data, &order)
	return order, nil
}

// GetUserOrders gets all user orders
func (s *OrderService) GetUserOrders(ctx context.Context, userID string) ([]interface{}, error) {
	if s.redis == nil {
		return []interface{}{}, nil
	}
	
	orderIDs, err := s.redis.SMembers(ctx, fmt.Sprintf("user:%s:orders", userID)).Result()
	if err != nil || len(orderIDs) == 0 {
		return []interface{}{}, nil
	}
	
	orders := make([]interface{}, len(orderIDs))
	for i, orderID := range orderIDs {
		order, _ := s.GetOrder(ctx, userID, orderID)
		orders[i] = order
	}
	
	return orders, nil
}

// MarketService handles market data
type MarketService struct {
	db    *Database
	redis *redis.Client
}

// NewMarketService creates a new market service
func NewMarketService(db *Database, redis *redis.Client) *MarketService {
	return &MarketService{
		db:    db,
		redis: redis,
	}
}

// GetTicker gets market ticker
func (s *MarketService) GetTicker(ctx context.Context, symbol string) (interface{}, error) {
	// In production, fetch from Redis or database
	return map[string]interface{}{
		"symbol":              symbol,
		"price":               "50000.00",
		"price_change":        "500.00",
		"price_change_percent": "1.01",
		"volume_24h":          "10000.5",
		"quote_volume_24h":    "500000000",
		"high_24h":           "51000.00",
		"low_24h":            "49000.00",
		"last_update":        time.Now().Unix(),
	}, nil
}

// SetTicker sets market ticker
func (s *MarketService) SetTicker(ctx context.Context, symbol string, ticker interface{}) error {
	if s.redis == nil {
		return nil
	}
	
	key := fmt.Sprintf("ticker:%s", symbol)
	data, _ := json.Marshal(ticker)
	s.redis.Set(ctx, key, data, 1*time.Second)
	
	return nil
}

// Close closes the database
func (d *Database) Close() error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

// Ping checks database connection
func (d *Database) Ping(ctx context.Context) error {
	if d.db != nil {
		return d.db.PingContext(ctx)
	}
	return nil
}