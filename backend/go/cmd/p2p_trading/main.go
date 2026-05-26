// Package p2p_trading provides P2P trading services.
// Peer-to-peer OTC desk for large trades.
package main

import (
	"fmt"
	"sync"
	"time"
)

// P2P Advertisement
type P2PAd struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Type    string  `json:"type"` // buy, sell
	Fiat   string  `json:"fiat"` // EUR, USD
	PriceOffset float64 `json:"priceOffset"` // % from market
	Limits  [2]float64 `json:"limits"` // min, max
	PaymentMethods []string `json:"paymentMethods"`
	Status  string  `json:"status"` // active, paused
}

// P2P Order
type P2POrder struct {
	ID        string  `json:"id"`
	AdID    string  `json:"adId"`
	TakerID string  `json:"takerId"`
	Symbol string  `json:"symbol"`
	Amount  float64 `json:"amount"`
	Price  float64 `json:"price"`
	FiatAmount float64 `json:"fiatAmount"`
	Status string  `json:"status"` // pending, paying, canceled, completed, disputed
}

// Dispute
type Dispute struct {
	ID       string  `json:"id"`
	OrderID string  `json:"orderId"`
	UserID string  `json:"userId"`
	Reason string  `json:"reason"`
	Status string  `json:"status"` // open, resolving, resolved
}

// Store
type P2PStore struct {
	mu    sync.RWMutex
	ads   map[string]*P2PAd
	orders map[string]*P2POrder
	dispputes map[string]*Dispute
}

var p2pStore = &P2PStore{
	ads: make(map[string]*P2PAd),
	orders: make(map[string]*P2POrder),
	dispputes: make(map[string]*Dispute),
}

// Create advertisement
func CreateAd(userID, ptype, fiat string, priceOffset float64, limits [2]float64, payments []string) *P2PAd {
	ad := &P2PAd{
		ID: fmt.Sprintf("p2pad_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: ptype,
		Fiat: fiat,
		PriceOffset: priceOffset,
		Limits: limits,
		PaymentMethods: payments,
		Status: "active",
	}

	p2pStore.mu.Lock()
	p2pStore.ads[ad.ID] = ad
	p2pStore.mu.Unlock()

	return ad
}

// Create order
func CreateOrder(adID, takerID, symbol string, amount float64, marketPrice float64) (*P2POrder, error) {
	p2pStore.mu.RLock()
	ad, ok := p2pStore.ads[adID]
	p2pStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("ad not found")
	}

	price := marketPrice * (1 + ad.PriceOffset)
	fiatAmount := price * amount

	order := &P2POrder{
		ID: fmt.Sprintf("p2po_%d", time.Now().UnixNano()),
		AdID: adID,
		TakerID: takerID,
		Symbol: symbol,
		Amount: amount,
		Price: price,
		FiatAmount: fiatAmount,
		Status: "pending",
	}

	p2pStore.mu.Lock()
	p2pStore.orders[order.ID] = order
	p2pStore.mu.Unlock()

	return order, nil
}

// Confirm payment
func ConfirmPayment(orderID string) error {
	p2pStore.mu.RLock()
	order, ok := p2pStore.orders[orderID]
	p2pStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	p2pStore.mu.Lock()
	order.Status = "paying"
	p2pStore.mu.Unlock()

	return nil
}

// Release crypto
func ReleaseCrypto(orderID string) error {
	p2pStore.mu.RLock()
	order, ok := p2pStore.orders[orderID]
	p2pStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	p2pStore.mu.Lock()
	order.Status = "completed"
	p2pStore.mu.Unlock()

	return nil
}

// Open dispute
func OpenDispute(orderID, userID, reason string) *Dispute {
	dispute := &Dispute{
		ID: fmt.Sprintf("dsp_%d", time.Now().UnixNano()),
		OrderID: orderID,
		UserID: userID,
		Reason: reason,
		Status: "open",
	}

	p2pStore.mu.Lock()
	p2pStore.dispputes[dispute.ID] = dispute
	p2pStore.mu.Unlock()

	return dispute
}

// Get ads
func GetAds(pType, fiat string) []*P2PAd {
	p2pStore.mu.RLock()
	defer p2pStore.mu.RUnlock()

	var result []*P2PAd
	for _, ad := range p2pStore.ads {
		if ad.Type == pType && ad.Fiat == fiat && ad.Status == "active" {
			result = append(result, ad)
		}
	}
	return result
}

func main() {
	fmt.Println("P2P Trading service initialized")

	// Create ad
	ad, _ := CreateAd("user1", "sell", "USD", -0.01, [2]float64{100, 5000}, []string{"bank_transfer"})
	fmt.Printf("Ad created: %s\n", ad.ID)

	// Create order
	order, _ := CreateOrder(ad.ID, "user2", "BTCUSDT", 1.0, 65000)
	fmt.Printf("Order: %s Amount: %.4f\n", order.ID, order.Amount)
}