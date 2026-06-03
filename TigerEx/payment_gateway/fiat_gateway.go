// =============================================================================
// FIAT PAYMENT GATEWAY SERVICE
// Complete fiat payment processing for CEX operations
// Supports SEPA, SWIFT, Card processing, Apple Pay, Google Pay
// =============================================================================

package payment

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	MethodSEPA     = "sepa"
	MethodSWIFT    = "swift"
	MethodCard    = "card"
	MethodApplePay = "apple_pay"
	MethodGooglePay = "google_pay"

	StatusPending     = "pending"
	StatusProcessing = "processing"
	StatusCompleted = "completed"
	StatusFailed   = "failed"
	StatusCancelled = "cancelled"
)

// Config holds payment gateway configuration
type Config struct {
	MerchantID        string
	SecretaryKey     string
	MinDeposit      float64
	MaxDeposit     float64
	MinWithdrawal   float64
	MaxWithdrawal  float64
	SEPAFee        float64
	SWIFTFee       float64
	CardFee        float64
	EnableSEPA     bool
	EnableSWIFT    bool
	EnableCard    bool
	EnableApplePay bool
	EnableGooglePay bool
}

// Payment represents a fiat payment transaction
type Payment struct {
	ID              string
	UserID          string
	Type            string
	Method          string
	Amount         float64
	Currency       string
	Fee            float64
	NetAmount      float64
	Status         string
	BankReference string   
	ProcessorRef   string
	CreatedAt     time.Time
	UpdatedAt    time.Time
}

// SEPADetails
type SEPADetails struct {
	CreditorName string
	IBAN       string
	BIC        string
	Reference  string
	Amount     float64
	Currency   string
}

// SWIFTDetails
type SWIFTDetails struct {
	CreditorName   string
	AccountNumber string
	BankCode     string
	BankName    string
	SWIFTCode   string
	Reference   string
}

// CardDetails
type CardDetails struct {
	Brand      string
	Last4      string
	ExpMonth   int
	ExpYear    int
	Country    string
	Issuer     string
}

// BankAccount represents a bank account
type BankAccount struct {
	ID            string
	UserID        string
	Type         string // "sepa", "swift"
	BankName     string
	AccountName string
	AccountNumber string
	IBAN        string
	SWIFTBIC    string
	IsDefault   bool
	IsVerified  bool
	AddedAt    time.Time
}

// Card represents stored card
type Card struct {
	ID            string
	UserID        string
	Brand         string
	Last4         string
	ExpMonth     int
	ExpYear      int
	Issuer       string
	IsDefault    bool
	IsVerified   bool
	AddedAt      time.Time
}

// FiatAccount represents fiat balance
type FiatAccount struct {
	UserID             string
	Currency          string
	AvailableBalance float64
	LockedBalance    float64
	TotalDeposited  float64
	TotalWithdrawn  float64
}

// FiatGateway is the main fiat payment gateway
type FiatGateway struct {
	mu               sync.RWMutex
	config            Config
	methods          map[string]bool
	payments         map[string]*Payment
	userPayments    map[string]map[string]*Payment
	userCards      map[string]map[string]*Card
	userBankAccounts map[string]map[string]*BankAccount
	fiatAccounts    map[string]*FiatAccount
}

// New creates new FiatGateway
func New(cfg Config) *FiatGateway {
	gateway := &FiatGateway{
		config: config,
		methods: map[string]bool{
			MethodSEPA: cfg.EnableSEPA,
			MethodSWIFT: cfg.EnableSWIFT,
			MethodCard: cfg.EnableCard,
			MethodApplePay: cfg.EnableApplePay,
			MethodGooglePay: cfg.EnableGooglePay,
		},
		payments:        make(map[string]*Payment),
		userPayments:   make(map[string]map[string]*Payment),
		userCards:     make(map[string]map[string]*Card),
		userBankAccounts: make(map[string]map[string]*BankAccount),
		fiatAccounts: make(map[string]*FiatAccount),
	}

	return gateway
}

// InitiateDeposit initiates a fiat deposit
func (g *FiatGateway) InitiateDeposit(ctx context.Context, userID, method string, amount float64, currency string) (*Payment, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Validate method enabled
	if !g.methods[method] {
		return nil, fmt.Errorf("payment method not enabled: %s", method)
	}

	// Validate limits
	if amount < g.config.MinDeposit {
		return nil, fmt.Errorf("minimum deposit: %.2f", g.config.MinDeposit)
	}
	if amount > g.config.MaxDeposit {
		return nil, fmt.Errorf("maximum deposit: %.2f", g.config.MaxDeposit)
	}

	// Calculate fee
	fee := g.calculateFee(amount, method)

	payment := &Payment{
		ID:        generatePaymentID("DEP"),
		UserID:    userID,
		Type:     "deposit",
		Method:   method,
		Amount:   amount,
		Currency: currency,
		Fee:      fee,
		NetAmount: amount - fee,
		Status:   StatusPending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store payment
	g.payments[payment.ID] = payment
	if _, ok := g.userPayments[userID]; !ok {
		g.userPayments[userID] = make(map[string]*Payment)
	}
	g.userPayments[userID][payment.ID] = payment

	// Update fiat account
	accountKey := userID + ":" + currency
	account := g.fiatAccounts[accountKey]
	if account == nil {
		account = &FiatAccount{UserID: userID, Currency: currency}
		g.fiatAccounts[accountKey] = account
	}
	account.TotalDeposited += amount

	return payment, nil
}

// InitiateWithdrawal initiates a fiat withdrawal  
func (g *FiatGateway) InitiateWithdrawal(ctx context.Context, userID, method string, amount float64, currency string) (*Payment, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.methods[method] {
		return nil, fmt.Errorf("payment method not enabled: %s", method)
	}

	// Check balance
	accountKey := userID + ":" + currency
	account := g.fiatAccounts[accountKey]
	if account == nil || account.AvailableBalance < amount {
		return nil, fmt.Errorf("insufficient balance")
	}

	// Validate limits
	if amount < g.config.MinWithdrawal {
		return nil, fmt.Errorf("minimum withdrawal: %.2f", g.config.MinWithdrawal)
	}
	if amount > g.config.MaxWithdrawal {
		return nil, fmt.Errorf("maximum withdrawal: %.2f", g.config.MaxWithdrawal)
	}

	// Reserve balance
	account.AvailableBalance -= amount
	account.LockedBalance += amount

	fee := g.calculateFee(amount, method)

	payment := &Payment{
		ID:       generatePaymentID("WDR"),
		UserID:   userID,
		Type:     "withdrawal",
		Method:  method,
		Amount:  amount,
		Currency: currency,
		Fee:     fee,
		NetAmount: amount - fee,
		Status:  StatusProcessing,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	g.payments[payment.ID] = payment
	if _, ok := g.userPayments[userID]; !ok {
		g.userPayments[userID] = make(map[string]*Payment)
	}
	g.userPayments[userID][payment.ID] = payment

	return payment, nil
}

// CompletePayment completes a payment
func (g *FiatGateway) CompletePayment(ctx context.Context, paymentID string, processorRef string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	payment, ok := g.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found: %s", paymentID)
	}

	payment.ProcessorRef = processorRef
	payment.Status = StatusCompleted
	payment.UpdatedAt = time.Now()

	// Update account
	accountKey := payment.UserID + ":" + payment.Currency
	if account := g.fiatAccounts[accountKey]; account != nil {
		if payment.Type == "deposit" {
			account.AvailableBalance += payment.NetAmount
		} else if payment.Type == "withdrawal" {
			account.LockedBalance -= payment.NetAmount
			account.TotalWithdrawn += payment.NetAmount
		}
	}

	return nil
}

// CancelPayment cancels a payment
func (g *FiatGateway) CancelPayment(ctx context.Context, paymentID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	payment, ok := g.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found: %s", paymentID)
	}

	if payment.Status != StatusPending {
		return fmt.Errorf("cannot cancel payment in status: %s", payment.Status)
	}

	// Release locked funds
	if payment.Type == "withdrawal" {
		accountKey := payment.UserID + ":" + payment.Currency
		if account := g.fiatAccounts[accountKey]; account != nil {
			account.LockedBalance -= payment.NetAmount
			account.AvailableBalance += payment.NetAmount
		}
	}

	payment.Status = StatusCancelled
	payment.UpdatedAt = time.Now()

	return nil
}

// AddCard adds a new card
func (g *FiatGateway) AddCard(ctx context.Context, userID string, brand string, last4 string, expMonth, expYear int) (*Card, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if expMonth < 1 || expMonth > 12 || expYear < time.Now().Year() {
		return nil, fmt.Errorf("invalid card")
	}

	card := &Card{
		ID:       generateCardID(),
		UserID:   userID,
		Brand:    brand,
		Last4:    last4,
		ExpMonth: expMonth,
		ExpYear:  expYear,
		AddedAt:  time.Now(),
	}

	if _, ok := g.userCards[userID]; !ok {
		g.userCards[userID] = make(map[string]*Card)
	}
	g.userCards[userID][card.ID] = card

	return card, nil
}

// ListCards lists user's cards
func (g *FiatGateway) ListCards(ctx context.Context, userID string) ([]*Card, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if _, ok := g.userCards[userID]; !ok {
		return []*Card{}, nil
	}

	cards := make([]*Card, 0)
	for _, card := range g.userCards[userID] {
		cards = append(cards, card)
	}

	return cards, nil
}

// AddBankAccount adds a bank account  
func (g *FiatGateway) AddBankAccount(ctx context.Context, userID, accType, bankName, accountName, accountNumber, iban, bic string) (*BankAccount, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if accType == MethodSEPA && (iban == "" || !validateIBAN(iban)) {
		return nil, fmt.Errorf("invalid IBAN")
	}

	account := &BankAccount{
		ID:             generateBankAccountID(),
		UserID:         userID,
		Type:          accType,
		BankName:       bankName,
		AccountName:    accountName,
		AccountNumber: accountNumber,
		IBAN:        iban,
		SWIFTBIC:     bic,
		AddedAt:      time.Now(),
	}

	if _, ok := g.userBankAccounts[userID]; !ok {
		g.userBankAccounts[userID] = make(map[string]*BankAccount)
	}
	g.userBankAccounts[userID][account.ID] = account

	return account, nil
}

// ListBankAccounts lists user's bank accounts
func (g *FiatGateway) ListBankAccounts(ctx context.Context, userID string) ([]*BankAccount, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if _, ok := g.userBankAccounts[userID]; !ok {
		return []*BankAccount{}, nil
	}

	accounts := make([]*BankAccount, 0)
	for _, acc := range g.userBankAccounts[userID] {
		accounts = append(accounts, acc)
	}

	return accounts, nil
}

// GetFiatBalance gets user's fiat balance
func (g *FiatGateway) GetFiatBalance(ctx context.Context, userID, currency string) (*FiatAccount, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	accountKey := userID + ":" + currency
	account, ok := g.fiatAccounts[accountKey]
	if !ok {
		return &FiatAccount{UserID: userID, Currency: currency}, nil
	}

	return account, nil
}

// GetPayment gets payment by ID
func (g *FiatGateway) GetPayment(ctx context.Context, paymentID string) (*Payment, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	payment, ok := g.payments[paymentID]
	if !ok {
		return nil, fmt.Errorf("payment not found")
	}

	return payment, nil
}

// ListPayments lists user's payments
func (g *FiatGateway) ListPayments(ctx context.Context, userID string, limit int) ([]*Payment, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if _, ok := g.userPayments[userID]; !ok {
		return []*Payment{}, nil
	}

	payments := make([]*Payment, 0)
	for _, p := range g.userPayments[userID] {
		payments = append(payments, p)
		if limit > 0 && len(payments) >= limit {
			break
		}
	}

	return payments, nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func (g *FiatGateway) calculateFee(amount float64, method string) float64 {
	switch method {
	case MethodSEPA:
		return g.config.SEPAFee
	case MethodSWIFT:
		return g.config.SWIFTFee
	case MethodCard:
		return amount * g.config.CardFee / 100
	}
	return 0
}

func generatePaymentID(prefix string) string {
	return fmt.Sprintf("%s%x", prefix, time.Now().UnixNano())
}

func generateCardID() string {
	return fmt.Sprintf("CARD%x", time.Now().UnixNano())
}

func generateBankAccountID() string {
	return fmt.Sprintf("BANK%x", time.Now().UnixNano())
}

func validateIBAN(iban string) bool {
	if len(iban) < 15 || len(iban) > 34 {
		return false
	}
	// Basic check sum validation would go here
	return true
}

var print = fmt.Println
var _ = math.MaxFloat64

func init() {
	_ = print
}

var (
	_ = context.Background{}
	_ = time.Now
)