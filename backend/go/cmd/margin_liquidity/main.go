// Package margin_liquidity provides margin liquidity management.
// Critical for preventing liquidation cascades.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Liquidation Queue
type LiquidationQueue struct {
	mu        sync.RWMutex
	positions map[string]*Position
	partialFees map[string]float64
}

// Position
type Position struct {
	UserID    string  `json:"userId"`
	Symbol   string  `json:"symbol"`
	Side     string  `json:"side"` // long, short
	Size     float64 `json:"size"`
	EntryPrice float64 `json:"entryPrice"`
	LiqPrice float64 `json:"liqPrice"`
	Margin   float64 `json:"margin"`
	Health   float64 `json:"health"`
	Status   string  `json:"status"` // active, liquidating, liquidated
}

// Partial fill for liquidation
type PartialFill struct {
	LiqID    string  `json:"liqId"`
	UserID   string  `json:"userId"`
	Symbol   string  `json:"symbol"`
	Size     float64  `json:"size"`
	FillPrice float64 `json:"fillPrice"`
	Fee      float64  `json:"fee"`
	GasUsed  int64   `json:"gasUsed"`
}

// Liquidation Engine
type LiquidationEngine struct {
	mu         sync.RWMutex
	queue     *LiquidationQueue
	insurance float64 // Insurance fund balance
	gasBudget int64   // Gas budget per liquidation
}

var liqEngine = &LiquidationEngine{
	queue: &LiquidationQueue{
		positions: make(map[string]*Position),
		partialFees: make(map[string]float64),
	},
	insurance: 10000000, // 10M insurance
	gasBudget: 500000,
}

// Queue position for liquidation
func QueueLiquidation(userID, symbol string, size, entryPrice, liqPrice, margin, health float64) {
	pos := &Position{
		UserID: userID,
		Symbol: symbol,
		Size: size,
		EntryPrice: entryPrice,
		LiqPrice: liqPrice,
		Margin: margin,
		Health: health,
		Status: "liquidating",
	}

	liqEngine.mu.Lock()
	liqEngine.queue.positions[userID+symbol] = pos
	liqEngine.mu.Unlock()
}

// Process liquidations
func ProcessLiquidations(symbol string, currentPrice float64) []*PartialFill {
	liqEngine.mu.RLock()
	var toLiquidate []*Position
	for key, pos := range liqEngine.queue.positions {
		if pos.Symbol == symbol && currentPrice >= pos.LiqPrice {
			toLiquidate = append(toLiquidate, pos)
			delete(liqEngine.queue.positions, key)
		}
	}
	liqEngine.mu.RUnlock()

	var fills []*PartialFill
	for _, pos := range toLiquidate {
		fillSize := pos.Size
		if pos.Health < 0.1 {
			fillSize = pos.Size * 0.25 // Liquidate 25% first
		}

		partialFee := fillSize * currentPrice * 0.001 // 0.1% fee

		fill := &PartialFill{
			LiqID: fmt.Sprintf("liq_%d", time.Now().UnixNano()),
			UserID: pos.UserID,
			Symbol: pos.Symbol,
			FillPrice: currentPrice,
			Size: fillSize,
			Fee: partialFee,
		}

		fills = append(fills, fill)

		// Update position
		liqEngine.mu.Lock()
		if existing, ok := liqEngine.queue.positions[pos.UserID+pos.Symbol]; ok {
			existing.Size -= fillSize
			existing.Health = (currentPrice - existing.EntryPrice) / existing.EntryPrice
			if existing.Size <= 0 {
				existing.Status = "liquidated"
			}
		}
		liqEngine.mu.Unlock()
	}

	return fills
}

// Get liquidation queue
func GetLiquidationQueue() []*Position {
	liqEngine.mu.RLock()
	defer liqEngine.mu.RUnlock()

	var positions []*Position
	for _, p := range liqEngine.queue.positions {
		positions = append(positions, p)
	}
	return positions
}

// Insurance fund draw
func DrawInsurance(amount float64) error {
	liqEngine.mu.Lock()
	defer liqEngine.mu.Unlock()

	if amount > liqEngine.insurance {
		return fmt.Errorf("insufficient insurance funds")
	}
	liqEngine.insurance -= amount
	return nil
}

// Check health
func CheckHealth(userID, symbol string, currentPrice float64) (float64, bool) {
	liqEngine.mu.RLock()
	pos, ok := liqEngine.queue.positions[userID+symbol]
	liqEngine.mu.RUnlock()

	if !ok {
		return 1.0, false
	}

	var health float64
	if pos.Side == "long" {
		health = (currentPrice - pos.LiqPrice) / pos.LiqPrice
	} else {
		health = (pos.LiqPrice - currentPrice) / pos.LiqPrice
	}

	return health, health < 0
}

func main() {
	fmt.Println("Margin Liquidity service initialized")

	// Queue liquidation
	QueueLiquidation("user1", "BTCUSDT", 1.0, 65000, 55250, 650, 0.3)

	// Process
	fills := ProcessLiquidations("BTCUSDT", 55000)
	fmt.Printf("Processed: %d liquidations\n", len(fills))
}