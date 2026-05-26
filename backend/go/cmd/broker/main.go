// Package broker provides broker services.
// Migrated from TypeScript to Go for broker integrations.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Broker
type Broker struct {
	ID       string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"` // prime, retail, affiliate
	Status  string `json:"status"` // active, inactive
	FeeDiscount float64 `json:"feeDiscount"`
}

// Client referral
type Referral struct {
	ID         string  `json:"id"`
	ReferrerID string  `json:"referrerId"`
	RefereeID  string  `json:"refereeId"`
	Reward    float64 `json:"reward"`
	Status    string  `json:"status"` // pending, active
}

// Commission
type Commission struct {
	BrokerID  string  `json:"brokerId"`
	UserID    string  `json:"userId"`
	FeeShare  float64 `json:"feeShare"` // % of fees
	Volume   float64 `json:"volume"`
	Earned    float64 `json:"earned"`
}

// Store
type BrokerStore struct {
	mu         sync.RWMutex
	brokers    map[string]*Broker
	referrals  map[string]*Referral
	commissions map[string]*Commission
}

var (
	brokerStore = &BrokerStore{
		brokers: make(map[string]*Broker),
		referrals: make(map[string]*Referral),
		commissions: make(map[string]*Commission),
	}
)

// Initialize brokers
func init() {
	brokers := []*Broker{
		{ID: "prime_1", Name: "Prime Broker", Type: "prime", Status: "active", FeeDiscount: 0.5},
		{ID: "retail_1", Name: "Retail Partner", Type: "retail", Status: "active", FeeDiscount: 0.2},
		{ID: "affiliate_1", Name: "Affiliate Network", Type: "affiliate", Status: "active", FeeDiscount: 0.3},
	}

	brokerStore.mu.Lock()
	defer brokerStore.mu.Unlock()

	for _, b := range brokers {
		brokerStore.brokers[b.ID] = b
	}
}

// Register referral
func RegisterReferral(referrerID, refereeID string, reward float64) *Referral {
	referral := &Referral{
		ID: fmt.Sprintf("ref_%d", time.Now().UnixNano()),
		ReferrerID: referrerID,
		RefereeID: refereeID,
		Reward: reward,
		Status: "pending",
	}

	brokerStore.mu.Lock()
	defer brokerStore.mu.Unlock()
	brokerStore.referrals[referral.ID] = referral

	return referral
}

// Activate referral (first trade made)
func ActivateReferral(referralID string) error {
	brokerStore.mu.Lock()
	defer brokerStore.mu.Unlock()

	referral, ok := brokerStore.referrals[referralID]
	if !ok {
		return fmt.Errorf("referral not found")
	}

	referral.Status = "active"
	return nil
}

// Track commission
func TrackCommission(brokerID, userID string, feeAmount float64) error {
	brokerStore.mu.Lock()
	defer brokerStore.mu.Unlock()

	broker, ok := brokerStore.brokers[brokerID]
	if !ok {
		return fmt.Errorf("broker not found")
	}

	key := fmt.Sprintf("%s_%s", brokerID, userID)
	commission, ok := brokerStore.commissions[key]
	if !ok {
		commission = &Commission{
			BrokerID: brokerID,
			UserID: userID,
			FeeShare: 0.30, // 30% of fees to broker
			Volume: 0,
			Earned: 0,
		}
		brokerStore.commissions[key] = commission
	}

	commission.Earned += feeAmount * commission.FeeShare
	commission.Volume += feeAmount

	return nil
}

func main() {
	fmt.Println("Broker service initialized")

	// Referrals
	ref := RegisterReferral("user_001", "user_002", 50)
	fmt.Printf("Referral: %s -> %s, reward $%.2f\n", ref.ReferrerID, ref.RefereeID, ref.Reward)

	ActivateReferral(ref.ID)
	fmt.Printf("Referral activated\n")

	// Commission
	TrackCommission("affiliate_1", "user_001", 100)
	key := "affiliate_1_user_001"
	comm, _ := brokerStore.commissions[key]
	fmt.Printf("Commission earned: $%.2f\n", comm.Earned)
}