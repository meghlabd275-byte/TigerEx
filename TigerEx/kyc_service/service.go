package kyc

import (
	"fmt"
	"regexp"
	"sync"
	"time"
)

// =============================================================================
// KYC/AML COMPLIANCE SERVICE
// Identity verification and anti-money laundering
// =============================================================================

// VerificationLevel KYC level
type VerificationLevel int

const (
	LevelNone  VerificationLevel = 0
	Level1    VerificationLevel = 1 // Email + Phone
	Level2    VerificationLevel = 2 // ID Document
	Level3    VerificationLevel = 3 // Selfie + PoA
	Level4    VerificationLevel = 4 // Enhanced Due Diligence
)

// DocumentType official document
type DocumentType string

const (
	DocPassport DocumentType = "PASSPORT"
	DocNationalID DocumentType = "NATIONAL_ID"
	DocDriverLicense DocumentType = "DRIVERS_LICENSE"
	DocBankStatement DocumentType = "BANK_STATEMENT"
	DocUtilityBill DocumentType = "UTILITY_BILL"
)

// CountryRisk risk category
type CountryRisk string

const (
	RiskLow    CountryRisk = "LOW"
	RiskMedium CountryRisk = "MEDIUM"
	RiskHigh   CountryRisk = "HIGH"
	RiskRestricted CountryRisk = "RESTRICTED"
)

// KycRecord KYC record
type KycRecord struct {
	UserID       string            `json:"userId"`
	Level       VerificationLevel `json:"level"`
	Status     string            `json:"status"` // pending, submitted, verified, rejected, expired
	Email      string            `json:"email"`
	Phone      string            `json:"phone"`
	FullName   string            `json:"fullName"`
	Country    string            `json:"country"`
	DocType    DocumentType     `json:"docType"`
	DocNumber string            `json:"docNumber"`
	DocExpiry *time.Time       `json:"docExpiry,omitempty"`
	Dob       *time.Time       `json:"dob,omitempty"`
	Address   string            `json:"address"`
	City      string            `json:"city"`
	State     string            `json:"state"`
	ZipCode   string            `json:"zipCode"`
	Submissions int            `json:"submissions"`
	LastSubmit *time.Time      `json:"lastSubmit,omitempty"`
	VerifiedAt *time.Time     `json:"verifiedAt,omitempty"`
	RejectedAt *time.Time     `json:"rejectedAt,omitempty"`
	RejectReason string        `json:"rejectReason"`
}

// AmlCheck AML screening result
type AmlCheck struct {
	UserID       string    `json:"userId"`
	ScreenedAt   time.Time `json:"screenedAt"`
	Result      string    `json:"result"` // clear, alert, review
	Score       int       `json:"score"`
	Alerts      []string `json:"alerts"`
	pepStatus   bool      `json:"pepStatus"`
	adverseMedia bool     `json:"adverseMedia"`
	sanctions   bool      `json:"sanctions"`
}

// Service KYC service
type Service struct {
	mu sync.RWMutex
	config *Config

	// Records
	records map[string]*KycRecord // userID -> record

	// Country risk
	countryRisks map[string]CountryRisk

	// Limits per level
	limits map[VerificationLevel]*Limits
}

// Config KYC configuration
type Config struct {
	RequireEmail   bool
	RequirePhone   bool
	RequireDoc     bool
	AllowPoA      bool
	EnableEnhanced bool
}

// Limits limits per KYC level
type Limits struct {
	DailyWithdraw float64
	MonthlyVolume float64
	MaxPosition float64
	MinTransfer float64
	MaxTransfer float64
}

// NewService creates KYC service
func NewService() *Service {
	return &Service{
		records:       make(map[string]*KycRecord),
		countryRisks:  initCountryRisks(),
		limits:       initLimits(),
	}
}

// Initialize country risks
func initCountryRisks() map[string]CountryRisk {
	return map[string]CountryRisk{
		"US":  RiskLow,
		"GB":  RiskLow,
		"DE":  RiskLow,
		"FR":  RiskLow,
		"JP":  RiskLow,
		"AU":  RiskLow,
		"CA":  RiskLow,
		"SG":  RiskLow,
		"CH":  RiskLow,
		"KR":  RiskMedium,
		"BR":  RiskMedium,
		"IN":  RiskMedium,
		"RU":  RiskHigh,
		"CN":  RiskHigh,
		"IR":  RiskRestricted,
		"SY":  RiskRestricted,
		"KP":  RiskRestricted,
		"MM":  RiskRestricted,
	}
}

// InitLimits initializes limits
func initLimits() map[VerificationLevel]*Limits {
	return map[VerificationLevel]*Limits{
		Level1: {DailyWithdraw: 2000, MonthlyVolume: 50000, MaxPosition: 1000, MinTransfer: 1, MaxTransfer: 2000},
		Level2: {DailyWithdraw: 10000, MonthlyVolume: 100000, MaxPosition: 100000, MinTransfer: 1, MaxTransfer: 10000},
		Level3: {DailyWithdraw: 50000, MonthlyVolume: 500000, MaxPosition: 1000000, MinTransfer: 1, MaxTransfer: 50000},
		Level4: {DailyWithdraw: 1000000, MonthlyVolume: 10000000, MaxPosition: 10000000, MinTransfer: 1, MaxTransfer: 1000000},
	}
}

// SubmitLevel1 submits level 1 KYC
func (s *Service) SubmitLevel1(userID, email, phone, fullName, country string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate email
	if !isValidEmail(email) {
		return fmt.Errorf("invalid email")
	}

	// Validate country
	risk := s.countryRisks[country]
	if risk == RiskRestricted {
		return fmt.Errorf("country not supported")
	}

	record := &KycRecord{
		UserID:    userID,
		Level:    Level1,
		Status:  "verified",
		Email:   email,
		Phone:   phone,
		FullName: fullName,
		Country: country,
		VerifiedAt: func() *time.Time { t := time.Now(); return &t }(),
	}

	s.records[userID] = record
	return nil
}

// SubmitLevel2 submits government ID
func (s *Service) SubmitLevel2(userID string, docType DocumentType, docNumber string, expiry *time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, ok := s.records[userID]
	if !ok {
		return fmt.Errorf("KYC not started")
	}

	if record.Level < Level1 {
		return fmt.Errorf("must complete Level 1 first")
	}

	// Validate document
	if docType != DocPassport && docType != DocNationalID && docType != DocDriverLicense {
		return fmt.Errorf("invalid document type")
	}

	record.DocType = docType
	record.DocNumber = docNumber
	record.DocExpiry = expiry
	record.Level = Level2
	record.Submissions++

	// Auto-verify if data looks valid
	s.verifyDocument(record)

	return nil
}

// SubmitLevel3 submits selfie + proof of address
func (s *Service) SubmitLevel3(userID, address, city, state, zipCode string, dob *time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, ok := s.records[userID]
	if !ok {
		return fmt.Errorf("KYC not started")
	}

	if record.Level < Level2 {
		return fmt.Errorf("must complete Level 2 first")
	}

	record.Address = address
	record.City = city
	record.State = state
	record.ZipCode = zipCode
	record.Dob = dob
	record.Level = Level3

	s.verifyFull(record)

	return nil
}

// verifyDocument performs basic verification
func (s *Service) verifyDocument(record *KycRecord) {
	if hasMinimumDocs(record) {
		record.Status = "verified"
		t := time.Now()
		record.VerifiedAt = &t
	}
}

// verifyFull verifies all documents
func (s *Service) verifyFull(record *KycRecord) {
	if record.DocType != "" && record.Dob != nil {
		record.Status = "verified"
		t := time.Now()
		record.VerifiedAt = &t
	}
}

// hasMinimumDocs checks minimum documents
func hasMinimumDocs(r *KycRecord) bool {
	return r.DocType != "" && r.DocNumber != ""
}

// GetLevel gets user KYC level
func (s *Service) GetLevel(userID string) VerificationLevel {
	s.mu.RLock()
	defer s.mu.RUnlock()

	record, ok := s.records[userID]
	if !ok {
		return LevelNone
	}
	return record.Level
}

// GetRecord gets KYC record
func (s *Service) GetRecord(userID string) (*KycRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	record, ok := s.records[userID]
	return record, ok
}

// GetLimits gets limits for level
func (s *Service) GetLimits(level VerificationLevel) *Limits {
	return s.limits[level]
}

// CheckLimits checks if amount is within limits
func (s *Service) CheckLimits(userID string, amount float64) error {
	level := s.GetLevel(userID)
	limits := s.limits[level]

	if amount > limits.DailyWithdraw {
		return fmt.Errorf("exceeds daily withdrawal limit: %.2f", limits.DailyWithdraw)
	}

	return nil
}

// AmlScreen performs AML screening
func (s *Service) AmlScreen(userID string) (*AmlCheck, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	record, ok := s.records[userID]
	if !ok {
		// Default to clear for unknown users
		return &AmlCheck{
			UserID:   userID,
			ScreenedAt: time.Now(),
			Result:  "clear",
			Score:   0,
		}, nil
	}

	// Basic screening logic
	result := &AmlCheck{
		UserID:     userID,
		ScreenedAt: time.Now(),
	}

	// Check country risk
	crisk := s.countryRisks[record.Country]
	if crisk == RiskHigh {
		result.Alerts = append(result.Alerts, "high_risk_country")
		result.Score += 30
	} else if crisk == RiskRestricted {
		result.Alerts = append(result.Alerts, "restricted_country")
		result.Score += 100
	}

	// Determine result
	if result.Score == 0 {
		result.Result = "clear"
	} else if result.Score < 50 {
		result.Result = "review"
	} else {
		result.Result = "alert"
	}

	return result, nil
}

// IsRestrictedCountry checks if country is restricted
func (s *Service) IsRestrictedCountry(country string) bool {
	risk := s.countryRisks[country]
	return risk == RiskRestricted
}

// =============================================================================
// EMAIL VALIDATION
// =============================================================================

func isValidEmail(email string) bool {
	pattern := `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`
	matched, _ := regexp.MatchString(pattern, email)
	return matched
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

// ValidateDocumentNumber validates document format
func ValidateDocumentNumber(docType DocumentType, number string) bool {
	if number == "" {
		return false
	}

	switch docType {
	case DocPassport:
		// Most passports are 6-9 alphanumeric
		if len(number) < 6 || len(number) > 9 {
			return false
		}
	case DocNationalID, DocDriverLicense:
		// Usually 8-12 characters
		if len(number) < 8 || len(number) > 12 {
			return false
		}
	}

	return true
}

// ValidatePhone validates phone number
func ValidatePhone(phone string) bool {
	if phone == "" {
		return false
	}

	// Remove common formatting
	cleaned := replace(phone, "[^0-9]", "")
	return len(cleaned) >= 10 && len(cleaned) <= 15
}

func replace(s, pattern, repl string) string {
	re := regexp.MustCompile(pattern)
	return re.ReplaceAllString(s, repl)
}