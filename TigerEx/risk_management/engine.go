package risk

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// RISK MANAGEMENT SYSTEM
// High-frequency position monitoring and liquidation
// =============================================================================

// Config risk management configuration
type Config struct {
	MaxLeverage        float64   // Maximum allowed leverage
	LiquidationBuffer float64  // Buffer before liquidation (e.g., 5%)
	AutoDelevEnabled  bool     // Enable auto-deleveraging
	MaxDailyLoss     float64   // Max daily loss limit
	MaxOpenOrders   int       // Max open orders per user
	MaxPositions    int       // Max positions per user
}

// Position represents a trading position
type Position struct {
	UserID        string    `json:"userId"`
	Symbol        string    `json:"symbol"`
	Side         string    `json:"side"` // LONG, SHORT
	Size          float64   `json:"size"`
	EntryPrice    float64   `json:"entryPrice"`
	MarkPrice    float64   `json:"markPrice"`
	Leverage      float64   `json:"leverage"`
	Margin       float64   `json:"margin"`
	Isolated     bool      `json:"isolated"`
	OpenedAt     time.Time `json:"openedAt"`
}

// RiskManager manages position risk
type RiskManager struct {
	mu sync.RWMutex
	config *Config

	// Position tracking
	positions map[string]map[string]*Position // userID -> symbol -> Position

	// Daily tracking
	dailyLoss    float64
	dailyReset   time.Time

	// Order counts
	openOrders map[string]int // userID -> count

	metrics *Metrics
}

// Metrics tracks risk metrics
type Metrics struct {
	TotalExposure  float64 `json:"totalExposure"`
	Liquidations int64   `json:"liquidations"`
	Deleverages int64   `json:"deleverages"`
	Breaches   int64   `json:"riskBreaches"`
}

// NewRiskManager creates risk manager
func NewRiskManager(cfg *Config) *RiskManager {
	if cfg == nil {
		cfg = &Config{
			MaxLeverage:       125.0,
			LiquidationBuffer: 5.0,
			AutoDelevEnabled: true,
			MaxDailyLoss:    1000000.0,
			MaxOpenOrders:   100,
			MaxPositions:  20,
		}
	}

	return &RiskManager{
		config:     cfg,
		positions: make(map[string]map[string]*Position),
		openOrders: make(map[string]int),
		metrics:   &Metrics{},
	}
}

// PreTradeCheck performs pre-trade risk checks
func (r *RiskManager) PreTradeCheck(userID, symbol string, orderQty, orderPrice, leverage float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check leverage
	if leverage > r.config.MaxLeverage {
		return fmt.Errorf("leverage exceeds maximum of %.0fx", r.config.MaxLeverage)
	}

	// Check position count
	userPositions := r.positions[userID]
	if userPositions == nil {
		userPositions = make(map[string]*Position)
		r.positions[userID] = userPositions
	}

	if len(userPositions) >= r.config.MaxPositions {
		return fmt.Errorf("maximum positions reached: %d", r.config.MaxPositions)
	}

	// Check order count
	if r.openOrders[userID]+1 > r.config.MaxOpenOrders {
		return fmt.Errorf("maximum open orders reached: %d", r.config.MaxOrders)
	}

	// Check daily loss
	if r.dailyLoss >= r.config.MaxDailyLoss {
		return fmt.Errorf("daily loss limit reached")
	}

	// Calculate new position exposure
	orderValue := orderQty * orderPrice

	// Check margin requirement
	requiredMargin := orderValue / leverage
	if requiredMargin < 10.0 { // Minimum $10 margin
		return fmt.Errorf("margin requirement not met: minimum $10")
	}

	return nil
}

// OpenPosition opens a position
func (r *RiskManager) OpenPosition(pos *Position) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	userID := pos.UserID
	symbol := pos.Symbol

	if r.positions[userID] == nil {
		r.positions[userID] = make(map[string]*Position)
	}

	// Check if position exists
	if existing, ok := r.positions[userID][symbol]; ok {
		// Add to existing position
		existing.Size += pos.Size
		existing.Margin += pos.Margin
		return nil
	}

	r.positions[userID][symbol] = pos
	r.openOrders[userID]++

	return nil
}

// UpdatePosition updates position with new mark price
func (r *RiskManager) UpdatePosition(userID, symbol string, markPrice float64) (liquidate bool, liqPrice float64, loss float64, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	userPositions := r.positions[userID]
	if userPositions == nil {
		return false, 0, 0, fmt.Errorf("position not found")
	}

	pos, ok := userPositions[symbol]
	if !ok {
		return false, 0, 0, fmt.Errorf("position not found")
	}

	// Update mark price
	oldMarkPrice := pos.MarkPrice
	pos.MarkPrice = markPrice

	// Calculate unrealized P&L
	var pnl float64
	if pos.Side == "LONG" {
		pnl = (markPrice - pos.EntryPrice) * pos.Size
	} else {
		pnl = (pos.EntryPrice - markPrice) * pos.Size
	}

	loss = pnl

	// Calculate margin ratio
	marginRatio := (pos.Margin + pnl) / (pos.Size * markPrice) * 100

	// Check liquidation
	liqPrice = calculateLiquidationPrice(pos.EntryPrice, pos.Side, pos.Leverage, pos.Side == "LONG")
	buffeeredLiqPrice := liqPrice * (1 + r.config.LiquidationBuffer/100)

	if marginRatio < r.config.LiquidationBuffer {
		liquidate = true
		r.metrics.Liquidations++
		return true, buffeeredLiqPrice, pnl, nil
	}

	return false, 0, pnl, nil
}

// CalculatePositionMetrics calculates position metrics
func (r *RiskManager) CalculatePositionMetrics(userID string) (marginUsed, unrealizedPnL, totalExposure float64) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	userPositions := r.positions[userID]
	if userPositions == nil {
		return 0, 0, 0
	}

	for _, pos := range userPositions {
		marginUsed += pos.Margin
		totalExposure += pos.Size * pos.MarkPrice

		if pos.Side == "LONG" {
			unrealizedPnL += (pos.MarkPrice - pos.EntryPrice) * pos.Size
		} else {
			unrealizedPnL += (pos.EntryPrice - pos.MarkPrice) * pos.Size
		}
	}

	return marginUsed, unrealizedPnL, totalExposure
}

// ClosePosition closes a position
func (r *RiskManager) ClosePosition(userID, symbol string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	userPositions := r.positions[userID]
	if userPositions == nil {
		return fmt.Errorf("no positions")
	}

	if _, ok := userPositions[symbol]; !ok {
		return fmt.Errorf("position not found")
	}

	delete(userPositions, symbol)
	r.openOrders[userID]--

	return nil
}

// CheckLeverage checks leverage for a position
func (r *RiskManager) CheckLeverage(userID, symbol string, newSize float64) (currentLeverage float64, valid bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	userPositions := r.positions[userID]
	if userPositions == nil {
		return 0, true
	}

	pos, ok := userPositions[symbol]
	if !ok {
		return 0, true
	}

	currentLeverage = (pos.Size * pos.MarkPrice) / pos.Margin
	valid = currentLeverage <= r.config.MaxLeverage

	return currentLeverage, valid
}

// GetMetrics returns risk metrics
func (r *RiskManager) GetMetrics() *Metrics {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return &Metrics{
		TotalExposure: r.metrics.TotalExposure,
		Liquidations: r.metrics.Liquidations,
		Deleverages: r.metrics.Deleverages,
		Breaches:   r.metrics.Breaches,
	}
}

// =============================================================================
// LIQUIDATION PRICE CALCULATION
// =============================================================================

// Calculate liquidation price
func calculateLiquidationPrice(entryPrice float64, side string, leverage float64, isLong bool) float64 {
	maintenanceMargin := 0.5 / 100 // 0.5% maintenance margin

	if isLong {
		return entryPrice * (1 - (1/leverage) + maintenanceMargin)
	}
	return entryPrice * (1 + (1/leverage) - maintenanceMargin)
}

// CalculateMarginRequirement calculates margin requirement
func CalculateMarginRequirement(size, price, leverage float64) float64 {
	return (size * price) / leverage
}

// CalculateLeverage calculates effective leverage
func CalculateLeverage(size, price, margin float64) float64 {
	if margin <= 0 {
		return 0
	}
	return (size * price) / margin
}

// =============================================================================
// AUTO-DELEVERAGING
// =============================================================================

// AutoDeleverAGE attempts to auto-deleverage profitable accounts
func (r *RiskManager) AutoDeleverAGE(userID, symbol string, amount float64) error {
	if !r.config.AutoDelevEnabled {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.metrics.Deleverages++
	// Simplified - production would interact with counterparty positions

	return nil
}

// =============================================================================
// POSITION LIMITS
// =============================================================================

// CheckPositionLimits checks overall position limits
func (r *RiskManager) CheckPositionLimits(userID string) (valid bool, reason string) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	userPositions := r.positions[userID]
	if userPositions == nil {
		return true, ""
	}

	positionCount := len(userPositions)
	if positionCount >= r.config.MaxPositions {
		return false, fmt.Sprintf("max positions: %d", r.config.MaxPositions)
	}

	return true, ""
}