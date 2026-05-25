package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// User represents a user account
type User struct {
	ID                primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	Email            string           `bson:"email" json:"email"`
	Username        string           `bson:"username" json:"username"`
	PasswordHash    string          `bson:"password_hash" json:"-"`
	Role            string          `bson:"role" json:"role"` // user, trader, admin
	Status          string          `bson:"status" json:"status"` // pending, active, suspended
	TwoFactorEnabled bool          `bson:"two_factor_enabled" json:"two_factor_enabled"`
	CreatedAt       time.Time      `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time      `bson:"updated_at" json:"updated_at"`
	KYC             *KYCInfo       `bson:"kyc,omitempty" json:"kyc,omitempty"`
	Preferences     UserPreferences `bson:"preferences" json:"preferences"`
}

// KYCInfo contains Know Your Customer information
type KYCInfo struct {
	Status        string    `bson:"status" json:"status"` // pending, submitted, verified, rejected
	Tier         int       `bson:"tier" json:"tier"`
	DocumentID  string    `bson:"document_id" json:"document_id"`
	SubmittedAt time.Time `bson:"submitted_at" json:"submitted_at"`
	VerifiedAt  time.Time `bson:"verified_at" json:"verified_at"`
}

// UserPreferences stores user trading preferences
type UserPreferences struct {
	Theme         string `bson:"theme" json:"theme"` // light, dark
	FiatCurrency string `bson:"fiat_currency" json:"fiat_currency"`
	Language     string `bson:"language" json:"language"`
}

// Wallet represents a user's cryptocurrency wallet
type Wallet struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID      string             `bson:"user_id" json:"user_id"`
	Currency    string            `bson:"currency" json:"currency"`
	Chain       string             `bson:"chain" json:"chain"`
	Balance     string            `bson:"balance" json:"balance"`
	Locked      string            `bson:"locked" json:"locked"`
	Address     string            `bson:"address" json:"address,omitempty"`
	IsDeposit   bool              `bson:"is_deposit" json:"is_deposit"`
	CreatedAt   time.Time         `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time         `bson:"updated_at" json:"updated_at"`
}

// Order represents a trading order
type Order struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID        string           `bson:"user_id" json:"user_id"`
	Symbol        string           `bson:"symbol" json:"symbol"`
	Side          string           `bson:"side" json:"side"` // buy, sell
	Type          string           `bson:"type" json:"type"` // market, limit, stop_loss, take_profit
	Price         string           `bson:"price" json:"price"`
	Quantity      string           `bson:"quantity" json:"quantity"`
	FilledQty     string           `bson:"filled_qty" json:"filled_qty"`
	AvgPrice      string           `bson:"avg_price" json:"avg_price"`
	Status        string           `bson:"status" json:"status"` // pending, filled, partially_filled, cancelled
	TimeInForce   string           `bson:"time_in_force" json:"time_in_force"` // gtc, ioc, fok
	StopPrice    string           `bson:"stop_price,omitempty" json:"stop_price,omitempty"`
	OrderID      string           `bson:"order_id" json:"order_id"` // exchange order ID
	ClientOrderID string          `bson:"client_order_id" json:"client_order_id"`
	CreatedAt    time.Time       `bson:"created_at" json:"created_at"`
	UpdatedAt    time.Time       `bson:"updated_at" json:"updated_at"`
}

// Trade represents an executed trade
type Trade struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	OrderID      string              `bson:"order_id" json:"order_id"`
	UserID      string              `bson:"user_id" json:"user_id"`
	Symbol      string              `bson:"symbol" json:"symbol"`
	Side        string              `bson:"side" json:"side"`
	Price       string             `bson:"price" json:"price"`
	Quantity    string             `bson:"quantity" json:"quantity"`
	Fee         string             `bson:"fee" json:"fee"`
	FeeCurrency string             `bson:"fee_currency" json:"fee_currency"`
	Role        string              `bson:"role" json:"role"` // maker, taker
	CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
}

// Market represents a trading pair
type Market struct {
	ID                primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Symbol           string             `bson:"symbol" json:"symbol"`
	BaseAsset        string             `bson:"base_asset" json:"base_asset"`
	QuoteAsset       string             `bson:"quote_asset" json:"quote_asset"`
	Status           string             `bson:"status" json:"status"` // trading, breakeye, suspend
	MakerFee         string             `bson:"maker_fee" json:"maker_fee"`
	TakerFee         string             `bson:"taker_fee" json:"taker_fee"`
	MinQty           string             `bson:"min_qty" json:"min_qty"`
	MaxQty           string             `bson:"max_qty" json:"max_qty"`
	MinNotional      string             `bson:"min_notional" json:"min_notional"`
	StepSize         string             `bson:"step_size" json:"step_size"`
	TickSize         string             `bson:"tick_size" json:"tick_size"`
	Precision       int                `bson:"precision" json:"precision"`
	CreatedAt       time.Time          `bson:"created_at" json:"created_at"`
}

// Ticker represents real-time market data
type Ticker struct {
	Symbol        string `json:"symbol"`
	LastPrice    string `json:"last_price"`
	PriceChange  string `json:"price_change"`
	PriceChangePercent string `json:"price_change_percent"`
	HighPrice    string `json:"high_price"`
	LowPrice     string `json:"low_price"`
	Volume24h    string `json:"volume_24h"`
	QuoteVolume24h string `json:"quote_volume_24h"`
	Timestamp    int64  `json:"timestamp"`
}

// OrderBook represents the order book
type OrderBook struct {
	Symbol   string     `json:"symbol"`
	Bids     [][]string `json:"bids"`
	Asks     [][]string `json:"asks"`
	LastUpdateID int64   `json:"last_update_id"`
}

// Transaction represents a deposit/withdrawal
type Transaction struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID     string         `bson:"user_id" json:"user_id"`
	WalletID   string         `bson:"wallet_id" json:"wallet_id"`
	Currency   string         `bson:"currency" json:"currency"`
	Amount    string         `bson:"amount" json:"amount"`
	Type      string         `bson:"type" json:"type"` // deposit, withdrawal, transfer
	Status    string         `bson:"status" json:"status"` // pending, processing, completed, failed
	TxHash    string        `bson:"tx_hash" json:"tx_hash,omitempty"`
	Address   string        `bson:"address" json:"address,omitempty"`
	Fee       string        `bson:"fee" json:"fee"`
	CreatedAt time.Time    `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time    `bson:"updated_at" json:"updated_at"`
}