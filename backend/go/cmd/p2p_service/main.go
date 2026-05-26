// Package p2p_service provides P2P trading service.
// Migrated from TypeScript to Go for P2P marketplace.
package main

import (
	"fmt"
	"sync"
	"time"
)

// P2P offer
type P2POffer struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	Type      string  `json:"type"` // buy, sell
	Fiat      string  `json:"fiat"` // USD, EUR, etc.
	Amount    float64 `json:"amount"`
	Price     float64 `json:"price"`
	Payment   []string `json:"paymentMethods"` // bank_transfer, paypal, etc.
	Terms     string  `json:"terms"`
	Status    string  `json:"status"` // active, paused, completed, cancelled
	MinAmount float64 `json:"minAmount"`
	MaxAmount float64 `json:"maxAmount"`
	CreatedAt int64   `json:"createdAt"`
}

// P2P trade
type P2PTrade struct {
	ID          string `json:"id"`
	OfferID    string `json:"offerId"`
	BuyerID    string `json:"buyerId"`
	SellerID   string `json:"sellerId"`
	FiatAmount float64 `json:"fiatAmount"`
	CryptoAmount float64 `json:"cryptoAmount"`
	Status     string `json:"status"` // pending, paid, released, cancelled, dispute
	CreatedAt  int64  `json:"createdAt"`
}

// P2P dispute
type P2PDispute struct {
	TradeID  string `json:"tradeId"`
	UserID  string `json:"userId"`
	Reason string `json:"reason"`
	Status string `json:"status"` // open, resolved
}

// Store
type P2PStore struct {
	mu     sync.RWMutex
	offers map[string]*P2POffer
	trades map[string]*P2PTrade
}

var (
	p2pStore = &P2PStore{
		offers: make(map[string]*P2POffer),
		trades: make(map[string]*P2PTrade),
	}
)

// Create offer
func CreateOffer(offer *P2POffer) *P2POffer {
	offer.ID = fmt.Sprintf("offer_%d", time.Now().UnixNano())
	offer.Status = "active"
	offer.CreatedAt = time.Now().UnixMilli()

	p2pStore.mu.Lock()
	defer p2pStore.mu.Unlock()
	p2pStore.offers[offer.ID] = offer

	return offer
}

// Get offers
func GetOffers(filter string) []*P2POffer {
	p2pStore.mu.RLock()
	defer p2pStore.mu.RUnlock()

	var result []*P2POffer
	for _, o := range p2pStore.offers {
		if o.Status == "active" && (filter == "" || o.Fiat == filter) {
			result = append(result, o)
		}
	}
	return result
}

// Start trade
func StartTrade(offerID, buyerID string, amount float64) (*P2PTrade, error) {
	p2pStore.mu.Lock()
	defer p2pStore.mu.Unlock()

	offer, ok := p2pStore.offers[offerID]
	if !ok {
		return nil, fmt.Errorf("offer not found")
	}

	if amount < offer.MinAmount || amount > offer.MaxAmount {
		return nil, fmt.Errorf("amount outside allowed range")
	}

	cryptoAmount := amount / offer.Price

	trade := &P2PTrade{
		ID:           fmt.Sprintf("trade_%d", time.Now().UnixNano()),
		OfferID:     offerID,
		BuyerID:     buyerID,
		SellerID:    offer.UserID,
		FiatAmount:  amount,
		CryptoAmount: cryptoAmount,
		Status:      "pending",
		CreatedAt:   time.Now().UnixMilli(),
	}

	p2pStore.trades[trade.ID] = trade
	return trade, nil
}

// Mark as paid
func MarkPaid(tradeID string) error {
	p2pStore.mu.Lock()
	defer p2pStore.mu.Unlock()

	trade, ok := p2pStore.trades[tradeID]
	if !ok {
		return fmt.Errorf("trade not found")
	}

	trade.Status = "paid"
	return nil
}

// Release crypto
func ReleaseCrypto(tradeID string) error {
	p2pStore.mu.Lock()
	defer p2pStore.mu.Unlock()

	trade, ok := p2pStore.trades[tradeID]
	if !ok {
		return fmt.Errorf("trade not found")
	}

	trade.Status = "released"
	return nil
}

// Cancel trade
func CancelTrade(tradeID string) error {
	p2pStore.mu.Lock()
	defer p2pStore.mu.Unlock()

	trade, ok := p2pStore.trades[tradeID]
	if !ok {
		return fmt.Errorf("trade not found")
	}

	if trade.Status != "pending" {
		return fmt.Errorf("cannot cancel in current state")
	}

	trade.Status = "cancelled"
	return nil
}

// Open dispute
func OpenDispute(tradeID, userID, reason string) *P2PDispute {
	return &P2PDispute{
		TradeID: tradeID,
		UserID: userID,
		Reason: reason,
		Status: "open",
	}
}

func main() {
	fmt.Println("P2P service initialized")

	// Demo offer
	offer := &P2POffer{
		UserID:    "user_seller",
		Type:     "sell",
		Fiat:     "USD",
		Amount:   10000.0,
		Price:    65000.0,
		Payment:  []string{"bank_transfer", "paypal"},
		Terms:    "Release within 24 hours",
		MinAmount: 100.0,
		MaxAmount: 5000.0,
	}

	created := CreateOffer(offer)
	fmt.Printf("Created offer: %s (%s %s)\n", created.Type, created.Fiat, created.Amount)
}