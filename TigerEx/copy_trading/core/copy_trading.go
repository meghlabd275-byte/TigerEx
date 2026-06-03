// Package core provides copy trading functionality.
// Enables following of expert traders with automatic trade copying.
package core

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// Trader represents a signal provider (expert trader)
type Trader struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Username      string          `json:"username"`
	Avatar        string          `json:"avatar"`
	Bio           string          `json:"bio"`
	Rating        decimal.Decimal `json:"rating"` // 0-5 stars
	TotalProfit   decimal.Decimal `json:"total_profit"`
	WinRate       decimal.Decimal `json:"win_rate"` // Percentage
	TotalTrades  int             `json:"total_trades"`
	Followers    int             `json:"followers"`
	TotalAUM     decimal.Decimal `json:"total_aum"` // Assets under management
	CopyTradingEnabled bool       `json:"copy_trading_enabled"`
	IsVerified   bool            `json:"is_verified"`
	IsPro       bool            `json:"is_pro"`
	FeePercentage decimal.Decimal `json:"_fee_percentage"` // Performance fee
	MinFollowAmount decimal.Decimal `json:"min_follow_amount"`
	MaxFollowAmount decimal.Decimal `json:"max_follow_amount"`
	TradeTypes   []string       `json:"trade_types"` // SPOT, MARGIN, FUTURES
	Status       TraderStatus    `json:"status"`
	CreatedAt   time.Time      `json:"created_at"`
}

// TraderStatus represents trader status
type TraderStatus string

const (
	TraderStatusActive   TraderStatus = "ACTIVE"
	TraderStatusPaused  TraderStatus = "PAUSED"
	TraderStatusSuspended TraderStatus = "SUSPENDED"
)

// Follower represents a follower (copy trader)
type Follower struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	TraderID     string          `json:"trader_id"`
	CopyRatio    decimal.Decimal `json:"copy_ratio"` // 0.1 - 10.0
	AllocatedAmount decimal.Decimal `json:"allocated_amount"`
	CurrentValue decimal.Decimal `json:"current_value"`
	UnrealizedPnL decimal.Decimal `json:"unrealized_pnl"`
	RealizedPnL  decimal.Decimal `json:"realized_pnl"`
	Status       FollowerStatus `json:"status"`
	StopLossPct  decimal.Decimal `json:"stop_loss_pct"` // Auto-close at loss %
	TakeProfitPct decimal.Decimal `json:"take_profit_pct"` // Auto-close at profit %
	MaxOpenPositions int       `json:"max_open_positions"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

// FollowerStatus represents follower status
type FollowerStatus string

const (
	FollowerStatusActive  FollowerStatus = "ACTIVE"
	FollowerStatusPaused FollowerStatus = "PAUSED"
	FollowerStatusStopped FollowerStatus = "STOPPED"
)

// CopyOrder represents a copied order
type CopyOrder struct {
	ID              string          `json:"id"`
	FollowerID     string          `json:"follower_id"`
	TraderOrderID  string         `json:"trader_order_id"`
	Symbol         string         `json:"symbol"`
	Side           string         `json:"side"`
	OrderType      string         `json:"order_type"`
	Size           decimal.Decimal `json:"size"`
	EntryPrice     decimal.Decimal `json:"entry_price"`
	CurrentPrice   decimal.Decimal `json:"current_price"`
	PnL            decimal.Decimal `json:"pnl"`
	Status         CopyOrderStatus `json:"status"`
	CopiedAt       time.Time     `json:"copied_at"`
	ClosedAt       *time.Time    `json:"closed_at,omitempty"`
}

// CopyOrderStatus represents copy order status
type CopyOrderStatus string

const (
	CopyOrderStatusOpen    CopyOrderStatus = "OPEN"
	CopyOrderStatusPartial CopyOrderStatus = "PARTIAL"
	CopyOrderStatusClosed CopyOrderStatus = "CLOSED"
	Canceled           CopyOrderStatus = "CANCELLED"
)

// TraderPerformance represents trader performance metrics
type TraderPerformance struct {
	TraderID      string          `json:"trader_id"`
	Period        string         `json:"period"` // 7D, 30D, 90D, ALL
	TotalReturn   decimal.Decimal `json:"total_return"`
	MonthlyReturn decimal.Decimal `json:"monthly_return"`
	SharpeRatio   decimal.Decimal `json:"sharpe_ratio"`
	MaxDrawdown  decimal.Decimal `json:"max_drawdown"`
	WinRate      decimal.Decimal `json:"win_rate"`
	ProfitFactor decimal.Decimal `json:"profit_factor"`
	TradesCount  int             `json:"trades_count"`
	WinningTrades int            `json:"winning_trades"`
	LosingTrades  int            `json:"losing_trades"`
}

// TraderRank represents trader ranking
type TraderRank struct {
	Rank      int             `json:"rank"`
	TraderID  string         `json:"trader_id"`
	Username  string         `json:"username"`
	Avatar    string         `json:"avatar"`
	Return    decimal.Decimal `json:"return"`
	Followers int            `json:"followers"`
	AUM       decimal.Decimal `json:"aum"`
}

// CopyConfig represents copy trading configuration
type CopyConfig struct {
	TraderID       string
	FollowerID    string
	CopyRatio     decimal.Decimal
	AllocatedAmt  decimal.Decimal
	StopLossPct   decimal.Decimal
	TakeProfitPct decimal.Decimal
	MaxPositions int
}

// CopyTradeConfig represents copy trading configuration
type CopyTradeConfig struct {
	MinCopyRatio   decimal.Decimal
	MaxCopyRatio   decimal.Decimal
	MinAllocation  decimal.Decimal
	MaxAllocation  decimal.Decimal
	DefaultStopLoss decimal.Decimal
	DefaultTakeProfit decimal.Decimal
	MaxFollowersPerTrader int
	MaxTradersPerUser int
}

// CopyEngine manages copy trading operations
type CopyEngine struct {
	mu              sync.RWMutex
	traders         map[string]*Trader
	followers       map[string]*Follower
	copyOrders      map[string]*CopyOrder
	orderRouter     OrderRouter
	priceFeed      PriceFeed
	tradingEngine  TradingEngine
	allocationCalc AllocationCalculator
	cfg            *CopyTradeConfig
}

// OrderRouter routes orders to exchange
type OrderRouter interface {
	RouteOrder(ctx context.Context, order *OrderRequest) (string, error)
}

// PriceFeed provides price data
type PriceFeed interface {
	GetPrice(symbol string) (decimal.Decimal, error)
}

// TradingEngine provides trading functionality
type TradingEngine interface {
	GetPositions(userID string) ([]*Position, error)
	GetOpenOrders(userID string) ([]*Order, error)
}

// AllocationCalculator calculates position sizing
type AllocationCalculator interface {
	CalculateSize(follower *Follower, traderSize decimal.Decimal) decimal.Decimal
}

// Position represents a trading position
type Position struct {
	ID        string
	Symbol    string
	Size      decimal.Decimal
	PnL       decimal.Decimal
}

// Order represents a trading order
type Order struct {
	ID      string
	Symbol  string
	Side    string
	Size    decimal.Decimal
	Status  string
}

// OrderRequest represents order request
type OrderRequest struct {
	UserID   string
	Symbol   string
	Side    string
	Type    string
	Size    decimal.Decimal
	Price   decimal.Decimal
}

// NewCopyEngine creates new copy trading engine
func NewCopyEngine() *CopyEngine {
	return &CopyEngine{
		traders:    make(map[string]*Trader),
		followers:  make(map[string]*Follower),
		copyOrders: make(map[string]*CopyOrder),
		cfg: &CopyTradeConfig{
			MinCopyRatio:   decimal.NewFromFloat(0.1),
			MaxCopyRatio:   decimal.NewFromFloat(10.0),
			MinAllocation:  decimal.NewFromInt(100),
			MaxAllocation: decimal.NewFromInt(1000000),
			DefaultStopLoss: decimal.NewFromFloat(20), // 20%
			DefaultTakeProfit: decimal.NewFromFloat(50), // 50%
			MaxFollowersPerTrader: 10000,
			MaxTradersPerUser: 20,
		},
	}
}

// EnableCopyTrading enables a user to be copied
func (ce *CopyEngine) EnableCopyTrading(ctx context.Context, userID string, config *EnableTradingConfig) (*Trader, error) {
	trader := &Trader{
		ID:              generateTraderID(),
		UserID:          userID,
		Username:        config.Username,
		Rating:         decimal.NewFromFloat(5), // Default
		TotalProfit:    decimal.Zero,
		WinRate:        decimal.Zero,
		TotalTrades:    0,
		Followers:      0,
		TotalAUM:       decimal.Zero,
		CopyTradingEnabled: true,
		IsVerified:     false,
		FeePercentage:  config.FeePercentage,
		MinFollowAmount: config.MinAmount,
		MaxFollowAmount: config.MaxAmount,
		TradeTypes:    config.TradeTypes,
		Status:        TraderStatusActive,
		CreatedAt:     time.Now(),
	}

	ce.mu.Lock()
	ce.traders[trader.ID] = trader
	ce.mu.Unlock()

	return trader, nil
}

// DisableCopyTrading disables copy trading for user
func (ce *CopyEngine) DisableCopyTrading(ctx context.Context, userID string) error {
	ce.mu.Lock()
	defer ce.mu.Unlock()

	var trader *Trader
	for _, t := range ce.traders {
		if t.UserID == userID {
			trader = t
			break
		}
	}

	if trader == nil {
		return fmt.Errorf("trader not found")
	}

	trader.CopyTradingEnabled = false
	trader.Status = TraderStatusPaused

	return nil
}

// FollowTrader starts copying a trader
func (ce *CopyEngine) FollowTrader(ctx context.Context, userID, traderID string, config *CopyConfig) (*Follower, error) {
	// Validate trader
	ce.mu.RLock()
	trader, ok := ce.traders[traderID]
	ce.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("trader not found")
	}

	if !trader.CopyTradingEnabled {
		return nil, fmt.Errorf("trader not accepting new followers")
	}

	// Validate config
	if config.AllocatedAmt.LessThan(trader.MinFollowAmount) {
		return nil, fmt.Errorf("minimum allocation is %s", trader.MinFollowAmount.String())
	}

	if trader.MaxFollowAmount.IsZero() == false && config.AllocatedAmt.GreaterThan(trader.MaxFollowAmount) {
		return nil, fmt.Errorf("maximum allocation is %s", trader.MaxFollowAmount.String())
	}

	if config.CopyRatio.LessThan(ce.cfg.MinCopyRatio) || config.CopyRatio.GreaterThan(ce.cfg.MaxCopyRatio) {
		return nil, fmt.Errorf("copy ratio must be between %s and %s", ce.cfg.MinCopyRatio.String(), ce.cfg.MaxCopyRatio.String())
	}

	// Check follower limit
	if trader.Followers >= ce.cfg.MaxFollowersPerTrader {
		return nil, fmt.Errorf("trader has reached maximum followers")
	}

	follower := &Follower{
		ID:             generateFollowerID(),
		UserID:         userID,
		TraderID:       traderID,
		CopyRatio:      config.CopyRatio,
		AllocatedAmount: config.AllocatedAmt,
		CurrentValue:   config.AllocatedAmt,
		Status:         FollowerStatusActive,
		StopLossPct:    config.StopLossPct,
		TakeProfitPct: config.TakeProfitPct,
		MaxOpenPositions: config.MaxPositions,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	ce.mu.Lock()
	ce.followers[follower.ID] = follower
	trader.Followers++
	trader.TotalAUM = trader.TotalAUM.Add(config.AllocatedAmt)
	ce.mu.Unlock()

	return follower, nil
}

// UnfollowTrader stops copying a trader
func (ce *CopyEngine) UnfollowTrader(ctx context.Context, followerID string) error {
	ce.mu.RLock()
	follower, ok := ce.followers[followerID]
	ce.mu.RUnlock()

	if !ok {
		return fmt.Errorf("follower not found")
	}

	// Close all copy orders
	ce.mu.Lock()
	for _, order := range ce.copyOrders {
		if order.FollowerID == followerID && order.Status == CopyOrderStatusOpen {
			// Close position
			order.Status = Canceled
		}
	}

	// Update trader stats
	if trader, ok := ce.traders[follower.TraderID]; ok {
		trader.Followers--
		trader.TotalAUM = trader.TotalAUM.Sub(follower.AllocatedAmount)
	}

	follower.Status = FollowerStatusStopped
	ce.mu.Unlock()

	return nil
}

// UpdateFollowSettings updates follower settings
func (ce *CopyEngine) UpdateFollowSettings(ctx context.Context, followerID string, config *CopyConfig) (*Follower, error) {
	ce.mu.RLock()
	follower, ok := ce.followers[followerID]
	ce.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("follower not found")
	}

	ce.mu.Lock()
	if config.CopyRatio.IsZero() == false {
		follower.CopyRatio = config.CopyRatio
	}
	if config.AllocatedAmt.IsZero() == false {
		follower.AllocatedAmount = config.AllocatedAmt
		follower.CurrentValue = config.AllocatedAmt
	}
	if config.StopLossPct.IsZero() == false {
		follower.StopLossPct = config.StopLossPct
	}
	if config.TakeProfitPct.IsZero() == false {
		follower.TakeProfitPct = config.TakeProfitPct
	}
	if config.MaxPositions > 0 {
		follower.MaxOpenPositions = config.MaxPositions
	}
	follower.UpdatedAt = time.Now()
	ce.mu.Unlock()

	return follower, nil
}

// ProcessTraderOrder processes new order from trader
func (ce *CopyEngine) ProcessTraderOrder(ctx context.Context, traderID string, traderOrder *TraderOrder) error {
	// Get all followers
	ce.mu.RLock()
	var activeFollowers []*Follower
	for _, f := range ce.followers {
		if f.TraderID == traderID && f.Status == FollowerStatusActive {
			activeFollowers = append(activeFollowers, f)
		}
	}
	ce.mu.RUnlock()

	if len(activeFollowers) == 0 {
		return nil
	}

	// Get trader info
	trader, _ := ce.traders[traderID]
	if trader == nil || !trader.CopyTradingEnabled {
		return nil
	}

	// Process for each follower
	for _, follower := range activeFollowers {
		// Check if should copy (position limit)
		if !ce.checkPositionLimit(follower) {
			continue
		}

		// Calculate copy size
		copySize := ce.allocationCalc.CalculateSize(follower, traderOrder.Size)

		// Check if within allocation
		if copySize.GreaterThan(follower.AllocatedAmount) {
			copySize = follower.AllocatedAmount
		}

		// Create copy order
		copyOrder := &CopyOrder{
			ID:            generateCopyOrderID(),
			FollowerID:   follower.ID,
			TraderOrderID: traderOrder.ID,
			Symbol:       traderOrder.Symbol,
			Side:         traderOrder.Side,
			OrderType:    traderOrder.OrderType,
			Size:         copySize,
			Status:       CopyOrderStatusOpen,
			CopiedAt:    time.Now(),
		}

		// Execute order via router
		orderReq := &OrderRequest{
			UserID: follower.UserID,
			Symbol: copyOrder.Symbol,
			Side:  copyOrder.Side,
			Type:  copyOrder.OrderType,
			Size:  copyOrder.Size,
		}

		orderID, err := ce.orderRouter.RouteOrder(ctx, orderReq)
		if err != nil {
			copyOrder.Status = Canceled
		}

		ce.mu.Lock()
		ce.copyOrders[copyOrder.ID] = copyOrder
		ce.mu.Unlock()
	}

	return nil
}

// ProcessTraderClose processes order close from trader
func (ce *CopyEngine) ProcessTraderClose(ctx context.Context, traderID, traderOrderID string, closeSize decimal.Decimal) error {
	ce.mu.RLock()
	var followerOrders []*CopyOrder
	for _, order := range ce.copyOrders {
		if order.TraderOrderID == traderOrderID && order.Status == CopyOrderStatusOpen {
			followerOrders = append(followerOrders, order)
		}
	}
	ce.mu.RUnlock()

	for _, order := range followerOrders {
		follower, _ := ce.followers[order.FollowerID]

		// Calculate close amount
		closeAmount := closeSize.Mul(follower.CopyRatio)

		// Execute close order
		closeReq := &OrderRequest{
			UserID: follower.UserID,
			Symbol: order.Symbol,
			Side:   "SELL", // Always close
			Type:   "MARKET",
			Size:   closeAmount,
		}

		ce.orderRouter.RouteOrder(ctx, closeReq)

		ce.mu.Lock()
		order.Status = CopyOrderStatusClosed
		now := time.Now()
		order.ClosedAt = &now
		ce.mu.Unlock()
	}

	return nil
}

// UpdatePositions updates follower positions and PnL
func (ce *CopyEngine) UpdatePositions(ctx context.Context) error {
	ce.mu.RLock()
	var followers []*Follower
	for _, f := range ce.followers {
		if f.Status == FollowerStatusActive {
			followers = append(followers, f)
		}
	}
	ce.mu.RUnlock()

	for _, follower := range followers {
		// Get positions from trading engine
		positions, err := ce.tradingEngine.GetPositions(follower.UserID)
		if err != nil {
			continue
		}

		var totalPnL decimal.Decimal
		for _, pos := range positions {
			totalPnL = totalPnL.Add(pos.PnL)
		}

		ce.mu.Lock()
		follower.UnrealizedPnL = totalPnL
		follower.CurrentValue = follower.AllocatedAmount.Add(totalPnL)

		// Check stop loss
		if follower.StopLossPct.IsZero() == false {
			lossPct := follower.UnrealizedPnL.Div(follower.AllocatedAmount).Mul(decimal.NewFromInt(100))
			if lossPct.LessThan(follower.StopLossPct.Neg()) {
				// Trigger stop loss - close all positions
				ce.closeAllPositions(ctx, follower)
			}
		}

		// Check take profit
		if follower.TakeProfitPct.IsZero() == false {
			profitPct := follower.UnrealizedPnL.Div(follower.AllocatedAmount).Mul(decimal.NewFromInt(100))
			if profitPct.GreaterThan(follower.TakeProfitPct) {
				// Trigger take profit - close all positions
				ce.closeAllPositions(ctx, follower)
			}
		}

		follower.UpdatedAt = time.Now()
		ce.mu.Unlock()
	}

	return nil
}

// checkPositionLimit checks if follower can open more positions
func (ce *CopyEngine) checkPositionLimit(follower *Follower) bool {
	ce.mu.RLock()
	defer ce.mu.RUnlock()

	openCount := 0
	for _, order := range ce.copyOrders {
		if order.FollowerID == follower.ID && order.Status == CopyOrderStatusOpen {
			openCount++
		}
	}

	return openCount < follower.MaxOpenPositions
}

// closeAllPositions closes all follower positions
func (ce *CopyEngine) closeAllPositions(ctx context.Context, follower *Follower) {
	positions, err := ce.tradingEngine.GetPositions(follower.UserID)
	if err != nil {
		return
	}

	for _, pos := range positions {
		closeReq := &OrderRequest{
			UserID: follower.UserID,
			Symbol: pos.Symbol,
			Side:   "SELL",
			Type:   "MARKET",
			Size:   pos.Size,
		}
		ce.orderRouter.RouteOrder(ctx, closeReq)
	}
}

// GetTrader returns trader by ID
func (ce *CopyEngine) GetTrader(traderID string) (*Trader, bool) {
	ce.mu.RLock()
	defer ce.mu.RUnlock()
	t, ok := ce.traders[traderID]
	return t, ok
}

// GetFollower returns follower by ID
func (ce *CopyEngine) GetFollower(followerID string) (*Follower, bool) {
	ce.mu.RLock()
	defer ce.mu.RUnlock()
	f, ok := ce.followers[followerID]
	return f, ok
}

// GetFollowerByUser returns follower for user-trader pair
func (ce *CopyEngine) GetFollowerByUser(userID, traderID string) (*Follower, bool) {
	ce.mu.RLock()
	defer ce.mu.RUnlock()

	for _, f := range ce.followers {
		if f.UserID == userID && f.TraderID == traderID {
			return f, true
		}
	}
	return nil, false
}

// GetUserFollowers returns all followers for a user
func (ce *CopyEngine) GetUserFollowers(userID string) []*Follower {
	ce.mu.RLock()
	defer ce.mu.RUnlock()

	var result []*Follower
	for _, f := range ce.followers {
		if f.UserID == userID {
			result = append(result, f)
		}
	}
	return result
}

// GetTraderFollowers returns all followers of a trader
func (ce *CopyEngine) GetTraderFollowers(traderID string) []*Follower {
	ce.mu.RLock()
	defer ce.mu.RUnlock()

	var result []*Follower
	for _, f := range ce.followers {
		if f.TraderID == traderID {
			result = append(result, f)
		}
	}
	return result
}

// GetTopTraders returns top ranked traders
func (ce *CopyEngine) GetTopTraders(limit int, tradeType string) []*TraderRank {
	ce.mu.RLock()
	defer ce.mu.RUnlock()

	type ranked struct {
		trader *Trader
		profit decimal.Decimal
	}

	var rankedTraders []ranked
	for _, t := range ce.traders {
		if !t.CopyTradingEnabled || t.Status != TraderStatusActive {
			continue
		}
		if tradeType != "" && !contains(t.TradeTypes, tradeType) {
			continue
		}
		rankedTraders = append(rankedTraders, ranked{t, t.TotalProfit})
	}

	// Sort by profit
	// Would use sort.Slice in production

	var result []*TraderRank
	for i, r := range rankedTraders {
		if i >= limit {
			break
		}
		result = append(result, &TraderRank{
			Rank:     i + 1,
			TraderID: r.trader.ID,
			Username: r.trader.Username,
			Avatar:   r.trader.Avatar,
			Return:   r.profit,
			Followers: r.trader.Followers,
			AUM:     r.trader.TotalAUM,
		})
	}

	return result
}

// SearchTraders searches traders
func (ce *CopyEngine) SearchTraders(query string, filters *TraderFilters) []*Trader {
	ce.mu.RLock()
	defer ce.mu.RUnlock()

	var result []*Trader
	for _, t := range ce.traders {
		if !t.CopyTradingEnabled {
			continue
		}

		// Check query
		if query != "" && !containsString(t.Username, query) && !containsString(t.Bio, query) {
			continue
		}

		// Apply filters
		if filters != nil {
			if filters.MinFollowers > 0 && t.Followers < filters.MinFollowers {
				continue
			}
			if filters.MinAUM.IsZero() == false && t.TotalAUM.LessThan(filters.MinAUM) {
				continue
			}
		}

		result = append(result, t)
	}

	return result
}

// TraderFilters represents search filters
type TraderFilters struct {
	MinFollowers int
	MinAUM      decimal.Decimal
	TradeType   string
}

// EnableTradingConfig represents enable trading config
type EnableTradingConfig struct {
	Username     string
	Bio         string
	FeePercentage decimal.Decimal
	MinAmount   decimal.Decimal
	MaxAmount   decimal.Decimal
	TradeTypes []string
}

// TraderOrder represents a trader's order
type TraderOrder struct {
	ID        string
	Symbol    string
	Side      string
	OrderType string
	Size      decimal.Decimal
	Price     decimal.Decimal
}

// Helper functions
func generateTraderID() string {
	return fmt.Sprintf("TRD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateFollowerID() string {
	return fmt.Sprintf("FOL%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateCopyOrderID() string {
	return fmt.Sprintf("CPY%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func containsString(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && 
		(len(s) >= len(substr) && (s == substr || 
		(len(s) > len(substr) && (s[:len(substr)] == substr || 
		containsString(s[1:], substr))))
}

var _ = math.Max // Prevent unused