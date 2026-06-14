package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// INSURANCE FUND
// SAFU-style insurance fund to protect users from hacks and system failures
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// Fund represents the insurance fund
type Fund struct {
	Name          string
	TotalBalance  float64
	ReserveRatio float64 // Target reserve ratio (e.g., 0.1 = 10%)
	
	// Claims
	TotalClaimsPaid  float64
	ClaimsCount   int64
	
	// Assets
	CoveredAssets map[string]bool
	
	// Statistics
	TotalDeposits  float64
	TotalClaims float64
	
	mu sync.RWMutex
}

// InsuranceClaim represents a claim
type InsuranceClaim struct {
	ID          string
	UserID      string
	Amount      float64
	Asset      string
	Reason     string
	Status     ClaimStatus
	ApprovedAt *time.Time
	PaidAt    *time.Time
	CreatedAt  time.Time
	ResolvedAt *time.Time
}

// ClaimStatus represents claim status
type ClaimStatus string

const (
	ClaimStatusPending   ClaimStatus = "PENDING"
	ClaimStatusApproved ClaimStatus = "APPROVED"
	ClaimStatusRejected ClaimStatus = "REJECTED"
	ClaimStatusPaid    ClaimStatus = "PAID"
)

// ============================================================================
// SERVICE
// ============================================================================

// Service manages the insurance fund
type Service struct {
	fund *Fund
	
	mu        sync.RWMutex
	claims   map[string]*InsuranceClaim
	claimCounter int64
}

// NewService creates insurance fund service
func NewService(initialBalance float64) *Service {
	return &Service{
		fund: &Fund{
			Name:          "TigerEx SAFU Insurance Fund",
			TotalBalance:  initialBalance,
			ReserveRatio:  0.1, // 10%
			CoveredAssets: initCoveredAssets(),
		},
		claims: make(map[string]*InsuranceClaim),
	}
}

func initCoveredAssets() map[string]bool {
	return map[string]bool{
		"USDT": true,
		"USDC": true,
		"BTC":  true,
		"ETH":  true,
		"BNB":  true,
	}
}

// ============================================================================
// FUND MANAGEMENT
// ============================================================================

// Deposit adds funds to the insurance pool
func (s *Service) Deposit(amount float64) {
	s.fund.mu.Lock()
	defer s.fund.mu.Unlock()
	
	s.fund.TotalBalance += amount
	s.fund.TotalDeposits += amount
}

// Withdraw removes funds from the pool (emergency use only)
func (s *Service) Withdraw(amount float64) error {
	s.fund.mu.Lock()
	defer s.fund.mu.Unlock()
	
	if amount > s.fund.TotalBalance {
		return fmt.Errorf("insufficient funds")
	}
	
	s.fund.TotalBalance -= amount
	return nil
}

// GetBalance returns current fund balance
func (s *Service) GetBalance() float64 {
	s.fund.mu.RLock()
	defer s.fund.mu.RUnlock()
	return s.fund.TotalBalance
}

// GetCoverage returns max coverage for an asset
func (s *Service) GetCoverage(asset string, userBalance float64) float64 {
	s.fund.mu.RLock()
	defer s.fund.mu.RUnlock()
	
	// Check if asset is covered
	if !s.fund.CoveredAssets[asset] {
		return 0
	}
	
	// Calculate coverage based on fund size
	// Generally covers up to 50% of fund reserves per user
	maxCoverage := s.fund.TotalBalance * 0.5
	
	// Cap at user's actual balance or a maximum (e.g., $50,000)
	if userBalance < maxCoverage {
		return userBalance
	}
	
	return maxCoverage
}

// ============================================================================
// CLAIMS MANAGEMENT
// ============================================================================

// CreateClaim creates a new insurance claim
func (s *Service) CreateClaim(userID, asset string, amount float64, reason string) (*InsuranceClaim, error) {
	s.fund.mu.RLock()
	
	// Check if asset is covered
	if !s.fund.CoveredAssets[asset] {
		s.fund.mu.RUnlock()
		return nil, fmt.Errorf("asset not covered")
	}
	
	// Check coverage
	maxCoverage := s.fund.TotalBalance * 0.5
	if amount > maxCoverage {
		s.fund.mu.RUnlock()
		return nil, fmt.Errorf("claim exceeds coverage")
	}
	
	s.fund.mu.RUnlock()
	
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.claimCounter++
	claim := &InsuranceClaim{
		ID:        fmt.Sprintf("CLM%d%08d", time.Now().Unix(), s.claimCounter),
		UserID:    userID,
		Amount:    amount,
		Asset:    asset,
		Reason:   reason,
		Status:   ClaimStatusPending,
		CreatedAt: time.Now(),
	}
	
	s.claims[claim.ID] = claim
	return claim, nil
}

// ApproveClaim approves a claim
func (s *Service) ApproveClaim(claimID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	claim, ok := s.claims[claimID]
	if !ok {
		return fmt.Errorf("claim not found")
	}
	
	if claim.Status != ClaimStatusPending {
		return fmt.Errorf("invalid claim status")
	}
	
	now := time.Now()
	claim.Status = ClaimStatusApproved
	claim.ApprovedAt = &now
	
	return nil
}

// RejectClaim rejects a claim
func (s *Service) RejectClaim(claimID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	claim, ok := s.claims[claimID]
	if !ok {
		return fmt.Errorf("claim not found")
	}
	
	now := time.Now()
	claim.Status = ClaimStatusRejected
	claim.Reason = reason
	claim.ResolvedAt = &now
	
	return nil
}

// PayClaim pays an approved claim
func (s *Service) PayClaim(claimID string) error {
	s.mu.Lock()
	claim, ok := s.claims[claimID]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("claim not found")
	}
	
	if claim.Status != ClaimStatusApproved {
		s.mu.Unlock()
		return fmt.Errorf("claim not approved")
	}
	s.mu.Unlock()
	
	// Check fund balance
	s.fund.mu.Lock()
	if claim.Amount > s.fund.TotalBalance {
		s.fund.mu.Unlock()
		return fmt.Errorf("insufficient fund balance")
	}
	s.fund.TotalBalance -= claim.Amount
	s.fund.TotalClaimsPaid += claim.Amount
	s.fund.TotalClaims++
	s.fund.mu.Unlock()
	
	// Update claim
	s.mu.Lock()
	now := time.Now()
	claim.Status = ClaimStatusPaid
	claim.PaidAt = &now
	claim.ResolvedAt = &now
	s.mu.Unlock()
	
	return nil
}

// GetClaim gets a claim by ID
func (s *Service) GetClaim(claimID string) (*InsuranceClaim, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	claim, ok := s.claims[claimID]
	if !ok {
		return nil, fmt.Errorf("claim not found")
	}
	
	return claim, nil
}

// GetUserClaims gets all claims for a user
func (s *Service) GetUserClaims(userID string) []*InsuranceClaim {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*InsuranceClaim
	for _, claim := range s.claims {
		if claim.UserID == userID {
			result = append(result, claim)
		}
	}
	
	return result
}

// ============================================================================
// STATISTICS
// ============================================================================

// GetStatistics returns fund statistics
func (s *Service) GetStatistics() map[string]interface{} {
	s.fund.mu.RLock()
	defer s.fund.mu.RUnlock()
	
	return map[string]interface{}{
		"total_balance":    s.fund.TotalBalance,
		"total_claims":   s.fund.TotalClaimsPaid,
		"claims_count":   s.fund.ClaimsCount,
		"total_deposits": s.fund.TotalDeposits,
		"reserve_ratio":  s.fund.ReserveRatio,
	}
}

// ============================================================================
// HELPER
// ============================================================================

func hashUser(userID, asset, amount string) string {
	data := fmt.Sprintf("%s:%s:%s:%d", userID, asset, amount, time.Now().Unix())
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// ============================================================================
// EXAMPLE
// ============================================================================

func main() {
	fmt.Println("TigerEx Insurance Fund v1.0.0")
	
	// Create service with initial capital
	insurance := NewService(100_000_000) // $100M initial
	
	// Add contributions
	insurance.Deposit(10_000_000) // $10M from trading fees
	
	fmt.Printf("Fund Balance: $%.2f\n", insurance.GetBalance())
	
	// Create a claim
	claim, err := insurance.CreateClaim("user123", "BTC", 2.5, "Hacked account")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	fmt.Printf("Created claim: %s\n", claim.ID)
	
	// Approve and pay
	insurance.ApproveClaim(claim.ID)
	insurance.PayClaim(claim.ID)
	
	fmt.Printf("Claim Status: %s\n", claim.Status)
	fmt.Printf("Fund Balance After: $%.2f\n", insurance.GetBalance())
}