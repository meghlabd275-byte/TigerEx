/**
 * TigerEx Trading Service
 * Production-Ready Trading Engine API
 * Supports Spot, Futures, Margin, Options Trading
 * 
 * @author TigerEx Team
 * @version 3.0.0
 * @date July 2026
 */

package trading

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ============================================================================
// CONFIGURATION
// ============================================================================

type Config struct {
	MaxOrderValue       float64   `mapstructure:"max_order_value"`
	MaxLeverage         int       `mapstructure:"max_leverage"`
	MakerFee            float64   `mapstructure:"maker_fee"`
	TakerFee            float64   `mapstructure:"taker_fee"`
	MinOrderValue       float64   `mapstructure:"min_order_value"`
	PricePrecision      int       `mapstructure:"price_precision"`
	QuantityPrecision   int       `mapstructure:"quantity_precision"`
	MaxOrdersPerUser    int       `mapstructure:"max_orders_per_user"`
	CancelWindowSeconds int       `mapstructure:"cancel_window_seconds"`
}

var DefaultConfig = Config{
	MaxOrderValue:       10000000,  // $10M
	MaxLeverage:         125,
	MakerFee:           0.001,      // 0.1%
	TakerFee:           0.001,      // 0.1%
	MinOrderValue:      1.0,        // $1
	PricePrecision:     8,
	QuantityPrecision:  8,
	MaxOrdersPerUser:   100,
	CancelWindowSeconds: 60,
}

// ============================================================================
// CORE TYPES
// ============================================================================

type OrderSide string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

type OrderType string

const (
	OrderTypeMarket     OrderType = "market"
	OrderTypeLimit      OrderType = "limit"
	OrderTypeStopLoss   OrderType = "stop_loss"
	OrderTypeStopLimit  OrderType = "stop_limit"
	OrderTypeTakeProfit OrderType = "take_profit"
	OrderTypeTrailing   OrderType = "trailing_stop"
	OrderTypeIceberg    OrderType = "iceberg"
	OrderTypeTWAP       OrderType = "twap"
	OrderTypeOCO        OrderType = "oco"
	OrderTypeOTO        OrderType = "oto"
)

type OrderStatus string

const (
	OrderStatusPending       OrderStatus = "pending"
	OrderStatusNew          OrderStatus = "new"
	OrderStatusPartially    OrderStatus = "partially_filled"
	OrderStatusFilled       OrderStatus = "filled"
	OrderStatusCanceled     OrderStatus = "canceled"
	OrderStatusRejected     OrderStatus = "rejected"
	OrderStatusExpired      OrderStatus = "expired"
	OrderStatusTriggered    OrderStatus = "triggered"
)

type TimeInForce string

const (
	TimeInForceGTC TimeInForce = "GTC"  // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC"  // Immediate Or Cancel
	TimeInForceFOK TimeInForce = "FOK"  // Fill Or Kill
	TimeInForceGTX TimeInForce = "GTX"  // Good Till Cross
	TimeInForceGTT TimeInForce = "GTT"  // Good Till Time
)

type PositionSide string

const (
	PositionSideLong  PositionSide = "long"
	PositionSideShort PositionSide = "short"
	PositionSideBoth  PositionSide = "both"
)

type MarginMode string

const (
	MarginModeIsolated MarginMode = "isolated"
	MarginModeCross   MarginMode = "cross"
)

// ============================================================================
// ORDER STRUCTURES
// ============================================================================

type Order struct {
	ID              uint64      `json:"id"`
	OrderID         string      `json:"order_id"`
	UserID          uint64      `json:"user_id"`
	Symbol          string      `json:"symbol"`
	Side            OrderSide   `json:"side"`
	Type            OrderType   `json:"type"`
	Status          OrderStatus `json:"status"`
	PositionSide    PositionSide `json:"position_side"`
	
	// Price & Quantity
	Price           float64     `json:"price"`
	StopPrice       float64     `json:"stop_price,omitempty"`
	OriginalQty     float64     `json:"original_quantity"`
	ExecutedQty     float64     `json:"executed_quantity"`
	RemainingQty    float64     `json:"remaining_quantity"`
	IcebergQty      float64     `json:"iceberg_quantity,omitempty"`
	
	// Average fill price
	AvgPrice        float64     `json:"avg_price"`
	
	// Fees
	MakerFee        float64     `json:"maker_fee"`
	TakerFee        float64     `json:"taker_fee"`
	
	// Time settings
	TimeInForce     TimeInForce `json:"time_in_force"`
	ExpireTime      *time.Time  `json:"expire_time,omitempty"`
	
	// Trigger info
	TriggerPrice    float64     `json:"trigger_price,omitempty"`
	TriggeredAt     *time.Time  `json:"triggered_at,omitempty"`
	
	// OCO/OTO
	OCOOrderID      string      `json:"oco_order_id,omitempty"`
	OTOTriggerID    string      `json:"oto_trigger_id,omitempty"`
	
	// Risk management
	Leverage        int         `json:"leverage"`
	MarginMode      MarginMode  `json:"margin_mode"`
	MarginRequired  float64     `json:"margin_required"`
	
	// Meta
	ClientOrderID   string      `json:"client_order_id,omitempty"`
	ExternalID      string      `json:"external_id,omitempty"`
	
	// Timestamps
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
	FilledAt        *time.Time  `json:"filled_at,omitempty"`
}

type Trade struct {
	ID              uint64      `json:"id"`
	TradeID         string      `json:"trade_id"`
	OrderID        string      `json:"order_id"`
	UserID          uint64      `json:"user_id"`
	Symbol          string      `json:"symbol"`
	Side            OrderSide   `json:"side"`
	
	// Execution
	Price           float64     `json:"price"`
	Quantity        float64     `json:"quantity"`
	Commission      float64     `json:"commission"`
	CommissionAsset string      `json:"commission_asset"`
	
	// Trade info
	MakerOrderID    string      `json:"maker_order_id"`
	TakerOrderID    string      `json:"taker_order_id"`
	TradeTime       time.Time   `json:"trade_time"`
	IsMaker         bool        `json:"is_maker"`
}

type Position struct {
	ID              uint64        `json:"id"`
	UserID          uint64        `json:"user_id"`
	Symbol          string        `json:"symbol"`
	Side            PositionSide `json:"side"`
	
	// Position data
	Size            float64       `json:"size"`
	EntryPrice      float64       `json:"entry_price"`
	MarkPrice       float64       `json:"mark_price"`
	LiquidationPrice float64      `json:"liquidation_price"`
	
	// PnL
	UnrealizedPnL   float64       `json:"unrealized_pnl"`
	RealizedPnL     float64       `json:"realized_pnl"`
	
	// Margin
	Margin          float64       `json:"margin"`
	PositionMargin  float64       `json:"position_margin"`
	MaintenanceMargin float64    `json:"maintenance_margin"`
	
	// Leverage
	Leverage        int           `json:"leverage"`
	MarginMode      MarginMode    `json:"margin_mode"`
	
	// Status
	IsClosed        bool          `json:"is_closed"`
	
	// Timestamps
	OpenedAt        time.Time     `json:"opened_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
	ClosedAt        *time.Time    `json:"closed_at,omitempty"`
}

type Symbol struct {
	ID              uint64      `json:"id"`
	Name            string      `json:"name"`
	BaseAsset       string      `json:"base_asset"`
	QuoteAsset      string      `json:"quote_asset"`
	Status          string      `json:"status"`
	
	// Precision
	PricePrecision  int         `json:"price_precision"`
	QuantityPrecision int       `json:"quantity_precision"`
	
	// Limits
	MinPrice        float64     `json:"min_price"`
	MaxPrice        float64     `json:"max_price"`
	MinQty          float64     `json:"min_quantity"`
	MaxQty          float64     `json:"max_quantity"`
	TickSize        float64     `json:"tick_size"`
	LotSize         float64     `json:"lot_size"`
	
	// Trading rules
	AllowMargin     bool        `json:"allow_margin"`
	MaxLeverage     int         `json:"max_leverage"`
	
	// Fees
	MakerFee        float64     `json:"maker_fee"`
	TakerFee        float64     `json:"taker_fee"`
	
	// Market data
	LastPrice       float64     `json:"last_price"`
	PriceChange     float64     `json:"price_change"`
	PriceChangePct  float64     `json:"price_change_pct"`
	High24h         float64     `json:"high_24h"`
	Low24h          float64     `json:"low_24h"`
	Volume24h       float64     `json:"volume_24h"`
	QuoteVolume24h  float64     `json:"quote_volume_24h"`
	Trades24h       int64       `json:"trades_24h"`
	
	// Timestamps
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

type OrderBook struct {
	Symbol          string      `json:"symbol"`
	LastUpdateID    int64       `json:"last_update_id"`
	
	// Bids: [price, quantity]
	Bids            [][]string `json:"bids"`
	
	// Asks: [price, quantity]
	Asks            [][]string `json:"asks"`
}

type Ticker struct {
	Symbol          string    `json:"symbol"`
	Price           float64   `json:"price"`
	PriceChange     float64   `json:"price_change"`
	PriceChangePct  float64   `json:"price_change_pct"`
	High24h         float64   `json:"high_24h"`
	Low24h          float64   `json:"low_24h"`
	Volume24h       float64   `json:"volume_24h"`
	QuoteVolume24h  float64   `json:"quote_volume_24h"`
	Trades24h       int64     `json:"trades_24h"`
	
	// Bid/Ask
	BidPrice        float64   `json:"bid_price"`
	AskPrice        float64   `json:"ask_price"`
	BidQty          float64   `json:"bid_qty"`
	AskQty          float64   `json:"ask_qty"`
	
	// Timestamp
	Timestamp       time.Time `json:"timestamp"`
}

type Kline struct {
	OpenTime        int64     `json:"open_time"`
	Open            float64   `json:"open"`
	High            float64   `json:"high"`
	Low             float64   `json:"low"`
	Close           float64   `json:"close"`
	Volume          float64   `json:"volume"`
	CloseTime       int64     `json:"close_time"`
	QuoteVolume     float64   `json:"quote_volume"`
	Trades          int64     `json:"trades"`
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

type CreateOrderRequest struct {
	Symbol          string      `json:"symbol" validate:"required"`
	Side            OrderSide   `json:"side" validate:"required"`
	Type            OrderType   `json:"type" validate:"required"`
	Quantity        float64     `json:"quantity" validate:"required,gt=0"`
	Price           *float64    `json:"price"`
	StopPrice       *float64    `json:"stop_price"`
	TriggerPrice    *float64    `json:"trigger_price"`
	TimeInForce     TimeInForce `json:"time_in_force"`
	PositionSide    PositionSide `json:"position_side"`
	Leverage        int         `json:"leverage"`
	MarginMode      MarginMode  `json:"margin_mode"`
	IcebergQty      *float64    `json:"iceberg_qty"`
	ClientOrderID   string      `json:"client_order_id"`
}

type CancelOrderRequest struct {
	Symbol      string `json:"symbol" validate:"required"`
	OrderID    string `json:"order_id" validate:"required"`
}

type CancelAllRequest struct {
	Symbol  string `json:"symbol"`
}

type QueryOrderRequest struct {
	Symbol        string `json:"symbol"`
	OrderID      string `json:"order_id"`
	ClientOrderID string `json:"client_order_id"`
	StartTime    int64  `json:"start_time"`
	EndTime      int64  `json:"end_time"`
	Limit        int    `json:"limit"`
}

type OpenOrdersRequest struct {
	Symbol   string `json:"symbol"`
	StartTime int64 `json:"start_time"`
	EndTime   int64 `json:"end_time"`
	Limit    int    `json:"limit"`
}

type AccountTradeRequest struct {
	Symbol    string `json:"symbol"`
	StartTime int64  `json:"start_time"`
	EndTime   int64  `json:"end_time"`
	FromID    int64  `json:"from_id"`
	Limit     int    `json:"limit"`
}

type CreateOrderResponse struct {
	Success         bool      `json:"success"`
	OrderID         string    `json:"order_id,omitempty"`
	ClientOrderID   string    `json:"client_order_id,omitempty"`
	TransactionTime int64     `json:"transaction_time"`
	Price           float64   `json:"price,omitempty"`
	OrigQty         float64   `json:"orig_qty,omitempty"`
	ExecutedQty      float64   `json:"executed_qty,omitempty"`
	Status          string    `json:"status,omitempty"`
	TimeInForce     string    `json:"time_in_force,omitempty"`
	Type            string    `json:"type,omitempty"`
	Side            string    `json:"side,omitempty"`
}

type CancelOrderResponse struct {
	Success       bool     `json:"success"`
	OrderID       string   `json:"order_id"`
	ClientOrderID string   `json:"client_order_id,omitempty"`
	Price         float64  `json:"price,omitempty"`
	OrigQty       float64  `json:"orig_qty"`
	ExecutedQty    float64  `json:"executed_qty"`
}

type QueryOrderResponse struct {
	Order *Order `json:"order"`
}

type OpenOrdersResponse struct {
	Orders []Order `json:"orders"`
}

type AccountTradeResponse struct {
	Trades []Trade `json:"trades"`
}

// ============================================================================
// TRADING SERVICE
// ============================================================================

type TradingService struct {
	config      Config
	db          *pgxpool.Pool
	redis       RedisClient
	orderBooks  map[string]*OrderBookCache
	positions   map[uint64]map[string]*Position
	wsHub       *WebSocketHub
	logger      Logger

	// Order management
	orders      map[string]*Order
	orderMu     sync.RWMutex
	
	// Symbol cache
	symbols     map[string]*Symbol
	symbolMu     sync.RWMutex
	
	// Market data
	tickers     map[string]*Ticker
	tickerMu    sync.RWMutex
	
	// Recent trades
	recentTrades map[string][]*Trade
	tradesMu     sync.RWMutex
}

type RedisClient interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error
	Del(ctx context.Context, keys ...string) error
	Publish(ctx context.Context, channel string, message interface{}) error
	Subscribe(ctx context.Context, channels ...string) (*redis.PubSub, error)
}

type Logger interface {
	Info(msg string, args ...interface{})
	Warn(msg string, args ...interface{})
	Error(msg string, args ...interface{})
	Debug(msg string, args ...interface{})
}

// OrderBookCache for fast order book access
type OrderBookCache struct {
	symbol string
	mu     sync.RWMutex
	
	// Price levels: price -> [quantity, orders]
	bids map[float64]*PriceLevel
	asks map[float64]*PriceLevel
	
	// Sorted arrays for quick access
	sortedBids []float64
	sortedAsks []float64
	
	lastUpdateID int64
}

type PriceLevel struct {
	Quantity float64
	Orders   int
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func NewTradingService(config Config, db *pgxpool.Pool, redis RedisClient, logger Logger) *TradingService {
	return &TradingService{
		config:       config,
		db:           db,
		redis:        redis,
		orderBooks:   make(map[string]*OrderBookCache),
		positions:    make(map[uint64]map[string]*Position),
		orders:       make(map[string]*OrderOrder),
		symbols:      make(map[string]*Symbol),
		tickers:      make(map[string]*Ticker),
		recentTrades: make(map[string][]*Trade),
	}
}

// ============================================================================
// INITIALIZATION
// ============================================================================

func (s *TradingService) Initialize(ctx context.Context) error {
	// Load symbols from database
	if err := s.loadSymbols(ctx); err != nil {
		return fmt.Errorf("failed to load symbols: %w", err)
	}
	
	// Initialize order books
	for symbol := range s.symbols {
		s.orderBooks[symbol] = &OrderBookCache{
			symbol:     symbol,
			bids:       make(map[float64]*PriceLevel),
			asks:       make(map[float64]*PriceLevel),
			sortedBids: make([]float64, 0),
			sortedAsks: make([]float64, 0),
		}
	}
	
	// Load open positions
	if err := s.loadPositions(ctx); err != nil {
		return fmt.Errorf("failed to load positions: %w", err)
	}
	
	// Start market data feed
	go s.startMarketDataFeed(ctx)
	
	// Start order processing
	go s.processOrders(ctx)
	
	s.logger.Info("Trading service initialized")
	return nil
}

func (s *TradingService) loadSymbols(ctx context.Context) error {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, base_asset, quote_asset, status, 
		       price_precision, quantity_precision,
		       min_price, max_price, min_quantity, max_quantity, tick_size, lot_size,
		       allow_margin, max_leverage, maker_fee, taker_fee,
		       last_price, price_change, price_change_pct,
		       high_24h, low_24h, volume_24h, quote_volume_24h, trades_24h,
		       created_at, updated_at
		FROM symbols WHERE status = 'trading'
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	
	for rows.Next() {
		var symbol Symbol
		err := rows.Scan(
			&symbol.ID, &symbol.Name, &symbol.BaseAsset, &symbol.QuoteAsset, &symbol.Status,
			&symbol.PricePrecision, &symbol.QuantityPrecision,
			&symbol.MinPrice, &symbol.MaxPrice, &symbol.MinQty, &symbol.MaxQty, &symbol.TickSize, &symbol.LotSize,
			&symbol.AllowMargin, &symbol.MaxLeverage, &symbol.MakerFee, &symbol.TakerFee,
			&symbol.LastPrice, &symbol.PriceChange, &symbol.PriceChangePct,
			&symbol.High24h, &symbol.Low24h, &symbol.Volume24h, &symbol.QuoteVolume24h, &symbol.Trades24h,
			&symbol.CreatedAt, &symbol.UpdatedAt,
		)
		if err != nil {
			return err
		}
		s.symbols[symbol.Name] = &symbol
	}
	
	return rows.Err()
}

func (s *TradingService) loadPositions(ctx context.Context) error {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, symbol, side, size, entry_price, mark_price, liquidation_price,
		       unrealized_pnl, realized_pnl, margin, position_margin, maintenance_margin,
		       leverage, margin_mode, is_closed, opened_at, updated_at, closed_at
		FROM positions WHERE is_closed = false
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	
	for rows.Next() {
		var pos Position
		err := rows.Scan(
			&pos.ID, &pos.UserID, &pos.Symbol, &pos.Side, &pos.Size, &pos.EntryPrice, &pos.MarkPrice, &pos.LiquidationPrice,
			&pos.UnrealizedPnL, &pos.RealizedPnL, &pos.Margin, &pos.PositionMargin, &pos.MaintenanceMargin,
			&pos.Leverage, &pos.MarginMode, &pos.IsClosed, &pos.OpenedAt, &pos.UpdatedAt, &pos.ClosedAt,
		)
		if err != nil {
			return err
		}
		
		if s.positions[pos.UserID] == nil {
			s.positions[pos.UserID] = make(map[string]*Position)
		}
		s.positions[pos.UserID][pos.Symbol] = &pos
	}
	
	return rows.Err()
}

// ============================================================================
// ORDER MANAGEMENT
// ============================================================================

func (s *TradingService) CreateOrder(ctx context.Context, userID uint64, req *CreateOrderRequest) (*CreateOrderResponse, error) {
	// Validate symbol
	symbol, ok := s.symbols[req.Symbol]
	if !ok {
		return &CreateOrderResponse{Success: false}, errors.New("invalid symbol")
	}
	
	// Validate order type
	if err := s.validateOrderType(req.Type, req.Price); err != nil {
		return &CreateOrderResponse{Success: false}, err
	}
	
	// Validate quantity
	if req.Quantity < symbol.MinQty || req.Quantity > symbol.MaxQty {
		return &CreateOrderResponse{Success: false}, fmt.Errorf("quantity must be between %f and %f", symbol.MinQty, symbol.MaxQty)
	}
	
	// Validate price for limit orders
	if req.Type == OrderTypeLimit {
		if req.Price == nil || *req.Price <= 0 {
			return &CreateOrderResponse{Success: false}, errors.New("price is required for limit orders")
		}
		if *req.Price < symbol.MinPrice || *req.Price > symbol.MaxPrice {
			return &CreateOrderResponse{Success: false}, fmt.Errorf("price must be between %f and %f", symbol.MinPrice, symbol.MaxPrice)
		}
	}
	
	// Validate leverage
	if req.Leverage <= 0 {
		req.Leverage = 1
	}
	if req.Leverage > symbol.MaxLeverage {
		req.Leverage = symbol.MaxLeverage
	}
	
	// Generate order ID
	orderID := generateOrderID(userID, req.Symbol)
	clientOrderID := req.ClientOrderID
	if clientOrderID == "" {
		clientOrderID = uuid.New().String()
	}
	
	// Calculate margin requirement for margin/futures orders
	marginRequired := 0.0
	if symbol.AllowMargin && req.Leverage > 1 {
		price := req.Price
		if price == nil {
			// Use current market price for market orders
			price = &symbol.LastPrice
		}
		marginRequired = (*price * req.Quantity) / float64(req.Leverage)
	}
	
	// Get current time
	now := time.Now()
	
	// Create order
	order := &Order{
		ID:              generateOrderIDNumber(),
		OrderID:         orderID,
		UserID:          userID,
		Symbol:          req.Symbol,
		Side:            req.Side,
		Type:            req.Type,
		Status:          OrderStatusPending,
		PositionSide:    req.PositionSide,
		OriginalQty:     req.Quantity,
		ExecutedQty:     0,
		RemainingQty:    req.Quantity,
		IcebergQty:      0,
		AvgPrice:        0,
		MakerFee:        0,
		TakerFee:        0,
		TimeInForce:     req.TimeInForce,
		Leverage:        req.Leverage,
		MarginMode:      req.MarginMode,
		MarginRequired:  marginRequired,
		ClientOrderID:   clientOrderID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	
	// Set price
	if req.Price != nil {
		order.Price = *req.Price
	}
	
	// Set stop price
	if req.StopPrice != nil {
		order.StopPrice = *req.StopPrice
	}
	
	// Set trigger price
	if req.TriggerPrice != nil {
		order.TriggerPrice = *req.TriggerPrice
	}
	
	// Set iceberg quantity
	if req.IcebergQty != nil {
		order.IcebergQty = *req.IcebergQty
	}
	
	// Store order
	s.orderMu.Lock()
	s.orders[orderID] = order
	s.orderMu.Unlock()
	
	// Save to database
	if err := s.saveOrder(ctx, order); err != nil {
		s.logger.Error("Failed to save order", "error", err)
	}
	
	// Process order immediately if market order
	if req.Type == OrderTypeMarket {
		go s.processMarketOrder(ctx, order)
	} else if order.TriggerPrice > 0 {
		// Add to stop order watchlist
		go s.watchTriggerOrder(ctx, order)
	} else {
		// Add to order book
		go s.addToOrderBook(ctx, order)
	}
	
	// Publish order created event
	s.publishOrderEvent("order_created", order)
	
	return &CreateOrderResponse{
		Success:         true,
		OrderID:         order.OrderID,
		ClientOrderID:   order.ClientOrderID,
		TransactionTime: order.CreatedAt.UnixMilli(),
		Price:           order.Price,
		OrigQty:         order.OriginalQty,
		Status:          string(order.Status),
		TimeInForce:     string(order.TimeInForce),
		Type:            string(order.Type),
		Side:            string(order.Side),
	}, nil
}

func (s *TradingService) CancelOrder(ctx context.Context, userID uint64, req *CancelOrderRequest) (*CancelOrderResponse, error) {
	s.orderMu.RLock()
	order, ok := s.orders[req.OrderID]
	s.orderMu.RUnlock()
	
	if !ok {
		return &CancelOrderResponse{Success: false}, errors.New("order not found")
	}
	
	if order.UserID != userID {
		return &CancelOrderResponse{Success: false}, errors.New("unauthorized")
	}
	
	if order.Status != OrderStatusNew && order.Status != OrderStatusPartially {
		return &CancelOrderResponse{Success: false}, fmt.Errorf("order cannot be canceled in status: %s", order.Status)
	}
	
	// Check cancel window
	if time.Since(order.CreatedAt) > time.Duration(s.config.CancelWindowSeconds)*time.Second {
		return &CancelOrderResponse{Success: false}, errors.New("cancel window expired")
	}
	
	// Update order status
	order.Status = OrderStatusCanceled
	order.UpdatedAt = time.Now()
	
	// Update in database
	if err := s.updateOrderStatus(ctx, order); err != nil {
		return &CancelOrderResponse{Success: false}, err
	}
	
	// Remove from order book if present
	s.removeFromOrderBook(ctx, order)
	
	// Publish cancel event
	s.publishOrderEvent("order_canceled", order)
	
	return &CancelOrderResponse{
		Success:       true,
		OrderID:       order.OrderID,
		ClientOrderID: order.ClientOrderID,
		Price:         order.Price,
		OrigQty:       order.OriginalQty,
		ExecutedQty:    order.ExecutedQty,
	}, nil
}

func (s *TradingService) CancelAllOrders(ctx context.Context, userID uint64, req *CancelAllRequest) ([]CancelOrderResponse, error) {
	s.orderMu.RLock()
	var ordersToCancel []*Order
	for _, order := range s.orders {
		if order.UserID == userID && (req.Symbol == "" || order.Symbol == req.Symbol) {
			if order.Status == OrderStatusNew || order.Status == OrderStatusPartially {
				ordersToCancel = append(ordersToCancel, order)
			}
		}
	}
	s.orderMu.RUnlock()
	
	var responses []CancelOrderResponse
	for _, order := range ordersToCancel {
		req := &CancelOrderRequest{
			Symbol:   order.Symbol,
			OrderID:  order.OrderID,
		}
		resp, err := s.CancelOrder(ctx, userID, req)
		if err == nil {
			responses = append(responses, *resp)
		}
	}
	
	return responses, nil
}

func (s *TradingService) QueryOrder(ctx context.Context, userID uint64, req *QueryOrderRequest) (*QueryOrderResponse, error) {
	s.orderMu.RLock()
	defer s.orderMu.RUnlock()
	
	var order *Order
	if req.OrderID != "" {
		order = s.orders[req.OrderID]
	} else if req.ClientOrderID != "" {
		for _, o := range s.orders {
			if o.ClientOrderID == req.ClientOrderID && o.UserID == userID {
				order = o
				break
			}
		}
	}
	
	if order == nil {
		// Try database
		order, err := s.getOrderFromDB(ctx, req.OrderID)
		if err != nil {
			return &QueryOrderResponse{}, errors.New("order not found")
		}
		return &QueryOrderResponse{Order: order}, nil
	}
	
	if order.UserID != userID {
		return &QueryOrderResponse{}, errors.New("unauthorized")
	}
	
	return &QueryOrderResponse{Order: order}, nil
}

func (s *TradingService) GetOpenOrders(ctx context.Context, userID uint64, req *OpenOrdersRequest) (*OpenOrdersResponse, error) {
	s.orderMu.RLock()
	var orders []Order
	for _, order := range s.orders {
		if order.UserID == userID {
			if req.Symbol == "" || order.Symbol == req.Symbol {
				if order.Status == OrderStatusNew || order.Status == OrderStatusPartially || order.Status == OrderStatusPending {
					orders = append(orders, *order)
				}
			}
		}
	}
	s.orderMu.RUnlock()
	
	// Also fetch from database
	dbOrders, err := s.getOpenOrdersFromDB(ctx, userID, req.Symbol, req.StartTime, req.EndTime, req.Limit)
	if err == nil {
		orders = append(orders, dbOrders...)
	}
	
	// Remove duplicates
	seen := make(map[string]bool)
	var uniqueOrders []Order
	for _, o := range orders {
		if !seen[o.OrderID] {
			seen[o.OrderID] = true
			uniqueOrders = append(uniqueOrders, o)
		}
	}
	
	return &OpenOrdersResponse{Orders: uniqueOrders}, nil
}

func (s *TradingService) GetAccountTrades(ctx context.Context, userID uint64, req *AccountTradeRequest) (*AccountTradeResponse, error) {
	trades, err := s.getTradesFromDB(ctx, userID, req.Symbol, req.StartTime, req.EndTime, req.FromID, req.Limit)
	if err != nil {
		return &AccountTradeResponse{Trades: []Trade{}}, err
	}
	
	return &AccountTradeResponse{Trades: trades}, nil
}

// ============================================================================
// POSITION MANAGEMENT
// ============================================================================

func (s *TradingService) GetPosition(ctx context.Context, userID uint64, symbol string) (*Position, error) {
	s.positionsMu.RLock()
	defer s.positionsMu.RUnlock()
	
	if userPositions, ok := s.positions[userID]; ok {
		if pos, ok := userPositions[symbol]; ok {
			return pos, nil
		}
	}
	
	// Try database
	return s.getPositionFromDB(ctx, userID, symbol)
}

func (s *TradingService) GetAllPositions(ctx context.Context, userID uint64) ([]Position, error) {
	s.positionsMu.RLock()
	var positions []Position
	if userPositions, ok := s.positions[userID]; ok {
		for _, pos := range userPositions {
			if !pos.IsClosed {
				positions = append(positions, *pos)
			}
		}
	}
	s.positionsMu.RUnlock()
	
	// Also fetch from database
	dbPositions, err := s.getAllPositionsFromDB(ctx, userID)
	if err == nil {
		positions = append(positions, dbPositions...)
	}
	
	return positions, nil
}

func (s *TradingService) SetLeverage(ctx context.Context, userID uint64, symbol string, leverage int) error {
	symbolInfo, ok := s.symbols[symbol]
	if !ok {
		return errors.New("invalid symbol")
	}
	
	if leverage < 1 || leverage > symbolInfo.MaxLeverage {
		return fmt.Errorf("leverage must be between 1 and %d", symbolInfo.MaxLeverage)
	}
	
	// Save leverage preference
	return s.saveLeveragePreference(ctx, userID, symbol, leverage)
}

func (s *TradingService) SetMarginMode(ctx context.Context, userID uint64, symbol string, mode MarginMode) error {
	return s.saveMarginModePreference(ctx, userID, symbol, mode)
}

// ============================================================================
// MARKET DATA
// ============================================================================

func (s *TradingService) GetTicker(ctx context.Context, symbol string) (*Ticker, error) {
	s.tickerMu.RLock()
	defer s.tickerMu.RUnlock()
	
	if ticker, ok := s.tickers[symbol]; ok {
		return ticker, nil
	}
	
	// Try to get from Redis cache
	cached, err := s.redis.Get(ctx, fmt.Sprintf("ticker:%s", symbol))
	if err == nil {
		var ticker Ticker
		if json.Unmarshal([]byte(cached), &ticker) == nil {
			return &ticker, nil
		}
	}
	
	// Get from database
	return s.getTickerFromDB(ctx, symbol)
}

func (s *TradingService) GetOrderBook(ctx context.Context, symbol string, limit int) (*OrderBook, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	
	s.orderMu.RLock()
	book, ok := s.orderBooks[symbol]
	s.orderMu.RUnlock()
	
	if !ok {
		return &OrderBook{
			Symbol: symbol,
			Bids:    [][]string{},
			Asks:    [][]string{},
		}, nil
	}
	
	book.mu.RLock()
	defer book.mu.RUnlock()
	
	result := &OrderBook{
		Symbol:       symbol,
		LastUpdateID: book.lastUpdateID,
		Bids:         make([][]string, 0, limit),
		Asks:         make([][]string, 0, limit),
	}
	
	// Get top N bids (highest first)
	sort.Sort(sort.Reverse(sort.Float64Slice(book.sortedBids)))
	for i := 0; i < len(book.sortedBids) && i < limit; i++ {
		price := book.sortedBids[i]
		level := book.bids[price]
		result.Bids = append(result.Bids, []string{
			strconv.FormatFloat(price, 'f', 8, 64),
			strconv.FormatFloat(level.Quantity, 'f', 8, 64),
		})
	}
	
	// Get top N asks (lowest first)
	sort.Float64s(book.sortedAsks)
	for i := 0; i < len(book.sortedAsks) && i < limit; i++ {
		price := book.sortedAsks[i]
		level := book.asks[price]
		result.Asks = append(result.Asks, []string{
			strconv.FormatFloat(price, 'f', 8, 64),
			strconv.FormatFloat(level.Quantity, 'f', 8, 64),
		})
	}
	
	return result, nil
}

func (s *TradingService) GetKlines(ctx context.Context, symbol string, interval string, startTime, endTime int64, limit int) ([]Kline, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	
	// Try Redis cache first
	cacheKey := fmt.Sprintf("klines:%s:%s:%d:%d:%d", symbol, interval, startTime, endTime, limit)
	cached, err := s.redis.Get(ctx, cacheKey)
	if err == nil {
		var klines []Kline
		if json.Unmarshal([]byte(cached), &klines) == nil {
			return klines, nil
		}
	}
	
	// Get from database
	klines, err := s.getKlinesFromDB(ctx, symbol, interval, startTime, endTime, limit)
	if err != nil {
		return nil, err
	}
	
	// Cache for 5 seconds
	if len(klines) > 0 {
		data, _ := json.Marshal(klines)
		s.redis.Set(ctx, cacheKey, string(data), 5*time.Second)
	}
	
	return klines, nil
}

func (s *TradingService) GetRecentTrades(ctx context.Context, symbol string, limit int) ([]Trade, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	
	s.tradesMu.RLock()
	if trades, ok := s.recentTrades[symbol]; ok {
		s.tradesMu.RUnlock()
		
		start := 0
		if len(trades) > limit {
			start = len(trades) - limit
		}
		return trades[start:], nil
	}
	s.tradesMu.RUnlock()
	
	return s.getRecentTradesFromDB(ctx, symbol, limit)
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

func (s *TradingService) validateOrderType(orderType OrderType, price *float64) error {
	switch orderType {
	case OrderTypeMarket:
		return nil
	case OrderTypeLimit:
		if price == nil {
			return errors.New("price required for limit orders")
		}
		return nil
	case OrderTypeStopLoss, OrderTypeStopLimit, OrderTypeTakeProfit:
		if price == nil {
			return errors.New("stop price required for stop orders")
		}
		return nil
	case OrderTypeIceberg, OrderTypeTWAP:
		return nil
	default:
		return fmt.Errorf("unsupported order type: %s", orderType)
	}
}

func (s *TradingService) processMarketOrder(ctx context.Context, order *Order) {
	// Get current market price
	symbol, ok := s.symbols[order.Symbol]
	if !ok {
		order.Status = OrderStatusRejected
		return
	}
	
	marketPrice := symbol.LastPrice
	order.Price = marketPrice
	
	// Execute at market price
	order.Status = OrderStatusFilled
	order.ExecutedQty = order.OriginalQty
	order.RemainingQty = 0
	order.AvgPrice = marketPrice
	order.FilledAt = &order.UpdatedAt
	
	// Calculate fees
	orderValue := order.ExecutedQty * order.AvgPrice
	order.TakerFee = orderValue * s.config.TakerFee
	
	// Update in database
	if err := s.updateOrderStatus(ctx, order); err != nil {
		s.logger.Error("Failed to update market order", "error", err)
	}
	
	// Create trade record
	s.createTrade(ctx, order)
	
	// Update position
	s.updatePosition(ctx, order)
	
	// Publish fill event
	s.publishOrderEvent("order_filled", order)
}

func (s *TradingService) addToOrderBook(ctx context.Context, order *Order) {
	book, ok := s.orderBooks[order.Symbol]
	if !ok {
		return
	}
	
	book.mu.Lock()
	defer book.mu.Unlock()
	
	price := order.Price
	
	if order.Side == OrderSideBuy {
		if book.bids[price] == nil {
			book.bids[price] = &PriceLevel{Quantity: 0, Orders: 0}
			book.sortedBids = append(book.sortedBids, price)
		}
		book.bids[price].Quantity += order.RemainingQty
		book.bids[price].Orders++
	} else {
		if book.asks[price] == nil {
			book.asks[price] = &PriceLevel{Quantity: 0, Orders: 0}
			book.sortedAsks = append(book.sortedAsks, price)
		}
		book.asks[price].Quantity += order.RemainingQty
		book.asks[price].Orders++
	}
	
	book.lastUpdateID++
	
	// Update order status
	order.Status = OrderStatusNew
	s.updateOrderStatus(ctx, order)
}

func (s *TradingService) removeFromOrderBook(ctx context.Context, order *Order) {
	book, ok := s.orderBooks[order.Symbol]
	if !ok {
		return
	}
	
	book.mu.Lock()
	defer book.mu.Unlock()
	
	price := order.Price
	
	if order.Side == OrderSideBuy {
		if level, ok := book.bids[price]; ok {
			level.Quantity -= order.RemainingQty
			level.Orders--
			if level.Quantity <= 0 || level.Orders <= 0 {
				delete(book.bids, price)
				for i, p := range book.sortedBids {
					if p == price {
						book.sortedBids = append(book.sortedBids[:i], book.sortedBids[i+1:]...)
						break
					}
				}
			}
		}
	} else {
		if level, ok := book.asks[price]; ok {
			level.Quantity -= order.RemainingQty
			level.Orders--
			if level.Quantity <= 0 || level.Orders <= 0 {
				delete(book.asks, price)
				for i, p := range book.sortedAsks {
					if p == price {
						book.sortedAsks = append(book.sortedAsks[:i], book.sortedAsks[i+1:]...)
						break
					}
				}
			}
		}
	}
	
	book.lastUpdateID++
}

func (s *TradingService) watchTriggerOrder(ctx context.Context, order *Order) {
	// In production, this would watch price feeds
	// For now, just mark as triggered when price is hit
	ticker, err := s.GetTicker(ctx, order.Symbol)
	if err != nil {
		return
	}
	
	shouldTrigger := false
	if order.Type == OrderTypeStopLoss {
		if order.Side == OrderSideBuy && ticker.Price >= order.TriggerPrice {
			shouldTrigger = true
		} else if order.Side == OrderSideSell && ticker.Price <= order.TriggerPrice {
			shouldTrigger = true
		}
	} else if order.Type == OrderTypeTakeProfit {
		if order.Side == OrderSideBuy && ticker.Price <= order.TriggerPrice {
			shouldTrigger = true
		} else if order.Side == OrderSideSell && ticker.Price >= order.TriggerPrice {
			shouldTrigger = true
		}
	}
	
	if shouldTrigger {
		order.Status = OrderStatusTriggered
		order.TriggeredAt = &order.UpdatedAt
		s.updateOrderStatus(ctx, order)
		
		// Process as market order
		go s.processMarketOrder(ctx, order)
	}
}

func (s *TradingService) createTrade(ctx context.Context, order *Order) {
	trade := &Trade{
		ID:              generateTradeIDNumber(),
		TradeID:         generateTradeID(order.UserID, order.Symbol),
		OrderID:         order.OrderID,
		UserID:          order.UserID,
		Symbol:          order.Symbol,
		Side:            order.Side,
		Price:           order.AvgPrice,
		Quantity:        order.ExecutedQty,
		Commission:      order.TakerFee,
		CommissionAsset: strings.Split(order.Symbol, "/")[1],
		TradeTime:       time.Now(),
		IsMaker:         false,
	}
	
	// Save trade to database
	if err := s.saveTrade(ctx, trade); err != nil {
		s.logger.Error("Failed to save trade", "error", err)
	}
	
	// Add to recent trades
	s.tradesMu.Lock()
	if s.recentTrades[order.Symbol] == nil {
		s.recentTrades[order.Symbol] = make([]*Trade, 0, 1000)
	}
	s.recentTrades[order.Symbol] = append(s.recentTrades[order.Symbol], trade)
	// Keep only last 1000 trades
	if len(s.recentTrades[order.Symbol]) > 1000 {
		s.recentTrades[order.Symbol] = s.recentTrades[order.Symbol][-1000:]
	}
	s.tradesMu.Unlock()
	
	// Publish trade event
	s.publishTradeEvent(trade)
}

func (s *TradingService) updatePosition(ctx context.Context, order *Order) {
	s.positionsMu.Lock()
	defer s.positionsMu.Unlock()
	
	if s.positions[order.UserID] == nil {
		s.positions[order.UserID] = make(map[string]*Position)
	}
	
	pos, ok := s.positions[order.UserID][order.Symbol]
	
	if !ok {
		// Create new position
		side := PositionSideLong
		if order.Side == OrderSideSell {
			side = PositionSideShort
		}
		
		pos = &Position{
			UserID:      order.UserID,
			Symbol:      order.Symbol,
			Side:        side,
			Size:        order.ExecutedQty,
			EntryPrice:  order.AvgPrice,
			Margin:      order.MarginRequired,
			Leverage:    order.Leverage,
			MarginMode:  order.MarginMode,
			OpenedAt:    time.Now(),
			UpdatedAt:   time.Now(),
		}
		s.positions[order.UserID][order.Symbol] = pos
	} else {
		// Update existing position
		// Calculate new average price
		totalValue := (pos.Size * pos.EntryPrice) + (order.ExecutedQty * order.AvgPrice)
		pos.Size += order.ExecutedQty
		if pos.Size > 0 {
			pos.EntryPrice = totalValue / pos.Size
		}
		pos.Margin += order.MarginRequired
		pos.UpdatedAt = time.Now()
		
		// If position closed
		if pos.Size <= 0 {
			pos.IsClosed = true
			now := time.Now()
			pos.ClosedAt = &now
		}
	}
	
	// Save to database
	if err := s.savePosition(ctx, pos); err != nil {
		s.logger.Error("Failed to save position", "error", err)
	}
}

// ============================================================================
// MARKET DATA FEED
// ============================================================================

func (s *TradingService) startMarketDataFeed(ctx context.Context) {
	// In production, this would connect to price feeds
	// For now, simulate with mock data
	ticker := &Ticker{
		Timestamp: time.Now(),
	}
	
	s.tickerMu.Lock()
	for symbol, sym := range s.symbols {
		ticker.Symbol = symbol
		ticker.Price = sym.LastPrice
		ticker.PriceChange = sym.PriceChange
		ticker.PriceChangePct = sym.PriceChangePct
		ticker.High24h = sym.High24h
		ticker.Low24h = sym.Low24h
		ticker.Volume24h = sym.Volume24h
		ticker.QuoteVolume24h = sym.QuoteVolume24h
		
		// Set bid/ask
		ticker.BidPrice = sym.LastPrice * 0.9995
		ticker.AskPrice = sym.LastPrice * 1.0005
		ticker.BidQty = sym.Volume24h * 0.1
		ticker.AskQty = sym.Volume24h * 0.1
		
		s.tickers[symbol] = ticker
	}
	s.tickerMu.Unlock()
	
	// Update every second
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for range ticker.C {
			s.updateTickers()
		}
	}()
}

func (s *TradingService) updateTickers() {
	s.tickerMu.Lock()
	defer s.tickerMu.Unlock()
	
	for symbol, ticker := range s.tickers {
		// Simulate price movement
		change := (math.random.Float64() - 0.5) * 0.001
		ticker.Price = ticker.Price * (1 + change)
		ticker.PriceChange = ticker.PriceChange + change*ticker.Price
		ticker.PriceChangePct = (ticker.PriceChange / (ticker.Price - ticker.PriceChange)) * 100
		
		if ticker.Price > ticker.High24h {
			ticker.High24h = ticker.Price
		}
		if ticker.Price < ticker.Low24h || ticker.Low24h == 0 {
			ticker.Low24h = ticker.Price
		}
		
		ticker.BidPrice = ticker.Price * 0.9995
		ticker.AskPrice = ticker.Price * 1.0005
		ticker.Timestamp = time.Now()
	}
}

// ============================================================================
// ORDER PROCESSING
// ============================================================================

func (s *TradingService) processOrders(ctx context.Context) {
	orderChan := make(chan *Order, 1000)
	
	go func() {
		for order := range orderChan {
			s.orderMu.Lock()
			s.orders[order.OrderID] = order
			s.orderMu.Unlock()
		}
	}()
	
	// Process pending orders
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		
		for range ticker.C {
			s.orderMu.RLock()
			var pending []*Order
			for _, order := range s.orders {
				if order.Status == OrderStatusPending {
					pending = append(pending, order)
				}
			}
			s.orderMu.RUnlock()
			
			for _, order := range pending {
				if order.Type == OrderTypeMarket {
					s.processMarketOrder(ctx, order)
				} else if order.Status == OrderStatusTriggered {
					s.processMarketOrder(ctx, order)
				}
			}
		}
	}()
	
	s.orderChan = orderChan
}

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

type WebSocketHub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan []byte
	register  chan *websocket.Conn
	unregister chan *websocket.Conn
}

func (s *TradingService) publishOrderEvent(event string, order *Order) {
	data, _ := json.Marshal(map[string]interface{}{
		"event":  event,
		"data":  order,
	})
	s.wsHub.broadcast <- data
}

func (s *TradingService) publishTradeEvent(trade *Trade) {
	data, _ := json.Marshal(map[string]interface{}{
		"event":  "trade",
		"data":  trade,
	})
	s.wsHub.broadcast <- data
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

func (s *TradingService) saveOrder(ctx context.Context, order *Order) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO orders (order_id, user_id, symbol, side, type, status, position_side,
		                   price, stop_price, trigger_price, original_quantity, executed_quantity,
		                   remaining_quantity, avg_price, maker_fee, taker_fee,
		                   time_in_force, leverage, margin_mode, margin_required,
		                   client_order_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
		ON CONFLICT (order_id) DO UPDATE SET
			status = EXCLUDED.status,
			executed_quantity = EXCLUDED.executed_quantity,
			avg_price = EXCLUDED.avg_price,
			updated_at = EXCLUDED.updated_at
	`, order.OrderID, order.UserID, order.Symbol, order.Side, order.Type, order.Status, order.PositionSide,
		order.Price, order.StopPrice, order.TriggerPrice, order.OriginalQty, order.ExecutedQty,
		order.RemainingQty, order.AvgPrice, order.MakerFee, order.TakerFee,
		order.TimeInForce, order.Leverage, order.MarginMode, order.MarginRequired,
		order.ClientOrderID, order.CreatedAt, order.UpdatedAt)
	
	return err
}

func (s *TradingService) updateOrderStatus(ctx context.Context, order *Order) error {
	_, err := s.db.Exec(ctx, `
		UPDATE orders 
		SET status = $1, executed_quantity = $2, avg_price = $3, updated_at = $4, filled_at = $5
		WHERE order_id = $6
	`, order.Status, order.ExecutedQty, order.AvgPrice, order.UpdatedAt, order.FilledAt, order.OrderID)
	
	return err
}

func (s *TradingService) getOrderFromDB(ctx context.Context, orderID string) (*Order, error) {
	var order Order
	err := s.db.QueryRow(ctx, `
		SELECT id, order_id, user_id, symbol, side, type, status, position_side,
		       price, stop_price, trigger_price, original_quantity, executed_quantity,
		       remaining_quantity, avg_price, time_in_force, leverage, margin_mode,
		       margin_required, client_order_id, created_at, updated_at, filled_at
		FROM orders WHERE order_id = $1
	`, orderID).Scan(
		&order.ID, &order.OrderID, &order.UserID, &order.Symbol, &order.Side, &order.Type, &order.Status, &order.PositionSide,
		&order.Price, &order.StopPrice, &order.TriggerPrice, &order.OriginalQty, &order.ExecutedQty,
		&order.RemainingQty, &order.AvgPrice, &order.TimeInForce, &order.Leverage, &order.MarginMode,
		&order.MarginRequired, &order.ClientOrderID, &order.CreatedAt, &order.UpdatedAt, &order.FilledAt,
	)
	
	return &order, err
}

func (s *TradingService) getOpenOrdersFromDB(ctx context.Context, userID uint64, symbol string, startTime, endTime int64, limit int) ([]Order, error) {
	query := `
		SELECT id, order_id, user_id, symbol, side, type, status, position_side,
		       price, stop_price, trigger_price, original_quantity, executed_quantity,
		       remaining_quantity, avg_price, time_in_force, leverage, margin_mode,
		       margin_required, client_order_id, created_at, updated_at, filled_at
		FROM orders 
		WHERE user_id = $1 AND status IN ('new', 'partially_filled', 'pending')
	`
	args := []interface{}{userID}
	
	if symbol != "" {
		query += " AND symbol = $2"
		args = append(args, symbol)
		limit = limit
	}
	
	if startTime > 0 {
		query += fmt.Sprintf(" AND created_at >= $%d", len(args)+1)
		args = append(args, startTime)
	}
	
	if endTime > 0 {
		query += fmt.Sprintf(" AND created_at <= $%d", len(args)+1)
		args = append(args, endTime)
	}
	
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", len(args)+1)
	args = append(args, limit)
	
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var orders []Order
	for rows.Next() {
		var order Order
		err := rows.Scan(
			&order.ID, &order.OrderID, &order.UserID, &order.Symbol, &order.Side, &order.Type, &order.Status, &order.PositionSide,
			&order.Price, &order.StopPrice, &order.TriggerPrice, &order.OriginalQty, &order.ExecutedQty,
			&order.RemainingQty, &order.AvgPrice, &order.TimeInForce, &order.Leverage, &order.MarginMode,
			&order.MarginRequired, &order.ClientOrderID, &order.CreatedAt, &order.UpdatedAt, &order.FilledAt,
		)
		if err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	
	return orders, rows.Err()
}

func (s *TradingService) saveTrade(ctx context.Context, trade *Trade) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO trades (trade_id, order_id, user_id, symbol, side, price, quantity,
		                   commission, commission_asset, maker_order_id, taker_order_id,
		                   trade_time, is_maker)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, trade.TradeID, trade.OrderID, trade.UserID, trade.Symbol, trade.Side, trade.Price, trade.Quantity,
		trade.Commission, trade.CommissionAsset, trade.MakerOrderID, trade.TakerOrderID,
		trade.TradeTime, trade.IsMaker)
	
	return err
}

func (s *TradingService) getTradesFromDB(ctx context.Context, userID uint64, symbol string, startTime, endTime, fromID int64, limit int) ([]Trade, error) {
	query := `
		SELECT id, trade_id, order_id, user_id, symbol, side, price, quantity,
		       commission, commission_asset, maker_order_id, taker_order_id,
		       trade_time, is_maker
		FROM trades 
		WHERE user_id = $1
	`
	args := []interface{}{userID}
	
	if symbol != "" {
		query += fmt.Sprintf(" AND symbol = $%d", len(args)+1)
		args = append(args, symbol)
	}
	
	if fromID > 0 {
		query += fmt.Sprintf(" AND id > $%d", len(args)+1)
		args = append(args, fromID)
	}
	
	if startTime > 0 {
		query += fmt.Sprintf(" AND trade_time >= $%d", len(args)+1)
		args = append(args, startTime)
	}
	
	if endTime > 0 {
		query += fmt.Sprintf(" AND trade_time <= $%d", len(args)+1)
		args = append(args, endTime)
	}
	
	query += fmt.Sprintf(" ORDER BY trade_time DESC LIMIT $%d", len(args)+1)
	args = append(args, limit)
	
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var trades []Trade
	for rows.Next() {
		var trade Trade
		err := rows.Scan(
			&trade.ID, &trade.TradeID, &trade.OrderID, &trade.UserID, &trade.Symbol, &trade.Side, &trade.Price, &trade.Quantity,
			&trade.Commission, &trade.CommissionAsset, &trade.MakerOrderID, &trade.TakerOrderID,
			&trade.TradeTime, &trade.IsMaker,
		)
		if err != nil {
			return nil, err
		}
		trades = append(trades, trade)
	}
	
	return trades, rows.Err()
}

func (s *TradingService) getRecentTradesFromDB(ctx context.Context, symbol string, limit int) ([]Trade, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, trade_id, order_id, user_id, symbol, side, price, quantity,
		       commission, commission_asset, maker_order_id, taker_order_id,
		       trade_time, is_maker
		FROM trades 
		WHERE symbol = $1
		ORDER BY trade_time DESC
		LIMIT $2
	`, symbol, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var trades []Trade
	for rows.Next() {
		var trade Trade
		err := rows.Scan(
			&trade.ID, &trade.TradeID, &trade.OrderID, &trade.UserID, &trade.Symbol, &trade.Side, &trade.Price, &trade.Quantity,
			&trade.Commission, &trade.CommissionAsset, &trade.MakerOrderID, &trade.TakerOrderID,
			&trade.TradeTime, &trade.IsMaker,
		)
		if err != nil {
			return nil, err
		}
		trades = append(trades, trade)
	}
	
	return trades, rows.Err()
}

func (s *TradingService) savePosition(ctx context.Context, pos *Position) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO positions (user_id, symbol, side, size, entry_price, mark_price,
		                    liquidation_price, unrealized_pnl, realized_pnl, margin,
		                    position_margin, maintenance_margin, leverage, margin_mode,
		                    is_closed, opened_at, updated_at, closed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		ON CONFLICT (user_id, symbol) DO UPDATE SET
			size = EXCLUDED.size,
			entry_price = EXCLUDED.entry_price,
			mark_price = EXCLUDED.mark_price,
			unrealized_pnl = EXCLUDED.unrealized_pnl,
			margin = EXCLUDED.margin,
			updated_at = EXCLUDED.updated_at,
			is_closed = EXCLUDED.is_closed,
			closed_at = EXCLUDED.closed_at
	`, pos.UserID, pos.Symbol, pos.Side, pos.Size, pos.EntryPrice, pos.MarkPrice,
		pos.LiquidationPrice, pos.UnrealizedPnL, pos.RealizedPnL, pos.Margin,
		pos.PositionMargin, pos.MaintenanceMargin, pos.Leverage, pos.MarginMode,
		pos.IsClosed, pos.OpenedAt, pos.UpdatedAt, pos.ClosedAt)
	
	return err
}

func (s *TradingService) getPositionFromDB(ctx context.Context, userID uint64, symbol string) (*Position, error) {
	var pos Position
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, symbol, side, size, entry_price, mark_price,
		       liquidation_price, unrealized_pnl, realized_pnl, margin,
		       position_margin, maintenance_margin, leverage, margin_mode,
		       is_closed, opened_at, updated_at, closed_at
		FROM positions 
		WHERE user_id = $1 AND symbol = $2 AND is_closed = false
	`, userID, symbol).Scan(
		&pos.ID, &pos.UserID, &pos.Symbol, &pos.Side, &pos.Size, &pos.EntryPrice, &pos.MarkPrice,
		&pos.LiquidationPrice, &pos.UnrealizedPnL, &pos.RealizedPnL, &pos.Margin,
		&pos.PositionMargin, &pos.MaintenanceMargin, &pos.Leverage, &pos.MarginMode,
		&pos.IsClosed, &pos.OpenedAt, &pos.UpdatedAt, &pos.ClosedAt,
	)
	
	return &pos, err
}

func (s *TradingService) getAllPositionsFromDB(ctx context.Context, userID uint64) ([]Position, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, symbol, side, size, entry_price, mark_price,
		       liquidation_price, unrealized_pnl, realized_pnl, margin,
		       position_margin, maintenance_margin, leverage, margin_mode,
		       is_closed, opened_at, updated_at, closed_at
		FROM positions 
		WHERE user_id = $1 AND is_closed = false
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var positions []Position
	for rows.Next() {
		var pos Position
		err := rows.Scan(
			&pos.ID, &pos.UserID, &pos.Symbol, &pos.Side, &pos.Size, &pos.EntryPrice, &pos.MarkPrice,
			&pos.LiquidationPrice, &pos.UnrealizedPnL, &pos.RealizedPnL, &pos.Margin,
			&pos.PositionMargin, &pos.MaintenanceMargin, &pos.Leverage, &pos.MarginMode,
			&pos.IsClosed, &pos.OpenedAt, &pos.UpdatedAt, &pos.ClosedAt,
		)
		if err != nil {
			return nil, err
		}
		positions = append(positions, pos)
	}
	
	return positions, rows.Err()
}

func (s *TradingService) getTickerFromDB(ctx context.Context, symbol string) (*Ticker, error) {
	var ticker Ticker
	err := s.db.QueryRow(ctx, `
		SELECT symbol, last_price, price_change, price_change_pct,
		       high_24h, low_24h, volume_24h, quote_volume_24h, trades_24h,
		       bid_price, ask_price, bid_qty, ask_qty
		FROM tickers WHERE symbol = $1
	`, symbol).Scan(
		&ticker.Symbol, &ticker.Price, &ticker.PriceChange, &ticker.PriceChangePct,
		&ticker.High24h, &ticker.Low24h, &ticker.Volume24h, &ticker.QuoteVolume24h, &ticker.Trades24h,
		&ticker.BidPrice, &ticker.AskPrice, &ticker.BidQty, &ticker.AskQty,
	)
	
	if err == sql.ErrNoRows {
		// Try from symbols table
		var sym Symbol
		err = s.db.QueryRow(ctx, `
			SELECT name, last_price, price_change, price_change_pct,
			       high_24h, low_24h, volume_24h, quote_volume_24h
			FROM symbols WHERE name = $1
		`, symbol).Scan(
			&ticker.Symbol, &ticker.Price, &ticker.PriceChange, &ticker.PriceChangePct,
			&ticker.High24h, &ticker.Low24h, &ticker.Volume24h, &ticker.QuoteVolume24h,
		)
		if err != nil {
			return nil, err
		}
	}
	
	ticker.Timestamp = time.Now()
	return &ticker, err
}

func (s *TradingService) getKlinesFromDB(ctx context.Context, symbol string, interval string, startTime, endTime int64, limit int) ([]Kline, error) {
	rows, err := s.db.Query(ctx, `
		SELECT open_time, open, high, low, close, volume, close_time, quote_volume, trades
		FROM klines 
		WHERE symbol = $1 AND interval = $2
		AND ($3 = 0 OR open_time >= $3)
		AND ($4 = 0 OR open_time <= $4)
		ORDER BY open_time DESC
		LIMIT $5
	`, symbol, interval, startTime, endTime, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var klines []Kline
	for rows.Next() {
		var kline Kline
		err := rows.Scan(
			&kline.OpenTime, &kline.Open, &kline.High, &kline.Low, &kline.Close,
			&kline.Volume, &kline.CloseTime, &kline.QuoteVolume, &kline.Trades,
		)
		if err != nil {
			return nil, err
		}
		klines = append(klines, kline)
	}
	
	// Reverse to get chronological order
	for i, j := 0, len(klines)-1; i < j; i, j = i+1, j-1 {
		klines[i], klines[j] = klines[j], klines[i]
	}
	
	return klines, rows.Err()
}

func (s *TradingService) saveLeveragePreference(ctx context.Context, userID uint64, symbol string, leverage int) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO user_preferences (user_id, symbol, leverage)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, symbol) DO UPDATE SET leverage = EXCLUDED.leverage
	`, userID, symbol, leverage)
	
	return err
}

func (s *TradingService) saveMarginModePreference(ctx context.Context, userID uint64, symbol string, mode MarginMode) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO user_preferences (user_id, symbol, margin_mode)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, symbol) DO UPDATE SET margin_mode = EXCLUDED.margin_mode
	`, userID, symbol, mode)
	
	return err
}

// ============================================================================
// ID GENERATION
// ============================================================================

func generateOrderID(userID uint64, symbol string) string {
	return fmt.Sprintf("%d-%s-%d", userID, symbol, time.Now().UnixMilli())
}

func generateOrderIDNumber() uint64 {
	return uint64(time.Now().UnixNano())
}

func generateTradeID(userID uint64, symbol string) string {
	return fmt.Sprintf("t-%d-%s-%d", userID, symbol, time.Now().UnixMilli())
}

func generateTradeIDNumber() uint64 {
	return uint64(time.Now().UnixNano())
}

// Add missing field
type OrderOrder = Order

var orderChan chan *Order
