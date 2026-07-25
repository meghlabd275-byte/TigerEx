package gridtrading

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// GRID TRADING ENGINE - PRODUCTION IMPLEMENTATION
// ============================================================================

// GridType represents the type of grid strategy
type GridType string

const (
	GridType arithmetic GridType = "arithmetic" // Equal price intervals
	GridTypeGeometric           GridType = "geometric"  // Equal percentage intervals
	GridTypeDynamic             GridType = "dynamic"    // Auto-adjusting intervals
)

// GridStatus represents the status of a grid strategy
type GridStatus string

const (
	GridStatusPending   GridStatus = "pending"
	GridStatusActive   GridStatus = "active"
	GridStatusPaused   GridStatus = "paused"
	GridStatusStopped  GridStatus = "stopped"
	GridStatusClosed   GridStatus = "closed"
)

// OrderSide represents buy or sell
type OrderSide string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

// GridOrder represents an order placed by grid strategy
type GridOrder struct {
	OrderID        string          `json:"order_id"`
	GridID         string          `json:"grid_id"`
	Side           OrderSide       `json:"side"`
	Price          decimal.Decimal `json:"price"`
	Quantity       decimal.Decimal `json:"quantity"`
	FilledQuantity decimal.Decimal `json:"filled_quantity"`
	Status         string          `json:"status"`
	CreatedAt      int64           `json:"created_at"`
	UpdatedAt      int64           `json:"updated_at"`
}

// GridLevel represents a single grid level
type GridLevel struct {
	Level         int             `json:"level"`
	Price         decimal.Decimal `json:"price"`
	BuyOrderID    string          `json:"buy_order_id,omitempty"`
	SellOrderID   string          `json:"sell_order_id,omitempty"`
	BuyFilled     bool            `json:"buy_filled"`
	SellFilled    bool            `json:"sell_filled"`
	LastUpdateAt  int64           `json:"last_update_at"`
}

// GridStrategy represents a complete grid trading strategy
type GridStrategy struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	Symbol            string          `json:"symbol"`
	GridType          GridType        `json:"grid_type"`
	Status            GridStatus      `json:"status"`
	
	// Grid Parameters
	LowerPrice        decimal.Decimal `json:"lower_price"`
	UpperPrice        decimal.Decimal `json:"upper_price"`
	GridCount         int             `json:"grid_count"`
	GridSpacing       decimal.Decimal `json:"grid_spacing"`
	InvestmentAmount  decimal.Decimal `json:"investment_amount"`
	
	// Risk Management
	MaxPositionSize   decimal.Decimal `json:"max_position_size"`
	StopLoss          decimal.Decimal `json:"stop_loss"`
	TakeProfit        decimal.Decimal `json:"take_profit"`
	
	// Dynamic Grid
	AutoRebalance     bool            `json:"auto_rebalance"`
	MinProfitGrid     int             `json:"min_profit_grid"`
	
	// State
	Levels            []GridLevel     `json:"levels"`
	TotalProfit       decimal.Decimal `json:"total_profit"`
	TotalTrades      int             `json:"total_trades"`
	RunningDays       int             `json:"running_days"`
	
	// Timestamps
	CreatedAt         int64           `json:"created_at"`
	UpdatedAt         int64           `json:"updated_at"`
	LastTradeAt       int64           `json:"last_trade_at"`
	
	mu                sync.RWMutex    `json:"-"`
}

// GridTradingEngine manages all grid strategies
type GridTradingEngine struct {
	strategies map[string]*GridStrategy
	orderFeed  chan GridOrder
	marketFeed chan MarketTick
	
	// Configuration
	config EngineConfig
	
	mu sync.RWMutex `json:"-"`
}

// EngineConfig contains configuration for the grid engine
type EngineConfig struct {
	MaxConcurrentGrids    int           `json:"max_concurrent_grids"`
	DefaultGridCount      int           `json:"default_grid_count"`
	MinGridSpacing        decimal.Decimal `json:"min_grid_spacing"`
	OrderTimeout          time.Duration `json:"order_timeout"`
	RebalanceInterval     time.Duration `json:"rebalance_interval"`
	MaxRetries           int           `json:"max_retries"`
	EnableAutoRecovery    bool          `json:"enable_auto_recovery"`
}

// MarketTick represents a price update
type MarketTick struct {
	Symbol    string          `json:"symbol"`
	Price     decimal.Decimal `json:"price"`
	Volume    decimal.Decimal `json:"volume"`
	Timestamp int64           `json:"timestamp"`
}

// NewGridTradingEngine creates a new grid trading engine
func NewGridTradingEngine(config EngineConfig) *GridTradingEngine {
	if config.DefaultGridCount == 0 {
		config.DefaultGridCount = 50
	}
	if config.MinGridSpacing.IsZero() {
		config.MinGridSpacing = decimal.NewFromFloat(0.01)
	}
	if config.OrderTimeout == 0 {
		config.OrderTimeout = 30 * time.Second
	}
	if config.RebalanceInterval == 0 {
		config.RebalanceInterval = 1 * time.Hour
	}
	
	return &GridTradingEngine{
		strategies: make(map[string]*GridStrategy),
		orderFeed:  make(chan GridOrder, 1000),
		marketFeed: make(chan MarketTick, 1000),
		config:     config,
	}
}

// CreateGridStrategy creates a new grid trading strategy
func (e *GridTradingEngine) CreateGridStrategy(ctx context.Context, req CreateGridRequest) (*GridStrategy, error) {
	// Validate inputs
	if req.Symbol == "" {
		return nil, fmt.Errorf("symbol is required")
	}
	if req.LowerPrice.LessThanOrEqual(decimal.Zero) {
		return nil, fmt.Errorf("lower price must be positive")
	}
	if req.UpperPrice.LessThanOrEqual(req.LowerPrice) {
		return nil, fmt.Errorf("upper price must be greater than lower price")
	}
	if req.GridCount < 2 || req.GridCount > 500 {
		return nil, fmt.Errorf("grid count must be between 2 and 500")
	}
	if req.InvestmentAmount.LessThanOrEqual(decimal.Zero) {
		return nil, fmt.Errorf("investment amount must be positive")
	}
	
	// Calculate grid spacing
	var gridSpacing decimal.Decimal
	switch req.GridType {
	case GridTypeArithmetic:
		gridSpacing = req.UpperPrice.Sub(req.LowerPrice).
			Div(decimal.NewFromInt(int64(req.GridCount - 1)))
	case GridTypeGeometric:
		// Geometric: each level is (upper/lower)^(1/(n-1)) times the previous
		ratio := req.UpperPrice.Div(req.LowerPrice)
		exponent := decimal.NewFromInt(1).Div(decimal.NewFromInt(int64(req.GridCount - 1)))
		gridSpacing = decimal.NewFromFloat(math.Pow(ratio.Float64(), exponent.Float64()))
	default:
		// Default to arithmetic
		gridSpacing = req.UpperPrice.Sub(req.LowerPrice).
			Div(decimal.NewFromInt(int64(req.GridCount - 1)))
	}
	
	if gridSpacing.LessThan(e.config.MinGridSpacing) {
		return nil, fmt.Errorf("grid spacing too small: minimum %s", e.config.MinGridSpacing.String())
	}
	
	// Create strategy
	strategy := &GridStrategy{
		ID:               fmt.Sprintf("grid_%s", uuid.New().String()[:8]),
		UserID:           req.UserID,
		Symbol:           req.Symbol,
		GridType:        req.GridType,
		Status:           GridStatusPending,
		LowerPrice:       req.LowerPrice,
		UpperPrice:       req.UpperPrice,
		GridCount:        req.GridCount,
		GridSpacing:      gridSpacing,
		InvestmentAmount: req.InvestmentAmount,
		MaxPositionSize:  req.MaxPositionSize,
		StopLoss:         req.StopLoss,
		TakeProfit:       req.TakeProfit,
		AutoRebalance:    req.AutoRebalance,
		MinProfitGrid:    req.MinProfitGrid,
		Levels:           make([]GridLevel, 0, req.GridCount),
		TotalProfit:      decimal.Zero,
		TotalTrades:      0,
		RunningDays:      0,
		CreatedAt:        time.Now().UnixMilli(),
		UpdatedAt:        time.Now().UnixMilli(),
	}
	
	// Generate grid levels
	if err := strategy.generateGridLevels(); err != nil {
		return nil, err
	}
	
	// Store strategy
	e.mu.Lock()
	if len(e.strategies) >= e.config.MaxConcurrentGrids {
		e.mu.Unlock()
		return nil, fmt.Errorf("max concurrent grids reached")
	}
	e.strategies[strategy.ID] = strategy
	e.mu.Unlock()
	
	return strategy, nil
}

// generateGridLevels creates the price levels for the grid
func (s *GridStrategy) generateGridLevels() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.Levels = make([]GridLevel, 0, s.GridCount)
	
	for i := 0; i < s.GridCount; i++ {
		var price decimal.Decimal
		
		switch s.GridType {
		case GridTypeArithmetic:
			price = s.LowerPrice.Add(s.GridSpacing.Mul(decimal.NewFromInt(int64(i))))
		case GridTypeGeometric:
			// Price = lower * (spacing ^ i)
			multiplier := decimal.NewFromFloat(math.Pow(s.GridSpacing.Float64(), float64(i)))
			price = s.LowerPrice.Mul(multiplier)
		default:
			price = s.LowerPrice.Add(s.GridSpacing.Mul(decimal.NewFromInt(int64(i))))
		}
		
		// Round to appropriate precision (assuming 2 decimal places)
		price = price.Round(2)
		
		level := GridLevel{
			Level:        i,
			Price:        price,
			LastUpdateAt: time.Now().UnixMilli(),
		}
		
		s.Levels = append(s.Levels, level)
	}
	
	return nil
}

// CreateGridRequest represents the request to create a grid strategy
type CreateGridRequest struct {
	UserID           string          `json:"user_id"`
	Symbol           string          `json:"symbol"`
	GridType         GridType        `json:"grid_type"`
	LowerPrice       decimal.Decimal `json:"lower_price"`
	UpperPrice       decimal.Decimal `json:"upper_price"`
	GridCount        int             `json:"grid_count"`
	InvestmentAmount decimal.Decimal `json:"investment_amount"`
	MaxPositionSize  decimal.Decimal `json:"max_position_size"`
	StopLoss         decimal.Decimal `json:"stop_loss"`
	TakeProfit       decimal.Decimal `json:"take_profit"`
	AutoRebalance    bool            `json:"auto_rebalance"`
	MinProfitGrid    int             `json:"min_profit_grid"`
}

// StartGrid starts an active grid strategy
func (e *GridTradingEngine) StartGrid(ctx context.Context, gridID string) error {
	e.mu.RLock()
	strategy, exists := e.strategies[gridID]
	e.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("grid strategy not found: %s", gridID)
	}
	
	if strategy.Status == GridStatusActive {
		return fmt.Errorf("grid strategy already active")
	}
	
	// Validate grid has levels
	if len(strategy.Levels) == 0 {
		return fmt.Errorf("grid has no levels")
	}
	
	// Start the grid
	strategy.mu.Lock()
	strategy.Status = GridStatusActive
	strategy.UpdatedAt = time.Now().UnixMilli()
	strategy.mu.Unlock()
	
	return nil
}

// StopGrid stops an active grid strategy
func (e *GridTradingEngine) StopGrid(ctx context.Context, gridID string) error {
	e.mu.RLock()
	strategy, exists := e.strategies[gridID]
	e.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("grid strategy not found: %s", gridID)
	}
	
	strategy.mu.Lock()
	strategy.Status = GridStatusStopped
	strategy.UpdatedAt = time.Now().UnixMilli()
	strategy.mu.Unlock()
	
	return nil
}

// PauseGrid pauses an active grid strategy
func (e *GridTradingEngine) PauseGrid(ctx context.Context, gridID string) error {
	e.mu.RLock()
	strategy, exists := e.strategies[gridID]
	e.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("grid strategy not found: %s", gridID)
	}
	
	strategy.mu.Lock()
	strategy.Status = GridStatusPaused
	strategy.UpdatedAt = time.Now().UnixMilli()
	strategy.mu.Unlock()
	
	return nil
}

// ProcessMarketTick processes a market price update
func (e *GridTradingEngine) ProcessMarketTick(tick MarketTick) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	for _, strategy := range e.strategies {
		if strategy.Symbol != tick.Symbol {
			continue
		}
		if strategy.Status != GridStatusActive {
			continue
		}
		
		// Process the tick asynchronously
		go e.evaluateGrid(strategy, tick)
	}
}

// evaluateGrid evaluates if any grid orders should be placed
func (e *GridTradingEngine) evaluateGrid(strategy *GridStrategy, tick MarketTick) {
	currentPrice := tick.Price
	
	strategy.mu.Lock()
	defer strategy.mu.Unlock()
	
	for i, level := range strategy.Levels {
		// Check if price crossed this level
		crossedBuy := false
		crossedSell := false
		
		// Simplified logic - in production would check direction
		priceDiff := currentPrice.Sub(level.Price)
		gridSpacingHalf := strategy.GridSpacing.Div(decimal.NewFromInt(2))
		
		// Buy order: place when price drops to level
		if priceDiff.Abs().LessThanOrEqual(gridSpacingHalf) && !level.BuyFilled && level.BuyOrderID == "" {
			crossedBuy = true
		}
		
		// Sell order: place when price rises to level
		if priceDiff.Abs().LessThanOrEqual(gridSpacingHalf) && !level.SellFilled && level.SellOrderID == "" {
			crossedSell = true
		}
		
		if crossedBuy || crossedSell {
			// Place order
			side := OrderSideBuy
			if crossedSell {
				side = OrderSideSell
			}
			
			order := GridOrder{
				OrderID:   fmt.Sprintf("order_%s_%d", strategy.ID, i),
				GridID:    strategy.ID,
				Side:      side,
				Price:     level.Price,
				Quantity:  e.calculateOrderQuantity(strategy, i),
				Status:    "pending",
				CreatedAt: time.Now().UnixMilli(),
			}
			
			if crossedBuy {
				strategy.Levels[i].BuyOrderID = order.OrderID
			} else {
				strategy.Levels[i].SellOrderID = order.OrderID
			}
			
			// Send to order feed
			select {
			case e.orderFeed <- order:
			default:
			}
		}
	}
}

// calculateOrderQuantity calculates the quantity for an order at a specific level
func (e *GridTradingEngine) calculateOrderQuantity(strategy *GridStrategy, levelIndex int) decimal.Decimal {
	// Calculate equal quantity per grid
	investmentPerGrid := strategy.InvestmentAmount.Div(decimal.NewFromInt(int64(strategy.GridCount)))
	
	// Get price at this level
	price := strategy.Levels[levelIndex].Price
	
	// Quantity = investment / price
	quantity := investmentPerGrid.Div(price)
	
	// Apply max position size if set
	if strategy.MaxPositionSize.GreaterThan(decimal.Zero) {
		if quantity.GreaterThan(strategy.MaxPositionSize) {
			quantity = strategy.MaxPositionSize
		}
	}
	
	return quantity.Round(8)
}

// GetGridStrategy returns a grid strategy by ID
func (e *GridTradingEngine) GetGridStrategy(gridID string) (*GridStrategy, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	strategy, exists := e.strategies[gridID]
	if !exists {
		return nil, fmt.Errorf("grid strategy not found")
	}
	
	return strategy, nil
}

// GetUserGrids returns all grid strategies for a user
func (e *GridTradingEngine) GetUserGrids(userID string) []*GridStrategy {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	var grids []*GridStrategy
	for _, strategy := range e.strategies {
		if strategy.UserID == userID {
			grids = append(grids, strategy)
		}
	}
	
	return grids
}

// GetAllGrids returns all grid strategies
func (e *GridTradingEngine) GetAllGrids() []*GridStrategy {
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	grids := make([]*GridStrategy, 0, len(e.strategies))
	for _, strategy := range e.strategies {
		grids = append(grids, strategy)
	}
	
	return grids
}

// RecordTrade records a completed trade for a grid strategy
func (e *GridTradingEngine) RecordTrade(gridID string, order GridOrder, profit decimal.Decimal) error {
	e.mu.RLock()
	strategy, exists := e.strategies[gridID]
	e.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("grid strategy not found")
	}
	
	strategy.mu.Lock()
	defer strategy.mu.Unlock()
	
	// Update strategy stats
	strategy.TotalTrades++
	strategy.TotalProfit = strategy.TotalProfit.Add(profit)
	strategy.LastTradeAt = time.Now().UnixMilli()
	strategy.UpdatedAt = time.Now().UnixMilli()
	
	// Mark level as filled
	for i, level := range strategy.Levels {
		if level.BuyOrderID == order.OrderID {
			strategy.Levels[i].BuyFilled = true
			strategy.Levels[i].BuyOrderID = ""
			break
		}
		if level.SellOrderID == order.OrderID {
			strategy.Levels[i].SellFilled = true
			strategy.Levels[i].SellOrderID = ""
			break
		}
	}
	
	return nil
}

// RebalanceGrid rebalances a grid strategy
func (e *GridTradingEngine) RebalanceGrid(ctx context.Context, gridID string, newPrices [2]decimal.Decimal) error {
	e.mu.RLock()
	strategy, exists := e.strategies[gridID]
	e.mu.RUnlock()
	
	if !exists {
		return fmt.Errorf("grid strategy not found")
	}
	
	if !strategy.AutoRebalance {
		return fmt.Errorf("auto rebalance not enabled")
	}
	
	strategy.mu.Lock()
	defer strategy.mu.Unlock()
	
	// Update price range
	strategy.LowerPrice = newPrices[0]
	strategy.UpperPrice = newPrices[1]
	
	// Recalculate grid spacing
	switch strategy.GridType {
	case GridTypeArithmetic:
		strategy.GridSpacing = strategy.UpperPrice.Sub(strategy.LowerPrice).
			Div(decimal.NewFromInt(int64(strategy.GridCount - 1)))
	case GridTypeGeometric:
		ratio := strategy.UpperPrice.Div(strategy.LowerPrice)
		exponent := decimal.NewFromInt(1).Div(decimal.NewFromInt(int64(strategy.GridCount - 1)))
		strategy.GridSpacing = decimal.NewFromFloat(math.Pow(ratio.Float64(), exponent.Float64()))
	}
	
	// Regenerate levels
	strategy.Levels = make([]GridLevel, 0, strategy.GridCount)
	for i := 0; i < strategy.GridCount; i++ {
		var price decimal.Decimal
		switch strategy.GridType {
		case GridTypeArithmetic:
			price = strategy.LowerPrice.Add(strategy.GridSpacing.Mul(decimal.NewFromInt(int64(i))))
		case GridTypeGeometric:
			multiplier := decimal.NewFromFloat(math.Pow(strategy.GridSpacing.Float64(), float64(i)))
			price = strategy.LowerPrice.Mul(multiplier)
		default:
			price = strategy.LowerPrice.Add(strategy.GridSpacing.Mul(decimal.NewFromInt(int64(i))))
		}
		
		price = price.Round(2)
		
		strategy.Levels = append(strategy.Levels, GridLevel{
			Level:        i,
			Price:        price,
			LastUpdateAt: time.Now().UnixMilli(),
		})
	}
	
	strategy.UpdatedAt = time.Now().UnixMilli()
	
	return nil
}

// GetGridStats returns statistics for a grid strategy
func (e *GridTradingEngine) GetGridStats(gridID string) (GridStats, error) {
	strategy, err := e.GetGridStrategy(gridID)
	if err != nil {
		return GridStats{}, err
	}
	
	strategy.mu.RLock()
	defer strategy.mu.RUnlock()
	
	// Calculate statistics
	var filledLevels int
	var activeOrders int
	for _, level := range strategy.Levels {
		if level.BuyFilled || level.SellFilled {
			filledLevels++
		}
		if level.BuyOrderID != "" || level.SellOrderID != "" {
			activeOrders++
		}
	}
	
	runningDays := 0
	if strategy.CreatedAt > 0 {
		runningDays = int((time.Now().UnixMilli() - strategy.CreatedAt) / (24 * 60 * 60 * 1000))
	}
	
	avgProfit := decimal.Zero
	if strategy.TotalTrades > 0 {
		avgProfit = strategy.TotalProfit.Div(decimal.NewFromInt(int64(strategy.TotalTrades)))
	}
	
	return GridStats{
		GridID:          strategy.ID,
		Status:           string(strategy.Status),
		TotalTrades:     strategy.TotalTrades,
		TotalProfit:     strategy.TotalProfit,
		AverageProfit:   avgProfit,
		FilledLevels:    filledLevels,
		ActiveOrders:    activeOrders,
		RunningDays:     runningDays,
		CurrentPrice:    strategy.Levels[len(strategy.Levels)/2].Price,
	}, nil
}

// GridStats contains statistics for a grid strategy
type GridStats struct {
	GridID        string          `json:"grid_id"`
	Status        string          `json:"status"`
	TotalTrades   int             `json:"total_trades"`
	TotalProfit   decimal.Decimal `json:"total_profit"`
	AverageProfit decimal.Decimal `json:"average_profit"`
	FilledLevels  int             `json:"filled_levels"`
	ActiveOrders  int             `json:"active_orders"`
	RunningDays   int             `json:"running_days"`
	CurrentPrice  decimal.Decimal `json:"current_price"`
}

// ToJSON converts the strategy to JSON
func (s *GridStrategy) ToJSON() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	data, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	
	return string(data), nil
}

// StartOrderFeed returns the channel for order updates
func (e *GridTradingEngine) StartOrderFeed() <-chan GridOrder {
	return e.orderFeed
}

// StartMarketFeed starts processing the market feed
func (e *GridTradingEngine) StartMarketFeed(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case tick := <-e.marketFeed:
				e.ProcessMarketTick(tick)
			}
		}
	}()
}

// SubmitMarketTick submits a market tick for processing
func (e *GridTradingEngine) SubmitMarketTick(tick MarketTick) {
	select {
	case e.marketFeed <- tick:
	default:
	}
}

// DeleteGrid deletes a grid strategy
func (e *GridTradingEngine) DeleteGrid(ctx context.Context, gridID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	strategy, exists := e.strategies[gridID]
	if !exists {
		return fmt.Errorf("grid strategy not found")
	}
	
	if strategy.Status == GridStatusActive {
		return fmt.Errorf("cannot delete active grid strategy")
	}
	
	delete(e.strategies, gridID)
	return nil
}

// Close closes the grid trading engine
func (e *GridTradingEngine) Close() error {
	close(e.orderFeed)
	close(e.marketFeed)
	
	e.mu.Lock()
	defer e.mu.Unlock()
	
	// Stop all active grids
	for _, strategy := range e.strategies {
		if strategy.Status == GridStatusActive {
			strategy.Status = GridStatusClosed
		}
	}
	
	return nil
}

// ============================================================================
// GRID ORDER EXECUTION SERVICE
// ============================================================================

// GridOrderExecutor executes grid orders
type GridOrderExecutor struct {
	engine    *GridTradingEngine
	orderFeed <-chan GridOrder
	
	// Execution callbacks
	executeOrder func(order GridOrder) error
}

// NewGridOrderExecutor creates a new order executor
func NewGridOrderExecutor(engine *GridTradingEngine, executeOrder func(order GridOrder) error) *GridOrderExecutor {
	return &GridOrderExecutor{
		engine:      engine,
		orderFeed:   engine.StartOrderFeed(),
		executeOrder: executeOrder,
	}
}

// Start starts processing grid orders
func (e *GridOrderExecutor) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case order := <-e.orderFeed:
				e.processOrder(order)
			}
		}
	}()
}

// processOrder processes a single order
func (e *GridOrderExecutor) processOrder(order GridOrder) {
	if err := e.executeOrder(order); err != nil {
		fmt.Printf("Failed to execute order %s: %v\n", order.OrderID, err)
		return
	}
	
	// Record the trade
	profit := calculateTradeProfit(order)
	e.engine.RecordTrade(order.GridID, order, profit)
}

// calculateTradeProfit calculates the profit from a trade
func calculateTradeProfit(order GridOrder) decimal.Decimal {
	// Simplified profit calculation
	// In production would calculate based on actual fills
	return decimal.Zero
}
