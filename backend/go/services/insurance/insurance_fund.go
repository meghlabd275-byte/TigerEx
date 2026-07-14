// TigerEx Insurance Fund Service
// SAFU-style protection fund for users

package insurance

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusRejected = "rejected"
	StatusPaid    = "paid"
	StatusClosed   = "closed"

	CauseHacking      = "hacking"
	CauseExploit     = "exploit"
	CauseTechnical   = "technical"
	CauseFraud       = "fraud"
	CauseLiquidate   = "liquidation"
)

type InsuranceFund struct {
	TotalBalance    float64   `json:"total_balance"`
	USDTBalance    float64   `json:"usdt_balance"`
	BTCBalance     float64   `json:"btc_balance"`
	ETHBalance     float64   `json:"eth_balance"`
	TotalCovered   float64   `json:"total_covered"`
	TotalClaims    int       `json:"total_claims"`
	ApprovedClaims int       `json:"approved_claims"`
	LastUpdated    time.Time `json:"last_updated"`
}

type Claim struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	OrderID      string    `json:"order_id"`
	Amount        float64   `json:"amount"`
	Currency      string    `json:"currency"`
	Cause         string    `json:"cause"`
	Description   string    `json:"description"`
	Evidence      []string  `json:"evidence"`
	Status        string    `json:"status"`
	ApprovedAmount float64  `json:"approved_amount"`
	ReviewerID   string    `json:"reviewer_id"`
	ReviewNotes   string    `json:"review_notes"`
	PaidAt        time.Time `json:"paid_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type CoverageRule struct {
	ID              string    `json:"id"`
	Asset          string    `json:"asset"`
	MinAmount       float64   `json:"min_amount"`
	MaxCoverage     float64   `json:"max_coverage"`
	CoveragePercent float64   `json:"coverage_percent"`
	WaitingPeriod   int       `json:"waiting_period_hours"`
	Active          bool      `json:"active"`
}

type InsuranceManager struct {
	mu          sync.RWMutex
	fund        *InsuranceFund
	claims      map[string]*Claim
	userClaims  map[string][]string
	rules      map[string]*CoverageRule
}

func NewInsuranceManager() *InsuranceManager {
	im := &InsuranceManager{
		fund: &InsuranceFund{
			TotalBalance:    0,
			USDTBalance:    0,
			BTCBalance:     0,
			ETHBalance:     0,
			TotalCovered:   0,
			TotalClaims:    0,
			ApprovedClaims: 0,
			LastUpdated:    time.Now(),
		},
		claims:     make(map[string]*Claim),
		userClaims: make(map[string][]string),
		rules:     make(map[string]*CoverageRule),
	}
	im.initializeRules()
	return im
}

func (im *InsuranceManager) initializeRules() {
	rules := []*CoverageRule{
		{ID: "USDT", Asset: "USDT", MinAmount: 10, MaxCoverage: 100000, CoveragePercent: 100, WaitingPeriod: 24, Active: true},
		{ID: "BTC", Asset: "BTC", MinAmount: 0.001, MaxCoverage: 2, CoveragePercent: 100, WaitingPeriod: 24, Active: true},
		{ID: "ETH", Asset: "ETH", MinAmount: 0.01, MaxCoverage: 20, CoveragePercent: 100, WaitingPeriod: 24, Active: true},
		{ID: "BNB", Asset: "BNB", MinAmount: 0.1, MaxCoverage: 200, CoveragePercent: 100, WaitingPeriod: 24, Active: true},
		{ID: "GENERAL", Asset: "*", MinAmount: 0, MaxCoverage: 10000, CoveragePercent: 50, WaitingPeriod: 48, Active: true},
	}

	for _, r := range rules {
		im.rules[r.ID] = r
	}
}

func (im *InsuranceManager) GetFund() *InsuranceFund {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.fund
}

func (im *InsuranceManager) Deposit(amount float64, currency string) error {
	im.mu.Lock()
	defer im.mu.Unlock()

	if amount <= 0 {
		return errors.New("invalid amount")
	}

	switch currency {
	case "USDT":
		im.fund.USDTBalance += amount
	case "BTC":
		im.fund.BTCBalance += amount
	case "ETH":
		im.fund.ETHBalance += amount
	default:
		return errors.New("unsupported currency")
	}

	im.fund.TotalBalance += amount
	im.fund.LastUpdated = time.Now()

	return nil
}

func (im *InsuranceManager) Withdraw(amount float64, currency string, adminID string) error {
	im.mu.Lock()
	defer im.mu.Unlock()

	if amount <= 0 {
		return errors.New("invalid amount")
	}

	var available float64
	switch currency {
	case "USDT":
		available = im.fund.USDTBalance
	case "BTC":
		available = im.fund.BTCBalance
	case "ETH":
		available = im.fund.ETHBalance
	default:
		return errors.New("unsupported currency")
	}

	if available < amount {
		return errors.New("insufficient fund balance")
	}

	switch currency {
	case "USDT":
		im.fund.USDTBalance -= amount
	case "BTC":
		im.fund.BTCBalance -= amount
	case "ETH":
		im.fund.ETHBalance -= amount
	}

	im.fund.TotalBalance -= amount
	im.fund.LastUpdated = time.Now()

	return nil
}

func (im *InsuranceManager) SubmitClaim(userID, orderID, amount, currency, cause, description string, evidence []string) (*Claim, error) {
	im.mu.Lock()
	defer im.mu.Unlock()

	if amount <= 0 {
		return nil, errors.New("invalid amount")
	}

	// Validate cause
	validCauses := []string{CauseHacking, CauseExploit, CauseTechnical, CauseFraud, CauseLiquidate}
	valid := false
	for _, c := range validCauses {
		if cause == c {
			valid = true
			break
		}
	}
	if !valid {
		return nil, errors.New("invalid cause")
	}

	rule := im.getCoverageRule(currency)
	if rule == nil {
		return nil, errors.New("no coverage rule for this asset")
	}

	if amount < rule.MinAmount {
		return nil, fmt.Errorf("minimum claim amount is %f", rule.MinAmount)
	}

	now := time.Now()
	claim := &Claim{
		ID:           fmt.Sprintf("CLM%d%d", now.Unix(), now.Nanosecond()),
		UserID:       userID,
		OrderID:     orderID,
		Amount:       amount,
		Currency:     currency,
		Cause:       cause,
		Description: description,
		Evidence:    evidence,
		Status:      StatusPending,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	im.claims[claim.ID] = claim
	im.userClaims[userID] = append(im.userClaims[userID], claim.ID)
	im.fund.TotalClaims++

	return claim, nil
}

func (im *InsuranceManager) getCoverageRule(asset string) *CoverageRule {
	// First try exact match
	if rule, ok := im.rules[asset]; ok && rule.Active {
		return rule
	}
	// Fall back to general rule
	return im.rules["GENERAL"]
}

func (im *InsuranceManager) ReviewClaim(claimID, reviewerID, decision, notes string, approvedAmount float64) error {
	im.mu.Lock()
	defer im.mu.Unlock()

	claim, exists := im.claims[claimID]
	if !exists {
		return errors.New("claim not found")
	}

	if claim.Status != StatusPending {
		return errors.New("claim already reviewed")
	}

	claim.ReviewerID = reviewerID
	claim.ReviewNotes = notes
	claim.UpdatedAt = time.Now()

	if decision == "approve" {
		claim.Status = StatusApproved
		claim.ApprovedAmount = approvedAmount
		im.fund.ApprovedClaims++
	} else if decision == "reject" {
		claim.Status = StatusRejected
	}

	return nil
}

func (im *InsuranceManager) PayClaim(claimID string) error {
	im.mu.Lock()
	defer im.mu.Unlock()

	claim, exists := im.claims[claimID]
	if !exists {
		return errors.New("claim not found")
	}

	if claim.Status != StatusApproved {
		return errors.New("claim not approved")
	}

	// Check fund balance
	if claim.Currency == "USDT" && im.fund.USDTBalance < claim.ApprovedAmount {
		return errors.New("insufficient fund balance")
	}

	// Deduct from fund
	switch claim.Currency {
	case "USDT":
		im.fund.USDTBalance -= claim.ApprovedAmount
	case "BTC":
		im.fund.BTCBalance -= claim.ApprovedAmount
	case "ETH":
		im.fund.ETHBalance -= claim.ApprovedAmount
	}

	im.fund.TotalBalance -= claim.ApprovedAmount
	im.fund.TotalCovered += claim.ApprovedAmount

	claim.Status = StatusPaid
	claim.PaidAt = time.Now()
	claim.UpdatedAt = time.Now()
	im.fund.LastUpdated = time.Now()

	return nil
}

func (im *InsuranceManager) GetClaim(claimID string) (*Claim, error) {
	im.mu.RLock()
	defer im.mu.RUnlock()

	claim, exists := im.claims[claimID]
	if !exists {
		return nil, errors.New("claim not found")
	}
	return claim, nil
}

func (im *InsuranceManager) GetUserClaims(userID string) []*Claim {
	im.mu.RLock()
	defer im.mu.RUnlock()

	claimIDs := im.userClaims[userID]
	claims := make([]*Claim, 0, len(claimIDs))
	for _, id := range claimIDs {
		if claim, exists := im.claims[id]; exists {
			claims = append(claims, claim)
		}
	}
	return claims
}

func (im *InsuranceManager) GetPendingClaims() []*Claim {
	im.mu.RLock()
	defer im.mu.RUnlock()

	var claims []*Claim
	for _, claim := range im.claims {
		if claim.Status == StatusPending {
			claims = append(claims, claim)
		}
	}
	return claims
}

func (im *InsuranceManager) GetCoverageRules() []*CoverageRule {
	im.mu.RLock()
	defer im.mu.RUnlock()

	rules := make([]*CoverageRule, 0, len(im.rules))
	for _, r := range im.rules {
		rules = append(rules, r)
	}
	return rules
}

func (im *InsuranceManager) CalculateCoverage(amount float64, currency string) (float64, error) {
	im.mu.RLock()
	defer im.mu.RUnlock()

	rule := im.getCoverageRule(currency)
	if rule == nil {
		return 0, errors.New("no coverage rule for this asset")
	}

	if amount < rule.MinAmount {
		return 0, nil
	}

	coverage := amount * rule.CoveragePercent / 100
	if coverage > rule.MaxCoverage {
		coverage = rule.MaxCoverage
	}

	return coverage, nil
}

func (im *InsuranceManager) GetFundStats() map[string]interface{} {
	im.mu.RLock()
	defer im.mu.RUnlock()

	return map[string]interface{}{
		"total_balance":    im.fund.TotalBalance,
		"usdt_balance":    im.fund.USDTBalance,
		"btc_balance":     im.fund.BTCBalance,
		"eth_balance":     im.fund.ETHBalance,
		"total_covered":   im.fund.TotalCovered,
		"total_claims":    im.fund.TotalClaims,
		"approved_claims":  im.fund.ApprovedClaims,
		"claim_approval_rate": float64(im.fund.ApprovedClaims) / float64(im.fund.TotalClaims) * 100,
	}
}
