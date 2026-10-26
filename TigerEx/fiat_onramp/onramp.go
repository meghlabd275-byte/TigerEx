package fiatonramp

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// FIAT ON-RAMP
// Fiat-to-crypto on-ramp for buying crypto with fiat currency
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// FiatCurrency represents supported fiat currencies
type FiatCurrency struct {
	Code      string // USD, EUR, GBP, etc.
	Name      string
	Symbol    string
	Precision int // Decimal places
	MinAmount float64
	MaxAmount float64
	Fee       float64 // Processing fee percentage
}

// PaymentMethod represents payment methods
type PaymentMethod struct {
	ID             string
	Name           string
	Type           string // BANK_CARD, BANK_TRANSFER, WIRE, etc.
	Currencies     []string
	Fee            float64
	ProcessingTime string // e.g., "instant", "1-3 days"
}

// OnRampOrder represents an on-ramp order
type OnRampOrder struct {
	ID            string
	UserID        string
	FiatCurrency  string
	CryptoAsset   string
	FiatAmount    float64
	CryptoAmount  float64
	ExchangeRate  float64
	Fee           float64
	PaymentMethod string
	Status        OrderStatus
	CreatedAt     time.Time
	CompletedAt   *time.Time
}

// OrderStatus represents order status
type OrderStatus string

const (
	OrderStatusPending    OrderStatus = "PENDING"
	OrderStatusProcessing OrderStatus = "PROCESSING"
	OrderStatusCompleted  OrderStatus = "COMPLETED"
	OrderStatusFailed     OrderStatus = "FAILED"
	OrderStatusCancelled  OrderStatus = "CANCELLED"
)

// ============================================================================
// SERVICE
// ============================================================================

// Service manages fiat on-ramp
// RateProvider returns the price of one unit of base in quote currency.
// It is the seam a real market data feed implements.
type RateProvider interface {
	Rate(ctx context.Context, base, quote string) (float64, error)
}

// PaymentProcessor confirms that the fiat leg of an on-ramp order actually
// settled. It is the seam a real PSP or bank integration implements.
type PaymentProcessor interface {
	Confirm(ctx context.Context, order *OnRampOrder) error
}

type Service struct {
	mu         sync.RWMutex
	currencies map[string]*FiatCurrency
	methods    map[string]*PaymentMethod
	orders     map[string]*OnRampOrder

	orderCounter int64
	// rateProvider and settlement are optional. When nil, quoting and
	// completion cannot run and must not be faked.
	rateProvider RateProvider
	settlement   PaymentProcessor
}

// NewService creates fiat on-ramp service
func NewService() *Service {
	s := &Service{
		currencies: make(map[string]*FiatCurrency),
		methods:    make(map[string]*PaymentMethod),
		orders:     make(map[string]*OnRampOrder),
	}

	// Initialize currencies
	s.initCurrencies()

	// Initialize payment methods
	s.initPaymentMethods()

	return s
}

// SetRateProvider wires the market data source used for quoting.
func (s *Service) SetRateProvider(p RateProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rateProvider = p
}

// SetPaymentProcessor wires the provider used to confirm fiat settlement.
func (s *Service) SetPaymentProcessor(p PaymentProcessor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.settlement = p
}

func (s *Service) initCurrencies() {
	s.currencies["USD"] = &FiatCurrency{Code: "USD", Name: "US Dollar", Symbol: "$", Precision: 2, MinAmount: 10, MaxAmount: 100000, Fee: 0}
	s.currencies["EUR"] = &FiatCurrency{Code: "EUR", Name: "Euro", Symbol: "€", Precision: 2, MinAmount: 10, MaxAmount: 100000, Fee: 0}
	s.currencies["GBP"] = &FiatCurrency{Code: "GBP", Name: "British Pound", Symbol: "£", Precision: 2, MinAmount: 10, MaxAmount: 100000, Fee: 0}
	s.currencies["JPY"] = &FiatCurrency{Code: "JPY", Name: "Japanese Yen", Symbol: "¥", Precision: 0, MinAmount: 1000, MaxAmount: 10000000, Fee: 0}
	s.currencies["KRW"] = &FiatCurrency{Code: "KRW", Name: "South Korean Won", Symbol: "₩", Precision: 0, MinAmount: 10000, MaxAmount: 100000000, Fee: 0}
}

func (s *Service) initPaymentMethods() {
	s.methods["BANK_CARD"] = &PaymentMethod{
		ID: "BANK_CARD", Name: "Credit/Debit Card", Type: "CARD",
		Currencies: []string{"USD", "EUR", "GBP"}, Fee: 2.99, ProcessingTime: "instant",
	}
	s.methods["BANK_TRANSFER"] = &PaymentMethod{
		ID: "BANK_TRANSFER", Name: "Bank Transfer", Type: "SEPA",
		Currencies: []string{"EUR", "GBP"}, Fee: 0.5, ProcessingTime: "1-3 days",
	}
	s.methods["WIRE"] = &PaymentMethod{
		ID: "WIRE", Name: "Wire Transfer", Type: "WIRE",
		Currencies: []string{"USD", "EUR"}, Fee: 0, ProcessingTime: "1-2 days",
	}
	s.methods["APPLE_PAY"] = &PaymentMethod{
		ID: "APPLE_PAY", Name: "Apple Pay", Type: "WALLET",
		Currencies: []string{"USD", "EUR", "GBP"}, Fee: 1.5, ProcessingTime: "instant",
	}
	s.methods["GOOGLE_PAY"] = &PaymentMethod{
		ID: "GOOGLE_PAY", Name: "Google Pay", Type: "WALLET",
		Currencies: []string{"USD", "EUR", "GBP"}, Fee: 1.5, ProcessingTime: "instant",
	}
}

// ============================================================================
// QUOTE & ORDER
// ============================================================================

// QuoteRequest represents a quote request
type QuoteRequest struct {
	UserID        string
	FiatCurrency  string
	CryptoAsset   string
	FiatAmount    float64
	PaymentMethod string
}

// GetQuote gets a quote for fiat purchase
func (s *Service) GetQuote(req *QuoteRequest) (float64, float64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.quote(req)
}

// quote computes a quote. Callers must hold s.mu.
func (s *Service) quote(req *QuoteRequest) (float64, float64, error) {

	// Validate fiat currency
	fiat, ok := s.currencies[req.FiatCurrency]
	if !ok {
		return 0, 0, fmt.Errorf("unsupported fiat currency")
	}

	// Validate amount
	if req.FiatAmount < fiat.MinAmount {
		return 0, 0, fmt.Errorf("amount below minimum: %.2f", fiat.MinAmount)
	}
	if req.FiatAmount > fiat.MaxAmount {
		return 0, 0, fmt.Errorf("amount above maximum: %.2f", fiat.MaxAmount)
	}

	// Validate payment method
	method, ok := s.methods[req.PaymentMethod]
	if !ok {
		return 0, 0, fmt.Errorf("unsupported payment method")
	}

	// Check method supports currency
	validCurrency := false
	for _, c := range method.Currencies {
		if c == req.FiatCurrency {
			validCurrency = true
			break
		}
	}
	if !validCurrency {
		return 0, 0, fmt.Errorf("payment method not available for currency")
	}

	if req.CryptoAsset == "" {
		return 0, 0, fmt.Errorf("crypto asset is required")
	}
	if req.FiatAmount <= 0 {
		return 0, 0, fmt.Errorf("amount must be positive")
	}

	exchangeRate, err := s.getExchangeRate(context.Background(), req.CryptoAsset, req.FiatCurrency)
	if err != nil {
		return 0, 0, err
	}

	// Calculate fees
	processingFee := req.FiatAmount * method.Fee / 100
	totalFiat := req.FiatAmount + processingFee

	// Calculate crypto
	cryptoAmount := totalFiat / exchangeRate

	return cryptoAmount, exchangeRate, nil
}

// CreateOrder creates an on-ramp order
func (s *Service) CreateOrder(req *QuoteRequest) (*OnRampOrder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// s.mu is already held here, so compute the quote inline rather than
	// calling GetQuote, which would try to take the lock again.
	cryptoAmount, exchangeRate, err := s.quote(req)
	if err != nil {
		return nil, err
	}

	// Generate order ID
	s.orderCounter++
	orderID := fmt.Sprintf("RAMP%d%08d", time.Now().Unix(), s.orderCounter)

	// Calculate fee
	method := s.methods[req.PaymentMethod]
	fee := req.FiatAmount * method.Fee / 100

	order := &OnRampOrder{
		ID:            orderID,
		UserID:        req.UserID,
		FiatCurrency:  req.FiatCurrency,
		CryptoAsset:   req.CryptoAsset,
		FiatAmount:    req.FiatAmount,
		CryptoAmount:  cryptoAmount,
		ExchangeRate:  exchangeRate,
		Fee:           fee,
		PaymentMethod: req.PaymentMethod,
		Status:        OrderStatusPending,
		CreatedAt:     time.Now(),
	}

	s.orders[orderID] = order
	return order, nil
}

// CompleteOrder marks order as completed
// CompleteOrder marks an order complete once the fiat leg has settled.
//
// The previous version flipped the status to completed unconditionally, so any
// caller could mark an unpaid order as settled.
func (s *Service) CompleteOrder(orderID string) error {
	s.mu.RLock()
	order, ok := s.orders[orderID]
	processor := s.settlement
	s.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}
	if order.Status != OrderStatusPending && order.Status != OrderStatusProcessing {
		return fmt.Errorf("invalid order status")
	}
	if processor == nil {
		return fmt.Errorf("no payment processor configured")
	}

	if err := processor.Confirm(context.Background(), order); err != nil {
		return fmt.Errorf("payment not confirmed: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	order.Status = OrderStatusCompleted
	order.CompletedAt = &now

	return nil
}

// CancelOrder cancels an order
func (s *Service) CancelOrder(orderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != OrderStatusPending {
		return fmt.Errorf("cannot cancel order in current status")
	}

	order.Status = OrderStatusCancelled
	return nil
}

// GetOrder gets an order
func (s *Service) GetOrder(orderID string) (*OnRampOrder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}

	return order, nil
}

// ============================================================================
// HELPER
// ============================================================================

// getExchangeRate returns the live rate, or an error when no provider is
// configured.
//
// The previous version read a hardcoded table (BTC = 50000 USD, ETH = 3000)
// and fell back to 50000 for any unknown asset, so every quote was priced
// against a stale constant and the service reported success regardless.
func (s *Service) getExchangeRate(ctx context.Context, cryptoAsset, fiatCurrency string) (float64, error) {
	if s.rateProvider == nil {
		return 0, fmt.Errorf("no exchange rate provider configured")
	}
	rate, err := s.rateProvider.Rate(ctx, cryptoAsset, fiatCurrency)
	if err != nil {
		return 0, fmt.Errorf("exchange rate unavailable for %s/%s: %w", cryptoAsset, fiatCurrency, err)
	}
	if rate <= 0 {
		return 0, fmt.Errorf("exchange rate provider returned a non-positive rate for %s/%s", cryptoAsset, fiatCurrency)
	}
	return rate, nil
}

// GetSupportedCurrencies returns supported fiat currencies
func (s *Service) GetSupportedCurrencies() []*FiatCurrency {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*FiatCurrency, 0, len(s.currencies))
	for _, c := range s.currencies {
		result = append(result, c)
	}
	return result
}

// GetPaymentMethods returns available payment methods
func (s *Service) GetPaymentMethods(fiatCurrency string) []*PaymentMethod {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*PaymentMethod
	for _, m := range s.methods {
		for _, c := range m.Currencies {
			if c == fiatCurrency {
				result = append(result, m)
				break
			}
		}
	}
	return result
}
