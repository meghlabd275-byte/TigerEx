// =============================================================================
// TIGEREX AML COMPLIANCE SERVICE
// Anti-Money Laundering compliance and monitoring
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// RiskLevel represents transaction risk assessment
type RiskLevel string

const (
	RiskLevelLow     RiskLevel = "LOW"
	RiskLevelMedium  RiskLevel = "MEDIUM"
	RiskLevelHigh    RiskLevel = "HIGH"
	RiskLevelCritical RiskLevel = "CRITICAL"
)

// TransactionType represents type of transaction
type TransactionType string

const (
	TransactionTypeDeposit    TransactionType = "DEPOSIT"
	TransactionTypeWithdrawal TransactionType = "WITHDRAWAL"
	TransactionTypeTransfer   TransactionType = "TRANSFER"
	TransactionTypeExchange  TransactionType = "EXCHANGE"
)

// TransactionStatus represents transaction status
type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "PENDING"
	TransactionStatusApproved  TransactionStatus = "APPROVED"
	TransactionStatusRejected TransactionStatus = "REJECTED"
	TransactionStatusFlagged  TransactionStatus = "FLAGGED"
	TransactionStatusBlocked  TransactionStatus = "BLOCKED"
)

// Transaction represents a financial transaction
type Transaction struct {
	ID              string            `json:"id"`
	UserID         string            `json:"userId"`
	Type           TransactionType   `json:"type"`
	Asset          string            `json:"asset"`
	Amount         *big.Int         `json:"amount"`
	FromAddress    string            `json:"fromAddress"`
	ToAddress      string            `json:"toAddress"`
	RiskScore      float64          `json:"riskScore"`
	RiskLevel      RiskLevel        `json:"riskLevel"`
	Status         TransactionStatus `json:"status"`
	Timestamp      time.Time        `json:"timestamp"`
	BlockchainTxHash string         `json:"blockchainTxHash"`
	IPAddress      string            `json:"ipAddress"`
	DeviceFingerprint string        `json:"deviceFingerprint"`
	KYCVerified    bool              `json:"kycVerified"`
	Flags          []string         `json:"flags"`
}

// Wallet represents a user wallet
type Wallet struct {
	ID             string             `json:"id"`
	UserID         string             `json:"userId"`
	Address        string             `json:"address"`
	Chain          string             `json:"chain"`
	Balance        *big.Int          `json:"balance"`
	RiskScore      float64           `json:"riskScore"`
	RiskLevel      RiskLevel         `json:"riskLevel"`
	FirstSeen      time.Time         `json:"firstSeen"`
	LastSeen       time.Time          `json:"lastSeen"`
	TransactionCount int64           `json:"transactionCount"`
	TotalVolume    *big.Int         `json:"totalVolume"`
	Tags           []string          `json:"tags"`
	IsWhitelisted  bool              `json:"isWhitelisted"`
	IsBlacklisted  bool              `json:"isBlacklisted"`
}

// Alert represents a compliance alert
type Alert struct {
	ID            string          `json:"id"`
	Type          string          `json:"type"`
	Severity      RiskLevel       `json:"severity"`
	UserID        string          `json:"userId"`
	TransactionID string          `json:"transactionId"`
	Description   string          `json:"description"`
	Timestamp     time.Time      `json:"timestamp"`
	Status        string          `json:"status"`
	ResolvedAt   *time.Time      `json:"resolvedAt"`
	ResolvedBy   string          `json:"resolvedBy"`
}

// Rule represents an AML rule
type Rule struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Type        string     `json:"type"`
	Condition   string     `json:"condition"`
	Threshold   *big.Int  `json:"threshold"`
	RiskWeight  float64   `json:"riskWeight"`
	Enabled     bool      `json:"enabled"`
}

// =============================================================================
// AML SERVICE
// =============================================================================

// AMLService handles AML compliance
type AMLService struct {
	mu            sync.RWMutex
	rules         map[string]*Rule
	transactions  map[string]*Transaction
	wallets       map[string]*Wallet
	alerts        map[string]*Alert
	
	// Risk scoring weights
	weights struct {
		largeTransaction float64
		rapidMovement    float64
		highFrequency    float64
		unknownWallet    float64
		highRiskCountry  float64
		pepAssociation   float64
		sanctioned      float64
	}
	
	// Thresholds
	thresholds struct {
		largeTransaction *big.Int
		rapidMovement     time.Duration
		highFrequency     int
		maxRiskScore     float64
	}
	
	// Known high-risk addresses (would be from external feeds in production)
	highRiskAddresses map[string]bool
	
	// PEP (Politically Exposed Persons) list
	pepAddresses map[string]bool
	
	// Sanctioned addresses
	sanctionedAddresses map[string]bool
}

// NewAMLService creates new AML service
func NewAMLService() *AMLService {
	svc := &AMLService{
		rules:            make(map[string]*Rule),
		transactions:    make(map[string]*Transaction),
		wallets:         make(map[string]*Wallet),
		alerts:          make(map[string]*Alert),
		highRiskAddresses: make(map[string]bool),
		pepAddresses:     make(map[string]bool),
		sanctionedAddresses: make(map[string]bool),
	}
	
	// Initialize weights
	svc.weights = struct {
		largeTransaction float64
		rapidMovement    float64
		highFrequency    float64
		unknownWallet    float64
		highRiskCountry  float64
		pepAssociation   float64
		sanctioned      float64
	}{
		largeTransaction: 30.0,
		rapidMovement:    20.0,
		highFrequency:    15.0,
		unknownWallet:    25.0,
		highRiskCountry:  35.0,
		pepAssociation:   40.0,
		sanctioned:       100.0,
	}
	
	// Initialize thresholds
	svc.thresholds = struct {
		largeTransaction *big.Int
		rapidMovement     time.Duration
		highFrequency     int
		maxRiskScore     float64
	}{
		largeTransaction: big.NewInt(10000), // $10,000
		rapidMovement:    time.Minute * 10, // 10 minutes
		highFrequency:    10,                // 10 transactions
		maxRiskScore:     70.0,
	}
	
	// Load default rules
	svc.loadDefaultRules()
	
	return svc
}

// loadDefaultRules loads default AML rules
func (s *AMLService) loadDefaultRules() {
	rules := []*Rule{
		{
			ID:          "LARGE_TX",
			Name:        "Large Transaction",
			Type:        "AMOUNT",
			Condition:   "amount > 10000",
			Threshold:   big.NewInt(10000),
			RiskWeight:  30.0,
			Enabled:     true,
		},
		{
			ID:          "RAPID_MOVEMENT",
			Name:        "Rapid Fund Movement",
			Type:        "VELOCITY",
			Condition:   "time < 10min",
			Threshold:   big.NewInt(0),
			RiskWeight:  20.0,
			Enabled:     true,
		},
		{
			ID:          "HIGH_FREQUENCY",
			Name:        "High Frequency Trading",
			Type:        "FREQUENCY",
			Condition:   "tx_count > 10",
			Threshold:   big.NewInt(10),
			RiskWeight:  15.0,
			Enabled:     true,
		},
		{
			ID:          "NEW_WALLET",
			Name:        "New Wallet Large Transfer",
			Type:        "AGE",
			Condition:   "age < 24h AND amount > 5000",
			Threshold:   big.NewInt(5000),
			RiskWeight:  25.0,
			Enabled:     true,
		},
		{
			ID:          "PEPPERED",
			Name:        "PEP Association",
			Type:        "WATCHLIST",
			Condition:   "address in PEP list",
			Threshold:   big.NewInt(0),
			RiskWeight:  40.0,
			Enabled:     true,
		},
		{
			ID:          "SANCTIONED",
			Name:        "Sanctioned Address",
			Type:        "WATCHLIST",
			Condition:   "address in sanctions list",
			Threshold:   big.NewInt(0),
			RiskWeight:  100.0,
			Enabled:     true,
		},
	}
	
	for _, rule := range rules {
		s.rules[rule.ID] = rule
	}
}

// AnalyzeTransaction analyzes a transaction for AML risk
func (s *AMLService) AnalyzeTransaction(ctx context.Context, tx *Transaction) (*Transaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Calculate risk score
	riskScore := s.calculateRiskScore(tx)
	tx.RiskScore = riskScore
	
	// Determine risk level
	tx.RiskLevel = s.determineRiskLevel(riskScore)
	
	// Determine status based on risk level
	switch tx.RiskLevel {
	case RiskLevelLow:
		tx.Status = TransactionStatusApproved
	case RiskLevelMedium:
		tx.Status = TransactionStatusPending
		tx.Flags = append(tx.Flags, "REVIEW_REQUIRED")
	case RiskLevelHigh:
		tx.Status = TransactionStatusFlagged
		tx.Flags = append(tx.Flags, "MANUAL_REVIEW_REQUIRED")
		s.createAlert(tx, "HIGH_RISK", tx.RiskLevel)
	case RiskLevelCritical:
		tx.Status = TransactionStatusBlocked
		tx.Flags = append(tx.Flags, "BLOCKED_HIGH_RISK")
		s.createAlert(tx, "CRITICAL_RISK", tx.RiskLevel)
	}
	
	// Store transaction
	s.transactions[tx.ID] = tx
	
	return tx, nil
}

// calculateRiskScore calculates risk score for a transaction
func (s *AMLService) calculateRiskScore(tx *Transaction) float64 {
	score := 0.0
	
	// Check amount
	if s.thresholds.largeTransaction.Cmp(tx.Amount) <= 0 {
		score += s.weights.largeTransaction
		tx.Flags = append(tx.Flags, "LARGE_TRANSACTION")
	}
	
	// Check wallet risk
	wallet, exists := s.wallets[tx.FromAddress]
	if exists {
		// Check wallet age
		age := time.Since(wallet.FirstSeen)
		if age < 24*time.Hour && s.thresholds.largeTransaction.Cmp(tx.Amount) <= 0 {
			score += s.weights.unknownWallet
			tx.Flags = append(tx.Flags, "NEW_WALLET_LARGE_TX")
		}
		
		// Check transaction frequency
		if wallet.TransactionCount > int64(s.thresholds.highFrequency) {
			score += s.weights.highFrequency
			tx.Flags = append(tx.Flags, "HIGH_FREQUENCY")
		}
		
		// Add wallet risk score
		score += wallet.RiskScore
		
		// Check if wallet is flagged
		if wallet.IsBlacklisted {
			score += s.weights.sanctioned
			tx.Flags = append(tx.Flags, "BLACKLISTED_WALLET")
		}
	}
	
	// Check high-risk addresses
	if s.highRiskAddresses[tx.FromAddress] {
		score += 30.0
		tx.Flags = append(tx.Flags, "HIGH_RISK_ADDRESS")
	}
	
	// Check PEP list
	if s.pepAddresses[tx.FromAddress] {
		score += s.weights.pepAssociation
		tx.Flags = append(tx.Flags, "PEP_ASSOCIATED")
	}
	
	// Check sanctions
	if s.sanctionedAddresses[tx.FromAddress] {
		score += s.weights.sanctioned
		tx.Flags = append(tx.Flags, "SANCTIONED")
	}
	
	// Cap at 100
	if score > 100 {
		score = 100
	}
	
	return score
}

// determineRiskLevel determines risk level from score
func (s *AMLService) determineRiskLevel(score float64) RiskLevel {
	switch {
	case score >= 80:
		return RiskLevelCritical
	case score >= 50:
		return RiskLevelHigh
	case score >= 25:
		return RiskLevelMedium
	default:
		return RiskLevelLow
	}
}

// createAlert creates an alert for high-risk transaction
func (s *AMLService) createAlert(tx *Transaction, alertType string, severity RiskLevel) {
	alert := &Alert{
		ID:            generateAlertID(),
		Type:          alertType,
		Severity:      severity,
		UserID:        tx.UserID,
		TransactionID: tx.ID,
		Description:   fmt.Sprintf("Transaction %s has %s risk (score: %.2f)", tx.ID, severity, tx.RiskScore),
		Timestamp:     time.Now(),
		Status:        "OPEN",
	}
	
	s.alerts[alert.ID] = alert
}

// GetWalletRisk assesses risk for a wallet address
func (s *AMLService) GetWalletRisk(ctx context.Context, address string) (*Wallet, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	wallet, exists := s.wallets[address]
	if !exists {
		// Create new wallet entry
		wallet = &Wallet{
			ID:             generateWalletID(),
			Address:        address,
			FirstSeen:      time.Now(),
			LastSeen:       time.Now(),
			TransactionCount: 0,
			TotalVolume:    big.NewInt(0),
		}
		s.wallets[address] = wallet
	}
	
	// Calculate risk score
	riskScore := s.calculateWalletRiskScore(wallet)
	wallet.RiskScore = riskScore
	wallet.RiskLevel = s.determineRiskLevel(riskScore)
	
	return wallet, nil
}

// calculateWalletRiskScore calculates risk score for a wallet
func (s *AMLService) calculateWalletRiskScore(wallet *Wallet) float64 {
	score := 0.0
	
	// Check age
	age := time.Since(wallet.FirstSeen)
	if age < 7*24*time.Hour {
		score += 20.0
	}
	
	// Check transaction count
	if wallet.TransactionCount > 100 {
		score += 15.0
	}
	
	// Check volume
	if wallet.TotalVolume.Cmp(big.NewInt(1000000)) > 0 { // > $1M
		score += 20.0
	}
	
	// Check tags
	for _, tag := range wallet.Tags {
		switch tag {
		case "high_risk":
			score += 30.0
		case "gambling":
			score += 15.0
		case "mixer":
			score += 40.0
		case "darknet":
			score += 50.0
		}
	}
	
	// Check blacklist
	if wallet.IsBlacklisted {
		score = 100.0
	}
	
	// Check whitelist (reduces risk)
	if wallet.IsWhitelisted {
		score -= 20.0
	}
	
	// Cap
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	
	return score
}

// AddToWatchlist adds an address to watchlist
func (s *AMLService) AddToWatchlist(address, listType, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	switch listType {
	case "high_risk":
		s.highRiskAddresses[address] = true
	case "pep":
		s.pepAddresses[address] = true
	case "sanctioned":
		s.sanctionedAddresses[address] = true
	default:
		return fmt.Errorf("unknown list type: %s", listType)
	}
	
	// Update wallet if exists
	if wallet, exists := s.wallets[address]; exists {
		wallet.Tags = append(wallet.Tags, listType)
		if listType == "sanctioned" {
			wallet.IsBlacklisted = true
		}
	}
	
	return nil
}

// GetAlerts returns all open alerts
func (s *AMLService) GetAlerts(status string) []*Alert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Alert
	for _, alert := range s.alerts {
		if status == "" || alert.Status == status {
			result = append(result, alert)
		}
	}
	
	return result
}

// ResolveAlert resolves an alert
func (s *AMLService) ResolveAlert(alertID, resolvedBy, resolution string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	alert, exists := s.alerts[alertID]
	if !exists {
		return fmt.Errorf("alert not found: %s", alertID)
	}
	
	now := time.Now()
	alert.Status = "RESOLVED"
	alert.ResolvedAt = &now
	alert.ResolvedBy = resolvedBy
	
	return nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func generateAlertID() string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	return "ALERT-" + hex.EncodeToString(hash[:8])
}

func generateWalletID() string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	return "WALLET-" + hex.EncodeToString(hash[:8])
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx AML Compliance Service")
	fmt.Println("================================")
	
	// Create AML service
	aml := NewAMLService()
	
	// Add some test watchlist entries
	aml.AddToWatchlist("0x1234567890abcdef", "high_risk", "Suspicious activity")
	aml.AddToWatchlist("0xabcdef1234567890", "sanctioned", "Sanctioned address")
	
	// Create test transaction
	tx := &Transaction{
		ID:              "TX-TEST-001",
		UserID:          "USER-001",
		Type:            TransactionTypeDeposit,
		Asset:           "BTC",
		Amount:          big.NewInt(15000), // $15,000
		FromAddress:     "0x1234567890abcdef",
		ToAddress:       "0xtigerex123456789",
		Timestamp:       time.Now(),
		KYCVerified:     true,
	}
	
	// Analyze transaction
	result, err := aml.AnalyzeTransaction(context.Background(), tx)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	
	fmt.Printf("\nTransaction Analysis:\n")
	fmt.Printf("  ID: %s\n", result.ID)
	fmt.Printf("  Amount: %s BTC\n", result.Amount.String())
	fmt.Printf("  Risk Score: %.2f\n", result.RiskScore)
	fmt.Printf("  Risk Level: %s\n", result.RiskLevel)
	fmt.Printf("  Status: %s\n", result.Status)
	fmt.Printf("  Flags: %v\n", result.Flags)
	
	// Get alerts
	alerts := aml.GetAlerts("")
	fmt.Printf("\nOpen Alerts: %d\n", len(alerts))
	
	for _, alert := range alerts {
		fmt.Printf("  - [%s] %s: %s\n", alert.Severity, alert.Type, alert.Description)
	}
}
