// Package engine provides the margin trading engine with cross/isolated margin support.
package engine

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// MarginMode represents margin mode (cross or isolated)
type MarginMode string

const (
	MarginModeCross    MarginMode = "CROSS"
	MarginModeIsolated MarginMode = "ISOLATED"
)

// PositionSide represents long or short
type PositionSide string

const (
	PositionSideLong  PositionSide = "LONG"
	PositionSideShort PositionSide = "SHORT"
)

// Position represents a margin position
type Position struct {
	ID                string                  `json:"id"`
	UserID            string                  `json:"user_id"`
	AccountID       string                  `json:"account_id"`
	Symbol           string                  `json:"symbol"`
	MarginMode       MarginMode              `json:"margin_mode"`
	Side             PositionSide           `json:"side"`
	Size             decimal.Decimal        `json:"size"`
	EntryPrice      decimal.Decimal        `json:"entry_price"`
	MarkPrice       decimal.Decimal        `json:"mark_price"`
	Leverage        decimal.Decimal        `json:"leverage"`
	InitialMargin   decimal.Decimal        `json:"initial_margin"`
	MarginBalance   decimal.Decimal        `json:"margin_balance"`
	UnrealizedPnL   decimal.Decimal        `json:"unrealized_pnl"`
	RealizedPnL     decimal.Decimal        `json:"realized_pnl"`
	LiquidationPrice decimal.Decimal        `json:"liquidation_price"`
	IsolatedPair    string                `json:"isolated_pair,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// MarginAccount represents a margin account
type MarginAccount struct {
	ID                  string                  `json:"id"`
	UserID              string                  `json:"user_id"`
	Config              *MarginConfig            `json:"config"`
	IsolatedPositions   map[string]*Position    `json:"isolated_positions"`
	CrossPosition     *Position              `json:"cross_position"`
	TotalEquity       decimal.Decimal        `json:"total_equity"`
	TotalMargin       decimal.Decimal        `json:"total_margin"`
	TotalAvailable    decimal.Decimal        `json:"total_available"`
	MarginRatio       decimal.Decimal        `json:"margin_ratio"`
	MaintenanceMargin decimal.Decimal        `json:"maintenance_margin"`
}

// MarginConfig holds margin account configuration
type MarginConfig struct {
	MarginMode      MarginMode           `json:"margin_mode"`
	Leverage      decimal.Decimal      `json:"leverage"`
	AutoTopUp      bool              `json:"auto_topup"`
	StopOutEnabled bool              `json:"stop_out_enabled"`
}

// MarginOrder represents a margin order
type MarginOrder struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Symbol       string          `json:"symbol"`
	MarginMode   MarginMode     `json:"margin_mode"`
	Side         PositionSide   `json:"side"`
	OrderType    string         `json:"order_type"`
	Size         decimal.Decimal `json:"size"`
	EntryPrice  decimal.Decimal `json:"entry_price"`
	StopLoss    *decimal.Decimal `json:"stop_loss,omitempty"`
	TakeProfit  *decimal.Decimal `json:"take_profit,omitempty"`
	Status      string         `json:"status"`
	CreatedAt   time.Time     `json:"created_at"`
	FilledAt    *time.Time    `json:"filled_at,omitempty"`
}

// Interest represents margin interest accrual
type Interest struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	AccountID  string          `json:"account_id"`
	Symbol     string          `json:"symbol"`
	Amount     decimal.Decimal `json:"amount"`
	Rate       decimal.Decimal `json:"rate"`
	AccruedAt  time.Time      `json:"accrued_at"`
	PaidAt     *time.Time     `json:"paid_at,omitempty"`
}

// MarginEngine handles all margin trading operations
type MarginEngine struct {
	mu                 sync.RWMutex
	positions          map[string]*Position
	positionBySymbol  map[string]map[string]*Position // userID -> symbol -> position
	marginAccounts   map[string]*MarginAccount
	interestRates   map[string]decimal.Decimal // symbol -> daily interest rate
	liqTemplates  map[string]*LiquidationTemplate
	feeCalc       *FeeCalculator
}

// FeeCalculator for margin trading
type FeeCalculator struct {
	makerFee decimal.Decimal
	takerFee decimal.Decimal
}

// LiquidationTemplate calculates liquidation prices
type LiquidationTemplate struct {
	LiquidationBuffer decimal.Decimal
	MinMarginRatio   decimal.Decimal
	PartialLiqqRatio decimal.Decimal
}

// NewMarginEngine creates a new margin engine
func NewMarginEngine() *MarginEngine {
	return &MarginEngine{
		positions:        make(map[string]*Position),
		positionBySymbol: make(map[string]map[string]*Position),
		marginAccounts:  make(map[string]*MarginAccount),
		interestRates:   make(map[string]decimal.Decimal),
		liqTemplates:   make(map[string]*LiquidationTemplate),
		feeCalc:        &FeeCalculator{
			makerFee: decimal.NewFromFloat(0.0001),
			takerFee: decimal.NewFromFloat(0.0001),
		},
	}
}

// SetInterestRate sets the daily interest rate for a symbol
func (me *MarginEngine) SetInterestRate(symbol string, rate decimal.Decimal) {
	me.mu.Lock()
	defer me.mu.Unlock()
	me.interestRates[symbol] = rate
}

// SetLeveragePreset sets leverage presets for a symbol
func (me *MarginEngine) SetLeveragePreset(symbol string, maxLeverage int) {
	// Would set in config - placeholder
}

// OpenPosition opens a new margin position
func (me *MarginEngine) OpenPosition(ctx context.Context, req *OpenPositionRequest) (*Position, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	// Validate leverage
	if req.LessThan(decimal.NewFromInt(1)) || req.LessThan(decimal.NewFromInt(100)) {
		return nil, fmt.Errorf("leverage must be between 1x and 100x")
	}

	// Calculate initial margin required
	notionalValue := req.Size.Mul(req.EntryPrice)
	initialMargin := notionalValue.Div(req.Leverage)

	// Check account has sufficient balance
	account, ok := me.marginAccounts[req.UserID]
	if !ok {
		return nil, fmt.Errorf("margin account not found")
	}

	if account.TotalAvailable.LessThan(initialMargin) {
		return nil, fmt.Errorf("insufficient margin balance")
	}

	// Calculate liquidation price
	liqPrice := me.calculateLiquidationPrice(req.EntryPrice, req.Leverage, req.Side, req.MarginMode)

	position := &Position{
		ID:              generatePositionID(),
		UserID:          req.UserID,
		AccountID:       req.AccountID,
		Symbol:          req.Symbol,
		MarginMode:     req.MarginMode,
		Side:           req.Side,
		Size:           req.Size,
		EntryPrice:     req.EntryPrice,
		MarkPrice:      req.EntryPrice,
		Leverage:       req.Leverage,
		InitialMargin: initialMargin,
		MarginBalance:  initialMargin,
		UnrealizedPnL: decimal.Zero,
		RealizedPnL:    decimal.Zero,
		LiquidationPrice: liqPrice,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	// Store position
	key := req.UserID + ":" + req.Symbol
	if req.MarginMode == MarginModeIsolated {
		if account.IsolatedPositions == nil {
			account.IsolatedPositions = make(map[string]*Position)
		}
		account.IsolatedPositions[req.Symbol] = position
	} else {
		account.CrossPosition = position
	}

	me.positions[position.ID] = position
	if me.positionBySymbol[req.UserID] == nil {
		me.positionBySymbol[req.UserID] = make(map[string]*Position)
	}
	me.positionBySymbol[req.UserID][req.Symbol] = position

	// Deduct from available
	account.TotalAvailable = account.TotalAvailable.Sub(initialMargin)
	account.TotalMargin = account.TotalMargin.Add(initialMargin)

	return position, nil
}

// ClosePosition closes an existing position
func (me *MarginEngine) ClosePosition(ctx context.Context, userID, positionID string, closeSize *decimal.Decimal) (*Position, decimal.Decimal, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	position, ok := me.positions[positionID]
	if !ok {
		return nil, decimal.Zero, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, decimal.Zero, fmt.Errorf("unauthorized")
	}

	size := closeSize
	if size == nil || size.IsZero() || size.GreaterThanOrEqual(position.Size) {
		size = position.Size
	}

	// Calculate PnL
	pnl := calculatePositionPnL(position, *size)

	// Update position
	position.Size = position.Size.Sub(*size)
	position.RealizedPnL = position.RealizedPnL.Add(pnl)

	// Return margin
	returnedMargin := position.InitialMargin.Mul(*size).Div(position.Size.Add(*size))
	position.MarginBalance = position.MarginBalance.Add(returnedMargin)

	if position.Size.IsZero() {
		position.Size = decimal.Zero
		delete(me.positions, positionID)
	}

	position.UpdatedAt = time.Now()

	return position, pnl, nil
}

// AddMargin adds margin to a position
func (me *MarginEngine) AddMargin(ctx context.Context, userID, positionID string, amount decimal.Decimal) (*Position, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	position, ok := me.positions[positionID]
	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	// Check account has sufficient balance
	account, ok := me.marginAccounts[userID]
	if !ok {
		return nil, fmt.Errorf("margin account not found")
	}

	if account.TotalAvailable.LessThan(amount) {
		return nil, fmt.Errorf("insufficient balance")
	}

	// Add to position margin
	position.MarginBalance = position.MarginBalance.Add(amount)

	// Update account
	account.TotalAvailable = account.TotalAvailable.Sub(amount)
	account.TotalMargin = account.TotalMargin.Add(amount)

	// Recalculate liquidation price
	position.LiquidationPrice = me.calculateLiquidationPrice(
		position.EntryPrice,
		position.Leverage,
		position.Side,
		position.MarginMode,
	)

	position.UpdatedAt = time.Now()

	return position, nil
}

// UpdateMarginMode updates the margin mode for a position
func (me *MarginEngine) UpdateMarginMode(ctx context.Context, userID, positionID string, mode MarginMode) (*Position, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	position, ok := me.positions[positionID]
	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	if position.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	// Convert position mode
	// In production, would transfer margin between cross/isolated
	position.MarginMode = mode

	position.UpdatedAt = time.Now()
	return position, nil
}

// UpdatePositionPrices updates position prices (called from price feed)
func (me *MarginEngine) UpdatePositionPrices(symbol string, markPrice decimal.Decimal) {
	me.mu.Lock()
	defer me.mu.Unlock()

	// Update all positions for symbol
	for _, positions := range me.positionBySymbol {
		if pos, ok := positions[symbol]; ok {
			pos.MarkPrice = markPrice
			pos.UnrealizedPnL = calculateUnrealizedPnL(pos, markPrice)
			
			// Check liquidation
			if pos.LiquidationPrice.IsZero() {
				continue
			}
			
			if pos.Side == PositionSideLong && markPrice.LessThanOrEqual(pos.LiquidationPrice) {
				// Trigger liquidation
				pos.Status = "LIQUIDATED"
			} else if pos.Side == PositionSideShort && markPrice.GreaterThanOrEqual(pos.LiquidationPrice) {
				pos.Status = "LIQUIDATED"
			}
			
			pos.UpdatedAt = time.Now()
		}
	}
}

// GetPositions returns positions for a user
func (me *MarginEngine) GetPositions(userID string) []*Position {
	me.mu.RLock()
	defer me.mu.RUnlock()

	var result []*Position
	userPositions := me.positionBySymbol[userID]
	if userPositions == nil {
		return result
	}

	for _, pos := range userPositions {
		result = append(result, pos)
	}
	return result
}

// GetPosition returns a specific position
func (me *MarginEngine) GetPosition(positionID string) (*Position, bool) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	pos, ok := me.positions[positionID]
	return pos, ok
}

// GetAccount returns margin account for a user
func (me *MarginEngine) GetAccount(userID string) (*MarginAccount, bool) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	account, ok := me.marginAccounts[userID]
	return account, ok
}

// CreateMarginAccount creates a new margin account
func (me *MarginEngine) CreateMarginAccount(userID, accountID string) *MarginAccount {
	me.mu.Lock()
	defer me.mu.Unlock()

	account := &MarginAccount{
		ID:                generateAccountID(),
		UserID:            userID,
		Config:            &MarginConfig{
			MarginMode:      MarginModeCross,
			Leverage:        decimal.NewFromInt(10),
			AutoTopUp:       false,
			StopOutEnabled:  true,
		},
		IsolatedPositions: make(map[string]*Position),
		CrossPosition:   nil,
		TotalEquity:     decimal.Zero,
		TotalMargin:     decimal.Zero,
		TotalAvailable: decimal.Zero,
		MarginRatio:     decimal.Zero,
	}

	me.marginAccounts[userID] = account
	return account
}

// DepositMargin adds balance to margin account
func (me *MarginEngine) DepositMargin(userID string, amount decimal.Decimal) error {
	me.mu.Lock()
	defer me.mu.Unlock()

	account, ok := me.marginAccounts[userID]
	if !ok {
		return fmt.Errorf("margin account not found")
	}

	account.TotalEquity = account.TotalEquity.Add(amount)
	account.TotalAvailable = account.TotalAvailable.Add(amount)

	return nil
}

// WithdrawMargin removes balance from margin account
func (me *MarginEngine) WithdrawMargin(userID string, amount decimal.Decimal) error {
	me.mu.Lock()
	defer me.mu.Unlock()

	account, ok := me.marginAccounts[userID]
	if !ok {
		return fmt.Errorf("margin account not found")
	}

	if account.TotalAvailable.LessThan(amount) {
		return fmt.Errorf("insufficient available balance")
	}

	account.TotalEquity = account.TotalEquity.Sub(amount)
	account.TotalAvailable = account.TotalAvailable.Sub(amount)

	return nil
}

// ForceLiquidation forces liquidation of a position
func (me *MarginEngine) ForceLiquidation(ctx context.Context, positionID string) (*Position, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	position, ok := me.positions[positionID]
	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	// Calculate remaining value
	remainingValue := position.MarginBalance.Add(position.UnrealizedPnL)
	position.Status = "LIQUIDATED"

	// In production, would execute liquidation order
	// and distribute remaining to user

	position.UpdatedAt = time.Now()
	return position, nil
}

// calculateLiquidationPrice calculates liquidation price
func (me *MarginEngine) calculateLiquiationPrice(entryPrice, leverage decimal.Decimal, side PositionSide, mode MarginMode) decimal.Decimal {
	leverageFloat, _ := leverage.Float64()
	
	var ratio decimal.Decimal
	if mode == MarginModeCross {
		ratio = decimal.NewFromFloat(1.0 / (leverageFloat - 0.8)) // Cross margin buffer
	} else {
		ratio = decimal.NewFromFloat(1.0 / (leverageFloat - 0.5)) // Isolated margin has less buffer
	}

	if side == PositionSideLong {
		return entryPrice.Mul(decimal.NewFromFloat(1)).Sub(entryPrice.Mul(ratio))
	}
	return entryPrice.Mul(decimal.NewFromFloat(1)).Add(entryPrice.Mul(ratio))
}

// calculateUnrealizedPnL calculates unrealized PnL
func calculateUnrealizedPnL(position *Position, currentPrice decimal.Decimal) decimal.Decimal {
	if position.Side == PositionSideLong {
		return currentPrice.Sub(position.EntryPrice).Mul(position.Size)
	}
	return position.EntryPrice.Sub(currentPrice).Mul(position.Size)
}

// calculatePositionPnL calculates realized PnL for a close
func calculatePositionPnL(position *Position, closeSize decimal.Decimal) decimal.Decimal {
	unrealized := calculateUnrealizedPnL(position, position.MarkPrice)
	return unrealized.Mul(closeSize).Div(position.Size)
}

// Helper functions
func generatePositionID() string {
	return fmt.Sprintf("MARGIN%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateAccountID() string {
	return fmt.Sprintf("MARGIN_ACC%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

// OpenPositionRequest represents a request to open a position
type OpenPositionRequest struct {
	UserID      string
	AccountID   string
	Symbol     string
	MarginMode MarginMode
	Side      PositionSide
	Size       decimal.Decimal
	EntryPrice decimal.Decimal
	Leverage   decimal.Decimal
}

// SetLeverageInfo sets leverage info for calculations
func calculateLiquidationPrice(entryPrice, leverage, initMargin, maintMargin decimal.Decimal, isLong bool) decimal.Decimal {
	// Maintenance margin ratio (typically 0.5%)
	maintRatio := decimal.NewFromFloat(0.005)
	
	if isLong {
		// Long: liquidation when price drops below
		liqPrice := entryPrice.Mul(decimal.NewFromFloat(1)).Sub(initMargin.Mul(maintRatio).Div(entryPrice))
		return liqPrice
	}
	
	// Short: liquidation when price rises above
	liqPrice := entryPrice.Mul(decimal.NewFromFloat(1)).Add(initMargin.Mul(maintRatio).Div(entryPrice))
	return liqPrice
}

var _ = math.Max // Prevent unused import