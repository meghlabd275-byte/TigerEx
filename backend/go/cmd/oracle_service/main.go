// Package oracle_service fetches and provides price data from oracles.
// Migrated from TypeScript to Go for reliable price feeds.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Price feed from oracle
type PriceFeed struct {
	Symbol    string    `json:"symbol"`
	Price     float64   `json:"price"`
	Volume24h  float64   `json:"volume24h"`
	Change24h float64   `json:"change24h"`
	Timestamp int64     `json:"timestamp"`
	Source    string    `json:"source"`
}

// Oracle source
type OracleSource struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Weight int   `json:"weight"` // Weight in aggregation
	Active bool  `json:"active"`
}

// Aggregated price from multiple oracles
type AggregatedPrice struct {
	Symbol     string  `json:"symbol"`
	Price      float64 `json:"price"`
	Confidence float64 `json:"confidence"`
	Sources    int     `json:"sources"`
	Timestamp  int64   `json:"timestamp"`
}

// Oracle store
type OracleStore struct {
	mu          sync.RWMutex
	prices     map[string]*PriceFeed
	sources    map[string]*OracleSource
}

var (
	oStore = &OracleStore{
		prices:  make(map[string]*PriceFeed),
		sources: make(map[string]*OracleSource),
	}
)

// Initialize with default sources
func init() {
	sources := map[string]*OracleSource{
		"binance":    {Name: "binance", URL: "https://api.binance.com", Weight: 10, Active: true},
		"coinbase":   {Name: "coinbase", URL: "https://api.coinbase.com", Weight: 10, Active: true},
		"kraken":    {Name: "kraken", URL: "https://api.kraken.com", Weight: 8, Active: true},
		"huobi":     {Name: "huobi", URL: "https://api.huobi.com", Weight: 7, Active: true},
		"band":      {Name: "band", URL: "https://oracle.bandprotocol.com", Weight: 5, Active: true},
		"chainlink": {Name: "chainlink", URL: "https://data.chainlink.com", Weight: 8, Active: true},
	}

	oStore.mu.Lock()
	defer oStore.mu.Unlock()
	for _, s := range sources {
		oStore.sources[s.Name] = s
	}
}

// Update price from source
func UpdatePrice(source string, feed *PriceFeed) {
	oStore.mu.Lock()
	defer oStore.mu.Unlock()
	oStore.prices[feed.Symbol] = feed
}

// Get price for symbol
func GetPrice(symbol string) (*PriceFeed, bool) {
	oStore.mu.RLock()
	defer oStore.mu.RUnlock()

	p, ok := oStore.prices[symbol]
	return p, ok
}

// Get aggregated price (weighted average)
func GetAggregatedPrice(symbol string) *AggregatedPrice {
	oStore.mu.RLock()
	defer oStore.mu.RUnlock()

	var totalWeight float64
	var weightedSum float64

	for name, source := range oStore.sources {
		if !source.Active {
			continue
		}

		// In real implementation, we'd gather from multiple sources
		// For demo, simulate with stored prices
		if p, ok := oStore.prices[symbol]; ok && p.Source == name {
			weightedSum += p.Price * float64(source.Weight)
			totalWeight += float64(source.Weight)
		}
	}

	if totalWeight == 0 {
		return nil
	}

	return &AggregatedPrice{
		Symbol:     symbol,
		Price:      weightedSum / totalWeight,
		Confidence: 1.0 - (0.1 / totalWeight), // More sources = higher confidence
		Sources:    len(oStore.sources),
		Timestamp: time.Now().UnixMilli(),
	}
}

// Fetch prices from multiple oracles (simulated)
func FetchPrices() error {
	// Simulated price updates (in production, would call real APIs)
	prices := map[string]float64{
		"BTC/USDT": 65000.0,
		"ETH/USDT": 3500.0,
		"BNB/USDT": 600.0,
		"SOL/USDT": 150.0,
		"XRP/USDT": 0.5,
		"ADA/USDT": 0.45,
		"DOGE/USDT": 0.08,
		"DOT/USDT": 7.5,
		"MATIC/USDT": 0.85,
		"LTC/USDT": 85.0,
	}

	oStore.mu.Lock()
	defer oStore.mu.Unlock()

	for sym, price := range prices {
		change := (price / 65000.0) * 100 // Simplified
		m := price * 0.1 // 10% volume estimate
		
		oStore.prices[sym] = &PriceFeed{
			Symbol:    sym,
			Price:     price,
			Volume24h: m,
			Change24h: change,
			Timestamp: time.Now().UnixMilli(),
			Source:    "agg",
		}
	}

	return nil
}

// Get all prices
func GetAllPrices() map[string]*PriceFeed {
	oStore.mu.RLock()
	defer oStore.mu.RUnlock()
	return oStore.prices
}

// Check price deviation (for alerts)
func CheckDeviation(symbol string, threshold float64) (*PriceFeed, bool) {
	feed, ok := GetPrice(symbol)
	if !ok {
		return nil, false
	}

	// Would fetch reference price and compare
	_ = threshold

	return feed, true
}

func main() {
	fmt.Println("Oracle service initialized")

	// Fetch prices
	if err := FetchPrices(); err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	// Get BTC price
	btc, ok := GetPrice("BTC/USDT")
	if ok {
		fmt.Printf("BTC: $%.2f (24h: %.2f%%)\n", btc.Price, btc.Change24h)
	}

	// Get aggregated
	agg := GetAggregatedPrice("BTC/USDT")
	if agg != nil {
		jsonAgg, _ := json.Marshal(agg)
		fmt.Printf("Aggregated: %s\n", string(jsonAgg))
	}
}