// Package dca provides Dollar Cost Averaging bot implementation.
// DCA bots invest a fixed amount at regular intervals regardless of price,
// reducing the impact of volatility and averaging the purchase cost.
package dca

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// DCABot represents a Dollar Cost Averaging bot
type DCABot struct {
	ID             string          `json:"id"`
	UserID         string          `json:"user_id"`
	Symbol         string          `json:"symbol"`
	Investment    decimal.Decimal `json:"investment"`   // Total to invest
	InvestedSoFar decimal.Decimal `json:"invested_so_far"` // Amount invested
	InvestmentPerTrade decimal.Decimal `json:"investment_per_trade"` // Amount per trade
	Interval      time.Duration   `json:"interval"` // Time between trades
	TotalTrades   int             `json:"total_trades"` // Number of trades to make
	TradesDone   int             `json:"trades_done"` // Trades completed
	TakeProfitPct decimal.Decimal `json:"take_profit_pct"` // Target profit %
	StopLossPct  decimal.Decimal `json:"stop_loss_pct"` // Max loss %
	AbovePrice   decimal.Decimal `json:"above_price"` // Only buy above this price
	BelowPrice  decimal.Decimal `json:"below_price"` // Only buy below this price
	Status       BotStatus     `json:"status"`
	Profit      decimal.Decimal `json:"profit"`
	AvgBuyPrice decimal.Decimal `json:"avg_buy_price"`
	StartPrice decimal.Decimal `json:"start_price"`
	IsActive   bool          `json:"is_active"`
	NextTradeTime time.Time   `json:"next_trade_time"`
	CreatedAt  time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
}

// BotStatus represents bot status
type BotStatus string

const (
	DCABotStatusIdle     BotStatus = "IDLE"
	DCABotStatusRunning BotStatus = "RUNNING"
	DCABotStatusPaused BotStatus = "PAUSED"
	DCABotStatusCompleted BotStatus = "COMPLETED"
	DCABotStatusStopped BotStatus = "STOPPED"
)

// DCATrade represents a completed trade
type DCATrade struct {
	ID        string          `json:"id"`
	BotID     string          `json:"bot_id"`
	OrderID   string          `json:"order_id"`
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
	Status   string         `json:"status"`
	ExecutedAt time.Time    `json:"executed_at"`
}

// DCACollection represents a collection of DCA trades
type DCACollection struct {
	ID        string           `json:"id"`
	UserID    string           `json:"user_id"`
	Symbol   string           `json:"symbol"`
	BotID    string           `json:"bot_id"`
	Status   string           `json:"status"`
	Trades   []*DCATrade `json:"trades"`
}

// DCAConfig represents DCA bot configuration
type DCAConfig struct {
	Symbol          string          `json:"symbol"`
	Investment     decimal.Decimal `json:"investment"` // Total amount
	InvestmentPerTrade decimal.Decimal `json:"investment_per_trade"`
	Interval      time.Duration `json:"interval"`
	TotalTrades   int          `json:"total_trades"` // 0 = infinite
	TakeProfitPct decimal.Decimal `json:"take_profit_pct"`
	StopLossPct  decimal.Decimal `json:"stop_loss_pct"`
	AbovePrice   decimal.Decimal `json:"above_price"`
	BelowPrice  decimal.Decimal `json:"below_price"`
}

// DCACalculator calculates DCA parameters
type DCACalculator struct{}

// CalculateInvestmentPerTrade calculates optimal investment per trade
func (calc *DCACalculator) CalculateInvestmentPerTrade(totalInvestment decimal.Decimal, numTrades int) decimal.Decimal {
	if numTrades <= 0 {
		return totalInvestment
	}
	return totalInvestment.Div(decimal.NewFromInt(int64(numTrades)))
}

// CalculateExpectedPrice calculates expected average price
func (calc *DCACalculator) CalculateExpectedPrice(trades []*DCATrade) decimal.Decimal {
	if len(trades) == 0 {
		return decimal.Zero
	}

	var totalSpent decimal.Decimal
	var totalQty decimal.Decimal
	for _, trade := range trades {
		if trade.Status == "FILLED" {
			totalSpent = totalSpent.Add(trade.Price.Mul(trade.Quantity))
			totalQty = totalQty.Add(trade.Quantity)
		}
	}

	if totalQty.IsZero() {
		return decimal.Zero
	}

	return totalSpent.Div(totalQty)
}

// CalculateTotalProfit calculates total profit from DCA
func (calc *DCACalculator) CalculateTotalProfit(trades []*DCATrade, currentPrice decimal.Decimal) decimal.Decimal {
	avgPrice := calc.CalculateExpectedPrice(trades)
	if avgPrice.IsZero() {
		return decimal.Zero
	}

	var totalQty decimal.Decimal
	for _, trade := range trades {
		if trade.Status == "FILLED" {
			totalQty = totalQty.Add(trade.Quantity)
		}
	}

	totalValue := totalQty.Mul(currentPrice)
	totalCost := totalQty.Mul(avgPrice)

	return totalValue.Sub(totalCost)
}

// DCAEngine manages DCA bot operations
type DCAEngine struct {
	mu          sync.RWMutex
	bots        map[string]*DCABot
	orders      map[string]*DCATrade
	scheduledCh chan *ScheduledTrade
	marketData MarketDataProvider
	orderExec OrderExecutor
	notifier NotificationService
	cfg     *EngineConfig
}

// ScheduledTrade represents a scheduled trade waiting to execute
type ScheduledTrade struct {
	BotID    string
	ExecTime time.Time
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
}

// NotificationService sends notifications
type NotificationService interface {
	Notify(userID, message string) error
}

// EngineConfig holds engine configuration
type EngineConfig struct {
	MaxBotsPerUser int
	MinInvestment decimal.Decimal
	MinInterval   time.Duration
}

// Ticker represents market ticker
type Ticker struct {
	Symbol    string
	LastPrice decimal.Decimal
}

// Order represents a trading order
type Order struct {
	ID       string
	UserID   string
	Symbol   string
	Side    string
	Type    string
	Price   decimal.Decimal
	Quantity decimal.Decimal
	Status  string
}

// NewDCAEngine creates a new DCA engine
func NewDCAEngine() *DCAEngine {
	return &DCAEngine{
		bots:        make(map[string]*DCABot),
		orders:      make(map[string]*DCATrade),
		scheduledCh: make(chan *ScheduledTrade, 1000),
		cfg:       &EngineConfig{
			MaxBotsPerUser: 10,
			MinInvestment: decimal.NewFromInt(10),
			MinInterval:   60 * time.Second,
		},
	}
}

// CreateBot creates a new DCA bot
func (dce *DCAEngine) CreateBot(ctx context.Context, userID string, config *DCAConfig) (*DCABot, error) {
	// Check minimum investment
	if config.Investment.LessThan(dce.cfg.MinInvestment) {
		return nil, fmt.Errorf("minimum investment is %s", dce.cfg.MinInvestment.String())
	}

	// Get current price to set start price
	currentPrice, err := dce.marketData.GetPrice(config.Symbol)
	if err != nil {
		return nil, err
	}

	// Calculate number of trades from interval
	numTrades := config.TotalTrades
	if numTrades == 0 && config.InvestmentPerTrade.IsZero() == false {
		// Infinite DCA
		numTrades = 999999 // Effectively infinite
	} else if numTrades == 0 {
		return nil, fmt.Errorf("must specify total trades or investment per trade")
	}

	bot := &DCABot{
		ID:              generateBotID(),
		UserID:          userID,
		Symbol:         config.Symbol,
		Investment:     config.Investment,
		InvestmentPerTrade: config.InvestmentPerTrade,
		Interval:       config.Interval,
		TotalTrades:    numTrades,
		TradesDone:     0,
		TakeProfitPct:  config.TakeProfitPct,
		StopLossPct:   config.StopLossPct,
		AbovePrice:    config.AbovePrice,
		BelowPrice:   config.BelowPrice,
		Status:        DCABotStatusIdle,
		Profit:       decimal.Zero,
		StartPrice:   currentPrice,
		IsActive:     false,
		NextTradeTime: time.Now(),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	dce.mu.Lock()
	dce.bots[bot.ID] = bot
	dce.mu.Unlock()

	return bot, nil
}

// StartBot starts a DCA bot
func (dce *DCAEngine) StartBot(ctx context.Context, botID string) error {
	dce.mu.Lock()
	defer dce.mu.Unlock()

	bot, ok := dce.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	if bot.Status == DCABotStatusRunning {
		return fmt.Errorf("bot already running")
	}

	// Schedule first trade
	bot.Status = DCABotStatusRunning
	bot.IsActive = true
	bot.NextTradeTime = time.Now()
	bot.UpdatedAt = time.Now()

	return nil
}

// StopBot stops a DCA bot
func (dce *DCAEngine) StopBot(ctx context.Context, botID string) error {
	dce.mu.Lock()
	defer dce.mu.Unlock()

	bot, ok := dce.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	bot.Status = DCABotStatusStopped
	bot.IsActive = false
	bot.UpdatedAt = time.Now()

	return nil
}

// PauseBot pauses a DCA bot
func (dce *DCAEngine) PauseBot(ctx context.Context, botID string) error {
	dce.mu.Lock()
	defer dce.mu.Unlock()

	bot, ok := dce.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	bot.Status = DCABotStatusPaused
	bot.UpdatedAt = time.Now()

	return nil
}

// ExecuteScheduledTrades executes scheduled DCA trades
func (dce *DCAEngine) ExecuteScheduledTrades(ctx context.Context) error {
	now := time.Now()

	dce.mu.RLock()
	var botsToExecute []*DCABot
	for _, bot := range dce.bots {
		if bot.IsActive && bot.Status == DCABotStatusRunning &&
			(now.After(bot.NextTradeTime) || now.Equal(bot.NextTradeTime)) {
			botsToExecute = append(botsToExecute, bot)
		}
	}
	dce.mu.RUnlock()

	for _, bot := range botsToExecute {
		dce.executeTrade(ctx, bot)
	}

	return nil
}

// executeTrade executes a single DCA trade
func (dce *DCAEngine) executeTrade(ctx context.Context, bot *DCABot) error {
	// Get current price
	currentPrice, err := dce.marketData.GetPrice(bot.Symbol)
	if err != nil {
		return err
	}

	// Check price filters
	if bot.AbovePrice.IsZero() == false && currentPrice.LessThan(bot.AbovePrice) {
		return nil // Skip, price too low
	}
	if bot.BelowPrice.IsZero() == false && currentPrice.GreaterThan(bot.BelowPrice) {
		return nil // Skip, price too high
	}

	// Place buy order
	order := &Order{
		ID:       generateOrderID(),
		UserID:   bot.UserID,
		Symbol:  bot.Symbol,
		Side:    "BUY",
		Type:    "MARKET",
		Price:   currentPrice, // Market order, price is estimated
		Quantity: bot.InvestmentPerTrade,
		Status:  "PENDING",
	}

	placedOrder, err := dce.orderExec.PlaceOrder(ctx, order)
	if err != nil {
		return err
	}

	// Record trade
	trade := &DCATrade{
		ID:         generateTradeID(),
		BotID:      bot.ID,
		OrderID:   placedOrder.ID,
		Price:    currentPrice,
		Quantity: bot.InvestmentPerTrade,
		Status:   "FILLED",
		ExecutedAt: time.Now(),
	}

	dce.mu.Lock()
	dce.orders[trade.ID] = trade
	dce.bots[bot.ID].TradesDone++
	dce.bots[bot.ID].InvestedSoFar = dce.bots[bot.ID].InvestedSoFar.Add(bot.InvestmentPerTrade)
	dce.bots[bot.ID].NextTradeTime = time.Now().Add(bot.Interval)
	dce.bots[bot.ID].UpdatedAt = time.Now()
	dce.mu.Unlock()

	// Notify user
	dce.notifier.Notify(bot.UserID, "DCA trade executed")

	return nil
}

// ProcessFill processes order fill and calculates profit
func (dce *DCAEngine) ProcessFill(ctx context.Context, orderID string, execPrice decimal.Decimal) error {
	dce.mu.RLock()
	trade, ok := dce.orders[orderID]
	dce.mu.RUnlock()

	if !ok {
		return fmt.Errorf("trade not found")
	}

	trade.Price = execPrice
	trade.Status = "FILLED"
	trade.ExecutedAt = time.Now()

	// Calculate new average price
	bot, ok := dce.bots[trade.BotID]
	if !ok {
		return nil
	}

	bot.AvgBuyPrice = bot.InvestedSoFar.Add(execPrice).
		Div(decimal.NewFromInt(int64(bot.TradesDone)))

	// Mark as filled in order map
	dce.mu.Lock()
	dce.orders[trade.ID] = trade
	dce.mu.Unlock()

	return nil
}

// CheckStopConditions checks stop loss and take profit conditions
func (dce *DCAEngine) CheckStopConditions(ctx context.Context, botID string) error {
	bot, ok := dce.bots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	// Check if completed
	if bot.TotalTrades > 0 && bot.TradesDone >= bot.TotalTrades {
		bot.Status = DCABotStatusCompleted
		return nil
	}

	// Get current price and check conditions
	currentPrice, err := dce.marketData.GetPrice(bot.Symbol)
	if err != nil {
		return err
	}

	// Calculate profit percentage
	if bot.AvgBuyPrice.IsZero() == false {
		profitPct := currentPrice.Sub(bot.AvgBuyPrice).Div(bot.AvgBuyPrice).Mul(decimal.NewFromInt(100))

		// Take profit
		if bot.TakeProfitPct.IsZero() == false && profitPct.GreaterThanOrEqual(bot.TakeProfitPct) {
			bot.Status = DCABotStatusCompleted
			dce.notifier.Notify(bot.UserID, "Take profit target reached!")
			return nil
		}

		// Stop loss
		if bot.StopLossPct.IsZero() == false && profitPct.LessThan(bot.StopLossPct.Neg()) {
			bot.Status = DCABotStatusStopped
			dce.notifier.Notify(bot.UserID, "Stop loss triggered!")
			return nil
		}
	}

	return nil
}

// GetBot returns bot by ID
func (dce *DCAEngine) GetBot(botID string) (*DCABot, bool) {
	dce.mu.RLock()
	defer dce.mu.RUnlock()
	bot, ok := dce.bots[botID]
	return bot, ok
}

// GetUserBots returns all bots for a user
func (dce *DCAEngine) GetUserBots(userID string) []*DCABot {
	dce.mu.RLock()
	defer dce.mu.RUnlock()

	var result []*DCABot
	for _, bot := range dce.bots {
		if bot.UserID == userID {
			result = append(result, bot)
		}
	}
	return result
}

// GetTrades returns trades for a bot
func (dce *DCAEngine) GetTrades(botID string) []*DCATrade {
	dce.mu.RLock()
	defer dce.mu.RUnlock()

	var result []*DCATrade
	for _, trade := range dce.orders {
		if trade.BotID == botID {
			result = append(result, trade)
		}
	}
	return result
}

// Helper functions
func generateBotID() string {
	return fmt.Sprintf("DCA%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateTradeID() string {
	return fmt.Sprintf("DCATRD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateOrderID() string {
	return fmt.Sprintf("DCAORD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

var _ = decimal.Decimal{}