package trading_bots

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"
)

// BotType represents the type of trading bot
type BotType string

const (
	BotTypeGrid        BotType = "GRID"
	BotTypeDCA         BotType = "DCA"
	BotTypeRebalance   BotType = "REBALANCE"
	BotTypeMartingale  BotType = "MARTINGALE"
)

// BotStatus represents the bot status
type BotStatus string

const (
	BotStatusActive   BotStatus = "ACTIVE"
	BotStatusPaused   BotStatus = "PAUSED"
	BotStatusStopped  BotStatus = "STOPPED"
	BotStatusError    BotStatus = "ERROR"
)

// Bot represents a trading bot configuration
type Bot struct {
	ID             string         `json:"id"`
	UserID         string         `json:"user_id"`
	BotType        BotType        `json:"bot_type"`
	Symbol         string         `json:"symbol"`
	Status         BotStatus      `json:"status"`
	Capital        float64        `json:"capital"` // Total capital allocated
	InvestedAmount float64        `json:"invested_amount"`
	ProfitLoss     float64        `json:"profit_loss"`
	StartPrice     float64        `json:"start_price"`
	CurrentPrice   float64        `json:"current_price"`
	Settings       BotSettings    `json:"settings"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	StartedAt      *time.Time     `json:"started_at,omitempty"`
}

// BotSettings represents bot configuration
type BotSettings struct {
	// Grid settings
	GridLevels     int     `json:"grid_levels,omitempty"` // For GRID bot
	UpperPrice     float64 `json:"upper_price,omitempty"`
	LowerPrice     float64 `json:"lower_price,omitempty"`
	GridSpacing    float64 `json:"grid_spacing,omitempty"` // Percentage
	
	// DCA settings
	DCAAmount      float64 `json:"dca_amount,omitempty"` // Amount per buy
	DCAPeriod      int     `json:"dca_period,omitempty"` // Hours between buys
	DCAMaxOrders   int     `json:"dca_max_orders,omitempty"`
	
	// Martingale settings
	Multiplier     float64 `json:"multiplier,omitempty"` // Position size multiplier after loss
	BaseStake      float64 `json:"base_stake,omitempty"`
	MaxStake       float64 `json:"max_stake,omitempty"`
	TargetProfit   float64 `json:"target_profit,omitempty"`
	
	// Common settings
	StopLoss       float64 `json:"stop_loss,omitempty"` // Percentage
	TakeProfit     float64 `json:"take_profit,omitempty"` // Percentage
	
	// Rebalance settings
	TargetAllocation map[string]float64 `json:"target_allocation,omitempty"` // symbol -> percentage
	RebalancePeriod int                `json:"rebalance_period,omitempty"` // Hours
}

// BotTrade represents a bot's executed trade
type BotTrade struct {
	ID        string    `json:"id"`
	BotID     string    `json:"bot_id"`
	Symbol    string    `json:"symbol"`
	Side      string    `json:"side"` // BUY or SELL
	Price     float64   `json:"price"`
	Quantity  float64   `json:"quantity"`
	Amount    float64   `json:"amount"`
	ProfitLoss float64 `json:"profit_loss"`
	Timestamp time.Time `json:"timestamp"`
}

// GridBot implements grid trading strategy
type GridBot struct {
	*Bot
	gridLines    []float64
	orders       map[int]*GridOrder // grid index -> order
	currentLevel int
	mu           sync.RWMutex
}

// GridOrder represents a grid level order
type GridOrder struct {
	Level      int
	BuyPrice   float64
	SellPrice  float64
	BuyFilled  bool
	SellFilled bool
	BuyQty     float64
	SellQty    float64
}

// DCABot implements Dollar Cost Averaging strategy
type DCABot struct {
	*Bot
	lastBuyTime    time.Time
	buyCount       int
	nextBuyPrice   float64
	mu             sync.RWMutex
}

// RebalanceBot implements portfolio rebalancing strategy
type RebalanceBot struct {
	*Bot
	lastRebalance  time.Time
	targetPortfolio map[string]float64 // symbol -> target percentage
	mu              sync.RWMutex
}

// MartingaleBot implements martingale strategy
type MartingaleBot struct {
	*Bot
	currentStake    float64
	lossStreak      int
	mu              sync.RWMutex
}

// BotService manages all trading bots
type BotService struct {
	mu        sync.RWMutex
	bots      map[string]*Bot
	trades    map[string][]*BotTrade
	priceFeed chan PriceUpdate
	
	// Trading interface (would connect to actual trading engine)
	tradingService TradingServiceInterface
}

// TradingServiceInterface interface for trading operations
type TradingServiceInterface interface {
	PlaceOrder(symbol string, side string, orderType string, price, quantity float64) error
	GetCurrentPrice(symbol string) (float64, error)
}

// PriceUpdate represents a price update
type PriceUpdate struct {
	Symbol    string
	Price     float64
	Timestamp time.Time
}

// NewBotService creates a new bot service
func NewBotService(tradingService TradingServiceInterface) *BotService {
	return &BotService{
		bots:          make(map[string]*Bot),
		trades:        make(map[string][]*BotTrade),
		priceFeed:     make(chan PriceUpdate, 1000),
		tradingService: tradingService,
	}
}

// CreateGridBot creates a new grid trading bot
func (s *BotService) CreateGridBot(userID, symbol string, capital float64, settings BotSettings) (*GridBot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if capital < 100 {
		return nil, errors.New("minimum capital is 100")
	}

	if settings.GridLevels < 2 || settings.GridLevels > 100 {
		return nil, errors.New("grid levels must be between 2 and 100")
	}

	if settings.LowerPrice >= settings.UpperPrice {
		return nil, errors.New("lower price must be less than upper price")
	}

	// Calculate grid lines
	spacing := (settings.UpperPrice - settings.LowerPrice) / float64(settings.GridLevels-1)
	gridLines := make([]float64, settings.GridLevels)
	for i := 0; i < settings.GridLevels; i++ {
		gridLines[i] = settings.LowerPrice + spacing*float64(i)
	}

	// Calculate capital per grid
	capitalPerGrid := capital / float64(settings.GridLevels)
	qtyPerGrid := capitalPerGrid / gridLines[settings.GridLevels/2] // Use middle price for calculation

	bot := &Bot{
		ID:           generateID(),
		UserID:       userID,
		BotType:      BotTypeGrid,
		Symbol:       symbol,
		Status:       BotStatusPaused,
		Capital:      capital,
		Settings:     settings,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	gridBot := &GridBot{
		Bot:        bot,
		gridLines:  gridLines,
		orders:     make(map[int]*GridOrder),
		currentLevel: settings.GridLevels / 2, // Start from middle
	}

	// Initialize grid orders
	for i := 0; i < settings.GridLevels; i++ {
		gridBot.orders[i] = &GridOrder{
			Level:     i,
			BuyPrice:  gridLines[i] * 0.998, // Slightly below line
			SellPrice: gridLines[i] * 1.002, // Slightly above line
			BuyQty:    qtyPerGrid,
			SellQty:   qtyPerGrid,
		}
	}

	s.bots[bot.ID] = bot
	s.trades[bot.ID] = make([]*BotTrade, 0)

	return gridBot, nil
}

// StartBot starts a bot
func (s *BotService) StartBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists {
		return errors.New("bot not found")
	}

	if bot.Status == BotStatusActive {
		return errors.New("bot already active")
	}

	now := time.Now()
	bot.Status = BotStatusActive
	bot.StartedAt = &now
	bot.UpdatedAt = time.Now()
	bot.StartPrice = s.getCurrentPrice(bot.Symbol)

	return nil
}

// StopBot stops a bot
func (s *BotService) StopBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists {
		return errors.New("bot not found")
	}

	bot.Status = BotStatusStopped
	bot.UpdatedAt = time.Now()

	return nil
}

// ExecuteGridBot executes grid bot logic
func (s *BotService) ExecuteGridBot(botID string, currentPrice float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists || bot.BotType != BotTypeGrid {
		return errors.New("bot not found or not a grid bot")
	}

	if bot.Status != BotStatusActive {
		return nil
	}

	bot.CurrentPrice = currentPrice

	// Find which grid level we're at
	settings := bot.Settings
	gridIndex := s.getGridIndex(currentPrice, settings.LowerPrice, settings.UpperPrice, settings.GridLevels)

	if gridIndex < 0 || gridIndex >= settings.GridLevels {
		return nil
	}

	// Execute grid orders
	profit := s.executeGridLevel(botID, gridIndex, currentPrice)
	bot.ProfitLoss += profit
	bot.UpdatedAt = time.Now()

	return nil
}

func (s *BotService) executeGridLevel(botID string, index int, currentPrice float64) float64 {
	bot := s.bots[botID].(*GridBot)
	order := bot.orders[index]
	
	if order == nil {
		return 0
	}

	var profit float64

	// Check if we should buy at this level
	if !order.BuyFilled && currentPrice <= order.BuyPrice {
		// Execute buy order
		trade := &BotTrade{
			ID:        generateID(),
			BotID:     botID,
			Symbol:    bot.Symbol,
			Side:      "BUY",
			Price:     currentPrice,
			Quantity:  order.BuyQty,
			Amount:    currentPrice * order.BuyQty,
			Timestamp: time.Now(),
		}
		s.trades[botID] = append(s.trades[botID], trade)
		order.BuyFilled = true
		bot.InvestedAmount += trade.Amount
		
		// Place corresponding sell order at sell price
		// In real implementation, this would place an actual sell order
	}

	// Check if we should sell at this level
	if !order.SellFilled && currentPrice >= order.SellPrice {
		// Execute sell order
		sellQty := order.SellQty
		if !order.BuyFilled {
			sellQty = order.SellQty * 2 // Full grid profit if no buy yet
		}
		
		trade := &BotTrade{
			ID:         generateID(),
			BotID:      botID,
			Symbol:     bot.Symbol,
			Side:       "SELL",
			Price:      currentPrice,
			Quantity:   sellQty,
			Amount:     currentPrice * sellQty,
			ProfitLoss: (currentPrice - order.BuyPrice) * sellQty,
			Timestamp:  time.Now(),
		}
		s.trades[botID] = append(s.trades[botID], trade)
		order.SellFilled = true
		profit = trade.ProfitLoss
		
		// Reset the grid level for next cycle
		order.BuyFilled = false
		order.SellFilled = false
	}

	return profit
}

func (s *BotService) getGridIndex(price, lower, upper float64, levels int) int {
	if price < lower || price > upper {
		return -1
	}
	
	spacing := (upper - lower) / float64(levels-1)
	index := int((price - lower) / spacing)
	
	if index < 0 {
		return 0
	}
	if index >= levels {
		return levels - 1
	}
	
	return index
}

// CreateDCABot creates a new DCA bot
func (s *BotService) CreateDCABot(userID, symbol string, capital float64, settings BotSettings) (*DCABot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if capital < 50 {
		return nil, errors.New("minimum capital is 50")
	}

	bot := &Bot{
		ID:           generateID(),
		UserID:       userID,
		BotType:      BotTypeDCA,
		Symbol:       symbol,
		Status:       BotStatusPaused,
		Capital:      capital,
		Settings:     settings,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	dcaBot := &DCABot{
		Bot:         bot,
		lastBuyTime: time.Now().Add(-time.Duration(settings.DCAPeriod) * time.Hour), // First buy immediately
		buyCount:    0,
	}

	s.bots[bot.ID] = bot
	s.trades[bot.ID] = make([]*BotTrade, 0)

	return dcaBot, nil
}

// ExecuteDCABot executes DCA bot logic
func (s *BotService) ExecuteDCABot(botID string, currentPrice float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists || bot.BotType != BotTypeDCA {
		return errors.New("bot not found or not a DCA bot")
	}

	if bot.Status != BotStatusActive {
		return nil
	}

	bot.CurrentPrice = currentPrice

	dcaBot := &DCABot{Bot: bot}
	
	// Check if it's time for next buy
	nextBuyTime := dcaBot.lastBuyTime.Add(time.Duration(bot.Settings.DCAPeriod) * time.Hour)
	if time.Now().After(nextBuyTime) {
		// Check if we've reached max orders
		if bot.Settings.DCAMaxOrders > 0 && dcaBot.buyCount >= bot.Settings.DCAMaxOrders {
			bot.Status = BotStatusStopped
			return nil
		}

		// Execute DCA buy
		buyAmount := bot.Settings.DCAAmount
		if buyAmount > bot.Capital-bot.InvestedAmount {
			buyAmount = bot.Capital - bot.InvestedAmount
		}

		if buyAmount <= 0 {
			return nil
		}

		quantity := buyAmount / currentPrice

		trade := &BotTrade{
			ID:        generateID(),
			BotID:     botID,
			Symbol:    bot.Symbol,
			Side:      "BUY",
			Price:     currentPrice,
			Quantity:  quantity,
			Amount:    buyAmount,
			Timestamp: time.Now(),
		}

		s.trades[botID] = append(s.trades[botID], trade)
		bot.InvestedAmount += buyAmount
		dcaBot.buyCount++
		dcaBot.lastBuyTime = time.Now()
		bot.UpdatedAt = time.Now()
	}

	return nil
}

// CreateMartingaleBot creates a martingale bot
func (s *BotService) CreateMartingaleBot(userID, symbol string, capital float64, settings BotSettings) (*MartingaleBot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if capital < 100 {
		return nil, errors.New("minimum capital is 100")
	}

	if settings.Multiplier <= 1 {
		return nil, errors.New("multiplier must be greater than 1")
	}

	bot := &Bot{
		ID:           generateID(),
		UserID:       userID,
		BotType:      BotTypeMartingale,
		Symbol:       symbol,
		Status:       BotStatusPaused,
		Capital:      capital,
		Settings:     settings,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	martingaleBot := &MartingaleBot{
		Bot:          bot,
		currentStake: settings.BaseStake,
		lossStreak:   0,
	}

	s.bots[bot.ID] = bot
	s.trades[botID] = make([]*BotTrade, 0)

	return martingaleBot, nil
}

// ExecuteMartingaleBot executes martingale bot logic
func (s *BotService) ExecuteMartingaleBot(botID string, win bool, currentPrice, entryPrice float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists || bot.BotType != BotTypeMartingale {
		return errors.New("bot not found or not a martingale bot")
	}

	if bot.Status != BotStatusActive {
		return nil
	}

	martingaleBot := &MartingaleBot{Bot: bot}

	if win {
		// Won - reset to base stake
		martingaleBot.currentStake = bot.Settings.BaseStake
		martingaleBot.lossStreak = 0
		bot.ProfitLoss += martingaleBot.currentStake * bot.Settings.TargetProfit
		
		// Check take profit
		if bot.ProfitLoss >= bot.Settings.TakeProfit*bot.Capital/100 {
			bot.Status = BotStatusStopped
		}
	} else {
		// Lost - increase stake
		martingaleBot.lossStreak++
		martingaleBot.currentStake = math.Min(
			martingaleBot.currentStake*bot.Settings.Multiplier,
			bot.Settings.MaxStake,
		)
		bot.ProfitLoss -= martingaleBot.currentStake
		
		// Check stop loss
		if math.Abs(bot.ProfitLoss) >= bot.Settings.StopLoss*bot.Capital/100 {
			bot.Status = BotStatusStopped
		}
	}

	bot.UpdatedAt = time.Now()
	return nil
}

// GetBotStatus retrieves bot status
func (s *BotService) GetBotStatus(botID string) (*Bot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	bot, exists := s.bots[botID]
	if !exists {
		return nil, errors.New("bot not found")
	}

	return bot, nil
}

// GetBotTrades retrieves all trades for a bot
func (s *BotService) GetBotTrades(botID string) []*BotTrade {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.trades[botID]
}

// GetUserBots retrieves all bots for a user
func (s *BotService) GetUserBots(userID string) []*Bot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var userBots []*Bot
	for _, bot := range s.bots {
		if bot.UserID == userID {
			userBots = append(userBots, bot)
		}
	}

	return userBots
}

func (s *BotService) getCurrentPrice(symbol string) float64 {
	// In real implementation, this would get price from trading service
	return 50000.0 // Default price
}

func generateID() string {
	return fmt.Sprintf("BOT_%d_%d", time.Now().UnixNano(), rand.Int63())
}

// CalculateBotProfit calculates total profit/loss for a bot
func (s *BotService) CalculateBotProfit(botID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var totalProfit float64
	for _, trade := range s.trades[botID] {
		if trade.Side == "SELL" {
			totalProfit += trade.ProfitLoss
		}
	}

	return totalProfit
}

// PauseBot pauses a bot
func (s *BotService) PauseBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists {
		return errors.New("bot not found")
	}

	if bot.Status != BotStatusActive {
		return errors.New("bot is not active")
	}

	bot.Status = BotStatusPaused
	bot.UpdatedAt = time.Now()

	return nil
}

// ResumeBot resumes a paused bot
func (s *BotService) ResumeBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists {
		return errors.New("bot not found")
	}

	if bot.Status != BotStatusPaused {
		return errors.New("bot is not paused")
	}

	bot.Status = BotStatusActive
	bot.UpdatedAt = time.Now()

	return nil
}

// DeleteBot deletes a bot
func (s *BotService) DeleteBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, exists := s.bots[botID]
	if !exists {
		return errors.New("bot not found")
	}

	if bot.Status == BotStatusActive {
		return errors.New("cannot delete active bot")
	}

	delete(s.bots, botID)
	delete(s.trades, botID)

	return nil
}