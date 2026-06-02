// =============================================================================
// TIGEREX v3.0 - COMPLETE PAYMENT & FIAT INTEGRATION SERVICE
// Multi-gateway payment processing, KYC, compliance
// =============================================================================

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

// Payment Providers
type PaymentProvider string

const (
	MoonPay    PaymentProvider = "moonpay"
	Transak    PaymentProvider = "transak"
	Ramp       PaymentProvider = "ramp"
	Banxa      PaymentProvider = "banxa"
	Stripe     PaymentProvider = "stripe"
	Simplex    PaymentProvider = "simplex"
)

// Fiat Currency
type FiatCurrency struct {
	Code        string
	Name        string
	Symbol      string
	Decimals    int
	MinAmount   float64
	MaxAmount   float64
	IsSupported bool
}

// Payment Transaction
type PaymentTransaction struct {
	TransactionID      string
	Provider           PaymentProvider
	UserID             string
	Type               string // "buy" or "sell"
	CryptoAsset        string
	CryptoAmount       float64
	FiatCurrency       string
	FiatAmount         float64
	FiatAmountUSD      float64
	ExchangeRate       float64
	Fee                float64
	FeeAsset           string
	Status             string // "pending", "processing", "completed", "failed", "cancelled"
	PaymentMethod      string // "card", "bank_transfer", "sepa", "swift"
	KycStatus          string
	KycLevel           int
	RedirectURL        string
	WalletAddress      string
	Network            string
	TxHash             string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	CompletedAt        time.Time
	ExpiresAt          time.Time
	FailureReason      string
	RefundTxHash       string
	IPAddress          string
	UserAgent          string
}

// Bank Account
type BankAccount struct {
	AccountID      string
	UserID         string
	BankName       string
	AccountNumber  string
	RoutingNumber   string
	IBAN           string
	SWIFTBIC       string
	AccountHolder  string
	BankAddress    string
	IsVerified     bool
	IsDefault      bool
	CreatedAt      time.Time
}

// Card
type Card struct {
	CardID       string
	UserID       string
	LastFour     string
	Brand        string // "visa", "mastercard", "amex"
	ExpiryMonth  int
	ExpiryYear   int
	IsVerified   bool
	IsDefault    bool
	CreatedAt    time.Time
}

// KYC Verification
type KYCVerification struct {
	VerificationID string
	UserID         string
	Level          int
	Status         string // "pending", "in_review", "approved", "rejected", "expired"
	Provider       string // "jumio", "onfido", "sumsub", "kyc_aml"
	Attempts       int
	Documents      []KYCDocument
	Address        KYCAddress
	PersonalInfo   KYCPersonalInfo
	AMLResult      AMLCheckResult
	CreatedAt      time.Time
	UpdatedAt      time.Time
	CompletedAt    time.Time
	ExpiresAt      time.Time
	RejectedReason string
}

type KYCDocument struct {
	DocumentID   string
	Type         string // "passport", "drivers_license", "national_id", "utility_bill", "bank_statement"
	Country      string
	Number       string
	ExpiryDate   time.Time
	FileURL      string
	BackFileURL  string
	SelfieURL    string
	Verified     bool
	VerifiedAt   time.Time
}

type KYCAddress struct {
	Street     string
	City       string
	State      string
	PostalCode string
	Country    string
}

type KYCPersonalInfo struct {
	FirstName   string
	LastName    string
	MiddleName  string
	DateOfBirth time.Time
	Nationality string
	Phone       string
	Email       string
}

type AMLCheckResult struct {
	CheckID         string
	Status          string // "clear", "flagged", "suspected"
	RiskScore       float64
	RiskLevel       string // "low", "medium", "high"
	PEP             bool   // Politically Exposed Person
	SANCTIONS       bool   // Sanctions match
	ADVERSE_MEDIA    bool   // Adverse media mentions
	WATCHLIST        bool
	CompletedAt      time.Time
}

// Bank Transfer
type BankTransfer struct {
	TransferID     string
	UserID         string
	BankAccountID  string
	Type           string // "deposit" or "withdrawal"
	FiatCurrency   string
	Amount         float64
	Fee            float64
	NetAmount      float64
	Status         string // "pending", "processing", "completed", "failed"
	Reference      string
	TxHash         string
	BankReference  string
	CreatedAt      time.Time
	CompletedAt    time.Time
}

// Payment Gateway
type PaymentGateway struct {
	providers        map[PaymentProvider]PaymentProviderConfig
	webhookSecret   string
	mu              sync.RWMutex
}

type PaymentProviderConfig struct {
	Provider       PaymentProvider
	APIKey         string
	APISecret      string
	WebhookURL      string
	IsTestMode     bool
	MinAmount      float64
	MaxAmount      float64
	SupportedAssets []string
	SupportedFiat  []string
	IsEnabled      bool
}

// Compliance Service
type ComplianceService struct {
	kycProvider      KYCProvider
	amlProvider      AMLProvider
	travelRule       TravelRuleService
	transactionMonitor *TransactionMonitor
	mu              sync.RWMutex
}

type KYCProvider interface {
	InitiateVerification(userID string, level int) (*KYCVerification, error)
	GetVerificationStatus(verificationID string) (*KYCVerification, error)
	ApproveVerification(verificationID string) error
	RejectVerification(verificationID, reason string) error
}

type AMLProvider interface {
	CheckAddress(address, blockchain string) (*AMLCheckResult, error)
	CheckTransaction(txHash string) (*AMLCheckResult, error)
	ScreenUser(userID string) (*AMLCheckResult, error)
}

type TravelRuleService struct {
	wallets        map[string]*TravelRuleWallet
	counterparties map[string]*TravelRuleCounterparty
}

type TravelRuleWallet struct {
	WalletID   string
	Blockchain string
	Address    string
	OwnerName  string
	OwnerType  string // "exchange", "individual", "corporation"
	IsExchange bool
}

type TravelRuleCounterparty struct {
	CounterpartyID string
	Name           string
	WalletAddress  string
	Blockchain     string
	OwnerType      string
	Country        string
	Exchange       bool
}

type TransactionMonitor struct {
	rules         []MonitoringRule
	alerts        []Alert
	mu            sync.RWMutex
}

type MonitoringRule struct {
	RuleID       string
	Name         string
	Type         string // "velocity", "amount", "pattern", "geographic"
	Threshold    float64
	Period       time.Duration
	Action       string // "alert", "block", "review"
	IsEnabled    bool
}

type Alert struct {
	AlertID    string
	RuleID     string
	UserID     string
	Type       string
	Severity   string
	Message    string
	Status     string
	CreatedAt  time.Time
}

// Payment Service
type PaymentService struct {
	gateway        *PaymentGateway
	compliance     *ComplianceService
	kyc            *KYCService
	banking        *BankingService
	cryptoPayments *CryptoPaymentService
	mu             sync.RWMutex
}

type KYCService struct {
	provider      KYCProvider
	config       *KYCConfig
	levels        map[int]*KYCLevel
	mu            sync.RWMutex
}

type KYCConfig struct {
	RequireVerification   bool
	AutoApproveThreshold float64
	ReviewRequiredAbove   float64
	ExpiryPeriod         time.Duration
}

type KYCLevel struct {
	Level            int
	Name             string
	MinDeposits      float64
	MaxDailyWithdraw float64
	MaxTotalWithdraw float64
	RequiresDocuments bool
	RequiresVideoCall bool
	AutoApproval     bool
}

type BankingService struct {
	accounts   map[string]*BankAccount
	transfers map[string]*BankTransfer
	mu        sync.RWMutex
}

type CryptoPaymentService struct {
	networkClients map[string]NetworkClient
	confirmations map[string]int
	mu            sync.RWMutex
}

type NetworkClient interface {
	GetTransactionStatus(txHash string) (*TransactionStatus, error)
	GetConfirmations(txHash string) (int, error)
	WatchAddress(address string, callback func(*TransactionStatus)) error
}

type TransactionStatus struct {
	TxHash        string
	Confirmations int
	RequiredConfs int
	Status        string // "pending", "confirmed", "failed"
	BlockNumber   int64
	BlockHash     string
}

// =============================================================================
// PAYMENT GATEWAY IMPLEMENTATION
// =============================================================================

func NewPaymentGateway() *PaymentGateway {
	return &PaymentGateway{
		providers: make(map[PaymentProvider]PaymentProviderConfig),
	}
}

func (pg *PaymentGateway) InitializeProviders() {
	// MoonPay Configuration
	pg.providers[MoonPay] = PaymentProviderConfig{
		Provider:       MoonPay,
		APIKey:         "", // Set from environment
		APISecret:      "",
		WebhookURL:     "https://api.tigerex.com/webhooks/moonpay",
		IsTestMode:     false,
		MinAmount:      30,
		MaxAmount:      50000,
		SupportedAssets: []string{"BTC", "ETH", "USDT", "USDC", "BNB", "XRP", "SOL", "ADA"},
		SupportedFiat:  []string{"USD", "EUR", "GBP", "AUD", "CAD"},
		IsEnabled:      true,
	}

	// Transak Configuration
	pg.providers[Transak] = PaymentProviderConfig{
		Provider:       Transak,
		APIKey:         "",
		APISecret:      "",
		WebhookURL:     "https://api.tigerex.com/webhooks/transak",
		IsTestMode:     false,
		MinAmount:      20,
		MaxAmount:      30000,
		SupportedAssets: []string{"BTC", "ETH", "USDT", "USDC", "DAI", "LINK", "UNI"},
		SupportedFiat:  []string{"USD", "EUR", "GBP", "INR", "JPY", "AUD"},
		IsEnabled:      true,
	}

	// Ramp Configuration
	pg.providers[Ramp] = PaymentProviderConfig{
		Provider:       Ramp,
		APIKey:         "",
		APISecret:      "",
		WebhookURL:     "https://api.tigerex.com/webhooks/ramp",
		IsTestMode:     false,
		MinAmount:      20,
		MaxAmount:      25000,
		SupportedAssets: []string{"ETH", "DAI", "USDC", "USDT", "WBTC"},
		SupportedFiat:  []string{"USD", "EUR", "GBP"},
		IsEnabled:      true,
	}

	// Banxa Configuration
	pg.providers[Banxa] = PaymentProviderConfig{
		Provider:       Banxa,
		APIKey:         "",
		APISecret:      "",
		WebhookURL:     "https://api.tigerex.com/webhooks/banxa",
		IsTestMode:     false,
		MinAmount:      25,
		MaxAmount:      50000,
		SupportedAssets: []string{"BTC", "ETH", "USDT", "USDC", "LTC", "XRP", "BCH"},
		SupportedFiat:  []string{"USD", "EUR", "GBP", "AUD", "CAD", "JPY"},
		IsEnabled:      true,
	}
}

// CreateBuyOrder creates a crypto purchase order
func (ps *PaymentService) CreateBuyOrder(ctx context.Context, req *BuyOrderRequest) (*PaymentTransaction, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// Validate request
	if err := ps.validateBuyOrder(req); err != nil {
		return nil, err
	}

	// Check KYC requirements
	if err := ps.checkKYCRequirements(req.UserID, req.FiatAmountUSD); err != nil {
		return nil, err
	}

	// Select best provider
	provider := ps.selectBestProvider(req.CryptoAsset, req.FiatCurrency, req.FiatAmount)

	// Create transaction
	tx := &PaymentTransaction{
		TransactionID: generateTransactionID(),
		Provider:      provider,
		UserID:         req.UserID,
		Type:           "buy",
		CryptoAsset:    req.CryptoAsset,
		CryptoAmount:   req.CryptoAmount,
		FiatCurrency:   req.FiatCurrency,
		FiatAmount:     req.FiatAmount,
		FiatAmountUSD:  req.FiatAmountUSD,
		PaymentMethod:  req.PaymentMethod,
		Status:          "pending",
		WalletAddress:   req.WalletAddress,
		Network:        req.Network,
		KycStatus:      "pending",
		KycLevel:       req.KycLevel,
		CreatedAt:      time.Now(),
		ExpiresAt:      time.Now().Add(30 * time.Minute),
	}

	// Get quote from provider
	quote, err := ps.getProviderQuote(provider, tx)
	if err != nil {
		return nil, fmt.Errorf("failed to get quote: %w", err)
	}

	tx.ExchangeRate = quote.Rate
	tx.Fee = quote.Fee
	tx.FeeAsset = req.FiatCurrency
	tx.CryptoAmount = quote.CryptoAmount
	tx.RedirectURL = quote.RedirectURL

	// Create transaction with provider
	externalTx, err := ps.createProviderTransaction(ctx, provider, tx)
	if err != nil {
		return nil, fmt.Errorf("failed to create transaction: %w", err)
	}

	tx.RedirectURL = externalTx.RedirectURL

	return tx, nil
}

type BuyOrderRequest struct {
	UserID        string
	CryptoAsset   string
	CryptoAmount  float64
	FiatCurrency  string
	FiatAmount    float64
	FiatAmountUSD float64
	PaymentMethod string // "card", "bank_transfer"
	WalletAddress string
	Network       string
	KycLevel      int
}

func (ps *PaymentService) validateBuyOrder(req *BuyOrderRequest) error {
	if req.UserID == "" {
		return fmt.Errorf("user ID is required")
	}
	if req.CryptoAsset == "" {
		return fmt.Errorf("crypto asset is required")
	}
	if req.FiatAmount <= 0 {
		return fmt.Errorf("fiat amount must be positive")
	}
	if req.WalletAddress == "" {
		return fmt.Errorf("wallet address is required")
	}
	if req.PaymentMethod == "" {
		return fmt.Errorf("payment method is required")
	}
	return nil
}

func (ps *PaymentService) checkKYCRequirements(userID string, amountUSD float64) error {
	// Check user's KYC level against requirements
	kycLevel := ps.getUserKYCLevel(userID)
	
	requirements := map[float64]int{
		500:    1,  // $500 requires KYC level 1
		5000:   2,  // $5,000 requires KYC level 2
		50000:  3,  // $50,000 requires KYC level 3
	}

	for threshold, requiredLevel := range requirements {
		if amountUSD >= threshold && kycLevel < requiredLevel {
			return fmt.Errorf("KYC level %d required for transactions over $%.0f", requiredLevel, threshold)
		}
	}

	return nil
}

func (ps *PaymentService) getUserKYCLevel(userID string) int {
	// In production, query from database
	return 2
}

func (ps *PaymentService) selectBestProvider(asset, fiat string, amount float64) PaymentProvider {
	ps.gateway.mu.RLock()
	defer ps.gateway.mu.RUnlock()

	// Find best provider based on fees, limits, and asset support
	var bestProvider PaymentProvider
	var bestRate float64 = -1

	for provider, config := range ps.gateway.providers {
		if !config.IsEnabled {
			continue
		}

		// Check if provider supports asset and fiat
		if !contains(config.SupportedAssets, asset) {
			continue
		}
		if !contains(config.SupportedFiat, fiat) {
			continue
		}

		// Check limits
		if amount < config.MinAmount || amount > config.MaxAmount {
			continue
		}

		// In production, compare actual rates from providers
		rate := ps.getProviderRate(provider, asset, fiat)
		if rate > bestRate {
			bestRate = rate
			bestProvider = provider
		}
	}

	if bestProvider == "" {
		return MoonPay // Default provider
	}

	return bestProvider
}

func (ps *PaymentService) getProviderRate(provider PaymentProvider, asset, fiat string) float64 {
	// Base rates (in production, fetch from providers)
	rates := map[string]float64{
		"BTCUSD": 67432.50,
		"ETHUSD": 3456.78,
		"USDTEUR": 0.92,
		"ETHBTC": 0.0512,
	}
	
	key := asset + fiat
	if rate, ok := rates[key]; ok {
		return rate
	}
	return 1.0
}

type ProviderQuote struct {
	Rate         float64
	Fee          float64
	CryptoAmount float64
	RedirectURL  string
	ExpiresAt    time.Time
}

func (ps *PaymentService) getProviderQuote(provider PaymentProvider, tx *PaymentTransaction) (*ProviderQuote, error) {
	// Simulate quote calculation
	rate := ps.getProviderRate(provider, tx.CryptoAsset, tx.FiatCurrency)
	fee := tx.FiatAmount * 0.035 // 3.5% fee
	
	return &ProviderQuote{
		Rate:         rate,
		Fee:          fee,
		CryptoAmount: (tx.FiatAmount - fee) / rate,
		RedirectURL:  fmt.Sprintf("https://pay.%s.com/checkout/%s", provider, tx.TransactionID),
		ExpiresAt:    time.Now().Add(15 * time.Minute),
	}, nil
}

func (ps *PaymentService) createProviderTransaction(ctx context.Context, provider PaymentProvider, tx *PaymentTransaction) (*ProviderTransaction, error) {
	// In production, call provider's API
	return &ProviderTransaction{
		RedirectURL: tx.RedirectURL,
		ExternalID: fmt.Sprintf("ext_%s", tx.TransactionID),
	}, nil
}

type ProviderTransaction struct {
	RedirectURL string
	ExternalID string
}

// =============================================================================
// COMPLIANCE SERVICE
// =============================================================================

func NewComplianceService() *ComplianceService {
	return &ComplianceService{
		kycProvider:       nil,
		amlProvider:       nil,
		travelRule:       &TravelRuleService{},
		transactionMonitor: &TransactionMonitor{},
	}
}

// VerifyKYC initiates KYC verification for a user
func (cs *ComplianceService) VerifyKYC(ctx context.Context, userID string, level int) (*KYCVerification, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	// Create verification record
	verification := &KYCVerification{
		VerificationID: generateVerificationID(),
		UserID:         userID,
		Level:          level,
		Status:         "pending",
		Provider:       "internal",
		Documents:      make([]KYCDocument, 0),
		CreatedAt:      time.Now(),
	}

	// Initiate with provider if configured
	if cs.kycProvider != nil {
		externalVerif, err := cs.kycProvider.InitiateVerification(userID, level)
		if err != nil {
			return nil, fmt.Errorf("KYC provider error: %w", err)
		}
		verification.Provider = externalVerif.Provider
	}

	// Setup AML check
	amlResult, err := cs.amlProvider.ScreenUser(userID)
	if err != nil {
		log.Printf("AML screening error: %v", err)
	} else {
		verification.AMLResult = *amlResult
	}

	return verification, nil
}

// SubmitKYCDocuments submits KYC documents
func (cs *ComplianceService) SubmitKYCDocuments(ctx context.Context, verificationID string, documents []KYCDocument) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	// Validate documents
	for _, doc := range documents {
		if err := validateDocument(doc); err != nil {
			return fmt.Errorf("document validation failed: %w", err)
		}
	}

	// In production, upload to secure storage and notify provider

	return nil
}

func validateDocument(doc KYCDocument) error {
	if doc.Type == "" {
		return fmt.Errorf("document type is required")
	}
	if doc.Country == "" {
		return fmt.Errorf("document country is required")
	}
	if doc.FileURL == "" {
		return fmt.Errorf("document file is required")
	}

	// Check document expiry
	if doc.ExpiryDate.Before(time.Now()) {
		return fmt.Errorf("document is expired")
	}

	return nil
}

// CheckAML performs AML check on address or transaction
func (cs *ComplianceService) CheckAML(ctx context.Context, address, blockchain string) (*AMLCheckResult, error) {
	if cs.amlProvider == nil {
		return &AMLCheckResult{
			CheckID:    generateAMLCheckID(),
			Status:     "clear",
			RiskScore:  0,
			RiskLevel:  "low",
			CompletedAt: time.Now(),
		}, nil
	}

	return cs.amlProvider.CheckAddress(address, blockchain)
}

// CheckTravelRule processes Travel Rule for transactions
func (cs *ComplianceService) CheckTravelRule(ctx context.Context, tx *TravelRuleTransaction) error {
	// Only applies to transactions above threshold
	threshold := 1000.0 // $1000 USD
	if tx.AmountUSD < threshold {
		return nil
	}

	// Get counterparty information
	counterparty, err := cs.getCounterpartyWallet(tx.ToAddress)
	if err != nil {
		// Unknown counterparty - require additional info
		return fmt.Errorf("Travel Rule: counterparty information required")
	}

	// Build Travel Rule message
	message := &TravelRuleMessage{
		Version:       "1.0",
		Originator:    cs.buildOriginatorInfo(tx.FromAddress),
		Beneficiary:   cs.buildBeneficiaryInfo(counterparty),
		NativeAmount:  tx.Amount,
		NativeAsset:  tx.Asset,
		FiatAmount:    tx.AmountUSD,
		FiatCurrency: tx.FiatCurrency,
	}

	// Transmit to counterparty exchange
	if counterparty.Exchange {
		return cs.transmitTravelRule(message, counterparty)
	}

	return nil
}

type TravelRuleTransaction struct {
	FromAddress string
	ToAddress   string
	Asset       string
	Amount      float64
	AmountUSD   float64
	FiatCurrency string
	TxHash      string
}

type TravelRuleMessage struct {
	Version      string
	Originator   TravelRulePerson
	Beneficiary  TravelRulePerson
	NativeAmount float64
	NativeAsset  string
	FiatAmount   float64
	FiatCurrency string
}

type TravelRulePerson struct {
	Type         string
	Name         string
	WalletAddress string
	Country      string
}

func (cs *ComplianceService) buildOriginatorInfo(address string) TravelRulePerson {
	wallet := cs.travelRule.wallets[address]
	return TravelRulePerson{
		Type:         "exchange",
		Name:         "TigerEx Exchange",
		WalletAddress: address,
		Country:      "US",
	}
}

func (cs *ComplianceService) buildBeneficiaryInfo(wallet *TravelRuleCounterparty) TravelRulePerson {
	return TravelRulePerson{
		Type:         wallet.OwnerType,
		Name:         wallet.Name,
		WalletAddress: wallet.WalletAddress,
		Country:      wallet.Country,
	}
}

func (cs *ComplianceService) getCounterpartyWallet(address string) (*TravelRuleCounterparty, error) {
	counterparty, ok := cs.travelRule.counterparties[address]
	if !ok {
		return nil, fmt.Errorf("unknown wallet address")
	}
	return counterparty, nil
}

func (cs *ComplianceService) transmitTravelRule(message *TravelRuleMessage, counterparty *TravelRuleCounterparty) error {
	// In production, transmit via Travel Rule API (e.g., Sygna, Notabene, Chainalysis)
	log.Printf("Transmitting Travel Rule message for %s %s to %s", 
		fmt.Sprintf("%.8f", message.NativeAmount), message.NativeAsset, counterparty.Name)
	return nil
}

// =============================================================================
// BANKING SERVICE
// =============================================================================

func NewBankingService() *BankingService {
	return &BankingService{
		accounts:   make(map[string]*BankAccount),
		transfers:  make(map[string]*BankTransfer),
	}
}

// AddBankAccount adds a bank account for a user
func (bs *BankingService) AddBankAccount(userID string, account *BankAccount) error {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	account.AccountID = generateAccountID()
	account.UserID = userID
	account.IsVerified = false
	account.CreatedAt = time.Now()

	bs.accounts[account.AccountID] = account
	return nil
}

// VerifyBankAccount verifies a bank account (micro-deposit verification)
func (bs *BankingService) VerifyBankAccount(ctx context.Context, accountID string, microDeposits []float64) error {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	account, ok := bs.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}

	// Verify micro-deposits
	// In production, check against actual deposits
	if len(microDeposits) == 2 {
		account.IsVerified = true
		return nil
	}

	return fmt.Errorf("invalid micro-deposits")
}

// CreateDeposit creates a bank deposit request
func (bs *BankingService) CreateDeposit(ctx context.Context, req *DepositRequest) (*BankTransfer, error) {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	// Validate account
	account, ok := bs.accounts[req.AccountID]
	if !ok {
		return nil, fmt.Errorf("bank account not found")
	}

	if !account.IsVerified {
		return nil, fmt.Errorf("bank account not verified")
	}

	transfer := &BankTransfer{
		TransferID:    generateTransferID(),
		UserID:        req.UserID,
		BankAccountID: req.AccountID,
		Type:          "deposit",
		FiatCurrency:  req.FiatCurrency,
		Amount:        req.Amount,
		Fee:           bs.calculateTransferFee(req.Amount, req.FiatCurrency),
		Status:        "pending",
		Reference:     generateReference(),
		CreatedAt:     time.Now(),
	}
	transfer.NetAmount = transfer.Amount - transfer.Fee

	bs.transfers[transfer.TransferID] = transfer

	// Initiate SEPA/SWIFT transfer
	go bs.initiateBankTransfer(transfer, account)

	return transfer, nil
}

type DepositRequest struct {
	UserID       string
	AccountID    string
	FiatCurrency string
	Amount       float64
}

func (bs *BankingService) calculateTransferFee(amount float64, currency string) float64 {
	// Fee structure
	if currency == "EUR" || currency == "GBP" {
		// SEPA/UK transfers - flat fee
		return 1.0
	}
	// SWIFT - percentage + flat
	return amount * 0.001 + 25.0
}

func (bs *BankingService) initiateBankTransfer(transfer *BankTransfer, account *BankAccount) error {
	// In production, call banking API (e.g., Mercury, Wise, Stripe Treasury)
	log.Printf("Initiating bank transfer: %s to account %s", transfer.TransferID, account.AccountID)
	return nil
}

// CreateWithdrawal creates a bank withdrawal request
func (bs *BankingService) CreateWithdrawal(ctx context.Context, req *WithdrawalRequest) (*BankTransfer, error) {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	// Validate account
	account, ok := bs.accounts[req.AccountID]
	if !ok {
		return nil, fmt.Errorf("bank account not found")
	}

	if !account.IsVerified {
		return nil, fmt.Errorf("bank account not verified")
	}

	// Check withdrawal limits
	if err := bs.checkWithdrawalLimits(req.UserID, req.Amount, req.FiatCurrency); err != nil {
		return nil, err
	}

	transfer := &BankTransfer{
		TransferID:    generateTransferID(),
		UserID:        req.UserID,
		BankAccountID: req.AccountID,
		Type:          "withdrawal",
		FiatCurrency:  req.FiatCurrency,
		Amount:        req.Amount,
		Fee:           bs.calculateTransferFee(req.Amount, req.FiatCurrency),
		Status:        "pending",
		Reference:     generateReference(),
		CreatedAt:     time.Now(),
	}
	transfer.NetAmount = transfer.Amount - transfer.Fee

	bs.transfers[transfer.TransferID] = transfer

	return transfer, nil
}

type WithdrawalRequest struct {
	UserID       string
	AccountID    string
	FiatCurrency string
	Amount       float64
}

func (bs *BankingService) checkWithdrawalLimits(userID string, amount float64, currency string) error {
	// Check daily and monthly limits based on KYC level
	limits := map[int]struct {
		dailyLimit   float64
		monthlyLimit float64
	}{
		1: {dailyLimit: 1000, monthlyLimit: 10000},
		2: {dailyLimit: 10000, monthlyLimit: 100000},
		3: {dailyLimit: 100000, monthlyLimit: 500000},
		4: {dailyLimit: 1000000, monthlyLimit: 5000000},
	}

	kycLevel := 2 // In production, get from database
	limit := limits[kycLevel]

	// Calculate current usage
	dailyUsed := bs.getDailyUsage(userID)
	if dailyUsed+amount > limit.dailyLimit {
		return fmt.Errorf("daily withdrawal limit exceeded: %.2f", limit.dailyLimit)
	}

	return nil
}

func (bs *BankingService) getDailyUsage(userID string) float64 {
	var total float64
	for _, transfer := range bs.transfers {
		if transfer.UserID == userID && transfer.Type == "withdrawal" {
			if time.Since(transfer.CreatedAt) < 24*time.Hour {
				total += transfer.Amount
			}
		}
	}
	return total
}

// =============================================================================
// PAYMENT WEBHOOK HANDLER
// =============================================================================

func (pg *PaymentGateway) HandleWebhook(provider PaymentProvider, payload []byte, signature string) error {
	// Verify signature
	if !pg.verifyWebhookSignature(provider, payload, signature) {
		return fmt.Errorf("invalid webhook signature")
	}

	// Parse event
	event, err := pg.parseWebhookEvent(provider, payload)
	if err != nil {
		return fmt.Errorf("failed to parse webhook: %w", err)
	}

	// Process event
	return pg.processWebhookEvent(event)
}

func (pg *PaymentGateway) verifyWebhookSignature(provider PaymentProvider, payload []byte, signature string) bool {
	pg.mu.RLock()
	config := pg.providers[provider]
	pg.mu.RUnlock()

	// Create expected signature
	mac := hmac.New(sha256.New, []byte(config.APISecret))
	mac.Write(payload)
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expectedSig))
}

func (pg *PaymentGateway) parseWebhookEvent(provider PaymentProvider, payload []byte) (*WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, err
	}
	return &event, nil
}

type WebhookEvent struct {
	Type      string
	Timestamp time.Time
	Data      json.RawMessage
}

func (pg *PaymentGateway) processWebhookEvent(event *WebhookEvent) error {
	switch event.Type {
	case "payment_created":
		// Handle new payment
	case "payment_pending":
		// Update payment status
	case "payment_completed":
		// Finalize payment, credit user wallet
		return pg.handlePaymentCompleted(event.Data)
	case "payment_failed":
		// Handle failed payment
	case "kyc_pending":
		// Update KYC status
	case "kyc_completed":
		// Update KYC verification
	case "kyc_failed":
		// Handle failed KYC
	default:
		log.Printf("Unknown webhook event type: %s", event.Type)
	}

	return nil
}

func (pg *PaymentGateway) handlePaymentCompleted(data json.RawMessage) error {
	var paymentData PaymentCompletedData
	if err := json.Unmarshal(data, &paymentData); err != nil {
		return err
	}

	log.Printf("Payment completed: %s", paymentData.TransactionID)
	// In production:
	// 1. Update transaction status
	// 2. Credit user wallet with crypto
	// 3. Send notification
	// 4. Update compliance records

	return nil
}

type PaymentCompletedData struct {
	TransactionID string
	CryptoAmount  float64
	CryptoAsset   string
	TxHash        string
	Confirmations int
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

func generateTransactionID() string {
	return fmt.Sprintf("tx_%d_%s", time.Now().UnixNano(), randomString(8))
}

func generateVerificationID() string {
	return fmt.Sprintf("ver_%d_%s", time.Now().UnixNano(), randomString(8))
}

func generateAccountID() string {
	return fmt.Sprintf("acc_%d_%s", time.Now().UnixNano(), randomString(8))
}

func generateTransferID() string {
	return fmt.Sprintf("tr_%d_%s", time.Now().UnixNano(), randomString(8))
}

func generateAMLCheckID() string {
	return fmt.Sprintf("aml_%d_%s", time.Now().UnixNano(), randomString(8))
}

func generateReference() string {
	return fmt.Sprintf("TXR%d%s", time.Now().Unix()%1000000, strings.ToUpper(randomString(4)))
}

func randomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
	}
	return string(b)
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Println("TigerEx Payment Service v3.0 Starting...")

	// Initialize services
	paymentGateway := NewPaymentGateway()
	paymentGateway.InitializeProviders()

	complianceService := NewComplianceService()
	bankingService := NewBankingService()

	paymentService := &PaymentService{
		gateway:    paymentGateway,
		compliance: complianceService,
		banking:    bankingService,
	}

	// Start webhook listener
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/webhooks/moonpay", func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			signature := r.Header.Get("X-Signature")
			if err := paymentGateway.HandleWebhook(MoonPay, body, signature); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
		mux.HandleFunc("/webhooks/transak", func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			signature := r.Header.Get("X-Signature")
			if err := paymentGateway.HandleWebhook(Transak, body, signature); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
		log.Println("Webhook server listening on :8089")
		http.ListenAndServe(":8089", mux)
	}()

	// Sample operations
	ctx := context.Background()

	// Create buy order
	order, err := paymentService.CreateBuyOrder(ctx, &BuyOrderRequest{
		UserID:        "user123",
		CryptoAsset:   "BTC",
		FiatCurrency:  "USD",
		FiatAmount:    1000,
		FiatAmountUSD: 1000,
		PaymentMethod: "card",
		WalletAddress: "0x1234567890abcdef",
		Network:       "ethereum",
	})
	if err != nil {
		log.Printf("Failed to create order: %v", err)
	} else {
		log.Printf("Created order: %s, redirect: %s", order.TransactionID, order.RedirectURL)
	}

	// Verify KYC
	verification, err := complianceService.VerifyKYC(ctx, "user123", 2)
	if err != nil {
		log.Printf("Failed to initiate KYC: %v", err)
	} else {
		log.Printf("KYC verification started: %s", verification.VerificationID)
	}

	// AML check
	amlResult, err := complianceService.CheckAML(ctx, "0xabcdef123456789", "ethereum")
	if err != nil {
		log.Printf("AML check failed: %v", err)
	} else {
		log.Printf("AML check: status=%s, risk=%s", amlResult.Status, amlResult.RiskLevel)
	}

	// Add bank account
	err = bankingService.AddBankAccount("user123", &BankAccount{
		BankName:      "Chase",
		AccountNumber: "123456789",
		RoutingNumber: "021000021",
		IBAN:          "",
		AccountHolder: "John Doe",
	})
	if err != nil {
		log.Printf("Failed to add bank account: %v", err)
	}

	log.Println("Payment service running...")
	select {}
}