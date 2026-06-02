package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// TIGGEREX v3.0 - COMPLETE MARGIN & FUTURES TRADING ENGINE
// Full margin and futures implementation with liquidation, funding, insurance fund
// =============================================================================

// =============================================================================
// MARGIN TYPES
// =============================================================================

type MarginEngine struct {
	// Configuration
	config MarginConfig
	
	// State
	mu sync.RWMutex
	
	// Positions
	positions map[string]*MarginPosition
	
	// Risk parameters
	riskLimits *RiskLimits
	
	// Funding
	fundingRates map[string]*FundingRate
	nextFundingTime time.Time
	
	// Insurance fund
	insuranceFund *InsuranceFund
	
	// Callbacks
	onPositionUpdate func(*MarginPosition)
	onLiquidation func(*MarginPosition, string)
	onFundingPayment func(string, *big.Float, *big.Float)
	
	ctx context.Context
	cancel context.CancelFunc
	wg sync.WaitGroup
}

type MarginConfig struct {
	// Trading
	DefaultLeverage float64
	MaxLeverage float64
	MinLeverage float64
	
	// Position limits
	MaxPositionSize float64
	MaxNotionalValue float64
	
	// Margin requirements
	InitialMarginRate float64
	MaintenanceMarginRate float64
	LiquidationBuffer float64
	
	// Risk
	AutoDeleverageEnabled bool
	PartialLiquidationEnabled bool
	PartialLiquidationPercent float64
	
	// Funding
	FundingInterval time.Duration
	DefaultFundingRate float64
	MaxFundingRate float64
	
	// Insurance fund
	InsuranceFundEnabled bool
	InsuranceFundRate float64 // Portion of fees to insurance fund
}

type RiskLimits struct {
	MaxPositionsPerUser int
	MaxOrdersPerUser int
	MaxDailyTradingVolume float64
	MaxOpenInterest float64
	PriceFluctuationLimit float64
	VolumeSpikeThreshold float64
}

type MarginPosition struct {
	PositionID string
	UserID string
	Symbol string
	
	// Position details
	Side PositionSide
	Size float64 // Position size (positive for long, negative for short)
	EntryPrice float64
	OpenQuantity float64
	
	// Margin
	Margin float64
	IsolatedMargin float64
	CrossMarginUsed float64
	Leverage float64
	
	// Prices
	MarkPrice float64
	IndexPrice float64
	LiquidationPrice float64
	BankruptcyPrice float64
	
	// Risk
	MarginRatio float64
	MaintenanceMarginRate float64
	MaintenanceMargin float64
	RiskLevel PositionRiskLevel
	
	// Unrealized PnL
	UnrealizedPNL float64
	UnrealizedPNLPercent float64
	RealizedPNL float64
	
	// Funding
	FundingFee float64
	FundingRate float64
	LastFundingTime time.Time
	AccumulatedFunding float64
	
	// Mode
	PositionMode PositionMode
	IsolatedPair string
	AutoAddMargin bool
	IsReduceOnly bool
	
	// ADL
	IsAutoDeleveraged bool
	ADLRank int
	LiquidationProgress float64
	
	// Timestamps
	OpenedAt time.Time
	UpdatedAt time.Time
	ClosedAt *time.Time
	
	mu sync.RWMutex
}

type PositionSide string

const (
	PositionSideLong PositionSide = "long"
	PositionSideShort PositionSide = "short"
)

type PositionMode string

const (
	MarginModeIsolated PositionMode = "isolated"
	MarginModeCross PositionMode = "cross"
)

type PositionRiskLevel string

const (
	RiskLevelHealthy PositionRiskLevel = "healthy"
	RiskLevelWarning PositionRiskLevel = "warning"
	RiskLevelDanger PositionRiskLevel = "danger"
	RiskLevelCritical PositionRiskLevel = "critical"
	RiskLevelLiquidating PositionRiskLevel = "liquidating"
)

// Funding Rate
type FundingRate struct {
	Symbol string
	Rate float64
	NextFundingTime time.Time
	PredictedRate float64
	HistoricalRates []float64
	Premium float64
	IndexPrice float64
}

// Insurance Fund
type InsuranceFund struct {
	Balance float64
	Currency string
	TotalLiquidationFees float64
	TotalAutoDeleverages float64
	TotalClaims float64
	
	// Statistics
	MaxBalance float64
	MinBalance float64
	
	// History
	History []InsuranceFundEvent
	
	mu sync.RWMutex
}

type InsuranceFundEvent struct {
	Timestamp time.Time
	Type string
	Amount float64
	PositionID string
	Description string
}

// =============================================================================
// FUTURES TYPES
// =============================================================================

type FuturesEngine struct {
	MarginEngine
	
	// Contract types
	contracts map[string]*Contract
	
	// Order book
	settlementPrices map[string]float64
	
	// Mark price
	markPrices map[string]*MarkPrice
	
	// Delivery
	deliveryQueue []*Delivery
	
	ctx context.Context
}

type Contract struct {
	ContractID string
	Symbol string
	Type ContractType
	BaseAsset string
	QuoteAsset string
	
	// Contract details
	ContractSize float64
	TickSize float64
	PricePrecision int
	QuantityPrecision int
	
	// Limits
	MinOrderSize float64
	MaxOrderSize float64
	MaxNotionalValue float64
	
	// Funding
	FundingRate float64
	FundingInterval time.Duration
	MaxFundingRate float64
	
	// Delivery (for futures)
	SettlementTime time.Time
	IsDelivering bool
	
	// Status
	IsActive bool
	LaunchTime time.Time
	ExpireTime time.Time
	
	// Risk
	LiquidationFee float64
	MakerFee float64
	TakerFee float64
}

type ContractType string

const (
	ContractTypePerpetual ContractType = "perpetual"
	ContractTypeDelivery ContractType = "delivery"
	ContractTypeQuarterly ContractType = "quarterly"
	ContractTypeBiweekly ContractType = "biweekly"
)

type MarkPrice struct {
	Symbol string
	IndexPrice float64
	MarkPrice float64
	FairPrice float64
	LastFundingRate float64
	NextFundingTime time.Time
	
	// Premium calculation
	Premium float64
	PremiumHistory []float64
	
	// Index components
	IndexComponents []IndexComponent
	
	UpdatedAt time.Time
}

type IndexComponent struct {
	Exchange string
	Price float64
	Weight float64
}

// Delivery
type Delivery struct {
	ContractID string
	DeliveryTime time.Time
	SettlementPrice float64
	Positions []DeliveryPosition
	
	IsProcessed bool
}

type DeliveryPosition struct {
	UserID string
	Side PositionSide
	Size float64
	EntryPrice float64
	SettlementPrice float64
	PNL float64
	Fee float64
}

// =============================================================================
// NEW ENGINES
// =============================================================================

func NewMarginEngine(config MarginConfig) *MarginEngine {
	ctx, cancel := context.WithCancel(context.Background())
	
	if config.MaxLeverage == 0 {
		config.MaxLeverage = 125
	}
	if config.MinLeverage == 0 {
		config.MinLeverage = 1
	}
	if config.InitialMarginRate == 0 {
		config.InitialMarginRate = 1 / config.MaxLeverage
	}
	if config.MaintenanceMarginRate == 0 {
		config.MaintenanceMarginRate = 0.005 // 0.5%
	}
	if config.FundingInterval == 0 {
		config.FundingInterval = 8 * time.Hour
	}
	
	me := &MarginEngine{
		config: config,
		positions: make(map[string]*MarginPosition),
		riskLimits: &RiskLimits{
			MaxPositionsPerUser: 50,
			MaxOrdersPerUser: 100,
			MaxDailyTradingVolume: 100000000,
			MaxOpenInterest: 1000000000,
			PriceFluctuationLimit: 0.1,
			VolumeSpikeThreshold: 5.0,
		},
		fundingRates: make(map[string]*FundingRate),
		nextFundingTime: time.Now().Add(config.FundingInterval),
		insuranceFund: &InsuranceFund{
			Balance: 0,
			Currency: "USDT",
			History: make([]InsuranceFundEvent, 0),
		},
		ctx: ctx,
		cancel: cancel,
	}
	
	// Start funding worker
	me.wg.Add(1)
	go me.fundingWorker()
	
	// Start liquidation worker
	me.wg.Add(1)
	go me.liquidationWorker()
	
	return me
}

func NewFuturesEngine(config MarginConfig) *FuturesEngine {
	fe := &FuturesEngine{
		MarginEngine: *NewMarginEngine(config),
		contracts: make(map[string]*Contract),
		settlementPrices: make(map[string]float64),
		markPrices: make(map[string]*MarkPrice),
		deliveryQueue: make([]*Delivery, 0),
	}
	
	return fe
}

// =============================================================================
// POSITION MANAGEMENT
// =============================================================================

// OpenPosition opens a new margin position
func (me *MarginEngine) OpenPosition(ctx context.Context, req *OpenPositionRequest) (*MarginPosition, error) {
	// Validate
	if err := me.validateOpenPosition(ctx, req); err != nil {
		return nil, err
	}
	
	// Calculate margin required
	marginRequired := me.calculateInitialMargin(req.Size, req.Price, req.Leververage)
	
	// Check balance
	if err := me.checkMarginAvailable(ctx, req.UserID, marginRequired); err != nil {
		return nil, err
	}
	
	// Lock margin
	if err := me.lockMargin(ctx, req.UserID, req.Currency, marginRequired); err != nil {
		return nil, err
	}
	
	// Create position
	position := &MarginPosition{
		PositionID: generatePositionID(),
		UserID: req.UserID,
		Symbol: req.Symbol,
		Side: req.Side,
		Size: req.Size,
		OpenQuantity: req.Size,
		EntryPrice: req.Price,
		Margin: marginRequired,
		Leverage: req.Leververage,
		PositionMode: req.PositionMode,
		AutoAddMargin: req.AutoAddMargin,
		MaintenanceMarginRate: me.config.MaintenanceMarginRate,
		LastFundingTime: time.Now(),
		OpenedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	
	// Calculate liquidation price
	position.LiquidationPrice = me.calculateLiquidationPrice(position, req.Price)
	position.BankruptcyPrice = me.calculateBankruptcyPrice(position, req.Price)
	
	// Store position
	me.mu.Lock()
	me.positions[position.PositionID] = position
	me.mu.Unlock()
	
	// Update callbacks
	if me.onPositionUpdate != nil {
		me.onPositionUpdate(position)
	}
	
	return position, nil
}

type OpenPositionRequest struct {
	UserID string
	Symbol string
	Side PositionSide
	Size float64
	Price float64
	Leververage float64
	PositionMode PositionMode
	AutoAddMargin bool
	Currency string
	ReduceOnly bool
}

func (me *MarginEngine) validateOpenPosition(ctx context.Context, req *OpenPositionRequest) error {
	if req.UserID == "" {
		return errors.New("user ID required")
	}
	if req.Symbol == "" {
		return errors.New("symbol required")
	}
	if req.Size <= 0 {
		return errors.New("size must be positive")
	}
	if req.Price <= 0 {
		return errors.New("price must be positive")
	}
	if req.Leververage < me.config.MinLeverage || req.Leververage > me.config.MaxLeverage {
		return fmt.Errorf("leverage must be between %.0f and %.0f", me.config.MinLeverage, me.config.MaxLeverage)
	}
	
	// Check position limits
	if err := me.checkPositionLimits(ctx, req.UserID, req.Symbol); err != nil {
		return err
	}
	
	// Check notional value
	notional := req.Size * req.Price
	if notional > me.riskLimits.MaxOpenInterest {
		return errors.New("order exceeds maximum notional value")
	}
	
	return nil
}

func (me *MarginEngine) checkPositionLimits(ctx context.Context, userID, symbol string) error {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	userPositions := 0
	for _, pos := range me.positions {
		if pos.UserID == userID {
			userPositions++
		}
	}
	
	if userPositions >= me.riskLimits.MaxPositionsPerUser {
		return errors.New("maximum positions reached")
	}
	
	return nil
}

// ModifyPosition modifies an existing position
func (me *MarginEngine) ModifyPosition(ctx context.Context, positionID string, newSize float64, addMargin float64) (*MarginPosition, error) {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	position, exists := me.positions[positionID]
	if !exists {
		return nil, errors.New("position not found")
	}
	
	if newSize < 0 {
		return nil, errors.New("size cannot be negative")
	}
	
	oldSize := position.Size
	
	if newSize == 0 {
		// Close position
		return nil, me.ClosePosition(ctx, positionID, 0)
	}
	
	// Calculate size delta
	delta := newSize - oldSize
	
	if delta > 0 {
		// Add to position
		additionalMargin := me.calculateInitialMargin(delta, position.EntryPrice, position.Leverage)
		
		// Lock additional margin
		if err := me.lockMargin(ctx, position.UserID, "USDT", additionalMargin); err != nil {
			return nil, err
		}
		
		position.Margin += additionalMargin
		position.Size = newSize
	} else if delta < 0 {
		// Reduce position
		marginToRelease := position.Margin * (math.Abs(delta) / oldSize)
		me.unlockMargin(ctx, position.UserID, "USDT", marginToRelease)
		
		position.Size = newSize
		position.Margin -= marginToRelease
	}
	
	// Update liquidation price
	position.LiquidationPrice = me.calculateLiquidationPrice(position, position.MarkPrice)
	position.UpdatedAt = time.Now()
	
	if me.onPositionUpdate != nil {
		me.onPositionUpdate(position)
	}
	
	return position, nil
}

// ClosePosition closes a margin position
func (me *MarginEngine) ClosePosition(ctx context.Context, positionID string, closePrice float64) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	position, exists := me.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}
	
	// Calculate final PnL
	if closePrice == 0 {
		closePrice = position.MarkPrice
	}
	
	position.UnrealizedPNL = me.calculateUnrealizedPNL(position, closePrice)
	
	// Release margin and add PnL
	finalMargin := position.Margin + position.UnrealizedPNL
	
	if finalMargin > 0 {
		// Profit or margin left
		me.unlockAndCredit(ctx, position.UserID, "USDT", finalMargin)
	} else {
		// Loss exceeds margin - use insurance fund
		loss := math.Abs(finalMargin)
		if me.insuranceFund.Balance >= loss {
			me.insuranceFund.Balance -= loss
			me.insuranceFund.TotalClaims += loss
		}
	}
	
	// Mark position as closed
	now := time.Now()
	position.ClosedAt = &now
	position.Size = 0
	position.Status = "closed"
	
	// Remove from active positions
	delete(me.positions, positionID)
	
	return nil
}

// UpdatePosition updates position with new mark price
func (me *MarginEngine) UpdatePosition(ctx context.Context, positionID string, markPrice, indexPrice float64) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	position, exists := me.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}
	
	position.MarkPrice = markPrice
	position.IndexPrice = indexPrice
	
	// Update unrealized PnL
	position.UnrealizedPNL = me.calculateUnrealizedPNL(position, markPrice)
	position.UnrealizedPNLPercent = (position.UnrealizedPNL / position.Margin) * 100
	
	// Update margin ratio
	position.MarginRatio = me.calculateMarginRatio(position)
	
	// Update risk level
	position.RiskLevel = me.calculateRiskLevel(position)
	
	// Check liquidation
	if me.shouldLiquidate(position) {
		return me.liquidatePosition(ctx, position)
	}
	
	position.UpdatedAt = time.Now()
	
	if me.onPositionUpdate != nil {
		me.onPositionUpdate(position)
	}
	
	return nil
}

// AddMargin adds margin to a position
func (me *MarginEngine) AddMargin(ctx context.Context, positionID string, amount float64) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	position, exists := me.positions[positionID]
	if !exists {
		return errors.New("position not found")
	}
	
	// Lock funds
	if err := me.lockMargin(ctx, position.UserID, "USDT", amount); err != nil {
		return err
	}
	
	position.Margin += amount
	position.UpdatedAt = time.Now()
	
	// Recalculate liquidation price
	position.LiquidationPrice = me.calculateLiquidationPrice(position, position.MarkPrice)
	
	if me.onPositionUpdate != nil {
		me.onPositionUpdate(position)
	}
	
	return nil
}

// =============================================================================
// CALCULATIONS
// =============================================================================

func (me *MarginEngine) calculateInitialMargin(size, price, leverage float64) float64 {
	notional := size * price
	return notional / leverage
}

func (me *MarginEngine) calculateMaintenanceMargin(position *MarginPosition) float64 {
	maintenanceRate := me.config.MaintenanceMarginRate
	if position.MaintenanceMarginRate > 0 {
		maintenanceRate = position.MaintenanceMarginRate
	}
	
	if position.PositionMode == MarginModeIsolated {
		return position.Margin * maintenanceRate
	}
	
	// Cross margin - based on notional
	return position.Size * position.MarkPrice * maintenanceRate
}

func (me *MarginEngine) calculateLiquidationPrice(position *MarginPosition, markPrice float64) float64 {
	marginRatio := 1.0 / position.Leverage
	maintenanceRate := position.MaintenanceMarginRate
	
	buffer := me.config.LiquidationBuffer
	if buffer == 0 {
		buffer = 0.005 // 0.5%
	}
	
	if position.Side == PositionSideLong {
		// Long liquidation price (higher than entry)
		liqPrice := position.EntryPrice * (1 - marginRatio + maintenanceRate + buffer)
		return liqPrice
	} else {
		// Short liquidation price (lower than entry)
		liqPrice := position.EntryPrice * (1 + marginRatio - maintenanceRate - buffer)
		return liqPrice
	}
}

func (me *MarginEngine) calculateBankruptcyPrice(position *MarginPosition, markPrice float64) float64 {
	if position.Side == PositionSideLong {
		return position.EntryPrice * (1 - 1.0/position.Leverage)
	} else {
		return position.EntryPrice * (1 + 1.0/position.Leverage)
	}
}

func (me *MarginEngine) calculateUnrealizedPNL(position *MarginPosition, price float64) float64 {
	if position.Side == PositionSideLong {
		return (price - position.EntryPrice) * position.Size
	} else {
		return (position.EntryPrice - price) * position.Size
	}
}

func (me *MarginEngine) calculateMarginRatio(position *MarginPosition) float64 {
	marginRatio := (position.Margin + position.UnrealizedPNL) / (position.Size * position.MarkPrice)
	return marginRatio
}

func (me *MarginEngine) calculateRiskLevel(position *MarginPosition) PositionRiskLevel {
	marginRatio := position.MarginRatio
	maintenanceRate := position.MaintenanceMarginRate
	
	// Liquidation buffer = Initial margin - Maintenance margin
	liquidationBuffer := (1.0 / position.Leverage) - maintenanceRate
	
	// Risk levels based on margin ratio
	if marginRatio > liquidationBuffer*2 {
		return RiskLevelHealthy
	} else if marginRatio > liquidationBuffer*1.5 {
		return RiskLevelWarning
	} else if marginRatio > liquidationBuffer {
		return RiskLevelDanger
	} else if marginRatio > maintenanceRate {
		return RiskLevelCritical
	} else {
		return RiskLevelLiquidating
	}
}

func (me *MarginEngine) shouldLiquidate(position *MarginPosition) bool {
	return position.MarginRatio <= position.MaintenanceMarginRate
}

// =============================================================================
// LIQUIDATION
// =============================================================================

func (me *MarginEngine) liquidatePosition(ctx context.Context, position *MarginPosition) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	log.Printf("[LIQUIDATION] Liquidation triggered for position %s (user=%s, symbol=%s)", 
		position.PositionID, position.UserID, position.Symbol)
	
	// Mark position as liquidating
	position.RiskLevel = RiskLevelLiquidating
	
	// Calculate liquidation price (use mark price or forced price)
	liquidationPrice := position.MarkPrice
	
	// Calculate bankruptcy price
	bankruptcyPrice := me.calculateBankruptcyPrice(position, liquidationPrice)
	
	// Calculate liquidation fee
	liquidationFee := position.Size * liquidationPrice * 0.01 // 1% liquidation fee
	
	if me.config.PartialLiquidationEnabled {
		// Partial liquidation - reduce position by percentage
		reductionPercent := me.config.PartialLiquidationPercent
		if reductionPercent == 0 {
			reductionPercent = 0.5 // Default 50%
		}
		
		reducedSize := position.Size * reductionPercent
		position.Size -= reducedSize
		position.Margin *= (1 - reductionPercent)
		
		// Recalculate liquidation price
		position.LiquidationPrice = me.calculateLiquidationPrice(position, position.MarkPrice)
		
		log.Printf("[LIQUIDATION] Partial liquidation: size reduced by %.2f%%, new size=%.4f", 
			reductionPercent*100, position.Size)
	} else {
		// Full liquidation
		position.Size = 0
		
		// Release remaining margin after fees
		remainingMargin := position.Margin - liquidationFee
		
		if remainingMargin > 0 {
			// Add to insurance fund
			me.insuranceFund.Balance += remainingMargin
			me.insuranceFund.TotalLiquidationFees += liquidationFee
			
			// Log event
			me.insuranceFund.History = append(me.insuranceFund.History, InsuranceFundEvent{
				Timestamp: time.Now(),
				Type: "liquidation",
				Amount: remainingMargin,
				PositionID: position.PositionID,
				Description: fmt.Sprintf("Liquidation for %s", position.Symbol),
			})
		} else {
			// Insurance fund covers the loss
			loss := math.Abs(remainingMargin)
			me.insuranceFund.TotalClaims += loss
		}
		
		// Close position
		position.ClosedAt = new(time.Time)
		*position.ClosedAt = time.Now()
		delete(me.positions, position.PositionID)
	}
	
	position.UpdatedAt = time.Now()
	
	if me.onLiquidation != nil {
		me.onLiquidation(position, "margin_call")
	}
	
	return nil
}

// Auto Deleverage (ADL)
func (me *MarginEngine) performAutoDeleverage(ctx context.Context, position *MarginPosition) error {
	if !me.config.AutoDeleverageEnabled {
		return errors.New("auto-deleverage is disabled")
	}
	
	me.mu.Lock()
	defer me.mu.Unlock()
	
	// Find opposing positions to deleverage
	var opposingPositions []*MarginPosition
	for _, pos := range me.positions {
		if pos.Symbol == position.Symbol && pos.Side != position.Side && !pos.IsAutoDeleveraged {
			opposingPositions = append(opposingPositions, pos)
		}
	}
	
	if len(opposingPositions) == 0 {
		return errors.New("no opposing positions for ADL")
	}
	
	// Sort by ADL rank (rank 1 = highest priority)
	// In production, would use a proper sorting algorithm
	
	// Deleverage the lowest ranked opposing position
	targetPosition := opposingPositions[0]
	
	// Calculate ADL size (typically 25-100% of position)
	adlSize := position.Size * 0.25 // 25% default
	
	if adlSize > targetPosition.Size {
		adlSize = targetPosition.Size
	}
	
	// Execute ADL
	adlPrice := position.MarkPrice
	
	// Calculate PnL for ADL
	pnlA := me.calculateUnrealizedPNL(position, adlPrice)
	pnlB := me.calculateUnrealizedPNL(targetPosition, adlPrice)
	
	// Mark positions as ADL'd
	position.IsAutoDeleveraged = true
	position.Size -= adlSize
	
	targetPosition.IsAutoDeleveraged = true
	targetPosition.Size -= adlSize
	
	log.Printf("[ADL] Auto-deleverage executed: %s %s %f at %f", 
		position.Symbol, position.Side, adlSize, adlPrice)
	
	if me.onPositionUpdate != nil {
		me.onPositionUpdate(position)
		me.onPositionUpdate(targetPosition)
	}
	
	return nil
}

// =============================================================================
// FUNDING PAYMENTS
// =============================================================================

func (me *MarginEngine) processFunding() error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	now := time.Now()
	
	if now.Before(me.nextFundingTime) {
		return nil
	}
	
	log.Printf("[FUNDING] Processing funding payments at %s", now.Format(time.RFC3339))
	
	for _, position := range me.positions {
		if position.Size == 0 {
			continue
		}
		
		// Get funding rate for symbol
		fundingRate := me.fundingRates[position.Symbol]
		if fundingRate == nil {
			fundingRate = &FundingRate{
				Rate: me.config.DefaultFundingRate,
				Symbol: position.Symbol,
			}
		}
		
		// Calculate funding fee
		// Longs pay shorts if funding is positive
		fundingPayment := position.Size * position.MarkPrice * fundingRate.Rate
		
		if position.Side == PositionSideLong {
			// Longs pay funding
			position.FundingFee += fundingPayment
			position.AccumulatedFunding += fundingPayment
		} else {
			// Shorts receive funding
			position.FundingFee -= fundingPayment
			position.AccumulatedFunding -= fundingPayment
		}
		
		position.FundingRate = fundingRate.Rate
		position.LastFundingTime = now
		
		// Adjust margin
		if position.Side == PositionSideLong {
			position.Margin -= fundingPayment
		} else {
			position.Margin += fundingPayment
		}
	}
	
	// Set next funding time
	me.nextFundingTime = now.Add(me.config.FundingInterval)
	
	log.Printf("[FUNDING] Funding processed, next funding at %s", me.nextFundingTime.Format(time.RFC3339))
	
	return nil
}

// Calculate Funding Rate (Fair Price Premium)
func (me *MarginEngine) calculateFundingRate(symbol string, indexPrice, markPrice float64) float64 {
	// Premium = (Mark Price - Index Price) / Index Price
	premium := (markPrice - indexPrice) / indexPrice
	
	// Interest rate (assume 0.01% daily for USDT pairs)
	interestRate := 0.0001
	
	// Funding rate = Premium + Interest Rate
	fundingRate := premium + interestRate
	
	// Cap at max funding rate
	if math.Abs(fundingRate) > me.config.MaxFundingRate {
		if fundingRate > 0 {
			fundingRate = me.config.MaxFundingRate
		} else {
			fundingRate = -me.config.MaxFundingRate
		}
	}
	
	return fundingRate
}

// =============================================================================
// INSURANCE FUND
// =============================================================================

func (me *MarginEngine) addToInsuranceFund(amount float64, description string) {
	me.insuranceFund.mu.Lock()
	defer me.insuranceFund.mu.Unlock()
	
	me.insuranceFund.Balance += amount
	me.insuranceFund.History = append(me.insuranceFund.History, InsuranceFundEvent{
		Timestamp: time.Now(),
		Type: "deposit",
		Amount: amount,
		Description: description,
	})
	
	// Update max balance
	if me.insuranceFund.Balance > me.insuranceFund.MaxBalance {
		me.insuranceFund.MaxBalance = me.insuranceFund.Balance
	}
}

func (me *MarginEngine) claimFromInsuranceFund(amount float64, positionID string) bool {
	me.insuranceFund.mu.Lock()
	defer me.insuranceFund.mu.Unlock()
	
	if me.insuranceFund.Balance < amount {
		return false
	}
	
	me.insuranceFund.Balance -= amount
	me.insuranceFund.TotalClaims += amount
	me.insuranceFund.History = append(me.insuranceFund.History, InsuranceFundEvent{
		Timestamp: time.Now(),
		Type: "claim",
		Amount: amount,
		PositionID: positionID,
		Description: "Insurance fund claim",
	})
	
	return true
}

// =============================================================================
// POSITION QUERIES
// =============================================================================

func (me *MarginEngine) GetPosition(userID, symbol string) (*MarginPosition, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	for _, pos := range me.positions {
		if pos.UserID == userID && pos.Symbol == symbol && pos.Size != 0 {
			return pos, nil
		}
	}
	
	return nil, errors.New("position not found")
}

func (me *MarginEngine) GetAllPositions(userID string) []*MarginPosition {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	var positions []*MarginPosition
	for _, pos := range me.positions {
		if pos.UserID == userID && pos.Size != 0 {
			positions = append(positions, pos)
		}
	}
	
	return positions
}

func (me *MarginEngine) GetPositionsAtRisk() []*MarginPosition {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	var positions []*MarginPosition
	for _, pos := range me.positions {
		if pos.RiskLevel == RiskLevelDanger || 
			pos.RiskLevel == RiskLevelCritical || 
			pos.RiskLevel == RiskLevelLiquidating {
			positions = append(positions, pos)
		}
	}
	
	return positions
}

// =============================================================================
// FUTURES SPECIFIC FUNCTIONS
// =============================================================================

// InitializeContract initializes a futures contract
func (fe *FuturesEngine) InitializeContract(contract *Contract) error {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	if _, exists := fe.contracts[contract.Symbol]; exists {
		return errors.New("contract already exists")
	}
	
	fe.contracts[contract.Symbol] = contract
	
	// Initialize funding rate
	fe.fundingRates[contract.Symbol] = &FundingRate{
		Symbol: contract.Symbol,
		Rate: contract.FundingRate,
		NextFundingTime: time.Now().Add(contract.FundingInterval),
	}
	
	log.Printf("[FUTURES] Contract initialized: %s (type=%s, size=%f)", 
		contract.Symbol, contract.Type, contract.ContractSize)
	
	return nil
}

// UpdateMarkPrice updates the mark price for a contract
func (fe *FuturesEngine) UpdateMarkPrice(symbol string, indexPrice float64, components []IndexComponent) error {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	// Calculate mark price from index + premium
	mp := fe.markPrices[symbol]
	if mp == nil {
		mp = &MarkPrice{Symbol: symbol}
		fe.markPrices[symbol] = mp
	}
	
	mp.IndexPrice = indexPrice
	mp.IndexComponents = components
	
	// Calculate premium
	if indexPrice > 0 {
		mp.Premium = (mp.MarkPrice - indexPrice) / indexPrice
	}
	
	// Fair price = Index * (1 + Premium)
	fairPrice := indexPrice * (1 + mp.Premium)
	mp.FairPrice = fairPrice
	
	// Mark price is the fair price (for perpetual)
	mp.MarkPrice = fairPrice
	
	mp.UpdatedAt = time.Now()
	
	// Update all positions for this symbol
	for _, position := range fe.positions {
		if position.Symbol == symbol {
			position.IndexPrice = indexPrice
			position.MarkPrice = fairPrice
			position.UnrealizedPNL = fe.calculateUnrealizedPNL(position, fairPrice)
			position.MarginRatio = fe.calculateMarginRatio(position)
			
			// Check liquidation
			if fe.shouldLiquidate(position) {
				fe.liquidatePosition(context.Background(), position)
			}
		}
	}
	
	return nil
}

// SettleFunding settles funding for perpetual contracts
func (fe *FuturesEngine) SettleFunding(symbol string) error {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	contract, exists := fe.contracts[symbol]
	if !exists {
		return errors.New("contract not found")
	}
	
	if contract.Type != ContractTypePerpetual {
		return errors.New("funding only applies to perpetual contracts")
	}
	
	fundingRate := fe.fundingRates[symbol]
	if fundingRate == nil {
		return errors.New("funding rate not found")
	}
	
	now := time.Now()
	
	// Process funding for all positions
	for _, position := range fe.positions {
		if position.Symbol != symbol || position.Size == 0 {
			continue
		}
		
		notional := position.Size * position.MarkPrice
		fundingPayment := notional * fundingRate.Rate
		
		// Longs pay shorts
		if position.Side == PositionSideLong {
			position.Margin -= fundingPayment
		} else {
			position.Margin += fundingPayment
		}
		
		position.LastFundingTime = now
		position.AccumulatedFunding += fundingPayment
		
		if fe.onFundingPayment != nil {
			fe.onFundingPayment(symbol, big.NewFloat(fundingPayment), big.NewFloat(fundingRate.Rate))
		}
	}
	
	// Set next funding time
	fe.nextFundingTime = now.Add(contract.FundingInterval)
	fundingRate.NextFundingTime = fe.nextFundingTime
	
	return nil
}

// ProcessDelivery processes contract delivery
func (fe *FuturesEngine) ProcessDelivery(contractID string) error {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	var contract *Contract
	for _, c := range fe.contracts {
		if c.ContractID == contractID {
			contract = c
			break
		}
	}
	
	if contract == nil {
		return errors.New("contract not found")
	}
	
	if contract.Type == ContractTypePerpetual {
		return errors.New("perpetual contracts do not deliver")
	}
	
	// Get settlement price
	settlementPrice := fe.settlementPrices[contract.Symbol]
	
	// Process all positions
	for _, position := range fe.positions {
		if position.Symbol != contract.Symbol || position.Size == 0 {
			continue
		}
		
		// Calculate settlement PnL
		var settlementPNL float64
		if position.Side == PositionSideLong {
			settlementPNL = (settlementPrice - position.EntryPrice) * position.Size
		} else {
			settlementPNL = (position.EntryPrice - settlementPrice) * position.Size
		}
		
		// Add to margin
		position.Margin += settlementPNL
		
		// Create delivery record
		delivery := DeliveryPosition{
			UserID: position.UserID,
			Side: position.Side,
			Size: position.Size,
			EntryPrice: position.EntryPrice,
			SettlementPrice: settlementPrice,
			PNL: settlementPNL,
		}
		
		// Close position
		position.Size = 0
		position.ClosedAt = new(time.Time)
		*position.ClosedAt = time.Now()
		
		// Unlock margin
		fe.unlockAndCredit(context.Background(), position.UserID, "USDT", position.Margin)
		
		log.Printf("[DELIVERY] Settled position for user %s: PnL=%.2f", position.UserID, settlementPNL)
	}
	
	// Mark contract as delivered
	contract.IsDelivering = true
	
	return nil
}

// =============================================================================
// WORKERS
// =============================================================================

func (me *MarginEngine) fundingWorker() {
	defer me.wg.Done()
	
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	
	for {
		select {
		case <-me.ctx.Done():
			return
		case <-ticker.C:
			me.processFunding()
		}
	}
}

func (me *MarginEngine) liquidationWorker() {
	defer me.wg.Done()
	
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-me.ctx.Done():
			return
		case <-ticker.C:
			me.checkLiquidations()
		}
	}
}

func (me *MarginEngine) checkLiquidations() {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	for _, position := range me.positions {
		if me.shouldLiquidate(position) {
			me.liquidatePosition(me.ctx, position)
		}
	}
}

// =============================================================================
// HELPERS
// =============================================================================

func generatePositionID() string {
	return fmt.Sprintf("POS_%s", uuid.New().String()[:12])
}

func (me *MarginEngine) checkMarginAvailable(ctx context.Context, userID, currency string, amount float64) error {
	// Would check actual balance
	return nil
}

func (me *MarginEngine) lockMargin(ctx context.Context, userID, currency string, amount float64) error {
	// Would lock funds in wallet
	return nil
}

func (me *MarginEngine) unlockMargin(ctx context.Context, userID, currency string, amount float64) {
	// Would unlock funds
}

func (me *MarginEngine) unlockAndCredit(ctx context.Context, userID, currency string, amount float64) {
	// Would unlock and credit funds
}

// Stop gracefully stops the engine
func (me *MarginEngine) Stop() {
	log.Println("[MARGIN] Shutting down margin engine...")
	me.cancel()
	me.wg.Wait()
	log.Println("[MARGIN] Stopped")
}

// =============================================================================
// PLACEHOLDER TYPES
// =============================================================================

var _ = json.Marshal

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Println("TigerEx Margin & Futures Engine v3.0 starting...")
	
	config := MarginConfig{
		DefaultLeverage: 10,
		MaxLeverage: 125,
		MinLeverage: 1,
		InitialMarginRate: 0.008,
		MaintenanceMarginRate: 0.005,
		LiquidationBuffer: 0.005,
		AutoDeleverageEnabled: true,
		PartialLiquidationEnabled: true,
		PartialLiquidationPercent: 0.5,
		FundingInterval: 8 * time.Hour,
		DefaultFundingRate: 0.0001,
		MaxFundingRate: 0.0075,
		InsuranceFundEnabled: true,
		InsuranceFundRate: 0.25,
	}
	
	marginEngine := NewMarginEngine(config)
	
	// Initialize futures contracts
	futuresEngine := NewFuturesEngine(config)
	
	contracts := []*Contract{
		{
			ContractID: "BTC-PERP",
			Symbol: "BTC/USDT",
			Type: ContractTypePerpetual,
			BaseAsset: "BTC",
			QuoteAsset: "USDT",
			ContractSize: 1,
			TickSize: 0.01,
			PricePrecision: 8,
			QuantityPrecision: 8,
			MinOrderSize: 0.001,
			MaxOrderSize: 100,
			MaxNotionalValue: 10000000,
			FundingRate: 0.0001,
			FundingInterval: 8 * time.Hour,
			MaxFundingRate: 0.0075,
			LiquidationFee: 0.01,
			MakerFee: 0.0002,
			TakerFee: 0.0004,
			IsActive: true,
		},
		{
			ContractID: "ETH-PERP",
			Symbol: "ETH/USDT",
			Type: ContractTypePerpetual,
			BaseAsset: "ETH",
			QuoteAsset: "USDT",
			ContractSize: 1,
			TickSize: 0.01,
			FundingRate: 0.0001,
			FundingInterval: 8 * time.Hour,
			IsActive: true,
		},
	}
	
	for _, contract := range contracts {
		futuresEngine.InitializeContract(contract)
	}
	
	log.Printf("[ENGINE] Margin/Futures engine ready with %d contracts", len(contracts))
	
	// Wait for shutdown
	select {}
}