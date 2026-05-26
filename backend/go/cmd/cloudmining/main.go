// Package cloudmining provides cloud mining services.
// Migrated from TypeScript to Go for cloud mining.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Mining plan
type MiningPlan struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	HashPower  float64 `json:"hashPower"` // TH/s
	DailyReward float64 `json:"dailyReward"` // per TH/s
	Duration  int     `json:"duration"` // days
	Price     float64 `json:"price"`
	Status    string  `json:"status"` // active, sold_out
}

// Mining contract
type MiningContract struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	PlanID  string  `json:"planId"`
	HashRate float64 `json:"hashRate"` // TH/s purchased
	StartTime int64   `json:"startTime"`
	EndTime  int64   `json:"endTime"`
	TotalEarned float64 `json:"totalEarned"`
	Status   string   `json:"status"` // active, completed
}

// Payout
type MiningPayout struct {
	ID      string  `json:"id"`
	UserID string  `json:"userId"`
	Amount float64 `json:"amount"`
	Type   string  `json:"type"` // manual, auto
	PaidAt int64   `json:"paidAt"`
}

// Store
type CloudMiningStore struct {
	mu        sync.RWMutex
	plans     map[string]*MiningPlan
	contracts map[string]*MiningContract
	payouts   map[string][]*MiningPayout
}

var (
	cmStore = &CloudMiningStore{
		plans:     make(map[string]*MiningPlan),
		contracts: make(map[string]*MiningContract),
		payouts:   make(map[string][]*MiningPayout),
	}
)

// Initialize plans
func init() {
	plans := []*MiningPlan{
		{ID: "starter_1", Name: "Starter", HashPower: 1, DailyReward: 0.00015, Duration: 365, Price: 29.99, Status: "active"},
		{ID: "starter_5", Name: "Starter 5TH", HashPower: 5, DailyReward: 0.0007, Duration: 365, Price: 139.99, Status: "active"},
		{ID: "standard_10", Name: "Standard", HashPower: 10, DailyReward: 0.0015, Duration: 730, Price: 249.99, Status: "active"},
		{ID: "pro_25", Name: "Pro", HashPower: 25, DailyReward: 0.0035, Duration: 730, Price: 599.99, Status: "active"},
		{ID: "enterprise_100", Name: "Enterprise", HashPower: 100, DailyReward: 0.014, Duration: 1095, Price: 2199.99, Status: "active"},
	}

	cmStore.mu.Lock()
	defer cmStore.mu.Unlock()

	for _, p := range plans {
		cmStore.plans[p.ID] = p
	}
}

// Purchase contract
func Purchase(userID, planID string) (*MiningContract, error) {
	cmStore.mu.Lock()
	defer cmStore.mu.Unlock()

	plan, ok := cmStore.plans[planID]
	if !ok {
		return nil, fmt.Errorf("plan not found")
	}

	if plan.Status != "active" {
		return nil, fmt.Errorf("plan not available")
	}

	now := time.Now().UnixMilli()

	contract := &MiningContract{
		ID:        fmt.Sprintf("mc_%d", now),
		UserID:    userID,
		PlanID:   planID,
		HashRate: plan.HashPower,
		StartTime: now,
		EndTime:  now + int64(plan.Duration*86400000),
		TotalEarned: 0,
		Status:   "active",
	}

	cmStore.contracts[contract.ID] = contract

	return contract, nil
}

// Calculate earnings
func CalculateEarnings(contractID string) (float64, error) {
	cmStore.mu.RLock()
	defer cmStore.mu.RUnlock()

	contract, ok := cmStore.contracts[contractID]
	if !ok {
		return 0, fmt.Errorf("contract not found")
	}

	plan, ok := cmStore.plans[contract.PlanID]
	if !ok {
		return 0, fmt.Errorf("plan not found")
	}

	// Calculate days since start
	days := float64(time.Now().UnixMilli()-contract.StartTime) / 86400000
	if days > float64(plan.Duration) {
		days = float64(plan.Duration)
	}

	earning := contract.HashRate * plan.DailyReward * days / plan.HashPower

	return earning, nil
}

// Claim earnings
func Claim(contractID string) (*MiningPayout, error) {
	earnings, err := CalculateEarnings(contractID)
	if err != nil {
		return nil, err
	}

	cmStore.mu.Lock()
	defer cmStore.mu.Unlock()

	contract, ok := cmStore.contracts[contractID]
	if !ok {
		return nil, fmt.Errorf("contract not found")
	}

	payout := &MiningPayout{
		ID:      fmt.Sprintf("payout_%d", time.Now().UnixNano()),
		UserID: contract.UserID,
		Amount: earnings,
		Type:   "manual",
		PaidAt: time.Now().UnixMilli(),
	}

	contract.TotalEarned += earnings

	cmStore.payouts[contract.UserID] = append(cmStore.payouts[contract.UserID], payout)

	return payout, nil
}

// Get active contracts
func GetActiveContracts(userID string) []*MiningContract {
	cmStore.mu.RLock()
	defer cmStore.mu.RUnlock()

	var result []*MiningContract
	for _, c := range cmStore.contracts {
		if c.UserID == userID && c.Status == "active" {
			result = append(result, c)
		}
	}
	return result
}

func main() {
	fmt.Println("Cloud Mining service initialized")

	// List plans
	for _, p := range cmStore.plans {
		fmt.Printf("Plan %s: %s - %.2f TH/s @ $%.2f\n", p.ID, p.Name, p.HashPower, p.Price)
	}

	// Purchase
	contract, err := Purchase("user_001", "standard_10")
	if err != nil {
		fmt.Printf("Purchase error: %v\n", err)
	} else {
		fmt.Printf("Purchased: %s (%f TH/s)\n", contract.ID, contract.HashRate)
	}

	// Simulate earnings (skip ahead)
	fmt.Printf("Estimated earnings: \n")
}