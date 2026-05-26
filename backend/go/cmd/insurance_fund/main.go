// Package insurance_fund provides insurance for users.
// Migrated from TypeScript to Go for SAFU (Secure Asset Fund).
package main

import (
	"fmt"
	"sync"
	"time"
)

// Insurance pool
type InsurancePool struct {
	ID       string  `json:"id"`
	Asset    string  `json:"asset"`
	Balance  float64 `json:"balance"`
	Cover    float64 `json:"cover"` // coverage limit
	Claims   int     `json:"claims"`
	PaidOut  float64 `json:"paidOut"`
}

// Claim
type InsuranceClaim struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	Asset    string  `json:"asset"`
	Amount   float64 `json:"amount"`
	Reason   string  `json:"reason"` // hack, exploit, technical
	Status   string  `json:"status"` // pending, approved, rejected
	ApprovedAt int64  `json:"approvedAt"`
	CreatedAt int64   `json:"createdAt"`
}

// Protection level
type ProtectionLevel struct {
	Level     string  `json:"level"` // standard, enhanced, unlimited
	CoverUSD  float64 `json:"coverUsd"`
	FeeMonthly float64 `json:"feeMonthly"`
}

var (
	pools = map[string]*InsurancePool{
		"BTC": {ID: "pool_BTC", Asset: "BTC", Balance: 5000, Cover: 100000000, Claims: 0, PaidOut: 0},
		"ETH": {ID: "pool_ETH", Asset: "ETH", Balance: 50000, Cover: 100000000, Claims: 0, PaidOut: 0},
		"USDT": {ID: "pool_USDT", Asset: "USDT", Balance: 100000000, Cover: 50000000, Claims: 0, PaidOut: 0},
		"USDC": {ID: "pool_USDC", Asset: "USDC", Balance: 100000000, Cover: 50000000, Claims: 0, PaidOut: 0},
	}

	protectionLevels = []ProtectionLevel{
		{Level: "standard", CoverUSD: 50000, FeeMonthly: 0},
		{Level: "enhanced", CoverUSD: 500000, FeeMonthly: 29},
		{Level: "unlimited", CoverUSD: 999999999, FeeMonthly: 99},
	}
)

// Submit claim
func SubmitClaim(userID, asset string, amount float64, reason string) (*InsuranceClaim, error) {
	pool, ok := pools[asset]
	if !ok {
		return nil, fmt.Errorf("asset not covered")
	}

	if pool.Balance <= 0 {
		return nil, fmt.Errorf("insurance pool depleted")
	}

	maxCover := pool.Cover - pool.PaidOut
	if amount > maxCover {
		amount = maxCover
	}

	claim := &InsuranceClaim{
		ID: fmt.Sprintf("claim_%d", time.Now().UnixNano()),
		UserID: userID,
		Asset: asset,
		Amount: amount,
		Reason: reason,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	return claim, nil
}

// Approve claim
func ApproveClaim(claimID string) error {
	var claim *InsuranceClaim
	var pool *InsurancePool

	// Find claim (simplified)
	for _, p := range pools {
		// Would search claims in real impl
	}

	if claim == nil || pool == nil {
		return fmt.Errorf("claim not found")
	}

	if claim.Status != "pending" {
		return fmt.Errorf("claim not pending")
	}

	pool.Balance -= claim.Amount
	pool.PaidOut += claim.Amount
	pool.Claims++
	claim.Status = "approved"
	claim.ApprovedAt = time.Now().UnixMilli()

	return nil
}

// Get pool status
func GetPoolStatus(asset string) (map[string]interface{}, error) {
	pool, ok := pools[asset]
	if !ok {
		return nil, fmt.Errorf("asset not found")
	}

	return map[string]interface{}{
		"balance": pool.Balance,
		"cover": pool.Cover - pool.PaidOut,
		"claims": pool.Claims,
		"paidOut": pool.PaidOut,
	}, nil
}

func main() {
	fmt.Println("Insurance Fund initialized")

	// Show pools
	for _, pool := range pools {
		fmt.Printf("Pool %s: $%.2f / $%.2f cover\n", pool.Asset, pool.Balance, pool.Cover)
	}

	// Submit claim
	claim, err := SubmitClaim("user_01", "BTC", 1.5, "hack")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("Claim: %.2f %s - %s\n", claim.Amount, claim.Asset, claim.Status)
	}

	// Protection levels
	for _, p := range protectionLevels {
		fmt.Printf("%s: $%.0f cover, $%.0f/mo\n", p.Level, p.CoverUSD, p.FeeMonthly)
	}
}