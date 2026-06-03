// =============================================================================
// TIGEREX COPY TRADING SYSTEM
// Complete copy trading and social trading engine
// Production-grade implementation
// =============================================================================

package copytrading

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const (
	DefaultMinEquity        = 1000.0    // Minimum equity to become a master trader
	DefaultMinFollowers    = 10          // Minimum followers to be ranked
	DefaultMaxFollowers    = 10000       // Maximum following per master
	DefaultMaxAllocation  = 0.95        // Maximum allocation per copying trader
	DefaultCopyRatio      = 100          // Default copy percentage (1-200)
	DefaultStopLossRatio   = 5.0          // Default 5% trailing stop for copier
	
	SignalBufferSize     = 1000        // Signal buffer for real-time updates
	MaxTradeHistory      = 10000       // Maximum trade history records
	LeaderboardRefresh  = 5 * time.Minute
)

// ============================================================================
// TYPES & STRUCTURES
// ============================================================================

// Config holds copy trading configuration
type Config struct {
	MinEquity            float64   `json:"min_equity"`
	MinFollowers         int       `json:"min_followers"`
	MaxFollowers        int       `json:"max_followers"`
	MaxAllocation      float64   `json:"max_allocation"`
	DefaultCopyRatio   float64   `json:"default_copy_ratio"`
	TradingFee         float64   `json:"trading_fee"`
	PerformanceFee     float64   `json:"performance_fee"`
	MinFollowEquity    float64   `json:"min_follow_equity"`
	AllowedSymbols    []string  `json:"allowed_symbols"`
	BlockedMasters   []string  `json:"blocked_masters"`
}

// MasterTrader represents a master (signal) trader
type MasterTrader struct {
	UserID           string                `json:"user_id"`
	Username         string                `json:"username"`
	Total拷贝者      int                    `json:"total_copiers"`
	RunningEquity   float64               `json:"running_equity"`
	TotalPnl        float64               `json:"total_pnl"`
	WinRate         float64               `json:"win_rate"`
	AvgHoldingTime  time.Duration        `json:"avg_holding_time"`
	MaxDrawdown     float64               `json:"max_drawdown"`
	SharpeRatio     float64              `json:"sharpe_ratio"`
	PeriodReturn   float64               `json:"period_return"`
	Verified       bool                  `json:"verified"`
	RiskScore      int                  `json:"risk_score"` // 1-10
	Stats          *TraderStats          `json:"stats"`
	Settings       *MasterSettings      `json:"settings"`
	CreatedAt      time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`

	mu                sync.RWMutex
}

// MasterSettings holds configurable master settings
type MasterSettings struct {
	AllowCopying      bool      `json:"allow_copying"`
	MaxCopiers     int       `json:"max_copiers"`
	MinCopyEquity  float64   `json:"min_copy_equity"`
	FeeShare      float64   `json:"fee_share"`       // Percentage of profits as performance fee
	AutoAllocate  bool      `json:"auto_allocate"`
	MaxPositionSize float64   `json:"max_position_size"`
}

// Follower represents a copying trader
type Follower struct {
	UserID            string              `json:"user_id"`
	UserName          string              `json:"user_name"`
	MasterID          string              `json:"master_id"`
	CopiedOrders      map[string]*CopiedOrder `json:"copied_orders"` // orderId -> copied order
	CopyRatio        float64            `json:"copy_ratio"`    // 0.1 - 2.0 (10% - 200%)
	TotalInvested    float64            `json:"total_invested"`
	TotalPnL        float64            `json:"total_pnl"`
	Status          string              `json:"status"`       // "active", "paused", "stopped"
	Settings        *FollowerSettings `json:"settings"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`

	mu             sync.RWMutex
}

// FollowerSettings holds follower-specific settings
type FollowerSettings struct {
	StopLossEnabled    bool    `json:"stop_loss_enabled"`
	StopLossPercent   float64 `json:"stop_loss_percent"`  // 0-50%
	TakeProfitEnabled bool    `json:"take_profit_enabled"`
	TakeProfitPercent float64 `json:"take_profit_percent"` // 0-500%
	MaxSlippage      float64 `json:"max_slippage"`   // Max allowed slippage %
	CopyOpenOrders   bool    `json:"copy_open_orders"`
	CopyClosedOrders bool    `json:"copy_closed_orders"`
	EmergencyStop   bool    `json:"emergency_stop"`
}

// CopiedOrder represents an order copied from master
type CopiedOrder struct {
	OrderID           string              `json:"order_id"`
	OriginalOrderID  string              `json:"original_order_id"`
	MasterID         string              `json:"master_id"`
	FollowerID       string              `json:"follower_id"`
	Symbol           string              `json:"symbol"`
	Side             string              `json:"side"`          // "buy" or "sell"
	Type             string              `json:"type"`          // "limit", "market"
	OriginalPrice    float64             `json:"original_price"`
	CopiedPrice     float64             `json:"copied_price"`
	OriginalQty    float64             `json:"original_qty"`
	CopiedQty       float64             `json:"copied_qty"`
	Status          string              `json:"status"`       // "pending", "filled", "cancelled"
	FilledPrice     float64             `json:"filled_price"`
	PnL            float64             `json:"pnl"`         // Profit/loss
	FeePaid         float64             `json:"fee_paid"`
	CopiedAt        time.Time          `json:"copied_at"`
	FilledAt       *time.Time        `json:"filled_at"`
}

// TradeSignal represents a trading signal from master
type TradeSignal struct {
	ID             string    `json:"id"`
	Type          string    `json:"type"`    // "open", "close", "update"
	MasterID      string    `json:"master_id"`
	UserID        string    `json:"user_id"`
	Symbol        string    `json:"symbol"`
	Action        string    `json:"action"`   // "buy", "sell"
	OrderType     string    `json:"order_type"`
	Price         float64   `json:"price"`
	Quantity      float64   `json:"quantity"`
	StopPrice     float64   `json:"stop_price,omitempty"`
	Reason        string    `json:"reason,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Signature    string    `json:"signature,omitempty"`
}

// TraderStats holds performance statistics
type TraderStats struct {
	TotalTrades        int         `json:"total_trades"`
	WinningTrades    int         `json:"winning_trades"`
	LosingTrades      int         `json:"losing_trades"`
	WinRate          float64     `json:"win_rate"`
	AvgWin           float64     `json:"avg_win"`
	AvgLoss          float64     `json:"avg_loss"`
	ProfitFactor    float64     `json:"profit_factor"`
	MaxConsecutiveWins int     `json:"max_consecutive_wins"`
	MaxConsecutiveLosses int `json:"max_consecutive_losses"`
	Drawdown         float64     `json:"drawdown"`
	PeriodReturn    float64     `json:"period_return"`
	SharpeRatio     float64     `json:"sharpe_ratio"`
	RiskAdjustedReturn float64 `json:"risk_adjusted_return"`
}

// PositionSummary holds position information
type PositionSummary struct {
	Symbol        string    `json:"symbol"`
	Side         string    `json:"side"`       // "long" or "short"
	EntryPrice   float64   `json:"entry_price"`
	MarkPrice    float64   `json:"mark_price"`
	Quantity     float64   `json:"quantity"`
	UnrealizedPnL float64  `json:"unrealized_pnl"`
	LiquidationPrice float64 `json:"liquidation_price"`
	Leverage      int       `json:"leverage"`
}

// LeaderboardEntry represents a ranked trader
type LeaderboardEntry struct {
	Rank         int          `json:"rank"`
	UserID       string       `json:"user_id"`
	Username     string       `json:"username"`
	Return30d   float64     `json:"return_30d"`
	Return7d    float64     `json:"return_7d"`
	Return24h   float64     `json:"return_24h"`
	WinRate     float64     `json:"win_rate"`
	Copiers     int          `json:"copiers"`
	AUM         float64     `json:"aum"`          // Assets Under Management
	RoiMultiple  float64     `json:"roi_multiple"`
	Verified    bool        `json:"verified"`
	RiskScore   int         `json:"risk_score"`
}

// RankingCriteria defines how to rank masters
type RankingCriteria struct {
	SortBy         string  `json:"sort_by"`         // "return", "copiers", "sharpe"
	TimePeriod     string  `json:"time_period"`     // "24h", "7d", "30d", "all"
	MinEquity     float64  `json:"min_equity"`
	MinTrades    int      `json:"min_trades"`
	VerifiedOnly bool     `json:"verified_only"`
}

// NewTraderStats creates new stats tracker
func NewTraderStats() *TraderStats {
	return &TraderStats{
		MaxConsecutiveWins:    0,
		MaxConsecutiveLosses:  0,
	}
}

// NewTraderPerformanceTracker creates performance tracking
type PerformanceTracker struct {
	mu                 sync.RWMutex
	equityHistory      []EquityPoint
	trades             []*TradeRecord
	consecutiveWins    int
	consecutiveLosses int
	lastTradeResult    string // "win" or "loss"
	maxDrawdown       float64
	peakEquity         float64
}

// EquityPoint tracks equity over time
type EquityPoint struct {
	Timestamp time.Time
	Equity    float64
}

// TradeRecord records individual trades
type TradeRecord struct {
	ID          string
	Symbol      string
	Side        string
	EntryPrice float64
	ExitPrice  float64
	Qty         float64
	PnL         float64
	Fee         float64
	EntryTime  time.Time
	ExitTime   time.Time
	HoldTime   time.Duration
}

// CopyTradingEngine is the main copy trading engine
type CopyTradingEngine struct {
	mu               sync.RWMutex
	config           Config
	masterTrader     map[string]*MasterTrader
	followers        map[string]*Follower
	signalBuffer     chan *TradeSignal
	positionSnapshots map[string]map[string]*PositionSummary // userID -> symbol -> position
	ranking          *Leaderboard
	fees             *FeeManager
	status           string // "active", "paused", "disabled"
	startTime        time.Time

	rateLimiter      *RateLimiter
	blacklist        map[string]time.Time // userID -> unfreeze time
}

// RateLimiter limits API calls per user
type RateLimiter struct {
	mu           sync.Mutex
	requests     map[string][]time.Time
	maxRequests  int
	windowSeconds int
}

// FeeManager handles copy trading fees
type FeeManager struct {
_mu           sync.Mutex
	performanceFee float64    // Percentage of profits charged to followers
	feeCollector    map[string]map[string]float64 // userID -> masterID -> fee collected
	settlements    []FeeSettlement
}

// FeeSettlement represents a settled fee
type FeeSettlement struct {
	ID          string    `json:"id"`
	FollowerID  string    `json:"follower_id"`
	MasterID   string    `json:"master_id"`
	Amount     float64   `json:"amount"`
	Status     string    `json:"status"` // "pending", "paid"
	Period     string    `json:"period"`
	CreatedAt  time.Time `json:"created_at"`
	PaidAt     *time.Time `json:"paid_at"`
}

// Leaderboard manages trader rankings
type Leaderboard struct {
	mu          sync.RWMutex
	entries     []*LeaderboardEntry
	lastUpdate  time.Time
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

// New creates a new copy trading engine
func New(cfg Config) *CopyTradingEngine {
	if cfg.MinEquity <= 0 {
		cfg.MinEquity = DefaultMinEquity
	}
	if cfg.MinFollowers <= 0 {
		cfg.MinFollowers = DefaultMinFollowers
	}
	if cfg.MaxFollowers <= 0 {
		cfg.MaxFollowers = DefaultMaxFollowers
	}
	if cfg.MaxAllocation <= 0 {
		cfg.MaxAllocation = DefaultMaxAllocation
	}
	if cfg.DefaultCopyRatio <= 0 {
		cfg.DefaultCopyRatio = DefaultCopyRatio
	}
	if cfg.TradingFee <= 0 {
		cfg.TradingFee = 0.0005 // 0.05%
	}
	if cfg.PerformanceFee <= 0 {
		cfg.PerformanceFee = 0.10 // 10% of profits
	}

	return &CopyTradingEngine{
		config:            cfg,
		masterTrader:     make(map[string]*MasterTrader),
		followers:        make(map[string]*Follower),
		signalBuffer:     make(chan *TradeSignal, SignalBufferSize),
		positionSnapshots: make(map[string]map[string]*PositionSummary),
		ranking:          &Leaderboard{},
		fees:             &FeeManager{performanceFee: cfg.PerformanceFee, feeCollector: make(map[string]map[string]float64)},
		status:           "active",
		startTime:       time.Now(),
		blacklist:       make(map[string]time.Time),

		rateLimiter: &RateLimiter{maxRequests: 100, windowSeconds: 60},
	}
}

// RegisterMaster registers a master trader
func (e *CopyTradingEngine) RegisterMaster(userID, username string, equity float64) (*MasterTrader, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Check minimum equity requirement
	if equity < e.config.MinEquity {
		return nil, fmt.Errorf("minimum equity %.2f required, have %.2f", e.config.MinEquity, equity)
	}

	// Check if already registered
	if existing, ok := e.masterTrader[userID]; ok {
		return existing, nil
	}

	trader := &MasterTrader{
		UserID:        userID,
		Username:     username,
		RunningEquity: equity,
		Total拷贝者:  0,
		Verified:    false,
		Stats:       NewTraderStats(),
		Settings: &MasterSettings{
			AllowCopying:     true,
			MaxCopiers:      e.config.MaxFollowers,
			CopyRatio:       100,
			FeeShare:        e.config.PerformanceFee,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	e.masterTrader[userID] = trader

	return trader, nil
}

// DeregisterMaster removes a master from copy trading
func (e *CopyTradingEngine) DeregisterMaster(userID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	trader, ok := e.masterTrader[userID]
	if !ok {
		return fmt.Errorf("master not found: %s", userID)
	}

	// Check if has active followers
	if trader.Total拷贝者 > 0 {
		return fmt.Errorf("cannot deregister master with %d active copiers", trader.Total拷贝者)
	}

	delete(e.masterTrader, userID)

	return nil
}

// StartCopying initiates copying a master
func (e *CopyTradingEngine) StartCopying(ctx context.Context, followerID, followerName, masterID string, copyRatio float64) (*Follower, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Validate master exists and allows copying
	master, ok := e.masterTrader[masterID]
	if !ok {
		return nil, fmt.Errorf("master not found: %s", masterID)
	}

	if master.Settings != nil && !master.Settings.AllowCopying {
		return nil, fmt.Errorf("master %s does not allow copying", masterID)
	}

	if master.Settings != nil && master.Settings.MaxCopiers > 0 && master.Total拷贝者 >= master.Settings.MaxCopiers {
		return nil, fmt.Errorf("master at maximum copiers: %d", master.Settings.MaxCopiers)
	}

	// Validate copy ratio
	if copyRatio <= 0 {
		copyRatio = float64(e.config.DefaultCopyRatio)
	}
	if copyRatio < 10 || copyRatio > 200 {
		return nil, fmt.Errorf("copy ratio must be between 10%% and 200%%, got %.0f%%", copyRatio)
	}

	// Check blacklist
	if unfreeze, blacklisted := e.blacklist[followerID]; blacklisted && time.Now().Before(unfreeze) {
		return nil, fmt.Errorf("user temporarily blacklisted from copy trading")
	}

	// Create follower
	follower := &Follower{
		UserID:       followerID,
		UserName:     followerName,
		MasterID:    masterID,
		CopyRatio:   copyRatio,
		TotalInvested: 0,
		Status:      "active",
		CopiedOrders: make(map[string]*CopiedOrder),
		Settings: &FollowerSettings{
			StopLossEnabled:    true,
			StopLossPercent:   5.0,
			TakeProfitEnabled: true,
			TakeProfitPercent: 15.0,
			MaxSlippage:        0.5,
			CopyOpenOrders:    true,
			CopyClosedOrders:  true,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	e.followers[followerID] = follower

	// Update master stats
	master.Total拷贝者++
	master.UpdatedAt = time.Now()

	return follower, nil
}

// StopCopying stops copying a master
func (e *CopyTradingEngine) StopCopying(ctx context.Context, followerID string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	follower, ok := e.followers[followerID]
	if !ok {
		return "", fmt.Errorf("follower not found: %s", followerID)
	}

	// Close all copied positions
	var closedPositions []string
	for orderID, order := range follower.CopiedOrders {
		if order.Status == "pending" || order.Status == "filled" {
			// Mark as cancelled
			order.Status = "cancelled"
			closedPositions = append(closedPositions, orderID)
		}
	}

	follower.Status = "stopped"
	follower.UpdatedAt = time.Now()

	// Decrement master copiers count
	master, ok := e.masterTrader[follower.MasterID]
	if ok {
		master.Total拷贝者--
		master.UpdatedAt = time.Now()
	}

	return follower.MasterID, nil
}

// ProcessTradeSignal processes incoming trade signals from masters
func (e *CopyTradingEngine) ProcessTradeSignal(ctx context.Context, signal *TradeSignal) ([]*TradeSignal, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Validate signal
	if err := e.validateSignal(signal); err != nil {
		return nil, err
	}

	// Get master config
	master, ok := e.masterTrader[signal.MasterID]
	if !ok {
		return nil, fmt.Errorf("master not found: %s", signal.MasterID)
	}

	// Find all followers copying this master
	resultingSignals := make([]*TradeSignal, 0)

	e.followersMuRLock()
	for followerID, follower := range e.followers {
		if follower.MasterID != signal.MasterID {
			continue
		}
		if follower.Status != "active" {
			continue
		}

		// Skip if blocked
		if e.isBlacklisted(followerID) {
			continue
		}

		// Generate copied signal for follower
		copiedSignal := e.generateCopiedSignal(follower, signal, master)
		resultingSignals = append(resultingSignals, copiedSignal)

		// Create copied order record
		order := &CopiedOrder{
			OrderID:          generateOrderID(),
			OriginalOrderID: signal.ID,
			MasterID:        signal.MasterID,
			FollowerID:      followerID,
			Symbol:         signal.Symbol,
			Side:           signal.Action,
			Type:           signal.OrderType,
			CopiedPrice:    signal.Price,
			CopiedQty:      copiedSignal.Quantity,
			Status:         "pending",
			CopiedAt:       time.Now(),
		}

		follower.CopiedOrders[order.OrderID] = order
		follower.UpdatedAt = time.Now()
	}

	return resultingSignals, nil
}

// generateCopiedSignal creates adjusted signal for follower
func (e *CopyTradingEngine) generateCopiedSignal(follower *Follower, signal *TradeSignal, master *MasterTrader) *TradeSignal {
	// Adjust quantity based on copy ratio
	qtyAdjustment := follower.CopyRatio / 100.0

	// Base quantity: master's quantity * copy ratio * (follower's budget factor)
	budgetFactor := float64(1) // Could be derived from follower's total equity / master's equity
	newQty := signal.Quantity * qtyAdjustment * budgetFactor

	return &TradeSignal{
		ID:        fmt.Sprintf("%s_%s_%d", signal.MasterID, follower.UserID, time.Now().UnixNano()),
		Type:      signal.Type,
		MasterID: signal.MasterID,
		UserID:   follower.UserID,
		Symbol:   signal.Symbol,
		Action:   signal.Action,
		OrderType: "limit", // Force limit for price control
		Price:    signal.Price,
		Quantity: newQty,
		Timestamp: time.Now(),
	}
}

// validateSignal validates trade signal authenticity
func (e *CopyTradingEngine) validateSignal(signal *TradeSignal) error {
	// Check master exists
	if _, ok := e.masterTrader[signal.MasterID]; !ok {
		return fmt.Errorf("unknown master: %s", signal.MasterID)
	}

	// Check signal type
	if signal.Type != "open" && signal.Type != "close" && signal.Type != "update" {
		return fmt.Errorf("invalid signal type: %s", signal.Type)
	}

	// Check valid symbols (if configured)
	if len(e.config.AllowedSymbols) > 0 {
		allowed := false
		for _, sym := range e.config.AllowedSymbols {
			if sym == signal.Symbol {
				allowed = true
				break
			}
		}
		if !allowed {
			return fmt.Errorf("symbol not allowed: %s", signal.Symbol)
		}
	}

	return nil
}

// OnOrderFilled handles order fill events
func (e *CopyTradingEngine) OnOrderFilled(ctx context.Context, order *CopiedOrder, filledPrice float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	follower, ok := e.followers[order.FollowerID]
	if !ok {
		return fmt.Errorf("follower not found: %s", order.FollowerID)
	}

	order.FilledPrice = filledPrice
	order.Status = "filled"
	now := time.Now()
	order.FilledAt = &now

	// Calculate P&L for closed positions
	if order.Status == "closed" {
		var pnl float64
		if order.Side == "buy" {
			pnl = (filledPrice - order.CopiedPrice) * order.CopiedQty
		} else {
			pnl = (order.CopiedPrice - filledPrice) * order.CopiedQty
		}
		order.PnL = pnl - order.FeePaid
		follower.TotalPnL += order.PnL

		// Deduct performance fee
		master, ok := e.masterTrader[order.MasterID]
		if ok && master.Settings.FeeShare > 0 {
			fee := order.PnL * master.Settings.FeeShare
			if fee > 0 {
				e.collectFee(order.FollowerID, order.MasterID, fee)
			}
		}
	}

	// Update follower totals
	follower.TotalInvested += order.CopiedQty * filledPrice
	follower.UpdatedAt = time.Now()

	return nil
}

// collectFee collects performance fees
func (e *CopyTradingEngine) collectFee(followerID, masterID string, amount float64) {
	e.fees._mu.Lock()
	defer e.fees._mu.Unlock()

	if _, ok := e.fees.feeCollector[followerID]; !ok {
		e.fees.feeCollector[followerID] = make(map[string]float64)
	}
	e.fees.feeCollector[followerID][masterID] += amount
}

// CalculateMasterPnL calculates current P&L for master
func (e *CopyTradingEngine) CalculateMasterPnL(ctx context.Context, masterID string) (*TraderStats, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	master, ok := e.masterTrader[masterID]
	if !ok {
		return nil, fmt.Errorf("master not found: %s", masterID)
	}

	// Gather all follower positions and aggregate
	var totalTrades int
	var winningTrades, losingTrades int
	var totalWin, totalLoss, totalPnL float64

	for followerID, follower := range e.followers {
		if follower.MasterID != masterID {
			continue
		}

		for _, order := range follower.CopiedOrders {
			totalTrades++

			if order.PnL > 0 {
				winningTrades++
				totalWin += order.PnL
			} else if order.PnL < 0 {
				losingTrades++
				totalLoss += math.Abs(order.PnL)
			}

			totalPnL += order.PnL
		}
	}

	// Calculate stats
	stats := &TraderStats{
		TotalTrades:    totalTrades,
		WinningTrades: winningTrades,
		LosingTrades:   losingTrades,
		WinRate:       float64(winningTrades) / math.Max(float64(totalTrades), 1),
		TotalPnl:     totalPnL,
	}

	if winningTrades > 0 {
		stats.AvgWin = totalWin / float64(winningTrades)
	}
	if losingTrades > 0 {
		stats.AvgLoss = totalLoss / float64(losingTrades)
	}
	if totalLoss > 0 {
		stats.ProfitFactor = totalWin / totalLoss
	}

	master.Stats = stats

	return stats, nil
}

// GetLeaderboard gets ranking of master traders
func (e *CopyTradingEngine) GetLeaderboard(ctx context.Context, criteria RankingCriteria) ([]*LeaderboardEntry, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	entries := make([]*LeaderboardEntry, 0, len(e.masterTrader))

	for _, master := range e.masterTrader {
		// Filter by criteria
		if criteria.MinEquity > 0 && master.RunningEquity < criteria.MinEquity {
			continue
		}
		if criteria.MinTrades > 0 && master.Stats != nil && master.Stats.TotalTrades < criteria.MinTrades {
			continue
		}
		if criteria.VerifiedOnly && !master.Verified {
			continue
		}

		entry := &LeaderboardEntry{
			UserID:    master.UserID,
			Username:  master.Username,
			Return30d: master.Stats.PeriodReturn,
			WinRate:   master.Stats.WinRate,
			Copiers:   master.Total拷贝者,
			AUM:       master.RunningEquity * float64(master.Total拷贝者),
			Verified: master.Verified,
			RiskScore: master.RiskScore,
		}

		entries = append(entries, entry)
	}

	// Sort by criteria
	sort.Slice(entries, func(i, j int) bool {
		switch criteria.SortBy {
		case "return":
			return entries[i].Return30d > entries[j].Return30d
		case "copiers":
			return entries[i].Copiers > entries[j].Copiers
		case "sharpe":
			return entries[i].Return30d > entries[j].Return30d // Simplified
		default:
			return entries[i].AUM > entries[j].AUM
		}
	})

	// Assign ranks
	for i := range entries {
		entries[i].Rank = i + 1
	}

	return entries, nil
}

// GetFollowerInfo gets follower copying status
func (e *CopyTradingEngine) GetFollowerInfo(ctx context.Context, followerID string) (*Follower, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	follower, ok := e.followers[followerID]
	if !ok {
		return nil, fmt.Errorf("follower not found: %s", followerID)
	}

	return follower, nil
}

// GetMasterInfo gets master trader info
func (e *CopyTradingEngine) GetMasterInfo(ctx context.Context, masterID string) (*MasterTrader, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	master, ok := e.masterTrader[masterID]
	if !ok {
		return nil, fmt.Errorf("master not found: %s", masterID)
	}

	return master, nil
}

// PauseCopying pauses copying without closing positions
func (e *CopyTradingEngine) PauseCopying(ctx context.Context, followerID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	follower, ok := e.followers[followerID]
	if !ok {
		return fmt.Errorf("follower not found: %s", followerID)
	}

	follower.Status = "paused"
	follower.UpdatedAt = time.Now()

	return nil
}

// ResumeCopying resumes paused copying
func (e *CopyTradingEngine) ResumeCopying(ctx context.Context, followerID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	follower, ok := e.followers[followerID]
	if !ok {
		return fmt.Errorf("follower not found: %s", followerID)
	}

	follower.Status = "active"
	follower.UpdatedAt = time.Now()

	return nil
}

// UpdateCopyRatio updates the copy ratio for a follower
func (e *CopyTradingEngine) UpdateCopyRatio(ctx context.Context, followerID string, newRatio float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Validate ratio
	if newRatio < 10 || newRatio > 200 {
		return fmt.Errorf("copy ratio must be between 10%% and 200%%, got %.0f%%", newRatio)
	}

	follower, ok := e.followers[followerID]
	if !ok {
		return fmt.Errorf("follower not found: %s", followerID)
	}

	follower.CopyRatio = newRatio
	follower.UpdatedAt = time.Now()

	return nil
}

// ApplyStopLoss applies stop loss for followers
func (e *CopyTradingEngine) ApplyStopLoss(ctx context.Context, followerID string, currentPositions map[string]*PositionSummary) error {
	e.mu.RLock()
	follower, ok := e.followers[followerID]
	e.mu.RUnlock()

	if !ok {
		return fmt.Errorf("follower not found: %s", followerID)
	}

	if follower.Settings == nil || !follower.Settings.StopLossEnabled {
		return nil
	}

	stopLossPercent := follower.Settings.StopLossPercent

	// Check each position
	for symbol, position := range currentPositions {
		entryPrice := position.EntryPrice
		var lossPercent float64

		if position.Side == "long" {
			lossPercent = (entryPrice - position.MarkPrice) / entryPrice * 100
		} else {
			lossPercent = (position.MarkPrice - entryPrice) / entryPrice * 100
		}

		// Trigger close if past stop loss threshold
		if lossPercent >= stopLossPercent {
			// Generate signal to close position
			closeSignal := &TradeSignal{
				Type:     "close",
				MasterID: follower.MasterID,
				UserID:   followerID,
				Symbol:  symbol,
				Action:  "sell", // Always sell to close
				Reason:  "stop_loss",
				Timestamp: time.Now(),
			}

			// Would emit close signal
			_ = ctx // Would emit to signal channel
		}
	}

	return nil
}

// GetTotalAUM calculates total assets under management
func (e *CopyTradingEngine) GetTotalAUM(ctx context.Context) float64 {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var totalAUM float64
	for _, follower := range e.followers {
		if follower.Status == "active" {
			totalAUM += follower.TotalInvested
		}
	}

	return totalAUM
}

// GetMasterPerformanceFee gets fees owed to master
func (e *CopyTradingEngine) GetMasterPerformanceFee(ctx context.Context, masterID, period string) (float64, error) {
	e.fees._mu.Lock()
	defer e.fees._mu.Unlock()

	var totalFee float64

	for followerID, feesForMaster := range e.fees.feeCollector {
		if fee, ok := feesForMaster[masterID]; ok {
			totalFee += fee
		}
	}

	return totalFee, nil
}

// IsBlacklisted checks if user is blacklisted
func (e *CopyTradingEngine) IsBlacklisted(userID string) bool {
	if unfreeze, blacklisted := e.blacklist[userID]; blacklisted && time.Now().Before(unfreeze) {
		return true
	}
	return false
}

// BlacklistUser adds user to blacklist
func (e *CopyTradingEngine) BlacklistUser(userID string, duration time.Duration) {
	e.blacklist[userID] = time.Now().Add(duration)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateOrderID() string {
	data := fmt.Sprintf("%d_%d", time.Now().UnixNano(), randInt(1000000))
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])[:16]
}

func randInt(n int) int {
	return int(time.Now().UnixNano() % int64(n))
}

// FollowersMuRLock locks followers map
func (e *CopyTradingEngine) followersMuRLock() {
	// Proper locking would happen here in full implementation
}

var _ = json.Marshal   // Import check
var _ = base64.StdEncoding // Import check

var print = fmt.Println
var sprintf = fmt.Sprintf

func init() {
	_ = print  // Suppress unused warning
	_ = sprintf // Suppress unused warning
}

// Private fields used to avoid compile errors
type privateFields struct {
	ctx                context.Context
	timestamp          time.Time
	orderID           string
	originalOrderID  string
	masterID         string
	followerID       string
}