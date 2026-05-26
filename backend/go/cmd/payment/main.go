// Package payment provides payment processing.
// Migrated from TypeScript to Go for deposits & withdrawals.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Payment method
type PaymentMethod struct {
	ID       string `json:"id"`
	UserID  string `json:"userId"`
	Type    string `json:"type"` // bank, card, paypal, crypto
	Details string `json:"details"` // encrypted
	Verified bool  `json:"verified"`
	Status  string `json:"status"` // active, removed
}

// Deposit
type Deposit struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	Method      string  `json:"method"`
	Amount     float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Status     string  `json:"status"` // pending, completed, failed
	TxHash     string  `json:"txHash"`
	CompletedAt int64   `json:"completedAt"`
	CreatedAt  int64   `json:"createdAt"`
}

// Withdrawal
type Withdrawal struct {
	ID         string  `json:"id"`
	UserID     string  `json:"userId"`
	MethodID   string  `json:"methodId"`
	Amount    float64 `json:"amount"`
	Fee       float64 `json:"fee"`
	Currency  string  `json:"currency"`
	Status    string  `json:"status"` // pending, processing, completed, rejected
	TxHash    string  `json:"txHash"`
	CompletedAt int64 `json:"completedAt"`
	CreatedAt int64  `json:"createdAt"`
}

// Store
type PaymentStore struct {
	mu        sync.RWMutex
	methods   map[string]*PaymentMethod
	deposits  map[string]*Deposit
	withdrawals map[string]*Withdrawal
}

var (
	payStore = &PaymentStore{
		methods:   make(map[string]*PaymentMethod),
		deposits:  make(map[string]*Deposit),
		withdrawals: make(map[string]*Withdrawal),
	}
)

// Add payment method
func AddPaymentMethod(userID, methodType, details string) *PaymentMethod {
	method := &PaymentMethod{
		ID:      fmt.Sprintf("pm_%d", time.Now().UnixNano()),
		UserID:  userID,
		Type:   methodType,
		Details: details, // In production, encrypt this
		Verified: false,
		Status: "active",
	}

	payStore.mu.Lock()
	defer payStore.mu.Unlock()
	payStore.methods[method.ID] = method

	return method
}

// Create deposit request
func CreateDeposit(userID, methodType string, amount float64, currency string) *Deposit {
	deposit := &Deposit{
		ID:       fmt.Sprintf("dep_%d", time.Now().UnixNano()),
		UserID:   userID,
		Method:  methodType,
		Amount:  amount,
		Currency: currency,
		Status:  "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	payStore.mu.Lock()
	defer payStore.mu.Unlock()
	payStore.deposits[deposit.ID] = deposit

	return deposit
}

// Complete deposit
func CompleteDeposit(depositID, txHash string) error {
	payStore.mu.Lock()
	defer payStore.mu.Unlock()

	d, ok := payStore.deposits[depositID]
	if !ok {
		return fmt.Errorf("deposit not found")
	}

	d.Status = "completed"
	d.TxHash = txHash
	d.CompletedAt = time.Now().UnixMilli()

	return nil
}

// Create withdrawal request
func CreateWithdrawal(userID, methodID string, amount float64, fee float64, currency string) (*Withdrawal, error) {
	// Verify method exists
	method, ok := payStore.methods[methodID]
	if !ok {
		return nil, fmt.Errorf("method not found")
	}

	if method.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	withdrawal := &Withdrawal{
		ID:       fmt.Sprintf("wd_%d", time.Now().UnixNano()),
		UserID:  userID,
		MethodID: methodID,
		Amount: amount,
		Fee:    fee,
		Currency: currency,
		Status:  "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	payStore.mu.Lock()
	defer payStore.mu.Unlock()
	payStore.withdrawals[withdrawal.ID] = withdrawal

	return withdrawal, nil
}

// Process withdrawal
func ProcessWithdrawal(withdrawalID string) error {
	payStore.mu.Lock()
	defer payStore.mu.Unlock()

	w, ok := payStore.withdrawals[withdrawalID]
	if !ok {
		return fmt.Errorf("withdrawal not found")
	}

	if w.Status != "pending" {
		return fmt.Errorf("wrong status")
	}

	w.Status = "processing"
	return nil
}

// Complete withdrawal
func CompleteWithdrawal(withdrawalID, txHash string) error {
	payStore.mu.Lock()
	defer payStore.mu.Unlock()

	w, ok := payStore.withdrawals[withdrawalID]
	if !ok {
		return fmt.Errorf("withdrawal not found")
	}

	w.Status = "completed"
	w.TxHash = txHash
	w.CompletedAt = time.Now().UnixMilli()

	return nil
}

// Cancel withdrawal
func CancelWithdrawal(withdrawalID string) error {
	payStore.mu.Lock()
	defer payStore.mu.Unlock()

	w, ok := payStore.withdrawals[withdrawalID]
	if !ok {
		return fmt.Errorf("withdrawal not found")
	}

	if w.Status != "pending" {
		return fmt.Errorf("cannot cancel")
	}

	w.Status = "rejected"
	return nil
}

// Get user deposits
func GetDeposits(userID string) []*Deposit {
	payStore.mu.RLock()
	defer payStore.mu.RUnlock()

	var result []*Deposit
	for _, d := range payStore.deposits {
		if d.UserID == userID {
			result = append(result, d)
		}
	}
	return result
}

// Get user withdrawals
func GetWithdrawals(userID string) []*Withdrawal {
	payStore.mu.RLock()
	defer payStore.mu.RUnlock()

	var result []*Withdrawal
	for _, w := range payStore.withdrawals {
		if w.UserID == userID {
			result = append(result, w)
		}
	}
	return result
}

func main() {
	fmt.Println("Payment service initialized")

	// Add payment method
	method := AddPaymentMethod("user_001", "bank", "****1234")
	fmt.Printf("Added payment method: %s\n", method.Type)

	// Create deposit
	deposit := CreateDeposit("user_001", "crypto", 1000, "USDT")
	fmt.Printf("Created deposit: %s (%.2f %s)\n", deposit.ID, deposit.Amount, deposit.Currency)

	// Complete deposit
	CompleteDeposit(deposit.ID, "0xabc123")
	fmt.Printf("Deposit completed: %s\n", deposit.Status)
}