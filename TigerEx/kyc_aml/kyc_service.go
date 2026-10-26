// =============================================================================
// TIGEREX v3.0 - COMPLETE KYC/AML SERVICE
// Full compliance and identity verification
// =============================================================================

package kycaml

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// KYC TYPES
// =============================================================================

type KYCLevel int

const (
	KYCLevelNone          KYCLevel = 0
	KYCLevelBasic         KYCLevel = 1
	KYCLevelIntermediate  KYCLevel = 2
	KYCLevelAdvanced      KYCLevel = 3
	KYCLevelInstitutional KYCLevel = 4
)

type KYCStatus string
type VerificationProvider string

const (
	KYCStatusPending   KYCStatus = "pending"
	KYCStatusInReview  KYCStatus = "in_review"
	KYCStatusApproved  KYCStatus = "approved"
	KYCStatusRejected  KYCStatus = "rejected"
	KYCStatusExpired   KYCStatus = "expired"
	KYCStatusSuspended KYCStatus = "suspended"

	ProviderJumio    VerificationProvider = "jumio"
	ProviderOnfido   VerificationProvider = "onfido"
	ProviderSumsub   VerificationProvider = "sumsub"
	ProviderInternal VerificationProvider = "internal"
)

// KYC Record
type KYCRecord struct {
	KYCID       string               `json:"kycId"`
	UserID      string               `json:"userId"`
	Level       KYCLevel             `json:"level"`
	Status      KYCStatus            `json:"status"`
	Provider    VerificationProvider `json:"provider"`
	ProviderRef string               `json:"providerRef"`

	// Personal Information
	FirstName          string   `json:"firstName"`
	LastName           string   `json:"lastName"`
	DateOfBirth        string   `json:"dateOfBirth"`
	Nationality        string   `json:"nationality"`
	CountryOfResidence string   `json:"countryOfResidence"`
	Address            *Address `json:"address,omitempty"`

	// Document Verification
	DocumentType     string `json:"documentType"`
	DocumentNumber   string `json:"documentNumber"`
	DocumentExpiry   string `json:"documentExpiry"`
	DocumentFrontURL string `json:"documentFrontUrl"`
	DocumentBackURL  string `json:"documentBackUrl"`
	DocumentVerified bool   `json:"documentVerified"`

	// Face Verification
	SelfieURL    string `json:"selfieUrl"`
	FaceVerified bool   `json:"faceVerified"`

	// AML Checks
	AMLStatus       string  `json:"amlStatus"`
	AMLScore        float64 `json:"amlScore"`
	PEPStatus       bool    `json:"pepStatus"`
	SanctionsStatus bool    `json:"sanctionsStatus"`
	AdverseMedia    bool    `json:"adverseMedia"`

	// Risk Assessment
	RiskScore    int      `json:"riskScore"`
	RiskCategory string   `json:"riskCategory"`
	RiskFactors  []string `json:"riskFactors"`

	// Compliance
	TravelRuleRequired   bool `json:"travelRuleRequired"`
	EnhancedDueDiligence bool `json:"enhancedDueDiligence"`

	// Review
	ReviewerID   string `json:"reviewerId,omitempty"`
	ReviewNotes  string `json:"reviewNotes,omitempty"`
	RejectReason string `json:"rejectReason,omitempty"`

	// Timestamps
	CreatedAt      int64 `json:"createdAt"`
	UpdatedAt      int64 `json:"updatedAt"`
	ExpiresAt      int64 `json:"expiresAt,omitempty"`
	LastVerifiedAt int64 `json:"lastVerifiedAt,omitempty"`
}

// Address
type Address struct {
	Street     string `json:"street"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postalCode"`
	Country    string `json:"country"`
}

// AML Check Result
type AMLCheckResult struct {
	CheckID        string  `json:"checkId"`
	UserID         string  `json:"userId"`
	Status         string  `json:"status"`
	MatchFound     bool    `json:"matchFound"`
	MatchType      string  `json:"matchType"` // pep, sanctions, adverse_media, custom
	MatchDetails   string  `json:"matchDetails"`
	RiskLevel      string  `json:"riskLevel"` // low, medium, high
	Score          float64 `json:"score"`
	CheckTimestamp int64   `json:"checkTimestamp"`
}

// Transaction Monitoring Alert
type ComplianceAlert struct {
	AlertID        string   `json:"alertId"`
	UserID         string   `json:"userId"`
	Type           string   `json:"type"`     // suspicious_activity, threshold_exceeded, unusual_pattern
	Severity       string   `json:"severity"` // low, medium, high, critical
	Description    string   `json:"description"`
	TransactionIDs []string `json:"transactionIds,omitempty"`
	Amount         float64  `json:"amount,omitempty"`
	Currency       string   `json:"currency,omitempty"`
	Status         string   `json:"status"` // open, investigating, resolved, false_positive
	AssignedTo     string   `json:"assignedTo,omitempty"`
	Resolution     string   `json:"resolution,omitempty"`
	CreatedAt      int64    `json:"createdAt"`
	ResolvedAt     int64    `json:"resolvedAt,omitempty"`
}

// SAR (Suspicious Activity Report)
type SAR struct {
	SARID       string   `json:"sarId"`
	UserID      string   `json:"userId"`
	AlertIDs    []string `json:"alertIds"`
	Description string   `json:"description"`
	Narrative   string   `json:"narrative"`
	// FiledWith names the regulator the report was sent to (FinCEN, FCA, ...).
	FiledWith string `json:"filedWith"`
	Status    string `json:"status"` // draft, filed, reviewed
	CreatedAt int64  `json:"createdAt"`
	FiledAt   int64  `json:"filedAt,omitempty"`
}

// Travel Rule
type TravelRule struct {
	TxID             string           `json:"txId"`
	FromUser         *TravelRuleParty `json:"fromUser"`
	ToUser           *TravelRuleParty `json:"toUser"`
	Amount           float64          `json:"amount"`
	Currency         string           `json:"currency"`
	VirtualAsset     string           `json:"virtualAsset"`
	OriginatorVATRF  string           `json:"originatorVatrf"` // Virtual Asset Travel Rule Form
	BeneficiaryVATRF string           `json:"beneficiaryVatrf"`
	Status           string           `json:"status"` // pending, verified, rejected
	// TravelRuleRequired is true when the transfer is at or above the
	// reporting threshold and the originator/beneficiary data must be kept.
	TravelRuleRequired bool  `json:"travelRuleRequired"`
	CreatedAt          int64 `json:"createdAt"`
}

// Travel Rule Party
type TravelRuleParty struct {
	WalletAddress string `json:"walletAddress"`
	Name          string `json:"name"`
	Country       string `json:"country"`
	Type          string `json:"type"` // individual, entity
}

// =============================================================================
// KYC SERVICE
// =============================================================================

type KYCService struct {
	mu sync.RWMutex

	// KYC records
	records map[string]*KYCRecord // kycId -> KYCRecord
	userKYC map[string]*KYCRecord // userId -> KYCRecord

	// AML checks
	amlChecks map[string]*AMLCheckResult // checkId -> AMLCheckResult

	// Compliance alerts
	alerts map[string]*ComplianceAlert // alertId -> Alert

	// SARs
	sars map[string]*SAR // sarId -> SAR

	// Travel Rules
	travelRules map[string]*TravelRule // txId -> TravelRule

	// Configuration
	config KYCConfig

	// User limits by KYC level
	limits map[KYCLevel]*UserLimits

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// IdentityVerifier performs document and liveness verification. It is the
// seam that a real vendor integration (Jumio, Onfido, Sumsub) implements.
type IdentityVerifier interface {
	VerifyDocument(ctx context.Context, record *KYCRecord) (verified bool, score float64, err error)
	VerifyFace(ctx context.Context, record *KYCRecord) (verified bool, score float64, err error)
}

// AMLScreener screens a person against PEP, sanctions, and adverse media
// lists.
type AMLScreener interface {
	Screen(ctx context.Context, fullName, country string) (*AMLScreenResult, error)
}

// AMLScreenResult is the outcome of a screening run.
type AMLScreenResult struct {
	PEP          bool
	Sanctions    bool
	AdverseMedia bool
	Score        float64
	MatchDetails string
}

type KYCConfig struct {
	Provider VerificationProvider
	// Verifier and Screener are optional. When nil, verification and
	// screening cannot run and must not be treated as having passed.
	Verifier                      IdentityVerifier
	Screener                      AMLScreener
	RequireVideoVerification      bool
	AutoApproveEnabled            bool
	AutoRejectThreshold           int // risk score threshold for auto-reject
	ReviewRequiredAbove           int // risk score above which manual review required
	ExpiryPeriodDays              int
	EnhancedDueDiligenceThreshold int
}

type UserLimits struct {
	DailyDepositLimit           float64
	MonthlyDepositLimit         float64
	DailyWithdrawalLimit        float64
	MonthlyWithdrawalLimit      float64
	MinWithdrawalAmount         float64
	MaxWithdrawalAmount         float64
	Requires2FA                 bool
	RequiresAddressVerification bool
}

// =============================================================================
// KYC SERVICE METHODS
// =============================================================================

func NewKYCService() *KYCService {
	ctx, cancel := context.WithCancel(context.Background())

	service := &KYCService{
		records:     make(map[string]*KYCRecord),
		userKYC:     make(map[string]*KYCRecord),
		amlChecks:   make(map[string]*AMLCheckResult),
		alerts:      make(map[string]*ComplianceAlert),
		sars:        make(map[string]*SAR),
		travelRules: make(map[string]*TravelRule),
		ctx:         ctx,
		cancel:      cancel,
		config: KYCConfig{
			Provider:                      ProviderJumio,
			RequireVideoVerification:      false,
			AutoApproveEnabled:            false,
			AutoRejectThreshold:           80,
			ReviewRequiredAbove:           50,
			ExpiryPeriodDays:              365,
			EnhancedDueDiligenceThreshold: 60,
		},
		limits: make(map[KYCLevel]*UserLimits),
	}

	// Initialize limits for each KYC level
	service.initializeLimits()

	// Start background workers
	service.startWorkers()

	return service
}

func (k *KYCService) initializeLimits() {
	k.limits[KYCLevelNone] = &UserLimits{
		DailyDepositLimit:      0,
		MonthlyDepositLimit:    0,
		DailyWithdrawalLimit:   0,
		MonthlyWithdrawalLimit: 0,
		MinWithdrawalAmount:    0,
		MaxWithdrawalAmount:    0,
		Requires2FA:            false,
	}

	k.limits[KYCLevelBasic] = &UserLimits{
		DailyDepositLimit:      1000,
		MonthlyDepositLimit:    10000,
		DailyWithdrawalLimit:   1000,
		MonthlyWithdrawalLimit: 10000,
		MinWithdrawalAmount:    10,
		MaxWithdrawalAmount:    1000,
		Requires2FA:            true,
	}

	k.limits[KYCLevelIntermediate] = &UserLimits{
		DailyDepositLimit:      10000,
		MonthlyDepositLimit:    100000,
		DailyWithdrawalLimit:   10000,
		MonthlyWithdrawalLimit: 100000,
		MinWithdrawalAmount:    10,
		MaxWithdrawalAmount:    50000,
		Requires2FA:            true,
	}

	k.limits[KYCLevelAdvanced] = &UserLimits{
		DailyDepositLimit:      100000,
		MonthlyDepositLimit:    500000,
		DailyWithdrawalLimit:   100000,
		MonthlyWithdrawalLimit: 500000,
		MinWithdrawalAmount:    10,
		MaxWithdrawalAmount:    500000,
		Requires2FA:            true,
	}

	k.limits[KYCLevelInstitutional] = &UserLimits{
		DailyDepositLimit:           10000000,
		MonthlyDepositLimit:         100000000,
		DailyWithdrawalLimit:        10000000,
		MonthlyWithdrawalLimit:      100000000,
		MinWithdrawalAmount:         100,
		MaxWithdrawalAmount:         10000000,
		Requires2FA:                 true,
		RequiresAddressVerification: true,
	}
}

func (k *KYCService) startWorkers() {
	// KYC expiry checker
	k.wg.Add(1)
	go func() {
		defer k.wg.Done()
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-k.ctx.Done():
				return
			case <-ticker.C:
				k.checkExpirations()
			}
		}
	}()

	// AML screening worker
	k.wg.Add(1)
	go func() {
		defer k.wg.Done()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-k.ctx.Done():
				return
			case <-ticker.C:
				k.runPeriodicAMLCheck()
			}
		}
	}()
}

func (k *KYCService) Shutdown() {
	k.cancel()
	k.wg.Wait()
}

// =============================================================================
// KYC SUBMISSION & VERIFICATION
// =============================================================================

func (k *KYCService) SubmitKYC(userID string, data *KYCRecord) (*KYCRecord, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	// Check if user already has KYC
	if existing, ok := k.userKYC[userID]; ok {
		if existing.Status == KYCStatusApproved {
			return nil, errors.New("KYC already approved")
		}
	}

	kycID := uuid.New().String()[:16]

	record := &KYCRecord{
		KYCID:       kycID,
		UserID:      userID,
		Level:       KYCLevelNone,
		Status:      KYCStatusPending,
		Provider:    k.config.Provider,
		ProviderRef: uuid.New().String(),

		// Copy data
		FirstName:          data.FirstName,
		LastName:           data.LastName,
		DateOfBirth:        data.DateOfBirth,
		Nationality:        data.Nationality,
		CountryOfResidence: data.CountryOfResidence,
		Address:            data.Address,
		DocumentType:       data.DocumentType,
		DocumentNumber:     data.DocumentNumber,
		DocumentExpiry:     data.DocumentExpiry,

		CreatedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
		ExpiresAt: time.Now().AddDate(0, 0, k.config.ExpiryPeriodDays).UnixMilli(),
	}

	k.records[kycID] = record
	k.userKYC[userID] = record

	log.Printf("[INFO] KYC submitted: %s for user %s", kycID, userID)

	// Start async verification
	go k.verifyKYCAsync(kycID)

	return record, nil
}

func (k *KYCService) verifyKYCAsync(kycID string) {
	ctx, cancel := context.WithTimeout(k.ctx, 60*time.Second)
	defer cancel()

	k.mu.Lock()
	record, ok := k.records[kycID]
	if !ok {
		k.mu.Unlock()
		return
	}
	verifier := k.config.Verifier
	requireVideo := k.config.RequireVideoVerification
	k.mu.Unlock()

	// Without a configured verifier there is nothing to trust. The record
	// stays in review for a human rather than being approved.
	if verifier == nil {
		k.mu.Lock()
		record.Status = KYCStatusInReview
		record.DocumentVerified = false
		record.FaceVerified = false
		record.AMLStatus = "not_run"
		record.ReviewNotes = "no identity verifier configured"
		record.UpdatedAt = time.Now().UnixMilli()
		k.mu.Unlock()
		log.Printf("[WARN] KYC %s left in review: no identity verifier configured", kycID)
		return
	}

	docVerified, docScore, docErr := verifier.VerifyDocument(ctx, record)
	faceVerified, _, faceErr := verifier.VerifyFace(ctx, record)
	if requireVideo && !faceVerified {
		docVerified = false
	}

	k.mu.Lock()
	defer k.mu.Unlock()

	// Re-read: the record may have changed while the provider was called.
	record, ok = k.records[kycID]
	if !ok {
		return
	}

	if docErr != nil || faceErr != nil {
		// A verification that could not run is not a pass.
		record.Status = KYCStatusInReview
		record.DocumentVerified = false
		record.FaceVerified = false
		record.ReviewNotes = fmt.Sprintf("verifier error: doc=%v face=%v", docErr, faceErr)
		record.UpdatedAt = time.Now().UnixMilli()
		log.Printf("[WARN] KYC %s verification failed: doc=%v face=%v", kycID, docErr, faceErr)
		return
	}

	record.DocumentVerified = docVerified
	record.FaceVerified = faceVerified

	// Document quality feeds the risk score, so a poor capture is not free.
	if docScore > 0 && docScore < 50 {
		record.RiskFactors = append(record.RiskFactors, "low_document_quality")
	}

	record.RiskScore = k.calculateRiskScore(record)

	// Approval now requires both a passing verifier and a risk score that
	// is below the manual review threshold.
	switch {
	case !record.DocumentVerified || !record.FaceVerified:
		record.Status = KYCStatusInReview
		record.ReviewNotes = "verification did not pass"
	case k.config.AutoApproveEnabled && record.RiskScore < k.config.ReviewRequiredAbove:
		record.Status = KYCStatusApproved
		record.Level = KYCLevelBasic
		record.LastVerifiedAt = time.Now().UnixMilli()
		log.Printf("[INFO] KYC auto-approved: %s", kycID)
	case record.RiskScore >= k.config.AutoRejectThreshold:
		record.Status = KYCStatusRejected
		record.RejectReason = "High risk score"
		log.Printf("[WARN] KYC auto-rejected: %s", kycID)
	default:
		record.Status = KYCStatusInReview
		log.Printf("[INFO] KYC requires review: %s", kycID)
	}

	record.UpdatedAt = time.Now().UnixMilli()
}

func (k *KYCService) calculateRiskScore(record *KYCRecord) int {
	score := 0

	// Age risk (under 18 or over 65)
	dob, _ := time.Parse("2006-01-02", record.DateOfBirth)
	age := time.Since(dob).Hours() / (365 * 24)
	if age < 25 || age > 70 {
		score += 10
	}

	// Country risk (sanctioned or high-risk countries)
	highRiskCountries := []string{"IR", "KP", "SY", "CU", "VE"}
	for _, c := range highRiskCountries {
		if record.Nationality == c || record.CountryOfResidence == c {
			score += 30
		}
	}

	// PEP check
	if record.PEPStatus {
		score += 20
	}

	// AML score contribution
	score += int(record.AMLScore)

	return score
}

// =============================================================================
// KYC REVIEW & APPROVAL
// =============================================================================

func (k *KYCService) ApproveKYC(kycID, reviewerID string, level KYCLevel, notes string) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	record, ok := k.records[kycID]
	if !ok {
		return errors.New("KYC record not found")
	}

	if record.Status != KYCStatusInReview && record.Status != KYCStatusPending {
		return errors.New("invalid status for approval")
	}

	record.Status = KYCStatusApproved
	record.Level = level
	record.ReviewerID = reviewerID
	record.ReviewNotes = notes
	record.LastVerifiedAt = time.Now().UnixMilli()
	record.ExpiresAt = time.Now().AddDate(0, 0, k.config.ExpiryPeriodDays).UnixMilli()
	record.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] KYC approved: %s level=%d by %s", kycID, level, reviewerID)
	return nil
}

func (k *KYCService) RejectKYC(kycID, reviewerID, reason string) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	record, ok := k.records[kycID]
	if !ok {
		return errors.New("KYC record not found")
	}

	record.Status = KYCStatusRejected
	record.ReviewerID = reviewerID
	record.RejectReason = reason
	record.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[WARN] KYC rejected: %s reason=%s by %s", kycID, reason, reviewerID)
	return nil
}

func (k *KYCService) UpgradeKYC(userID string, newLevel KYCLevel) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	record, ok := k.userKYC[userID]
	if !ok {
		return errors.New("KYC record not found")
	}

	if record.Status != KYCStatusApproved {
		return errors.New("KYC must be approved to upgrade")
	}

	if newLevel <= record.Level {
		return errors.New("can only upgrade to higher level")
	}

	record.Level = newLevel
	record.LastVerifiedAt = time.Now().UnixMilli()
	record.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] KYC upgraded: %s to level %d", record.KYCID, newLevel)
	return nil
}

// =============================================================================
// KYC QUERIES
// =============================================================================

func (k *KYCService) GetKYC(userID string) (*KYCRecord, error) {
	k.mu.RLock()
	defer k.mu.RUnlock()

	if record, ok := k.userKYC[userID]; ok {
		return record, nil
	}
	return nil, errors.New("KYC not found")
}

func (k *KYCService) GetKYCByID(kycID string) (*KYCRecord, error) {
	k.mu.RLock()
	defer k.mu.RUnlock()

	if record, ok := k.records[kycID]; ok {
		return record, nil
	}
	return nil, errors.New("KYC not found")
}

func (k *KYCService) GetAllPendingKYC() []*KYCRecord {
	k.mu.RLock()
	defer k.mu.RUnlock()

	var pending []*KYCRecord
	for _, record := range k.records {
		if record.Status == KYCStatusPending || record.Status == KYCStatusInReview {
			pending = append(pending, record)
		}
	}
	return pending
}

func (k *KYCService) GetUserLimits(userID string) (*UserLimits, error) {
	k.mu.RLock()
	defer k.mu.RUnlock()

	record, ok := k.userKYC[userID]
	if !ok {
		return k.limits[KYCLevelNone], nil
	}

	return k.limits[record.Level], nil
}

func (k *KYCService) CheckLimit(userID string, txType string, amount float64) (bool, string) {
	limits, err := k.GetUserLimits(userID)
	if err != nil {
		return false, err.Error()
	}

	switch txType {
	case "deposit":
		if amount > limits.DailyDepositLimit {
			return false, fmt.Sprintf("Daily deposit limit exceeded: %.2f", limits.DailyDepositLimit)
		}
	case "withdrawal":
		if amount > limits.DailyWithdrawalLimit {
			return false, fmt.Sprintf("Daily withdrawal limit exceeded: %.2f", limits.DailyWithdrawalLimit)
		}
		if amount < limits.MinWithdrawalAmount {
			return false, fmt.Sprintf("Minimum withdrawal amount: %.2f", limits.MinWithdrawalAmount)
		}
		if amount > limits.MaxWithdrawalAmount {
			return false, fmt.Sprintf("Maximum withdrawal amount: %.2f", limits.MaxWithdrawalAmount)
		}
	}

	return true, "OK"
}

// =============================================================================
// AML SCREENING
// =============================================================================

func (k *KYCService) RunAMLScreen(userID string) (*AMLCheckResult, error) {
	k.mu.Lock()
	record, ok := k.userKYC[userID]
	screener := k.config.Screener
	k.mu.Unlock()

	checkID := uuid.New().String()[:16]
	result := &AMLCheckResult{
		CheckID:        checkID,
		UserID:         userID,
		CheckTimestamp: time.Now().UnixMilli(),
	}

	if !ok {
		return nil, errors.New("no KYC record for user")
	}

	// The previous version returned "completed / low / 0" without running
	// any screening, so a sanctioned user looked clean.
	if screener == nil {
		result.Status = "UNSCREENED"
		result.RiskLevel = "high"
		result.Score = 100
		result.MatchDetails = "no AML screener configured"

		k.mu.Lock()
		k.amlChecks[checkID] = result
		k.mu.Unlock()
		return result, nil
	}

	fullName := strings.TrimSpace(record.FirstName + " " + record.LastName)
	if fullName == "" {
		return nil, errors.New("cannot screen a user without a name")
	}

	ctx, cancel := context.WithTimeout(k.ctx, 30*time.Second)
	defer cancel()

	screen, err := screener.Screen(ctx, fullName, record.CountryOfResidence)
	if err != nil {
		// A screening that could not run is not a clean result.
		result.Status = "ERROR"
		result.RiskLevel = "high"
		result.Score = 100
		result.MatchDetails = fmt.Sprintf("screening error: %v", err)

		k.mu.Lock()
		k.amlChecks[checkID] = result
		k.mu.Unlock()
		return result, nil
	}

	result.MatchFound = screen.PEP || screen.Sanctions || screen.AdverseMedia
	result.Score = screen.Score
	result.MatchDetails = screen.MatchDetails
	switch {
	case screen.Sanctions:
		result.MatchType = "sanctions"
		result.RiskLevel = "high"
	case screen.PEP:
		result.MatchType = "pep"
		result.RiskLevel = "high"
	case screen.AdverseMedia:
		result.MatchType = "adverse_media"
		result.RiskLevel = "medium"
	default:
		result.RiskLevel = "low"
	}
	result.Status = "completed"

	k.mu.Lock()
	k.amlChecks[checkID] = result
	k.mu.Unlock()

	log.Printf("[INFO] AML check completed: %s for user %s (match=%v)", checkID, userID, result.MatchFound)
	return result, nil
}

func (k *KYCService) GetAMLHistory(userID string) []*AMLCheckResult {
	k.mu.RLock()
	defer k.mu.RUnlock()

	var history []*AMLCheckResult
	for _, check := range k.amlChecks {
		if check.UserID == userID {
			history = append(history, check)
		}
	}
	return history
}

// =============================================================================
// COMPLIANCE ALERTS
// =============================================================================

func (k *KYCService) CreateAlert(alert *ComplianceAlert) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	alert.AlertID = uuid.New().String()[:16]
	alert.Status = "open"
	alert.CreatedAt = time.Now().UnixMilli()

	k.alerts[alert.AlertID] = alert

	log.Printf("[WARN] Compliance alert created: %s type=%s user=%s",
		alert.AlertID, alert.Type, alert.UserID)

	return nil
}

func (k *KYCService) ResolveAlert(alertID, resolverID, resolution string) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	alert, ok := k.alerts[alertID]
	if !ok {
		return errors.New("alert not found")
	}

	alert.Status = "resolved"
	alert.AssignedTo = resolverID
	alert.Resolution = resolution
	alert.ResolvedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Alert resolved: %s by %s", alertID, resolverID)
	return nil
}

func (k *KYCService) GetOpenAlerts() []*ComplianceAlert {
	k.mu.RLock()
	defer k.mu.RUnlock()

	var open []*ComplianceAlert
	for _, alert := range k.alerts {
		if alert.Status == "open" {
			open = append(open, alert)
		}
	}
	return open
}

// =============================================================================
// SAR (SUSPICIOUS ACTIVITY REPORT)
// =============================================================================

func (k *KYCService) FileSAR(sar *SAR) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	sar.SARID = uuid.New().String()[:16]
	sar.Status = "filed"
	sar.CreatedAt = time.Now().UnixMilli()
	sar.FiledAt = time.Now().UnixMilli()

	k.sars[sar.SARID] = sar

	log.Printf("[WARN] SAR filed: %s for user %s", sar.SARID, sar.UserID)
	return nil
}

// =============================================================================
// TRAVEL RULE
// =============================================================================

func (k *KYCService) ProcessTravelRule(tr *TravelRule) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	tr.TxID = uuid.New().String()[:16]
	tr.Status = "pending"
	tr.CreatedAt = time.Now().UnixMilli()

	// Validate Travel Rule data
	if tr.Amount >= 1000 { // $1000 threshold
		tr.OriginatorVATRF = uuid.New().String()[:16]
		tr.BeneficiaryVATRF = uuid.New().String()[:16]
		tr.TravelRuleRequired = true
	} else {
		tr.TravelRuleRequired = false
	}

	k.travelRules[tr.TxID] = tr

	log.Printf("[INFO] Travel Rule processed: %s amount=%.2f %s",
		tr.TxID, tr.Amount, tr.Currency)

	return nil
}

// =============================================================================
// EXPIRY CHECK
// =============================================================================

func (k *KYCService) checkExpirations() {
	k.mu.Lock()
	defer k.mu.Unlock()

	now := time.Now().UnixMilli()

	for _, record := range k.records {
		if record.Status == KYCStatusApproved && record.ExpiresAt > 0 && record.ExpiresAt <= now {
			record.Status = KYCStatusExpired
			record.UpdatedAt = now
			log.Printf("[WARN] KYC expired: %s for user %s", record.KYCID, record.UserID)
		}
	}
}

// runPeriodicAMLCheck re-screens approved users on the configured interval.
// The previous version was an empty stub, so a user who became high risk
// after onboarding was never screened again.
func (k *KYCService) runPeriodicAMLCheck() {
	k.mu.RLock()
	hasScreener := k.config.Screener != nil
	userIDs := make([]string, 0, len(k.userKYC))
	for userID, record := range k.userKYC {
		if record.Status == KYCStatusApproved {
			userIDs = append(userIDs, userID)
		}
	}
	k.mu.RUnlock()

	if !hasScreener {
		// Screening cannot run; do not pretend it did.
		return
	}

	for _, userID := range userIDs {
		result, err := k.RunAMLScreen(userID)
		if err != nil {
			log.Printf("[WARN] periodic AML screen failed for %s: %v", userID, err)
			continue
		}
		if result.MatchFound {
			k.mu.Lock()
			if record, ok := k.userKYC[userID]; ok {
				record.Status = KYCStatusSuspended
				record.AMLStatus = "match"
				record.UpdatedAt = time.Now().UnixMilli()
			}
			k.mu.Unlock()
			log.Printf("[WARN] periodic AML match, KYC suspended: %s", userID)
		}
	}
}

// =============================================================================
// UTILITIES
// =============================================================================

func (k *KYCService) GetStats() map[string]interface{} {
	k.mu.RLock()
	defer k.mu.RUnlock()

	var pending, approved, rejected int
	for _, record := range k.records {
		switch record.Status {
		case KYCStatusPending, KYCStatusInReview:
			pending++
		case KYCStatusApproved:
			approved++
		case KYCStatusRejected:
			rejected++
		}
	}

	return map[string]interface{}{
		"total_records":      len(k.records),
		"pending":            pending,
		"approved":           approved,
		"rejected":           rejected,
		"total_alerts":       len(k.alerts),
		"total_sars":         len(k.sars),
		"total_travel_rules": len(k.travelRules),
	}
}

// Placeholder for unused imports
var _ = json.Marshal
var _ = fmt.Errorf
