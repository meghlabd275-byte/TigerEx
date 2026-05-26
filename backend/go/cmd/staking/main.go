// Package staking provides Staking Service
package main

import (
	"fmt"
	"sync"
	"time"
)

type StakeStatus string

const (
	StatusActive StakeStatus = "active"
	StatusUnstaking StakeStatus = "unstaking"
	StatusWithdrawn StakeStatus = "withdrawn"
)

type StakingPool struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Token      string  `json:"token"`
	DurationDays int `json:"durationDays"`
	Apy        float64 `json:"apy"`
	MinStake   float64 `json:"minStake"`
	MaxStake   float64 `json:"maxStake"`
	TotalStaked float64 `json:"totalStaked"`
}

type StakePosition struct {
	ID         string      `json:"id"`
	UserID     string      `json:"userId"`
	PoolID    string      `json:"poolId"`
	Amount    float64     `json:"amount"`
	Reward    float64     `json:"reward"`
	Status    StakeStatus `json:"status"`
	StartTime time.Time  `json:"startTime"`
	EndTime  *time.Time `json:"endTime"`
}

type StakingService struct {
	mu         sync.RWMutex
	pools     map[string]*StakingPool
	positions map[string][]*StakePosition
	userStakes map[string]map[string]*StakePosition
	counter   uint64
}

func NewStakingService() *StakingService {
	ss := &StakingService{
		pools:     make(map[string]*StakingPool),
		positions: make(map[string][]*StakePosition),
		userStakes: make(map[string]map[string]*StakePosition),
	}
	ss.pools["btc_stake"] = &StakingPool{ID: "btc_stake", Name: "BTC Staking", Token: "BTC", DurationDays: 90, Apy: 0.08, MinStake: 0.01, MaxStake: 100}
	ss.pools["eth_stake"] = &StakingPool{ID: "eth_stake", Name: "ETH Staking", Token: "ETH", DurationDays: 60, Apy: 0.06, MinStake: 0.1, MaxStake: 1000}
	ss.pools["usdt_stake"] = &StakingPool{ID: "usdt_stake", Name: "USDT Staking", Token: "USDT", DurationDays: 30, Apy: 0.12, MinStake: 100, MaxStake: 100000}
	return ss
}

func (ss *StakingService) Stake(userID, poolID string, amount float64) (*StakePosition, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	pool, ok := ss.pools[poolID]
	if !ok {
		return nil, fmt.Errorf("pool not found")
	}
	if pool.Status != "active" {
		return nil, fmt.Errorf("pool not active")
	}
	if amount < pool.MinStake {
		return nil, fmt.Errorf("below minimum stake")
	}

	ss.counter++
	endTime := time.Now().Add(time.Duration(pool.DurationDays) * 24 * time.Hour)
	position := &StakePosition{
		ID: fmt.Sprintf("stake_%d", ss.counter),
		UserID: userID,
		PoolID: poolID,
		Amount: amount,
		Status: StatusActive,
		StartTime: time.Now(),
		EndTime: &endTime,
	}

	if ss.userStakes[userID] == nil {
		ss.userStakes[userID] = make(map[string]*StakePosition)
	}
	ss.userStakes[userID][position.ID] = position
	ss.positions[poolID] = append(ss.positions[poolID], position)
	pool.TotalStaked += amount
	return position, nil
}

func (ss *StakingService) ClaimRewards(userID, positionID string) (float64, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	position, ok := ss.userStakes[userID][positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}
	pool := ss.pools[position.PoolID]
	daysStaked := time.Since(position.StartTime).Hours() / 24
	rewards := position.Amount * pool.Apy * (daysStaked / 365)
	position.Reward = rewards
	return rewards, nil
}

func (ss *StakingService) GetPools() []*StakingPool {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	result := make([]*StakingPool, 0, len(ss.pools))
	for _, pool := range ss.pools {
		result = append(result, pool)
	}
	return result
}

func main() {
	ss := NewStakingService()
	pools := ss.GetPools()
	for _, p := range pools {
		fmt.Printf("Pool: %s APY: %.1f%%\n", p.Name, p.Apy*100)
	}

	stake, _ := ss.Stake("user1", "btc_stake", 1.0)
	fmt.Printf("Staked: %s\n", stake.ID)

	rewards, _ := ss.ClaimRewards("user1", stake.ID)
	fmt.Printf("Rewards: %.6f BTC\n", rewards)
}