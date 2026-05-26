package main

import (
	"fmt"
	"time"
)

// Deposit type
type DepositType string

const (
	DepositRecurring DepositType = "recurring"
	DepositDCA DepositType = "dca"
	DepositScheduled DepositType = "scheduled"
	DepositVault DepositType = "vault"
	DepositBudget DepositType = "budget"
)

// Frequency
type Frequency string

const (
	FreqDaily Frequency = "daily"
	FreqWeekly Frequency = "weekly"
	FreqBiweekly Frequency = "biweekly"
	FreqMonthly Frequency = "monthly"
	FreqQuarterly Frequency = "quarterly"
)

// Routing strategy
type RoutingStrategy string

const (
	RoutingBestPrice RoutingStrategy = "best_price"
	RoutingSplit RoutingStrategy = "split"
	RoutingSlippageLimit RoutingStrategy = "slippage_limit"
	RoutingCheapest RoutingStrategy = "cheapest"
)

// Deposit plan
type DepositPlan struct {
	ID            string        `json:"id"`
	UserID       string        `json:"userId"`
	DepositType  DepositType  `json:"depositType"`
	Currency     string        `json:"currency"`
	Amount       float64       `json:"amount"`
	Frequency    Frequency     `json:"frequency"`
	NextRun      int64         `json:"nextRun"`
	Status       string        `json:"status"`
	CreatedAt    int64         `json:"createdAt"`
}

// Execution result
type ExecutionResult struct {
	PlanID      string  `json:"planId"`
	ExecutedAt int64   `json:"executedAt"`
	Amount     float64 `json:"amount"`
	Status     string  `json:"status"`
}

// Programmable deposits
type ProgrammableDeposits struct {
	Plans      map[string]*DepositPlan
	Executions map[string][]*ExecutionResult
}

// New creates service
func NewProgrammableDeposits() *ProgrammableDeposits {
	return &ProgrammableDeposits{
		Plans: make(map[string]*DepositPlan),
		Executions: make(map[string][]*ExecutionResult),
	}
}

// Get next run time
func (p *ProgrammableDeposits) getNextRun(frequency Frequency) int64 {
	now := time.Now()
	
	switch frequency {
	case FreqDaily:
		return now.Add(24 * time.Hour).UnixMilli()
	case FreqWeekly:
		return now.Add(7 * 24 * time.Hour).UnixMilli()
	case FreqBiweekly:
		return now.Add(14 * 24 * time.Hour).UnixMilli()
	case FreqMonthly:
		return now.Add(30 * 24 * time.Hour).UnixMilli()
	case FreqQuarterly:
		return now.Add(90 * 24 * time.Hour).UnixMilli()
	default:
		return now.Add(24 * time.Hour).UnixMilli()
	}
}

// Create deposit plan
func (p *ProgrammableDeposits) CreatePlan(userID string, depositType DepositType, currency string, amount float64, frequency Frequency) *DepositPlan {
	id := fmt.Sprintf("plan_%d", time.Now().UnixNano())
	
	plan := &DepositPlan{
		ID: id,
		UserID: userID,
		DepositType: depositType,
		Currency: currency,
		Amount: amount,
		Frequency: frequency,
		NextRun: p.getNextRun(frequency),
		Status: "active",
		CreatedAt: time.Now().UnixMilli(),
	}
	
	p.Plans[id] = plan
	return plan
}

// Pause plan
func (p *ProgrammableDeposits) PausePlan(planID string) bool {
	plan, ok := p.Plans[planID]
	if !ok {
		return false
	}
	
	plan.Status = "paused"
	return true
}

// Execute deposit
func (p *ProgrammableDeposits) Execute(planID string) *ExecutionResult {
	plan, ok := p.Plans[planID]
	if !ok || plan.Status != "active" {
		return nil
	}
	
	result := &ExecutionResult{
		PlanID: planID,
		ExecutedAt: time.Now().UnixMilli(),
		Amount: plan.Amount,
		Status: "success",
	}
	
	p.Executions[planID] = append(p.Executions[planID], result)
	
	// Schedule next run
	plan.NextRun = p.getNextRun(plan.Frequency)
	
	return result
}

// Get pending executions
func (p *ProgrammableDeposits) GetPending() []*DepositPlan {
	var result []*DepositPlan
	now := time.Now().UnixMilli()
	
	for _, plan := range p.Plans {
		if plan.Status == "active" && plan.NextRun <= now {
			result = append(result, plan)
		}
	}
	
	return result
}

func main() {
	svc := NewProgrammableDeposits()
	
	// Create DCA plan
	plan := svc.CreatePlan("user1", DepositDCA, "USDT", 100.0, FreqDaily)
	fmt.Printf("Created: %s\n", plan.ID)
	
	// Execute
	result := svc.Execute(plan.ID)
	fmt.Printf("Executed: %.2f %s\n", result.Amount, plan.Currency)
	
	// Next run
	fmt.Printf("Next run: %d\n", plan.NextRun)
}