// Package api provides the API types for TigerEx
package api

import (
	"time"
)

// User represents a user account
type User struct {
	ID               string    `json:"id"`
	Email            string    `json:"email"`
	Username         string    `json:"username"`
	Password         string    `json:"-"`
	Phone           string    `json:"phone,omitempty"`
	TwoFactorEnabled bool      `json:"twoFactorEnabled"`
	TwoFactorSecret  string    `json:"-"`
	KYCLevel        int       `json:"kycLevel"`
	IsAdmin         bool      `json:"isAdmin"`
	RefCode        string    `json:"refCode,omitempty"`
	ReferrerID     string    `json:"referrerId,omitempty"`
	CreatedAt      int64     `json:"createdAt"`
	UpdatedAt      int64     `json:"updatedAt"`
	LastLoginAt    int64     `json:"lastLoginAt,omitempty"`
	LockedUntil   int64     `json:"lockedUntil,omitempty"`
}

// Order represents a trading order
type Order struct {
	ID              string    `json:"id"`
	UserID          string    `json:"userId"`
	Symbol         string    `json:"symbol"`
	Side           string    `json:"side"`
	Type           string    `json:"type"`
	Price          float64   `json:"price,omitempty"`
	StopPrice      float64   `json:"stopPrice,omitempty"`
	Quantity      float64   `json:"quantity"`
	FilledQuantity float64   `json:"filledQuantity"`
	Status         string    `json:"status"`
	TimeInForce   string    `json:"timeInForce"`
	ClientOrderID string   `json:"clientOrderId,omitempty"`
	CreatedAt     int64     `json:"createdAt"`
	UpdatedAt     int64     `json:"updatedAt"`
	ExpiresAt     int64     `json:"expiresAt,omitempty"`
}

// Trade represents a trade execution
type Trade struct {
	ID            string  `json:"id"`
	OrderID       string  `json:"orderId"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"`
	Price         float64 `json:"price"`
	Quantity     float64 `json:"quantity"`
	Fee          float64 `json:"fee"`
	FeeAsset     string  `json:"feeAsset"`
	Maker        bool    `json:"maker"`
	Timestamp    int64   `json:"timestamp"`
}

// Market represents a trading market
type Market struct {
	Symbol        string  `json:"symbol"`
	BaseAsset    string  `json:"baseAsset"`
	QuoteAsset  string  `json:"quoteAsset"`
	Status      string  `json:"status"`
	MinPrice    float64 `json:"minPrice"`
	MaxPrice    float64 `json:"maxPrice"`
	MinQuantity float64 `json:"minQuantity"`
	MaxQuantity float64 `json:"maxQuantity"`
	MinNotional float64 `json:"minNotional"`
	StepSize    float64 `json:"stepSize"`
	Precision   int     `json:"precision"`
}

// Ticker represents 24h ticker data
type Ticker struct {
	Symbol           string  `json:"symbol"`
	Price           float64 `json:"price"`
	PriceChange     float64 `json:"priceChange"`
	PriceChangePct float64 `json:"priceChangePct"`
	Volume         float64 `json:"volume"`
	QuoteVolume    float64 `json:"quoteVolume"`
	High           float64 `json:"high"`
	Low            float64 `json:"low"`
	Timestamp      int64   `json:"timestamp"`
}

// OrderBook represents order book depth
type OrderBook struct {
	LastUpdateID int64       `json:"lastUpdateId"`
	Bids        [][]string `json:"bids"`
	Asks        [][]string `json:"asks"`
}

// KLine represents candlestick data
type KLine struct {
	OpenTime  int64   `json:"openTime"`
	Open     float64 `json:"open"`
	High     float64 `json:"high"`
	Low      float64 `json:"low"`
	Close    float64 `json:"close"`
	Volume   float64 `json:"volume"`
	CloseTime int64   `json:"closeTime"`
}

// ExchangeInfo represents exchange configuration
type ExchangeInfo struct {
	Timezone        string   `json:"timezone"`
	ServerTime     int64    `json:"serverTime"`
	ExchangeStatus string   `json:"exchangeStatus"`
	Symbols       []Market `json:"symbols"`
}

// Wallet represents a user wallet
type Wallet struct {
	UserID     string  `json:"userId"`
	Asset     string  `json:"asset"`
	Network   string  `json:"network"`
	Available float64 `json:"available"`
	Locked   float64 `json:"locked"`
	Total    float64 `json:"total"`
}

// StakingProduct represents a staking product
type StakingProduct struct {
	ID             string  `json:"id"`
	Asset         string  `json:"asset"`
	APY           float64 `json:"apy"`
	MinStake      float64 `json:"minStake"`
	LockPeriod   int     `json:"lockPeriod"`
	Status       string  `json:"status"`
}

// SavingsProduct represents a savings product
type SavingsProduct struct {
	ID        string  `json:"id"`
	Asset    string  `json:"asset"`
	APY      float64 `json:"apy"`
	Type     string  `json:"type"`
	MinAmount float64 `json:"minAmount"`
	Status   string  `json:"status"`
}

// LendingProduct represents a lending product
type LendingProduct struct {
	ID           string  `json:"id"`
	Asset        string  `json:"asset"`
	BorrowAPY    float64 `json:"borrowApy"`
	LendAPY     float64 `json:"lendApy"`
	Collateral  []string `json:"collateral"`
	MinAmount  float64 `json:"minAmount"`
	MaxAmount float64 `json:"maxAmount"`
	Status    string  `json:"status"`
}

// APIKey represents an API key
type APIKey struct {
	ID          string   `json:"id"`
	Key         string   `json:"key"`
	Secret      string   `json:"secret"`
	Label       string   `json:"label"`
	Permissions []string `json:"permissions"`
	ExpiresAt   int64    `json:"expiresAt,omitempty"`
	CreatedAt   int64    `json:"createdAt"`
	LastUsed   int64    `json:"lastUsed,omitempty"`
	Enabled    bool     `json:"enabled"`
	IPWhitelist []string `json:"ipWhitelist,omitempty"`
}

// Deposit represents a deposit
type Deposit struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Asset      string  `json:"asset"`
	Amount     float64 `json:"amount"`
	Address    string  `json:"address"`
	TXID       string  `json:"txId,omitempty"`
	Confirmations int    `json:"confirmations"`
	Status     string  `json:"status"`
	Timestamp  int64   `json:"timestamp"`
}

// Withdrawal represents a withdrawal
type Withdrawal struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Asset      string  `json:"asset"`
	Amount     float64 `json:"amount"`
	Fee        float64 `json:"fee"`
	NetAmount float64 `json:"netAmount"`
	Address    string  `json:"address"`
	TXID       string  `json:"txId,omitempty"`
	Status     string  `json:"status"`
	Timestamp  int64   `json:"timestamp"`
	ProcessedAt int64  `json:"processedAt,omitempty"`
}

// SubAccount represents a sub-account
type SubAccount struct {
	ID        string  `json:"id"`
	UserID    string  `json:"userId"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	APIKeys   []APIKey `json:"apiKeys"`
	CreatedAt int64   `json:"createdAt"`
}

// UserSettings represents user settings
type UserSettings struct {
	UserID          string `json:"userId"`
	Language        string `json:"language"`
	Timezone       string `json:"timezone"`
	Theme          string `json:"theme"`
	Currency       string `json:"currency"`
	AntiPhishingCode string `json:"antiPhishingCode,omitempty"`
}

// Now returns current timestamp
func Now() int64 {
	return time.Now().Unix()
}