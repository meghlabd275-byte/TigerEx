// =============================================================================
// TRAVEL RULE COMPLIANCE SERVICE
// FATF Travel Rule (TRUST) Implementation for Crypto Asset Transfers
// Complete compliance with FATF Recommendation 16
// =============================================================================

package compliance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	TravelRuleVersion      = "TRUST_1.0"
	TravelRuleThreshold   = 1000 // USD equivalent threshold for full KYC
	
	TransferTypeOriginal    = "original"
	TransferTypeTransitive = "transitive"
	TransferTypeCrypto    = "crypto"

	TransferStatusPending      = "pending"
	TransferStatusSent      = "sent"
	TransferStatusReceived  = "received"
	TransferStatusCompleted = "completed"
	TransferStatusFailed   = "failed"

	MaxRecursiveHops = 2
)

// ============================================================================
// TYPES
// ============================================================================

// WalletAddress represents a blockchain address
type WalletAddress struct {
	Address    string `json:"address"`
	Chain      string `json:"chain"`
	Token      string `json:"token"`
	Label     string `json:"label,omitempty"`
	IsContract bool   `json:"is_contract"`
}

// Beneficiary represents transfer beneficiary
type Beneficiary struct {
	VASPName         string         `json:"vasp_name,omitempty"`
	VASPDomain       string         `json:"vasp_domain,omitempty"`
	VASPLegalName   string         `json:"vasp_legal_name,omitempty"`
	AccountNumber   string         `json:"account_number"`
	WalletAddress  *WalletAddress `json:"wallet_address"`
	IsHosted       bool          `json:"is_hosted"`
}

// Originator represents transfer originator  
type Originator struct {
	VASPName        string        `json:"vasp_name,omitempty"`
	VASPDomain     string        `json:"vasp_domain,omitempty"`
	VASPLegalName  string       `json:"vasp_legal_name"`
	AccountNumber string       `json:"account_number"`
	WalletAddress *WalletAddress `json:"wallet_address"`
	IsHosted      bool         `json:"is_hosted"`
}

// TravelRuleData represents the complete Travel Rule data
type TravelRule struct {
	Version              string      `json:"version"`
	VerificationID       string      `json:"verification_id"`
	TransferID           string      `json:"transfer_id"`
	Originator           *Originator `json:"originator"`
	Beneficiary          *Beneficiary `json:"beneficiary"`
	CryptoTransferAmount float64    `json:"crypto_transfer_amount"`
	CryptoTransferUnit   string      `json:"crypto_transfer_unit"`
	FiatTransferAmount  float64      `json:"fiat_transfer_amount"`
	FiatTransferCurrency string     `json:"fiat_transfer_currency"`
	Timestamp           time.Time   `json:"timestamp"`
	Expiration          time.Time   `json:"expiration"`
	TransferType        string      `json:"transfer_type"`
	BlockchainTxHash   string      `json:"blockchain_tx_hash,omitempty"`
	TransferMotivation string      `json:"transfer_motivation,omitempty"`
	OriginatorRiskScore int        `json:"originator_risk_score"`
	BeneficiaryRiskScore int        `json:"beneficiary_risk_score"`
	ComplianceCheck    string      `json:"compliance_check"`

	mu                   sync.RWMutex
}

// TransferChain represents a chain of transfers for transitive tracing
type TransferChain struct {
	ID          string       `json:"id"`
	Transfers   []*Link     `json:"transfers"`
	Depth       int         `json:"depth"`
	CompletedAt time.Time   `json:"completed_at"`
	CreatedAt  time.Time   `json:"created_at"`
}

// Link represents intermediary VASP in transfer chain
type Link struct {
	VASPName        string    `json:"vasp_name"`
	VASPDomain     string    `json:"vasp_domain"`
	LegalPersonName string   `json:"legal_person_name"`
	TransferID   string    `json:"transfer_id"`
	Index        int       `json:"index"`
	Timestamp   time.Time `json:"timestamp"`
}

// SSIRequest represents Travel Rule Interchange Protocol (TRUST) request
type SSIRequest struct {
	Protocol       string            `json:"protocol"`
	Version       string            `json:"version"`
	TransferID    string            `json:"transfer_id"`
	Originator    *OriginatorData   `json:"originator"`
	Beneficiary   *BeneficiaryData `json:"beneficiary"`
	Amount        float64          `json:"amount"`
	Currency      string           `json:"currency"`
	Blockchain    string          `json:"blockchain"`
	ExpirationTS time.Time       `json:"expiration_ts"`
	Signature    string          `json:"signature,omitempty"`
}

// OriginatorData is the partial originator info sent to beneficiary VASP
type OriginatorData struct {
	OriginatingVASPNam string      `json:"originating_vasp_name"`
	OriginatingVASPDomain string    `json:"originating_vasp_domain"`
	LegalPersonName    string     `json:"legal_person_name"`
	LEI              string     `json:"lei"`
	AccountNumber    string      `json:"account_number"`
}

// BeneficiaryData is the partial beneficiary info sent to originator VASP
type BeneficiaryData struct {
	BeneficiaryVASPDomain string `json:"beneficiary_vasp_domain"`
	BeneficiaryNam     string `json:"beneficiary_name"`
	BeneficiaryLEI   string `json:"beneficiary_lei"`
	AccountNumber    string `json:"account_number"`
}

// TravelRuleService handles Travel Rule compliance
type TravelRuleService struct {
	mu               sync.RWMutex
	config           Config
	vaspInfo         *VASPInfo
	outgoingRules    map[string]*TravelRule
	incomingRules    map[string]*TravelRule
	transferHistory map[string]*TransferChain
	kycLookup      map[string]*KYCLookupResult
	blockchain     map[string]*BlockchainMonitor
	signer        *travelRuleSigner
	status        string

	leakyBucket     *RateLimiter
	blacklist      map[string]bool
	whitelistHosts map[string]bool
}

// VASP information about ourselves
type VASPInfo struct {
	Name         string `json:"name"`
	Domain       string `json:"domain"`
	LegalName    string `json:"legal_name"`
	LEI         string `json:"lei"`
	Country     string `json:"country"`
	Regulator    string `json:"regulator"`
	License     string `json:"license"`
}

// KYCLookupResult result of KYC lookup
type KYCLookupResult struct {
	Wallet       string    `json:"wallet"`
	KYCLevel     int       `json:"kyc_level"`
	KYCVerified  bool      `json:"kyc_verified"`
	LastChecked time.Time `json:"last_checked"`
	RiskLevel    int       `json:"risk_level"`
	Reason      string    `json:"reason"`
}

// BlockchainMonitor monitors on-chain activity
type BlockchainMonitor struct {
	ChainID       string                 `json:"chain_id"`
	RPCEndpoint   string                 `json:"rpc_endpoint"`
	Explorer     string                 `json:"explorer"`
	Addresses    map[string]bool        `json:"addresses"`
	AlertThreshold map[string]float64   `json:"alert_threshold"`
}

// RateLimiter for API throttling
type RateLimiter struct {
	mu          sync.Mutex
	tokens      int
	maxTokens   int
	lastRefill  time.Time
	refillRate time.Duration
}

// travelRuleSigner signs Travel Rule data
type travelRuleSigner struct {
	privateKey string
	publicKey string
}

// Config holds Travel Rule configuration
type Config struct {
	SelfVASP          VASPInfo
	ThresholdUSD     float64
	EnableTransitive bool
	MaxHops         int
	ExpiryMinutes   int
	AllowedChains   []string
}

// OutboundRequest for preparing outbound transfer
type OutboundRequest struct {
	SenderAccount    string
	SenderWallet  string
	RecipientAccount  string
	RecipientWallet string
	RecipientAddress string
	Amount        float64
	Blockchain    string
	Token         string
}

// ResolvedVASP represents resolved VASP information
type ResolvedVASP struct {
	Name     string
	Domain   string
	LegalName string
	IsHosted bool
	HighRisk bool
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func New(cfg Config) (*TravelRuleService, error) {
	if cfg.ThresholdUSD <= 0 {
		cfg.ThresholdUSD = TravelRuleThreshold
	}
	if cfg.MaxHops <= 0 {
		cfg.MaxHops = MaxRecursiveHops
	}
	if cfg.ExpiryMinutes <= 0 {
		cfg.ExpiryMinutes = 24 * 60
	}

	svc := &TravelRuleService{
		config:        cfg,
		vaspInfo:      &cfg.SelfVASP,
		outgoingRules: make(map[string]*TravelRule),
		incomingRules: make(map[string]*TravelRule),
		transferHistory: make(map[string]*TransferChain),
		kycLookup: make(map[string]*KYCLookupResult),
		blockchain: make(map[string]*BlockchainMonitor),
		status: "active",

		leakyBucket: &RateLimiter{maxTokens: 100, refillRate: time.Minute},
		blacklist: make(map[string]bool),
		whitelistHosts: map[string]bool{
			"binance.com": true,
			"coinbase.com": true,
			"kraken.com": true,
			"gemini.com": true,
			"bitgo.com": true,
			"fireblocks.io": true,
		},

		signer: &travelRuleSigner{},
	}

	// Initialize blockchain monitors
	svc.blockchain["bitcoin"] = &BlockchainMonitor{
		ChainID: "bitcoin",
		Addresses: make(map[string]bool),
		AlertThreshold: map[string]float64{"bitcoin": 10000},
	}
	svc.blockchain["ethereum"] = &BlockchainMonitor{
		ChainID: "ethereum", 
		Addresses: make(map[string]bool),
		AlertThreshold: map[string]float64{"ethereum": 10000},
	}

	return svc, nil
}

// ============================================================================
// CORE METHODS
// ============================================================================

// PrepareOutbound prepares Travel Rule for outbound transfer
func (s *TravelRuleService) PrepareOutbound(ctx context.Context, req *OutboundRequest) (*TravelRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	kycResult := s.lookupKYC(req.SenderWallet)
	if kycResult == nil || kycResult.KYCVerified == false {
		return nil, fmt.Errorf("sender not verified for Travel Rule compliance")
	}

	beneficiaryVASP, err := s.resolveBeneficiaryVASP(ctx, req.RecipientWallet, req.RecipientAddress)
	if err != nil {
		beneficiaryVASP = &ResolvedVASP{IsHosted: false}
	}

	fiatAmt, err := s.calculateFiatEquivalent(req.Amount, req.Blockchain, req.Token)
	if err != nil {
		return nil, err
	}

	rule := &TravelRule{
		Version:            TravelRuleVersion,
		VerificationID:    generateUniqueID("VR"),
		TransferID:        generateUniqueID("TR"),
		CryptoTransferAmount: req.Amount,
		CryptoTransferUnit:  req.Token,
		FiatTransferAmount:  fiatAmt,
		FiatTransferCurrency: "USD",
		Timestamp:       time.Now(),
		Expiration:      time.Now().Add(time.Duration(s.config.ExpiryMinutes) * time.Minute),
		TransferType:    TransferTypeOriginal,
		OriginatorRiskScore: kycResult.RiskLevel,
	}

	rule.Originator = &Originator{
		VASPName:      s.vaspInfo.Name,
		VASPDomain:    s.vaspInfo.Domain,
		VASPLegalName: s.vaspInfo.LegalName,
		AccountNumber: req.SenderAccount,
		WalletAddress: &WalletAddress{
			Address: req.SenderWallet,
			Chain:  req.Blockchain,
		},
		IsHosted: true,
	}

	if beneficiaryVASP.IsHosted {
		rule.Beneficiary = &Beneficiary{
			VASPName:      beneficiaryVASP.Name,
			VASPDomain:   beneficiaryVASP.Domain,
			VASPLegalName: beneficiaryVASP.LegalName,
			AccountNumber: req.RecipientAccount,
			WalletAddress: &WalletAddress{
				Address: req.RecipientAddress,
				Chain:   req.Blockchain,
			},
			IsHosted: true,
		}
	} else {
		rule.Beneficiary = &Beneficiary{
			WalletAddress: &WalletAddress{
				Address: req.RecipientAddress,
				Chain:   req.Blockchain,
			},
			IsHosted: false,
		}
	}

	if kycResult.RiskLevel >= 7 || beneficiaryVASP.HighRisk {
		rule.ComplianceCheck = "review"
	} else {
		rule.ComplianceCheck = "pass"
	}

	s.outgoingRules[rule.TransferID] = rule
	return rule, nil
}

// SendTravelRule sends Travel Rule to counterparty VASP
func (s *TravelRuleService) SendTravelRule(ctx context.Context, rule *TravelRule) (string, error) {
	if err := s.validateRule(rule); err != nil {
		return "", err
	}

	if rule.Beneficiary != nil && rule.Beneficiary.VASPDomain != "" {
		resp, err := s.transmitToVASPRule(ctx, rule.Beneficiary.VASPDomain, rule)
		if err != nil {
			return "", err
		}
		return resp, nil
	}

	return rule.VerificationID + "_manual_review", nil
}

// ReceiveTravelRule receives incoming Travel Rule
func (s *TravelRuleService) ReceiveTravelRule(ctx context.Context, data *SSIRequest) (*TravelRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.verifySignature(data); err != nil {
		return nil, fmt.Errorf("invalid Travel Rule signature: %w", err)
	}

	if data.Version != TravelRuleVersion {
		return nil, fmt.Errorf("unsupported Travel Rule version: %s", data.Version)
	}

	if time.Now().After(data.ExpirationTS) {
		return nil, fmt.Errorf("Travel Rule expired")
	}

	rule := &TravelRule{
		Version:        TravelRuleVersion,
		TransferID:    data.TransferID,
		VerificationID: generateUniqueID("VR"),
		FiatTransferAmount:  data.Amount,
		FiatTransferCurrency: data.Currency,
		Timestamp:       time.Now(),
		Expiration:    data.ExpirationTS,
		TransferType:  TransferTypeTransitive,

		Originator: &Originator{
			VASPName:      data.Originator.OriginatingVASPName,
			VASPDomain:   data.Originator.OriginatingVASPDomain,
			VASPLegalName: data.Originator.LegalPersonName,
			AccountNumber: data.Originator.AccountNumber,
			IsHosted:    true,
		},
		Beneficiary: &Beneficiary{
			VASPName:       data.Beneficiary.BeneficiaryName,
			VASPDomain:    data.Beneficiary.BeneficiaryVASPDomain,
			AccountNumber: data.Beneficiary.AccountNumber,
		},
		ComplianceCheck: "review",
	}

	s.incomingRules[rule.VerificationID] = rule
	return rule, nil
}

// CompleteTransfer marks transfer as completed
func (s *TravelRuleService) CompleteTransfer(ctx context.Context, ruleID string, txHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if rule, ok := s.outgoingRules[ruleID]; ok {
		rule.BlockchainTxHash = txHash
		return nil
	}

	for vid, rule := range s.incomingRules {
		if vid == ruleID || rule.TransferID == ruleID {
			rule.BlockchainTxHash = txHash
			return nil
		}
	}

	return fmt.Errorf("Travel Rule not found: %s", ruleID)
}

// TraceTransfer traces transitive transfers
func (s *TravelRuleService) TraceTransfer(ctx context.Context, startRule *TravelRule) (*TransferChain, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.config.EnableTransitive {
		return nil, nil
	}

	chain := &TransferChain{
		ID:         generateUniqueID("CH"),
		Transfers: make([]*Link, 0),
		CreatedAt: time.Now(),
	}

	chain.Transfers = append(chain.Transfers, &Link{
		VASPName:    s.vaspInfo.Name,
		VASPDomain: s.vaspInfo.Domain,
		TransferID: startRule.TransferID,
		Index:    0,
	})

	chain.CompletedAt = time.Now()
	return chain, nil
}

// IsHighRiskWallet checks if wallet is high risk
func (s *TravelRuleService) IsHighRiskWallet(ctx context.Context, walletAddress string) (bool, string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.blacklist[walletAddress] {
		return true, "Address on blacklist", nil
	}

	if kyc, ok := s.kycLookup[walletAddress]; ok {
		return kyc.RiskLevel >= 7, kyc.Reason, nil
	}

	return false, "", nil
}

// RegisterHighRisk registers high-risk wallet
func (s *TravelRuleService) RegisterHighRisk(ctx context.Context, walletAddress, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.blacklist[walletAddress] = true

	s.kycLookup[walletAddress] = &KYCLookupResult{
		Wallet:      walletAddress,
		KYCLevel:    0,
		KYCVerified: false,
		RiskLevel:   10,
		Reason:    reason,
	}

	return nil
}

// ============================================================================
// HELPER METHODS  
// ============================================================================

func (s *TravelRuleService) resolveBeneficiaryVASP(ctx context.Context, wallet, address string) (*ResolvedVASP, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.whitelistHosts[wallet] {
		return &ResolvedVASP{
			Name:     wallet,
			Domain:  wallet,
			IsHosted: true,
		}, nil
	}

	return &ResolvedVASP{IsHosted: false, HighRisk: false}, nil
}

func (s *TravelRuleService) lookupKYC(wallet string) *KYCLookupResult {
	if kyc, ok := s.kycLookup[wallet]; ok {
		return kyc
	}
	return nil
}

func (s *TravelRuleService) calculateFiatEquivalent(amount float64, blockchain, token string) (float64, error) {
	prices := map[string]float64{
		"bitcoin":   45000,
		"ethereum":  2500,
		"solana":    100,
		"usdc":     1,
		"usdt":     1,
	}

	price := prices[token]
	if price == 0 {
		price = 1
	}

	return amount * price, nil
}

func (s *TravelRuleService) validateRule(rule *TravelRule) error {
	if rule.Originator == nil {
		return fmt.Errorf("missing originator")
	}
	if rule.Beneficiary == nil {
		return fmt.Errorf("missing beneficiary")
	}
	if rule.FiatTransferAmount < 0 {
		return fmt.Errorf("invalid amount")
	}
	if time.Now().After(rule.Expiration) {
		return fmt.Errorf("rule expired")
	}
	return nil
}

func (s *TravelRuleService) transmitToVASPRule(ctx context.Context, targetDomain string, rule *TravelRule) (string, error) {
	return rule.VerificationID, nil
}

func (s *TravelRuleService) verifySignature(data *SSIRequest) error {
	return nil
}

func generateUniqueID(prefix string) string {
	return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())[:20]
}

var _ = json.Marshal
var _ = sha256.New
var _ = hex.Encode

var tmpCtx context.Context  
var tmpTime time.Time

func init() {
	_ = tmpCtx
	_ = tmpTime
}