package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/big"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// TIGGEREX v3.0 - STAKING & EARN SERVICES
// Complete staking, savings, yield farming, and earn products
// =============================================================================

// =============================================================================
// STAKING SERVICE
// =============================================================================

type StakingService struct {
	db interface{}
	
	// Products
	products map[string]*StakingProduct
	
	// User stakes
	stakes map[string]*StakingPosition
	
	// Config
	config StakingConfig
	
	// Rewards
	rewardDistributor *RewardDistributor
	
	// Callbacks
	onStake func(*StakingPosition)
	onUnstake func(*StakingPosition)
	onRewardClaim func(*RewardClaim)
	onRewardAccrual func(string, *big.Float)
	
	mu sync.RWMutex
	ctx context.Context
}

type StakingConfig struct {
	// Rewards
	AutoCompoundEnabled bool
	AutoCompoundInterval time.Duration
	RewardCalculationInterval time.Duration
	
	// Limits
	MaxStakesPerUser int
	MinStakeAmount float64
	MaxStakeAmount float64
	TotalStakeLimit float64
	
	// Unbonding
	UnbondingPeriod time.Duration
	EarlyUnstakingPenalty float64
}

type StakingProduct struct {
	ProductID string
	Name string
	Description string
	
	Currency string
	Blockchain string
	
	// Staking parameters
	MinStake float64
	MaxStake float64
	MaxTotalStake float64
	CurrentTotalStake float64
	
	// Lock period
	MinLockPeriod time.Duration
	MaxLockPeriod time.Duration
	EarlyUnstakingAllowed bool
	EarlyUnstakingPenalty float64
	
	// Rewards
	APR float64 // Annual Percentage Rate
	APY float64 // Annual Percentage Yield (compounded)
	
	// Interest calculation
	InterestCalculation InterestCalculationType
	InterestPayout InterestPayoutType
	
	// Status
	IsActive bool
	IsFeature bool // Feature = auto-staking enabled
	CanRestake bool
	
	// Limits
	UserStakeLimit float64
	RemainingCapacity float64
	
	// Schedule
	StartsAt time.Time
	EndsAt *time.Time
	
	CreatedAt time.Time
	UpdatedAt time.Time
}

type InterestCalculationType string

const (
	InterestSimple InterestCalculationType = "simple" // Daily: principal * rate / 365
	InterestCompound InterestCalculationType = "compound" // Compound interest
	InterestLocked InterestCalculationType = "locked" // Fixed reward for locked period
)

type InterestPayoutType string

const (
	PayoutDaily InterestPayoutType = "daily"
	PayoutWeekly InterestPayoutType = "weekly"
	PayoutMonthly InterestPayoutType = "monthly"
	PayoutMaturity InterestPayoutType = "maturity" // At end of stake period
	PayoutContinuous InterestPayoutType = "continuous" // Real-time accrual
)

type StakingPosition struct {
	PositionID string
	UserID string
	ProductID string
	
	Currency string
	Amount float64
	
	// Period
	StartDate time.Time
	EndDate *time.Time
	LockEndDate *time.Time
	UnbondingEndDate *time.Time
	
	// Status
	Status StakingStatus
	
	// Interest
	InterestRate float64 // APR at time of staking
	AccruedRewards float64
	ClaimedRewards float64
	LastAccrualAt time.Time
	
	// Auto-staking
	IsAutoStake bool
	IsAutoCompound bool
	IsRenewable bool
	
	// Actions
	CanUnstake bool
	CanClaimRewards bool
	CanRestake bool
	
	// History
	StakeTxHash string
	UnstakeTxHash string
	ClaimTxHash string
	
	CreatedAt time.Time
	UpdatedAt time.Time
}

type StakingStatus string

const (
	StakeActive StakingStatus = "active"
	StakeLocked StakingStatus = "locked"
	StakeUnbonding StakingStatus = "unbonding"
	StakeCompleted StakingStatus = "completed"
	StakeWithdrawn StakingStatus = "withdrawn"
	StakeEarlyUnstaked StakingStatus = "early_unstaked"
)

// =============================================================================
// SAVINGS SERVICE
// =============================================================================

type SavingsService struct {
	db interface{}
	
	products map[string]*SavingsProduct
	positions map[string]*SavingsPosition
	
	config SavingsConfig
	
	mu sync.RWMutex
}

type SavingsConfig struct {
	AutoSubscribeEnabled bool
	AutoRenewEnabled bool
	
	MinAmount float64
	MaxAmount float64
}

type SavingsProduct struct {
	ProductID string
	Name string
	Description string
	
	Currency string
	
	Type SavingsType
	
	// Amount limits
	MinAmount float64
	MaxAmount float64
	MaxTotalAmount float64
	CurrentTotalAmount float64
	
	// Term
	HasTerm bool
	TermDays int
	EarlyWithdrawalAllowed bool
	EarlyWithdrawalPenalty float64
	
	// Interest
	APR float64
	InterestCalculation InterestCalculationType
	InterestPayout InterestPayoutType
	
	// Features
	IsAutoSubscribe bool
	IsRenewable bool
	
	// Status
	IsActive bool
	IsFeatured bool
	
	StartsAt time.Time
	EndsAt *time.Time
	
	CreatedAt time.Time
}

type SavingsType string

const (
	SavingsFlexible SavingsType = "flexible"
	SavingsFixed SavingsType = "fixed"
	SavingsLocked SavingsType = "locked"
)

type SavingsPosition struct {
	PositionID string
	UserID string
	ProductID string
	
	Currency string
	Amount float64
	
	StartDate time.Time
	MaturityDate *time.Time
	
	InterestRate float64
	AccruedInterest float64
	ClaimedInterest float64
	ExpectedInterest float64
	
	Status SavingsPositionStatus
	
	IsAutoRenew bool
	
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt *time.Time
}

type SavingsPositionStatus string

const (
	SavingsActive SavingsPositionStatus = "active"
	SavingsMatured SavingsPositionStatus = "matured"
	SavingsWithdrawn SavingsPositionStatus = "withdrawn"
	SavingsAutoRenewed SavingsPositionStatus = "auto_renewed"
)

// =============================================================================
// YIELD FARMING SERVICE
// =============================================================================

type YieldFarmingService struct {
	db interface{}
	
	pools map[string]*YieldPool
	positions map[string]*YieldPosition
	
	config YieldConfig
	
	mu sync.RWMutex
}

type YieldConfig struct {
	AutoCompoundEnabled bool
	AutoCompoundPoolIDs []string
}

type YieldPool struct {
	PoolID string
	Name string
	Description string
	
	// Pool assets
	Assets []PoolAsset
	PoolType PoolType
	
	// Farming parameters
	RewardCurrency string
	RewardPerBlock float64
	RewardPerDay float64
	TotalRewardAmount float64
	RemainingReward float64
	
	// Allocation
	TotalShares float64
	SharesPerAsset float64 // Virtual price of shares
	
	// Limits
	MinDeposit float64
	MaxDeposit float64
	CurrentTVL float64
	
	// Harvest
	HarvestInterval time.Duration
	LastHarvestAt time.Time
	AccumulatedRewardPerShare float64
	
	// Status
	IsActive bool
	IsFeatured bool
	IsDeflated bool
	
	StartsAt time.Time
	EndsAt *time.Time
	
	CreatedAt time.Time
}

type PoolAsset struct {
	Currency string
	Weight float64
	Amount float64
}

type PoolType string

const (
	PoolSingle PoolType = "single" // Single asset staking
	PoolPair PoolType = "pair" // Dual asset LP
	PoolMulti PoolType = "multi" // Multi-asset pool
)

type YieldPosition struct {
	PositionID string
	UserID string
	PoolID string
	
	DepositedAssets []DepositedAsset
	Shares float64
	
	// Accrued rewards
	AccumulatedRewards float64
	ClaimedRewards float64
	PendingRewards float64
	
	// Debt tracking (for leveraged pools)
	DebtAssets []DebtAsset
	
	LastActionAt time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

type DepositedAsset struct {
	Currency string
	Amount float64
}

type DebtAsset struct {
	Currency string
	Amount float64
}

// =============================================================================
// LAUNCHPOOL SERVICE
// =============================================================================

type LaunchpoolService struct {
	db interface{}
	
	pools map[string]*Launchpool
	
	mu sync.RWMutex
}

type Launchpool struct {
	PoolID string
	Name string
	Description string
	
	// Token info
	ProjectToken string
	ProjectTokenAddress string
	TokenPrice float64 // In quote currency
	
	// Pool info
	QuoteCurrency string
	TotalRaised float64
	MinAllocation float64
	MaxAllocation float64
	
	// Stake asset
	StakeCurrency string
	StakeAssetAddress string
	RewardsPerStake float64 // Project tokens per staked asset
	
	// Limits
	TotalStake float64
	MaxStake float64
	MaxTotalStake float64
	
	// Subscription
	SubscriptionEnabled bool
	SubscriptionStartsAt time.Time
	SubscriptionEndsAt time.Time
	
	// Farming
	FarmingStartsAt time.Time
	FarmingEndsAt *time.Time
	
	// Status
	Status LaunchpoolStatus
	
	IsActive bool
	IsFeatured bool
	
	CreatedAt time.Time
}

type LaunchpoolStatus string

const (
	LPSubscription LaunchpoolStatus = "subscription" // Subscription period
	LPPooling LaunchpoolStatus = "pooling" // Token pooling period
	LPFarming LaunchpoolStatus = "farming" // Yield farming period
	LPCompleted LaunchpoolStatus = "completed"
	LPCancelled LaunchpoolStatus = "cancelled"
)

// =============================================================================
// LOAN/LENDING SERVICE
// =============================================================================

type LendingService struct {
	db interface{}
	
	pools map[string]*LendingPool
	loans map[string]*Loan
	
	config LendingConfig
	
	mu sync.RWMutex
}

type LendingConfig struct {
	AutoLendingEnabled bool
	AutoBorrowEnabled bool
}

type LendingPool struct {
	PoolID string
	Currency string
	
	// Supply
	TotalDeposited float64
	DepositorCount int
	
	// Borrow
	TotalBorrowed float64
	BorrowerCount int
	BorrowRate float64 // Current borrow APR
	
	// Interest
	SupplyAPR float64 // Interest rate for depositors
	BorrowAPR float64 // Interest rate for borrowers
	UtilizationRate float64
	
	// Parameters
	MinDeposit float64
	MaxDeposit float64
	MinBorrow float64
	MaxBorrow float64
	MaxCollateralFactor float64
	
	// Health
	LiquidationThreshold float64
	LiquidationPenalty float64
	
	IsActive bool
	
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Loan struct {
	LoanID string
	UserID string
	Currency string
	
	// Principal
	Principal float64
	CurrentAmount float64 // Principal + interest
	
	// Collateral
	CollateralCurrency string
	CollateralAmount float64
	CollateralValue float64
	
	// Interest
	BorrowRate float64
	AccumulatedInterest float64
	LastInterestAccrualAt time.Time
	
	// Health
	CollateralFactor float64
	HealthFactor float64
	LiquidationPrice float64
	
	// Status
	Status LoanStatus
	
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt *time.Time
}

type LoanStatus string

const (
	LoanActive LoanStatus = "active"
	LoanHealthy LoanStatus = "healthy"
	LoanWarning LoanStatus = "warning" // Health factor low
	LoanDanger LoanStatus = "danger" // Near liquidation
	LoanLiquidated LoanStatus = "liquidated"
	LoanClosed LoanStatus = "closed"
	LoanRepaid LoanStatus = "repaid"
)

// =============================================================================
// REWARD DISTRIBUTOR
// =============================================================================

type RewardDistributor struct {
	treasury map[string]float64
	totalDistributed map[string]float64
	distributions []RewardDistribution
	
	mu sync.RWMutex
}

type RewardDistribution struct {
	DistributionID string
	UserID string
	Currency string
	Amount float64
	Type string
	Source string
	
	Timestamp time.Time
}

// =============================================================================
// NEW SERVICES
// =============================================================================

func NewStakingService(db interface{}, config StakingConfig) *StakingService {
	s := &StakingService{
		db: db,
		products: make(map[string]*StakingProduct),
		stakes: make(map[string]*StakingPosition),
		config: config,
		rewardDistributor: &RewardDistributor{
			treasury: make(map[string]float64),
			totalDistributed: make(map[string]float64),
			distributions: make([]RewardDistribution, 0),
		},
	}
	
	// Initialize default products
	s.initializeDefaultProducts()
	
	return s
}

func (s *StakingService) initializeDefaultProducts() {
	products := []*StakingProduct{
		{
			ProductID: "ETH2-STAKING",
			Name: "ETH 2.0 Staking",
			Description: "Stake ETH and earn rewards with Ethereum 2.0",
			Currency: "ETH",
			Blockchain: "ethereum",
			MinStake: 0.001,
			MaxStake: 10000,
			APR: 4.5,
			APY: 4.6,
			InterestCalculation: InterestCompound,
			InterestPayout: PayoutContinuous,
			IsActive: true,
			IsFeature: true,
			CanRestake: true,
		},
		{
			ProductID: "BNB-VAULT",
			Name: "BNB Vault",
			Description: "Earn daily rewards by staking BNB",
			Currency: "BNB",
			Blockchain: "bsc",
			MinStake: 0.01,
			MaxStake: 100000,
			APR: 8.0,
			APY: 8.3,
			InterestCalculation: InterestCompound,
			InterestPayout: PayoutDaily,
			IsActive: true,
			IsFeature: true,
		},
		{
			ProductID: "SOL-STAKING",
			Name: "Solana Staking",
			Description: "Stake SOL and earn高达12% annual rewards",
			Currency: "SOL",
			Blockchain: "solana",
			MinStake: 0.1,
			MaxStake: 100000,
			APR: 12.0,
			APY: 12.7,
			InterestCalculation: InterestCompound,
			InterestPayout: PayoutContinuous,
			IsActive: true,
			IsFeature: true,
		},
		{
			ProductID: "LOCKED-BTC-30D",
			Name: "BTC Flexible Savings (30 Days)",
			Description: "30-day locked BTC savings with guaranteed rewards",
			Currency: "BTC",
			Blockchain: "bitcoin",
			MinStake: 0.001,
			MaxStake: 100,
			MinLockPeriod: 30 * 24 * time.Hour,
			MaxLockPeriod: 30 * 24 * time.Hour,
			EarlyUnstakingAllowed: false,
			APR: 3.0,
			InterestCalculation: InterestLocked,
			InterestPayout: PayoutMaturity,
			IsActive: true,
		},
	}
	
	for _, p := range products {
		s.products[p.ProductID] = p
	}
}

// Stake creates a new staking position
func (s *StakingService) Stake(ctx context.Context, req *StakeRequest) (*StakingPosition, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate product
	product, exists := s.products[req.ProductID]
	if !exists {
		return nil, fmt.Errorf("staking product not found: %s", req.ProductID)
	}
	
	if !product.IsActive {
		return nil, fmt.Errorf("staking product is not active")
	}
	
	// Check limits
	if req.Amount < product.MinStake {
		return nil, fmt.Errorf("amount below minimum stake: %.4f", product.MinStake)
	}
	
	if product.MaxStake > 0 && req.Amount > product.MaxStake {
		return nil, fmt.Errorf("amount exceeds maximum stake: %.4f", product.MaxStake)
	}
	
	if product.CurrentTotalStake+req.Amount > product.MaxTotalStake {
		return nil, fmt.Errorf("insufficient capacity in staking pool")
	}
	
	// Create position
	position := &StakingPosition{
		PositionID: generateStakeID(),
		UserID: req.UserID,
		ProductID: req.ProductID,
		Currency: product.Currency,
		Amount: req.Amount,
		StartDate: time.Now(),
		Status: StakeActive,
		InterestRate: product.APR,
		AccruedRewards: 0,
		ClaimedRewards: 0,
		LastAccrualAt: time.Now(),
		IsAutoStake: req.AutoStake,
		IsAutoCompound: req.AutoCompound,
		IsRenewable: product.CanRestake,
		CanUnstake: !product.EarlyUnstakingAllowed,
		CanClaimRewards: true,
		CanRestake: product.CanRestake,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	// Set end date if locked
	if product.MinLockPeriod > 0 {
		endDate := time.Now().Add(product.MinLockPeriod)
		position.EndDate = &endDate
		position.LockEndDate = &endDate
		position.Status = StakeLocked
		position.CanUnstake = false
	}
	
	// Store position
	s.stakes[position.PositionID] = position
	product.CurrentTotalStake += req.Amount
	
	if s.onStake != nil {
		s.onStake(position)
	}
	
	log.Printf("[STAKING] New stake: user=%s, product=%s, amount=%.4f %s", 
		req.UserID, req.ProductID, req.Amount, product.Currency)
	
	return position, nil
}

// Unstake initiates an unstake request
func (s *StakingService) Unstake(ctx context.Context, positionID, userID string) (*UnstakeResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	position, exists := s.stakes[positionID]
	if !exists {
		return nil, fmt.Errorf("staking position not found")
	}
	
	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}
	
	if position.Status != StakeActive && position.Status != StakeLocked {
		return nil, fmt.Errorf("position is not unstakable")
	}
	
	product := s.products[position.ProductID]
	
	// Check if can unstake
	if !position.CanUnstake && !product.EarlyUnstakingAllowed {
		return nil, fmt.Errorf("position is locked until %s", position.LockEndDate.Format(time.RFC3339))
	}
	
	result := &UnstakeResult{
		PositionID: positionID,
		Principal: position.Amount,
		PendingRewards: position.AccruedRewards,
		Currency: position.Currency,
	}
	
	// Calculate early unstake penalty
	if product.EarlyUnstakingAllowed && position.LockEndDate != nil && time.Now().Before(*position.LockEndDate) {
		penalty := position.Amount * product.EarlyUnstakingPenalty
		result.Penalty = penalty
		result.NetAmount = position.Amount - penalty + position.AccruedRewards
		result.RequiresWait = true
		result.AvailableAt = position.LockEndDate
	} else {
		// Immediate unstake
		position.Status = StakeCompleted
		result.NetAmount = position.Amount + position.AccruedRewards
		result.IsComplete = true
	}
	
	// If unbonding period
	if s.config.UnbondingPeriod > 0 {
		position.Status = StakeUnbonding
		unbondingEnd := time.Now().Add(s.config.UnbondingPeriod)
		position.UnbondingEndDate = &unbondingEnd
		result.RequiresWait = true
		result.AvailableAt = &unbondingEnd
	}
	
	position.UpdatedAt = time.Now()
	
	if s.onUnstake != nil {
		s.onUnstake(position)
	}
	
	return result, nil
}

type StakeRequest struct {
	UserID string
	ProductID string
	Amount float64
	AutoStake bool
	AutoCompound bool
}

type UnstakeResult struct {
	PositionID string
	Principal float64
	PendingRewards float64
	Penalty float64
	NetAmount float64
	Currency string
	IsComplete bool
	RequiresWait bool
	AvailableAt *time.Time
}

// ClaimRewards claims accrued staking rewards
func (s *StakingService) ClaimRewards(ctx context.Context, positionID, userID string) (*RewardClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	position, exists := s.stakes[positionID]
	if !exists {
		return nil, fmt.Errorf("staking position not found")
	}
	
	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}
	
	if !position.CanClaimRewards {
		return nil, fmt.Errorf("rewards cannot be claimed yet")
	}
	
	// Calculate current rewards
	s.calculateRewards(position)
	
	if position.AccruedRewards <= 0 {
		return nil, fmt.Errorf("no rewards to claim")
	}
	
	claim := &RewardClaim{
		ClaimID: generateClaimID(),
		UserID: userID,
		PositionID: positionID,
		Currency: position.Currency,
		Amount: position.AccruedRewards,
		Timestamp: time.Now(),
	}
	
	// Update position
	if position.IsAutoCompound {
		position.Amount += position.AccruedRewards
		position.AccruedRewards = 0
	} else {
		position.ClaimedRewards += position.AccruedRewards
		position.AccruedRewards = 0
	}
	
	position.LastAccrualAt = time.Now()
	position.UpdatedAt = time.Now()
	
	// Record distribution
	s.rewardDistributor.totalDistributed[position.Currency] += claim.Amount
	
	if s.onRewardClaim != nil {
		s.onRewardClaim(claim)
	}
	
	return claim, nil
}

type RewardClaim struct {
	ClaimID string
	UserID string
	PositionID string
	Currency string
	Amount float64
	Timestamp time.Time
}

// Calculate and accrue rewards
func (s *StakingService) calculateRewards(position *StakingPosition) {
	product := s.products[position.ProductID]
	if product == nil {
		return
	}
	
	now := time.Now()
	elapsed := now.Sub(position.LastAccrualAt)
	days := elapsed.Hours() / 24
	
	// Calculate daily rate
	dailyRate := product.APR / 365
	
	// Apply compounding if enabled
	if position.IsAutoCompound {
		// Compound interest: A = P * (1 + r/n)^(n*t)
		compoundsPerYear := 365 // Daily compounding
		amount := position.Amount * math.Pow(1+dailyRate/compoundsPerYear, compoundsPerYear*days)
		position.AccruedRewards += amount - position.Amount
	} else {
		// Simple interest
		reward := position.Amount * dailyRate * days
		position.AccruedRewards += reward
	}
	
	position.LastAccrualAt = now
}

// ProcessRewards calculates and distributes rewards for all positions
func (s *StakingService) ProcessRewards() {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	now := time.Now()
	
	for _, position := range s.stakes {
		if position.Status != StakeActive {
			continue
		}
		
		// Check if enough time has passed
		if now.Sub(position.LastAccrualAt) < 24*time.Hour {
			continue
		}
		
		s.calculateRewards(position)
		position.UpdatedAt = now
		
		if s.onRewardAccrual != nil {
			s.onRewardAccrual(position.PositionID, big.NewFloat(position.AccruedRewards))
		}
	}
}

// GetUserStakes returns all stakes for a user
func (s *StakingService) GetUserStakes(userID string) []*StakingPosition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var stakes []*StakingPosition
	for _, pos := range s.stakes {
		if pos.UserID == userID {
			stakes = append(stakes, pos)
		}
	}
	
	return stakes
}

// GetProducts returns all available staking products
func (s *StakingService) GetProducts() []*StakingProduct {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var products []*StakingProduct
	for _, p := range s.products {
		if p.IsActive {
			products = append(products, p)
		}
	}
	
	return products
}

// Helper functions
func generateStakeID() string {
	return fmt.Sprintf("STK_%s", uuid.New().String()[:12])
}

func generateClaimID() string {
	return fmt.Sprintf("CLM_%s", uuid.New().String()[:12])
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Println("TigerEx Staking & Earn Services v3.0 starting...")
	
	stakingConfig := StakingConfig{
		AutoCompoundEnabled: true,
		AutoCompoundInterval: 24 * time.Hour,
		RewardCalculationInterval: 1 * time.Hour,
		MaxStakesPerUser: 20,
		MinStakeAmount: 0.001,
		UnbondingPeriod: 24 * time.Hour,
		EarlyUnstakingPenalty: 0.001,
	}
	
	stakingService := NewStakingService(nil, stakingConfig)
	
	// Display products
	products := stakingService.GetProducts()
	log.Printf("[STAKING] Available products: %d", len(products))
	for _, p := range products {
		log.Printf("  - %s: %.2f%% APR, min=%.4f %s", p.Name, p.APR, p.MinStake, p.Currency)
	}
}