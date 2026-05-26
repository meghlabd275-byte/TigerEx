// Package fiat_service handles fiat gateway operations.
// Migrated from TypeScript to Go for fiat on/off ramps.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Fiat payment method
type PaymentMethod struct {
	ID        string `json:"id"`
	UserID   string `json:"userId"`
	Type     string `json:"type"` // bank, card, paypal
	Details  string `json:"details"`
	Verified bool  `json:"verified"`
}

// Fiat order
type FiatOrder struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Type       string  `json:"type"` // buy, sell
	Fiat       string  `json:"fiat"` // USD, EUR
	Crypto     string  `json:"crypto"`
	Amount     float64 `json:"amount"`
	CryptoAmt  float64 `json:"cryptoAmount"`
	Status     string  `json:"status"` // pending, processing, completed, failed
	PaymentID  string  `json:"paymentId"`
	CreatedAt  int64   `json:"createdAt"`
}

// Store
type FiatStore struct {
	mu      sync.RWMutex
	methods map[string]*PaymentMethod
	orders  map[string]*FiatOrder
}

var (
	fStore = &FiatStore{
		methods: make(map[string]*PaymentMethod),
		orders:  make(map[string]*FiatOrder),
	}
)

// Add payment method
func AddMethod(method *PaymentMethod) *PaymentMethod {
	method.ID = fmt.Sprintf("pm_%d", time.Now().UnixNano())

	fStore.mu.Lock()
	defer fStore.mu.Unlock()
	fStore.methods[method.ID] = method

	return method
}

// Create fiat order
func CreateOrder(order *FiatOrder) *FiatOrder {
	order.ID = fmt.Sprintf("fiat_%d", time.Now().UnixNano())
	order.Status = "pending"
	order.CreatedAt = time.Now().UnixMilli()

	// Calculate crypto amount
	// In production, use live price
	order.CryptoAmt = order.Amount / 65000.0 // Simplified

	fStore.mu.Lock()
	defer fStore.mu.Unlock()
	fStore.orders[order.ID] = order

	return order
}

// Update order status
func UpdateStatus(orderID, status string) error {
	fStore.mu.Lock()
	defer fStore.mu.Unlock()

	order, ok := fStore.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	order.Status = status
	return nil
}

func main() {
	fmt.Println("Fiat service initialized")
}