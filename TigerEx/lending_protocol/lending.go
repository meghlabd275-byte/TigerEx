// =============================================================================
// LENDING PROTOCOL
// Complete lending/borrowing protocol for crypto assets
// Supports collateralized lending with flexible and fixed terms
// =============================================================================

package lending

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	LendingTypeFlexible = "flexible" // Variable rate, withdraw anytime
	LendingTypeFixed   = "fixed"    // Fixed term, fixed rate
	
	LoanStatusActive   = "active"
	LoanStatusLiquidated = "liquidated"
	LoanStatusRepaid   = "repaid"
	LoanStatusPending = "pending"
	
	StatusActive   = "active"
	StatusPaused = "paused"
	StatusClosed = "closed"
)

// ============================================================================
// TYPES
// ============================================================================

// Config for lending protocol
type Config struct {
	PlatformFee       float64   // Platform takes X% of interest
	MinDeposit      float64
	MaxDeposit     float64
	MinLoan         float64
	MaxLoan        float64
	MaxCollateralRatio float64 // Maximum LTV (e.g., 80%)
	MinCollateralRatio float64 // Minimum to avoid liquidation (e.g., 115%)
	LiquidationBonus float64   // Bonus for liquidators
	OracleAddress   string    // Price oracle
}

// Market represents a lending market for a token
type Market struct {
	Token            string
	LendingType     string // "flexible" or "fixed"
	SupplyRate     float64 // Annual percentage yield
	BorrowRate    float64 // Annual interest rate
	TotalDeposited float64
	TotalBorrowed  float64
	UtilizationRate float64 // TotalBorrowed / TotalDeposited
	AssetPrice    float64
	LastUpdateTime time.Time
	
	mu sync.RWMutex
}

// SupplyPosition represents a supplier's deposit
type SupplyPosition struct {
	UserID      string
	Token      string
	LendingType string
	Deposited  float64
	AccruedInterest float64
	LastAccruedTime time.Time
	
	mu sync.RWMutex
}

// BorrowPosition represents a loan
type BorrowPosition struct {
	ID            string
	UserID        string
	Token         string
	LendingType  string
	CollateralToken string
	CollateralAmount float64
	BorrowedAmount float64
	InterestRate float64
	AccruedInterest float64
	HealthFactor float64
	Status      string
	OpenedAt    time.Time
	LastAccrued time.Time
	
	mu sync.RWMutex
}

// CollateralRatio tracks collateral for a borrow position
type CollateralRatio struct {
	CollateralValue float64 // Value of collateral in USD
	BorrowedValue  float64 // Value of borrowed asset in USD
	Ratio          float64 // Collateral / Borrowed
}

// LendingProtocol is the main lending service
type LendingProtocol struct {
	mu               sync.RWMutex
	config           Config
	markets          map[string]*Market // token -> market
	supplyPositions  map[string]map[string]*SupplyPosition // userID -> token -> position
	borrowPositions  map[string]*BorrowPosition // loanID -> position
	collateralPrices map[string]float64 // token -> price in USD
	
	oracle       PriceOracle
	eventEmitter EventEmitter
	status       string
	startTime   time.Time
}

// PriceOracle interface for getting prices
type PriceOracle interface {
	GetPrice(token string) (float64, error)
	GetPrices(tokens []string) (map[string]float64, error)
}

// EventEmitter for notifications
type EventEmitter interface {
	Emit(event string, data interface{})
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func NewLendingProtocol(cfg Config) *LendingProtocol {
	if cfg.PlatformFee <= 0 {
		cfg.PlatformFee = 10 // 10% of interest
	}
	if cfg.MaxCollateralRatio <= 0 {
		cfg.MaxCollateralRatio = 80 // 80% LTV
	}
	if cfg.MinCollateralRatio <= 0 {
		cfg.MinCollateralRatio = 115 // 115% - liquidation threshold
	}
	if cfg.LiquidationBonus <= 0 {
		cfg.LiquidationBonus = 5 // 5% bonus for liquidators
	}

	lp := &LendingProtocol{
		config:          cfg,
		markets:         make(map[string]*Market),
		supplyPositions: make(map[string]map[string]*SupplyPosition),
		borrowPositions: make(map[string]*BorrowPosition),
		collateralPrices: make(map[string]float64),
		status:          "active",
		startTime:       time.Now(),
	}

	return lp
}

// ============================================================================
// MARKET MANAGEMENT
// ============================================================================

// CreateMarket creates a new lending market
func (lp *LendingProtocol) CreateMarket(ctx context.Context, token, lendingType string) (*Market, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	marketKey := token + "_" + lendingType
	
	if _, exists := lp.markets[marketKey]; exists {
		return nil, fmt.Errorf("market already exists: %s", marketKey)
	}

	market := &Market{
		Token:         token,
		LendingType:   lendingType,
		SupplyRate:    0,
		BorrowRate:   0,
		TotalDeposited: 0,
		TotalBorrowed:  0,
		UtilizationRate: 0,
		LastUpdateTime: time.Now(),
	}

	lp.markets[marketKey] = market

	return market, nil
}

// UpdateRates updates supply and borrow rates based on utilization
func (lp *LendingProtocol) UpdateRates(ctx context.Context, marketKey string) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	market, ok := lp.markets[marketKey]
	if !ok {
		return fmt.Errorf("market not found")
	}

	utilization := 0.0
	if market.TotalDeposited > 0 {
		utilization = market.TotalBorrowed / market.TotalDeposited
	}

	// Base rates
	baseSupplyRate := 0.02  // 2% base
	baseBorrowRate := 0.05  // 5% base

	// Slope adjustments based on utilization
	// Supply rate increases with utilization
	market.SupplyRate = baseSupplyRate + (utilization * 0.10) // Max ~12%
	
	// Borrow rate increases more aggressively
	market.BorrowRate = baseBorrowRate + (utilization * 0.15) // Max ~20%

	market.UtilizationRate = utilization
	market.LastUpdateTime = time.Now()

	return nil
}

// GetMarket gets market info
func (lp *LendingProtocol) GetMarket(ctx context.Context, token, lendingType string) (*Market, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()

	marketKey := token + "_" + lendingType
	market, ok := lp.markets[marketKey]
	if !ok {
		return nil, fmt.Errorf("market not found")
	}

	return market, nil
}

// ============================================================================
// SUPPLY (LEND)
// ============================================================================

// Supply deposits assets to lending market
func (lp *LendingProtocol) Supply(ctx context.Context, userID, token, lendingType string, amount float64) (*SupplyPosition, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	if amount < lp.config.MinDeposit {
		return nil, fmt.Errorf("minimum deposit: %.2f", lp.config.MinDeposit)
	}

	marketKey := token + "_" + lendingType
	market, ok := lp.markets[marketKey]
	if !ok {
		return nil, fmt.Errorf("market not found: %s", marketKey)
	}

	// Get or create supply position
	if lp.supplyPositions[userID] == nil {
		lp.supplyPositions[userID] = make(map[string]*SupplyPosition)
	}

	positionKey := marketKey
	position, exists := lp.supplyPositions[userID][positionKey]
	if !exists {
		position = &SupplyPosition{
			UserID:        userID,
			Token:         token,
			LendingType:  lendingType,
			Deposited:    0,
			LastAccruedTime: time.Now(),
		}
		lp.supplyPositions[userID][positionKey] = position
	}

	// Add deposit
	position.Deposited += amount
	market.TotalDeposited += amount

	// Update rates
	lp.updateMarketRatesLocked(marketKey)

	return position, nil
}

// Withdraw withdraws assets from lending market
func (lp *LendingProtocol) Withdraw(ctx context.Context, userID, token, lendingType string, amount float64) (float64, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	marketKey := token + "_" + lendingType
	positionKey := marketKey

	position, exists := lp.supplyPositions[userID][positionKey]
	if !exists || position.Deposited <= 0 {
		return 0, fmt.Errorf("no supply position found")
	}

	// Calculate available (with accrued interest)
	available := lp.calculateAccruedInterestLocked(position) + position.Deposited

	if amount > available {
		amount = available
	}

	// Withdraw
	position.Deposited -= amount
	market := lp.markets[marketKey]
	market.TotalDeposited -= amount

	// Update rates
	lp.updateMarketRatesLocked(marketKey)

	return amount, nil
}

// ============================================================================
// BORROW
// ============================================================================

// Borrow creates a loan against collateral
func (lp *LendingProtocol) Borrow(ctx context.Context, userID, borrowToken, collateralToken, lendingType string, borrowAmount float64, collateralAmount float64) (*BorrowPosition, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	if borrowAmount < lp.config.MinLoan {
		return nil, fmt.Errorf("minimum loan: %.2f", lp.config.MinLoan)
	}

	// Get collateral value
	collateralPrice, ok := lp.collateralPrices[collateralToken]
	if !ok || collateralPrice <= 0 {
		return nil, fmt.Errorf("unknown collateral price for: %s", collateralToken)
	}

	borrowPrice, ok := lp.collateralPrices[borrowToken]
	if !ok || borrowPrice <= 0 {
		return nil, fmt.Errorf("unknown borrow price for: %s", borrowToken)
	}

	collateralValue := collateralAmount * collateralPrice
	borrowValue := borrowAmount * borrowPrice

	// Check LTV (Loan to Value)
	ltv := (borrowValue / collateralValue) * 100
	if ltv > lp.config.MaxCollateralRatio {
		return nil, fmt.Errorf("collateral ratio too low: %.2f%% required max %.2f%%", ltv, lp.config.MaxCollateralRatio)
	}

	// Get market for borrow token
	marketKey := borrowToken + "_" + lendingType
	market, ok := lp.markets[marketKey]
	if !ok {
		return nil, fmt.Errorf("market not found: %s", marketKey)
	}

	// Check available liquidity
	availableLiquidity := market.TotalDeposited - market.TotalBorrowed
	if borrowAmount > availableLiquidity {
		return nil, fmt.Errorf("insufficient liquidity: available %.2f", availableLiquidity)
	}

	// Get borrow rate
	borrowRate := market.BorrowRate

	// Create borrow position
	position := &BorrowPosition{
		ID:                generateLoanID(),
		UserID:            userID,
		Token:             borrowToken,
		LendingType:       lendingType,
		CollateralToken:   collateralToken,
		CollateralAmount:  collateralAmount,
		BorrowedAmount:   borrowAmount,
		InterestRate:     borrowRate,
		AccruedInterest:  0,
		Status:            LoanStatusActive,
		OpenedAt:          time.Now(),
		LastAccrued:       time.Now(),
	}

	// Calculate initial health factor
	position.HealthFactor = lp.calculateHealthFactorLocked(position, collateralPrice, borrowPrice)

	// Store position
	lp.borrowPositions[position.ID] = position

	// Update market
	market.TotalBorrowed += borrowAmount
	lp.updateMarketRatesLocked(marketKey)

	return position, nil
}

// Repay repays a loan
func (lp *LendingProtocol) Repay(ctx context.Context, userID, loanID string, amount float64) (float64, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	position, ok := lp.borrowPositions[loanID]
	if !ok {
		return 0, fmt.Errorf("loan not found")
	}

	if position.UserID != userID {
		return 0, fmt.Errorf("unauthorized")
	}

	// Calculate total owed
	totalOwed := position.BorrowedAmount + lp.calculateAccruedInterestLocked(position)

	if amount > totalOwed {
		amount = totalOwed
	}

	// Repay
	position.BorrowedAmount -= amount
	if position.BorrowedAmount <= 0 {
		position.Status = LoanStatusRepaid
	}

	// Update market
	marketKey := position.Token + "_" + position.LendingType
	market := lp.markets[marketKey]
	market.TotalBorrowed -= amount

	lp.updateMarketRatesLocked(marketKey)

	return amount, nil
}

// AddCollateral adds more collateral to a loan
func (lp *LendingProtocol) AddCollateral(ctx context.Context, userID, loanID string, collateralAmount float64) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	position, ok := lp.borrowPositions[loanID]
	if !ok {
		return fmt.Errorf("loan not found")
	}

	if position.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	// Update collateral
	position.CollateralAmount += collateralAmount

	// Recalculate health factor
	collateralPrice, _ := lp.collateralPrices[position.CollateralToken]
	borrowPrice, _ := lp.collateralPrices[position.Token]
	position.HealthFactor = lp.calculateHealthFactorLocked(position, collateralPrice, borrowPrice)

	return nil
}

// Liquidate liquidates an unhealthy position
func (lp *LendingProtocol) Liquidate(ctx context.Context, liquidatorID, loanID string) (float64, float64, error) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	position, ok := lp.borrowPositions[loanID]
	if !ok {
		return 0, 0, fmt.Errorf("loan not found")
	}

	// Check if liquidatable
	if position.HealthFactor > lp.config.MinCollateralRatio {
		return 0, 0, fmt.Errorf("position not liquidatable: health factor %.2f", position.HealthFactor)
	}

	// Calculate liquidation amount (up to 50% of collateral)
	liquidationPercent := 0.50
	collateralPrice, _ := lp.collateralPrices[position.CollateralToken]
	borrowPrice, _ := lp.collateralPrices[position.Token]

	collateralValue := position.CollateralAmount * collateralPrice
	liquidateValue := collateralValue * liquidationPercent
	liquidateAmount := liquidateValue / borrowPrice

	// Apply bonus for liquidator
	bonus := lp.config.LiquidationBonus / 100
	liquidatorReward := liquidateAmount * (1 + bonus)

	// Update position
	position.CollateralAmount -= liquidateAmount
	position.BorrowedAmount -= liquidateAmount

	// Recalculate health
	position.HealthFactor = lp.calculateHealthFactorLocked(position, collateralPrice, borrowPrice)

	if position.HealthFactor > lp.config.MinCollateralRatio {
		position.Status = LoanStatusActive
	}

	return liquidateAmount, liquidatorReward, nil
}

// ============================================================================
// INTEREST ACCRUAL
// ============================================================================

// AccrueInterest accrues interest for all positions
func (lp *LendingProtocol) AccrueInterest(ctx context.Context) error {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	now := time.Now()

	// Accrue supply interest
	for userID, positions := range lp.supplyPositions {
		for _, position := range positions {
			marketKey := position.Token + "_" + position.LendingType
			market, ok := lp.markets[marketKey]
			if !ok {
				continue
			}

			elapsed := now.Sub(position.LastAccruedTime).Seconds() / (365 * 24 * 3600) // Years
			interest := position.Deposited * market.SupplyRate * elapsed
			
			position.AccruedInterest += interest
			position.LastAccruedTime = now

			// Update market (platform fee)
			platformFee := interest * (lp.config.PlatformFee / 100)
			netInterest := interest - platformFee
			market.TotalDeposited += netInterest
		}
	}

	// Accrue borrow interest
	for _, position := range lp.borrowPositions {
		if position.Status != LoanStatusActive {
			continue
		}

		elapsed := now.Sub(position.LastAccrued).Seconds() / (365 * 24 * 3600)
		interest := position.BorrowedAmount * position.InterestRate * elapsed

		position.AccruedInterest += interest
		position.BorrowedAmount += interest
		position.LastAccrued = now
	}

	return nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func (lp *LendingProtocol) calculateAccruedInterestLocked(position *SupplyPosition) float64 {
	elapsed := time.Now().Sub(position.LastAccruedTime).Seconds() / (365 * 24 * 3600)
	
	marketKey := position.Token + "_" + position.LendingType
	market := lp.markets[marketKey]
	if market == nil {
		return 0
	}

	return position.Deposited * market.SupplyRate * elapsed
}

func (lp *LendingProtocol) calculateHealthFactorLocked(position *BorrowPosition, collateralPrice, borrowPrice float64) float64 {
	collateralValue := position.CollateralAmount * collateralPrice
	borrowValue := position.BorrowedAmount * borrowPrice

	if borrowValue <= 0 {
		return math.MaxFloat64
	}

	return (collateralValue / borrowValue) * 100
}

func (lp *LendingProtocol) updateMarketRatesLocked(marketKey string) {
	market, ok := lp.markets[marketKey]
	if !ok {
		return
	}

	utilization := 0.0
	if market.TotalDeposited > 0 {
		utilization = market.TotalBorrowed / market.TotalDeposited
	}

	baseSupply := 0.02
	baseBorrow := 0.05

	market.SupplyRate = baseSupply + (utilization * 0.10)
	market.BorrowRate = baseBorrow + (utilization * 0.15)
	market.UtilizationRate = utilization
	market.LastUpdateTime = time.Now()
}

func (lp *LendingProtocol) GetSupplyPosition(ctx context.Context, userID, token, lendingType string) (*SupplyPosition, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()

	marketKey := token + "_" + lendingType
	positionKey := marketKey

	if position, ok := lp.supplyPositions[userID][positionKey]; ok {
		return position, nil
	}

	return nil, fmt.Errorf("position not found")
}

func (lp *LendingProtocol) GetBorrowPosition(ctx context.Context, loanID string) (*BorrowPosition, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()

	if position, ok := lp.borrowPositions[loanID]; ok {
		return position, nil
	}

	return nil, fmt.Errorf("loan not found")
}

func (lp *LendingProtocol) GetBorrowPositions(ctx context.Context, userID string) ([]*BorrowPosition, error) {
	lp.mu.RLock()
	defer lp.mu.RUnlock()

	positions := make([]*BorrowPosition, 0)
	for _, position := range lp.borrowPositions {
		if position.UserID == userID && position.Status == LoanStatusActive {
			positions = append(positions, position)
		}
	}

	return positions, nil
}

// SetCollateralPrice sets the price of collateral token
func (lp *LendingProtocol) SetCollateralPrice(ctx context.Context, token string, price float64) {
	lp.mu.Lock()
	defer lp.mu.Unlock()

	lp.collateralPrices[token] = price
}

func generateLoanID() string {
	return fmt.Sprintf("LOAN%x", time.Now().UnixNano())
}

var _ = fmt.Sprintf
var _ = math.MaxFloat64

func init() {}

var (
	_ context.Context
	_ time.Now
)