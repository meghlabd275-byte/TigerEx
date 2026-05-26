package main

import (
	"fmt"
	"time"
)

// Plan status
type PlanStatus string

const (
	PlanActive PlanStatus = "active"
	PlanPaused PlanStatus = "paused"
)

// Auto invest plan
type AutoInvestPlan struct {
	ID      string    `json:"id"`
	UserID string    `json:"userId"`
	Asset  string    `json:"asset"`
	Amount float64   `json:"amount"`
	Interval string  `json:"interval"`
	Status PlanStatus `json:"status"`
	NextRun int64    `json:"nextRun,omitempty"`
}

// Auto invest system
type AutoInvest struct {
	Plans map[string]*AutoInvestPlan
}

// New creates system
func NewAutoInvest() *AutoInvest {
	return &AutoInvest{
		Plans: make(map[string]*AutoInvestPlan),
	}
}

// Create plan
func (a *AutoInvest) CreatePlan(userID, asset string, amount float64, interval string) *AutoInvestPlan {
	id := fmt.Sprintf("plan_%d", time.Now().UnixNano())
	
	// Calculate next run
	nextRun := time.Now().Add(24 * time.Hour).UnixMilli()
	
	plan := &AutoInvestPlan{
		ID: id,
		UserID: userID,
		Asset: asset,
		Amount: amount,
		Interval: interval,
		Status: PlanActive,
		NextRun: nextRun,
	}
	
	a.Plans[id] = plan
	return plan
}

// Pause plan
func (a *AutoInvest) PausePlan(planID string) bool {
	plan := a.Plans[planID]
	if plan == nil {
		return false
	}
	
	plan.Status = PlanPaused
	return true
}

// Resume plan
func (a *AutoInvest) ResumePlan(planID string) bool {
	plan := a.Plans[planID]
	if plan == nil {
		return false
	}
	
	plan.Status = PlanActive
	plan.NextRun = time.Now().Add(24 * time.Hour).UnixMilli()
	return true
}

// Execute plans
func (a *AutoInvest) ExecutePlans() int {
	executed := 0
	
	now := time.Now().UnixMilli()
	
	for _, plan := range a.Plans {
		if plan.Status == PlanActive && plan.NextRun <= now {
			// Execute purchase
			fmt.Printf("Executing: %s %.2f %s\n", plan.UserID, plan.Amount, plan.Asset)
			plan.NextRun += 86400000 // Next day
			executed++
		}
	}
	
	return executed
}

func main() {
	autoInvest := NewAutoInvest()
	
	// Create plan
	plan := autoInvest.CreatePlan("user1", "BTC", 100, "daily")
	fmt.Printf("Created: %s - %s %.2f\n", plan.Asset, plan.Asset, plan.Amount)
	
	// Execute
	count := autoInvest.ExecutePlans()
	fmt.Printf("Executed: %d\n", count)
}