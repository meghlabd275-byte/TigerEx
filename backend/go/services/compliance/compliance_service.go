// TigerEx Compliance Service
// Regulatory compliance and reporting

package compliance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrReportGeneratorNotConfigured is returned when a report is requested but no
// generator is configured. The service must not report a completed report that
// was never produced.
var ErrReportGeneratorNotConfigured = errors.New("report generator is not configured; refusing to report a report that was not produced")

// ReportGenerator produces a report artefact for a type and period. The
// implementation is supplied by the operator; this package never fabricates a
// report body or a completion status.
type ReportGenerator interface {
	Generate(ctx context.Context, reportType, period string) (filePath string, err error)
}

type License struct {
	ID           string    `json:"id"`
	Country      string    `json:"country"`
	Type         string    `json:"type"`
	Number       string    `json:"number"`
	IssueDate    time.Time `json:"issue_date"`
	ExpiryDate   time.Time `json:"expiry_date"`
	Status       string    `json:"status"`
	Jurisdiction string    `json:"jurisdiction"`
}

type Report struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Period      string    `json:"period"`
	Status      string    `json:"status"`
	FilePath    string    `json:"file_path"`
	GeneratedAt time.Time `json:"generated_at"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type ComplianceRequirement struct {
	ID          string    `json:"id"`
	Regulation  string    `json:"regulation"`
	Requirement string    `json:"requirement"`
	Category    string    `json:"category"`
	Status      string    `json:"status"`
	DueDate     time.Time `json:"due_date"`
	CompletedAt time.Time `json:"completed_at"`
}

type TravelRuleTransaction struct {
	ID            string    `json:"id"`
	TransactionID string    `json:"transaction_id"`
	FromUserID    string    `json:"from_user_id"`
	FromName      string    `json:"from_name"`
	FromAddress   string    `json:"from_address"`
	ToUserID      string    `json:"to_user_id"`
	ToName        string    `json:"to_name"`
	ToAddress     string    `json:"to_address"`
	Amount        float64   `json:"amount"`
	Currency      string    `json:"currency"`
	Status        string    `json:"status"`
	IVMS101Data   string    `json:"ivms101_data"`
	SubmittedAt   time.Time `json:"submitted_at"`
}

type ProofOfReserve struct {
	ID              string    `json:"id"`
	Asset           string    `json:"asset"`
	ExchangeBalance float64   `json:"exchange_balance"`
	ColdStorage     float64   `json:"cold_storage"`
	HotWallet       float64   `json:"hot_wallet"`
	NetBalance      float64   `json:"net_balance"`
	MerkleRoot      string    `json:"merkle_root"`
	Timestamp       time.Time `json:"timestamp"`
}

type ComplianceManager struct {
	mu              sync.RWMutex
	licenses        []License
	reports         map[string]*Report
	requirements    []ComplianceRequirement
	travelRules     map[string]*TravelRuleTransaction
	proofOfReserves []ProofOfReserve
	generator       ReportGenerator
}

// NewComplianceManager returns an empty manager. Licences and regulatory
// requirements are operator-held records and are loaded from the operator's
// system of record; the manager never seeds placeholder licences or deadlines
// that could be mistaken for the exchange's real regulatory position.
func NewComplianceManager() *ComplianceManager {
	return &ComplianceManager{
		reports:         make(map[string]*Report),
		travelRules:     make(map[string]*TravelRuleTransaction),
		proofOfReserves: make([]ProofOfReserve, 0),
	}
}

// SetReportGenerator installs the report producer. Until one is installed,
// GenerateReport fails closed.
func (cm *ComplianceManager) SetReportGenerator(g ReportGenerator) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.generator = g
}

// AddRequirement records a regulatory requirement from the operator.
func (cm *ComplianceManager) AddRequirement(req ComplianceRequirement) error {
	if req.Regulation == "" || req.Requirement == "" {
		return errors.New("regulation and requirement must not be empty")
	}
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.requirements = append(cm.requirements, req)
	return nil
}

func (cm *ComplianceManager) GetLicenses() []License {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.licenses
}

func (cm *ComplianceManager) GetLicense(licenseID string) (*License, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	for _, license := range cm.licenses {
		if license.ID == licenseID {
			return &license, nil
		}
	}
	return nil, errors.New("license not found")
}

func (cm *ComplianceManager) AddLicense(license License) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cm.licenses = append(cm.licenses, license)
	return nil
}

func (cm *ComplianceManager) GenerateReport(reportType, period string) (*Report, error) {
	cm.mu.Lock()
	generator := cm.generator
	cm.mu.Unlock()

	if generator == nil {
		return nil, ErrReportGeneratorNotConfigured
	}

	// Generate the artefact outside the lock: report generation can be slow and
	// must not block unrelated compliance operations.
	filePath, err := generator.Generate(context.Background(), reportType, period)
	if err != nil {
		return nil, fmt.Errorf("report generation failed: %w", err)
	}

	now := time.Now()
	report := &Report{
		ID:          fmt.Sprintf("RPT%d%d", now.Unix(), now.Nanosecond()),
		Type:        reportType,
		Period:      period,
		Status:      "completed",
		FilePath:    filePath,
		GeneratedAt: now,
	}

	cm.mu.Lock()
	cm.reports[report.ID] = report
	cm.mu.Unlock()
	return report, nil
}

func (cm *ComplianceManager) GetReport(reportID string) (*Report, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	report, exists := cm.reports[reportID]
	if !exists {
		return nil, errors.New("report not found")
	}
	return report, nil
}

func (cm *ComplianceManager) GetReports(limit int) []*Report {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	reports := make([]*Report, 0, len(cm.reports))
	for _, r := range cm.reports {
		reports = append(reports, r)
	}

	if limit > 0 && len(reports) > limit {
		reports = reports[:limit]
	}

	return reports
}

func (cm *ComplianceManager) GetRequirements() []ComplianceRequirement {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.requirements
}

func (cm *ComplianceManager) UpdateRequirementStatus(reqID, status string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	for i, req := range cm.requirements {
		if req.ID == reqID {
			cm.requirements[i].Status = status
			if status == "completed" {
				cm.requirements[i].CompletedAt = time.Now()
			}
			return nil
		}
	}
	return errors.New("requirement not found")
}

func (cm *ComplianceManager) ProcessTravelRule(tx *TravelRuleTransaction) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Validate required fields
	if tx.FromUserID == "" || tx.ToUserID == "" {
		return errors.New("missing required traveler rule fields")
	}

	tx.ID = fmt.Sprintf("TRV%d%d", time.Now().Unix(), time.Now().Nanosecond())
	tx.Status = "pending"
	tx.SubmittedAt = time.Now()

	cm.travelRules[tx.ID] = tx
	return nil
}

func (cm *ComplianceManager) GetTravelRule(txID string) (*TravelRuleTransaction, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	tx, exists := cm.travelRules[txID]
	if !exists {
		return nil, errors.New("travel rule transaction not found")
	}
	return tx, nil
}

func (cm *ComplianceManager) SubmitTravelRule(txID string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	tx, exists := cm.travelRules[txID]
	if !exists {
		return errors.New("travel rule transaction not found")
	}

	tx.Status = "submitted"
	return nil
}

func (cm *ComplianceManager) GenerateProofOfReserve(asset string, exchangeBalance, coldStorage, hotWallet float64) (*ProofOfReserve, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	now := time.Now()
	por := &ProofOfReserve{
		ID:              fmt.Sprintf("POR%d%d", now.Unix(), now.Nanosecond()),
		Asset:           asset,
		ExchangeBalance: exchangeBalance,
		ColdStorage:     coldStorage,
		HotWallet:       hotWallet,
		NetBalance:      exchangeBalance - coldStorage - hotWallet,
		MerkleRoot:      proofOfReserveRoot(asset, exchangeBalance, coldStorage, hotWallet),
		Timestamp:       now,
	}

	cm.proofOfReserves = append(cm.proofOfReserves, *por)
	return por, nil
}

func (cm *ComplianceManager) GetProofOfReserves(asset string) []ProofOfReserve {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	var reserves []ProofOfReserve
	for _, por := range cm.proofOfReserves {
		if asset == "" || por.Asset == asset {
			reserves = append(reserves, por)
		}
	}
	return reserves
}

func (cm *ComplianceManager) GetLatestProofOfReserve(asset string) (*ProofOfReserve, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	var latest *ProofOfReserve
	for i := range cm.proofOfReserves {
		if cm.proofOfReserves[i].Asset == asset {
			if latest == nil || cm.proofOfReserves[i].Timestamp.After(latest.Timestamp) {
				latest = &cm.proofOfReserves[i]
			}
		}
	}

	if latest == nil {
		return nil, errors.New("no proof of reserves found")
	}
	return latest, nil
}

func (cm *ComplianceManager) GetComplianceStatus() map[string]interface{} {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	completed := 0
	pending := 0
	inProgress := 0

	for _, req := range cm.requirements {
		switch req.Status {
		case "completed":
			completed++
		case "pending":
			pending++
		case "in_progress":
			inProgress++
		}
	}

	return map[string]interface{}{
		"total_licenses":     len(cm.licenses),
		"active_licenses":    countActiveLicenses(cm.licenses),
		"total_requirements": len(cm.requirements),
		"completed":          completed,
		"pending":            pending,
		"in_progress":        inProgress,
		"reports_generated":  len(cm.reports),
	}
}

func countActiveLicenses(licenses []License) int {
	count := 0
	for _, l := range licenses {
		if l.Status == "active" {
			count++
		}
	}
	return count
}

// proofOfReserveRoot hashes the reserve figures into a deterministic
// commitment. The same balances always produce the same root, so a published
// root can be independently recomputed by an auditor from the same numbers.
func proofOfReserveRoot(asset string, exchangeBalance, coldStorage, hotWallet float64) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%.18g|%.18g|%.18g", asset, exchangeBalance, coldStorage, hotWallet)
	return hex.EncodeToString(h.Sum(nil))
}
