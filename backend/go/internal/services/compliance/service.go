package services

import (
	"context"
	"time"
)

// ComplianceService handles KYC/AML
type ComplianceService struct {
	// In real implementation, inject database
}

func NewComplianceService() *ComplianceService {
	return &ComplianceService{}
}

type KYCStatus struct {
	Level    int    `json:"level"`
	Status   string `json:"status"` // pending, submitted, approved, rejected
	RejectedReason string `json:"rejected_reason,omitempty"`
	SubmittedAt int64 `json:"submitted_at,omitempty"`
	ReviewedAt int64 `json:"reviewed_at,omitempty"`
}

type KYCDocument struct {
	Type          string `json:"type"` // passport, national_id, driver_license
	Number        string `json:"number"`
	IssueCountry  string `json:"issued_country"`
	ExpiryDate   int64  `json:"expiry_date,omitempty"`
}

type KYCSubmission struct {
	UserID     string      `json:"user_id"`
	Document  KYCDocument `json:"document"`
	Selfie    string     `json:"selfie_image"`
	ProofAddr string     `json:"proof_of_address,omitempty"`
}

type AMLCheck struct {
	ID              string   `json:"id"`
	UserID          string   `json:"user_id"`
	Timestamp      int64    `json:"timestamp"`
	RiskScore      int      `json:"risk_score"`
	RiskLevel      string   `json:"risk_level"` // low, medium, high, critical
	PEPStatus     bool     `json:"pep_status"`
	SanctionsScreening string `json:"sanctions_screening"` // clear, match
	AdverseMedia  bool     `json:"adverse_media"`
	FlaggedActivities []string `json:"flagged_activities"`
}

type TravelRule struct {
	SenderAddress      string `json:"sender_address"`
	SenderCountry    string `json:"sender_country"`
	SenderFI        string `json:"sender_financial_institution"`
	ReceiverAddress string `json:"receiver_address"`
	ReceiverCountry string `json:"receiver_country"`
	ReceiverFI     string `json:"receiver_financial_institution"`
	Amount         string `json:"amount"`
	Currency       string `json:"currency"`
}

type ComplianceConfig struct {
	LevelConfigs []struct {
		Level            int    `json:"level"`
		Name            string `json:"name"`
		DepositLimit    string `json:"deposit_limit"`
		WithdrawalLimit string `json:"withdrawal_limit"`
		TradingEnabled bool   `json:"trading_enabled"`
		FiatEnabled   bool   `json:"fiat_enabled"`
	} `json:"kyc_levels"`
	AMLThreshold        string   `json:"aml_threshold"`
	TravelRuleThreshold string   `json:"travel_rule_threshold"`
	RestrictedCountries []string `json:"restricted_countries"`
}

// Submit KYC documents
func (s *ComplianceService) SubmitKYC(ctx context.Context, submission KYCSubmission) (*KYCStatus, error) {
	status := &KYCStatus{
		Level:      1,
		Status:    "submitted",
		SubmittedAt: time.Now().Unix(),
	}
	return status, nil
}

// Get KYC status
func (s *ComplianceService) GetKYCStatus(ctx context.Context, userID string) (*KYCStatus, error) {
	return &KYCStatus{
		Level:    2,
		Status:   "approved",
		ReviewedAt: time.Now().Add(-24 * time.Hour).Unix(),
	}, nil
}

// Run AML check
func (s *ComplianceService) RunAMLCheck(ctx context.Context, userID string) (*AMLCheck, error) {
	return &AMLCheck{
		ID:                "aml_" + userID,
		UserID:            userID,
		Timestamp:        time.Now().Unix(),
		RiskScore:        15,
		RiskLevel:        "low",
		PEPStatus:       false,
		SanctionsScreening: "clear",
		AdverseMedia:    false,
		FlaggedActivities: []string{},
	}, nil
}

// Submit travel rule
func (s *ComplianceService) SubmitTravelRule(ctx context.Context, transactionID string, rule TravelRule) error {
	return nil
}

// Get travel rule requirement
func (s *ComplianceService) GetTravelRule(ctx context.Context, transactionID, amount string) (*TravelRule, bool) {
	threshold := float64(10000)
	if amountFloat := parseAmount(amount); amountFloat >= threshold {
		return &TravelRule{}, true
	}
	return nil, false
}

func parseAmount(amount string) float64 {
	// Simple parse - in real code use proper decimal parsing
	return 0
}

// Get compliance config
func (s *ComplianceService) GetConfig(ctx context.Context) (*ComplianceConfig, error) {
	config := &ComplianceConfig{
		AMLThreshold:        "10000",
		TravelRuleThreshold: "10000",
		RestrictedCountries: []string{"KP", "IR", "SY"},
	}

	config.LevelConfigs = []struct {
		Level            int
		Name            string
		DepositLimit    string
		WithdrawalLimit string
		TradingEnabled bool
		FiatEnabled   bool
	}{
		{Level: 1, Name: "Basic", DepositLimit: "1000", WithdrawalLimit: "1000", TradingEnabled: true, FiatEnabled: false},
		{Level: 2, Name: "Intermediate", DepositLimit: "10000", WithdrawalLimit: "5000", TradingEnabled: true, FiatEnabled: true},
		{Level: 3, Name: "Advanced", DepositLimit: "100000", WithdrawalLimit: "50000", TradingEnabled: true, FiatEnabled: true},
		{Level: 4, Name: "Unlimited", DepositLimit: "unlimited", WithdrawalLimit: "unlimited", TradingEnabled: true, FiatEnabled: true},
	}

	return config, nil
}

// Check restricted country
func (s *ComplianceService) IsRestrictedCountry(countryCode string) bool {
	restricted := map[string]bool{
		"KP": true, // North Korea
		"IR": true, // Iran
		"SY": true, // Syria
		"CU": true, // Cuba
	}
	return restricted[countryCode]
}

// Validate transaction limits
func (s *ComplianceService) ValidateLimits(ctx context.Context, userID, amount, txType string, kycLevel int) (bool, string) {
	limits := map[int]map[string]string{
		1: {"deposit": "1000", "withdrawal": "1000"},
		2: {"deposit": "10000", "withdrawal": "5000"},
		3: {"deposit": "100000", "withdrawal": "50000"},
		4: {"deposit": "999999999", "withdrawal": "999999999"},
	}

	levelLimits, ok := limits[kycLevel]
	if !ok {
		return false, "Invalid KYC level"
	}

	limit := levelLimits[txType]
	if limit == "999999999" { // unlimited
		return true, ""
	}

	return false, limit + " limit reached"
}