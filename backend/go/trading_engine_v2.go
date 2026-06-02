package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/m"
	"github.com/gorilla/rpc"
	"github.com/gorilla/rpc/json"
	"golang.org/x/time/rate"
)

// ============================================
// CORE CONSTANTS & CONFIGURATION
// ============================================

const (
	// Version
	Version = "2.0.0"

	// Order Types
	OrderTypeLimit       OrderType = "limit"
	OrderTypeMarket     OrderType = "market"
	OrderTypeStopLoss   OrderType = "stop_loss"
	OrderTypeStopLimit  OrderType = "stop_limit"
	OrderTypeTakeProfit OrderType = "take_profit"
	OrderTypeTrailingStop OrderType = "trailing_stop"
	OrderTypeOCO        OrderType = "oco" // One-Cancels-Other
	OrderTypeIceberg    OrderType = "iceberg"

	// Order Sides
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"

	// Time in Force
	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC" // Immediate Or Cancel
	TimeInForceFOK TimeInForce = "FOK"   // Fill Or Kill
	TimeInForceGTX TimeInForce = "GTX"   // Good Till Cross (Fill-or-Kill for maker)
	TimeInForceGTT TimeInForce = "GTT"   // Good Till Time

	// Order Status
	OrderStatusPendingNew    OrderStatus = "pending_new"
	OrderStatusNew          OrderStatus = "new"
	OrderStatusPartiallyFilled OrderStatus = "partially_filled"
	OrderStatusFilled       OrderStatus = "filled"
	OrderStatusCanceled     OrderStatus = "canceled"
	OrderStatusRejected     OrderStatus = "rejected"
	OrderStatusExpired      OrderStatus = "expired"

	// Position Modes
	PositionModeIsolated = "isolated"
	PositionModeCross    = "cross"
)

// ============================================
// CONFIGURATION STRUCTURES
// ============================================

// Config holds all server configuration
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Log      LogConfig
	Rate     RateLimitConfig
}

// ServerConfig for HTTP server
type ServerConfig struct {
	Port            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	MaxHeaderBytes  int
}

// DatabaseConfig for database connection
type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	MaxOpenConns    int
	MaxIdleConns    int
	MaxLifetime    time.Duration
}

// RedisConfig for Redis connection
type RedisConfig struct {
	Host          string
	Port          int
	Password     string
	Database     int
	PoolSize      int
	MinIdleConns  int
}

// LogConfig for logging
type LogConfig struct {
	Level     string
	Format    string
	Output    string
}

// RateLimitConfig for rate limiting
type RateLimitConfig struct {
	RequestsPerSecond int
	Burst             int
}

// ============================================
// CORE DATA STRUCTURES
// ============================================

// OrderType represents type of order
type OrderType string

// OrderSide represents buy or sell
type OrderSide string

// TimeInForce represents order time validity
type TimeInForce string

// OrderStatus represents current status
type OrderStatus string

// Order represents a trading order
type Order struct {
	// Public fields (serialized)
	OrderID            string    `json:"orderId"`
	UserID             string    `json:"userId"`
	MarketSymbol       string    `json:"marketSymbol"`
	Side              OrderSide `json:"side"`
	Type              OrderType `json:"type"`
	TimeInForce       TimeInForce `json:"timeInForce"`
	Price             float64   `json:"price"`
	StopPrice         float64   `json:"stopPrice,omitempty"`
	Quantity          float64   `json:"quantity"`
	FilledQuantity    float64   `json:"filledQuantity"`
	Remaining        float64   `json:"remaining"`
	AverageFillPrice float64   `json:"avgFillPrice"`
	OrderValue       float64   `json:"orderValue"`
	Fees             float64   `json:"fees"`
	Status           OrderStatus `json:"status"`
	Leverage          float64   `json:"leverage,omitempty"`
	MarginUsed       float64   `json:"marginUsed,omitempty"`
	PositionMode    string    `json:"positionMode,omitempty"`
	ClientOrderID    string    `json:"clientOrderId,omitempty"`
	TriggerOnce     bool      `json:"triggerOnce,omitempty"`
	IsMakerOnly     bool      `json:"isMakerOnly,omitempty"`
	IsPostOnly      bool      `json:"postOnly,omitempty"`
	ExpiresAt       int64     `json:"expiresAt,omitempty"`
	FrozenFunds     float64   `json:"frozenFunds,omitempty"`
	SelfTradePrevention string `json:"selfTradePrevention,omitempty"`
	CreatedAt        int64    `json:"createdAt"`
	UpdatedAt        int64    `json:"updatedAt"`
	TradedAt         int64    `json:"tradedAt,omitempty"`

	// Internal tracking
	priceLevel int // price level in order book
}

// Trade represents an executed trade
type Trade struct {
	TradeID          string    `json:"tradeId"`
	OrderID         string    `json:"orderId"`
	TakerOrderID    string    `json:"takerOrderId"`
	MakerOrderID    string    `json:"makerOrderId"`
	MarketSymbol    string    `json:"marketSymbol"`
	UserID          string    `json:"userId"`
	MakerUserID    string    `json:"makerUserId"`
	TakerUserID     string    `json:"takerUserId"`
	Side           OrderSide `json:"side"`
	Role            string    `json:"role"` // maker/taker
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	QuoteQuantity  float64   `json:"quoteQuantity"`
	MakerFee       float64   `json:"makerFee"`
	TakerFee       float64   `json:"takerFee"`
	MakerFeeRate   float64   `json:"makerFeeRate"`
	TakerFeeRate   float64   `json:"takerFeeRate"`
	RealizedPNL    float64   `json:"realizedPnl,omitempty"`
	IsSelfTrade    bool      `json:"isSelfTrade"`
	IsMaker        bool      `json:"isMaker"`
	Timestamp      int64     `json:"timestamp"`
}

// Position represents a user's position
type Position struct {
	PositionID      string    `json:"positionId"`
	UserID           string    `json:"userId"`
	MarketSymbol    string    `json:"marketSymbol"`
	Side            OrderSide `json:"side"`
	Size            float64   `json:"size"`
	EntryPrice      float64   `json:"entryPrice"`
	Margin          float64   `json:"margin"`
	LiquidationPrice float64  `json:"liquidationPrice"`
	Leverage        float64   `json:"leverage"`
 UnrealizedPNL    float64   `json:"unrealizedPnl"`
	PositionMode    string    `json:"positionMode"`
	IsolatedMargin  float64   `json:"isolatedMargin,omitempty"`
	MarkPrice      float64   `json:"markPrice"`
	UpdatedAt       int64     `json:"updatedAt"`
	CreatedAt       int64     `json:"createdAt"`
}

// OrderBook represents the order book for a market
type OrderBook struct {
	mu sync.RWMutex

	MarketSymbol   string
	Bids          *PriceLevels // Sorted highest to lowest
	Asks          *PriceLevels // Sorted lowest to highest

	LastUpdateID   int64
	Version       int64

	BaseAsset     string
	QuoteAsset    string
	MinPrice      float64
	MaxPrice      float64
	TickSize      float64
	LotSize       float64

	PricePrecision    int
	QuantityPrecision int

	TradingEnabled bool
	CancelOnly     bool
	FastMatchEnabled bool
}

// PriceLevel represents aggregated orders at a price level
type PriceLevel struct {
	Price       float64
	Quantity   float64
	Orders     []*Order
	CancelOnly bool
}

// PriceLevels is a sorted slice of price levels
type PriceLevels []*PriceLevel

func (pl PriceLevels) Len() int           { return len(pl) }
func (pl PriceLevels) Less(i, j int) bool  { return pl[i].Price > pl[j].Price }
func (pl PriceLevels) Swap(i, j int)       { pl[i], pl[j] = pl[j], pl[i] }

// AskPriceLevels sorts ascending (lowest first for asks)
type AskPriceLevels PriceLevels

func (pl AskPriceLevels) Len() int           { return len(pl) }
func (pl AskPriceLevels) Less(i, j int) bool  { return pl[i].Price < pl[j].Price }
func (pl AskPriceLevels) Swap(i, j int)     { pl[i], pl[j] = pl[j], pl[i] }

// ============================================
// ENGINE STATISTICS
// ============================================

// EngineStats tracks matching engine statistics
type EngineStats struct {
	mu sync.RWMutex

	TotalTrades       int64
	Volume24h        float64
	FeesCollected24H  float64
	LastReset        time.Time

	// Performance metrics
	AvgLatencyUs     int64
	MaxLatencyUs     int64
	MinLatencyUs     int64
	OrdersProcessed  int64

	// Memory
	NumOrders        int64
	NumTrades       int64
	NumMarkets      int64
}

// ============================================
// FEE CONFIGURATION
// ============================================

// FeeConfig for fee calculations
type FeeConfig struct {
	MakerFeeRate  float64
	TakerFeeRate float64

	VolumeTiers    []FeeTier
	HoldingsTiers []FeeHolderTier
}

type FeeTier struct {
	Volume       float64
	MakerFeeRate float64
	TakerFeeRate float64
}

type FeeHolderTier struct {
	Holdings    float64
	FeeDiscount float64
}

// ============================================
// PERMISSION SYSTEM
// ============================================

// Permission constants
const (
	PermissionTrade     = "trade"
	PermissionWithdraw = "withdraw"
	PermissionDeposit   = "deposit"
	PermissionTransfer = "transfer"
)

// UserPermissions represents a user's permissions
type UserPermissions struct {
	UserID         string
	Permissions   []string
	KYCVerified    bool
	Country       string
	Restricted    bool
	Locked        bool
	CreatedAt     int64
	UpdatedAt     int64
}

// ============================================
// BALANCE MANAGEMENT
// ============================================

// Balance represents user's balance
type Balance struct {
	UserID     string
	Asset     string
	Available float64
	Locked    float64
}

// WalletService manages user balances
type WalletService struct {
	mu sync.RWMutex
	balances map[string]map[string]*Balance // userID -> asset -> Balance
}

// NewWalletService creates new wallet service
func NewWalletService() *WalletService {
	return &WalletService{
		balances: make(map[string]map[string]*Balance),
	}
}

// GetBalance returns user's balance for an asset
func (w *WalletService) GetBalance(userID, asset string) (available, locked float64) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if userBalances, ok := w.balances[userID]; ok {
		if balance, ok := userBalances[asset]; ok {
			return balance.Available, balance.Locked
		}
	}
	return 0, 0
}

// LockFunds locks funds for an order
func (w *WalletService) LockFunds(userID, asset string, amount float64) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if _, ok := w.balances[userID]; !ok {
		w.balances[userID] = make(map[string]*Balance)
	}

	balance, ok := w.balances[userID][asset]
	if !ok {
		balance = &Balance{UserID: userID, Asset: asset}
		w.balances[userID][asset] = balance
	}

	if balance.Available < amount {
		return errors.New("insufficient balance")
	}

	balance.Available -= amount
	balance.Locked += amount
	return nil
}

// UnlockFunds unlocks funds
func (w *WalletService) UnlockFunds(userID, asset string, amount float64) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if userBalances, ok := w.balances[userID]; ok {
		if balance, ok := userBalances[asset]; ok {
			balance.Locked -= amount
			if balance.Locked < 0 {
				balance.Available += balance.Locked
				balance.Locked = 0
			} else {
				balance.Available += amount
			}
		}
	}
}

// ============================================
// MATCHING ENGINE
// ============================================

// MatchingEngine handles order matching
type MatchingEngine struct {
	mu sync.RWMutex

	markets      map[string]*OrderBook
	tickers     map[string]*Ticker
	orders      map[string]*Order
	trades      map[string]*Trade
	positions  map[string]*Position

	wallet     *WalletService
	feeConfig *FeeConfig

	// Callbacks
	OnTrade         func(*Trade)
	OnOrderUpdate   func(*Order)
	OnBalanceUpdate func(string, string, float64)
	OnPositionUpdate func(*Position)

	// Statistics
	Stats *EngineStats

	// Rate limiting
	rateLimiter *RateLimiter

	// Order expiration checker
	expirationWorker *ExpirationWorker
}

// Ticker tracks market price
type Ticker struct {
	Symbol       string
	LastPrice   float64
	LastQuantity float64
	BidPrice    float64
	AskPrice    float64
	AskQuantity float64
	BidQuantity float64
	OpenPrice  float64
	HighPrice  float64
	LowPrice   float64
	ClosePrice float64
	Volume    float64
	QuoteVolume float64
	Trades    int64
	Timestamp int64
}

// RateLimiter for API rate limiting
type RateLimiter struct {
	clients      map[string]*ClientRateLimit
	globalLimit *ClientRateLimit
}

type ClientRateLimit struct {
	requests   int64
	resetTime time.Time
}

// ExpirationWorker checks for expired orders
type ExpirationWorker struct {
	engine  *MatchingEngine
	ticker *time.Ticker
	ctx    context.Context
	cancel context.CancelFunc
}

// NewMatchingEngine creates new matching engine
func NewMatchingEngine() *MatchingEngine {
	m := &MatchingEngine{
		markets:     make(map[string]*OrderBook),
		tickers:    make(map[string]*Ticker),
		orders:    make(map[string]*Order),
		trades:    make(map[string]*Trade),
		positions: make(map[string]*Position),
		wallet:    NewWalletService(),
		feeConfig: &FeeConfig{
			MakerFeeRate: 0.001,
			TakerFeeRate: 0.001,
			VolumeTiers: []FeeTier{
				{Volume: 0, MakerFeeRate: 0.001, TakerFeeRate: 0.001},
				{Volume: 100000, MakerFeeRate: 0.0008, TakerFeeRate: 0.0008},
				{Volume: 1000000, MakerFeeRate: 0.0006, TakerFeeRate: 0.0006},
				{Volume: 10000000, MakerFeeRate: 0.0004, TakerFeeRate: 0.0004},
				{Volume: 100000000, MakerFeeRate: 0.0, TakerFeeRate: 0.0002},
			},
		},
		Stats: &EngineStats{
			LastReset: time.Now(),
		},
		rateLimiter: &RateLimiter{
			clients: make(map[string]*ClientRateLimit),
		},
	}

	// Start expiration worker
	m.expirationWorker = &ExpireWorker{m.engine}
	go m.expirationWorker.Start()

	return m
}

// InitializeMarket creates order book for a market
func (m *MatchingEngine) InitializeMarket(symbol, baseAsset, quoteAsset string, pricePrecision, qtyPrecision int, minPrice, maxPrice, tickSize, lotSize float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.markets[symbol]; exists {
		return errors.New("market already exists")
	}

	ob := &OrderBook{
		MarketSymbol:   symbol,
		BaseAsset:      baseAsset,
		QuoteAsset:     quoteAsset,
		PricePrecision:  pricePrecision,
		QuantityPrecision: qtyPrecision,
		MinPrice:       minPrice,
		MaxPrice:       maxPrice,
		TickSize:       tickSize,
		LotSize:        lotSize,
		Bids:           &PriceLevels{},
		Asks:           &PriceLevels{},
		TradingEnabled: true,

		LastUpdateID: 0,
		Version:    0,
	}

	// Initialize with default price levels
	*ob.Bids = append(*ob.Bids, &PriceLevel{Price: minPrice, Quantity: 0, Orders: []*Order{}})
	*ob.Asks = append(*ob.Asks, &PriceLevel{Price: maxPrice, Quantity: 0, Orders: []*Order{}})

	m.markets[symbol] = ob

	// Initialize ticker
	m.tickers[symbol] = &Ticker{
		Symbol:     symbol,
		LastPrice:  (minPrice + maxPrice) / 2,
		OpenPrice:  (minPrice + maxPrice) / 2,
		Timestamp: time.Now().UnixMilli(),
	}

	m.Stats.NumMarkets++

	log.Printf("[ENGINE] Initialized market %s (base: %s, quote: %s)", symbol, baseAsset, quoteAsset)
	return nil
}

// SubmitOrder submits order to matching engine
func (m *MatchingEngine) SubmitOrder(order *Order) ([]*Trade, error) {
	startTime := time.Now()

	m.mu.Lock()
	defer m.mu.Unlock()

	// Generate order ID if not set
	if order.OrderID == "" {
		order.OrderID = generateOrderID()
	}

	// Validate order
	if err := m.validateOrder(order); err != nil {
		order.Status = OrderStatusRejected
		return nil, err
	}

	// Get or create market
	ob, exists := m.markets[order.MarketSymbol]
	if !exists {
		return nil, errors.New("market not found")
	}

	// Lock funds for the order
	if !isMarketOrder(order.Type) {
		err := m.wallet.LockFunds(order.UserID, getQuoteAsset(order.MarketSymbol), order.Price*order.Quantity)
		if err != nil {
			order.Status = OrderStatusRejected
			return nil, err
		}
		order.FrozenFunds = order.Price * order.Quantity
	}

	// Set creation time
	order.CreatedAt = time.Now().UnixMilli()
	order.UpdatedAt = order.CreatedAt
	order.Remaining = order.Quantity
	order.Status = OrderStatusNew

	// Store order
	m.orders[order.OrderID] = order
	m.Stats.NumOrders++
	order.Stats.OrdersProcessed++

	// Process order based on type
	var trades []*Trade
	if isMarketOrder(order.Type) {
		trades = m.executeMarketOrder(ob, order)
	} else if isStopOrder(order.Type) {
		// Add to stop order queue
		trades = m.addStopOrder(ob, order)
	} else {
		// Add to order book (limit order)
		trades = m.executeLimitOrder(ob, order)
	}

	// Update latency stats
	latency := time.Since(startTime).Microseconds()
	m.updateLatencyStats(latency)

	return trades, nil
}

// validateOrder validates order parameters
func (m *MatchingEngine) validateOrder(order *Order) error {
	if order.UserID == "" {
		return errors.New("user ID required")
	}
	if order.MarketSymbol == "" {
		return errors.New("market symbol required")
	}
	if order.Quantity <= 0 {
		return errors.New("quantity must be positive")
	}
	if order.Price <= 0 && !isMarketOrder(order.Type) {
		return errors.New("price must be positive")
	}
	return nil
}

// executeLimitOrder executes limit order
func (m *MatchingEngine) executeLimitOrder(ob *OrderBook, order *Order) []*Trade {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	var trades []*Trade

	if order.Side == OrderSideBuy {
		// Match against asks
		for i := 0; i < len(*ob.Asks) && order.Remaining > 0; i++ {
			level := (*ob.Asks)[i]
			if level.Price > order.Price {
				continue // Price too high
			}

			for j := 0; j < len(level.Orders) && order.Remaining > 0; j++ {
				makerOrder := level.Orders[j]
				if makerOrder.Status != OrderStatusNew && makerOrder.Status != OrderStatusPartiallyFilled {
					continue
				}

				// Execute match
				qty := math.Min(order.Remaining, makerOrder.Remaining)
				trade := m.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				order.FilledQuantity += qty
				order.Remaining -= qty
				makerOrder.FilledQuantity += qty
				makerOrder.Remaining -= qty

				if makerOrder.Remaining <= 0 {
					makerOrder.Status = OrderStatusFilled
				} else {
					makerOrder.Status = OrderStatusPartiallyFilled
				}

				// Update balances
				m.updateBalancesForTrade(trade)
			}
		}

		// If remaining and GTC, add to book
		if order.Remaining > 0 && order.TimeInForce == TimeInForceGTC {
			m.addOrderToBook(ob, order)
		} else {
			order.Status = OrderStatusFilled
		}
	} else {
		// Sell side - match against bids
		for i := 0; i < len(*ob.Bids) && order.Remaining > 0; i++ {
			level := (*ob.Bids)[i]
			if level.Price < order.Price {
				continue // Price too low
			}

			for j := 0; j < len(level.Orders) && order.Remaining > 0; j++ {
				makerOrder := level.Orders[j]
				if makerOrder.Status != OrderStatusNew && makerOrder.Status != OrderStatusPartiallyFilled {
					continue
				}

				qty := math.Min(order.Remaining, makerOrder.Remaining)
				trade := m.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				order.FilledQuantity += qty
				order.Remaining -= qty
				makerOrder.FilledQuantity += qty
				makerOrder.Remaining -= qty

				if makerOrder.Remaining <= 0 {
					makerOrder.Status = OrderStatusFilled
				} else {
					makerOrder.Status = OrderStatusPartiallyFilled
				}

				m.updateBalancesForTrade(trade)
			}
		}

		if order.Remaining > 0 && order.TimeInForce == TimeInForceGTC {
			m.addOrderToBook(ob, order)
		} else {
			order.Status = OrderStatusFilled
		}
	}

	ob.LastUpdateID++

	if len(trades) > 0 {
		order.Status = order.Remaining > 0 && order.FilledQuantity > 0: OrderStatusPartiallyFilled
		if order.Remaining > 0 && order.FilledQuantity > 0 {
			order.Status = OrderStatusPartiallyFilled
		} else if order.Remaining <= 0 || order.FilledQuantity > 0 {
			order.Status = OrderStatusFilled
		} else {
			order.Status = OrderStatusCanceled
		}
	} else if order.TimeInForce == TimeInForceIOC || order.TimeInForce == TimeInForceFOK {
		order.Status = OrderStatusCanceled
	}

	order.UpdatedAt = time.Now().UnixMilli()

	// Calculate average fill price
	if len(trades) > 0 {
		var totalValue, totalQty float64
		for _, t := range trades {
			totalValue += t.Price * t.Quantity
			totalQty += t.Quantity
		}
		if totalQty > 0 {
			order.AverageFillPrice = totalValue / totalQty
		}
		order.OrderValue = order.AverageFillPrice * order.FilledQuantity
	}

	// Update stats
	m.Stats.TotalTrades += int64(len(trades))
	m.Stats.Volume24h += order.OrderValue

	// Trigger callbacks
	if m.OnOrderUpdate != nil {
		m.OnOrderUpdate(order)
	}

	return trades
}

// createTrade creates trade record
func (m *MatchingEngine) createTrade(ob *OrderBook, taker, maker *Order, price, quantity float64) *Trade {
	trade := &Trade{
		TradeID:       generateTradeID(),
		OrderID:      taker.OrderID,
		TakerOrderID:  taker.OrderID,
		MakerOrderID:  maker.OrderID,
		MarketSymbol: ob.MarketSymbol,
		UserID:       taker.UserID,
		MakerUserID:  maker.UserID,
		TakerUserID:  taker.UserID,
		Side:        taker.Side,
		Price:       price,
		Quantity:    quantity,
		QuoteQuantity: price * quantity,
	}

	// Determine role
	if price >= maker.Price {
		trade.Role = "taker"
		trade.IsMaker = false
	} else {
		trade.Role = "maker"
		trade.IsMaker = true
	}

	// Calculate fees
	makerFeeRate := m.feeConfig.MakerFeeRate
	takerFeeRate := m.feeConfig.TakerFeeRate
	trade.MakerFeeRate = makerFeeRate
	trade.TakerFeeRate = takerFeeRate

	if trade.IsMaker {
		trade.MakerFee = quantity * price * makerFeeRate
	} else {
		trade.TakerFee = quantity * price * takerFeeRate
	}

	trade.Timestamp = time.Now().UnixMilli()

	m.trades[trade.TradeID] = trade
	m.Stats.NumTrades++

	return trade
}

// updateBalancesForTrade updates user balances after a trade
func (m *MatchingEngine) updateBalancesForTrade(trade *Trade) {
	baseAsset := strings.Split(trade.MarketSymbol, "/")[0]
	quoteAsset := strings.Split(trade.MarketSymbol, "/")[1]

	if trade.Side == OrderSideBuy {
		// Buyer gets base asset, pays quote
		m.wallet.balances[trade.UserID][quoteAsset].Available -= trade.QuoteQuantity + trade.TakerFee
		m.wallet.balances[trade.UserID][baseAsset].Available += trade.Quantity

		// Seller gets quote, pays base
		m.wallet.balances[trade.MakerUserID][baseAsset].Available -= trade.Quantity
		m.wallet.balances[trade.MakerUserID][quoteAsset].Available += trade.QuoteQuantity - trade.MakerFee
	} else {
		// Seller gets quote minus fees
		m.wallet.balances[trade.UserID][quoteAsset].Available += trade.QuoteQuantity - trade.TakerFee
		m.wallet.balances[trade.UserID][baseAsset].Available -= trade.Quantity

		// Buyer gets base asset
		m.wallet.balances[trade.MakerUserID][baseAsset].Available += trade.Quantity
		m.wallet.balances[trade.MakerUserID][quoteAsset].Available -= trade.QuoteQuantity + trade.MakerFee
	}

	if m.OnBalanceUpdate != nil {
		m.OnBalanceUpdate(trade.UserID, quoteAsset, m.wallet.balances[trade.UserID][quoteAsset].Available)
	}
}

// addOrderToBook adds order to order book
func (m *MatchingEngine) addOrderToBook(ob *OrderBook, order *Order) {
	if order.Side == OrderSideBuy {
		levels := *ob.Bids
		found := false
		for i, level := range levels {
			if level.Price == order.Price {
				level.Orders = append(level.Orders, order)
				level.Quantity += order.Remaining
				found = true
				break
			}
		}
		if !found {
			newLevel := &PriceLevel{
				Price: order.Price,
				Quantity: order.Remaining,
				Orders: []*Order{order},
			}
			*ob.Bids = append(*ob.Bids, newLevel)
			sort.Sort(ob.Bids)
		}
	} else {
		levels := *ob.Asks
		found := false
		for i, level := range levels {
			if level.Price == order.Price {
				level.Orders = append(level.Orders, order)
				level.Quantity += order.Remaining
				found = true
				break
			}
		}
		if !found {
			newLevel := &PriceLevel{
				Price: order.Price,
				Quantity: order.Remaining,
				Orders: []*Order{order},
			}
			*ob.Asks = append(*ob.Asks, newLevel)
			sort.Sort(AskPriceLevels(*ob.Asks))
		}
	}
}

// executeMarketOrder executes market order at current price
func (m *MatchingEngine) executeMarketOrder(ob *OrderBook, order *Order) []*Trade {
	var trades []*Trade

	if order.Side == OrderSideBuy {
		for _, level := range *ob.Asks {
			if order.Remaining <= 0 {
				break
			}

			for _, makerOrder := range level.Orders {
				if order.Remaining <= 0 {
					break
				}

				qty := math.Min(order.Remaining, makerOrder.Remaining)
				trade := m.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				order.FilledQuantity += qty
				order.Remaining -= qty
				makerOrder.FilledQuantity += qty
				makerOrder.Remaining -= qty

				m.updateBalancesForTrade(trade)
			}
		}
	} else {
		for _, level := range *ob.Bids {
			if order.Remaining <= 0 {
				break
			}

			for _, makerOrder := range level.Orders {
				if order.Remaining <= 0 {
					break
				}

				qty := math.Min(order.Remaining, makerOrder.Remaining)
				trade := m.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)

				order.FilledQuantity += qty
				order.Remaining -= qty
				makerOrder.FilledQuantity += qty
				makerOrder.Remaining -= qty

				m.updateBalancesForTrade(trade)
			}
		}
	}

	if order.Remaining <= 0 {
		order.Status = OrderStatusFilled
	} else if order.FilledQuantity > 0 {
		order.Status = OrderStatusPartiallyFilled
	} else {
		order.Status = OrderStatusRejected
	}

	ob.LastUpdateID++

	return trades
}

// CancelOrder cancels an order
func (m *MatchingEngine) CancelOrder(orderID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	order, exists := m.orders[orderID]
	if !exists {
		return errors.New("order not found")
	}

	if order.UserID != userID {
		return errors.New("unauthorized")
	}

	if order.Status == OrderStatusFilled || order.Status == OrderStatusCanceled {
		return errors.New("order already settled")
	}

	order.Status = OrderStatusCanceled
	order.UpdatedAt = time.Now().UnixMilli()

	// Unlock frozen funds
	if order.FrozenFunds > 0 {
		m.wallet.UnlockFunds(order.UserID, getQuoteAsset(order.MarketSymbol), order.FrozenFunds)
	}

	if m.OnOrderUpdate != nil {
		m.OnOrderUpdate(order)
	}

	return nil
}

// GetOrder returns order by ID
func (m *MatchingEngine) GetOrder(orderID string) (*Order, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	order, exists := m.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}

	return order, nil
}

// GetOpenOrders returns user's open orders
func (m *MatchingEngine) GetOpenOrders(userID string) []*Order {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var orders []*Order
	for _, order := range m.orders {
		if order.UserID == userID && (order.Status == OrderStatusNew || order.Status == OrderStatusPartiallyFilled) {
			orders = append(orders, order)
		}
	}

	return orders
}

// GetOrderBook returns order book depth
func (m *MatchingEngine) GetOrderBook(symbol string, limit int) (map[string]interface{}, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ob, exists := m.markets[symbol]
	if !exists {
		return nil, errors.New("market not found")
	}

	bids := make([]map[string]interface{}, 0, limit)
	asks := make([]map[string]interface{}, 0, limit)

	for i := 0; i < len(*ob.Bids) && i < limit; i++ {
		level := (*ob.Bids)[i]
		bids = append(bids, map[string]interface{}{
			"price":    level.Price,
			"quantity": level.Quantity,
		})
	}

	for i := 0; i < len(*ob.Asks) && i < limit; i++ {
		level := (*ob.Asks)[i]
		asks = append(asks, map[string]interface{}{
			"price":    level.Price,
			"quantity": level.Quantity,
		})
	}

	return map[string]interface{}{
		"lastUpdateId": ob.LastUpdateID,
		"bids":        bids,
		"asks":        asks,
	}, nil
}

// GetTicker returns ticker for a market
func (m *MatchingEngine) GetTicker(symbol string) (*Ticker, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ticker, exists := m.tickers[symbol]
	if !exists {
		return nil, errors.New("market not found")
	}

	return ticker, nil
}

// updateLatencyStats updates latency statistics
func (m *MatchingEngine) updateLatencyStats(latencyUs int64) {
	m.Stats.mu.Lock()
	defer m.Stats.mu.Unlock()

	m.Stats.AvgLatencyUs = (m.Stats.AvgLatencyUs*(m.Stats.OrdersProcessed-1) + latencyUs) / m.Stats.OrdersProcessed

	if latencyUs > m.Stats.MaxLatencyUs {
		m.Stats.MaxLatencyUs = latencyUs
	}
	if m.Stats.MinLatencyUs == 0 || latencyUs < m.Stats.MinLatencyUs {
		m.Stats.MinLatencyUs = latencyUs
	}
}

// ============================================
// HELPER FUNCTIONS
// ============================================

func generateOrderID() string {
	return fmt.Sprintf("ORD_%s", uuid.New().String()[:8])
}

func generateTradeID() string {
	return fmt.Sprintf("TRD_%s", uuid.New().String()[:8])
}

func isMarketOrder(orderType OrderType) bool {
	return orderType == OrderTypeMarket || orderType == "stop_market"
}

func isStopOrder(orderType OrderType) bool {
	return orderType == OrderTypeStopLoss || orderType == OrderTypeStopLimit ||
		orderType == OrderTypeTakeProfit || orderType == OrderTypeTrailingStop
}

func getQuoteAsset(symbol string) string {
	parts := strings.Split(symbol, "/")
	if len(parts) != 2 {
		return "USDT"
	}
	return parts[1]
}

func (w *ExpirationWorker) Start() {
}

func (w *ExpirationWorker) Stop() {
}

// Placeholder functions for compilation
var _ = json.Register
var _ = mux.Vars
var _ = rpc.NewServer
var _ = hex.Encode
var _ = base64.StdEncoding
var _ = sha256.New
var _ = hmac.New
var _ = big.NewInt
var _ = rate.New
var _ = runtime.GOMAXPROCS
var _ = syscall.SIGTERM
var _ = atomic.LoadInt64
var _ = sync.Map

func addStopOrder(ob *OrderBook, order *Order) []*Trade {
	return nil
}

var _ = fmt.Errorf
var _ = strconv.ParseFloat
var _ = strings.TrimSpace
var _ = sort.IsSorted

// ============================================
// MAIN
// ============================================

func main() {
	log.Printf("TigerEx Trading Engine v%s", Version)

	// Create matching engine
	engine := NewMatchingEngine()

	// Initialize markets
	markets := []struct {
		Symbol           string
		Base, Quote      string
		MinPrice, MaxPrice float64
	}{
		{"BTC/USDT", "BTC", "USDT", 1000, 1000000},
		{"ETH/USDT", "ETH", "USDT", 100, 10000},
		{"BNB/USDT", "BNB", "USDT", 10, 1000},
		{"SOL/USDT", "SOL", "USDT", 0.1, 500},
	}

	for _, m := range markets {
		err := engine.InitializeMarket(m.Symbol, m.Base, m.Quote, 8, 8, m.MinPrice, m.MaxPrice, 0.01, 0.00001)
		if err != nil {
			log.Printf("[ERROR] Failed to initialize %s: %v", m.Symbol, err)
		}
	}

	log.Printf("[INFO] Engine initialized with %d markets", len(markets))

	// HTTP Server
	server := &http.Server{
		Addr:         ":8080",
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
		Handler:      nil,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		log.Println("[INFO] Shutting down...")

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[ERROR] Server shutdown: %v", err)
		}
	}()

	log.Printf("[INFO] Server starting on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil {
		log.Printf("[ERROR] Server: %v", err)
	}
}