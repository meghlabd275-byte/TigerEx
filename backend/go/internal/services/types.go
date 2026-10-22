package services

import (
	"time"

	"github.com/google/uuid"
)

// OrderRequest is the accepted payload for order creation.
type OrderRequest struct {
	Symbol        string `json:"symbol" binding:"required"`
	Side          string `json:"side" binding:"required,oneof=buy sell"`
	Type          string `json:"type" binding:"required,oneof=limit market stop_loss take_profit stop_limit"`
	TimeInForce   string `json:"time_in_force"`
	Price         string `json:"price"`
	StopPrice     string `json:"stop_price"`
	Quantity      string `json:"quantity" binding:"required"`
	ClientOrderID string `json:"client_order_id"`
}

// Order is the persisted representation of an order.
type Order struct {
	ID            uuid.UUID `json:"id"`
	UserID        uuid.UUID `json:"user_id"`
	Symbol        string    `json:"symbol"`
	Side          string    `json:"side"`
	Type          string    `json:"type"`
	TimeInForce   string    `json:"time_in_force"`
	Price         string    `json:"price,omitempty"`
	StopPrice     string    `json:"stop_price,omitempty"`
	Quantity      string    `json:"quantity"`
	FilledQty     string    `json:"filled_quantity"`
	Status        string    `json:"status"`
	ClientOrderID string    `json:"client_order_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Ticker is the stored 24h market summary for a symbol.
type Ticker struct {
	Symbol             string `json:"symbol"`
	Price              string `json:"price"`
	PriceChange        string `json:"price_change"`
	PriceChangePercent string `json:"price_change_percent"`
	Volume24h          string `json:"volume_24h"`
	QuoteVolume24h     string `json:"quote_volume_24h"`
	High24h            string `json:"high_24h"`
	Low24h             string `json:"low_24h"`
	LastUpdate         int64  `json:"last_update"`
}
