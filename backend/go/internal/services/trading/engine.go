package main

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ============ ORDER BOOK (Go - High Performance) ============

type PriceLevel struct {
	Price    float64
	Quantity float64
	Orders   int
}

type Order struct {
	ID            string
	UserID        string
	Symbol        string
	Side          string  // buy, sell
	Type          string  // market, limit
	Price         float64
	Quantity      float64
	FilledQty     float64
	AvgPrice     float64
	Status       string  // pending, filled, cancelled
	TimeInForce  string  // gtc, ioc, fok
	StopPrice    float64
	CreatedAt    int64
	UpdatedAt   int64
}

type Trade struct {
	ID          string
	OrderID    string
	UserID     string
	Symbol     string
	Side       string
	Price      float64
	Quantity   float64
	Fee        float64
	FeeCurrency string
	Role       string  // maker, taker
	Timestamp  int64
}

type OrderBook struct {
	sync.RWMutex
	Symbol    string
	Bids      map[float64]*PriceLevel  // sorted ascending
	Asks      map[float64]*PriceLevel  // sorted ascending
	Orders    map[string]*Order
	Trades    []Trade
	lastTradeID int64
	lastOrdID  int64
}

func NewOrderBook(symbol string) *OrderBook {
	return &OrderBook{
		Symbol: symbol,
		Bids:   make(map[float64]*PriceLevel),
		Asks:   make(map[float64]*PriceLevel),
		Orders: make(map[string]*Order),
	}
}

func (ob *OrderBook) AddOrder(o *Order) bool {
	o.ID = fmt.Sprintf("ord_%d", ob.lastOrdID)
	o.CreatedAt = time.Now().Unix()
	o.Status = "open"
	
	ob.Orders[o.ID] = o
	
	// Add to book for limit orders
	if o.Type == "limit" {
		ob.addToBook(o)
	}
	
	return true
}

func (ob *OrderBook) addToBook(o *Order) {
	book := ob.Bids
	if o.Side == "sell" {
		book = ob.Asks
	}
	
	if level, ok := book[o.Price]; ok {
		level.Quantity += o.Quantity
		level.Orders++
	} else {
		book[o.Price] = &PriceLevel{
			Price:    o.Price,
			Quantity: o.Quantity,
			Orders:   1,
		}
	}
}

func (ob *OrderBook) removeFromBook(o *Order) {
	book := ob.Bids
	if o.Side == "sell" {
		book = ob.Asks
	}
	
	if level, ok := book[o.Price]; ok {
		level.Quantity -= o.Quantity
		if level.Quantity <= 0 {
			delete(book, o.Price)
		}
	}
}

func (ob *OrderBook) MatchOrders() []Trade {
	ob.Lock()
	defer ob.Unlock()
	
	var trades []Trade
	
	// Match buy orders with lowest asks, sell orders with highest bids
	for _, o := range ob.Orders {
		if o.FilledQty >= o.Quantity || o.Status == "filled" {
			continue
		}
		
		var matched bool
		if o.Side == "buy" {
			matched = ob.matchBuyOrder(o)
		} else {
			matched = ob.matchSellOrder(o)
		}
		
		if o.FilledQty >= o.Quantity {
			o.Status = "filled"
			ob.removeFromBook(o)
		}
	}
	
	ob.Trades = append(ob.Trades, trades...)
	return trades
}

func (ob *OrderBook) matchBuyOrder(o *Order) bool {
	matched := false
	
	for price, level := range ob.Asks {
		if o.Type == "limit" && price > o.Price {
			break
		}
		if o.Type == "limit" && price > o.Price {
			continue
		}
		
		// Find match
		remainQty := o.Quantity - o.FilledQty
		fillQty := math.Min(remainQty, level.Quantity)
		
		o.AvgPrice = (o.AvgPrice*o.FilledQty + price*fillQty) / (o.FilledQty + fillQty)
		o.FilledQty += fillQty
		
		timestamp := time.Now().Unix()
		ob.lastTradeID++
		trade := Trade{
			ID:          fmt.Sprintf("t%d", ob.lastTradeID),
			OrderID:     o.ID,
			UserID:      o.UserID,
			Symbol:     o.Symbol,
			Side:       "buy",
			Price:      price,
			Quantity:   fillQty,
			Fee:        fillQty * price * 0.001,
			FeeCurrency: "USDT",
			Role:       "taker",
			Timestamp:  timestamp,
		}
		ob.Trades = append(ob.Trades, trade)
		
		level.Quantity -= fillQty
		if level.Quantity <= 0 {
			delete(ob.Asks, price)
		}
		
		matched = true
		if o.FilledQty >= o.Quantity {
			break
		}
	}
	
	return matched
}

func (ob *OrderBook) matchSellOrder(o *Order) bool {
	matched := false
	
	prices := make([]float64, 0, len(ob.Bids))
	for p := range ob.Bids {
		positions = append(positions, p)
	}
	sort.Float64s(positions)
	
	for _, price := range positions {
		level := ob.Bids[price]
		
		if o.Type == "limit" && price < o.Price {
			continue
		}
		
		remainQty := o.Quantity - o.FilledQty
		fillQty := math.Min(remainQty, level.Quantity)
		
		o.AvgPrice = (o.AvgPrice*o.FilledQty + price*fillQty) / (o.FilledQty + fillQty)
		o.FilledQty += fillQty
		
		timestamp := time.Now().Unix()
		ob.lastTradeID++
		trade := Trade{
			ID:          fmt.Sprintf("t%d", ob.lastTradeID),
			OrderID:     o.ID,
			UserID:      o.UserID,
			Symbol:     o.Symbol,
			Side:       "sell",
			Price:      price,
			Quantity:   fillQty,
			Fee:        fillQty * price * 0.001,
			FeeCurrency: "USDT",
			Role:       "taker",
			Timestamp:  timestamp,
		}
		ob.Trades = append(ob.Trades, trade)
		
		level.Quantity -= fillQty
		if level.Quantity <= 0 {
			delete(ob.Bids, price)
		}
		
		matched = true
		if o.FilledQty >= o.Quantity {
			break
		}
	}
	
	return matched
}

func (ob *OrderBook) CancelOrder(orderID string) bool {
	ob.Lock()
	defer ob.Unlock()
	
	order, ok := ob.Orders[orderID]
	if !ok {
		return false
	}
	
	if order.Status == "filled" {
		return false
	}
	
	order.Status = "cancelled"
	ob.removeFromBook(order)
	return true
}

func (ob *OrderBook) GetDepth(levels int) (bids, asks []PriceLevel) {
	ob.RLock()
	defer ob.RUnlock()
	
	// Sort bid prices descending
	bidPrices := make([]float64, 0, len(ob.Bids))
	for p := range ob.Bids {
		bidPrices = append(bidPrices, p)
	}
	sort.Float64s(bidPrices)
	
	// Sort ask prices ascending  
	askPrices := make([]float64, 0, len(ob.Asks))
	for p := range ob.Asks {
		askPrices = append(askPrices, p)
	}
	sort.Float64s(askPrices)
	
	for i := len(bidPrices) - 1; i >= 0 && len(bids) < levels; i-- {
		bids = append(bids, *ob.Bids[bidPrices[i]])
	}
	
	for i := 0; i < len(askPrices) && len(asks) < levels; i++ {
		asks = append(asks, *ob.Asks[askPrices[i]])
	}
	
	return
}

func (ob *OrderBook) GetRecentTrades(limit int) []Trade {
	ob.RLock()
	defer ob.RUnlock()
	
	start := len(ob.Trades) - limit
	if start < 0 {
		start = 0
	}
	
	return ob.Trades[start:]
}

// ============ Trading Engine API ============

type TradingEngine struct {
	Books   map[string]*OrderBook
	Matches map[string]*MatchEngine
	sync.RWMutex
}

func NewTradingEngine() *TradingEngine {
	te := &TradingEngine{
		Books:   make(map[string]*OrderBook),
		Matches: make(map[string]*MatchEngine),
	}
	
	// Initialize default markets
	defaults := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT"}
	for _, sym := range defaults {
		te.Books[sym] = NewOrderBook(sym)
		te.Matches[sym] = &MatchEngine{
			Symbol: sym,
		}
	}
	
	return te
}

func (te *TradingEngine) CreateOrder(req CreateOrderReq) (*Order, []Trade, error) {
	te.Lock()
	defer te.Unlock()
	
	book, ok := te.Books[req.Symbol]
	if !ok {
		book = NewOrderBook(req.Symbol)
		te.Books[req.Symbol] = book
	}
	
	// Parse price/quantity
	price, _ := strconv.ParseFloat(req.Price, 64)
	qty, _ := strconv.ParseFloat(req.Quantity, 64)
	
	order := &Order{
		UserID:       req.UserID,
		Symbol:      req.Symbol,
		Side:       req.Side,
		Type:       req.Type,
		Price:      price,
		Quantity:   qty,
		FilledQty:   0,
		AvgPrice:   0,
		Status:     "pending",
		TimeInForce: req.TimeInForce,
	}
	
	if req.StopPrice != "" {
		order.StopPrice, _ = strconv.ParseFloat(req.StopPrice, 64)
	}
	
	book.AddOrder(order)
	trades := book.MatchOrders()
	
	return order, trades, nil
}

func (te *TradingEngine) CancelOrder(symbol, orderID string) bool {
	te.Lock()
	defer te.Unlock()
	
	book, ok := te.Books[symbol]
	if !ok {
		return false
	}
	
	return book.CancelOrder(orderID)
}

func (te *TradingEngine) GetOrder(symbol, orderID string) *Order {
	te.RLock()
	defer te.RUnlock()
	
	book, ok := te.Books[symbol]
	if !ok {
		return nil
	}
	
	return book.Orders[orderID]
}

func (te *TradingEngine) GetOrders(symbol, userID, status string) []*Order {
	te.RLock()
	defer te.RUnlock()
	
	book, ok := te.Books[symbol]
	if !ok {
		return nil
	}
	
	var result []*Order
	for _, o := range book.Orders {
		if o.UserID == userID && (status == "" || o.Status == status) {
			result = append(result, o)
		}
	}
	
	return result
}

func (te *TradingEngine) GetTrades(symbol string, limit int) []Trade {
	te.RLock()
	defer te.RUnlock()
	
	book, ok := te.Books[symbol]
	if !ok {
		return nil
	}
	
	return book.GetRecentTrades(limit)
}

func (te *TradingEngine) GetOrderBook(symbol string, limit int) (bids, asks []PriceLevel) {
	te.RLock()
	defer te.RUnlock()
	
	book, ok := te.Books[symbol]
	if !ok {
		return
	}
	
	return book.GetDepth(limit)
}

type MatchEngine struct {
	Symbol   string
	Trades   []Trade
	lastTicker Ticker
	lastFunding FundingRate
	sync.RWMutex
}

type Ticker struct {
	Symbol          string
	LastPrice      float64
	PriceChange    float64
	ChangePercent Float64
	HighPrice     float64
	LowPrice      float64
	Volume        float64
	QuoteVolume   float64
}

type FundingRate struct {
	Symbol          string
	FundingRate   float64
	NextFunding  int64
	Predicted    float64
}

func (me *MatchEngine) UpdateFunding(rate float64) {
	me.Lock()
	defer me.Unlock()
	
	me.lastFunding.FundingRate = rate
	me.lastFunding.Predicted = rate
	me.lastFunding.NextFunding = time.Now().Add(8 * time.Hour).Unix()
}

func (me *MatchEngine) UpdatePrices(last, high, low, vol, qvol float64) {
	me.Lock()
	defer me.Unlock()
	
	changePercent := (last - me.lastTicker.LastPrice) / me.lastTicker.LastPrice * 100
	
	me.lastTicker = Ticker{
		lastTicker.Symbol,
		last,
		last - me.lastTicker.LastPrice,
		changePercent,
		high,
		low,
		vol,
		qvol,
	}
	req := struct {
	Symbol string `json:"symbol"`
	Side string `json:"side"`
	Type string `json:"type"`
	Price string `json:"price"`
	Quantity string `json:"quantity"`
	TimeInForce string `json:"time_in_force"`
	}{}

type CreateOrderReq struct {
	UserID      string `json:"user_id"`
	Symbol     string `json:"symbol"`
	Side       string `json:"side"`
	Type       string `json:"type"`
	Price      string `json:"price"`
	Quantity   string `json:"quantity"`
	StopPrice  string `json:"stop_price,omitempty"`
	TimeInForce string `json:"time_in_force"`
}

type CreateOrderResp struct {
	Order Order   `json:"order"`
	Trades []Trade `json:"trades"`
}