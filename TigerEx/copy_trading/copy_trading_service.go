package copy_trading

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"
)

// TraderProfile represents a lead trader profile
type TraderProfile struct {
	ID               string           `json:"id"`
	UserID           string           `json:"user_id"`
	DisplayName      string           `json:"display_name"`
	Avatar           string           `json:"avatar"`
	Bio              string           `json:"bio"`
	IsVerified       bool             `json:"is_verified"`
	IsPublic         bool             `json:"is_public"`
	TotalTrades      int64            `json:"total_trades"`
	WinRate          float64          `json:"win_rate"`
	TotalProfit      float64          `json:"total_profit"`
	MonthlyProfit    float64          `json:"monthly_profit"`
	Drawdown         float64          `json:"drawdown"`
	MaxDrawdown      float64          `json:"max_drawdown"`
	SharpeRatio      float64          `json:"sharpe_ratio"`
	RiskLevel        string           `json:"risk_level"` // LOW, MEDIUM, HIGH
	MinCopyAmount    float64          `json:"min_copy_amount"`
	MaxCopyAmount    float64          `json:"max_copy_amount"`
	TotalCopiers     int              `json:"total_copiers"`
	TotalCopiedAmount float64        `json:"total_copied_amount"`
	AvailableSymbols []string         `json:"available_symbols"`
	PerformanceData  []DailyPerformance `json:"performance_data"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}

// DailyPerformance represents daily performance data
type DailyPerformance struct {
	Date        string  `json:"date"`
	Profit      float64 `json:"profit"`
	ProfitPercent float64 `json:"profit_percent"`
	Trades      int     `json:"trades"`
}

// CopyOrder represents a copied order
type CopyOrder struct {
	ID              string    `json:"id"`
	CopierID        string    `json:"copier_id"`
	TraderID        string    `json:"trader_id"`
	OriginalOrderID string    `json:"original_order_id"`
	Symbol          string    `json:"symbol"`
	Side            string    `json:"side"`
	OrderType       string    `json:"order_type"`
	Price           float64   `json:"price"`
	Quantity        float64   `json:"quantity"`
	FilledPrice     float64   `json:"filled_price"`
	FillRatio       float64   `json:"fill_ratio"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`
}

// Copier represents a user who copies traders
type Copier struct {
	ID               string          `json:"id"`
	UserID           string          `json:"user_id"`
	TraderID         string          `json:"trader_id"`
	CopyAmount       float64         `json:"copy_amount"`
	CurrentProfit    float64         `json:"current_profit"`
	TotalProfit      float64         `json:"total_profit"`
	StopLossPercent  float64         `json:"stop_loss_percent"`
	TakeProfitPercent float64        `json:"take_profit_percent"`
	IsActive         bool            `json:"is_active"`
	AllocatedAmount  float64         `json:"allocated_amount"`
	UsedAmount       float64         `json:"used_amount"`
	AvailableAmount  float64         `json:"available_amount"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// TraderStats represents detailed trader statistics
type TraderStats struct {
	TraderID         string  `json:"trader_id"`
	Period           string  `json:"period"` // DAY, WEEK, MONTH, ALL
	TotalProfit      float64 `json:"total_profit"`
	ProfitPercent    float64 `json:"profit_percent"`
	WinRate          float64 `json:"win_rate"`
	TotalTrades      int     `json:"total_trades"`
	ProfitableTrades int     `json:"profitable_trades"`
	LosingTrades     int     `json:"losing_trades"`
	AvgProfit        float64 `json:"avg_profit"`
	AvgLoss          float64 `json:"avg_loss"`
	LargestWin       float64 `json:"largest_win"`
	LargestLoss      float64 `json:"largest_loss"`
	CurrentStreak    int     `json:"current_streak"`
	BestStreak       int     `json:"best_streak"`
	WorstStreak      int     `json:"worst_streak"`
	MaxDrawdown      float64 `json:"max_drawdown"`
	SharpeRatio      float64 `json:"sharpe_ratio"`
	SortinoRatio     float64 `json:"sortino_ratio"`
}

// CopyTradeEvent represents a copy trade event
type CopyTradeEvent struct {
	ID           string    `json:"id"`
	CopierID     string    `json:"copier_id"`
	TraderID     string    `json:"trader_id"`
	Symbol       string    `json:"symbol"`
	Side         string    `json:"side"`
	Price        float64   `json:"price"`
	Quantity     float64   `json:"quantity"`
	TraderProfit float64   `json:"trader_profit"`
	CopierProfit float64   `json:"copier_profit"`
	Timestamp    time.Time `json:"timestamp"`
}

// CopyTradingService handles copy trading operations
type CopyTradingService struct {
	mu              sync.RWMutex
	traderProfiles  map[string]*TraderProfile // userID -> profile
	copies          map[string]*Copier       // copierID -> copy relation
	copyOrders      map[string]*CopyOrder
	traderStats     map[string]*TraderStats // traderID -> stats
	events          chan *CopyTradeEvent
	orderChan       chan *TraderOrder
}

// TraderOrder represents an order from a lead trader
type TraderOrder struct {
	ID        string    `json:"id"`
	TraderID  string    `json:"trader_id"`
	Symbol    string    `json:"symbol"`
	Side      string    `json:"side"` // BUY, SELL
	OrderType string    `json:"order_type"`
	Price     float64   `json:"price"`
	Quantity  float64   `json:"quantity"`
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
}

// NewCopyTradingService creates a new copy trading service
func NewCopyTradingService() *CopyTradingService {
	return &CopyTradingService{
		traderProfiles: make(map[string]*TraderProfile),
		copies:         make(map[string]*Copier),
		copyOrders:     make(map[string]*CopyOrder),
		traderStats:    make(map[string]*TraderStats),
		events:         make(chan *CopyTradeEvent, 1000),
		orderChan:      make(chan *TraderOrder, 100),
	}
}

// CreateTraderProfile creates a new trader profile
func (s *CopyTradingService) CreateTraderProfile(userID, displayName string, minCopy, maxCopy float64) (*TraderProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if minCopy < 10 {
		return nil, errors.New("minimum copy amount must be at least 10")
	}

	profile := &TraderProfile{
		ID:              generateID(),
		UserID:          userID,
		DisplayName:     displayName,
		IsPublic:        false,
		TotalTrades:     0,
		WinRate:         0,
		TotalProfit:     0,
		MonthlyProfit:   0,
		Drawdown:        0,
		MaxDrawdown:     0,
		SharpeRatio:     0,
		RiskLevel:       "MEDIUM",
		MinCopyAmount:    minCopy,
		MaxCopyAmount:    maxCopy,
		TotalCopiers:    0,
		TotalCopiedAmount: 0,
		AvailableSymbols: []string{},
		PerformanceData:  []DailyPerformance{},
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	s.traderProfiles[userID] = profile
	return profile, nil
}

// GetTraderProfile retrieves a trader profile
func (s *CopyTradingService) GetTraderProfile(traderID string) (*TraderProfile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	profile, exists := s.traderProfiles[traderID]
	if !exists {
		return nil, errors.New("trader profile not found")
	}

	return profile, nil
}

// GetTraderLeaderboard returns top traders sorted by performance
func (s *CopyTradingService) GetTraderLeaderboard(limit int) []*TraderProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var profiles []*TraderProfile
	for _, profile := range s.traderProfiles {
		if profile.IsPublic {
			profiles = append(profiles, profile)
		}
	}

	// Sort by total profit
	for i := 0; i < len(profiles)-1; i++ {
		for j := i + 1; j < len(profiles); j++ {
			if profiles[j].TotalProfit > profiles[i].TotalProfit {
				profiles[i], profiles[j] = profiles[j], profiles[i]
			}
		}
	}

	if len(profiles) > limit {
		profiles = profiles[:limit]
	}

	return profiles
}

// StartCopying starts copying a trader
func (s *CopyTradingService) StartCopying(copierID, traderID string, amount, stopLoss, takeProfit float64) (*Copier, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	trader, exists := s.traderProfiles[traderID]
	if !exists {
		return nil, errors.New("trader not found")
	}

	if amount < trader.MinCopyAmount {
		return nil, fmt.Errorf("minimum copy amount is %.2f", trader.MinCopyAmount)
	}

	if trader.MaxCopyAmount > 0 && amount > trader.MaxCopyAmount {
		return nil, fmt.Errorf("maximum copy amount is %.2f", trader.MaxCopyAmount)
	}

	copier := &Copier{
		ID:               generateID(),
		UserID:           copierID,
		TraderID:         traderID,
		CopyAmount:       amount,
		CurrentProfit:    0,
		TotalProfit:      0,
		StopLossPercent:  stopLoss,
		TakeProfitPercent: takeProfit,
		IsActive:         true,
		AllocatedAmount:  amount,
		UsedAmount:       0,
		AvailableAmount:  amount,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	s.copies[copierID+"_"+traderID] = copier

	// Update trader stats
	trader.TotalCopiers++
	trader.TotalCopiedAmount += amount

	return copier, nil
}

// StopCopying stops copying a trader
func (s *CopyTradingService) StopCopying(copierID, traderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := copierID + "_" + traderID
	copier, exists := s.copies[key]
	if !exists {
		return errors.New("copy relation not found")
	}

	copier.IsActive = false

	// Return remaining funds to copier
	copier.AvailableAmount = copier.AllocatedAmount - copier.UsedAmount

	// Update trader stats
	if trader, exists := s.traderProfiles[traderID]; exists {
		trader.TotalCopiers--
		trader.TotalCopiedAmount -= copier.AllocatedAmount
	}

	return nil
}

// ProcessTraderOrder processes an order from a lead trader
func (s *CopyTradingService) ProcessTraderOrder(order *TraderOrder) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Find all copiers copying this trader
	var copierList []*Copier
	for _, copier := range s.copies {
		if copier.TraderID == order.TraderID && copier.IsActive {
			copierList = append(copierList, copier)
		}
	}

	if len(copierList) == 0 {
		return nil
	}

	// Create copy orders for each copier
	for _, copier := range copierList {
		// Calculate copy quantity based on allocated amount
		copyRatio := copier.AllocatedAmount / s.calculateTraderAllocation(order.TraderID)
		if copyRatio > 1 {
			copyRatio = 1
		}

		quantity := order.Quantity * copyRatio
		if quantity*order.Price > copier.AvailableAmount {
			quantity = copier.AvailableAmount / order.Price
		}

		if quantity <= 0 {
			continue
		}

		copyOrder := &CopyOrder{
			ID:              generateID(),
			CopierID:        copier.UserID,
			TraderID:        order.TraderID,
			OriginalOrderID: order.ID,
			Symbol:          order.Symbol,
			Side:            order.Side,
			OrderType:       order.OrderType,
			Price:           order.Price,
			Quantity:        quantity,
			FilledPrice:     order.Price,
			FillRatio:       1.0,
			Status:          order.Status,
			CreatedAt:       time.Now(),
		}

		s.copyOrders[copyOrder.ID] = copyOrder

		// Update copier balance
		copier.UsedAmount += quantity * order.Price
		copier.AvailableAmount = copier.AllocatedAmount - copier.UsedAmount

		// Emit event
		event := &CopyTradeEvent{
			ID:           generateID(),
			CopierID:     copier.UserID,
			TraderID:     order.TraderID,
			Symbol:       order.Symbol,
			Side:         order.Side,
			Price:        order.Price,
			Quantity:     quantity,
			Timestamp:    time.Now(),
		}

		select {
		case s.events <- event:
		default:
		}
	}

	return nil
}

// CloseCopyOrder closes a copy order with profit/loss
func (s *CopyTradingService) CloseCopyOrder(orderID string, exitPrice float64) (*CopyOrder, float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, exists := s.copyOrders[orderID]
	if !exists {
		return nil, 0, errors.New("copy order not found")
	}

	order.FilledPrice = exitPrice

	// Calculate profit/loss
	var profit float64
	if order.Side == "BUY" {
		profit = (exitPrice - order.Price) * order.Quantity
	} else {
		profit = (order.Price - exitPrice) * order.Quantity
	}

	// Update copier
	copierKey := order.CopierID + "_" + order.TraderID
	if copier, exists := s.copies[copierKey]; exists {
		copier.CurrentProfit += profit
		copier.TotalProfit += profit
		copier.UsedAmount -= order.Quantity * order.Price
		copier.AvailableAmount = copier.AllocatedAmount - copier.UsedAmount

		// Check stop loss / take profit
		profitPercent := (profit / copier.AllocatedAmount) * 100
		if profitPercent <= -copier.StopLossPercent || profitPercent >= copier.TakeProfitPercent {
			copier.IsActive = false
		}
	}

	now := time.Now()
	order.ClosedAt = &now
	order.Status = "CLOSED"

	// Update trader stats
	s.updateTraderStats(order.TraderID, profit)

	return order, profit, nil
}

// GetCopierPositions returns all copy positions for a user
func (s *CopyTradingService) GetCopierPositions(userID string) []*CopyOrder {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var positions []*CopyOrder
	for _, order := range s.copyOrders {
		if order.CopierID == userID && order.Status != "CLOSED" {
			positions = append(positions, order)
		}
	}

	return positions
}

// GetCopierCopying returns all traders a user is copying
func (s *CopyTradingService) GetCopierCopying(userID string) []*Copier {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var copierList []*Copier
	for _, copier := range s.copies {
		if copier.UserID == userID && copier.IsActive {
			copierList = append(copierList, copier)
		}
	}

	return copierList
}

// GetTraderCopiers returns all copiers copying a trader
func (s *CopyTradingService) GetTraderCopiers(traderID string) []*Copier {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var copierList []*Copier
	for _, copier := range s.copies {
		if copier.TraderID == traderID && copier.IsActive {
			copierList = append(copierList, copier)
		}
	}

	return copierList
}

// GetTraderStats returns detailed stats for a trader
func (s *CopyTradingService) GetTraderStats(traderID string, period string) (*TraderStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats, exists := s.traderStats[traderID+"_"+period]
	if !exists {
		return &TraderStats{
			TraderID: traderID,
			Period:   period,
		}, nil
	}

	return stats, nil
}

// CalculateTraderAllocation calculates total allocated to trader
func (s *CopyTradingService) calculateTraderAllocation(traderID string) float64 {
	var total float64
	for _, copier := range s.copies {
		if copier.TraderID == traderID && copier.IsActive {
			total += copier.AllocatedAmount
		}
	}
	return total
}

// UpdateTraderStats updates trader performance statistics
func (s *CopyTradingService) updateTraderStats(traderID string, profit float64) {
	key := traderID + "_ALL"
	stats, exists := s.traderStats[key]
	if !exists {
		stats = &TraderStats{
			TraderID: traderID,
			Period:   "ALL",
		}
		s.traderStats[key] = stats
	}

	stats.TotalTrades++
	stats.TotalProfit += profit

	if profit > 0 {
		stats.ProfitableTrades++
		stats.LargestWin = math.Max(stats.LargestWin, profit)
	} else {
		stats.LosingTrades++
		stats.LargestLoss = math.Min(stats.LargestLoss, profit)
	}

	stats.WinRate = float64(stats.ProfitableTrades) / float64(stats.TotalTrades) * 100

	if stats.ProfitableTrades > 0 {
		stats.AvgProfit = stats.TotalProfit / float64(stats.ProfitableTrades)
	}
	if stats.LosingTrades > 0 {
		avgLoss := stats.TotalProfit - (stats.AvgProfit * float64(stats.ProfitableTrades))
		stats.AvgLoss = avgLoss / float64(stats.LosingTrades)
	}

	// Update trader profile
	if profile, exists := s.traderProfiles[traderID]; exists {
		profile.TotalTrades++
		profile.TotalProfit += profit
		if profit > 0 {
			profile.WinRate = float64(profile.WinRate*float64(profile.TotalTrades-1)+100) / float64(profile.TotalTrades)
		} else {
			profile.WinRate = float64(profile.WinRate*float64(profile.TotalTrades-1)) / float64(profile.TotalTrades)
		}
	}
}

// SubscribeToTraderOrders subscribes to new orders from a trader
func (s *CopyTradingService) SubscribeToTraderOrders(traderID string) <-chan *TraderOrder {
	s.mu.Lock()
	defer s.mu.Unlock()

	orderChan := make(chan *TraderOrder, 100)

	// In real implementation, this would connect to a message broker
	// For now, we'll handle orders synchronously

	return orderChan
}

// UpdateTraderProfile updates trader profile settings
func (s *CopyTradingService) UpdateTraderProfile(traderID string, minCopy, maxCopy float64, isPublic bool, symbols []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, exists := s.traderProfiles[traderID]
	if !exists {
		return errors.New("trader profile not found")
	}

	profile.MinCopyAmount = minCopy
	profile.MaxCopyAmount = maxCopy
	profile.IsPublic = isPublic
	profile.AvailableSymbols = symbols
	profile.UpdatedAt = time.Now()

	return nil
}

// AddPerformanceData adds daily performance data
func (s *CopyTradingService) AddPerformanceData(traderID string, data DailyPerformance) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	profile, exists := s.traderProfiles[traderID]
	if !exists {
		return errors.New("trader profile not found")
	}

	profile.PerformanceData = append(profile.PerformanceData, data)

	// Keep only last 365 days
	if len(profile.PerformanceData) > 365 {
		profile.PerformanceData = profile.PerformanceData[len(profile.PerformanceData)-365:]
	}

	profile.MonthlyProfit = data.ProfitPercent
	profile.UpdatedAt = time.Now()

	return nil
}

func generateID() string {
	return fmt.Sprintf("CT_%d_%d", time.Now().UnixNano(), rand.Int63())
}
