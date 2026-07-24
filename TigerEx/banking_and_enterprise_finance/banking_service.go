// =============================================================================
// TIGEREX BANKING AND ENTERPRISE FINANCE SERVICE
// Banking integrations and enterprise financial operations
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// AccountType represents type of bank account
type AccountType string

const (
	AccountTypeChecking    AccountType = "CHECKING"
	AccountTypeSavings    AccountType = "SAVINGS"
	AccountTypeCorporate  AccountType = "CORPORATE"
	AccountTypeEscrow     AccountType = "ESCROW"
)

// Currency represents supported fiat currencies
type Currency string

const (
	CurrencyUSD Currency = "USD"
	CurrencyEUR Currency = "EUR"
	CurrencyGBP Currency = "GBP"
	CurrencyJPY Currency = "JPY"
	CurrencyCHF Currency = "CHF"
	CurrencyCAD Currency = "CAD"
	CurrencyAUD Currency = "AUD"
	CurrencyCNY Currency = "CNY"
	CurrencyINR Currency = "INR"
	CurrencyBRL Currency = "BRL"
	CurrencySGD Currency = "SGD"
	CurrencyHKD Currency = "HKD"
)

// TransactionStatus represents banking transaction status
type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "PENDING"
	TransactionStatusProcessing TransactionStatus = "PROCESSING"
	TransactionStatusCompleted TransactionStatus = "COMPLETED"
	TransactionStatusFailed   TransactionStatus = "FAILED"
	TransactionStatusReversed TransactionStatus = "REVERSED"
)

// BankAccount represents a bank account
type BankAccount struct {
	ID                string            `json:"id"`
	UserID            string            `json:"userId"`
	BankName          string            `json:"bankName"`
	BankCode          string            `json:"bankCode"`       // SWIFT/BIC
	BranchCode        string            `json:"branchCode"`
	AccountNumber     string            `json:"accountNumber"`
	IBAN              string            `json:"iban"`
	AccountType       AccountType       `json:"accountType"`
	Currency          Currency          `json:"currency"`
	Balance           *big.Float        `json:"balance"`
	AvailableBalance  *big.Float        `json:"availableBalance"`
	Status            string            `json:"status"`
	Verified          bool              `json:"verified"`
	VerificationLevel int               `json:"verificationLevel"`
	CreatedAt         time.Time         `json:"createdAt"`
	LastUpdated       time.Time         `json:"lastUpdated"`
}

// BankTransaction represents a banking transaction
type BankTransaction struct {
	ID              string            `json:"id"`
	UserID          string            `json:"userId"`
	AccountID       string            `json:"accountId"`
	Type            string            `json:"type"` // DEPOSIT, WITHDRAWAL, TRANSFER
	Amount          *big.Float        `json:"amount"`
	Currency        Currency          `json:"currency"`
	ExchangeRate    *big.Float        `json:"exchangeRate"`
	Fees            *big.Float        `json:"fees"`
	Status          TransactionStatus `json:"status"`
	Reference       string            `json:"reference"`
	Description     string            `json:"description"`
	Counterparty    string            `json:"counterparty"`
	CounterpartyBank string           `json:"counterpartyBank"`
	CreatedAt       time.Time         `json:"createdAt"`
	ProcessedAt     *time.Time        `json:"processedAt"`
	CompletedAt     *time.Time        `json:"completedAt"`
	FailureReason   string            `json:"failureReason"`
}

// PaymentMethod represents a payment method
type PaymentMethod struct {
	ID             string    `json:"id"`
	UserID         string    `json:"userId"`
	Type           string    `json:"type"` // CARD, BANK, WIRE, SWIFT, SEPA
	BankName       string    `json:"bankName"`
	BankCode       string    `json:"bankCode"`
	AccountNumber  string    `json:"accountNumber"`
	IBAN           string    `json:"iban"`
	CardLast4      string    `json:"cardLast4"`
	CardBrand      string    `json:"cardBrand"`
	CardType       string    `json:"cardType"` // DEBIT, CREDIT
	ExpiryMonth    int       `json:"expiryMonth"`
	ExpiryYear     int       `json:"expiryYear"`
	IsDefault      bool      `json:"isDefault"`
	Status         string    `json:"status"`
	Verified       bool      `json:"verified"`
	CreatedAt      time.Time `json:"createdAt"`
}

// CorporateAccount represents enterprise account
type CorporateAccount struct {
	ID                  string            `json:"id"`
	CompanyName        string            `json:"companyName"`
	CompanyID          string            `json:"companyId"` // EIN/VAT
	Industry           string            `json:"industry"`
	Country            string            `json:"country"`
	BankAccounts       []string          `json:"bankAccounts"`
	AuthorizedSigners  []string          `json:"authorizedSigners"`
	AccountType        AccountType       `json:"accountType"`
	TotalBalance       *big.Float        `json:"totalBalance"`
	DailyLimit         *big.Float        `json:"dailyLimit"`
	MonthlyVolume      *big.Float        `json:"monthlyVolume"`
	FeeTier            string            `json:"feeTier"`
	Status             string            `json:"status"`
	KYCLevel           int               `json:"kycLevel"`
	CreatedAt          time.Time         `json:"createdAt"`
}

// EscrowAccount represents escrow account for settlements
type EscrowAccount struct {
	ID             string     `json:"id"`
	TransactionID  string     `json:"transactionId"`
	BuyerID       string     `json:"buyerId"`
	SellerID      string     `json:"sellerId"`
	Amount        *big.Float `json:"amount"`
	Currency      Currency   `json:"currency"`
	Status        string     `json:"status"` // PENDING, FUNDED, RELEASED, REFUNDED, DISPUTED
	ReleaseTerms  string     `json:"releaseTerms"`
	CreatedAt     time.Time  `json:"createdAt"`
	ReleasedAt    *time.Time `json:"releasedAt"`
	DisputeReason string     `json:"disputeReason"`
}

// =============================================================================
// BANKING SERVICE
// =============================================================================

// BankingService handles banking operations
type BankingService struct {
	mu              sync.RWMutex
	accounts        map[string]*BankAccount
	transactions    map[string]*BankTransaction
	paymentMethods  map[string]*PaymentMethod
	corporateAccts  map[string]*CorporateAccount
	escrowAccounts  map[string]*EscrowAccount
	
	// Exchange rates
	exchangeRates map[string]*big.Float // "USD/EUR" -> rate
	
	// Fee structure
	fees struct {
		wireFee        *big.Float
		sepaFee        *big.Float
		cardFee        *big.Float
		conversionFee  *big.Float
	}
	
	// Limits
	limits struct {
		dailyWireLimit    *big.Float
		monthlyWireLimit *big.Float
		minWireAmount    *big.Float
		maxWireAmount    *big.Float
	}
}

// NewBankingService creates new banking service
func NewBankingService() *BankingService {
	svc := &BankingService{
		accounts:       make(map[string]*BankAccount),
		transactions:   make(map[string]*BankTransaction),
		paymentMethods: make(map[string]*PaymentMethod),
		corporateAccts: make(map[string]*CorporateAccount),
		escrowAccounts: make(map[string]*EscrowAccount),
		exchangeRates:  make(map[string]*big.Float),
	}
	
	// Initialize exchange rates (would fetch from API in production)
	svc.initExchangeRates()
	
	// Initialize fees
	svc.fees = struct {
		wireFee        *big.Float
		sepaFee        *big.Float
		cardFee        *big.Float
		conversionFee  *big.Float
	}{
		wireFee:       big.NewFloat(25.0),
		sepaFee:       big.NewFloat(1.50),
		cardFee:       big.NewFloat(2.9),  // percentage
		conversionFee: big.NewFloat(0.5),   // percentage
	}
	
	// Initialize limits
	svc.limits = struct {
		dailyWireLimit    *big.Float
		monthlyWireLimit *big.Float
		minWireAmount    *big.Float
		maxWireAmount    *big.Float
	}{
		dailyWireLimit:    big.NewFloat(1000000.0),
		monthlyWireLimit: big.NewFloat(10000000.0),
		minWireAmount:    big.NewFloat(100.0),
		maxWireAmount:    big.NewFloat(5000000.0),
	}
	
	return svc
}

// initExchangeRates initializes exchange rates
func (s *BankingService) initExchangeRates() {
	rates := map[string]float64{
		"USD/EUR": 0.92,
		"USD/GBP": 0.79,
		"USD/JPY": 149.50,
		"USD/CHF": 0.88,
		"USD/CAD": 1.36,
		"USD/AUD": 1.53,
		"USD/CNY": 7.24,
		"USD/INR": 83.12,
		"USD/BRL": 4.97,
		"USD/SGD": 1.34,
		"USD/HKD": 7.82,
		"EUR/USD": 1.09,
		"GBP/USD": 1.27,
	}
	
	for pair, rate := range rates {
		s.exchangeRates[pair] = big.NewFloat(rate)
	}
}

// CreateBankAccount creates a new bank account
func (s *BankingService) CreateBankAccount(ctx context.Context, req *BankAccount) (*BankAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate bank code
	if req.BankCode == "" {
		return nil, fmt.Errorf("bank code is required")
	}
	
	// Validate account number
	if req.AccountNumber == "" {
		return nil, fmt.Errorf("account number is required")
	}
	
	// Generate account ID
	account := &BankAccount{
		ID:                generateAccountID(),
		UserID:            req.UserID,
		BankName:          req.BankName,
		BankCode:          req.BankCode,
		BranchCode:        req.BranchCode,
		AccountNumber:     req.AccountNumber,
		IBAN:              req.IBAN,
		AccountType:       req.AccountType,
		Currency:          req.Currency,
		Balance:           big.NewFloat(0),
		AvailableBalance:  big.NewFloat(0),
		Status:            "ACTIVE",
		Verified:         false,
		VerificationLevel: 0,
		CreatedAt:        time.Now(),
		LastUpdated:       time.Now(),
	}
	
	s.accounts[account.ID] = account
	
	return account, nil
}

// InitiateWireTransfer initiates a wire transfer
func (s *BankingService) InitiateWireTransfer(ctx context.Context, req *BankTransaction) (*BankTransaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate amount
	amount := req.Amount
	if amount.Cmp(s.limits.minWireAmount) < 0 {
		return nil, fmt.Errorf("amount below minimum: %s", s.limits.minWireAmount.String())
	}
	if amount.Cmp(s.limits.maxWireAmount) > 0 {
		return nil, fmt.Errorf("amount exceeds maximum: %s", s.limits.maxWireAmount.String())
	}
	
	// Check daily limit
	dailyTotal := s.getDailyWireTotal(req.UserID)
	dailyTotal.Add(dailyTotal, amount)
	if dailyTotal.Cmp(s.limits.dailyWireLimit) > 0 {
		return nil, fmt.Errorf("daily wire limit exceeded: %s", s.limits.dailyWireLimit.String())
	}
	
	// Calculate fees
	fees := new(big.Float).Copy(s.fees.wireFee)
	if req.Currency != CurrencyUSD {
		// Add conversion fee
		conversionFee := new(big.Float).Mul(amount, s.fees.conversionFee)
		fees.Add(fees, conversionFee)
	}
	
	// Create transaction
	tx := &BankTransaction{
		ID:               generateTxID(),
		UserID:           req.UserID,
		AccountID:        req.AccountID,
		Type:             "WIRE_TRANSFER",
		Amount:           amount,
		Currency:         req.Currency,
		Fees:             fees,
		Status:           TransactionStatusPending,
		Reference:        generateReference(),
		Description:      req.Description,
		Counterparty:     req.Counterparty,
		CounterpartyBank: req.CounterpartyBank,
		CreatedAt:       time.Now(),
	}
	
	s.transactions[tx.ID] = tx
	
	// Process (simulate)
	go s.processWireTransfer(tx.ID)
	
	return tx, nil
}

// processWireTransfer processes wire transfer asynchronously
func (s *BankingService) processWireTransfer(txID string) {
	time.Sleep(2 * time.Second) // Simulate processing
	
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if tx, exists := s.transactions[txID]; exists {
		tx.Status = TransactionStatusCompleted
		now := time.Now()
		tx.CompletedAt = &now
	}
}

// ProcessCardPayment processes card payment
func (s *BankingService) ProcessCardPayment(ctx context.Context, req *BankTransaction, card *PaymentMethod) (*BankTransaction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate card
	if card.Status != "ACTIVE" {
		return nil, fmt.Errorf("card not active")
	}
	
	// Calculate fees (percentage)
	fees := new(big.Float).Mul(req.Amount, s.fees.cardFee)
	fees.Quo(fees, big.NewFloat(100))
	
	// Create transaction
	tx := &BankTransaction{
		ID:          generateTxID(),
		UserID:       req.UserID,
		AccountID:    req.AccountID,
		Type:         "CARD_PAYMENT",
		Amount:       req.Amount,
		Currency:     req.Currency,
		Fees:         fees,
		Status:       TransactionStatusProcessing,
		Reference:    generateReference(),
		Description:  req.Description,
		CreatedAt:    time.Now(),
	}
	
	s.transactions[tx.ID] = tx
	
	// Process
	go s.processCardPayment(tx.ID)
	
	return tx, nil
}

// processCardPayment processes card payment
func (s *BankingService) processCardPayment(txID string) {
	time.Sleep(1 * time.Second)
	
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if tx, exists := s.transactions[txID]; exists {
		tx.Status = TransactionStatusCompleted
		now := time.Now()
		tx.CompletedAt = &now
	}
}

// ExchangeCurrency exchanges currency
func (s *BankingService) ExchangeCurrency(ctx context.Context, fromCurrency, toCurrency Currency, amount *big.Float) (*big.Float, *big.Float, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if fromCurrency == toCurrency {
		return amount, big.NewFloat(0), nil
	}
	
	// Get exchange rate
	pair := fmt.Sprintf("%s/%s", fromCurrency, toCurrency)
	rate, exists := s.exchangeRates[pair]
	if !exists {
		// Try reverse
		reversePair := fmt.Sprintf("%s/%s", toCurrency, fromCurrency)
		reverseRate, exists := s.exchangeRates[reversePair]
		if !exists {
			return nil, nil, fmt.Errorf("exchange rate not available for %s", pair)
		}
		rate = reverseRate
		// Invert rate
		one := big.NewFloat(1.0)
		rate = new(big.Float).Quo(one, rate)
	}
	
	// Calculate converted amount
	converted := new(big.Float).Mul(amount, rate)
	
	// Calculate conversion fee
	fee := new(big.Float).Mul(converted, s.fees.conversionFee)
	fee.Quo(fee, big.NewFloat(100))
	
	// Subtract fee
	netAmount := new(big.Float).Sub(converted, fee)
	
	return netAmount, fee, nil
}

// CreateCorporateAccount creates corporate account
func (s *BankingService) CreateCorporateAccount(ctx context.Context, req *CorporateAccount) (*CorporateAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if req.CompanyID == "" {
		return nil, fmt.Errorf("company ID required")
	}
	
	account := &CorporateAccount{
		ID:                  generateCorporateID(),
		CompanyName:         req.CompanyName,
		CompanyID:           req.CompanyID,
		Industry:            req.Industry,
		Country:             req.Country,
		AccountType:         AccountTypeCorporate,
		TotalBalance:        big.NewFloat(0),
		DailyLimit:          big.NewFloat(5000000),
		MonthlyVolume:       big.NewFloat(0),
		FeeTier:             "CORPORATE",
		Status:              "PENDING_KYC",
		KYCLevel:            0,
		CreatedAt:           time.Now(),
	}
	
	s.corporateAccts[account.ID] = account
	
	return account, nil
}

// CreateEscrow creates escrow account
func (s *BankingService) CreateEscrow(ctx context.Context, buyerID, sellerID string, amount *big.Float, currency Currency, terms string) (*EscrowAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	escrow := &EscrowAccount{
		ID:            generateEscrowID(),
		BuyerID:       buyerID,
		SellerID:      sellerID,
		Amount:        amount,
		Currency:      currency,
		Status:        "PENDING",
		ReleaseTerms:  terms,
		CreatedAt:     time.Now(),
	}
	
	s.escrowAccounts[escrow.ID] = escrow
	
	return escrow, nil
}

// FundEscrow funds escrow account
func (s *BankingService) FundEscrow(ctx context.Context, escrowID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	escrow, exists := s.escrowAccounts[escrowID]
	if !exists {
		return fmt.Errorf("escrow not found")
	}
	
	if escrow.Status != "PENDING" {
		return fmt.Errorf("escrow not in pending status")
	}
	
	escrow.Status = "FUNDED"
	
	return nil
}

// ReleaseEscrow releases funds from escrow
func (s *BankingService) ReleaseEscrow(ctx context.Context, escrowID, releasedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	escrow, exists := s.escrowAccounts[escrowID]
	if !exists {
		return fmt.Errorf("escrow not found")
	}
	
	if escrow.Status != "FUNDED" {
		return fmt.Errorf("escrow not funded")
	}
	
	escrow.Status = "RELEASED"
	now := time.Now()
	escrow.ReleasedAt = &now
	
	return nil
}

// GetExchangeRate gets exchange rate
func (s *BankingService) GetExchangeRate(from, to Currency) *big.Float {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	pair := fmt.Sprintf("%s/%s", from, to)
	if rate, exists := s.exchangeRates[pair]; exists {
		return rate
	}
	
	// Try reverse
	reversePair := fmt.Sprintf("%s/%s", to, from)
	if rate, exists := s.exchangeRates[reversePair]; exists {
		one := big.NewFloat(1.0)
		return new(big.Float).Quo(one, rate)
	}
	
	return nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func generateAccountID() string {
	return "ACCT-" + generateRandomString(12)
}

func generateTxID() string {
	return "TX-" + generateRandomString(16)
}

func generateCorporateID() string {
	return "CORP-" + generateRandomString(10)
}

func generateEscrowID() string {
	return "ESCROW-" + generateRandomString(12)
}

func generateReference() string {
	return "TGR" + fmt.Sprintf("%d", time.Now().Unix())
}

func generateRandomString(length int) string {
	h := sha512.New()
	h.Write([]byte(fmt.Sprintf("%d%d", time.Now().UnixNano(), time.Now().Unix())))
	return base64.URLEncoding.EncodeToString(h.Sum(nil))[:length]
}

// getDailyWireTotal gets total wire transfer for today
func (s *BankingService) getDailyWireTotal(userID string) *big.Float {
	total := big.NewFloat(0)
	today := time.Now().Truncate(24 * time.Hour)
	
	for _, tx := range s.transactions {
		if tx.UserID == userID && tx.Type == "WIRE_TRANSFER" && tx.CreatedAt.After(today) {
			total.Add(total, tx.Amount)
		}
	}
	
	return total
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx Banking & Enterprise Finance Service")
	fmt.Println("============================================")
	
	// Create service
	banking := NewBankingService()
	
	// Create bank account
	account, err := banking.CreateBankAccount(context.Background(), &BankAccount{
		UserID:       "USER-001",
		BankName:     "Chase Bank",
		BankCode:     "CHASEUS33",
		AccountNumber: "1234567890",
		IBAN:         "US89370400440532013000",
		AccountType:  AccountTypeCorporate,
		Currency:     CurrencyUSD,
	})
	if err != nil {
		fmt.Printf("Error creating account: %v\n", err)
		return
	}
	
	fmt.Printf("\nCreated Account: %s\n", account.ID)
	fmt.Printf("  Bank: %s\n", account.BankName)
	fmt.Printf("  Currency: %s\n", account.Currency)
	
	// Initiate wire transfer
	tx, err := banking.InitiateWireTransfer(context.Background(), &BankTransaction{
		UserID:          "USER-001",
		AccountID:       account.ID,
		Amount:          big.NewFloat(50000),
		Currency:        CurrencyUSD,
		Description:      "Business payment",
		Counterparty:     "ABC Corp",
		CounterpartyBank: "CITIUS33",
	})
	if err != nil {
		fmt.Printf("Error initiating transfer: %v\n", err)
		return
	}
	
	fmt.Printf("\nWire Transfer: %s\n", tx.ID)
	fmt.Printf("  Amount: %s %s\n", tx.Amount.String(), tx.Currency)
	fmt.Printf("  Fees: %s\n", tx.Fees.String())
	fmt.Printf("  Status: %s\n", tx.Status)
	
	// Test currency exchange
	converted, fee, err := banking.ExchangeCurrency(context.Background(), CurrencyUSD, CurrencyEUR, big.NewFloat(1000))
	if err != nil {
		fmt.Printf("Error exchanging: %v\n", err)
	} else {
		fmt.Printf("\nCurrency Exchange:\n")
		fmt.Printf("  1000 USD -> %s EUR\n", converted.String())
		fmt.Printf("  Fee: %s EUR\n", fee.String())
	}
	
	// Get exchange rates
	fmt.Printf("\nExchange Rates:\n")
	currencies := []Currency{CurrencyEUR, CurrencyGBP, CurrencyJPY, CurrencyCNY}
	rate := banking.GetExchangeRate(CurrencyUSD, CurrencyEUR)
	if rate != nil {
		fmt.Printf("  USD/EUR: %s\n", rate.String())
	}
}
