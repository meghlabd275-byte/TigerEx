// Package fiat_ramp provides fiat on/off ramp services.
// Migrated from TypeScript to Go for fiat-crypto conversion.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Ramp order
type RampOrder struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Type       string  `json:"type"` // buy, sell
	CryptoType string  `json:"cryptoType"`
	CryptoAmount float64 `json:"cryptoAmount"`
	FiatAmount float64  `json:"fiatAmount"`
	FiatCurrency string  `json:"fiatCurrency"`
	FiatMethod string  `json:"fiatMethod"` // bank_transfer, card, pix
	Status    string  `json:"status"` // pending, waiting_payment, completed, cancelled
	CreatedAt int64   `json:"createdAt"`
}

// KYC record
type KYCDocument struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Type     string  `json:"type"` // id, passport, driver
	Status   string  `json:"status"` // pending, verified, rejected
	UploadedAt int64  `json:"uploadedAt"`
}

// Bank account for fiat
type FiatAccount struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	BankName  string  `json:"bankName"`
	SortCode  string  `json:"sortCode"` // for UK
	AccountNum string  `json:"accountNum"`
	IBAN     string  `json:"iban"` // international
	Status   string  `json:"status"` // pending, verified
}

// Exchange rate quote
type Quote struct {
	CryptoType string  `json:"cryptoType"`
	FiatCurrency string  `json:"fiatCurrency"`
	Rate      float64 `json:"rate"`
	ExpiresAt int64   `json:"expiresAt"`
}

// Store
type FiatRampStore struct {
	mu      sync.RWMutex
	orders  map[string]*RampOrder
	kycDocs map[string]*KYCDocument
	accounts map[string]*FiatAccount
	quotes  map[string]*Quote
}

var (
	rampStore = &FiatRampStore{
		orders: make(map[string]*RampOrder),
		kycDocs: make(map[string]*KYCDocument),
		accounts: make(map[string]*FiatAccount),
		quotes: make(map[string]*Quote),
	}
)

// Get quote
func GetQuote(cryptoType, fiatCurrency string) *Quote {
	rates := map[string]map[string]float64{
		"BTC": {"USD": 65000, "EUR": 59800, "GBP": 51300, "BRL": 325000},
		"ETH": {"USD": 3500, "EUR": 3220, "GBP": 2760, "BRL": 17500},
		"USDT": {"USD": 1.0, "EUR": 0.92, "GBP": 0.79, "BRL": 5.0},
	}

	rate, ok := rates[cryptoType][fiatCurrency]
	if !ok {
		rate = 1.0 // Default
	}

	quote := &Quote{
		CryptoType: cryptoType,
		FiatCurrency: fiatCurrency,
		Rate: rate,
		ExpiresAt: time.Now().UnixMilli() + 300000, // 5 min
	}

	rampStore.mu.Lock()
	defer rampStore.mu.Unlock()
	rampStore.quotes[fmt.Sprintf("%s_%s", cryptoType, fiatCurrency)] = quote

	return quote
}

// Create ramp order
func CreateOrder(userID, rampType, cryptoType, fiatCurrency, fiatMethod string, cryptoAmount float64) (*RampOrder, error) {
	// Get quote
	quote := GetQuote(cryptoType, fiatCurrency)
	
	// Check KYC
	if len(rampStore.kycDocs) == 0 {
		return nil, fmt.Errorf("KYC required")
	}

	fiatAmount := cryptoAmount * quote.Rate

	order := &RampOrder{
		ID: fmt.Sprintf("ramp_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: rampType,
		CryptoType: cryptoType,
		CryptoAmount: cryptoAmount,
		FiatAmount: fiatAmount,
		FiatCurrency: fiatCurrency,
		FiatMethod: fiatMethod,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	rampStore.mu.Lock()
	defer rampStore.mu.Unlock()
	rampStore.orders[order.ID] = order

	return order, nil
}

// Confirm payment
func ConfirmPayment(orderID string, txHash string) error {
	rampStore.mu.Lock()
	defer rampStore.mu.Unlock()

	order, ok := rampStore.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	order.Status = "waiting_payment"
	return nil
}

// Complete order
func CompleteOrder(orderID string) error {
	rampStore.mu.Lock()
	defer rampStore.mu.Unlock()

	order, ok := rampStore.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "waiting_payment" {
		return fmt.Errorf("not waiting for payment")
	}

	order.Status = "completed"
	return nil
}

// Submit KYC document
func SubmitKYC(userID, docType string) *KYCDocument {
	doc := &KYCDocument{
		ID: fmt.Sprintf("kyc_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: docType,
		Status: "pending",
		UploadedAt: time.Now().UnixMilli(),
	}

	rampStore.mu.Lock()
	defer rampStore.mu.Unlock()
	rampStore.kycDocs[doc.ID] = doc

	return doc
}

// Add fiat bank account
func AddFiatAccount(userID, bankName, sortCode, accountNum, iban string) *FiatAccount {
	account := &FiatAccount{
		ID: fmt.Sprintf("fa_%d", time.Now().UnixNano()),
		UserID: userID,
		BankName: bankName,
		SortCode: sortCode,
		AccountNum: accountNum,
		IBAN: iban,
		Status: "pending",
	}

	rampStore.mu.Lock()
	defer rampStore.mu.Unlock()
	rampStore.accounts[account.ID] = account

	return account
}

func main() {
	fmt.Println("Fiat Ramp service initialized")

	// Quote
	quote := GetQuote("BTC", "USD")
	fmt.Printf("Quote: 1 BTC = $%.2f USD\n", quote.Rate)

	// Create order
	order, err := CreateOrder("user_001", "buy", "BTC", "USD", "bank_transfer", 1.0)
	if err != nil {
		fmt.Printf("Order error: %v\n", err)
	} else {
		fmt.Printf("Order: %s - %.2f BTC = $%.2f\n", order.Type, order.CryptoAmount, order.FiatAmount)
	}
}