// Package grid provides grid trading bot implementation.
// Grid trading works by placing buy orders at regular intervals below a 
// starting price and sell orders above, profiting from price oscillations.
package grid

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// GridBot represents a grid trading bot
type GridBot struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Symbol        string          `json:"symbol"`
	StartPrice    decimal.Decimal `json:"start_price"`
	EndPrice     decimal.Decimal `json:"end_price"`
	GridLevels   int             `json:"grid_levels"`
	GridSpacing  decimal.Decimal `json:"grid_spacing"`
	Quantity    decimal.Decimal `json:"quantity"`
	Invested    decimal.Decimal `json:"invested"`
	Profit      decimal.Decimal `json:"profit"`
	Status      BotStatus       `json:"status"`
	Direction   GridDirection `json:"direction"`
	Leverage     decimal.Decimal `json:"leverage"`
	IsActive     bool            `json:"is_active"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// BotStatus represents bot status
type BotStatus string

const (
	BotStatusIdle     BotStatus = "IDLE"
	BotStatusRunning BotStatus = "RUNNING"
	BotStatusPaused BotStatus = "PAUSED"
	BotStatusStopped BotStatus = "STOPPED"
	BotStatusCompleted BotStatus = "COMPLETED"
)

// GridDirection represents grid direction
type GridDirection string

const (
	GridDirectionLong  GridDirection = "LONG"
	GridDirectionShort GridDirection = "SHORT"
	GridDirectionNeutral GridDirection = "NEUTRAL"
)

// GridLevel represents a single grid level
type GridLevel struct {
	Level      int             `json:"level"`
	Price      decimal.Decimal `json:"price"`
	Quantity   decimal.Decimal `json:"quantity"`
	IsBuyOrder  bool           `json:"is_buy_order"`
	IsFilled   bool           `json:"is_filled"`
	OrderID    string         `json:"order_id"`
	FillPrice decimal.Decimal `json:"fill_price"`
	Profit    decimal.Decimal `json:"profit"`
}

// GridOrder represents an active grid order
type GridOrder struct {
	ID        string          `json:"id"`
	BotID     string          `json:"bot_id"`
	Level    int             `json:"level"`
	OrderID  string          `json:"order_id"`
	Side     string         `json:"side"`
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
	Status   string         `json:"status"`
	CreatedAt time.Time    `json:"created_at"`
}

// GridConfig represents grid bot configuration
type GridConfig struct {
	Symbol      string          `json:"symbol"`
	StartPrice  decimal.Decimal `json:"start_price"`
	EndPrice   decimal.Decimal `json:"end_price"`
	GridLevels int             `json:"grid_levels"`
	Quantity  decimal.Decimal `json:"quantity"`
	Direction GridDirection  `json:"direction"`
	Leverage   decimal.Decimal `json:"leverage"`
}

// GridEngine manages grid trading operations
type GridEngine struct {
	mu          sync.RWMutex
	bots        map[string]*GridBot
	orders      map[string]*GridOrder
	marketData  MarketDataProvider
	orderExec  OrderExecutor
	cfg        *EngineConfig
}

// EngineConfig holds engine configuration
type EngineConfig struct {
	MaxBotsPerUser int
	MaxGridLevels int
	MinGridSpacing decimal.Decimal
	MaxInvestment decimal.Decimal
}

// MarketDataProvider provides market data
type MarketDataProvider interface {
	GetTicker(symbol string) (*Ticker, error)
	GetPrice(symbol string) (decimal.Decimal, error)
}

// OrderExecutor executes orders
type OrderExecutor interface {
	PlaceOrder(ctx context.Context, order *Order) (*Order, error)
	CancelOrder(ctx context.Context, orderID string) error
	GetOrder(orderID string) (*Order, error)
}

// Ticker represents market ticker
type Ticker struct {
	Symbol    string
	LastPrice decimal.Decimal
	HighPrice decimal.Decimal
	LowPrice  decimal.Decimal
	Volume    decimal.Decimal
}

// Order represents a trading order
type Order struct {
	ID          string
	UserID      string
	Symbol      string
	Side        string
	Type        string
	Price       decimal.Decimal
	Quantity    decimal.Decimal
	Status      string
	CreatedAt   time.Time
}

// NewGridEngine creates a new grid engine
func NewGridEngine() *GridEngine {
	return &GridEngine{
		bots:       make(map[string]*GridBot),
		orders:     make(map[string]*GridOrder),
		cfg:       &EngineConfig{MaxBotsPerUser: 10, MaxGridLevels: 100, MinInvestment: decimal.NewFromInt(10)},
	}
}

// CreateBot creates a new grid trading bot
func (ge *GridEngine) CreateBot(ctx context.Context, userID string, config *GridConfig) (*GridBot, error) {
	// Validate configuration
	if config.GridLevels < 2 || config.GridLevels > ge.cfg.MaxGridLevels {
		return nil, fmt.Errorf("grid levels must be between 2 and %d", ge.cfg.MaxGridLevels)
	}

	// Check if bot limit reached
 BotsPerUser:
	count := 0
	for _, bot := range ge.bots {
		if bot.UserID == userID && bot.IsActive {
			count++
		}
	}
	if count >= ge.cfg.MaxBotsPerUser {
		return nil, fmt.Errorf("maximum bots per user reached")
	}

	// Calculate grid spacing
	rangeSize := config.EndPrice.Sub(config.StartPrice)
	if rangeSize.IsZero() {
		return nil, fmt.Errorf("start and end price cannot be equal")
	}

	gridSpacing := rangeSize.Div(decimal.NewFromInt(int64(config.GridLevels)))
	if gridSpacing.LessThan(ge.cfg.MinGridSpacing) {
		return nil, fmt.Errorf("grid spacing too small, minimum is %s", ge.cfg.MinGridSpacing.String())
	}

	// Estimate investment per level
	qtyPerLevel := config.Quantity

	bot := &GridBot{
		ID:           generateBotID(),
		UserID:       userID,
		Symbol:       config.Symbol,
		StartPrice: config.StartPrice,
		EndPrice:  config.EndPrice,
		GridLevels: config.GridLevels,
		GridSpacing: gridSpacing,
		Quantity:  qtyPerLevel,
		Invested:  decimal.Zero,
		Profit:   decimal.Decimal{},
		Status:   BotStatusIdle,
		Direction: config.Direction,
		Leverage: config.Leverage,
		Status:   BotStatusIdle,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	ge.mu.Lock()
	ge.bots[bot.ID] = bot
	ge.mu.Unlock()

	return bot, nil
}

// StartBot starts an existing grid bot
func (ge *GridEngine) StartBot(ctx context.Context, botID string) error {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	bot, ok := ge.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	if bot.Status == BotStatusRunning {
		return fmt.Errorf("bot already running")
	}

	// Get current price
	currentPrice, err := ge.marketData.GetPrice(bot.Symbol)
	if err != nil {
		return err
	}

	// Place initial grid orders
	err = ge.placeGridOrders(ctx, bot, currentPrice)
	if err != nil {
		return err
	}

	bot.Status = BotStatusRunning
	bot.IsActive = true
	bot.UpdatedAt = time.Now()

	return nil
}

// StopBot stops a running grid bot
func (ge *GridEngine) StopBot(ctx context.Context, botID string) error {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	bot, ok := ge.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	// Cancel all pending orders
	for _, order := range ge.orders {
		if order.BotID == botID && order.Status == "PENDING" {
			ge.orderExec.CancelOrder(ctx, order.OrderID)
			delete(ge.orders, order.ID)
		}
	}

	bot.Status = BotStatusStopped
	bot.IsActive = false
	bot.UpdatedAt = time.Now()

	return nil
}

// PauseBot pauses a running grid bot
func (ge *GridEngine) PauseBot(ctx context.Context, botID string) error {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	bot, ok := ge.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	bot.Status = BotStatusPaused
	bot.UpdatedAt = time.Now()

	return nil
}

// ResumeBot resumes a paused grid bot
func (ge *GridEngine) ResumeBot(ctx context.Context, botID string) error {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	bot, ok := ge.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	bot.Status = BotStatusRunning
	bot.UpdatedAt = time.Now()

	return nil
}

// placeGridOrders places all grid orders
func (ge *GridEngine) placeGridOrders(ctx context.Context, bot *GridBot, currentPrice decimal.Decimal) error {
	basePrice := bot.StartPrice

	for i := 0; i < bot.GridLevels; i++ {
		levelPrice := basePrice.Add(bot.GridSpacing.Mul(decimal.NewFromInt(int64(i))))
		
		isBuyOrder := true
		if bot.Direction == GridDirectionShort {
			isBuyOrder = false
		}

		order := &GridOrder{
			ID:        generateOrderID(),
			BotID:     bot.ID,
			Level:    i,
			OrderID:  "",
			Side:     "BUY",
			Price:    levelPrice,
			Quantity: bot.Quantity,
			Status:   "PENDING",
			CreatedAt: time.Now(),
		}

		if isBuyOrder {
			order.Side = "BUY"
		} else {
			order.Side = "SELL"
		}

		// Place order via executor
		placedOrder, err := ge.orderExec.PlaceOrder(ctx, &Order{
			ID:       order.OrderID,
			UserID:   bot.UserID,
			Symbol:  bot.Symbol,
			Side:    order.Side,
			Type:    "LIMIT",
			Price:   order.Price,
			Quantity: order.Quantity,
			Status:  "PENDING",
		})
		if err != nil {
			return err
		}

		order.OrderID = placedOrder.ID
		ge.orders[order.ID] = order
	}

	return nil
}

// ProcessFill processes order fill
func (ge *GridEngine) ProcessFill(ctx context.Context, fill *FillEvent) error {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	order, ok := ge.orders[fill.OrderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	bot, ok := ge.bots[order.BotID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	// Calculate profit from fill
	order.IsFilled = true
	order.FillPrice = fill.Price

	// Calculate grid level profit
	gridIndex := order.Level
	var profit decimal.Decimal

	if order.Side == "BUY" {
		// This was a buy order that filled, now we need a sell order
		profit = fill.Price.Sub(bot.GridSpacing)
		
		// Place compensating sell order
		sellPrice := bot.StartPrice.Add(bot.GridSpacing.Mul(decimal.NewFromInt(int64(gridIndex + 1))))
		sellOrder, _ := ge.orderExec.PlaceOrder(ctx, &Order{
			ID:        generateOrderID(),
			UserID:   bot.UserID,
			Symbol:  bot.Symbol,
			Side:    "SELL",
			Type:    "LIMIT",
			Price:   sellPrice,
			Quantity: order.Quantity,
			Status:  "PENDING",
		})
		
		newGridOrder := &GridOrder{
			ID:        generateOrderID(),
			BotID:     bot.ID,
			Level:    gridIndex,
			OrderID:  sellOrder.ID,
			Side:     "SELL",
			Price:    sellPrice,
			Quantity: order.Quantity,
			Status:   "PENDING",
			CreatedAt: time.Now(),
		}
		ge.orders[newGridOrder.ID] = newGridOrder

		bot.Invested = bot.Invested.Add(fill.Price.Mul(fill.Quantity))
	} else {
		// This was a sell order that filled, profit made
		profit = bot.GridSpacing

		// Place compensating buy order
		buyPrice := bot.StartPrice.Add(bot.GridSpacing.Mul(decimal.NewFromInt(int64(gridIndex - 1))))
		buyOrder, _ := ge.orderExec.PlaceOrder(ctx, &Order{
			ID:       generateOrderID(),
			UserID:   bot.UserID,
			Symbol:  bot.Symbol,
			Side:   "BUY",
			Type:   "LIMIT",
			Price:  buyPrice,
			Quantity: order.Quantity,
			Status: "PENDING",
		})

		newGridOrder := &GridOrder{
			ID:        generateOrderID(),
			BotID:     bot.ID,
			Level:    gridIndex - 1,
			OrderID:  buyOrder.ID,
			Side:     "BUY",
			Price:    buyPrice,
			Quantity: order.Quantity,
			Status:   "PENDING",
			CreatedAt: time.Now(),
		}
		ge.orders[newGridOrder.ID] = newGridOrder

		bot.Profit = bot.Profit.Add(profit)
	}

	bot.UpdatedAt = time.Now()

	return nil
}

// GetBot returns bot by ID
func (ge *GridEngine) GetBot(botID string) (*GridBot, bool) {
	ge.mu.RLock()
	defer ge.mu.RUnlock()
	bot, ok := ge.bots[botID]
	return bot, ok
}

// GetUserBots returns all bots for a user
func (ge *GridEngine) GetUserBots(userID string) []*GridBot {
	ge.mu.RLock()
	defer ge.mu.RUnlock()

	var result []*GridBot
	for _, bot := range ge.bots {
		if bot.UserID == userID {
			result = append(result, bot)
		}
	}
	return result
}

// GetPerformance returns bot performance metrics
func (ge *GridEngine) GetPerformance(ctx context.Context, botID string) (*PerformanceMetrics, error) {
	bot, ok := ge.bots[botID]
	if !ok {
		return nil, fmt.Errorf("bot not found")
	}

	// Calculate metrics
	totalGrids := float64(bot.GridLevels)
	levelsTriggered := 0.0 // Would count triggered levels
	
	profitRate := 0.0
	if bot.Invested.GreaterThan(decimal.Zero) {
		profitRate, _ = bot.Profit.Div(bot.Invested).Float64()
	}

	annualizedReturn := profitRate * (math.Pow(365.0/profitRate, 1.0))

	return &PerformanceMetrics{
		BotID:           botID,
		TotalGrids:      totalGrids,
		LevelsTriggered: totalGrids,
		TotalProfit:    bot.Profit,
		Invested:      bot.Invested,
		ProfitRate:    profitRate,
		Annualized:     annualizedReturn,
		Uptime:       time.Since(bot.CreatedAt),
	}, nil
}

// FillEvent represents an order fill event
type FillEvent struct {
	OrderID   string
	BotID    string
	Price    decimal.Decimal
	Quantity decimal.Decimal
	Side     string
}

// PerformanceMetrics represents bot performance
type PerformanceMetrics struct {
	BotID          string
	TotalGrids     float64
	LevelsTriggered float64
	TotalProfit    decimal.Decimal
	Invested       decimal.Decimal
	ProfitRate     float64
	Annualized     float64
	Uptime        time.Duration
}

// Grid bots differ based on type:
// 1. Spot Grid - buy low, sell high within range
// 2. Futures Grid - long/short with leverage
// 3. Infinity Grid - unbounded grid for trending markets
// 4. Reverse Grid - profit from volatility direction changes

var _ = decimal.Decimal{}