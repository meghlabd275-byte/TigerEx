// Package giftcard provides gift card services.
// Migrated from TypeScript to Go for gift cards.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// Gift card
type GiftCard struct {
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	Pin         string  `json:"pin"`
	Denomination float64 `json:"denomination"`
	Balance     float64 `json:"balance"`
	Currency    string  `json:"currency"`
	Status     string  `json:"status"` // active, used, Expired
	CreatedAt   int64   `json:"createdAt"`
	ExpiresAt   int64   `json:"expiresAt"`
	Type       string  `json:"type"` // physical, digital
}

// Gift card purchase order
type GiftCardOrder struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Denomination float64 `json:"denomination"`
	Quantity int     `json:"quantity"`
	Currency string  `json:"currency"`
	Status  string  `json:"status"` // pending, completed, cancelled
	CreatedAt int64  `json:"createdAt"`
}

// Store
type GiftCardStore struct {
	mu    sync.RWMutex
	cards map[string]*GiftCard
	orders map[string]*GiftCardOrder
}

var (
	gcStore = &GiftCardStore{
		cards: make(map[string]*GiftCard),
		orders: make(map[string]*GiftCardOrder),
	}
)

// Generate card code
func generateCardCode() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)[:16]
}

// Generate PIN
func generatePIN() string {
	b := make([]byte, 4)
	rand.Read(b)
	return fmt.Sprintf("%04d", int(b[0])*1000+int(b[1])%1000)
}

// Issue gift cards
func IssueCards(denomination float64, quantity int, currency string, expiryDays int) []*GiftCard {
	cards := make([]*GiftCard, quantity)

	for i := 0; i < quantity; i++ {
		card := &GiftCard{
			ID:         fmt.Sprintf("gc_%d", time.Now().UnixNano()+int64(i)),
			Code:      generateCardCode(),
			Pin:       generatePIN(),
			Denomination: denomination,
			Balance:   denomination,
			Currency:  currency,
			Status:   "active",
			CreatedAt: time.Now().UnixMilli(),
			ExpiresAt: time.Now().UnixMilli() + int64(expiryDays*24*3600000),
			Type:     "digital",
		}

		gcStore.mu.Lock()
		gcStore.cards[card.Code] = card
		gcStore.mu.Unlock()

		cards[i] = card
	}

	return cards
}

// Activate card (physical cards need activation)
func ActivateCard(code string) error {
	gcStore.mu.Lock()
	defer gcStore.mu.Unlock()

	card, ok := gcStore.cards[code]
	if !ok {
		return fmt.Errorf("card not found")
	}

	if card.Status != "active" {
		return fmt.Errorf("card already used")
	}

	card.Status = "active"
	return nil
}

// Redeem gift card
func RedeemCard(code, pin string, amount float64) (float64, error) {
	gcStore.mu.Lock()
	defer gcStore.mu.Unlock()

	card, ok := gcStore.cards[code]
	if !ok {
		return 0, fmt.Errorf("invalid card")
	}

	if card.Pin != pin {
		return 0, fmt.Errorf("invalid PIN")
	}

	if card.Status != "active" {
		return 0, fmt.Errorf("card not active")
	}

	if time.Now().UnixMilli() > card.ExpiresAt {
		card.Status = "expired"
		return 0, fmt.Errorf("card expired")
	}

	redeemAmount := amount
	if amount > card.Balance {
		redeemAmount = card.Balance
	}

	card.Balance -= redeemAmount
	if card.Balance <= 0 {
		card.Status = "used"
	}

	return redeemAmount, nil
}

// Check balance
func CheckBalance(code string) (float64, error) {
	gcStore.mu.RLock()
	defer gcStore.mu.RUnlock()

	card, ok := gcStore.cards[code]
	if !ok {
		return 0, fmt.Errorf("card not found")
	}

	return card.Balance, nil
}

// Get card details
func GetCardDetails(code string) (*GiftCard, error) {
	gcStore.mu.RLock()
	defer gcStore.mu.RUnlock()

	card, ok := gcStore.cards[code]
	if !ok {
		return nil, fmt.Errorf("card not found")
	}

	return card, nil
}

func main() {
	fmt.Println("Gift Card service initialized")

	// Issue demo cards
	cards := IssueCards(100, 5, "USDT", 365)
	fmt.Printf("Issued %d cards, each %s %.2f\n", len(cards), "USDT", cards[0].Denomination)
	fmt.Printf("First card: %s (PIN: %s)\n", cards[0].Code, cards[0].Pin)

	// Redeem demo
	amount, err := RedeemCard(cards[0].Code, cards[0].Pin, 50)
	if err != nil {
		fmt.Printf("Redeem error: %v\n", err)
	} else {
		fmt.Printf("Redeemed: %.2f\n", amount)
	}
}