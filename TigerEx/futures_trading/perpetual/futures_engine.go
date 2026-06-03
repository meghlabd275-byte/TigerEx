// Package perpetual provides perpetual futures trading engine.
// Supports USDT-M (linear) and COIN-M (inverse) perpetual contracts.
package perpetual

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// ContractType represents contract type
type ContractType string

const (
	ContractTypeLinear   ContractType = "LINEAR"   // USDT-M
	ContractTypeInverse ContractType = "INVERSE"  // COIN-M
)

// PositionSide represents position direction
type PositionSide string

const (
	PositionSideLong  PositionSide = "LONG"
	PositionSideShort PositionSide = "SHORT"
)

// Contract represents a perpetual contract
type Contract struct {
	ID                string          `json:"id"`
	Symbol            string          `json:"symbol"`
	ContractType     ContractType    `json:"contract_type"`
	BaseAsset        string          `json:"base_asset"`
	QuoteAsset       string          `json:"quote_asset"` // USDT or BTC
	PricePrecision   int             `json:"price_precision"`
	QuantityPrecision int            `json:"quantity_precision"`
	MinQuantity      decimal.Decimal `json:"min_quantity"`
	MaxQuantity      decimal.Decimal `json:"max_quantity"`
	LeverageRange    [2]int         `json:"leverage_range"` // [min, max]
	MaintenanceMargin decimal.Decimal `json:"maintenance_margin"`
	MarkPriceSource string          `json:"mark_price_source"`
	FundingInterval int             `json:"funding_interval"` // Hours
	NextFundingTime time.Time      `json:"next_funding_time"`
	MaxOpenInterest decimal.Decimal `json:"max_open_interest"`
	TotalOpenInterest decimal.Decimal `json:"total_open_interest"`
	IsActive        bool            `json:"is_active"`
}

// Position represents a futures position
type Position struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	ContractID       string          `json:"contract_id"`
	ContractSymbol   string          `json:"contract_symbol"`
	Side             PositionSide   `json:"side"`
	Size             decimal.Decimal `json:"size"` // Position size (positive=long, negative=short)
	EntryPrice       decimal.Decimal `json:"entry_price"`
	MarkPrice        decimal.Decimal `json:"mark_price"`
	Leverage         int             `json:"leverage"`
	UnrealizedPnL    decimal.Decimal `json:"unrealized_pnl"`
	RealizedPnL      decimal.Decimal `json:"realized_pnl"`
	LiquidationPrice  decimal.Decimal `json:"liquidation_price"`
	Margin           decimal.Decimal `json:"margin"`         // Initial margin
	PositionMargin   decimal.Decimal `json:"position_margin"` // Current margin
	MaintenanceMargin decimal.Decimal `json:"maintenance_margin"`
	ROE              decimal.Decimal `json:"roe"` // Return on equity
	UpdatedAt        time.Time      `json:"updated_at"`
}

// Order represents a futures order
type Order struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	ContractID      string          `json:"contract_id"`
	Side            PositionSide   `json:"side"`
	OrderType       OrderType      `json:"order_type"`
	Size            decimal.Decimal `json:"size"` // Order size (positive=buy, negative=sell)
	Price           decimal.Decimal `json:"price"`
	TriggerPrice    decimal.Decimal `json:"trigger_price"`
	FilledSize      decimal.Decimal `json:"filled_size"`
	AverageFillPrice decimal.Decimal `json:"avg_fill_price"`
	Status          OrderStatus    `json:"status"`
	ReduceOnly      bool           `json:"reduce_only"`
	CloseOnTrigger  bool           `json:"close_on_trigger"`
	TimeInForce     TimeInForce    `json:"time_in_force"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// OrderType represents order type
type OrderType string

const (
	OrderTypeMarket      OrderType = "MARKET"
	OrderTypeLimit       OrderType = "LIMIT"
	OrderTypeStopMarket  OrderType = "STOP_MARKET"
	OrderTypeStopLimit   OrderType = "STOP_LIMIT"
	OrderTypeTakeProfit  OrderType = "TAKE_PROFIT"
)

// OrderStatus represents order status
type OrderStatus string

const (
	OrderStatusNew        OrderStatus = "NEW"
	OrderStatusPartially  OrderStatus = "PARTIALLY_FILLED"
	OrderStatusFilled     OrderStatus = "FILLED"
	OrderStatusCancelled  OrderStatus = "CANCELLED"
	OrderStatusRejected   OrderStatus = "REJECTED"
)

// TimeInForce represents time in force
type TimeInForce string

const (
	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC" // Immediate or Cancel
	TimeInForceFOK TimeInForce = "FOK" // Fill or Kill
)

// FundingRate represents funding rate
type FundingRate struct {
	ContractID   string          `json:"contract_id"`
	Rate         decimal.Decimal `json:"rate"`
	NextRate     decimal.Decimal `json:"next_rate"`
	Timestamp    time.Time      `json:"timestamp"`
	NextUpdate   time.Time      `json:"next_update"`
}

// FundingPayment represents funding payment
type FundingPayment struct {
	ID           string          `json:"id"`
	UserID       string          `json:"user_id"`
	ContractID   string          `json:"contract_id"`
	PositionSize decimal.Decimal `json:"position_size"`
	Rate         decimal.Decimal `json:"rate"`
	Payment      decimal.Decimal `json:"payment"` // Positive = receive, negative = pay
	Timestamp    time.Time      `json:"timestamp"`
}

// LiquidationEvent represents liquidation event
type LiquidationEvent struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	ContractID    string          `json:"contract_id"`
	PositionID    string          `json:"position_id"`
	LiquidationPrice decimal.Decimal `json:"liquidation_price"`
	MarkPrice    decimal.Decimal `json:"mark_price"`
	RemainingMargin decimal.Decimal `json:"remaining_margin"`
	EventType    string         `json:"event_type"`
	Timestamp    time.Time      `json:"timestamp"`
}

// FuturesEngine manages perpetual futures trading
type FuturesEngine struct {
	mu              sync.RWMutex
	contracts       map[string]*Contract
	positions      map[string]*Position // positionID -> position
	userPositions  map[string]map[string]*Position // userID -> contractID -> position
	orders         map[string]*Order
	orderBook      map[string]*OrderBook
	fundingRates   map[string]*FundingRate
	priceFeed      PriceFeed
	marginCalc    *MarginCalculator
	liquidation   *LiquidationEngine
	insuranceFund *InsuranceFund
	cfg           *EngineConfig
}

// PriceFeed provides price feeds
type PriceFeed interface {
	GetMarkPrice(contractID string) (decimal.Decimal, error)
	GetIndexPrice(contractID string) (decimal.Decimal, error)
	GetLastPrice(contractID string) (decimal.Decimal, error)
	Subscribe(contractID string, callback func(decimal.Decimal)) error
}

// MarginCalculator calculates margin requirements
type MarginCalculator struct {
	defaultMMF decimal.Decimal // Maintenance margin fraction
}

// LiquidationEngine handles liquidations
type LiquidationEngine struct {
	mu        sync.RWMutex
	positions map[string]*Position
}

// InsuranceFund holds insurance fund
type InsuranceFund struct {
	mu          sync.RWMutex
	balance    decimal.Decimal
	daylyUsage decimal.Decimal
}

// EngineConfig holds engine configuration
type EngineConfig struct {
	MaxPositionsPerUser int
	MaxLeverage       int
	MaxOrderSize     decimal.Decimal
	FundingInterval  time.Duration
}

// OrderBook represents order book
type OrderBook struct {
	ContractID string
	Bids       []OrderLevel
	Asks       []OrderLevel
	mu         sync.RWMutex
}

// OrderLevel represents price level
type OrderLevel struct {
	Price  decimal.Decimal
	Orders []string
	Size   decimal.Decimal
}

// NewFuturesEngine creates new futures engine
func NewFuturesEngine() *FuturesEngine {
	return &FuturesEngine{
		contracts:     make(map[string]*Contract),
		positions:    make(map[string]*Position),
		userPositions: make(map[string]map[string]*Position),
		orders:      make(map[string]*Order),
		orderBook:  make(map[string]*OrderBook),
		fundingRates: make(map[string]*FundingRate),
		marginCalc: &MarginCalculator{
			defaultMMF: decimal.NewFromFloat(0.005), // 0.5%
		},
		liquidation: &LiquidationEngine{
			positions: make(map[string]*Position),
		},
		insuranceFund: &InsuranceFund{
			balance: decimal.Zero,
		},
		cfg: &EngineConfig{
			MaxPositionsPerUser: 20,
			MaxLeverage: 125,
			FundingInterval: 8 * time.Hour,
		},
	}
}

// CreateContract creates a new perpetual contract
func (fe *FuturesEngine) CreateContract(contract *Contract) error {
	fe.mu.Lock()
	defer fe.mu.Unlock()

	if _, exists := fe.contracts[contract.Symbol]; exists {
		return fmt.Errorf("contract already exists")
	}

	contract.IsActive = true
	contract.NextFundingTime = time.Now().Add(fe.cfg.FundingInterval)
	fe.contracts[contract.Symbol] = contract
	fe.orderBook[contract.Symbol] = &OrderBook{
		ContractID: contract.Symbol,
		Bids:      []OrderLevel{},
		Asks:      []OrderLevel{},
	}

	// Initialize funding rate
	fe.fundingRates[contract.Symbol] = &FundingRate{
		ContractID: contract.Symbol,
		Rate:       decimal.Zero,
		NextRate:   decimal.Zero,
		Timestamp:  time.Now(),
		NextUpdate: contract.NextFundingTime,
	}

	return nil
}

// OpenPosition opens a new position
func (fe *FuturesEngine) OpenPosition(ctx context.Context, userID, contractSymbol string, side PositionSide, size decimal.Decimal, leverage int, orderType OrderType, price, triggerPrice decimal.Decimal) (*Position, error) {
	// Validate leverage
	if leverage < 1 || leverage > fe.cfg.MaxLeverage {
		return nil, fmt.Errorf("leverage must be between 1 and %d", fe.cfg.MaxLeverage)
	}

	fe.mu.RLock()
	contract, ok := fe.contracts[contractSymbol]
	fe.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("contract not found")
	}

	// Get mark price
	markPrice, err := fe.priceFeed.GetMarkPrice(contractSymbol)
	if err != nil {
		return nil, err
	}

	// Calculate position notional value
	notionalValue := fe.calculateNotionalValue(size, markPrice, contract.ContractType)

	// Calculate required margin
	requiredMargin := fe.marginCalc.CalculateMargin(notionalValue, leverage)

	// Calculate liquidation price
	liqPrice := fe.marginCalc.CalculateLiquidationPrice(markPrice, leverage, side, contract.ContractType)

	position := &Position{
		ID:                generatePositionID(),
		UserID:            userID,
		ContractID:       contract.ID,
		ContractSymbol:   contractSymbol,
		Side:             side,
		Size:             size,
		EntryPrice:      markPrice,
		MarkPrice:       markPrice,
		Leverage:        leverage,
		UnrealizedPnL:   decimal.Zero,
		RealizedPnL:     decimal.Zero,
		LiquidationPrice: liqPrice,
		Margin:          requiredMargin,
		PositionMargin:   requiredMargin,
		MaintenanceMargin: notionalValue.Mul(fe.marginCalc.defaultMMF),
		ROE:             decimal.Zero,
		UpdatedAt:       time.Now(),
	}

	fe.mu.Lock()
	fe.positions[position.ID] = position

	// Add to user positions
	if fe.userPositions[userID] == nil {
		fe.userPositions[userID] = make(map[string]*Position)
	}
	fe.userPositions[userID][contractSymbol] = position

	// Update open interest
	contract.TotalOpenInterest = contract.TotalOpenInterest.Add(size)
	fe.mu.Unlock()

	return position, nil
}

// ClosePosition closes an existing position
func (fe *FuturesEngine) ClosePosition(ctx context.Context, userID, positionID string, size *decimal.Decimal, reduceOnly bool) (*Position, decimal.Decimal, error) {
	fe.mu.RLock()
	position, ok := fe.positions[positionID]
	fe.mu.RUnlock()

	if !ok {
		return nil, decimal.Zero, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, decimal.Zero, fmt.Errorf("unauthorized")
	}

	// Get current mark price
	markPrice, err := fe.priceFeed.GetMarkPrice(position.ContractSymbol)
	if err != nil {
		return nil, decimal.Zero, err
	}

	// Calculate close size
	closeSize := size
	if size == nil || size.IsZero() {
		closeSize = position.Size.Abs()
	} else if size.GreaterThan(position.Size.Abs()) {
		closeSize = position.Size.Abs()
	}

	// Calculate realized PnL
	pnl := fe.calculatePnL(position, closeSize, markPrice)

	// Update position
	position.Size = position.Size.Sub(closeSize)
	position.RealizedPnL = position.RealizedPnL.Add(pnl)

	// Return margin
	returnedMargin := position.Margin.Mul(closeSize).Div(position.Size.Add(closeSize))
	position.Margin = position.Margin.Sub(returnedMargin)
	position.PositionMargin = position.PositionMargin.Sub(returnedMargin)

	// If position closed
	if position.Size.IsZero() {
		fe.mu.Lock()
		delete(fe.positions, positionID)
		delete(fe.userPositions[userID], position.ContractSymbol)
		fe.mu.Unlock()
	}

	position.UpdatedAt = time.Now()

	return position, pnl, nil
}

// UpdatePositionPrices updates position prices (called from price feed)
func (fe *FuturesEngine) UpdatePositionPrices(contractSymbol string) error {
	fe.mu.RLock()
	contract, ok := fe.contracts[contractSymbol]
	fe.mu.RUnlock()

	if !ok {
		return fmt.Errorf("contract not found")
	}

	markPrice, err := fe.priceFeed.GetMarkPrice(contractSymbol)
	if err != nil {
		return err
	}

	fe.mu.RLock()
	positions := fe.userPositions
	fe.mu.RUnlock()

	// Update all positions for this contract
	for userID, userPos := range positions {
		position, ok := userPos[contractSymbol]
		if !ok {
			continue
		}

		position.MarkPrice = markPrice
		position.UnrealizedPnL = fe.calculatePnL(position, position.Size, markPrice)
		position.ROE = fe.calculateROE(position)

		// Check liquidation
		if position.Side == PositionSideLong && markPrice.LessThanOrEqual(position.LiquidationPrice) {
			fe.liquidatePosition(position, markPrice)
		} else if position.Side == PositionSideShort && markPrice.GreaterThanOrEqual(position.LiquidationPrice) {
			fe.liquidatePosition(position, markPrice)
		}

		position.UpdatedAt = time.Now()
		_ = userID
	}

	return nil
}

// calculateNotionalValue calculates position notional value
func (fe *FuturesEngine) calculateNotionalValue(size decimal.Decimal, price decimal.Decimal, contractType ContractType) decimal.Decimal {
	if contractType == ContractTypeLinear {
		// USDT-M: notional = size * price (in USDT)
		return size.Abs().Mul(price)
	}
	// COIN-M: notional = size / price (in BTC)
	return size.Abs().Div(price)
}

// calculatePnL calculates profit/loss
func (fe *FuturesEngine) calculatePnL(position *Position, size decimal.Decimal, currentPrice decimal.Decimal) decimal.Decimal {
	var pnl decimal.Decimal

	if position.Side == PositionSideLong {
		// Long: profit when price goes up
		pnl = size.Mul(currentPrice.Sub(position.EntryPrice))
	} else {
		// Short: profit when price goes down
		pnl = size.Mul(position.EntryPrice.Sub(currentPrice))
	}

	return pnl
}

// calculateROE calculates return on equity
func (fe *FuturesEngine) calculateROE(position *Position) decimal.Decimal {
	if position.Margin.IsZero() {
		return decimal.Zero
	}
	return position.UnrealizedPnL.Div(position.Margin).Mul(decimal.NewFromInt(100))
}

// liquidatePosition liquidates a position
func (fe *FuturesEngine) liquidatePosition(position *Position, markPrice decimal.Decimal) {
	fe.liquidation.mu.Lock()
	fe.liquidation.positions[position.ID] = position
	fe.liquidation.mu.Unlock()

	// Create liquidation event
	event := &LiquidationEvent{
		ID:               generateLiquidationID(),
		UserID:           position.UserID,
		ContractID:      position.ContractID,
		PositionID:      position.ID,
		LiquidationPrice: position.LiquidationPrice,
		MarkPrice:       markPrice,
		RemainingMargin: decimal.Zero, // Would calculate remaining
		EventType:       "LIQUIDATION",
		Timestamp:       time.Now(),
	}
	_ = event

	// In production: would close position, notify user, etc.
}

// AddMargin adds margin to position
func (fe *FuturesEngine) AddMargin(ctx context.Context, userID, positionID string, amount decimal.Decimal) error {
	fe.mu.RLock()
	position, ok := fe.positions[positionID]
	fe.mu.RUnlock()

	if !ok {
		return fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	position.Margin = position.Margin.Add(amount)
	position.PositionMargin = position.PositionMargin.Add(amount)

	// Recalculate liquidation price
	liqPrice := fe.marginCalc.CalculateLiquidationPrice(position.MarkPrice, position.Leverage, position.Side, "")
	position.LiquidationPrice = liqPrice

	return nil
}

// CalculateFunding calculates funding payments
func (fe *FuturesEngine) CalculateFunding(contractSymbol string) ([]*FundingPayment, error) {
	fe.mu.RLock()
	contract, ok := fe.contracts[contractSymbol]
	fe.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("contract not found")
	}

	markPrice, err := fe.priceFeed.GetMarkPrice(contractSymbol)
	if err != nil {
		return nil, err
	}

	indexPrice, err := fe.priceFeed.GetIndexPrice(contractSymbol)
	if err != nil {
		return nil, err
	}

	// Calculate funding rate based on mark - index price
	rate := calculateFundingRate(markPrice, indexPrice)

	var payments []*FundingPayment

	fe.mu.RLock()
	for userID, positions := range fe.userPositions {
		position, ok := positions[contractSymbol]
		if !ok || position.Size.IsZero() {
			continue
		}

		// Calculate payment: size * rate (for linear)
		var payment decimal.Decimal
		if contract.ContractType == ContractTypeLinear {
			payment = position.Size.Mul(rate)
		} else {
			payment = position.Size.Div(markPrice).Mul(rate)
		}

		fundingPayment := &FundingPayment{
			ID:           generateFundingID(),
			UserID:       userID,
			ContractID:   contract.ID,
			PositionSize: position.Size,
			Rate:         rate,
			Payment:      payment,
			Timestamp:    time.Now(),
		}
		payments = append(payments, fundingPayment)
	}
	fe.mu.RUnlock()

	// Update funding rate
	fe.mu.Lock()
	fe.fundingRates[contractSymbol].Rate = rate
	fe.fundingRates[contractSymbol].Timestamp = time.Now()
	fe.mu.Unlock()

	return payments, nil
}

// calculateFundingRate calculates funding rate
func calculateFundingRate(markPrice, indexPrice decimal.Decimal) decimal.Decimal {
	diff := markPrice.Sub(indexPrice)
	
	// Clamp to [-0.75%, 0.75%]
	rate := diff.Div(indexPrice)
	
	maxRate := decimal.NewFromFloat(0.0075)
	if rate.GreaterThan(maxRate) {
		rate = maxRate
	} else if rate.LessThan(maxRate.Neg()) {
		rate = maxRate.Neg()
	}
	
	return rate
}

// GetPosition returns position by ID
func (fe *FuturesEngine) GetPosition(positionID string) (*Position, bool) {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	p, ok := fe.positions[positionID]
	return p, ok
}

// GetUserPosition returns user's position for a contract
func (fe *FuturesEngine) GetUserPosition(userID, contractSymbol string) (*Position, bool) {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	if positions, ok := fe.userPositions[userID]; ok {
		p, ok := positions[contractSymbol]
		return p, ok
	}
	return nil, false
}

// GetContract returns contract by symbol
func (fe *FuturesEngine) GetContract(symbol string) (*Contract, bool) {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	c, ok := fe.contracts[symbol]
	return c, ok
}

// GetFundingRate returns funding rate for contract
func (fe *FuturesEngine) GetFundingRate(contractSymbol string) (*FundingRate, bool) {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	f, ok := fe.fundingRates[contractSymbol]
	return f, ok
}

// Helper functions
func generatePositionID() string {
	return fmt.Sprintf("PERP_POS%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateOrderID() string {
	return fmt.Sprintf("PERP_ORD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateLiquidationID() string {
	return fmt.Sprintf("LIQ%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateFundingID() string {
	return fmt.Sprintf("FUND%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

// CalculateMargin calculates required margin
func (mc *MarginCalculator) CalculateMargin(notionalValue decimal.Decimal, leverage int) decimal.Decimal {
	leverageDec := decimal.NewFromInt(int64(leverage))
	return notionalValue.Div(leverageDec)
}

// CalculateLiquidationPrice calculates liquidation price
func (mc *MarginCalculator) CalculateLiquidationPrice(entryPrice decimal.Decimal, leverage int, side PositionSide, contractType string) decimal.Decimal {
	leverageDec := decimal.NewFromInt(int64(leverage))
	
	// Maintenance margin ratio
	mmRatio := decimal.NewFromFloat(0.005) // 0.5%
	
	// Liquidation price formula
	var liqPrice decimal.Decimal
	
	if side == PositionSideLong {
		// Long: liquidation when price drops
		liqPrice = entryPrice.Mul(decimal.NewFromInt(1)).Sub(
			entryPrice.Div(leverageDec).Mul(decimal.NewFromInt(1).Sub(mmRatio)),
		)
	} else {
		// Short: liquidation when price rises
		liqPrice = entryPrice.Mul(decimal.NewFromInt(1)).Add(
			entryPrice.Div(leverageDec).Mul(decimal.NewFromInt(1).Sub(mmRatio)),
		)
	}
	
	return liqPrice
}

var _ = math.Max // Prevent unused