// TigerEx KYC Service
// Know Your Customer and AML compliance

package kyc

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	LevelUnverified  = "unverified"
	LevelBasic      = "basic"
	LevelIntermediate = "intermediate"
	LevelAdvanced   = "advanced"

	StatusPending    = "pending"
	StatusSubmitted = "submitted"
	StatusReviewing = "reviewing"
	StatusApproved  = "approved"
	StatusRejected  = "rejected"
	StatusExpired   = "expired"

	DocTypePassport    = "passport"
	DocTypeIDCard      = "id_card"
	DocTypeDriversLicense = "drivers_license"
	DocTypeUtilityBill = "utility_bill"
	DocTypeBankStatement = "bank_statement"
)

type KYCProfile struct {
	UserID         string    `json:"user_id"`
	Level          string    `json:"level"`
	Status         string    `json:"status"`
	SubmittedAt    time.Time `json:"reviewed_at"`
	ApprovedAt     time.Time `json:"approved_at"`
	ExpiresAt      time.Time `json:"expires_at"`
	RejectionReason string   `json:"rejection_reason"`
	BasicVerified  bool      `json:"basic_verified"`
	IntermediateVerified bool `json:"intermediate_verified"`
	AdvancedVerified  bool   `json:"advanced_verified"`
}

type KYCSubmission struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Level         string    `json:"level"`
	DocumentType  string    `json:"document_type"`
	DocumentID    string    `json:"document_id"`
	FirstName     string    `json:"first_name"`
	LastName      string    `json:"last_name"`
	DateOfBirth   string    `json:"date_of_birth"`
	Nationality   string    `json:"nationality"`
	Address       string    `json:"address"`
	City          string    `json:"city"`
	Country       string    `json:"country"`
	PostalCode    string    `json:"postal_code"`
	DocumentFront string    `json:"document_front"`
	DocumentBack  string    `json:"document_back"`
	Selfie        string    `json:"selfie"`
	Status        string    `json:"status"`
	ReviewNotes   string    `json:"review_notes"`
	ReviewedBy    string    `json:"reviewed_by"`
	CreatedAt     time.Time `json:"created_at"`
	ReviewedAt    time.Time `json:"reviewed_at"`
}

type AMLCheck struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	CheckType     string    `json:"check_type"`
	RiskScore     int      `json:"risk_score"`
	RiskLevel     string    `json:"risk_level"`
	Status        string    `json:"status"`
	PEPStatus      string    `json:"pep_status"`
	SanctionsStatus string  `json:"sanctions_status"`
	AdverseMediaStatus string `json:"adverse_media_status"`
	Details       string    `json:"details"`
	CheckedAt     time.Time `json:"checked_at"`
}

type AMLTransaction struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Type         string    `json:"type"`
	Amount       float64   `json:"amount"`
	Currency     string    `json:"currency"`
	Status       string    `json:"status"`
	RiskScore    int      `json:"risk_score"`
	Flags        []string `json:"flags"`
	CreatedAt    time.Time `json:"created_at"`
}

type KYCManager struct {
	mu          sync.RWMutex
	profiles    map[string]*KYCProfile
	submissions map[string]*KYCSubmission
	amlChecks   map[string]*AMLCheck
	amlTransactions map[string]*AMLTransaction
}

func NewKYCManager() *KYCManager {
	return &KYCManager{
		profiles:         make(map[string]*KYCProfile),
		submissions:     make(map[string]*KYCSubmission),
		amlChecks:       make(map[string]*AMLCheck),
		amlTransactions: make(map[string]*AMLTransaction),
	}
}

func (km *KYCManager) CreateProfile(userID string) (*KYCProfile, error) {
	km.mu.Lock()
	defer km.mu.Unlock()

	if _, exists := km.profiles[userID]; exists {
		return nil, errors.New("profile already exists")
	}

	profile := &KYCProfile{
		UserID:    userID,
		Level:     LevelUnverified,
		Status:    StatusPending,
		CreatedAt: time.Now(),
	}

	km.profiles[userID] = profile
	return profile, nil
}

func (km *KYCManager) GetProfile(userID string) (*KYCProfile, error) {
	km.mu.RLock()
	defer km.mu.RUnlock()

	profile, exists := km.profiles[userID]
	if !exists {
		return nil, errors.New("profile not found")
	}
	return profile, nil
}

func (km *KYCManager) SubmitDocuments(userID string, submission *KYCSubmission) (*KYCSubmission, error) {
	km.mu.Lock()
	defer km.mu.Unlock()

	profile, exists := km.profiles[userID]
	if !exists {
		return nil, errors.New("profile not found")
	}

	if profile.Status == StatusApproved {
		return nil, errors.New("profile already verified")
	}

	submission.ID = fmt.Sprintf("KYC%d%d", time.Now().Unix(), time.Now().Nanosecond())
	submission.UserID = userID
	submission.Status = StatusSubmitted
	submission.CreatedAt = time.Now()

	km.submissions[submission.ID] = submission
	profile.Status = StatusSubmitted

	return submission, nil
}

func (km *KYCManager) ReviewSubmission(submissionID, reviewerID, notes, decision string) error {
	km.mu.Lock()
	defer km.mu.Unlock()

	submission, exists := km.submissions[submissionID]
	if !exists {
		return errors.New("submission not found")
	}

	submission.Status = decision
	submission.ReviewNotes = notes
	submission.ReviewedBy = reviewerID
	submission.ReviewedAt = time.Now()

	profile, exists := km.profiles[submission.UserID]
	if !exists {
		return errors.New("profile not found")
	}

	if decision == StatusApproved {
		profile.Status = StatusApproved
		profile.Level = submission.Level
		profile.ApprovedAt = time.Now()
		profile.ExpiresAt = time.Now().Add(365 * 24 * time.Hour)

		switch submission.Level {
		case LevelBasic:
			profile.BasicVerified = true
		case LevelIntermediate:
			profile.BasicVerified = true
			profile.IntermediateVerified = true
		case LevelAdvanced:
			profile.BasicVerified = true
			profile.IntermediateVerified = true
			profile.AdvancedVerified = true
		}
	} else if decision == StatusRejected {
		profile.Status = StatusRejected
		profile.RejectionReason = notes
	}

	return nil
}

func (km *KYCManager) RunAMLCheck(userID, checkType string) (*AMLCheck, error) {
	km.mu.Lock()
	defer km.mu.Unlock()

	now := time.Now()
	amlCheck := &AMLCheck{
		ID:             fmt.Sprintf("AML%d%d", now.Unix(), now.Nanosecond()),
		UserID:        userID,
		CheckType:     checkType,
		RiskScore:     0,
		RiskLevel:     "low",
		Status:        StatusApproved,
		PEPStatus:      "clear",
		SanctionsStatus: "clear",
		CheckedAt:     now,
	}

	// Simulate AML screening
	riskScore := simulateAMLScreen(userID)
	amlCheck.RiskScore = riskScore

	if riskScore > 70 {
		amlCheck.RiskLevel = "high"
		amlCheck.Status = StatusReviewing
	} else if riskScore > 40 {
		amlCheck.RiskLevel = "medium"
	} else {
		amlCheck.RiskLevel = "low"
	}

	km.amlChecks[amlCheck.ID] = amlCheck
	return amlCheck, nil
}

func simulateAMLScreen(userID string) int {
	// Simulate AML screening - in production, integrate with Chainalysis, Elliptic, etc.
	// Return random risk score for demonstration
	hash := 0
	for _, c := range userID {
		hash = hash*31 + int(c)
	}
	return (hash % 100 + 100) % 100
}

func (km *KYCManager) GetAMLCheck(checkID string) (*AMLCheck, error) {
	km.mu.RLock()
	defer km.mu.RUnlock()

	check, exists := km.amlChecks[checkID]
	if !exists {
		return nil, errors.New("AML check not found")
	}
	return check, nil
}

func (km *KYCManager) GetUserAMLChecks(userID string) []*AMLCheck {
	km.mu.RLock()
	defer km.mu.RUnlock()

	var checks []*AMLCheck
	for _, check := range km.amlChecks {
		if check.UserID == userID {
			checks = append(checks, check)
		}
	}
	return checks
}

func (km *KYCManager) CheckTransaction(userID, txType string, amount float64, currency string) (*AMLTransaction, error) {
	km.mu.Lock()
	defer km.mu.Unlock()

	now := time.Now()
	tx := &AMLTransaction{
		ID:        fmt.Sprintf("TX%d%d", now.Unix(), now.Nanosecond()),
		UserID:    userID,
		Type:      txType,
		Amount:    amount,
		Currency:  currency,
		Status:    "approved",
		RiskScore: 0,
		Flags:     []string{},
		CreatedAt: now,
	}

	// Risk assessment
	if amount > 10000 {
		tx.Flags = append(tx.Flags, "large_amount")
		tx.RiskScore += 30
	}

	if txType == "withdrawal" {
		tx.RiskScore += 20
	}

	// Check daily cumulative
	var dailyTotal float64
	for _, t := range km.amlTransactions {
		if t.UserID == userID && t.Type == txType {
			dayDiff := t.CreatedAt.Sub(now).Hours()
			if dayDiff > -24 {
				dailyTotal += t.Amount
			}
		}
	}

	if dailyTotal+amount > 50000 {
		tx.Flags = append(tx.Flags, "daily_limit_exceeded")
		tx.RiskScore += 40
	}

	if tx.RiskScore > 50 {
		tx.Status = "pending_review"
	} else {
		tx.Status = "approved"
	}

	km.amlTransactions[tx.ID] = tx
	return tx, nil
}

func (km *KYCManager) GetTransaction(txID string) (*AMLTransaction, error) {
	km.mu.RLock()
	defer km.mu.RUnlock()

	tx, exists := km.amlTransactions[txID]
	if !exists {
		return nil, errors.New("transaction not found")
	}
	return tx, nil
}

func (km *KYCManager) GetUserTransactions(userID string) []*AMLTransaction {
	km.mu.RLock()
	defer km.mu.RUnlock()

	var txs []*AMLTransaction
	for _, tx := range km.amlTransactions {
		if tx.UserID == userID {
			txs = append(txs, tx)
		}
	}
	return txs
}

func (km *KYCManager) GetRequiredLevel(operation string, amount float64) string {
	switch operation {
	case "deposit":
		if amount > 10000 {
			return LevelIntermediate
		}
		return LevelBasic
	case "withdrawal":
		if amount > 5000 {
			return LevelIntermediate
		}
		return LevelBasic
	case "p2p_trade":
		if amount > 50000 {
			return LevelAdvanced
		} else if amount > 10000 {
			return LevelIntermediate
		}
		return LevelBasic
	default:
		return LevelBasic
	}
}

func (km *KYCManager) VerifyLevel(userID, requiredLevel string) (bool, error) {
	profile, err := km.GetProfile(userID)
	if err != nil {
		return false, err
	}

	if profile.Status != StatusApproved {
		return false, errors.New("profile not approved")
	}

	levelOrder := map[string]int{
		LevelUnverified:    0,
		LevelBasic:        1,
		LevelIntermediate: 2,
		LevelAdvanced:     3,
	}

	userLevel := levelOrder[profile.Level]
	reqLevel := levelOrder[requiredLevel]

	return userLevel >= reqLevel, nil
}

func (km *KYCManager) GetSupportedDocuments() []string {
	return []string{
		DocTypePassport,
		DocTypeIDCard,
		DocTypeDriversLicense,
		DocTypeUtilityBill,
		DocTypeBankStatement,
	}
}

func (km *KYCManager) GetSupportedCountries() []string {
	return []string{
		"US", "GB", "DE", "FR", "ES", "IT", "NL", "BE", "AT", "PT",
		"JP", "KR", "SG", "HK", "AU", "CA", "BR", "IN", "MX", "AE",
	}
}
