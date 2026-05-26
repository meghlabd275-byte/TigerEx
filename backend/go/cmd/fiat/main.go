// Package Fiat provides Fiat Gateway Service
// Bank integrations, payment processing, wire transfers
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type PaymentMethod string
type PaymentStatus string
type FiatCurrency string

const (
	MethodWire     PaymentMethod = "wire"
	MethodCard   PaymentMethod = "card"
	MethodBank  PaymentMethod = "bank_account"
	MethodPayPal PaymentMethod = "paypal"

	StatusPending   PaymentStatus = "pending"
	StatusProcessing PaymentStatus = "processing"
	StatusCompleted PaymentStatus = "completed"
	StatusFailed  PaymentStatus = "failed"
	StatusReversed PaymentStatus = "reversed"

	CurrencyUSD FiatCurrency = "USD"
	CurrencyEUR FiatCurrency = "EUR"
	CurrencyGBP FiatCurrency = "GBP"
	CurrencyJPY FiatCurrency = "JPY"
	CurrencyBRL FiatCurrency = "BRL"
)

// ============================================================================
// BANK ACCOUNT
// ============================================================================

type BankAccount struct {
	ID           string    `json:"id"`
	UserID      string    `json:"userId"`
	AccountName string    `json:"accountName"`
	AccountNumber string `json:"accountNumber"`
	RoutingNumber string  `json:"routingNumber"`
	BankName    string    `json:"bankName"`
	BankCode    string    `json:"bankCode"`
	Country    string    `json:"country"`
	Currency   FiatCurrency `json:"currency"`
	Status     string    `json:"status"`
	Verified   bool      `json:"verified"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ============================================================================
// PAYMENT
// ============================================================================

type FiatPayment struct {
	ID              string        `json:"id"`
	UserID          string        `json:"userId"`
	 Amount         float64       `json:"amount"`
	Currency       FiatCurrency  `json:"currency"`
	Method         PaymentMethod `json:"method"`
	Direction      string        `json:"direction"` // "deposit" or "withdrawal"
	Status         PaymentStatus `json:"status"`
	BankAccountID   string       `json:"bankAccountId,omitempty"`
	Reference      string       `json:"reference"`
	Description    string       `json:"description"`
	Fee            float64      `json:"fee"`
	NetAmount      float64      `json:"netAmount"`
	ProcessedAt    *time.Time   `json:"processedAt,omitempty"`
	CreatedAt      time.Time    `json:"createdAt"`
}

// ============================================================================
// FIAT GATEWAY
// ============================================================================

type FiatGateway struct {
	mu           sync.RWMutex
	bankAccounts map[string]*BankAccount
	payments    map[string]*FiatPayment
	paymentCounter uint64
	feeSchedule  map[FiatCurrency]FeeTier
}

type FeeTier struct {
	FlatFee     float64
	Percentage float64
	MinFee     float64
	MaxFee     float64
}

func NewFiatGateway() *FiatGateway {
	return &FiatGateway{
		bankAccounts: make(map[string]*BankAccount),
		payments:    make(map[string]*FiatPayment),
		feeSchedule: map[FiatCurrency]FeeTier{
			CurrencyUSD: {FlatFee: 25, Percentage: 0.01, MinFee: 25, MaxFee: 500},
			CurrencyEUR: {FlatFee: 20, Percentage: 0.01, MinFee: 20, MaxFee: 400},
			CurrencyGBP: {FlatFee: 20, Percentage: 0.01, MinFee: 20, MaxFee: 400},
		},
	}
}

// ============================================================================
// BANK ACCOUNT OPERATIONS
// ============================================================================

func (fg *FiatGateway) AddBankAccount(userID string, acc *BankAccount) string {
	fg.mu.Lock()
	defer fg.mu.Unlock()

	acc.ID = fmt.Sprintf("bank_%d", time.Now().UnixNano())
	acc.UserID = userID
	acc.CreatedAt = time.Now()
	acc.Status = "pending"
	acc.Verified = false

	fg.bankAccounts[acc.ID] = acc
	return acc.ID
}

func (fg *FiatGateway) VerifyBankAccount(accountID, userID string) error {
	fg.mu.Lock()
	defer fg.mu.Unlock()

	acc, ok := fg.bankAccounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}
	if acc.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	acc.Verified = true
	acc.Status = "active"
	return nil
}

func (fg *FiatGateway) GetUserBankAccounts(userID string) []*BankAccount {
	fg.mu.RLock()
	defer fg.mu.RUnlock()

	var result []*BankAccount
	for _, acc := range fg.bankAccounts {
		if acc.UserID == userID {
			result = append(result, acc)
		}
	}
	return result
}

// ============================================================================
// PAYMENT OPERATIONS
// ============================================================================

func (fg *FiatGateway) processDeposit(userID, accountID string, amount float64, currency FiatCurrency) (*FiatPayment, error) {
	fg.mu.Lock()
	defer fg.mu.Unlock()

	// Verify account
	acc, ok := fg.bankAccounts[accountID]
	if !ok {
		return nil, fmt.Errorf("bank account not found")
	}
	if acc.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}
	if !acc.Verified {
		return nil, fmt.Errorf("bank account not verified")
	}

	// Calculate fee
	fee := fg.calculateFee(amount, currency)

	fg.paymentCounter++
	payment := &FiatPayment{
		ID:            fmt.Sprintf("fiat_%d", fgp.paymentCounter),
		UserID:        userID,
		Amount:       amount,
		Currency:     currency,
		Method:       MethodWire,
		Direction:    "deposit",
		Status:      StatusPending,
		BankAccountID: accountID,
		Reference:   fmt.Sprintf("DEP%d%d", time.Now().Unix(), fgp.paymentCounter),
		Fee:         fee,
		NetAmount:   amount - fee,
		CreatedAt:  time.Now(),
	}

	fg.payments[payment.ID] = payment
	return payment, nil
}

func (fg *FiatGateway) RequestWithdrawal(userID, accountID string, amount float64, currency FiatCurrency) (*FiatPayment, error) {
	fg.mu.Lock()
	defer fg.mu.Unlock()

	acc, ok := fg.bankAccounts[accountID]
	if !ok {
		return nil, fmt.Errorf("bank account not found")
	}
	if acc.UserID != userID {
		return fmt.Errorf("unauthorized"), nil
	}

	fee := fg.calculateFee(amount, currency)
	netAmount := amount - fee

	if netAmount <= 0 {
		return nil, fmt.Errorf("amount too small for fee")
	}

	fg.paymentCounter++
	payment := &FiatPayment{
		ID:            fmt.Sprintf("fiat_%d", fgp.paymentCounter),
		UserID:        userID,
		Amount:       amount,
		Currency:     currency,
		Method:       MethodWire,
		Direction:    "withdrawal",
		Status:      StatusPending,
		BankAccountID: accountID,
		Reference:   fmt.Sprintf("WD%d%d", time.Now().Unix(), fgp.paymentCounter),
		Fee:         fee,
		NetAmount:   netAmount,
		CreatedAt:  time.Now(),
	}

	fg.payments[payment.ID] = payment
	return payment, nil
}

func (fg *FiatGateway) calculateFee(amount float64, currency FiatCurrency) float64 {
	feeTier := fg.feeSchedule[currency]
	
	fee := feeTier.FlatFee + (amount * feeTier.Percentage)
	
	if fee < feeTier.MinFee {
		return feeTier.MinFee
	}
	if fee > feeTier.MaxFee {
		return feeTier.MaxFee
	}
	return fee
}

func (fg *FiatGateway) ProcessPayment(paymentID string) error {
	fg.mu.Lock()
	defer fg.mu.Unlock()

	payment, ok := fg.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}

	if payment.Status != StatusPending {
		return fmt.Errorf("payment cannot be processed")
	}

	payment.Status = StatusProcessing
	now := time.Now()
	payment.ProcessedAt = &now

	// Simulate processing delay
	payment.Status = StatusCompleted

	return nil
}

func (fg *FiatGateway) CancelPayment(paymentID, userID string) error {
	fg.mu.Lock()
	defer fg.mu.Unlock()

	payment, ok := fg.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}
	if payment.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if payment.Status == StatusCompleted {
		return fmt.Errorf("cannot cancel completed payment")
	}

	payment.Status = StatusCancelled
	return nil
}

// ============================================================================
// QUERIES
// ============================================================================

func (fg *FiatGateway) GetPayment(paymentID string) (*FiatPayment, error) {
	fg.mu.RLock()
	defer fg.mu.RUnlock()

	payment, ok := fg.payments[paymentID]
	if !ok {
		return nil, fmt.Errorf("payment not found")
	}
	return payment, nil
}

func (fg *FiatGateway) GetUserPayments(userID string) []*FiatPayment {
	fg.mu.RLock()
	defer fg.mu.RUnlock()

	var result []*FiatPayment
	for _, p := range fg.payments {
		if p.UserID == userID {
			result = append(result, p)
		}
	}
	return result
}

func (fg *FiatGateway) GetStats() map[string]interface{} {
	fg.mu.RLock()
	defer fg.mu.RUnlock()

	return map[string]interface{}{
		"totalAccounts": len(fg.bankAccounts),
		"totalPayments": len(fg.payments),
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fg := NewFiatGateway()

	// Add bank account
	bankID := fg.AddBankAccount("user1", &BankAccount{
		AccountName:   "John Doe",
		AccountNumber: "123456789",
		RoutingNumber: "021000021",
		BankName:     "Chase Bank",
		BankCode:    "CHASEUS33",
		Country:     "US",
		Currency:    CurrencyUSD,
	})

	// Verify
	fg.VerifyBankAccount(bankID, "user1")

	// Deposit
	deposit, _ := fg.ProcessDeposit("user1", bankID, 10000, CurrencyUSD)
	fmt.Printf("Deposit: %s - %s ($%.2f)\n", deposit.ID, deposit.Status, deposit.NetAmount)

	// Stats
	fmt.Printf("Stats: %v\n", fg.GetStats())
}