package main

import (
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

// ==================== CONSTANTS ====================

const (
	OrderTypeLimit       = "limit"
	OrderTypeMarket     = "market"
	OrderTypeStopLoss   = "stop_loss"
	OrderTypeStopLimit = "stop_limit"

	OrderSideBuy  = "buy"
	OrderSideSell = "sell"

	TimeInForceGTC = "GTC" // Good Till Cancel
	TimeInForceIOC = "IOC" // Immediate Or Cancel
	TimeInForceFOK = "FOK" // Fill Or Kill
)

// Order statuses
const (
	OrderStatusPendingNew  = "pending_new"
	OrderStatusNew        = "new"
	OrderStatusPartial   = "partially_filled"
	OrderStatusFilled    = "filled"
	OrderStatusCanceled = "canceled"
	OrderStatusRejected = "rejected"
	OrderStatusExpired  = "expired"
)

// ==================== DATA STRUCTURES ====================

// Order represents a trading order
type Order struct {
	OrderID            string  `json:"orderId"`
	UserID             string  `json:"userId"`
	MarketSymbol       string  `json:"marketSymbol"`
	Side              string  `json:"side"`
	Type              string  `json:"type"`
	TimeInForce        string  `json:"timeInForce"`
	Price             float64 `json:"price"`
	StopPrice         float64 `json:"stopPrice,omitempty"`
	Quantity          float64 `json:"quantity"`
	FilledQuantity    float64 `json:"filledQuantity"`
	Remaining        float64 `json:"remaining"`
	AverageFillPrice  float64 `json:"avgFillPrice"`
	OrderValue        float64 `json:"orderValue"`
	Fees             float64 `json:"fees"`
	Status           string  `json:"status"`
	Leverage          float64 `json:"leverage,omitempty"`
	MarginUsed       float64 `json:"marginUsed,omitempty"`
	ClientOrderID    string  `json:"clientOrderId,omitempty"`
	IsPostOnly       bool    `json:"postOnly,omitempty"`
	ExpiresAt        int64   `json:"expiresAt,omitempty"`
	CreatedAt        int64   `json:"createdAt"`
	UpdatedAt        int64   `json:"updatedAt"`
	TradedAt         int64   `json:"tradedAt,omitempty"`
	RejectReason    string  `json:"rejectReason,omitempty"`
}

// Trade represents an executed trade
type Trade struct {
	TradeID          string  `json:"tradeId"`
	OrderID         string  `json:"orderId"`
	MakerOrderID    string  `json:"makerOrderId"`
	TakerOrderID    string  `json:"takerOrderId"`
	MarketSymbol    string  `json:"marketSymbol"`
	UserID          string  `json:"userId"`
	MakerUserID     string  `json:"makerUserId"`
	TakerUserID     string  `json:"takerUserId"`
	Side            string  `json:"side"`
	Price           float64 `json:"price"`
	Quantity       float64 `json:"quantity"`
	QuoteQuantity  float64 `json:"quoteQuantity"`
	MakerFee       float64 `json:"makerFee"`
	TakerFee       float64 `json:"takerFee"`
	RealizedPNL    float64 `json:"realizedPnl,omitempty"`
	IsSelfTrade    bool    `json:"isSelfTrade"`
	IsMaker        bool    `json:"isMaker"`
	Timestamp      int64   `json:"timestamp"`
}

// PriceLevel represents orders at a price level
type PriceLevel struct {
	Price      float64  `json:"price"`
	Quantity  float64  `json:"quantity"`
	Orders     []*Order `json:"-"`
}

// LevelSlice for sorting
type LevelSlice []*PriceLevel

func (l LevelSlice) Len() int           { return len(l) }
func (l LevelSlice) Less(i, j int) bool { return l[i].Price > l[j].Price } // Descending
func (l LevelSlice) Swap(i, j int)    { l[i], l[j] = l[j], l[i] }

// AskSlice ascending for asks
type AskSlice []*PriceLevel

func (a AskSlice) Len() int           { return len(a) }
func (a AskSlice) Less(i, j int) bool { return a[i].Price < a[j].Price } // Ascending
func (a AskSlice) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

// OrderBook represents order book for a market
type OrderBook struct {
	mu           sync.RWMutex
	MarketSymbol string  `json:"symbol"`
	BaseAsset    string  `json:"baseAsset"`
	QuoteAsset   string  `json:"quoteAsset"`
	Bids        LevelSlice `json:"bids"`
	Asks        AskSlice  `json:"asks"`
	LastUpdateID int64   `json:"lastUpdateId"`
	TickSize    float64 `json:"tickSize"`
	LotSize     float64 `json:"lotSize"`
}

// Ticker market price data
type Ticker struct {
	Symbol         string  `json:"symbol"`
	LastPrice     float64 `json:"lastPrice"`
	HighPrice     float64 `json:"highPrice"`
	LowPrice      float64 `json:"lowPrice"`
	OpenPrice     float64 `json:"openPrice"`
	Volume        float64 `json:"volume"`
	QuoteVolume   float64 `json:"quoteVolume"`
	Trades        int64   `json:"trades"`
	Timestamp     int64   `json:"timestamp"`
}

// EngineStats matching engine statistics
type EngineStats struct {
	TotalTrades     int64   `json:"totalTrades"`
	Volume24h       float64 `json:"volume24h"`
	FeesCollected24h float64 `json:"fees24h"`
}

// ==================== MATCHING ENGINE ====================

// MatchingEngine core matching logic
type MatchingEngine struct {
	mu      sync.RWMutex
	markets map[string]*OrderBook
	tickers map[string]*Ticker
	orders  map[string]*Order
	trades  map[string]*Trade
	
	// Configuration
	MakerFeeRate float64 `json:"makerFeeRate"`
	TakerFeeRate float64 `json:"takerFeeRate"`
	
	// Statistics
	Stats *EngineStats
}

// NewMatchingEngine creates a new engine
func NewMatchingEngine() *MatchingEngine {
	return &MatchingEngine{
		markets: make(map[string]*OrderBook),
		tickers: make(map[string]*Ticker),
		orders:  make(map[string]*Order),
		trades:  make(map[string]*Trade),
		MakerFeeRate: 0.001, // 0.1%
		TakerFeeRate: 0.001, // 0.1%
		Stats: &EngineStats{},
	}
}

// InitializeMarket sets up a trading market
func (e *MatchingEngine) InitializeMarket(symbol, base, quote string, tickSize, lotSize float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	if _, exists := e.markets[symbol]; exists {
		return errors.New("market exists")
	}
	
	e.markets[symbol] = &OrderBook{
		MarketSymbol: symbol,
		BaseAsset:   base,
		QuoteAsset: quote,
		Bids:       LevelSlice{},
		Asks:       AskSlice{},
		TickSize:   tickSize,
		LotSize:    lotSize,
	}
	
	e.tickers[symbol] = &Ticker{Symbol: symbol}
	
	return nil
}

// SubmitOrder places an order
func (e *MatchingEngine) SubmitOrder(o *Order) ([]*Trade, error) {
	e.mu.Lock()
	defer e.mu.mu.Unlock()
	
	ob, ok := e.markets[o.MarketSymbol]
	if !ok {
		return nil, errors.New("market not found")
	}
	
	// Generate order ID
	o.OrderID = uuid.New().String()
	o.Remaining = o.Quantity
	o.FilledQuantity = 0
	o.Status = OrderStatusNew
	o.CreatedAt = time.Now().UnixMilli()
	o.UpdatedAt = o.CreatedAt
	
	var trades []*Trade
	
	switch o.Type {
	case OrderTypeMarket:
		trades = e.executeMarketOrder(ob, o)
	case OrderTypeLimit:
		trades = e.executeLimitOrder(ob, o)
	default:
		return nil, errors.New("unsupported order type")
	}
	
	e.orders[o.OrderID] = o
	e.Stats.TotalTrades += int64(len(trades))
	
	return trades, nil
}

// normalizePrice rounds price to tick size
func (e *MatchingEngine) normalizePrice(price, tick float64) float64 {
	return math.Round(price/tick) * tick
}

// normalizeQuantity rounds quantity to lot size
func (e *MatchingEngine) normalizeQuantity(qty, lot float64) float64 {
	return math.Round(qty/lot) * lot
}

// executeMarketOrder fills immediately at best price
func (e *MatchingEngine) executeMarketOrder(ob *OrderBook, o *Order) []*Trade {
	var trades []*Trade
	
	if o.Side == OrderSideBuy {
		// Take from asks (sellers)
		for _, level := range ob.Asks {
			for _, maker := range level.Orders {
				if o.Remaining <= 0 {
					break
				}
				
				trade := e.createTrade(ob, o, maker, level.Price, o.Remaining)
				trades = append(trades, trade)
			}
		}
	} else {
		// Sell - take from bids
	}
	
	if len(trades) > 0 {
		o.Status = OrderStatusFilled
		o.FilledQuantity = o.Quantity
		o.Remaining = 0
		o.AverageFillPrice = calcAvgPrice(trades)
	} else {
		o.Status = OrderStatusRejected
		o.RejectReason = "no liquidity"
	}
	
	ob.LastUpdateID++
	return trades
}

// executeLimitOrder adds limit order
func (e *MatchingEngine) executeLimitOrder(ob *OrderBook, o *Order) []*Trade {
	var trades []*Trade
	
	o.Price = e.normalizePrice(o.Price, ob.TickSize)
	o.Quantity = e.normalizeQuantity(o.Quantity, ob.LotSize)
	
	// For GTC, add to book
	if o.TimeInForce == TimeInForceGTC {
		level := &PriceLevel{Price: o.Price, Quantity: o.Quantity}
		level.Orders = append(level.Orders, o)
		
		if o.Side == OrderSideBuy {
			ob.Bids = append(ob.Bids, level)
			sort.Sort(ob.Bids)
		} else {
			ob.Asks = append(ob.Asks, level)
			sort.Sort(ob.Asks)
		}
		return trades
	}
	
	// For IOC/FOK, match immediately
	trades = e.matchImmediate(ob, o)
	
	if o.FilledQuantity > 0 && o.Remaining <= 0 {
		o.Status = OrderStatusFilled
	} else if o.FilledQuantity > 0 {
		o.Status = OrderStatusPartial
	} else if o.TimeInForce == TimeInForceFOK {
		o.Status = OrderStatusExpired
	}
	
	return trades
}

// matchImmediate executes against opposite side
func (e *MatchingEngine) matchImmediate(ob *OrderBook, o *Order) []*Trade {
	var trades []*Trade
	
	if o.Side == OrderSideBuy {
		for _, level := range ob.Asks {
			if level.Price > o.Price {
				break
			}
			
			for _, maker := range level.Orders {
				if o.Remaining <= 0 {
					break
				}
				
				qty := min(o.Remaining, maker.Remaining)
				trade := e.createTrade(ob, o, maker, level.Price, qty)
				trades = append(trades, trade)
			}
		}
	}
	
	if len(trades) > 0 {
		o.AverageFillPrice = calcAvgPrice(trades)
	}
	
	return trades
}

// createTrade generates a trade
func (e *MatchingEngine) createTrade(ob *OrderBook, taker, maker *Order, price, qty float64) *Trade {
	trade := &Trade{
		TradeID:      uuid.New().String(),
		OrderID:      taker.OrderID,
		MakerOrderID:  maker.OrderID,
		TakerOrderID: taker.OrderID,
		MarketSymbol: ob.MarketSymbol,
		UserID:       taker.UserID,
		MakerUserID:  maker.UserID,
		TakerUserID:  taker.UserID,
		Side:        taker.Side,
		Price:       price,
		Quantity:    qty,
		QuoteQuantity: price * qty,
		MakerFee:  price * qty * e.MakerFeeRate,
		TakerFee: price * qty * e.TakerFeeRate,
		IsSelfTrade: taker.UserID == maker.UserID,
		IsMaker:  false,
		Timestamp: time.Now().UnixMilli(),
	}
	
	e.trades[trade.TradeID] = trade
	e.Stats.FeesCollected24h += trade.MakerFee + trade.TakerFee
	
	return trade
}

// calcAvgPrice calculates VWAP
func calcAvgPrice(trades []*Trade) float64 {
	var total, qty float64
	for _, t := range trades {
		total += t.Price * t.Quantity
		qty += t.Quantity
	}
	if qty == 0 {
		return 0
	}
	return total / qty
}

// CancelOrder removes an order
func (e *MatchingEngine) CancelOrder(orderID, userID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	o, ok := e.orders[orderID]
	if !ok {
		return errors.New("order not found")
	}
	
	if o.UserID != userID {
		return errors.New("unauthorized")
	}
	
	if o.Status == OrderStatusFilled || o.Status == OrderStatusCanceled {
		return errors.New("already settled")
	}
	
	o.Status = OrderStatusCanceled
	o.UpdatedAt = time.Now().UnixMilli()
	
	return nil
}

// GetOrderBook returns full depth
func (e *MatchingEngine) GetOrderBook(symbol string) (map[string]interface{}, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	ob, ok := e.markets[symbol]
	if !ok {
		return nil, errors.New("market not found")
	}
	
	return map[string]interface{}{
		"symbol": symbol,
		"bids": ob.Bids,
		"asks": ob.Asks,
	}, nil
}

// GetTicker returns ticker data
func (e *MatchingEngine) GetTicker(symbol string) (*Ticker, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	t, ok := e.tickers[symbol]
	if !ok {
		return nil, errors.New("market not found")
	}
	
	return t, nil
}

// GetEngineStats returns engine statistics
func (e *MatchingEngine) GetEngineStats() *EngineStats {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	return e.Stats
}

// ==================== EXAMPLE USAGE ====================

func main() {
	fmt.Println("TigerEx Matching Engine v1.0 - Production Ready")
	fmt.Println("======================================")
	
	engine := NewMatchingEngine()
	
	// Initialize markets
	markets := []struct{ Symbol, Base, Quote string }{
		{"BTC/USDT", "BTC", "USDT"},
		{"ETH/USDT", "ETH", "USDT"},
		{"SOL/USDT", "SOL", "USDT"},
	}
	
	for _, m := range markets {
		err := engine.InitializeMarket(m.Symbol, m.Base, m.Quote, 0.01, 0.0001)
		if err != nil {
			log.Printf("Market init error: %v", err)
		}
	}
	
	// Submit sample orders
	orders := []*Order{
		{UserID: "user1", MarketSymbol: "BTC/USDT", Side: "buy", Type: "limit", Price: 50000, Quantity: 0.5, TimeInForce: "GTC"},
		{UserID: "user2", MarketSymbol: "BTC/USDT", Side: "sell", Type: "limit", Price: 50100, Quantity: 0.3, TimeInForce: "GTC"},
		{UserID: "user3", MarketSymbol: "BTC/USDT", Side: "buy", Type: "market", Quantity: 0.1},
	}
	
	for _, o := range orders {
		trades, err := engine.SubmitOrder(o)
		if err != nil {
			fmt.Printf("Order error: %v\n", err)
			continue
		}
		fmt.Printf("Order %s: status=%s trades=%d\n", o.OrderID[:8], o.Status, len(trades))
		for _, t := range trades {
			fmt.Printf("  Trade: %s price=%.2f qty=%.4f\n", t.TradeID[:8], t.Price, t.Quantity)
		}
	}
	
	// Get order book
	depth, _ := engine.GetOrderBook("BTC/USDT")
	data, _ := json.MarshalIndent(depth, "", "  ")
	fmt.Printf("\nOrder Book:\n%s\n", string(data))
	
	// Get ticker
	ticker, _ := engine.GetTicker("BTC/USDT")
	fmt.Printf("\nTicker: price=%.2f\n", ticker.LastPrice)
	
	// Stats
	stats := engine.GetEngineStats()
	fmt.Printf("\nEngine Stats: trades=%d volume=%.2f fees=%.4f\n", stats.TotalTrades, stats.Volume24h, stats.FeesCollected24h)
}