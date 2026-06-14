package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
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
	Precision int    // Decimal places
	MinAmount float64
	MaxAmount float64
	Fee       float64 // Processing fee percentage
}

// PaymentMethod represents payment methods
type PaymentMethod struct {
	ID          string
	Name        string
	Type        string // BANK_CARD, BANK_TRANSFER, WIRE, etc.
	Currencies []string
	Fee        float64
	ProcessingTime string // e.g., "instant", "1-3 days"
}

// OnRampOrder represents an on-ramp order
type OnRampOrder struct {
	ID            string
	UserID        string
	FiatCurrency  string
	CryptoAsset   string
	FiatAmount   float64
	CryptoAmount float64
	ExchangeRate float64
	Fee           float64
	PaymentMethod string
	Status       OrderStatus
	CreatedAt    time.Time
	CompletedAt *time.Time
}

// OrderStatus represents order status
type OrderStatus string

const (
	OrderStatusPending   OrderStatus = "PENDING"
	OrderStatusProcessing OrderStatus = "PROCESSING"
	OrderStatusCompleted OrderStatus = "COMPLETED"
	OrderStatusFailed    OrderStatus = "FAILED"
	OrderStatusCancelled OrderStatus = "CANCELLED"
)

// ============================================================================
// SERVICE
// ============================================================================

// Service manages fiat on-ramp
type Service struct {
	mu          sync.RWMutex
	currencies map[string]*FiatCurrency
	methods    map[string]*PaymentMethod
	orders    map[string]*OnRampOrder
	
	orderCounter int64
	rateProvider string // Exchange rate provider
}

// NewService creates fiat on-ramp service
func NewService() *Service {
	s := &Service{
		currencies: make(map[string]*FiatCurrency),
		methods:    make(map[string]*PaymentMethod),
		orders:    make(map[string]*OnRampOrder),
	}
	
	// Initialize currencies
	s.initCurrencies()
	
	// Initialize payment methods
	s.initPaymentMethods()
	
	return s
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
	UserID       string
	FiatCurrency string
	CryptoAsset  string
	FiatAmount  float64
	PaymentMethod string
}

// GetQuote gets a quote for fiat purchase
func (s *Service) GetQuote(req *QuoteRequest) (float64, float64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
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
	
	// Get exchange rate (mock - in production, use real provider)
	exchangeRate := s.getExchangeRate(req.CryptoAsset, req.FiatCurrency)
	
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
	
	// Get quote
	cryptoAmount, exchangeRate, err := s.GetQuote(req)
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
		CryptoAmount: cryptoAmount,
		ExchangeRate: exchangeRate,
		Fee:          fee,
		PaymentMethod: req.PaymentMethod,
		Status:       OrderStatusPending,
		CreatedAt:    time.Now(),
	}
	
	s.orders[orderID] = order
	return order, nil
}

// CompleteOrder marks order as completed
func (s *Service) CompleteOrder(orderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	order, ok := s.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}
	
	if order.Status != OrderStatusPending && order.Status != OrderStatusProcessing {
		return fmt.Errorf("invalid order status")
	}
	
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

func (s *Service) getExchangeRate(cryptoAsset, fiatCurrency string) float64 {
	// Mock rates - in production, use real exchange rate API
	rates := map[string]map[string]float64{
		"BTC": {"USD": 50000, "EUR": 45000, "GBP": 40000},
		"ETH": {"USD": 3000, "EUR": 2700, "GBP": 2400},
		"USDT": {"USD": 1, "EUR": 0.9, "GBP": 0.8},
	}
	
	if rates[cryptoAsset] != nil {
		if rate, ok := rates[cryptoAsset][fiatCurrency]; ok {
			return rate
		}
	}
	
	return 50000 // default
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

// ============================================================================
// EXAMPLE
// ============================================================================

func main() {
	fmt.Println("TigerEx Fiat On-Ramp v1.0.0")
	
	onramp := NewService()
	
	// Get quote
	req := &QuoteRequest{
		UserID:        "user123",
		FiatCurrency: "USD",
		CryptoAsset:  "BTC",
		FiatAmount:  1000,
		PaymentMethod: "BANK_CARD",
	}
	
	cryptoAmount, rate, err := onramp.GetQuote(req)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	fmt.Printf("Quote: %.8f BTC at rate $%.2f\n", cryptoAmount, rate)
	
	// Create order
	order, err := onramp.CreateOrder(req)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	fmt.Printf("Order: %s\n", order.ID)
	
	// Complete order
	onramp.CompleteOrder(order.ID)
	
	fmt.Printf("Order Status: %s\n", order.Status)
}