// Package loyalty provides loyalty rewards program.
// Migrated from TypeScript to Go for loyalty points.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Loyalty tier
type LoyaltyTier struct {
	Level      int     `json:"level"`
	Name       string  `json:"name"`
	MinPoints  int     `json:"minPoints"`
	Cashback   float64 `json:"cashback"` // %
	FeeDiscount float64 `json:"feeDiscount"` // %
}

// Points transaction
type PointsTransaction struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Type     string  `json:"type"` // earned, redeemed, expired
	Points   int     `json:"points"`
	Reason   string  `json:"reason"`
	Timestamp int64  `json:"timestamp"`
}

// User loyalty profile
type LoyaltyProfile struct {
	UserID      string  `json:"userId"`
	TotalPoints int    `json:"totalPoints"`
	CurrentPoints int `json:"currentPoints"`
	TierLevel  int    `json:"tierLevel"`
	LifetimeValue float64 `json:"lifetimeValue"`
}

// Store
type LoyaltyStore struct {
	mu        sync.RWMutex
	tiers     []*LoyaltyTier
	profiles  map[string]*LoyaltyProfile
	transactions map[string][]*PointsTransaction
}

var (
	loyaltyStore = &LoyaltyStore{
		tiers: []*LoyaltyTier{
			{Level: 0, Name: "Bronze", MinPoints: 0, Cashback: 0.1, FeeDiscount: 0},
			{Level: 1, Name: "Silver", MinPoints: 1000, Cashback: 0.2, FeeDiscount: 5},
			{Level: 2, Name: "Gold", MinPoints: 10000, Cashback: 0.3, FeeDiscount: 10},
			{Level: 3, Name: "Platinum", MinPoints: 100000, Cashback: 0.5, FeeDiscount: 20},
			{Level: 4, Name: "Diamond", MinPoints: 1000000, Cashback: 1.0, FeeDiscount: 50},
		},
		profiles: make(map[string]*LoyaltyProfile),
		transactions: make(map[string][]*PointsTransaction),
	}
)

// Get or create profile
func GetProfile(userID string) *LoyaltyProfile {
	loyaltyStore.mu.Lock()
	defer loyaltyStore.mu.Unlock()

	profile, ok := loyaltyStore.profiles[userID]
	if !ok {
		profile = &LoyaltyProfile{
			UserID:      userID,
			TotalPoints: 0,
			CurrentPoints: 0,
			TierLevel:  0,
			LifetimeValue: 0,
		}
		loyaltyStore.profiles[userID] = profile
	}

	return profile
}

// Earn points
func EarnPoints(userID string, points int, reason string) *PointsTransaction {
	profile := GetProfile(userID)

	tx := &PointsTransaction{
		ID:        fmt.Sprintf("tx_%d", time.Now().UnixNano()),
		UserID:   userID,
		Type:     "earned",
		Points:   points,
		Reason:   reason,
		Timestamp: time.Now().UnixMilli(),
	}

	loyaltyStore.mu.Lock()
	defer loyaltyStore.mu.Unlock()

	profile.TotalPoints += points
	profile.CurrentPoints += points
	updateTier(profile)

	loyaltyStore.transactions[userID] = append(loyaltyStore.transactions[userID], tx)

	return tx
}

// Redeem points
func RedeemPoints(userID string, points int, reason string) error {
	profile := GetProfile(userID)

	if profile.CurrentPoints < points {
		return fmt.Errorf("insufficient points")
	}

	tx := &PointsTransaction{
		ID:        fmt.Sprintf("tx_%d", time.Now().UnixNano()),
		UserID:   userID,
		Type:     "redeemed",
		Points:   -points,
		Reason:   reason,
		Timestamp: time.Now().UnixMilli(),
	}

	loyaltyStore.mu.Lock()
	defer loyaltyStore.mu.Unlock()

	profile.CurrentPoints -= points
	loyaltyStore.transactions[userID] = append(loyaltyStore.transactions[userID], tx)

	return nil
}

// Update tier based on points
func updateTier(profile *LoyaltyProfile) {
	for _, tier := range loyaltyStore.tiers {
		if profile.TotalPoints >= tier.MinPoints {
			profile.TierLevel = tier.Level
		}
	}
}

// Get tier benefits
func GetTierBenefits(userID string) map[string]interface{} {
	profile := GetProfile(userID)

	tier := loyaltyStore.tiers[profile.TierLevel]

	return map[string]interface{}{
		"tier":     tier.Name,
		"cashback": tier.Cashback,
		"discount": tier.FeeDiscount,
		"points":   profile.CurrentPoints,
	}
}

// Calculate cashback
func CalculateCashback(userID string, amount float64) float64 {
	profile := GetProfile(userID)
	tier := loyaltyStore.tiers[profile.TierLevel]
	return amount * tier.Cashback / 100
}

func main() {
	fmt.Println("Loyalty service initialized")

	// Earn points demo
	tx := EarnPoints("user_001", 500, "Trade bonus")
	fmt.Printf("Earned: %d points (%s)\n", tx.Points, tx.Reason)

	// Get profile
	profile := GetProfile("user_001")
	fmt.Printf("Profile: %d points, Tier: Level %d\n", 
		profile.CurrentPoints, profile.TierLevel)

	// Benefits
	benefits := GetTierBenefits("user_001")
	fmt.Printf("Benefits: %+v\n", benefits)
}