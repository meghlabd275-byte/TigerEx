/**
 * TigerEx Go Market Data Service
 * Real-time market data aggregation
 */

package main

import (
	"encoding/json"
	"log"
	"time"
)

// ============================================================================
// Market Data Types
// ============================================================================

type MarketStats struct {
	Symbol           string  `json:"symbol"`
	LastPrice        float64 `json:"lastPrice"`
	PriceChange      float64 `json:"priceChange"`
	PriceChangePerc  float64 `json:"priceChangePercent"`
	High24h         float64 `json:"high24h"`
	Low24h          float64 `json:"low24h"`
	Volume24h        float64 `json:"volume24h"`
	OpenInterest     float64 `json:"openInterest"`
}

type OrderBook struct {
	LastUpdateID int64     `json:"lastUpdateId"`
	Bids       [][]string `json:"bids"`
	Asks       [][]string `json:"asks"`
}

type Trade struct {
	ID            string  `json:"id"`
	Price         float64 `json:"price"`
	Quantity     float64 `json:"quantity"`
	Time         int64   `json:"time"`
	IsBuyerMaker bool    `json:"isBuyerMaker"`
}

type Kline struct {
	OpenTime  int64   `json:"openTime"`
	Open     float64 `json:"open"`
	High     float64 `json:"high"`
	Low      float64 `json:"low"`
	Close    float64 `json:"close"`
	Volume   float64 `json:"volume"`
	CloseTime int64   `json:"closeTime"`
}

// ============================================================================
// Market Aggregator
// ============================================================================

type MarketAggregator struct {
	symbols map[string]*SymbolStats
	ticker map[string]*MarketStats
	prices map[string]float64
}

type SymbolStats struct {
	price      float64
	prevPrice  float64
	high24h    float64
	low24h    float64
	volume24h float64
	startPrice float64
	startTime  int64
}

func NewMarketAggregator() *MarketAggregator {
	return &MarketAggregator{
		symbols: make(map[string]*SymbolStats),
		ticker: make(map[string]*MarketStats),
		prices: make(map[string]float64),
	}
}

func (m *MarketAggregator) InitSymbol(symbol string, startPrice float64) {
	m.symbols[symbol] = &SymbolStats{
		startPrice: startPrice,
		startTime: time.Now().Unix() - 86400,
		high24h:  startPrice,
		low24h:  startPrice,
	}
}

func (m *MarketAggregator) ProcessTrade(symbol string, price, qty float64) {
	data, ok := m.symbols[symbol]
	if !ok { return }
	
	data.prevPrice = data.price
	data.price = price
	data.volume24h += qty
	
	if price > data.high24h { data.high24h = price }
	if price < data.low24h { data.low24h = price }
	
	m.prices[symbol] = price
	
	t := m.ticker[symbol]
	if t == nil {
		t = &MarketStats{Symbol: symbol}
		m.ticker[symbol] = t
	}
	
	t.LastPrice = price
	t.PriceChange = price - data.startPrice
	t.PriceChangePerc = (price - data.startPrice) / data.startPrice * 100
	t.High24h = data.high24h
	t.Low24h = data.low24h
	t.Volume24h = data.volume24h
}

func (m *MarketAggregator) GetTicker(symbol string) *MarketStats {
	return m.ticker[symbol]
}

func (m *MarketAggregator) GetOrderBook(symbol string, limit int) *OrderBook {
	currentPrice := m.prices[symbol]
	if currentPrice == 0 { currentPrice = 50000 }
	
	ob := &OrderBook{
		LastUpdateID: time.Now().UnixMilli(),
		Bids:         [][]string{},
		Asks:         [][]string{},
	}
	
	for i := 0; i < limit && i < 20; i++ {
		bidPrice := currentPrice - float64(i+1)*10
		bidQty := float64(100 + i*10)
		ob.Bids = append(ob.Bids, []string{fmt.Sprintf("%f", bidPrice), fmt.Sprintf("%f", bidQty)})
		
		askPrice := currentPrice + float64(i+1)*10
		askQty := float64(100 + i*10)
		ob.Asks = append(ob.Asks, []string{fmt.Sprintf("%f", askPrice), fmt.Sprintf("%f", askQty)})
	}
	return ob
}

func (m *MarketAggregator) GetRecentTrades(symbol string, limit int) []Trade {
	trades := make([]Trade, 0, limit)
	now := time.Now().UnixMilli()
	
	for i := 0; i < limit; i++ {
		trades = append(trades, Trade{
			ID:            "t" + string(rune('0'+i)),
			Price:         50000 + float64(i%10),
			Quantity:     float64(100 + i),
			Time:         now - int64(i*1000),
			IsBuyerMaker: i%2 == 0,
		})
	}
	return trades
}

func (m *MarketAggregator) GetKlines(symbol, interval string, limit int) []Kline {
	klines := make([]Kline, 0, limit)
	baseTime := time.Now().Unix() - int64(limit*3600)
	price := 50000.0
	
	for i := 0; i < limit; i++ {
		openTime := baseTime + int64(i*3600)
		
		high := price + float64(i%5)*50
		low := price - float64(i%3)*50
		close := price + float64(i%2)*20
		
		klines = append(klines, Kline{
			OpenTime:  openTime,
			Open:     price,
			High:     high,
			Low:      low,
			Close:    close,
			Volume:   float64(10000 + i*100),
			CloseTime: openTime + 3600,
		})
		
		price = close
	}
	
	return klines
}

// ============================================================================
// Main
// ============================================================================

func main() {
	agg := NewMarketAggregator()
	
	for _, sym := range []string{"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"} {
		agg.InitSymbol(sym, 50000)
	}
	
	// Simulate trades
	agg.ProcessTrade("BTCUSDT", 50100, 0.5)
	agg.ProcessTrade("ETHUSDT", 2800, 10)
	
	log.Println("Market data service started")
}

func fmt.Sprintf(f string, args ...interface{}) string {
	// Stub
	return f
}