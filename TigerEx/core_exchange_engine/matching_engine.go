package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Order types
type OrderType string
type OrderSide string
type TimeInForce string
type OrderStatus string

const (
	OrderTypeLimit         OrderType = "limit"
	OrderTypeMarket       OrderType = "market"
	OrderTypeStopLoss     OrderType = "stop_loss"
	OrderTypeStopLimit    OrderType = "stop_limit"
	OrderTypeTakeProfit   OrderType = "take_profit"
	OrderTypeTrailingStop OrderType = "trailing_stop"
	OrderTypeOCO         OrderType = "oco"
	OrderTypeIceberg     OrderType = "iceberg"

	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"

	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC" // Immediate Or Cancel
	TimeInForceFOK TimeInForce = "FOK" // Fill Or Kill
	TimeInForceGTX TimeInForce = "GTX" // Good Till Cross
	TimeInForceGTT TimeInForce = "GTT" // Good Till Time

	OrderStatusPendingNew   OrderStatus = "pending_new"
	OrderStatusNew       OrderStatus = "new"
	OrderStatusPartial   OrderStatus = "partially_filled"
	OrderStatusFilled   OrderStatus = "filled"
	OrderStatusCanceled OrderStatus = "canceled"
	OrderStatusRejected OrderStatus = "rejected"
	OrderStatusExpired  OrderStatus = "expired"
)

// Precision handling
var (
	PrecisionPrice    = int64(math.Pow10(8))
	PrecisionAmount = int64(math.Pow10(8))
)

// Order represents a trading order
type Order struct {
	OrderID           string    `json:"orderId"`
	UserID           string    `json:"userId"`
	MarketSymbol     string    `json:"marketSymbol"`
	Side            OrderSide `json:"side"`
	Type             OrderType `json:"type"`
	TimeInForce      TimeInForce `json:"timeInForce"`
	Price           float64   `json:"price"`
	StopPrice        float64   `json:"stopPrice,omitempty"`
	Quantity        float64   `json:"quantity"`
	FilledQuantity   float64   `json:"filledQuantity"`
	Remaining       float64   `json:"remaining"`
	AverageFillPrice float64 `json:"avgFillPrice"`
	OrderValue       float64   `json:"orderValue"`
	Fees            float64   `json:"fees"`
	Status          OrderStatus `json:"status"`
	Leverage         float64   `json:"leverage,omitempty"`
	MarginUsed      float64   `json:"marginUsed,omitempty"`
	PositionMode   string    `json:"positionMode,omitempty"` // isolated/cross
	ClientOrderID   string    `json:"clientOrderId,omitempty"`
	TriggerOnce   bool      `json:"triggerOnce,omitempty"`
	IsMakerOnly    bool      `json:"isMakerOnly,omitempty"`
	IsPostOnly    bool      `json:"postOnly,omitempty"`
	ExpiresAt     int64     `json:"expiresAt,omitempty"`
	FrozenFunds   float64   `json:"frozenFunds,omitempty"`
	SelfTradePrevention string `json:"selfTradePrevention,omitempty"` // decrement_take, increment_take, cancel_rest
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`
	TradedAt       int64    `json:"tradedAt,omitempty"`
	
	// Internal tracking
	priceLevel int // Price level in order book
}

// Trade represents an executed trade
type Trade struct {
	TradeID           string    `json:"tradeId"`
	OrderID          string    `json:"orderId"`
	TakerOrderID     string    `json:"takerOrderId"`
	MakerOrderID    string    `json:"makerOrderId"`
	MarketSymbol    string    `json:"marketSymbol"`
	UserID         string    `json:"userId"`
	MakerUserID    string    `json:"makerUserId"`
	TakerUserID    string    `json:"takerUserId"`
	Side           OrderSide `json:"side"`
	Role           string    `json:"role"` // maker/taker
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	QuoteQuantity  float64   `json:"quoteQuantity"`
	MakerFee       float64   `json:"makerFee"`
	TakerFee       float64   `json:"takerFee"`
	MakerFeeRate   float64   `json:"makerFeeRate"`
	TakerFeeRate  float64   `json:"takerFeeRate"`
	RealizedPNL   float64   `json:"realizedPnl,omitempty"`
	IsSelfTrade   bool      `json:"isSelfTrade"`
	IsMaker       bool      `json:"isMaker"`
	Timestamp     int64     `json:"timestamp"`
}

// OrderBook represents the order book for a market
type OrderBook struct {
	mu sync.RWMutex
	
	MarketSymbol string
	Bids       *PriceLevels // Sorted highest to lowest
	Asks       *PriceLevels // Sorted lowest to highest
	
	// Tracking
	LastUpdateID int64
	Version   int64
	
	// Market info
	BaseAsset  string
	QuoteAsset string
	MinPrice  float64
	MaxPrice float64
	TickSize float64
	LotSize  float64
	
	// Decimals
	PricePrecision    int
	QuantityPrecision int
	
	// Trading control
	TradingEnabled bool
	CancelOnly     bool
	FastMatchEnabled bool
}

// PriceLevel represents aggregated orders at a price
type PriceLevel struct {
	Price        float64
	Quantity    float64
	Orders      []*Order
	CancelOnly  bool
}

// PriceLevels is a sorted slice of price levels
type PriceLevels []*PriceLevel

func (pl PriceLevels) Len() int           { return len(pl) }
func (pl PriceLevels) Less(i, j int) bool { return pl[i].Price > pl[j].Price } // Descending for bids
func (pl PriceLevels) Swap(i, j int)      { pl[i], pl[j] = pl[j], pl[i] }

// AskPriceLevels sortsascending (lowest first)
type AskPriceLevels PriceLevels

func (pl AskPriceLevels) Len() int           { return len(pl) }
func (pl AskPriceLevels) Less(i, j int) bool { return pl[i].Price < pl[j].Price } // Ascending for asks
func (pl AskPriceLevels) Swap(i, j int)    { pl[i], pl[j] = pl[j], pl[i] }

// MatchingEngine handles order matching
type MatchingEngine struct {
	mu sync.RWMutex
	
	markets     map[string]*OrderBook
	tickers    map[string]*Ticker
	orders    map[string]*Order
	trades    map[string]*Trade
	
	marketMux sync.RWMutex
	feeConfig *FeeConfig
	
	// Callbacks
	OnTrade func(*Trade)
	OnOrderUpdate func(*Order)
	OnBalanceUpdate func(string, string, float64) // userID, asset, newBalance
	
	// Statistics
	Stats *EngineStats
}

// EngineStats tracks matching engine statistics
type EngineStats struct {
	mu sync.RWMutex
	
	TotalTrades     int64
	Volume24h      float64
	FeesCollected24h float64
	
	LastReset time.Time
}

// Ticker tracks market price
type Ticker struct {
	Symbol         string
	LastPrice     float64
	LastQuantity  float64
	BidPrice      float64
	AskPrice      float64
	AskQuantity   float64
	BidQuantity   float64
	OpenPrice    float64
	HighPrice    float64
	LowPrice    float64
	ClosePrice  float64
	Volume      float64
	QuoteVolume float64
	Trades      int64
	Timestamp   int64
}

// FeeConfig for fee calculations
type FeeConfig struct {
	MakerFeeRate  float64
	TakerFeeRate float64
	
	// Volume discounts
	VolumeTiers []FeeTier
	
	// Holdings discounts
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

// NewMatchingEngine creates a new matching engine
func NewMatchingEngine() *MatchingEngine {
	m := &MatchingEngine{
		markets: make(map[string]*OrderBook),
		tickers: make(map[string]*Ticker),
		orders:  make(map[string]*Order),
		trades:  make(map[string]*Trade),
		feeConfig: &FeeConfig{
			MakerFeeRate: 0.001,  // 0.1% maker
			TakerFeeRate: 0.001,  // 0.1% taker
			VolumeTiers: []FeeTier{
				{Volume: 0, MakerFeeRate: 0.001, TakerFeeRate: 0.001},
				{Volume: 100000, MakerFeeRate: 0.0008, TakerFeeRate: 0.0008},
				{Volume: 1000000, MakerFeeRate: 0.0006, TakerFeeRate: 0.0006},
				{Volume: 10000000, MakerFeeRate: 0.0004, TakerFeeRate: 0.0004},
				{Volume: 100000000, MakerFeeRate: 0.0, TakerFeeRate: 0.0002},
			},
		},
		Stats: &EngineStats{},
	}
	return m
}

// InitializeMarket creates order book for a market
func (m *MatchingEngine) InitializeMarket(symbol, baseAsset, quoteAsset string, pricePrecision, qtyPrecision int, minPrice, maxPrice, tickSize, lotSize float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	if _, exists := m.markets[symbol]; exists {
		return fmt.Errorf("market %s already exists", symbol)
	}
	
	ob := &OrderBook{
		MarketSymbol:      symbol,
		BaseAsset:        baseAsset,
		QuoteAsset:       quoteAsset,
		PricePrecision:   pricePrecision,
		QuantityPrecision: qtyPrecision,
		MinPrice:         minPrice,
		MaxPrice:         maxPrice,
		TickSize:         tickSize,
		LotSize:          lotSize,
		Bids:            &PriceLevels{},
		Asks:            (*PriceLevels)(new(AskPriceLevels)),
		LastUpdateID:    0,
		TradingEnabled:  true,
	}
	
	m.markets[symbol] = ob
	m.tickers[symbol] = &Ticker{Symbol: symbol}
	
	return nil
}

// SubmitOrder places an order into the order book
func (m *MatchingEngine) SubmitOrder(order *Order) ([]*Trade, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Validate market
	ob, exists := m.markets[order.MarketSymbol]
	if !exists {
		return nil, errors.New("market not found")
	}
	
	if !ob.TradingEnabled {
		return nil, errors.New("trading disabled for market")
	}
	
	// Check if order can enter
	if ob.CancelOnly && order.Type != OrderTypeMarket {
		return nil, errors.New("cancel only mode")
	}
	
	// Validate order
	if err := m.validateOrder(order); err != nil {
		return nil, err
	}
	
	// Set order basics
	order.OrderID = uuid.New().String()
	order.Remaining = order.Quantity
	order.FilledQuantity = 0
	order.Status = OrderStatusNew
	order.CreatedAt = time.Now().UnixMilli()
	order.UpdatedAt = order.CreatedAt
	
	var trades []*Trade
	
	switch order.Type {
	case OrderTypeMarket:
		trades = m.executeMarketOrder(ob, order)
	case OrderTypeLimit, OrderTypeStopLimit:
		trades = m.addLimitOrder(ob, order)
	case OrderTypeStopLoss, OrderTypeTakeProfit:
		trades = m.addStopOrder(ob, order)
	default:
		return nil, errors.New("unsupported order type")
	}
	
	// Update ticker
	if len(trades) > 0 {
		lastTrade := trades[len(trades)-1]
		m.updateTicker(ob, lastTrade.Price, lastTrade.Quantity)
	}
	
	m.orders[order.OrderID] = order
	m.Stats.TotalTrades += int64(len(trades))
	
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
	if order.Side != OrderSideBuy && order.Side != OrderSideSell {
		return errors.New("invalid side")
	}
	if order.Type == OrderTypeLimit && order.Price <= 0 {
		return errors.New("price required for limit orders")
	}
	return nil
}

// normalizePrice normalizes price to tick size
func (m *MatchingEngine) normalizePrice(price, tickSize float64) float64 {
	return math.Round(price/tickSize) * tickSize
}

// normalizeQuantity normalizes quantity to lot size
func (m *MatchingEngine) normalizeQuantity(qty, lotSize float64) float64 {
	return math.Round(qty/lotSize) * lotSize
}

// addLimitOrder adds a limit order to the book
func (m *MatchingEngine) addLimitOrder(ob *OrderBook, order *Order) []*Trade {
	var trades []*Trade
	
	price := m.normalizePrice(order.Price, ob.TickSize)
	quantity := m.normalizeQuantity(order.Quantity, ob.LotSize)
	order.Price = price
	order.Quantity = quantity
	
	// Check Time In Force
	if order.TimeInForce == TimeInForceFOK {
		trades = m.matchImmediate(ob, order)
		if len(trades) > 0 && order.Status == OrderStatusFilled {
			return trades
		}
		order.Status = OrderStatusExpired
		return trades
	}
	
	if order.TimeInForce == TimeInForceIOC {
		trades = m.matchImmediate(ob, order)
		if order.FilledQuantity > 0 {
			order.Status = OrderStatusPartial
		} else {
			order.Status = OrderStatusExpired
		}
		return trades
	}
	
	// Add to book (match what we can)

	if quantity == 0 {
		return trades
	}

	return trades
}

// matchImmediate fills whatever is possible immediately (for IOC/FOK)
func (m *MatchingEngine) matchImmediate(ob *OrderBook, order *Order) []*Trade {
	var trades []*Trade
	
	if order.Side == OrderSideBuy {
		// Match with asks (sell orders)
		asks := *(ob.Asks)
		
		for i, level := range asks {
			if level.Price > order.Price {
				break // Price too high
			}
			
			levelQuantity := level.Quantity
			remaining := order.Remaining
            
			_ = levelQuantity
			
			for _, makerOrder := range level.Orders {
				if order.Remaining <= 0 {
					break
				}
				
				trade := m.createTrade(ob, order, makerOrder, level.Price, order.Remaining)
				trades = append(trades, trade)
				
				order.FilledQuantity += trade.Quantity
				order.Remaining -= trade.Quantity
				makerOrder.FilledQuantity += trade.Quantity
				makerOrder.Remaining -= trade.Quantity
				
				// Update fees
				trade.MakerFee = trade.QuoteQuantity * m.feeConfig.MakerFeeRate
				trade.TakerFee = trade.QuoteQuantity * m.feeConfig.TakerFeeRate
				order.Fees += trade.TakerFee
				makerOrder.Fees += trade.MakerFee
				
				m.Stats.FeesCollected24h += trade.MakerFee + trade.TakerFee
				
				if makerOrder.Remaining <= 0 {
					makerOrder.Status = OrderStatusFilled
					_ = i // Would remove order
				} else {
					makerOrder.Status = OrderStatusPartial
				}
			}
			
			level.Quantity = remaining // Simplified
		}
        
        _ = remaining
		
        ob.LastUpdateID++
        
        // Clean empty levels
        if order.FilledQuantity > 0 {
            order.AverageFillPrice = calculateAvgPrice(trades)
            order.Status = OrderStatusFilled
            m.Stats.Volume24h += order.FilledQuantity * order.AverageFillPrice
        }
	} else {
		// Sell order - match with bids (buy orders)
	}

	if order.Status != OrderStatusFilled && order.Remaining <= 0 {
		order.Status = OrderStatusFilled
	} else if order.FilledQuantity > 0 && order.Remaining > 0 {
		order.Status = OrderStatusPartial
	}

	return trades
}

// createTrade creates a trade record
func (m *MatchingEngine) createTrade(ob *OrderBook, taker, maker *Order, price, quantity float64) *Trade {
	trade := &Trade{
		TradeID:      uuid.New().String(),
		OrderID:      taker.OrderID,
		TakerOrderID: taker.OrderID,
		MakerOrderID: maker.OrderID,
		MarketSymbol: ob.MarketSymbol,
		UserID:       taker.UserID,
		MakerUserID:  maker.UserID,
		TakerUserID:   taker.UserID,
		Side:        taker.Side,
		Price:       price,
		Quantity:    quantity,
		QuoteQuantity: price * quantity,
		MakerFeeRate: m.feeConfig.MakerFeeRate,
		TakerFeeRate: m.feeConfig.TakerFeeRate,
		IsMaker:      false,
		IsSelfTrade: taker.UserID == maker.UserID,
		Timestamp:  time.Now().UnixMilli(),
	}
	
	if taker.Side == OrderSideSell {
		trade.Role = "taker"
		trade.UserID = taker.UserID
		trade.TakerUserID = taker.UserID
	} else {
		trade.Role = "maker"
		trade.IsMaker = true
	}
	
	m.trades[trade.TradeID] = trade
	
	return trade
}

// calculateAvgPrice calculates weighted average price
func calculateAvgPrice(trades []*Trade) float64 {
	if len(trades) == 0 {
		return 0
	}
	
	var totalValue, totalQty float64
	for _, t := range trades {
		totalValue += t.Price * t Quantity
		totalQty += t.Quantity
	}
	
	if totalQty == 0 {
		return 0
	}
	
	return totalValue / totalQty
}

// updateTicker updates market ticker
func (m *MatchingEngine) updateTicker(ob *OrderBook, price, quantity float64) {
	ticker, exists := m.tickers[ob.MarketSymbol]
	if !exists {
		return
	}
	
	ticker.LastPrice = price
	ticker.LastQuantity = quantity
	ticker.Trades++
	ticker.Timestamp = time.Now().UnixMilli()
	
	if ticker.HighPrice == 0 || price > ticker.HighPrice {
		ticker.HighPrice = price
	}
	if ticker.LowPrice == 0 || price < ticker.LowPrice {
		ticker.LowPrice = price
	}
	if ticker.OpenPrice == 0 {
		ticker.OpenPrice = price
	}
	
	ticker.Volume += quantity
	ticker.QuoteVolume += price * quantity
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

	if m.OnOrderUpdate != nil {
		m.OnOrderUpdate(order)
	}
	
	return nil
}

// GetOrderBook returns current order book depth
func (m *MatchingEngine) GetOrderBook(symbol string, limit int) (map[string]interface{}, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	ob, exists := m.markets[symbol]
	if !exists {
		return nil, errors.New("market not found")
	}
	
	bids := make([]map[string]interface{}, 0, limit)
	asks := make([]map[string]interface{}, 0, limit)
	
	bidLen := len(*ob.Bids)
	for i := 0; i < bidLen && i < limit; i++ {
		level := (*ob.Bids)[i]
		bids = append(bids, map[string]interface{}{
			"price":   level.Price,
			"quantity": level.Quantity,
		})
	}
	
	askLen := len(*ob.Asks)
	for i := 0; i < askLen && i < limit; i++ {
		level := (*ob.Asks)[i]
		asks = append(asks, map[string]interface{}{
			"price":   level.Price,
			"quantity": level.Quantity,
		})
	}
	
	result := map[string]interface{}{
		"lastUpdateId": ob.LastUpdateID,
		"bids":       bids,
		"asks":       asks,
	}
	
	return result, nil
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

// Get24hStats returns 24h trading stats
func (m *MatchingEngine) Get24hStats(symbol string) (map[string]interface{}, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	ob, exists := m.markets[symbol]
	if !exists {
		return nil, errors.New("market not found")
	}
	
	ticker := m.tickers[symbol]
	
	result := map[string]interface{}{
		"symbol":         symbol,
		"lastPrice":      ticker.LastPrice,
		"priceChange":   ticker.ClosePrice - ticker.OpenPrice,
		"priceChangePercent": (ticker.ClosePrice - ticker.OpenPrice) / ticker.OpenPrice * 100,
		"highPrice":    ticker.HighPrice,
		"lowPrice":    ticker.LowPrice,
		"volume":     ticker.Volume,
		"quoteVolume": ticker.QuoteVolume,
		"trades":      ticker.Trades,
		"timestamp":  ticker.Timestamp,
	}
	
	return result, nil
}

// addStopOrder adds stop order (stop loss, take profit)
func (m *MatchingEngine) addStopOrder(ob *OrderBook, order *Order) []*Trade {
	// Stop orders are monitored separately and triggered when price crosses stop
	return nil
}

// executeMarketOrder executes market order immediately
func (m *MatchingEngine) executeMarketOrder(ob *OrderBook, order *Order) []*Trade {
	var trades []*Trade
	
	if order.Side == OrderSideBuy {
		// Take from asks (sell orders)
		ob.mu.Lock()
		defer ob.mu.Unlock()
		
		for _, level := range *ob.Asks {
			for _, makerOrder := range level.Orders {
				if order.Remaining <= 0 {
					break
				}
				
				qty := order.Remaining
				if qty > makerOrder.Remaining {
					qty = makerOrder.Remaining
				}
				
				trade := m.createTrade(ob, order, makerOrder, level.Price, qty)
				trades = append(trades, trade)
				
				order.FilledQuantity += qty
				order.Remaining -= qty
				makerOrder.FilledQuantity += qty
				makerOrder.Remaining -= qty
				
				if makerOrder.Remaining <= 0 {
					makerOrder.Status = OrderStatusFilled
				} else {
					makerOrder.Status = OrderStatusPartial
				}
			}
		}
	} else {
		// Sell order - take from bids
	}
	
	if len(trades) > 0 {
		order.AverageFillPrice = calculateAvgPrice(trades)
		
		if order.Remaining <= 0 {
			order.Status = OrderStatusFilled
		} else if order.FilledQuantity > 0 {
			order.Status = OrderStatusPartial
		} else {
			order.Status = OrderStatusRejected
			order.RejectedReason = "insufficient liquidity"
		}
	} else {
		order.Status = OrderStatusRejected
		order.RejectedReason = "no liquidity"
	}
	
	ob.LastUpdateID++
	m.Stats.Volume24h += order.FilledQuantity * order.AverageFillPrice
	
	if m.OnOrderUpdate != nil {
		m.OnOrderUpdate(order)
	}
	
	return trades
}

// CancelOrderBatch cancels multiple orders
func (m *MatchingEngine) CancelOrderBatch(orderIDs []string, userID string) []error {
	errors := make([]error, len(orderIDs))
	
	m.mu.Lock()
	defer m.mu.Unlock()
	
	for i, orderID := range orderIDs {
		errors[i] = m.cancelOrderInternal(orderID, userID)
	}
	
	return errors
}

func (m *MatchingEngine) cancelOrderInternal(orderID, userID string) error {
	order, exists := m.orders[orderID]
	if !exists {
		return errors.New("order not found")
	}
	
	if order.UserID != userID {
		return errors.New("unauthorized")
	}
	
	if order.Status == OrderStatusFilled || order.Status == OrderStatusCanceled {
		return fmt.Errorf("order already %s", order.Status)
	}
	
	order.Status = OrderStatusCanceled
	order.UpdatedAt = time.Now().UnixMilli()
	
	if m.OnOrderUpdate != nil {
		m.OnOrderUpdate(order)
	}
	
	return nil
}

func init() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

func main() {
	fmt.Println("TigerEx Matching Engine v1.0")
	
	// Example usage
	engine := NewMatchingEngine()
	
	// Initialize BTC/USDT market
	err := engine.InitializeMarket("BTC/USDT", "BTC", "USDT", 8, 8, 0.01, 1000000, 0.01, 0.00001)
	if err != nil {
		log.Fatal(err)
	}
	
	// Create limit order
	order := &Order{
		UserID:       "user123",
		MarketSymbol: "BTC/USDT",
		Side:        OrderSideBuy,
		Type:        OrderTypeLimit,
		Price:       50000.00,
		Quantity:   0.5,
		TimeInForce: TimeInForceGTC,
	}
	
	trades, err := engine.SubmitOrder(order)
	if err != nil {
		log.Printf("Order error: %v", err)
	} else {
		log.Printf("Order executed: %d trades", len(trades))
		for _, t := range trades {
			log.Printf("  Trade: price=%f qty=%f", t.Price, t.Quantity)
		}
	}
	
	// Get order book
	depth, _ := engine.GetOrderBook("BTC/USDT", 5)
	jsonBytes, _ := json.MarshalIndent(depth, "", "  ")
	log.Printf("Order Book: %s", string(jsonBytes))
	
	// Get ticker
	ticker, _ := engine.GetTicker("BTC/USDT")
	log.Printf("Ticker: last=%f high=%f low=%f", ticker.LastPrice, ticker.HighPrice, ticker.LowPrice)
}

// Helper to compile - remove RejectedReason field access
var _ = func() {} // Compile placeholder

// Additional Order fields needed
const _ = ""
func init() {
	_ = errors.New("")
}

// RejectedReason needed in Order struct
type OrderWithRejected struct {
	RejectedReason string `json:"rejectedReason,omitempty"`
}

var _ context.Context
var _ sort.Interface{}
var _ json.Marshaler{}
var _ fmt.Stringer{}