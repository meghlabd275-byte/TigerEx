// Package affiliate provides affiliate program services.
// Migrated from TypeScript to Go for partner management.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Affiliate partner
type Affiliate struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Tier       string  `json:"tier"` // bronze, silver, gold, platinum
	FeeShare   float64 `json:"feeShare"` // % share of fees
	Bonus      float64 `json:"bonus"` // signup bonus
	Status     string  `json:"status"` // active, suspended
	JoinedAt   int64   `json:"joinedAt"`
}

// Client
type Client struct {
	ID          string  `json:"id"`
	AffiliateID string `json:"affiliateId"`
	UserID    string  `json:"userId"`
	Volume    float64 `json:"volume"`
	ReferredAt int64  `json:"referredAt"`
}

// Commission
type Commission struct {
	ID          string  `json:"id"`
	AffiliateID string  `json:"affiliateId"`
	UserID    string  `json:"userId"`
	Amount    float64 `json:"amount"`
	Type      string  `json:"type"` // trade_fee, spread, bonus
	PaidAt    int64   `json:"paidAt"`
}

// Store
type AffiliateStore struct {
	mu         sync.RWMutex
	affiliates map[string]*Affiliate
	clients    map[string]*Client
	commissions map[string]*Commission
}

var (
	affStore = &AffiliateStore{
		affiliates: make(map[string]*Affiliate),
		clients: make(map[string]*Client),
		commissions: make(map[string]*Commission),
	}
)

// Register affiliate
func RegisterAffiliate(userID, tier string, feeShare float64) *Affiliate {
	minShares := map[string]float64{"bronze": 0.10, "silver": 0.20, "gold": 0.30, "platinum": 0.40}

	share, ok := minShares[tier]
	if !ok || feeShare > share {
		feeShare = share
	}

	affiliate := &Affiliate{
		ID: fmt.Sprintf("aff_%d", time.Now().UnixNano()),
		UserID: userID,
		Tier: tier,
		FeeShare: feeShare,
		Status: "active",
		JoinedAt: time.Now().UnixMilli(),
	}

	affStore.mu.Lock()
	defer affStore.mu.Unlock()
	affStore.affiliates[affiliate.ID] = affiliate

	return affiliate
}

// Add client
func AddClient(affiliateID, userID string) *Client {
	client := &Client{
		ID: fmt.Sprintf("client_%d", time.Now().UnixNano()),
		AffiliateID: affiliateID,
		UserID: userID,
		Volume: 0,
		ReferredAt: time.Now().UnixMilli(),
	}

	affStore.mu.Lock()
	defer affStore.mu.Unlock()
	affStore.clients[client.ID] = client

	return client
}

// Track commission
func TrackCommission(affiliateID, userID, commType string, amount float64) *Commission {
	affStore.mu.RLock()
	affiliate, ok := affStore.affiliates[affiliateID]
	affStore.mu.RUnlock()

	if !ok {
		return nil
	}

	// Calculate affiliate share
	affShare := amount * affiliate.FeeShare

	comm := &Commission{
		ID: fmt.Sprintf("comm_%d", time.Now().UnixNano()),
		AffiliateID: affiliateID,
		UserID: userID,
		Amount: affShare,
		Type: commType,
		PaidAt: time.Now().UnixMilli(),
	}

	affStore.mu.Lock()
	defer affStore.mu.Unlock()
	affStore.commissions[comm.ID] = comm

	return comm
}

// Get affiliate earnings
func GetEarnings(affiliateID string) float64 {
	affStore.mu.RLock()
	defer affStore.mu.RUnlock()

	var total float64
	for _, c := range affStore.commissions {
		if c.AffiliateID == affiliateID {
			total += c.Amount
		}
	}
	return total
}

func main() {
	fmt.Println("Affiliate service initialized")

	// Register
	aff := RegisterAffiliate("user_001", "gold", 0.30)
	fmt.Printf("Registered: %s (%s tier, %.0f%% share)\n", aff.UserID, aff.Tier, aff.FeeShare*100)

	// Add clients
	c1 := AddClient(aff.ID, "client_001")
	c2 := AddClient(aff.ID, "client_002")
	fmt.Printf("Clients: %d referred\n", 2)

	// Commission
	comm := TrackCommission(aff.ID, "client_001", "trade_fee", 1000)
	if comm != nil {
		fmt.Printf("Commission: $%.2f\n", comm.Amount)
	}

	// Earnings
	earnings := GetEarnings(aff.ID)
	fmt.Printf("Total earnings: $%.2f\n", earnings)
}