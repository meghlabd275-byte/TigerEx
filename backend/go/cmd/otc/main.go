// Package otc provides OTC (over-the-counter) desk services.
// For large institutional trades with negotiated prices.
package main

import (
	"fmt"
	"sync"
	"time"
)

// OTC Quote Request
type OTCRequest struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Symbol  string  `json:"symbol"`
	Side    string  `json:"side"` // buy, sell
	Amount  float64 `json:"amount"`
	Status  string  `json:"status"` // pending, quoted, accepted, completed, expired
}

// OTC Quote
type OTCQuote struct {
	ID         string  `json:"id"`
	RequestID string  `json:"requestId"`
	Price     float64 `json:"price"`
	Slippage  float64 `json:"slippage"` // % from spot
	Expiry    int64   `json:"expiry"`
	Status   string  `json:"status"`
}

// OTC Execution
type OTCExecution struct {
	ID        string  `json:"id"`
	QuoteID  string  `json:"quoteId"`
	UserID   string  `json:"userId"`
	Symbol  string  `json:"symbol"`
	Amount  float64 `json:"amount"`
	Price   float64 `json:"price"`
	Status  string  `json:"status"` // pending, completed, failed
}

// Store
type OTCStore struct {
	mu       sync.RWMutex
	requests map[string]*OTCRequest
	quotes   map[string]*OTCQuote
	execs    map[string]*OTCExecution
}

var otcStore = &OTCStore{
	requests: make(map[string]*OTCRequest),
	quotes: make(map[string]*OTCQuote),
	execs: make(map[string]*OTCExecution),
}

// Request quote
func RequestQuote(userID, symbol, side string, amount float64) *OTCRequest {
	req := &OTCRequest{
		ID: fmt.Sprintf("otcreq_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Amount: amount,
		Status: "pending",
	}

	otcStore.mu.Lock()
	otcStore.requests[req.ID] = req
	otcStore.mu.Unlock()

	return req
}

// Get quote
func GetQuote(requestID, symbol, side string, amount, spotPrice float64) (*OTCQuote, error) {
	otcStore.mu.RLock()
	_, ok := otcStore.requests[requestID]
	otcStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("request not found")
	}

	// Calculate slippage based on size
	slippage := calculateSlippage(amount)
	price := spotPrice * (1 + slippage)

	quote := &OTCQuote{
		ID: fmt.Sprintf("otcq_%d", time.Now().UnixNano()),
		RequestID: requestID,
		Price: price,
		Slippage: slippage,
		Expiry: time.Now().UnixMilli() + 300000, // 5 min validity
		Status: "active",
	}

	otcStore.mu.Lock()
	otcStore.quotes[quote.ID] = quote
	otcStore.mu.Unlock()

	return quote, nil
}

// Execute OTC trade
func ExecuteTrade(quoteID string) (*OTCExecution, error) {
	otcStore.mu.RLock()
	quote, ok := otcStore.quotes[quoteID]
	otcStore.mu.RUnlock()

	if !ok || quote.Status != "active" {
		return nil, fmt.Errorf("quote not valid")
	}

	if time.Now().UnixMilli() > quote.Expiry {
		return nil, fmt.Errorf("quote expired")
	}

	req, _ := otcStore.requests[quote.RequestID]

	exec := &OTCExecution{
		ID: fmt.Sprintf("otcex_%d", time.Now().UnixNano()),
		QuoteID: quoteID,
		UserID: req.UserID,
		Symbol: req.Symbol,
		Amount: req.Amount,
		Price: quote.Price,
		Status: "completed",
	}

	otcStore.mu.Lock()
	quote.Status = "executed"
	otcStore.execs[exec.ID] = exec
	otcStore.mu.Unlock()

	return exec, nil
}

func generateSlippage(amt float64) float64 {
	// Tiered slippage model
	if amt >= 1000000 { // >1M
		return 0.005 // 0.5%
	}
	if amt >= 100000 { // >100K
		return 0.003 // 0.3%
	}
	if amt >= 10000 { // >10K
		return 0.001 // 0.1%
	}
	return 0 // <10K uses spot
}

func main() {
	fmt.Println("OTC Desk service initialized")

	// Request
	req := RequestQuote("inst1", "BTCUSDT", "buy", 50000)
	fmt.Printf("Request: %s\n", req.ID)

	// Get quote (spot price 65000)
	quote, _ := GetQuote(req.ID, "BTCUSDT", "buy", 50000, 65000)
	fmt.Printf("Quote: $%.2f (%.2f%% slippage)\n", quote.Price, quote.Slippage*100)
}