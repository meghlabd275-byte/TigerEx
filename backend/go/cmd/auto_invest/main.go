// Package auto_invest provides automated investment strategies.
// Recurring investment and portfolio rebalancing.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Investment Strategy
type InvestStrategy struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Name      string  `json:"name"`
	Type      string  `json:"type"` // dca, rebalance, smart
	Allocations map[string]float64 `json:"allocations"` // symbol -> %
	Status    string  `json:"status"` // active, paused
	TotalInvested float64 `json:"totalInvested"`
	LastRebalance int64  `json:"lastRebalance"`
}

// Portfolio Position
type InvestPosition struct {
	StrategyID string  `json:"strategyId"`
	Symbol    string  `json:"symbol"`
	TargetPct float64 `json:"targetPct"`
	CurrentPct float64 `json:"currentPct"`
	Value    float64 `json:"value"`
}

// Rebalance Order
type RebalanceOrder struct {
	ID        string  `json:"id"`
	StrategyID string `json:"strategyId"`
	Symbol    string  `json:"symbol"`
	Side     string  `json:"side"` // buy, sell
	Amount   float64 `json:"amount"`
	Status   string  `json:"status"`
}

// Store
type AISStore struct {
	mu         sync.RWMutex
	strategies map[string]*InvestStrategy
	positions map[string]*InvestPosition
	orders    map[string]*RebalanceOrder
}

var aiStore = &AISStore{
	strategies: make(map[string]*InvestStrategy),
	positions: make(map[string]*InvestPosition),
	orders: make(map[string]*RebalanceOrder),
}

// Create strategy
func CreateInvestStrategy(userID, name, strType string, allocations map[string]float64) *InvestStrategy {
	strategy := &InvestStrategy{
		ID: fmt.Sprintf("inv_%d", time.Now().UnixNano()),
		UserID: userID,
		Name: name,
		Type: strType,
		Allocations: allocations,
		Status: "active",
		TotalInvested: 0,
		LastRebalance: time.Now().UnixMilli(),
	}

	aiStore.mu.Lock()
	aiStore.strategies[strategy.ID] = strategy
	aiStore.mu.Unlock()

	// Init positions
	for symbol, pct := range allocations {
		pos := &InvestPosition{
			StrategyID: strategy.ID,
			Symbol: symbol,
			TargetPct: pct,
			CurrentPct: 0,
			Value: 0,
		}

		aiStore.mu.Lock()
		aiStore.positions[symbol+strategy.ID] = pos
		aiStore.mu.Unlock()
	}

	return strategy
}

// Add funds
func AddFunds(strategyID string, amount float64) error {
	aiStore.mu.RLock()
	strategy, ok := aiStore.strategies[strategyID]
	aiStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("strategy not found")
	}

	aiStore.mu.Lock()
	strategy.TotalInvested += amount

	// Distribute to positions
	for symbol, pos := range aiStore.positions {
		if pos.StrategyID == strategyID {
			pos.Value += amount * (pos.TargetPct / 100)
		}
	}
	aiStore.mu.Unlock()

	return nil
}

// Rebalance portfolio
func Rebalance(strategyID string, currentPrices map[string]float64) []*RebalanceOrder {
	aiStore.mu.RLock()
	strategy, ok := aiStore.strategies[strategyID]
	aiStore.mu.RUnlock()

	if !ok {
		return nil
	}

	var orders []*RebalanceOrder
	totalValue := 0.0

	// Calculate current values
	for key, pos := range aiStore.positions {
		if pos.StrategyID == strategyID {
			if price, p := currentPrices[pos.Symbol]; p {
				pos.CurrentPct = (pos.Value * price) / (strategy.TotalInvested + 1) * 100
				totalValue += pos.Value * price
			}
		}
	}

	// Generate rebalance orders
	for key, pos := range aiStore.positions {
		if pos.StrategyID != strategyID {
			continue
		}

		targetValue := totalValue * (pos.TargetPct / 100)
		diff := targetValue - pos.Value

		if diff > 10 { // Threshold
			side := "buy"
			if diff < 0 {
				side = "sell"
			}

			order := &RebalanceOrder{
				ID: fmt.Sprintf("rebl_%d", time.Now().UnixNano()),
				StrategyID: strategyID,
				Symbol: pos.Symbol,
				Side: side,
				Amount: abs(diff),
				Status: "pending",
			}

			orders = append(orders, order)

			aiStore.mu.Lock()
			aiStore.orders[order.ID] = order
			aiStore.mu.Unlock()
		}
	}

	aiStore.mu.Lock()
	strategy.LastRebalance = time.Now().UnixMilli()
	aiStore.mu.Unlock()

	return orders
}

// Pause strategy
func PauseInvest(strategyID string) error {
	aiStore.mu.RLock()
	strategy, ok := aiStore.strategies[strategyID]
	aiStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("strategy not found")
	}

	aiStore.mu.Lock()
	strategy.Status = "paused"
	aiStore.mu.Unlock()

	return nil
}

func abs(n float64) float64 {
	if n < 0 {
		return -n
	}
	return n
}

func main() {
	fmt.Println("Auto Invest service initialized")

	// Create strategy
	alloc := map[string]float64{"BTCUSDT": 60, "ETHUSDT": 40}
	strategy := CreateInvestStrategy("user1", "Growth", "smart", alloc)
	fmt.Printf("Strategy: %s\n", strategy.ID)

	// Add funds
	AddFunds(strategy.ID, 10000)

	// Rebalance
	currentPrices := map[string]float64{"BTCUSDT": 65000, "ETHUSDT": 3500}
	orders := Rebalance(strategy.ID, currentPrices)
	fmt.Printf("Rebalance orders: %d\n", len(orders))
}