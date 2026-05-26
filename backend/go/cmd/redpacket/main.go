// Package redpacket provides promotional red packet events.
// Migrated from TypeScript to Go for marketing campaigns.
package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// Red packet campaign
type RedPacketCampaign struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Token      string  `json:"token"`
	Amount    float64 `json:"amount"`
	Quantity  int     `json:"quantity"` // number of packets
	Spent      int     `json:"spent"`
	Status    string  `json:"status"` // active, ended
	StartedAt int64   `json:"startedAt"`
	EndsAt    int64   `json:"endsAt"`
	Type      string  `json:"type"` // random, fixed, lucky
}

// Red packet claim
type RedPacketClaim struct {
	ID        string  `json:"id"`
	CampaignID string `json:"campaignId"`
	UserID    string  `json:"userId"`
	Amount    float64 `json:"amount"`
	ClaimedAt int64   `json:"claimedAt"`
}

// Store
type RedPacketStore struct {
	mu         sync.RWMutex
	campaigns map[string]*RedPacketCampaign
	claims   map[string][]*RedPacketClaim
}

var (
	rpStore = &RedPacketStore{
		campaigns: make(map[string]*RedPacketCampaign),
		claims:   make(map[string][]*RedPacketClaim),
	}
)

// Create campaign
func CreateCampaign(name, token string, amount float64, quantity int, durationHours int, packetType string) *RedPacketCampaign {
	id := fmt.Sprintf("rp_%d", time.Now().UnixNano())

	campaign := &RedPacketCampaign{
		ID:         id,
		Name:      name,
		Token:     token,
		Amount:    amount,
		Quantity:  quantity,
		Spent:     0,
		Status:   "active",
		StartedAt: time.Now().UnixMilli(),
		EndsAt:   time.Now().UnixMilli() + int64(durationHours*3600000),
		Type:      packetType,
	}

	rpStore.mu.Lock()
	defer rpStore.mu.Unlock()
	rpStore.campaigns[id] = campaign

	return campaign
}

// Claim red packet
func Claim(campaignID, userID string) (*RedPacketClaim, error) {
	rpStore.mu.Lock()
	defer rpStore.mu.Unlock()

	campaign, ok := rpStore.campaigns[campaignID]
	if !ok {
		return nil, fmt.Errorf("campaign not found")
	}

	if campaign.Status != "active" {
		return nil, fmt.Errorf("campaign not active")
	}

	if campaign.Spent >= campaign.Quantity {
		return nil, fmt.Errorf("no packets remaining")
	}

	now := time.Now().UnixMilli()
	if now > campaign.EndsAt {
		return nil, fmt.Errorf("campaign ended")
	}

	// Check if already claimed
	for _, claims := range rpStore.claims {
		for _, c := range claims {
			if c.UserID == userID && c.CampaignID == campaignID {
				return nil, fmt.Errorf("already claimed")
			}
		}
	}

	// Calculate amount based on type
	var amount float64
	switch campaign.Type {
	case "random":
		// Random distribution
		avgAmount := campaign.Amount / float64(campaign.Quantity)
		amount = avgAmount * (0.5 + rand.Float64()) // 50%-150% of average
	case "fixed":
		amount = campaign.Amount / float64(campaign.Quantity)
	case "lucky":
		// One lucky winner gets big amount
		if rand.Float64() < 0.01 { // 1% chance
			amount = campaign.Amount * 0.5 // 50% to one person
		} else {
			amount = campaign.Amount / float64(campaign.Quantity) * 0.1
		}
	}

	claim := &RedPacketClaim{
		ID:         fmt.Sprintf("claim_%d", now),
		CampaignID: campaignID,
		UserID:     userID,
		Amount:     amount,
		ClaimedAt:  now,
	}

	rpStore.claims[campaignID] = append(rpStore.claims[campaignID], claim)
	campaign.Spent++

	return claim, nil
}

// Get campaign status
func GetCampaignStatus(campaignID string) (map[string]interface{}, error) {
	rpStore.mu.RLock()
	defer rpStore.mu.RUnlock()

	campaign, ok := rpStore.campaigns[campaignID]
	if !ok {
		return nil, fmt.Errorf("campaign not found")
	}

	return map[string]interface{}{
		"name":         campaign.Name,
		"remaining":    campaign.Quantity - campaign.Spent,
		"participants": campaign.Spent,
		"status":      campaign.Status,
	}, nil
}

func main() {
	fmt.Println("Red Packet service initialized")

	// Demo campaign
	campaign := CreateCampaign("New Year 2024", "USDT", 10000, 1000, 24, "random")
	fmt.Printf("Created campaign: %s - %s (%d packets)\n", campaign.ID, campaign.Name, campaign.Quantity)

	// Demo claim
	claim, err := Claim(campaign.ID, "user_001")
	if err != nil {
		fmt.Printf("Claim error: %v\n", err)
	} else {
		fmt.Printf("Claimed: %.2f %s\n", claim.Amount, "USDT")
	}
}