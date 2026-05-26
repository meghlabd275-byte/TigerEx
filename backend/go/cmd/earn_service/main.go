// Package earn_service provides yield/earn products.
// Migrated from TypeScript to Go for staking and earning.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Earn product type
type EarnProduct struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Asset      string  `json:"asset"`
	Type       string  `json:"type"` // flexible, locked, dual
	APY        float64 `json:"apy"`
	Duration   int     `json:"duration"` // days (0 = flexible)
	MinAmount  float64 `json:"minAmount"`
	MaxAmount  float64 `json:"maxAmount"`
	TotalStaked float64 `json:"totalStaked"`
	Status     string  `json:"status"`
}

// Earn subscription
type EarnSubscription struct {
	ID        string    `json:"id"`
	UserID   string    `json:"userId"`
	ProductID string   `json:"productId"`
	Amount   float64  `json:"amount"`
	APY      float64   `json:"apy"`
	StartedAt int64    `json:"startedAt"`
	EndsAt    int64    `json:"endsAt"`
	Status   string    `json:"status"` // active, claimed
}

// Earn reward
type EarnReward struct {
	UserID    string  `json:"userId"`
	ProductID string  `json:"productId"`
	Amount   float64 `json:"amount"`
	Type     string  `json:"type"` // interest, reward
	Currency string  `json:"currency"`
	Claimed  bool    `json:"claimed"`
	Date     int64   `json:"date"`
}

// Store
type EarnStore struct {
	mu           sync.RWMutex
	products    map[string]*EarnProduct
	subscriptions map[string]*EarnSubscription
	rewards     map[string][]*EarnReward
}

var (
	earnStore = &EarnStore{
		products:    make(map[string]*EarnProduct),
		subscriptions: make(map[string]*EarnSubscription),
		rewards:     make(map[string][]*EarnReward),
	}
)

// Initialize products
func init() {
	products := []*EarnProduct{
		// Flexible staking
		{FlexibleETH, Name: "ETH Flexible Staking", Asset: "ETH", Type: "flexible", APY: 5.0, Duration: 0, MinAmount: 0.01, MaxAmount: 1000, TotalStaked: 0, Status: "active"},
		{FlexibleBTC, Name: "BTC Flexible Staking", Asset: "BTC", Type: "flexible", APY: 3.0, Duration: 0, MinAmount: 0.001, MaxAmount: 100, TotalStaked: 0, Status: "active"},
		{FlexibleUSDT, Name: "USDT Flexible", Asset: "USDT", Type: "flexible", APY: 8.0, Duration: 0, MinAmount: 10, MaxAmount: 1000000, TotalStaked: 0, Status: "active"},
		{FlexibleUSDC, Name: "USDC Flexible", Asset: "USDC", Type: "flexible", APY: 8.0, Duration: 0, MinAmount: 10, MaxAmount: 1000000, TotalStaked: 0, Status: "active"},
		// Locked staking
		{LockedETH30, Name: "ETH 30-Day Lock", Asset: "ETH", Type: "locked", APY: 8.0, Duration: 30, MinAmount: 0.1, MaxAmount: 500, TotalStaked: 0, Status: "active"},
		{LockedETH60, Name: "ETH 60-Day Lock", Asset: "ETH", Type: "locked", APY: 12.0, Duration: 60, MinAmount: 0.1, MaxAmount: 500, TotalStaked: 0, Status: "active"},
		{LockedETH90, Name: "ETH 90-Day Lock", Asset: "ETH", Type: "locked", APY: 18.0, Duration: 90, MinAmount: 0.1, MaxAmount: 500, TotalStaked: 0, Status: "active"},
		{LockedBNB30, Name: "BNB 30-Day Lock", Asset: "BNB", Type: "locked", APY: 15.0, Duration: 30, MinAmount: 1, MaxAmount: 10000, TotalStaked: 0, Status: "active"},
	}

	var flexibleETH = "eth_flexible"
	productMap := map[string]*EarnProduct{
		flexibleETH: products[0],
		"btc_flexible": products[1],
		"usdt_flexible": products[2],
		"usdc_flexible": products[3],
		"eth_locked_30": products[4],
		"eth_locked_60": products[5],
		"eth_locked_90": products[6],
		"bnb_locked_30": products[7],
	}

	// Fix the pointers
	earnStore.products = productMap
}

// Subscribe to product
func Subscribe(userID, productID string, amount float64) (*EarnSubscription, error) {
	earnStore.mu.Lock()
	defer earnStore.mu.Unlock()

	product, ok := earnStore.products[productID]
	if !ok {
		return nil, fmt.Errorf("product not found")
	}

	if amount < product.MinAmount || amount > product.MaxAmount {
		return nil, fmt.Errorf("amount outside limits")
	}

	now := time.Now().UnixMilli()
	var endsAt int64
	if product.Duration > 0 {
		endsAt = now + int64(product.Duration*24*60*60*1000)
	} else {
		endsAt = 0 // flexible
	}

	sub := &EarnSubscription{
		ID:        fmt.Sprintf("sub_%d", now),
		UserID:    userID,
		ProductID: productID,
		Amount:   amount,
		APY:      product.APY,
		StartedAt: now,
		EndsAt:    endsAt,
		Status:   "active",
	}

	product.TotalStaked += amount
	earnStore.subscriptions[sub.ID] = sub

	return sub, nil
}

// Calculate pending rewards
func CalculateRewards(subID string) (float64, error) {
	earnStore.mu.RLock()
	defer earnStore.mu.RUnlock()

	sub, ok := earnStore.subscriptions[subID]
	if !ok {
		return 0, fmt.Errorf("subscription not found")
	}

	if sub.Status != "active" {
		return 0, fmt.Errorf("subscription not active")
	}

	// Calculate: amount * APY * days / 365
	days := float64(time.Now().UnixMilli()-sub.StartedAt) / (24 * 60 * 60 * 1000)
	rewards := sub.Amount * sub.APY / 100 * days / 365

	return rewards, nil
}

// Claim rewards
func Claim(userID, subID string) (*EarnReward, error) {
	earnStore.mu.Lock()
	defer earnStore.mu.Unlock()

	sub, ok := earnStore.subscriptions[subID]
	if !ok {
		return nil, fmt.Errorf("subscription not found")
	}

	if sub.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	pending, err := CalculateRewards(subID)
	if err != nil {
		return nil, err
	}

	reward := &EarnReward{
		UserID:    userID,
		ProductID: sub.ProductID,
		Amount:   pending,
		Type:     "interest",
		Currency: "USDT",
		Claimed:  true,
		Date:     time.Now().UnixMilli(),
	}

	earnStore.rewards[userID] = append(earnStore.rewards[userID], reward)

	return reward, nil
}

// GetFlexibleProducts returns all flexible staking products
func GetFlexibleProducts() []*EarnProduct {
	earnStore.mu.RLock()
	defer earnStore.mu.RUnlock()

	var result []*EarnProduct
	for _, p := range earnStore.products {
		if p.Type == "flexible" {
			result = append(result, p)
		}
	}
	return result
}

// GetLockedProducts returns locked staking products
func GetLockedProducts() []*EarnProduct {
	earnStore.mu.RLock()
	defer earnStore.mu.RUnlock()

	var result []*EarnProduct
	for _, p := range earnStore.products {
		if p.Type == "locked" {
			result = append(result, p)
		}
	}
	return result
}

// GetSubscriptions returns user subscriptions
func GetSubscriptions(userID string) []*EarnSubscription {
	earnStore.mu.RLock()
	defer earnStore.mu.RUnlock()

	var result []*EarnSubscription
	for _, s := range earnStore.subscriptions {
		if s.UserID == userID && s.Status == "active" {
			result = append(result, s)
		}
	}
	return result
}

func main() {
	fmt.Println("Earn service initialized")

	// Get products
	flexible := GetFlexibleProducts()
	for _, p := range flexible {
		fmt.Printf("Product %s: %s - APY %.2f%%\n", p.ID, p.Name, p.APY)
	}

	// Demo subscription
	sub, err := Subscribe("user_demo", "eth_locked_30", 1.0)
	if err != nil {
		fmt.Printf("Subscribe error: %v\n", err)
	} else {
		fmt.Printf("Subscribed: %s for %.2f %s at %.2f%% APY\n", 
			sub.ID, sub.Amount, "ETH", sub.APY)
	}
}