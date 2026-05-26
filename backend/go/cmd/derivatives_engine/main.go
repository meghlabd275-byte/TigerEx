// Package derivatives_engine provides derivatives trading engine.
// Migrated from TypeScript to Go for contracts trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Contract specification
type ContractSpec struct {
	ID          string  `json:"id"`
	Underlying string  `json:"underlying"` // BTC, ETH
	Type      string  `json:"type"` // future, option
	Strike    float64 `json:"strike"`
	Expiry    int64   `json:"expiry"`
	Multiplier float64 `json:"multiplier"` // contract multiplier
	TickSize  float64 `json:"tickSize"`
}

// Option type
type OptionType struct {
	Call bool
	Put  bool
}

// Position
type Position struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	ContractID string  `json:"contractId"`
	Size      float64 `json:"size"` // positive=long, negative=short
	EntryPrice float64 `json:"entryPrice"`
	Margin    float64 `json:"margin"`
}

// Order
type Order struct {
	ID          string   `json:"id"`
	UserID     string   `json:"userId"`
	ContractID string   `json:"contractId"`
	Side      string   `json:"side"` // buy, sell
	Type      string   `json:"type"` // market, limit
	Size      float64  `json:"size"`
	Price     float64  `json:"price"`
	Status    string   `json:"status"` // pending, filled, cancelled
	FilledAt  int64    `json:"filledAt"`
}

// Store
type DerivativesEngine struct {
	mu         sync.RWMutex
	specs      map[string]*ContractSpec
	positions map[string]*Position
	orders    map[string]*Order
}

var (
	dEngine = &DerivativesEngine{
		specs:     make(map[string]*ContractSpec),
		positions: make(map[string]*Position),
		orders:    make(map[string]*Order),
	}
)

// Initialize contract specs
func init() {
	specs := []*ContractSpec{
		{ID: "BTC-PERP", Underlying: "BTC", Type: "future", Expiry: 0, Multiplier: 100, TickSize: 0.5},
		{ID: "BTC-2503", Underlying: "BTC", Type: "future", Expiry: 1743537600000, Multiplier: 100, TickSize: 0.5},
		{ID: "BTC-2506", Underlying: "BTC", Type: "future", Expiry: 1751326400000, Multiplier: 100, TickSize: 0.5},
		{ID: "ETH-PERP", Underlying: "ETH", Type: "future", Expiry: 0, Multiplier: 10, TickSize: 0.05},
		{ID: "ETH-2503", Underlying: "ETH", Type: "future", Expiry: 1743537600000, Multiplier: 10, TickSize: 0.05},
		{ID: "BTC-50K-C", Underlying: "BTC", Type: "option", Strike: 50000, Expiry: 1743537600000, Multiplier: 100, TickSize: 0.5},
		{ID: "BTC-50K-P", Underlying: "BTC", Type: "option", Strike: 50000, Expiry: 1743537600000, Multiplier: 100, TickSize: 0.5},
		{ID: "BTC-60K-C", Underlying: "BTC", Type: "option", Strike: 60000, Expiry: 1743537600000, Multiplier: 100, TickSize: 0.5},
		{ID: "BTC-60K-P", Underlying: "BTC", Type: "option", Strike: 60000, Expiry: 1743537600000, Multiplier: 100, TickSize: 0.5},
		{ID: "ETH-3K-C", Underlying: "ETH", Type: "option", Strike: 3000, Expiry: 1743537600000, Multiplier: 10, TickSize: 0.05},
		{ID: "ETH-3K-P", Underlying: "ETH", Type: "option", Strike: 3000, Expiry: 1743537600000, Multiplier: 10, TickSize: 0.05},
	}

	dEngine.mu.Lock()
	defer dEngine.mu.Unlock()

	for _, s := range specs {
		dEngine.specs[s.ID] = s
	}
}

// Place order
func PlaceOrder(order *Order) *Order {
	order.ID = fmt.Sprintf("order_%d", time.Now().UnixNano())
	order.Status = "pending"

	dEngine.mu.Lock()
	defer dEngine.mu.Unlock()
	dEngine.orders[order.ID] = order

	return order
}

// Fill order at market price
func FillOrder(orderID string, fillPrice float64) (*Position, error) {
	dEngine.mu.Lock()
	defer dEngine.mu.Unlock()

	order, ok := dEngine.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}

	if order.Status != "pending" {
		return nil, fmt.Errorf("order not pending")
	}

	spec, ok := dEngine.specs[order.ContractID]
	if !ok {
		return nil, fmt.Errorf("contract not found")
	}

	// Calculate margin
	margin := spec.Multiplier * order.Size * fillPrice / 100 // 1% initial margin

	position := &Position{
		ID:          fmt.Sprintf("pos_%d", time.Now().UnixNano()),
		UserID:      order.UserID,
		ContractID: order.ContractID,
		Size:       order.Size,
		EntryPrice:  fillPrice,
		Margin:     margin,
	}

	order.Status = "filled"
	order.FilledAt = time.Now().UnixMilli()

	dEngine.positions[position.ID] = position

	return position, nil
}

// Calculate P&L
func CalculatePnL(positionID string, currentPrice float64) (float64, error) {
	dEngine.mu.RLock()
	defer dEngine.mu.RUnlock()

	pos, ok := dEngine.positions[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}

	spec, ok := dEngine.specs[pos.ContractID]
	if !ok {
		return 0, fmt.Errorf("contract not found")
	}

	size := pos.Size * spec.Multiplier
	valueDiff := (currentPrice - pos.EntryPrice) * size

	if pos.Size < 0 { // Short
		valueDiff = -valueDiff
	}

	return valueDiff, nil
}

// Close position
func ClosePosition(positionID string, closePrice float64) (float64, error) {
	dEngine.mu.Lock()
	defer dEngine.mu.Unlock()

	pos, ok := dEngine.positions[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}

	pnl, err := CalculatePnL(positionID, closePrice)
	if err != nil {
		return 0, err
	}

	pos.Size = 0 // Mark as closed

	return pnl, nil
}

// Calculate option payoff (plain vanilla)
func CalculateOptionPayoff(optionType string, strike, underlying, premium float64, contracts float64) float64 {
	multiplier := 100.0 // BTC contract multiplier

	var payoff float64
	if optionType == "call" {
		// Max(0, underlying - strike)
		if underlying > strike {
			payoff = (underlying - strike) * contracts * multiplier
		}
	} else {
		// Max(0, strike - underlying)
		if strike > underlying {
			payoff = (strike - underlying) * contracts * multiplier
		}
	}

	return payoff - (premium * contracts * multiplier)
}

func main() {
	fmt.Println("Derivatives Engine initialized")

	// List contracts
	count := len(dEngine.specs)
	fmt.Printf("Loaded %d contract specifications\n", count)

	// Demo order
	order := PlaceOrder(&Order{
		UserID:     "user_001",
		ContractID: "BTC-PERP",
		Side:      "buy",
		Type:      "market",
		Size:      1.0,
		Price:     0,
	})

	fmt.Printf("Placed order: %s\n", order.ID)

	// Fill
	pos, err := FillOrder(order.ID, 65000)
	if err != nil {
		fmt.Printf("Fill error: %v\n", err)
	} else {
		fmt.Printf("Filled position: entry @ %.2f, margin: %.2f\n", pos.EntryPrice, pos.Margin)
	}

	// Calculate P&L
	pnl, _ := CalculatePnL(pos.ID, 66000)
	fmt.Printf("P&L: %.2f\n", pnl)
}