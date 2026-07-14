// TigerEx Staking Service
// Staking and Earn products for passive income

package staking

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	StakingTypeLocked   = "locked"
	StakingTypeFlexible = "flexible"
	StakingTypeDefi     = "defi"

	StatusActive    = "active"
	StatusUnstaked  = "unstaked"
	StatusPending   = "pending"
	StatusCompleted = "completed"

	MinStakingAmount = 10.0
)

// ============================================================================
// DATA STRUCTURES
// ============================================================================

// StakingPool represents a staking pool
type StakingPool struct {
	ID               string    `json:"id"`
	Asset            string    `json:"asset"`
	Name             string    `json:"name"`
	Type             string    `json:"type"`
	APY              float64   `json:"apy"`
	Duration         int       `json:"duration"`
	MinAmount        float64   `json:"min_amount"`
	MaxAmount        float64   `json:"max_amount"`
	TotalStaked      float64   `json:"total_staked"`
	StakersCount     int       `json:"stakers_count"`
	RewardPool       float64   `json:"reward_pool"`
	StartTime        time.Time `json:"start_time"`
	EndTime          time.Time `json:"end_time"`
	Status           string    `json:"status"`
	EarlyUnstakeFee  float64   `json:"early_unstake_fee"`
}

// StakingPosition represents a user's staking position
type StakingPosition struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	PoolID          string    `json:"pool_id"`
	Asset           string    `json:"asset"`
	Amount          float64   `json:"amount"`
	StakedAt        time.Time `json:"staked_at"`
	UnlockTime      time.Time `json:"unlock_time"`
	Reward          float64   `json:"reward"`
	ClaimedReward   float64   `json:"claimed_reward"`
	Status          string    `json:"status"`
}

// StakingReward represents a staking reward
type StakingReward struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	PoolID     string    `json:"pool_id"`
	Asset      string    `json:"asset"`
	Amount     float64   `json:"amount"`
	RewardType string    `json:"reward_type"`
	CreatedAt  time.Time `json:"created_at"`
}

// ============================================================================
// STAKING MANAGER
// ============================================================================

type StakingManager struct {
	mu          sync.RWMutex
	pools       map[string]*StakingPool
	positions   map[string]*StakingPosition
	userStaking map[string]map[string]*StakingPosition
	rewards     map[string][]StakingReward
}

func NewStakingManager() *StakingManager {
	sm := &StakingManager{
		pools:       make(map[string]*StakingPool),
		positions:   make(map[string]*StakingPosition),
		userStaking: make(map[string]map[string]*StakingPosition),
		rewards:     make(map[string][]StakingReward),
	}
	sm.initializePools()
	return sm
}

func (sm *StakingManager) initializePools() {
	now := time.Now()

	pools := []*StakingPool{
		{ID: "tgr_locked_30", Asset: "TGR", Name: "TGR 30-Day Locked Staking", Type: StakingTypeLocked, APY: 25.0, Duration: 30, MinAmount: 100.0, MaxAmount: 1000000.0, TotalStaked: 0, StakersCount: 0, RewardPool: 0, StartTime: now, EndTime: now.Add(365*24*time.Hour), Status: StatusActive, EarlyUnstakeFee: 0.02},
		{ID: "tgr_locked_60", Asset: "TGR", Name: "TGR 60-Day Locked Staking", Type: StakingTypeLocked, APY: 35.0, Duration: 60, MinAmount: 100.0, MaxAmount: 1000000.0, TotalStaked: 0, StakersCount: 0, RewardPool: 0, StartTime: now, EndTime: now.Add(365*24*time.Hour), Status: StatusActive, EarlyUnstakeFee: 0.015},
		{ID: "tgr_locked_90", Asset: "TGR", Name: "TGR 90-Day Locked Staking", Type: StakingTypeLocked, APY: 50.0, Duration: 90, MinAmount: 100.0, MaxAmount: 1000000.0, TotalStaked: 0, StakersCount: 0, RewardPool: 0, StartTime: now, EndTime: now.Add(365*24*time.Hour), Status: StatusActive, EarlyUnstakeFee: 0.01},
		{ID: "tgr_flexible", Asset: "TGR", Name: "TGR Flexible Staking", Type: StakingTypeFlexible, APY: 12.0, Duration: 0, MinAmount: 10.0, MaxAmount: 0, TotalStaked: 0, StakersCount: 0, RewardPool: 0, StartTime: now, EndTime: now.Add(365*24*time.Hour), Status: StatusActive, EarlyUnstakeFee: 0},
		{ID: "eth_flexible", Asset: "ETH", Name: "ETH Flexible Staking", Type: StakingTypeFlexible, APY: 5.0, Duration: 0, MinAmount: 0.1, MaxAmount: 0, TotalStaked: 0, StakersCount: 0, RewardPool: 0, StartTime: now, EndTime: now.Add(365*24*time.Hour), Status: StatusActive, EarlyUnstakeFee: 0},
		{ID: "btc_flexible", Asset: "BTC", Name: "BTC Flexible Staking", Type: StakingTypeFlexible, APY: 3.5, Duration: 0, MinAmount: 0.001, MaxAmount: 0, TotalStaked: 0, StakersCount: 0, RewardPool: 0, StartTime: now, EndTime: now.Add(365*24*time.Hour), Status: StatusActive, EarlyUnstakeFee: 0},
	}

	for _, pool := range pools {
		sm.pools[pool.ID] = pool
	}
}

func (sm *StakingManager) CreateStaking(userID, poolID string, amount float64) (*StakingPosition, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if amount < MinStakingAmount {
		return nil, fmt.Errorf("minimum staking amount is %f", MinStakingAmount)
	}

	pool, exists := sm.pools[poolID]
	if !exists {
		return nil, errors.New("staking pool not found")
	}

	if pool.Status != StatusActive {
		return nil, errors.New("staking pool is not active")
	}

	if amount < pool.MinAmount {
		return nil, fmt.Errorf("minimum staking amount for this pool is %f", pool.MinAmount)
	}
	if pool.MaxAmount > 0 && amount > pool.MaxAmount {
		return nil, fmt.Errorf("maximum staking amount for this pool is %f", pool.MaxAmount)
	}

	now := time.Now()
	position := &StakingPosition{
		ID:            fmt.Sprintf("STK%d%d", now.Unix(), now.Nanosecond()),
		UserID:        userID,
		PoolID:        poolID,
		Asset:         pool.Asset,
		Amount:        amount,
		StakedAt:      now,
		UnlockTime:    time.Time{},
		Reward:        0,
		ClaimedReward: 0,
		Status:        StatusActive,
	}

	if pool.Type == StakingTypeLocked {
		position.UnlockTime = now.Add(time.Duration(pool.Duration) * 24 * time.Hour)
	}

	sm.positions[position.ID] = position

	if _, ok := sm.userStaking[userID]; !ok {
		sm.userStaking[userID] = make(map[string]*StakingPosition)
	}
	sm.userStaking[userID][position.ID] = position

	pool.TotalStaked += amount
	pool.StakersCount++

	return position, nil
}

func (sm *StakingManager) Unstake(userID, positionID string) (float64, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	position, exists := sm.positions[positionID]
	if !exists {
		return 0, errors.New("staking position not found")
	}

	if position.UserID != userID {
		return 0, errors.New("unauthorized")
	}

	if position.Status != StatusActive {
		return 0, errors.New("position is not active")
	}

	pool := sm.pools[position.PoolID]
	if pool.Type == StakingTypeLocked && time.Now().Before(position.UnlockTime) {
		return 0, fmt.Errorf("position unlocks at %s", position.UnlockTime.Format("2006-01-02 15:04:05"))
	}

	reward := sm.calculateReward(position, pool)

	position.Status = StatusUnstaked
	position.Reward = reward

	pool.TotalStaked -= position.Amount
	pool.StakersCount--
	pool.RewardPool += reward

	return position.Amount + reward, nil
}

func (sm *StakingManager) ClaimReward(userID, positionID string) (float64, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	position, exists := sm.positions[positionID]
	if !exists {
		return 0, errors.New("staking position not found")
	}

	if position.UserID != userID {
		return 0, errors.New("unauthorized")
	}

	pool := sm.pools[position.PoolID]
	reward := sm.calculateReward(position, pool)

	claimable := reward - position.ClaimedReward
	if claimable <= 0 {
		return 0, errors.New("no rewards to claim")
	}

	position.ClaimedReward = reward

	rewardRecord := StakingReward{
		ID:         fmt.Sprintf("RWD%d%d", time.Now().Unix(), time.Now().Nanosecond()),
		UserID:     userID,
		PoolID:     position.PoolID,
		Asset:      position.Asset,
		Amount:     claimable,
		RewardType: "staking",
		CreatedAt:  time.Now(),
	}
	sm.rewards[userID] = append(sm.rewards[userID], rewardRecord)

	return claimable, nil
}

func (sm *StakingManager) calculateReward(position *StakingPosition, pool *StakingPool) float64 {
	days := time.Since(position.StakedAt).Hours() / 24
	return position.Amount * (pool.APY / 100) * (days / 365)
}

func (sm *StakingManager) GetStakingPools() []*StakingPool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	pools := make([]*StakingPool, 0, len(sm.pools))
	for _, pool := range sm.pools {
		pools = append(pools, pool)
	}
	return pools
}

func (sm *StakingManager) GetStakingPool(poolID string) (*StakingPool, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	pool, exists := sm.pools[poolID]
	if !exists {
		return nil, errors.New("pool not found")
	}
	return pool, nil
}

func (sm *StakingManager) GetUserPositions(userID string) []*StakingPosition {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	positions, exists := sm.userStaking[userID]
	if !exists {
		return nil
	}

	result := make([]*StakingPosition, 0, len(positions))
	for _, pos := range positions {
		result = append(result, pos)
	}
	return result
}

func (sm *StakingManager) GetUserRewards(userID string) []StakingReward {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	return sm.rewards[userID]
}

func (sm *StakingManager) GetTotalStaked(poolID string) (float64, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	pool, exists := sm.pools[poolID]
	if !exists {
		return 0, errors.New("pool not found")
	}
	return pool.TotalStaked, nil
}

func (sm *StakingManager) CalculateProjectedReward(poolID string, amount float64, days int) (float64, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	pool, exists := sm.pools[poolID]
	if !exists {
		return 0, errors.New("pool not found")
	}

	annualReward := amount * (pool.APY / 100)
	dailyReward := annualReward / 365

	return dailyReward * float64(days), nil
}

func (sp *StakingPool) ToJSON() (string, error) {
	data, err := json.Marshal(sp)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (sp *StakingPosition) ToJSON() (string, error) {
	data, err := json.Marshal(sp)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
