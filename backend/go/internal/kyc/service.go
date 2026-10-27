// Package kyc provides KYC (Know Your Customer) services.
package kyc

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	// ErrNotSubmitted is returned when a user has no KYC record.
	ErrNotSubmitted = errors.New("KYC not submitted")
	// ErrPending is returned when a decision is requested while a review is open.
	ErrPending = errors.New("KYC pending review")
	// ErrRejected is returned when the latest submission was rejected.
	ErrRejected = errors.New("KYC rejected")
	// ErrExpired is returned when a verification has expired.
	ErrExpired = errors.New("KYC expired")
	// ErrStoreUnavailable is returned when an operation needs durable state and
	// no store has been configured.
	ErrStoreUnavailable = errors.New("kyc persistence is not configured")
)

// KYC levels. They are ordered: a higher level satisfies every requirement of a
// lower one.
const (
	LevelNone int = iota
	LevelEmail
	LevelPhone
	LevelBasic
	LevelIntermediate
	LevelFull
)

// Application states.
const (
	StatusNotSubmitted = "not_submitted"
	StatusPending      = "pending"
	StatusApproved     = "approved"
	StatusRejected     = "rejected"
)

// Document types accepted by the submission endpoint.
const (
	DocPassport       = "passport"
	DocNationalID     = "national_id"
	DocDriversLicense = "drivers_license"
)

var documentTypes = map[string]bool{
	DocPassport:       true,
	DocNationalID:     true,
	DocDriversLicense: true,
}

// documentPatterns validate a document number per type. They are deliberately
// permissive: the issuing authority decides the format, and an over-strict
// pattern would reject valid documents.
var documentPatterns = map[string]*regexp.Regexp{
	DocPassport:       regexp.MustCompile(`^[A-Z0-9]{6,9}$`),
	DocNationalID:     regexp.MustCompile(`^[A-Z0-9-]{5,20}$`),
	DocDriversLicense: regexp.MustCompile(`^[A-Z0-9-]{5,20}$`),
}

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// supportedCountries lists the ISO 3166-1 alpha-2 codes the exchange accepts.
// Unsupported jurisdictions are refused rather than silently accepted.
var supportedCountries = map[string]bool{
	"US": true, "GB": true, "DE": true, "FR": true, "JP": true,
	"KR": true, "SG": true, "HK": true, "AU": true, "CA": true,
	"CH": true, "NL": true, "SE": true, "NO": true, "DK": true,
	"FI": true, "IE": true, "IT": true, "ES": true, "PT": true,
	"BE": true, "AT": true, "PL": true, "CZ": true, "HU": true,
	"GR": true, "TR": true, "IN": true, "BR": true, "MX": true,
	"AR": true, "CL": true, "CO": true, "BD": true, "PK": true,
	"PH": true, "ID": true, "MY": true, "TH": true, "VN": true,
	"ZA": true, "NG": true, "KE": true, "AE": true, "SA": true,
	"IL": true, "NZ": true, "TW": true, "UA": true, "RO": true,
}

// sanctionsCountries are jurisdictions subject to comprehensive sanctions.
// Submissions from these countries are refused outright.
var sanctionsCountries = map[string]bool{
	"IR": true, "KP": true, "SY": true, "CU": true, "MM": true, "SD": true,
}

// Config holds KYC configuration.
type Config struct {
	MaxLoginAttempts int
	LockoutDuration  time.Duration
}

// Status represents KYC verification status.
type Status struct {
	UserID       string `json:"userId"`
	Level        int    `json:"level"`
	Status       string `json:"status"`
	SubmittedAt  int64  `json:"submittedAt,omitempty"`
	ReviewedAt   int64  `json:"reviewedAt,omitempty"`
	ExpiresAt    int64  `json:"expiresAt,omitempty"`
	RejectReason string `json:"rejectReason,omitempty"`
}

// SubmissionRequest represents a KYC submission request.
type SubmissionRequest struct {
	UserID       string
	DocumentType string
	FirstName    string
	LastName     string
	DOB          string
	Country      string
	DocumentID   string
	Address      string
	City         string
	State        string
	ZipCode      string
}

// Application is a stored submission.
type Application struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	DocumentType string `json:"documentType"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	DOB          string `json:"dob"`
	Country      string `json:"country"`
	DocumentID   string `json:"documentId"`
	Address      string `json:"address"`
	City         string `json:"city"`
	State        string `json:"state"`
	ZipCode      string `json:"zipCode"`
	Level        int    `json:"level"`
	Status       string `json:"status"`
	RejectReason string `json:"rejectReason,omitempty"`
	SubmittedAt  int64  `json:"submittedAt"`
	ReviewedAt   int64  `json:"reviewedAt,omitempty"`
}

// AuditEntry records a KYC decision for the audit trail.
type AuditEntry struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Action    string `json:"action"`
	Details   string `json:"details,omitempty"`
	ActorID   string `json:"actorId,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

// Store is the persistence seam for KYC state.
type Store interface {
	// GetApplication returns the user's current application, or nil with a nil
	// error when the user has never submitted one.
	GetApplication(ctx context.Context, userID string) (*Application, error)
	CreateApplication(ctx context.Context, app *Application) error
	UpdateApplication(ctx context.Context, app *Application) error
	// SetUserKYCLevel updates the user's effective verification level.
	SetUserKYCLevel(ctx context.Context, userID string, level int) error
	RecordAudit(ctx context.Context, entry *AuditEntry) error
}

// Service handles KYC verification.
type Service struct {
	config Config
	store  Store
}

// NewService creates a new KYC service. Persistence is attached with
// WithStore; without it every operation reports ErrStoreUnavailable rather than
// returning a fabricated "not submitted" status.
func NewService(config Config) *Service {
	return &Service{config: config}
}

// WithStore returns the service with a persistence store attached.
func (s *Service) WithStore(store Store) *Service {
	s.store = store
	return s
}

// Store returns the configured store, or nil.
func (s *Service) Store() Store { return s.store }

// GetStatus retrieves KYC status for a user.
func (s *Service) GetStatus(ctx context.Context, userID string) (*Status, error) {
	if userID == "" {
		return nil, ErrNotSubmitted
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}

	app, err := s.store.GetApplication(ctx, userID)
	if err != nil {
		return nil, err
	}
	if app == nil {
		return &Status{UserID: userID, Level: LevelNone, Status: StatusNotSubmitted}, nil
	}

	return &Status{
		UserID:       userID,
		Level:        app.Level,
		Status:       app.Status,
		SubmittedAt:  app.SubmittedAt,
		ReviewedAt:   app.ReviewedAt,
		RejectReason: app.RejectReason,
	}, nil
}

// ValidateSubmission checks a submission against the exchange's document and
// jurisdiction rules. It is exported so the review tooling and the tests share
// one implementation.
func ValidateSubmission(req *SubmissionRequest) error {
	if req == nil || strings.TrimSpace(req.UserID) == "" {
		return errors.New("userId is required")
	}

	docType := strings.ToLower(strings.TrimSpace(req.DocumentType))
	if !documentTypes[docType] {
		return errors.New("documentType must be passport, national_id, or drivers_license")
	}

	if strings.TrimSpace(req.FirstName) == "" || strings.TrimSpace(req.LastName) == "" {
		return errors.New("firstName and lastName are required")
	}
	if len(req.FirstName) > 100 || len(req.LastName) > 100 {
		return errors.New("name is too long")
	}

	dob := strings.TrimSpace(req.DOB)
	if _, err := time.Parse("2006-01-02", dob); err != nil {
		return errors.New("dob must be formatted as YYYY-MM-DD")
	}
	if !isAdult(dob) {
		return errors.New("applicant must be at least 18 years old")
	}

	country := strings.ToUpper(strings.TrimSpace(req.Country))
	if len(country) != 2 {
		return errors.New("country must be a two-letter ISO 3166-1 code")
	}
	if sanctionsCountries[country] {
		return errors.New("applications from this jurisdiction are not accepted")
	}
	if !supportedCountries[country] {
		return errors.New("country is not supported")
	}

	docID := strings.ToUpper(strings.TrimSpace(req.DocumentID))
	if !documentPatterns[docType].MatchString(docID) {
		return errors.New("documentId does not match the expected format for this document type")
	}

	if strings.TrimSpace(req.Address) == "" {
		return errors.New("address is required")
	}
	if len(req.Address) > 255 {
		return errors.New("address is too long")
	}
	if strings.TrimSpace(req.City) == "" {
		return errors.New("city is required")
	}
	zip := strings.TrimSpace(req.ZipCode)
	if len(zip) < 3 || len(zip) > 10 {
		return errors.New("zipCode must be between 3 and 10 characters")
	}
	return nil
}

func isAdult(dob string) bool {
	d, err := time.Parse("2006-01-02", strings.TrimSpace(dob))
	if err != nil {
		return false
	}
	return !d.AddDate(18, 0, 0).After(time.Now().UTC())
}

// Submit stores KYC documents for review. Validation runs before anything is
// persisted, so a malformed submission cannot create a pending record.
func (s *Service) Submit(ctx context.Context, req *SubmissionRequest) (*Status, error) {
	if req == nil || strings.TrimSpace(req.UserID) == "" {
		return nil, ErrNotSubmitted
	}
	if err := ValidateSubmission(req); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}

	existing, err := s.store.GetApplication(ctx, req.UserID)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == StatusPending {
		return nil, ErrPending
	}

	now := time.Now().Unix()
	app := &Application{
		UserID:       req.UserID,
		DocumentType: strings.ToLower(strings.TrimSpace(req.DocumentType)),
		FirstName:    strings.TrimSpace(req.FirstName),
		LastName:     strings.TrimSpace(req.LastName),
		DOB:          strings.TrimSpace(req.DOB),
		Country:      strings.ToUpper(strings.TrimSpace(req.Country)),
		DocumentID:   strings.ToUpper(strings.TrimSpace(req.DocumentID)),
		Address:      strings.TrimSpace(req.Address),
		City:         strings.TrimSpace(req.City),
		State:        strings.TrimSpace(req.State),
		ZipCode:      strings.TrimSpace(req.ZipCode),
		Level:        LevelNone,
		Status:       StatusPending,
		SubmittedAt:  now,
	}

	if existing != nil {
		app.ID = existing.ID
		if err := s.store.UpdateApplication(ctx, app); err != nil {
			return nil, err
		}
	} else if err := s.store.CreateApplication(ctx, app); err != nil {
		return nil, err
	}

	_ = s.store.RecordAudit(ctx, &AuditEntry{
		UserID:    req.UserID,
		Action:    "kyc.submitted",
		Details:   "document_type=" + app.DocumentType + " country=" + app.Country,
		CreatedAt: now,
	})

	return &Status{
		UserID:      req.UserID,
		Level:       app.Level,
		Status:      app.Status,
		SubmittedAt: app.SubmittedAt,
	}, nil
}

// Review records an operator decision on an application.
func (s *Service) Review(ctx context.Context, userID string, approve bool, level int, reason, actorID string) (*Status, error) {
	if userID == "" {
		return nil, ErrNotSubmitted
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}
	if approve && (level < LevelBasic || level > LevelFull) {
		return nil, errors.New("approved level must be between basic and full")
	}
	if !approve && strings.TrimSpace(reason) == "" {
		return nil, errors.New("a rejection reason is required")
	}

	app, err := s.store.GetApplication(ctx, userID)
	if err != nil {
		return nil, err
	}
	if app == nil {
		return nil, ErrNotSubmitted
	}

	now := time.Now().Unix()
	app.ReviewedAt = now
	if approve {
		app.Status = StatusApproved
		app.Level = level
		app.RejectReason = ""
	} else {
		app.Status = StatusRejected
		app.Level = LevelNone
		app.RejectReason = strings.TrimSpace(reason)
	}

	if err := s.store.UpdateApplication(ctx, app); err != nil {
		return nil, err
	}
	// The user's effective level follows the application, so withdrawal limits
	// change at the moment of approval.
	if err := s.store.SetUserKYCLevel(ctx, userID, app.Level); err != nil {
		return nil, err
	}

	action := "kyc.rejected"
	if approve {
		action = "kyc.approved"
	}
	_ = s.store.RecordAudit(ctx, &AuditEntry{
		UserID:    userID,
		Action:    action,
		Details:   app.RejectReason,
		ActorID:   actorID,
		CreatedAt: now,
	})

	return &Status{
		UserID:       userID,
		Level:        app.Level,
		Status:       app.Status,
		SubmittedAt:  app.SubmittedAt,
		ReviewedAt:   app.ReviewedAt,
		RejectReason: app.RejectReason,
	}, nil
}

// CanWithdraw checks if a user can withdraw the given amount under their KYC
// level.
func (s *Service) CanWithdraw(ctx context.Context, userID string, amount float64) error {
	if amount < 0 {
		return errors.New("amount must not be negative")
	}
	status, err := s.GetStatus(ctx, userID)
	if err != nil {
		return err
	}
	if status.Status == StatusRejected {
		return ErrRejected
	}
	if required := requiredLevelForWithdrawal(amount); status.Level < required {
		return levelError(required, "withdrawal")
	}
	return nil
}

// CanDeposit checks if a user can deposit the given amount under their KYC
// level.
func (s *Service) CanDeposit(ctx context.Context, userID string, amount float64) error {
	if amount < 0 {
		return errors.New("amount must not be negative")
	}
	status, err := s.GetStatus(ctx, userID)
	if err != nil {
		return err
	}
	if status.Status == StatusRejected {
		return ErrRejected
	}
	if required := requiredLevelForDeposit(amount); status.Level < required {
		return levelError(required, "deposit")
	}
	return nil
}

// requiredLevelForWithdrawal maps an amount to the minimum KYC level.
func requiredLevelForWithdrawal(amount float64) int {
	switch {
	case amount <= 1000:
		return LevelNone
	case amount <= 10000:
		return LevelBasic
	case amount <= 50000:
		return LevelIntermediate
	default:
		return LevelFull
	}
}

func requiredLevelForDeposit(amount float64) int {
	switch {
	case amount <= 1000:
		return LevelNone
	case amount <= 3000:
		return LevelEmail
	case amount <= 10000:
		return LevelBasic
	case amount <= 50000:
		return LevelIntermediate
	default:
		return LevelFull
	}
}

func levelError(required int, operation string) error {
	names := map[int]string{
		LevelEmail:        "email verification",
		LevelPhone:        "phone verification",
		LevelBasic:        "basic KYC",
		LevelIntermediate: "intermediate KYC",
		LevelFull:         "full KYC",
	}
	name, ok := names[required]
	if !ok {
		name = "additional verification"
	}
	return errors.New(name + " is required for this " + operation)
}

// VerifyEmail validates an email address. The caller has already proven control
// of the mailbox by presenting the one-time code sent to it.
func (s *Service) VerifyEmail(_ context.Context, userID, email string) error {
	if strings.TrimSpace(userID) == "" {
		return ErrNotSubmitted
	}
	if !emailPattern.MatchString(strings.TrimSpace(email)) {
		return errors.New("invalid email address")
	}
	return nil
}

// VerifyPhone validates an E.164 phone number.
func (s *Service) VerifyPhone(_ context.Context, userID, phone string) error {
	if strings.TrimSpace(userID) == "" {
		return ErrNotSubmitted
	}
	phone = strings.TrimSpace(phone)
	if len(phone) < 8 || len(phone) > 16 {
		return errors.New("phone number must be between 8 and 16 characters")
	}
	if !strings.HasPrefix(phone, "+") {
		return errors.New("phone number must be in E.164 format, starting with +")
	}
	for _, r := range phone[1:] {
		if r < '0' || r > '9' {
			return errors.New("phone number must contain only digits after the leading +")
		}
	}
	return nil
}

// LevelLimits describes what a level permits.
type LevelLimits struct {
	Level                int     `json:"level"`
	Name                 string  `json:"name"`
	DepositLimitDaily    float64 `json:"depositLimitDaily"`
	WithdrawalLimitDaily float64 `json:"withdrawalLimitDaily"`
	TradingLimitDaily    float64 `json:"tradingLimitDaily"`
	RequiresSelfie       bool    `json:"requiresSelfie"`
	RequiresLiveness     bool    `json:"requiresLiveness"`
	RequiresAddressProof bool    `json:"requiresAddressProof"`
}

// Limits returns the published limits for a level.
func Limits(level int) LevelLimits {
	switch level {
	case LevelEmail:
		return LevelLimits{Level: LevelEmail, Name: "Email verified", DepositLimitDaily: 1000}
	case LevelPhone:
		return LevelLimits{Level: LevelPhone, Name: "Phone verified", DepositLimitDaily: 1000, WithdrawalLimitDaily: 1000}
	case LevelBasic:
		return LevelLimits{Level: LevelBasic, Name: "Basic", DepositLimitDaily: 3000, WithdrawalLimitDaily: 10000, TradingLimitDaily: 10000, RequiresSelfie: true}
	case LevelIntermediate:
		return LevelLimits{Level: LevelIntermediate, Name: "Intermediate", DepositLimitDaily: 50000, WithdrawalLimitDaily: 50000, TradingLimitDaily: 100000, RequiresSelfie: true, RequiresLiveness: true}
	case LevelFull:
		return LevelLimits{Level: LevelFull, Name: "Full", DepositLimitDaily: 1000000, WithdrawalLimitDaily: 1000000, TradingLimitDaily: 10000000, RequiresSelfie: true, RequiresLiveness: true, RequiresAddressProof: true}
	default:
		return LevelLimits{Level: LevelNone, Name: "Unverified"}
	}
}
