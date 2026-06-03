// Package trading provides options trading engine with Greek calculations.
package trading

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// OptionType represents call or put
type OptionType string

const (
	OptionTypeCall OptionType = "CALL"
	OptionTypePut  OptionType = "PUT"
)

// OptionStyle represents American or European
type OptionStyle string

const (
	OptionStyleAmerican OptionStyle = "AMERICAN"
	OptionStyleEuropean OptionStyle = "EUROPEAN"
)

// Option represents an option contract
type Option struct {
	ID              string          `json:"id"`
	Symbol         string          `json:"symbol"`
	Underlying     string          `json:"underlying"` // BTC, ETH, etc.
	OptionType    OptionType     `json:"option_type"`
	Style         OptionStyle    `json:"style"`
	StrikePrice   decimal.Decimal `json:"strike_price"`
	Expiration    time.Time      `json:"expiration"`
	ContractSize  decimal.Decimal `json:"contract_size"`
	MaxOpenInterest decimal.Decimal `json:"max_open_interest"`
	TotalVolume  decimal.Decimal `json:"total_volume"`
	IsActive     bool            `json:"is_active"`
}

// Position represents an options position
type Position struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	OptionID        string          `json:"option_id"`
	OptionSymbol   string          `json:"option_symbol"`
	Side           string          `json:"side"` // LONG, SHORT
	Size           decimal.Decimal `json:"size"`
	EntryPrice     decimal.Decimal `json:"entry_price"`
	CurrentPrice   decimal.Decimal `json:"current_price"`
	UnrealizedPnL decimal.Decimal `json:"unrealized_pnl"`
	RealizedPnL   decimal.Decimal `json:"realized_pnl"`
	BreakEvenPrice decimal.Decimal `json:"break_even_price"`
	MaxLoss       decimal.Decimal `json:"max_loss"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

// OptionOrder represents an options order
type OptionOrder struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	OptionID      string          `json:"option_id"`
	Side         string          `json:"side"` // BUY, SELL
	OrderType    string          `json:"order_type"` // MARKET, LIMIT
	Price        decimal.Decimal `json:"price"`
	Quantity     decimal.Decimal `json:"quantity"`
	Filled       decimal.Decimal `json:"filled"`
	AvgFillPrice decimal.Decimal `json:"avg_fill_price"`
	Status       string          `json:"status"`
	TimeInForce string         `json:"time_in_force"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// Greeks represents option Greeks
type Greeks struct {
	Delta decimal.Decimal // Rate of change of option price vs underlying
	Gamma decimal.Decimal // Rate of change of delta vs underlying
	Theta decimal.Decimal // Time decay (per day)
	Vega  decimal.Decimal // Sensitivity to volatility
	Rho   decimal.Decimal // Sensitivity to interest rate
}

// PricingEngine calculates option prices and Greeks
type PricingEngine struct {
	mu           sync.RWMutex
	riskFreeRate decimal.Decimal // Risk-free interest rate
	volatility   map[string]decimal.Decimal // Implied volatility by underlying
}

// NewPricingEngine creates new pricing engine
func NewPricingEngine() *PricingEngine {
	return &PricingEngine{
		riskFreeRate: decimal.NewFromFloat(0.05), // 5% default
		volatility:   make(map[string]decimal.Decimal),
	}
}

// SetVolatility sets implied volatility for underlying
func (pe *PricingEngine) SetVolatility(underlying string, vol decimal.Decimal) {
	pe.mu.Lock()
	defer pe.mu.Unlock()
	pe.volatility[underlying] = vol
}

// CalculatePrice calculates option price using Black-Scholes
func (pe *PricingEngine) CalculatePrice(
	optionType OptionType,
	S decimal.Decimal, // Current underlying price
	K decimal.Decimal, // Strike price
	T float64,         // Time to expiration in years
	sigma decimal.Decimal, // Volatility
	r decimal.Decimal, // Risk-free rate
) decimal.Decimal {
	// Black-Scholes-Merton model
	d1 := pe.calculateD1(S, K, T, sigma, r)
	d2 := d1.Sub(sigma.Mul(decimal.NewFromFloat(math.Sqrt(T)))

	var price decimal.Decimal
	sqrtT := decimal.NewFromFloat(math.Sqrt(T))

	if optionType == OptionTypeCall {
		// Call: S * N(d1) - K * e^(-rT) * N(d2)
		price = S.Mul(pe.normalCDF(d1)).Sub(
			K.Mul(decimal.NewFromFloat(math.Exp(-r.Float64() * T))).Mul(pe.normalCDF(d2)),
		)
	} else {
		// Put: K * e^(-rT) * N(-d2) - S * N(-d1)
		price = K.Mul(decimal.NewFromFloat(math.Exp(-r.Float64() * T))).Mul(pe.normalCDF(d2.Neg())).
			Sub(S.Mul(pe.normalCDF(d1.Neg())))
	}

	return price.Mul(decimal.NewFromInt(100)) // Multiply by contract size
}

// CalculateGreeks calculates all Greeks
func (pe *PricingEngine) CalculateGreeks(
	optionType OptionType,
	S decimal.Decimal,
	K decimal.Decimal,
	T float64,
	sigma decimal.Decimal,
	r decimal.Decimal,
) *Greeks {
	d1 := pe.calculateD1(S, K, T, sigma, r)
	d2 := d1.Sub(sigma.Mul(decimal.NewFromFloat(math.Sqrt(T))))
	sqrtT := decimal.NewFromFloat(math.Sqrt(T))
	pdfD1 := pe.normalPDF(d1)

	greeks := &Greeks{}

	if optionType == OptionTypeCall {
		// Delta: N(d1)
		greeks.Delta = pe.normalCDF(d1)

		// Gamma: N'(d1) / (S * sigma * sqrt(T))
		greeks.Gamma = pdfD1.Div(S.Mul(sigma).Mul(sqrtT))

		// Theta (per day): -S * N'(d1) * sigma / (2 * sqrt(T)) + r * K * e^(-rT) * N(d2)
		thetaTerm1 := S.Mul(pdfD1).Mul(sigma).Div(sqrtT.Mul(decimal.NewFromInt(2)))
		thetaTerm2 := K.Mul(decimal.NewFromFloat(math.Exp(-r.Float64() * T))).Mul(pe.normalCDF(d2)).Mul(r)
		greeks.Theta = thetaTerm1.Sub(thetaTerm2).Div(decimal.NewFromInt(365))

		// Vega (per 1% vol change): S * sqrt(T) * N'(d1) / 100
		greeks.Vega = S.Mul(sqrtT).Mul(pdfD1).Div(decimal.NewFromInt(100))

		// Rho (per 1% rate change): K * T * e^(-rT) * N(d2) / 100
		greeks.Rho = K.Mul(decimal.NewFromFloat(T)).Mul(decimal.NewFromFloat(math.Exp(-r.Float64() * T))).Mul(pe.normalCDF(d2)).Div(decimal.NewFromInt(100))
	} else {
		// Delta: N(d1) - 1
		greeks.Delta = pe.normalCDF(d1).Sub(decimal.NewFromInt(1))

		// Gamma: Same as call
		greeks.Gamma = pdfD1.Div(S.Mul(sigma).Mul(sqrtT))

		// Theta (per day)
		thetaTerm1 := S.Mul(pdfD1).Mul(sigma).Div(sqrtT.Mul(decimal.NewFromInt(2)))
		thetaTerm2 := K.Mul(decimal.NewFromFloat(math.Exp(-r.Float64() * T))).Mul(pe.normalCDF(d2.Neg())).Mul(r)
		greeks.Theta = thetaTerm1.Add(thetaTerm2).Div(decimal.NewFromInt(365))

		// Vega: Same as call
		greeks.Vega = S.Mul(sqrtT).Mul(pdfD1).Div(decimal.NewFromInt(100))

		// Rho: -K * T * e^(-rT) * N(-d2) / 100
		greeks.Rho = K.Mul(decimal.NewFromFloat(T)).Mul(decimal.NewFromFloat(math.Exp(-r.Float64() * T))).Mul(pe.normalCDF(d2.Neg())).Neg().Div(decimal.NewFromInt(100))
	}

	return greeks
}

// calculateD1 calculates d1 parameter
func (pe *PricingEngine) calculateD1(S, K decimal.Decimal, T float64, sigma, r decimal.Decimal) decimal.Decimal {
	sqrtT := decimal.NewFromFloat(math.Sqrt(T))
	logTerm := S.Div(K).Log10() // Natural log
	logTerm = S.Div(K).String() // Using string conversion

	// ln(S/K)
	lnSK := float64(0)
	{
		sf, _ := S.Float64()
		kf, _ := K.Float64()
		if kf > 0 && sf > 0 {
			lnSK = math.Log(sf / kf)
		}
	}

	d1Numerator := decimal.NewFromFloat(lnSK).Add(
		r.Add(sigma.Mul(sigma).Div(decimal.NewFromInt(2))).Mul(decimal.NewFromFloat(T)),
	)
	d1 := d1Numerator.Div(sigma.Mul(sqrtT))

	return d1
}

// normalCDF calculates standard normal cumulative distribution
func (pe *PricingEngine) normalCDF(x decimal.Decimal) decimal.Decimal {
	xf, _ := x.Float64()
	cdf := 0.5 * (1 + math.Erf(xf/math.Sqrt2))
	return decimal.NewFromFloat(cdf)
}

// normalPDF calculates standard normal probability density
func (pe *PricingEngine) normalPDF(x decimal.Decimal) decimal.Decimal {
	xf, _ := x.Float64()
	pdf := math.Exp(-0.5*xf*xf) / math.Sqrt(2*math.Pi)
	return decimal.NewFromFloat(pdf)
}

// ImpliedVolatility calculates implied volatility from market price
func (pe *PricingEngine) ImpliedVolatility(
	optionType OptionType,
	marketPrice decimal.Decimal,
	S decimal.Decimal,
	K decimal.Decimal,
	T float64,
	r decimal.Decimal,
) decimal.Decimal {
	// Newton-Raphson method to find implied volatility
	sigma := decimal.NewFromFloat(0.3) // Initial guess: 30%

	for i := 0; i < 100; i++ {
		price := pe.CalculatePrice(optionType, S, K, T, sigma, r)
		diff := marketPrice.Sub(price)

		// Check convergence
		diffAbs, _ := diff.Abs().Float64()
		if diffAbs < 0.01 {
			return sigma
		}

		// Calculate vega for next iteration
		greeks := pe.CalculateGreeks(optionType, S, K, T, sigma, r)
		vega, _ := greeks.Vega.Float64()

		if vega < 0.0001 {
			break
		}

		// Update sigma
		sigma = sigma.Add(decimal.NewFromFloat(diffAbs / vega))
	}

	return sigma
}

// OptionsEngine manages options trading
type OptionsEngine struct {
	mu            sync.RWMutex
	options      map[string]*Option
	positions    map[string]*Position
	orders       map[string]*OptionOrder
	pricing      *PricingEngine
	exercise    *ExerciseEngine
	settlement  *SettlementEngine
	cfg          *EngineConfig
}

// EngineConfig holds engine configuration
type EngineConfig struct {
	MaxPositionsPerUser int
	MaxStrikeDistance decimal.Decimal
	MinExpiration time.Duration
}

// ExerciseEngine handles option exercise
type ExerciseEngine struct {
	mu      sync.RWMutex
	exercises map[string]*Exercise
}

// Exercise represents exercise event
type Exercise struct {
	ID          string          `json:"id"`
	PositionID  string         `json:"position_id"`
	UserID     string         `json:"user_id"`
	OptionID   string         `json:"option_id"`
	ExerciseType string      `json:"exercise_type"` // EARLY, AT_EXPIRY
	Profit     decimal.Decimal `json:"profit"`
	ExecutedAt time.Time    `json:"executed_at"`
}

// SettlementEngine handles settlement
type SettlementEngine struct {
	mu          sync.RWMutex
	settlements map[string]*Settlement
}

// Settlement represents settlement event
type Settlement struct {
	ID            string          `json:"id"`
	OptionID      string         `json:"option_id"`
	SettlementPrice decimal.Decimal `json:"settlement_price"`
	TotalValue   decimal.Decimal `json:"total_value"`
	ExecutedAt   time.Time    `json:"executed_at"`
}

// NewOptionsEngine creates new options engine
func NewOptionsEngine() *OptionsEngine {
	return &OptionsEngine{
		options:     make(map[string]*Option),
		positions:   make(map[string]*Position),
		orders:      make(map[string]*OptionOrder),
		pricing:     NewPricingEngine(),
		exercise:   &ExerciseEngine{exercises: make(map[string]*Exercise)},
		settlement: &SettlementEngine{settlements: make(map[string]*Settlement)},
		cfg: &EngineConfig{
			MaxPositionsPerUser: 50,
			MaxStrikeDistance: decimal.NewFromFloat(0.5), // 50% from current
			MinExpiration: 1 * time.Hour,
		},
	}
}

// CreateOption creates new option contract
func (oe *OptionsEngine) CreateOption(option *Option) error {
	oe.mu.Lock()
	defer oe.mu.Unlock()

	if _, exists := oe.options[option.Symbol]; exists {
		return fmt.Errorf("option already exists")
	}

	option.IsActive = true
	oe.options[option.Symbol] = option

	return nil
}

// GetOption returns option by symbol
func (oe *OptionsEngine) GetOption(symbol string) (*Option, bool) {
	oe.mu.RLock()
	defer oe.mu.RUnlock()
	opt, ok := oe.options[symbol]
	return opt, ok
}

// OpenPosition opens new options position
func (oe *OptionsEngine) OpenPosition(ctx context.Context, userID, optionSymbol string, side string, quantity decimal.Decimal, orderType string, price decimal.Decimal) (*Position, error) {
	oe.mu.RLock()
	option, ok := oe.options[optionSymbol]
	oe.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("option not found")
	}

	// Calculate entry price
	var entryPrice decimal.Decimal
	if orderType == "MARKET" {
		entryPrice = oe.pricing.CalculatePrice(
			option.OptionType,
			decimal.NewFromFloat(50000), // Would get from price feed
			option.StrikePrice,
			time.Until(option.Expiration).Hours()/8760,
			decimal.NewFromFloat(0.3),
			oe.pricing.riskFreeRate,
		)
	} else {
		entryPrice = price
	}

	breakEven := entryPrice
	if side == "SHORT" {
		breakEven = entryPrice.Neg()
	}

	position := &Position{
		ID:              generatePositionID(),
		UserID:          userID,
		OptionID:        option.ID,
		OptionSymbol:     optionSymbol,
		Side:           side,
		Size:           quantity,
		EntryPrice:     entryPrice,
		CurrentPrice:   entryPrice,
		BreakEvenPrice: breakEven,
		MaxLoss:        entryPrice.Mul(quantity), // For short positions
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	oe.mu.Lock()
	oe.positions[position.ID] = position
	oe.mu.Unlock()

	return position, nil
}

// ClosePosition closes an options position
func (oe *OptionsEngine) ClosePosition(ctx context.Context, userID, positionID string, quantity *decimal.Decimal) (*Position, decimal.Decimal, error) {
	oe.mu.RLock()
	position, ok := oe.positions[positionID]
	oe.mu.RUnlock()

	if !ok {
		return nil, decimal.Zero, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, decimal.Zero, fmt.Errorf("unauthorized")
	}

	// Calculate close amount
	closeQty := quantity
	if quantity == nil || quantity.IsZero() {
		closeQty = &position.Size
	}

	// Get current option price
	option, _ := oe.options[position.OptionSymbol]
	currentPrice := oe.pricing.CalculatePrice(
		option.OptionType,
		decimal.NewFromFloat(50000), // Would get from price feed
		option.StrikePrice,
		time.Until(option.Expiration).Hours()/8760,
		decimal.NewFromFloat(0.3),
		oe.pricing.riskFreeRate,
	)

	// Calculate PnL
	var pnl decimal.Decimal
	if position.Side == "LONG" {
		pnl = currentPrice.Sub(position.EntryPrice).Mul(*closeQty)
	} else {
		pnl = position.EntryPrice.Sub(currentPrice).Mul(*closeQty)
	}

	// Update position
	position.Size = position.Size.Sub(*closeQty)
	position.RealizedPnL = position.RealizedPnL.Add(pnl)

	if position.Size.IsZero() {
		oe.mu.Lock()
		delete(oe.positions, positionID)
		oe.mu.Unlock()
	}

	position.UpdatedAt = time.Now()

	return position, pnl, nil
}

// GetPositions returns all positions for user
func (oe *OptionsEngine) GetPositions(userID string) []*Position {
	oe.mu.RLock()
	defer oe.mu.RUnlock()

	var result []*Position
	for _, pos := range oe.positions {
		if pos.UserID == userID {
			result = append(result, pos)
		}
	}
	return result
}

// GetPosition returns position by ID
func (oe *OptionsEngine) GetPosition(positionID string) (*Position, bool) {
	oe.mu.RLock()
	defer oe.mu.RUnlock()
	pos, ok := oe.positions[positionID]
	return pos, ok
}

// CalculatePositionValue calculates current position value and Greeks
func (oe *OptionsEngine) CalculatePositionValue(positionID string, underlyingPrice decimal.Decimal) (*PositionValue, error) {
	oe.mu.RLock()
	position, ok := oe.positions[positionID]
	oe.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	option, ok := oe.options[position.OptionSymbol]
	if !ok {
		return nil, fmt.Errorf("option not found")
	}

	// Time to expiration
	T := time.Until(option.Expiration).Hours() / 8760
	if T <= 0 {
		T = 0.0001
	}

	// Get or calculate IV
	oe.mu.RLock()
	sigma := oe.pricing.volatility[option.Underlying]
	if sigma.IsZero() {
		sigma = decimal.NewFromFloat(0.3)
	}
	oe.mu.RUnlock()

	// Calculate current price and Greeks
	currentPrice := oe.pricing.CalculatePrice(
		option.OptionType,
		underlyingPrice,
		option.StrikePrice,
		T,
		sigma,
		oe.pricing.riskFreeRate,
	)

	greeks := oe.pricing.CalculateGreeks(
		option.OptionType,
		underlyingPrice,
		option.StrikePrice,
		T,
		sigma,
		oe.pricing.riskFreeRate,
	)

	// Calculate PnL
	var pnl decimal.Decimal
	if position.Side == "LONG" {
		pnl = currentPrice.Sub(position.EntryPrice).Mul(position.Size)
	} else {
		pnl = position.EntryPrice.Sub(currentPrice).Mul(position.Size)
	}

	return &PositionValue{
		PositionID:   positionID,
		CurrentPrice: currentPrice,
		MarketValue:  currentPrice.Mul(position.Size),
		UnrealizedPnL: pnl,
		Greeks:       greeks,
	}, nil
}

// PositionValue represents position value with Greeks
type PositionValue struct {
	PositionID   string
	CurrentPrice decimal.Decimal
	MarketValue  decimal.Decimal
	UnrealizedPnL decimal.Decimal
	Greeks       *Greeks
}

// ExerciseOption exercises an option position
func (oe *OptionsEngine) ExerciseOption(ctx context.Context, userID, positionID string, exerciseType string) (*Exercise, error) {
	oe.mu.RLock()
	position, ok := oe.positions[positionID]
	oe.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	option, ok := oe.options[position.OptionSymbol]
	if !ok {
		return nil, fmt.Errorf("option not found")
	}

	// Get settlement price (would get from price feed)
	settlementPrice := decimal.NewFromFloat(50000)

	// Calculate exercise profit
	var profit decimal.Decimal
	if option.OptionType == OptionTypeCall {
		if settlementPrice.GreaterThan(option.StrikePrice) {
			profit = settlementPrice.Sub(option.StrikePrice).Mul(position.Size).Mul(option.ContractSize)
		}
	} else {
		if settlementPrice.LessThan(option.StrikePrice) {
			profit = option.StrikePrice.Sub(settlementPrice).Mul(position.Size).Mul(option.ContractSize)
		}
	}

	exercise := &Exercise{
		ID:         generateExerciseID(),
		PositionID: positionID,
		UserID:     userID,
		OptionID:  option.ID,
		ExerciseType: exerciseType,
		Profit:    profit,
		ExecutedAt: time.Now(),
	}

	oe.mu.Lock()
	oe.exercise.exercises[exercise.ID] = exercise
	// Close position
	delete(oe.positions, positionID)
	oe.mu.Unlock()

	return exercise, nil
}

// ExpireOptions expires options at expiration
func (oe *OptionsEngine) ExpireOptions(ctx context.Context, expiration time.Time) error {
	// Get all options expiring at this time
	oe.mu.RLock()
	var expiringOptions []*Option
	for _, opt := range oe.options {
		if opt.Expiration.Before(expiration.Add(time.Minute)) && 
		   opt.Expiration.After(expiration.Add(-time.Minute)) {
			expiringOptions = append(expiringOptions, opt)
		}
	}
	oe.mu.RUnlock()

	// Get settlement price (would get from price feed)
	settlementPrice := decimal.NewFromFloat(50000)

	for _, option := range expiringOptions {
		// Find all positions for this option
		oe.mu.RLock()
		var optionPositions []*Position
		for _, pos := range oe.positions {
			if pos.OptionSymbol == option.Symbol {
				optionPositions = append(optionPositions, pos)
			}
		}
		oe.mu.RUnlock()

		// Settle each position
		for _, pos := range optionPositions {
			var value decimal.Decimal
			if option.OptionType == OptionTypeCall {
				if settlementPrice.GreaterThan(option.StrikePrice) {
					value = settlementPrice.Sub(option.StrikePrice).Mul(pos.Size).Mul(option.ContractSize)
				}
			} else {
				if settlementPrice.LessThan(option.StrikePrice) {
					value = option.StrikePrice.Sub(settlementPrice).Mul(pos.Size).Mul(option.ContractSize)
				}
			}

			settlement := &Settlement{
				ID:               generateSettlementID(),
				OptionID:         option.ID,
				SettlementPrice:  settlementPrice,
				TotalValue:       value,
				ExecutedAt:       time.Now(),
			}

			oe.mu.Lock()
			oe.settlement.settlements[settlement.ID] = settlement
			pos.RealizedPnL = pos.RealizedPnL.Add(value)
			oe.mu.Unlock()
		}
	}

	return nil
}

// GetOptionChain returns option chain for underlying
func (oe *OptionsEngine) GetOptionChain(underlying string, expiration time.Time) ([]*OptionChainItem, error) {
	oe.mu.RLock()
	defer oe.mu.RUnlock()

	// Get current underlying price (would get from price feed)
	underlyingPrice := decimal.NewFromFloat(50000)

	var chain []*OptionChainItem
	for _, opt := range oe.options {
		if opt.Underlying == underlying && 
		   opt.Expiration.Sub(expiration).Abs() < time.Hour {
			
			// Calculate prices and Greeks
			T := time.Until(opt.Expiration).Hours() / 8760
			sigma := decimal.NewFromFloat(0.3)

			bidPrice := oe.pricing.CalculatePrice(opt.OptionType, underlyingPrice, opt.StrikePrice, T, sigma, oe.pricing.riskFreeRate)
			askPrice := bidPrice.Mul(decimal.NewFromFloat(1.1)) // Simplified spread
			greeks := oe.pricing.CalculateGreeks(opt.OptionType, underlyingPrice, opt.StrikePrice, T, sigma, oe.pricing.riskFreeRate)

			chain = append(chain, &OptionChainItem{
				Symbol:        opt.Symbol,
				OptionType:    opt.OptionType,
				StrikePrice:   opt.StrikePrice,
				Expiration:    opt.Expiration,
				BidPrice:     bidPrice,
				AskPrice:     askPrice,
				LastPrice:    bidPrice,
				Change24h:    decimal.Zero,
				Volume24h:    decimal.Zero,
				OpenInterest: opt.MaxOpenInterest,
				IV:           sigma,
				Delta:        greeks.Delta,
				Gamma:        greeks.Gamma,
				Theta:        greeks.Theta,
				Vega:         greeks.Vega,
			})
		}
	}

	return chain, nil
}

// OptionChainItem represents single option in chain
type OptionChainItem struct {
	Symbol        string
	OptionType    OptionType
	StrikePrice   decimal.Decimal
	Expiration    time.Time
	BidPrice     decimal.Decimal
	AskPrice     decimal.Decimal
	LastPrice    decimal.Decimal
	Change24h    decimal.Decimal
	Volume24h    decimal.Decimal
	OpenInterest decimal.Decimal
	IV           decimal.Decimal
	Delta        decimal.Decimal
	Gamma        decimal.Decimal
	Theta        decimal.Decimal
	Vega         decimal.Decimal
}

// Helper functions
func generatePositionID() string {
	return fmt.Sprintf("OPT_POS%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateOrderID() string {
	return fmt.Sprintf("OPT_ORD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateExerciseID() string {
	return fmt.Sprintf("OPT_EXE%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateSettlementID() string {
	return fmt.Sprintf("OPT_STL%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

var _ = math.Sqrt