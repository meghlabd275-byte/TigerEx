package main

import (
	"fmt"
	"time"
)

// Mining type
type MiningType string

const (
	MiningStandard MiningType = "standard"
	MiningDualReward MiningType = "dual_reward"
	MiningBoosted MiningType = "boosted"
	MiningFixedTerm MiningType = "fixed_term"
	MiningVeGov MiningType = "vegov"
)

// Pool status
type PoolStatus string

const (
	PoolUpcoming PoolStatus = "upcoming"
	PoolActive PoolStatus = "active"
	PoolEnded PoolStatus = "ended"
)

// Reward
type Reward struct {
	Token string  `json:"token"`
	Rate float64 `json:"rate"`
	Period int   `json:"period,omitempty"`
}

// Liquidity pool
type LiquidityPool struct {
	ID              string    `json:"id"`
	Pair           string    `json:"pair"`
	TokenA         string    `json:"tokenA"`
	TokenB         string    `json:"tokenB"`
	TVL            float64   `json:"tvl"`
	APR            float64   `json:"apr"`
	BoostMultiplier float64  `json:"boostMultiplier"`
	MiningToken    string    `json:"miningToken"`
	Rewards       []*Reward `json:"rewards"`
	Term          int       `json:"term"`
	StartedAt     int64     `json:"startedAt"`
	EndsAt        int64     `json:"endsAt"`
	Status       PoolStatus `json:"status"`
}

// User position
type UserPosition struct {
	UserID   string  `json:"userId"`
	PoolID   string  `json:"poolId"`
	Deposited float64 `json:"deposited"`
	RewardDebt float64 `json:"rewardDebt"`
	Claimed   float64 `json:"claimed"`
}

// Liquidity mining
type LiquidityMining struct {
	Pools     map[string]*LiquidityPool
	Positions map[string]*UserPosition
}

// New creates mining
func NewLiquidityMining() *LiquidityMining {
	return &LiquidityMining{
		Pools: make(map[string]*LiquidityPool),
		Positions: make(map[string]*UserPosition),
	}
}

// Create pool
func (m *LiquidityMining) CreatePool(pair, tokenA, tokenB, miningToken string, apr float64, termDays int, rewardToken string, rewardRate float64) *LiquidityPool {
	id := fmt.Sprintf("pool_%d", time.Now().UnixNano())
	now := time.Now().UnixMilli()
	
	pool := &LiquidityPool{
		ID: id,
		Pair: pair,
		TokenA: tokenA,
		TokenB: tokenB,
		TVL: 0,
		APR: apr,
		BoostMultiplier: 1.0,
		MiningToken: miningToken,
		Rewards: []*Reward{{Token: rewardToken, Rate: rewardRate}},
		Term: termDays,
		StartedAt: now,
		EndsAt: now + int64(termDays*86400000),
		Status: PoolActive,
	}
	
	m.Pools[id] = pool
	return pool
}

// Deposit
func (m *LiquidityMining) Deposit(userID, poolID string, amount float64) *UserPosition {
	pool := m.Pools[poolID]
	if pool == nil {
		return nil
	}
	
	key := userID + "_" + poolID
	pos := &UserPosition{
		UserID: userID,
		PoolID: poolID,
		Deposited: amount,
	}
	
	pool.TVL += amount
	m.Positions[key] = pos
	return pos
}

// Claim rewards
func (m *LiquidityMining) Claim(userID, poolID string) float64 {
	key := userID + "_" + poolID
	pos := m.Positions[key]
	if pos == nil {
		return 0
	}
	
	reward := pos.Deposited * 0.01 // Simplified
	pos.Claimed += reward
	return reward
}

func main() {
	mining := NewLiquidityMining()
	
	// Create pool
	pool := mining.CreatePool("ETH-USDT", "ETH", "USDT", "TIGER", 0.25, 30, "TIGER", 100)
	fmt.Printf("Pool: %s APR: %.1f%%\n", pool.Pair, pool.APR*100)
	
	// Deposit
	pos := mining.Deposit("user1", pool.ID, 10000)
	fmt.Printf("Deposited: %.2f\n", pos.Deposited)
	
	// Claim
	reward := mining.Claim("user1", pool.ID)
	fmt.Printf("Reward: %.2f\n", reward)
}