// Package payment_gateway provides payment processing services.
// Migrated from TypeScript to Go for payment processing.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Payment method
type PaymentMethod struct {
	ID           string  `json:"id"`
	UserID      string  `json:"userId"`
	Type        string  `json:"type"` // card, bank, crypto
	Details     map[string]string `json:"details"`
	IsDefault   bool    `json:"isDefault"`
	Status     string  `json:"status"` // active, inactive
}

// Payment
type Payment struct {
	ID           string  `json:"id"`
	UserID       string  `json:"userId"`
	Amount       float64 `json:"amount"`
	Currency    string  `json:"currency"`
	MethodID    string  `json:"methodId"`
	Type        string  `json:"type"` // deposit, withdraw, refund
	Status      string  `json:"status"` // pending, processing, completed, failed
	Gateway    string  `json:"gateway"`
	ExternalID string  `json:"externalId"`
	ProcessedAt int64  `json:"processedAt"`
	Fee        float64 `json:"fee"`
}

// Refund
type Refund struct {
	ID        string  `json:"id"`
	PaymentID string  `json:"paymentId"`
	Amount   float64 `json:"amount"`
	Reason   string  `json:"reason"`
	Status  string  `json:"status"` // pending, processed, failed
}

// Store
type PaymentStore struct {
	mu      sync.RWMutex
	methods map[string]*PaymentMethod
	payments map[string]*Payment
}

var (
	payStore = &PaymentStore{
		methods: make(map[string]*PaymentMethod),
		payments: make(map[string]*Payment),
	}
)

// Add payment method
func AddPaymentMethod(userID, ptype string, details map[string]string) *PaymentMethod {
	method := &PaymentMethod{
		ID: fmt.Sprintf("pm_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: ptype,
		Details: details,
		IsDefault: false,
		Status: "active",
	}

	payStore.mu.Lock()
	defer payStore.mu.Unlock()
	payStore.methods[method.ID] = method

	return method
}

// Process payment
func ProcessPayment(userID, methodID string, amount float64, currency, ptype, gateway string) (*Payment, error) {
	payStore.mu.RLock()
	_, ok := payStore.methods[methodID]
	payStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("payment method not found")
	}

	fee := amount * getGatewayFee(gateway)
	netAmount := amount - fee

	payment := &Payment{
		ID: fmt.Sprintf("pay_%d", time.Now().UnixNano()),
		UserID: userID,
		Amount: netAmount,
		Currency: currency,
		MethodID: methodID,
		Type: ptype,
		Status: "processing",
		Gateway: gateway,
		ProcessedAt: time.Now().UnixMilli(),
		Fee: fee,
	}

	// In real impl: call payment gateway API

	payment.Status = "completed"
	payment.ExternalID = fmt.Sprintf("ext_%d", time.Now().UnixNano())

	payStore.mu.Lock()
	defer payStore.mu.Unlock()
	payStore.payments[payment.ID] = payment

	return payment, nil
}

// Get payment status
func GetPaymentStatus(paymentID string) (*Payment, error) {
	payStore.mu.RLock()
	defer payStore.mu.RUnlock()

	payment, ok := payStore.payments[paymentID]
	if !ok {
		return nil, fmt.Errorf("payment not found")
	}

	return payment, nil
}

// Get default method
func GetDefaultMethod(userID string) (*PaymentMethod, bool) {
	payStore.mu.RLock()
	defer payStore.mu.RUnlock()

	for _, m := range payStore.methods {
		if m.UserID == userID && m.IsDefault && m.Status == "active" {
			return m, true
		}
	}

	return nil, false
}

// Set default method
func SetDefaultMethod(methodID string) error {
	payStore.mu.RLock()
	method, ok := payStore.methods[methodID]
	payStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("method not found")
	}

	payStore.mu.Lock()
	defer payStore.mu.Unlock()

	// Unset previous default
	for _, m := range payStore.methods {
		if m.UserID == method.UserID {
			m.IsDefault = false
		}
	}

	method.IsDefault = true

	return nil
}

func getGatewayFee(gateway string) float64 {
	fees := map[string]float64{
		"stripe": 0.029,
		"adyen": 0.025,
		"paypal": 0.034,
		"coinbase": 0.0,
	}

	if fee, ok := fees[gateway]; ok {
		return fee
	}

	return 0.03
}

func main() {
	fmt.Println("Payment Gateway service initialized")

	// Add card
	card := AddPaymentMethod("user_001", "card", map[string]string{"last4": "4242"})
	fmt.Printf("Card added: %s\n", card.ID)

	// Process payment
	payment, _ := ProcessPayment("user_001", card.ID, 1000, "USD", "deposit", "stripe")
	fmt.Printf("Payment: %s (%s)\n", payment.Status, payment.Currency)
}