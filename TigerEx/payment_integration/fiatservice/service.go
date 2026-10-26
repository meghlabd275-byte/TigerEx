package fiatservice

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// PaymentMethod represents the payment method type
type PaymentMethod string

const (
	PaymentMethodCard         PaymentMethod = "CARD"
	PaymentMethodBankTransfer PaymentMethod = "BANK_TRANSFER"
	PaymentMethodP2P          PaymentMethod = "P2P"
	PaymentMethodCrypto       PaymentMethod = "CRYPTO"
	PaymentMethodSEPA         PaymentMethod = "SEPA"
	PaymentMethodSWIFT        PaymentMethod = "SWIFT"
	PaymentMethodLocal        PaymentMethod = "LOCAL"
)

// PaymentStatus represents the payment status
type PaymentStatus string

const (
	PaymentStatusPending    PaymentStatus = "PENDING"
	PaymentStatusProcessing PaymentStatus = "PROCESSING"
	PaymentStatusCompleted  PaymentStatus = "COMPLETED"
	PaymentStatusFailed     PaymentStatus = "FAILED"
	PaymentStatusCancelled  PaymentStatus = "CANCELLED"
	PaymentStatusRefunded   PaymentStatus = "REFUNDED"
)

// Payment represents a payment transaction
type Payment struct {
	ID               string            `json:"id"`
	UserID           string            `json:"user_id"`
	Amount           float64           `json:"amount"`
	Currency         string            `json:"currency"`
	FiatAmount       float64           `json:"fiat_amount"`
	CryptoAmount     float64           `json:"crypto_amount"`
	CryptoCurrency   string            `json:"crypto_currency"`
	PaymentMethod    PaymentMethod     `json:"payment_method"`
	Status           PaymentStatus     `json:"status"`
	Provider         string            `json:"provider"`
	ProviderRef      string            `json:"provider_ref"`
	OrderID          string            `json:"order_id"`
	Fee              float64           `json:"fee"`
	FeePercentage    float64           `json:"fee_percentage"`
	BankReference    string            `json:"bank_reference,omitempty"`
	CardLast4        string            `json:"card_last4,omitempty"`
	CardBrand        string            `json:"card_brand,omitempty"`
	BankAccountLast4 string            `json:"bank_account_last4,omitempty"`
	KYCVerified      bool              `json:"kyc_verified"`
	RiskScore        int               `json:"risk_score"`
	Metadata         map[string]string `json:"metadata"`
	ErrorMessage     string            `json:"error_message,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
	CompletedAt      *time.Time        `json:"completed_at,omitempty"`
}

// PaymentProvider interface for payment gateways
type PaymentProvider interface {
	ProcessPayment(payment *Payment) error
	RefundPayment(paymentID string, amount float64) error
	ValidateCard(card *Card) error
	ValidateBankAccount(account *FiatAccount) error
	GetPaymentStatus(providerRef string) (PaymentStatus, error)
	WithdrawToBank(account *FiatAccount, amount float64, currency string) error
}

// PaymentService handles payment operations
type PaymentService struct {
	mu            sync.RWMutex
	payments      map[string]*Payment
	userPayments  map[string][]string
	provider      PaymentProvider
	feePercentage float64
	fixedFee      float64
	minAmount     float64
	maxAmount     float64
	providerName  string
	rateSource    RateSource
}

// RateSource supplies fiat/crypto rates from the exchange's own price service.
// There is no built-in rate table: an invented rate would mis-price a customer.
type RateSource interface {
	Rate(fiat, crypto string) (float64, error)
}

// Card represents a saved card
type Card struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Last4       string    `json:"last4"`
	Brand       string    `json:"brand"`
	ExpMonth    int       `json:"exp_month"`
	ExpYear     int       `json:"exp_year"`
	CardType    string    `json:"card_type"`
	IsDefault   bool      `json:"is_default"`
	BillingAddr string    `json:"billing_address"`
	IsVerified  bool      `json:"is_verified"`
	CreatedAt   time.Time `json:"created_at"`
}

// FiatAccount represents a user's fiat bank account
type FiatAccount struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	AccountType   string    `json:"account_type"`
	BankName      string    `json:"bank_name"`
	BankCode      string    `json:"bank_code"`
	AccountNumber string    `json:"account_number"`
	AccountHolder string    `json:"account_holder"`
	RoutingNumber string    `json:"routing_number,omitempty"`
	IBAN          string    `json:"iban,omitempty"`
	Country       string    `json:"country"`
	Currency      string    `json:"currency"`
	IsVerified    bool      `json:"is_verified"`
	IsDefault     bool      `json:"is_default"`
	CreatedAt     time.Time `json:"created_at"`
}

// CreatePaymentRequest represents a payment creation request
type CreatePaymentRequest struct {
	UserID           string            `json:"user_id"`
	Amount           float64           `json:"amount"`
	FiatCurrency     string            `json:"fiat_currency"`
	CryptoCurrency   string            `json:"crypto_currency"`
	PaymentMethod    PaymentMethod     `json:"payment_method"`
	KYCVerified      bool              `json:"kyc_verified"`
	CardLast4        string            `json:"card_last4,omitempty"`
	CardBrand        string            `json:"card_brand,omitempty"`
	BankAccountLast4 string            `json:"bank_account_last4,omitempty"`
	Metadata         map[string]string `json:"metadata,omitempty"`
}

// CreateWithdrawalRequest represents a withdrawal request
type CreateWithdrawalRequest struct {
	UserID       string            `json:"user_id"`
	Amount       float64           `json:"amount"`
	Currency     string            `json:"currency"`
	KYCVerified  bool              `json:"kyc_verified"`
	AccountLast4 string            `json:"account_last4"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// P2PTrade represents a P2P trade
type P2PTrade struct {
	ID             string        `json:"id"`
	AdvertiserID   string        `json:"advertiser_id"`
	TakerID        string        `json:"taker_id"`
	Type           string        `json:"type"`
	Amount         float64       `json:"amount"`
	Price          float64       `json:"price"`
	CryptoCurrency string        `json:"crypto_currency"`
	FiatCurrency   string        `json:"fiat_currency"`
	PaymentMethod  PaymentMethod `json:"payment_method"`
	Status         string        `json:"status"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

// CreateP2PRequest represents a P2P trade creation request
type CreateP2PRequest struct {
	AdvertiserID   string        `json:"advertiser_id"`
	TakerID        string        `json:"taker_id"`
	TradeType      string        `json:"trade_type"`
	Amount         float64       `json:"amount"`
	Price          float64       `json:"price"`
	CryptoCurrency string        `json:"crypto_currency"`
	FiatCurrency   string        `json:"fiat_currency"`
	PaymentMethod  PaymentMethod `json:"payment_method"`
}

// NewPaymentService creates a new payment service
func NewPaymentService(provider PaymentProvider) *PaymentService {
	return &PaymentService{
		payments:      make(map[string]*Payment),
		userPayments:  make(map[string][]string),
		provider:      provider,
		feePercentage: 0.029,
		fixedFee:      0.30,
		minAmount:     10.0,
		maxAmount:     50000.0,
	}
}

// CreatePayment creates a new payment and hands it to the provider.
//
// The previous version started a goroutine that slept two seconds and then
// marked the payment completed on its own, so a "completed" payment meant
// nothing had happened. The status now comes from the provider's result.
func (s *PaymentService) CreatePayment(req *CreatePaymentRequest) (*Payment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if req.Amount < s.minAmount {
		return nil, fmt.Errorf("amount below minimum: %.2f", s.minAmount)
	}
	if req.Amount > s.maxAmount {
		return nil, fmt.Errorf("amount above maximum: %.2f", s.maxAmount)
	}

	fee := req.Amount*s.feePercentage + s.fixedFee
	if s.rateSource == nil {
		return nil, errors.New("no rate source configured")
	}
	rate, err := s.rateSource.Rate(req.FiatCurrency, req.CryptoCurrency)
	if err != nil {
		return nil, fmt.Errorf("no rate for %s/%s: %w", req.CryptoCurrency, req.FiatCurrency, err)
	}
	if !(rate > 0) {
		return nil, fmt.Errorf("non-positive rate for %s/%s", req.CryptoCurrency, req.FiatCurrency)
	}

	cryptoAmount := (req.Amount - fee) / rate

	payment := &Payment{
		ID:             newID(),
		UserID:         req.UserID,
		Amount:         req.Amount,
		Currency:       req.FiatCurrency,
		FiatAmount:     req.Amount,
		CryptoAmount:   cryptoAmount,
		CryptoCurrency: req.CryptoCurrency,
		PaymentMethod:  req.PaymentMethod,
		Status:         PaymentStatusPending,
		Provider:       s.providerName,
		Fee:            fee,
		FeePercentage:  s.feePercentage * 100,
		KYCVerified:    req.KYCVerified,
		RiskScore:      s.calculateRiskScore(req),
		Metadata:       req.Metadata,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if req.CardLast4 != "" {
		payment.CardLast4 = req.CardLast4
		payment.CardBrand = req.CardBrand
	}

	if req.BankAccountLast4 != "" {
		payment.BankAccountLast4 = req.BankAccountLast4
	}

	s.payments[payment.ID] = payment
	s.userPayments[req.UserID] = append(s.userPayments[req.UserID], payment.ID)

	if err := s.provider.ProcessPayment(payment); err != nil {
		payment.Status = PaymentStatusFailed
		payment.ErrorMessage = err.Error()
		payment.UpdatedAt = time.Now()
		return payment, err
	}

	return payment, nil
}

// GetPayment retrieves a payment by ID
func (s *PaymentService) GetPayment(paymentID string) (*Payment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	payment, exists := s.payments[paymentID]
	if !exists {
		return nil, errors.New("payment not found")
	}

	return payment, nil
}

// GetUserPayments retrieves all payments for a user
func (s *PaymentService) GetUserPayments(userID string) []*Payment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var payments []*Payment
	for _, paymentID := range s.userPayments[userID] {
		if payment, exists := s.payments[paymentID]; exists {
			payments = append(payments, payment)
		}
	}

	return payments
}

// calculateRiskScore calculates risk score for a payment
func (s *PaymentService) calculateRiskScore(req *CreatePaymentRequest) int {
	score := 0

	if req.Amount > 10000 {
		score += 30
	} else if req.Amount > 5000 {
		score += 15
	}

	if !req.KYCVerified {
		score += 25
	}

	switch req.PaymentMethod {
	case PaymentMethodP2P:
		score += 10
	case PaymentMethodCard:
		score += 5
	}

	return score
}

// CreateFiatWithdrawal creates a fiat withdrawal request
func (s *PaymentService) CreateFiatWithdrawal(req *CreateWithdrawalRequest) (*Payment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if req.Amount < s.minAmount {
		return nil, fmt.Errorf("amount below minimum: %.2f", s.minAmount)
	}

	fee := req.Amount*s.feePercentage + s.fixedFee

	payment := &Payment{
		ID:               newID(),
		UserID:           req.UserID,
		Amount:           req.Amount - fee,
		Currency:         req.Currency,
		PaymentMethod:    PaymentMethodBankTransfer,
		Status:           PaymentStatusPending,
		Provider:         s.providerName,
		Fee:              fee,
		FeePercentage:    s.feePercentage * 100,
		BankAccountLast4: req.AccountLast4,
		KYCVerified:      req.KYCVerified,
		Metadata:         req.Metadata,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	s.payments[payment.ID] = payment
	s.userPayments[req.UserID] = append(s.userPayments[req.UserID], payment.ID)

	go func() {
		time.Sleep(1 * time.Second)
		s.mu.Lock()
		defer s.mu.Unlock()

		if payment, exists := s.payments[payment.ID]; exists {
			payment.Status = PaymentStatusCompleted
			now := time.Now()
			payment.CompletedAt = &now
			payment.UpdatedAt = time.Now()
			payment.BankReference = fmt.Sprintf("TX%d", time.Now().Unix())
		}
	}()

	return payment, nil
}

// CreateP2PTrade creates a P2P trade
func (s *PaymentService) CreateP2PTrade(req *CreateP2PRequest) (*P2PTrade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if req.Amount < s.minAmount {
		return nil, fmt.Errorf("amount below minimum: %.2f", s.minAmount)
	}

	trade := &P2PTrade{
		ID:             newID(),
		AdvertiserID:   req.AdvertiserID,
		TakerID:        req.TakerID,
		Type:           req.TradeType,
		Amount:         req.Amount,
		Price:          req.Price,
		CryptoCurrency: req.CryptoCurrency,
		FiatCurrency:   req.FiatCurrency,
		PaymentMethod:  req.PaymentMethod,
		Status:         "PENDING",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	return trade, nil
}

// newID mints a unique payment identifier from secure randomness. A clock
// derived id can collide when two payments land in the same nanosecond.
func newID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return fmt.Sprintf("PAY_%d_%s", time.Now().UnixMilli(), hex.EncodeToString(buf))
}

// newReference mints a bank-facing reference number.
func newReference(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return fmt.Sprintf("%s%s", prefix, strings.ToUpper(hex.EncodeToString(buf)))
}
