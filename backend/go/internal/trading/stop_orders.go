// Package trading provides advanced order types including stop-loss, OCO, trailing stop
package trading

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var (
	ErrStopNotTriggered = errors.New("stop price not triggered")
	ErrOCOPairNotFound = errors.New("OCO pair not found")
)

// StopOrderHandler handles stop orders
type StopOrderHandler struct {
	orders map[string]*api.Order
}

func NewStopOrderHandler() *StopOrderHandler {
	return &StopOrderHandler{
		orders: make(map[string]*api.Order),
	}
}

// CheckStopOrder checks if a stop order should be triggered
func (h *StopOrderHandler) CheckStopOrder(order *api.Order, currentPrice float64) bool {
	if order == nil {
		return false
	}

	switch order.Type {
	case "stop_loss", "stop_limit":
		return h.checkStopLossTrigger(order, currentPrice)
	case "trailing_stop":
		return h.checkTrailingStopTrigger(order, currentPrice)
	default:
		return false
	}
}

func (h *StopOrderHandler) checkStopLossTrigger(order *api.Order, currentPrice float64) bool {
	if order.StopPrice <= 0 {
		return false
	}

	switch order.Side {
	case "buy":
		// Buy stop triggers when price rises to or above stop price
		return currentPrice >= order.StopPrice
	case "sell":
		// Sell stop triggers when price falls to or below stop price
		return currentPrice <= order.StopPrice
	}
	return false
}

func (h *StopOrderHandler) checkTrailingStopTrigger(order *api.Order, currentPrice float64) bool {
	if order.TrailingDistance <= 0 {
		return false
	}

	// For trailing stop, we need to track the highest/lowest price since order creation
	// This is a simplified version
	switch order.Side {
	case "buy":
		// Trigger when price drops by trailing distance from highest
		// For now, just check if current price dropped from some reference
		return true // Real implementation would track high price
	case "sell":
		// Trigger when price rises by trailing distance from lowest
		return true // Real implementation would track low price
	}
	return false
}

// TriggerStopOrder converts a stop order to a limit/market order
func (h *StopOrderHandler) TriggerStopOrder(order *api.Order, currentPrice float64) *api.Order {
	if order == nil || order.Status != "new" {
		return nil
	}

	switch order.Type {
	case "stop_loss":
		// Convert to market order
		order.Type = "market"
		order.Status = "triggered"
	case "stop_limit":
		// Convert to limit order at stop price
		order.Type = "limit"
		order.Price = order.StopPrice
		order.Status = "triggered"
	case "trailing_stop":
		// Calculate actual stop price based on trailing distance
		if order.Side == "buy" {
			order.StopPrice = currentPrice - order.TrailingDistance
		} else {
			order.StopPrice = currentPrice + order.TrailingDistance
		}
		order.Type = "market"
		order.Status = "triggered"
	}

	order.UpdatedAt = api.Now()
	return order
}

// OCOHandler handles One-Cancels-Other orders
type OCOHandler struct {
	pairs map[string]*OCOPair
}

type OCOPair struct {
	ID          string
	Order1ID    string
	Order2ID    string
	UserID      string
	TriggeredAt int64
	Active      bool
}

func NewOCOHandler() *OCOHandler {
	return &OCOHandler{
		pairs: make(map[string]*OCOPair),
	}
}

// CreateOCOPair creates an OCO pair
func (h *OCOHandler) CreateOCOPair(userID, symbol, side string, quantity, limitPrice, stopPrice float64) (*api.Order, *api.Order, string, error) {
	pairID := uuid.New().String()

	// Create limit order
	order1 := &api.Order{
		ID:          uuid.New().String(),
		UserID:      userID,
		Symbol:     symbol,
		Side:       side,
		Type:       "limit",
		Quantity:   quantity,
		Price:      limitPrice,
		Status:     "new",
		TimeInForce: "GTC",
		CreatedAt:  api.Now(),
		UpdatedAt:  api.Now(),
	}

	// Create stop order
	order2 := &api.Order{
		ID:          uuid.New().String(),
		UserID:      userID,
		Symbol:     symbol,
		Side:       side,
		Type:       "stop_loss",
		Quantity:   quantity,
		StopPrice:  stopPrice,
		Status:     "new",
		TimeInForce: "GTC",
		CreatedAt:  api.Now(),
		UpdatedAt:  api.Now(),
	}

	// Store pair
	h.pairs[pairID] = &OCOPair{
		ID:       pairID,
		Order1ID: order1.ID,
		Order2ID: order2.ID,
		UserID:   userID,
		Active:  true,
	}

	return order1, order2, pairID, nil
}

// TriggerOCO triggers one order and cancels the other
func (h *OCOHandler) TriggerOCO(pairID, triggeredOrderID string, orders map[string]*api.Order) error {
	pair, ok := h.pairs[pairID]
	if !ok || !pair.Active {
		return ErrOCOPairNotFound
	}

	// Determine which order was triggered
	var cancelOrderID string
	if pair.Order1ID == triggeredOrderID {
		cancelOrderID = pair.Order2ID
	} else if pair.Order2ID == triggeredOrderID {
		cancelOrderID = pair.Order1ID
	} else {
		return errors.New("order not in OCO pair")
	}

	// Mark triggered order as triggered
	if order, ok := orders[triggeredOrderID]; ok {
		order.Status = "triggered"
		order.UpdatedAt = api.Now()
	}

	// Cancel the other order
	if cancelOrder, ok := orders[cancelOrderID]; ok {
		cancelOrder.Status = "cancelled"
		cancelOrder.UpdatedAt = api.Now()
	}

	// Mark pair as inactive
	pair.Active = false
	pair.TriggeredAt = api.Now()

	return nil
}

// AlgoExecutionHandler handles TWAP, VWAP, and iceberg orders
type AlgoExecutionHandler struct {
	executions map[string]*AlgoExecution
}

type AlgoExecution struct {
	OrderID      string
	UserID       string
	Symbol       string
	Side         string
	TotalQty     float64
	ExecutedQty  float64
	AvgPrice     float64
	SliceQty     float64
	StartTime    int64
	EndTime      int64
	Slices       int
	MaxSlippage  float64
	Status       string
	ChildOrders  []string
	CreatedAt    int64
}

func NewAlgoExecutionHandler() *AlgoExecutionHandler {
	return &AlgoExecutionHandler{
		executions: make(map[string]*api.Order),
	}
}

// CreateTWAPExecution creates a TWAP execution
func (h *AlgoExecutionHandler) CreateTWAPExecution(
	userID, symbol, side string,
	quantity float64,
	startTime, endTime int64,
	slices int,
	maxSlippage float64,
) *AlgoExecution {

	exec := &AlgoExecution{
		OrderID:     uuid.New().String(),
		UserID:      userID,
		Symbol:      symbol,
		Side:        side,
		TotalQty:    quantity,
		ExecutedQty: 0,
		AvgPrice:    0,
		SliceQty:    quantity / float64(slices),
		StartTime:   startTime,
		EndTime:     endTime,
		Slices:      slices,
		MaxSlippage: maxSlippage,
		Status:      "active",
		CreatedAt:   api.Now(),
	}

	h.executions[exec.OrderID] = nil
	return exec
}

// CreateVWAPExecution creates a VWAP execution
func (h *AlgoExecutionHandler) CreateVWAPExecution(
	userID, symbol, side string,
	quantity float64,
	startTime, endTime int64,
	slices int,
	maxSlippage float64,
	volumeProfile []float64,
) *AlgoExecution {

	exec := &AlgoExecution{
		OrderID:     uuid.New().String(),
		UserID:      userID,
		Symbol:      symbol,
		Side:        side,
		TotalQty:    quantity,
		ExecutedQty: 0,
		AvgPrice:    0,
		SliceQty:    quantity / float64(slices),
		StartTime:   startTime,
		EndTime:     endTime,
		Slices:      slices,
		MaxSlippage: maxSlippage,
		Status:      "active",
		CreatedAt:   api.Now(),
	}

	h.executions[exec.OrderID] = nil
	return exec
}

// CreateIcebergExecution creates an iceberg execution
func (h *AlgoExecutionHandler) CreateIcebergExecution(
	userID, symbol, side string,
	quantity, price, displayQty float64,
) *AlgoExecution {

	exec := &AlgoExecution{
		OrderID:     uuid.New().String(),
		UserID:      userID,
		Symbol:      symbol,
		Side:        side,
		TotalQty:    quantity,
		ExecutedQty: 0,
		AvgPrice:    0,
		SliceQty:    displayQty,
		Status:      "active",
		CreatedAt:   api.Now(),
	}

	h.executions[exec.OrderID] = nil
	return exec
}

// CheckSlice checks if a new slice should be executed
func (h *AlgoExecutionHandler) CheckSlice(exec *AlgoExecution, currentPrice, vwap float64) bool {
	if exec == nil || exec.Status != "active" {
		return false
	}

	// Check if within time window
	now := api.Now()
	if now < exec.StartTime || now > exec.EndTime {
		return false
	}

	// Check slippage for VWAP
	if exec.MaxSlippage > 0 {
		var slippage float64
		switch exec.Side {
		case "buy":
			slippage = (currentPrice - vwap) / vwap
		case "sell":
			slippage = (vwap - currentPrice) / vwap
		}

		if slippage > exec.MaxSlippage {
			return false
		}
	}

	// Check if all slices executed
	return exec.ExecutedQty < exec.TotalQty
}

// UpdateExecution updates execution with trade result
func (h *AlgoExecutionHandler) UpdateExecution(exec *AlgoExecution, tradePrice, tradeQty float64) {
	if exec == nil {
		return
	}

	// Update executed quantity
	exec.ExecutedQty += tradeQty

	// Update average price
	totalValue := exec.AvgPrice*(exec.ExecutedQty-tradeQty) + tradePrice*tradeQty
	exec.AvgPrice = totalValue / exec.ExecutedQty

	// Check if complete
	if exec.ExecutedQty >= exec.TotalQty {
		exec.Status = "completed"
	}
}

// GridTradingBot represents a grid trading bot
type GridTradingBot struct {
	ID              string
	UserID          string
	Symbol          string
	UpperPrice      float64
	LowerPrice      float64
	GridCount       int
	GridSpacing     float64
	TotalInvestment float64
	CurrentProfits  float64
	Status          string
	OpenPositions   []GridPosition
	CreatedAt       int64
}

type GridPosition struct {
	GridLevel  int
	BuyPrice   float64
	SellPrice  float64
	Quantity   float64
	Side       string // "buy" or "sell"
}

// CreateGridBot creates a new grid trading bot
func CreateGridBot(userID, symbol string, upperPrice, lowerPrice float64, gridCount int) *GridTradingBot {
	gridSpacing := (upperPrice - lowerPrice) / float64(gridCount)

	bot := &GridTradingBot{
		ID:              uuid.New().String(),
		UserID:          userID,
		Symbol:          symbol,
		UpperPrice:      upperPrice,
		LowerPrice:      lowerPrice,
		GridCount:       gridCount,
		GridSpacing:     gridSpacing,
		Status:          "active",
		OpenPositions:   make([]GridPosition, 0),
		CreatedAt:       api.Now(),
	}

	return bot
}

// GetGridLevels calculates all grid levels
func (b *GridTradingBot) GetGridLevels() []GridPosition {
	levels := make([]GridPosition, 0, b.GridCount)

	for i := 0; i < b.GridCount; i++ {
		buyPrice := b.LowerPrice + float64(i)*b.GridSpacing
		sellPrice := buyPrice + b.GridSpacing

		level := GridPosition{
			GridLevel:  i,
			BuyPrice:   buyPrice,
			SellPrice:  sellPrice,
			Quantity:   0,
			Side:       "",
		}
		levels = append(levels, level)
	}

	return levels
}

// DCABot represents a Dollar-Cost Averaging bot
type DCABot struct {
	ID              string
	UserID          string
	Symbol          string
	BuyAmount       float64
	IntervalHours   int
	TotalOrders     int
	CompletedOrders int
	Status          string
	NextBuyTime     int64
	CreatedAt       int64
}

// CreateDCABot creates a new DCA bot
func CreateDCABot(userID, symbol string, buyAmount float64, intervalHours int) *DCABot {
	return &DCABot{
		ID:              uuid.New().String(),
		UserID:          userID,
		Symbol:          symbol,
		BuyAmount:       buyAmount,
		IntervalHours:   intervalHours,
		TotalOrders:     0,
		CompletedOrders: 0,
		Status:          "active",
		NextBuyTime:     api.Now(),
		CreatedAt:       api.Now(),
	}
}

// ShouldExecute checks if DCA should execute
func (b *DCABot) ShouldExecute() bool {
	if b.Status != "active" {
		return false
	}

	return api.Now() >= b.NextBuyTime
}

// Execute performs a DCA purchase
func (b *DCABot) Execute(currentPrice float64) {
	if !b.ShouldExecute() {
		return
	}

	b.CompletedOrders++
	b.NextBuyTime = api.Now() + int64(b.IntervalHours*3600)
}

// CopyTradingHandler handles copy trading
type CopyTradingHandler struct {
	LeaderPositions map[string]*LeaderPosition
	Followers      map[string]*Follower
}

type LeaderPosition struct {
	UserID      string
	Symbol     string
	Side       string
	Quantity   float64
	EntryPrice float64
	StopLoss   float64
	TakeProfit float64
	OpenedAt   int64
}

type Follower struct {
	UserID        string
	LeaderID      string
	CopiedOrders  []string
	CopiedAmount  float64
	CopyRatio     float64 // 0.0 - 1.0
	Status        string
	CreatedAt     int64
}

// NewCopyTradingHandler creates a new copy trading handler
func NewCopyTradingHandler() *CopyTradingHandler {
	return &CopyTradingHandler{
		LeaderPositions: make(map[string]*LeaderPosition),
		Followers:      make(map[string]*Follower),
	}
}

// FollowLeader starts following a leader
func (h *CopyTradingHandler) FollowLeader(followerID, leaderID string, copyRatio float64) *Follower {
	follower := &Follower{
		UserID:       followerID,
		LeaderID:     leaderID,
		CopiedOrders: make([]string, 0),
		CopiedAmount: 0,
		CopyRatio:    math.Min(1.0, math.Max(0.1, copyRatio)),
		Status:       "active",
		CreatedAt:    api.Now(),
	}

	h.Followers[followerID] = follower
	return follower
}

// UnfollowLeader stops following a leader
func (h *CopyTradingHandler) UnfollowLeader(followerID string) error {
	follower, ok := h.Followers[followerID]
	if !ok {
		return errors.New("not following")
	}

	follower.Status = "inactive"
	return nil
}

// CopyOrder copies an order from leader to follower
func (h *CopyTradingHandler) CopyOrder(leaderOrder *api.Order, follower *Follower) *api.Order {
	if follower == nil || follower.Status != "active" {
		return nil
	}

	// Calculate copied quantity
	quantity := leaderOrder.Quantity * follower.CopyRatio

	// Create follower order
	copiedOrder := &api.Order{
		ID:          uuid.New().String(),
		UserID:      follower.UserID,
		Symbol:      leaderOrder.Symbol,
		Side:        leaderOrder.Side,
		Type:        leaderOrder.Type,
		Quantity:    quantity,
		Price:       leaderOrder.Price,
		StopPrice:   leaderOrder.StopPrice,
		Status:      "new",
		TimeInForce: leaderOrder.TimeInForce,
		CreatedAt:   api.Now(),
		UpdatedAt:   api.Now(),
	}

	follower.CopiedOrders = append(follower.CopiedOrders, copiedOrder.ID)
	follower.CopiedAmount += quantity * leaderOrder.Price

	return copiedOrder
}

// SignalTradingHandler handles signal trading
type SignalTradingHandler struct {
	Signals     map[string]*Signal
	Subscriptions map[string][]string
}

type Signal struct {
	ID          string
	LeaderID   string
	Symbol     string
	Action     string // "buy" or "sell"
	EntryPrice float64
	StopLoss   float64
	TakeProfit float64
	Confidence int // 0-100
	CreatedAt  int64
	ExpiresAt  int64
	Status     string
}

// NewSignalTradingHandler creates a new signal trading handler
func NewSignalTradingHandler() *SignalTradingHandler {
	return &SignalTradingHandler{
		Signals:        make(map[string]*Signal),
		Subscriptions:  make(map[string][]string),
	}
}

// CreateSignal creates a new trading signal
func (h *SignalTradingHandler) CreateSignal(
	leaderID, symbol, action string,
	entryPrice, stopLoss, takeProfit float64,
	confidence int,
	ttlMinutes int,
) *Signal {

	signal := &Signal{
		ID:          uuid.New().String(),
		LeaderID:   leaderID,
		Symbol:     symbol,
		Action:     action,
		EntryPrice: entryPrice,
		StopLoss:   stopLoss,
		TakeProfit: takeProfit,
		Confidence: confidence,
		CreatedAt:  api.Now(),
		ExpiresAt:  api.Now() + int64(ttlMinutes*60),
		Status:     "active",
	}

	h.Signals[signal.ID] = signal
	return signal
}

// Subscribe subscribes to a leader's signals
func (h *SignalTradingHandler) Subscribe(followerID, leaderID string) {
	h.Subscriptions[leaderID] = append(h.Subscriptions[leaderID], followerID)
}

// GetActiveSignals gets all active signals for a leader
func (h *SignalTradingHandler) GetActiveSignals(leaderID string) []*Signal {
	var result []*Signal

	for _, signal := range h.Signals {
		if signal.LeaderID == leaderID && signal.Status == "active" && signal.ExpiresAt > api.Now() {
			result = append(result, signal)
		}
	}

	return result
}

// SignalTradingBot represents a signal trading bot
type SignalTradingBot struct {
	ID              string
	UserID          string
	Strategy        string
	Symbols         []string
	MaxPositions    int
	RiskLevel       string // "low", "medium", "high"
	Status          string
	CurrentPositions []SignalPosition
	CreatedAt       int64
}

type SignalPosition struct {
	Symbol     string
	EntryPrice float64
	StopLoss   float64
	TakeProfit float64
	Quantity   float64
	Side       string
	OpenedAt   int64
}

// CreateSignalBot creates a new signal trading bot
func CreateSignalBot(userID, strategy string, symbols []string, maxPositions int, riskLevel string) *SignalTradingBot {
	return &SignalTradingBot{
		ID:               uuid.New().String(),
		UserID:           userID,
		Strategy:         strategy,
		Symbols:          symbols,
		MaxPositions:     maxPositions,
		RiskLevel:        riskLevel,
		Status:           "active",
		CurrentPositions: make([]SignalPosition, 0),
		CreatedAt:        api.Now(),
	}
}