// Package crypto_card provides crypto card services.
// Migrated from TypeScript to Go for crypto debit cards.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Card
type CryptoCard struct {
	ID        string `json:"id"`
	UserID   string `json:"userId"`
	Last4    string `json:"last4"`
	Status   string `json:"status"` // active, blocked, expired
	Limit    float64 `json:"dailyLimit"`
	UsedToday float64 `json:"usedToday"`
	ResetAt  int64  `json:"resetAt"`
}

// Transaction
type CardTransaction struct {
	ID          string  `json:"id"`
	CardID    string  `json:"cardId"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Merchant string  `json:"merchant"`
	Status   string  `json:"status"` // pending, completed, declined
	Timestamp int64   `json:"timestamp"`
}

// Store
type CardStore struct {
	mu      sync.RWMutex
	cards   map[string]*CryptoCard
	txns    map[string]*CardTransaction
}

var (
	cardStore = &CardStore{
		cards: make(map[string]*CryptoCard),
		txns: make(map[string]*CardTransaction),
	}
)

// Issue card
func IssueCard(userID string, dailyLimit float64) *CryptoCard {
	card := &CryptoCard{
		ID: fmt.Sprintf("card_%d", time.Now().UnixNano()),
		UserID: userID,
		Last4: fmt.Sprintf("%04d", 1234),
		Status: "active",
		Limit: dailyLimit,
		UsedToday: 0,
		ResetAt: 0,
	}

	cardStore.mu.Lock()
	defer cardStore.mu.Unlock()
	cardStore.cards[card.ID] = card

	return card
}

// Authorize transaction
func Authorize(cardID string, amount float64, merchant string) (*CardTransaction, error) {
	cardStore.mu.RLock()
	card, ok := cardStore.cards[cardID]
	cardStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("card not found")
	}

	if card.Status != "active" {
		return nil, fmt.Errorf("card not active")
	}

	// Check limit
	if card.UsedToday + amount > card.Limit {
		return nil, fmt.Errorf("daily limit exceeded")
	}

	txn := &CardTransaction{
		ID: fmt.Sprintf("txn_%d", time.Now().UnixNano()),
		CardID: cardID,
		Amount: amount,
		Currency: "USD",
		Merchant: merchant,
		Status: "pending",
		Timestamp: time.Now().UnixMilli(),
	}

	cardStore.mu.Lock()
	defer cardStore.mu.Unlock()
	cardStore.txns[txn.ID] = txn
	card.UsedToday += amount

	return txn, nil
}

// Capture transaction
func Capture(txnID string) error {
	cardStore.mu.Lock()
	defer cardStore.mu.Unlock()

	txn, ok := cardStore.txns[txnID]
	if !ok {
		return fmt.Errorf("transaction not found")
	}

	txn.Status = "completed"
	return nil
}

// Get card
func GetCard(cardID string) (*CryptoCard, bool) {
	cardStore.mu.RLock()
	defer cardStore.mu.RUnlock()

	card, ok := cardStore.cards[cardID]
	return card, ok
}

func main() {
	fmt.Println("Crypto Card service initialized")

	// Issue card
	card := IssueCard("user_001", 1000)
	fmt.Printf("Card issued: **** %s, limit $%.2f/day\n", card.Last4, card.Limit)

	// Authorize
	txn, _ := Authorize(card.ID, 50, "Amazon")
	fmt.Printf("Authorized: $%.2f @ %s\n", txn.Amount, txn.Merchant)

	// Capture
	Capture(txn.ID)
	fmt.Printf("Transaction: %s\n", txn.Status)
}