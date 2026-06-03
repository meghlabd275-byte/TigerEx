// =============================================================================
// TIGEREX v3.0 - COMPLETE MARGIN TRADING ENGINE
// Cross-margin and isolated margin with liquidation
// =============================================================================

package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// MARGIN TYPES
// =============================================================================

type MarginAccount struct {
	UserID           string          `json:"userId"`
	Mode             MarginMode      `json:"mode"` // cross, isolated
	Positions        map[string]*MarginPosition `json:"positions"`
	TotalMargin      float64         `json:"totalMargin"`
	TotalDebt        float64         `json:"totalDebt"`
	TotalInterest    float64         `json:"totalInterest"`
	RiskLevel        RiskLevel       `json:"riskLevel"`
	LiquidationLevel float64         `json:"liquidationLevel"`
	MarginRatio      float64         `json:"marginRatio"`
	AvailableMargin  float64         `json:"availableMargin"`
	CreatedAt        int64           `json:"createdAt"`
	UpdatedAt        int64           `json:"updatedAt"`
}

type MarginMode string

const (
	MarginModeCross     MarginMode = "cross"
	MarginModeIsolated  MarginMode = "isolated"
)

type MarginPosition struct {
	PositionID       string        `json:"positionId"`
	UserID           string        `json:"userId"`
	MarketSymbol     string        `json:"marketSymbol"`
	Side             OrderSide     `json:"side"` // long, short
	Size             float64       `json:"size"`
	EntryPrice       float64       `json:"entryPrice"`
	Margin           float64       `json:"margin"`
	IsolatedMargin   float64       `json:"isolatedMargin,omitempty"`
	Leverage         float64       `json:"leverage"`
	LiquidationPrice float64       `json:"liquidationPrice"`
	MarkPrice        float64       `json:"markPrice"`
	IndexPrice       float64       `json:"indexPrice"`
	UnrealizedPNL    float64       `json:"unrealizedPnl"`
	RealizedPNL      float64       `json:"realizedPnl"`
	InterestPaid     float64       `json:"interestPaid"`
	AutoTopUp        bool          `json:"autoTopUp"`
	AutoTopUpThreshold float64     `json:"autoTopUpThreshold"`
	Mode             MarginMode    `json:"mode"`
	OpenedAt         int64         `json:"openedAt"`
	UpdatedAt        int64         `json:"updatedAt"`
}

type RiskLevel string

const (
	RiskLevelHealthy      RiskLevel = "healthy"
	RiskLevelWarning      RiskLevel = "warning"
	RiskLevelDanger       RiskLevel = "danger"
	RiskLevelLiquidation  RiskLevel = "liquidation"
)

// Margin Order Request
type MarginOrderRequest struct {
	UserID        string     `json:"userId"`
	MarketSymbol  string     `json:"marketSymbol"`
	Side          OrderSide  `json:"side"`
	Type          OrderType  `json:"type"`
	Price         float64    `json:"price"`
	Quantity      float64    `json:"quantity"`
	Leverage      float64    `json:"leverage"`
	MarginMode    MarginMode `json:"marginMode"`
	StopPrice     float64    `json:"stopPrice,omitempty"`
	TimeInForce   TimeInForce `json:"timeInForce,omitempty"`
}

// =============================================================================
// MARGIN ENGINE
// =============================================================================

type MarginEngine struct {
	mu sync.RWMutex

	// Margin accounts
	accounts map[string]*MarginAccount

	// Position tracking
	positions map[string]*MarginPosition

	// Configuration
	config MarginConfig

	// Interest rates per asset
	interestRates map[string]*InterestRate

	// Insurance fund
	insuranceFund float64

	// Statistics
	stats MarginStats

	// Callbacks
	onLiquidation    func(*MarginPosition, string)
	onMarginCall     func(*MarginAccount)
	onPositionUpdate func(*MarginPosition)

	// Context for background workers
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type MarginConfig struct {
	DefaultLeverage         float64
	MaxLeverage             float64
	MinLeverage             float64
	LiquidationBuffer       float64  // e.g., 0.8 = 80% margin ratio
	MarginCallBuffer        float64  // e.g., 1.1 = 110% margin ratio
	AutoDeleverageEnabled   bool
	InsuranceFundRate       float64
	MaxPositionSize         float64
}

type MarginStats struct {
	mu                   sync.Mutex
	TotalLiquidations    int64
	TotalMarginCalls     int64
	InsuranceFundBalance float64
	LiquidatedVolume     float64
}

type InterestRate struct {
	BorrowRate    float64 // Hourly rate
	LendRate      float64
	BorrowAPY     float64
	LendAPY       float64
}

// =============================================================================
// MARGIN ENGINE METHODS
// =============================================================================

func NewMarginEngine() *MarginEngine {
	ctx, cancel := context.WithCancel(context.Background())
	
	engine := &MarginEngine{
		accounts:      make(map[string]*MarginAccount),
		positions:     make(map[string]*MarginPosition),
		interestRates: make(map[string]*InterestRate),
		ctx:           ctx,
		cancel:        cancel,
		config: MarginConfig{
			DefaultLeverage:       10,
			MaxLeverage:           125,
			MinLeverage:           1,
			LiquidationBuffer:     0.8,
			MarginCallBuffer:      1.1,
			AutoDeleverageEnabled: true,
			InsuranceFundRate:     0.0001,
			MaxPositionSize:       1000000,
		},
	}

	// Initialize interest rates for major assets
	engine.initializeInterestRates()

	// Start background workers
	engine.startWorkers()

	return engine
}

func (e *MarginEngine) initializeInterestRates() {
	assets := []string{"BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"}
	
	for _, asset := range assets {
		e.interestRates[asset] = &InterestRate{
			BorrowRate: 0.000004, // 0.0004% per hour ~ 0.0096% daily
			LendRate:   0.000003, // 0.0003% per hour
			BorrowAPY: 0.035,    // 3.5% APY
			LendAPY:   0.025,    // 2.5% APY
		}
	}
}

func (e *MarginEngine) startWorkers() {
	// Interest calculation worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.calculateInterest()
			}
		}
	}()

	// Liquidation monitor worker
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for {
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
				e.monitorLiquidations()
			}
		}
	}()
}

func (e *MarginEngine) Shutdown() {
	e.cancel()
	e.wg.Wait()
}

// =============================================================================
// ACCOUNT MANAGEMENT
// =============================================================================

func (e *MarginEngine) GetOrCreateAccount(userID string) *MarginAccount {
	e.mu.Lock()
	defer e.mu.Unlock()

	if account, ok := e.accounts[userID]; ok {
		return account
	}

	account := &MarginAccount{
		UserID:     userID,
		Mode:      MarginModeCross,
		Positions: make(map[string]*MarginPosition),
		CreatedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}

	e.accounts[userID] = account
	return account
}

func (e *MarginEngine) SetMarginMode(userID string, mode MarginMode) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	account := e.GetOrCreateAccount(userID)

	// Check if user has any isolated positions
	if mode == MarginModeCross {
		for symbol, pos := range account.Positions {
			if pos.Mode == MarginModeIsolated && pos.Size > 0 {
				return fmt.Errorf("cannot switch to cross mode: open isolated position on %s", symbol)
			}
		}
	}

	account.Mode = mode
	account.UpdatedAt = time.Now().UnixMilli()

	return nil
}

func (e *MarginEngine) GetAccount(userID string) (*MarginAccount, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if account, ok := e.accounts[userID]; ok {
		return account, nil
	}
	return nil, errors.New("margin account not found")
}

func (e *MarginEngine) AddMargin(userID, symbol string, amount float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	account := e.GetOrCreateAccount(userID)

	if position, ok := account.Positions[symbol]; ok {
		position.Margin += amount
		if position.Mode == MarginModeIsolated {
			position.IsolatedMargin += amount
		}
	} else {
		return errors.New("position not found")
	}

	account.UpdatedAt = time.Now().UnixMilli()
	log.Printf("[INFO] Margin added: %s %s %.8f", userID, symbol, amount)

	return nil
}

func (e *MarginEngine) ReduceMargin(userID, symbol string, amount float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	account := e.GetOrCreateAccount(userID)

	if position, ok := account.Positions[symbol]; ok {
		maxReduce := position.Margin - (position.Size * position.LiquidationPrice / position.Leverage)
		if amount > maxReduce {
			return errors.New("cannot reduce margin below liquidation level")
		}

		position.Margin -= amount
		if position.Mode == MarginModeIsolated {
			position.IsolatedMargin -= amount
		}
	} else {
		return errors.New("position not found")
	}

	account.UpdatedAt = time.Now().UnixMilli()
	log.Printf("[INFO] Margin reduced: %s %s %.8f", userID, symbol, amount)

	return nil
}

// =============================================================================
// POSITION MANAGEMENT
// =============================================================================

func (e *MarginEngine) OpenPosition(req *MarginOrderRequest) (*MarginPosition, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Validate leverage
	if req.Leverage < e.config.MinLeverage || req.Leverage > e.config.MaxLeverage {
		return nil, fmt.Errorf("leverage must be between %.0f and %.0f", e.config.MinLeverage, e.config.MaxLeverage)
	}

	// Get or create account
	account := e.GetOrCreateAccount(req.UserID)
	account.Mode = req.MarginMode

	// Calculate required margin
	positionValue := req.Price * req.Quantity
	requiredMargin := positionValue / req.Leverage

	// Check if isolated mode and enough margin
	if req.MarginMode == MarginModeIsolated {
		// For isolated, need full margin upfront
		if account.AvailableMargin < requiredMargin {
			return nil, errors.New("insufficient margin")
		}
	} else {
		// For cross margin, check total available
		if account.AvailableMargin < requiredMargin {
			return nil, errors.New("insufficient margin")
		}
	}

	// Calculate liquidation price
	var liquidationPrice float64
	if req.Side == OrderSideBuy {
		liquidationPrice = req.Price * (1 - 1/e.config.LiquidationBuffer)
	} else {
		liquidationPrice = req.Price * (1 + 1/e.config.LiquidationBuffer)
	}

	// Create position
	positionID := uuid.New().String()[:12]
	position := &MarginPosition{
		PositionID:        positionID,
		UserID:           req.UserID,
		MarketSymbol:     req.MarketSymbol,
		Side:            req.Side,
		Size:            req.Quantity,
		EntryPrice:      req.Price,
		Margin:          requiredMargin,
		IsolatedMargin:  requiredMargin,
		Leverage:        req.Leverage,
		LiquidationPrice: liquidationPrice,
		MarkPrice:       req.Price,
		IndexPrice:      req.Price,
		UnrealizedPNL:   0,
		RealizedPNL:     0,
		InterestPaid:    0,
		AutoTopUp:       false,
		Mode:            req.MarginMode,
		OpenedAt:        time.Now().UnixMilli(),
		UpdatedAt:        time.Now().UnixMilli(),
	}

	// Add to positions
	e.positions[fmt.Sprintf("%s:%s", req.UserID, req.MarketSymbol)] = position
	account.Positions[req.MarketSymbol] = position

	// Lock margin
	account.AvailableMargin -= requiredMargin

	// Update account totals
	e.updateAccountMetrics(account)

	log.Printf("[INFO] Position opened: %s %s %s %s %.8f @ %.8f x%.0f",
		positionID, req.UserID, req.Side, req.MarketSymbol, req.Quantity, req.Price, req.Leverage)

	return position, nil
}

func (e *MarginEngine) ClosePosition(userID, symbol string, quantity float64, closePrice float64) (*MarginPosition, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	posKey := fmt.Sprintf("%s:%s", userID, symbol)
	position, ok := e.positions[posKey]
	if !ok {
		return nil, errors.New("position not found")
	}

	if quantity > position.Size {
		return nil, errors.New("quantity exceeds position size")
	}

	// Calculate PnL
	var pnl float64
	if position.Side == OrderSideBuy {
		pnl = (closePrice - position.EntryPrice) * quantity
	} else {
		pnl = (position.EntryPrice - closePrice) * quantity
	}

	// Calculate realized portion
	closeRatio := quantity / position.Size
	realizedPNL := pnl * closeRatio
	marginReleased := position.Margin * closeRatio

	// Update position
	position.Size -= quantity
	position.RealizedPNL += realizedPNL
	position.Margin -= marginReleased

	if position.Mode == MarginModeIsolated {
		position.IsolatedMargin -= marginReleased
	}

	// Release margin back to account
	account := e.accounts[userID]
	if account != nil {
		account.AvailableMargin += marginReleased + realizedPNL
	}

	// Update liquidation price if position still exists
	if position.Size > 0 {
		position.LiquidationPrice = position.EntryPrice * (1 + 1/(position.Leverage*e.config.LiquidationBuffer))
	} else {
		// Position fully closed
		delete(e.positions, posKey)
		delete(account.Positions, symbol)
	}

	e.updateAccountMetrics(account)

	log.Printf("[INFO] Position closed: %s %s %s %.8f @ %.8f PnL: %.8f",
		position.PositionID, userID, symbol, quantity, closePrice, realizedPNL)

	return position, nil
}

func (e *MarginEngine) GetPosition(userID, symbol string) (*MarginPosition, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	posKey := fmt.Sprintf("%s:%s", userID, symbol)
	if position, ok := e.positions[posKey]; ok {
		return position, nil
	}
	return nil, errors.New("position not found")
}

func (e *MarginEngine) GetAllPositions(userID string) []*MarginPosition {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var positions []*MarginPosition
	for key, pos := range e.positions {
		if key[:len(userID)] == userID {
			positions = append(positions, pos)
		}
	}
	return positions
}

// =============================================================================
// POSITION UPDATES (MARK PRICE)
// =============================================================================

func (e *MarginEngine) UpdateMarkPrice(symbol string, markPrice, indexPrice float64) {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, position := range e.positions {
		if position.MarketSymbol != symbol {
			continue
		}

		position.MarkPrice = markPrice
		position.IndexPrice = indexPrice

		// Calculate unrealized PnL
		if position.Side == OrderSideBuy {
			position.UnrealizedPNL = (markPrice - position.EntryPrice) * position.Size
		} else {
			position.UnrealizedPNL = (position.EntryPrice - markPrice) * position.Size
		}

		// Calculate margin ratio
		positionValue := position.Size * markPrice
		if positionValue > 0 {
			position.MarginRatio = position.Margin / positionValue
		}

		position.UpdatedAt = time.Now().UnixMilli()

		// Notify callbacks
		if e.onPositionUpdate != nil {
			e.onPositionUpdate(position)
		}
	}

	// Update account metrics
	for _, account := range e.accounts {
		e.updateAccountMetrics(account)
	}
}

// =============================================================================
// LIQUIDATION
// =============================================================================

func (e *MarginEngine) monitorLiquidations() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, account := range e.accounts {
		var liquidationNeeded bool
		var liquidationPosition *MarginPosition

		for _, position := range account.Positions {
			if position.Size == 0 {
				continue
			}

			// Calculate current margin ratio
			positionValue := position.Size * position.MarkPrice
			marginRatio := position.Margin / positionValue

			// Check liquidation
			if marginRatio < e.config.LiquidationBuffer {
				liquidationNeeded = true
				liquidationPosition = position
				break
			}

			// Check margin call warning
			if marginRatio < e.config.MarginCallBuffer && marginRatio >= e.config.LiquidationBuffer {
				if e.onMarginCall != nil {
					e.onMarginCall(account)
				}
			}
		}

		if liquidationNeeded && liquidationPosition != nil {
			e.liquidatePosition(liquidationPosition)
		}
	}
}

func (e *MarginEngine) liquidatePosition(position *MarginPosition) {
	log.Printf("[WARN] Liquidation triggered: %s %s %s", 
		position.PositionID, position.UserID, position.MarketSymbol)

	// Calculate bankruptcy price
	bankruptcyPrice := position.EntryPrice
	if position.Side == OrderSideBuy {
		bankruptcyPrice = position.EntryPrice * (1 - 1/position.Leverage)
	} else {
		bankruptcyPrice = position.EntryPrice * (1 + 1/position.Leverage)
	}

	// Get liquidation price (worse than bankruptcy)
	liquidationPrice := position.MarkPrice * 0.995 // 0.5% worse than market

	// Close position at liquidation price
	realizedPNL := position.UnrealizedPNL

	// Update account
	account := e.accounts[position.UserID]
	if account != nil {
		// Insurance fund covers losses
		if realizedPNL < 0 {
			deficit := -realizedPNL
			if e.insuranceFund >= deficit {
				e.insuranceFund -= deficit
				account.AvailableMargin += position.Margin
			} else {
				// Auto-deleverage other traders
				account.AvailableMargin += position.Margin - (deficit - e.insuranceFund)
				e.insuranceFund = 0
			}
		} else {
			account.AvailableMargin += position.Margin + realizedPNL
		}
	}

	// Remove position
	posKey := fmt.Sprintf("%s:%s", position.UserID, position.MarketSymbol)
	delete(e.positions, posKey)
	if account != nil {
		delete(account.Positions, position.MarketSymbol)
	}

	// Update stats
	atomic.AddInt64(&e.stats.TotalLiquidations, 1)
	e.stats.LiquidatedVolume += position.Size * position.MarkPrice

	// Notify callbacks
	if e.onLiquidation != nil {
		e.onLiquidation(position, "margin_ratio")
	}

	log.Printf("[INFO] Position liquidated: %s PnL: %.8f", position.PositionID, realizedPNL)
}

func (e *MarginEngine) Liquidate(userID, symbol string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	posKey := fmt.Sprintf("%s:%s", userID, symbol)
	position, ok := e.positions[posKey]
	if !ok {
		return errors.New("position not found")
	}

	e.liquidatePosition(position)
	return nil
}

// =============================================================================
// INTEREST CALCULATION
// =============================================================================

func (e *MarginEngine) calculateInterest() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, position := range e.positions {
		if position.Size == 0 {
			continue
		}

		// Get interest rate for the asset
		asset := extractBaseAsset(position.MarketSymbol)
		rate, ok := e.interestRates[asset]
		if !ok {
			continue
		}

		// Calculate position value
		positionValue := position.Size * position.MarkPrice

		// Calculate interest
		hourlyInterest := positionValue * rate.BorrowRate / 24

		// For longs, borrow base asset; for shorts, borrow quote asset
		if position.Side == OrderSideBuy {
			hourlyInterest = position.Size * position.MarkPrice * rate.BorrowRate / 24
		} else {
			hourlyInterest = position.Size * rate.BorrowRate / 24
		}

		// Add to position debt
		position.InterestPaid += hourlyInterest

		// Deduct from margin
		position.Margin -= hourlyInterest

		// Update account
		account := e.accounts[position.UserID]
		if account != nil {
			account.AvailableMargin -= hourlyInterest
			account.TotalInterest += hourlyInterest
		}
	}
}

func (e *MarginEngine) GetInterestRate(asset string) *InterestRate {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if rate, ok := e.interestRates[asset]; ok {
		return rate
	}
	return nil
}

// =============================================================================
// ACCOUNT METRICS
// =============================================================================

func (e *MarginEngine) updateAccountMetrics(account *MarginAccount) {
	var totalMargin float64
	var totalDebt float64

	for _, position := range account.Positions {
		totalMargin += position.Margin
		if position.UnrealizedPNL < 0 {
			totalDebt += -position.UnrealizedPNL
		}
	}

	account.TotalMargin = totalMargin
	account.TotalDebt = totalDebt

	// Calculate available margin
	account.AvailableMargin = totalMargin - totalDebt

	// Calculate margin ratio
	totalPositionValue := 0.0
	for _, position := range account.Positions {
		totalPositionValue += position.Size * position.MarkPrice
	}

	if totalPositionValue > 0 {
		account.MarginRatio = totalMargin / totalPositionValue
	}

	// Determine risk level
	if account.MarginRatio < e.config.LiquidationBuffer {
		account.RiskLevel = RiskLevelLiquidation
	} else if account.MarginRatio < e.config.MarginCallBuffer {
		account.RiskLevel = RiskLevelDanger
	} else if account.MarginRatio < 1.3 {
		account.RiskLevel = RiskLevelWarning
	} else {
		account.RiskLevel = RiskLevelHealthy
	}

	account.UpdatedAt = time.Now().UnixMilli()
}

// =============================================================================
// AUTO TOP-UP
// =============================================================================

func (e *MarginEngine) SetAutoTopUp(userID, symbol string, enabled bool, threshold float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	posKey := fmt.Sprintf("%s:%s", userID, symbol)
	position, ok := e.positions[posKey]
	if !ok {
		return errors.New("position not found")
	}

	position.AutoTopUp = enabled
	position.AutoTopUpThreshold = threshold

	log.Printf("[INFO] Auto-top-up set: %s %s enabled=%v threshold=%.4f", 
		userID, symbol, enabled, threshold)

	return nil
}

func (e *MarginEngine) ProcessAutoTopUp() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, position := range e.positions {
		if !position.AutoTopUp || position.Size == 0 {
			continue
		}

		// Calculate margin ratio
		positionValue := position.Size * position.MarkPrice
		marginRatio := position.Margin / positionValue

		// Check if below threshold
		if marginRatio < position.AutoTopUpThreshold {
			// Calculate additional margin needed
			targetMargin := positionValue * e.config.MarginCallBuffer
			additionalMargin := targetMargin - position.Margin

			// Deduct from available margin (would need balance check in real implementation)
			if additionalMargin > 0 {
				position.Margin += additionalMargin
				
				account := e.accounts[position.UserID]
				if account != nil {
					account.AvailableMargin -= additionalMargin
				}

				log.Printf("[INFO] Auto-top-up executed: %s %s amount=%.8f", 
					position.PositionID, position.MarketSymbol, additionalMargin)
			}
		}
	}
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

func extractBaseAsset(symbol string) string {
	// Extract base asset from symbol like "BTC/USDT"
	for i := len(symbol) - 1; i >= 0; i-- {
		if symbol[i] == '/' {
			return symbol[:i]
		}
	}
	return symbol
}

func (e *MarginEngine) GetStats() MarginStats {
	e.stats.mu.Lock()
	defer e.stats.mu.Unlock()
	e.stats.InsuranceFundBalance = e.insuranceFund
	return e.stats
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

func (e *MarginEngine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/margin/health":
		fmt.Fprint(w, `{"status":"ok","engine":"margin-v3.0"}`)
	case "/margin/stats":
		stats := e.GetStats()
		// JSON encoding would go here
		fmt.Fprintf(w, "%+v", stats)
	default:
		http.NotFound(w, r)
	}
}

// Placeholder for http import
var http interface{}
func init() {
	_ = errors.New
	_ = math.MaxFloat64
}