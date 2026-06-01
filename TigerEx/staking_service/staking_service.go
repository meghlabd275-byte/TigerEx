package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// ============================================================================
// TIGEREX STAKING SERVICE
// Production-ready staking for PoS chains, liquid ETH staking, and more
// ============================================================================

// Staking Types
const (
	StakeTypePOS        = "pos"
	StakeTypeLiquid     = "liquid"
	StakeTypeLocked     = "locked"
	StakeTypeFlexible   = "flexible"
	StakeTypeDual       = "dual"
	StakeTypeValidator  = "validator"
)

// Staking Status
const (
	StakeActive    = "active"
	StakeUnbonding = "unbonding"
	StakeCompleted = "completed"
	StakeCancelled = "cancelled"
)

// ============================================================================
// STAKING TYPES
// ============================================================================

type StakingProduct struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Description         string  `json:"description"`
	Currency            string  `json:"currency"` // Staked asset
	RewardCurrency      string  `json:"rewardCurrency"` // Asset earned
	Type                string  `json:"type"` // pos, liquid, locked, flexible
	MinAmount           float64 `json:"minAmount"`
	MaxAmount           float64 `json:"maxAmount"`
	APY                 float64 `json:"apy"` // Annual Percentage Yield
	Duration            int64   `json:"duration"` // Duration in seconds
	LockPeriod          int64   `json:"lockPeriod"` // Lock period in seconds
	UnbondingPeriod     int64   `json:"unbondingPeriod"` // Unbonding time
	EarlyUnbondingPenalty float64 `json:"earlyUnbondingPenalty"` // Penalty %
	MaxStakers          int     `json:"maxStakers"`
	CurrentStakers      int     `json:"currentStakers"`
	TotalStaked         float64 `json:"totalStaked"`
	RewardsPool         float64 `json:"rewardsPool"`
	Status              string  `json:"status"` // active, paused, closed
	AutoCompound        bool    `json:"autoCompound"`
	CompoundFrequency   int     `json:"compoundFrequency"` // Hours
	CanDelegate         bool    `json:"canDelegate"`
	ValidatorAddress    string  `json:"validatorAddress,omitempty"`
	Network             string  `json:"network"` // ethereum, solana, etc.
	RewardDistribution  string  `json:"rewardDistribution"` // hourly, daily, weekly
	CreatedAt           int64   `json:"createdAt"`
	UpdatedAt           int64   `json:"updatedAt"`
}

type StakingPosition struct {
	ID              string  `json:"id"`
	UserID          string  `json:"userId"`
	ProductID       string  `json:"productId"`
	Currency        string  `json:"currency"`
	Amount          float64 `json:"amount"`
	InitialAmount   float64 `json:"initialAmount"`
	RewardCurrency  string  `json:"rewardCurrency"`
	PendingReward   float64 `json:"pendingReward"`
	TotalReward     float64 `json:"totalReward"`
	APY             float64 `json:"apy"`
	Type            string  `json:"type"`
	Status          string  `json:"status"`
	StartTime       int64   `json:"startTime"`
	EndTime         int64   `json:"endTime,omitempty"` // For locked stakes
	UnlockTime      int64   `json:"unlockTime,omitempty"`
	UnbondingStart  int64   `json:"unbondingStart,omitempty"`
	AutoCompound    bool    `json:"autoCompound"`
	CompoundCount   int     `json:"compoundCount"`
	LastClaimTime   int64   `json:"lastClaimTime"`
	LastCompoundTime int64   `json:"lastCompoundTime"`
	Network          string  `json:"network"`
	DelegatedTo     string  `json:"delegatedTo,omitempty"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`
}

type UnbondingPosition struct {
	ID           string  `json:"id"`
	UserID       string  `json:"userId"`
	ProductID    string  `json:"productId"`
	Currency     string  `json:"currency"`
	Amount       float64 `json:"amount"`
	StartTime    int64   `json:"startTime"`
	CompleteTime int64   `json:"completeTime"`
	Status       string  `json:"status"` // pending, ready, claimed
}

type Validator struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Network       string  `json:"network"`
	Address       string  `json:"address"`
	APY           float64 `json:"apy"`
	Commission    float64 `json:"commission"` // Validator commission %
	TotalStake    float64 `json:"totalStake"`
	OwnStake      float64 `json:"ownStake"`
	DelegatedStake float64 `json:"delegatedStake"`
	Status        string  `json:"status"` // active, inactive, jailed
	Uptime        float64 `json:"uptime"` // Uptime percentage
	SlashCount    int     `json:"slashCount"`
	LastRewardBlock int64  `json:"lastRewardBlock"`
	CreatedAt     int64   `json:"createdAt"`
}

// ============================================================================
// STAKING SERVICE
// ============================================================================

type StakingService struct {
	// Products
	products map[string]*StakingProduct // ProductID -> Product

	// User positions
	positions map[string]*StakingPosition // PositionID -> Position
	userPositions map[string][]*StakingPosition // UserID -> Positions

	// Unbonding positions
	unbonding map[string]*UnbondingPosition // PositionID -> Unbonding

	// Validators
	validators map[string]*Validator // ValidatorID -> Validator

	// Reward tracking
	rewardBalances map[string]map[string]float64 // UserID -> Currency -> Balance

	// Staking stats
	totalStaked float64
	totalRewards float64
	activeStakers int

	// Configuration
	rewardDistributionInterval int64 // Hours
	autoCompoundInterval int64 // Hours

	mu sync.RWMutex
}

func NewStakingService() *StakingService {
	return &StakingService{
		products:    make(map[string]*StakingProduct),
		positions:   make(map[string]*StakingPosition),
		userPositions: make(map[string][]*StakingPosition),
		unbonding:   make(map[string]*UnbondingPosition),
		validators:  make(map[string]*Validator),
		rewardBalances: make(map[string]map[string]float64),
		rewardDistributionInterval: 24, // Daily distribution
		autoCompoundInterval: 24, // Daily compounding
	}
}

// ============================================================================
// PRODUCT MANAGEMENT
// ============================================================================

func (ss *StakingService) CreateProduct(product *StakingProduct) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if product.ID == "" {
		product.ID = fmt.Sprintf("stake_%d_%s", time.Now().UnixMilli(), product.Currency)
	}

	product.CreatedAt = time.Now().UnixMilli()
	product.UpdatedAt = product.CreatedAt
	product.CurrentStakers = 0
	product.TotalStaked = 0
	product.Status = "active"

	ss.products[product.ID] = product

	return nil
}

func (ss *StakingService) GetProduct(productID string) (*StakingProduct, error) {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	product, exists := ss.products[productID]
	if !exists {
		return nil, fmt.Errorf("product not found: %s", productID)
	}

	return product, nil
}

func (ss *StakingService) GetAllProducts() []*StakingProduct {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	products := make([]*StakingProduct, 0, len(ss.products))
	for _, p := range ss.products {
		if p.Status == "active" {
			products = append(products, p)
		}
	}

	return products
}

func (ss *StakingService) GetProductsByCurrency(currency string) []*StakingProduct {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	var products []*StakingProduct
	for _, p := range ss.products {
		if p.Currency == currency && p.Status == "active" {
			products = append(products, p)
		}
	}

	return products
}

func (ss *StakingService) UpdateProduct(productID string, updates map[string]interface{}) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	product, exists := ss.products[productID]
	if !exists {
		return fmt.Errorf("product not found")
	}

	// Apply updates
	if apy, ok := updates["apy"].(float64); ok {
		product.APY = apy
	}
	if status, ok := updates["status"].(string); ok {
		product.Status = status
	}
	if rewardPool, ok := updates["rewardsPool"].(float64); ok {
		product.RewardsPool = rewardPool
	}

	product.UpdatedAt = time.Now().UnixMilli()

	return nil
}

// ============================================================================
// STAKING OPERATIONS
// ============================================================================

func (ss *StakingService) Stake(userID, productID string, amount float64, autoCompound bool) (*StakingPosition, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	// Get product
	product, exists := ss.products[productID]
	if !exists {
		return nil, fmt.Errorf("product not found")
	}

	if product.Status != "active" {
		return nil, fmt.Errorf("product not available for staking")
	}

	// Validate amount
	if amount < product.MinAmount {
		return nil, fmt.Errorf("amount below minimum: %.8f", product.MinAmount)
	}

	if product.MaxAmount > 0 && amount > product.MaxAmount {
		return nil, fmt.Errorf("amount above maximum: %.8f", product.MaxAmount)
	}

	// Check max stakers
	if product.MaxStakers > 0 && product.CurrentStakers >= product.MaxStakers {
		return nil, fmt.Errorf("max stakers reached")
	}

	// Check available rewards pool for reward-bearing products
	if product.RewardsPool > 0 {
		maxStake := product.RewardsPool * 10 // Conservative estimate
		if product.TotalStaked+amount > maxStake {
			return nil, fmt.Errorf("rewards pool exhausted")
		}
	}

	// Create position
	positionID := fmt.Sprintf("pos_%d_%s_%s", time.Now().UnixMilli(), userID[:8], product.Currency)
	now := time.Now().UnixMilli()

	position := &StakingPosition{
		ID:             positionID,
		UserID:         userID,
		ProductID:      productID,
		Currency:       product.Currency,
		Amount:         amount,
		InitialAmount:  amount,
		RewardCurrency: product.RewardCurrency,
		PendingReward:  0,
		TotalReward:    0,
		APY:            product.APY,
		Type:           product.Type,
		Status:         StakeActive,
		StartTime:      now,
		AutoCompound:   autoCompound,
		CompoundCount:   0,
		LastClaimTime:  now,
		LastCompoundTime: now,
		Network:        product.Network,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	// Set end time for locked stakes
	if product.Type == StakeTypeLocked || product.Type == StakeTypeDual {
		position.EndTime = now + product.Duration*1000
		position.UnlockTime = position.EndTime + product.UnbondingPeriod*1000
	}

	// Update product
	product.TotalStaked += amount
	product.CurrentStakers++

	// Store position
	ss.positions[positionID] = position
	ss.userPositions[userID] = append(ss.userPositions[userID], position)

	// Update stats
	ss.totalStaked += amount
	ss.activeStakers++

	return position, nil
}

func (ss *StakingService) Unstake(positionID, userID string) (*UnbondingPosition, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	position, exists := ss.positions[positionID]
	if !exists {
		return nil, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	if position.Status != StakeActive {
		return nil, fmt.Errorf("position not active")
	}

	product, exists := ss.products[position.ProductID]
	if !exists {
		return nil, fmt.Errorf("product not found")
	}

	now := time.Now().UnixMilli()

	// Check lock period
	if product.Type == StakeTypeLocked || product.Type == StakeTypeDual {
		if now < position.EndTime {
			// Apply early unbonding penalty
			penalty := position.Amount * product.EarlyUnbondingPenalty / 100
			position.Amount -= penalty
		}
	}

	// Create unbonding position
	unbondingID := fmt.Sprintf("unbond_%d_%s", time.Now().UnixMilli(), userID[:8])
	unbonding := &UnbondingPosition{
		ID:           unbondingID,
		UserID:       userID,
		ProductID:    position.ProductID,
		Currency:     position.Currency,
		Amount:       position.Amount,
		StartTime:    now,
		CompleteTime: now + product.UnbondingPeriod*1000,
		Status:       "pending",
	}

	// Update position
	position.Status = StakeUnbonding
	position.UnbondingStart = now
	position.UpdatedAt = now

	// Update product
	product.TotalStaked -= position.Amount
	product.CurrentStakers--

	// Store unbonding
	ss.unbonding[unbondingID] = unbonding

	// Update stats
	ss.activeStakers--

	return unbonding, nil
}

func (ss *StakingService) ClaimUnbonded(unbondingID, userID string) (float64, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	unbonding, exists := ss.unbonding[unbondingID]
	if !exists {
		return 0, fmt.Errorf("unbonding position not found")
	}

	if unbonding.UserID != userID {
		return 0, fmt.Errorf("unauthorized")
	}

	if unbonding.Status != "ready" {
		return 0, fmt.Errorf("unbonding not ready")
	}

	// Mark as claimed
	unbonding.Status = "claimed"

	return unbonding.Amount, nil
}

// ============================================================================
// REWARD MANAGEMENT
// ============================================================================

func (ss *StakingService) CalculateReward(position *StakingPosition) float64 {
	if position.Status != StakeActive {
		return 0
	}

	// Calculate time-based reward
	now := time.Now().UnixMilli()
	hoursStaked := float64(now-position.StartTime) / (1000 * 60 * 60)
	
	// APY to hourly rate
	hourlyRate := position.APY / (100 * 24 * 365)
	
	// Calculate reward
	reward := position.Amount * hourlyRate * hoursStaked

	return reward
}

func (ss *StakingService) ClaimReward(positionID, userID string) (float64, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	position, exists := ss.positions[positionID]
	if !exists {
		return 0, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return 0, fmt.Errorf("unauthorized")
	}

	if position.Status != StakeActive {
		return 0, fmt.Errorf("position not active")
	}

	// Calculate and claim reward
	reward := ss.CalculateReward(position)
	if reward <= 0 {
		return 0, fmt.Errorf("no reward available")
	}

	// Update position
	position.PendingReward = 0
	position.TotalReward += reward
	position.LastClaimTime = time.Now().UnixMilli()

	// Add to user's reward balance
	if ss.rewardBalances[userID] == nil {
		ss.rewardBalances[userID] = make(map[string]float64)
	}
	ss.rewardBalances[userID][position.RewardCurrency] += reward

	// Update stats
	ss.totalRewards += reward

	return reward, nil
}

func (ss *StakingService) GetPendingRewards(userID string) (map[string]float64, error) {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	var totalRewards float64
	rewardsByCurrency := make(map[string]float64)

	positions := ss.userPositions[userID]
	for _, pos := range positions {
		if pos.Status == StakeActive {
			reward := ss.CalculateReward(pos)
			totalRewards += reward
			rewardsByCurrency[pos.RewardCurrency] += reward
		}
	}

	return rewardsByCurrency, nil
}

func (ss *StakingService) GetRewardBalance(userID, currency string) (float64, error) {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	balances, exists := ss.rewardBalances[userID]
	if !exists {
		return 0, nil
	}

	return balances[currency], nil
}

func (ss *StakingService) WithdrawReward(userID, currency string, amount float64) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	balances, exists := ss.rewardBalances[userID]
	if !exists {
		return fmt.Errorf("no balance")
	}

	if balances[currency] < amount {
		return fmt.Errorf("insufficient balance")
	}

	balances[currency] -= amount

	return nil
}

// ============================================================================
// AUTO COMPOUNDING
// ============================================================================

func (ss *StakingService) ProcessAutoCompound() {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	now := time.Now().UnixMilli()
	hourMs := int64(60 * 60 * 1000)

	for _, position := range ss.positions {
		if !position.AutoCompound || position.Status != StakeActive {
			continue
		}

		// Check if it's time to compound
		if now-position.LastCompoundTime < ss.autoCompoundInterval*hourMs {
			continue
		}

		// Calculate reward
		reward := ss.CalculateReward(position)
		if reward <= 0 {
			continue
		}

		// Compound: add reward to principal
		position.Amount += reward
		position.TotalReward += reward
		position.PendingReward = 0
		position.CompoundCount++
		position.LastCompoundTime = now
		position.UpdatedAt = now

		// Update product total staked
		if product, exists := ss.products[position.ProductID]; exists {
			product.TotalStaked += reward
		}

		// Update stats
		ss.totalRewards += reward
	}
}

func (ss *StakingService) SetAutoCompound(positionID string, enabled bool) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	position, exists := ss.positions[positionID]
	if !exists {
		return fmt.Errorf("position not found")
	}

	position.AutoCompound = enabled
	position.UpdatedAt = time.Now().UnixMilli()

	return nil
}

// ============================================================================
// POSITION QUERIES
// ============================================================================

func (ss *StakingService) GetPosition(positionID string) (*StakingPosition, error) {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	position, exists := ss.positions[positionID]
	if !exists {
		return nil, fmt.Errorf("position not found")
	}

	return position, nil
}

func (ss *StakingService) GetUserPositions(userID string) []*StakingPosition {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	return ss.userPositions[userID]
}

func (ss *StakingService) GetUserStakingSummary(userID string) *StakingSummary {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	summary := &StakingSummary{
		UserID:          userID,
		TotalStaked:     0,
		TotalRewards:    0,
		PendingRewards:  0,
		ActivePositions: 0,
		Products:        make(map[string]*ProductSummary),
	}

	for _, pos := range ss.userPositions[userID] {
		summary.TotalStaked += pos.Amount
		summary.TotalRewards += pos.TotalReward
		summary.PendingRewards += ss.CalculateReward(pos)
		
		if pos.Status == StakeActive {
			summary.ActivePositions++
		}

		if _, exists := summary.Products[pos.Currency]; !exists {
			summary.Products[pos.Currency] = &ProductSummary{
				Currency:    pos.Currency,
				TotalStaked: 0,
				PositionCount: 0,
			}
		}
		summary.Products[pos.Currency].TotalStaked += pos.Amount
		summary.Products[pos.Currency].PositionCount++
	}

	return summary
}

type StakingSummary struct {
	UserID          string `json:"userId"`
	TotalStaked     float64 `json:"totalStaked"`
	TotalRewards    float64 `json:"totalRewards"`
	PendingRewards  float64 `json:"pendingRewards"`
	ActivePositions int     `json:"activePositions"`
	Products        map[string]*ProductSummary `json:"products"`
}

type ProductSummary struct {
	Currency       string  `json:"currency"`
	TotalStaked    float64 `json:"totalStaked"`
	PositionCount  int     `json:"positionCount"`
}

// ============================================================================
// VALIDATOR MANAGEMENT
// ============================================================================

func (ss *StakingService) AddValidator(validator *Validator) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	if validator.ID == "" {
		validator.ID = fmt.Sprintf("val_%d_%s", time.Now().UnixMilli(), validator.Network)
	}
	validator.CreatedAt = time.Now().UnixMilli()

	ss.validators[validator.ID] = validator
	return nil
}

func (ss *StakingService) GetValidators(network string) []*Validator {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	var validators []*Validator
	for _, v := range ss.validators {
		if v.Network == network {
			validators = append(validators, v)
		}
	}

	return validators
}

func (ss *StakingService) DelegateToValidator(positionID, validatorID string) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	position, exists := ss.positions[positionID]
	if !exists {
		return fmt.Errorf("position not found")
	}

	validator, exists := ss.validators[validatorID]
	if !exists {
		return fmt.Errorf("validator not found")
	}

	position.DelegatedTo = validatorID
	position.UpdatedAt = time.Now().UnixMilli()

	// Update validator delegated stake
	validator.DelegatedStake += position.Amount

	return nil
}

// ============================================================================
// REWARD DISTRIBUTION
// ============================================================================

func (ss *StakingService) DistributeRewards() {
	ss.mu.Lock()
	defer ss.mu.Unlock()

	// This would be called by a scheduler
	// Distributes pending rewards to user balances

	for userID, positions := range ss.userPositions {
		if ss.rewardBalances[userID] == nil {
			ss.rewardBalances[userID] = make(map[string]float64)
		}

		for _, pos := range positions {
			if pos.Status != StakeActive {
				continue
			}

			reward := ss.CalculateReward(pos)
			if reward > 0 {
				ss.rewardBalances[userID][pos.RewardCurrency] += reward
				pos.TotalReward += reward
				pos.LastClaimTime = time.Now().UnixMilli()
				ss.totalRewards += reward
			}
		}
	}
}

// ============================================================================
// STATS
// ============================================================================

func (ss *StakingService) GetStats() *StakingStats {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	return &StakingStats{
		TotalStaked:     ss.totalStaked,
		TotalRewards:    ss.totalRewards,
		ActiveStakers:   ss.activeStakers,
		TotalProducts:   len(ss.products),
		TotalPositions: len(ss.positions),
	}
}

type StakingStats struct {
	TotalStaked     float64 `json:"totalStaked"`
	TotalRewards    float64 `json:"totalRewards"`
	ActiveStakers   int     `json:"activeStakers"`
	TotalProducts   int     `json:"totalProducts"`
	TotalPositions  int     `json:"totalPositions"`
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Staking Service v1.0")
	fmt.Println("PoS Staking, Liquid ETH, Locked Staking")
	fmt.Println()

	ss := NewStakingService()

	// Create staking products
	products := []*StakingProduct{
		{
			ID: "eth-liquid-stake",
			Name: "ETH Liquid Staking",
			Description: "Stake ETH and receive stETH",
			Currency: "ETH",
			RewardCurrency: "stETH",
			Type: StakeTypeLiquid,
			MinAmount: 0.01,
			MaxAmount: 10000,
			APY: 4.5,
			LockPeriod: 0, // No lock
			UnbondingPeriod: 0,
			Network: "ethereum",
			Status: "active",
		},
		{
			ID: "eth-locked-stake",
			Name: "ETH Locked Staking (30 days)",
			Description: "Stake ETH for 30 days with higher APY",
			Currency: "ETH",
			RewardCurrency: "ETH",
			Type: StakeTypeLocked,
			MinAmount: 0.1,
			MaxAmount: 1000,
			APY: 5.5,
			Duration: 30 * 24 * 60 * 60, // 30 days
			LockPeriod: 30 * 24 * 60 * 60,
			UnbondingPeriod: 2 * 24 * 60 * 60, // 2 days
			EarlyUnbondingPenalty: 10, // 10%
			Network: "ethereum",
			Status: "active",
		},
		{
			ID: "sol-stake",
			Name: "Solana Staking",
			Description: "Stake SOL and earn rewards",
			Currency: "SOL",
			RewardCurrency: "SOL",
			Type: StakeTypePOS,
			MinAmount: 1,
			MaxAmount: 100000,
			APY: 6.0,
			UnbondingPeriod: 5 * 24 * 60 * 60, // 5 days
			Network: "solana",
			Status: "active",
		},
		{
			ID: "dot-stake",
			Name: "Polkadot Staking",
			Description: "Stake DOT and earn rewards",
			Currency: "DOT",
			RewardCurrency: "DOT",
			Type: StakeTypePOS,
			MinAmount: 10,
			MaxAmount: 100000,
			APY: 12.0,
			UnbondingPeriod: 28 * 24 * 60 * 60, // 28 days
			Network: "polkadot",
			Status: "active",
		},
	}

	for _, p := range products {
		if err := ss.CreateProduct(p); err != nil {
			fmt.Printf("Failed to create product %s: %v\n", p.Name, err)
		} else {
			fmt.Printf("Created staking product: %s (APY: %.2f%%)\n", p.Name, p.APY)
		}
	}

	// Test staking
	fmt.Println()
	userID := "user123"
	
	// Stake ETH
	position, err := ss.Stake(userID, "eth-liquid-stake", 10.0, true)
	if err != nil {
		fmt.Printf("ETH staking failed: %v\n", err)
	} else {
		fmt.Printf("Staked 10 ETH (Position: %s, APY: %.2f%%)\n", position.ID, position.APY)
	}

	// Get summary
	summary := ss.GetUserStakingSummary(userID)
	fmt.Printf("\nStaking Summary:\n")
	fmt.Printf("  Total Staked: %.4f\n", summary.TotalStaked)
	fmt.Printf("  Total Rewards: %.8f\n", summary.TotalRewards)
	fmt.Printf("  Active Positions: %d\n", summary.ActivePositions)

	// Get stats
	stats := ss.GetStats()
	fmt.Printf("\nPlatform Stats:\n")
	fmt.Printf("  Total Staked: %.2f\n", stats.TotalStaked)
	fmt.Printf("  Total Rewards: %.4f\n", stats.TotalRewards)
	fmt.Printf("  Active Stakers: %d\n", stats.ActiveStakers)

	fmt.Println()
	fmt.Println("Staking Service initialized and ready!")
}

var _ = math.Abs