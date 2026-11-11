package kyc_aml

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// KYCLevel represents the KYC verification level
type KYCLevel string

const (
	KYCLevelBasic         KYCLevel = "BASIC"         // Email + phone verification
	KYCLevelStandard      KYCLevel = "STANDARD"      // ID document verification
	KYCLevelEnhanced      KYCLevel = "ENHANCED"      // ID + proof of address + facial recognition
	KYCLevelInstitutional KYCLevel = "INSTITUTIONAL" // Full KYB + enhanced due diligence
)

// VerificationStatus represents the status of a verification
type VerificationStatus string

const (
	VerificationStatusPending  VerificationStatus = "PENDING"
	VerificationStatusInReview VerificationStatus = "IN_REVIEW"
	VerificationStatusApproved VerificationStatus = "APPROVED"
	VerificationStatusRejected VerificationStatus = "REJECTED"
	VerificationStatusExpired  VerificationStatus = "EXPIRED"
)

// DocumentType represents the type of identity document
type DocumentType string

const (
	DocumentTypePassport        DocumentType = "PASSPORT"
	DocumentTypeNationalID      DocumentType = "NATIONAL_ID"
	DocumentTypeDriverLicense   DocumentType = "DRIVER_LICENSE"
	DocumentTypeResidencePermit DocumentType = "RESIDENCE_PERMIT"
)

// KYCProfile represents a user's KYC profile
type KYCProfile struct {
	UserID             string             `json:"user_id"`
	Level              KYCLevel           `json:"level"`
	Status             VerificationStatus `json:"status"`
	FirstName          string             `json:"first_name"`
	LastName           string             `json:"last_name"`
	DateOfBirth        string             `json:"date_of_birth"`
	Nationality        string             `json:"nationality"`
	CountryOfResidence string             `json:"country_of_residence"`
	Address            *Address           `json:"address,omitempty"`
	Document           *IdentityDocument  `json:"document,omitempty"`
	IsPEP              bool               `json:"is_pep"` // Politically Exposed Person
	IsSanctioned       bool               `json:"is_sanctioned"`
	IsHighRisk         bool               `json:"is_high_risk"`
	RiskScore          int                `json:"risk_score"`
	VerificationDate   *time.Time         `json:"verification_date,omitempty"`
	ExpiryDate         *time.Time         `json:"expiry_date,omitempty"`
	LastReviewDate     time.Time          `json:"last_review_date"`
	FailedAttempts     int                `json:"failed_attempts"`
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
}

// Address represents a physical address
type Address struct {
	Street     string `json:"street"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postal_code"`
	Country    string `json:"country"`
}

// IdentityDocument represents an identity document
type IdentityDocument struct {
	Type           DocumentType `json:"type"`
	Number         string       `json:"number"`
	ExpiryDate     string       `json:"expiry_date"`
	IssuedDate     string       `json:"issued_date"`
	Country        string       `json:"country"`
	FrontImage     string       `json:"front_image"`  // Base64 encoded
	BackImage      string       `json:"back_image"`   // Base64 encoded (if applicable)
	SelfieImage    string       `json:"selfie_image"` // Base64 encoded
	LivenessCheck  bool         `json:"liveness_check"`
	IsVerified     bool         `json:"is_verified"`
	VerificationID string       `json:"verification_id,omitempty"`
}

// AMLCheck represents an AML screening result
type AMLCheck struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	CheckType   string     `json:"check_type"`           // SANCTIONS, PEP, ADVERSE_MEDIA, COMPLIANCE
	Status      string     `json:"status"`               // PASS, FAIL, REVIEW, PENDING
	MatchType   string     `json:"match_type,omitempty"` // EXACT, PARTIAL, FUZZY
	MatchName   string     `json:"match_name,omitempty"`
	MatchSource string     `json:"match_source,omitempty"`
	Severity    string     `json:"severity"` // HIGH, MEDIUM, LOW, NONE
	Details     string     `json:"details,omitempty"`
	Resolved    bool       `json:"resolved"`
	ResolvedBy  string     `json:"resolved_by,omitempty"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// TransactionMonitor monitors transactions for AML compliance
type TransactionMonitor struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	TransactionID string     `json:"transaction_id"`
	Amount        float64    `json:"amount"`
	Currency      string     `json:"currency"`
	Asset         string     `json:"asset"`
	Type          string     `json:"type"` // DEPOSIT, WITHDRAWAL, TRADE
	RiskScore     int        `json:"risk_score"`
	Flags         []string   `json:"flags"`  // STRUCTURING, ROUND_AMOUNT, HIGH_RISK_COUNTRY, etc.
	Status        string     `json:"status"` // CLEARED, REVIEW, BLOCKED
	ReviewNotes   string     `json:"review_notes,omitempty"`
	ReviewedBy    string     `json:"reviewed_by,omitempty"`
	ReviewedAt    *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// SARReport represents a Suspicious Activity Report
type SARReport struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id"`
	Type         string     `json:"type"` // SUSPICIOUS_TRANSACTION, SUSPICIOUS_BEHAVIOR, TERRORISM_FINANCING
	Description  string     `json:"description"`
	Evidence     []string   `json:"evidence"` // List of evidence IDs
	Status       string     `json:"status"`   // DRAFT, SUBMITTED, UNDER_REVIEW, CLOSED
	SubmittedBy  string     `json:"submitted_by"`
	SubmittedAt  time.Time  `json:"submitted_at"`
	ClosedAt     *time.Time `json:"closed_at,omitempty"`
	ClosureNotes string     `json:"closure_notes,omitempty"`
}

// TravelRuleInfo represents Travel Rule information
type TravelRuleInfo struct {
	OriginatorName     string `json:"originator_name"`
	OriginatorAccount  string `json:"originator_account"`
	OriginatorAddress  string `json:"originator_address"`
	BeneficiaryName    string `json:"beneficiary_name"`
	BeneficiaryAccount string `json:"beneficiary_account"`
	BeneficiaryAddress string `json:"beneficiary_address"`
}

// DocumentVerifier is the external identity check the venue must consult before
// it approves a KYC profile. An implementation performs the OCR, liveness and
// face-match against real providers; the service never decides approval itself.
type DocumentVerifier interface {
	// VerifyDocument returns whether the identity document is authentic and
	// matches the profile, and the liveness check on the submitted selfie.
	VerifyDocument(doc *IdentityDocument, profile *KYCProfile) (documentOK bool, livenessOK bool, err error)
}

// AMLScreener runs the sanctions, PEP and adverse-media screening a venue is
// required to perform. It returns the check status (PASS, FAIL, REVIEW), the
// severity and human-readable details for each list.
type AMLScreener interface {
	Screen(userID, checkType string) (status string, severity string, details string, err error)
}

// KYCService handles KYC/AML operations
type KYCService struct {
	mu           sync.RWMutex
	profiles     map[string]*KYCProfile           // userID -> profile
	amlChecks    map[string][]*AMLCheck           // userID -> checks
	transactions map[string][]*TransactionMonitor // userID -> transactions
	sarReports   map[string][]*SARReport          // userID -> reports
	verifier     DocumentVerifier
	screener     AMLScreener
}

// NewKYCService creates a KYC service with no verifier. Document verification
// and AML screening fail closed until a real verifier and screener are supplied
// through SetVerifier/SetScreener, so a deployment can never approve a profile
// on the strength of an unverified upload.
func NewKYCService() *KYCService {
	return &KYCService{
		profiles:     make(map[string]*KYCProfile),
		amlChecks:    make(map[string][]*AMLCheck),
		transactions: make(map[string][]*TransactionMonitor),
		sarReports:   make(map[string][]*SARReport),
	}
}

// SetVerifier installs the document/liveness verifier. Passing nil disables
// verification and makes approval fail closed again.
func (s *KYCService) SetVerifier(v DocumentVerifier) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.verifier = v
}

// SetScreener installs the AML screener. Passing nil disables screening and
// makes every check report PENDING rather than a fabricated PASS.
func (s *KYCService) SetScreener(scr AMLScreener) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.screener = scr
}

// InitiateKYC initiates KYC verification for a user
func (s *KYCService) InitiateKYC(userID, firstName, lastName, dateOfBirth, nationality, country string) (*KYCProfile, error) {
	profile, err := s.createProfile(userID, firstName, lastName, dateOfBirth, nationality, country)
	if err != nil {
		return nil, err
	}

	// Screen after the profile lock is released: the screener may perform
	// network I/O and must not hold the service lock.
	s.runInitialAMLScreening(userID)

	return profile, nil
}

func (s *KYCService) createProfile(userID, firstName, lastName, dateOfBirth, nationality, country string) (*KYCProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if user already has a profile
	if _, exists := s.profiles[userID]; exists {
		return nil, errors.New("KYC profile already exists")
	}

	profile := &KYCProfile{
		UserID:             userID,
		Level:              KYCLevelBasic,
		Status:             VerificationStatusPending,
		FirstName:          firstName,
		LastName:           lastName,
		DateOfBirth:        dateOfBirth,
		Nationality:        nationality,
		CountryOfResidence: country,
		IsPEP:              false,
		IsSanctioned:       false,
		IsHighRisk:         false,
		RiskScore:          0,
		LastReviewDate:     time.Now(),
		FailedAttempts:     0,
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}

	s.profiles[userID] = profile

	return profile, nil
}

// SubmitDocument submits identity document for verification
func (s *KYCService) SubmitDocument(userID string, doc *IdentityDocument) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, exists := s.profiles[userID]
	if !exists {
		return errors.New("KYC profile not found")
	}

	profile.Document = doc
	profile.Status = VerificationStatusInReview
	profile.UpdatedAt = time.Now()

	return nil
}

// VerifyDocument runs the external document and liveness check and approves
// the profile only when that check passes.
//
// It fails closed: with no verifier installed it refuses to approve, a verifier
// error leaves the profile in review, and a negative document or liveness
// result rejects it. Approval is never granted on the strength of an upload.
func (s *KYCService) VerifyDocument(userID string) error {
	s.mu.RLock()
	existing, exists := s.profiles[userID]
	var docCopy *IdentityDocument
	var profileCopy *KYCProfile
	if exists {
		if existing.Document != nil {
			d := *existing.Document
			docCopy = &d
		}
		p := *existing
		profileCopy = &p
	}
	verifier := s.verifier
	s.mu.RUnlock()

	if !exists {
		return errors.New("KYC profile not found")
	}
	if docCopy == nil {
		return errors.New("no document submitted")
	}
	if verifier == nil {
		return errors.New("no document verifier configured; KYC approval is disabled")
	}

	documentOK, livenessOK, err := verifier.VerifyDocument(docCopy, profileCopy)
	if err != nil {
		return fmt.Errorf("document verification failed: %w", err)
	}
	if !documentOK || !livenessOK {
		s.mu.Lock()
		if p, ok := s.profiles[userID]; ok {
			p.Status = VerificationStatusRejected
			p.FailedAttempts++
			p.UpdatedAt = time.Now()
		}
		s.mu.Unlock()
		return errors.New("document verification did not pass")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.profiles[userID]
	if !ok {
		return errors.New("KYC profile not found")
	}
	now := time.Now()
	p.Document.IsVerified = true
	p.Status = VerificationStatusApproved
	p.Level = KYCLevelStandard
	p.VerificationDate = &now
	expiryDate := now.AddDate(1, 0, 0)
	p.ExpiryDate = &expiryDate
	p.UpdatedAt = now

	return nil
}

// runInitialAMLScreening runs the sanctions, PEP and adverse-media checks and
// records their real outcome.
//
// It fails closed: with no screener installed every check is recorded PENDING
// (never a fabricated PASS), and a screener error is recorded as REVIEW so a
// human examines it.
func (s *KYCService) runInitialAMLScreening(userID string) {
	s.mu.RLock()
	screener := s.screener
	s.mu.RUnlock()

	checkTypes := []string{"SANCTIONS", "PEP", "ADVERSE_MEDIA"}
	checks := make([]*AMLCheck, 0, len(checkTypes))
	for _, ct := range checkTypes {
		check := &AMLCheck{
			ID:        generateID(),
			UserID:    userID,
			CheckType: ct,
			Status:    "PENDING",
			Severity:  "NONE",
			CreatedAt: time.Now(),
		}
		if screener != nil {
			status, severity, details, err := screener.Screen(userID, ct)
			if err != nil {
				check.Status = "REVIEW"
				check.Severity = "MEDIUM"
				check.Details = err.Error()
			} else {
				check.Status = status
				check.Severity = severity
				check.Details = details
			}
		}
		checks = append(checks, check)
	}

	s.mu.Lock()
	s.amlChecks[userID] = checks
	s.mu.Unlock()
}

// ScreenTransaction screens a transaction for AML compliance
// ScreenTransaction scores a transaction for AML risk and records it.
//
// The score is driven by real signals: high value, a round amount just under
// the reporting threshold, and structuring (several sub-threshold transactions
// inside a short window). A structuring pattern raises the status to REVIEW
// rather than clearing it, since deliberately splitting a payment to stay
// below the reporting limit is itself suspicious.
func (s *KYCService) ScreenTransaction(tx *TransactionMonitor) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx.ID = generateID()
	tx.Status = "CLEARED"
	tx.RiskScore = 0
	tx.Flags = []string{}
	tx.CreatedAt = time.Now()

	const reportingThreshold = 10000.0
	if tx.Amount >= reportingThreshold {
		tx.RiskScore += 20
		tx.Flags = append(tx.Flags, "HIGH_VALUE")
	}

	// A round amount just under the reporting threshold is a classic structuring
	// tell.
	if tx.Amount > 0 && tx.Amount < reportingThreshold && tx.Amount >= reportingThreshold*0.9 {
		tx.RiskScore += 15
		tx.Flags = append(tx.Flags, "NEAR_THRESHOLD")
	}

	// Velocity: count the user's other sub-threshold transactions in the last 24h
	// whose combined value crosses the reporting threshold.
	windowStart := tx.CreatedAt.Add(-24 * time.Hour)
	var recentTotal float64
	var recentCount int
	for _, prev := range s.transactions[tx.UserID] {
		if prev.CreatedAt.After(windowStart) && prev.Amount < reportingThreshold {
			recentTotal += prev.Amount
			recentCount++
		}
	}
	structuring := false
	if recentCount >= 3 && recentTotal+tx.Amount >= reportingThreshold {
		tx.RiskScore += 40
		tx.Flags = append(tx.Flags, "STRUCTURING")
		structuring = true
	}

	// Structuring is suspicious in its own right, so it always goes to review.
	if tx.RiskScore > 50 || structuring {
		tx.Status = "REVIEW"
	}

	s.transactions[tx.UserID] = append(s.transactions[tx.UserID], tx)

	return nil
}

// GetTransactionMonitor returns transactions for a user
func (s *KYCService) GetTransactionMonitor(userID string) []*TransactionMonitor {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.transactions[userID]
}

// GetAMLCheck returns AML checks for a user
func (s *KYCService) GetAMLCheck(userID string) []*AMLCheck {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.amlChecks[userID]
}

// GetKYCProfile returns KYC profile for a user
func (s *KYCService) GetKYCProfile(userID string) (*KYCProfile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	profile, exists := s.profiles[userID]
	if !exists {
		return nil, errors.New("KYC profile not found")
	}

	return profile, nil
}

// UpgradeKYC upgrades KYC level
// UpgradeKYC moves an approved profile to a higher level for re-verification.
//
// The new level is not approved here: the profile goes back to IN_REVIEW and
// requires a passing VerifyDocument (and any level-specific evidence) before it
// is approved again, so an upgrade can never grant a higher limit on an
// unverified profile.
func (s *KYCService) UpgradeKYC(userID string, level KYCLevel) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, exists := s.profiles[userID]
	if !exists {
		return errors.New("KYC profile not found")
	}

	if profile.Status != VerificationStatusApproved {
		return errors.New("KYC must be approved before upgrade")
	}

	profile.Level = level
	profile.Status = VerificationStatusInReview
	profile.VerificationDate = nil
	profile.UpdatedAt = time.Now()

	return nil
}

// CreateSARReport creates a Suspicious Activity Report
func (s *KYCService) CreateSARReport(report *SARReport) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	report.ID = generateID()
	report.Status = "DRAFT"
	report.SubmittedAt = time.Now()

	s.sarReports[report.UserID] = append(s.sarReports[report.UserID], report)

	return nil
}

// SubmitSARReport submits a SAR for review
func (s *KYCService) SubmitSARReport(userID, reportID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var report *SARReport
	for _, r := range s.sarReports[userID] {
		if r.ID == reportID {
			report = r
			break
		}
	}

	if report == nil {
		return errors.New("report not found")
	}

	report.Status = "SUBMITTED"

	return nil
}

// CheckAddress verifies address against sanctions lists
func (s *KYCService) CheckAddress(address *Address) (bool, string) {
	// Simulated check
	// In real implementation, this would check against OFAC, EU, UN sanctions lists

	return true, ""
}

// CheckDocument verifies document against databases
func (s *KYCService) CheckDocument(doc *IdentityDocument) (bool, string) {
	// Simulated check
	// In real implementation, this would verify against document databases

	return true, ""
}

// CalculateRiskScore calculates overall risk score for a user
func (s *KYCService) CalculateRiskScore(userID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	profile := s.profiles[userID]
	if profile == nil {
		return 0
	}

	var score int

	// Check AML flags
	for _, check := range s.amlChecks[userID] {
		switch check.Severity {
		case "HIGH":
			score += 50
		case "MEDIUM":
			score += 25
		case "LOW":
			score += 10
		}
	}

	// Check transaction patterns
	for _, tx := range s.transactions[userID] {
		score += tx.RiskScore
	}

	// Check KYC level
	switch profile.Level {
	case KYCLevelBasic:
		score += 20
	case KYCLevelStandard:
		score += 10
	case KYCLevelEnhanced:
		score += 5
	case KYCLevelInstitutional:
		score += 0
	}

	return score
}

// ValidateTravelRule validates Travel Rule information
func (s *KYCService) ValidateTravelRule(info *TravelRuleInfo) error {
	if info.OriginatorName == "" {
		return errors.New("originator name required")
	}
	if info.OriginatorAccount == "" {
		return errors.New("originator account required")
	}
	if info.BeneficiaryName == "" {
		return errors.New("beneficiary name required")
	}
	if info.BeneficiaryAccount == "" {
		return errors.New("beneficiary account required")
	}
	return nil
}

// GenerateTravelRuleData generates Travel Rule data for a transaction
func (s *KYCService) GenerateTravelRuleData(senderID, receiverID string, amount float64, asset string) (*TravelRuleInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get sender profile
	senderProfile := s.profiles[senderID]
	if senderProfile == nil {
		return nil, errors.New("sender KYC profile not found")
	}

	// Generate Travel Rule data
	info := &TravelRuleInfo{
		OriginatorName:     fmt.Sprintf("%s %s", senderProfile.FirstName, senderProfile.LastName),
		OriginatorAccount:  senderID, // In real implementation, this would be the wallet address
		OriginatorAddress:  senderProfile.Address.Street + ", " + senderProfile.Address.City + ", " + senderProfile.Address.Country,
		BeneficiaryName:    "Beneficiary",
		BeneficiaryAccount: receiverID,
	}

	return info, nil
}

func generateID() string {
	return fmt.Sprintf("KYC_%d_%d", time.Now().UnixNano(), rand.Int63())
}

// HashDocument hashes a document for secure storage
func HashDocument(docNumber string) string {
	h := sha256.Sum256([]byte(docNumber))
	return base64.StdEncoding.EncodeToString(h[:])
}
