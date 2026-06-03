// Package staking provides staking and earn products.
// Supports flexible savings, fixed deposits, staking, and liquid staking.
package staking

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// StakeProduct represents a staking product
type StakeProduct struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	ProductType     ProductType     `json:"product_type"`
	Chain          string         `json:"chain"`
	Token          string         `json:"token"`
	MinStake       decimal.Decimal `json:"min_stake"`
	MaxStake       decimal.Decimal `json:"max_stake"`
	APY           decimal.Decimal `json:"apy"` // Annual percentage yield
	Duration      *time.Duration `json:"duration"` // Fixed term length, nil = flexible
	LockPeriod    time.Duration `json:"lock_period"`
	EarlyUnstakeFee decimal.Decimal `json:"early_unstake_fee"` // Early withdrawal fee
	IsActive      bool           `json:"is_active"`
	MaxStakers    int            `json:"max_stakers"`
	TotalStaked  decimal.Decimal `json:"total_staked"`
	CreatedAt    time.Time     `json:"created_at"`
}

// ProductType represents type of stake product
type ProductType string

const (
	ProductTypeFlexible Savings
	ProductTypeFixed Savings
	ProductTypeStaking Savings
	ProductTypeLiquidStaking Savings
	ProductTypeDeFiStaking Savings
)

// Savings represents stake/savings term

// StakePosition represents a user's stake position
type StakePosition struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	ProductID   string          `json:"product_id"`
	Token      string         `json:"token"`
	Amount     decimal.Decimal `json:"amount"`
	RewardDebt decimal.Decimal `json:"reward_debt"` // Pending reward to be claimed
	Claimed    decimal.Decimal `json:"claimed"`
	StartTime  time.Time     `json:"start_time"`
	EndTime   *time.Time    `json:"end_time"`
	Status    PositionStatus `json:"status"`
}

// PositionStatus represents stake position status
type PositionStatus string

const (
	PositionStatusActive   PositionStatus = "ACTIVE"
	PositionStatusUnstaking PositionStatus = "UNSTAKE_PENDING"
	PositionStatusCompleted PositionStatus = "COMPLETED"
)

// ClaimRecord represents a reward claim
type ClaimRecord struct {
	ID           string          `json:"id"`
	UserID       string          `json:"user_id"`
	ProductID    string         `json:"product_id"`
	Amount      decimal.Decimal `json:"amount"`
	Token       string         `json:"token"`
	BlockNumber int64          `json:"block_number"`
	TxHash     string         `json:"tx_hash"`
	ClaimedAt   time.Time      `json:"claimed_at"`
}

// RewardDistribution represents reward distribution info
type RewardDistribution struct {
	Period    int             `json:"period"` // Reward period (daily/weekly)
	StartTime time.Time       `json:"start_time"`
	EndTime   time.Time       `json:"end_time"`
}

// StakingEngine manages all staking operations
type StakingEngine struct {
	mu         sync.RWMutex
	products   map[string]*StakeProduct
	positions map[string]*StakePosition
	rewards   map[string][]*ClaimRecord
	blockchain StakeAdapter
	rewardDist *RewardDistribution
	cfg       *EngineConfig
}

// StakeAdapter adapts to blockchain staking
type StakeAdapter interface {
	Stake(ctx context.Context, userID, token, amount string) (txHash string, err error)
	Unstake(ctx context.Context, userID, token, amount string) (txHash string, err error)
	Claim(ctx context.Context, userID, token, productID string) (txHash string, err error)
	GetStakedAmount(userID, token string) (decimal.Decimal, error)
	GetPendingRewards(userID, token string) (decimal.Decimal, error)
}

// EngineConfig holds engine configuration
type EngineConfig struct {
	MaxPositionsPerUser int
	MaxProducts     int
	ClaimMinThreshold decimal.Decimal
}

// NewStakingEngine creates a new staking engine
func NewStakingEngine() *StakingEngine {
	return &StakingEngine{
		products:   make(map[string]*StakeProduct),
		positions: make(map[string]*StakePosition),
		rewards:   make(map[string][]*ClaimRecord),
		rewardDist: &RewardDistribution{Period: 86400}, // Daily
		cfg:      &EngineConfig{
			MaxPositionsPerUser: 50,
			MaxProducts: 100,
			ClaimMinThreshold: decimal.NewFromFloat(0.01),
		},
	}
}

// CreateProduct creates a new staking product
func (se *StakingEngine) CreateProduct(product *StakeProduct) error {
	se.mu.Lock()
	defer se.mu.Unlock()

	// Validate
	if product.APY.IsNegative() || product.APY.GreaterThan(decimal.NewFromFloat(100)) {
		return fmt.Errorf("APY must be between 0 and 100")
	}

	product.ID = generateProductID()
	product.IsActive = true
	product.TotalStaked = decimal.Zero
	product.CreatedAt = time.Now()

	se.products[product.ID] = product

	return nil
}

// Stake stakes tokens in a product
func (se *StakingEngine) Stake(ctx context.Context, userID, productID string, amount decimal.Decimal) (*StakePosition, error) {
	se.mu.RLock()
	product, ok := se.products[productID]
	se.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("product not found")
	}

	if !product.IsActive {
		return nil, fmt.Errorf("product is not active")
	}

	if amount.LessThan(product.MinStake) {
		return nil, fmt.Errorf("minimum stake is %s", product.MinStake.String())
	}

	if product.MaxStake.IsZero() == false && amount.GreaterThan(product.MaxStake) {
		return nil, fmt.Errorf("maximum stake is %s", product.MaxStake.String())
	}

	// Check total staked limit
	if product.TotalStaked.Add(amount).GreaterThan(product.MaxStake) {
		return nil, fmt.Errorf("total staking capacity reached")
	}

	// Execute blockchain stake
	txHash, err := se.blockchain.Stake(ctx, userID, product.Token, amount.String())
	if err != nil {
		return nil, err
	}

	position := &StakePosition{
		ID:         generatePositionID(),
		UserID:     userID,
		ProductID: productID,
		Token:     product.Token,
		Amount:    amount,
		RewardDebt: decimal.Zero,
		Claimed:   decimal.Zero,
		StartTime: time.Now(),
		Status:   PositionStatusActive,
	}

	se.mu.Lock()
	se.positions[position.ID] = position
	product.TotalStaked = product.TotalStaked.Add(amount)
	se.mu.Unlock()

	return position, nil
}

// Unstake unstakes tokens
func (se *StakingEngine) Unstake(ctx context.Context, userID, positionID string, amount *decimal.Decimal) (*StakePosition, error) {
	se.mu.RLock()
	position, ok := se.positions[positionID]
	se.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	if position.Status != PositionStatusActive {
		return nil, fmt.Errorf("position not active")
	}

	product, ok := se.products[position.ProductID]
	if !ok {
		return nil, fmt.Errorf("product not found")
	}

	// Determine unstake amount
	unStakeAmount := amount
	if amount == nil || amount.IsZero() {
		unStakeAmount = &position.Amount
	}

	if unStakeAmount.GreaterThan(position.Amount) {
		return nil, fmt.Errorf("unstake amount exceeds staked amount")
	}

	// Check lock period for fixed products
	remainingDuration := time.Duration(0)
	if product.Duration != nil {
		expectedEnd := position.StartTime.Add(*product.Duration)
		remainingDuration = expectedEnd.Sub(time.Now())
		
		if remainingDuration > 0 {
			// Apply early unstake fee
			earlyFee := product.EarlyUnstakeFee
			penalty := unStakeAmount.Mul(earlyFee)
			// Would deduct penalty
			_ = penalty
		}
	}

	// Execute blockchain unstake
	txHash, err := se.blockchain.Unstake(ctx, userID, position.Token, unStakeAmount.String())
	if err != nil {
		return nil, err
	}
	_ = txHash

	// Update position
	position.Amount = position.Amount.Sub(*unStakeAmount)

	if position.Amount.IsZero() {
		position.Status = PositionStatusCompleted
	}

	se.mu.Lock()
	product.TotalStaked = product.TotalStaked.Sub(*unStakeAmount)
	se.mu.Unlock()

	return position, nil
}

// Claim claims pending rewards
func (se *StakingEngine) Claim(ctx context.Context, userID, positionID string) (*ClaimRecord, error) {
	se.mu.RLock()
	position, ok := se.positions[positionID]
	se.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	product, ok := se.products[position.ProductID]
	if !ok {
		return nil, fmt.Errorf("product not found")
	}

	// Calculate pending rewards
	pendingReward := se.calculatePendingReward(position)

	if pendingReward.LessThan(se.cfg.ClaimMinThreshold) {
		return nil, fmt.Errorf("claim amount below minimum threshold")
	}

	// Execute blockchain claim
	txHash, err := se.blockchain.Claim(ctx, userID, product.Token, product.ID)
	if err != nil {
		return nil, err
	}

	claim := &ClaimRecord{
		ID:        generateClaimID(),
		UserID:    userID,
		ProductID: product.ID,
		Amount:   pendingReward,
		Token:    product.Token + "-REWARD",
		TxHash:   txHash,
		ClaimedAt: time.Now(),
	}

	// Update position
	se.mu.Lock()
	position.Claimed = position.Claimed.Add(pendingReward)
	position.RewardDebt = decimal.Zero
	if se.rewards[userID] == nil {
		se.rewards[userID] = []*ClaimRecord{}
	}
	se.rewards[userID] = append(se.rewards[userID], claim)
	se.mu.Unlock()

	return claim, nil
}

// calculatePendingReward calculates pending reward for a position
func (se *StakingEngine) calculatePendingReward(position *StakePosition) decimal.Decimal {
	product, ok := se.products[position.ProductID]
	if !ok {
		return decimal.Zero
	}

	// Calculate days elapsed
	daysElapsed := time.Since(position.StartTime).Hours() / 24
	if daysElapsed < 1 {
		return decimal.Zero
	}

	// Calculate reward: amount * APY * (days/365)
	dailyAPY := product.APY.Div(decimal.NewFromFloat(365))
	reward := position.Amount.Mul(dailyAPY).Mul(decimal.NewFromFloat(daysElapsed))

	return reward
}

// DistributeRewards distributes rewards to all stakers
func (se *StakingEngine) DistributeRewards(ctx context.Context) error {
	se.mu.RLock()
	defer se.mu.RUnlock()

	var products []*StakeProduct
	for _, product := range se.products {
		if product.IsActive {
			products = append(products, product)
		}
	}

	// Would calculate and distribute rewards to each staker
	// This is typically done via a scheduled job

	return nil
}

// CalculateAPY calculates effective APY for user
func (se *StakingEngine) CalculateAPY(userID, productID string) (decimal.Decimal, error) {
	se.mu.RLock()
	defer se.mu.RUnlock()

	product, ok := se.products[productID]
	if !ok {
		return decimal.Zero, fmt.Errorf("product not found")
	}

	// Return product APY (would be adjusted for user's tier in production)
	return product.APY, nil
}

// GetUserPositions returns all positions for a user
func (se *StakingEngine) GetUserPositions(userID string) []*StakePosition {
	se.mu.RLock()
	defer se.mu.RUnlock()

	var result []*StakePosition
	for _, position := range se.positions {
		if position.UserID == userID {
			result = append(result, position)
		}
	}
	return result
}

// GetStakingProducts returns active products
func (se *StakingEngine) GetStakingProducts(chain *string) []*StakeProduct {
	se.mu.RLock()
	defer se.mu.RUnlock()

	var result []*StakeProduct
	for _, product := range se.products {
		if !product.IsActive {
			continue
		}
		if chain != nil && product.Chain != *chain {
			continue
		}
		result = append(result, product)
	}
	return result
}

// GetClaimHistory returns claim history for a user
func (se *StakingEngine) GetClaimHistory(userID string) []*ClaimRecord {
	se.mu.RLock()
	defer se.mu.RUnlock()
	return se.rewards[userID]
}

// GetEstimatedReward returns estimated reward for position
func (se *StakingEngine) GetEstimatedReward(positionID string) (decimal.Decimal, error) {
	se.mu.RLock()
	position, ok := se.positions[positionID]
	se.mu.RUnlock()

	if !ok {
		return decimal.Zero, fmt.Errorf("position not found")
	}

	return se.calculatePendingReward(position), nil
}

// Helper functions
func generateProductID() string {
	return fmt.Sprintf("STK%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generatePositionID() string {
	return fmt.Sprintf("POS%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateClaimID() string {
	return fmt.Sprintf("CLM%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

// Savings is a savings product type

var _ = decimal.Decimal{}