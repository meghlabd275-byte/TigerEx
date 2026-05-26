// Package earn_plus provides advanced earning products.
// Migrated from TypeScript to Go for DeFi yield products.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Earn product
type EarnProduct struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Type      string  `json:"type"` // flexible, locked, dual
	APY       float64 `json:"apy"` // annual percentage yield
	Duration  int     `json:"duration"` // days (0 = flexible)
	MinAmount float64 `json:"minAmount"`
	Status    string  `json:"status"` // active, paused
}

// Subscription
type EarnSubscription struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	ProductID string  `json:"productId"`
	Amount   float64 `json:"amount"`
	APY      float64 `json:"apy"`
	StartedAt int64   `json:"startedAt"`
	LockedUntil int64  `json:"lockedUntil"`
}

// Yield
type Yield struct {
	UserID     string  `json:"userId"`
	ProductID  string  `json:"productId"`
	YieldAmount float64 `json:"yieldAmount"`
	Period     int64   `json:"period"`
}

// Store
type EarnPlusStore struct {
	mu           sync.RWMutex
	products     map[string]*EarnProduct
	subscriptions map[string]*EarnSubscription
}

var (
	epStore = &EarnPlusStore{
		products: make(map[string]*EarnProduct),
		subscriptions: make(map[string]*EarnSubscription),
	}
)

// Initialize products
func init() {
	products := []*EarnProduct{
		{ID: "usdt_flex", Name: "USDT Flexible", Type: "flexible", APY: 0.05, Duration: 0, MinAmount: 10, Status: "active"},
		{ID: "usdt_30d", Name: "USDT 30 Days", Type: "locked", APY: 0.08, Duration: 30, MinAmount: 100, Status: "active"},
		{ID: "usdt_90d", Name: "USDT 90 Days", Type: "locked", APY: 0.12, Duration: 90, MinAmount: 100, Status: "active"},
		{ID: "eth_flex", Name: "ETH Flexible", Type: "flexible", APY: 0.04, Duration: 0, MinAmount: 0.01, Status: "active"},
		{ID: "btc_flex", Name: "BTC Flexible", Type: "flexible", APY: 0.03, Duration: 0, MinAmount: 0.001, Status: "active"},
	}

	epStore.mu.Lock()
	defer epStore.mu.Unlock()

	for _, p := range products {
		epStore.products[p.ID] = p
	}
}

// Subscribe
func Subscribe(userID, productID string, amount float64) (*EarnSubscription, error) {
	epStore.mu.Lock()
	defer epStore.mu.Unlock()

	product, ok := epStore.products[productID]
	if !ok {
		return nil, fmt.Errorf("product not found")
	}

	if product.Status != "active" {
		return nil, fmt.Errorf("product not active")
	}

	if amount < product.MinAmount {
		return nil, fmt.Errorf("below minimum")
	}

	now := time.Now().UnixMilli()
	duration := product.Duration * 86400000

	sub := &EarnSubscription{
		ID: fmt.Sprintf("earn_%d", now),
		UserID: userID,
		ProductID: productID,
		Amount: amount,
		APY: product.APY,
		StartedAt: now,
		LockedUntil: now + duration,
	}

	epStore.subscriptions[sub.ID] = sub

	return sub, nil
}

// Calculate yield
func CalculateYield(subscriptionID string) (float64, error) {
	epStore.mu.RLock()
	defer epStore.mu.RUnlock()

	sub, ok := epStore.subscriptions[subscriptionID]
	if !ok {
		return 0, fmt.Errorf("subscription not found")
	}

	// APY / 365 * days * amount
	days := float64(productDuration(sub.ProductID)) / 86400000
	yield := sub.Amount * sub.APY / 365 * days

	return yield, nil
}

// Helper to get product duration  
func productDuration(productID string) int {
	if product, ok := epStore.products[productID] {
		return product.Duration * 86400000
	}
	return 0
}

func main() {
	fmt.Println("Earn+ service initialized")

	// Products
	for _, p := range epStore.products {
		flexOrLocked := "Flexible"
		if p.Duration > 0 {
			flexOrLocked = fmt.Sprintf("%dd Locked", p.Duration)
		}
		fmt.Printf("%s: %s (%.1f%% APY)\n", p.ID, flexOrLocked, p.APY*100)
	}

	// Subscribe
	sub, _ := Subscribe("user_001", "usdt_30d", 1000)
	fmt.Printf("Subscribed: %s - $%.2f @ %.1f%% APY\n", sub.ProductID, sub.Amount, sub.APY*100)

	// Yield
	yield, _ := CalculateYield(sub.ID)
	fmt.Printf("Projected yield: $%.2f\n", yield)
}