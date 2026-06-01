// Package billing provides fee calculation and billing services
// for global distributed users
package billing

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// Fee tiers based on 30-day trading volume
type FeeTier struct {
	MinVolume    float64 // Minimum 30-day volume in USD
	MakerFee    float64 // As percentage (0.001 = 0.1%)
	TakerFee    float64
	RoboturnRate float64 // Discount from standard fee
}

// VIP tiers (higher volume = lower fees)
var FeeTiers = []FeeTier{
	{MinVolume: 0, MakerFee: 0.0010, TakerFee: 0.0010, RoboturnRate: 0},      // Default
	{MinVolume: 50000, MakerFee: 0.0008, TakerFee: 0.0008, RoboturnRate: 0.2},    // Bronze
	{MinVolume: 200000, MakerFee: 0.0006, TakerFee: 0.0007, RoboturnRate: 0.3},   // Silver
	{MinVolume: 1000000, MakerFee: 0.0005, TakerFee: 0.0006, RoboturnRate: 0.4},  // Gold
	{MinVolume: 5000000, MakerFee: 0.0004, TakerFee: 0.0005, RoboturnRate: 0.5},  // Platinum
	{MinVolume: 20000000, MakerFee: 0.0002, TakerFee: 0.0003, RoboturnRate: 0.7}, VIP Diamond
	{MinVolume: 100000000, MakerFee: 0.0, TakerFee: 0.0001, RoboturnRate: 0.9},   // SVIP
}

// Asset fee structure
type AssetFee struct {
	Asset         string  // e.g., "BTC"
	WithdrawFee   float64 // Network fee
	MinWithdraw  float64 // Minimum withdrawal
	DepositEnable bool   // Can deposit
	WithdrawEnable bool // Can withdraw
}

// Asset-specific fees
var AssetFees = map[string]*AssetFee{
	"BTC":  {Asset: "BTC", WithdrawFee: 0.0005, MinWithdraw: 0.001, DepositEnable: true, WithdrawEnable: true},
	"ETH":  {Asset: "ETH", WithdrawFee: 0.005, MinWithdraw: 0.01, DepositEnable: true, WithdrawEnable: true},
	"USDT": {Asset: "USDT", WithdrawFee: 1.0, MinWithdraw: 10, DepositEnable: true, WithdrawEnable: true},
	"BNB":  {Asset: "BNB", WithdrawFee: 0.001, MinWithdraw: 0.05, DepositEnable: true, WithdrawEnable: true},
	"SOL":  {Asset: "SOL", WithdrawFee: 0.01, MinWithdraw: 0.1, DepositEnable: true, WithdrawEnable: true},
}

// Account holds billing info for a user
type Account struct {
	UserID       string
	Volume30D   float64 // 30-day trading volume in USD
	Volume30DUpdated time.Time
	
	mu           sync.RWMutex
	transactions []Transaction
}

type Transaction struct {
	ID          string
	Type        string // "trade", "deposit", "withdraw", "fee"
	Asset       string
	Amount      float64
	Fee         float64
	Timestamp   time.Time
}

// BillingService handles all fee calculations
type BillingService struct {
	mu      sync.RWMutex
	accounts map[string]*Account
	
	// Global stats
	totalVolume   float64
	totalFees    float64
	feeCollected float64
}

// NewBillingService creates billing service
func NewBillingService() *BillingService {
	return &BillingService{
		accounts: make(map[string]*Account),
	}
}

// GetFeeTier calculates fee tier based on volume
func (s *BillingService) GetFeeTier(volume30D float64) FeeTier {
	// Start from highest tier and work down
	for i := len(FeeTiers) - 1; i >= 0; i-- {
		if volume30D >= FeeTiers[i].MinVolume {
			return FeeTiers[i]
		}
	}
	return FeeTiers[0]
}

// CalculateTradeFee calculates fee for a trade
func (s *BillingService) CalculateTradeFee(userID string, volume30D float64, side string, price, quantity float64) (fee float64, tier FeeTier) {
	// Get tier
	tier = s.GetFeeTier(volume30D)
	
	// Calculate notional value
	notional := price * quantity
	
	// Apply maker/taker rate
	var rate float64
	if side == "buy" {
		rate = tier.MakerFee
	} else {
		rate = tier.TakerFee
	}
	
	fee = notional * rate
	
	// Round to 2 decimal places
	fee = math.Round(fee*100) / 100
	
	return fee, tier
}

// CalculateWithdrawFee calculates withdrawal fee
func (s *BillingService) CalculateWithdrawFee(asset string, amount float64) (fee float64, err error) {
	assetFee, ok := AssetFees[asset]
	if !ok {
		return 0, fmt.Errorf("unsupported asset: %s", asset)
	}
	
	if !assetFee.WithdrawEnable {
		return 0, fmt.Errorf("withdrawals disabled for %s", asset)
	}
	
	if amount < assetFee.MinWithdraw {
		return 0, fmt.Errorf("minimum withdrawal is %f %s", assetFee.MinWithdraw, asset)
	}
	
	return assetFee.WithdrawFee, nil
}

// CalculateDepositFee - deposits are usually free
func (s *BillingService) CalculateDepositFee(asset string, amount float64) float64 {
	return 0 // Deposits are free
}

// RecordTrade records a trade for volume tracking
func (s *BillingService) RecordTrade(userID, side string, price, quantity float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Ensure account exists
	account, ok := s.accounts[userID]
	if !ok {
		account = &Account{UserID: userID}
		s.accounts[userID] = account
	}
	
	// Update 30-day rolling volume
	notional := price * quantity
	
	// Reset if older than 30 days
	if time.Since(account.Volume30DUpdated) > 30*24*time.Hour {
		account.Volume30D = 0
		account.Volume30DUpdated = time.Now()
	}
	
	account.Volume30D += notional
	s.totalVolume += notional
}

func timeSince(t time.Time) time.Duration {
	return time.Since(t)
}

// RecordFee records collected fees
func (s *BillingService) RecordFee(amount float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.feeCollected += amount
}

// GetUserVolume gets user's 30-day volume
func (s *BillingService) GetUserVolume(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	account, ok := s.accounts[userID]
	if !ok {
		return 0
	}
	
	// Check if we need to reset
	if time.Since(account.Volume30DUpdated) > 30*24*time.Hour {
		return 0
	}
	
	return account.Volume30D
}

// GetFeeBreakdown calculates detailed fee breakdown
func (s *BillingService) GetFeeBreakdown(userID string, trades []TradeRequest) FeeBreakdown {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	breakdown := FeeBreakdown{
		UserID: userID,
	}
	
	account, ok := s.accounts[userID]
	if !ok {
		return breakdown
	}
	
	volume := account.Volume30D
	breakdown.CurrentTier = s.GetFeeTier(volume)
	breakdown.Volume30D = volume
	
	// Calculate potential fees for proposed trades
	for _, trade := range trades {
		fee, _ := s.CalculateTradeFee(userID, volume, trade.Side, trade.Price, trade.Quantity)
		breakdown.TotalMakerFee += fee
		breakdown.TotalTakerFee += fee
	}
	
	breakdown.Breakdown = make([]TradeFeeDetail, len(trades))
	for i, trade := range trades {
		fee, _ := s.CalculateTradeFee(userID, volume, trade.Side, trade.Price, trade.Quantity)
		breakdown.Breakdown[i] = TradeFeeDetail{
			Side:     trade.Side,
			Price:    trade.Price,
			Quantity: trade.Quantity,
			Notional: trade.Price * trade.Quantity,
			Fee:      fee,
		}
	}
	
	return breakdown
}

// TradeRequest is a proposed trade
type TradeRequest struct {
	Side     string
	Price   float64
	Quantity float64
}

// FeeBreakdown shows detailed fee calculation
type FeeBreakdown struct {
	UserID              string
	CurrentTier        FeeTier
	Volume30D         float64
	TotalMakerFee      float64
	TotalTakerFee     float64
	Breakdown         []TradeFeeDetail
}

// TradeFeeDetail shows individual trade fees
type TradeFeeDetail struct {
	Side     string
	Price   float64
	Quantity float64
	Notional float64
	Fee     float64
}

// GetDiscountedFee applies discount
func (t FeeTier) GetDiscountedFee(baseFee float64) float64 {
	return baseFee * (1 - t.RoboturnRate)
}

// FormatFee returns formatted fee percentage
func (t FeeTier) FormatFee(isMaker bool) string {
	rate := t.MakerFee
	if !isMaker {
		rate = t.TakerFee
	}
	return fmt.Sprintf("%.2f%%", rate*100)
}