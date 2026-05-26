// Package invest - Auto Invest Bot
package main

import (
	"fmt"
	"time"
)

type Plan struct {
	ID        string
	UserID    string
	Symbol    string
	Amount    float64
	Interval  time.Duration
	LastBuy   time.Time
	Enabled   bool
}

type Executor struct {
	plans map[string]*Plan
}

func NewExecutor() *Executor {
	return &Executor{plans: make(map[string]*Plan)}
}

func (e *Executor) AddPlan(plan Plan) {
	e.plans[plan.ID] = &plan
}

func (e *Executor) Run() []Execution {
	var executions []Execution
	now := time.Now()
	
	for _, plan := range e.plans {
		if !plan.Enabled {
			continue
		}
		if now.Sub(plan.LastBuy) >= plan.Interval {
			executions = append(executions, Execution{
				PlanID: plan.ID,
				Symbol: plan.Symbol,
				Amount: plan.Amount,
				Time:   now,
			})
			plan.LastBuy = now
		}
	}
	return executions
}

type Execution struct {
	PlanID  string
	Symbol  string
	Amount  float64
	Time    time.Time
}

func main() {
	ex := NewExecutor()
	ex.AddPlan(Plan{
		ID:       "dca-btc",
		UserID:   "user1",
		Symbol:   "BTC",
		Amount:   100,
		Interval: 24 * time.Hour,
		Enabled:  true,
	})
	
	execs := ex.Run()
	fmt.Printf("Executed %d buys\n", len(execs))
}