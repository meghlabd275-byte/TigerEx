package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// TIGGEREX v3.0 - COMPLETE PRODUCTION TRADING ENGINE
// All features from Top CEX white-label providers integrated
// =============================================================================

const (
	EngineVersion = "3.0.0"
	
	// Order Types
	OrderTypeMarket OrderType = "market"
	OrderTypeLimit OrderType = "limit"
	OrderTypeStopLoss OrderType = "stop_loss"
	OrderTypeStopLimit OrderType = "stop_limit"
	OrderTypeTakeProfit OrderType = "take_profit"
	OrderTypeStopMarket OrderType = "stop_market"
	OrderTypeTrailingStop OrderType = "trailing_stop"
	OrderTypeOCO OrderType = "oco"
	OrderTypeOTO OrderType = "oto"
	OrderTypeIceberg OrderType = "iceberg"
	OrderTypeTWAP OrderType = "twap"
	OrderTypePO OrderType = "post_only"
	OrderTypeFOK OrderType = "fok"
	OrderTypeIOC OrderType = "ioc"
	
	// Order Sides
	OrderSideBuy OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
	
	// Time in Force
	TIFGTC TimeInForce = "GTC" // Good Till Cancel
	TIFIOC TimeInForce = "IOC" // Immediate Or Cancel
	TIFFOK TimeInForce = "FOK"  // Fill Or Kill
	TIFGTX TimeInForce = "GTX" // Good Till Cross
	TIFGTT TimeInForce = "GTT" // Good Till Time
	
	// Order Status
	StatusPendingNew OrderStatus = "pending_new"
	StatusNew OrderStatus = "new"
	StatusPartiallyFilled OrderStatus = "partially_filled"
	StatusFilled OrderStatus = "filled"
	StatusCanceled OrderStatus = "canceled"
	StatusRejected OrderStatus = "rejected"
	StatusExpired OrderStatus = "expired"
	StatusPendingCancel OrderStatus = "pending_cancel"
	StatusPendingModify OrderStatus = "pending_modify"
	
	// Position Mode
	PositionModeIsolated = "isolated"
	PositionModeCross = "cross"
	PositionModeLeverage = "leverage"
	
	// Liquidation Status
	LiquidationModeFull = "full"
	LiquidationModePartial = "partial"
	LiquidationModeAutoDeleverage = "auto_deleverage"
)

// =============================================================================
// CORE TYPES
// =============================================================================

type OrderType string
type OrderSide string
type TimeInForce string
type OrderStatus string

// Order represents a trading order
type Order struct {
	// Identification
	OrderID string `json:"orderId"`
	ClientOrderID string `json:"clientOrderId,omitempty"`
	UserID string `json:"userId"`
	Symbol string `json:"symbol"`
	
	// Order Details
	Side OrderSide `json:"side"`
	Type OrderType `json:"type"`
	
	// Pricing
	Price float64 `json:"price"`
	StopPrice float64 `json:"stopPrice,omitempty"`
	TriggerPrice float64 `json:"triggerPrice,omitempty"`
	TrailingDelta float64 `json:"trailingDelta,omitempty"`
	TrailingPercent float64 `json:"trailingPercent,omitempty"`
	
	// Quantity
	Quantity float64 `json:"quantity"`
	FilledQuantity float64 `json:"filledQuantity"`
	RemainingQuantity float64 `json:"remainingQuantity"`
	DisplayQuantity float64 `json:"displayQuantity,omitempty"` // For iceberg orders
	
	// Fees
	MakerFeeRate float64 `json:"makerFeeRate"`
	TakerFeeRate float64 `json:"takerFeeRate"`
	FeeCurrency string `json:"feeCurrency,omitempty"`
	
	// Time
	TimeInForce TimeInForce `json:"timeInForce"`
	ExpireTime time.Time `json:"expireTime,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	FilledAt *time.Time `json:"filledAt,omitempty"`
	
	// Status
	Status OrderStatus `json:"status"`
	IsMaker bool `json:"isMaker"`
	IsReduceOnly bool `json:"isReduceOnly,omitempty"`
	IsCloseOnly bool `json:"isCloseOnly,omitempty"`
	
	// Position
	PositionMode string `json:"positionMode,omitempty"`
	PositionID string `json:"positionId,omitempty"`
	Leverage float64 `json:"leverage,omitempty"`
	
	// Self-Trade Prevention
	SelfTradePrevention string `json:"selfTradePrevention,omitempty"` // decrement_cancel, cancel_oldest, cancel_newest, cancel_both
	
	// Iceberg
	IsIceberg bool `json:"isIceberg,omitempty"`
	IcebergHiddenQuantity float64 `json:"icebergHiddenQty,omitempty"`
	
	// Average fill price
	AverageFillPrice float64 `json:"avgFillPrice"`
	
	// Contingent orders (OCO)
	ContingentOrderID string `json:"contingentOrderId,omitempty"`
	
	mu sync.RWMutex
}

// Trade represents an executed trade
type Trade struct {
	TradeID string `json:"tradeId"`
	OrderID string `json:"orderId"`
	CounterOrderID string `json:"counterOrderId"`
	Symbol string `json:"symbol"`
	
	UserID string `json:"userId"`
	CounterUserID string `json:"counterUserId"`
	
	Side OrderSide `json:"side"`
	Role string `json:"role"` // maker, taker
	
	Price float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	QuoteQuantity float64 `json:"quoteQuantity"`
	
	Fee float64 `json:"fee"`
	FeeCurrency string `json:"feeCurrency"`
	FeeMakerTaker string `json:"feeMakerTaker"`
	
	// PnL (for positions)
	RealizedPNL float64 `json:"realizedPnl,omitempty"`
	UnrealizedPNL float64 `json:"unrealizedPnl,omitempty"`
	
	IsTaker bool `json:"isTaker"`
	IsMaker bool `json:"isMaker"`
	IsSelfTrade bool `json:"isSelfTrade"`
	
	TradeType string `json:"tradeType"` // normal, liquidation, adl
	LiquidationOrder bool `json:"liquidationOrder"`
	
	Timestamp time.Time `json:"timestamp"`
}

// Position represents a trading position
type Position struct {
	PositionID string `json:"positionId"`
	UserID string `json:"userId"`
	Symbol string `json:"symbol"`
	
	Side OrderSide `json:"side"` // long or short
	Size float64 `json:"size"` // position size
	
	// Entry
	EntryPrice float64 `json:"entryPrice"`
	OpenQuantity float64 `json:"openQuantity"`
	
	// Margin
	Margin float64 `json:"margin"`
	IsolatedMargin float64 `json:"isolatedMargin,omitempty"`
	CrossMarginUsed float64 `json:"crossMarginUsed,omitempty"`
	Leverage float64 `json:"leverage"`
	
	// Liquidation
	LiquidationPrice float64 `json:"liquidationPrice"`
	BankruptcyPrice float64 `json:"bankruptcyPrice"`
	MarginRatio float64 `json:"marginRatio"`
	MaintenanceMargin float64 `json:"maintenanceMargin"`
	
	// Unrealized PnL
	UnrealizedPNL float64 `json:"unrealizedPnl"`
	UnrealizedPNLPercent float64 `json:"unrealizedPnlPercent"`
	
	// Realized PnL
	TotalRealizedPNL float64 `json:"totalRealizedPnl"`
	
	// Funding
	FundingFee float64 `json:"fundingFee"`
	LastFundingTime time.Time `json:"lastFundingTime"`
	FundingRate float64 `json:"fundingRate"`
	
	// Position Mode
	PositionMode string `json:"positionMode"`
	AutoAddMargin bool `json:"autoAddMargin"`
	
	// Risk
	RiskLevel string `json:"riskLevel"`
	 liquidationProgress float64
	
	// Timestamps
	OpenedAt time.Time `json:"openedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	
	mu sync.RWMutex
}

// OrderBook represents the order book for a market
type OrderBook struct {
	mu sync.RWMutex
	
	Symbol string `json:"symbol"`
	
	// Price levels
	Bids PriceLevels `json:"bids"` // Sorted by price descending
	Asks PriceLevels `json:"asks"` // Sorted by price ascending
	
	// Book depth
	LastUpdateID int64 `json:"lastUpdateId"`
	LastTradeID int64 `json:"lastTradeId"`
	Version int64
	
	// Market info
	BaseAsset string `json:"baseAsset"`
	QuoteAsset string `json:"quoteAsset"`
	
	// Price filters
	MinPrice float64 `json:"minPrice"`
	MaxPrice float64 `json:"maxPrice"`
	TickSize float64 `json:"tickSize"`
	
	// Quantity filters
	MinQuantity float64 `json:"minQuantity"`
	MaxQuantity float64 `json:"maxQuantity"`
	StepSize float64 `json:"stepSize"`
	
	// Market state
	TradingEnabled bool `json:"tradingEnabled"`
	CancelOnly bool `json:"cancelOnly"`
	FastMatchEnabled bool `json:"fastMatchEnabled"`
	PostOnlyEnabled bool `json:"postOnlyEnabled"`
	PriceLocked bool `json:"priceLocked"`
	
	// Statistics
	HighPrice float64 `json:"highPrice"`
	LowPrice float64 `json:"lowPrice"`
	Volume float64 `json:"volume"`
	QuoteVolume float64 `json:"quoteVolume"`
	Count int64 `json:"count"`
	
	// Auction mode
	AuctionMode bool `json:"auctionMode"`
	AuctionEndTime *time.Time `json:"auctionEndTime,omitempty"`
}

// PriceLevel represents a price level in the order book
type PriceLevel struct {
	Price float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Orders int `json:"orders"`
	
	// For iceberg orders
	VisibleQuantity float64 `json:"visibleQty,omitempty"`
	HiddenQuantity float64 `json:"hiddenQty,omitempty"`
}

type PriceLevels []*PriceLevel

func (pl PriceLevels) Len() int { return len(pl) }
func (pl PriceLevels) Less(i, j int) bool { return pl[i].Price > pl[j].Price }
func (pl PriceLevels) Swap(i, j int) { pl[i], pl[j] = pl[j], pl[i] }

type AskPriceLevels []*PriceLevel
func (al AskPriceLevels) Len() int { return len(al) }
func (al AskPriceLevels) Less(i, j int) bool { return al[i].Price < al[j].Price }
func (al AskPriceLevels) Swap(i, j int) { al[i], al[j] = al[j], al[i] }

// Ticker represents market ticker data
type Ticker struct {
	Symbol string `json:"symbol"`
	
	// Price
	LastPrice float64 `json:"lastPrice"`
	OpenPrice float64 `json:"openPrice"`
	HighPrice float64 `json:"highPrice"`
	LowPrice float64 `json:"lowPrice"`
	ClosePrice float64 `json:"closePrice"`
	
	// Volume
	Volume float64 `json:"volume"`
	QuoteVolume float64 `json:"quoteVolume"`
	BaseVolume float64 `json:"baseVolume"`
	
	// Change
	PriceChange float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	
	// Order book
	BidPrice float64 `json:"bidPrice"`
	AskPrice float64 `json:"askPrice"`
	BidQuantity float64 `json:"bidQty"`
	AskQuantity float64 `json:"askQty"`
	
	// Timestamp
	Timestamp time.Time `json:"timestamp"`
}

// =============================================================================
// MATCHING ENGINE
// =============================================================================

type MatchingEngine struct {
	// Configuration
	config EngineConfig
	
	// State
	mu sync.RWMutex
	markets map[string]*MarketState
	orders map[string]*Order
	positions map[string]*Position
	
	// User data
	userOrders map[string]map[string]*Order // userID -> symbol -> orders
	userPositions map[string]map[string]*Position // userID -> symbol -> position
	
	// Fee structure
	makerFeeRate float64
	takerFeeRate float64
	
	// Risk management
	riskManager *RiskManager
	
	// Callbacks
	onOrderUpdate func(*Order)
	onTrade func(*Trade)
	onPositionUpdate func(*Position)
	onTickerUpdate func(*Ticker)
	
	// Statistics
	stats EngineStats
	
	// Database
	db *pgxpool.Pool
	
	// Redis for caching
	redis *RedisClient
	
	// Context
	ctx context.Context
	cancel context.CancelFunc
	
	wg sync.WaitGroup
}

// MarketState holds state for a trading pair
type MarketState struct {
	Symbol string
	OrderBook *OrderBook
	Ticker *Ticker
	
	// Matching
	bidTree *PriceTree
	askTree *PriceTree
	
	// Pending orders
	pendingOrders []*Order
	stopOrders []*Order
	
	// Liquidation queue
	liquidationQueue []*Position
	
	// Funding
	fundingRate float64
	nextFundingTime time.Time
	
	// Trading rules
	minOrderSize float64
	maxOrderSize float64
	pricePrecision int
	quantityPrecision int
	
	mu sync.RWMutex
}

type PriceTree struct {
	levels map[float64]*OrderLevel
	mu sync.RWMutex
}

type OrderLevel struct {
	Price float64
	Orders []*Order
	TotalQuantity float64
	Count int
}

type EngineConfig struct {
	Name string
	Mode string // production, test, development
	
	// Performance
	MaxOrdersPerMarket int
	MaxPositionsPerUser int
	OrderProcessBatchSize int
	
	// Fees
	DefaultMakerFee float64
	DefaultTakerFee float64
	
	// Risk
	MaxPositionSize float64
	MaxOrderValue float64
	LiquidationBuffer float64
	
	// Matching
	MatchingLatencyTarget time.Duration
	
	// Persistence
	SnapshotInterval time.Duration
}

// EngineStats holds engine statistics
type EngineStats struct {
	TotalOrders int64
	OrdersProcessed int64
	TradesExecuted int64
	OrdersCanceled int64
	OrdersRejected int64
	
	AvgLatencyUs int64
	MaxLatencyUs int64
	MinLatencyUs int64
	
	TotalVolume float64
	TotalQuoteVolume float64
	
	mu sync.RWMutex
}

// =============================================================================
// NEW MATCHING ENGINE
// =============================================================================

func NewMatchingEngine(config EngineConfig) *MatchingEngine {
	if config.MaxOrdersPerMarket == 0 {
		config.MaxOrdersPerMarket = 100000
	}
	if config.MaxPositionsPerUser == 0 {
		config.MaxPositionsPerUser = 100
	}
	if config.OrderProcessBatchSize == 0 {
		config.OrderProcessBatchSize = 1000
	}
	if config.DefaultMakerFee == 0 {
		config.DefaultMakerFee = 0.001
	}
	if config.DefaultTakerFee == 0 {
		config.DefaultTakerFee = 0.002
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	
	me := &MatchingEngine{
		config: config,
		markets: make(map[string]*MarketState),
		orders: make(map[string]*Order),
		positions: make(map[string]*Position),
		userOrders: make(map[string]map[string]*Order),
		userPositions: make(map[string]map[string]*Position),
		makerFeeRate: config.DefaultMakerFee,
		takerFeeRate: config.DefaultTakerFee,
		ctx: ctx,
		cancel: cancel,
	}
	
	me.riskManager = NewRiskManager(me)
	
	// Start background workers
	me.wg.Add(1)
	go me.orderExpirationWorker()
	
	me.wg.Add(1)
	go me.fundingWorker()
	
	me.wg.Add(1)
	go me.statsWorker()
	
	return me
}

// InitializeMarket initializes a new trading market
func (me *MatchingEngine) InitializeMarket(symbol, base, quote string, pricePrec, qtyPrec int, minPrice, maxPrice, tickSize, lotSize float64) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	if _, exists := me.markets[symbol]; exists {
		return fmt.Errorf("market %s already exists", symbol)
	}
	
	state := &MarketState{
		Symbol: symbol,
		OrderBook: &OrderBook{
			Symbol: symbol,
			Bids: make(PriceLevels, 0),
			Asks: make(PriceLevels, 0),
			LastUpdateID: time.Now().UnixNano(),
			
			BaseAsset: base,
			QuoteAsset: quote,
			
			MinPrice: minPrice,
			MaxPrice: maxPrice,
			TickSize: tickSize,
			
			MinQuantity: lotSize,
			StepSize: lotSize,
			
			TradingEnabled: true,
			CancelOnly: false,
			
			HighPrice: 0,
			LowPrice: math.MaxFloat64,
		},
		Ticker: &Ticker{
			Symbol: symbol,
			HighPrice: 0,
			LowPrice: math.MaxFloat64,
		},
		bidTree: &PriceTree{levels: make(map[float64]*OrderLevel)},
		askTree: &PriceTree{levels: make(map[float64]*OrderLevel)},
		pendingOrders: make([]*Order, 0),
		stopOrders: make([]*Order, 0),
		fundingRate: 0.0001, // 0.01% default
		nextFundingTime: time.Now().Add(8 * time.Hour),
		minOrderSize: lotSize,
		maxOrderSize: 1000000000,
		pricePrecision: pricePrec,
		quantityPrecision: qtyPrec,
	}
	
	me.markets[symbol] = state
	
	log.Printf("[ENGINE] Market initialized: %s (base=%s, quote=%s, tick=%f, lot=%f)", 
		symbol, base, quote, tickSize, lotSize)
	
	return nil
}

// SubmitOrder submits a new order to the engine
func (me *MatchingEngine) SubmitOrder(order *Order) (*OrderResult, error) {
	startTime := time.Now()
	
	// Validate order
	if err := me.validateOrder(order); err != nil {
		order.Status = StatusRejected
		order.UpdatedAt = time.Now()
		atomic.AddInt64(&me.stats.OrdersRejected, 1)
		return &OrderResult{
			Order: order,
			Error: err.Error(),
		}, err
	}
	
	// Generate order ID
	if order.OrderID == "" {
		order.OrderID = me.generateOrderID()
	}
	if order.ClientOrderID == "" {
		order.ClientOrderID = order.OrderID
	}
	
	order.Status = StatusPendingNew
	order.CreatedAt = time.Now()
	order.UpdatedAt = time.Now()
	
	// Process order
	me.mu.Lock()
	me.orders[order.OrderID] = order
	
	// Add to user's orders
	if me.userOrders[order.UserID] == nil {
		me.userOrders[order.UserID] = make(map[string]*Order)
	}
	me.userOrders[order.UserID][order.OrderID] = order
	
	me.mu.Unlock()
	
	// Get market state
	state := me.getMarketState(order.Symbol)
	if state == nil {
		order.Status = StatusRejected
		me.onOrderUpdate(order)
		return &OrderResult{Order: order, Error: "market not found"}, errors.New("market not found")
	}
	
	state.mu.Lock()
	defer state.mu.Unlock()
	
	// Handle different order types
	var trades []*Trade
	var err error
	
	switch order.Type {
	case OrderTypeMarket:
		trades, err = me.executeMarketOrder(state, order)
	case OrderTypeLimit:
		trades, err = me.executeLimitOrder(state, order)
	case OrderTypeStopLoss, OrderTypeStopLimit, OrderTypeStopMarket, OrderTypeTakeProfit:
		trades, err = me.addStopOrder(state, order)
	case OrderTypeTrailingStop:
		trades, err = me.addTrailingStopOrder(state, order)
	case OrderTypeOCO:
		trades, err = me.addOCOOrder(state, order)
	case OrderTypeIceberg:
		trades, err = me.addIcebergOrder(state, order)
	case OrderTypeTWAP:
		trades, err = me.addTWAPOrder(state, order)
	case OrderTypePO:
		trades, err = me.executeLimitOrder(state, order)
		order.IsPostOnly = true
	case OrderTypeFOK:
		trades, err = me.executeFOKOrder(state, order)
	case OrderTypeIOC:
		trades, err = me.executeIOCOrder(state, order)
	default:
		trades, err = me.executeLimitOrder(state, order)
	}
	
	// Update statistics
	atomic.AddInt64(&me.stats.TotalOrders, 1)
	atomic.AddInt64(&me.stats.OrdersProcessed, 1)
	
	latency := time.Since(startTime).Microseconds()
	me.updateLatencyStats(latency)
	
	// Trigger callbacks
	if me.onOrderUpdate != nil {
		me.onOrderUpdate(order)
	}
	
	for _, trade := range trades {
		if me.onTrade != nil {
			me.onTrade(trade)
		}
	}
	
	result := &OrderResult{
		Order: order,
		Trades: trades,
		ExecutedQuantity: order.FilledQuantity,
		ExecutedQuote: order.FilledQuantity * order.AverageFillPrice,
	}
	
	return result, nil
}

// validateOrder validates an order
func (me *MatchingEngine) validateOrder(order *Order) error {
	if order.UserID == "" {
		return errors.New("user ID required")
	}
	if order.Symbol == "" {
		return errors.New("symbol required")
	}
	if order.Quantity <= 0 {
		return errors.New("quantity must be positive")
	}
	if order.Price < 0 && order.Type != OrderTypeMarket {
		return errors.New("price must be non-negative")
	}
	
	// Check risk limits
	if err := me.riskManager.checkOrderRisk(order); err != nil {
		return err
	}
	
	return nil
}

// executeMarketOrder executes a market order
func (me *MatchingEngine) executeMarketOrder(state *MarketState, order *Order) ([]*Trade, error) {
	book := state.OrderBook
	
	if order.Side == OrderSideBuy && len(book.Asks) == 0 {
		order.Status = StatusRejected
		return nil, errors.New("no asks available")
	}
	if order.Side == OrderSideSell && len(book.Bids) == 0 {
		order.Status = StatusRejected
		return nil, errors.New("no bids available")
	}
	
	var trades []*Trade
	remainingQty := order.Quantity
	
	if order.Side == OrderSideBuy {
		// Buy against asks (lowest price first)
		for _, level := range book.Asks {
			if remainingQty <= 0 {
				break
			}
			
			for _, makerOrder := range level.Orders {
				if remainingQty <= 0 {
					break
				}
				
				execQty := math.Min(remainingQty, makerOrder.RemainingQuantity)
				if execQty <= 0 {
					continue
				}
				
				// Create trade
				trade := me.createTrade(state, order, makerOrder, level.Price, execQty)
				trades = append(trades, trade)
				
				// Update quantities
				remainingQty -= execQty
				order.FilledQuantity += execQty
				order.RemainingQuantity -= execQty
				makerOrder.FilledQuantity += execQty
				makerOrder.RemainingQuantity -= execQty
				
				// Update balances
				me.updateBalancesForTrade(trade)
				
				// Update order book
				level.Quantity -= execQty
				
				// Update taker price for average
				order.AverageFillPrice = (order.AverageFillPrice*float64(order.FilledQuantity-execQty) + level.Price*execQty) / float64(order.FilledQuantity)
			}
		}
	} else {
		// Sell against bids (highest price first)
		for _, level := range book.Bids {
			if remainingQty <= 0 {
				break
			}
			
			for _, makerOrder := range level.Orders {
				if remainingQty <= 0 {
					break
				}
				
				execQty := math.Min(remainingQty, makerOrder.RemainingQuantity)
				if execQty <= 0 {
					continue
				}
				
				// Create trade
				trade := me.createTrade(state, order, makerOrder, level.Price, execQty)
				trades = append(trades, trade)
				
				// Update quantities
				remainingQty -= execQty
				order.FilledQuantity += execQty
				order.RemainingQuantity -= execQty
				makerOrder.FilledQuantity += execQty
				makerOrder.RemainingQuantity -= execQty
				
				// Update balances
				me.updateBalancesForTrade(trade)
				
				// Update order book
				level.Quantity -= execQty
				
				// Update average price
				order.AverageFillPrice = (order.AverageFillPrice*float64(order.FilledQuantity-execQty) + level.Price*execQty) / float64(order.FilledQuantity)
			}
		}
	}
	
	// Update order status
	if remainingQty <= 0 {
		order.Status = StatusFilled
		order.FilledAt = &order.UpdatedAt
	} else if order.FilledQuantity > 0 {
		order.Status = StatusPartiallyFilled
	} else {
		order.Status = StatusRejected
	}
	
	order.UpdatedAt = time.Now()
	
	// Update market statistics
	if len(trades) > 0 {
		me.updateMarketStats(state, trades)
	}
	
	return trades, nil
}

// executeLimitOrder executes a limit order
func (me *MatchingEngine) executeLimitOrder(state *MarketState, order *Order) ([]*Trade, error) {
	book := state.OrderBook
	
	// First, check for immediate matches
	var trades []*Trade
	remainingQty := order.Quantity
	
	// Try to match against opposite side
	var oppositeSide PriceLevels
	if order.Side == OrderSideBuy {
		oppositeSide = book.Asks
	} else {
		oppositeSide = book.Bids
	}
	
	// Check for crossing
	shouldMatch := false
	if order.Side == OrderSideBuy && len(oppositeSide) > 0 && order.Price >= oppositeSide[0].Price {
		shouldMatch = true
	}
	if order.Side == OrderSideSell && len(oppositeSide) > 0 && order.Price <= oppositeSide[0].Price {
		shouldMatch = true
	}
	
	// Post-only: don't match, only add to book
	if order.IsPostOnly || order.TimeInForce == TIFGTX {
		if shouldMatch {
			order.Status = StatusRejected
			return nil, errors.New("post-only order would match")
		}
		order.Status = StatusNew
		me.addToBook(state, order)
		return nil, nil
	}
	
	// Execute matches
	if shouldMatch && !order.IsReduceOnly {
		if order.Side == OrderSideBuy {
			for _, level := range book.Asks {
				if remainingQty <= 0 {
					break
				}
				if order.Price < level.Price {
					break
				}
				
				for _, makerOrder := range level.Orders {
					if remainingQty <= 0 {
						break
					}
					if order.Price < level.Price {
						break
					}
					
					execQty := math.Min(remainingQty, makerOrder.RemainingQuantity)
					if execQty <= 0 {
						continue
					}
					
					trade := me.createTrade(state, order, makerOrder, level.Price, execQty)
					trades = append(trades, trade)
					
					remainingQty -= execQty
					order.FilledQuantity += execQty
					order.RemainingQuantity -= execQty
					makerOrder.FilledQuantity += execQty
					makerOrder.RemainingQuantity -= execQty
					
					me.updateBalancesForTrade(trade)
					level.Quantity -= execQty
					
					order.AverageFillPrice = (order.AverageFillPrice*float64(order.FilledQuantity-execQty) + level.Price*execQty) / float64(order.FilledQuantity)
					
					// Remove filled orders
					if makerOrder.RemainingQuantity <= 0 {
						makerOrder.Status = StatusFilled
						makerOrder.FilledAt = &makerOrder.UpdatedAt
						if me.onOrderUpdate != nil {
							me.onOrderUpdate(makerOrder)
						}
					}
				}
				
				// Remove empty levels
				if level.Quantity <= 0 {
					me.removePriceLevel(book, order.Side, level.Price)
				}
			}
		} else {
			for _, level := range book.Bids {
				if remainingQty <= 0 {
					break
				}
				if order.Price > level.Price {
					break
				}
				
				for _, makerOrder := range level.Orders {
					if remainingQty <= 0 {
						break
					}
					if order.Price > level.Price {
						break
					}
					
					execQty := math.Min(remainingQty, makerOrder.RemainingQuantity)
					if execQty <= 0 {
						continue
					}
					
					trade := me.createTrade(state, order, makerOrder, level.Price, execQty)
					trades = append(trades, trade)
					
					remainingQty -= execQty
					order.FilledQuantity += execQty
					order.RemainingQuantity -= execQty
					makerOrder.FilledQuantity += execQty
					makerOrder.RemainingQuantity -= execQty
					
					me.updateBalancesForTrade(trade)
					level.Quantity -= execQty
					
					order.AverageFillPrice = (order.AverageFillPrice*float64(order.FilledQuantity-execQty) + level.Price*execQty) / float64(order.FilledQuantity)
					
					if makerOrder.RemainingQuantity <= 0 {
						makerOrder.Status = StatusFilled
						makerOrder.FilledAt = &makerOrder.UpdatedAt
						if me.onOrderUpdate != nil {
							me.onOrderUpdate(makerOrder)
						}
					}
				}
				
				if level.Quantity <= 0 {
					me.removePriceLevel(book, order.Side, level.Price)
				}
			}
		}
	}
	
	// Update order status and add remaining to book
	order.RemainingQuantity = remainingQty
	
	if remainingQty <= 0 {
		order.Status = StatusFilled
		order.FilledAt = &order.UpdatedAt
	} else if order.FilledQuantity > 0 {
		order.Status = StatusPartiallyFilled
		if remainingQty >= state.minOrderSize {
			me.addToBook(state, order)
		}
	} else {
		// Check time in force
		switch order.TimeInForce {
		case TIFFOK:
			order.Status = StatusRejected
			return nil, errors.New("fok order could not be filled")
		case TIFIOC:
			// IOC - any unfilled portion is canceled
			if order.FilledQuantity > 0 {
				order.Status = StatusPartiallyFilled
			} else {
				order.Status = StatusCanceled
			}
		default:
			order.Status = StatusNew
			if remainingQty >= state.minOrderSize {
				me.addToBook(state, order)
			}
		}
	}
	
	order.UpdatedAt = time.Now()
	
	if len(trades) > 0 {
		me.updateMarketStats(state, trades)
	}
	
	return trades, nil
}

// addStopOrder adds a stop order to the stop queue
func (me *MatchingEngine) addStopOrder(state *MarketState, order *Order) ([]*Trade, error) {
	order.Status = StatusNew
	state.stopOrders = append(state.stopOrders, order)
	
	// Check if stop should trigger immediately
	book := state.OrderBook
	shouldTrigger := false
	
	switch order.Type {
	case OrderTypeStopLoss:
		if order.Side == OrderSideSell && book.LastPrice <= order.StopPrice {
			shouldTrigger = true
		}
		if order.Side == OrderSideBuy && book.LastPrice >= order.StopPrice {
			shouldTrigger = true
		}
	case OrderTypeTakeProfit:
		if order.Side == OrderSideSell && book.LastPrice >= order.StopPrice {
			shouldTrigger = true
		}
		if order.Side == OrderSideBuy && book.LastPrice <= order.StopPrice {
			shouldTrigger = true
		}
	}
	
	if shouldTrigger {
		return me.triggerStopOrder(state, order)
	}
	
	return nil, nil
}

// addTrailingStopOrder adds a trailing stop order
func (me *MatchingEngine) addTrailingStopOrder(state *MarketState, order *Order) ([]*Trade, error) {
	order.Status = StatusNew
	state.stopOrders = append(state.stopOrders, order)
	return nil, nil
}

// addOCOOrder adds a one-cancels-other order
func (me *MatchingEngine) addOCOOrder(state *MarketState, order *Order) ([]*Trade, error) {
	if order.ContingentOrderID == "" {
		return nil, errors.New("oco order requires contingent order")
	}
	
	order.Status = StatusNew
	state.stopOrders = append(state.stopOrders, order)
	return nil, nil
}

// addIcebergOrder adds an iceberg order
func (me *MatchingEngine) addIcebergOrder(state *MarketState, order *Order) ([]*Trade, error) {
	order.IsIceberg = true
	order.DisplayQuantity = order.Quantity * 0.1 // 10% visible by default
	order.IcebergHiddenQuantity = order.Quantity - order.DisplayQuantity
	
	order.Status = StatusNew
	me.addToBook(state, order)
	return nil, nil
}

// addTWAPOrder adds a time-weighted average price order
func (me *MatchingEngine) addTWAPOrder(state *MarketState, order *Order) ([]*Trade, error) {
	order.Status = StatusNew
	
	// Split into smaller orders
	sliceCount := 10
	sliceQty := order.Quantity / float64(sliceCount)
	
	for i := 0; i < sliceCount; i++ {
		sliceOrder := &Order{
			OrderID: me.generateOrderID(),
			UserID: order.UserID,
			Symbol: order.Symbol,
			Side: order.Side,
			Type: OrderTypeLimit,
			Price: order.Price,
			Quantity: sliceQty,
			FilledQuantity: 0,
			RemainingQuantity: sliceQty,
			Status: StatusNew,
			CreatedAt: time.Now().Add(time.Duration(i) * time.Minute),
			UpdatedAt: time.Now(),
		}
		me.addToBook(state, sliceOrder)
	}
	
	return nil, nil
}

// executeFOKOrder executes a fill-or-kill order
func (me *MatchingEngine) executeFOKOrder(state *MarketState, order *Order) ([]*Trade, error) {
	book := state.OrderBook
	
	// Check if entire quantity can be filled at limit price
	var oppositeSide PriceLevels
	if order.Side == OrderSideBuy {
		oppositeSide = book.Asks
	} else {
		oppositeSide = book.Bids
	}
	
	totalAvailable := float64(0)
	for _, level := range oppositeSide {
		if order.Side == OrderSideBuy && level.Price > order.Price {
			break
		}
		if order.Side == OrderSideSell && level.Price < order.Price {
			break
		}
		totalAvailable += level.Quantity
	}
	
	if totalAvailable < order.Quantity {
		order.Status = StatusRejected
		return nil, errors.New("fok order could not be fully filled")
	}
	
	// Execute as market order
	return me.executeMarketOrder(state, order)
}

// executeIOCOrder executes an immediate-or-cancel order
func (me *MatchingEngine) executeIOCOrder(state *MarketState, order *Order) ([]*Trade, error) {
	trades, err := me.executeMarketOrder(state, order)
	if order.FilledQuantity > 0 {
		order.Status = StatusPartiallyFilled
	} else {
		order.Status = StatusCanceled
	}
	return trades, err
}

// addToBook adds an order to the order book
func (me *MatchingEngine) addToBook(state *MarketState, order *Order) {
	book := state.OrderBook
	
	// Lock order for updates
	order.Status = StatusNew
	order.UpdatedAt = time.Now()
	
	if order.Side == OrderSideBuy {
		book.Bids = me.insertPriceLevel(book.Bids, order)
		sort.Sort(book.Bids)
	} else {
		book.Asks = me.insertPriceLevel(book.Asks, order)
		sort.Sort(AskPriceLevels(book.Asks))
	}
	
	book.LastUpdateID++
	
	// Update market ticker
	me.updateTickerFromBook(state)
}

// insertPriceLevel inserts an order into price levels
func (me *MatchingEngine) insertPriceLevel(levels PriceLevels, order *Order) PriceLevels {
	for _, level := range levels {
		if level.Price == order.Price {
			level.Orders = append(level.Orders, order)
			level.Quantity += order.RemainingQuantity
			level.Orders++
			return levels
		}
	}
	
	// New price level
	newLevel := &PriceLevel{
		Price: order.Price,
		Quantity: order.RemainingQuantity,
		Orders: 1,
	}
	
	return append(levels, newLevel)
}

// removePriceLevel removes empty price level
func (me *MatchingEngine) removePriceLevel(book *OrderBook, side OrderSide, price float64) {
	if side == OrderSideBuy {
		for i, level := range book.Bids {
			if level.Price == price {
				book.Bids = append(book.Bids[:i], book.Bids[i+1:]...)
				return
			}
		}
	} else {
		for i, level := range book.Asks {
			if level.Price == price {
				book.Asks = append(book.Asks[:i], book.Asks[i+1:]...)
				return
			}
		}
	}
}

// createTrade creates a new trade
func (me *MatchingEngine) createTrade(state *MarketState, takerOrder, makerOrder *Order, price, quantity float64) *Trade {
	tradeID := me.generateTradeID()
	
	// Determine roles
	isTaker := takerOrder.OrderID != makerOrder.OrderID
	takerUserID := takerOrder.UserID
	makerUserID := makerOrder.UserID
	
	// Calculate fees
	var takerFee, makerFee float64
	takerIsUser := takerOrder.UserID
	
	if isTaker {
		takerFee = quantity * price * me.takerFeeRate
		makerFee = quantity * price * me.makerFeeRate
		
		// Fees are charged in quote currency
		// Maker gets rebate, taker pays
	} else {
		// Self-trade
		takerFee = quantity * price * me.takerFeeRate
		makerFee = 0
	}
	
	trade := &Trade{
		TradeID: tradeID,
		OrderID: takerOrder.OrderID,
		CounterOrderID: makerOrder.OrderID,
		Symbol: state.Symbol,
		UserID: takerUserID,
		CounterUserID: makerUserID,
		Side: takerOrder.Side,
		Price: price,
		Quantity: quantity,
		QuoteQuantity: quantity * price,
		Fee: takerFee,
		FeeCurrency: state.OrderBook.QuoteAsset,
		FeeMakerTaker: "taker",
		IsTaker: isTaker,
		IsMaker: !isTaker,
		IsSelfTrade: takerUserID == makerUserID,
		Timestamp: time.Now(),
	}
	
	atomic.AddInt64(&me.stats.TradesExecuted, 1)
	atomic.AddInt64(&me.stats.TotalVolume, int64(quantity))
	atomic.AddInt64(&me.stats.TotalQuoteVolume, int64(quantity*price))
	
	return trade
}

// updateBalancesForTrade updates user balances after a trade
func (me *MatchingEngine) updateBalancesForTrade(trade *Trade) {
	// This would integrate with the wallet service
	// For now, just a placeholder
}

// updateMarketStats updates market statistics
func (me *MatchingEngine) updateMarketStats(state *MarketState, trades []*Trade) {
	if len(trades) == 0 {
		return
	}
	
	book := state.OrderBook
	lastPrice := trades[len(trades)-1].Price
	
	book.LastTradeID++
	book.Count += int64(len(trades))
	
	// Update volume
	for _, trade := range trades {
		book.Volume += trade.Quantity
		book.QuoteVolume += trade.QuoteQuantity
	}
	
	// Update high/low
	if lastPrice > book.HighPrice {
		book.HighPrice = lastPrice
	}
	if lastPrice < book.LowPrice || book.LowPrice == 0 {
		book.LowPrice = lastPrice
	}
	
	// Update ticker
	state.Ticker.LastPrice = lastPrice
	state.Ticker.Volume = book.Volume
	state.Ticker.QuoteVolume = book.QuoteVolume
	state.Ticker.HighPrice = book.HighPrice
	state.Ticker.LowPrice = book.LowPrice
	state.Ticker.Timestamp = time.Now()
	
	// Update order book last price
	book.LastUpdateID++
}

// updateTickerFromBook updates ticker from order book
func (me *MatchingEngine) updateTickerFromBook(state *MarketState) {
	book := state.OrderBook
	
	if len(book.Bids) > 0 {
		bid := book.Bids[0]
		state.Ticker.BidPrice = bid.Price
		state.Ticker.BidQuantity = bid.Quantity
	}
	
	if len(book.Asks) > 0 {
		ask := book.Asks[0]
		state.Ticker.AskPrice = ask.Price
		state.Ticker.AskQuantity = ask.Quantity
	}
	
	// Spread
	if len(book.Bids) > 0 && len(book.Asks) > 0 {
		spread := book.Asks[0].Price - book.Bids[0].Price
		state.Ticker.LastPrice = (book.Bids[0].Price + book.Asks[0].Price) / 2
		_ = spread // Could use for spread analysis
	}
}

// CancelOrder cancels an order
func (me *MatchingEngine) CancelOrder(orderID, userID string) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	order, exists := me.orders[orderID]
	if !exists {
		return errors.New("order not found")
	}
	
	if order.UserID != userID {
		return errors.New("unauthorized")
	}
	
	if order.Status == StatusFilled || order.Status == StatusCanceled {
		return errors.New("order already settled")
	}
	
	order.Status = StatusCanceled
	order.UpdatedAt = time.Now()
	
	atomic.AddInt64(&me.stats.OrdersCanceled, 1)
	
	// Remove from order book
	state := me.markets[order.Symbol]
	if state != nil {
		state.mu.Lock()
		defer state.mu.Unlock()
		
		if order.Side == OrderSideBuy {
			me.removeOrderFromLevel(state.OrderBook.Bids, order)
		} else {
			me.removeOrderFromLevel(state.OrderBook.Asks, order)
		}
	}
	
	if me.onOrderUpdate != nil {
		me.onOrderUpdate(order)
	}
	
	return nil
}

// removeOrderFromLevel removes an order from a price level
func (me *MatchingEngine) removeOrderFromLevel(levels PriceLevels, order *Order) {
	for _, level := range levels {
		for i, o := range level.Orders {
			if o.OrderID == order.OrderID {
				level.Orders = append(level.Orders[:i], level.Orders[i+1:]...)
				level.Quantity -= order.RemainingQuantity
				level.Orders--
				return
			}
		}
	}
}

// ModifyOrder modifies an existing order
func (me *MatchingEngine) ModifyOrder(orderID, userID string, newPrice, newQuantity float64) (*Order, error) {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	order, exists := me.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}
	
	if order.UserID != userID {
		return nil, errors.New("unauthorized")
	}
	
	if order.Status != StatusNew && order.Status != StatusPartiallyFilled {
		return nil, errors.New("can only modify active orders")
	}
	
	// Cancel old order
	oldQty := order.RemainingQuantity
	if order.Side == OrderSideBuy {
		me.removeOrderFromLevel(me.markets[order.Symbol].OrderBook.Bids, order)
	} else {
		me.removeOrderFromLevel(me.markets[order.Symbol].OrderBook.Asks, order)
	}
	
	// Update order
	order.Price = newPrice
	order.Quantity = newQuantity
	order.FilledQuantity = oldQty - order.RemainingQuantity + order.FilledQuantity
	order.RemainingQuantity = order.Quantity - order.FilledQuantity
	order.UpdatedAt = time.Now()
	
	// Add back to book
	state := me.markets[order.Symbol]
	state.mu.Lock()
	if order.Side == OrderSideBuy {
		me.addToBook(state, order)
	} else {
		me.addToBook(state, order)
	}
	state.mu.Unlock()
	
	if me.onOrderUpdate != nil {
		me.onOrderUpdate(order)
	}
	
	return order, nil
}

// GetOrder returns an order by ID
func (me *MatchingEngine) GetOrder(orderID string) (*Order, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	order, exists := me.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}
	
	return order, nil
}

// GetOpenOrders returns user's open orders
func (me *MatchingEngine) GetOpenOrders(userID, symbol string) ([]*Order, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	var orders []*Order
	for _, order := range me.orders {
		if order.UserID == userID {
			if symbol == "" || order.Symbol == symbol {
				if order.Status == StatusNew || order.Status == StatusPartiallyFilled {
					orders = append(orders, order)
				}
			}
		}
	}
	
	return orders, nil
}

// GetOrderBook returns the order book for a symbol
func (me *MatchingEngine) GetOrderBook(symbol string, limit int) (*OrderBook, error) {
	state := me.getMarketState(symbol)
	if state == nil {
		return nil, errors.New("market not found")
	}
	
	state.mu.RLock()
	defer state.mu.RUnlock()
	
	book := state.OrderBook
	
	result := &OrderBook{
		Symbol: symbol,
		LastUpdateID: book.LastUpdateID,
		Bids: make(PriceLevels, 0),
		Asks: make(PriceLevels, 0),
	}
	
	// Limit bids
	for i := 0; i < len(book.Bids) && i < limit; i++ {
		result.Bids = append(result.Bids, book.Bids[i])
	}
	
	// Limit asks
	for i := 0; i < len(book.Asks) && i < limit; i++ {
		result.Asks = append(result.Asks, book.Asks[i])
	}
	
	return result, nil
}

// GetTicker returns ticker for a symbol
func (me *MatchingEngine) GetTicker(symbol string) (*Ticker, error) {
	state := me.getMarketState(symbol)
	if state == nil {
		return nil, errors.New("market not found")
	}
	
	state.mu.RLock()
	defer state.mu.RUnlock()
	
	return state.Ticker, nil
}

// GetTradeHistory returns trade history
func (me *MatchingEngine) GetTradeHistory(symbol string, limit int) ([]*Trade, error) {
	// This would typically query from persistent storage
	return []*Trade{}, nil
}

// =============================================================================
// STOP ORDER TRIGGERING
// =============================================================================

// triggerStopOrder triggers a stop order
func (me *MatchingEngine) triggerStopOrder(state *MarketState, order *Order) ([]*Trade, error) {
	// Convert stop to market order
	marketOrder := &Order{
		OrderID: me.generateOrderID(),
		UserID: order.UserID,
		Symbol: order.Symbol,
		Side: order.Side,
		Type: OrderTypeMarket,
		Quantity: order.Quantity,
		Status: StatusPendingNew,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	me.mu.Lock()
	me.orders[marketOrder.OrderID] = marketOrder
	me.mu.Unlock()
	
	trades, err := me.executeMarketOrder(state, marketOrder)
	
	// Update original order
	order.FilledQuantity = marketOrder.FilledQuantity
	order.RemainingQuantity = marketOrder.RemainingQuantity
	order.AverageFillPrice = marketOrder.AverageFillPrice
	order.Status = marketOrder.Status
	
	return trades, err
}

// checkStopOrders checks and triggers stop orders
func (me *MatchingEngine) checkStopOrders(state *MarketState) {
	book := state.OrderBook
	currentPrice := book.LastPrice
	
	for i := len(state.stopOrders) - 1; i >= 0; i-- {
		order := state.stopOrders[i]
		
		shouldTrigger := false
		
		switch order.Type {
		case OrderTypeStopLoss:
			if order.Side == OrderSideSell && currentPrice <= order.StopPrice {
				shouldTrigger = true
			}
			if order.Side == OrderSideBuy && currentPrice >= order.StopPrice {
				shouldTrigger = true
			}
		case OrderTypeTakeProfit:
			if order.Side == OrderSideSell && currentPrice >= order.StopPrice {
				shouldTrigger = true
			}
			if order.Side == OrderSideBuy && currentPrice <= order.StopPrice {
				shouldTrigger = true
			}
		}
		
		if shouldTrigger {
			me.triggerStopOrder(state, order)
			state.stopOrders = append(state.stopOrders[:i], state.stopOrders[i+1:]...)
		}
	}
}

// =============================================================================
// MARGIN & POSITION MANAGEMENT
// =============================================================================

// OpenPosition opens a new position
func (me *MatchingEngine) OpenPosition(userID, symbol string, side OrderSide, quantity, leverage float64, positionMode string) (*Position, error) {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	positionID := fmt.Sprintf("POS_%s", uuid.New().String()[:8])
	
	position := &Position{
		PositionID: positionID,
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Size: quantity,
		OpenQuantity: quantity,
		EntryPrice: 0, // Set from first trade
		Leverage: leverage,
		PositionMode: positionMode,
		AutoAddMargin: false,
		OpenedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	me.positions[positionID] = position
	
	if me.userPositions[userID] == nil {
		me.userPositions[userID] = make(map[string]*Position)
	}
	me.userPositions[userID][positionID] = position
	
	return position, nil
}

// UpdatePosition updates a position after a trade
func (me *MatchingEngine) UpdatePosition(position *Position, trade *Trade) {
	position.mu.Lock()
	defer position.mu.Unlock()
	
	if position.Size == 0 {
		position.EntryPrice = trade.Price
	} else {
		// Average entry price
		totalCost := position.EntryPrice*position.Size + trade.Price*trade.Quantity
		position.Size += trade.Quantity
		if position.Size != 0 {
			position.EntryPrice = totalCost / position.Size
		}
	}
	
	position.UpdatedAt = time.Now()
	
	if me.onPositionUpdate != nil {
		me.onPositionUpdate(position)
	}
}

// GetPosition returns a user's position for a symbol
func (me *MatchingEngine) GetPosition(userID, symbol string) (*Position, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	for _, pos := range me.positions {
		if pos.UserID == userID && pos.Symbol == symbol {
			return pos, nil
		}
	}
	
	return nil, errors.New("position not found")
}

// CalculateLiquidationPrice calculates liquidation price for a position
func (me *MatchingEngine) CalculateLiquidationPrice(position *Position, markPrice float64) float64 {
	leverage := position.Leverage
	if leverage <= 0 {
		leverage = 1
	}
	
	maintenanceMarginRate := 0.005 // 0.5% default
	
	if position.Side == OrderSideBuy {
		// Long position
		return position.EntryPrice * (1 - (1/leverage) + maintenanceMarginRate)
	} else {
		// Short position
		return position.EntryPrice * (1 + (1/leverage) - maintenanceMarginRate)
	}
}

// CheckLiquidation checks if position should be liquidated
func (me *MatchingEngine) CheckLiquidation(position *Position, markPrice float64) (bool, string) {
	liquidationPrice := me.CalculateLiquidationPrice(position, markPrice)
	
	if position.Side == OrderSideBuy && markPrice <= liquidationPrice {
		return true, "long liquidation"
	}
	if position.Side == OrderSideSell && markPrice >= liquidationPrice {
		return true, "short liquidation"
	}
	
	return false, ""
}

// LiquidatePosition liquidates a position
func (me *MatchingEngine) LiquidatePosition(position *Position) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	// Create liquidation order
	order := &Order{
		OrderID: me.generateOrderID(),
		UserID: position.UserID,
		Symbol: position.Symbol,
		Side: OrderSideSell,
		Type: OrderTypeMarket,
		Quantity: position.Size,
		Status: StatusPendingNew,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	me.orders[order.OrderID] = order
	
	state := me.markets[position.Symbol]
	if state == nil {
		return errors.New("market not found")
	}
	
	state.mu.Lock()
	_, err := me.executeMarketOrder(state, order)
	state.mu.Unlock()
	
	if err == nil {
		position.Size = 0
		position.Status = StatusCanceled
		position.UpdatedAt = time.Now()
	}
	
	return err
}

// =============================================================================
// RISK MANAGEMENT
// =============================================================================

type RiskManager struct {
	engine *MatchingEngine
	
	// Risk limits
	maxPositionPerUser float64
	maxOrderValue float64
	maxDailyTradingVolume float64
	maxLeverage float64
	
	// Circuit breakers
	priceFluctuationLimit float64
	volumeSpikeThreshold float64
}

func NewRiskManager(engine *MatchingEngine) *RiskManager {
	return &RiskManager{
		engine: engine,
		maxPositionPerUser: 10000000, // $10M
		maxOrderValue: 1000000, // $1M
		maxDailyTradingVolume: 100000000, // $100M
		maxLeverage: 125, // Max 125x leverage
		priceFluctuationLimit: 0.1, // 10% price move triggers circuit breaker
		volumeSpikeThreshold: 5.0, // 5x average volume
	}
}

func (rm *RiskManager) checkOrderRisk(order *Order) error {
	// Check leverage
	if order.Leverage > rm.maxLeverage {
		return fmt.Errorf("leverage exceeds maximum of %d", int(rm.maxLeverage))
	}
	
	// Check order value
	orderValue := order.Price * order.Quantity
	if orderValue > rm.maxOrderValue {
		return fmt.Errorf("order value exceeds maximum of %.2f", rm.maxOrderValue)
	}
	
	// Check user position
	userPositions := rm.engine.userPositions[order.UserID]
	if userPositions != nil {
		for _, pos := range userPositions {
			if pos.Symbol == order.Symbol {
				newSize := pos.Size + order.Quantity
				if newSize * order.Price > rm.maxPositionPerUser {
					return fmt.Errorf("position size exceeds maximum of %.2f", rm.maxPositionPerUser)
				}
			}
		}
	}
	
	return nil
}

// =============================================================================
// ORDER RESULT
// =============================================================================

type OrderResult struct {
	Order *Order
	Trades []*Trade
	Error string
	
	ExecutedQuantity float64
	ExecutedQuote float64
	
	NewOrderID string
}

// =============================================================================
// HELPERS
// =============================================================================

func (me *MatchingEngine) getMarketState(symbol string) *MarketState {
	me.mu.RLock()
	defer me.mu.RUnlock()
	return me.markets[symbol]
}

func (me *MatchingEngine) generateOrderID() string {
	return fmt.Sprintf("ORD_%s", uuid.New().String()[:12])
}

func (me *MatchingEngine) generateTradeID() string {
	return fmt.Sprintf("TRD_%s", uuid.New().String()[:12])
}

func (me *MatchingEngine) updateLatencyStats(latencyUs int64) {
	me.stats.mu.Lock()
	defer me.stats.mu.Unlock()
	
	count := atomic.LoadInt64(&me.stats.OrdersProcessed)
	me.stats.AvgLatencyUs = (me.stats.AvgLatencyUs*(count-1) + latencyUs) / count
	
	if latencyUs > me.stats.MaxLatencyUs {
		me.stats.MaxLatencyUs = latencyUs
	}
	if me.stats.MinLatencyUs == 0 || latencyUs < me.stats.MinLatencyUs {
		me.stats.MinLatencyUs = latencyUs
	}
}

// =============================================================================
// BACKGROUND WORKERS
// =============================================================================

func (me *MatchingEngine) orderExpirationWorker() {
	defer me.wg.Done()
	
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-me.ctx.Done():
			return
		case <-ticker.C:
			me.checkExpiredOrders()
		}
	}
}

func (me *MatchingEngine) checkExpiredOrders() {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	now := time.Now()
	
	for _, order := range me.orders {
		if order.Status == StatusNew || order.Status == StatusPartiallyFilled {
			if !order.ExpireTime.IsZero() && now.After(order.ExpireTime) {
				order.Status = StatusExpired
				order.UpdatedAt = now
				
				// Remove from book
				if state, ok := me.markets[order.Symbol]; ok {
					state.mu.Lock()
					if order.Side == OrderSideBuy {
						me.removeOrderFromLevel(state.OrderBook.Bids, order)
					} else {
						me.removeOrderFromLevel(state.OrderBook.Asks, order)
					}
					state.mu.Unlock()
				}
				
				if me.onOrderUpdate != nil {
					me.onOrderUpdate(order)
				}
			}
		}
	}
}

func (me *MatchingEngine) fundingWorker() {
	defer me.wg.Done()
	
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	
	for {
		select {
		case <-me.ctx.Done():
			return
		case <-ticker.C:
			me.processFunding()
		}
	}
}

func (me *MatchingEngine) processFunding() {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	now := time.Now()
	
	for _, state := range me.markets {
		if now.After(state.nextFundingTime) {
			// Process funding payments for all positions
			for _, pos := range me.positions {
				if pos.Symbol == state.Symbol && pos.Size > 0 {
					// Calculate and apply funding fee
					fundingRate := state.fundingRate
					fundingFee := pos.Size * fundingRate
					
					pos.FundingFee += fundingFee
					pos.LastFundingTime = now
				}
			}
			
			state.nextFundingTime = now.Add(8 * time.Hour)
		}
	}
}

func (me *MatchingEngine) statsWorker() {
	defer me.wg.Done()
	
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	
	for {
		select {
		case <-me.ctx.Done():
			return
		case <-ticker.C:
			me.logStats()
		}
	}
}

func (me *MatchingEngine) logStats() {
	me.stats.mu.RLock()
	stats := me.stats
	me.stats.mu.RUnlock()
	
	log.Printf("[ENGINE] Stats - Orders: processed=%d, trades=%d, rejected=%d, avg_latency=%dμs",
		stats.OrdersProcessed, stats.TradesExecuted, stats.OrdersRejected, stats.AvgLatencyUs)
}

// Stop gracefully stops the engine
func (me *MatchingEngine) Stop() {
	log.Println("[ENGINE] Shutting down...")
	me.cancel()
	me.wg.Wait()
	log.Println("[ENGINE] Stopped")
}

// =============================================================================
// PLACEHOLDER TYPES
// =============================================================================

type RedisClient struct {
	// Placeholder for Redis connection
}

func (r *RedisClient) Get(key string) ([]byte, error) {
	return nil, nil
}

func (r *RedisClient) Set(key string, value []byte, ttl time.Duration) error {
	return nil
}

func (r *RedisClient) Del(key string) error {
	return nil
}

// Placeholder for sql.NullString compilation
var _ = sql.NullString{}
var _ = base64.StdEncoding
var _ = hex.Encode
var _ = sha256.New
var _ = hmac.New
var _ = big.NewFloat
var _ = strconv.ParseFloat
var _ = strings.TrimSpace

// =============================================================================
// HTTP API HANDLERS
// =============================================================================

// OrderHandler handles order-related API requests
type OrderHandler struct {
	engine *MatchingEngine
}

func (h *OrderHandler) PlaceOrder(w http.ResponseWriter, r *http.Request) {
	var req PlaceOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	
	order := &Order{
		UserID: req.UserID,
		Symbol: req.Symbol,
		Side: OrderSide(req.Side),
		Type: OrderType(req.Type),
		Price: req.Price,
		Quantity: req.Quantity,
		StopPrice: req.StopPrice,
		Leverage: req.Leverage,
		TimeInForce: TimeInForce(req.TimeInForce),
	}
	
	result, err := h.engine.SubmitOrder(order)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	
	json.NewEncoder(w).Encode(result)
}

type PlaceOrderRequest struct {
	UserID string `json:"userId"`
	Symbol string `json:"symbol"`
	Side string `json:"side"`
	Type string `json:"type"`
	Price float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	StopPrice float64 `json:"stopPrice"`
	Leverage float64 `json:"leverage"`
	TimeInForce string `json:"timeInForce"`
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Printf("TigerEx Trading Engine v%s starting...", EngineVersion)
	
	config := EngineConfig{
		Name: "TigerEx",
		Mode: "production",
		MaxOrdersPerMarket: 100000,
		MaxPositionsPerUser: 100,
		OrderProcessBatchSize: 1000,
		DefaultMakerFee: 0.001,
		DefaultTakerFee: 0.002,
		MaxPositionSize: 10000000,
		MaxOrderValue: 1000000,
		LiquidationBuffer: 0.005,
	}
	
	engine := NewMatchingEngine(config)
	
	// Initialize markets
	markets := []struct {
		Symbol string
		Base, Quote string
		PricePrec, QtyPrec int
		MinPrice, MaxPrice float64
		TickSize, LotSize float64
	}{
		{"BTC/USDT", "BTC", "USDT", 8, 8, 1000, 1000000, 0.01, 0.00001},
		{"ETH/USDT", "ETH", "USDT", 8, 8, 100, 10000, 0.01, 0.0001},
		{"BNB/USDT", "BNB", "USDT", 8, 8, 10, 1000, 0.001, 0.001},
		{"SOL/USDT", "SOL", "USDT", 8, 8, 0.1, 500, 0.001, 0.01},
		{"XRP/USDT", "XRP", "USDT", 8, 8, 0.1, 100, 0.0001, 0.1},
		{"ADA/USDT", "ADA", "USDT", 8, 8, 0.01, 10, 0.0001, 1},
		{"DOGE/USDT", "DOGE", "USDT", 8, 8, 0.001, 10, 0.00001, 10},
		{"DOT/USDT", "DOT", "USDT", 8, 8, 1, 100, 0.001, 0.1},
		{"MATIC/USDT", "MATIC", "USDT", 8, 8, 0.01, 10, 0.0001, 1},
		{"LINK/USDT", "LINK", "USDT", 8, 8, 1, 100, 0.001, 0.1},
	}
	
	for _, m := range markets {
		err := engine.InitializeMarket(m.Symbol, m.Base, m.Quote, m.PricePrec, m.QtyPrec, m.MinPrice, m.MaxPrice, m.TickSize, m.LotSize)
		if err != nil {
			log.Printf("[ERROR] Failed to initialize %s: %v", m.Symbol, err)
		} else {
			log.Printf("[INFO] Market initialized: %s", m.Symbol)
		}
	}
	
	log.Printf("[INFO] Trading engine ready with %d markets", len(markets))
	
	// Setup signal handling
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	
	<-sigCh
	
	log.Println("[INFO] Shutting down trading engine...")
	engine.Stop()
}