// Package adapter provides exchange adapters.
// Migrated from TypeScript to Go for exchange integrations.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Exchange adapter
type Adapter struct {
	ID       string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"` // cex, dex
	Status  string `json:"status"` // active
	TradeFee float64 `json:"tradeFee"` // %
	WithdrawFee float64 `json:"withdrawFee"`
}

// Ticker from adapter
type Ticker struct {
	Symbol    string  `json:"symbol"`
	Bid       float64 `json:"bid"`
	Ask       float64 `json:"ask"`
	Last      float64 `json:"last"`
	Volume24h float64 `json:"volume24h"`
	Timestamp int64   `json:"timestamp"`
}

// Order from adapter
type OrderResponse struct {
	OrderID   string  `json:"orderId"`
	Side     string  `json:"side"`
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Filled   float64 `json:"filled"`
	Status   string  `json:"status"`
}

// Store
type AdapterStore struct {
	mu       sync.RWMutex
	adapters map[string]*Adapter
}

var (
	adapterStore = &AdapterStore{
		adapters: make(map[string]*Adapter),
	}
)

// Initialize adapters
func init() {
	adapters := []*Adapter{
		{ID: "binance", Name: "Binance", Type: "cex", Status: "active", TradeFee: 0.001, WithdrawFee: 0.0005},
		{ID: "coinbase", Name: "Coinbase", Type: "cex", Status: "active", TradeFee: 0.006, WithdrawFee: 0.001},
		{ID: "bybit", Name: "Bybit", Type: "cex", Status: "active", TradeFee: 0.001, WithdrawFee: 0.0005},
		{ID: "kraken", Name: "Kraken", Type: "cex", Status: "active", TradeFee: 0.002, WithdrawFee: 0.0009},
		{ID: "uniswap", Name: "Uniswap", Type: "dex", Status: "active", TradeFee: 0.003, WithdrawFee: 0},
		{ID: "curve", Name: "Curve", Type: "dex", Status: "paused", TradeFee: 0.0004, WithdrawFee: 0},
	}

	adapterStore.mu.Lock()
	defer adapterStore.mu.Unlock()

	for _, a := range adapters {
		adapterStore.adapters[a.ID] = a
	}
}

// Get ticker
func GetTicker(adapterID, symbol string) (*Ticker, error) {
	adapterStore.mu.RLock()
	adapter, ok := adapterStore.adapters[adapterID]
	adapterStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("adapter not found")
	}

	// Simulate ticker
	return &Ticker{
		Symbol: symbol,
		Bid: 65000.0,
		Ask: 65001.0,
		Last: 65000.0,
		Volume24h: 1000000000,
		Timestamp: time.Now().UnixMilli(),
	}, nil
}

// Place order
func PlaceOrder(adapterID, symbol, side string, price, quantity float64) (*OrderResponse, error) {
	adapterStore.mu.RLock()
	adapter, ok := adapterStore.adapters[adapterID]
	adapterStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("adapter not found")
	}

	if adapter.Status != "active" {
		return nil, fmt.Errorf("adapter not active")
	}

	return &OrderResponse{
		OrderID: fmt.Sprintf("ord_%d", time.Now().UnixNano()),
		Side: side,
		Price: price,
		Quantity: quantity,
		Filled: 0,
		Status: "pending",
	}, nil
}

// Withdraw
func Withdraw(adapterID, address, symbol string, amount float64) (string, error) {
	adapterStore.mu.RLock()
	adapter, ok := adapterStore.adapters[adapterID]
	adapterStore.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("adapter not found")
	}

	if adapter.WithdrawFee > 0 {
		netAmount := amount - (amount * adapter.WithdrawFee)
		return fmt.Sprintf("tx_%d", time.Now().UnixNano()), nil
	}

	return fmt.Sprintf("tx_%d", time.Now().UnixNano()), nil
}

// Get adapters
func GetAdapters() []*Adapter {
	adapterStore.mu.RLock()
	defer adapterStore.mu.RUnlock()

	var result []*Adapter
	for _, a := range adapterStore.adapters {
		result = append(result, a)
	}

	return result
}

func main() {
	fmt.Println("Exchange Adapter service initialized")

	// Show adapters
	for _, a := range GetAdapters() {
		fmt.Printf("%s: %s (%.2f%% fee)\n", a.Name, a.Type, a.TradeFee*100)
	}

	// Get ticker
	ticker, _ := GetTicker("binance", "BTCUSDT")
	fmt.Printf("Ticker: $%.2f\n", ticker.Last)
}