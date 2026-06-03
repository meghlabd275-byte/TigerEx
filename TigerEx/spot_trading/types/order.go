// Package types provides core types for the spot trading engine.
// This file defines all order types, side, time-in-force, and trading related types.
package types

import (
	"time"

	"github.com/shopspring/decimal"
)

// OrderSide represents the buy or sell side of an order
type OrderSide string

const (
	OrderSideBuy  OrderSide = "BUY"
	OrderSideSell OrderSide = "SELL"
)

// OrderType represents the type of order
type OrderType string

const (
	OrderTypeMarket      OrderType = "MARKET"
	OrderTypeLimit       OrderType = "LIMIT"
	OrderTypeStopLoss     OrderType = "STOP_LOSS"
	OrderTypeStopLimit   OrderType = "STOP_LIMIT"
	OrderTypeOCO         OrderType = "OCO" // One Cancels Other
	OrderTypeIceberg     OrderType = "ICEBERG"
	OrderTypeTWAP        OrderType = "TWAP"
	OrderTypeTrailingStop OrderType = "TRAILING_STOP"
)

// TimeInForce defines order expiration behavior
type TimeInForce string

const (
	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC" // Immediate or Cancel
	TimeInForceFOK TimeInForce = "FOK" // Fill or Kill
	TimeInForceGTX TimeInForce = "GTX" // Good Till Expire
	TimeInForceGTT TimeInForce = "GTT" // Good Till Time
)

// OrderStatus represents the current status of an order
type OrderStatus string

const (
	OrderStatusPending     OrderStatus = "PENDING"
	OrderStatusOpen       OrderStatus = "OPEN"
	OrderStatusPartially   OrderStatus = "PARTIALLY_FILLED"
	OrderStatusFilled     OrderStatus = "FILLED"
	OrderStatusCancelled   OrderStatus = "CANCELLED"
	OrderStatusRejected   OrderStatus = "REJECTED"
	OrderStatusExpired    OrderStatus = "EXPIRED"
)

// Order represents a trading order in the system
type Order struct {
	ID                string          `json:"id" db:"id"`
	UserID            string          `json:"user_id" db:"user_id"`
	AccountID         string          `json:"account_id" db:"account_id"`
	Symbol            string          `json:"symbol" db:"symbol"`
	Side              OrderSide       `json:"side" db:"side"`
	OrderType         OrderType       `json:"order_type" db:"order_type"`
	Price            decimal.Decimal `json:"price" db:"price"`
	Quantity         decimal.Decimal `json:"quantity" db:"quantity"`
	FilledQuantity   decimal.Decimal `json:"filled_quantity" db:"filled_quantity"`
	RemainingQuantity decimal.Decimal `json:"remaining_quantity" db:"remaining_quantity"`
	StopPrice        decimal.Decimal `json:"stop_price" db:"stop_price"`
	IcebergQuantity  decimal.Decimal `json:"iceberg_quantity" db:"iceberg_quantity"`
	TimeInForce      TimeInForce     `json:"time_in_force" db:"time_in_force"`
	Status           OrderStatus     `json:"status" db:"status"`
	AverageFillPrice decimal.Decimal `json:"avg_fill_price" db:"avg_fill_price"`
	Commission       decimal.Decimal `json:"commission" db:"commission"`
	IsMaker          bool            `json:"is_maker" db:"is_maker"`
	ClientOrderID    string          `json:"client_order_id" db:"client_order_id"`
	CreatedAt        time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at" db:"updated_at"`
	CompletedAt      *time.Time     `json:"completed_at" db:"completed_at"`
	ExpiresAt        *time.Time     `json:"expires_at" db:"expires_at"`
}

// OrderBookEntry represents a single entry in the order book
type OrderBookEntry struct {
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
	Orders   int            `json:"orders"`
}

// OrderBook represents the full order book for a symbol
type OrderBook struct {
	Symbol        string          `json:"symbol"`
	Bids          []OrderBookEntry `json:"bids"`
	Asks          []OrderBookEntry `json:"asks"`
	LastUpdateID int64           `json:"last_update_id"`
	Timestamp    time.Time      `json:"timestamp"`
}

// Trade represents a completed trade
type Trade struct {
	ID               string          `json:"id" db:"id"`
	OrderID          string          `json:"order_id" db:"order_id"`
	Symbol           string          `json:"symbol" db:"symbol"`
	Side             OrderSide       `json:"side" db:"side"`
	Price            decimal.Decimal `json:"price" db:"price"`
	Quantity         decimal.Decimal `json:"quantity" db:"quantity"`
	Commission       decimal.Decimal `json:"commission" db:"commission"`
	MakerOrderID     string          `json:"maker_order_id" db:"maker_order_id"`
	TakerOrderID     string          `json:"taker_order_id" db:"taker_order_id"`
	ExecutedAt       time.Time      `json:"executed_at" db:"executed_at"`
	TransactionID   string          `json:"transaction_id" db:"transaction_id"`
}

// Ticker represents 24h ticker data
type Ticker struct {
	Symbol             string          `json:"symbol"`
	LastPrice          decimal.Decimal `json:"last_price"`
	PriceChange        decimal.Decimal `json:"price_change"`
	PriceChangePercent decimal.Decimal `json:"price_change_percent"`
	HighPrice          decimal.Decimal `json:"high_price"`
	LowPrice           decimal.Decimal `json:"low_price"`
	Volume             decimal.Decimal `json:"volume"`
	QuoteVolume        decimal.Decimal `json:"quote_volume"`
	OpenPrice         decimal.Decimal `json:"open_price"`
	WeightedAvgPrice  decimal.Decimal `json:"weighted_avg_price"`
	Trades            int64            `json:"trades"`
}

// KLine represents a candlestick/kline
type KLine struct {
	Symbol       string          `json:"symbol"`
	Interval    string          `json:"interval"`
	OpenPrice   decimal.Decimal `json:"open_price"`
	HighPrice   decimal.Decimal `json:"high_price"`
	LowPrice    decimal.Decimal `json:"low_price"`
	ClosePrice  decimal.Decimal `json:"close_price"`
	Volume      decimal.Decimal `json:"volume"`
	QuoteVolume decimal.Decimal `json:"quote_volume"`
	OpenTime    int64           `json:"open_time"`
	CloseTime   int64           `json:"close_time"`
}

// Market represents a trading pair/market
type Market struct {
	ID             string          `json:"id" db:"id"`
	BaseAsset      string          `json:"base_asset" db:"base_asset"`
	QuoteAsset    string          `json:"quote_asset" db:"quote_asset"`
	Symbol        string          `json:"symbol" db:"symbol"`
	Status        string          `json:"status" db:"status"`
	BasePrecision int            `json:"base_precision" db:"base_precision"`
	QuotePrecision int            `json:"quote_precision" db:"quote_precision"`
	MinQuantity   decimal.Decimal `json:"min_quantity" db:"min_quantity"`
	MaxQuantity   decimal.Decimal `json:"max_quantity" db:"max_quantity"`
	MinPrice      decimal.Decimal `json:"min_price" db:"min_price"`
	MaxPrice      decimal.Decimal `json:"max_price" db:"max_price"`
	TickSize      decimal.Decimal `json:"tick_size" db:"tick_size"`
	LotSize       decimal.Decimal `json:"lot_size" db:"lot_size"`
	MakerFee     decimal.Decimal `json:"maker_fee" db:"maker_fee"`
	TakerFee     decimal.Decimal `json:"taker_fee" db:"taker_fee"`
	MinNotional  decimal.Decimal `json:"min_notional" db:"min_notional"`
	IsTradable   bool            `json:"is_tradable" db:"is_tradable"`
	CreatedAt    time.Time      `json:"created_at" db:"created_at"`
}

// NewOrder creates a new order with default values
func NewOrder(userID, symbol string, side OrderSide, orderType OrderType, quantity decimal.Decimal, price decimal.Decimal) *Order {
	return &Order{
		ID:                generateOrderID(),
		UserID:            userID,
		Symbol:           symbol,
		Side:             side,
		OrderType:        orderType,
		Quantity:         quantity,
		FilledQuantity:   decimal.Zero,
		RemainingQuantity: quantity,
		Price:            price,
		Status:           OrderStatusPending,
		TimeInForce:      TimeInForceGTC,
		ClientOrderID:    "",
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
}

// Validate checks if order is valid
func (o *Order) Validate() error {
	if o.Symbol == "" {
		return ErrInvalidSymbol
	}
	if o.Quantity.LessThanOrEqual(decimal.Zero) {
		return ErrInvalidQuantity
	}
	if o.OrderType != OrderTypeMarket && o.Price.LessThanOrEqual(decimal.Zero) {
		return ErrInvalidPrice
	}
	if o.Side != OrderSideBuy && o.Side != OrderSideSell {
		return ErrInvalidSide
	}
	return nil
}

// CanFill checks if order can be filled
func (o *Order) CanFill() bool {
	return o.Status == OrderStatusOpen || o.Status == OrderStatusPartially
}

// RemainingQty returns remaining quantity
func (o *Order) RemainingQty() decimal.Decimal {
	return o.Quantity.Sub(o.FilledQuantity)
}

// IsFullyFilled checks if order is fully filled
func (o *Order) IsFullyFilled() bool {
	return o.RemainingQty().Equal(decimal.Zero)
}

// ErrInvalidSymbol is returned when symbol is invalid
var ErrInvalidSymbol = &TradingError{Code: "INVALID_SYMBOL", Message: "Invalid trading symbol"}

// ErrInvalidQuantity is returned when quantity is invalid
var ErrInvalidQuantity = &TradingError{Code: "INVALID_QUANTITY", Message: "Invalid quantity"}

// ErrInvalidPrice is returned when price is invalid
var ErrInvalidPrice = &TradingError{Code: "INVALID_PRICE", Message: "Invalid price"}

// ErrInvalidSide is returned when side is invalid
var ErrInvalidSide = &TradingError{Code: "INVALID_SIDE", Message: "Invalid order side"}

// TradingError represents a trading error
type TradingError struct {
	Code    string
	Message string
}

func (e *TradingError) Error() string {
	return e.Message
}