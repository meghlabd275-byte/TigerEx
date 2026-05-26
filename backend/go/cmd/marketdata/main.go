// Package main provides Market Data Aggregation Service
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"time"
)

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type MarketData struct {
	Symbol string  `json:"symbol"`
	Price  float64 `json:"price"`
	Volume float64 `json:"volume"`
	Time   int64   `json:"time"`
}

type Ticker struct {
	Symbol          string  `json:"symbol"`
	LastPrice      float64 `json:"lastPrice"`
	PriceChange    float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	High24h        float64 `json:"high24h"`
	Low24h         float64 `json:"low24h"`
	Volume24h      float64 `json:"volume24h"`
	QuoteVolume24h float64 `json:"quoteVolume24h"`
	Trades24h      int     `json:"trades24h"`
	Timestamp      int64   `json:"timestamp"`
}

type Trade struct {
	ID        string  `json:"id"`
	Symbol   string  `json:"symbol"`
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	IsBuyerMaker bool  `json:"isBuyerMaker"`
	Time     int64   `json:"time"`
}

type OrderBook struct {
	Symbol    string       `json:"symbol"`
	Bids      []OrderLevel `json:"bids"`
	Asks      []OrderLevel `json:"asks"`
	LastUpdateID int64    `json:"lastUpdateId"`
}

type OrderLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

type Kline struct {
	Symbol         string  `json:"symbol"`
	OpenTime      int64   `json:"openTime"`
	Open          float64 `json:"open"`
	High          float64 `json:"high"`
	Low           float64 `json:"low"`
	Close         float64 `json:"close"`
	Volume        float64 `json:"volume"`
	QuoteVolume   float64 `json:"quoteVolume"`
	Trades        int     `json:"trades"`
	KlineCallapse string  `json:"klineCallapse"`
	Timestamp    int64   `json:"timestamp"`
}

// ============================================================================
// MARKET DATA SERVICE
// ============================================================================

type MarketDataService struct {
	mu         sync.RWMutex
	tickers    map[string]*Ticker
	trades     map[string][]*Trade
	orderBooks map[string]*OrderBook
	tradeCounter uint64
}

func NewMarketDataService() *MarketDataService {
	return &MarketDataService{
		tickers:    make(map[string]*Ticker),
		trades:     make(map[string][]*Trade),
		orderBooks: make(map[string]*OrderBook),
	}
}

// Initialize symbols
func (s *MarketDataService) InitializeSymbols(symbols []string) {
	for _, symbol := range symbols {
		s.tickers[symbol] = &Ticker{
			Symbol:    symbol,
			LastPrice: 50000.0, // Default price
			High24h:  50000.0,
			Low24h:   50000.0,
			Timestamp: time.Now().Unix(),
		}
		
		s.orderBooks[symbol] = &OrderBook{
			Symbol:    symbol,
			Bids:      []OrderLevel{},
			Asks:      []OrderLevel{},
		}
		
		s.trades[symbol] = []*Trade{}
	}
}

// Process trade
func (s *MarketDataService) ProcessTrade(symbol string, price, quantity float64, isBuyerMaker bool) *Trade {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.tradeCounter++
	trade := &Trade{
		ID:        fmt.Sprintf("t_%d", s.tradeCounter),
		Symbol:   symbol,
		Price:    price,
		Quantity: quantity,
		IsBuyerMaker: isBuyerMaker,
		Time:     time.Now().Unix(),
	}

	// Add to trades (keep last 1000)
	s.trades[symbol] = append(s.trades[symbol], trade)
	if len(s.trades[symbol]) > 1000 {
		s.trades[symbol] = s.trades[symbol][-1000:]
	}

	// Update ticker
	ticker := s.tickers[symbol]
	ticker.LastPrice = price
	
	// Update high/low
	if price > ticker.High24h {
		ticker.High24h = price
	}
	if price < ticker.Low24h || ticker.Low24h == 0 {
		ticker.Low24h = price
	}

	// Calculate change
	if len(s.trades[symbol]) > 1 {
		firstPrice := s.trades[symbol][0].Price
		ticker.PriceChange = price - firstPrice
		if firstPrice > 0 {
			ticker.PriceChangePercent = (ticker.PriceChange / firstPrice) * 100
		}
	}

	ticker.Volume24h += quantity
	ticker.Trades24h++
	ticker.Timestamp = time.Now().Unix()

	return trade
}

// Update order book
func (s *MarketDataService) UpdateOrderBook(symbol string, side string, price, quantity float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ob := s.orderBooks[symbol]
	ob.LastUpdateID++

	if side == "buy" {
		found := false
		for i, level := range ob.Bids {
			if level.Price == price {
				ob.Bids[i].Quantity = quantity
				found = true
				break
			}
		}
		if !found {
			ob.Bids = append(ob.Bids, OrderLevel{Price: price, Quantity: quantity})
		}
		// Sort descending by price
		for i := 0; i < len(ob.Bids)-1; i++ {
			for j := i + 1; j < len(ob.Bids); j++ {
				if ob.Bids[j].Price > ob.Bids[i].Price {
					ob.Bids[i], ob.Bids[j] = ob.Bids[j], ob.Bids[i]
				}
			}
		}
	} else {
		found := false
		for i, level := range ob.Asks {
			if level.Price == price {
				ob.Asks[i].Quantity = quantity
				found = true
				break
			}
		}
		if !found {
			ob.Asks = append(ob.Asks, OrderLevel{Price: price, Quantity: quantity})
		}
		// Sort ascending by price
		for i := 0; i < len(ob.Asks)-1; i++ {
			for j := i + 1; j < len(ob.Asks); j++ {
				if ob.Asks[j].Price < ob.Asks[i].Price {
					ob.Asks[i], ob.Asks[j] = ob.Asks[j], ob.Asks[i]
				}
			}
		}
	}
}

// Get 24h ticker
func (s *MarketDataService) GetTicker(symbol string) *Ticker {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.tickers[symbol]
}

// Get recent trades
func (s *MarketDataService) GetTrades(symbol string, limit int) []*Trade {
	s.mu.RLock()
	defer s.mu.RUnlock()

	trades := s.trades[symbol]
	if len(trades) > limit {
		return trades[len(trades)-limit:]
	}
	return trades
}

// Get order book
func (s *MarketDataService) GetOrderBook(symbol string, limit int) *OrderBook {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ob := s.orderBooks[symbol]
	result := &OrderBook{
		Symbol:       symbol,
		LastUpdateID: ob.LastUpdateID,
	}

	if len(ob.Bids) > limit {
		result.Bids = ob.Bids[:limit]
	} else {
		result.Bids = ob.Bids
	}

	if len(ob.Asks) > limit {
		result.Asks = ob.Asks[:limit]
	} else {
		result.Asks = ob.Asks
	}

	return result
}

// Get candles (simplified)
func (s *MarketDataService) GetKlines(symbol string, interval string, limit int) []*Kline {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Simplified - real implementation would aggregate actual trades
	var klines []*Kline
	
	baseTime := time.Now().Unix()
	for i := 0; i < limit; i++ {
		openTime := baseTime - int64((limit-i)*60)
		
		kline := &Kline{
			Symbol:       symbol,
			OpenTime:    openTime,
			Open:        50000.0 + float64(i)*10,
			High:        50010.0 + float64(i)*10,
			Low:         49990.0 + float64(i)*10,
			Close:       50000.0 + float64(i)*10,
			Volume:      100.0,
			QuoteVolume: 5000000.0,
			Trades:      42,
			KlineCallapse: interval,
			Timestamp:  openTime + 60,
		}
		klines = append(klines, kline)
	}

	return klines
}

// ============================================================================
// WEBSOCKET COMPATIBLE JSON
// ============================================================================

func (s *MarketDataService) ToJSON() string {
	data := map[string]interface{}{
		"tickers": s.tickers,
	}
	json, _ := json.Marshal(data)
	return string(json)
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	service := NewMarketDataService()
	
	symbols := []string{
		"BTC/USDT", "ETH/USDT", "BNB/USDT",
		"SOL/USDT", "XRP/USDT", "ADA/USDT",
		"DOGE/USDT", "DOT/USDT", "MATIC/USDT",
	}
	
	service.InitializeSymbols(symbols)

	// Simulate some trades
	for _, symbol := range symbols[:3] {
		for i := 0; i < 10; i++ {
			price := 50000.0 + float64(i)*100 + float64(symbol[0])*10
			quantity := 0.1 + float64(i)*0.01
			service.ProcessTrade(symbol, price, quantity, i%2 == 0)
			service.UpdateOrderBook(symbol, "buy", price-10, quantity)
			service.UpdateOrderBook(symbol, "ask", price+10, quantity)
		}
	}

	// Print summary
	for _, symbol := range symbols[:3] {
		ticker := service.GetTicker(symbol)
		fmt.Printf("%s: $%.2f (%.2f%%) Vol: %.2f\n", 
			symbol, ticker.LastPrice, ticker.PriceChangePercent, ticker.Volume24h)
		
		ob := service.GetOrderBook(symbol, 5)
		fmt.Printf("  OrderBook - Bids: %d, Asks: %d\n", len(ob.Bids), len(ob.Asks))
	}

	log.Println("Market Data Service initialized successfully")
}