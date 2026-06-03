// =============================================================================
// TIGEREX v3.0 - COMPLETE TRADING ENGINE
// Production-grade matching engine with all order types
// =============================================================================

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// CONSTANTS & ENUMS
// =============================================================================

const (
	// Order Types
	OrderTypeMarket       OrderType = "market"
	OrderTypeLimit        OrderType = "limit"
	OrderTypeStopLoss     OrderType = "stop_loss"
	OrderTypeStopLimit    OrderType = "stop_limit"
	OrderTypeStopMarket   OrderType = "stop_market"
	OrderTypeTakeProfit   OrderType = "take_profit"
	OrderTypeTrailingStop OrderType = "trailing_stop"
	OrderTypeOCO          OrderType = "oco"
	OrderTypeIceberg      OrderType = "iceberg"
	OrderTypeTWAP        OrderType = "twap"
	OrderTypeVWAP        OrderType = "vwap"

	// Order Sides
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"

	// Time in Force
	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC" // Immediate Or Cancel
	TimeInForceFOK TimeInForce = "FOK" // Fill Or Kill
	TimeInForceGTX TimeInForce = "GTX" // Good Till Cross
	TimeInForceGTT TimeInForce = "GTT" // Good Till Time

	// Order Status
	OrderStatusPending          OrderStatus = "pending"
	OrderStatusNew              OrderStatus = "new"
	OrderStatusPartiallyFilled  OrderStatus = "partially_filled"
	OrderStatusFilled          OrderStatus = "filled"
	OrderStatusCanceled        OrderStatus = "canceled"
	OrderStatusRejected        OrderStatus = "rejected"
	OrderStatusExpired         OrderStatus = "expired"
	OrderStatusTriggered        OrderStatus = "triggered"

	// Position Mode
	PositionModeIsolated       = "isolated"
	PositionModeCross          = "cross"

	// Trade Role
	TradeRoleMaker              = "maker"
	TradeRoleTaker              = "taker"
)

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type OrderType string
type OrderSide string
type TimeInForce string
type OrderStatus string

// Order represents a trading order
type Order struct {
	// Order identification
	OrderID         string    `json:"orderId"`
	ClientOrderID   string    `json:"clientOrderId,omitempty"`
	UserID          string    `json:"userId"`
	MarketSymbol    string    `json:"marketSymbol"`
	Side            OrderSide `json:"side"`
	Type            OrderType `json:"type"`

	// Order parameters
	Price           float64   `json:"price"`
	StopPrice       float64   `json:"stopPrice,omitempty"`
	Quantity        float64   `json:"quantity"`
	FilledQuantity  float64   `json:"filledQuantity"`
	RemainingQty    float64   `json:"remaining"`
	QuoteQuantity   float64   `json:"quoteQuantity"`
	IcebergQty      float64   `json:"icebergQty,omitempty"`
	TrailingDelta   float64   `json:"trailingDelta,omitempty"`
	TrailingCallback float64  `json:"trailingCallback,omitempty"`

	// Time in force
	TimeInForce     TimeInForce `json:"timeInForce"`
	ExpiresAt       int64       `json:"expiresAt,omitempty"`

	// Execution flags
	IsPostOnly      bool        `json:"postOnly,omitempty"`
	IsReduceOnly    bool        `json:"reduceOnly,omitempty"`
	IsMarketOnClose bool        `json:"marketOnClose,omitempty"`
	SelfTradePrevention string   `json:"selfTradePrevention,omitempty"`

	// Fees
	MakerFeeRate    float64    `json:"makerFeeRate"`
	TakerFeeRate    float64    `json:"takerFeeRate"`

	// Position info (for margin/futures)
	Leverage        float64    `json:"leverage,omitempty"`
	MarginUsed      float64    `json:"marginUsed,omitempty"`
	PositionMode    string     `json:"positionMode,omitempty"`

	// Timestamps
	Status          OrderStatus `json:"status"`
	CreatedAt       int64       `json:"createdAt"`
	UpdatedAt       int64       `json:"updatedAt"`
	TradedAt        int64       `json:"tradedAt,omitempty"`
	ExpiredAt       int64       `json:"expiredAt,omitempty"`

	// Linked orders (for OCO)
	LinkedOrderID   string     `json:"linkedOrderId,omitempty"`

	// Average fill price
	AvgFillPrice    float64    `json:"avgFillPrice"`
}

// Trade represents an executed trade
type Trade struct {
	TradeID        string    `json:"tradeId"`
	OrderID        string    `json:"orderId"`
	CounterOrderID string    `json:"counterOrderId"`
	MarketSymbol   string    `json:"marketSymbol"`
	UserID         string    `json:"userId"`
	CounterUserID  string    `json:"counterUserId"`
	Side           OrderSide `json:"side"`
	Role           string    `json:"role"` // maker/taker
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	QuoteQuantity  float64   `json:"quoteQuantity"`
	MakerFee       float64   `json:"makerFee"`
	TakerFee       float64   `json:"takerFee"`
	RealizedPNL    float64    `json:"realizedPnl,omitempty"`
	Liquidation    bool      `json:"liquidation,omitempty"`
	SelfTrade      bool      `json:"selfTrade,omitempty"`
	Timestamp      int64     `json:"timestamp"`
}

// Position represents a user's trading position
type Position struct {
	PositionID      string    `json:"positionId"`
	UserID         string    `json:"userId"`
	MarketSymbol   string    `json:"marketSymbol"`
	Side           OrderSide `json:"side"`
	Size           float64   `json:"size"`
	EntryPrice     float64   `json:"entryPrice"`
	Margin         float64   `json:"margin"`
	LiquidationPrice float64 `json:"liquidationPrice"`
	Leverage       float64   `json:"leverage"`
	UnrealizedPNL  float64   `json:"unrealizedPnl"`
	RealizedPNL    float64   `json:"realizedPnl"`
	MarginRatio    float64   `json:"marginRatio"`
	PositionMode   string    `json:"positionMode"`
	MarkPrice      float64   `json:"markPrice"`
	IsolatedMargin float64   `json:"isolatedMargin,omitempty"`
	AutoTopUp      bool      `json:"autoTopUp,omitempty"`
	CreatedAt      int64     `json:"createdAt"`
	UpdatedAt      int64     `json:"updatedAt"`
}

// OrderBook represents the order book for a market
type OrderBook struct {
	mu sync.RWMutex

	MarketSymbol    string       `json:"marketSymbol"`
	Bids            *PriceLevels `json:"bids"`
	Asks            *PriceLevels `json:"asks"`
	LastUpdateID    int64        `json:"lastUpdateId"`
	Sequence        int64        `json:"sequence"`

	// Market configuration
	BaseAsset       string      `json:"baseAsset"`
	QuoteAsset      string      `json:"quoteAsset"`
	MinPrice        float64     `json:"minPrice"`
	MaxPrice        float64     `json:"maxPrice"`
	TickSize        float64     `json:"tickSize"`
	LotSize         float64     `json:"lotSize"`
	PricePrecision  int         `json:"pricePrecision"`
	QtyPrecision    int         `json:"qtyPrecision"`

	// Trading state
	TradingEnabled  bool        `json:"tradingEnabled"`
	CancelOnly      bool        `json:"cancelOnly"`
	FastMatch       bool        `json:"fastMatch"`

	// Calculated metrics
	Spread          float64     `json:"spread"`
	SpreadPercent   float64     `json:"spreadPercent"`
	MidPrice        float64     `json:"midPrice"`
	BestBid         float64     `json:"bestBid"`
	BestAsk         float64     `json:"bestAsk"`
	Volume24h       float64     `json:"volume24h"`
	QuoteVolume24h  float64     `json:"quoteVolume24h"`
}

// PriceLevel represents aggregated orders at a price level
type PriceLevel struct {
	Price        float64  `json:"price"`
	Quantity     float64  `json:"quantity"`
	Orders       []*Order `json:"orders"`
	OrderCount   int      `json:"orderCount"`
	AccumQty     float64  `json:"accumQty"`
}

// PriceLevels is a sorted slice of price levels
type PriceLevels []*PriceLevel

func (pl PriceLevels) Len() int           { return len(pl) }
func (pl PriceLevels) Less(i, j int) bool  { return pl[i].Price < pl[j].Price }
func (pl PriceLevels) Swap(i, j int)       { pl[i], pl[j] = pl[j], pl[i] }

func (pl PriceLevels) LenDesc() int           { return len(pl) }
func (pl PriceLevels) LessDesc(i, j int) bool  { return pl[i].Price > pl[j].Price }
func (pl PriceLevels) SwapDesc(i, j int)       { pl[i], pl[j] = pl[j], pl[i] }

// Ticker represents market ticker data
type Ticker struct {
	MarketSymbol      string  `json:"marketSymbol"`
	LastPrice         float64 `json:"lastPrice"`
	PriceChange       float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	High24h           float64 `json:"high24h"`
	Low24h            float64 `json:"low24h"`
	Volume24h         float64 `json:"volume24h"`
	QuoteVolume24h    float64 `json:"quoteVolume24h"`
	BidPrice          float64 `json:"bidPrice"`
	AskPrice          float64 `json:"askPrice"`
	OpenPrice         float64 `json:"openPrice"`
	ClosePrice        float64 `json:"closePrice"`
	Timestamp         int64   `json:"timestamp"`
}

// Market represents a trading market configuration
type Market struct {
	Symbol          string  `json:"symbol"`
	BaseAsset       string  `json:"baseAsset"`
	QuoteAsset      string  `json:"quoteAsset"`
	Status          string  `json:"status"`
	MinPrice        float64 `json:"minPrice"`
	MaxPrice        float64 `json:"maxPrice"`
	TickSize        float64 `json:"tickSize"`
	LotSize         float64 `json:"lotSize"`
	MinQty          float64 `json:"minQty"`
	MaxQty          float64 `json:"maxQty"`
	MakerFee        float64 `json:"makerFee"`
	TakerFee        float64 `json:"takerFee"`
	LeverageEnabled bool    `json:"leverageEnabled"`
	MaxLeverage     float64 `json:"maxLeverage"`
}

// UserBalance represents a user's asset balance
type UserBalance struct {
	UserID      string  `json:"userId"`
	Currency    string  `json:"currency"`
	Available   float64 `json:"available"`
	Locked      float64 `json:"locked"`
	Total       float64 `json:"total"`
	USDValue    float64 `json:"usdValue"`
}

// =============================================================================
// MATCHING ENGINE
// =============================================================================

type MatchingEngine struct {
	mu sync.RWMutex

	// Market data
	markets     map[string]*Market
	orderBooks   map[string]*OrderBook
	tickers      map[string]*Ticker

	// Orders
	orders        map[string]*Order
	userOrders    map[string][]*Order
	stopOrders    map[string]*Order
	ocoOrders     map[string][]*Order

	// Positions (for margin/futures)
	positions     map[string]*Position
	userPositions map[string][]*Position

	// Balances
	balances      map[string]map[string]*UserBalance

	// Statistics
	stats          EngineStats

	// Callbacks
	onTrade        func(*Trade)
	onOrderUpdate   func(*Order)
	onPositionUpdate func(*Position)
	onTickerUpdate  func(*Ticker)

	// Configuration
	config         EngineConfig

	// Background workers
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
}

type EngineStats struct {
	mu                   sync.Mutex
	OrdersProcessed      int64   `json:"ordersProcessed"`
	TradesExecuted       int64   `json:"tradesExecuted"`
	TotalVolume          float64 `json:"totalVolume"`
	TotalFees            float64 `json:"totalFees"`
	AvgLatencyUs         int64   `json:"avgLatencyUs"`
	MaxLatencyUs         int64   `json:"maxLatencyUs"`
	MinLatencyUs         int64   `json:"minLatencyUs"`
	RejectedOrders       int64   `json:"rejectedOrders"`
	CanceledOrders       int64   `json:"canceledOrders"`
}

type EngineConfig struct {
	MaxOrdersPerUser     int
	MaxOpenOrders        int
	MaxOrderValue        float64
	MinOrderValue        float64
	MakerFeeRate         float64
	TakerFeeRate         float64
	LiquidationBuffer    float64
	InsuranceFundRate    float64
}

// =============================================================================
// MATCHING ENGINE METHODS
// =============================================================================

func NewMatchingEngine() *MatchingEngine {
	ctx, cancel := context.WithCancel(context.Background())
	
	engine := &MatchingEngine{
		markets:      make(map[string]*Market),
		orderBooks:   make(map[string]*OrderBook),
		tickers:      make(map[string]*Ticker),
		orders:       make(map[string]*Order),
		userOrders:   make(map[string][]*Order),
		stopOrders:   make(map[string]*Order),
		ocoOrders:    make(map[string][]*Order),
		positions:    make(map[string]*Position),
		userPositions: make(map[string][]*Position),
		balances:     make(map[string]map[string]*UserBalance),
		ctx:          ctx,
		cancel:       cancel,
		config: EngineConfig{
			MaxOrdersPerUser:     100,
			MaxOpenOrders:        10,
			MaxOrderValue:        10000000, // $10M
			MinOrderValue:        10,        // $10
			MakerFeeRate:         0.001,     // 0.1%
			TakerFeeRate:         0.002,     // 0.2%
			LiquidationBuffer:    0.8,        // 80%
			InsuranceFundRate:    0.0001,     // 0.01%
		},
	}

	// Start background workers
	engine.startWorkers()

	return engine
}

func (e *MatchingEngine) startWorkers() {
	// Order expiration worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.processExpiredOrders()
			}
		}
	}()

	// Liquidation worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.processLiquidations()
			}
		}
	}()

	// Price tick worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.updateTickers()
			}
		}
	}()
}

func (e *MatchingEngine) Shutdown() {
	e.cancel()
	e.wg.Wait()
}

// =============================================================================
// MARKET MANAGEMENT
// =============================================================================

func (e *MatchingEngine) InitializeMarket(
	symbol, base, quote string,
	pricePrecision, qtyPrecision int,
	minPrice, maxPrice, tickSize, lotSize float64,
) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	market := &Market{
		Symbol:         symbol,
		BaseAsset:       base,
		QuoteAsset:      quote,
		Status:          "trading",
		MinPrice:        minPrice,
		MaxPrice:        maxPrice,
		TickSize:        tickSize,
		LotSize:         lotSize,
		MinQty:          lotSize,
		MaxQty:          math.MaxFloat64,
		MakerFee:        e.config.MakerFeeRate,
		TakerFee:        e.config.TakerFeeRate,
		LeverageEnabled: true,
		MaxLeverage:     125,
	}

	e.markets[symbol] = market

	ob := &OrderBook{
		MarketSymbol:   symbol,
		Bids:          new(PriceLevels),
		Asks:          new(PriceLevels),
		LastUpdateID:  1,
		Sequence:       0,
		BaseAsset:     base,
		QuoteAsset:    quote,
		MinPrice:      minPrice,
		MaxPrice:      maxPrice,
		TickSize:      tickSize,
		LotSize:       lotSize,
		PricePrecision: pricePrecision,
		QtyPrecision:  qtyPrecision,
		TradingEnabled: true,
	}
	*ob.Bids = make([]*PriceLevel, 0, 100)
	*ob.Asks = make([]*PriceLevel, 0, 100)

	e.orderBooks[symbol] = ob

	e.tickers[symbol] = &Ticker{
		MarketSymbol: symbol,
		High24h:     0,
		Low24h:      math.MaxFloat64,
		Timestamp:   time.Now().Unix(),
	}

	log.Printf("[INFO] Market initialized: %s (base: %s, quote: %s)", symbol, base, quote)
	return nil
}

func (e *MatchingEngine) GetMarket(symbol string) (*Market, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if market, ok := e.markets[symbol]; ok {
		return market, nil
	}
	return nil, errors.New("market not found")
}

func (e *MatchingEngine) GetAllMarkets() []*Market {
	e.mu.RLock()
	defer e.mu.RUnlock()

	markets := make([]*Market, 0, len(e.markets))
	for _, m := range e.markets {
		markets = append(markets, m)
	}
	return markets
}

// =============================================================================
// ORDER MANAGEMENT
// =============================================================================

func (e *MatchingEngine) PlaceOrder(req *PlaceOrderRequest) (*Order, error) {
	startTime := time.Now()
	
	// Validate request
	if err := e.validateOrderRequest(req); err != nil {
		atomic.AddInt64(&e.stats.RejectedOrders, 1)
		return nil, err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// Get market
	market, ok := e.markets[req.MarketSymbol]
	if !ok {
		return nil, errors.New("market not found")
	}

	// Check user balance
	if !e.checkBalance(req.UserID, market.QuoteAsset, e.calculateRequiredBalance(req)) {
		return nil, errors.New("insufficient balance")
	}

	// Generate order ID
	orderID := e.generateOrderID()
	
	// Create order
	order := &Order{
		OrderID:           orderID,
		ClientOrderID:     req.ClientOrderID,
		UserID:            req.UserID,
		MarketSymbol:      req.MarketSymbol,
		Side:              req.Side,
		Type:              req.Type,
		Price:             req.Price,
		StopPrice:         req.StopPrice,
		Quantity:          req.Quantity,
		FilledQuantity:    0,
		RemainingQty:      req.Quantity,
		QuoteQuantity:     req.Price * req.Quantity,
		TimeInForce:       req.TimeInForce,
		ExpiresAt:         req.ExpiresAt,
		IsPostOnly:        req.IsPostOnly,
		IsReduceOnly:      req.IsReduceOnly,
		Leverage:          req.Leverage,
		PositionMode:      req.PositionMode,
		MakerFeeRate:      market.MakerFee,
		TakerFeeRate:      market.TakerFee,
		Status:            OrderStatusNew,
		CreatedAt:         time.Now().UnixMilli(),
		UpdatedAt:         time.Now().UnixMilli(),
		AvgFillPrice:      0,
	}

	// Handle special order types
	if order.Type == OrderTypeIceberg {
		order.IcebergQty = req.IcebergQty
		order.RemainingQty = req.IcebergQty
	}

	if order.Type == OrderTypeTrailingStop {
		order.TrailingDelta = req.TrailingDelta
		order.TrailingCallback = req.TrailingCallback
	}

	// Handle OCO orders
	if order.Type == OrderTypeOCO {
		// Create linked stop-loss order
		stopOrder := &Order{
			OrderID:         e.generateOrderID(),
			UserID:          order.UserID,
			MarketSymbol:    order.MarketSymbol,
			Side:            oppositeSide(order.Side),
			Type:            OrderTypeStopLoss,
			Price:           order.StopPrice,
			StopPrice:       order.StopPrice,
			Quantity:        order.Quantity,
			RemainingQty:    order.Quantity,
			TimeInForce:     order.TimeInForce,
			Leverage:        order.Leverage,
			LinkedOrderID:   order.OrderID,
			Status:          OrderStatusPending,
			CreatedAt:       time.Now().UnixMilli(),
			UpdatedAt:       time.Now().UnixMilli(),
		}
		e.stopOrders[stopOrder.OrderID] = stopOrder
		order.LinkedOrderID = stopOrder.OrderID
		
		// Create take-profit order
		tpOrder := &Order{
			OrderID:         e.generateOrderID(),
			UserID:          order.UserID,
			MarketSymbol:    order.MarketSymbol,
			Side:            oppositeSide(order.Side),
			Type:            OrderTypeTakeProfit,
			Price:           order.Price,
			StopPrice:       order.Price,
			Quantity:        order.Quantity,
			RemainingQty:    order.Quantity,
			TimeInForce:     order.TimeInForce,
			Leverage:        order.Leverage,
			LinkedOrderID:   order.OrderID,
			Status:          OrderStatusPending,
			CreatedAt:       time.Now().UnixMilli(),
			UpdatedAt:       time.Now().UnixMilli(),
		}
		e.stopOrders[tpOrder.OrderID] = tpOrder
		
		// Add to OCO group
		e.ocoOrders[order.OrderID] = []*Order{stopOrder, tpOrder}
	}

	// Lock funds
	e.lockFunds(order.UserID, market.QuoteAsset, order.QuoteQuantity)

	// Process the order
	var trades []*Trade
	var err error

	switch order.Type {
	case OrderTypeMarket:
		trades, err = e.executeMarketOrder(order)
	case OrderTypeLimit, OrderTypeStopLimit:
		trades, err = e.executeLimitOrder(order)
	case OrderTypeStopLoss, OrderTypeStopMarket, OrderTypeTakeProfit:
		// Add to stop order book
		e.addStopOrder(order)
		order.Status = OrderStatusPending
	default:
		trades, err = e.executeLimitOrder(order)
	}

	if err != nil {
		e.unlockFunds(order.UserID, market.QuoteAsset, order.QuoteQuantity)
		return nil, err
	}

	// Store order
	e.orders[order.OrderID] = order
	e.userOrders[order.UserID] = append(e.userOrders[order.UserID], order)

	// Update statistics
	atomic.AddInt64(&e.stats.OrdersProcessed, 1)
	
	// Update latency
	latency := time.Since(startTime).Microseconds()
	e.updateLatencyStats(latency)

	// Process trades
	for _, trade := range trades {
		e.processTrade(trade)
	}

	// Notify callbacks
	if e.onOrderUpdate != nil {
		e.onOrderUpdate(order)
	}

	log.Printf("[INFO] Order placed: %s %s %s %s %.8f @ %.8f [trades: %d]",
		order.OrderID, order.UserID, order.Side, order.MarketSymbol, order.Quantity, order.Price, len(trades))

	return order, nil
}

func (e *MatchingEngine) validateOrderRequest(req *PlaceOrderRequest) error {
	if req.UserID == "" {
		return errors.New("user ID required")
	}
	if req.MarketSymbol == "" {
		return errors.New("market symbol required")
	}
	if req.Side != OrderSideBuy && req.Side != OrderSideSell {
		return errors.New("invalid order side")
	}
	if req.Quantity <= 0 {
		return errors.New("quantity must be positive")
	}
	if req.Type == OrderTypeLimit || req.Type == OrderTypeStopLimit {
		if req.Price <= 0 {
			return errors.New("price must be positive")
		}
	}
	if req.TimeInForce == "" {
		req.TimeInForce = TimeInForceGTC
	}

	market, ok := e.markets[req.MarketSymbol]
	if !ok {
		return errors.New("market not found")
	}

	// Validate lot size
	if math.Remainder(req.Quantity, market.LotSize) != 0 {
		return fmt.Errorf("quantity must be multiple of lot size: %f", market.LotSize)
	}

	// Validate tick size
	if math.Remainder(req.Price, market.TickSize) != 0 {
		return fmt.Errorf("price must be multiple of tick size: %f", market.TickSize)
	}

	// Check order value
	orderValue := req.Price * req.Quantity
	if orderValue < e.config.MinOrderValue {
		return fmt.Errorf("order value below minimum: %.2f", e.config.MinOrderValue)
	}
	if orderValue > e.config.MaxOrderValue {
		return fmt.Errorf("order value exceeds maximum: %.2f", e.config.MaxOrderValue)
	}

	// Check leverage
	if req.Leverage > market.MaxLeverage {
		return fmt.Errorf("leverage exceeds maximum: %.2f", market.MaxLeverage)
	}

	return nil
}

func (e *MatchingEngine) calculateRequiredBalance(req *PlaceOrderRequest) float64 {
	if req.Leverage > 1 {
		return (req.Price * req.Quantity) / req.Leverage
	}
	return req.Price * req.Quantity
}

// =============================================================================
// ORDER EXECUTION
// =============================================================================

func (e *MatchingEngine) executeLimitOrder(order *Order) ([]*Trade, error) {
	ob, ok := e.orderBooks[order.MarketSymbol]
	if !ok {
		return nil, errors.New("order book not found")
	}

	var trades []*Trade
	remaining := order.RemainingQty

	if order.Side == OrderSideBuy {
		// Match against asks (sellers)
		for _, level := range *ob.Asks {
			if remaining <= 0 {
				break
			}
			if order.Price < level.Price && !order.IsPostOnly {
				break // Price too low, can't match
			}

			for _, makerOrder := range level.Orders {
				if remaining <= 0 {
					break
				}

				// Post-only: don't take liquidity
				if order.IsPostOnly && order.Price < makerOrder.Price {
					continue
				}

				// Check self-trade prevention
				if order.UserID == makerOrder.UserID {
					if order.SelfTradePrevention == "cancel_both" || order.SelfTradePrevention == "" {
						continue
					}
				}

				qty := math.Min(remaining, makerOrder.RemainingQty)
				trade := e.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				remaining -= qty
				order.FilledQuantity += qty
				makerOrder.FilledQuantity += qty
				makerOrder.RemainingQty -= qty
			}

			// Remove empty levels
			e.cleanPriceLevel(ob.Asks, level)
		}
	} else {
		// Match against bids (buyers)
		for _, level := range *ob.Bids {
			if remaining <= 0 {
				break
			}
			if order.Price > level.Price && !order.IsPostOnly {
				break // Price too high, can't match
			}

			for _, makerOrder := range level.Orders {
				if remaining <= 0 {
					break
				}

				// Post-only: don't take liquidity
				if order.IsPostOnly && order.Price > makerOrder.Price {
					continue
				}

				// Check self-trade prevention
				if order.UserID == makerOrder.UserID {
					if order.SelfTradePrevention == "cancel_both" || order.SelfTradePrevention == "" {
						continue
					}
				}

				qty := math.Min(remaining, makerOrder.RemainingQty)
				trade := e.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				remaining -= qty
				order.FilledQuantity += qty
				makerOrder.FilledQuantity += qty
				makerOrder.RemainingQty -= qty
			}

			// Remove empty levels
			e.cleanPriceLevel(ob.Bids, level)
		}
	}

	order.RemainingQty = remaining

	// If remaining quantity, add to order book
	if order.RemainingQty > 0 {
		e.addToOrderBook(ob, order)
	} else {
		order.Status = OrderStatusFilled
	}

	if order.FilledQuantity > 0 {
		order.AvgFillPrice = e.calculateAvgFillPrice(trades)
	}

	return trades, nil
}

func (e *MatchingEngine) executeMarketOrder(order *Order) ([]*Trade, error) {
	ob, ok := e.orderBooks[order.MarketSymbol]
	if !ok {
		return nil, errors.New("order book not found")
	}

	var trades []*Trade
	remaining := order.Quantity

	if order.Side == OrderSideBuy {
		for _, level := range *ob.Asks {
			if remaining <= 0 {
				break
			}

			for _, makerOrder := range level.Orders {
				if remaining <= 0 {
					break
				}

				// Check self-trade prevention
				if order.UserID == makerOrder.UserID {
					if order.SelfTradePrevention == "cancel_both" || order.SelfTradePrevention == "" {
						continue
					}
				}

				qty := math.Min(remaining, makerOrder.RemainingQty)
				trade := e.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				remaining -= qty
				order.FilledQuantity += qty
				makerOrder.FilledQuantity += qty
				makerOrder.RemainingQty -= qty
			}

			e.cleanPriceLevel(ob.Asks, level)
		}
	} else {
		for _, level := range *ob.Bids {
			if remaining <= 0 {
				break
			}

			for _, makerOrder := range level.Orders {
				if remaining <= 0 {
					break
				}

				// Check self-trade prevention
				if order.UserID == makerOrder.UserID {
					if order.SelfTradePrevention == "cancel_both" || order.SelfTradePrevention == "" {
						continue
					}
				}

				qty := math.Min(remaining, makerOrder.RemainingQty)
				trade := e.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				remaining -= qty
				order.FilledQuantity += qty
				makerOrder.FilledQuantity += qty
				makerOrder.RemainingQty -= qty
			}

			e.cleanPriceLevel(ob.Bids, level)
		}
	}

	order.RemainingQty = remaining

	if remaining > 0 && order.FilledQuantity == 0 {
		order.Status = OrderStatusRejected
	} else if remaining > 0 && order.FilledQuantity > 0 {
		order.Status = OrderStatusPartiallyFilled
	} else {
		order.Status = OrderStatusFilled
	}

	if order.FilledQuantity > 0 {
		order.AvgFillPrice = e.calculateAvgFillPrice(trades)
	}

	return trades, nil
}

func (e *MatchingEngine) createTrade(ob *OrderBook, taker, maker *Order, price, quantity float64) *Trade {
	isTaker := taker.Type == OrderTypeMarket || (taker.Type == OrderTypeLimit && !taker.IsPostOnly)

	trade := &Trade{
		TradeID:        e.generateTradeID(),
		OrderID:        taker.OrderID,
		CounterOrderID: maker.OrderID,
		MarketSymbol:   ob.MarketSymbol,
		UserID:         taker.UserID,
		CounterUserID:  maker.UserID,
		Side:           taker.Side,
		Price:          price,
		Quantity:       quantity,
		QuoteQuantity:  price * quantity,
		Timestamp:      time.Now().UnixMilli(),
	}

	// Calculate fees
	if isTaker {
		trade.TakerFee = trade.QuoteQuantity * taker.TakerFeeRate
		trade.MakerFee = trade.QuoteQuantity * maker.MakerFeeRate
		trade.Role = TradeRoleTaker
	} else {
		trade.MakerFee = trade.QuoteQuantity * maker.MakerFeeRate
		trade.TakerFee = 0
		trade.Role = TradeRoleMaker
	}

	// Check for self-trade
	if taker.UserID == maker.UserID {
		trade.SelfTrade = true
	}

	return trade
}

func (e *MatchingEngine) calculateAvgFillPrice(trades []*Trade) float64 {
	if len(trades) == 0 {
		return 0
	}

	totalValue := 0.0
	totalQty := 0.0

	for _, trade := range trades {
		totalValue += trade.Price * trade.Quantity
		totalQty += trade.Quantity
	}

	if totalQty == 0 {
		return 0
	}

	return totalValue / totalQty
}

func (e *MatchingEngine) addToOrderBook(ob *OrderBook, order *Order) {
	level := &PriceLevel{
		Price:      order.Price,
		Quantity:   order.RemainingQty,
		Orders:     []*Order{order},
		OrderCount: 1,
	}

	if order.Side == OrderSideBuy {
		*ob.Bids = append(*ob.Bids, level)
		sort.Sort(PriceLevels(*ob.Bids))
	} else {
		*ob.Asks = append(*ob.Asks, level)
		sort.Sort(PriceLevels(*ob.Asks))
	}

	order.priceLevel = len(*ob.Bids)
}

func (e *MatchingEngine) addStopOrder(order *Order) {
	e.stopOrders[order.OrderID] = order
}

func (e *MatchingEngine) cleanPriceLevel(levels *PriceLevels, level *PriceLevel) {
	// Remove orders with zero remaining quantity
	validOrders := make([]*Order, 0)
	for _, order := range level.Orders {
		if order.RemainingQty > 0 {
			validOrders = append(validOrders, order)
		}
	}

	if len(validOrders) == 0 {
		// Remove the level
		*levels = removePriceLevel(*levels, level)
	} else {
		level.Orders = validOrders
		level.Quantity = 0
		for _, order := range validOrders {
			level.Quantity += order.RemainingQty
		}
	}
}

func removePriceLevel(levels PriceLevels, level *PriceLevel) PriceLevels {
	result := make(PriceLevels, 0)
	for _, l := range levels {
		if l != level {
			result = append(result, l)
		}
	}
	return result
}

// =============================================================================
// ORDER BOOK MANAGEMENT
// =============================================================================

func (e *MatchingEngine) CancelOrder(orderID, userID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	order, ok := e.orders[orderID]
	if !ok {
		return errors.New("order not found")
	}

	if order.UserID != userID {
		return errors.New("unauthorized")
	}

	if order.Status == OrderStatusFilled || order.Status == OrderStatusCanceled {
		return errors.New("order already settled")
	}

	// Update status
	order.Status = OrderStatusCanceled
	order.UpdatedAt = time.Now().UnixMilli()

	// Unlock frozen funds
	market, _ := e.markets[order.MarketSymbol]
	if market != nil {
		e.unlockFunds(order.UserID, market.QuoteAsset, order.QuoteQuantity-(order.FilledQuantity*order.AvgFillPrice))
	}

	// If OCO, cancel linked orders
	if order.LinkedOrderID != "" {
		if ocoOrders, ok := e.ocoOrders[order.OrderID]; ok {
			for _, linkedOrder := range ocoOrders {
				linkedOrder.Status = OrderStatusCanceled
			}
		}
	}

	// Remove from stop orders
	if _, ok := e.stopOrders[orderID]; ok {
		delete(e.stopOrders, orderID)
	}

	atomic.AddInt64(&e.stats.CanceledOrders, 1)

	log.Printf("[INFO] Order canceled: %s by %s", orderID, userID)

	if e.onOrderUpdate != nil {
		e.onOrderUpdate(order)
	}

	return nil
}

func (e *MatchingEngine) GetOrder(orderID string) (*Order, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if order, ok := e.orders[orderID]; ok {
		return order, nil
	}
	return nil, errors.New("order not found")
}

func (e *MatchingEngine) GetOpenOrders(userID string) []*Order {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var orders []*Order
	for _, order := range e.orders {
		if order.UserID == userID {
			if order.Status == OrderStatusNew || order.Status == OrderStatusPartiallyFilled {
				orders = append(orders, order)
			}
		}
	}
	return orders
}

func (e *MatchingEngine) GetOrderHistory(userID string, limit int) []*Order {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var orders []*Order
	for _, order := range e.orders {
		if order.UserID == userID {
			if order.Status == OrderStatusFilled || order.Status == OrderStatusCanceled || order.Status == OrderStatusRejected {
				orders = append(orders, order)
				if limit > 0 && len(orders) >= limit {
					break
				}
			}
		}
	}
	return orders
}

// =============================================================================
// ORDER BOOK QUERIES
// =============================================================================

func (e *MatchingEngine) GetOrderBook(symbol string, depth int) (*OrderBookData, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	ob, ok := e.orderBooks[symbol]
	if !ok {
		return nil, errors.New("market not found")
	}

	if depth <= 0 {
		depth = 20
	}

	bids := make([]*OrderBookLevelData, 0, depth)
	for i := 0; i < len(*ob.Bids) && i < depth; i++ {
		level := (*ob.Bids)[i]
		bids = append(bids, &OrderBookLevelData{
			Price:    level.Price,
			Quantity: level.Quantity,
			Orders:   level.OrderCount,
		})
	}

	asks := make([]*OrderBookLevelData, 0, depth)
	for i := 0; i < len(*ob.Asks) && i < depth; i++ {
		level := (*ob.Asks)[i]
		asks = append(asks, &OrderBookLevelData{
			Price:    level.Price,
			Quantity: level.Quantity,
			Orders:   level.OrderCount,
		})
	}

	return &OrderBookData{
		LastUpdateID: ob.LastUpdateID,
		Bids:        bids,
		Asks:        asks,
		Spread:      ob.Spread,
	}, nil
}

type OrderBookData struct {
	LastUpdateID int64                  `json:"lastUpdateId"`
	Bids         []*OrderBookLevelData `json:"bids"`
	Asks         []*OrderBookLevelData `json:"asks"`
	Spread       float64               `json:"spread"`
}

type OrderBookLevelData struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Orders   int     `json:"orders"`
}

func (e *MatchingEngine) GetTicker(symbol string) (*Ticker, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if ticker, ok := e.tickers[symbol]; ok {
		return ticker, nil
	}
	return nil, errors.New("market not found")
}

func (e *MatchingEngine) GetAllTickers() []*Ticker {
	e.mu.RLock()
	defer e.mu.RUnlock()

	tickers := make([]*Ticker, 0, len(e.tickers))
	for _, t := range e.tickers {
		tickers = append(tickers, t)
	}
	return tickers
}

// =============================================================================
// TRADE PROCESSING
// =============================================================================

func (e *MatchingEngine) processTrade(trade *Trade) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Update balances
	e.updateBalancesForTrade(trade)

	// Update ticker
	if ticker, ok := e.tickers[trade.MarketSymbol]; ok {
		ticker.LastPrice = trade.Price
		ticker.PriceChange = trade.Price - ticker.OpenPrice
		ticker.PriceChangePercent = (ticker.PriceChange / ticker.OpenPrice) * 100
		if trade.Price > ticker.High24h {
			ticker.High24h = trade.Price
		}
		if trade.Price < ticker.Low24h {
			ticker.Low24h = trade.Price
		}
		ticker.Volume24h += trade.Quantity
		ticker.QuoteVolume24h += trade.QuoteQuantity
		ticker.BidPrice = trade.Price
		ticker.AskPrice = trade.Price
	}

	// Update statistics
	atomic.AddInt64(&e.stats.TradesExecuted, 1)
	e.stats.TotalVolume += trade.QuoteQuantity
	e.stats.TotalFees += trade.MakerFee + trade.TakerFee

	// Process margin/futures positions
	if trade.RealizedPNL != 0 {
		e.updatePositionFromTrade(trade)
	}

	// Notify callbacks
	if e.onTrade != nil {
		e.onTrade(trade)
	}
}

func (e *MatchingEngine) updateBalancesForTrade(trade *Trade) {
	market, ok := e.markets[trade.MarketSymbol]
	if !ok {
		return
	}

	// Ensure balance maps exist
	if _, ok := e.balances[trade.UserID]; !ok {
		e.balances[trade.UserID] = make(map[string]*UserBalance)
	}
	if _, ok := e.balances[trade.CounterUserID]; !ok {
		e.balances[trade.CounterUserID] = make(map[string]*UserBalance)
	}

	// Update taker (buyer)
	if trade.Side == OrderSideBuy {
		// Taker receives base asset
		e.addBalance(trade.UserID, market.BaseAsset, trade.Quantity)
		// Taker pays quote asset
		e.subtractBalance(trade.UserID, market.QuoteAsset, trade.QuoteQuantity+trade.TakerFee)
		// Maker receives quote asset
		e.addBalance(trade.CounterUserID, market.QuoteAsset, trade.QuoteQuantity-trade.MakerFee)
	} else {
		// Taker receives quote asset
		e.addBalance(trade.UserID, market.QuoteAsset, trade.QuoteQuantity-trade.TakerFee)
		// Taker pays base asset
		e.subtractBalance(trade.UserID, market.BaseAsset, trade.Quantity)
		// Maker receives base asset
		e.addBalance(trade.CounterUserID, market.BaseAsset, trade.Quantity)
	}
}

func (e *MatchingEngine) addBalance(userID, currency string, amount float64) {
	if _, ok := e.balances[userID][currency]; !ok {
		e.balances[userID][currency] = &UserBalance{
			UserID:   userID,
			Currency: currency,
		}
	}
	e.balances[userID][currency].Available += amount
	e.balances[userID][currency].Total += amount
}

func (e *MatchingEngine) subtractBalance(userID, currency string, amount float64) {
	if balance, ok := e.balances[userID][currency]; ok {
		balance.Available -= amount
		balance.Total -= amount
	}
}

func (e *MatchingEngine) lockFunds(userID, currency string, amount float64) {
	if balance, ok := e.balances[userID][currency]; ok {
		balance.Available -= amount
		balance.Locked += amount
	}
}

func (e *MatchingEngine) unlockFunds(userID, currency string, amount float64) {
	if balance, ok := e.balances[userID][currency]; ok {
		balance.Available += amount
		balance.Locked -= amount
	}
}

func (e *MatchingEngine) checkBalance(userID, currency string, required float64) bool {
	if balance, ok := e.balances[userID][currency]; ok {
		return balance.Available >= required
	}
	return false
}

// =============================================================================
// POSITION MANAGEMENT (Margin/Futures)
// =============================================================================

func (e *MatchingEngine) updatePositionFromTrade(trade *Trade) {
	posKey := fmt.Sprintf("%s:%s", trade.UserID, trade.MarketSymbol)
	
	if position, ok := e.positions[posKey]; ok {
		// Update existing position
		if position.Side == OrderSideBuy {
			// Long position
			if trade.Side == OrderSideSell {
				// Closing
				if trade.Quantity >= position.Size {
					position.RealizedPNL += trade.RealizedPNL
					position.Size = 0
				} else {
					position.Size -= trade.Quantity
					position.RealizedPNL += trade.RealizedPNL
				}
			} else {
				// Adding to position
				position.Size += trade.Quantity
			}
		} else {
			// Short position
			if trade.Side == OrderSideBuy {
				// Closing
				if trade.Quantity >= position.Size {
					position.RealizedPNL += trade.RealizedPNL
					position.Size = 0
				} else {
					position.Size -= trade.Quantity
					position.RealizedPNL += trade.RealizedPNL
				}
			} else {
				// Adding to position
				position.Size += trade.Quantity
			}
		}
		
		// Update margin ratio
		if position.Size > 0 {
			position.MarginRatio = position.Margin / (position.Size * position.MarkPrice)
		}

		if e.onPositionUpdate != nil {
			e.onPositionUpdate(position)
		}
	}
}

func (e *MatchingEngine) getPosition(userID, symbol string) *Position {
	posKey := fmt.Sprintf("%s:%s", userID, symbol)
	return e.positions[posKey]
}

func (e *MatchingEngine) getUserPositions(userID string) []*Position {
	var positions []*Position
	for key, pos := range e.positions {
		if key[:len(userID)] == userID && pos.Size > 0 {
			positions = append(positions, pos)
		}
	}
	return positions
}

// =============================================================================
// LIQUIDATION
// =============================================================================

func (e *MatchingEngine) processLiquidations() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for key, position := range e.positions {
		if position.Size == 0 {
			continue
		}

		// Calculate margin ratio
		marginRatio := position.Margin / (position.Size * position.MarkPrice)

		// Check for liquidation
		if marginRatio < e.config.LiquidationBuffer {
			// Trigger liquidation
			log.Printf("[WARN] Liquidation triggered for position: %s (margin ratio: %.4f)", key, marginRatio)
			
			// Create liquidation order
			liquidationOrder := &Order{
				OrderID:        e.generateOrderID(),
				UserID:         position.UserID,
				MarketSymbol:   position.MarketSymbol,
				Side:          oppositeSide(position.Side),
				Type:          OrderTypeMarket,
				Quantity:      position.Size,
				Price:         position.MarkPrice,
				Liquidation:   true,
				Status:        OrderStatusNew,
				CreatedAt:     time.Now().UnixMilli(),
			}

			// Execute liquidation
			trades, _ := e.executeMarketOrder(liquidationOrder)
			for _, trade := range trades {
				trade.Liquidation = true
				e.processTrade(trade)
			}
		}
	}
}

// =============================================================================
// ORDER EXPIRATION
// =============================================================================

func (e *MatchingEngine) processExpiredOrders() {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UnixMilli()

	for orderID, order := range e.stopOrders {
		if order.Status == OrderStatusPending {
			// Check if stop price is triggered
			ticker, ok := e.tickers[order.MarketSymbol]
			if !ok {
				continue
			}

			triggered := false
			switch order.Type {
			case OrderTypeStopLoss:
				if order.Side == OrderSideBuy && ticker.LastPrice <= order.StopPrice {
					triggered = true
				} else if order.Side == OrderSideSell && ticker.LastPrice >= order.StopPrice {
					triggered = true
				}
			case OrderTypeTakeProfit:
				if order.Side == OrderSideBuy && ticker.LastPrice >= order.StopPrice {
					triggered = true
				} else if order.Side == OrderSideSell && ticker.LastPrice <= order.StopPrice {
					triggered = true
				}
			}

			if triggered {
				order.Status = OrderStatusTriggered
				
				// Convert to market order
				marketOrder := &Order{
					OrderID:        e.generateOrderID(),
					UserID:         order.UserID,
					MarketSymbol:   order.MarketSymbol,
					Side:          order.Side,
					Type:          OrderTypeMarket,
					Quantity:      order.Quantity,
					RemainingQty:  order.Quantity,
					Status:        OrderStatusNew,
					CreatedAt:     now,
				}

				trades, _ := e.executeMarketOrder(marketOrder)
				for _, trade := range trades {
					e.processTrade(trade)
				}

				// Cancel linked OCO orders
				if order.LinkedOrderID != "" {
					if ocoOrders, ok := e.ocoOrders[order.OrderID]; ok {
						for _, linkedOrder := range ocoOrders {
							if linkedOrder.OrderID != orderID {
								linkedOrder.Status = OrderStatusCanceled
							}
						}
					}
				}

				delete(e.stopOrders, orderID)
			}
		}
	}

	// Check for expired GTT orders
	for orderID, order := range e.orders {
		if order.ExpiresAt > 0 && order.ExpiresAt <= now {
			if order.Status == OrderStatusNew || order.Status == OrderStatusPartiallyFilled {
				order.Status = OrderStatusExpired
				order.UpdatedAt = now

				// Unlock remaining funds
				market, _ := e.markets[order.MarketSymbol]
				if market != nil {
					remaining := order.RemainingQty * order.Price
					e.unlockFunds(order.UserID, market.QuoteAsset, remaining)
				}

				if e.onOrderUpdate != nil {
					e.onOrderUpdate(order)
				}
			}
		}
	}
}

// =============================================================================
// TICKER UPDATES
// =============================================================================

func (e *MatchingEngine) updateTickers() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for symbol, ticker := range e.tickers {
		ob, ok := e.orderBooks[symbol]
		if !ok {
			continue
		}

		// Update order book metrics
		if len(*ob.Bids) > 0 {
			ticker.BidPrice = (*ob.Bids)[0].Price
		}
		if len(*ob.Asks) > 0 {
			ticker.AskPrice = (*ob.Asks)[0].Price
		}

		// Calculate spread
		if ticker.BidPrice > 0 && ticker.AskPrice > 0 {
			ob.Spread = ticker.AskPrice - ticker.BidPrice
			ob.SpreadPercent = (ob.Spread / ticker.MidPrice) * 100
			ob.MidPrice = (ticker.BidPrice + ticker.AskPrice) / 2
			ob.BestBid = ticker.BidPrice
			ob.BestAsk = ticker.AskPrice
		}
	}
}

// =============================================================================
// TRAILING STOP
// =============================================================================

func (e *MatchingEngine) processTrailingStops() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for orderID, order := range e.stopOrders {
		if order.Type != OrderTypeTrailingStop {
			continue
		}

		ticker, ok := e.tickers[order.MarketSymbol]
		if !ok {
			continue
		}

		// Update trailing price
		if order.Side == OrderSideBuy {
			// For buy, trailing stop rises with price
			if ticker.LastPrice > order.TrailingCallback {
				order.TrailingCallback = ticker.LastPrice - order.TrailingDelta
			}
			
			// Check if triggered
			if ticker.LastPrice <= order.TrailingCallback {
				log.Printf("[INFO] Trailing stop triggered: %s", orderID)
				order.Status = OrderStatusTriggered
				
				// Convert to market order
				marketOrder := &Order{
					OrderID:        e.generateOrderID(),
					UserID:         order.UserID,
					MarketSymbol:   order.MarketSymbol,
					Side:          OrderSideSell,
					Type:          OrderTypeMarket,
					Quantity:      order.Quantity,
					RemainingQty:  order.Quantity,
					Status:        OrderStatusNew,
					CreatedAt:     time.Now().UnixMilli(),
				}

				trades, _ := e.executeMarketOrder(marketOrder)
				for _, trade := range trades {
					e.processTrade(trade)
				}

				delete(e.stopOrders, orderID)
			}
		} else {
			// For sell, trailing stop falls with price
			if ticker.LastPrice < order.TrailingCallback {
				order.TrailingCallback = ticker.LastPrice + order.TrailingDelta
			}
			
			// Check if triggered
			if ticker.LastPrice >= order.TrailingCallback {
				log.Printf("[INFO] Trailing stop triggered: %s", orderID)
				order.Status = OrderStatusTriggered
				
				// Convert to market order
				marketOrder := &Order{
					OrderID:        e.generateOrderID(),
					UserID:         order.UserID,
					MarketSymbol:   order.MarketSymbol,
					Side:          OrderSideBuy,
					Type:          OrderTypeMarket,
					Quantity:      order.Quantity,
					RemainingQty:  order.Quantity,
					Status:        OrderStatusNew,
					CreatedAt:     time.Now().UnixMilli(),
				}

				trades, _ := e.executeMarketOrder(marketOrder)
				for _, trade := range trades {
					e.processTrade(trade)
				}

				delete(e.stopOrders, orderID)
			}
		}
	}
}

// =============================================================================
// BALANCE MANAGEMENT
// =============================================================================

func (e *MatchingEngine) GetBalance(userID, currency string) *UserBalance {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if userBalances, ok := e.balances[userID]; ok {
		if balance, ok := userBalances[currency]; ok {
			return balance
		}
	}
	return nil
}

func (e *MatchingEngine) GetAllBalances(userID string) []*UserBalance {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var balances []*UserBalance
	if userBalances, ok := e.balances[userID]; ok {
		for _, balance := range userBalances {
			balances = append(balances, balance)
		}
	}
	return balances
}

func (e *MatchingEngine) Deposit(userID, currency string, amount float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if _, ok := e.balances[userID]; !ok {
		e.balances[userID] = make(map[string]*UserBalance)
	}

	if _, ok := e.balances[userID][currency]; !ok {
		e.balances[userID][currency] = &UserBalance{
			UserID:   userID,
			Currency: currency,
		}
	}

	e.balances[userID][currency].Available += amount
	e.balances[userID][currency].Total += amount

	log.Printf("[INFO] Deposit: %s %s %.8f", userID, currency, amount)
	return nil
}

func (e *MatchingEngine) Withdraw(userID, currency string, amount float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if balance, ok := e.balances[userID][currency]; ok {
		if balance.Available >= amount {
			balance.Available -= amount
			balance.Total -= amount
			
			log.Printf("[INFO] Withdraw: %s %s %.8f", userID, currency, amount)
			return nil
		}
	}
	return errors.New("insufficient balance")
}

// =============================================================================
// STATISTICS
// =============================================================================

func (e *MatchingEngine) updateLatencyStats(latencyUs int64) {
	e.stats.mu.Lock()
	defer e.stats.mu.Unlock()

	if e.stats.OrdersProcessed == 0 {
		e.stats.AvgLatencyUs = latencyUs
	} else {
		e.stats.AvgLatencyUs = (e.stats.AvgLatencyUs*(e.stats.OrdersProcessed-1) + latencyUs) / e.stats.OrdersProcessed
	}

	if latencyUs > e.stats.MaxLatencyUs {
		e.stats.MaxLatencyUs = latencyUs
	}
	if e.stats.MinLatencyUs == 0 || latencyUs < e.stats.MinLatencyUs {
		e.stats.MinLatencyUs = latencyUs
	}
}

func (e *MatchingEngine) GetStats() EngineStats {
	return EngineStats{
		OrdersProcessed:  atomic.LoadInt64(&e.stats.OrdersProcessed),
		TradesExecuted:   atomic.LoadInt64(&e.stats.TradesExecuted),
		TotalVolume:      e.stats.TotalVolume,
		TotalFees:       e.stats.TotalFees,
		AvgLatencyUs:    atomic.LoadInt64(&e.stats.AvgLatencyUs),
		MaxLatencyUs:    atomic.LoadInt64(&e.stats.MaxLatencyUs),
		MinLatencyUs:    atomic.LoadInt64(&e.stats.MinLatencyUs),
		RejectedOrders:  atomic.LoadInt64(&e.stats.RejectedOrders),
		CanceledOrders:  atomic.LoadInt64(&e.stats.CanceledOrders),
	}
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

func (e *MatchingEngine) generateOrderID() string {
	uuid := uuid.New().String()
	hash := sha256.Sum256([]byte(uuid + time.Now().String()))
	return fmt.Sprintf("ORD%s", hex.EncodeToString(hash[:8]))
}

func (e *MatchingEngine) generateTradeID() string {
	uuid := uuid.New().String()
	hash := sha256.Sum256([]byte(uuid + time.Now().String()))
	return fmt.Sprintf("TRD%s", hex.EncodeToString(hash[:8]))
}

func oppositeSide(side OrderSide) OrderSide {
	if side == OrderSideBuy {
		return OrderSideSell
	}
	return OrderSideBuy
}

// =============================================================================
// PLACE ORDER REQUEST
// =============================================================================

type PlaceOrderRequest struct {
	UserID          string
	MarketSymbol    string
	Side            OrderSide
	Type            OrderType
	Price           float64
	StopPrice       float64
	Quantity        float64
	IcebergQty      float64
	TrailingDelta   float64
	TrailingCallback float64
	TimeInForce     TimeInForce
	ExpiresAt       int64
	IsPostOnly      bool
	IsReduceOnly    bool
	SelfTradePrevention string
	Leverage        float64
	PositionMode    string
	ClientOrderID   string
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

func (e *MatchingEngine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/health":
		fmt.Fprint(w, `{"status":"ok","engine":"v3.0"}`)
	case "/stats":
		stats := e.GetStats()
		json.NewEncoder(w).Encode(stats)
	case "/markets":
		markets := e.GetAllMarkets()
		json.NewEncoder(w).Encode(markets)
	case "/tickers":
		tickers := e.GetAllTickers()
		json.NewEncoder(w).Encode(tickers)
	default:
		http.NotFound(w, r)
	}
}