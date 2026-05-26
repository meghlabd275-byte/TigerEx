// Package otc_trading provides OTC (Over-The-Counter) desk.
// Migrated from TypeScript to Go for large institutional trades.
package main

import (
	"fmt"
	"sync"
	"time"
)

// OTC Quote
type OTCQuote struct {
	ID         string  `json:"id"`
	Asset      string  `json:"asset"`
	Amount     float64 `json:"amount"`
	SellPrice  float64 `json:"sellPrice"` // discounted for large
	BuyPrice   float64 `json:"buyPrice"`
	ValidUntil int64   `json:"validUntil"`
	Status     string  `json:"status"` // active, quoted, accepted, Expired
}

// OTC Order
type OTCOrder struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	QuotedBy string  `json:"quotedBy"` // desk ID
	Asset    string  `json:"asset"`
	Amount   float64 `json:"amount"`
	Price    float64 `json:"price"`
	Status   string  `json:"status"` // pending, completed, cancelled
	ExecutedAt int64  `json:"executedAt"`
	CreatedAt int64   `json:"createdAt"`
}

// Desk
type OTCDesk struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MinSize  float64 `json:"minSize"`
	Fee      float64 `json:"fee"` // fee discount
	Status  string `json:"status"`
}

// Store
type OTCStore struct {
	mu    sync.RWMutex
	quotes map[string]*OTCQuote
	orders map[string]*OTCOrder
	desks  map[string]*OTCDesk
}

var (
	otcStore = &OTCStore{
		quotes: make(map[string]*OTCQuote),
		orders: make(map[string]*OTCOrder),
		desks: make(map[string]*OTCDesk),
	}
)

// Initialize desks
func init() {
	desks := []*OTCDesk{
		{ID: "desk_1", Name: "VIP Desk", MinSize: 100000, Fee: 0.001, Status: "active"},
		{ID: "desk_2", Name: "Institutional Desk", MinSize: 500000, Fee: 0.0008, Status: "active"},
		{ID: "desk_3", Name: "Partner Desk", MinSize: 1000000, Fee: 0.0005, Status: "active"},
	}

	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	for _, d := range desks {
		otcStore.desks[d.ID] = d
	}
}

// Request quote
func RequestQuote(deskID, asset string, amount float64) (*OTCQuote, error) {
	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	desk, ok := otcStore.desks[deskID]
	if !ok {
		return nil, fmt.Errorf("desk not found")
	}

	if amount < desk.MinSize {
		return nil, fmt.Errorf("below minimum size")
	}

	// Discount pricing for volume
	discount := 1.0
	if amount >= 1000000 {
		discount = 0.995 // 0.5% discount
	} else if amount >= 500000 {
		discount = 0.998 // 0.2% discount
	}

	quote := &OTCQuote{
		ID: fmt.Sprintf("quote_%d", time.Now().UnixNano()),
		Asset: asset,
		Amount: amount,
		SellPrice: 65000 * discount, // Simplified
		BuyPrice: 65000 * discount,
		ValidUntil: time.Now().UnixMilli() + 3600000, // 1 hour
		Status: "active",
	}

	otcStore.quotes[quote.ID] = quote

	return quote, nil
}

// Accept quote
func AcceptQuote(quoteID, userID string) (*OTCOrder, error) {
	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	quote, ok := otcStore.quotes[quoteID]
	if !ok {
		return nil, fmt.Errorf("quote not found")
	}

	if quote.Status != "active" {
		return nil, fmt.Errorf("quote not active")
	}

	if time.Now().UnixMilli() > quote.ValidUntil {
		quote.Status = "expired"
		return nil, fmt.Errorf("quote expired")
	}

	order := &OTCOrder{
		ID: fmt.Sprintf("otc_%d", time.Now().UnixNano()),
		UserID: userID,
		QuotedBy: "", // Would track desk
		Asset: quote.Asset,
		Amount: quote.Amount,
		Price: quote.BuyPrice,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	otcStore.orders[order.ID] = order
	quote.Status = "accepted"

	return order, nil
}

// Execute order
func ExecuteOrder(orderID string) error {
	otcStore.mu.Lock()
	defer otcStore.mu.Unlock()

	order, ok := otcStore.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != "pending" {
		return fmt.Errorf("order not pending")
	}

	order.Status = "completed"
	order.ExecutedAt = time.Now().UnixMilli()

	return nil
}

func main() {
	fmt.Println("OTC Trading initialized")

	// Request quote
	quote, err := RequestQuote("desk_2", "BTC", 500000)
	if err != nil {
		fmt.Printf("Quote error: %v\n", err)
	} else {
		fmt.Printf("Quote: %.2f BTC @ $%.2f (valid 1hr)\n", quote.Amount, quote.BuyPrice)
	}

	// Accept
	order, _ := AcceptQuote(quote.ID, "institution_001")
	fmt.Printf("Order created: %s\n", order.Status)
}