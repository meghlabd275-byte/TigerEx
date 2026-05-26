// Package copy_trading provides copy trading services.
// Follow professional traders.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Master Trader
type MasterTrader struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Name       string  `json:"name"`
	Followers int     `json:"followers"`
	AUM        float64 `json:"aum"` // assets under management
	WinRate   float64 `json:"winRate"`
	Performance float64 `json:"performance"` // 30d return
	Status    string  `json:"status"` // active, paused
}

// Copy Position
type CopyPosition struct {
	ID         string  `json:"id"`
	MasterID   string  `json:"masterId"`
	FollowerID string  `json:"followerId"`
	Symbol    string  `json:"symbol"`
	Side      string  `json:"side"`
	Size      float64 `json:"size"`
	EntryPrice float64 `json:"entryPrice"`
	PnL       float64 `json:"pnl"`
	Status    string  `json:"status"` // open, closed
}

// Follower Config
type FollowerConfig struct {
	FollowerID string  `json:"followerId"`
	MasterID string  `json:"masterId"`
	Allocation float64 `json:"allocation"` // max capital per trade
	CopyRatio float64 `json:"copyRatio"` // % of master size
	StopLoss float64 `json:"stopLoss"` // max loss %
	Mode     string  `json:"mode"` // mirror, proportional
}

// Store
type CTStore struct {
	mu       sync.RWMutex
	masters  map[string]*MasterTrader
	positions map[string]*CopyPosition
	configs  map[string]*FollowerConfig
}

var ctStore = &CTStore{
	masters: make(map[string]*MasterTrader),
	positions: make(map[string]*CopyPosition),
	configs: make(map[string]*FollowerConfig),
}

// Register master
func RegisterMaster(userID, name string) *MasterTrader {
	master := &MasterTrader{
		ID: fmt.Sprintf("master_%d", time.Now().UnixNano()),
		UserID: userID,
		Name: name,
		Followers: 0,
		AUM: 0,
		WinRate: 0,
		Performance: 0,
		Status: "active",
	}

	ctStore.mu.Lock()
	ctStore.masters[master.ID] = master
	ctStore.mu.Unlock()

	return master
}

// Follow master
func FollowMaster(followerID, masterID string, allocation, copyRatio, stopLoss float64, mode string) error {
	ctStore.mu.RLock()
	_, ok := ctStore.masters[masterID]
	ctStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("master not found")
	}

	config := &FollowerConfig{
		FollowerID: followerID,
		MasterID: masterID,
		Allocation: allocation,
		CopyRatio: copyRatio,
		StopLoss: stopLoss,
		Mode: mode,
	}

	ctStore.mu.Lock()
	ctStore.configs[followerID] = config
	ctStore.mu.Unlock()

	return nil
}

// Copy order
func CopyOrder(masterID, followerID, symbol, side string, size, price float64) *CopyPosition {
	pos := &CopyPosition{
		ID: fmt.Sprintf("cp_%d", time.Now().UnixNano()),
		MasterID: masterID,
		FollowerID: followerID,
		Symbol: symbol,
		Side: side,
		Size: size,
		EntryPrice: price,
		PnL: 0,
		Status: "open",
	}

	ctStore.mu.Lock()
	ctStore.positions[pos.ID] = pos
	ctStore.mu.Unlock()

	return pos
}

// Update PnL
func UpdatePnL(positionID string, currentPrice float64) {
	ctStore.mu.RLock()
	pos, ok := ctStore.positions[positionID]
	ctStore.mu.RUnlock()

	if !ok {
		return
	}

	var pnl float64
	if pos.Size > 0 {
		if pos.Side == "buy" {
			pnl = (currentPrice - pos.EntryPrice) * pos.Size
		} else {
			pnl = (pos.EntryPrice - currentPrice) * pos.Size
		}
	}

	ctStore.mu.Lock()
	pos.PnL = pnl
	ctStore.mu.Unlock()
}

// Close position
func ClosePosition(positionID string, closePrice float64) error {
	ctStore.mu.RLock()
	pos, ok := ctStore.positions[positionID]
	ctStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("position not found")
	}

	UpdatePnL(positionID, closePrice)

	ctStore.mu.Lock()
	pos.Status = "closed"
	ctStore.mu.Unlock()

	return nil
}

// Get masters
func GetMasters() []*MasterTrader {
	ctStore.mu.RLock()
	defer ctStore.mu.RUnlock()

	var result []*MasterTrader
	for _, m := range ctStore.masters {
		result = append(result, m)
	}

	return result
}

func main() {
	fmt.Println("Copy Trading service initialized")

	// Register master
	master := RegisterMaster("trader1", "Pro Trader")
	fmt.Printf("Master: %s (%s)\n", master.ID, master.Name)

	// Follow
	err := FollowMaster("user1", master.ID, 10000, 1.0, 0.1, "mirror")
	if err == nil {
		fmt.Println("Following master")
	}

	// Copy order
	pos := CopyOrder(master.ID, "user1", "BTCUSDT", "buy", 0.1, 65000)
	fmt.Printf("Copied: %s\n", pos.ID)
}