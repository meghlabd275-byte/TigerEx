// Package funding provides funding rate services.
// Migrated from TypeScript to Go for futures funding rates.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Funding rate
type FundingRate struct {
	Symbol      string  `json:"symbol"`
	Rate        float64 `json:"rate"` // per hour
	NextFunding int64   `json:"nextFunding"`
	Status     string  `json:"status"` // active
}

// Funding payment
type FundingPayment struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Symbol   string  `json:"symbol"`
	Amount   float64 `json:"amount"` // positive = received, negative = paid
	Rate     float64 `json:"rate"`
	Period   int64   `json:"period"` // funding period
	PaidAt   int64   `json:"paidAt"`
}

// Store
type FundingStore struct {
	mu        sync.RWMutex
	rates    map[string]*FundingRate
	payments map[string]*FundingPayment
}

var (
	fundStore = &FundingStore{
		rates: make(map[string]*FundingRate),
		payments: make(map[string]*FundingPayment),
	}
)

// Initialize funding rates
func init() {
	rates := []*FundingRate{
		{ Symbol: "BTC-PERP", Rate: 0.0001, NextFunding: 0, Status: "active"},
		{ Symbol: "ETH-PERP", Rate: 0.0001, NextFunding: 0, Status: "active"},
		{ Symbol: "SOL-PERP", Rate: 0.0002, NextFunding: 0, Status: "active"},
	}

	fundStore.mu.Lock()
	defer fundStore.mu.Unlock()

	for _, r := range rates {
		fundStore.rates[r.Symbol] = r
	}
}

// Calculate funding payment
func CalculateFunding(userID, symbol string, positionSize, entryPrice float64) *FundingPayment {
	fundStore.mu.RLock()
	rate, ok := fundStore.rates[symbol]
	fundStore.mu.RUnlock()

	if !ok {
		return nil
	}

	// Calculate: position_size * price * rate
	amount := positionSize * entryPrice * rate.Rate

	payment := &FundingPayment{
		ID: fmt.Sprintf("fund_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Amount: amount,
		Rate: rate.Rate,
		Period: rate.NextFunding,
		PaidAt: 0,
	}

	fundStore.mu.Lock()
	defer fundStore.mu.Unlock()
	fundStore.payments[payment.ID] = payment

	return payment
}

// Process funding
func ProcessFunding(paymentID string) error {
	fundStore.mu.Lock()
	defer fundStore.mu.Unlock()

	payment, ok := fundStore.payments[paymentID]
	if !ok {
		return fmt.Errorf("payment not found")
	}

	payment.PaidAt = time.Now().UnixMilli()

	return nil
}

// Get pending payments
func GetPendingPayments(userID string) []*FundingPayment {
	fundStore.mu.RLock()
	defer fundStore.mu.RUnlock()

	var result []*FundingPayment
	for _, p := range fundStore.payments {
		if p.UserID == userID && p.PaidAt == 0 {
			result = append(result, p)
		}
	}
	return result
}

// Update funding rate
func UpdateFundingRate(symbol string, newRate float64) error {
	fundStore.mu.Lock()
	defer fundStore.mu.Unlock()

	rate, ok := fundStore.rates[symbol]
	if !ok {
		return fmt.Errorf("symbol not found")
	}

	rate.Rate = newRate

	return nil
}

func main() {
	fmt.Println("Funding service initialized")

	// Show rates
	for _, r := range fundStore.rates {
		fmt.Printf("%s: %.4f%% per hour\n", r.Symbol, r.Rate*100)
	}
}