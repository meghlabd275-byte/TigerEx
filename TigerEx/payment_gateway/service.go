package payment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// =============================================================================
// PAYMENT GATEWAY SERVICE
// Fiat on/off ramps, card payments, banking
// =============================================================================

// PaymentMethod payment method
type PaymentMethod string

const (
	MethodCard     PaymentMethod = "CARD"
	MethodBank    PaymentMethod = "BANK"
	MethodSWIFT   PaymentMethod = "SWIFT"
	MethodSEPA    PaymentMethod = "SEPA"
	MethodFPS     PaymentMethod = "FPS"
	MethodWire    PaymentMethod = "WIRE"
	MethodPix     PaymentMethod = "PIX"
	MethodUPI     PaymentMethod = "UPI"
)

// PaymentStatus payment status
type PaymentStatus string

const (
	StatusPending   PaymentStatus = "PENDING"
	StatusProcessing PaymentStatus = "PROCESSING"
	StatusCompleted PaymentStatus = "COMPLETED"
	StatusFailed   PaymentStatus = "FAILED"
	StatusRefunded PaymentStatus = "REFUNDED"
)

// Payment represents a fiat payment
type Payment struct {
	ID              string         `json:"id"`
	UserID         string         `json:"userId"`
	Type           string         `json:"type"` // DEPOSIT, WITHDRAWAL
	Method         PaymentMethod  `json:"method"`
	Asset          string         `json:"asset"` // USD, EUR, GBP, etc
	Amount         float64        `json:"amount"`
	Fees           float64        `json:"fees"`
	Total          float64        `json:"total"`
	Status         PaymentStatus `json:"status"`
	Provider       string        `json:"provider"` // STRIPE, PLATID, etc
	ProviderID     string        `json:"providerId"`
	ProviderRef    string        `json:"providerRef"`
	BankAccount   string        `json:"bankAccount"`
	BankCode      string        `json:"bankCode"`
	SwiftCode     string        `json:"swiftCode"`
	Iban          string        `json:"iban"`
	RedirectURL   string        `json:"redirectUrl"`
	WebhookCalled bool          `json:"webhookCalled"`
	ProcessedAt   *time.Time   `json:"processedAt,omitempty"`
	CompletedAt   *time.Time   `json:"completedAt,omitempty"`
	FailReason    string       `json:"failReason"`
	CreatedAt     time.Time    `json:"createdAt"`
}

// CardPayment card payment request
type CardPayment struct {
	Number     string `json:"number"`
	ExpMonth   int    `json:"expMonth"`
	ExpYear   int    `json:"expYear"`
	CVC       string `json:"cvc"`
	Name      string `json:"name"`
	Address   string `json:"address"`
	City      string `json:"city"`
	State     string `json:"state"`
	Country   string `json:"country"`
	ZipCode   string `json:"zipCode"`
}

// BankAccount bank account details
type BankAccount struct {
	BankName     string `json:"bankName"`
	AccountName string `json:"accountName"`
	AccountNum string `json:"accountNum"`
	RoutingNum string `json:"routingNum"`
	Iban       string `json:"iban"`
	SwiftCode  string `json:"swiftCode"`
	Country   string `json:"country"`
}

// GatewayConfig gateway configuration
type GatewayConfig struct {
	StripeSecret   string
	StripeWebhook string
	PlatiSecret  string
	PlatiWebhook string
	MinDeposit   float64
	MaxDeposit   float64
	MinWithdraw float64
	MaxWithdraw float64
}

// Service payment gateway service
type Service struct {
	mu sync.RWMutex
	config *GatewayConfig

	// Payments
	payments map[string]*Payment
	userPayments map[string]map[string]*Payment // userID -> paymentID -> Payment
	providers []string

	// Bank accounts by user
	userBankAccounts map[string][]*BankAccount

	// Pending_webhooks
	pendingWebhooks map[string]bool

	// Rates (exchange rates)
	rates map[string]float64 // asset -> USD rate

	// Limits
	dailyDepositLimit float64
	dailyWithdrawLimit float64
}

// NewService creates payment gateway service
func NewService(config *GatewayConfig) *Service {
	if config == nil {
		config = &GatewayConfig{
			MinDeposit:   10,
			MaxDeposit:   10000,
			MinWithdraw: 10,
			MaxWithdraw: 50000,
		}
	}

	return &Service{
		config:          config,
		payments:       make(map[string]*Payment),
		userPayments:  make(map[string]map[string]*Payment),
		userBankAccounts: make(map[string][]*BankAccount),
		pendingWebhooks: make(map[string]bool),
		rates:         initRates(),
		dailyDepositLimit: 50000,
		dailyWithdrawLimit: 50000,
	}
}

// Initialize rates
func initRates() map[string]float64 {
	return map[string]float64{
		"USD": 1.0,
		"EUR": 1.08,
		"GBP": 1.27,
		"JPY": 0.0067,
		"CAD": 0.74,
		"AUD": 0.65,
		"CHF": 1.13,
		"CNY": 0.14,
		"INR": 0.012,
		"BRL": 0.20,
	}
}

// CreateDeposit creates deposit request
func (s *Service) CreateDeposit(userID string, method PaymentMethod, amount float64, card *CardPayment) (*Payment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate limits
	if amount < s.config.MinDeposit {
		return nil, fmt.Errorf("minimum deposit: %.2f", s.config.MinDeposit)
	}
	if amount > s.config.MaxDeposit {
		return nil, fmt.Errorf("maximum deposit: %.2f", s.config.MaxDeposit)
	}

	// Check daily limit
	dailyTotal := s.getDailyTotal(userID, "DEPOSIT")
	if dailyTotal+amount > s.dailyDepositLimit {
		return nil, fmt.Errorf("daily deposit limit reached")
	}

	// Calculate fees
	fees := s.calculateFees(method, amount)
	total := amount + fees

	payment := &Payment{
		ID:          generateID(),
		UserID:     userID,
		Type:       "DEPOSIT",
		Method:     method,
		Asset:      "USD",
		Amount:     amount,
		Fees:       fees,
		Total:      total,
		Status:    StatusPending,
		Provider:  "STRIPE", // Default
		CreatedAt: time.Now(),
	}

	s.payments[payment.ID] = payment

	if s.userPayments[userID] == nil {
		s.userPayments[userID] = make(map[string]*Payment)
	}
	s.userPayments[userID][payment.ID] = payment

	return payment, nil
}

// ProcessPayment processes a payment (simulated - production calls providers)
func (s *Service) ProcessPayment(paymentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	payment, ok := s.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}

	if payment.Status != StatusPending && payment.Status != StatusProcessing {
		return fmt.Errorf("invalid status")
	}

	// Simulate processing
	payment.Status = StatusProcessing
	payment.ProviderID = generateProviderID()

	// Simulate async completion
	go func() {
		time.Sleep(2 * time.Second)

		s.mu.Lock()
		defer s.mu.Unlock()

		p, ok := s.payments[paymentID]
		if !ok {
			return
		}

		p.Status = StatusCompleted
		now := time.Now()
		p.CompletedAt = &now
	}()

	return nil
}

// CreateWithdrawal creates withdrawal request
func (s *Service) CreateWithdrawal(userID string, method PaymentMethod, amount float64, bank *BankAccount) (*Payment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate limits
	if amount < s.config.MinWithdraw {
		return nil, fmt.Errorf("minimum withdrawal: %.2f", s.config.MinWithdraw)
	}
	if amount > s.config.MaxWithdraw {
		return nil, fmt.Errorf("maximum withdrawal: %.2f", s.config.MaxWithdraw)
	}

	// Check daily limit
	dailyTotal := s.getDailyTotal(userID, "WITHDRAWAL")
	if dailyTotal+amount > s.dailyWithdrawLimit {
		return nil, fmt.Errorf("daily withdrawal limit reached")
	}

	// Validate bank account
	if bank == nil {
		return nil, fmt.Errorf("bank account required")
	}

	// Calculate fees
	fees := s.calculateFees(method, amount)
	total := amount - fees

	payment := &Payment{
		ID:           generateID(),
		UserID:       userID,
		Type:        "WITHDRAWAL",
		Method:      method,
		Asset:       "USD",
		Amount:      amount,
		Fees:        fees,
		Total:       total,
		Status:      StatusPending,
		Provider:   "STRIPE",
		BankAccount: bank.AccountNum,
		BankCode:    bank.RoutingNum,
		SwiftCode:  bank.SwiftCode,
		Iban:       bank.Iban,
		CreatedAt:  time.Now(),
	}

	s.payments[payment.ID] = payment

	if s.userPayments[userID] == nil {
		s.userPayments[userID] = make(map[string]*Payment)
	}
	s.userPayments[userID][payment.ID] = payment

	return payment, nil
}

// calculateFees calculates payment fees
func (s *Service) calculateFees(method PaymentMethod, amount float64) float64 {
	switch method {
	case MethodCard:
		return amount * 0.029 + 0.30 // Stripe 2.9% + 30c
	case MethodBank, MethodSWIFT, MethodWire:
		return max(amount*0.01, 15) // 1% min $15
	case MethodSEPA:
		return max(amount*0.005, 1) // 0.5% min 1 euro
	case MethodPIX, MethodUPI:
		return 0 // Free
	default:
		return amount * 0.01
	}
}

// AddBankAccount adds bank account for user
func (s *Service) AddBankAccount(userID string, bank *BankAccount) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate
	if bank.AccountNum == "" || (bank.Iban == "" && bank.SwiftCode == "") {
		return fmt.Errorf("invalid bank account")
	}

	s.userBankAccounts[userID] = append(s.userBankAccounts[userID], bank)

	return nil
}

// GetBankAccounts gets user's bank accounts
func (s *Service) GetBankAccounts(userID string) []*BankAccount {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.userBankAccounts[userID]
}

// GetPayment gets payment
func (s *Service) GetPayment(paymentID string) (*Payment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	payment, ok := s.payments[paymentID]
	if !ok {
		return nil, fmt.Errorf("payment not found")
	}

	return payment, nil
}

// GetUserPayments gets user's payments
func (s *Service) GetUserPayments(userID, statusFilter string, limit int) []*Payment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userPays := s.userPayments[userID]
	if userPays == nil {
		return nil
	}

	var result []*Payment
	count := 0
	for _, p := range userPays {
		if statusFilter != "" && p.Status != PaymentStatus(statusFilter) {
			continue
		}
		result = append(result, p)
		count++
		if limit > 0 && count >= limit {
			break
		}
	}

	return result
}

// getDailyTotal gets daily total for type
func (s *Service) getDailyTotal(userID, ptype string) float64 {
	userPays := s.userPayments[userID]
	if userPays == nil {
		return 0
	}

	var total float64
	today := time.Now().Truncate(24 * time.Hour)

	for _, p := range userPays {
		if p.Type != ptype {
			continue
		}
		if p.CreatedAt.After(today) {
			total += p.Amount
		}
	}

	return total
}

// HandleWebhook handles webhook from payment provider
func (s *Service) HandleWebhook(payload []byte, signature string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// In production, verify signature
	var webhook struct {
		Type string `json:"type"`
		Data struct {
			PaymentID string `json:"id"`
			Status  string `json:"status"`
		} `json:"data"`
	}

	if err := json.Unmarshal(payload, &webhook); err != nil {
		return fmt.Errorf("invalid webhook")
	}

	payment, ok := s.payments[webhook.Data.PaymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}

	switch PaymentStatus(webhook.Data.Status) {
	case "succeeded":
		payment.Status = StatusCompleted
	case "failed":
		payment.Status = StatusFailed
	case "refunded":
		payment.Status = StatusRefunded
	}

	now := time.Now()
	payment.CompletedAt = &now
	payment.WebhookCalled = true

	return nil
}

// GetExchangeRate gets exchange rate to USD
func (s *Service) GetExchangeRate(asset string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.rates[asset]
}

// Refund initiates refund
func (s *Service) Refund(paymentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	payment, ok := s.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}

	if payment.Type != "DEPOSIT" {
		return fmt.Errorf("can only refund deposits")
	}

	if payment.Status != StatusCompleted {
		return fmt.Errorf("can only refund completed payments")
	}

	payment.Status = StatusRefunded

	return nil
}

// Cancel cancels pending payment
func (s *Service) Cancel(paymentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	payment, ok := s.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}

	if payment.Status != StatusPending {
		return fmt.Errorf("can only cancel pending")
	}

	payment.Status = StatusFailed
	payment.FailReason = "cancelled_by_user"

	return nil
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("pay_%s", hex.EncodeToString(b))
}

func generateProviderID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// HTTP Client for external calls
var httpClient = &http.Client{Timeout: 30 * time.Second}

// CallProvider calls external payment provider
func CallProvider(method, endpoint string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = strings.NewReader(string(b))
	}

	req, _ := http.NewRequest(method, endpoint, bodyReader)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}

var _ context.Context = nil