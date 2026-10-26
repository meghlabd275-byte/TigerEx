// Package kyc provides KYC/AML compliance services.
package kyc

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// VerificationLevel represents KYC verification level
type VerificationLevel int

const (
	LevelNone         VerificationLevel = 0
	LevelBasic        VerificationLevel = 1
	LevelIntermediate VerificationLevel = 2
	LevelFull         VerificationLevel = 3
)

// KYCStatus represents KYC application status
type KYCStatus string

const (
	KYCStatusNotStarted KYCStatus = "NOT_STARTED"
	KYCStatusPending    KYCStatus = "PENDING"
	KYCStatusReviewing  KYCStatus = "REVIEWING"
	KYCStatusApproved   KYCStatus = "APPROVED"
	KYCStatusRejected   KYCStatus = "REJECTED"
	KYCStatusResubmit   KYCStatus = "RESUBMIT"
)

// DocumentType represents ID document type
type DocumentType string

const (
	DocumentPassport      DocumentType = "PASSPORT"
	DocumentNationalID    DocumentType = "NATIONAL_ID"
	DocumentDriverLicense DocumentType = "DRIVERS_LICENSE"
	DocumentUtilityBill   DocumentType = "UTILITY_BILL"
	DocumentBankStatement DocumentType = "BANK_STATEMENT"
)

// KYCDocument represents an uploaded document
type KYCDocument struct {
	ID           string         `json:"id" db:"id"`
	UserID       string         `json:"user_id" db:"user_id"`
	DocumentType DocumentType   `json:"document_type" db:"document_type"`
	FileName     string         `json:"file_name" db:"file_name"`
	FileURL      string         `json:"file_url" db:"file_url"`
	FileHash     string         `json:"file_hash" db:"file_hash"`
	FileSize     int64          `json:"file_size" db:"file_size"`
	Status       string         `json:"status" db:"status"`
	RejectReason sql.NullString `json:"reject_reason" db:"reject_reason"`
	UploadedAt   time.Time      `json:"uploaded_at" db:"uploaded_at"`
	VerifiedAt   sql.NullTime   `json:"verified_at" nullable:"true"`
}

// KYCApplication represents a KYC application
type KYCApplication struct {
	ID           string            `json:"id" db:"id"`
	UserID       string            `json:"user_id" db:"user_id"`
	Status       KYCStatus         `json:"status" db:"status"`
	Level        VerificationLevel `json:"level" db:"level"`
	FirstName    sql.NullString    `json:"first_name" db:"first_name"`
	LastName     sql.NullString    `json:"last_name" db:"last_name"`
	DateOfBirth  sql.NullTime      `json:"date_of_birth" db:"date_of_birth"`
	Nationality  sql.NullString    `json:"nationality" db:"nationality"`
	Country      sql.NullString    `json:"country" db:"country"`
	AddressLine1 sql.NullString    `json:"address_line_1" db:"address_line_1"`
	AddressLine2 sql.NullString    `json:"address_line_2" db:"address_line_2"`
	City         sql.NullString    `json:"city" db:"city"`
	State        sql.NullString    `json:"state" db:"state"`
	PostalCode   sql.NullString    `json:"postal_code" db:"postal_code"`
	IDNumber     sql.NullString    `json:"id_number" db:"id_number"`
	IDIssueDate  sql.NullTime      `json:"id_issue_date" db:"id_issue_date"`
	IDExpiryDate sql.NullTime      `json:"id_expiry_date" db:"id_expiry_date"`
	SubmittedAt  time.Time         `json:"submitted_at" db:"submitted_at"`
	ReviewedAt   sql.NullTime      `json:"reviewed_at" db:"reviewed_at"`
	ReviewerID   sql.NullString    `json:"reviewer_id" db:"reviewer_id"`
	Notes        sql.NullString    `json:"notes" db:"notes"`
}

// PEPStatus represents Politically Exposed Person status
type PEPStatus string

const (
	PEPStatusUnknown PEPStatus = "UNKNOWN"
	PEPStatusClear   PEPStatus = "CLEAR"
	PEPStatusMatch   PEPStatus = "MATCH"
	PEPStatusReview  PEPStatus = "REVIEW"
)

// AMLCheck represents an AML screening result
type AMLCheck struct {
	ID                 string    `json:"id" db:"id"`
	UserID             string    `json:"user_id" db:"user_id"`
	CheckType          string    `json:"check_type" db:"check_type"`
	Status             string    `json:"status" db:"status"`
	PepStatus          PEPStatus `json:"pep_status" db:"pep_status"`
	SanctionsStatus    string    `json:"sanctions_status" db:"sanctions_status"`
	AdverseMediaStatus string    `json:"adverse_media_status" db:"adverse_media_status"`
	RiskScore          int       `json:"risk_score" db:"risk_score"`
	RiskLevel          string    `json:"risk_level" db:"risk_level"`
	MatchesFound       int       `json:"matches_found" db:"matches_found"`
	ChecksCompletedAt  time.Time `json:"checks_completed_at" db:"checks_completed_at"`
	CreatedAt          time.Time `json:"created_at" db:"created_at"`
}

// WatchlistHit represents a watchlist match
type WatchlistHit struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	ListType   string    `json:"list_type"`
	ListName   string    `json:"list_name"`
	MatchType  string    `json:"match_type"`
	EntityName string    `json:"entity_name"`
	EntityID   string    `json:"entity_id"`
	Score      float64   `json:"score"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// TravelRule holds travel rule information
type TravelRule struct {
	RecipientName  string `json:"recipient_name"`
	RecipientID    string `json:"recipient_id"`
	RecipientType  string `json:"recipient_type"`
	OriginatorName string `json:"originator_name"`
	OriginatorID   string `json:"originator_id"`
	Geographic     string `json:"geographic"`
}

// AMLTransaction represents an AML-screened transaction
type AMLTransaction struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	TxID            string          `json:"tx_id"`
	Type            string          `json:"type"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	ScreeningResult string          `json:"screening_result"`
	AlertLevel      string          `json:"alert_level"`
	AlertReason     string          `json:"alert_reason"`
	Status          string          `json:"status"`
	ScreenedAt      time.Time       `json:"screened_at"`
	ReviewedAt      *time.Time      `json:"reviewed_at,omitempty"`
}

// KYCService handles KYC verification
type KYCService struct {
	mu            sync.RWMutex
	applications  map[string]*KYCApplication
	documents     map[string][]*KYCDocument
	amlChecks     map[string]*AMLCheck
	watchlistHits map[string][]*WatchlistHit
	providers     map[string]VerificationProvider
	rules         []ComplianceRule
	db            *sql.DB
	httpClient    *http.Client
}

// VerificationProvider provides external verification
type VerificationProvider interface {
	VerifyIdentity(ctx context.Context, data *VerificationData) (*VerificationResult, error)
	VerifyDocument(ctx context.Context, doc *KYCDocument) (*VerificationResult, error)
	CheckPEP(ctx context.Context, name string) ([]PEPMatch, error)
	CheckSanctions(ctx context.Context, name string) ([]SanctionMatch, error)
}

// VerificationData holds identity verification data
type VerificationData struct {
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	DateOfBirth  string `json:"date_of_birth"`
	Nationality  string `json:"nationality"`
	IDNumber     string `json:"id_number"`
	IDType       string `json:"id_type"`
	Country      string `json:"country"`
	AddressLine1 string `json:"address_line_1"`
	City         string `json:"city"`
	State        string `json:"state"`
	PostalCode   string `json:"postal_code"`
}

// VerificationResult holds verification result
type VerificationResult struct {
	Valid      bool     `json:"valid"`
	Score      float64  `json:"score"`
	Confidence float64  `json:"confidence"`
	Errors     []string `json:"errors"`
	Warnings   []string `json:"warnings"`
}

// PEPMatch represents a PEP match
type PEPMatch struct {
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	EntityType string  `json:"entity_type"`
	Position   string  `json:"position"`
	Country    string  `json:"country"`
	Score      float64 `json:"score"`
}

// SanctionMatch represents a sanctions match
type SanctionMatch struct {
	Name    string  `json:"name"`
	List    string  `json:"list"`
	Type    string  `json:"type"`
	Country string  `json:"country"`
	Program string  `json:"program"`
	Score   float64 `json:"score"`
}

// RiskScore represents user risk score
type RiskScore struct {
	UserID       string          `json:"user_id"`
	TotalScore   float64         `json:"total_score"`
	RiskLevel    string          `json:"risk_level"`
	Components   []RiskComponent `json:"components"`
	CalculatedAt time.Time       `json:"calculated_at"`
}

// RiskComponent represents a risk score component
type RiskComponent struct {
	Name   string  `json:"name"`
	Score  float64 `json:"score"`
	Weight float64 `json:"weight"`
}

// ComplianceRule represents a compliance rule
type ComplianceRule struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Condition      string `json:"condition"`
	Action         string `json:"action"`
	RiskScore      int    `json:"risk_score"`
	Enabled        bool   `json:"enabled"`
	Priority       int    `json:"priority"`
	RequiresReview bool   `json:"requires_review"`
}

// NewKYCService creates a new KYC service
func NewKYCService() *KYCService {
	return &KYCService{
		applications: make(map[string]*KYCApplication),
		documents:    make(map[string][]*KYCDocument),
		amlChecks:    make(map[string]*AMLCheck),
		// watchlistHits was never initialised, so recording the first PEP or
		// sanctions hit panicked on a nil map write.
		watchlistHits: make(map[string][]*WatchlistHit),
		providers:     make(map[string]VerificationProvider),
		rules:         defaultRules(),
	}
}

func defaultRules() []ComplianceRule {
	return []ComplianceRule{
		{
			ID:             "rule_001",
			Name:           "High Value Transaction",
			Description:    "Flag transactions above threshold",
			Condition:      "amount > 10000",
			Action:         "ALERT",
			RiskScore:      30,
			Enabled:        true,
			RequiresReview: true,
		},
		{
			ID:             "rule_002",
			Name:           "High Risk Country",
			Description:    "Flag transactions from high risk countries",
			Condition:      "country in ['high_risk']",
			Action:         "ALERT",
			RiskScore:      50,
			Enabled:        true,
			RequiresReview: true,
		},
		{
			ID:             "rule_003",
			Name:           "Rapid Transactions",
			Description:    "Flag many transactions in short time",
			Condition:      "tx_count > 10 in 1 hour",
			Action:         "REVIEW",
			RiskScore:      20,
			Enabled:        true,
			RequiresReview: false,
		},
		{
			ID:             "rule_004",
			Name:           "New Account Big Transaction",
			Description:    "Large transaction from new account",
			Condition:      "account_age < 7 days AND amount > 1000",
			Action:         "REVIEW",
			RiskScore:      40,
			Enabled:        true,
			RequiresReview: true,
		},
		{
			ID:             "rule_005",
			Name:           "Unverified Large Transfer",
			Description:    "Large withdrawal without KYC",
			Condition:      "kyc_level < 2 AND amount > 500",
			Action:         "BLOCK",
			RiskScore:      60,
			Enabled:        true,
			RequiresReview: true,
		},
	}
}

// SubmitApplication submits a KYC application
func (ks *KYCService) SubmitApplication(ctx context.Context, app *KYCApplication) (*KYCApplication, error) {
	// Validate required fields
	if app.FirstName.String == "" || app.LastName.String == "" {
		return nil, fmt.Errorf("first name and last name are required")
	}

	// Set timestamps
	app.ID = generateApplicationID()
	app.SubmittedAt = time.Now()

	// Store application
	ks.mu.Lock()
	ks.applications[app.ID] = app
	ks.mu.Unlock()

	return app, nil
}

// UploadDocument stores an ID document after checking that its bytes really
// are an allowed image or PDF.
//
// The previous version only looked at the filename, so a client could upload
// anything by naming it passport.jpg, and it hashed the file without ever
// checking the bytes it read.
func (ks *KYCService) UploadDocument(ctx context.Context, doc *KYCDocument, file multipart.File) (*KYCDocument, error) {
	if file == nil {
		return nil, fmt.Errorf("no file supplied")
	}
	if doc == nil {
		return nil, fmt.Errorf("no document metadata supplied")
	}
	if !isAllowedFileType(doc.FileName) {
		return nil, fmt.Errorf("file type not allowed: %s", doc.FileName)
	}

	// Read the whole upload once, bounded by the size cap.
	content, err := io.ReadAll(io.LimitReader(file, maxDocumentBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read upload: %w", err)
	}
	if int64(len(content)) > maxDocumentBytes {
		return nil, fmt.Errorf("document exceeds the %d byte limit", maxDocumentBytes)
	}
	if len(content) == 0 {
		return nil, fmt.Errorf("document is empty")
	}

	// The declared name and MIME are attacker controlled; trust the bytes.
	mime := detectContentType(content)
	if mime == "" || !allowedMimeTypes[mime] {
		return nil, fmt.Errorf("document content is not an allowed image or PDF")
	}

	sum := sha256.Sum256(content)
	doc.FileHash = base64.StdEncoding.EncodeToString(sum[:])
	doc.FileSize = int64(len(content))

	doc.ID = generateDocumentID()
	doc.Status = "pending"
	doc.UploadedAt = time.Now()

	ks.mu.Lock()
	ks.documents[doc.UserID] = append(ks.documents[doc.UserID], doc)
	ks.mu.Unlock()

	return doc, nil
}

// ProcessApplication processes a KYC application
func (ks *KYCService) ProcessApplication(ctx context.Context, appID string) (*KYCApplication, error) {
	ks.mu.RLock()
	app, ok := ks.applications[appID]
	ks.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("application not found")
	}

	// Run verification checks. Approval requires positive evidence: at least
	// one provider must answer, and every provider that answers must agree. A
	// service with no providers configured cannot approve anyone, and the old
	// "allPassed starts true" loop did exactly that.
	providersRun := 0
	providersPassed := 0

	data := &VerificationData{
		FirstName:   app.FirstName.String,
		LastName:    app.LastName.String,
		DateOfBirth: app.DateOfBirth.Time.Format("2006-01-02"),
		Nationality: app.Nationality.String,
		IDNumber:    app.IDNumber.String,
		Country:     app.Country.String,
	}

	for _, provider := range ks.providers {
		providersRun++

		result, err := provider.VerifyIdentity(ctx, data)
		if err != nil {
			app.Notes.String += fmt.Sprintf("\nProvider error: %v", err)
			continue
		}
		if result == nil {
			app.Notes.String += "\nProvider returned no result"
			continue
		}
		if result.Valid {
			providersPassed++
		} else {
			app.Notes.String += fmt.Sprintf("\nVerification failed: %v", result.Errors)
		}
	}

	if providersRun == 0 {
		app.Notes.String += "\nNo identity provider configured; manual review required"
	}

	// Every document required for this level must be present and verified.
	docs := ks.documents[app.UserID]
	docsOK := true
	if len(docs) == 0 {
		docsOK = false
		app.Notes.String += "\nNo documents uploaded"
	}
	for _, required := range ks.getRequiredDocuments(app.Level) {
		found := false
		for _, doc := range docs {
			if doc.DocumentType == required && doc.Status == "verified" {
				found = true
				break
			}
		}
		if !found {
			docsOK = false
			app.Notes.String += fmt.Sprintf("\nMissing verified document: %s", required)
		}
	}

	// Approve only on positive evidence; otherwise hand to a human.
	if providersRun > 0 && providersPassed == providersRun && docsOK {
		app.Status = KYCStatusApproved
	} else {
		app.Status = KYCStatusReviewing
	}

	app.ReviewedAt.Time = time.Now()
	app.ReviewedAt.Valid = true

	return app, nil
}

// RunAMLCheck runs AML screening
func (ks *KYCService) RunAMLCheck(ctx context.Context, userID string, app *KYCApplication) (*AMLCheck, error) {
	check := &AMLCheck{
		ID:                generateCheckID(),
		UserID:            userID,
		CheckType:         "STANDARD",
		Status:            "COMPLETE",
		PepStatus:         PEPStatusClear,
		SanctionsStatus:   "CLEAR",
		RiskScore:         0,
		RiskLevel:         "LOW",
		MatchesFound:      0,
		CreatedAt:         time.Now(),
		ChecksCompletedAt: time.Now(),
	}

	// Screen the applicant against every configured provider.
	//
	// The previous version ranged over the package-level `providers` map,
	// which is never initialised, so it always found nothing and reported a
	// clean result. It also swallowed provider errors, so a screening that
	// could not run looked identical to one that passed.
	name := strings.TrimSpace(app.FirstName.String + " " + app.LastName.String)
	if name == "" {
		check.Status = "ERROR"
		check.SanctionsStatus = "UNKNOWN"
		check.RiskLevel = "HIGH"
		check.RiskScore = 100
		app.Notes.String += "\nAML: applicant name is empty"
	}

	screeningProviders := 0
	for _, provider := range ks.providers {
		screeningProviders++

		matches, err := provider.CheckPEP(ctx, name)
		if err != nil {
			// A screening that could not run is not a clean result.
			check.Status = "ERROR"
			check.SanctionsStatus = "UNKNOWN"
			check.RiskLevel = "HIGH"
			check.RiskScore = 100
			app.Notes.String += fmt.Sprintf("\nAML provider error: %v", err)
			continue
		}

		for _, m := range matches {
			hit := &WatchlistHit{
				ID:         generateHitID(),
				UserID:     userID,
				ListType:   "PEP",
				EntityName: m.Name,
				EntityID:   m.Type,
				Score:      m.Score,
				Status:     "REVIEW",
				CreatedAt:  time.Now(),
			}
			check.PepStatus = PEPStatusMatch
			check.SanctionsStatus = "MATCH"
			check.MatchesFound++
			check.RiskScore += 30

			ks.mu.Lock()
			ks.watchlistHits[userID] = append(ks.watchlistHits[userID], hit)
			ks.mu.Unlock()
		}
	}

	if screeningProviders == 0 && check.Status == "COMPLETE" {
		check.Status = "UNSCREENED"
		check.SanctionsStatus = "UNKNOWN"
		check.RiskLevel = "HIGH"
		check.RiskScore = 100
		app.Notes.String += "\nAML: no screening provider configured"
	}

	// Determine risk level
	if check.RiskScore >= 70 {
		check.RiskLevel = "HIGH"
	} else if check.RiskScore >= 40 {
		check.RiskLevel = "MEDIUM"
	} else {
		check.RiskLevel = "LOW"
	}

	ks.mu.Lock()
	ks.amlChecks[check.ID] = check
	ks.mu.Unlock()

	return check, nil
}

// GetApplication returns KYC application for a user
func (ks *KYCService) GetApplication(userID string) (*KYCApplication, bool) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	for _, app := range ks.applications {
		if app.UserID == userID {
			return app, true
		}
	}
	return nil, false
}

// GetDocuments returns documents for a user
func (ks *KYCService) GetDocuments(userID string) []*KYCDocument {
	ks.mu.RLock()
	defer ks.mu.RUnlock()
	return ks.documents[userID]
}

// CalculateRiskScore calculates user risk score
func (ks *KYCService) CalculateRiskScore(ctx context.Context, userID string, app *KYCApplication) *RiskScore {
	rs := &RiskScore{
		UserID:     userID,
		Components: []RiskComponent{},
	}

	// Basic risk factors
	if app == nil {
		rs.Components = append(rs.Components, RiskComponent{
			Name:   "NO_KYC",
			Score:  100,
			Weight: 0.4,
		})
		rs.TotalScore += 40
	} else {
		levelScore := map[VerificationLevel]float64{
			LevelNone:         100,
			LevelBasic:        50,
			LevelIntermediate: 25,
			LevelFull:         0,
		}[app.Level]
		rs.Components = append(rs.Components, RiskComponent{
			Name:   "KYC_LEVEL",
			Score:  levelScore,
			Weight: 0.4,
		})
		rs.TotalScore += levelScore * 0.4
	}

	// Country risk
	highRiskCountries := []string{"KP", "IR", "SY", "CU", "RU"}
	for _, c := range highRiskCountries {
		if app.Country.String == c {
			rs.Components = append(rs.Components, RiskComponent{
				Name:   "HIGH_RISK_COUNTRY",
				Score:  50,
				Weight: 0.3,
			})
			rs.TotalScore += 15
		}
	}

	// Set risk level
	if rs.TotalScore >= 70 {
		rs.RiskLevel = "HIGH"
	} else if rs.TotalScore >= 40 {
		rs.RiskLevel = "MEDIUM"
	} else {
		rs.RiskLevel = "LOW"
	}

	rs.CalculatedAt = time.Now()

	return rs
}

// EvaluateTransaction evaluates transaction for AML
func (ks *KYCService) EvaluateTransaction(ctx context.Context, tx *AMLTransaction) error {
	// Run compliance rules
	for _, rule := range ks.rules {
		if !rule.Enabled {
			continue
		}

		// Check condition (simplified)
		if evaluateRule(rule, tx) {
			tx.AlertLevel = rule.Action
			tx.AlertReason = rule.Name

			if rule.Action == "BLOCK" {
				tx.ScreeningResult = "BLOCKED"
				tx.Status = "REJECTED"
				return fmt.Errorf("transaction blocked by compliance rule: %s", rule.Name)
			}
		}
	}

	tx.ScreeningResult = "CLEARED"
	tx.Status = "APPROVED"
	tx.ScreenedAt = time.Now()

	return nil
}

// GetRequiredDocuments returns required documents for level
func (ks *KYCService) getRequiredDocuments(level VerificationLevel) []DocumentType {
	requirements := map[VerificationLevel][]DocumentType{
		LevelBasic:        {DocumentNationalID},
		LevelIntermediate: {DocumentNationalID, DocumentUtilityBill},
		LevelFull:         {DocumentNationalID, DocumentPassport, DocumentBankStatement},
	}
	return requirements[level]
}

// Helper functions
func generateApplicationID() string {
	return fmt.Sprintf("APP%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateDocumentID() string {
	return fmt.Sprintf("DOC%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateCheckID() string {
	return fmt.Sprintf("AML%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateHitID() string {
	return fmt.Sprintf("HIT%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

// isAllowedFileType reports whether a filename carries an allowed extension.
//
// The previous version sliced from strings.LastIndex without checking for -1,
// so any name without a dot ("passport") panicked.
func isAllowedFileType(filename string) bool {
	dot := strings.LastIndex(filename, ".")
	if dot < 0 || dot == len(filename)-1 {
		return false
	}

	switch strings.ToLower(filename[dot:]) {
	case ".jpg", ".jpeg", ".png", ".pdf":
		return true
	default:
		return false
	}
}

// allowedMimeTypes are the content types accepted for identity documents.
var allowedMimeTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"application/pdf": true,
}

// magicNumbers maps a file's leading bytes to its content type. Extension and
// client-declared MIME are both attacker controlled, so an upload is accepted
// only when the bytes match an allowed type.
var magicNumbers = []struct {
	prefix []byte
	mime   string
}{
	{[]byte{0xFF, 0xD8, 0xFF}, "image/jpeg"},
	{[]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, "image/png"},
	{[]byte{0x25, 0x50, 0x44, 0x46, 0x2D}, "application/pdf"},
}

// detectContentType returns the content type implied by a file's leading bytes,
// or "" when the bytes match nothing known.
func detectContentType(head []byte) string {
	for _, m := range magicNumbers {
		if len(head) >= len(m.prefix) && bytes.Equal(head[:len(m.prefix)], m.prefix) {
			return m.mime
		}
	}
	return ""
}

// maxDocumentBytes caps an upload so a huge file cannot exhaust memory.
const maxDocumentBytes = 25 << 20 // 25 MiB

func evaluateRule(rule ComplianceRule, tx *AMLTransaction) bool {
	switch rule.Name {
	case "High Value Transaction":
		amountFloat, _ := tx.Amount.Float64()
		return amountFloat > 10000
	}
	return false
}

var _ = rand.Read
