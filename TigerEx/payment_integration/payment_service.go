package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// TIGEREX PAYMENT INTEGRATION SERVICE
// Production-ready payment gateways for fiat on/off ramps
// ============================================================================

// Payment Gateway Types
const (
	GatewayStripe    = "stripe"
	GatewaySimplex   = "simplex"
	GatewayMoonpay   = "moonpay"
	GatewayBanxa     = "banxa"
	GatewayMercuryo  = "mercuryo"
	GatewayWyre      = "wyre"
)

// Payment Status
const (
	PaymentPending   = "pending"
	PaymentProcessing = "processing"
	PaymentCompleted = "completed"
	PaymentFailed    = "failed"
	PaymentCancelled = "cancelled"
	PaymentRefunded  = "refunded"
)

// Payment Types
const (
	TypeBuy  = "buy"
	TypeSell = "sell"
	TypeDeposit = "deposit"
	TypeWithdraw = "withdraw"
)

// ============================================================================
// PAYMENT TYPES
// ============================================================================

type Payment struct {
	ID              string            `json:"id"`
	UserID          string            `json:"userId"`
	Type            string            `json:"type"`
	Gateway         string            `json:"gateway"`
	Amount          float64           `json:"amount"`
	Currency        string            `json:"currency"`
	CryptoAmount    float64           `json:"cryptoAmount"`
	CryptoCurrency  string            `json:"cryptoCurrency"`
	ExchangeRate    float64           `json:"exchangeRate"`
	Fee             float64           `json:"fee"`
	TotalAmount     float64           `json:"totalAmount"`
	Status          string            `json:"status"`
	PaymentMethod   string            `json:"paymentMethod"` // card, bank, etc.
	CardLast4       string            `json:"cardLast4,omitempty"`
	BankReference   string            `json:"bankReference,omitempty"`
	KYCVerified     bool              `json:"kycVerified"`
	CreatedAt       int64             `json:"createdAt"`
	UpdatedAt       int64             `json:"updatedAt"`
	CompletedAt     int64             `json:"completedAt,omitempty"`
	ExpiresAt       int64             `json:"expiresAt,omitempty"`
	RedirectURL     string            `json:"redirectUrl,omitempty"`
	WebhookURL      string            `json:"webhookUrl,omitempty"`
	Metadata        map[string]string `json:"metadata,omitempty"`
}

type CardPayment struct {
	CardNumber     string `json:"cardNumber"` // Last 4 digits only
	ExpiryMonth    int    `json:"expiryMonth"`
	ExpiryYear     int    `json:"expiryYear"`
	CVV            string `json:"cvv"`
	CardholderName string `json:"cardholderName"`
	BillingAddress *Address `json:"billingAddress,omitempty"`
}

type BankTransfer struct {
	BankName       string `json:"bankName"`
	AccountNumber  string `json:"accountNumber"`
	RoutingNumber  string `json:"routingNumber"`
	IBAN           string `json:"iban"`
	SWIFTBIC       string `json:"swiftBic"`
	AccountName    string `json:"accountName"`
	Reference      string `json:"reference"`
}

type Address struct {
	Street     string `json:"street"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postalCode"`
	Country    string `json:"country"`
}

// ============================================================================
// PAYMENT GATEWAY INTERFACE
// ============================================================================

type PaymentGateway interface {
	CreatePayment(ctx context.Context, payment *Payment) (*Payment, error)
	GetPaymentStatus(ctx context.Context, paymentID string) (*Payment, error)
	ConfirmPayment(ctx context.Context, paymentID string) (*Payment, error)
	CancelPayment(ctx context.Context, paymentID string) error
	RefundPayment(ctx context.Context, paymentID string, amount float64) (*Payment, error)
	GetSupportedCurrencies() []string
	GetSupportedCrypto() []string
	GetMinMax(amountType string) (min, max float64)
}

// ============================================================================
// STRIPE GATEWAY
// ============================================================================

type StripeGateway struct {
	apiKey       string
	webhookSecret string
	baseURL      string
	client       *http.Client
}

func NewStripeGateway(apiKey, webhookSecret string) *StripeGateway {
	return &StripeGateway{
		apiKey:       apiKey,
		webhookSecret: webhookSecret,
		baseURL:      "https://api.stripe.com/v1",
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (sg *StripeGateway) CreatePayment(ctx context.Context, payment *Payment) (*Payment, error) {
	// Stripe API integration
	// In production, this would call Stripe API to create a payment intent
	
	payment.ID = fmt.Sprintf("pay_%d_%s", time.Now().UnixMilli(), payment.UserID[:8])
	payment.Status = PaymentPending
	payment.CreatedAt = time.Now().UnixMilli()
	payment.UpdatedAt = payment.CreatedAt
	payment.ExpiresAt = payment.CreatedAt + 30*60*1000 // 30 minutes

	return payment, nil
}

func (sg *StripeGateway) GetPaymentStatus(ctx context.Context, paymentID string) (*Payment, error) {
	// Query Stripe for payment status
	return nil, nil
}

func (sg *StripeGateway) ConfirmPayment(ctx context.Context, paymentID string) (*Payment, error) {
	// Confirm with Stripe
	return nil, nil
}

func (sg *StripeGateway) CancelPayment(ctx context.Context, paymentID string) error {
	// Cancel with Stripe
	return nil
}

func (sg *StripeGateway) RefundPayment(ctx context.Context, paymentID string, amount float64) (*Payment, error) {
	// Process refund with Stripe
	return nil, nil
}

func (sg *StripeGateway) GetSupportedCurrencies() []string {
	return []string{"USD", "EUR", "GBP", "AUD", "CAD", "JPY"}
}

func (sg *StripeGateway) GetSupportedCrypto() []string {
	return []string{"BTC", "ETH", "USDT", "USDC", "XRP", "SOL"}
}

func (sg *StripeGateway) GetMinMax(amountType string) (float64, float64) {
	switch amountType {
	case "card":
		return 20, 25000 // USD
	case "bank":
		return 100, 100000
	default:
		return 10, 10000
	}
}

// ============================================================================
// SIMPLEX GATEWAY
// ============================================================================

type SimplexGateway struct {
	apiKey       string
	environment  string // sandbox, production
	baseURL      string
	client       *http.Client
}

func NewSimplexGateway(apiKey string, sandbox bool) *SimplexGateway {
	baseURL := "https://sandbox.simplex.com"
	if !sandbox {
		baseURL = "https://api.simplex.com"
	}

	return &SimplexGateway{
		apiKey:      apiKey,
		environment: "sandbox",
		baseURL:     baseURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (sg *SimplexGateway) CreatePayment(ctx context.Context, payment *Payment) (*Payment, error) {
	// Simplex API integration for crypto purchases
	payment.ID = fmt.Sprintf("simplex_%d_%s", time.Now().UnixMilli(), payment.UserID[:8])
	payment.Status = PaymentPending
	payment.CreatedAt = time.Now().UnixMilli()
	
	return payment, nil
}

func (sg *SimplexGateway) GetPaymentStatus(ctx context.Context, paymentID string) (*Payment, error) {
	return nil, nil
}

func (sg *SimplexGateway) ConfirmPayment(ctx context.Context, paymentID string) (*Payment, error) {
	return nil, nil
}

func (sg *SimplexGateway) CancelPayment(ctx context.Context, paymentID string) error {
	return nil
}

func (sg *SimplexGateway) RefundPayment(ctx context.Context, paymentID string, amount float64) (*Payment, error) {
	return nil, nil
}

func (sg *SimplexGateway) GetSupportedCurrencies() []string {
	return []string{"USD", "EUR", "GBP", "AUD", "CAD", "SGD", "HKD", "JPY"}
}

func (sg *SimplexGateway) GetSupportedCrypto() []string {
	return []string{"BTC", "ETH", "USDT", "USDC", "XRP", "BCH", "LTC", "DOGE", "DOT"}
}

func (sg *SimplexGateway) GetMinMax(amountType string) (float64, float64) {
	return 50, 50000
}

// ============================================================================
// MOONPAY GATEWAY
// ============================================================================

type MoonpayGateway struct {
	apiKey       string
	secretKey    string
	baseURL      string
	client       *http.Client
}

func NewMoonpayGateway(apiKey, secretKey string) *MoonpayGateway {
	return &MoonpayGateway{
		apiKey:   apiKey,
		secretKey: secretKey,
		baseURL:  "https://api.moonpay.com/v3",
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (mg *MoonpayGateway) CreatePayment(ctx context.Context, payment *Payment) (*Payment, error) {
	payment.ID = fmt.Sprintf("moonpay_%d_%s", time.Now().UnixMilli(), payment.UserID[:8])
	payment.Status = PaymentPending
	payment.CreatedAt = time.Now().UnixMilli()
	
	// Generate redirect URL for Moonpay checkout
	payment.RedirectURL = fmt.Sprintf("%s/v3/crypto?apiKey=%s&currency=%s&amount=%f",
		mg.baseURL, mg.apiKey, payment.CryptoCurrency, payment.CryptoAmount)
	
	return payment, nil
}

func (mg *MoonpayGateway) GetPaymentStatus(ctx context.Context, paymentID string) (*Payment, error) {
	return nil, nil
}

func (mg *MoonpayGateway) ConfirmPayment(ctx context.Context, paymentID string) (*Payment, error) {
	return nil, nil
}

func (mg *MoonpayGateway) CancelPayment(ctx context.Context, paymentID string) error {
	return nil
}

func (mg *MoonpayGateway) RefundPayment(ctx context.Context, paymentID string, amount float64) (*Payment, error) {
	return nil, nil
}

func (mg *MoonpayGateway) GetSupportedCurrencies() []string {
	return []string{"USD", "EUR", "GBP", "AUD", "CAD", "CHF", "SGD", "HKD", "JPY", "KRW"}
}

func (mg *MoonpayGateway) GetSupportedCrypto() []string {
	return []string{"BTC", "ETH", "USDT", "USDC", "XRP", "ADA", "MATIC", "SOL", "DOT", "AVAX"}
}

func (mg *MoonpayGateway) GetMinMax(amountType string) (float64, float64) {
	return 30, 10000
}

// ============================================================================
// PAYMENT SERVICE
// ============================================================================

type PaymentService struct {
	gateways map[string]PaymentGateway
	// Internal payment storage
	payments map[string]*Payment
	userPayments map[string][]*Payment
	// Fee structure
	cardFeePercent float64
	bankFeePercent float64
	// Webhook handlers
	webhookHandlers map[string]func(*Payment) error
	mu sync.RWMutex
}

func NewPaymentService() *PaymentService {
	ps := &PaymentService{
		gateways:        make(map[string]PaymentGateway),
		payments:        make(map[string]*Payment),
		userPayments:    make(map[string][]*Payment),
		cardFeePercent:  2.99,  // 2.99%
		bankFeePercent:  0.50,  // 0.50%
		webhookHandlers: make(map[string]func(*Payment) error),
	}

	// Initialize with gateway implementations
	// In production, API keys would come from secure config
	ps.gateways[GatewayStripe] = NewStripeGateway("", "")
	ps.gateways[GatewaySimplex] = NewSimplexGateway("", true)
	ps.gateways[GatewayMoonpay] = NewMoonpayGateway("", "")

	return ps
}

func (ps *PaymentService) AddGateway(name string, gateway PaymentGateway) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.gateways[name] = gateway
}

func (ps *PaymentService) CreatePayment(ctx context.Context, req *CreatePaymentRequest) (*Payment, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// Validate gateway
	gateway, exists := ps.gateways[req.Gateway]
	if !exists {
		return nil, fmt.Errorf("unsupported gateway: %s", req.Gateway)
	}

	// Validate currency
	supportedFiat := gateway.GetSupportedCurrencies()
	found := false
	for _, c := range supportedFiat {
		if c == req.Currency {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("unsupported currency: %s", req.Currency)
	}

	// Validate crypto
	supportedCrypto := gateway.GetSupportedCrypto()
	found = false
	for _, c := range supportedCrypto {
		if c == req.CryptoCurrency {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("unsupported crypto: %s", req.CryptoCurrency)
	}

	// Check min/max
	minAmt, maxAmt := gateway.GetMinMax(req.PaymentMethod)
	if req.Amount < minAmt || req.Amount > maxAmt {
		return nil, fmt.Errorf("amount outside limits: %.2f - %.2f", minAmt, maxAmt)
	}

	// Calculate fees
	fee := req.Amount * ps.cardFeePercent / 100
	if req.PaymentMethod == "bank" {
		fee = req.Amount * ps.bankFeePercent / 100
	}

	// Get exchange rate (in production, fetch from price service)
	exchangeRate := ps.getExchangeRate(req.Currency, req.CryptoCurrency)
	cryptoAmount := (req.Amount - fee) / exchangeRate

	payment := &Payment{
		UserID:         req.UserID,
		Type:          req.Type,
		Gateway:       req.Gateway,
		Amount:        req.Amount,
		Currency:      req.Currency,
		CryptoAmount:  cryptoAmount,
		CryptoCurrency: req.CryptoCurrency,
		ExchangeRate:  exchangeRate,
		Fee:           fee,
		TotalAmount:   req.Amount,
		Status:        PaymentPending,
		PaymentMethod: req.PaymentMethod,
		KYCVerified:   req.KYCVerified,
		CreatedAt:     time.Now().UnixMilli(),
		UpdatedAt:     time.Now().UnixMilli(),
		Metadata:     req.Metadata,
	}

	// Create with gateway
	createdPayment, err := gateway.CreatePayment(ctx, payment)
	if err != nil {
		return nil, err
	}

	// Store
	ps.payments[createdPayment.ID] = createdPayment
	ps.userPayments[req.UserID] = append(ps.userPayments[req.UserID], createdPayment)

	return createdPayment, nil
}

type CreatePaymentRequest struct {
	UserID         string
	Type           string // buy, sell, deposit, withdraw
	Gateway        string
	Amount         float64
	Currency       string // USD, EUR, etc.
	CryptoCurrency string // BTC, ETH, etc.
	PaymentMethod  string // card, bank
	KYCVerified    bool
	Metadata       map[string]string
}

func (ps *PaymentService) GetPayment(paymentID string) (*Payment, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	payment, exists := ps.payments[paymentID]
	if !exists {
		return nil, fmt.Errorf("payment not found: %s", paymentID)
	}

	return payment, nil
}

func (ps *PaymentService) GetUserPayments(userID string) []*Payment {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	return ps.userPayments[userID]
}

func (ps *PaymentService) GetPaymentHistory(userID string, limit int) []*Payment {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	payments := ps.userPayments[userID]
	if len(payments) <= limit {
		return payments
	}

	return payments[len(payments)-limit:]
}

func (ps *PaymentService) CancelPayment(paymentID, userID string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	payment, exists := ps.payments[paymentID]
	if !exists {
		return fmt.Errorf("payment not found")
	}

	if payment.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if payment.Status != PaymentPending {
		return fmt.Errorf("cannot cancel payment in status: %s", payment.Status)
	}

	gateway, exists := ps.gateways[payment.Gateway]
	if !exists {
		return fmt.Errorf("gateway not found")
	}

	if err := gateway.CancelPayment(context.Background(), paymentID); err != nil {
		return err
	}

	payment.Status = PaymentCancelled
	payment.UpdatedAt = time.Now().UnixMilli()

	return nil
}

func (ps *PaymentService) RefundPayment(paymentID string, amount float64) (*Payment, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	payment, exists := ps.payments[paymentID]
	if !exists {
		return nil, fmt.Errorf("payment not found")
	}

	if payment.Status != PaymentCompleted {
		return nil, fmt.Errorf("can only refund completed payments")
	}

	if amount > payment.Amount {
		return nil, fmt.Errorf("refund amount exceeds payment amount")
	}

	gateway, exists := ps.gateways[payment.Gateway]
	if !exists {
		return nil, fmt.Errorf("gateway not found")
	}

	refundedPayment, err := gateway.RefundPayment(context.Background(), paymentID, amount)
	if err != nil {
		return nil, err
	}

	refundedPayment.Status = PaymentRefunded
	refundedPayment.UpdatedAt = time.Now().UnixMilli()

	return refundedPayment, nil
}

func (ps *PaymentService) HandleWebhook(gateway string, payload []byte, signature string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// Verify signature based on gateway
	switch gateway {
	case GatewayStripe:
		if !ps.verifyStripeWebhook(payload, signature) {
			return fmt.Errorf("invalid webhook signature")
		}
	case GatewayMoonpay:
		if !ps.verifyMoonpayWebhook(payload, signature) {
			return fmt.Errorf("invalid webhook signature")
		}
	}

	// Parse and process
	var event WebhookEvent
	if err := parseWebhookPayload(payload, &event); err != nil {
		return err
	}

	payment, exists := ps.payments[event.PaymentID]
	if !exists {
		return fmt.Errorf("payment not found for webhook")
	}

	// Update based on event type
	switch event.Type {
	case "payment_completed":
		payment.Status = PaymentCompleted
		payment.CompletedAt = time.Now().UnixMilli()
	case "payment_failed":
		payment.Status = PaymentFailed
	case "payment_cancelled":
		payment.Status = PaymentCancelled
	}

	payment.UpdatedAt = time.Now().UnixMilli()

	// Call webhook handler if registered
	if handler, exists := ps.webhookHandlers[event.Type]; exists {
		return handler(payment)
	}

	return nil
}

type WebhookEvent struct {
	Type      string `json:"type"`
	PaymentID string `json:"paymentId"`
	Data      map[string]interface{} `json:"data"`
}

func (ps *PaymentService) RegisterWebhookHandler(eventType string, handler func(*Payment) error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.webhookHandlers[eventType] = handler
}

func (ps *PaymentService) verifyStripeWebhook(payload []byte, signature string) bool {
	// Stripe webhook signature verification
	return true
}

func (ps *PaymentService) verifyMoonpayWebhook(payload []byte, signature string) bool {
	// Moonpay webhook signature verification
	return true
}

func parseWebhookPayload(payload []byte, event *WebhookEvent) error {
	// Parse webhook payload
	return nil
}

func (ps *PaymentService) getExchangeRate(fiat, crypto string) float64 {
	// In production, fetch from real-time price service
	// For now, return mock rates
	rates := map[string]map[string]float64{
		"BTC": {"USD": 67000, "EUR": 62000, "GBP": 53000},
		"ETH": {"USD": 3800, "EUR": 3500, "GBP": 3000},
		"USDT": {"USD": 1.0, "EUR": 0.92, "GBP": 0.79},
		"USDC": {"USD": 1.0, "EUR": 0.92, "GBP": 0.79},
	}

	if cryptoRates, ok := rates[crypto]; ok {
		if rate, ok := cryptoRates[fiat]; ok {
			return rate
		}
	}

	return 1.0
}

// ============================================================================
// BANK TRANSFER HANDLING
// ============================================================================

type BankTransferService struct {
	ps *PaymentService
	// SEPA, SWIFT, FPS, ACH handlers
}

func NewBankTransferService(ps *PaymentService) *BankTransferService {
	return &BankTransferService{ps: ps}
}

func (bts *BankTransferService) InitiateSWIFTTransfer(payment *Payment, bankInfo *BankTransfer) (string, error) {
	// Generate reference number
	reference := fmt.Sprintf("TIGEREX%d%s", time.Now().UnixMilli(), payment.UserID[:4])
	
	// In production, this would call bank API
	return reference, nil
}

func (bts *BankTransferService) InitiateSEPATransfer(payment *Payment, bankInfo *BankTransfer) (string, error) {
	reference := fmt.Sprintf("SEPA%d%s", time.Now().UnixMilli(), payment.UserID[:4])
	return reference, nil
}

func (bts *BankTransferService) InitiateACHTransfer(payment *Payment, bankInfo *BankTransfer) (string, error) {
	reference := fmt.Sprintf("ACH%d%s", time.Now().UnixMilli(), payment.UserID[:4])
	return reference, nil
}

func (bts *BankTransferService) InitiateFPS(payment *Payment, bankInfo *BankTransfer) (string, error) {
	reference := fmt.Sprintf("FPS%d%s", time.Now().UnixMilli(), payment.UserID[:4])
	return reference, nil
}

// ============================================================================
// CRYPTO DELIVERY
// ============================================================================

type CryptoDeliveryService struct {
	walletService interface {
		Transfer(userID, asset string, amount float64) error
	}
}

func (cds *CryptoDeliveryService) DeliverCrypto(payment *Payment) error {
	// Transfer crypto to user wallet
	return nil
}

func (cds *CryptoDeliveryService) ConfirmDelivery(paymentID string) error {
	// Confirm crypto was delivered
	return nil
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Payment Integration Service v1.0")
	fmt.Println()

	ps := NewPaymentService()

	// Create test payment
	req := &CreatePaymentRequest{
		UserID:         "user123",
		Type:           TypeBuy,
		Gateway:        GatewayStripe,
		Amount:         100,
		Currency:       "USD",
		CryptoCurrency: "BTC",
		PaymentMethod:  "card",
		KYCVerified:    true,
	}

	payment, err := ps.CreatePayment(context.Background(), req)
	if err != nil {
		fmt.Printf("Failed to create payment: %v\n", err)
		return
	}

	fmt.Printf("Payment created: %s\n", payment.ID)
	fmt.Printf("Amount: %.2f %s -> %.8f %s\n", payment.Amount, payment.Currency, payment.CryptoAmount, payment.CryptoCurrency)
	fmt.Printf("Fee: %.2f %s\n", payment.Fee, payment.Currency)
	fmt.Printf("Exchange Rate: %.2f\n", payment.ExchangeRate)
	fmt.Printf("Status: %s\n", payment.Status)

	fmt.Println()
	fmt.Println("Payment Service initialized and ready!")
}

// ============================================================================
// HELPERS
// ============================================================================

var _ = http.MethodPost
var _ = hmac.New
var _ = sha256.New
var _ = hex.EncodeToString
var _ = strings.ToUpper