// Package grid_trading provides grid trading strategies.
// Automated price grid trading.
package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// Grid Strategy
type GridStrategy struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	Symbol    string  `json:"symbol"`
	GridLevel int     `json:"gridLevel"` // number of grid levels
	MinPrice  float64 `json:"minPrice"`
	MaxPrice  float64 `json:"maxPrice"`
	GridSpacing float64 `json:"gridSpacing"` // % between levels
	Status    string  `json:"status"` // running, paused, stopped
	TotalProfit float64 `json:"totalProfit"`
}

// Grid Order
type GridOrder struct {
	ID        string  `json:"id"`
	StrategyID string `json:"strategyId"`
	Level    int     `json:"level"`
	Side    string  `json:"side"` // buy, sell
	Price   float64 `json:"price"`
	Size    float64 `json:"size"`
	Status  string  `json:"status"` // pending, filled, cancelled
}

// Store
type GridStore struct {
	mu       sync.RWMutex
	strategies map[string]*GridStrategy
	orders    map[string]*GridOrder
}

var gridStore = &GridStore{
	strategies: make(map[string]*GridStrategy),
	orders: make(map[string]*GridOrder),
}

// Create grid strategy
func CreateGridStrategy(userID, symbol string, levels int, minPrice, maxPrice float64) *GridStrategy {
	spacing := (maxPrice - minPrice) / float64(levels)

	strategy := &GridStrategy{
		ID: fmt.Sprintf("grid_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		GridLevel: levels,
		MinPrice: minPrice,
		MaxPrice: maxPrice,
		GridSpacing: spacing,
		Status: "running",
		TotalProfit: 0,
	}

	gridStore.mu.Lock()
	gridStore.strategies[strategy.ID] = strategy
	gridStore.mu.Unlock()

	// Create grid orders
	createGridOrders(strategy)

	return strategy
}

func createGridOrders(strategy *GridStrategy) {
	for i := 0; i < strategy.GridLevel; i++ {
		price := strategy.MinPrice + (strategy.GridSpacing * float64(i))

		// Buy order at each level below middle
		buyOrder := &GridOrder{
			ID: fmt.Sprintf("go_%d_buy_%d", time.Now().UnixNano(), i),
			StrategyID: strategy.ID,
			Level: i,
			Side: "buy",
			Price: price,
			Size: 0.01, // Fixed size per grid
			Status: "pending",
		}

		// Sell order at each level above middle
		sellOrder := &GridOrder{
			ID: fmt.Sprintf("go_%d_sell_%d", time.Now().UnixNano(), i),
			StrategyID: strategy.ID,
			Level: i,
			Side: "sell",
			Price: price + strategy.GridSpacing,
			Size: 0.01,
			Status: "pending",
		}

		gridStore.mu.Lock()
		gridStore.orders[buyOrder.ID] = buyOrder
		gridStore.orders[sellOrder.ID] = sellOrder
		gridStore.mu.Unlock()
	}
}

// Fill order
func FillGridOrder(orderID string, fillPrice float64) error {
	gridStore.mu.RLock()
	order, ok := gridStore.orders[orderID]
	gridStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	gridStore.mu.Lock()
	order.Status = "filled"
	gridStore.mu.Unlock()

	// Find strategy and update profit
	strategyID := order.StrategyID
	gridStore.mu.RLock()
	strategy, sok := gridStore.strategies[strategyID]
	gridStore.mu.RUnlock()

	if sok {
		profit := calculateGridProfit(order.Side, fillPrice, order.Size)
		gridStore.mu.Lock()
		strategy.TotalProfit += profit
		gridStore.mu.Unlock()

		// Create opposite order
		createReplacementOrder(strategy, order.Level, fillPrice)
	}

	return nil
}

func calculateGridProfit(side string, price, size float64) float64 {
	if side == "buy" {
		return size * price * 0.001 //maker fee
	}
	return size * price * 0.001
}

func createReplacementOrder(strategy *GridStrategy, level int, currentPrice float64) {
	newLevel := level + 1
	if newLevel >= strategy.GridLevel {
		newLevel = 0
	}

	price := strategy.MinPrice + (strategy.GridSpacing * float64(newLevel))

	order := &GridOrder{
		ID: fmt.Sprintf("go_rep_%d", time.Now().UnixNano()),
		StrategyID: strategy.ID,
		Level: newLevel,
		Side: "buy",
		Price: price,
		Size: 0.01,
		Status: "pending",
	}

	gridStore.mu.Lock()
	gridStore.orders[order.ID] = order
	gridStore.mu.Unlock()
}

// Pause strategy
func PauseStrategy(strategyID string) error {
	gridStore.mu.RLock()
	strategy, ok := gridStore.strategies[strategyID]
	gridStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("strategy not found")
	}

	gridStore.mu.Lock()
	strategy.Status = "paused"
	gridStore.mu.Unlock()

	return nil
}

// Resume strategy
func ResumeStrategy(strategyID string) error {
	gridStore.mu.RLock()
	strategy, ok := gridStore.strategies[strategyID]
	gridStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("strategy not found")
	}

	gridStore.mu.Lock()
	strategy.Status = "running"
	gridStore.mu.Unlock()

	return nil
}

// Stop strategy
func StopStrategy(strategyID string) error {
	gridStore.mu.RLock()
	strategy, ok := gridStore.strategies[strategyID]
	gridStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("strategy not found")
	}

	gridStore.mu.Lock()
	strategy.Status = "stopped"

	// Cancel all pending orders
	for _, o := range gridStore.orders {
		if o.StrategyID == strategyID && o.Status == "pending" {
			o.Status = "cancelled"
		}
	}
	gridStore.mu.Unlock()

	return nil
}

// Get strategy status
func GetGridStatus(strategyID string) (*GridStrategy, error) {
	gridStore.mu.RLock()
	defer gridStore.mu.RUnlock()

	if s, ok := gridStore.strategies[strategyID]; ok {
		return s, nil
	}

	return nil, fmt.Errorf("strategy not found")
}

func main() {
	fmt.Println("Grid Trading service initialized")

	// Create strategy
	strategy := CreateGridStrategy("user1", "BTCUSDT", 10, 60000, 70000)
	fmt.Printf("Strategy: %s Profit: $%.2f\n", strategy.ID, strategy.TotalProfit)

	// Status
	status, _ := GetGridStatus(strategy.ID)
	fmt.Printf("Status: %s\n", status.Status)
}