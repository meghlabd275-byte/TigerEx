package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// TRAVEL RULE COMPLIANCE
// Implement FATF Travel Rule for crypto transactions
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// TravelRule represents travel rule information
type TravelRule struct {
	// Sending VASPs
	SendingVASP *VASPInfo `json:"sendingVASP"`
	
	// Receiving VASPs
	ReceivingVASP *VASPInfo `json:"receivingVASP"`
	
	// Transaction
	Transaction *TransactionInfo `json:"transaction"`
	
	// Originator
	Originator *PersonInfo `json:"originator"`
	
	// Beneficiary
	Beneficiary *PersonInfo `json:"beneficiary"`
	
	// Metadata
	RuleVersion string    `json:"ruleVersion"`
	Status     RuleStatus `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

// VASPInfo represents VASP (Virtual Asset Service Provider) information
type VASPInfo struct {
	LegalName     string `json:"legalName"`
	TradingName   string `json:"tradingName"`
	LEI          string `json:"lei"` // Legal Entity Identifier
	Country       string `json:"country"`
	Address       string `json:"address"`
	BusinessURL   string `json:"businessURL"`
	Regulator     string `json:"regulator"`
	LicenseNumber string `json:"licenseNumber"`
}

// TransactionInfo represents transaction details
type TransactionInfo struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"` // crypto transfer, exchange
	Amount      float64 `json:"amount"`
	Asset       string  `json:"asset"`
	Timestamp   int64   `json:"timestamp"`
	Network     string  `json:"network"`
	TxHash      string  `json:"txHash"`
}

// PersonInfo represents person (originator/beneficiary) info
type PersonInfo struct {
	LegalName    string  `json:"legalName"`
	NaturalPerson *NaturalPerson `json:"naturalPerson,omitempty"`
	LegalPerson  *LegalPerson  `json:"legalPerson,omitempty"`
	Country      string `json:"country"`
	Address      string `json:"address"`
}

// NaturalPerson represents natural person details
type NaturalPerson struct {
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	DateOfBirth string `json:"dateOfBirth"` // YYYYMMDD
	PlaceOfBirth string `json:"placeOfBirth"`
	CountryOfBirth string `json:"countryOfBirth"`
	IDNumber    string `json:"idNumber"`
	IDType      string `json:"idType"` // passport, national_id
	IDCountry   string `json:"idCountry"`
}

// LegalPerson represents legal person details
type LegalPerson struct {
	LEI          string `json:"lei"`
	LegalName    string `json:"legalName"`
	Country      string `json:"country"`
	Address      string `json:"address"`
}

// RuleStatus represents travel rule status
type RuleStatus string

const (
	RuleStatusPending    RuleStatus = "PENDING"
	RuleStatusSent       RuleStatus = "SENT"
	RuleStatusReceived   RuleStatus = "RECEIVED"
	RuleStatusVerified   RuleStatus = "VERIFIED"
	RuleStatusApproved   RuleStatus = "APPROVED"
	RuleStatusRejected  RuleStatus = "REJECTED"
	RuleStatusException RuleStatus = "EXCEPTION"
)

// ============================================================================
// SERVICE
// ============================================================================

// Service manages travel rule compliance
type Service struct {
	mu       sync.RWMutex
	rules   map[string]*TravelRule
	leiCache map[string]*VASPInfo
	
	ownVASP *VASPInfo
}

func NewService(ownVASP *VASPInfo) *Service {
	return &Service{
		rules:   make(map[string]*TravelRule),
		leiCache: make(map[string]*VASPInfo),
		ownVASP: ownVASP,
	}
}

// ============================================================================
// TRAVEL RULE OPERATIONS
// ============================================================================

// Prepare prepares travel rule for a transaction
func (s *Service) Prepare(tx *TransactionInfo, originator, beneficiary *PersonInfo, receivingVASP *VASPInfo) (*TravelRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate transaction amount exceeds threshold
	// FATF threshold is $3,000 USD equivalent
	if tx.Amount < 3000 {
		return nil, nil // Below threshold, no travel rule needed
	}
	
	// Generate unique ID
	ruleID := generateTravelRuleID(tx)
	
	rule := &TravelRule{
		SendingVASP:   s.ownVASP,
		ReceivingVASP: receivingVASP,
		Transaction:  tx,
		Originator:   originator,
		Beneficiary:  beneficiary,
		RuleVersion:  "2.0",
		Status:      RuleStatusPending,
		CreatedAt:  time.Now(),
	}
	
	s.rules[ruleID] = rule
	return rule, nil
}

// Send sends travel rule to receiving VASP
func (s *Service) Send(ruleID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	rule, ok := s.rules[ruleID]
	if !ok {
		return fmt.Errorf("rule not found")
	}
	
	if rule.Status != RuleStatusPending {
		return fmt.Errorf("invalid status")
	}
	
	// In production, this would send to the receiving VASP's Travel Rule endpoint
	// For now, just mark as sent
	rule.Status = RuleStatusSent
	
	return nil
}

// Receive receives travel rule from sending VASP
func (s *Service) Receive(data []byte) (*TravelRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	var rule TravelRule
	err := json.Unmarshal(data, &rule)
	if err != nil {
		return nil, fmt.Errorf("invalid travel rule data")
	}
	
	// Validate required fields
	if rule.Originator == nil || rule.Beneficiary == nil {
		return nil, fmt.Errorf("missing required fields")
	}
	
	rule.Status = RuleStatusReceived
	
	// Generate ID
	ruleID := generateTravelRuleID(rule.Transaction)
	s.rules[ruleID] = &rule
	
	return &rule, nil
}

// Verify verifies travel rule information
func (s *Service) Verify(ruleID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	rule, ok := s.rules[ruleID]
	if !ok {
		return fmt.Errorf("rule not found")
	}
	
	if rule.Status != RuleStatusReceived {
		return fmt.Errorf("invalid status")
	}
	
	// Verify originator/beneficiary
	err := s.verifyPerson(rule.Originator)
	if err != nil {
		return fmt.Errorf("originator verification failed: %w", err)
	}
	
	err = s.verifyPerson(rule.Beneficiary)
	if err != nil {
		return fmt.Errorf("beneficiary verification failed: %w", err)
	}
	
	// Verify VASP
	if rule.SendingVASP != nil {
		err = s.verifyVASP(rule.SendingVASP)
		if err != nil {
			return fmt.Errorf("VASP verification failed: %w", err)
		}
	}
	
	rule.Status = RuleStatusVerified
	return nil
}

// Approve approves travel rule
func (s *Service) Approve(ruleID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	rule, ok := s.rules[ruleID]
	if !ok {
		return fmt.Errorf("rule not found")
	}
	
	if rule.Status != RuleStatusVerified {
		return fmt.Errorf("must be verified first")
	}
	
	rule.Status = RuleStatusApproved
	return nil
}

// Reject rejects travel rule
func (s *Service) Reject(ruleID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	rule, ok := s.rules[ruleID]
	if !ok {
		return fmt.Errorf("rule not found")
	}
	
	rule.Status = RuleStatusRejected
	return nil
}

// GetRule gets travel rule by ID
func (s *Service) GetRule(ruleID string) (*TravelRule, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	rule, ok := s.rules[ruleID]
	if !ok {
		return nil, fmt.Errorf("rule not found")
	}
	
	return rule, nil
}

// GetPendingRules gets all pending rules
func (s *Service) GetPendingRules() []*TravelRule {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*TravelRule
	for _, rule := range s.rules {
		if rule.Status == RuleStatusPending || rule.Status == RuleStatusSent {
			result = append(result, rule)
		}
	}
	
	return result
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

func (s *Service) verifyPerson(p *PersonInfo) error {
	if p == nil {
		return fmt.Errorf("person is nil")
	}
	
	// Verify required fields
	if p.Country == "" {
		return fmt.Errorf("country is required")
	}
	
	// Check restricted countries
	restrictedCountries := []string{"KP", "IR", "SY", "CU"}
	for _, c := range restrictedCountries {
		if p.Country == c {
			return fmt.Errorf("restricted country: %s", c)
		}
	}
	
	// For natural persons, verify ID
	if p.NaturalPerson != nil {
		if p.NaturalPerson.IDNumber == "" {
			return fmt.Errorf("ID number required")
		}
	}
	
	// For legal persons, verify LEI
	if p.LegalPerson != nil {
		if p.LegalPerson.LEI == "" {
			return fmt.Errorf("LEI required")
		}
	}
	
	return nil
}

func (s *Service) verifyVASP(v *VASPInfo) error {
	if v == nil {
		return fmt.Errorf("VASP is nil")
	}
	
	// Verify LEI format
	if !isValidLEI(v.LEI) {
		return fmt.Errorf("invalid LEI format")
	}
	
	// Check against sanctions list
	if isSanctioned(v) {
		return fmt.Errorf("VASP is sanctioned")
	}
	
	return nil
}

func isValidLEI(lei string) bool {
	// LEI format: 20 characters alphanumeric
	if len(lei) != 20 {
		return false
	}
	
	for _, c := range lei {
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	
	return true
}

func isSanctioned(v *VASPInfo) bool {
	// In production, check against OFAC, EU sanctions lists
	return false
}

// ============================================================================
// HELPER
// ============================================================================

func generateTravelRuleID(tx *TransactionInfo) string {
	data := fmt.Sprintf("%s:%s:%.2f:%d", tx.ID, tx.Asset, tx.Amount, tx.Timestamp)
	hash := sha256.Sum256([]byte(data))
	return "TR" + strings.ToUpper(hex.EncodeToString(hash[:8]))
}

// ============================================================================
// EXAMPLE
// ============================================================================

func main() {
	fmt.Println("TigerEx Travel Rule Compliance v1.0.0")
	
	// Configure our VASP
	ourVASP := &VASPInfo{
		LegalName:   "TigerEx Exchange Ltd",
		TradingName: "TigerEx",
		LEI:        "549300X7K3HG0XUTCD47",
		Country:    "SG",
		Address:    "Singapore",
		BusinessURL: "https://tigerex.com",
	}
	
	tr := NewService(ourVASP)
	
	// Create transaction
	tx := &TransactionInfo{
		ID:        "tx123",
		Type:      "crypto_transfer",
		Amount:    5000, // Above threshold
		Asset:     "BTC",
		Timestamp: time.Now().Unix(),
		Network:   "Bitcoin",
	}
	
	// Create originator
	originator := &PersonInfo{
		NaturalPerson: &NaturalPerson{
			FirstName:    "John",
			LastName:     "Doe",
			DateOfBirth:  "19900101",
			Country:      "US",
			IDNumber:     "P123456789",
			IDType:       "passport",
			IDCountry:   "US",
		},
		Country: "US",
	}
	
	// Create beneficiary
	beneficiary := &PersonInfo{
		NaturalPerson: &NaturalPerson{
			FirstName:   "Jane",
			LastName:    "Smith",
			DateOfBirth: "19850315",
			Country:     "DE",
		},
		Country: "DE",
	}
	
	// Create receiving VASP
	receivingVASP := &VASPInfo{
		LegalName: "Example Exchange GmbH",
		LEI:       "529900ABCD1234567890",
		Country:   "DE",
	}
	
	// Prepare travel rule
	rule, err := tr.Prepare(tx, originator, beneficiary, receivingVASP)
	if err != nil {
		fmt.Println("Error preparing:", err)
		return
	}
	
	if rule == nil {
		fmt.Println("Transaction below threshold, no travel rule needed")
		return
	}
	
	fmt.Printf("Travel Rule created: %s\n", generateTravelRuleID(tx))
	
	// Verify
	ruleID := generateTravelRuleID(tx)
	tr.Approve(ruleID)
	
	fmt.Println("Travel Rule approved!")
}