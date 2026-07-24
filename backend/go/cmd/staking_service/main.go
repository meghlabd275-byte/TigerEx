package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// =============================================================================
// ERROR TYPES
// =============================================================================

type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e APIError) Error() string {
	return e.Message
}

// =============================================================================
// DATA TYPES
// =============================================================================

type StakingPool struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Asset           string    `json:"asset"`
	Network         string    `json:"network"`
	Duration        int      `json:"duration"` // in days
	APY             float64  `json:"apy"`
	MinStake        float64  `json:"min_stake"`
	MaxStake        float64  `json:"max_stake"`
	TotalStaked     float64  `json:"total_staked"`
	RewardPool      float64  `json:"reward_pool"`
	Status          string    `json:"status"` // "active", "paused", "completed"
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	CreatedAt       time.Time `json:"created_at"`
}

type StakingPosition struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	PoolID          string    `json:"pool_id"`
	Amount          float64   `json:"amount"`
	RewardAmount    float64   `json:"reward_amount"`
	PendingReward   float64   `json:"pending_reward"`
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	Status          string    `json:"status"` // "active", "unclaimed", "claimed"
	ClaimedAt       *time.Time `json:"claimed_at"`
	CreatedAt       time.Time `json:"created_at"`
}

type StakingReward struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	PoolID      string    `json:"pool_id"`
	PositionID  string    `json:"position_id"`
	Amount      float64   `json:"amount"`
	Type        string    `json:"type"` // "staking", "early_unstake"
	TaxRate     float64   `json:"tax_rate"`
	NetAmount   float64   `json:"net_amount"`
	Status      string    `json:"status"` // "pending", "available", "claimed"
	ClaimedAt   *time.Time `json:"claimed_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type StakingHistory struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	PoolID      string    `json:"pool_id"`
	Action      string    `json:"action"` // "stake", "unstake", "claim", "claim_all"
	Amount      float64   `json:"amount"`
	Reward      float64   `json:"reward"`
	Status      string    `json:"status"`
	TxHash      string    `json:"tx_hash"`
	CreatedAt   time.Time `json:"created_at"`
}

type UserStakingStats struct {
	UserID            string  `json:"user_id"`
	TotalStaked      float64 `json:"total_staked"`
	TotalRewards     float64 `json:"total_rewards"`
	PendingRewards   float64 `json:"pending_rewards"`
	ActivePositions  int     `json:"active_positions"`
	CompletedPositions int    `json:"completed_positions"`
}

type StakingConfig struct {
	MinStakeAmount    float64 `json:"min_stake_amount"`
	MaxStakeAmount    float64 `json:"max_stake_amount"`
	EarlyUnstakeTax  float64 `json:"early_unstake_tax"`
	ClaimLockPeriod  int     `json:"claim_lock_period"` // in hours
	AutoCompound     bool    `json:"auto_compound"`
}

// =============================================================================
// STAKING SERVICE
// =============================================================================

type StakingService struct {
	pools       map[string]*StakingPool
	positions   map[string]*StakingPosition
	rewards     map[string]*StakingReward
	history     map[string]*StakingHistory
	config      *StakingConfig
	mu          sync.RWMutex
}

func NewStakingService() *StakingService {
	svc := &StakingService{
		pools:    make(map[string]*StakingPool),
		positions: make(map[string]*StakingPosition),
		rewards:  make(map[string]*StakingReward),
		history:  make(map[string]*StakingHistory),
		config: &StakingConfig{
			MinStakeAmount:   10.0,
			MaxStakeAmount:   1000000.0,
			EarlyUnstakeTax:  0.1, // 10%
			ClaimLockPeriod:  24,
			AutoCompound:     false,
		},
	}

	// Initialize default staking pools
	svc.initPools()

	return svc
}

func (s *StakingService) initPools() {
	pools := []*StakingPool{
		{
			ID:          "eth-staking-30d",
			Name:        "Ethereum Staking 30 Days",
			Asset:       "ETH",
			Network:     "Ethereum",
			Duration:    30,
			APY:         5.5,
			MinStake:    0.01,
			MaxStake:    1000.0,
			TotalStaked: 15420.5,
			RewardPool:  50000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -1, 0),
			EndTime:     time.Now().AddDate(0, 2, 0),
			CreatedAt:   time.Now().AddDate(0, -1, 0),
		},
		{
			ID:          "eth-staking-60d",
			Name:        "Ethereum Staking 60 Days",
			Asset:       "ETH",
			Network:     "Ethereum",
			Duration:    60,
			APY:         7.2,
			MinStake:    0.01,
			MaxStake:    1000.0,
			TotalStaked: 8540.2,
			RewardPool:  35000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -1, 0),
			EndTime:     time.Now().AddDate(0, 2, 0),
			CreatedAt:   time.Now().AddDate(0, -1, 0),
		},
		{
			ID:          "eth-staking-90d",
			Name:        "Ethereum Staking 90 Days",
			Asset:       "ETH",
			Network:     "Ethereum",
			Duration:    90,
			APY:         9.5,
			MinStake:    0.01,
			MaxStake:    1000.0,
			TotalStaked: 25680.8,
			RewardPool:  120000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -2, 0),
			EndTime:     time.Now().AddDate(0, 3, 0),
			CreatedAt:   time.Now().AddDate(0, -2, 0),
		},
		{
			ID:          "dot-staking-30d",
			Name:        "Polkadot Staking 30 Days",
			Asset:       "DOT",
			Network:     "Polkadot",
			Duration:    30,
			APY:         12.5,
			MinStake:    10.0,
			MaxStake:    100000.0,
			TotalStaked: 125000.0,
			RewardPool:  80000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -1, 0),
			EndTime:     time.Now().AddDate(0, 2, 0),
			CreatedAt:   time.Now().AddDate(0, -1, 0),
		},
		{
			ID:          "sol-staking-30d",
			Name:        "Solana Staking 30 Days",
			Asset:       "SOL",
			Network:     "Solana",
			Duration:    30,
			APY:         8.5,
			MinStake:    1.0,
			MaxStake:    10000.0,
			TotalStaked: 85000.0,
			RewardPool:  65000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -1, 0),
			EndTime:     time.Now().AddDate(0, 2, 0),
			CreatedAt:   time.Now().AddDate(0, -1, 0),
		},
		{
			ID:          "ada-staking-30d",
			Name:        "Cardano Staking 30 Days",
			Asset:       "ADA",
			Network:     "Cardano",
			Duration:    30,
			APY:         5.0,
			MinStake:    100.0,
			MaxStake:    1000000.0,
			TotalStaked: 50000000.0,
			RewardPool:  2500000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -3, 0),
			EndTime:     time.Now().AddDate(0, 6, 0),
			CreatedAt:   time.Now().AddDate(0, -3, 0),
		},
		{
			ID:          "atom-staking-30d",
			Name:        "Cosmos Staking 30 Days",
			Asset:       "ATOM",
			Network:     "Cosmos",
			Duration:    30,
			APY:         15.0,
			MinStake:    10.0,
			MaxStake:    100000.0,
			TotalStaked: 250000.0,
			RewardPool:  180000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -1, 0),
			EndTime:     time.Now().AddDate(0, 2, 0),
			CreatedAt:   time.Now().AddDate(0, -1, 0),
		},
		{
			ID:          "avax-staking-30d",
			Name:        "Avalanche Staking 30 Days",
			Asset:       "AVAX",
			Network:     "Avalanche",
			Duration:    30,
			APY:         9.8,
			MinStake:    25.0,
			MaxStake:    50000.0,
			TotalStaked: 180000.0,
			RewardPool:  90000.0,
			Status:      "active",
			StartTime:   time.Now().AddDate(0, -1, 0),
			EndTime:     time.Now().AddDate(0, 2, 0),
			CreatedAt:   time.Now().AddDate(0, -1, 0),
		},
	}

	for _, pool := range pools {
		s.pools[pool.ID] = pool
	}
}

// =============================================================================
// POOL MANAGEMENT
// =============================================================================

func (s *StakingService) GetPools(status string) []*StakingPool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*StakingPool
	for _, pool := range s.pools {
		if status == "" || pool.Status == status {
			result = append(result, pool)
		}
	}
	return result
}

func (s *StakingService) GetPool(poolID string) (*StakingPool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	pool, ok := s.pools[poolID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Pool not found"}
	}
	return pool, nil
}

// =============================================================================
// STAKING OPERATIONS
// =============================================================================

func (s *StakingService) CreateStake(userID, poolID string, amount float64) (*StakingPosition, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate pool
	pool, ok := s.pools[poolID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Pool not found"}
	}

	if pool.Status != "active" {
		return nil, APIError{Code: 400, Message: "Pool is not active"}
	}

	// Validate amount
	if amount < pool.MinStake {
		return nil, APIError{Code: 400, Message: fmt.Sprintf("Minimum stake is %f", pool.MinStake)}
	}

	if amount > pool.MaxStake {
		return nil, APIError{Code: 400, Message: fmt.Sprintf("Maximum stake is %f", pool.MaxStake)}
	}

	// Calculate end time
	now := time.Now()
	endTime := now.AddDate(0, 0, pool.Duration)

	// Create position
	position := &StakingPosition{
		ID:            uuid.New().String(),
		UserID:        userID,
		PoolID:        poolID,
		Amount:        amount,
		RewardAmount:  0,
		PendingReward: 0,
		StartTime:     now,
		EndTime:       endTime,
		Status:        "active",
		CreatedAt:     now,
	}

	// Update pool total
	pool.TotalStaked += amount

	// Store position
	s.positions[position.ID] = position

	// Record history
	history := &StakingHistory{
		ID:        uuid.New().String(),
		UserID:    userID,
		PoolID:   poolID,
		Action:   "stake",
		Amount:   amount,
		Reward:   0,
		Status:   "completed",
		TxHash:   s.generateTxHash(),
		CreatedAt: now,
	}
	s.history[history.ID] = history

	return position, nil
}

func (s *StakingService) Unstake(userID, positionID string) (*StakingReward, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate position
	position, ok := s.positions[positionID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Position not found"}
	}

	if position.UserID != userID {
		return nil, APIError{Code: 403, Message: "Not authorized"}
	}

	if position.Status != "active" {
		return nil, APIError{Code: 400, Message: "Position is not active"}
	}

	// Check if lock period is over
	now := time.Now()
	if now.Before(position.EndTime) {
		return nil, APIError{Code: 400, Message: "Lock period not yet over"}
	}

	// Calculate reward
	pool := s.pools[position.PoolID]
	daysStaked := now.Sub(position.StartTime).Hours() / 24
	reward := position.Amount * (pool.APY / 100) * (daysStaked / 365)

	// Create reward record
	rewardRecord := &StakingReward{
		ID:         uuid.New().String(),
		UserID:     userID,
		PoolID:    position.PoolID,
		PositionID: positionID,
		Amount:    reward,
		Type:      "staking",
		TaxRate:    0,
		NetAmount: reward,
		Status:    "available",
		CreatedAt: now,
	}

	// Update pool
	pool.TotalStaked -= position.Amount
	pool.RewardPool -= reward

	// Update position
	position.Status = "unclaimed"
	position.RewardAmount = reward
	position.PendingReward = 0

	// Record history
	history := &StakingHistory{
		ID:        uuid.New().String(),
		UserID:    userID,
		PoolID:   position.PoolID,
		Action:   "unstake",
		Amount:   position.Amount,
		Reward:   reward,
		Status:   "completed",
		TxHash:   s.generateTxHash(),
		CreatedAt: now,
	}
	s.history[history.ID] = history

	s.rewards[rewardRecord.ID] = rewardRecord

	return rewardRecord, nil
}

func (s *StakingService) EarlyUnstake(userID, positionID string) (*StakingReward, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate position
	position, ok := s.positions[positionID]
	if !ok {
		return nil, APIError{Code: 404, Message: "Position not found"}
	}

	if position.UserID != userID {
		return nil, APIError{Code: 403, Message: "Not authorized"}
	}

	if position.Status != "active" {
		return nil, APIError{Code: 400, Message: "Position is not active"}
	}

	// Calculate partial reward (pro-rata)
	pool := s.pools[position.PoolID]
	daysStaked := time.Since(position.StartTime).Hours() / 24
	reward := position.Amount * (pool.APY / 100) * (daysStaked / 365)

	// Apply early unstake tax
	tax := reward * s.config.EarlyUnstakeTax
	netReward := reward - tax

	// Create reward record
	rewardRecord := &StakingReward{
		ID:         uuid.New().String(),
		UserID:     userID,
		PoolID:    position.PoolID,
		PositionID: positionID,
		Amount:    reward,
		Type:      "early_unstake",
		TaxRate:    s.config.EarlyUnstakeTax,
		NetAmount: netReward,
		Status:    "available",
		CreatedAt: time.Now(),
	}

	// Update pool
	pool.TotalStaked -= position.Amount

	// Update position
	position.Status = "unclaimed"
	position.RewardAmount = netReward
	position.PendingReward = 0

	s.rewards[rewardRecord.ID] = rewardRecord

	return rewardRecord, nil
}

func (s *StakingService) ClaimReward(userID, rewardID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate reward
	reward, ok := s.rewards[rewardID]
	if !ok {
		return APIError{Code: 404, Message: "Reward not found"}
	}

	if reward.UserID != userID {
		return APIError{Code: 403, Message: "Not authorized"}
	}

	if reward.Status != "available" {
		return APIError{Code: 400, Message: "Reward not available for claim"}
	}

	// Mark as claimed
	now := time.Now()
	reward.Status = "claimed"
	reward.ClaimedAt = &now

	// Update position if exists
	if position, ok := s.positions[reward.PositionID]; ok {
		position.Status = "claimed"
		position.ClaimedAt = &now
	}

	// Record history
	history := &StakingHistory{
		ID:        uuid.New().String(),
		UserID:    userID,
		PoolID:   reward.PoolID,
		Action:   "claim",
		Amount:   reward.NetAmount,
		Reward:   0,
		Status:   "completed",
		TxHash:   s.generateTxHash(),
		CreatedAt: now,
	}
	s.history[history.ID] = history

	return nil
}

func (s *StakingService) ClaimAllRewards(userID string) ([]*StakingReward, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var claimedRewards []*StakingReward
	now := time.Now()

	for _, reward := range s.rewards {
		if reward.UserID == userID && reward.Status == "available" {
			reward.Status = "claimed"
			reward.ClaimedAt = &now

			// Update position if exists
			if position, ok := s.positions[reward.PositionID]; ok {
				position.Status = "claimed"
				position.ClaimedAt = &now
			}

			claimedRewards = append(claimedRewards, reward)

			// Record history
			history := &StakingHistory{
				ID:        uuid.New().String(),
				UserID:    userID,
				PoolID:   reward.PoolID,
				Action:   "claim_all",
				Amount:   reward.NetAmount,
				Reward:   0,
				Status:   "completed",
				TxHash:   s.generateTxHash(),
				CreatedAt: now,
			}
			s.history[history.ID] = history
		}
	}

	if len(claimedRewards) == 0 {
		return nil, APIError{Code: 400, Message: "No rewards available to claim"}
	}

	return claimedRewards, nil
}

// =============================================================================
// QUERIES
// =============================================================================

func (s *StakingService) GetUserPositions(userID string) []*StakingPosition {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*StakingPosition
	for _, pos := range s.positions {
		if pos.UserID == userID {
			result = append(result, pos)
		}
	}
	return result
}

func (s *StakingService) GetUserRewards(userID string) []*StakingReward {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*StakingReward
	for _, reward := range s.rewards {
		if reward.UserID == userID {
			result = append(result, reward)
		}
	}
	return result
}

func (s *StakingService) GetUserStats(userID string) *UserStakingStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := &UserStakingStats{
		UserID:          userID,
		TotalStaked:    0,
		TotalRewards:    0,
		PendingRewards:  0,
		ActivePositions: 0,
	}

	for _, pos := range s.positions {
		if pos.UserID == userID {
			stats.TotalStaked += pos.Amount
			if pos.Status == "active" {
				stats.ActivePositions++
			} else {
				stats.CompletedPositions++
			}
		}
	}

	for _, reward := range s.rewards {
		if reward.UserID == userID {
			stats.TotalRewards += reward.NetAmount
			if reward.Status == "available" {
				stats.PendingRewards += reward.NetAmount
			}
		}
	}

	return stats
}

func (s *StakingService) GetUserHistory(userID string) []*StakingHistory {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*StakingHistory
	for _, hist := range s.history {
		if hist.UserID == userID {
			result = append(result, hist)
		}
	}
	return result
}

func (s *StakingService) CalculatePendingRewards(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var totalPending float64
	now := time.Now()

	for _, pos := range s.positions {
		if pos.UserID == userID && pos.Status == "active" {
			pool := s.pools[pos.PoolID]
			daysStaked := now.Sub(pos.StartTime).Hours() / 24
			reward := pos.Amount * (pool.APY / 100) * (daysStaked / 365)
			totalPending += reward
			pos.PendingReward = reward
		}
	}

	return totalPending
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

func (s *StakingService) GetPoolsHandler(c *gin.Context) {
	status := c.Query("status")
	pools := s.GetPools(status)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": pools})
}

func (s *StakingService) GetPoolHandler(c *gin.Context) {
	poolID := c.Param("id")
	pool, err := s.GetPool(poolID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": pool})
}

func (s *StakingService) CreateStakeHandler(c *gin.Context) {
	var req struct {
		UserID  string  `json:"user_id" binding:"required"`
		PoolID string  `json:"pool_id" binding:"required"`
		Amount float64 `json:"amount" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	position, err := s.CreateStake(req.UserID, req.PoolID, req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": position})
}

func (s *StakingService) UnstakeHandler(c *gin.Context) {
	positionID := c.Param("id")

	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	reward, err := s.Unstake(req.UserID, positionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": reward})
}

func (s *StakingService) ClaimRewardHandler(c *gin.Context) {
	rewardID := c.Param("id")

	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	if err := s.ClaimReward(req.UserID, rewardID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (s *StakingService) ClaimAllHandler(c *gin.Context) {
	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	rewards, err := s.ClaimAllRewards(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": rewards})
}

func (s *StakingService) GetUserPositionsHandler(c *gin.Context) {
	userID := c.Param("user_id")
	positions := s.GetUserPositions(userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": positions})
}

func (s *StakingService) GetUserRewardsHandler(c *gin.Context) {
	userID := c.Param("user_id")
	rewards := s.GetUserRewards(userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rewards})
}

func (s *StakingService) GetUserStatsHandler(c *gin.Context) {
	userID := c.Param("user_id")
	stats := s.GetUserStats(userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": stats})
}

func (s *StakingService) GetUserHistoryHandler(c *gin.Context) {
	userID := c.Param("user_id")
	history := s.GetUserHistory(userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": history})
}

func (s *StakingService) CalculatePendingRewardsHandler(c *gin.Context) {
	userID := c.Param("user_id")
	pending := s.CalculatePendingRewards(userID)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"pending_rewards": pending}})
}

func (s *StakingService) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "staking-service",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// =============================================================================
// HELPERS
// =============================================================================

func (s *StakingService) generateTxHash() string {
	hash := sha256.Sum256([]byte(uuid.New().String() + time.Now().Format(time.RFC3339Nano)))
	return "0x" + hex.EncodeToString(hash[:])[:64]
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	gin.SetMode(gin.ReleaseMode)

	svc := NewStakingService()

	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Health check
	r.GET("/health", svc.HealthCheck)

	// API routes
	api := r.Group("/api/v1/staking")
	{
		// Pools
		api.GET("/pools", svc.GetPoolsHandler)
		api.GET("/pools/:id", svc.GetPoolHandler)

		// Staking
		api.POST("/stake", svc.CreateStakeHandler)
		api.POST("/unstake/:id", svc.UnstakeHandler)

		// Rewards
		api.POST("/claim/:id", svc.ClaimRewardHandler)
		api.POST("/claim-all", svc.ClaimAllHandler)

		// User data
		api.GET("/users/:user_id/positions", svc.GetUserPositionsHandler)
		api.GET("/users/:user_id/rewards", svc.GetUserRewardsHandler)
		api.GET("/users/:user_id/stats", svc.GetUserStatsHandler)
		api.GET("/users/:user_id/history", svc.GetUserHistoryHandler)
		api.GET("/users/:user_id/pending", svc.CalculatePendingRewardsHandler)
	}

	fmt.Println("Starting Staking Service on :8087")
	r.Run(":8087")
}
