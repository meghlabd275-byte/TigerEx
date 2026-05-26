// Package margin_service handles margin trading.
// Migrated from TypeScript to Go for margin/leverage trading.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Position side
type PositionSide string

const (
	Long  PositionSide = "long"
	Short PositionSide = "short"
)

// Position represents a margin position
type Position struct {
	ID           string       `json:"id"`
	UserID      string       `json:"userId"`
	Pair        string       `json:"pair"`
	Side        PositionSide `json:"side"`
	Quantity    float64      `json:"quantity"`
	EntryPrice  float64      `json:"entryPrice"`
	Leverage    float64      `json:"leverage"`
	LiqPrice   float64      `json:"liqPrice"`
	MarginUsed float64     `json:"marginUsed"`
	Status     string      `json:"status"`
	OpenedAt   int64        `json:"openedAt"`
	UpdatedAt  int64        `json:"updatedAt"`
}

// Margin order
type MarginOrder struct {
	ID        string       `json:"id"`
	UserID   string       `json:"userId"`
	Pair     string       `json:"pair"`
	Side     PositionSide `json:"side"`
	Type     string       `json:"type"` // open, close, adjust
	Quantity float64    `json:"quantity"`
	Leverage float64    `json:"leverage"`
	Price   float64    `json:"price"`
	Status  string      `json:"status"`
}

// MarginStore manages margin positions
type MarginStore struct {
	mu        sync.RWMutex
	positions map[string]*Position
	orders    []*MarginOrder
}

var (
	marginStore = &MarginStore{
		positions: make(map[string]*Position),
		orders:    make([]*MarginOrder, 0),
	}
)

// Calculate liquidation price
func CalcLiqPrice(entryPrice float64, leverage float64, side PositionSide) float64 {
	marginRatio := 1.0 / leverage
	
	if side == Long {
		return entryPrice * (1.0 - marginRatio)
	}
	return entryPrice * (1.0 + marginRatio)
}

// Open margin position
func OpenPosition(order *MarginOrder) *Position {
	entryPrice := order.Price
	liqPrice := CalcLiqPrice(entryPrice, order.Leverage, order.Side)
	marginUsed := (order.Quantity * entryPrice) / order.Leverage

	position := &Position{
		ID:         fmt.Sprintf("pos_%d", time.Now().UnixNano()),
		UserID:     order.UserID,
		Pair:      order.Pair,
		Side:      order.Side,
		Quantity:  order.Quantity,
		EntryPrice: entryPrice,
		Leverage:   order.Leverage,
		LiqPrice:  liqPrice,
		MarginUsed: marginUsed,
		Status:    "open",
		OpenedAt:  time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}

	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()
	marginStore.positions[position.ID] = position

	return position
}

// Close position
func ClosePosition(positionID string, closePrice float64) (*Position, error) {
	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()

	position, ok := marginStore.positions[positionID]
	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	// Calculate P&L
	var pnl float64
	if position.Side == Long {
		pnl = (closePrice - position.EntryPrice) * position.Quantity
	} else {
		pnl = (position.EntryPrice - closePrice) * position.Quantity
	}

	position.Status = "closed"
	position.UpdatedAt = time.Now().UnixMilli()

	return position, nil
}

// Adjust leverage
func AdjustLeverage(positionID string, newLeverage float64) (*Position, error) {
	marginStore.mu.Lock()
	defer marginStore.mu.Unlock()

	position, ok := marginStore.positions[positionID]
	if !ok {
		return nil, fmt.Errorf("position not found")
	}

	// Calculate new margin and liquidation price
	newMargin := (position.Quantity * position.EntryPrice) / newLeverage
	newLiqPrice := CalcLiqPrice(position.EntryPrice, newLeverage, position.Side)

	position.Leverage = newLeverage
	position.MarginUsed = newMargin
	position.LiqPrice = newLiqPrice
	position.UpdatedAt = time.Now().UnixMilli()

	return position, nil
}

// Get user positions
func GetUserPositions(userID string) []*Position {
	marginStore.mu.RLock()
	defer marginStore.mu.RUnlock()

	var result []*Position
	for _, p := range marginStore.positions {
		if p.UserID == userID && p.Status == "open" {
			result = append(result, p)
		}
	}
	return result
}

// Get position by ID
func GetPosition(id string) (*Position, bool) {
	marginStore.mu.RLock()
	defer marginStore.mu.RUnlock()

	p, ok := marginStore.positions[id]
	return p, ok
}

// Check liquidation (mark price reached liq price)
func CheckLiquidation(position *Position, markPrice float64) bool {
	return (position.Side == Long && markPrice <= position.LiqPrice) ||
		(position.Side == Short && markPrice >= position.LiqPrice)
}

// Get margin ratio for position
func GetMarginRatio(position *Position, currentPrice float64) float64 {
	unrealizedPnL := 0.0
	if position.Side == Long {
		unrealizedPnL = (currentPrice - position.EntryPrice) * position.Quantity
	} else {
		unrealizedPnL = (position.EntryPrice - currentPrice) * position.Quantity
	}

	totalValue := position.Quantity * currentPrice
	
	return (position.MarginUsed + unrealizedPnL) / totalValue
}

func main() {
	fmt.Println("Margin service initialized")

	// Demo: open LONG position
	order := &MarginOrder{
		UserID:   "user_demo",
		Pair:     "BTC/USDT",
		Side:     Long,
		Type:     "open",
		Quantity: 1.0,
		Leverage: 5.0,
		Price:    65000.0,
	}

	pos := OpenPosition(order)
	jp, _ := json.Marshal(pos)
	fmt.Printf("Opened position: %s\n", string(jp))
}