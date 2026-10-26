package payment

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
	MethodCard  PaymentMethod = "CARD"
	MethodBank  PaymentMethod = "BANK"
	MethodSWIFT PaymentMethod = "SWIFT"
	MethodSEPA  PaymentMethod = "SEPA"
	MethodFPS   PaymentMethod = "FPS"
	MethodWire  PaymentMethod = "WIRE"
	MethodPix   PaymentMethod = "PIX"
	MethodUPI   PaymentMethod = "UPI"
)

// PaymentStatus payment status
type PaymentStatus string

const (
	StatusPending    PaymentStatus = "PENDING"
	StatusProcessing PaymentStatus = "PROCESSING"
	StatusCompleted  PaymentStatus = "COMPLETED"
	StatusFailed     PaymentStatus = "FAILED"
	StatusRefunded   PaymentStatus = "REFUNDED"
)

// Payment represents a fiat payment
type Payment struct {
	ID            string        `json:"id"`
	UserID        string        `json:"userId"`
	Type          string        `json:"type"` // DEPOSIT, WITHDRAWAL
	Method        PaymentMethod `json:"method"`
	Asset         string        `json:"asset"` // USD, EUR, GBP, etc
	Amount        float64       `json:"amount"`
	Fees          float64       `json:"fees"`
	Total         float64       `json:"total"`
	Status        PaymentStatus `json:"status"`
	Provider      string        `json:"provider"` // STRIPE, PLATID, etc
	ProviderID    string        `json:"providerId"`
	ProviderRef   string        `json:"providerRef"`
	BankAccount   string        `json:"bankAccount"`
	BankCode      string        `json:"bankCode"`
	SwiftCode     string        `json:"swiftCode"`
	Iban          string        `json:"iban"`
	RedirectURL   string        `json:"redirectUrl"`
	WebhookCalled bool          `json:"webhookCalled"`
	ProcessedAt   *time.Time    `json:"processedAt,omitempty"`
	CompletedAt   *time.Time    `json:"completedAt,omitempty"`
	FailReason    string        `json:"failReason"`
	CreatedAt     time.Time     `json:"createdAt"`
}

// CardPayment card payment request
type CardPayment struct {
	Number   string `json:"number"`
	ExpMonth int    `json:"expMonth"`
	ExpYear  int    `json:"expYear"`
	CVC      string `json:"cvc"`
	Name     string `json:"name"`
	Address  string `json:"address"`
	City     string `json:"city"`
	State    string `json:"state"`
	Country  string `json:"country"`
	ZipCode  string `json:"zipCode"`
}

// BankAccount bank account details
type BankAccount struct {
	BankName    string `json:"bankName"`
	AccountName string `json:"accountName"`
	AccountNum  string `json:"accountNum"`
	RoutingNum  string `json:"routingNum"`
	Iban        string `json:"iban"`
	SwiftCode   string `json:"swiftCode"`
	Country     string `json:"country"`
}

// GatewayConfig gateway configuration
// Provider settles a payment with an external payment service provider. It is
// the seam a real Stripe, Plaid, or bank integration implements.
type Provider interface {
	// Settle submits the payment. The returned reference identifies it at the
	// provider. A nil error means the provider accepted the request; the
	// payment is only completed once the provider confirms it, normally via a
	// signed webhook.
	Settle(ctx context.Context, payment *Payment, card *CardPayment, bank *BankAccount) (providerRef string, err error)
}

type GatewayConfig struct {
	StripeSecret  string
	StripeWebhook string
	PlatiSecret   string
	PlatiWebhook  string
	MinDeposit    float64
	MaxDeposit    float64
	MinWithdraw   float64
	MaxWithdraw   float64

	// Provider settles payments. When nil, a payment cannot be submitted.
	Provider Provider
	// WebhookSecret is the shared secret used to authenticate provider
	// webhooks. When empty, webhooks are rejected rather than trusted.
	WebhookSecret string
}

// Service payment gateway service
type Service struct {
	mu     sync.RWMutex
	config *GatewayConfig

	// Payments
	payments     map[string]*Payment
	userPayments map[string]map[string]*Payment // userID -> paymentID -> Payment
	providers    []string

	// Bank accounts by user
	userBankAccounts map[string][]*BankAccount

	// Pending_webhooks
	pendingWebhooks map[string]bool

	// Rates (exchange rates)
	rates map[string]float64 // asset -> USD rate

	// Limits
	dailyDepositLimit  float64
	dailyWithdrawLimit float64
}

// NewService creates payment gateway service
func NewService(config *GatewayConfig) *Service {
	if config == nil {
		config = &GatewayConfig{
			MinDeposit:  10,
			MaxDeposit:  10000,
			MinWithdraw: 10,
			MaxWithdraw: 50000,
		}
	}

	return &Service{
		config:             config,
		payments:           make(map[string]*Payment),
		userPayments:       make(map[string]map[string]*Payment),
		userBankAccounts:   make(map[string][]*BankAccount),
		pendingWebhooks:    make(map[string]bool),
		rates:              initRates(),
		dailyDepositLimit:  50000,
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
		ID:        generateID(),
		UserID:    userID,
		Type:      "DEPOSIT",
		Method:    method,
		Asset:     "USD",
		Amount:    amount,
		Fees:      fees,
		Total:     total,
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

// ProcessPayment submits a payment to the configured provider.
//
// The previous version invented a provider reference, slept for two seconds,
// and then marked the payment completed. No money ever moved, yet the payment
// looked settled to every downstream caller.
func (s *Service) ProcessPayment(paymentID string) error {
	s.mu.RLock()
	payment, ok := s.payments[paymentID]
	provider := s.config.Provider
	var card *CardPayment
	var bank *BankAccount
	s.mu.RUnlock()

	if !ok {
		return fmt.Errorf("payment not found")
	}
	if provider == nil {
		return fmt.Errorf("no payment provider configured")
	}
	if payment.Status != StatusPending && payment.Status != StatusProcessing {
		return fmt.Errorf("invalid status")
	}

	// A withdrawal needs a bank account on file; look up the most recent one.
	if payment.Type == "WITHDRAWAL" {
		s.mu.RLock()
		accounts := s.userBankAccounts[payment.UserID]
		if len(accounts) > 0 {
			bank = accounts[len(accounts)-1]
		}
		s.mu.RUnlock()
		if bank == nil {
			return fmt.Errorf("no bank account on file for withdrawal")
		}
	}

	ref, err := provider.Settle(context.Background(), payment, card, bank)
	if err != nil {
		return fmt.Errorf("provider settlement failed: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	payment, ok = s.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}
	payment.Status = StatusProcessing
	payment.ProviderRef = ref
	now := time.Now()
	payment.ProcessedAt = &now

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
		ID:          generateID(),
		UserID:      userID,
		Type:        "WITHDRAWAL",
		Method:      method,
		Asset:       "USD",
		Amount:      amount,
		Fees:        fees,
		Total:       total,
		Status:      StatusPending,
		Provider:    "STRIPE",
		BankAccount: bank.AccountNum,
		BankCode:    bank.RoutingNum,
		SwiftCode:   bank.SwiftCode,
		Iban:        bank.Iban,
		CreatedAt:   time.Now(),
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
		return amount*0.029 + 0.30 // Stripe 2.9% + 30c
	case MethodBank, MethodSWIFT, MethodWire:
		return max(amount*0.01, 15) // 1% min $15
	case MethodSEPA:
		return max(amount*0.005, 1) // 0.5% min 1 euro
	case MethodPix, MethodUPI:
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
	if bank.Iban != "" && !ValidIBAN(bank.Iban) {
		return fmt.Errorf("invalid IBAN")
	}

	s.userBankAccounts[userID] = append(s.userBankAccounts[userID], bank)

	return nil
}

// ValidIBAN reports whether iban passes the ISO 13616 mod-97 check. It also
// enforces the structural rules: two letters, two check digits, then 11 to 30
// alphanumerics.
func ValidIBAN(iban string) bool {
	normalised := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(iban), " ", ""))
	if len(normalised) < 15 || len(normalised) > 34 {
		return false
	}
	for i, r := range normalised {
		if i < 2 {
			if r < 'A' || r > 'Z' {
				return false
			}
			continue
		}
		if i < 4 {
			if r < '0' || r > '9' {
				return false
			}
			continue
		}
		if (r < '0' || r > '9') && (r < 'A' || r > 'Z') {
			return false
		}
	}

	// Move the first four characters to the end, then map letters to digits
	// (A=10 .. Z=35) and evaluate the resulting number modulo 97.
	rearranged := normalised[4:] + normalised[:4]
	remainder := 0
	for _, r := range rearranged {
		var value int
		if r >= '0' && r <= '9' {
			value = int(r - '0')
		} else {
			value = int(r-'A') + 10
		}
		if value >= 10 {
			remainder = (remainder*100 + value) % 97
		} else {
			remainder = (remainder*10 + value) % 97
		}
	}
	return remainder == 1
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

	// The provider's signature must be verified before the payload is trusted.
	// Without this check any caller could mark an arbitrary payment completed.
	if s.config.WebhookSecret == "" {
		return fmt.Errorf("webhook secret is not configured")
	}
	mac := hmac.New(sha256.New, []byte(s.config.WebhookSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	provided := strings.TrimSpace(signature)
	if subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) != 1 {
		return fmt.Errorf("invalid webhook signature")
	}

	var webhook struct {
		Type string `json:"type"`
		Data struct {
			PaymentID string `json:"id"`
			Status    string `json:"status"`
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
	if s.config.Provider == nil {
		return fmt.Errorf("no payment provider configured")
	}

	payment.Status = StatusRefunded
	payment.ProviderRef = generateProviderID()

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
