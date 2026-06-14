package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// AUTO INVEST
// Automated investment plans similar to Binance Auto-Invest
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// InvestmentPlan represents an auto-investment plan
type InvestmentPlan struct {
	ID          string
	UserID     string
	Name       string
	Strategy  StrategyType
	Assets    []AssetAllocation
	Amount    float64
	Frequency InvestmentFrequency
	Status   PlanStatus
	NextRun   time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

type StrategyType string

const (
	StrategyRecurring  StrategyType = "RECURRING"
	StrategyDCA       StrategyType = "DCA"
	StrategySmart     StrategyType = "SMART"
	StrategyYield     StrategyType = "YIELD"
)

type AssetAllocation struct {
	Asset   string
	Percent float64 // 0-100
}

type InvestmentFrequency string

const (
	FrequencyDaily    InvestmentFrequency = "DAILY"
	FrequencyWeekly  InvestmentFrequency = "WEEKLY"
	FrequencyBiweekly InvestmentFrequency = "BIWEEKLY"
	FrequencyMonthly InvestmentFrequency = "MONTHLY"
)

type PlanStatus string

const (
	PlanStatusActive   PlanStatus = "ACTIVE"
	PlanStatusPaused  PlanStatus = "PAUSED"
	PlanStatusStopped PlanStatus = "STOPPED"
	PlanStatusCompleted PlanStatus = "COMPLETED"
)

// InvestmentTransaction represents an investment transaction
type InvestmentTransaction struct {
	ID          string
	PlanID     string
	Asset      string
	Amount     float64
	Price      float64
	Quantity   float64
	Status    TransactionStatus
	ExecutedAt *time.Time
	CreatedAt time.Time
}

type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "PENDING"
	TransactionStatusExecuted TransactionStatus = "EXECUTED"
	TransactionStatusFailed   TransactionStatus = "FAILED"
)

// YieldStrategy represents a yield optimization strategy
type YieldStrategy struct {
	ID          string
	UserID     string
	Assets     []string
	TargetAPY  float64
	MinAPY     float64
	Status    StrategyStatus
	CreatedAt time.Time
}

type StrategyStatus string

const (
	StrategyStatusActive  StrategyStatus = "ACTIVE"
	StrategyStatusPaused StrategyStatus = "PAUSED"
)

// ============================================================================
// SERVICE
// ============================================================================

type AutoInvestService struct {
	mu      sync.RWMutex
	plans   map[string]*InvestmentPlan
	yieldStrategies map[string]*YieldStrategy
	transactions map[string]*InvestmentTransaction
	
	planCounter    int64
	transactionCounter int64
}

func NewAutoInvestService() *AutoInvestService {
	return &AutoInvestService{
		plans:   make(map[string]*InvestmentPlan),
		yieldStrategies: make(map[string]*YieldStrategy),
		transactions: make(map[string]*InvestmentTransaction),
	}
}

// ============================================================================
// PLAN MANAGEMENT
// ============================================================================

func (s *AutoInvestService) CreatePlan(userID, name string, strategy StrategyType, assets []AssetAllocation, amount float64, frequency InvestmentFrequency) (*InvestmentPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate allocations
	totalPercent := 0.0
	for _, a := range assets {
		totalPercent += a.Percent
	}
	if totalPercent < 99.0 || totalPercent > 101.0 {
		return nil, fmt.Errorf("allocations must total 100%%")
	}
	
	s.planCounter++
	plan := &InvestmentPlan{
		ID:       fmt.Sprintf("PLAN%d", s.planCounter),
		UserID:  userID,
		Name:    name,
		Strategy: strategy,
		Assets:  assets,
		Amount:  amount,
		Frequency: frequency,
		Status:  PlanStatusActive,
		NextRun: s.calculateNextRun(frequency),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	s.plans[plan.ID] = plan
	return plan, nil
}

func (s *AutoInvestService) PausePlan(planID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	plan, ok := s.plans[planID]
	if !ok {
		return fmt.Errorf("plan not found")
	}
	
	plan.Status = PlanStatusPaused
	plan.UpdatedAt = time.Now()
	return nil
}

func (s *AutoInvestService) ResumePlan(planID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	plan, ok := s.plans[planID]
	if !ok {
		return fmt.Errorf("plan not found")
	}
	
	plan.Status = PlanStatusActive
	plan.UpdatedAt = time.Now()
	return nil
}

func (s *AutoInvestService) StopPlan(planID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	plan, ok := s.plans[planID]
	if !ok {
		return fmt.Errorf("plan not found")
	}
	
	plan.Status = PlanStatusStopped
	plan.UpdatedAt = time.Now()
	return nil
}

func (s *AutoInvestService) GetPlan(planID string) (*InvestmentPlan, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	plan, ok := s.plans[planID]
	if !ok {
		return nil, fmt.Errorf("plan not found")
	}
	
	return plan, nil
}

func (s *AutoInvestService) GetUserPlans(userID string) []*InvestmentPlan {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*InvestmentPlan
	for _, plan := range s.plans {
		if plan.UserID == userID {
			result = append(result, plan)
		}
	}
	
	return result
}

// ============================================================================
// EXECUTION
// ============================================================================

func (s *AutoInvestService) ExecutePlan(planID string) ([]*InvestmentTransaction, error) {
	s.mu.Lock()
	plan, ok := s.plans[planID]
	s.mu.Unlock()
	
	if !ok {
		return nil, fmt.Errorf("plan not found")
	}
	
	if plan.Status != PlanStatusActive {
		return nil, fmt.Errorf("plan not active")
	}
	
	var transactions []*InvestmentTransaction
	
	for _, allocation := range plan.Assets {
		// Calculate amount for this asset
		assetAmount := plan.Amount * (allocation.Percent / 100.0)
		
		// Get current price (mock)
		price := s.getPrice(allocation.Asset)
		quantity := assetAmount / price
		
		// Create transaction
		s.mu.Lock()
		s.transactionCounter++
		tx := &InvestmentTransaction{
			ID:         fmt.Sprintf("TX%d", s.transactionCounter),
			PlanID:     planID,
			Asset:     allocation.Asset,
			Amount:    assetAmount,
			Price:     price,
			Quantity:  quantity,
			Status:    TransactionStatusExecuted,
			ExecutedAt: func() *time.Time { t := time.Now(); return &t }(),
			CreatedAt: time.Now(),
		}
		s.transactions[tx.ID] = tx
		s.mu.Unlock()
		
		transactions = append(transactions, tx)
	}
	
	// Update next run time
	s.mu.Lock()
	plan.NextRun = s.calculateNextRun(plan.Frequency)
	plan.UpdatedAt = time.Now()
	s.mu.Unlock()
	
	return transactions, nil
}

func (s *AutoInvestService) ExecuteDuePlans() []*InvestmentTransaction {
	s.mu.RLock()
	var duePlans []*InvestmentPlan
	now := time.Now()
	
	for _, plan := range s.plans {
		if plan.Status == PlanStatusActive && now.After(plan.NextRun) {
			duePlans = append(duePlans, plan)
		}
	}
	s.mu.RUnlock()
	
	var allTransactions []*InvestmentTransaction
	
	for _, plan := range duePlans {
		txs, _ := s.ExecutePlan(plan.ID)
		allTransactions = append(allTransactions, txs...)
	}
	
	return allTransactions
}

// ============================================================================
// YIELD STRATEGIES
// ============================================================================

func (s *AutoInvestService) CreateYieldStrategy(userID string, assets []string, targetAPY, minAPY float64) (*YieldStrategy, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	strategy := &YieldStrategy{
		ID:       generateID("YIELD"),
		UserID:   userID,
		Assets:   assets,
		TargetAPY: targetAPY,
		MinAPY:  minAPY,
		Status:  StrategyStatusActive,
		CreatedAt: time.Now(),
	}
	
	s.yieldStrategies[strategy.ID] = strategy
	return strategy, nil
}

func (s *AutoInvestService) OptimizeYield(strategyID string) error {
	s.mu.RLock()
	strategy, ok := s.yieldStrategies[strategyID]
	s.mu.RUnlock()
	
	if !ok {
		return fmt.Errorf("strategy not found")
	}
	
	// In production, this would:
	// 1. Analyze current yields across assets
	// 2. Rebalance to maximize APY
	// 3. Execute rebalancing trades
	
	return nil
}

// ============================================================================
// STATISTICS
// ============================================================================

func (s *AutoInvestService) GetPlanStatistics(planID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	plan, ok := s.plans[planID]
	if !ok {
		return nil
	}
	
	var totalInvested float64
	var totalTransactions int64
	
	for _, tx := range s.transactions {
		if tx.PlanID == planID {
			totalInvested += tx.Amount
			totalTransactions++
		}
	}
	
	return map[string]interface{}{
		"plan_id":          planID,
		"total_invested":   totalInvested,
		"total_transactions": totalTransactions,
		"status":           plan.Status,
		"next_run":        plan.NextRun,
	}
}

// ============================================================================
// HELPERS
// ============================================================================

func (s *AutoInvestService) calculateNextRun(frequency InvestmentFrequency) time.Time {
	now := time.Now()
	
	switch frequency {
	case FrequencyDaily:
		return now.Add(24 * time.Hour)
	case FrequencyWeekly:
		return now.Add(7 * 24 * time.Hour)
	case FrequencyBiweekly:
		return now.Add(14 * 24 * time.Hour)
	case FrequencyMonthly:
		return now.AddDate(0, 1, 0)
	default:
		return now.Add(24 * time.Hour)
	}
}

func (s *AutoInvestService) getPrice(asset string) float64 {
	// Mock prices - in production, use real market data
	prices := map[string]float64{
		"BTC": 50000,
		"ETH": 3000,
		"BNB": 600,
		"SOL": 100,
	}
	
	if price, ok := prices[asset]; ok {
		return price
	}
	return 1.0
}

func generateID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%s%s", prefix, hex.EncodeToString(b)[:8])
}

func main() {
	fmt.Println("TigerEx Auto-Invest v1.0.0")
	
	auto := NewAutoInvestService()
	
	// Create DCA plan
	plan, _ := auto.CreatePlan("user1", "Monthly BTC DCA", StrategyDCA, []AssetAllocation{
		{Asset: "BTC", Percent: 60},
		{Asset: "ETH", Percent: 30},
		{Asset: "BNB", Percent: 10},
	}, 1000, FrequencyMonthly)
	
	fmt.Printf("Created plan: %s\n", plan.ID)
	
	// Execute plan
	txs, _ := auto.ExecutePlan(plan.ID)
	fmt.Printf("Executed %d transactions\n", len(txs))
	
	for _, tx := range txs {
		fmt.Printf("  Bought %.8f %s at $%.2f\n", tx.Quantity, tx.Asset, tx.Price)
	}
	
	// Get stats
	stats := auto.GetPlanStatistics(plan.ID)
	fmt.Printf("Stats: %+v\n", stats)
}