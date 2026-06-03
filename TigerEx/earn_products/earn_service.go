// =============================================================================
// TIGEREX v3.0 - EARN PRODUCTS SERVICE
// Staking, Savings, Launchpad, DeFi Staking
// =============================================================================

package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// EARN TYPES
// =============================================================================

type EarnProductType string
type EarnStatus string

const (
	ProductTypeStaking       EarnProductType = "staking"
	ProductTypeSavings       EarnProductType = "savings"
	ProductTypeLaunchpad     EarnProductType = "launchpad"
	ProductTypeLaunchpool    EarnProductType = "launchpool"
	ProductTypeDeFi          EarnProductType = "defi"
	ProductTypeFDUSD         EarnProductType = "fdusd"

	EarnStatusActive         EarnStatus = "active"
	EarnStatusInactive       EarnStatus = "inactive"
	EarnStatusSoldOut        EarnStatus = "sold_out"
	EarnStatusEnded          EarnStatus = "ended"
)

// Earn Product
type EarnProduct struct {
	ProductID        string            `json:"productId"`
	Name             string            `json:"name"`
	Type             EarnProductType    `json:"type"`
	Currency         string            `json:"currency"`
	Chain            string            `json:"chain,omitempty"`
	Status           EarnStatus         `json:"status"`
	
	// APY/Rate
	MinAPY           float64           `json:"minApy"`
	MaxAPY           float64           `json:"maxApy"`
	CurrentAPY       float64           `json:"currentApy"`
	DistributionDays  int              `json:"distributionDays"` // daily, weekly, etc.
	
	// Duration
	DurationDays      int              `json:"durationDays"`
	MinDurationDays   int              `json:"minDurationDays"`
	MaxDurationDays   int              `json:"maxDurationDays"`
	UnlockDate        int64             `json:"unlockDate,omitempty"`
	
	// Limits
	MinAmount         float64          `json:"minAmount"`
	MaxAmount         float64          `json:"maxAmount"`
	TotalCapacity     float64          `json:"totalCapacity"`
	CurrentSubscribed float64          `json:"currentSubscribed"`
	
	// Subscription
	AllowEarlyUnlock  bool             `json:"allowEarlyUnlock"`
	EarlyUnlockFee    float64          `json:"earlyUnlockFee"` // percentage
	
	// Project info (for launchpad)
	ProjectName       string            `json:"projectName,omitempty"`
	TokenSymbol       string            `json:"tokenSymbol,omitempty"`
	HardCapPerUser    float64           `json:"hardCapPerUser,omitempty"`
	
	// Timestamps
	StartDate         int64             `json:"startDate"`
	EndDate            int64             `json:"endDate,omitempty"`
	CreatedAt         int64             `json:"createdAt"`
}

// Earn Subscription
type EarnSubscription struct {
	SubscriptionID   string            `json:"subscriptionId"`
	UserID           string            `json:"userId"`
	ProductID        string            `json:"productId"`
	ProductName      string            `json:"productName"`
	
	// Amount
	Amount           float64           `json:"amount"`
	Currency         string            `json:"currency"`
	
	// Terms at subscription
	APY              float64            `json:"apy"`
	DurationDays     int               `json:"durationDays"`
	
	// Progress
	StartDate        int64             `json:"startDate"`
	EndDate          int64             `json:"endDate"`
	UnlockDate       int64             `json:"unlockDate"`
	
	// Earnings
	PendingEarnings   float64           `json:"pendingEarnings"`
	ClaimedEarnings   float64           `json:"claimedEarnings"`
	LastClaimedAt     int64             `json:"lastClaimedAt,omitempty"`
	
	// Status
	Status           string             `json:"status"` // active, completed, cancelled
	EarlyUnlocked     bool              `json:"earlyUnlocked"`
	
	CreatedAt        int64             `json:"createdAt"`
	UpdatedAt        int64             `json:"updatedAt"`
}

// Launchpad Allocation
type LaunchpadAllocation struct {
	AllocationID     string             `json:"allocationId"`
	UserID           string             `json:"userId"`
	ProductID        string             `json:"productId"`
	
	// Subscription
	BiddedAmount     float64            `json:"bidAmount"` // amount in BNB or USDT
	AllocationAmount float64            `json:"allocationAmount"` // amount of new token
	TokenPrice       float64            `json:"tokenPrice"`
	
	// Status
	Status           string             `json:"status"` // pending, allocated, claimed, refunded
	ClaimedAt        int64              `json:"claimedAt,omitempty"`
	
	CreatedAt        int64              `json:"createdAt"`
}

// =============================================================================
// EARN SERVICE
// =============================================================================

type EarnService struct {
	mu sync.RWMutex

	// Products
	products map[string]*EarnProduct // productId -> Product

	// Subscriptions
	subscriptions map[string]*EarnSubscription // subId -> Subscription
	userSubs      map[string][]*EarnSubscription // userId -> Subscriptions

	// Launchpad allocations
	launchpadAllocs map[string]*LaunchpadAllocation // allocId -> Allocation

	// Earnings tracking
	userEarnings map[string][]*EarningRecord // userId -> Earnings

	// Configuration
	config EarnConfig

	// Distribution settings
	distributionInterval int64 // seconds

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type EarnConfig struct {
	StakingEnabled     bool
	SavingsEnabled     bool
	LaunchpadEnabled   bool
	MinStakingAmount   float64
	MaxStakingAmount   float64
	CompoundEnabled    bool
	AutoStakeEnabled   bool
	DistributionInterval int64 // in seconds
}

type EarningRecord struct {
	SubscriptionID string    `json:"subscriptionId"`
	Amount         float64   `json:"amount"`
	Currency       string    `json:"currency"`
	Type           string    `json:"type"` // interest, reward, etc.
	Timestamp      int64     `json:"timestamp"`
}

// =============================================================================
// EARN SERVICE METHODS
// =============================================================================

func NewEarnService() *EarnService {
	ctx, cancel := context.WithCancel(context.Background())

	service := &EarnService{
		products:         make(map[string]*EarnProduct),
		subscriptions:    make(map[string]*EarnSubscription),
		userSubs:         make(map[string][]*EarnSubscription),
		launchpadAllocs:  make(map[string]*LaunchpadAllocation),
		userEarnings:     make(map[string][]*EarningRecord),
		ctx:              ctx,
		cancel:           cancel,
		distributionInterval: 86400, // 24 hours
		config: EarnConfig{
			StakingEnabled:     true,
			SavingsEnabled:     true,
			LaunchpadEnabled:   true,
			MinStakingAmount:   10,
			MaxStakingAmount:   10000000,
			CompoundEnabled:    true,
			AutoStakeEnabled:   true,
			DistributionInterval: 86400,
		},
	}

	// Initialize default products
	service.initializeDefaultProducts()

	// Start background workers
	service.startWorkers()

	return service
}

func (e *EarnService) initializeDefaultProducts() {
	products := []*EarnProduct{
		// Flexible Savings
		{
			ProductID:        "savings_flex_btc",
			Name:             "BTC Flexible Savings",
			Type:             ProductTypeSavings,
			Currency:         "BTC",
			Status:           EarnStatusActive,
			MinAPY:           0.001, // 0.1%
			MaxAPY:           0.005,
			CurrentAPY:       0.002,
			DistributionDays: 1,
			DurationDays:      0, // Flexible
			MinAmount:         0.0001,
			MaxAmount:         1000,
			TotalCapacity:     10000,
			CurrentSubscribed: 500,
			AllowEarlyUnlock:  true,
			EarlyUnlockFee:   0.001,
			StartDate:        time.Now().UnixMilli(),
		},
		{
			ProductID:        "savings_flex_eth",
			Name:             "ETH Flexible Savings",
			Type:             ProductTypeSavings,
			Currency:         "ETH",
			Status:           EarnStatusActive,
			MinAPY:           0.002,
			MaxAPY:           0.008,
			CurrentAPY:       0.005,
			DistributionDays: 1,
			DurationDays:      0,
			MinAmount:         0.01,
			MaxAmount:         10000,
			TotalCapacity:     100000,
			CurrentSubscribed: 25000,
			AllowEarlyUnlock:  true,
			EarlyUnlockFee:   0.001,
			StartDate:        time.Now().UnixMilli(),
		},
		{
			ProductID:        "savings_flex_usdt",
			Name:             "USDT Flexible Savings",
			Type:             ProductTypeSavings,
			Currency:         "USDT",
			Status:           EarnStatusActive,
			MinAPY:           0.03, // 3%
			MaxAPY:           0.10,
			CurrentAPY:       0.05,
			DistributionDays: 1,
			DurationDays:      0,
			MinAmount:         10,
			MaxAmount:         1000000,
			TotalCapacity:     100000000,
			CurrentSubscribed: 25000000,
			AllowEarlyUnlock:  true,
			EarlyUnlockFee:   0.001,
			StartDate:        time.Now().UnixMilli(),
		},
		// Locked Staking
		{
			ProductID:        "staking_30d_eth",
			Name:             "ETH 30-Day Staking",
			Type:             ProductTypeStaking,
			Currency:         "ETH",
			Status:           EarnStatusActive,
			MinAPY:           0.04,
			MaxAPY:           0.06,
			CurrentAPY:       0.05,
			DistributionDays: 30,
			DurationDays:      30,
			MinAmount:         0.1,
			MaxAmount:         5000,
			TotalCapacity:     50000,
			CurrentSubscribed: 12000,
			AllowEarlyUnlock:  false,
			StartDate:        time.Now().UnixMilli(),
		},
		{
			ProductID:        "staking_60d_sol",
			Name:             "SOL 60-Day Staking",
			Type:             ProductTypeStaking,
			Currency:         "SOL",
			Status:           EarnStatusActive,
			MinAPY:           0.06,
			MaxAPY:           0.12,
			CurrentAPY:       0.08,
			DistributionDays: 60,
			DurationDays:      60,
			MinAmount:         1,
			MaxAmount:         10000,
			TotalCapacity:     100000,
			CurrentSubscribed: 45000,
			AllowEarlyUnlock:  false,
			StartDate:        time.Now().UnixMilli(),
		},
		{
			ProductID:        "staking_90d_bnb",
			Name:             "BNB 90-Day Staking",
			Type:             ProductTypeStaking,
			Currency:         "BNB",
			Status:           EarnStatusActive,
			MinAPY:           0.08,
			MaxAPY:           0.15,
			CurrentAPY:       0.10,
			DistributionDays: 90,
			DurationDays:      90,
			MinAmount:         0.1,
			MaxAmount:         1000,
			TotalCapacity:     10000,
			CurrentSubscribed: 3500,
			AllowEarlyUnlock:  false,
			StartDate:        time.Now().UnixMilli(),
		},
		// ETH Liquid Staking
		{
			ProductID:        "liquid_staking_eth",
			Name:             "ETH 2.0 Liquid Staking",
			Type:             ProductTypeStaking,
			Currency:         "ETH",
			Chain:            "ETH",
			Status:           EarnStatusActive,
			MinAPY:           0.03,
			MaxAPY:           0.06,
			CurrentAPY:       0.045,
			DistributionDays: 1,
			DurationDays:      0, // Flexible with lock
			MinAmount:         0.01,
			MaxAmount:         10000,
			TotalCapacity:     500000,
			CurrentSubscribed: 125000,
			AllowEarlyUnlock:  false,
			UnlockDate:        time.Now().AddDate(0, 0, 1).UnixMilli(), // 1 day after request
			StartDate:        time.Now().UnixMilli(),
		},
		// DeFi Staking
		{
			ProductID:        "defi_farm_btc",
			Name:             "BTC DeFi Farm",
			Type:             ProductTypeDeFi,
			Currency:         "BTC",
			Status:           EarnStatusActive,
			MinAPY:           0.05,
			MaxAPY:           0.15,
			CurrentAPY:       0.10,
			DistributionDays: 7,
			DurationDays:      7,
			MinAmount:         0.001,
			MaxAmount:         100,
			TotalCapacity:     1000,
			CurrentSubscribed: 450,
			AllowEarlyUnlock:  false,
			StartDate:        time.Now().UnixMilli(),
		},
	}

	for _, p := range products {
		e.products[p.ProductID] = p
	}

	log.Printf("[INFO] Initialized %d earn products", len(products))
}

func (e *EarnService) startWorkers() {
	// Earnings distribution worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(time.Duration(e.distributionInterval) * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.distributeEarnings()
			}
		}
	}()

	// Subscription expiry worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.processCompletedSubscriptions()
			}
		}
	}()
}

func (e *EarnService) Shutdown() {
	e.cancel()
	e.wg.Wait()
}

// =============================================================================
// PRODUCT MANAGEMENT
// =============================================================================

func (e *EarnService) GetProducts(productType string, currency string) []*EarnProduct {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var products []*EarnProduct
	for _, p := range e.products {
		if productType != "" && string(p.Type) != productType {
			continue
		}
		if currency != "" && p.Currency != currency {
			continue
		}
		if p.Status == EarnStatusActive {
			products = append(products, p)
		}
	}
	return products
}

func (e *EarnService) GetProduct(productID string) (*EarnProduct, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if product, ok := e.products[productID]; ok {
		return product, nil
	}
	return nil, errors.New("product not found")
}

func (e *EarnService) CreateProduct(product *EarnProduct) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	product.ProductID = uuid.New().String()[:16]
	product.CreatedAt = time.Now().UnixMilli()

	e.products[product.ProductID] = product

	log.Printf("[INFO] Earn product created: %s", product.ProductID)
	return nil
}

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

func (e *EarnService) Subscribe(userID, productID string, amount float64) (*EarnSubscription, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	product, ok := e.products[productID]
	if !ok {
		return nil, errors.New("product not found")
	}

	if product.Status != EarnStatusActive {
		return nil, errors.New("product not available")
	}

	if amount < product.MinAmount {
		return nil, fmt.Errorf("minimum amount is %.4f %s", product.MinAmount, product.Currency)
	}

	if amount > product.MaxAmount {
		return nil, fmt.Errorf("maximum amount is %.4f %s", product.MaxAmount, product.Currency)
	}

	if product.CurrentSubscribed+amount > product.TotalCapacity {
		return nil, errors.New("insufficient capacity")
	}

	// Calculate end date
	now := time.Now()
	startDate := now.UnixMilli()
	endDate := now.AddDate(0, 0, product.DurationDays).UnixMilli()
	unlockDate := endDate

	if product.UnlockDate > 0 {
		unlockDate = product.UnlockDate
	}

	subscription := &EarnSubscription{
		SubscriptionID:   uuid.New().String()[:16],
		UserID:           userID,
		ProductID:        productID,
		ProductName:      product.Name,
		Amount:           amount,
		Currency:         product.Currency,
		APY:               product.CurrentAPY,
		DurationDays:     product.DurationDays,
		StartDate:        startDate,
		EndDate:          endDate,
		UnlockDate:       unlockDate,
		PendingEarnings:  0,
		ClaimedEarnings:  0,
		Status:           "active",
		EarlyUnlocked:    false,
		CreatedAt:        startDate,
		UpdatedAt:        startDate,
	}

	e.subscriptions[subscription.SubscriptionID] = subscription
	e.userSubs[userID] = append(e.userSubs[userSubscription)

	// Update product capacity
	product.CurrentSubscribed += amount

	log.Printf("[INFO] Earn subscription: %s user=%s product=%s amount=%.4f %s APY=%.2f%%",
		subscription.SubscriptionID, userID, productID, amount, product.Currency, product.CurrentAPY*100)

	return subscription, nil
}

func (e *EarnService) GetSubscription(subscriptionID string) (*EarnSubscription, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if sub, ok := e.subscriptions[subscriptionID]; ok {
		return sub, nil
	}
	return nil, errors.New("subscription not found")
}

func (e *EarnService) GetUserSubscriptions(userID string) []*EarnSubscription {
	e.mu.RLock()
	defer e.mu.RUnlock()

	return e.userSubs[userID]
}

func (e *EarnService) GetActiveSubscriptions(userID string) []*EarnSubscription {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var active []*EarnSubscription
	for _, sub := range e.userSubs[userID] {
		if sub.Status == "active" {
			active = append(active, sub)
		}
	}
	return active
}

func (e *EarnService) ClaimEarnings(subscriptionID string) (float64, string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	sub, ok := e.subscriptions[subscriptionID]
	if !ok {
		return 0, "", errors.New("subscription not found")
	}

	if sub.Status != "active" {
		return 0, "", errors.New("subscription not active")
	}

	// Calculate pending earnings
	earnings := sub.PendingEarnings
	if earnings <= 0 {
		return 0, "", errors.New("no earnings to claim")
	}

	// Reset pending earnings
	sub.PendingEarnings = 0
	sub.LastClaimedAt = time.Now().UnixMilli()
	sub.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Earnings claimed: %s amount=%.8f %s", subscriptionID, earnings, sub.Currency)

	return earnings, sub.Currency, nil
}

func (e *EarnService) EarlyUnlock(subscriptionID string) (float64, float64, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	sub, ok := e.subscriptions[subscriptionID]
	if !ok {
		return 0, 0, errors.New("subscription not found")
	}

	if sub.Status != "active" {
		return 0, 0, errors.New("subscription not active")
	}

	product, ok := e.products[sub.ProductID]
	if !ok {
		return 0, 0, errors.New("product not found")
	}

	if !product.AllowEarlyUnlock {
		return 0, 0, errors.New("early unlock not allowed")
	}

	// Calculate fee and return amount
	fee := sub.Amount * product.EarlyUnlockFee
	returnAmount := sub.Amount - fee

	// Update subscription
	sub.Status = "completed"
	sub.EarlyUnlocked = true
	sub.UpdatedAt = time.Now().UnixMilli()

	// Update product capacity
	product.CurrentSubscribed -= sub.Amount

	log.Printf("[INFO] Early unlock: %s amount=%.4f fee=%.4f", subscriptionID, returnAmount, fee)

	return returnAmount, fee, nil
}

// =============================================================================
// EARNINGS DISTRIBUTION
// =============================================================================

func (e *EarnService) distributeEarnings() {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UnixMilli()

	for _, sub := range e.subscriptions {
		if sub.Status != "active" {
			continue
		}

		// Calculate daily/periodic earnings
		// APY / 365 * amount = daily earnings
		dailyEarnings := (sub.APY / 365) * sub.Amount

		// For different distribution periods
		if sub.DurationDays > 0 {
			// Calculate based on distribution days
			earningsPerPeriod := (sub.APY / float64(365/sub.DurationDays)) * sub.Amount
			
			// Check if it's time to distribute
			lastClaim := sub.LastClaimedAt
			if lastClaim == 0 {
				lastClaim = sub.StartDate
			}
			
			periodMillis := int64(sub.DurationDays) * 24 * 60 * 60 * 1000
			if now-lastClaim >= periodMillis {
				sub.PendingEarnings += earningsPerPeriod
				sub.UpdatedAt = now

				// Record earning
				record := &EarningRecord{
					SubscriptionID: sub.SubscriptionID,
					Amount:         earningsPerPeriod,
					Currency:       sub.Currency,
					Type:           "interest",
					Timestamp:      now,
				}
				e.userEarnings[sub.UserID] = append(e.userEarnings[sub.UserID], record)
			}
		}
	}

	log.Printf("[INFO] Earnings distributed at %d", now)
}

func (e *EarnService) processCompletedSubscriptions() {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UnixMilli()

	for _, sub := range e.subscriptions {
		if sub.Status == "active" && sub.EndDate > 0 && sub.EndDate <= now {
			sub.Status = "completed"
			sub.UpdatedAt = now

			// Final earnings distribution
			// (Already calculated in regular distribution)

			log.Printf("[INFO] Subscription completed: %s user=%s", sub.SubscriptionID, sub.UserID)
		}
	}
}

// =============================================================================
// LAUNCHPAD
// =============================================================================

func (e *EarnService) SubscribeLaunchpad(userID, productID string, bidAmount float64) (*LaunchpadAllocation, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	product, ok := e.products[productID]
	if !ok {
		return nil, errors.New("product not found")
	}

	if product.Type != ProductTypeLaunchpad && product.Type != ProductTypeLaunchpool {
		return nil, errors.New("not a launchpad product")
	}

	// Calculate allocation based on bid amount
	// In production, would use more complex allocation algorithm
	allocationAmount := bidAmount * 10 // simplified

	alloc := &LaunchpadAllocation{
		AllocationID:     uuid.New().String()[:16],
		UserID:           userID,
		ProductID:        productID,
		BiddedAmount:     bidAmount,
		AllocationAmount: allocationAmount,
		TokenPrice:       0.1, // simplified
		Status:           "pending",
		CreatedAt:        time.Now().UnixMilli(),
	}

	e.launchpadAllocs[alloc.AllocationID] = alloc

	log.Printf("[INFO] Launchpad subscription: %s user=%s bid=%.4f allocation=%.4f",
		alloc.AllocationID, userID, bidAmount, allocationAmount)

	return alloc, nil
}

func (e *EarnService) ClaimLaunchpadAllocation(allocationID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	alloc, ok := e.launchpadAllocs[allocationID]
	if !ok {
		return errors.New("allocation not found")
	}

	if alloc.Status != "allocated" {
		return errors.New("not eligible for claim")
	}

	alloc.Status = "claimed"
	alloc.ClaimedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Launchpad allocation claimed: %s", allocationID)
	return nil
}

// =============================================================================
// STATS & QUERIES
// =============================================================================

func (e *EarnService) GetUserStats(userID string) map[string]interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var totalStaked, totalEarnings float64
	activeSubs := 0

	for _, sub := range e.userSubs[userID] {
		totalStaked += sub.Amount
		totalEarnings += sub.ClaimedEarnings + sub.PendingEarnings
		if sub.Status == "active" {
			activeSubs++
		}
	}

	return map[string]interface{}{
		"total_staked":       totalStaked,
		"total_earnings":     totalEarnings,
		"active_subscriptions": activeSubs,
	}
}

func (e *EarnService) GetTotalStats() map[string]interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var totalSubscribed, totalCapacity float64

	for _, product := range e.products {
		totalSubscribed += product.CurrentSubscribed
		totalCapacity += product.TotalCapacity
	}

	return map[string]interface{}{
		"total_products":     len(e.products),
		"total_subscriptions": len(e.subscriptions),
		"total_subscribed":   totalSubscribed,
		"total_capacity":      totalCapacity,
	}
}

// Placeholder
var _ = fmt.Errorf