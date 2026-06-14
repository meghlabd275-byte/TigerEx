// TigerEx Insurance Fund - SAFU-Style Protection
// Go-based insurance fund for protecting users

package main

import (
	"fmt"
	"sync"
	"time"
)

type InsuranceFund struct {
	mu           sync.RWMutex
	Reserves     map[string]float64  // Asset -> amount
	TotalValueUSD float64
	Claims       []Claim
	Events       []FundEvent
}

type Claim struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Asset       string    `json:"asset"`
	Amount      float64   `json:"amount"`
	Reason      string    `json:"reason"`
	Status      string    `json:"status"` // pending, approved, rejected, paid
	ApprovedBy  string    `json:"approvedBy,omitempty"`
	AmountPaid  float64   `json:"amountPaid"`
	CreatedAt   int64     `json:"createdAt"`
	ProcessedAt int64     `json:"processedAt,omitempty"`
}

type FundEvent struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"` // deposit, claim, allocation
	Amount    float64   `json:"amount"`
	Asset     string    `json:"asset"`
	CreatedAt int64     `json:"createdAt"`
}

func NewInsuranceFund() *InsuranceFund {
	return &InsuranceFund{
		Reserves: map[string]float64{
			"USDT": 100000000,  // $100M initial
			"BTC": 1000,           // ~$50M
			"ETH": 10000,          // ~$30M
		},
		TotalValueUSD: 180000000,
		Claims:   []Claim{},
		Events:   []FundEvent{},
	}
}

func (f *InsuranceFund) GetReserves() map[string]float64 {
	f.mu.RLock()
	defer f.mu.RUnlock()
	reserves := make(map[string]float64)
	for k, v := range f.Reserves {
		reserves[k] = v
	}
	return reserves
}

func (f *InsuranceFund) Deposit(asset string, amount float64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	
	f.Reserves[asset] += amount
	if asset == "USDT" {
		f.TotalValueUSD += amount
	}
	
	f.Events = append(f.Events, FundEvent{
		ID: fmt.Sprintf("evt_%d", time.Now().UnixMilli()),
		Type: "deposit",
		Amount: amount,
		Asset: asset,
		CreatedAt: time.Now().UnixMilli(),
	})
}

func (f *InsuranceFund) SubmitClaim(userID, asset string, amount float64, reason string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	
	claim := Claim{
		ID:        fmt.Sprintf("claim_%d", time.Now().UnixMilli()),
		UserID:    userID,
		Asset:    asset,
		Amount:   amount,
		Reason:   reason,
		Status:   "pending",
		CreatedAt: time.Now().UnixMilli(),
	}
	
	f.Claims = append(f.Claims, claim)
	return claim.ID
}

func (f *InsuranceFund) ApproveClaim(claimID, approvedBy string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	
	for i := range f.Claims {
		if f.Claims[i].ID == claimID && f.Claims[i].Status == "pending" {
			f.Claims[i].Status = "approved"
			f.Claims[i].ApprovedBy = approvedBy
			return nil
		}
	}
	return fmt.Errorf("claim not found")
}

func (f *InsuranceFund) ProcessClaim(claimID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	
	for i := range f.Claims {
		if f.Claims[i].ID == claimID && f.Claims[i].Status == "approved" {
			asset := f.Claims[i].Asset
			amount := f.Claims[i].Amount
			
			if f.Reserves[asset] < amount {
				return fmt.Errorf("insufficient reserves")
			}
			
			f.Reserves[asset] -= amount
			f.Claims[i].Status = "paid"
			f.Claims[i].AmountPaid = amount
			f.Claims[i].ProcessedAt = time.Now().UnixMilli()
			
			if asset == "USDT" {
				f.TotalValueUSD -= amount
			}
			return nil
		}
	}
	return fmt.Errorf("claim not found or not approved")
}

func (f *InsuranceFund) GetStats() map[string]interface{} {
	f.mu.RLock()
	defer f.mu.RUnlock()
	
	pendingClaims := 0
	paidClaims := 0
	for _, c := range f.Claims {
		if c.Status == "pending" || c.Status == "approved" {
			pendingClaims++
		} else if c.Status == "paid" {
			paidClaims++
		}
	}
	
	return map[string]interface{}{
		"totalReservesUSD": f.TotalValueUSD,
		"reserves":         f.Reserves,
		"pendingClaims":    pendingClaims,
		"paidClaims":       paidClaims,
		"totalEvents":      len(f.Events),
	}
}

func main() {
	fmt.Println("TigerEx Insurance Fund v1.0.0")
	
	fund := NewInsuranceFund()
	
	// Simulate deposits
	fund.Deposit("USDT", 10000000) // Add $10M
	fund.Deposit("BTC", 100)        // Add 100 BTC
	
	// Submit claim
	claimID := fund.SubmitClaim("user123", "USDT", 50000, "Hacked account")
	fmt.Printf("Claim submitted: %s\n", claimID)
	
	// Approve and process
	fund.ApproveClaim(claimID, "admin")
	fund.ProcessClaim(claimID)
	
	// Get stats
	stats := fund.GetStats()
	fmt.Printf("Fund Stats: %+v\n", stats)
}