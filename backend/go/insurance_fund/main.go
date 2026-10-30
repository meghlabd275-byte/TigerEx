// TigerEx Insurance Fund - SAFU-Style Protection
// Go-based insurance fund for protecting users

package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

type InsuranceFund struct {
	mu            sync.RWMutex
	Reserves      map[string]float64 // Asset -> amount
	TotalValueUSD float64
	Claims        []Claim
	Events        []FundEvent
}

type Claim struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	Asset       string  `json:"asset"`
	Amount      float64 `json:"amount"`
	Reason      string  `json:"reason"`
	Status      string  `json:"status"` // pending, approved, rejected, paid
	ApprovedBy  string  `json:"approvedBy,omitempty"`
	AmountPaid  float64 `json:"amountPaid"`
	CreatedAt   int64   `json:"createdAt"`
	ProcessedAt int64   `json:"processedAt,omitempty"`
}

type FundEvent struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"` // deposit, claim, allocation
	Amount    float64 `json:"amount"`
	Asset     string  `json:"asset"`
	CreatedAt int64   `json:"createdAt"`
}

// NewInsuranceFund returns an empty fund. Reserves are funded from real
// revenue or capital transfers through Deposit; the fund is never seeded with
// placeholder balances that would overstate its coverage.
func NewInsuranceFund() *InsuranceFund {
	return &InsuranceFund{
		Reserves: map[string]float64{},
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

// Deposit credits reserves from real revenue or capital. It rejects an empty
// asset and any non-finite or non-positive amount so a malformed call cannot
// silently inflate the fund's coverage.
func (f *InsuranceFund) Deposit(asset string, amount float64) error {
	if asset == "" {
		return fmt.Errorf("asset must not be empty")
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return fmt.Errorf("deposit amount %v must be finite and positive", amount)
	}

	f.mu.Lock()
	defer f.mu.Unlock()

	f.Reserves[asset] += amount
	if asset == "USDT" {
		f.TotalValueUSD += amount
	}

	f.Events = append(f.Events, FundEvent{
		ID:        fmt.Sprintf("evt_%d", time.Now().UnixMilli()),
		Type:      "deposit",
		Amount:    amount,
		Asset:     asset,
		CreatedAt: time.Now().UnixMilli(),
	})
	return nil
}

func (f *InsuranceFund) SubmitClaim(userID, asset string, amount float64, reason string) string {
	f.mu.Lock()
	defer f.mu.Unlock()

	claim := Claim{
		ID:        fmt.Sprintf("claim_%d", time.Now().UnixMilli()),
		UserID:    userID,
		Asset:     asset,
		Amount:    amount,
		Reason:    reason,
		Status:    "pending",
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
	fmt.Println("Reserves are funded from real revenue via Deposit; the fund starts empty.")
	fund := NewInsuranceFund()
	fmt.Printf("Initial reserves: %+v\n", fund.GetReserves())
}
