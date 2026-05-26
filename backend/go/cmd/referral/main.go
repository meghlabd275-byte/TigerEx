// Package referral provides referral program services.
// Multi-tier referral system with commissions.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Referral Tier
type ReferralTier struct {
	Tier     int     `json:"tier"`
	Name    string  `json:"name"` // bronze, silver, gold, platinum
	ReqTrade float64 `json:"reqTrade"` // monthly requirement
	CommShare float64 `json:"commShare"` // commission share %
}

// Referral Link
type ReferralLink struct {
	Code      string `json:"code"`
	ReferrerID string `json:"referrerId"`
	CreatedAt int64  `json:"createdAt"`
	Clicks   int    `json:"clicks"`
	Joined  int    `json:"joined"`
}

// Referral Reward
type ReferralReward struct {
	ID        string  `json:"id"`
	ReferrerID string  `json:"referrerId"`
	RefereeID string  `json:"refereeId"`
	Amount   float64 `json:"amount"`
	Type    string  `json:"type"` // rebate, commission
	Paid     bool   `json:"paid"`
}

// Store
type ReferralStore struct {
	mu      sync.RWMutex
	tiers   map[int]*ReferralTier
	links   map[string]*ReferralLink
	rewards map[string]*ReferralReward
}

var refStore = &ReferralStore{
	tiers: make(map[int]*ReferralTier),
	links: make(map[string]*ReferralLink),
	rewards: make(map[string]*ReferralReward),
}

func init() {
	tiers := []*ReferralTier{
		{Tier: 1, Name: "bronze", ReqTrade: 0, CommShare: 10},
		{Tier: 2, Name: "silver", ReqTrade: 10000, CommShare: 15},
		{Tier: 3, Name: "gold", ReqTrade: 100000, CommShare: 20},
		{Tier: 4, Name: "platinum", ReqTrade: 1000000, CommShare: 30},
	}

	refStore.mu.Lock()
	for _, t := range tiers {
		refStore.tiers[t.Tier] = t
	}
	refStore.mu.Unlock()
}

// Create referral code
func CreateReferralCode(referrerID string) *ReferralLink {
	code := generateCode(referrerID)

	link := &ReferralLink{
		Code: code,
		ReferrerID: referrerID,
		CreatedAt: time.Now().UnixMilli(),
		Clicks: 0,
		Joined: 0,
	}

	refStore.mu.Lock()
	refStore.links[code] = link
	refStore.mu.Unlock()

	return link
}

// Track click
func TrackClick(code string) {
	refStore.mu.RLock()
	link, ok := refStore.links[code]
	refStore.mu.RUnlock()

	if ok {
		refStore.mu.Lock()
		link.Clicks++
		refStore.mu.Unlock()
	}
}

// Register referee
func RegisterReferee(code, refereeID string) error {
	refStore.mu.RLock()
	link, ok := refStore.links[code]
	refStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("invalid referral code")
	}

	refStore.mu.Lock()
	link.Joined++
	refStore.mu.Unlock()

	return nil
}

// Calculate commission
func CalculateCommission(referrerID string, tradeAmount float64) (float64, error) {
	tier := getTier(referrerID)
	if tier == nil {
		return 0, fmt.Errorf("referrer not found")
	}

	return tradeAmount * tier.CommShare / 100, nil
}

// Credit reward
func CreditReward(referrerID, refereeID string, amount float64, rtype string) *ReferralReward {
	reward := &ReferralReward{
		ID: fmt.Sprintf("rew_%d", time.Now().UnixNano()),
		ReferrerID: referrerID,
		RefereeID: refereeID,
		Amount: amount,
		Type: rtype,
		Paid: false,
	}

	refStore.mu.Lock()
	refStore.rewards[reward.ID] = reward
	refStore.mu.Unlock()

	return reward
}

// Mark paid
func MarkPaid(rewardID string) error {
	refStore.mu.RLock()
	reward, ok := refStore.rewards[rewardID]
	refStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("reward not found")
	}

	refStore.mu.Lock()
	reward.Paid = true
	refStore.mu.Unlock()

	return nil
}

// Get referrer stats
func GetReferrerStats(referrerID string) (int, float64) {
	refStore.mu.RLock()
	defer refStore.mu.RUnlock()

	var totalReferred int
	var totalPaid float64

	for _, link := range refStore.links {
		if link.ReferrerID == referrerID {
			totalReferred = link.Joined
		}
	}

	for _, reward := range refStore.rewards {
		if reward.ReferrerID == referrerID && reward.Paid {
			totalPaid += reward.Amount
		}
	}

	return totalReferred, totalPaid
}

func generateCode(refID string) string {
	return fmt.Sprintf("REF%s%d", refID[:4], time.Now().UnixNano())
}

func getTier(referrerID string) *ReferralTier {
	// Simplified - return max tier
	if tier, ok := refStore.tiers[3]; ok {
		return tier
	}
	return refStore.tiers[1]
}

func main() {
	fmt.Println("Referral service initialized")

	// Create code
	link, _ := CreateReferralCode("user1")
	fmt.Printf("Referral code: %s\n", link.Code)

	// Track click
	TrackClick(link.Code)

	// Calculate commission
	comm, _ := CalculateCommission("user1", 10000)
	fmt.Printf("Commission: $%.2f\n", comm)
}