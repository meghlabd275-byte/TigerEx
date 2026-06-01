package models

import (
	"time"
)

// User represents a user account
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	IsActive     bool      `json:"is_active"`
	Tier         string    `json:"tier"`
	KYCStatus     string    `json:"kyc_status"`
}

// UserResponse is the public user info
type UserResponse struct {
	ID       string `json:"id"`
	Email   string `json:"email"`
	Username string `json:"username"`
	Tier    string `json:"tier"`
}

// RegisterRequest is the registration request
type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=8"`
}

// LoginRequest is the login request
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// AuthResponse is the authentication response
type AuthResponse struct {
	Token string       `json:"token"`
	User  UserResponse `json:"user"`
}

// Order sides
const (
	OrderSideBuy  = "buy"
	OrderSideSell = "sell"
)

// Order types
const (
	OrderTypeLimit       = "limit"
	OrderTypeMarket      = "market"
	OrderTypeStopLoss   = "stop_loss"
	OrderTypeTakeProfit = "take_profit"
	OrderTypeStopLimit   = "stop_limit"
)

// Order statuses
const (
	OrderStatusPending         = "pending"
	OrderStatusNew           = "new"
	OrderStatusPartiallyFilled = "partially_filled"
	OrderStatusFilled        = "filled"
	OrderStatusCancelled    = "cancelled"
	OrderStatusRejected      = "rejected"
	OrderStatusExpired       = "expired"
)

// Time in force
const (
	TimeInForceGTC = "good_till_cancel"
	TimeInForceIOC = "immediate_or_cancel"
	TimeInForceFOK = "fill_or_kill"
	TimeInForceGTD = "good_till_date"
)

// Order represents a trading order
type Order struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	Symbol           string    `json:"symbol"`
	Side             string    `json:"side"`
	Type             string    `json:"type"`
	Price            string    `json:"price"`
	Quantity         string    `json:"quantity"`
	FilledQuantity  string    `json:"filled_quantity"`
	StopPrice       string    `json:"stop_price,omitempty"`
	IcebergQuantity string    `json:"iceberg_quantity,omitempty"`
	Status          string    `json:"status"`
	TimeInForce     string    `json:"time_in_force"`
	ClientOrderID   string    `json:"client_order_id,omitempty"`
	ExecutedPrice   string    `json:"executed_price,omitempty"`
	Fees           string    `json:"fees"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// CreateOrderRequest is order creation request
type CreateOrderRequest struct {
	Symbol         string `json:"symbol" binding:"required"`
	Side           string `json:"side" binding:"required,oneof=buy sell"`
	Type           string `json:"type" binding:"required,oneof=limit market stop_loss take_profit stop_limit"`
	Price          string `json:"price" binding:"required"`
	Quantity       string `json:"quantity" binding:"required"`
	TimeInForce    string `json:"time_in_force"`
	StopPrice      string `json:"stop_price"`
	ClientOrderID  string `json:"client_order_id"`
}

// OrderResponse is order response
type OrderResponse struct {
	Order Order `json:"order"`
}

// Trade represents an execution trade
type Trade struct {
	ID            string    `json:"id"`
	OrderID       string    `json:"order_id"`
	Symbol        string    `json:"symbol"`
	Price         string    `json:"price"`
	Quantity      string    `json:"quantity"`
	Fee           string    `json:"fee"`
	Maker         bool      `json:"maker"`
	Taker         bool      `json:"taker"`
	Commission   string    `json:"commission"`
	CreatedAt     time.Time `json:"created_at"`
}

// Ticker represents market ticker
type Ticker struct {
	Symbol             string `json:"symbol"`
	Price              string `json:"price"`
	PriceChange        string `json:"price_change"`
	PriceChangePercent string `json:"price_change_percent"`
	Volume24h         string `json:"volume_24h"`
	QuoteVolume24h     string `json:"quote_volume_24h"`
	High24h            string `json:"high_24h"`
	Low24h             string `json:"low_24h"`
	LastUpdate        int64  `json:"last_update"`
}

// Claims represents JWT claims
type Claims struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Tier     string `json:"tier"`
	jwt.RegisteredClaims
}

// APIResponse is standard API response
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
	Message string    `json:"message,omitempty"`
}

// PaginationParams is pagination params
type PaginationParams struct {
	Page    int `form:"page,default=1"`
	Limit  int `form:"limit,default=100"`
}

// ErrorResponse is error response
type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}