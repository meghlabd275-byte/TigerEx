// Package staking_pool provides liquid staking services.
// Migrated from TypeScript to Go for liquid staking pools.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Stake position
type StakePosition struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Token      string  `json:"token"`
	Amount    float64 `json:"amount"`
	SdToken    float64 `json:"sdToken"` // staking derivative token
	APY        float64 `json:"apy"`
	StartedAt  int64   `json:"startedAt"`
	LockedDays int    `json:"lockedDays"`
}

// Validator
type Validator struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Stake      float64 `json:"stake"`
	Commission float64 `json:"commission"`
	Uptime     float64 `json:"uptime"`
	Status    string  `json:"status"` // active, offline
}

// Pool stats
type PoolStats struct {
	TotalStaked   float64 `json:"totalStaked"`
	TotalRewards float64 `json:"totalRewards"`
	APY          float64 `json:"apy"`
	Validators   int    `json:"validators"`
}

// Store
type StakingPoolStore struct {
	mu        sync.RWMutex
	positions map[string]*StakePosition
	validators map[string]*Validator
}

var (
	spStore = &StakingPoolStore{
		positions: make(map[string]*StakePosition),
		validators: make(map[string]*Validator),
	}
)

// Initialize validators
func init() {
	validators := []*Validator{
		{ID: "val_1", Name: "Titan Validator", Stake: 1000000, Commission: 5, Uptime: 99.9, Status: "active"},
		{ID: "val_2", Name: "Eagle Validator", Stake: 800000, Commission: 4, Uptime: 99.8, Status: "active"},
		{ID: "val_3", Name: "Phoenix Validator", Stake: 500000, Commission: 3, Uptime: 99.5, Status: "active"},
	}

	spStore.mu.Lock()
	defer spStore.mu.Unlock()

	for _, v := range validators {
		spStore.validators[v.ID] = v
	}
}

// Stake tokens
func Stake(userID, token string, amount float64, days int) (*StakePosition, error) {
	minAmounts := map[string]float64{"ETH": 0.1, "SOL": 1, "ATOM": 1, "DOT": 10}
	
	min, ok := minAmounts[token]
	if !ok {
		return nil, fmt.Errorf("unsupported token")
	}
	
	if amount < min {
		return nil, fmt.Errorf("minimum stake is %.2f %s", min, token)
	}

	// Calculate APY based on days
	apy := 0.05
	if days >= 365 {
		apy = 0.12
	} else if days >= 180 {
		apy = 0.08
	} else if days >= 90 {
		apy = 0.06
	}

	// sdToken represents staked position (liquid)
	sdToken := amount

	position := &StakePosition{
		ID: fmt.Sprintf("stake_%d", time.Now().UnixNano()),
		UserID: userID,
		Token: token,
		Amount: amount,
		SdToken: sdToken,
		APY: apy,
		StartedAt: time.Now().UnixMilli(),
		LockedDays: days,
	}

	spStore.mu.Lock()
	defer spStore.mu.Unlock()
	spStore.positions[position.ID] = position

	return position, nil
}

// Unstake tokens
func Unstake(positionID string) (float64, error) {
	spStore.mu.Lock()
	defer spStore.mu.Unlock()

	position, ok := spStore.positions[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}

	// Calculate rewards
	days := (time.Now().UnixMilli() - position.StartedAt) / 86400000
	rewards := position.Amount * position.APY * float64(days) / 365

	// Return principal + rewards
	total := position.Amount + rewards

	delete(spStore.positions, positionID)

	return total, nil
}

// Get pool stats
func GetPoolStats(token string) *PoolStats {
	spStore.mu.RLock()
	defer spStore.mu.RUnlock()

	var totalStaked float64
	var validators int

	for _, v := range spStore.validators {
		if v.Status == "active" {
			validators++
			totalStaked += v.Stake
		}
	}

	return &PoolStats{
		TotalStaked: totalStaked,
		APY: 0.08,
		Validators: validators,
	}
}

func main() {
	fmt.Println("Staking Pool service initialized")

	// Show validators
	for _, v := range spStore.validators {
		fmt.Printf("Validator: %s (%.2f%% uptime)\n", v.Name, v.Uptime)
	}

	// Stake
	position, _ := Stake("user_001", "ETH", 10, 365)
	fmt.Printf("Staked: %.2f %s for %d days @ %.1f%% APY\n", 
		position.Amount, position.Token, position.LockedDays, position.APY*100)

	// Pool stats
	stats := GetPoolStats("ETH")
	fmt.Printf("Pool: %.0f %s staked, %d validators\n", 
		stats.TotalStaked, "ETH", stats.Validators)
}