// Package compliance provides AML and regulatory services
package compliance

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"tigerex/backend/internal/api"
)

var ErrNotFound = errors.New("not found")

// ErrSanctionsScreenerNotConfigured is returned when a sanctions check is
// requested but no screening backend is configured. Clearing a party without
// screening them would be a fail-open compliance decision, so the check is
// refused instead of reported as "clear".
var ErrSanctionsScreenerNotConfigured = errors.New("sanctions screener is not configured; refusing to clear an unscreened party")

// ErrReportGeneratorNotConfigured is returned when a report is requested but
// no generator is configured. A report that was never produced must not be
// reported as generated.
var ErrReportGeneratorNotConfigured = errors.New("report generator is not configured; refusing to report a report that was not produced")

// SanctionsScreener checks a party against sanctions lists. The implementation
// is supplied by the operator (OFAC/EU/UN/UK-HMT feeds); this package never
// fabricates a screening result.
type SanctionsScreener interface {
	Screen(ctx context.Context, name, address, country string) (matchedLists []string, err error)
}

// ReportGenerator produces a report artefact for a type and period.
type ReportGenerator interface {
	Generate(ctx context.Context, reportType string) (url string, err error)
}

type Config struct {
	ChainalysisAPIKey string
	EllipticAPIKey    string
	TravelRuleEnabled bool
	// Screener performs the actual sanctions matching. A nil screener makes
	// CheckSanctions fail closed rather than clear a party it never checked.
	Screener SanctionsScreener
	// Reports generates report artefacts. A nil generator makes GenerateReport
	// fail closed.
	Reports ReportGenerator
}

type Transaction struct {
	ID          string
	UserID      string
	Type        string
	Asset       string
	Amount      float64
	FromAddress string
	ToAddress   string
	RiskScore   float64
	Status      string
	CheckedAt   int64
}

type SanctionsCheck struct {
	ID          string
	UserID      string
	Name        string
	Address     string
	Country     string
	Result      string
	MatchedList []string
	CheckedAt   int64
}

type TravelRule struct {
	ID            string
	TransactionID string
	FromWallet    string
	FromName      string
	FromLegalName string
	FromCountry   string
	FromAddress   string
	ToWallet      string
	ToName        string
	ToLegalName   string
	ToCountry     string
	ToAddress     string
	Amount        float64
	Asset         string
	Status        string
}

type AuditRecord struct {
	ID        string
	UserID    string
	Action    string
	Details   string
	IPAddress string
	Timestamp int64
}

type Service struct {
	config       Config
	transactions map[string]*Transaction
	sanctions    map[string]*SanctionsCheck
	travelRules  map[string]*TravelRule
	suspicious   map[string]*SuspiciousActivity
	auditLog     []*AuditRecord
}

func NewService(config Config) *Service {
	return &Service{
		config:       config,
		transactions: make(map[string]*Transaction),
		sanctions:    make(map[string]*SanctionsCheck),
		travelRules:  make(map[string]*TravelRule),
		suspicious:   make(map[string]*SuspiciousActivity),
		auditLog:     make([]*AuditRecord, 0),
	}
}

func (s *Service) CheckTransaction(ctx context.Context, userID, txType, asset string, amount float64, fromAddr, toAddr string) (*Transaction, error) {
	tx := &Transaction{
		ID:          uuid.New().String(),
		UserID:      userID,
		Type:        txType,
		Asset:       asset,
		Amount:      amount,
		FromAddress: fromAddr,
		ToAddress:   toAddr,
		RiskScore:   s.calculateRiskScore(amount, asset),
		Status:      "pending",
		CheckedAt:   api.Now(),
	}
	s.transactions[tx.ID] = tx
	return tx, nil
}

func (s *Service) calculateRiskScore(amount float64, asset string) float64 {
	score := 0.0
	if amount > 10000 {
		score += 30
	}
	if amount > 50000 {
		score += 40
	}
	switch asset {
	case "BTC":
		if amount > 1 {
			score += 20
		}
	case "ETH":
		if amount > 10 {
			score += 20
		}
	}
	return score
}

func (s *Service) GetTransaction(txID string) (*Transaction, error) {
	tx, ok := s.transactions[txID]
	if !ok {
		return nil, ErrNotFound
	}
	return tx, nil
}

func (s *Service) CheckSanctions(ctx context.Context, userID, name, address, country string) (*SanctionsCheck, error) {
	if s.config.Screener == nil {
		return nil, ErrSanctionsScreenerNotConfigured
	}
	matched, err := s.config.Screener.Screen(ctx, name, address, country)
	if err != nil {
		return nil, fmt.Errorf("sanctions screening failed: %w", err)
	}
	check := &SanctionsCheck{
		ID:        uuid.New().String(),
		UserID:    userID,
		Name:      name,
		Address:   address,
		Country:   country,
		Result:    "clear",
		CheckedAt: api.Now(),
	}
	if len(matched) > 0 {
		check.Result = "match"
		check.MatchedList = matched
	}
	s.sanctions[check.ID] = check
	return check, nil
}

func (s *Service) ProcessTravelRule(ctx context.Context, txID, fromWallet, fromName, fromCountry, fromAddr, toWallet, toName, toCountry, toAddr string, amount float64, asset string) (*TravelRule, error) {
	rule := &TravelRule{
		ID:            uuid.New().String(),
		TransactionID: txID,
		FromWallet:    fromWallet,
		FromName:      fromName,
		FromCountry:   fromCountry,
		FromAddress:   fromAddr,
		ToWallet:      toWallet,
		ToName:        toName,
		ToCountry:     toCountry,
		ToAddress:     toAddr,
		Amount:        amount,
		Asset:         asset,
		Status:        "pending",
	}
	s.travelRules[rule.ID] = rule
	return rule, nil
}

func (s *Service) GetTravelRules(userID string) []*TravelRule {
	result := make([]*TravelRule, 0)
	for _, r := range s.travelRules {
		if r.FromWallet == userID || r.ToWallet == userID {
			result = append(result, r)
		}
	}
	return result
}

func (s *Service) LogAction(userID, action, details, ipAddress string) {
	record := &AuditRecord{
		ID:        uuid.New().String(),
		UserID:    userID,
		Action:    action,
		Details:   details,
		IPAddress: ipAddress,
		Timestamp: api.Now(),
	}
	s.auditLog = append(s.auditLog, record)
}

func (s *Service) GetAuditLog(userID string, limit int) []*AuditRecord {
	if limit <= 0 {
		limit = 100
	}
	result := make([]*AuditRecord, 0)
	count := 0
	for i := len(s.auditLog) - 1; i >= 0 && count < limit; i-- {
		if s.auditLog[i].UserID == userID {
			result = append(result, s.auditLog[i])
			count++
		}
	}
	return result
}

type ReportRequest struct {
	UserID    string
	Type      string
	StartDate int64
	EndDate   int64
	Status    string
}

type GeneratedReport struct {
	ID          string
	UserID      string
	Type        string
	URL         string
	GeneratedAt int64
	ExpiresAt   int64
}

func (s *Service) GenerateReport(ctx context.Context, req *ReportRequest) (*GeneratedReport, error) {
	if s.config.Reports == nil {
		return nil, ErrReportGeneratorNotConfigured
	}
	url, err := s.config.Reports.Generate(ctx, req.Type)
	if err != nil {
		return nil, fmt.Errorf("report generation failed: %w", err)
	}
	if url == "" {
		return nil, ErrReportGeneratorNotConfigured
	}
	report := &GeneratedReport{
		ID:          uuid.New().String(),
		UserID:      req.UserID,
		Type:        req.Type,
		URL:         url,
		GeneratedAt: api.Now(),
		ExpiresAt:   api.Now() + 7*24*3600,
	}
	return report, nil
}

type SuspiciousActivity struct {
	ID          string
	UserID      string
	Type        string
	Description string
	Amount      float64
	Status      string
	ReportedAt  int64
	ResolvedAt  int64
}

func (s *Service) ReportSuspiciousActivity(ctx context.Context, userID, desc string, amount float64) (*SuspiciousActivity, error) {
	activity := &SuspiciousActivity{
		ID:          uuid.New().String(),
		UserID:      userID,
		Description: desc,
		Amount:      amount,
		Status:      "open",
		ReportedAt:  api.Now(),
	}
	s.suspicious[activity.ID] = activity
	return activity, nil
}

// GetSuspiciousActivity returns a previously reported case, or ErrNotFound.
func (s *Service) GetSuspiciousActivity(id string) (*SuspiciousActivity, error) {
	activity, ok := s.suspicious[id]
	if !ok {
		return nil, ErrNotFound
	}
	return activity, nil
}
