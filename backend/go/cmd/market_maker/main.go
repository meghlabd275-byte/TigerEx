// Package market_maker provides market making services.
// Migrated from TypeScript to Go for liquidity provision.
package main

import (
	"fmt"
	"sync"
	"time"
)

// MM Strategy
type MMStrategy struct {
	Symbol     string  `json:"symbol"`
	Spread     float64 `json:"spread"` // percentage
	MinSize   float64 `json:"minSize"`
	MaxSize   float64 `json:"maxSize"`
	Status    string  `json:"status"` // active, paused
	Bias      string  `json:"bias"` // neutral, buy, sell
}

// MM Order
type MMOrder struct {
	ID        string  `json:"id"`
	Strategy string  `json:"strategy"`
	Side     string  `json:"side"`
	Price    float64 `json:"price"`
	Size     float64 `json:"size"`
	Status   string  `json:"status"` // pending, filled, cancelled
}

// Store
type MMStore struct {
	mu       sync.RWMutex
	strategies map[string]*MMStrategy
	orders   map[string]*MMOrder
}

var (
	mmStore = &MMStore{
		strategies: make(map[string]*MMStrategy),
		orders: make(map[string]*MMOrder),
	}
)

// Initialize strategies
func init() {
	strategies := []*MMStrategy{
		{Symbol: "BTCUSDT", Spread: 0.001, MinSize: 0.001, MaxSize: 1.0, Status: "active", Bias: "neutral"},
		{Symbol: "ETHUSDT", Spread: 0.002, MinSize: 0.01, MaxSize: 10.0, Status: "active", Bias: "neutral"},
		{Symbol: "SOLUSDT", Spread: 0.003, MinSize: 0.1, MaxSize: 100.0, Status: "paused", Bias: "neutral"},
	}

	mmStore.mu.Lock()
	defer mmStore.mu.Unlock()

	for _, s := range strategies {
		mmStore.strategies[s.Symbol] = s
	}
}

// Get strategy
func GetStrategy(symbol string) (*MMStrategy, bool) {
	mmStore.mu.RLock()
	defer mmStore.mu.RUnlock()

	strat, ok := mmStore.strategies[symbol]
	return strat, ok
}

// Calculate prices
func CalculatePrices(symbol string, midPrice float64) (float64, float64) {
	strat, ok := GetStrategy(symbol)
	if !ok {
		return 0, 0
	}

	bid := midPrice * (1 - strat.Spread)
	ask := midPrice * (1 + strat.Spread)

	return bid, ask
}

// Submit orders
func SubmitOrders(symbol string, midPrice float64) []*MMOrder {
	bid, ask := CalculatePrices(symbol, midPrice)

	orders := []*MMOrder{
		{ID: fmt.Sprintf("mmo_%d", time.Now().UnixNano()), Strategy: symbol, Side: "buy", Price: bid, Size: 0.1, Status: "pending"},
		{ID: fmt.Sprintf("mmo_%d", time.Now().UnixNano()), Strategy: symbol, Side: "sell", Price: ask, Size: 0.1, Status: "pending"},
	}

	mmStore.mu.Lock()
	defer mmStore.mu.Unlock()

	for _, o := range orders {
		mmStore.orders[o.ID] = o
	}

	return orders
}

// Update spread
func UpdateSpread(symbol string, spread float64) {
	mmStore.mu.Lock()
	defer mmStore.mu.Unlock()

	if strat, ok := mmStore.strategies[symbol]; ok {
		strat.Spread = spread
	}
}

func main() {
	fmt.Println("Market Maker service initialized")

	// Calculate prices
	bid, ask := CalculatePrices("BTCUSDT", 65000.0)
	fmt.Printf("BTCUSDT: Bid $%.2f, Ask $%.2f\n", bid, ask)

	// Submit
	orders := SubmitOrders("BTCUSDT", 65000.0)
	fmt.Printf("Submitted %d orders\n", len(orders))
}