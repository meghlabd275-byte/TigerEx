package main

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// ============================================================================
// MARGIN TYPES
// ============================================================================

type MarginAccount struct {
	UserID            string             `json:"userId"`
	AccountType       string             `json:"accountType"` // CROSS_MARGIN, ISOLATED_MARGIN
	TotalEquity       float64            `json:"totalEquity"`
	TotalDebt         float64            `json:"totalDebt"`
	TotalMargin       float64            `json:"totalMargin"`
	AvailableMargin   float64            `json:"availableMargin"`
	IsolatedPositions []*IsolatedPosition `json:"isolatedPositions"`
	CrossPositions    []*CrossPosition    `json:"crossPositions"`
	Leverage          int                `json:"leverage"`
	RiskLevel         string             `json:"riskLevel"`
	LastUpdate        int64              `json:"lastUpdate"`
}

type CrossPosition struct {
	UserID            string  `json:"userId"`
	Symbol            string  `json:"symbol"`
	Size              float64 `json:"size"` // Positive = long, Negative = short
	EntryPrice        float64 `json:"entryPrice"`
	MarkPrice         float64 `json:"markPrice"`
	LiquidationPrice  float64 `json:"liquidationPrice"`
	UnrealizedPnL     float64 `json:"unrealizedPnl"`
	Leverage          int     `json:"leverage"`
	Margin            float64 `json:"margin"`
	MaintenanceMargin  float64 `json:"maintenanceMargin"`
	AutoAddMargin     bool    `json:"autoAddMargin"`
	ROE               float64 `json:"roe"`
}

type IsolatedPosition struct {
	Symbol            string  `json:"symbol"`
	Side              string  `json:"side"`
	Size              float64 `json:"size"`
	EntryPrice        float64 `json:"entryPrice"`
	MarkPrice         float64 `json:"markPrice"`
	LiquidationPrice  float64 `json:"liquidationPrice"`
	UnrealizedPnL     float64 `json:"unrealizedPnl"`
	Leverage          int     `json:"leverage"`
	IsolatedMargin    float64 `json:"isolatedMargin"`
	MaintenanceMargin  float64 `json:"maintenanceMargin"`
	AutoAddMargin     bool    `json:"autoAddMargin"`
	ROE               float64 `json:"roe"`
}

type MarginOrder struct {
	OrderID       string  `json:"orderId"`
	UserID        string  `json:"userId"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"`
	Type          string  `json:"type"`
	Leverage      int     `json:"leverage"`
	Quantity      float64 `json:"quantity"`
	Price         float64 `json:"price"`
	StopPrice     float64 `json:"stopPrice,omitempty"`
	ReduceOnly    bool    `json:"reduceOnly"`
	Margin        float64 `json:"margin"`
	PositionSide  string  `json:"positionSide"`
	Status        string  `json:"status"`
	CreatedAt     int64   `json:"createdAt"`
	UpdatedAt     int64   `json:"updatedAt"`
}

type LiquidationOrder struct {
	OrderID          string  `json:"orderId"`
	UserID           string  `json:"userId"`
	Symbol           string  `json:"symbol"`
	PositionSize     float64 `json:"positionSize"`
	EntryPrice       float64 `json:"entryPrice"`
	LiquidationPrice float64 `json:"liquidationPrice"`
	BankruptPrice    float64 `json:"bankruptPrice"`
	Margin           float64 `json:"margin"`
	TotalDebt        float64 `json:"totalDebt"`
	Type             string  `json:"type"`
	ForceOrderID     string  `json:"forceOrderId"`
	Timestamp        int64   `json:"timestamp"`
}

// ============================================================================
// MARGIN ENGINE
// ============================================================================

type MarginEngine struct {
	marginAccounts    map[string]*MarginAccount
	crossPositions    map[string]*CrossPosition
	isolatedPositions map[string]*IsolatedPosition
	liquidationQueue  []*LiquidationOrder
	defaultLeverage   int
	maxLeverage       int
	liquidationBuffer float64
	markPrices        map[string]float64
	onLiquidation     func(*LiquidationOrder)
	onMarginCall      func(string, float64)
	mu                sync.RWMutex
	version           int64
}

func NewMarginEngine() *MarginEngine {
	return &MarginEngine{
		marginAccounts:    make(map[string]*MarginAccount),
		crossPositions:    make(map[string]*CrossPosition),
		isolatedPositions: make(map[string]*IsolatedPosition),
		liquidationQueue:  make([]*LiquidationOrder, 0),
		defaultLeverage:   10,
		maxLeverage:       125,
		liquidationBuffer: 0.5,
		markPrices:        make(map[string]float64),
	}
}

func (me *MarginEngine) OpenMarginAccount(userID, accountType string) (*MarginAccount, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	account := &MarginAccount{
		UserID:     userID,
		AccountType: accountType,
		Leverage:   me.defaultLeverage,
		RiskLevel:  "SAFE",
		LastUpdate: time.Now().UnixMilli(),
	}

	me.marginAccounts[userID] = account
	return account, nil
}

func (me *MarginEngine) GetMarginAccount(userID string) (*MarginAccount, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()

	account, exists := me.marginAccounts[userID]
	if !exists {
		return nil, fmt.Errorf("margin account not found")
	}
	return account, nil
}

func (me *MarginEngine) UpdateLeverage(userID string, leverage int) error {
	me.mu.Lock()
	defer me.mu.Unlock()

	if leverage < 1 || leverage > me.maxLeverage {
		return fmt.Errorf("invalid leverage")
	}

	account, exists := me.marginAccounts[userID]
	if !exists {
		return fmt.Errorf("margin account not found")
	}

	account.Leverage = leverage
	account.LastUpdate = time.Now().UnixMilli()
	return nil
}

func (me *MarginEngine) OpenPosition(order *MarginOrder) (*CrossPosition, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	if order.Leverage < 1 || order.Leverage > me.maxLeverage {
		return nil, fmt.Errorf("invalid leverage")
	}

	key := order.UserID + ":" + order.Symbol
	position, exists := me.crossPositions[key]

	if !exists {
		position = &CrossPosition{
			UserID:   order.UserID,
			Symbol:   order.Symbol,
			Leverage: order.Leverage,
		}
		me.crossPositions[key] = position
	}

	positionValue := order.Quantity * order.Price
	position.Margin = positionValue / float64(order.Leverage)

	if order.Side == "BUY_OPEN" || order.Side == "BUY_CLOSE" {
		position.Size += order.Quantity
	} else {
		position.Size -= order.Quantity
	}

	if position.Size != 0 {
		oldValue := (position.Size - order.Quantity) * position.EntryPrice
		newValue := order.Quantity * order.Price
		position.EntryPrice = (oldValue + newValue) / position.Size
	}

	position.MaintenanceMargin = positionValue * 0.05
	position.LiquidationPrice = me.calculateLiquidationPrice(position)
	me.updateUnrealizedPnL(position)

	if position.Margin > 0 {
		position.ROE = (position.UnrealizedPnL / position.Margin) * 100
	}

	me.version++
	return position, nil
}

func (me *MarginEngine) ClosePosition(userID, symbol string, quantity float64, price float64) (*CrossPosition, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	key := userID + ":" + symbol
	position, exists := me.crossPositions[key]

	if !exists || position.Size == 0 {
		return nil, fmt.Errorf("no position found")
	}

	if quantity > math.Abs(position.Size) {
		quantity = math.Abs(position.Size)
	}

	position.Size -= quantity

	if math.Abs(position.Size) < 0.0001 {
		position.Size = 0
		position.UnrealizedPnL = 0
	}

	me.updateUnrealizedPnL(position)
	me.version++

	return position, nil
}

func (me *MarginEngine) GetPosition(userID, symbol string) *CrossPosition {
	me.mu.RLock()
	defer me.mu.RUnlock()

	key := userID + ":" + symbol
	return me.crossPositions[key]
}

func (me *MarginEngine) GetAllPositions(userID string) []*CrossPosition {
	me.mu.RLock()
	defer me.mu.RUnlock()

	positions := make([]*CrossPosition, 0)
	prefix := userID + ":"

	for key, pos := range me.crossPositions {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			positions = append(positions, pos)
		}
	}

	return positions
}

func (me *MarginEngine) updateUnrealizedPnL(position *CrossPosition) {
	markPrice := me.markPrices[position.Symbol]
	if markPrice == 0 {
		markPrice = position.EntryPrice
	}

	if position.Size > 0 {
		position.UnrealizedPnL = (markPrice - position.EntryPrice) * position.Size
	} else if position.Size < 0 {
		position.UnrealizedPnL = (position.EntryPrice - markPrice) * math.Abs(position.Size)
	} else {
		position.UnrealizedPnL = 0
	}
}

func (me *MarginEngine) UpdateMarkPrice(symbol string, price float64) {
	me.mu.Lock()
	defer me.mu.Unlock()

	me.markPrices[symbol] = price

	for key, position := range me.crossPositions {
		if position.Symbol == symbol {
			position.MarkPrice = price
			me.updateUnrealizedPnL(position)
			position.LiquidationPrice = me.calculateLiquidationPrice(position)

			if position.Margin > 0 {
				position.ROE = (position.UnrealizedPnL / position.Margin) * 100
			}
		}
	}

	me.checkLiquidation(symbol)
}

func (me *MarginEngine) calculateLiquidationPrice(position *CrossPosition) float64 {
	maintenanceMarginRatio := 0.05
	leverageFactor := 1.0 / float64(position.Leverage)

	if position.Size > 0 {
		return position.EntryPrice * (1 - leverageFactor*(1-maintenanceMarginRatio) - me.liquidationBuffer/100)
	} else if position.Size < 0 {
		return position.EntryPrice * (1 + leverageFactor*(1-maintenanceMarginRatio) + me.liquidationBuffer/100)
	}

	return 0
}

func (me *MarginEngine) checkLiquidation(symbol string) {
	for key, position := range me.crossPositions {
		if position.Symbol != symbol {
			continue
		}

		marginRatio := (position.Margin - position.UnrealizedPnL) / (math.Abs(position.Size) * position.MarkPrice)

		if marginRatio <= 0.05 {
			me.forceLiquidatePosition(key)
		}
	}
}

func (me *MarginEngine) forceLiquidatePosition(key string) {
	position := me.crossPositions[key]
	if position == nil {
		return
	}

	liquidationPrice := me.markPrices[position.Symbol]
	if liquidationPrice == 0 {
		liquidationPrice = position.EntryPrice
	}

	totalDebt := position.Size * (position.LiquidationPrice - liquidationPrice)

	order := &LiquidationOrder{
		OrderID:          fmt.Sprintf("LIQ-%d-%s", time.Now().UnixMilli(), position.Symbol),
		UserID:           position.UserID,
		Symbol:           position.Symbol,
		PositionSize:     math.Abs(position.Size),
		EntryPrice:       position.EntryPrice,
		LiquidationPrice: position.LiquidationPrice,
		BankruptPrice:    liquidationPrice,
		Margin:           position.Margin,
		TotalDebt:        totalDebt,
		Type:             "FULL_LIQUIDATION",
		ForceOrderID:     fmt.Sprintf("FORCE-%d", time.Now().UnixMilli()),
		Timestamp:        time.Now().UnixMilli(),
	}

	me.liquidationQueue = append(me.liquidationQueue, order)
	delete(me.crossPositions, key)

	if me.onLiquidation != nil {
		go me.onLiquidation(order)
	}
}

func (me *MarginEngine) SubmitMarginOrder(order *MarginOrder) (*MarginOrder, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	if order.Quantity <= 0 {
		return nil, fmt.Errorf("invalid quantity")
	}

	if order.Leverage < 1 || order.Leverage > me.maxLeverage {
		return nil, fmt.Errorf("invalid leverage")
	}

	if order.OrderID == "" {
		order.OrderID = fmt.Sprintf("MARGIN-%d-%s", time.Now().UnixMilli(), order.Symbol)
	}

	order.Status = "SUBMITTED"
	order.CreatedAt = time.Now().UnixMilli()
	order.UpdatedAt = order.CreatedAt

	positionValue := order.Quantity * order.Price
	order.Margin = positionValue / float64(order.Leverage)

	switch order.Type {
	case "MARKET":
		_, err := me.OpenPosition(order)
		if err != nil {
			order.Status = "FAILED"
			return order, err
		}
		order.Status = "FILLED"
		me.markPrices[order.Symbol] = order.Price

	case "LIMIT":
		order.Status = "OPEN"

	case "STOP":
		order.Status = "WAITING"
	}

	return order, nil
}

func (me *MarginEngine) GetAvailableMargin(userID string) (float64, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()

	account, exists := me.marginAccounts[userID]
	if !exists {
		return 0, fmt.Errorf("margin account not found")
	}

	var usedMargin float64
	prefix := userID + ":"

	for key, pos := range me.crossPositions {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			usedMargin += pos.Margin
		}
	}

	return account.TotalEquity - usedMargin, nil
}

func (me *MarginEngine) AddMargin(userID, symbol string, amount float64) error {
	me.mu.Lock()
	defer me.mu.Unlock()

	if amount <= 0 {
		return fmt.Errorf("invalid amount")
	}

	account, exists := me.marginAccounts[userID]
	if !exists {
		return fmt.Errorf("margin account not found")
	}

	account.TotalEquity += amount
	account.LastUpdate = time.Now().UnixMilli()

	if symbol != "" {
		key := userID + ":" + symbol
		if pos, exists := me.crossPositions[key]; exists {
			pos.Margin += amount
		}
	}

	return nil
}

func (me *MarginEngine) AssessRisk(userID string) string {
	me.mu.RLock()
	defer me.mu.RUnlock()

	account, exists := me.marginAccounts[userID]
	if !exists {
		return "UNKNOWN"
	}

	var totalExposure float64
	var totalMargin float64

	prefix := userID + ":"
	for key, pos := range me.crossPositions {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			totalExposure += math.Abs(pos.Size) * pos.MarkPrice
			totalMargin += pos.Margin
		}
	}

	if totalMargin == 0 {
		return "SAFE"
	}

	marginRatio := totalMargin / totalExposure

	if marginRatio > 0.30 {
		return "SAFE"
	} else if marginRatio > 0.15 {
		return "MODERATE"
	} else if marginRatio > 0.05 {
		return "HIGH"
	} else {
		return "LIQUIDATION"
	}
}

type RiskMetrics struct {
	UserID              string  `json:"userId"`
	TotalPositions      int     `json:"totalPositions"`
	TotalExposure       float64 `json:"totalExposure"`
	TotalMargin         float64 `json:"totalMargin"`
	TotalEquity         float64 `json:"totalEquity"`
	TotalUnrealizedPnL  float64 `json:"totalUnrealizedPnl"`
	MarginRatio         float64 `json:"marginRatio"`
	LeverageUsed        float64 `json:"leverageUsed"`
	RiskLevel           string  `json:"riskLevel"`
}

func (me *MarginEngine) GetRiskMetrics(userID string) *RiskMetrics {
	me.mu.RLock()
	defer me.mu.RUnlock()

	account, exists := me.marginAccounts[userID]
	if !exists {
		return nil
	}

	metrics := &RiskMetrics{UserID: userID}

	var totalExposure float64
	var totalMargin float64

	prefix := userID + ":"
	for key, pos := range me.crossPositions {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix {
			totalExposure += math.Abs(pos.Size) * pos.MarkPrice
			totalMargin += pos.Margin
			metrics.TotalPositions++
			metrics.TotalUnrealizedPnL += pos.UnrealizedPnL
		}
	}

	metrics.TotalExposure = totalExposure
	metrics.TotalMargin = totalMargin
	metrics.TotalEquity = account.TotalEquity

	if totalExposure > 0 {
		metrics.MarginRatio = totalMargin / totalExposure
		metrics.LeverageUsed = totalExposure / totalMargin
	}

	metrics.RiskLevel = me.AssessRisk(userID)

	return metrics
}

var _ = atomic.AddInt64
var _ = sync.Mutex{}
var _ = fmt.Sprintf
var _ = math.Abs