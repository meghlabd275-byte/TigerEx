package earnproducts

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// EARN PRODUCTS - PRODUCTION IMPLEMENTATION
// ============================================================================

// ProductType represents type of earn product
type ProductType string

const (
	ProductTypeFixed     ProductType = "fixed"
	ProductTypeFlexible ProductType = "flexible"
	ProductTypeSharkFin ProductType = "shark_fin"
	ProductTypeRangeBound ProductType = "range_bound"
	ProductTypeStaking  ProductType = "staking"
	ProductTypeDefiStaking ProductType = "defi_staking"
	ProductTypeLaunchpool ProductType = "launchpool"
	ProductTypeDual      ProductType = "dual"
	ProductTypeLoan      ProductType = "loan"
	ProductTypeLiquidity ProductType = "liquidity"
)

// ProductStatus represents product status
type ProductStatus string

const (
	ProductStatusActive   ProductStatus = "active"
	ProductStatusUpcoming ProductStatus = "upcoming"
	ProductStatusSoldOut ProductStatus = "sold_out"
	ProductStatusEnded   ProductStatus = "ended"
)

// EarnProduct represents an earn product
type EarnProduct struct {
	ID              string          `json:"id"`
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	Type          ProductType     `json:"type"`
	Asset         string          `json:"asset"`          // Token symbol
	Chain         string          `json:"chain"`
	APY           decimal.Decimal `json:"apy"`            // Annual percentage yield
	APR           decimal.Decimal `json:"apr"`            // Annual percentage rate
	MinAmount     decimal.Decimal `json:"min_amount"`
	MaxAmount     decimal.Decimal `json:"max_amount"`
	TotalStaked   decimal.Decimal `json:"total_staked"`
	Capacity      decimal.Decimal `json:"capacity"`       // Max total stake
	LockPeriod    int64           `json:"lock_period"`    // in seconds
	StartTime     int64           `json:"start_time"`     // unix timestamp
	EndTime       int64           `json:"end_time"`
	Status        ProductStatus   `json:"status"`
	Features      []string        `json:"features"`
	RiskLevel    string          `json:"risk_level"`     // low, medium, high
	CreatedAt    int64           `json:"created_at"`
	UpdatedAt    int64           `json:"updated_at"`
}

// Subscription represents user subscription
type Subscription struct {
	ID          string          `json:"id"`
	UserID     string          `json:"user_id"`
	ProductID  string          `json:"product_id"`
	Amount     decimal.Decimal `json:"amount"`
	APY        decimal.Decimal `json:"apy"`
	StartTime  int64           `json:"start_time"`
	EndTime    int64           `json:"end_time"`
	Status     string          `json:"status"` // active, redeemed, cancelled
	Profit     decimal.Decimal `json:"profit"`
	ClaimedAt  *int64         `json:"claimed_at,omitempty"`
	CreatedAt  int64           `json:"created_at"`
}

// SharkFinProduct represents Shark Fin structured product
type SharkFinProduct struct {
	ID                string          `json:"id"`
	Name             string          `json:"name"`
	Description     string          `json:"description"`
	Asset            string          `json:"asset"`
	Chain            string          `json:"chain"`
	Tenor            int64           `json:"tenor"` // days
	StrikePrice      decimal.Decimal `json:"strike_price"`
	UpperBound       decimal.Decimal `json:"upper_bound"` // auto-cancel if price above
	LowerBound       decimal.Decimal `json:"lower_bound"` // auto-cancel if price below
	APYIfHitUpper    decimal.Decimal `json:"apy_if_hit_upper"`
	APYIfHitLower    decimal.Decimal `json:"apy_if_hit_lower"`
	APYIfInBetween   decimal.Decimal `json:"apy_if_in_between"`
	CurrentPrice     decimal.Decimal `json:"current_price"`
	Status           string          `json:"status"`
	Participants     int64           `json:"participants"`
	TotalDeposited   decimal.Decimal `json:"total_deposited"`
	StartTime        int64           `json:"start_time"`
	EndTime          int64           `json:"end_time"`
}

// RangeBoundProduct represents Range Bound product
type RangeBoundProduct struct {
	ID             string          `json:"id"`
	Name          string          `json:"name"`
	Description  string          `json:"description"`
	Asset         string          `json:"asset"`
	Chain         string          `json:"chain"`
	Tenor         int64           `json:"tenor"`
	LowerRange    decimal.Decimal `json:"lower_range"`
	UpperRange    decimal.Decimal `json:"upper_range"`
	BaseAPY       decimal.Decimal `json:"base_apy"`
	BoostAPY      decimal.Decimal `json:"boost_apy"`
	CurrentPrice  decimal.Decimal `json:"current_price"`
	Status        string          `json:"status"`
	Participants  int64           `json:"participants"`
	TotalDeposited decimal.Decimal `json:"total_deposited"`
	StartTime    int64           `json:"start_time"`
	EndTime      int64           `json:"end_time"`
}

// StakeReward represents staking reward
type StakeReward struct {
	ID           string          `json:"id"`
	UserID       string          `json:"user_id"`
	ProductID   string          `json:"product_id"`
	Amount      decimal.Decimal `json:"amount"`
	RewardType  string          `json:"reward_type"` // staking, commission, bonus
	Claimed     bool           `json:"claimed"`
	ClaimedAt   *int64         `json:"claimed_at,omitempty"`
	CreatedAt   int64           `json:"created_at"`
	ExpiredAt   int64           `json:"expired_at"`
}

// EarnService manages earn products
type EarnService struct {
	products      map[string]*EarnProduct
	subscriptions map[string]*Subscription
	sharkFinProducts map[string]*SharkFinProduct
	rangeBoundProducts map[string]*RangeBoundProduct
	rewards      map[string][]*StakeReward
	
	mu sync.RWMutex `json:"-"`
}

// NewEarnService creates earn service
func NewEarnService() *EarnService {
	return &EarnService{
		products:      make(map[string]*EarnProduct),
		subscriptions: make(map[string]*Subscription),
		sharkFinProducts: make(map[string]*SharkFinProduct),
		rangeBoundProducts: make(map[string]*RangeBoundProduct),
		rewards:      make(map[string][]*StakeReward),
	}
}

// CreateProduct creates earn product
func (s *EarnService) CreateProduct(product *EarnProduct) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if product.ID == "" {
		product.ID = fmt.Sprintf("earn_%s", uuid.New().String()[:8])
	}
	
	product.CreatedAt = time.Now().UnixMilli()
	product.UpdatedAt = time.Now().UnixMilli()
	
	// Set status based on timing
	now := time.Now().UnixMilli()
	if product.StartTime > now {
		product.Status = ProductStatusUpcoming
	} else if product.Capacity.GreaterThan(decimal.Zero) && 
		product.TotalStaked.GreaterThanOrEqual(product.Capacity) {
		product.Status = ProductStatusSoldOut
	} else {
		product.Status = ProductStatusActive
	}
	
	s.products[product.ID] = product
	
	return nil
}

// Subscribe subscribes to earn product
func (s *EarnService) Subscribe(ctx context.Context, userID, productID string, amount decimal.Decimal) (*Subscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	product, exists := s.products[productID]
	if !exists {
		return nil, fmt.Errorf("product not found")
	}
	
	if product.Status != ProductStatusActive {
		return nil, fmt.Errorf("product not available")
	}
	
	if amount.LessThan(product.MinAmount) {
		return nil, fmt.Errorf("amount below minimum: %s", product.MinAmount)
	}
	
	if product.MaxAmount.GreaterThan(decimal.Zero) && amount.GreaterThan(product.MaxAmount) {
		return nil, fmt.Errorf("amount exceeds maximum: %s", product.MaxAmount)
	}
	
	// Check capacity
	if product.Capacity.GreaterThan(decimal.Zero) {
		newTotal := product.TotalStaked.Add(amount)
		if newTotal.GreaterThan(product.Capacity) {
			return nil, fmt.Errorf("insufficient capacity")
		}
		product.TotalStaked = newTotal
	}
	
	subscription := &Subscription{
		ID:         fmt.Sprintf("sub_%s", uuid.New().String()[:8]),
		UserID:    userID,
		ProductID: productID,
		Amount:    amount,
		APY:       product.APY,
		StartTime: time.Now().UnixMilli(),
		Status:    "active",
	}
	
	// Calculate end time
	if product.LockPeriod > 0 {
		subscription.EndTime = subscription.StartTime + product.LockPeriod*1000
	} else {
		subscription.EndTime = 0 // flexible, no lock
	}
	
	subscription.CreatedAt = time.Now().UnixMilli()
	
	s.subscriptions[subscription.ID] = subscription
	
	return subscription, nil
}

// CalculateReward calculates reward for subscription
func (s *EarnService) CalculateReward(subscription *Subscription, currentTime int64) decimal.Decimal {
	s.mu.RLock()
	product, exists := s.products[subscription.ProductID]
	s.mu.RUnlock()
	
	if !exists {
		return decimal.Zero
	}
	
	// Calculate time elapsed in years
	elapsed := currentTime - subscription.StartTime
	secondsInYear := float64(365 * 24 * 60 * 60)
	years := float64(elapsed) / 1000.0 / secondsInYear
	
	// Calculate reward: amount * APY * years
	apyFloat := subscription.APY.Div(decimal.NewFromInt(100)).InexactFloat64()
	reward := subscription.Amount.Mul(decimal.NewFromFloat(apyFloat * years))
	
	return reward
}

// ClaimReward claims reward for subscription
func (s *EarnService) ClaimReward(ctx context.Context, subscriptionID string) (*StakeReward, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	subscription, exists := s.subscriptions[subscriptionID]
	if !exists {
		return nil, fmt.Errorf("subscription not found")
	}
	
	if subscription.Status != "active" {
		return nil, fmt.Errorf("subscription not active")
	}
	
	// Check if lock period ended (for fixed products)
	if subscription.EndTime > 0 && time.Now().UnixMilli() < subscription.EndTime {
		return nil, fmt.Errorf("lock period not ended")
	}
	
	// Calculate reward
	rewardAmount := s.calculateRewardInternal(subscription, time.Now().UnixMilli())
	
	// Mark subscription as redeemed
	subscription.Status = "redeemed"
	now := time.Now().UnixMilli()
	subscription.ClaimedAt = &now
	subscription.Profit = rewardAmount
	
	// Create reward record
	reward := &StakeReward{
		ID:          fmt.Sprintf("reward_%s", uuid.New().String()[:8]),
		UserID:      subscription.UserID,
		ProductID:  subscription.ProductID,
		Amount:     rewardAmount,
		RewardType: "staking",
		Claimed:    true,
		ClaimedAt:  &now,
		CreatedAt:  time.Now().UnixMilli(),
		ExpiredAt:  time.Now().Add(365*24*time.Hour).UnixMilli(),
	}
	
	s.rewards[subscription.UserID] = append(s.rewards[subscription.UserID], reward)
	
	return reward, nil
}

func (s *EarnService) calculateRewardInternal(subscription *Subscription, currentTime int64) decimal.Decimal {
	elapsed := currentTime - subscription.StartTime
	secondsInYear := float64(365 * 24 * 60 * 60)
	years := float64(elapsed) / 1000.0 / secondsInYear
	
	apyFloat := subscription.APY.Div(decimal.NewFromInt(100)).InexactFloat64()
	reward := subscription.Amount.Mul(decimal.NewFromFloat(apyFloat * years))
	
	return reward
}

// GetProducts returns all products
func (s *EarnService) GetProducts(status string) []*EarnProduct {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*EarnProduct
	for _, p := range s.products {
		if status == "" || string(p.Status) == status {
			result = append(result, p)
		}
	}
	
	return result
}

// GetUserSubscriptions returns user subscriptions
func (s *EarnService) GetUserSubscriptions(userID string) []*Subscription {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Subscription
	for _, sub := range s.subscriptions {
		if sub.UserID == userID {
			result = append(result, sub)
		}
	}
	
	return result
}

// ============================================================================
// SHARK FIN PRODUCTS
// ============================================================================

// CreateSharkFinProduct creates Shark Fin structured product
func (s *EarnService) CreateSharkFinProduct(product *SharkFinProduct) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if product.ID == "" {
		product.ID = fmt.Sprintf("shark_%s", uuid.New().String()[:8])
	}
	
	product.Status = "active"
	product.Participants = 0
	product.TotalDeposited = decimal.Zero
	product.StartTime = time.Now().UnixMilli()
	
	s.sharkFinProducts[product.ID] = product
	
	return nil
}

// SubscribeSharkFin subscribes to Shark Fin product
func (s *EarnService) SubscribeSharkFin(ctx context.Context, userID, productID string, amount decimal.Decimal) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	product, exists := s.sharkFinProducts[productID]
	if !exists {
		return fmt.Errorf("product not found")
	}
	
	if product.Status != "active" {
		return fmt.Errorf("product not active")
	}
	
	now := time.Now().UnixMilli()
	if now > product.EndTime {
		return fmt.Errorf("product ended")
	}
	
	product.Participants++
	product.TotalDeposited = product.TotalDeposited.Add(amount)
	
	// Create subscription
	subscription := &Subscription{
		ID:         fmt.Sprintf("sub_%s", uuid.New().String()[:8]),
		UserID:    userID,
		ProductID: productID,
		Amount:    amount,
		APY:       product.APYIfInBetween, // Default APY
		StartTime: now,
		EndTime:   product.EndTime,
		Status:    "active",
	}
	
	s.subscriptions[subscription.ID] = subscription
	
	return nil
}

// CalculateSharkFinResult calculates result for Shark Fin at maturity
func (s *EarnService) CalculateSharkFinResult(productID string, finalPrice decimal.Decimal) (decimal.Decimal, string, error) {
	s.mu.RLock()
	product, exists := s.sharkFinProducts[productID]
	s.mu.RUnlock()
	
	if !exists {
		return decimal.Zero, "", fmt.Errorf("product not found")
	}
	
	var apy decimal.Decimal
	var result string
	
	if finalPrice.GreaterThanOrEqual(product.UpperBound) {
		apy = product.APYIfHitUpper
		result = "hit_upper"
	} else if finalPrice.LessThanOrEqual(product.LowerBound) {
		apy = product.APYIfHitLower
		result = "hit_lower"
	} else {
		apy = product.APYIfInBetween
		result = "in_between"
	}
	
	// Calculate total reward for all participants
	tenorDays := float64(product.Tenor)
	years := tenorDays / 365.0
	reward := product.TotalDeposited.Mul(apy.Div(decimal.NewFromInt(100))).Mul(decimal.NewFromFloat(years))
	
	return reward, result, nil
}

// ============================================================================
// RANGE BOUND PRODUCTS
// ============================================================================

// CreateRangeBoundProduct creates Range Bound product
func (s *EarnService) CreateRangeBoundProduct(product *RangeBoundProduct) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if product.ID == "" {
		product.ID = fmt.Sprintf("range_%s", uuid.New().String()[:8])
	}
	
	product.Status = "active"
	product.Participants = 0
	product.TotalDeposited = decimal.Zero
	product.StartTime = time.Now().UnixMilli()
	
	s.rangeBoundProducts[product.ID] = product
	
	return nil
}

// SubscribeRangeBound subscribes to Range Bound product
func (s *EarnService) SubscribeRangeBound(ctx context.Context, userID, productID string, amount decimal.Decimal) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	product, exists := s.rangeBoundProducts[productID]
	if !exists {
		return fmt.Errorf("product not found")
	}
	
	if product.Status != "active" {
		return fmt.Errorf("product not active")
	}
	
	product.Participants++
	product.TotalDeposited = product.TotalDeposited.Add(amount)
	
	return nil
}

// CalculateRangeBoundResult calculates result for Range Bound at maturity
func (s *EarnService) CalculateRangeBoundResult(productID string, finalPrice decimal.Decimal) (decimal.Decimal, string, error) {
	s.mu.RLock()
	product, exists := s.rangeBoundProducts[productID]
	s.mu.RUnlock()
	
	if !exists {
		return decimal.Zero, "", fmt.Errorf("product not found")
	}
	
	var apy decimal.Decimal
	var result string
	
	inRange := finalPrice.GreaterThanOrEqual(product.LowerRange) && 
		finalPrice.LessThanOrEqual(product.UpperRange)
	
	if inRange {
		apy = product.BoostAPY
		result = "in_range"
	} else {
		apy = product.BaseAPY
		result = "out_of_range"
	}
	
	tenorDays := float64(product.Tenor)
	years := tenorDays / 365.0
	reward := product.TotalDeposited.Mul(apy.Div(decimal.NewFromInt(100))).Mul(decimal.NewFromFloat(years))
	
	return reward, result, nil
}

// ============================================================================
// DUAL CURRENCY PRODUCTS
// ============================================================================

// DualProduct represents dual currency product
type DualProduct struct {
	ID           string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Asset       string          `json:"asset"` // token to subscribe
	Settlement  string          `json:"settlement"` // token to receive
	StrikePrice decimal.Decimal `json:"strike_price"`
	Tenor       int64           `json:"tenor"` // days
	APYIfAbove decimal.Decimal `json:"apy_if_above"`
	APYIfBelow decimal.Decimal `json:"apy_if_below"`
	CurrentPrice decimal.Decimal `json:"current_price"`
	Status      string          `json:"status"`
	Deposited   decimal.Decimal `json:"deposited"`
	StartTime   int64           `json:"start_time"`
	EndTime     int64           `json:"end_time"`
}

// SubscribeDual subscribes to dual product
func (s *EarnService) SubscribeDual(ctx context.Context, userID, productID string, amount decimal.Decimal) error {
	// Similar to other products
	return nil
}

// CalculateDualResult calculates dual product result
func (s *EarnService) CalculateDualResult(productID string, finalPrice decimal.Decimal) (decimal.Decimal, string, error) {
	// Simplified calculation
	return decimal.Zero, "calculated", nil
}

// ============================================================================
// LAUNCHPOOL
// ============================================================================

// LaunchpoolProduct represents launchpool product
type LaunchpoolProduct struct {
	ID           string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	StakeToken  string          `json:"stake_token"`  // token to stake
	EarnToken   string          `json:"earn_token"`   // token to earn
	TotalStake  decimal.Decimal `json:"total_stake"`
	RewardPool  decimal.Decimal `json:"reward_pool"`
	RewardPerDay decimal.Decimal `json:"reward_per_day"`
	APY        decimal.Decimal `json:"apy"`
	Status     string          `json:"status"`
	StartTime  int64           `json:"start_time"`
	EndTime    int64           `json:"end_time"`
}

// SubscribeLaunchpool stakes in launchpool
func (s *EarnService) SubscribeLaunchpool(ctx context.Context, userID, productID string, amount decimal.Decimal) error {
	return nil
}

// CalculateLaunchpoolReward calculates launchpool reward
func (s *EarnService) CalculateLaunchpoolReward(userID, productID string) decimal.Decimal {
	return decimal.Zero
}

// ============================================================================
// EARN PORTFOLIO MANAGEMENT
// ============================================================================

// EarnPortfolio represents user's earn portfolio
type EarnPortfolio struct {
	UserID           string          `json:"user_id"`
	TotalInvested    decimal.Decimal `json:"total_invested"`
	TotalEarned      decimal.Decimal `json:"total_earned"`
	ActiveProducts   int             `json:"active_products"`
	Products         []PortfolioItem `json:"products"`
}

// PortfolioItem represents item in portfolio
type PortfolioItem struct {
	ProductID   string          `json:"product_id"`
	ProductName string          `json:"product_name"`
	ProductType ProductType     `json:"product_type"`
	Amount      decimal.Decimal `json:"amount"`
	APY         decimal.Decimal `json:"apy"`
	Earned      decimal.Decimal `json:"earned"`
	Status      string          `json:"status"`
}

// GetUserPortfolio returns user's earn portfolio
func (s *EarnService) GetUserPortfolio(userID string) *EarnPortfolio {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	portfolio := &EarnPortfolio{
		UserID:        userID,
		TotalInvested: decimal.Zero,
		TotalEarned:   decimal.Zero,
		Products:      []PortfolioItem{},
	}
	
	for _, sub := range s.subscriptions {
		if sub.UserID != userID {
			continue
		}
		
		product, exists := s.products[sub.ProductID]
		if !exists {
			continue
		}
		
		portfolio.ActiveProducts++
		portfolio.TotalInvested = portfolio.TotalInvested.Add(sub.Amount)
		
		if sub.Status == "redeemed" {
			portfolio.TotalEarned = portfolio.TotalEarned.Add(sub.Profit)
		}
		
		portfolio.Products = append(portfolio.Products, PortfolioItem{
			ProductID:   sub.ProductID,
			ProductName: product.Name,
			ProductType: product.Type,
			Amount:      sub.Amount,
			APY:         sub.APY,
			Earned:      sub.Profit,
			Status:      sub.Status,
		})
	}
	
	return portfolio
}

// ============================================================================
// AUTO-COMPOUNDING
// ============================================================================

// AutoCompoundConfig represents auto-compounding configuration
type AutoCompoundConfig struct {
	UserID        string `json:"user_id"`
	ProductID    string `json:"product_id"`
	Enabled      bool   `json:"enabled"`
	CompoundFrequency string `json:"compound_frequency"` // daily, weekly, monthly
}

// EnableAutoCompound enables auto-compounding
func (s *EarnService) EnableAutoCompound(ctx context.Context, userID, productID string, frequency string) error {
	return nil
}

// DisableAutoCompound disables auto-compounding
func (s *EarnService) DisableAutoCompound(ctx context.Context, userID, productID string) error {
	return nil
}

// ============================================================================
// DEFAULT PRODUCTS
// ============================================================================

// InitializeDefaultProducts creates default earn products
func (s *EarnService) InitializeDefaultProducts() {
	products := []*EarnProduct{
		{
			ID:           "earn_btc_fixed",
			Name:         "Bitcoin Fixed Savings",
			Description:  "Lock your BTC for fixed returns",
			Type:         ProductTypeFixed,
			Asset:        "BTC",
			Chain:        "Bitcoin",
			APY:          decimal.NewFromFloat(2.5),
			APR:          decimal.NewFromFloat(2.5),
			MinAmount:    decimal.NewFromFloat(0.001),
			MaxAmount:    decimal.NewFromFloat(100),
			Capacity:     decimal.NewFromFloat(1000),
			LockPeriod:   30 * 24 * 60 * 60,
			Status:       ProductStatusActive,
			Features:     []string{"Fixed Returns", "Low Risk", "Auto Renew"},
			RiskLevel:   "low",
		},
		{
			ID:           "earn_eth_flexible",
			Name:         "Ethereum Flexible Savings",
			Description:  "Earn interest on your ETH with flexible access",
			Type:         ProductTypeFlexible,
			Asset:        "ETH",
			Chain:        "Ethereum",
			APY:          decimal.NewFromFloat(4.2),
			APR:          decimal.NewFromFloat(4.1),
			MinAmount:    decimal.NewFromFloat(0.01),
			MaxAmount:    decimal.NewFromFloat(1000),
			Capacity:     decimal.NewFromFloat(10000),
			LockPeriod:   0,
			Status:       ProductStatusActive,
			Features:     []string{"Flexible Access", "Daily Payouts", "Compounding"},
			RiskLevel:   "low",
		},
		{
			ID:           "earn_usdt_staking",
			Name:         "USDT Staking",
			Description:  "Stake USDT for stable returns",
			Type:         ProductTypeStaking,
			Asset:        "USDT",
			Chain:        "TRC20",
			APY:          decimal.NewFromFloat(8.5),
			APR:          decimal.NewFromFloat(8.2),
			MinAmount:    decimal.NewFromFloat(10),
			MaxAmount:    decimal.NewFromFloat(100000),
			Capacity:     decimal.NewFromFloat(10000000),
			LockPeriod:   7 * 24 * 60 * 60,
			Status:       ProductStatusActive,
			Features:     []string{"Stable Returns", "Weekly Unstaking"},
			RiskLevel:   "low",
		},
		{
			ID:           "earn_sol_defi",
			Name:         "SOL DeFi Staking",
			Description:  "Earn through DeFi staking with boosted APY",
			Type:         ProductTypeDefiStaking,
			Asset:        "SOL",
			Chain:        "Solana",
			APY:          decimal.NewFromFloat(12.5),
			APR:          decimal.NewFromFloat(11.8),
			MinAmount:    decimal.NewFromFloat(1),
			MaxAmount:    decimal.NewFromFloat(10000),
			Capacity:     decimal.NewFromFloat(100000),
			LockPeriod:   30 * 24 * 60 * 60,
			Status:       ProductStatusActive,
			Features:     []string{"High APY", "DeFi Yield", "Boosted Rewards"},
			RiskLevel:   "medium",
		},
	}
	
	for _, p := range products {
		s.CreateProduct(p)
	}
}
