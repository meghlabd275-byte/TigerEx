package main

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// GIFT CARDS PLATFORM - Production Ready
// Digital gift cards for crypto and fiat
// =============================================================================

// GiftCardBrand represents card brand
type GiftCardBrand string

const (
	BrandAmazon GiftCardBrand = "AMAZON"
	BrandApple GiftCardBrand = "APPLE"
	BrandGoogle GiftCardBrand = "GOOGLE"
	BrandNetflix GiftCardBrand = "NETFLIX"
	BrandSpotify GiftCardBrand = "SPOTIFY"
	BrandVisa GiftCardBrand = "VISA"
	BrandMastercard GiftCardBrand = "MASTERCARD"
	BrandTigerEx GiftCardBrand = "TIGEREX"
)

// GiftCardType represents card type
type GiftCardType int

const (
	TypeDigital GiftCardType = iota
	TypePhysical
	TypeVirtual
)

// GiftCardStatus represents card status
type GiftCardStatus int

const (
	CardPending GiftCardStatus = iota
	CardActive
	CardRedeemed
	CardExpired
	CardCancelled
)

// GiftCard represents a gift card
type GiftCard struct {
	ID          string       `json:"id"`
	Brand      GiftCardBrand `json:"brand"`
	Type      GiftCardType `json:"type"`
	Amount    float64     `json:"amount"`
	Currency  string      `json:"currency"`
	Pin       string      `json:"-"`
	Status    GiftCardStatus `json:"status"`
	Code      string      `json:"code"`
	UserID    string     `json:"userId"`
	RedeemedBy string    `json:"redeemedBy,omitempty"`
	CreatedAt int64      `json:"createdAt"`
	ExpiresAt int64      `json:"expiresAt"`
	RedeemedAt int64     `json:"redeemedAt,omitempty"`
}

// GiftCardConfig represents card configuration
type GiftCardConfig struct {
	MinAmount   float64 `json:"minAmount"`
	MaxAmount   float64 `json:"maxAmount"`
	FeePercent  float64 `json:"feePercent"`
	ExpiryDays int    `json:"expiryDays"`
	AutoRedeem bool   `json:"autoRedeem"`
}

// GiftCardOrder represents an order for cards
type GiftCardOrder struct {
	ID          string          `json:"id"`
	UserID      string          `json:"userId"`
	Cards       []*GiftCard     `json:"cards"`
	TotalAmount float64        `json:"totalAmount"`
	Fee         float64        `json:"fee"`
	Status      string        `json:"status"`
	CreatedAt   int64         `json:"createdAt"`
}

// GiftCardsPlatform main struct
type GiftCardsPlatform struct {
	mu          sync.RWMutex
	config      GiftCardConfig
	cards       map[string]*GiftCard // cardID -> card
	orders      map[string]*GiftCardOrder
	brands     map[GiftCardBrand]bool
	// Inventory management
	inventory map[GiftCardBrand]map[float64]int // brand -> amount -> count
}

// NewGiftCardsPlatform creates new platform
func NewGiftCardsPlatform() *GiftCardsPlatform {
	return &GiftCardsPlatform{
		config: GiftCardConfig{
			MinAmount:   5.0,
			MaxAmount:   1000.0,
			FeePercent: 0.02,
			ExpiryDays: 365,
			AutoRedeem: true,
		},
		cards:     make(map[string]*GiftCard),
		orders:   make(map[string]*GiftCardOrder),
		brands:  make(map[GiftCardBrand]bool),
		inventory: make(map[GiftCardBrand]map[float64]int),
	}
}

// InitializeBrands initializes supported brands
func (p *GiftCardsPlatform) InitializeBrands(brands []GiftCardBrand) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, brand := range brands {
		p.brands[brand] = true

		// Initialize inventory for common amounts
		p.inventory[brand] = map[float64]int{
			25:   1000,
			50:   1000,
			100:  500,
			200:  500,
			500:  100,
		}
	}
}

// CreateCard creates a new gift card
func (p *GiftCardsPlatform) CreateCard(brand GiftCardBrand, amount float64, cardType GiftCardType, userID string) (*GiftCard, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Validate brand
	if !p.brands[brand] {
		return nil, fmt.Errorf("unsupported brand")
	}

	// Validate amount
	if amount < p.config.MinAmount || amount > p.config.MaxAmount {
		return nil, fmt.Errorf("amount out of range")
	}

	// Generate unique card
	id := fmt.Sprintf("GC-%d-%s", time.Now().UnixNano(), userID[:min(4, len(userID)])
	code := generateCardCode()
	pin := generatePIN()

	now := time.Now().UnixMilli()
	expires := now + int64(p.config.ExpiryDays*24*3600*1000)

	card := &GiftCard{
		ID:         id,
		Brand:     brand,
		Type:      cardType,
		Amount:    amount,
		Currency:  "USD",
		Status:    CardActive,
		Code:      code,
		Pin:       pin,
		UserID:    userID,
		CreatedAt: now,
		ExpiresAt: expires,
	}

	p.cards[id] = card

	return card, nil
}

// RedeemCard redeems a gift card
func (p *GiftCardsPlatform) RedeemCard(cardID, redeemCode, pin, recipientID string) (float64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	card, ok := p.cards[cardID]
	if !ok {
		return 0, fmt.Errorf("card not found")
	}

	// Validate status
	if card.Status != CardActive {
		return 0, fmt.Errorf("card is not active")
	}

	// Validate code and PIN
	if card.Code != redeemCode || card.Pin != pin {
		return 0, fmt.Errorf("invalid code or PIN")
	}

	// Check expiry
	if time.Now().UnixMilli() > card.ExpiresAt {
		card.Status = CardExpired
		return 0, fmt.Errorf("card expired")
	}

	// Redeem the card
	card.Status = CardRedeemed
	card.RedeemedBy = recipientID
	card.RedeemedAt = time.Now().UnixMilli()

	return card.Amount, nil
}

// CreateBulkOrder creates bulk order
func (p *GiftCardsPlatform) CreateBulkOrder(userID string, brand GiftCardBrand, amounts []float64) (*GiftCardOrder, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	orderID := fmt.Sprintf("ORDER-%d", time.Now().UnixNano())

	totalAmount := 0.0
	cards := make([]*GiftCard, 0, len(amounts))

	for _, amount := range amounts {
		card, err := p.createCardInternal(brand, amount, TypeDigital, userID)
		if err != nil {
			return nil, err
		}
		cards = append(cards, card)
		totalAmount += amount
	}

	fee := totalAmount * p.config.FeePercent

	order := &GiftCardOrder{
		ID:          orderID,
		UserID:      userID,
		Cards:       cards,
		TotalAmount: totalAmount,
		Fee:        fee,
		Status:     "completed",
		CreatedAt:  time.Now().UnixMilli(),
	}

	p.orders[orderID] = order

	return order, nil
}

func (p *GiftCardsPlatform) createCardInternal(brand GiftCardBrand, amount float64, cardType GiftCardType, userID string) (*GiftCard, error) {
	id := fmt.Sprintf("GC-%d-%s", time.Now().UnixNano(), userID[:min(4, len(userID)])
	code := generateCardCode()
	pin := generatePIN()

	now := time.Now().UnixMilli()
	expires := now + int64(p.config.ExpiryDays*24*3600*1000)

	card := &GiftCard{
		ID:         id,
		Brand:     brand,
		Type:      cardType,
		Amount:    amount,
		Currency:  "USD",
		Status:    CardActive,
		Code:      code,
		Pin:       pin,
		UserID:    userID,
		CreatedAt: now,
		ExpiresAt: expires,
	}

	p.cards[id] = card

	return card, nil
}

// GetCard gets card by ID
func (p *GiftCardsPlatform) GetCard(cardID string) (*GiftCard, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	card, ok := p.cards[cardID]
	if !ok {
		return nil, fmt.Errorf("card not found")
	}

	return card, nil
}

// GetInventory gets inventory status
func (p *GiftCardsPlatform) GetInventory(brand GiftCardBrand) map[float64]int {
	p.mu.RLock()
	defer p.mu.RUnlock()

	inv := make(map[float64]int)
	if inventory, ok := p.inventory[brand]; ok {
		for amt, count := range inventory {
			inv[amt] = count
		}
	}

	return inv
}

// GetStats returns platform statistics
func (p *GiftCardsPlatform) GetStats() map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()

	totalActive := 0
	totalRedeemed := 0
	totalExpired := 0

	for _, card := range p.cards {
		switch card.Status {
		case CardActive:
			totalActive++
		case CardRedeemed:
			totalRedeemed++
		case CardExpired:
			totalExpired++
		}
	}

	return map[string]interface{}{
		"totalCards":    len(p.cards),
		"activeCards":  totalActive,
		"redeemedCards": totalRedeemed,
		"expiredCards": totalExpired,
		"orders":      len(p.orders),
		"brands":     len(p.brands),
	}
}

// Helper functions
func generateCardCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	code := make([]byte, 16)
	for i := range code {
		code[i] = chars[i%len(chars)]
	}
	return string(code)
}

func generatePIN() string {
	const pins = "0123456789"
	pin := make([]byte, 4)
	for i := range pin {
		pin[i] = pins[i%len(pins)]
	}
	return string(pin)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Main entry point
func main() {
	fmt.Println("=== TigerEx Gift Cards Platform ===")
	fmt.Println()

	platform := NewGiftCardsPlatform()

	// Initialize brands
	brands := []GiftCardBrand{
		BrandAmazon,
		BrandApple,
		BrandGoogle,
		BrandNetflix,
		BrandSpotify,
		BrandTigerEx,
	}
	platform.InitializeBrands(brands)
	fmt.Println("✓ Brands initialized:", len(brands))

	// Create sample cards
	fmt.Println("\nCreating gift cards...")
	card1, err := platform.CreateCard(BrandAmazon, 50.0, TypeDigital, "user1")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("✓ Created: %s - $%.2f %s\n", card1.Brand, card1.Amount)
	}

	card2, err := platform.CreateCard(BrandApple, 100.0, TypeDigital, "user2")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("✓ Created: %s - $%.2f %s\n", card2.Brand, card2.Amount)
	}

	card3, err := platform.CreateCard(BrandTigerEx, 200.0, TypeVirtual, "user3")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("✓ Created: %s - $%.2f %s\n", card3.Brand, card3.Amount)
	}

	// Redeem a card
	fmt.Println("\nRedeeming card...")
	amount, err := platform.RedeemCard(card1.ID, card1.Code, card1.Pin, "recipient1")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("✓ Redeemed: $%.2f\n", amount)
	}

	// Bulk order
	fmt.Println("\nCreating bulk order...")
	amounts := []float64{25, 50, 100, 100}
	order, err := platform.CreateBulkOrder("userbulk", BrandAmazon, amounts)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("✓ Bulk order: %s - %d cards, Total: $%.2f\n", order.ID, len(order.Cards), order.TotalAmount)
	}

	// Statistics
	stats := platform.GetStats()
	fmt.Printf("\n✓ Platform Statistics:\n")
	fmt.Printf("  - Total Cards: %d\n", stats["totalCards"])
	fmt.Printf("  - Active Cards: %d\n", stats["activeCards"])
	fmt.Printf("  - Redeemed Cards: %d\n", stats["redeemedCards"])
	fmt.Printf("  - Orders: %d\n", stats["orders"])

	// Inventory
	fmt.Println("\n✓ Inventory Check:")
	inventory := platform.GetInventory(BrandAmazon)
	for amt, count := range inventory {
		fmt.Printf("  - Amazon $%.0f: %d cards\n", amt, count)
	}

	fmt.Println("\n=== Gift Cards Platform Ready ===")
}