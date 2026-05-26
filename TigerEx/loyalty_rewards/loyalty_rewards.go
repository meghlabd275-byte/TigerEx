package main

import (
	"fmt"
	"time"
)

// Tier level
type TierLevel string

const (
	TierBronze TierLevel = "bronze"
	TierSilver TierLevel = "silver"
	TierGold TierLevel = "gold"
	TierPlatinum TierLevel = "platinum"
	TierDiamond TierLevel = "diamond"
)

// Tier thresholds
var TierThresholds = map[TierLevel]int{
	TierBronze: 0,
	TierSilver: 10000,
	TierGold: 50000,
	TierPlatinum: 200000,
	TierDiamond: 1000000,
}

// Reward tier
var TierBenefits = map[TierLevel][]string{
	TierBronze: {"Basic support"},
	TierSilver: {"Priority support", "Lower fees"},
	TierGold: {"VIP support", "Zero fees", "Higher limits"},
	TierPlatinum: {"Dedicated manager", "Free withdrawals"},
	TierDiamond: {"All benefits", "Exclusive events"},
}

// Reward
type Reward struct {
	ID        string  `json:"id"`
	Name    string  `json:"name"`
	Points  int     `json:"points"`
	Category string  `json:"category"`
	Stock   int     `json:"stock"`
}

// User rewards
type UserRewards struct {
	UserID        string    `json:"userId"`
	Points       int       `json:"points"`
	LifetimePoints int     `json:"lifetimePoints"`
	Tier         TierLevel `json:"tier"`
	Benefits     []string  `json:"benefits"`
}

// Loyalty platform
type LoyaltyPlatform struct {
	Users   map[string]*UserRewards
	Rewards map[string]*Reward
}

// New creates platform
func NewLoyaltyPlatform() *LoyaltyPlatform {
	return &LoyaltyPlatform{
		Users: make(map[string]*UserRewards),
		Rewards: make(map[string]*Reward),
	}
}

// Register user
func (p *LoyaltyPlatform) RegisterUser(userID string) {
	p.Users[userID] = &UserRewards{
		UserID: userID,
		Points: 0,
		LifetimePoints: 0,
		Tier: TierBronze,
		Benefits: TierBenefits[TierBronze],
	}
}

// Add points
func (p *LoyaltyPlatform) AddPoints(userID string, points int, description string) {
	user := p.Users[userID]
	if user == nil {
		return
	}
	
	user.Points += points
	user.LifetimePoints += points
	
	// Update tier
	p.updateTier(userID)
}

func (p *LoyaltyPlatform) updateTier(userID string) {
	user := p.Users[userID]
	if user == nil {
		return
	}
	
	lifetime := user.LifetimePoints
	
	newTier := TierBronze
	for tier, threshold := range TierThresholds {
		if lifetime >= threshold {
			newTier = tier
		}
	}
	
	if newTier != user.Tier {
		user.Tier = newTier
		user.Benefits = TierBenefits[newTier]
	}
}

// Get rewards
func (p *LoyaltyPlatform) GetUserRewards(userID string) *UserRewards {
	return p.Users[userID]
}

// List rewards
func (p *LoyaltyPlatform) ListAvailableRewards() []*Reward {
	var result []*Reward
	for _, r := range p.Rewards {
		if r.Stock > 0 {
			result = append(result, r)
		}
	}
	return result
}

func main() {
	platform := NewLoyaltyPlatform()
	
	// Register user
	platform.RegisterUser("user1")
	
	// Add points
	platform.AddPoints("user1", 15000, "Deposit bonus")
	
	// Get user rewards
	user := platform.GetUserRewards("user1")
	fmt.Printf("User: %s\n", user.UserID)
	fmt.Printf("Points: %d, Tier: %s\n", user.Points, user.Tier)
	fmt.Printf("Benefits: %v\n", user.Benefits)
}