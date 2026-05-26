// Package copytrade provides copy trading services.
// Migrated from TypeScript to Go for social trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Trader profile
type TraderProfile struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Copy       bool    `json:"copy"` // allow copying
	PnL        float64 `json:"pnl"` // profit
	WinRate    float64 `json:"winRate"` // %
	Followers   int    `json:"followers"`
	AUM        float64 `json:"aum"` // Assets under management
}

// Copy position
type CopyPosition struct {
	ID        string  `json:"id"`
	MasterID string  `json:"masterId"`
	FollowerID string `json:"followerId"`
	CopyRatio float64 `json:"copyRatio"` // 0.1 - 10x
	Amount   float64 `json:"amount"`
	Status   string  `json:"status"` // active, paused
}

// Copied order
type CopiedOrder struct {
	ID         string  `json:"id"`
	MasterOrderID string `json:"masterOrderId"`
	FollowerID string `json:"followerId"`
	MasterAmount float64 `json:"masterAmount"`
	CopiedAmount float64 `json:"copiedAmount"`
	Status    string  `json:"status"` // copied, rejected
	Timestamp int64  `json:"timestamp"`
}

// Store
type CopyTradeStore struct {
	mu           sync.RWMutex
	profiles     map[string]*TraderProfile
	copyPositions map[string]*CopyPosition
	copiedOrders map[string][]*CopiedOrder
}

var (
	ctStore = &CopyTradeStore{
		profiles: make(map[string]*TraderProfile),
		copyPositions: make(map[string]*CopyPosition),
		copiedOrders: make(map[string][]*CopiedOrder),
	}
)

// Enable copy trading
func EnableCopyTrading(userID string) *TraderProfile {
	profile := &TraderProfile{
		ID:       fmt.Sprintf("tp_%d", time.Now().UnixNano()),
		UserID:   userID,
		Copy:    true,
		PnL:     0,
		WinRate:  0,
		Followers: 0,
		AUM:     0,
	}

	ctStore.mu.Lock()
	defer ctStore.mu.Unlock()
	ctStore.profiles[userID] = profile

	return profile
}

// Follow trader
func Follow(masterID, followerID string, copyRatio float64, amount float64) (*CopyPosition, error) {
	if copyRatio < 0.1 || copyRatio > 10 {
		return nil, fmt.Errorf("copy ratio must be 0.1 - 10x")
	}

	position := &CopyPosition{
		ID:         fmt.Sprintf("cp_%d", time.Now().UnixNano()),
		MasterID:   masterID,
		FollowerID: followerID,
		CopyRatio:  copyRatio,
		Amount:    amount,
		Status:    "active",
	}

	ctStore.mu.Lock()
	defer ctStore.mu.Unlock()
	ctStore.copyPositions[position.ID] = position

	// Update follower count
	if profile, ok := ctStore.profiles[masterID]; ok {
		profile.Followers++
		profile.AUM += amount
	}

	return position, nil
}

// Unfollow
func Unfollow(positionID string) error {
	ctStore.mu.Lock()
	defer ctStore.mu.Unlock()

	pos, ok := ctStore.copyPositions[positionID]
	if !ok {
		return fmt.Errorf("position not found")
	}

	masterID := pos.MasterID
	amount := pos.Amount

	delete(ctStore.copyPositions, positionID)

	// Update follower count
	if profile, ok := ctStore.profiles[masterID]; ok {
		profile.Followers--
		profile.AUM -= amount
	}

	return nil
}

// Copy order from master
func CopyOrder(masterOrderID, masterID, followerID string, masterAmount float64) *CopiedOrder {
	ctStore.mu.RLock()
	
	// Find follower's position with this master
	var position *CopyPosition
	for _, p := range ctStore.copyPositions {
		if p.MasterID == masterID && p.FollowerID == followerID && p.Status == "active" {
			position = p
			break
		}
	}
	
	ctStore.mu.RUnlock()
	
	if position == nil {
		return nil
	}

	copiedAmount := masterAmount * position.CopyRatio

	order := &CopiedOrder{
		ID:           fmt.Sprintf("co_%d", time.Now().UnixNano()),
		MasterOrderID: masterOrderID,
		FollowerID:  followerID,
		MasterAmount: masterAmount,
		CopiedAmount: copiedAmount,
		Status:     "copied",
		Timestamp:  time.Now().UnixMilli(),
	}

	ctStore.mu.Lock()
	defer ctStore.mu.Unlock()
	ctStore.copiedOrders[followerID] = append(ctStore.copiedOrders[followerID], order)

	return order
}

// Get top traders
func GetTopTraders(limit int) []*TraderProfile {
	ctStore.mu.RLock()
	defer ctStore.mu.RUnlock()

	profiles := make([]*TraderProfile, 0, len(ctStore.profiles))
	for _, p := range ctStore.profiles {
		if p.Copy && p.Followers > 0 {
			profiles = append(profiles, p)
		}
	}

	// Sort by PnL (simple bubble)
	for i := 0; i < len(profiles)-1; i++ {
		for j := i + 1; j < len(profiles); j++ {
			if profiles[j].PnL > profiles[i].PnL {
				profiles[i], profiles[j] = profiles[j], profiles[i]
			}
		}
	}

	if len(profiles) > limit {
		profiles = profiles[:limit]
	}

	return profiles
}

func main() {
	fmt.Println("Copy Trade service initialized")

	// Enable copy
	profile := EnableCopyTrading("master_001")
	fmt.Printf("Enabled copy trading: %s\n", profile.UserID)

	// Follow
	position, err := Follow("master_001", "follower_001", 1.0, 1000)
	if err != nil {
		fmt.Printf("Follow error: %v\n", err)
	} else {
		fmt.Printf("Following master at %.1fx ratio\n", position.CopyRatio)
	}

	// Copy order
	order := CopyOrder("mo_001", "master_001", "follower_001", 100)
	if order != nil {
		fmt.Printf("Copied: %.2f (from %.2f)\n", order.CopiedAmount, order.MasterAmount)
	}
}