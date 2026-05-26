package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// =============================================================================
// ADVANCED DERIVATIVES HUB - Production Ready
// Options, Futures, Perpetuals with Black-Scholes pricing
// =============================================================================

// Option types
const (
	OptionTypeCall = "CALL"
	OptionTypePut = "PUT"
)

const (
	ExerciseTypeEuropean = "EUROPEAN"
	ExerciseTypeAmerican = "AMERICAN"
)

// Greeks - option sensitivity measures
type Greeks struct {
	Delta float64 // ∂V/∂S - rate of change with underlying
	Gamma float64 // ∂²V/∂S² - rate of change of delta
	Theta float64 // ∂V/∂t - time decay per day
	Rho   float64 // ∂V/∂r - sensitivity to interest rate
	Vega  float64 // ∂V/∂σ - sensitivity to volatility
}

// Option contract
type OptionContract struct {
	Symbol        string  `json:"symbol"`
	Underlying    string  `json:"underlying"`
	Type         string  `json:"type"` // CALL or PUT
	Strike       float64 `json:"strike"`
	Expiry       int64   `json:"expiry"`
	ExerciseType string  `json:"exerciseType"`
	ContractSize float64 `json:"contractSize"`
	MinQuantity float64 `json:"minQuantity"`
	MaxQuantity float64 `json:"maxQuantity"`
	MakerFee    float64 `json:"makerFee"`
	TakerFee    float64 `json:"takerFee"`
	Status     string  `json:"status"` // ACTIVE, EXPIRED, SETTLED
}

// Option position
type OptionPosition struct {
	UserID       string  `json:"userId"`
	ContractID   string  `json:"contractId"`
	Quantity    float64 `json:"quantity"`
	EntryPrice  float64 `json:"entryPrice"`
	MarkPrice   float64 `json:"markPrice"`
	Leverage    int    `json:"leverage"`
	Maintenance float64 `json:"maintenance"`
}

// Perpetual contract
type PerpetualContract struct {
	Symbol          string  `json:"symbol"`
	Underlying      string  `json:"underlying"`
	ContractType   string  `json:"contractType"` // LINEAR, INVERSE
	StrikeCurrency  string  `json:"strikeCurrency"`
	MinPrice       float64 `json:"minPrice"`
	MaxPrice       float64 `json:"maxPrice"`
	TickSize       float64 `json:"tickSize"`
	ContractValue float64 `json:"contractValue"`
	MaxLeverage   int    `json:"maxLeverage"`
	MakerFee      float64 `json:"makerFee"`
	TakerFee      float64 `json:"takerFee"`
	FundingRate   float64 `json:"fundingRate"`
	Status       string  `json:"status"`
}

// Futures contract
type FuturesContract struct {
	Symbol          string  `json:"symbol"`
	Underlying      string  `json:"underlying"`
	SettlementTime int64   `json:"settlementTime"`
	SettlementCurrency string `json:"settlementCurrency"`
	ContractSize   float64 `json:"contractSize"`
	MakerFee       float64 `json:"makerFee"`
	TakerFee       float64 `json:"takerFee"`
	Status        string  `json:"status"`
}

// DerivativesHub - main struct
type DerivativesHub struct {
	mu                  sync.RWMutex
	options             map[string]*OptionContract
	perpetuals          map[string]*PerpetualContract
	futures            map[string]*FuturesContract
	optionPositions    map[string][]OptionPosition
	positions          map[string]float64
	prices             map[string]float64
	iv                 map[string]float64 // implied volatility
	riskFreeRate       float64 // risk-free rate (0.05 = 5%)
}

// NewDerivativesHub - constructor
func NewDerivativesHub() *DerivativesHub {
	return &DerivativesHub{
		options:         make(map[string]*OptionContract),
		perpetuals:      make(map[string]*PerpetualContract),
		futures:        make(map[string]*FuturesContract),
		optionPositions: make(map[string][]OptionPosition),
		positions:       make(map[string]float64),
		prices:          make(map[string]float64),
		iv:             make(map[string]float64),
		riskFreeRate:    0.05, // 5% risk-free rate
	}
}

// InitializeOption - register option contract
func (dh *DerivativesHub) InitializeOption(opt *OptionContract) error {
	dh.mu.Lock()
	defer dh.mu.Unlock()

	if _, exists := dh.options[opt.Symbol]; exists {
		return fmt.Errorf("option %s already exists", opt.Symbol)
	}

	dh.options[opt.Symbol] = opt
	dh.prices[opt.Symbol] = opt.Strike // Initial price = strike
	dh.iv[opt.Symbol] = 0.5 // 50% default IV

	return nil
}

// InitializePerpetual - register perpetual contract
func (dh *DerivativesHub) InitializePerpetual(p *PerpetualContract) error {
	dh.mu.Lock()
	defer dh.mu.Unlock()

	if _, exists := dh.perpetuals[p.Symbol]; exists {
		return fmt.Errorf("perpetual %s already exists", p.Symbol)
	}

	dh.perpetuals[p.Symbol] = p
	dh.prices[p.Symbol] = 0

	return nil
}

// InitializeFutures - register futures contract
func (dh *DerivativesHub) InitializeFutures(f *FuturesContract) error {
	dh.mu.Lock()
	defer dh.mu.Unlock()

	if _, exists := dh.futures[f.Symbol]; exists {
		return fmt.Errorf("futures %s already exists", f.Symbol)
	}

	dh.futures[f.Symbol] = f
	return nil
}

// CalculateOptionPrice - Black-Scholes pricing
func (dh *DerivativesHub) CalculateOptionPrice(underlyingPrice, strike, expiry float64, optionType string, iv float64) float64 {
	r := dh.riskFreeRate

	// Time to expiry in years
	if expiry <= 0 {
		return 0
	}
	T := expiry / 31536000 // convert seconds to years

	if T <= 0 {
		return 0
	}

	// Black-Scholes calculation
	d1 := (math.Log(underlyingPrice/strike) + (r+iv*iv/2)*T) / (iv * math.Sqrt(T))
	d2 := d1 - iv*math.Sqrt(T)

	nd1 := normalCDF(d1)
	nd2 := normalCDF(d2)
	nnd1 := normalCDF(-d1)
	nnd2 := normalCDF(-d2)

	discountFactor := math.Exp(-r * T)

	if optionType == OptionTypeCall {
		return underlyingPrice*nd1 - strike*discountFactor*nd2
	}
	// Put option
	return strike*discountFactor*nnd2 - underlyingPrice*nnd1
}

// CalculateGreeks - calculate option Greeks
func (dh *DerivativesHub) CalculateGreeks(underlyingPrice, strike, expiry float64, optionType string, iv float64) *Greeks {
	r := dh.riskFreeRate
	T := expiry / 31536000

	if T <= 0 || iv <= 0 {
		return &Greeks{}
	}

	d1 := (math.Log(underlyingPrice/strike) + (r+iv*iv/2)*T) / (iv * math.Sqrt(T))
	d2 := d1 - iv*math.Sqrt(T)

	nd1 := normalCDF(d1)
	gammaVal := normalPDF(d1) / (underlyingPrice * iv * math.Sqrt(T))

	if optionType == OptionTypeCall {
		delta := nd1
		theta := (-(underlyingPrice*normalPDF(d1)*iv)/(2*math.Sqrt(T)) - r*strike*math.Exp(-r*T)*normalCDF(d2)) / 365
		rho := strike * T * math.Exp(-r*T) * normalCDF(d2) / 100
		vega := underlyingPrice * math.Sqrt(T) * normalPDF(d1) / 100

		return &Greeks{
			Delta: delta,
			Gamma: gammaVal,
			Theta: theta,
			Rho:   rho,
			Vega:  vega,
		}
	}

	// Put Greeks
	delta := nd1 - 1
	theta := (-(underlyingPrice*normalPDF(d1)*iv)/(2*math.Sqrt(T)) + r*strike*math.Exp(-r*T)*normalCDF(-d2)) / 365
	rho := -strike * T * math.Exp(-r*T) * normalCDF(-d2) / 100
	vega := underlyingPrice * math.Sqrt(T) * normalPDF(d1) / 100

	return &Greeks{
		Delta: delta,
		Gamma: gammaVal,
		Theta: theta,
		Rho:   rho,
		Vega:  vega,
	}
}

// UpdatePrice - update underlying price
func (dh *DerivativesHub) UpdatePrice(symbol string, price float64) {
	dh.mu.Lock()
	defer dh.mu.Unlock()
	dh.prices[symbol] = price
}

// GetOptionPrice - get current option price
func (dh *DerivativesHub) GetOptionPrice(optionSymbol string) float64 {
	dh.mu.RLock()
	defer dh.mu.RUnlock()

	opt, ok := dh.options[optionSymbol]
	if !ok {
		return 0
	}

	underlyingPrice := dh.prices[opt.Underlying]
	expiry := opt.Expiry - time.Now().Unix()
	iv := dh.iv[optionSymbol]

	return dh.CalculateOptionPrice(underlyingPrice, opt.Strike, expiry, opt.Type, iv)
}

// GetPerpetualPrice - calculate perpetual price (funding included)
func (dh *DerivativesHub) GetPerpetualPrice(symbol string, underlyingPrice float64) float64 {
	dh.mu.RLock()
	defer dh.mu.RUnlock()

	p, ok := dh.perpetuals[symbol]
	if !ok {
		return 0
	}

	// Funding rate adjustment
	fundingPayment := underlyingPrice * p.FundingRate / 8 // 3 times daily

	if p.ContractType == "LINEAR" {
		return underlyingPrice + fundingPayment
	}
	// Inverse contract
	return p.ContractValue / underlyingPrice
}

// GetMarkPrice - calculate mark price for liquidation
func (dh *DerivativesHub) GetMarkPrice(symbol string) float64 {
	dh.mu.RLock()
	defer dh.mu.RUnlock()

	price, ok := dh.prices[symbol]
	if !ok {
		return 0
	}

	// Mark price = (Bid + Ask) / 2 = use last price * 1.0005 as premium
	return price * 1.0005
}

// CalculatePositionValue - calculate position value
func (dh *DerivativesHub) CalculatePositionValue(position *OptionPosition, currentPrice float64) float64 {
	return position.Quantity * currentPrice * position.ContractSize
}

// CalculateMaintenanceMargin - maintenance margin requirement
func (dh *DerivativesHub) CalculateMaintenanceMargin(position *OptionPosition) float64 {
	// 0.5% of position value for options
	maintenance := position.Quantity * position.ContractSize * position.MarkPrice * 0.005

	// Minimum $50
	if maintenance < 50 {
		return 50
	}

	return maintenance
}

// CalculateLiquidationPrice - calculate liquidation price
func (dh *DerivativesHub) CalculateLiquificationPrice(entryPrice float64, leverage int, isLong bool) float64 {
	if isLong {
		// Long position: liquidation when price drops
		return entryPrice * (1 - 1/float64(leverage))
	}
	// Short position: liquidation when price rises
	return entryPrice * (1 + 1/float64(leverage))
}

// Normal CDF approximation
func normalCDF(x float64) float64 {
	return 0.5 * (1 + math.Erf(x/math.Sqrt2))
}

// Normal PDF
func normalPDF(x float64) float64 {
	return math.Exp(-0.5*x*x) / math.Sqrt2Pi
}

const (
	mathSqrt2    = 1.4142135623730951
	mathSqrt2Pi  = 2.5066282746310002
)

// Main entry point
func main() {
	fmt.Println("=== TigerEx Advanced Derivatives Hub ===")
	fmt.Println()

	dh := NewDerivativesHub()

	// Initialize BTC options
	err := dh.InitializeOption(&OptionContract{
		Symbol:        "BTC-60000-CALL-20251231",
		Underlying:    "BTC",
		Type:         OptionTypeCall,
		Strike:       60000,
		Expiry:       time.Now().Unix() + 86400*180, // 180 days
		ExerciseType: ExerciseTypeEuropean,
		ContractSize: 0.01,
		MinQuantity:  0.1,
		MaxQuantity:  100,
		MakerFee:     0.0003,
		TakerFee:     0.0005,
		Status:      "ACTIVE",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Println("✓ BTC 60K Call option registered")
	}

	// Initialize ETH options
	err = dh.InitializeOption(&OptionContract{
		Symbol:        "ETH-3000-PUT-20251231",
		Underlying:    "ETH",
		Type:         OptionTypePut,
		Strike:       3000,
		Expiry:       time.Now().Unix() + 86400*90,
		ExerciseType: ExerciseTypeEuropean,
		ContractSize: 0.1,
		MinQuantity:  0.1,
		MaxQuantity: 1000,
		MakerFee:     0.0003,
		TakerFee:    0.0005,
		Status:     "ACTIVE",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Println("✓ ETH 3K Put option registered")
	}

	// Initialize BTC perpetual
	err = dh.InitializePerpetual(&PerpetualContract{
		Symbol:         "BTC-USDT-PERP",
		Underlying:     "BTC",
		ContractType:  "LINEAR",
		StrikeCurrency: "USDT",
		MinPrice:      0.01,
		MaxPrice:      1000000,
		TickSize:      0.5,
		ContractValue: 0.01,
		MaxLeverage:   125,
		MakerFee:      0.0001,
		TakerFee:     0.0001,
		FundingRate:  0.0001,
		Status:      "ACTIVE",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Println("✓ BTC-USDT perpetual registered")
	}

	// Test pricing - BTC call option
	underlyingPrice := 50000.0
	strike := 60000.0
	expirySeconds := float64(86400 * 180)
	iv := 0.5 // 50% IV

	callPrice := dh.CalculateOptionPrice(underlyingPrice, strike, expirySeconds, OptionTypeCall, iv)
	fmt.Printf("\nBTC 60K Call (underlying=$50K, 180 days, 50%% IV): $%.2f\n", callPrice)

	putPrice := dh.CalculateOptionPrice(underlyingPrice, strike, expirySeconds, OptionTypePut, iv)
	fmt.Printf("BTC 60K Put: $%.2f\n", putPrice)

	// Test Greeks
	greeks := dh.CalculateGreeks(underlyingPrice, strike, expirySeconds, OptionTypeCall, iv)
	fmt.Printf("\nGreeks (Call): Δ%.4f γ%.4f θ%.4f ρ%.4f ν%.4f\n",
		greeks.Delta, greeks.Gamma, greeks.Theta, greeks.Rho, greeks.Vega)

	greeksPut := dh.CalculateGreeks(underlyingPrice, strike, expirySeconds, OptionTypePut, iv)
	fmt.Printf("Greeks (Put): Δ%.4f γ%.4f θ%.4f ρ%.4f ν%.4f\n",
		greeksPut.Delta, greeksPut.Gamma, greeksPut.Theta, greeksPut.Rho, greeksPut.Vega)

	// Test perpetual pricing
	dh.UpdatePrice("BTC", 50000)
	perpPrice := dh.GetPerpetualPrice("BTC-USDT-PERP", 50000)
	fmt.Printf("\nBTC Perpetual price (incl. funding): $%.2f\n", perpPrice)

	// Test liquidation prices
	liquidationLong := dh.CalculateLiquificationPrice(50000, 10, true)
	liquidationShort := dh.CalculateLiquificationPrice(50000, 10, false)
	fmt.Printf("\nLiquidation (10x Long): $%.2f\n", liquidationLong)
	fmt.Printf("Liquidation (10x Short): $%.2f\n", liquidationShort)

	// List registered derivatives
	fmt.Printf("\n✓ Registered options: %d\n", len(dh.options))
	fmt.Printf("✓ Registered perpetuals: %d\n", len(dh.perpetuals))
	fmt.Printf("✓ Registered futures: %d\n", len(dh.futures))

	fmt.Println("\n=== Derivatives Hub Ready ===")
}