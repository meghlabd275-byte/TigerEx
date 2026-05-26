// Package staking_service provides staking services.
// Migrated from TypeScript to Go for staking/yield.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Staking pool
type StakingPool struct {
	ID          string  `json:"id"`
	Asset      string  `json:"asset"`
	Duration   int     `json:"duration"` // days
	APY        float64 `json:"apy"`
	MinStake   float64 `json:"minStake"`
	MaxStake   float64 `json:"maxStake"`
	TotalStaked float64 `json:"totalStaked"`
	Status     string  `json:"status"` // active, paused
}

// Staking position
type StakingPosition struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	PoolID  string  `json:"poolId"`
	Amount  float64 `json:"amount"`
	APY     float64 `json:"apy"`
	StartTime int64 `json:"startTime"`
	EndTime  int64 `json:"endTime"`
	Status  string  `json:"status"` // active, claimed
}

// Rewards record
type StakingReward struct {
	UserID   string  `json:"userId"`
	PoolID  string  `json:"poolId"`
	Amount  float64 `json:"amount"`
	Timestamp int64 `json:"timestamp"`
}

// Store
type StakingStore struct {
	mu      sync.RWMutex
	pools   map[string]*StakingPool
	positions map[string]*StakingPosition
	rewards []StakingReward
}

var (
	sStore = &StakingStore{
		pools:     make(map[string]*StakingPool),
		positions: make(map[string]*StakingPosition),
		rewards:   make([]StakingReward, 0),
	}
)

// Initialize pools
func init() {
	pools := []*StakingPool{
		{ID: "btc_90", Asset: "BTC", Duration: 90, APY: 8.5, MinStake: 0.01, MaxStake: 100, TotalStaked: 0, Status: "active"},
		{ID: "eth_60", Asset: "ETH", Duration: 60, APY: 12.0, MinStake: 0.1, MaxStake: 1000, TotalStaked: 0, Status: "active"},
		{ID: "bnb_30", Asset: "BNB", Duration: 30, APY: 15.0, MinStake: 1.0, MaxStake: 10000, TotalStaked: 0, Status: "active"},
	}

	sStore.mu.Lock()
	defer sStore.mu.Unlock()
	for _, p := range pools {
		sStore.pools[p.ID] = p
	}
}

// Stake assets
func Stake(poolID, userID string, amount float64) (*StakingPosition, error) {
	sStore.mu.Lock()
	defer sStore.mu.Unlock()

	pool, ok := sStore.pools[poolID]
	if !ok {
		return nil, fmt.Errorf("pool not found")
	}

	if amount < pool.MinStake || amount > pool.MaxStake {
		return nil, fmt.Errorf("amount outside limits")
	}

	now := time.Now().UnixMilli()
	position := &StakingPosition{
		ID:        fmt.Sprintf("stake_%d", now),
		UserID:    userID,
		PoolID:   poolID,
		Amount:   amount,
		APY:      pool.APY,
		StartTime: now,
		EndTime:  now + int64(pool.Duration*86400000),
		Status:   "active",
	}

	// Update pool total
	pool.TotalStaked += amount

	sStore.positions[position.ID] = position
	return position, nil
}

// Claim rewards
func Claim(positionID string) (float64, error) {
	sStore.mu.Lock()
	defer sStore.mu.Unlock()

	pos, ok := sStore.positions[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}

	if pos.Status != "active" {
		return 0, fmt.Errorf("position not active")
	}

	// Calculate rewards
	daysStaked := (time.Now().UnixMilli() - pos.StartTime) / 86400000
	rewards := pos.Amount * pos.APY / 100 * float64(daysStaked) / 365

	pos.Status = "claimed"

	// Record reward
	sStore.rewards = append(sStore.rewards, StakingReward{
		UserID:   pos.UserID,
		PoolID:  pos.PoolID,
		Amount:  rewards,
		Timestamp: time.Now().UnixMilli(),
	})

	return rewards, nil
}

// Get APY
func GetAPY(poolID string) (float64, bool) {
	sStore.mu.RLock()
	defer sStore.mu.RUnlock()

	p, ok := sStore.pools[poolID]
	return p.APY, ok
}

// List pools
func ListPools() []*StakingPool {
	sStore.mu.RLock()
	defer sStore.mu.RUnlock()

	result := make([]*StakingPool, 0, len(sStore.pools))
	for _, p := range sStore.pools {
		result = append(result, p)
	}
	return result
}

func main() {
	fmt.Println("Staking service initialized")

	pools := ListPools()
	for _, p := range pools {
		fmt.Printf("Pool %s: %s %dd APY %.1f%%\n", p.ID, p.Asset, p.Duration, p.APY)
	}
}