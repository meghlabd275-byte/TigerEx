// TigerEx Compliance Service
// Regulatory compliance and reporting

package compliance

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

type License struct {
	ID          string    `json:"id"`
	Country     string    `json:"country"`
	Type        string    `json:"type"`
	Number      string    `json:"number"`
	IssueDate   time.Time `json:"issue_date"`
	ExpiryDate  time.Time `json:"expiry_date"`
	Status      string    `json:"status"`
	Jurisdiction string   `json:"jurisdiction"`
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
	DueDate    time.Time `json:"due_date"`
	CompletedAt time.Time `json:"completed_at"`
}

type TravelRuleTransaction struct {
	ID              string    `json:"id"`
	TransactionID  string    `json:"transaction_id"`
	FromUserID     string    `json:"from_user_id"`
	FromName       string    `json:"from_name"`
	FromAddress    string    `json:"from_address"`
	ToUserID       string    `json:"to_user_id"`
	ToName         string    `json:"to_name"`
	ToAddress      string    `json:"to_address"`
	Amount         float64   `json:"amount"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	IVMS101Data    string    `json:"ivms101_data"`
	SubmittedAt    time.Time `json:"submitted_at"`
}

type ProofOfReserve struct {
	ID          string    `json:"id"`
	Asset      string    `json:"asset"`
	ExchangeBalance float64 `json:"exchange_balance"`
	ColdStorage float64   `json:"cold_storage"`
	HotWallet   float64   `json:"hot_wallet"`
	NetBalance  float64   `json:"net_balance"`
	MerkleRoot string    `json:"merkle_root"`
	Timestamp   time.Time `json:"timestamp"`
}

type ComplianceManager struct {
	mu       sync.RWMutex
	licenses []License
	reports  map[string]*Report
	requirements []ComplianceRequirement
	travelRules map[string]*TravelRuleTransaction
	proofOfReserves []ProofOfReserve
}

func NewComplianceManager() *ComplianceManager {
	cm := &ComplianceManager{
		reports:            make(map[string]*Report),
		travelRules:        make(map[string]*TravelRuleTransaction),
		proofOfReserves:    make([]ProofOfReserve, 0),
	}
	cm.initializeLicenses()
	cm.initializeRequirements()
	return cm
}

func (cm *ComplianceManager) initializeLicenses() {
	cm.licenses = []License{
		{ID: "LIC001", Country: "US", Type: "MTL", Number: "MSB-2024-001", IssueDate: time.Now().AddDate(0, -6, 0), ExpiryDate: time.Now().AddDate(1, 0, 0), Status: "active", Jurisdiction: "USA"},
		{ID: "LIC002", Country: "EU", Type: "DL", Number: "DL-2024-EU-001", IssueDate: time.Now().AddDate(0, -6, 0), ExpiryDate: time.Now().AddDate(1, 0, 0), Status: "active", Jurisdiction: "European Union"},
		{ID: "LIC003", Country: "SG", Type: "PSA", Number: "PSA-2024-SG-001", IssueDate: time.Now().AddDate(0, -6, 0), ExpiryDate: time.Now().AddDate(1, 0, 0), Status: "active", Jurisdiction: "Singapore"},
	}
}

func (cm *ComplianceManager) initializeRequirements() {
	cm.requirements = []ComplianceRequirement{
		{ID: "REQ001", Regulation: "FATF", Requirement: "Travel Rule Implementation", Category: "AML", Status: "in_progress", DueDate: time.Now().AddDate(0, 3, 0)},
		{ID: "REQ002", Regulation: "GDPR", Requirement: "Data Protection Policy", Category: "Privacy", Status: "completed", CompletedAt: time.Now().AddDate(0, -1, 0)},
		{ID: "REQ003", Regulation: "MiCA", Requirement: "Crypto Asset Service Provider Registration", Category: "Licensing", Status: "pending", DueDate: time.Now().AddDate(0, 6, 0)},
	}
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
	defer cm.mu.Unlock()

	now := time.Now()
	report := &Report{
		ID:           fmt.Sprintf("RPT%d%d", now.Unix(), now.Nanosecond()),
		Type:         reportType,
		Period:       period,
		Status:       "generating",
		GeneratedAt:  now,
	}

	cm.reports[report.ID] = report

	// Simulate report generation
	report.Status = "completed"

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
		ID:             fmt.Sprintf("POR%d%d", now.Unix(), now.Nanosecond()),
		Asset:          asset,
		ExchangeBalance: exchangeBalance,
		ColdStorage:    coldStorage,
		HotWallet:      hotWallet,
		NetBalance:     exchangeBalance - coldStorage - hotWallet,
		MerkleRoot:     generateMerkleRoot(asset),
		Timestamp:      now,
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
		"total_licenses":      len(cm.licenses),
		"active_licenses":    countActiveLicenses(cm.licenses),
		"total_requirements": len(cm.requirements),
		"completed":          completed,
		"pending":            pending,
		"in_progress":        inProgress,
		"reports_generated": len(cm.reports),
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

func generateMerkleRoot(asset string) string {
	// Simplified merkle root generation
	// In production, this would use actual merkle tree
	return fmt.Sprintf("MERKLE-%s-%d", asset, time.Now().Unix())
}
