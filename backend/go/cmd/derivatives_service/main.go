// Package derivatives_service provides derivatives trading.
// Migrated from TypeScript to Go for futures and options.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Futures contract
type FuturesContract struct {
	ID          string  `json:"id"`
	Symbol      string  `json:"symbol"`
	Underlying  string  `json:"underlying"` // BTC, ETH
	Expiry     string  `json:"expiry"`   // quarterly, perpetual
	MarkPrice  float64 `json:"markPrice"`
	IndexPrice float64 `json:"indexPrice"`
	FundingRate float64 `json:"fundingRate"`
	Status    string  `json:"status"` // active, expired, settled
}

// Futures position
type FuturesPosition struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	ContractID string  `json:"contractId"`
	Side      string  `json:"side"` // long, short
	Size      float64 `json:"size"`
	EntryPrice float64 `json:"entryPrice"`
	Leverage  float64 `json:"leverage"`
	LiqPrice float64 `json:"liqPrice"`
	Status   string  `json:"status"` // open, closed
}

// Option contract
type OptionContract struct {
	ID         string  `json:"id"`
	Underlying string  `json:"underlying"`
	Type      string  `json:"type"` // call, put
	Strike    float64 `json:"strike"`
	Expiry    string  `json:"expiry"`
	Status    string  `json:"status"` // active, exercised, expired
}

// Option position
type OptionPosition struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	ContractID string  `json:"contractId"`
	Type      string  `json:"type"` // long, short
	Contracts float64 `json:"contracts"`
	EntryPrice float64 `json:"entryPrice"`
	Premium  float64 `json:"premium"`
	Status   string  `json:"status"` // open, closed, exercised
}

// Store
type DerivStore struct {
	mu          sync.RWMutex
	futures    map[string]*FuturesContract
	options   map[string]*OptionContract
	fPos      map[string]*FuturesPosition
	oPos      map[string]*OptionPosition
}

var (
	dStore = &DerivStore{
		futures:  make(map[string]*FuturesContract),
		options: make(map[string]*OptionContract),
		fPos:   make(map[string]*FuturesPosition),
		oPos:   make(map[string]*OptionPosition),
	}
)

// Initialize futures contracts
func init() {
	contracts := []*FuturesContract{
		{ID: "BTC-PERP", Symbol: "BTCUSDT", Underlying: "BTC", Expiry: "perpetual", FundingRate: 0.01, Status: "active"},
		{ID: "BTC-2503", Symbol: "BTCUSDT", Underlying: "BTC", Expiry: "2025-03", FundingRate: 0.01, Status: "active"},
		{ID: "ETH-PERP", Symbol: "ETHUSDT", Underlying: "ETH", Expiry: "perpetual", FundingRate: 0.01, Status: "active"},
		{ID: "ETH-2503", Symbol: "ETHUSDT", Underlying: "ETH", Expiry: "2025-03", FundingRate: 0.01, Status: "active"},
	}

	dStore.mu.Lock()
	defer dStore.mu.Unlock()
	for _, c := range contracts {
		dStore.futures[c.ID] = c
	}
}

// Open futures position
func OpenFutures(userID, contractID, side string, size, leverage float64) (*FuturesPosition, error) {
	dStore.mu.Lock()
	defer dStore.mu.Unlock()

	contract, ok := dStore.futures[contractID]
	if !ok {
		return nil, fmt.Errorf("contract not found")
	}

	liqPrice := contract.MarkPrice
	if side == "long" {
		liqPrice *= (1 - 1/leverage)
	} else {
		liqPrice *= (1 + 1/leverage)
	}

	pos := &FuturesPosition{
		ID:        fmt.Sprintf("fpos_%d", time.Now().UnixNano()),
		UserID:    userID,
		ContractID: contractID,
		Side:     side,
		Size:     size,
		EntryPrice: contract.MarkPrice,
		Leverage: leverage,
		LiqPrice: liqPrice,
		Status:   "open",
	}

	dStore.fPos[pos.ID] = pos
	return pos, nil
}

// Close futures position
func CloseFutures(positionID string, closePrice float64) (float64, error) {
	dStore.mu.Lock()
	defer dStore.mu.Unlock()

	pos, ok := dStore.fPos[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}

	// Calculate P&L
	var pnl float64
	if pos.Side == "long" {
		pnl = (closePrice - pos.EntryPrice) * pos.Size
	} else {
		pnl = (pos.EntryPrice - closePrice) * pos.Size
	}

	pos.Status = "closed"
	return pnl, nil
}

// Buy option
func BuyOption(userID, contractID string, contracts float64, premium float64) *OptionPosition {
	dStore.mu.Lock()
	defer dStore.mu.Unlock()

	pos := &OptionPosition{
		ID:         fmt.Sprintf("opos_%d", time.Now().UnixNano()),
		UserID:     userID,
		ContractID: contractID,
		Type:       "long",
		Contracts:  contracts,
		EntryPrice: premium,
		Premium:    premium * contracts,
		Status:    "open",
	}

	dStore.oPos[pos.ID] = pos
	return pos
}

// Exercise option
func ExerciseOption(positionID string, exercisePrice float64) (float64, error) {
	dStore.mu.Lock()
	defer dStore.mu.Unlock()

	pos, ok := dStore.oPos[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}

	opt := dStore.options[pos.ContractID]
	if opt == nil {
		return 0, fmt.Errorf("option not found")
	}

	var payout float64
	if opt.Type == "call" {
		payout = (exercisePrice - opt.Strike) * pos.Contracts
	} else {
		payout = (opt.Strike - exercisePrice) * pos.Contracts
	}

	if payout > 0 {
		pos.Status = "exercised"
		return payout, nil
	}

	return 0, nil
}

// Get funding rate
func GetFundingRate(contractID string) (float64, bool) {
	dStore.mu.RLock()
	defer dStore.mu.RUnlock()

	c, ok := dStore.futures[contractID]
	return c.FundingRate, ok
}

// List futures
func ListFutures() []*FuturesContract {
	dStore.mu.RLock()
	defer dStore.mu.RUnlock()

	result := make([]*FuturesContract, 0, len(dStore.futures))
	for _, c := range dStore.futures {
		result = append(result, c)
	}
	return result
}

func main() {
	fmt.Println("Derivatives service initialized")

	contracts := ListFutures()
	for _, c := range contracts {
		fmt.Printf("Contract %s: %s Funding %.2f%%\n", c.Symbol, c.Expiry, c.FundingRate*100)
	}
}