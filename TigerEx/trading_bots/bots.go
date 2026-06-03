// =============================================================================
// TRADING BOTS SYSTEM
// Complete Grid Trading and DCA (Dollar Cost Averaging) Bot Engine
// Production-grade algorithmic trading bots
// =============================================================================

package bots

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	BotTypeGrid   = "grid"
	BotTypeDCA    = "dca"
	BotTypeSignal = "signal"
	
	BotStatusCreated   = "created"
	BotStatusRunning  = "running"
	BotStatusPaused   = "paused"
	BotStatusStopped = "stopped"
	BotStatusError   = "error"
	
	OrderSideBuy  = "buy"
	OrderSideSell = "sell"
)

// ============================================================================
// GRID BOT
// ============================================================================

// GridBotConfig for grid trading
type GridBotConfig struct {
	Symbol         string  // "BTCUSDT"
	UpperPrice    float64 // Highest price bound
	LowerPrice    float64 // Lowest price bound
	GridLevels    int     // Number of grid levels
	Investment    float64 // Total investment amount
	GridsQuantity float64 // Quantity per grid level
	AutoRebalance bool    // Auto-rebalance when price breaks bounds
}

// GridBot represents a grid trading bot
type GridBot struct {
	ID          string
	UserID      string
	Config      GridBotConfig
	Status      string
	GridLines   []float64 // Price levels
	Orders      map[string]*GridOrder
	Profit     float64
	TotalTrades int
	CreatedAt   time.Time
	UpdatedAt   time.Time
	
	mu          sync.RWMutex
}

// GridOrder represents an order at a grid level
type GridOrder struct {
	Level     int     // Grid level (0 = lowest)
	Side      string  // "buy" or "sell"
	Price     float64
	Quantity  float64
	Filled    bool
	OrderID   string
	Profit    float64
}

// NewGridBot creates a new grid bot
func NewGridBot(userID string, config GridBotConfig) (*GridBot, error) {
	// Validate config
	if config.Symbol == "" {
		return nil, fmt.Errorf("symbol required")
	}
	if config.LowerPrice <= 0 || config.UpperPrice <= 0 {
		return nil, fmt.Errorf("invalid price bounds")
	}
	if config.LowerPrice >= config.UpperPrice {
		return nil, fmt.Errorf("lower price must be less than upper price")
	}
	if config.GridLevels < 2 {
		return nil, fmt.Errorf("minimum 2 grid levels")
	}

	// Calculate grid prices
	priceRange := config.UpperPrice - config.LowerPrice
	gridStep := priceRange / float64(config.GridLevels-1)
	
	gridLines := make([]float64, config.GridLevels)
	for i := 0; i < config.GridLevels; i++ {
		gridLines[i] = config.LowerPrice + gridStep*float64(i)
	}

	// Calculate quantity per grid
	gridsQuantity := config.Investment / float64(config.GridLevels) / config.LowerPrice

	bot := &GridBot{
		ID:       generateBotID("GRID"),
		UserID:   userID,
		Config:   config,
		Status:   BotStatusCreated,
		GridLines: gridLines,
		Orders:  make(map[string]*GridOrder),
		Profit:  0,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	return bot, nil
}

// Start starts the grid bot
func (gb *GridBot) Start(ctx context.Context) error {
	gb.mu.Lock()
	defer gb.mu.Unlock()

	if gb.Status == BotStatusRunning {
		return fmt.Errorf("bot already running")
	}

	gb.Status = BotStatusRunning
	gb.UpdatedAt = time.Now()

	return nil
}

// Stop stops the grid bot
func (gb *GridBot) Stop(ctx context.Context) error {
	gb.mu.Lock()
	defer gb.mu.Unlock()

	gb.Status = BotStatusStopped
	gb.UpdatedAt = time.Now()

	return nil
}

// OnPriceUpdate handles price updates and executes grid orders
func (gb *GridBot) OnPriceUpdate(ctx context.Context, currentPrice float64) ([]*BotOrder, error) {
	gb.mu.Lock()
	defer gb.mu.Unlock()

	if gb.Status != BotStatusRunning {
		return nil, nil
	}

	orders := make([]*BotOrder, 0)

	// Check if price is within bounds
	if currentPrice < gb.Config.LowerPrice || currentPrice > gb.Config.UpperPrice {
		if gb.Config.AutoRebalance {
			// Would rebalance here
		}
		return orders, nil
	}

	// Find current grid level
	currentLevel := gb.findGridLevel(currentPrice)

	// Check each level for triggering
	for level, price := range gb.GridLines {
		// Buy order triggers when price drops TO the level (or below)
		if currentPrice <= price && level < len(gb.GridLines)-1 {
			// Check if we need to place buy order at this level
			orderKey := fmt.Sprintf("buy_%d", level)
			if _, exists := gb.Orders[orderKey]; !exists {
				order := &BotOrder{
					Symbol:    gb.Config.Symbol,
					Side:     OrderSideBuy,
					Type:     "limit",
					Price:    price,
					Quantity: gb.Config.GridsQuantity,
				}
				orders = append(orders, order)
				gb.Orders[orderKey] = &GridOrder{
					Level:    level,
					Side:     OrderSideBuy,
					Price:    price,
					Quantity: gb.Config.GridsQuantity,
					Filled:   false,
				}
			}
		}

		// Sell order triggers when price rises TO the level (or above)
		if currentPrice >= price && level > 0 {
			orderKey := fmt.Sprintf("sell_%d", level)
			if _, exists := gb.Orders[orderKey]; !exists {
				order := &BotOrder{
					Symbol:    gb.Config.Symbol,
					Side:     OrderSideSell,
					Type:     "limit",
					Price:    price,
					Quantity: gb.Config.GridsQuantity,
				}
				orders = append(orders, order)
				gb.Orders[orderKey] = &GridOrder{
					Level:    level,
					Side:     OrderSideSell,
					Price:    price,
					Quantity: gb.Config.GridsQuantity,
					Filled:   false,
				}
			}
		}
	}

	return orders, nil
}

// OnFill handles order fill events
func (gb *GridBot) OnFill(ctx context.Context, orderID string, fillPrice, quantity float64, side string) error {
	gb.mu.Lock()
	defer gb.mu.Unlock()

	// Find the order
	for key, order := range gb.Orders {
		if order.OrderID == orderID {
			order.Filled = true
			
			// Calculate profit
			if side == OrderSideBuy {
				// Calculate expected sell price (next level up)
				if order.Level < len(gb.GridLines)-1 {
					expectedSell := gb.GridLines[order.Level+1]
					profit := (expectedSell - fillPrice) * quantity
					order.Profit = profit
					gb.Profit += profit
				}
			}
			
			gb.TotalTrades++
			gb.UpdatedAt = time.Now()
			return nil
		}
	}

	return fmt.Errorf("order not found: %s", orderID)
}

func (gb *GridBot) findGridLevel(price float64) int {
	closestLevel := 0
	closestDiff := math.MaxFloat64

	for i, gridPrice := range gb.GridLines {
		diff := math.Abs(gridPrice - price)
		if diff < closestDiff {
			closestDiff = diff
			closestLevel = i
		}
	}

	return closestLevel
}

// GetStats returns bot statistics
func (gb *GridBot) GetStats() map[string]interface{} {
	gb.mu.RLock()
	defer gb.mu.RUnlock()

	return map[string]interface{}{
		"bot_id":        gb.ID,
		"status":        gb.Status,
		"symbol":        gb.Config.Symbol,
		"profit":        gb.Profit,
		"total_trades":  gb.TotalTrades,
		"grid_levels":   gb.Config.GridLevels,
		"upper_price":   gb.Config.UpperPrice,
		"lower_price":   gb.Config.LowerPrice,
		"investment":    gb.Config.Investment,
	}
}

// ============================================================================
// DCA BOT (Dollar Cost Averaging)
// ============================================================================

// DCABotConfig for DCA strategy
type DCABotConfig struct {
	Symbol        string  // "BTCUSDT"
	BuyAmount    float64 // Amount to buy each time
	Interval     time.Duration // Time between buys
	MaxTrades   int     // Maximum number of trades
	ProfitTarget float64 // Target profit % to sell all
	StopLoss    float64 // Stop loss price
	StartPrice  float64 // Starting price reference
}

// DCABot represents a DCA bot
type DCABot struct {
	ID          string
	UserID      string
	Config      DCABotConfig
	Status      string
	Trades      []*DCATrade
	TotalBought float64
	TotalSpent  float64
	AveragePrice float64
	NextTradeTime time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
	
	mu          sync.RWMutex
}

// DCATrade represents a single DCA trade
type DCATrade struct {
	ID            string
	Price         float64
	Amount        float64
	Total         float64
	Timestamp     time.Time
}

// NewDCABot creates a new DCA bot
func NewDCABot(userID string, config DCABotConfig) (*DCABot, error) {
	if config.Symbol == "" {
		return nil, fmt.Errorf("symbol required")
	}
	if config.BuyAmount <= 0 {
		return nil, fmt.Errorf("buy amount must be positive")
	}
	if config.Interval < time.Minute {
		return nil, fmt.Errorf("interval too short")
	}

	bot := &DCABot{
		ID:            generateBotID("DCA"),
		UserID:        userID,
		Config:        config,
		Status:        BotStatusCreated,
		Trades:        make([]*DCATrade, 0),
		NextTradeTime: time.Now(),
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	return bot, nil
}

// Start starts the DCA bot
func (db *DCABot) Start(ctx context.Context) error {
	db.mu.Lock()
	defer db.mu.Unlock()

	if db.Status == BotStatusRunning {
		return fmt.Errorf("bot already running")
	}

	db.Status = BotStatusRunning
	db.NextTradeTime = time.Now()
	db.UpdatedAt = time.Now()

	return nil
}

// Stop stops the DCA bot
func (db *DCABot) Stop(ctx context.Context) error {
	db.mu.Lock()
	defer db.mu.Unlock()

	db.Status = BotStatusStopped
	db.UpdatedAt = time.Now()

	return nil
}

// CheckAndTrade checks if it's time to execute a DCA trade
func (db *DCABot) CheckAndTrade(ctx context.Context, currentPrice float64) (*BotOrder, error) {
	db.mu.Lock()
	defer db.mu.Unlock()

	if db.Status != BotStatusRunning {
		return nil, nil
	}

	// Check max trades limit
	if db.Config.MaxTrades > 0 && len(db.Trades) >= db.Config.MaxTrades {
		db.Status = BotStatusStopped
		return nil, fmt.Errorf("max trades reached")
	}

	// Check if it's time for next trade
	if time.Now().Before(db.NextTradeTime) {
		return nil, nil
	}

	// Check stop loss
	if db.Config.StopLoss > 0 && currentPrice <= db.Config.StopLoss {
		db.Status = BotStatusStopped
		return nil, fmt.Errorf("stop loss triggered at %.2f", currentPrice)
	}

	// Calculate average price so far
	if len(db.Trades) > 0 {
		var totalSpent float64
		var totalBought float64
		for _, t := range db.Trades {
			totalSpent += t.Total
			totalBought += t.Amount
		}
		db.AveragePrice = totalSpent / totalBought

		// Check profit target
		if db.Config.ProfitTarget > 0 {
			currentValue := db.TotalBought * currentPrice
			profitPercent := (currentValue - db.TotalSpent) / db.TotalSpent * 100
			if profitPercent >= db.Config.ProfitTarget {
				// Execute sell order for all
				db.Status = BotStatusStopped
				return &BotOrder{
					Symbol:    db.Config.Symbol,
					Side:     OrderSideSell,
					Type:     "market",
					Quantity: db.TotalBought,
				}, nil
			}
		}
	}

	// Execute buy order
	trade := &DCATrade{
		ID:        generateTradeID(),
		Price:     currentPrice,
		Amount:    db.Config.BuyAmount,
		Total:     currentPrice * db.Config.BuyAmount,
		Timestamp: time.Now(),
	}

	db.Trades = append(db.Trades, trade)
	db.TotalBought += trade.Amount
	db.TotalSpent += trade.Total
	db.NextTradeTime = time.Now().Add(db.Config.Interval)
	db.UpdatedAt = time.Now()

	return &BotOrder{
		Symbol:    db.Config.Symbol,
		Side:     OrderSideBuy,
		Type:     "market",
		Quantity: db.Config.BuyAmount,
	}, nil
}

// GetStats returns DCA bot statistics
func (db *DCABot) GetStats() map[string]interface{} {
	db.mu.RLock()
	defer db.mu.RUnlock()

	var avgPrice float64
	if db.TotalBought > 0 {
		avgPrice = db.TotalSpent / db.TotalBought
	}

	return map[string]interface{}{
		"bot_id":         db.ID,
		"status":         db.Status,
		"symbol":         db.Config.Symbol,
		"total_trades":   len(db.Trades),
		"total_bought":   db.TotalBought,
		"total_spent":   db.TotalSpent,
		"average_price":  avgPrice,
		"next_trade":    db.NextTradeTime,
	}
}

// ============================================================================
// BOT MANAGER
// ============================================================================

// BotOrder represents an order to be executed
type BotOrder struct {
	Symbol    string
	Side      string // "buy" or "sell"
	Type      string // "market" or "limit"
	Price     float64
	Quantity  float64
	OrderID   string
}

// BotManager manages all trading bots
type BotManager struct {
	mu           sync.RWMutex
	gridBots     map[string]*GridBot
	dcaBots      map[string]*DCABot
	exchange     ExchangeAPI
	orderChannel chan *BotOrder
	
	status      string
	startTime  time.Time
}

// ExchangeAPI interface for executing orders
type ExchangeAPI interface {
	PlaceOrder(order *BotOrder) (string, error)
	GetPrice(symbol string) (float64, error)
}

// NewBotManager creates a new bot manager
func NewBotManager(exchange ExchangeAPI) *BotManager {
	return &BotManager{
		gridBots:    make(map[string]*GridBot),
		dcaBots:     make(map[string]*DCABot),
		exchange:    exchange,
		orderChannel: make(chan *BotOrder, 100),
		status:      "active",
		startTime:  time.Now(),
	}
}

// CreateGridBot creates and starts a grid bot
func (bm *GridBot) CreateGridBot(ctx context.Context, userID string, config GridBotConfig) (*GridBot, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bot, err := NewGridBot(userID, config)
	if err != nil {
		return nil, err
	}

	bm.gridBots[bot.ID] = bot
	bot.Start(ctx)

	return bot, nil
}

// CreateDCABot creates and starts a DCA bot
func (bm *DCABot) CreateDCABot(ctx context.Context, userID string, config DCABotConfig) (*DCABot, error) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bot, err := NewDCABot(userID, config)
	if err != nil {
		return nil, err
	}

	bm.dcaBots[bot.ID] = bot
	bot.Start(ctx)

	return bot, nil
}

// StopBot stops a running bot
func (bm *BotManager) StopBot(ctx context.Context, botID string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bot, ok := bm.gridBots[botID]; ok {
		return bot.Stop(ctx)
	}

	if bot, ok := bm.dcaBots[botID]; ok {
		return bot.Stop(ctx)
	}

	return fmt.Errorf("bot not found: %s", botID)
}

// GetUserBots gets all bots for a user
func (bm *BotManager) GetUserBots(ctx context.Context, userID string) ([]interface{}, error) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	bots := make([]interface{}, 0)

	for _, bot := range bm.gridBots {
		if bot.UserID == userID {
			bots = append(bots, bot)
		}
	}

	for _, bot := range bm.dcaBots {
		if bot.UserID == userID {
			bots = append(bots, bot)
		}
	}

	return bots, nil
}

// ProcessPriceUpdate processes price updates for all bots
func (bm *BotManager) ProcessPriceUpdate(ctx context.Context, symbol string, price float64) error {
	bm.mu.RLock()
	
	// Process grid bots
	for _, bot := range bm.gridBots {
		if bot.Config.Symbol == symbol && bot.Status == BotStatusRunning {
			orders, err := bot.OnPriceUpdate(ctx, price)
			if err != nil {
				continue
			}
			for _, order := range orders {
				bm.orderChannel <- order
			}
		}
	}

	// Process DCA bots
	for _, bot := range bm.dcaBots {
		if bot.Config.Symbol == symbol && bot.Status == BotStatusRunning {
			order, err := bot.CheckAndTrade(ctx, price)
			if err != nil {
				continue
			}
			if order != nil {
				bm.orderChannel <- order
			}
		}
	}

	bm.mu.RUnlock()

	return nil
}

// StartOrderProcessor starts the order processing goroutine
func (bm *BotManager) StartOrderProcessor(ctx context.Context) {
	go func() {
		for {
			select {
			case order := <-bm.orderChannel:
				orderID, err := bm.exchange.PlaceOrder(order)
				if err != nil {
					// Handle error - log, retry, etc.
					continue
				}
				order.OrderID = orderID
			case <-ctx.Done():
				return
			}
		}
	}()
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateBotID(prefix string) string {
	return fmt.Sprintf("%s_%x", prefix, time.Now().UnixNano())
}

func generateTradeID() string {
	return fmt.Sprintf("TRD_%x", time.Now().UnixNano())
}

var _ = fmt.Sprintf
var _ = math.MaxFloat64

func init() {}

var (
	_ context.Context
	_ time.Now
)