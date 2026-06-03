package fee

import (
	"context"
	"sync"
	"time"
)

// =============================================================================
// FEE COLLECTION SYSTEM
// Maker/taker fees, discounts, volume tiers
// =============================================================================

// FeeTier represents a volume tier
type FeeTier struct {
	TradingVol30D  float64 // 30-day trading volume
	MakerRate     float64 
	TakerRate    float64 
	MarkerTakerDiscount float64 // discount off standard
}

// FeeSchedule contains fee tiers
type FeeSchedule struct {
	MakerRates []float64
	TakerRates []float64
	Thresholds []float64
}

// DefaultFeeSchedule returns standard fee schedule
func DefaultFeeSchedule() *FeeSchedule {
	return &FeeSchedule{
		MakerRates: []float64{0.02, 0.015, 0.012, 0.01, 0.008, 0.006, 0.004, 0.002, 0.0},
		TakerRates: []float64{0.1, 0.08, 0.06, 0.05, 0.04, 0.035, 0.03, 0.025, 0.02},
		Thresholds: []float64{0, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 50000000},
	}
}

// FeeConfig fee configuration
type FeeConfig struct {
	DefaultMaker float64
	DefaultTaker float64
	Schedule    *FeeSchedule
	UseVolume30D bool
}

// FeeService calculates fees
type FeeService struct {
	mu sync.RWMutex
	config *FeeConfig

	// Volume tracking
	volumes   map[string]map[string]float64 // userID -> asset -> volume
	dailyVol  map[string]float64
}

// NewFeeService creates fee service
func NewFeeService(cfg *FeeConfig) *FeeService {
	if cfg == nil {
		cfg = &FeeConfig{
			DefaultMaker: 0.002,
			DefaultTaker: 0.001,
			Schedule: DefaultFeeSchedule(),
			UseVolume30D: true,
		}
	}

	return &FeeService{
		config:   cfg,
		volumes:  make(map[string]map[string]float64),
		dailyVol:  make(map[string]float64),
	}
}

// CalculateFee calculates fee for a trade
func (s *FeeService) CalculateFee(userID string, sides string, quantity, price float64) (makerFee, takerFee float64) {
	rate := s.GetFeeRate(userID, sides)

	if sides == "MAKER" {
		makerFee = quantity * price * rate
		return makerFee, 0
	}
	takerFee = quantity * price * rate
	return 0, takerFee
}

// CalculateTradeFee calculates total fee
func (s *FeeService) CalculateTradeFee(userID string, sides string, quantity, price float64) float64 {
	makerFee, takerFee := s.CalculateFee(userID, sides, quantity, price)
	return makerFee + takerFee
}

// GetFeeRate gets fee rate for user
func (s *FeeService) GetFeeRate(userID string, sides string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Get trading volume
	userVolumes := s.volumes[userID]
	if userVolumes == nil {
		if sides == "MAKER" {
			return s.config.DefaultMaker
		}
		return s.config.DefaultTaker
	}

	var totalVol float64
	for _, vol := range userVolumes {
		totalVol += vol
	}

	// Find tier
	schedule := s.config.Schedule
	for i, threshold := range schedule.Thresholds {
		if totalVol < threshold {
			continue
		}
		if sides == "MAKER" {
			return schedule.MakerRates[i]
		}
		return schedule.TakerRates[i]
	}

	// Fall back to default
	if sides == "MAKER" {
		return s.config.DefaultMaker
	}
	return s.config.DefaultTaker
}

// AddVolume adds trading volume
func (s *FeeService) AddVolume(userID, asset string, volume float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.volumes[userID] == nil {
		s.volumes[userID] = make(map[string]float64)
	}

	s.volumes[userID][asset] += volume
	s.dailyVol[userID] += volume
}

// GetUserVolume gets user volume
func (s *FeeService) GetUserVolume(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userVolumes := s.volumes[userID]
	if userVolumes == nil {
		return 0
	}

	var total float64
	for _, vol := range userVolumes {
		total += vol
	}
	return total
}

// GetDiscount gets user discount percentage
func (s *FeeService) GetDiscount(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userVolumes := s.volumes[userID]
	if userVolumes == nil {
		return 0
	}

	var totalVol float64
	for _, vol := range userVolumes {
		totalVol += vol
	}

	// Find tier
	schedule := s.config.Schedule
	for i, threshold := range schedule.Thresholds {
		if totalVol < threshold {
			continue
		}
		return schedule.MarkerTakerDiscount
	}

	return 0
}

// ResetDaily resets daily volumes
func (s *FeeService) ResetDaily() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dailyVol = make(map[string]float64)
}

// GetDailyVolume gets daily volume
func (s *FeeService) GetDailyVolume(userID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dailyVol[userID]
}

// =============================================================================
// TRANSACTION FEE (NETWORK FEES)
// =============================================================================

// NetworkFee represents estimated network fee
type NetworkFee struct {
	Asset  string
	Fee    float64
	Unit   string 
	Fast   float64 
	Slow   float64 
}

// EstimatedFees returns estimated network fees for assets
func EstimatedFees() map[string]*NetworkFee {
	return map[string]*NetworkFee{
		"BTC":  {Asset: "BTC", Fee: 0.0001, Unit: "BTC", Fast: 0.0005, Slow: 0.00001},
		"ETH":  {Asset: "ETH", Fee: 0.006, Unit: "ETH", Fast: 0.01, Slow: 0.002},
		"USDT": {Asset: "USDT", Fee: 1.0, Unit: "USDT", Fast: 5.0, Slow: 1.0},
		"TRX":  {Asset: "TRX", Fee: 1.0, Unit: "TRX", Fast: 5.0, Slow: 1.0},
		"SOL":  {Asset: "SOL", Fee: 0.00025, Unit: "SOL", Fast: 0.001, Slow: 0.0001},
	}
}

// GetNetworkFee gets network fee estimate
func GetNetworkFee(asset string, priority string) float64 {
	fees := EstimatedFees()
	fee, ok := fees[asset]
	if !ok {
		return 0
	}

	if priority == "fast" {
		return fee.Fast
	}
	if priority == "slow" {
		return fee.Slow
	}
	return fee.Fee
}

// WithdrawalFee represents withdrawal fee config
type WithdrawalFee struct {
	Asset       string
	MinFee      float64
	Fee         float64  
	FeePercent float64 
}

// GetWithdrawalFee calculates withdrawal fee
func GetWithdrawalFee(asset string, amount float64) float64 {
	fees := EstimatedFees()
	fee, ok := fees[asset]
	if !ok {
		return 0
	}

	networkFee := fee.Fee

	// Add percentage fee (0.1%)
	percentFee := amount * 0.001

	return networkFee + percentFee
}

// =============================================================================
// SPREAD AND SLIPPAGE
// =============================================================================

// EstimateSlippage estimates potential slippage
func EstimateSlippage(size, orderBookDepth float64) float64 {
	if orderBookDepth <= 0 {
		return 0.001 // 0.1%
	}

	impact := size / orderBookDepth
	if impact > 0.1 {
		return 0.05 // 5% for large orders
	}
	return impact * 0.5
}

// =============================================================================
// DISCOUNT TIERS
// =============================================================================

// TierInfo describes fee tier
type TierInfo struct {
	Tier          int     
	Name         string   
	MakerFee     float64  
	TakerFee    float64  
	MinVolume  float64  
	Holders    int      
}

// AllTiers returns all fee tiers
func AllTiers() []TierInfo {
	return []TierInfo{
		{1, "VIP 0", 0.001, 0.001, 0, 0},
		{2, "VIP 1", 0.0008, 0.0008, 10000, 0},
		{3, "VIP 2", 0.0006, 0.0006, 50000, 0},
		{4, "VIP 3", 0.0004, 0.0004, 100000, 0},
		{5, "VIP 4", 0.0002, 0.0002, 500000, 0},
		{6, "VIP 5", 0.0, 0.0, 1000000, 0},
		{7, "VIP 6", 0.0, 0.0, 5000000, 0},
		{8, "VIP 7", 0.0, 0.0, 10000000, 0},
		{9, "VIP 8", 0.0, 0.0, 50000000, 0},
	}
}

// GetTier returns user's tier
func (s *FeeService) GetTier(userID string) TierInfo {
	vol := s.GetUserVolume(userID)
	tiers := AllTiers()

	for i := len(tiers) - 1; i >= 0; i-- {
		if vol >= tiers[i].MinVolume {
			return tiers[i]
		}
	}

	return tiers[0]
}

var _ context.Context = nil