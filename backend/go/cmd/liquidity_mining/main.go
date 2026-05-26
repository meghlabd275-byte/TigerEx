// Package liquidity_mining provides liquidity mining rewards.
// Exchange incentive program for liquidity providers.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Pool info
type MiningPool struct {
	Symbol     string  `json:"symbol"`
	Token0     string  `json:"token0"`
	Token1     string  `json:"token1"`
	TVL        float64 `json:"tvl"` // total value locked
	APR        float64 `json:"apr"` // annual percentage reward
	Status    string  `json:"status"` // active, paused
}

// Provider position
type Provider struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Symbol   string  `json:"symbol"`
	Token0Amount float64 `json:"token0Amount"`
	Token1Amount float64 `json:"token1Amount"`
	Shares   float64 `json:"shares"`
	RewardDebt float64 `json:"rewardDebt"`
	RewardPaid float64 `json:"rewardPaid"`
}

// Reward allocation
type RewardAllocation struct {
	PoolID    string  `json:"poolId"`
	Period    int     `json:"period"` // week number
	Amount    float64 `json:"amount"`
	StartTime int64   `json:"startTime"`
	EndTime  int64   `json:"endTime"`
}

// Store
type LMStore struct {
	mu         sync.RWMutex
	pools      map[string]*MiningPool
	providers map[string]*Provider
	rewards    map[string][]RewardAllocation
}

var lmStore = &LMStore{
	pools: make(map[string]*MiningPool),
	providers: make(map[string]*Provider),
	rewards: make(map[string][]RewardAllocation),
}

func init() {
	pools := []*MiningPool{
		{Symbol: "BTC-USDT", Token0: "BTC", Token1: "USDT", TVL: 50000000, APR: 0.25, Status: "active"},
		{Mymbol: "ETH-USDT", Token0: "ETH", Token1: "USDT", TVL: 30000000, APR: 0.30, Status: "active"},
		{Symbol: "SOL-USDT", Token0: "SOL", Token1: "USDT", TVL: 10000000, APR: 0.40, Status: "active"},
	}
	lmStore.mu.Lock()
	for _, p := range pools {
		lmStore.pools[p.Symbol] = p
	}
	lmStore.mu.Unlock()
}

// Stake liquidity
func Stake(userID, symbol string, token0Amt, token1Amt float64) (*Provider, error) {
	lmStore.mu.RLock()
	pool, ok := lmStore.pools[symbol]
	lmStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("pool not found")
	}

	value := token0Amt * getTokenPrice(pool.Token0) + token1Amt * getTokenPrice(pool.Token1)
	shares := value

	provider := &Provider{
		ID: fmt.Sprintf("prov_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Token0Amount: token0Amt,
		Token1Amount: token1Amt,
		Shares: shares,
		RewardDebt: 0,
		RewardPaid: 0,
	}

	lmStore.mu.Lock()
	lmStore.providers[provider.ID] = provider
	lmStore.pools[symbol].TVL += value
	lmStore.mu.Unlock()

	return provider, nil
}

// Unstake
func Unstake(providerID string) (float64, error) {
	lmStore.mu.RLock()
	provider, ok := lmStore.providers[providerID]
	if !ok {
		lmStore.mu.RUnlock()
		return 0, fmt.Errorf("provider not found")
	}

	pool, poolOk := lmStore.pools[provider.Symbol]
	lmStore.mu.RUnlock()

	if poolOk {
		lmStore.mu.Lock()
		pool.TVL -= provider.Shares
		lmStore.mu.Unlock()
	}

	lmStore.mu.Lock()
	delete(lmStore.providers, providerID)
	lmStore.mu.Unlock()

	return provider.Shares, nil
}

// Claim rewards
func ClaimRewards(providerID string) (float64, error) {
	lmStore.mu.RLock()
	provider, ok := lmStore.providers[providerID]
	lmStore.mu.RUnlock()

	if !ok {
		return 0, fmt.Errorf("provider not found")
	}

	lmStore.mu.RLock()
	pool, poolOk := lmStore.pools[provider.Symbol]
	lmStore.mu.RUnlock()

	if !poolOk {
		return 0, fmt.Errorf("pool not found")
	}

	reward := provider.Shares / pool.TVR * pool.APR * 100 // Simplified

	lmStore.mu.Lock()
	provider.RewardPaid += reward
	lmStore.mu.Unlock()

	return reward, nil
}

// Get pool APR
func GetPoolAPR(symbol string) float64 {
	lmStore.mu.RLock()
	defer lmStore.mu.RUnlock()
	if pool, ok := lmStore.pools[symbol]; ok {
		return pool.APR
	}
	return 0
}

// Get provider info
func GetProvider(providerID string) (*Provider, error) {
	lmStore.mu.RLock()
	defer lmStore.mu.RUnlock()
	if p, ok := lmStore.providers[providerID]; ok {
		return p, nil
	}
	return nil, fmt.Errorf("provider not found")
}

func getTokenPrice(token string) float64 {
	prices := map[string]float64{"BTC": 65000, "ETH": 3500, "USDT": 1, "SOL": 150, "ETH": 3500}
	if p, ok := prices[token]; ok {
		return p
	}
	return 0
}

func main() {
	fmt.Println("Liquidity Mining service initialized")

	// Stake
	prov, _ := Stake("user1", "BTC-USDT", 1.0, 50000)
	fmt.Printf("Staked: %.4f shares\n", prov.Shares)

	// APR
	apr := GetPoolAPR("BTC-USDT")
	fmt.Printf("APR: %.2%%\n", apr*100)
}