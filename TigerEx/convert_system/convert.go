package convert

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// CONVERT SYSTEM - PRODUCTION IMPLEMENTATION
// ============================================================================

// ConvertType represents type of conversion
type ConvertType string

const (
	ConvertTypeClassic    ConvertType = "classic"
	ConvertTypeConvert   ConvertType = "convert"
	ConvertTypeExchange  ConvertType = "exchange"
)

// Conversion represents a conversion transaction
type Conversion struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Type         ConvertType     `json:"type"`
	FromAsset    string          `json:"from_asset"`
	ToAsset      string          `json:"to_asset"`
	FromAmount   decimal.Decimal `json:"from_amount"`
	ToAmount     decimal.Decimal `json:"to_amount"`
	Rate         decimal.Decimal `json:"rate"`
	Fee          decimal.Decimal `json:"fee"`
	Status       string          `json:"status"` // pending, completed, failed
	Timestamp    int64           `json:"timestamp"`
	CompletedAt   *int64          `json:"completed_at,omitempty"`
}

// ConvertQuote represents conversion quote
type ConvertQuote struct {
	QuoteID       string          `json:"quote_id"`
	FromAsset    string          `json:"from_asset"`
	ToAsset      string          `json:"to_asset"`
	FromAmount   decimal.Decimal `json:"from_amount"`
	ToAmount     decimal.Decimal `json:"to_amount"`
	Rate         decimal.Decimal `json:"rate"`
	Fee          decimal.Decimal `json:"fee"`
	Slippage     decimal.Decimal `json:"slippage"`
	ValidUntil   int64           `json:"valid_until"`
}

// ConvertService manages conversions
type ConvertService struct {
	conversions map[string]*Conversion
	quotes     map[string]*ConvertQuote
	rateCache  map[string]decimal.Decimal
	feeConfig  *FeeConfig
	
	mu sync.RWMutex `json:"-"`
}

// FeeConfig represents fee configuration
type FeeConfig struct {
	MakerFee   decimal.Decimal `json:"maker_fee"`
	TakerFee   decimal.Decimal `json:"taker_fee"`
	MinFee     decimal.Decimal `json:"min_fee"`
	DiscountTiers []DiscountTier `json:"discount_tiers"`
}

// DiscountTier represents fee discount tier
type DiscountTier struct {
	VolumeThreshold decimal.Decimal `json:"volume_threshold"`
	DiscountRate   decimal.Decimal `json:"discount_rate"`
}

// NewConvertService creates convert service
func NewConvertService() *ConvertService {
	return &ConvertService{
		conversions: make(map[string]*Conversion),
		quotes:     make(map[string]*ConvertQuote),
		rateCache:  make(map[string]decimal.Decimal),
		feeConfig: &FeeConfig{
			MakerFee: decimal.NewFromFloat(0.1),
			TakerFee: decimal.NewFromFloat(0.1),
			MinFee:   decimal.NewFromFloat(0.01),
			DiscountTiers: []DiscountTier{
				{VolumeThreshold: decimal.NewFromFloat(10000), DiscountRate: decimal.NewFromFloat(0.2)},
				{VolumeThreshold: decimal.NewFromFloat(100000), DiscountRate: decimal.NewFromFloat(0.3)},
				{VolumeThreshold: decimal.NewFromFloat(1000000), DiscountRate: decimal.NewFromFloat(0.5)},
			},
		},
	}
}

// GetQuote gets conversion quote
func (s *ConvertService) GetQuote(ctx context.Context, fromAsset, toAsset string, amount decimal.Decimal) (*ConvertQuote, error) {
	if amount.LessThan(decimal.Zero) {
		return nil, fmt.Errorf("amount must be positive")
	}
	
	// Get rate (in production would call exchange API)
	rate := s.getRate(fromAsset, toAsset)
	if rate.IsZero() {
		return nil, fmt.Errorf("conversion pair not available: %s/%s", fromAsset, toAsset)
	}
	
	// Calculate to amount
	toAmount := amount.Mul(rate)
	
	// Calculate fee
	fee := s.calculateFee(amount, fromAsset)
	
	// Calculate slippage (estimate based on amount)
	slippage := s.estimateSlippage(amount, fromAsset, toAsset)
	
	quote := &ConvertQuote{
		QuoteID:     fmt.Sprintf("quote_%s", uuid.New().String()[:8]),
		FromAsset:  fromAsset,
		ToAsset:    toAsset,
		FromAmount: amount,
		ToAmount:   toAmount.Sub(fee),
		Rate:       rate,
		Fee:        fee,
		Slippage:   slippage,
		ValidUntil: time.Now().Add(10 * time.Second).UnixMilli(),
	}
	
	// Cache quote
	s.mu.Lock()
	s.quotes[quote.QuoteID] = quote
	s.mu.Unlock()
	
	return quote, nil
}

// ExecuteConversion executes conversion
func (s *ConvertService) ExecuteConversion(ctx context.Context, userID, quoteID string) (*Conversion, error) {
	s.mu.RLock()
	quote, exists := s.quotes[quoteID]
	s.mu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("quote not found or expired")
	}
	
	// Check quote validity
	if time.Now().UnixMilli() > quote.ValidUntil {
		return nil, fmt.Errorf("quote expired")
	}
	
	conversion := &Conversion{
		ID:          fmt.Sprintf("conv_%s", uuid.New().String()[:8]),
		UserID:      userID,
		Type:        ConvertTypeConvert,
		FromAsset:   quote.FromAsset,
		ToAsset:     quote.ToAsset,
		FromAmount:  quote.FromAmount,
		ToAmount:    quote.ToAmount,
		Rate:        quote.Rate,
		Fee:         quote.Fee,
		Status:      "completed",
		Timestamp:   time.Now().UnixMilli(),
	}
	
	now := time.Now().UnixMilli()
	conversion.CompletedAt = &now
	
	s.mu.Lock()
	s.conversions[conversion.ID] = conversion
	delete(s.quotes, quoteID)
	s.mu.Unlock()
	
	return conversion, nil
}

// getRate gets exchange rate between assets
func (s *ConvertService) getRate(fromAsset, toAsset string) decimal.Decimal {
	// In production would call price API
	// Simplified mock rates
	rates := map[string]decimal.Decimal{
		"BTC_USD":  decimal.NewFromFloat(50000),
		"ETH_USD":  decimal.NewFromFloat(3000),
		"BNB_USD":  decimal.NewFromFloat(600),
		"SOL_USD":  decimal.NewFromFloat(150),
		"USDT_USD": decimal.NewFromFloat(1),
		"USDC_USD": decimal.NewFromFloat(1),
		"BTC_ETH":  decimal.NewFromFloat(16.67),
		"ETH_BTC":  decimal.NewFromFloat(0.06),
		"BTC_USDT": decimal.NewFromFloat(50000),
		"ETH_USDT": decimal.NewFromFloat(3000),
	}
	
	// Direct rate
	if rate, ok := rates[fromAsset+"_"+toAsset]; ok {
		return rate
	}
	
	// Cross rate via USD
	fromUSD, fromOK := rates[fromAsset+"_USD"]
	toUSD, toOK := rates[toAsset+"_USD"]
	
	if fromOK && toOK && toUSD.GreaterThan(decimal.Zero) {
		return fromUSD.Div(toUSD)
	}
	
	return decimal.Zero
}

// calculateFee calculates conversion fee
func (s *ConvertService) calculateFee(amount decimal.Decimal, asset string) decimal.Decimal {
	fee := amount.Mul(s.feeConfig.TakerFee).Div(decimal.NewFromInt(100))
	
	// Minimum fee
	if fee.LessThan(s.feeConfig.MinFee) {
		return s.feeConfig.MinFee
	}
	
	return fee
}

// estimateSlippage estimates slippage
func (s *ConvertService) estimateSlippage(amount decimal.Decimal, fromAsset, toAsset string) decimal.Decimal {
	// Larger orders have more slippage
	// Simplified estimation
	baseSlippage := decimal.NewFromFloat(0.1) // 0.1% base
	
	// Scale based on amount
	amountFactor := amount.Div(decimal.NewFromFloat(10000))
	if amountFactor.GreaterThan(decimal.NewFromFloat(1)) {
		amountFactor = decimal.NewFromFloat(1)
	}
	
	slippage := baseSlippage.Add(amountFactor.Mul(decimal.NewFromFloat(0.5)))
	
	return slippage.Mul(decimal.NewFromInt(100)) // Return as percentage
}

// GetUserConversions returns user conversion history
func (s *ConvertService) GetUserConversions(userID string, limit, offset int) []*Conversion {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Conversion
	count := 0
	
	for _, conv := range s.conversions {
		if conv.UserID == userID {
			if count >= offset && count < offset+limit {
				result = append(result, conv)
			}
			count++
		}
	}
	
	return result
}

// ApplyDiscount applies volume discount
func (s *ConvertService) ApplyDiscount(userID string, baseFee decimal.Decimal) decimal.Decimal {
	// Get user volume (in production would query database)
	userVolume := decimal.NewFromFloat(50000) // Mock
	
	discount := decimal.Zero
	for _, tier := range s.feeConfig.DiscountTiers {
		if userVolume.GreaterThanOrEqual(tier.VolumeThreshold) {
			discount = tier.DiscountRate
		}
	}
	
	discountedFee := baseFee.Mul(decimal.NewFromInt(1).Sub(discount))
	
	return discountedFee
}

// ============================================================================
// CONVERT UI DATA
// ============================================================================

// ConvertPair represents convert pair for UI
type ConvertPair struct {
	FromAsset string          `json:"from_asset"`
	ToAsset   string          `json:"to_asset"`
	Rate      decimal.Decimal `json:"rate"`
	MinAmount decimal.Decimal `json:"min_amount"`
	MaxAmount decimal.Decimal `json:"max_amount"`
}

// GetAvailablePairs returns available convert pairs
func (s *ConvertService) GetAvailablePairs() []*ConvertPair {
	assets := []string{"BTC", "ETH", "BNB", "SOL", "USDT", "USDC", "ADA", "DOGE", "XRP", "MATIC"}
	
	var pairs []*ConvertPair
	for _, from := range assets {
		for _, to := range assets {
			if from == to {
				continue
			}
			
			rate := s.getRate(from, to)
			if rate.IsZero() {
				continue
			}
			
			pairs = append(pairs, &ConvertPair{
				FromAsset: from,
				ToAsset:   to,
				Rate:      rate,
				MinAmount: decimal.NewFromFloat(10),
				MaxAmount: decimal.NewFromFloat(1000000),
			})
		}
	}
	
	return pairs
}

// ============================================================================
// QUICK CONVERT
// ============================================================================

// QuickConvert performs instant conversion
func (s *ConvertService) QuickConvert(ctx context.Context, userID, fromAsset, toAsset string, amount decimal.Decimal) (*Conversion, error) {
	// Get quote
	quote, err := s.GetQuote(ctx, fromAsset, toAsset, amount)
	if err != nil {
		return nil, err
	}
	
	// Execute conversion
	return s.ExecuteConversion(ctx, userID, quote.QuoteID)
}

// ============================================================================
// CONVERT ANALYTICS
// ============================================================================

// ConversionStats represents conversion statistics
type ConversionStats struct {
	TotalVolume    decimal.Decimal `json:"total_volume"`
	TotalFees     decimal.Decimal `json:"total_fees"`
	TotalCount    int64           `json:"total_count"`
	PopularPairs  []PairStats     `json:"popular_pairs"`
	AvgSlippage   decimal.Decimal `json:"avg_slippage"`
}

// PairStats represents stats for a pair
type PairStats struct {
	FromAsset  string          `json:"from_asset"`
	ToAsset    string          `json:"to_asset"`
	Volume     decimal.Decimal `json:"volume"`
	Count      int64           `json:"count"`
}

// GetStats returns conversion statistics
func (s *ConvertService) GetStats() *ConversionStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	stats := &ConversionStats{
		TotalVolume:  decimal.Zero,
		TotalFees:   decimal.Zero,
		TotalCount:  0,
		PopularPairs: []PairStats{},
	}
	
	pairVolumes := make(map[string]decimal.Decimal)
	pairCounts := make(map[string]int64)
	
	for _, conv := range s.conversions {
		stats.TotalVolume = stats.TotalVolume.Add(conv.FromAmount)
		stats.TotalFees = stats.TotalFees.Add(conv.Fee)
		stats.TotalCount++
		
		pairKey := conv.FromAsset + "_" + conv.ToAsset
		pairVolumes[pairKey] = pairVolumes[pairKey].Add(conv.FromAmount)
		pairCounts[pairKey]++
	}
	
	// Convert to slice
	for pair, volume := range pairVolumes {
		var fromAsset, toAsset string
		fmt.Sscanf(pair, "%s_%s", &fromAsset, &toAsset)
		
		stats.PopularPairs = append(stats.PopularPairs, PairStats{
			FromAsset: fromAsset,
			ToAsset:   toAsset,
			Volume:    volume,
			Count:     pairCounts[pair],
		})
	}
	
	// Calculate average slippage
	if stats.TotalCount > 0 {
		stats.AvgSlippage = decimal.NewFromFloat(0.15) // Mock
	}
	
	return stats
}
