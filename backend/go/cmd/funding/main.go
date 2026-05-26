// Package funding provides funding rate calculation.
// Perpetual futures funding mechanism.
package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// Funding Rate
type FundingRate struct {
	Symbol     string  `json:"symbol"`
	Rate       float64 `json:"rate"` // current rate
	NextFunding int64   `json:"nextFunding"`
	PrevFunding int64   `json:"prevFunding"`
	Accumulated float64 `json:"accumulated"`
}

// Position Funding Info
type FundingInfo struct {
	PositionID string  `json:"positionId"`
	UserID     string  `json:"userId"`
	Symbol     string  `json:"symbol"`
	Size       float64 `json:"size"`
	LastFunding float64 `json:"lastFunding"`
	Accumulated float64 `json:"accumulated"`
}

// Funding Calculation
type FundingCalc struct {
	Symbol     string  `json:"symbol"`
	MarkPrice  float64 `json:"markPrice"`
	IndexPrice float64 `json:"indexPrice"`
	Premium   float64 `json:"premium"`
	Floor     float64 `json:"floor"` // min funding rate
	Cap       float64 `json:"cap"` // max funding rate
}

// Store
type FundStore struct {
	mu      sync.RWMutex
	rates   map[string]*FundingRate
	infos   map[string]*FundingInfo
	calcs   map[string]*FundingCalc
}

var fundStore = &FundStore{
	rates: make(map[string]*FundingRate),
	infos: make(map[string]*FundingInfo),
	calcs: make(map[string]*FundingCalc),
}

// Initialize funding
func InitFunding(symbol string) {
	fundingInterval := int64(28800000) // 8 hours

	rate := &FundingRate{
		Symbol: symbol,
		Rate: 0.0001, // 0.01% default (hourly)
		NextFunding: time.Now().UnixMilli() + fundingInterval,
		PrevFunding: 0,
		Accumulated: 0,
	}

	calc := &FundingCalc{
		Symbol: symbol,
		MarkPrice: 65000,
		IndexPrice: 64980,
		Premium: 0,
		Floor: -0.00075,
		Cap: 0.00075,
	}

	fundStore.mu.Lock()
	fundStore.rates[symbol] = rate
	fundStore.calcs[symbol] = calc
	fundStore.mu.Unlock()
}

// Calculate premium
func CalcPremium(symbol string, markPrice, indexPrice float64) float64 {
	premium := (markPrice - indexPrice) / indexPrice

	// Apply clamp
	if calc, ok := fundStore.calcs[symbol]; ok {
		calc.MarkPrice = markPrice
		calc.IndexPrice = indexPrice
		calc.Premium = premium

		if premium > calc.Cap {
			premium = calc.Cap
		} else if premium < calc.Floor {
			premium = calc.Floor
		}
	}

	return premium
}

// Calculate funding rate
func CalcFundingRate(symbol string, premium float64) float64 {
	fundStore.mu.RLock()
	rate, ok := fundStore.rates[symbol]
	fundStore.mu.RUnlock()

	if !ok {
		InitFunding(symbol)
		return 0.0001
	}

	// Interest rate component
	interest := 0.0001 // 0.01% per day

	// Premium component adjusted
	newRate := interest + (premium * 3) // Scale factor

	// Clamp to bounds
	if calc, cok := fundStore.calcs[symbol]; cok {
		if newRate > calc.Cap {
			newRate = calc.Cap
		} else if newRate < calc.Floor {
			newRate = calc.Floor
		}
	}

	fundStore.mu.Lock()
	fundStore.rates[symbol].Rate = newRate
	fundStore.mu.Unlock()

	return newRate
}

// Settle funding
func SettleFunding(symbol string) map[string]float64 {
	userFunding := make(map[string]float64)

	fundStore.mu.RLock()
	rate, ok := fundStore.rates[symbol]
	fundStore.mu.RUnlock()

	if !ok {
		return userFunding
	}

	fundStore.mu.RLock()
	for key, info := range fundStore.infos {
		if info.Symbol == symbol {
			fundingPayment := info.Size * rate.Rate
			
			info.Accumulated += fundingPayment
			userFunding[key] = fundingPayment
		}
	}
	fundStore.mu.RUnlock()

	// Update funding time
	fundStore.mu.Lock()
	rate.PrevFunding = time.Now().UnixMilli()
	rate.NextFunding = time.Now().UnixMilli() + 28800000
	fundStore.mu.Unlock()

	return userFunding
}

// Record funding for position
func RecordFunding(positionID, userID, symbol string, size float64) {
	info := &FundingInfo{
		PositionID: positionID,
		UserID: userID,
		Symbol: symbol,
		Size: size,
		LastFunding: 0,
		Accumulated: 0,
	}

	fundStore.mu.Lock()
	fundStore.infos[positionID] = info
	fundStore.mu.Unlock()
}

// Get current funding rate
func GetFundingRate(symbol string) float64 {
	fundStore.mu.RLock()
	defer fundStore.mu.RUnlock()

	if rate, ok := fundStore.rates[symbol]; ok {
		return rate.Rate
	}
	return 0
}

func main() {
	fmt.Println("Funding service initialized")

	// Initialize
	InitFunding("BTCUSDT")

	// Calculate
	premium := CalcPremium("BTCUSDT", 65000, 64980)
	rate := CalcFundingRate("BTCUSDT", premium)

	fmt.Printf("Premium: %.4f%% Rate: %.4f%%\n", premium*100, rate*100)
}