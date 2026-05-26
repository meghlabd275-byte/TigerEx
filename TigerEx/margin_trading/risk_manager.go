package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// RISK MANAGEMENT TYPES
// ============================================================================

type RiskLevel int

const (
	RiskLow RiskLevel = iota
	RiskMedium
	RiskHigh
	RiskCritical
)

type PositionSide int

const (
	PositionLong PositionSide = iota
	PositionShort
)

type Position struct {
	PositionID     string    `json:"positionId"`
	UserID        string    `json:"userId"`
	Market        string    `json:"market"`
	Side          PositionSide `json:"side"`
	Quantity      float64   `json:"quantity"`
	EntryPrice    float64   `json:"entryPrice"`
	Leverage      float64   `json:"leverage"`
	LiqPrice      float64   `json:"liqPrice"`
	UnrealizedPNL float64 `json:"unrealizedPnl"`
	MarginUsed    float64   `json:"marginUsed"`
	MaintMargin   float64   `json:"maintMargin"`
	OpenTime      int64     `json:"openTime"`
}

type RiskAccount struct {
	UserID           string     `json:"userId"`
	TotalEquity      float64    `json:"totalEquity"`
	MarginUsed      float64    `json:"marginUsed"`
	AvailableMargin float64    `json:"availableMargin"`
	UnrealizedPNL  float64    `json:"unrealizedPnl"`
	MarginRatio     float64    `json:"marginRatio"`
	Positions       []*Position `json:"positions"`
	IsLiquidated    bool       `json:"isLiquidated"`
}

// ============================================================================
// RISK MANAGER
// ============================================================================

type RiskManager struct {
	mu sync.RWMutex

	// User accounts
	accounts map[string]*RiskAccount

	// Risk limits
	MaxLeverage      map[string]float64 // market -> max leverage
	MaxPositionSize  float64
	MaxDailyLoss    float64
	MaintMarginRate  float64 // Maintenance margin rate
	InitialMarginRate float64 // Initial margin rate
	LiqMarginRatio   float64 // Liquidation margin ratio

	// Position tracking
	positions map[string]*Position // positionID -> Position

	// Daily PnL
	dailyPnL map[string]float64 // userID -> daily PnL

	// Metrics
	TotalLiquidations int64 `json:"totalLiquidations"`
	TotalMarginCalls int64  `json:"totalMarginCalls"`
}

// NewRiskManager creates a new risk manager
func NewRiskManager() *RiskManager {
	return &RiskManager{
		accounts:          make(map[string]*RiskAccount),
		positions:        make(map[string]*Position),
		dailyPnL:         make(map[string]float64),
		MaxLeverage: map[string]float64{
			"BTC/USDT": 125.0,
			"ETH/USDT": 75.0,
		},
		MaxPositionSize:   1000000.0,
		MaxDailyLoss:      50000.0,
		MaintMarginRate:   0.005,  // 0.5%
		InitialMarginRate: 0.01,   // 1%
		LiqMarginRatio:    0.8,    // 80% of maint margin
	}
}

// GetAccount gets or creates a risk account
func (rm *RiskManager) GetAccount(userID string) *RiskAccount {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	account, exists := rm.accounts[userID]
	if !exists {
		account = &RiskAccount{
			UserID:    userID,
			Positions: make([]*Position, 0),
		}
		rm.accounts[userID] = account
	}

	return account
}

// CalculateMargin calculates required margin for position
func (rm *RiskManager) CalculateMargin(quantity, price, leverage float64) float64 {
	if leverage <= 1 {
		return quantity * price
	}
	return (quantity * price) / leverage
}

// CalculateLiquidationPrice calculates liquidation price
func (rm *RiskManager) CalculateLiquidationPrice(entryPrice float64, leverage float64, side PositionSide) float64 {
	if leverage <= 1 {
		return 0
	}

	// Maintenance margin ratio
	mr := rm.MaintMarginRate
	liqRatio := 1.0 - (mr * (1.0 - 1.0/leverage))

	if side == PositionLong {
		// Long: liquidation when price drops
		return entryPrice * liqRatio
	}

	// Short: liquidation when price rises
	return entryPrice * (2 - liqRatio)
}

// ValidateOrder validates order against risk limits
func (rm *RiskManager) ValidateOrder(userID, market string, side PositionSide, quantity, price, leverage float64) (bool, string) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	account := rm.accounts[userID]
	if account == nil {
		return true, ""
	}

	// Check leverage
	maxLev := rm.MaxLeverage[market]
	if maxLev == 0 {
		maxLev = 10.0 // Default
	}

	if leverage > maxLev {
		return false, fmt.Sprintf("max leverage for %s is %.0fx", market, maxLev)
	}

	// Calculate required margin
	requiredMargin := rm.CalculateMargin(quantity, price, leverage)

	// Check available margin
	if account.AvailableMargin < requiredMargin {
		return false, "insufficient margin"
	}

	// Check position size
	positionValue := quantity * price
	if positionValue > rm.MaxPositionSize {
		return false, fmt.Sprintf("max position size is %.0f", rm.MaxPositionSize)
	}

	// Check daily loss
	dailyLoss := rm.dailyPnL[userID]
	if dailyLoss < -rm.MaxDailyLoss {
		return false, "daily loss limit exceeded"
	}

	return true, ""
}

// OpenPosition opens a new position
func (rm *RiskManager) OpenPosition(userID, market string, side PositionSide, quantity, entryPrice, leverage float64) (*Position, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	// Calculate margins
	margin := rm.CalculateMargin(quantity, entryPrice, leverage)
	maintMargin := quantity * entryPrice * rm.MaintMarginRate
	liqPrice := rm.CalculateLiquidationPrice(entryPrice, leverage, side)

	// Create position
	position := &Position{
		PositionID:    uuid.New().String(),
		UserID:        userID,
		Market:        market,
		Side:          side,
		Quantity:      quantity,
		EntryPrice:    entryPrice,
		Leverage:      leverage,
		LiqPrice:      liqPrice,
		MarginUsed:    margin,
		MaintMargin:   maintMargin,
		UnrealizedPNL: 0,
		OpenTime:      time.Now().UnixMilli(),
	}

	// Update account
	account := rm.accounts[userID]
	if account == nil {
		account = &RiskAccount{
			UserID:    userID,
			Positions: make([]*Position, 0),
		}
		rm.accounts[userID] = account
	}

	account.Positions = append(account.Positions, position)
	account.MarginUsed += margin
	account.AvailableMargin = account.TotalEquity - account.MarginUsed

	// Store position
	rm.positions[position.PositionID] = position

	return position, nil
}

// ClosePosition closes an existing position
func (rm *RiskManager) ClosePosition(positionID string, exitPrice float64) (float64, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	position, exists := rm.positions[positionID]
	if !exists {
		return 0, fmt.Errorf("position not found")
	}

	// Calculate realized PnL
	var pnl float64
	if position.Side == PositionLong {
		pnl = (exitPrice - position.EntryPrice) * position.Quantity
	} else {
		pnl = (position.EntryPrice - exitPrice) * position.Quantity
	}

	// Update daily PnL
	rm.dailyPnL[position.UserID] += pnl

	// Return margin to account
	account := rm.accounts[position.UserID]
	if account != nil {
		account.MarginUsed -= position.MarginUsed
		account.AvailableMargin = account.TotalEquity - account.MarginUsed

		// Remove position
		for i, pos := range account.Positions {
			if pos.PositionID == positionID {
				account.Positions = append(account.Positions[:i], account.Positions[i+1:]...)
				break
			}
		}
	}

	// Remove from tracking
	delete(rm.positions, positionID)

	return pnl, nil
}

// UpdatePositions updates unrealized PnL for all positions
func (rm *RiskManager) UpdatePositions(prices map[string]float64) []*Position {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	liquidations := make([]*Position, 0)

	for _, account := range rm.accounts {
		for _, position := range account.Positions {
			currentPrice, hasPrice := prices[position.Market]
			if !hasPrice {
				continue
			}

			// Calculate unrealized PnL
			if position.Side == PositionLong {
				position.UnrealizedPNL = (currentPrice - position.EntryPrice) * position.Quantity
			} else {
				position.UnrealizedPNL = (position.EntryPrice - currentPrice) * position.Quantity
			}

			// Check liquidation
			if currentPrice <= position.LiqPrice {
				liquidations = append(liquidations, position)
				account.IsLiquidated = true
				atomic.AddInt64(&rm.TotalLiquidations, 1)
			}
		}

		// Update account equity
		var totalUnrealized float64
		for _, pos := range account.Positions {
			totalUnrealized += pos.UnrealizedPNL
		}
		account.UnrealizedPNL = totalUnrealized
		account.AvailableMargin = account.TotalEquity - account.MarginUsed + totalUnrealized

		// Check margin call
		if account.MarginUsed > 0 {
			account.MarginRatio = account.AvailableMargin / account.MarginUsed
			if account.MarginRatio < rm.LiqMarginRatio {
				atomic.AddInt64(&rm.TotalMarginCalls, 1)
			}
		}
	}

	return liquidations
}

// ForceLiquidate forces liquidation of position
func (rm *RiskManager) ForceLiquidate(positionID string, currentPrice float64) (float64, error) {
	return rm.ClosePosition(positionID, currentPrice)
}

// GetAccountInfo returns account risk information
func (rm *RiskManager) GetAccountInfo(userID string) map[string]interface{} {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	account := rm.accounts[userID]
	if account == nil {
		return map[string]interface{}{
			"error": "account not found",
		}
	}

	positions := make([]map[string]interface{}, len(account.Positions))
	for i, pos := range account.Positions {
		positions[i] = map[string]interface{}{
			"positionId":      pos.PositionID,
			"market":        pos.Market,
			"side":          pos.Side,
			"quantity":      pos.Quantity,
			"entryPrice":    pos.EntryPrice,
			"leverage":      pos.Leverage,
			"liqPrice":     pos.LiqPrice,
			"unrealizedPnl": pos.UnrealizedPNL,
			"marginUsed":    pos.MarginUsed,
		}
	}

	return map[string]interface{}{
		"userId":           userID,
		"totalEquity":      account.TotalEquity,
		"marginUsed":       account.MarginUsed,
		"availableMargin":  account.AvailableMargin,
		"unrealizedPnl":    account.UnrealizedPNL,
		"marginRatio":      account.MarginRatio,
		"positions":        positions,
		"isLiquidated":     account.IsLiquidated,
	}
}

// GetMetrics returns risk manager metrics
func (rm *RiskManager) GetMetrics() map[string]interface{} {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	totalPositions := 0
	totalMarginUsed := 0.0

	for _, account := range rm.accounts {
		totalPositions += len(account.Positions)
		totalMarginUsed += account.MarginUsed
	}

	return map[string]interface{}{
		"totalAccounts":      len(rm.accounts),
		"totalPositions":    totalPositions,
		"totalMarginUsed":   totalMarginUsed,
		"totalLiquidations":  atomic.LoadInt64(&rm.TotalLiquidations),
		"totalMarginCalls":  atomic.LoadInt64(&rm.TotalMarginCalls),
	}
}

// SetAccountEquity sets account equity (call from wallet service)
func (rm *RiskManager) SetAccountEquity(userID string, equity float64) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	account := rm.accounts[userID]
	if account == nil {
		account = &RiskAccount{UserID: userID}
		rm.accounts[userID] = account
	}

	account.TotalEquity = equity
	account.AvailableMargin = equity - account.MarginUsed
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Risk Manager (Go)")
	fmt.Println("============================\n")

	rm := NewRiskManager()

	// Set account equity
	rm.SetAccountEquity("user1", 100000.0)

	// Validate order
	valid, msg := rm.ValidateOrder("user1", "BTC/USDT", PositionLong, 1.0, 50000, 10)
	fmt.Printf("Order validation: %v - %s\n", valid, msg)

	// Open position
	pos, err := rm.OpenPosition("user1", "BTC/USDT", PositionLong, 1.0, 50000, 10)
	if err != nil {
		fmt.Printf("Open error: %v\n", err)
	} else {
		fmt.Printf("Opened position: %s\n", pos.PositionID[:8])
		fmt.Printf("  Liquidation price: %.2f\n", pos.LiqPrice)
		fmt.Printf("  Margin required: %.2f\n", pos.MarginUsed)
	}

	// Simulate price update
	prices := map[string]float64{
		"BTC/USDT": 45500, // Drops below liq price
	}

	liquidations := rm.UpdatePositions(prices)
	fmt.Printf("\nLiquidations: %d\n", len(liquidations))

	// Get account info
	info := rm.GetAccountInfo("user1")
	infoJSON, _ := json.MarshalIndent(info, "", "  ")
	fmt.Printf("\nAccount Info:\n%s\n", string(infoJSON))

	// Get metrics
	metrics := rm.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nRisk Manager ready.")
}