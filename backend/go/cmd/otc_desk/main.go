// Package otc_desk provides OTC trading services.
// Migrated from TypeScript to Go for Over-The-Counter trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// OTC Quote
type OTCQuote struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	Side      string  `json:"side"` // buy, sell
	Base      string  `json:"base"`
	Quote     string  `json:"quote"`
	Amount    float64 `json:"amount"`
	Rate      float64 `json:"rate"` // negotiated rate
	ExpiresAt int64   `json:"expiresAt"`
	Status    string  `json:"status"` // active, accepted, expired
}

// OTC Deal
type OTCDeal struct {
	ID          string  `json:"id"`
	QuoteID    string  `json:"quoteId"`
	Buyer     string  `json:"buyer"`
	Seller    string  `json:"seller"`
	Base      string  `json:"base"`
	Quote     string  `json:"quote"`
	Amount    float64 `json:"amount"`
	Rate      float64 `json:"rate"`
	FiatAmount float64 `json:"fiatAmount"`
	Status   string  `json:"status"` // pending, paid, released, completed, disputed
	BankRef  string  `json:"bankRef"`
}

// Store
type OTCOStore struct {
	mu    sync.RWMutex
	quotes map[string]*OTCQuote
	deals  map[string]*OTCDeal
}

var (
	otcStore = &OTCOStore{
		quotes: make(map[string]*OTCQuote),
		deals: make(map[string]*OTCDeal),
	}
)

// Request quote
func RequestQuote(userID, side, base, quote string, amount float64) *OTCQuote {
	// Apply custom rate (negotiated)
	rate := getCustomRate(base, quote, amount)

	qt := &OTCQuote{
		ID: fmt.Sprintf("otcq_%d", time.Now().UnixNano()),
		UserID: userID,
		Side: side,
		Base: base,
		Quote: quote,
		Amount: amount,
		Rate: rate,
		ExpiresAt: time.Now().UnixMilli() + 300000, // 5 mins
		Status: "active",
	}

	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()
	otcStore.quotes[qt.ID] = qt

	return qt
}

// Accept quote
func AcceptQuote(quoteID string, buyerID string) (*OTCDeal, error) {
	otcStore.mu.RLock()
	quote, ok := otcStore.quotes[quoteID]
	otcStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("quote not found")
	}

	if quote.Status != "active" {
		return nil, fmt.Errorf("quote not active")
	}

	deal := &OTCDeal{
		ID: fmt.Sprintf("otcd_%d", time.Now().UnixNano()),
		QuoteID: quoteID,
		Buyer: buyerID,
		Seller: quote.UserID,
		Base: quote.Base,
		Quote: quote.Quote,
		Amount: quote.Amount,
		Rate: quote.Rate,
		FiatAmount: quote.Amount * quote.Rate,
		Status: "pending",
	}

	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	quote.Status = "accepted"
	otcStore.deals[deal.ID] = deal

	return deal, nil
}

// Release crypto
func ReleaseCrypto(dealID, bankRef string) error {
	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	deal, ok := otcStore.deals[dealID]
	if !ok {
		return fmt.Errorf("deal not found")
	}

	if deal.Status != "paid" {
		return fmt.Errorf("payment not confirmed")
	}

	deal.Status = "released"
	deal.BankRef = bankRef

	return nil
}

// Dispute deal
func DisputeDeal(dealID, reason string) error {
	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	deal, ok := otcStore.deals[dealID]
	if !ok {
		return fmt.Errorf("deal not found")
	}

	deal.Status = "disputed"
	return nil
}

// Custom rates for large volume
func getCustomRate(base, quote string, amount float64) float64 {
	rates := map[string]map[string]float64{
		"BTC": {"USD": 64800, "EUR": 59600, "GBP": 51000},
		"ETH": {"USD": 3480, "EUR": 3200, "GBP": 2740},
		"SOL": {"USD": 145, "EUR": 133, "GBP": 114},
	}

	if r, ok := rates[base][quote]; ok {
		discount := 0.02 // 2% discount for OTC
		if amount >= 100000 {
			discount = 0.04 // 4% for large orders
		}
		return r * (1 - discount)
	}

	return 1.0
}

func main() {
	fmt.Println("OTC Desk service initialized")

	// Request quote
	quote := RequestQuote("user_002", "sell", "BTC", "USD", 50000)
	fmt.Printf("Quote: Sell %.0f %s @ $%.2f (expires in 5min)\n", 
		quote.Amount, quote.Base, quote.Rate)

	// Accept
	deal, _ := AcceptQuote(quote.ID, "user_001")
	fmt.Printf("Deal: %s -> %s @ $%.2f (%s %.0f %s)\n", 
		deal.Buyer, deal.Seller, deal.Rate, deal.Base, deal.Amount)
}