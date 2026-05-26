// Package dca provides dollar-cost averaging trading.
// Automated recurring purchases.
package main

import (
	"fmt"
	"sync"
	"time"
)

// DCA Plan
type DCAPlan struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Symbol     string  `json:"symbol"`
	Amount     float64 `json:"amount"` // per purchase
	Interval   int     `json:"interval"` // hours between purchases
	NextPurchase int64  `json:"nextPurchase"`
	TotalBought float64 `json:"totalBought"`
	TotalSpent  float64 `json:"totalSpent"`
	Status     string  `json:"status"` // active, paused, completed
}

// DCA Order
type DCAOrder struct {
	ID        string  `json:"id"`
	PlanID   string  `json:"planId"`
	Amount   float64 `json:"amount"`
	Price    float64 `json:"price"`
	Status  string  `json:"status"` // pending, completed, failed
	ExecutedAt int64 `json:"executedAt"`
}

// Store
type DCAStore struct {
	mu    sync.RWMutex
	plans map[string]*DCAPlan
	orders map[string]*DCAOrder
}

var dcaStore = &DCAStore{
	plans: make(map[string]*DCAPlan),
	orders: make(map[string]*DCAOrder),
}

// Create DCA plan
func CreateDCAPlan(userID, symbol string, amount float64, intervalHours int) *DCAPlan {
	now := time.Now().UnixMilli()
	nextPurchase := now + int64(intervalHours)*3600000

	plan := &DCAPlan{
		ID: fmt.Sprintf("dca_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Amount: amount,
		Interval: intervalHours,
		NextPurchase: nextPurchase,
		TotalBought: 0,
		TotalSpent: 0,
		Status: "active",
	}

	dcaStore.mu.Lock()
	dcaStore.plans[plan.ID] = plan
	dcaStore.mu.Unlock()

	return plan
}

// Execute DCA purchase
func ExecuteDCAPurchase(planID string, currentPrice float64) (*DCAOrder, error) {
	dcaStore.mu.RLock()
	plan, ok := dcaStore.plans[planID]
	dcaStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("plan not found")
	}

	if plan.Status != "active" {
		return nil, fmt.Errorf("plan not active")
	}

	order := &DCAOrder{
		ID: fmt.Sprintf("dcao_%d", time.Now().UnixNano()),
		PlanID: planID,
		Amount: plan.Amount,
		Price: currentPrice,
		Status: "completed",
		ExecutedAt: time.Now().UnixMilli(),
	}

	// Calculate bought amount
	bought := plan.Amount / currentPrice

	dcaStore.mu.Lock()
	dcaStore.orders[order.ID] = order

	plan.TotalBought += bought
	plan.TotalSpent += plan.Amount
	plan.NextPurchase = time.Now().UnixMilli() + int64(plan.Interval)*3600000
	dcaStore.mu.Unlock()

	return order, nil
}

// Pause plan
func PauseDCA(planID string) error {
	dcaStore.mu.RLock()
	plan, ok := dcaStore.plans[planID]
	dcaStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("plan not found")
	}

	dcaStore.mu.Lock()
	plan.Status = "paused"
	dcaStore.mu.Unlock()

	return nil
}

// Resume plan
func ResumeDCA(planID string) error {
	dcaStore.mu.RLock()
	plan, ok := dcaStore.plans[planID]
	dcaStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("plan not found")
	}

	dcaStore.mu.Lock()
	plan.Status = "active"
	dcaStore.mu.Unlock()

	return nil
}

// Stop plan
func StopDCA(planID string) error {
	dcaStore.mu.RLock()
	plan, ok := dcaStore.plans[planID]
	dcaStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("plan not found")
	}

	dcaStore.mu.Lock()
	plan.Status = "completed"
	dcaStore.mu.Unlock()

	return nil
}

// Get plan summary
func GetDCASummary(planID string) (float64, float64, float64) {
	dcaStore.mu.RLock()
	plan, ok := dcaStore.plans[planID]
	dcaStore.mu.RUnlock()

	if !ok {
		return 0, 0, 0
	}

	avgPrice := 0.0
	if plan.TotalBought > 0 {
		avgPrice = plan.TotalSpent / plan.TotalBought
	}

	return plan.TotalBought, plan.TotalSpent, avgPrice
}

func main() {
	fmt.Println("DCA Trading service initialized")

	// Create plan
	plan := CreateDCAPlan("user1", "BTCUSDT", 100, 24)
	fmt.Printf("Plan: %s\n", plan.ID)

	// Execute
	order, _ := ExecuteDCAPurchase(plan.ID, 65000)
	fmt.Printf("Order: %s Bought: %.6f\n", order.ID, order.Amount/65000)
}