package main

import (
	"fmt"
	"time"
)

// Referral tier
type ReferralTier struct {
	Level                int     `json:"level"`
	Name                 string `json:"name"`
	ReferralRewardPercent float64 `json:"referralRewardPercent"`
	RewardSoulboundToken bool   `json:"rewardSoulboundToken"`
	RequiredReferrals    int    `json:"requiredReferrals"`
	RequiredVolume      float64 `json:"requiredVolume"`
	Badge                string `json:"badge"`
}

// Referral status
type ReferralStatus string

const (
	ReferralPending   ReferralStatus = "pending"
	ReferralActive    ReferralStatus = "active"
	ReferralCompleted ReferralStatus = "completed"
	ReferralCancelled ReferralStatus = "cancelled"
)

// Referral
type Referral struct {
	ID            string         `json:"id"`
	ReferrerID    string         `json:"referrerId"`
	RefereeID    string         `json:"refereeId"`
	ReferrerCode string         `json:"referrerCode"`
	RefereeCode string         `json:"refereeCode"`
	Status       ReferralStatus `json:"status"`
	RegisteredAt int64          `json:"registeredAt"`
	CompletedAt *int64        `json:"completedAt,omitempty"`
	RewardPaid  float64        `json:"rewardPaid"`
}

// Reward type
type RewardType string

const (
	RewardReferral RewardType = "referral"
	RewardTrade   RewardType = "trade"
	RewardDeposit RewardType = "deposit"
	RewardVolume RewardType = "volume"
	RewardBadge  RewardType = "badge"
)

// Reward record
type RewardRecord struct {
	ID         string      `json:"id"`
	UserID    string      `json:"userId"`
	Type      RewardType  `json:"type"`
	Amount    float64    `json:"amount"`
	Currency  string     `json:"currency"`
	Timestamp int64       `json:"timestamp"`
	LockedUntil *int64  `json:"lockedUntil,omitempty"`
}

// Leaderboard entry
type LeaderboardEntry struct {
	Rank         int     `json:"rank"`
	UserID       string  `json:"userId"`
	TotalReferrals int    `json:"totalReferrals"`
	TotalVolume  float64 `json:"totalVolume"`
	TotalRewards float64 `json:"totalRewards"`
}

// Referral manager
type ReferralManager struct {
	Referrals      map[string]*Referral
	UserCodes     map[string]string
	Rewards      map[string][]*RewardRecord
	Tiers        []ReferralTier
}

// New creates manager
func NewReferralManager() *ReferralManager {
	return &ReferralManager{
		Referrals: make(map[string]*Referral),
		UserCodes: make(map[string]string),
		Rewards: make(map[string][]*RewardRecord),
		Tiers: []ReferralTier{
			{Level: 1, Name: "Bronze", ReferralRewardPercent: 0.10, RequiredReferrals: 0, RequiredVolume: 0},
			{Level: 2, Name: "Silver", ReferralRewardPercent: 0.15, RequiredReferrals: 5, RequiredVolume: 10000},
			{Level: 3, Name: "Gold", ReferralRewardPercent: 0.20, RequiredReferrals: 20, RequiredVolume: 100000},
			{Level: 4, Name: "Platinum", ReferralRewardPercent: 0.25, RequiredReferrals: 50, RequiredVolume: 500000},
			{Level: 5, Name: "Diamond", ReferralRewardPercent: 0.30, RequiredReferrals: 100, RequiredVolume: 1000000},
		},
	}
}

// Generate referral code
func (m *ReferralManager) GenerateCode(userID string) string {
	code := fmt.Sprintf("REF%d%s", time.Now().Unix(), userID[:4])
	m.UserCodes[userID] = code
	return code
}

// Create referral
func (m *ReferralManager) CreateReferral(referrerID, refereeID string) *Referral {
	referrerCode := m.UserCodes[referrerID]
	if referrerCode == "" {
		referrerCode = m.GenerateCode(referrerID)
	}
	refereeCode := m.GenerateCode(refereeID)
	
	ref := &Referral{
		ID: fmt.Sprintf("ref_%d", time.Now().UnixNano()),
		ReferrerID: referrerID,
		RefereeID: refereeID,
		ReferrerCode: referrerCode,
		RefereeCode: refereeCode,
		Status: ReferralPending,
		RegisteredAt: time.Now().UnixMilli(),
	}
	
	m.Referrals[ref.ID] = ref
	return ref
}

// Complete referral (when referee trades)
func (m *ReferralManager) CompleteReferral(refID string) bool {
	ref, ok := m.Referrals[refID]
	if !ok {
		return false
	}
	
	now := time.Now().UnixMilli()
	ref.Status = ReferralCompleted
	ref.CompletedAt = &now
	ref.RewardPaid = 10.0 // Default reward
	
	return true
}

// Award reward
func (m *ReferralManager) AwardReward(userID string, rewardType RewardType, amount float64) {
	record := &RewardRecord{
		ID: fmt.Sprintf("reward_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: rewardType,
		Amount: amount,
		Currency: "USDT",
		Timestamp: time.Now().UnixMilli(),
	}
	
	m.Rewards[userID] = append(m.Rewards[userID], record)
}

// Get leaderboard
func (m *ReferralManager) GetLeaderboard(limit int) []LeaderboardEntry {
	var entries []LeaderboardEntry
	counts := make(map[string]int)
	
	for _, ref := range m.Referrals {
		if ref.Status == ReferralCompleted {
			counts[ref.ReferrerID]++
		}
	}
	
	for userID, count := range counts {
		entries = append(entries, LeaderboardEntry{
			Rank: 0,
			UserID: userID,
			TotalReferrals: count,
		})
	}
	
	// Sort by referrals
	for i := 0; i < len(entries)-1; i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[j].TotalReferrals > entries[i].TotalReferrals {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
	
	// Set ranks
	for i := range entries {
		entries[i].Rank = i + 1
	}
	
	if limit > 0 && len(entries) > limit {
		entries = entries[:limit]
	}
	
	return entries
}

// Get tier info
func (m *ReferralManager) GetTier(referrerID string) *ReferralTier {
	count := 0
	for _, ref := range m.Referrals {
		if ref.ReferrerID == referrerID && ref.Status == ReferralCompleted {
			count++
		}
	}
	
	for _, tier := range m.Tiers {
		if count >= tier.RequiredReferrals {
			return &tier
		}
	}
	
	return &m.Tiers[0]
}

func main() {
	mgr := NewReferralManager()
	
	// Generate codes
	code := mgr.GenerateCode("user1")
	fmt.Printf("Referral code: %s\n", code)
	
	// Create referral
	ref := mgr.CreateReferral("user1", "user2")
	fmt.Printf("Referral: %s\n", ref.ID)
	
	// Complete
	mgr.CompleteReferral(ref.ID)
	fmt.Printf("Completed: %s\n", ref.Status)
	
	// Award reward
	mgr.AwardReward("user1", RewardReferral, 10.0)
	
	// Get tier
	tier := mgr.GetTier("user1")
	fmt.Printf("Tier: %s - %.0f%%\n", tier.Name, tier.ReferralRewardPercent*100)
}