// Package oracle provides price oracle services.
// Aggregates prices from multiple sources.
package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// Price Source
type PriceSource struct {
	Name     string  `json:"name"`
	Weight   float64 `json:"weight"` // confidence weight
	LastPrice float64 `json:"lastPrice"`
	LastUpdate int64   `json:"lastUpdate"`
	Status   string  `json:"status"` // active, stale, disabled
	Deviation float64 `json:"deviation"` // standard deviation
}

// Aggregated Price
type AggregatedPrice struct {
	Symbol      string  `json:"symbol"`
	Price       float64 `json:"price"`
	Change24h   float64 `json:"change24h"`
	Volume24h   float64 `json:"volume24h"`
	Confidence  float64 `json:"confidence"` // quality score
	Sources     int     `json:"sources"`
	Timestamp   int64   `json:"timestamp"`
}

// Price Feed
type PriceFeed struct {
	Symbol  string  `json:"symbol"`
	Source  string  `json:"source"`
	Price   float64 `json:"price"`
	Bid    float64 `json:"bid"`
	Ask    float64 `json:"ask"`
	Volume float64 `json:"volume"`
	Time   int64  `json:"time"`
}

// Store
type OracleStore struct {
	mu     sync.RWMutex
	sources map[string]*PriceSource
	prices  map[string]*AggregatedPrice
	feeds  map[string][]PriceFeed
}

var oracleStore = &OracleStore{
	sources: make(map[string]*PriceSource),
	prices: make(map[string]*AggregatedPrice),
	feeds: make(map[string][]PriceFeed),
}

func init() {
	srcs := []*PriceSource{
		{"Binance", 0.4, 0, 0, "active", 0.001},
		{"Coinbase", 0.25, 0, 0, "active", 0.002},
		{"Kraken", 0.2, 0, 0, "active", 0.003},
		{"Gemini", 0.15, 0, 0, "active", 0.002},
	}

	oracleStore.mu.Lock()
	for _, s := range srcs {
		oracleStore.sources[s.Name] = s
	}
	oracleStore.mu.Unlock()
}

// Update price feed
func UpdateFeed(symbol, source string, price, bid, ask, volume float64) {
	feed := PriceFeed{
		Symbol: symbol,
		Source: source,
		Price: price,
		Bid: bid,
		Ask: ask,
		Volume: volume,
		Time: time.Now().UnixMilli(),
	}

	oracleStore.mu.Lock()
	oracleStore.feeds[symbol] = append(oracleStore.feeds[symbol], feed)
	oracleStore.mu.Unlock()
}

// Aggregate prices (weighted median)
func AggregatePrice(symbol string) (*AggregatedPrice, error) {
	oracleStore.mu.RLock()
	feeds, ok := oracleStore.feeds[symbol]
	oracleStore.mu.RUnlock()

	if !ok || len(feeds) == 0 {
		return nil, fmt.Errorf("no price feeds")
	}

	// Filter stale (>5 min)
	var validFeeds []PriceFeed
	for _, f := range feeds {
		if time.Now().UnixMilli()-f.Time < 300000 {
			validFeeds = append(validFeeds, f)
		}
	}

	if len(validFeeds) == 0 {
		return nil, fmt.Errorf("no valid feeds")
	}

	// Calculate weighted average (，排除 outliers)
	var totalWeight float64
	var weightedSum float64

	for _, f := range validFeeds {
		src, Sok := oracleStore.sources[f.Source]
		if !Sok {
			continue
		}

		// Skip if deviates > 5% from median
		median := calculateMedian(validFeeds)
		if math.Abs(f.Price-median)/median > 0.05 {
			continue
		}

		weight := src.Weight
		weightedSum += f.Price * weight
		totalWeight += weight
	}

	if totalWeight == 0 {
		return nil, fmt.Errorf("no valid sources after filtering")
	}

	finalPrice := weightedSum / totalWeight

	// Get previous price for change
	var change24h float64
	oracleStore.mu.RLock()
	if prev, pok := oracleStore.prices[symbol]; pok {
		change24h = (finalPrice - prev.Price) / prev.Price
	}
	oracleStore.mu.RUnlock()

	result := &AggregatedPrice{
		Symbol: symbol,
		Price: finalPrice,
		Change24h: change24h * 100,
		Confidence: totalWeight,
		Sources: len(validFeeds),
		Timestamp: time.Now().UnixMilli(),
	}

	oracleStore.mu.Lock()
	oracleStore.prices[symbol] = result
	oracleStore.mu.Unlock()

	return result, nil
}

func calculateMedian(feeds []PriceFeed) float64 {
	prices := make([]float64, len(feeds))
	for i, f := range feeds {
		prices[i] = f.Price
	}

	n := len(prices)
	if n%2 == 0 {
		return (prices[n/2-1] + prices[n/2]) / 2
	}
	return prices[n/2]
}

// Get current price
func GetPrice(symbol string) (*AggregatedPrice, error) {
	oracleStore.mu.RLock()
	defer oracleStore.mu.RUnlock()

	if p, ok := oracleStore.prices[symbol]; ok {
		return p, nil
	}
	return nil, fmt.Errorf("price not available")
}

// Set source status
func SetSourceStatus(source, status string) {
	oracleStore.mu.RLock()
	src, ok := oracleStore.sources[source]
	oracleStore.mu.RUnlock()

	if ok {
		oracleStore.mu.Lock()
		src.Status = status
		oracleStore.mu.Unlock()
	}
}

func main() {
	fmt.Println("Oracle service initialized")

	// Update feeds
	UpdateFeed("BTCUSDT", "Binance", 65000, 64995, 65005, 500)
	UpdateFeed("BTCUSDT", "Coinbase", 65010, 65005, 65015, 300)

	// Aggregate
	price, _ := AggregatePrice("BTCUSDT")
	fmt.Printf("Oracle: $%.2f Sources: %d\n", price.Price, price.Sources)
}