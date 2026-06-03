package bots

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// =============================================================================
// TRADING BOTS SERVICE
// Grid trading, DCA, and other algorithmic bots
// =============================================================================

// BotConfig bot configuration
type BotConfig struct {
	BotType     string  `json:"botType"` // GRID, DCA, MARTINGALE, ARBITRAGE
	Symbol     string  `json:"symbol"`
	Capital    float64 `json:"capital"`
	MinPrice   float64 `json:"minPrice"`
	MaxPrice   float64 `json:"maxPrice"`
	GridLevels int     `json:"gridLevels"`
	GridSpacing float64 `json:"gridSpacing"` // % between grids
	isEnabled  bool    `json:"isEnabled"`
}

// GRIDBot grid trading bot
type GRIDBot struct {
	ID        string    `json:"id"`
	UserID   string    `json:"userId"`
	Config   *BotConfig `json:"config"`
	Status   string    `json:"status"` // RUNNING, PAUSED, STOPPED
	Orders   []string  `json:"orders"` // Grid order IDs
	Profit   float64   `json:"profit"`
	StartedAt time.Time `json:"startedAt"`
	LastTrade *time.Time `json:"lastTrade,omitempty"`
}

// DCABot DCA bot
type DCABot struct {
	ID          string    `json:"id"`
	UserID     string    `json:"userId"`
	Config     *BotConfig `json:"config"`
	Status    string    `json:"status"`
	Invested  float64   `json:"invested"`
	AvgPrice  float64   `json:"avgPrice"`
	Positions int64    `json:"positions"`
	NextBuy   *time.Time `json:"nextBuy"`
	Profit    float64  `json:"profit"`
	StartedAt time.Time `json:"startedAt"`
}

// MartingaleBot martingale bot
type MartingaleBot struct {
	ID           string    `json:"id"`
	UserID      string    `json:"userId"`
	Config     *BotConfig `json:"config"`
	Status    string    `json:"status"`
	BaseBet   float64   `json:"baseBet"`
	CurrentBet float64 `json:"currentBet"`
	Wins      int64    `json:"wins"`
	losses    int64    `json:"losses"`
	Profit    float64  `json:"profit"`
	MaxSequence int    `json:"maxSequence"`
	Multiplier float64 `json:"multiplier"`
}

// BotExecution represents bot trade execution
type BotExecution struct {
	ID        string    `json:"id"`
	BotID     string    `json:"botId"`
	Type     string    `json:"type"` // BUY, SELL
	Price    float64   `json:"price"`
	Quantity float64   `json:"quantity"`
	OrderID  string    `json:"orderId"`
	ExecutedAt time.Time `json:"executedAt"`
	Error    string    `json:"error,omitempty"`
}

// Service trading bots service
type Service struct {
	mu sync.RWMutex

	// Bots
	gridBots      map[string]*GRIDBot
	dcaBots       map[string]*DCABot
	martingaleBots map[string]*MartingaleBot

	// Executions (recent trades)
	executions   map[string][]*BotExecution
	maxExecutionHistory int

	// External price feed (mock - production would connect to oracle)
	prices map[string]float64
}

// NewService creates bots service
func NewService() *Service {
	return &Service{
		gridBots:         make(map[string]*GRIDBot),
		dcaBots:          make(map[string]*DCABot),
		martingaleBots:   make(map[string]*MartingaleBot),
		executions:       make(map[string][]*BotExecution),
		maxExecutionHistory: 100,
		prices:           make(map[string]float64),
	}
}

// CreateGridBot creates grid trading bot
func (s *Service) CreateGridBot(userID string, config *BotConfig) (*GRIDBot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if config.Symbol == "" {
		return nil, fmt.Errorf("symbol required")
	}

	if config.GridLevels < 2 || config.GridLevels > 200 {
		return nil, fmt.Errorf("grid levels 2-200")
	}

	if config.Capital <= 100 {
		return nil, fmt.Errorf("minimum capital: 100")
	}

	bot := &GRIDBot{
		ID:        generateID(),
		UserID:   userID,
		Config:   config,
		Status:   "PAUSED",
		Profit:   0,
		StartedAt: time.Now(),
	}

	s.gridBots[bot.ID] = bot

	return bot, nil
}

// StartGridBot starts grid bot
func (s *Service) StartGridBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.gridBots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	if bot.Status == "RUNNING" {
		return fmt.Errorf("already running")
	}

	// Generate grid levels
	priceRange := bot.Config.MaxPrice - bot.Config.MinPrice
	gridStep := priceRange / float64(bot.Config.GridLevels)

	// Create buy orders at lower grids
	gridPrice := bot.Config.MinPrice
	for i := 0; i < bot.Config.GridLevels; i++ {
		gridPrice += gridStep
		orderID := generateOrderID()
		bot.Orders = append(bot.Orders, orderID)

		bot.Profit -= gridPrice * (bot.Config.Capital / float64(bot.Config.GridLevels))
	}

	bot.Status = "RUNNING"

	return nil
}

// StopGridBot stops grid bot
func (s *Service) StopGridBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.gridBots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	bot.Status = "STOPPED"

	return nil
}

// ExecuteGrid executes grid order (called by price feed)
func (s *Service) ExecuteGrid(botID string, currentPrice float64) (*BotExecution, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.gridBots[botID]
	if !ok || bot.Status != "RUNNING" {
		return nil, nil
	}

	// Check if price hits any grid level
	priceRange := bot.Config.MaxPrice - bot.Config.MinPrice
	gridStep := priceRange / float64(bot.Config.GridLevels)

	for i, orderID := range bot.Orders {
		gridPrice := bot.Config.MinPrice + (float64(i+1) * gridStep)
		
		currentDiff := math.Abs(currentPrice - gridPrice)
		threshold := gridStep * 0.001 // 0.1% threshold

		if currentDiff < threshold {
			// Execute trade
			execution := &BotExecution{
				ID:        generateID(),
				BotID:     botID,
				Type:     "SELL",
				Price:    currentPrice,
				Quantity: bot.Config.Capital / float64(bot.Config.GridLevels) / gridPrice,
				OrderID:  orderID,
				ExecutedAt: time.Now(),
			}

			buyPrice := bot.Config.MinPrice + (float64(i) * gridStep)
			profit := (currentPrice - buyPrice) * execution.Quantity
			bot.Profit += profit

			// Replace order
			newOrderID := generateOrderID()
			bot.Orders[i] = newOrderID

			now := time.Now()
			bot.LastTrade = &now

			return execution, nil
		}
	}

	return nil, nil
}

// CreateDCABot creates DCA bot
func (s *Service) CreateDCABot(userID string, config *BotConfig) (*DCABot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if config.Symbol == "" {
		return nil, fmt.Errorf("symbol required")
	}

	bot := &DCABot{
		ID:        generateID(),
		UserID:    userID,
		Config:    config,
		Status:   "PAUSED",
		Invested: 0,
		AvgPrice: 0,
		StartedAt: time.Now(),
	}

	s.dcaBots[bot.ID] = bot

	return bot, nil
}

// StartDCA starts DCA bot
func (s *Service) StartDCA(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.dcaBots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	nextBuy := time.Now().Add(24 * time.Hour) // Daily DCA
	bot.NextBuy = &nextBuy
	bot.Status = "RUNNING"

	return nil
}

// ExecuteDCA executes DCA purchase
func (s *Service) ExecuteDCA(botID string, currentPrice float64) (*BotExecution, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.dcaBots[botID]
	if !ok || bot.Status != "RUNNING" {
		return nil, nil
	}

	// Check if time for DCA
	if bot.NextBuy != nil && time.Now().Before(*bot.NextBuy) {
		return nil, nil
	}

	// Execute DCA purchase
	buyAmount := bot.Config.Capital / float64(bot.Config.GridLevels)
	quantity := buyAmount / currentPrice

	execution := &BotExecution{
		ID:        generateID(),
		BotID:    botID,
		Type:     "BUY",
		Price:    currentPrice,
		Quantity: quantity,
		ExecutedAt: time.Now(),
	}

	// Update average price
	totalInvested := bot.Invested + buyAmount
	newTotalQty := (bot.AvgPrice * float64(bot.Positions)) + quantity
	bot.AvgPrice = newTotalQty / float64(bot.Positions+1)
	bot.Invested = totalInvested
	bot.Positions++

	// Calculate P&L
	if bot.Positions > 1 {
		currentValue := float64(bot.Positions) * currentPrice
		bot.Profit = currentValue - bot.Invested
	}

	// Schedule next buy (24h)
	nextBuy := time.Now().Add(24 * time.Hour)
	bot.NextBuy = &nextBuy

	return execution, nil
}

// StopDCA stops DCA bot
func (s *Service) StopDCA(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.dcaBots[botID]
	if !ok {
		return fmt.Errorf("bot not found")
	}

	bot.Status = "STOPPED"

	return nil
}

// GetGridBots gets user's grid bots
func (s *Service) GetGridBots(userID string) []*GRIDBot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*GRIDBot
	for _, bot := range s.gridBots {
		if bot.UserID == userID {
			result = append(result, bot)
		}
	}

	return result
}

// GetDCABots gets user's DCA bots
func (s *Service) GetDCABots(userID string) []*DCABot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*DCABot
	for _, bot := range s.dcaBots {
		if bot.UserID == userID {
			result = append(result, bot)
		}
	}

	return result
}

// CalculateBotPnL calculates bot P&L
func (s *Service) CalculateBotPnL(botID string) (profit, roi float64) {
	s.mu.RLock()
	switch {
	case bot, ok := s.gridBots[botID]:
		if bot.Config.Capital > 0 {
			roi = (bot.Profit / bot.Config.Capital) * 100
		}
		return bot.Profit, roi
	case bot, ok := s.dcaBots[botID]:
		if bot.Invested > 0 {
			roi = (bot.Profit / bot.Invested) * 100
		}
		return bot.Profit, roi
	default:
		return 0, 0
	}
	s.mu.RUnlock()
}

// UpdatePrice updates price for execution check
func (s *Service) UpdatePrice(symbol string, price float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prices[symbol] = price
}

// GetExecutions gets executions
func (s *Service) GetExecutions(botID string) []*BotExecution {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.executions[botID]
}

func generateID() string {
	return fmt.Sprintf("bot-%d", time.Now().UnixNano())
}

func generateOrderID() string {
	return fmt.Sprintf("ord-%d", time.Now().UnixNano())
}