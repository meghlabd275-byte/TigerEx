package kyc

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"
)

// MaxAcceptableRiskScore is the highest AML risk score that may still be
// auto-cleared. A screening at or above it is treated as a hit and blocks the
// account until a human reviews it.
const MaxAcceptableRiskScore = 70

var (
	ErrInvalidDocument    = errors.New("invalid document")
	ErrVerificationFailed = errors.New("verification failed")
	ErrUserNotEligible    = errors.New("user not eligible for KYC")
	ErrAlreadyVerified    = errors.New("user already verified")
	// ErrScreenerNotConfigured is returned when a screening is requested but no
	// AML screener has been injected. Screening must never silently pass.
	ErrScreenerNotConfigured = errors.New("no AML screener configured")
)

// AMLScreener screens a person against sanctions, PEP and adverse-media lists.
// It is the exchange's own screening rail; the service holds no default, so an
// absent screener blocks approval rather than fabricating a clean result.
type AMLScreener interface {
	Screen(ctx context.Context, fullName, country string) (*AMLScreenResult, error)
}

// AMLScreenResult is the outcome of a screening run.
type AMLScreenResult struct {
	Sanctions    bool
	PEP          bool
	AdverseMedia bool
	RiskScore    int
	Details      string
}

type KYCLevel int

const (
	KYCLevelNone         KYCLevel = 0
	KYCLevelBasic        KYCLevel = 1
	KYCLevelIntermediate KYCLevel = 2
	KYCLevelAdvanced     KYCLevel = 3
)

type VerificationStatus string

const (
	StatusPending    VerificationStatus = "pending"
	StatusSubmitted  VerificationStatus = "submitted"
	StatusProcessing VerificationStatus = "processing"
	StatusApproved   VerificationStatus = "approved"
	StatusRejected   VerificationStatus = "rejected"
)

type DocumentType string

const (
	DocPassport       DocumentType = "passport"
	DocNationalID     DocumentType = "national_id"
	DocDriversLicense DocumentType = "drivers_license"
	DocProofOfAddress DocumentType = "proof_of_address"
	DocSelfie         DocumentType = "selfie"
)

type KYCUser struct {
	ID              string             `json:"id"`
	UserID          string             `json:"user_id"`
	Level           KYCLevel           `json:"kyc_level"`
	Status          VerificationStatus `json:"status"`
	Documents       []*KYCDocument     `json:"documents"`
	RejectionReason string             `json:"rejection_reason,omitempty"`
	ReviewedBy      string             `json:"reviewed_by,omitempty"`
	ReviewedAt      *time.Time         `json:"reviewed_at,omitempty"`
	LastAML         *AMLCheck          `json:"last_aml,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

type KYCDocument struct {
	ID              string                 `json:"id"`
	UserID          string                 `json:"user_id"`
	DocumentType    DocumentType           `json:"document_type"`
	DocumentNumber  string                 `json:"document_number"`
	IssuingCountry  string                 `json:"issuing_country"`
	FileURLs        []string               `json:"file_urls"`
	ExtractedData   map[string]interface{} `json:"extracted_data"`
	Status          VerificationStatus     `json:"status"`
	RejectionReason string                 `json:"rejection_reason,omitempty"`
	VerifiedAt      *time.Time             `json:"verified_at,omitempty"`
	ExpiresAt       *time.Time             `json:"expires_at,omitempty"`
	CreatedAt       time.Time              `json:"created_at"`
}

type AMLCheck struct {
	ID           string                 `json:"id"`
	UserID       string                 `json:"user_id"`
	CheckType    string                 `json:"check_type"`
	Status       VerificationStatus     `json:"status"`
	ResultData   map[string]interface{} `json:"result_data"`
	RiskScore    int                    `json:"risk_score"`
	MatchFound   bool                   `json:"match_found"`
	RiskLevel    string                 `json:"risk_level"`
	MatchDetails string                 `json:"match_details,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
}

type KYCService struct {
	mu       sync.RWMutex
	users    map[string]*KYCUser
	screener AMLScreener
}

func NewKYCService() *KYCService {
	return &KYCService{
		users: make(map[string]*KYCUser),
	}
}

// NewKYCServiceWithScreener wires a real AML screener into the service. Without
// one, approval and withdrawal are blocked rather than passed.
func NewKYCServiceWithScreener(screener AMLScreener) *KYCService {
	s := NewKYCService()
	s.screener = screener
	return s
}

func (s *KYCService) StartKYC(userID string) (*KYCUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	kycUser := &KYCUser{
		ID:        generateID(),
		UserID:    userID,
		Level:     KYCLevelNone,
		Status:    StatusPending,
		Documents: make([]*KYCDocument, 0),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.users[userID] = kycUser
	return kycUser, nil
}

func (s *KYCService) SubmitDocument(userID string, doc *KYCDocument) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	kycUser, exists := s.users[userID]
	if !exists {
		return errors.New("KYC not started")
	}

	if kycUser.Status == StatusApproved {
		return ErrAlreadyVerified
	}

	doc.ID = generateID()
	doc.UserID = userID
	doc.Status = StatusSubmitted
	doc.CreatedAt = time.Now()

	kycUser.Documents = append(kycUser.Documents, doc)
	kycUser.Status = StatusSubmitted
	kycUser.UpdatedAt = time.Now()

	return nil
}

func (s *KYCService) ProcessKYC(userID string, reviewerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	kycUser, exists := s.users[userID]
	if !exists {
		return errors.New("KYC not found")
	}

	if len(kycUser.Documents) == 0 {
		kycUser.Status = StatusRejected
		kycUser.RejectionReason = "No documents submitted"
		return nil
	}

	allValid := true
	for _, doc := range kycUser.Documents {
		if doc.Status != StatusApproved {
			allValid = false
			break
		}
	}

	// An approved application also needs a cleared AML screening. A missing or
	// unfavourable result keeps the application in processing instead of
	// approving a user the exchange never screened.
	amlCleared := kycUser.LastAML != nil && kycUser.LastAML.Status == StatusApproved && !kycUser.LastAML.MatchFound

	if allValid && len(kycUser.Documents) >= 2 && amlCleared {
		kycUser.Status = StatusApproved
		kycUser.Level = KYCLevelIntermediate
		now := time.Now()
		kycUser.ReviewedAt = &now
		kycUser.ReviewedBy = reviewerID
	} else if kycUser.LastAML != nil && (kycUser.LastAML.MatchFound || kycUser.LastAML.Status == StatusRejected) {
		kycUser.Status = StatusRejected
		kycUser.RejectionReason = "AML screening did not clear"
	} else {
		kycUser.Status = StatusProcessing
	}

	kycUser.UpdatedAt = time.Now()
	return nil
}

func (s *KYCService) ApproveDocument(docID, reviewerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, kycUser := range s.users {
		for _, doc := range kycUser.Documents {
			if doc.ID == docID {
				doc.Status = StatusApproved
				now := time.Now()
				doc.VerifiedAt = &now
				return nil
			}
		}
	}
	return errors.New("document not found")
}

func (s *KYCService) RejectDocument(docID, reviewerID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, kycUser := range s.users {
		for _, doc := range kycUser.Documents {
			if doc.ID == docID {
				doc.Status = StatusRejected
				doc.RejectionReason = reason
				return nil
			}
		}
	}
	return errors.New("document not found")
}

func (s *KYCService) PerformAMLCheck(userID string) (*AMLCheck, error) {
	s.mu.Lock()
	kycUser, exists := s.users[userID]
	screener := s.screener
	s.mu.Unlock()

	if !exists {
		return nil, errors.New("KYC not found")
	}

	check := &AMLCheck{
		ID:        generateID(),
		UserID:    userID,
		CheckType: "aml_screening",
		Status:    StatusPending,
		CreatedAt: time.Now(),
	}

	// No screener means no screening. The result is explicitly a high-risk
	// non-clearance, never a fabricated "approved".
	if screener == nil {
		check.Status = StatusRejected
		check.RiskScore = 100
		check.RiskLevel = "high"
		check.MatchDetails = "no AML screener configured"
		check.ResultData = map[string]interface{}{"screener_configured": false, "approved": false}
		s.storeAML(userID, check)
		return check, nil
	}

	fullName := strings.TrimSpace(kycUser.UserID)
	result, err := screener.Screen(context.Background(), fullName, "")
	if err != nil {
		// A screening that could not run is not a clean result.
		check.Status = StatusRejected
		check.RiskScore = 100
		check.RiskLevel = "high"
		check.MatchDetails = "screening error: " + err.Error()
		check.ResultData = map[string]interface{}{"screener_configured": true, "approved": false, "error": err.Error()}
		s.storeAML(userID, check)
		return check, nil
	}
	if result == nil {
		check.Status = StatusRejected
		check.RiskScore = 100
		check.RiskLevel = "high"
		check.MatchDetails = "screener returned no result"
		s.storeAML(userID, check)
		return check, nil
	}

	check.MatchFound = result.Sanctions || result.PEP || result.AdverseMedia
	check.RiskScore = result.RiskScore
	check.MatchDetails = result.Details
	switch {
	case result.Sanctions:
		check.RiskLevel = "high"
	case result.PEP:
		check.RiskLevel = "high"
	case result.AdverseMedia:
		check.RiskLevel = "medium"
	default:
		check.RiskLevel = "low"
	}
	cleared := !check.MatchFound && check.RiskScore < MaxAcceptableRiskScore
	check.ResultData = map[string]interface{}{
		"sanctions_match": result.Sanctions,
		"pep_match":       result.PEP,
		"adverse_media":   result.AdverseMedia,
		"approved":        cleared,
	}
	if cleared {
		check.Status = StatusApproved
	} else {
		check.Status = StatusRejected
	}

	s.storeAML(userID, check)
	return check, nil
}

// storeAML records the latest screening against the user so approval and
// withdrawal read the same verdict.
func (s *KYCService) storeAML(userID string, check *AMLCheck) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kycUser, ok := s.users[userID]; ok {
		kycUser.LastAML = check
		kycUser.UpdatedAt = time.Now()
	}
}

func (s *KYCService) GetKYCStatus(userID string) (*KYCUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	kycUser, exists := s.users[userID]
	if !exists {
		return nil, errors.New("KYC not found")
	}
	return kycUser, nil
}

func (s *KYCService) GetRequiredDocuments(level KYCLevel) []DocumentType {
	switch level {
	case KYCLevelBasic:
		return []DocumentType{DocNationalID}
	case KYCLevelIntermediate:
		return []DocumentType{DocPassport, DocProofOfAddress}
	case KYCLevelAdvanced:
		return []DocumentType{DocPassport, DocProofOfAddress, DocSelfie}
	default:
		return []DocumentType{}
	}
}

func (s *KYCService) CanWithdraw(userID string, amount float64) (bool, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	kycUser, exists := s.users[userID]
	if !exists {
		return false, "KYC not completed"
	}

	if kycUser.Status != StatusApproved {
		return false, "KYC not approved"
	}

	// Withdrawal also needs a cleared AML screening. A user whose screening hit
	// or never ran cannot move funds out.
	if kycUser.LastAML == nil || kycUser.LastAML.Status != StatusApproved || kycUser.LastAML.MatchFound {
		return false, "AML screening not cleared"
	}

	switch {
	case amount > 10000 && kycUser.Level < KYCLevelIntermediate:
		return false, "Intermediate KYC required for withdrawals over $10,000"
	case amount > 100000 && kycUser.Level < KYCLevelAdvanced:
		return false, "Advanced KYC required for withdrawals over $100,000"
	}

	return true, ""
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}
