package copy

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// COPY TRADING SERVICE
// Mirror trading from traders to followers
// =============================================================================

// Trader represents a master trader
type Trader struct {
	UserID         string    `json:"userId"`
	Rank           int       `json:"rank"`
	TotalPnL       float64   `json:"totalPnl"`
	WinRate        float64   `json:"winRate"`
	Followers      int64     `json:"followers"`
	AUM            float64   `json:"aum"` // Assets Under Management
	CopyCapacity   float64   `json:"copyCapacity"` // Max copy amount
	IsProfilePublic bool      `json:"isProfilePublic"`
	VerifiedTrader bool     `json:"verifiedTrader"`
	Bio            string   `json:"bio"`
	Strategies    []string  `json:"strategies"`
}

// Follower represents a follower
type Follower struct {
	UserID        string    `json:"userId"`
	TraderID     string    `json:"traderId"`
	Allocated    float64   `json:"allocated"`
	AllocatedUSD float64   `json:"allocatedUsd"`
	CopyRatio    float64   `json:"copyRatio"` // % of trader position to copy
	Type         string    `json:"type"` // FIXED, RATIO
	Status      string    `json:"status"` // ACTIVE, PAUSED, STOPPED
}

// Signal represents a trading signal
type Signal struct {
	ID          string    `json:"id"`
	TraderID   string    `json:"traderId"`
	Symbol     string    `json:"symbol"`
	Side       string    `json:"side"` // BUY, SELL
	OrderType  string    `json:"orderType"` // LIMIT, MARKET
	Price      float64   `json:"price"`
	Quantity   float64   `json:"quantity"`
	StopLoss   float64   `json:"stopLoss,omitempty"`
	TakeProfit float64   `json:"takeProfit,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
}

// PositionCopy represents copied position
type PositionCopy struct {
	ID            string    `json:"id"`
	SignalID      string    `json:"signalId"`
	FollowerID    string    `json:"followerId"`
	OrderID      string    `json:"orderId"`
	OriginalID   string    `json:"originalId"` // Original order from trader
	Symbol       string    `json:"symbol"`
	Side         string    `json:"side"`
	Quantity    float64   `json:"quantity"`
	EntryPrice  float64   `json:"entryPrice"`
	IsClosed    bool      `json:"isClosed"`
	PnL         float64   `json:"pnl"`
	OpenedAt    time.Time `json:"openedAt"`
	ClosedAt    *time.Time `json:"closedAt,omitempty"`
}

// Service copy trading service
type Service struct {
	mu sync.RWMutex

	// Traders
	traders map[string]*Trader
	userTrader map[string]bool // userID -> isTrader

	// Followers
	followers map[string]*Follower
	followersByTrader map[string]map[string]*Follower // traderID -> map[followerID]Follower

	// Signals
	activeSignals map[string]*Signal
	signalsByTrader map[string][]*Signal // traderID -> signals
	signalHistory []*Signal

	// Positions
	positions map[string]*PositionCopy

	// Config
	MaxSignalAge time.Duration
	MinAllocation float64
	MaxFollowers int
}

// NewService creates copy trading service
func NewService() *Service {
	return &Service{
		traders:            make(map[string]*Trader),
		userTrader:        make(map[string]bool),
		followers:        make(map[string]*Follower),
		followersByTrader:  make(map[string]map[string]*Follower),
		activeSignals:     make(map[string]*Signal),
		signalsByTrader:  make(map[string][]*Signal),
		positions:       make(map[string]*PositionCopy),
		MaxSignalAge:    5 * time.Minute,
		MinAllocation:   100.0,
		MaxFollowers:    10000,
	}
}

// RegisterAsTrader registers user as trader
func (s *Service) RegisterAsTrader(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.userTrader[userID] {
		return fmt.Errorf("already a trader")
	}

	trader := &Trader{
		UserID:           userID,
		IsProfilePublic:   false,
		VerifiedTrader:  false,
	}

	s.traders[userID] = trader
	s.userTrader[userID] = true

	return nil
}

// SetTraderBio sets trader bio
func (s *Service) SetTraderBio(userID, bio string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	trader, ok := s.traders[userID]
	if !ok {
		return fmt.Errorf("not a trader")
	}

	trader.Bio = bio

	return nil
}

// PublishSignal publishes trading signal
func (s *Service) PublishSignal(signal *Signal) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Verify trader
	if !s.userTrader[signal.TraderID] {
		return fmt.Errorf("not a verified trader")
	}

	// Validate signal
	if signal.Symbol == "" || (signal.Side != "BUY" && signal.Side != "SELL") {
		return fmt.Errorf("invalid signal")
	}

	// Clean old signals
	s.cleanOldSignals()

	s.activeSignals[signal.ID] = signal
	s.signalHistory = append(s.signalHistory, signal)

	traderSignals := s.signalsByTrader[signal.TraderID]
	if traderSignals == nil {
		traderSignals = make([]*Signal, 0)
	}
	traderSignals = append(traderSignals, signal)
	s.signalsByTrader[signal.TraderID] = traderSignals

	return nil
}

// Follow follows a trader
func (s *Service) Follow(followerID, traderID string, allocated float64, copyRatio float64, copyType string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Verify trader exists
	if !s.userTrader[traderID] {
		return fmt.Errorf("trader not found")
	}

	// Check allocation
	if allocated < s.MinAllocation {
		return fmt.Errorf("minimum allocation: %.2f", s.MinAllocation)
	}

	// Check trader capacity
	trader := s.traders[traderID]
	if trader.CopyCapacity > 0 && allocated > trader.CopyCapacity {
		return fmt.Errorf("exceeds trader copy capacity")
	}

	// Check follower count
	if len(s.followersByTrader[traderID]) >= s.MaxFollowers {
		return fmt.Errorf("max followers reached")
	}

	// Create follower
	follower := &Follower{
		UserID:    followerID,
		TraderID:  traderID,
		Allocated: allocated,
		Type:     copyType,
		CopyRatio: copyRatio,
		Status:   "ACTIVE",
	}

	key := fmt.Sprintf("%s-%s", traderID, followerID)
	s.followers[key] = follower

	if s.followersByTrader[traderID] == nil {
		s.followersByTrader[traderID] = make(map[string]*Follower)
	}
	s.followersByTrader[traderID][key] = follower

	return nil
}

// Unfollow unfollows a trader
func (s *Service) Unfollow(followerID, traderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s-%s", traderID, followerID)
	if _, ok := s.followers[key]; !ok {
		return fmt.Errorf("not following")
	}

	delete(s.followers, key)
	delete(s.followersByTrader[traderID], key)

	return nil
}

// GetActiveSignals gets active signals from trader
func (s *Service) GetActiveSignals(traderID string) []*Signal {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.signalsByTrader[traderID]
}

// GetFollowedTraders gets traders followed by user
func (s *Service) GetFollowedTraders(userID string) []*Trader {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Trader
	for _, f := range s.followers {
		if f.UserID == userID && f.Status == "ACTIVE" {
			if t, ok := s.traders[f.TraderID]; ok {
				result = append(result, t)
			}
		}
	}

	return result
}

// GetCopyPositions gets copy positions
func (s *Service) GetCopyPositions(followerID string) []*PositionCopy {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*PositionCopy
	for _, p := range s.positions {
		if p.FollowerID == followerID {
			result = append(result, p)
		}
	}

	return result
}

// CalculatePnL calculates P&L
func (s *Service) CalculatePnL(followerID string) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var totalPnL float64
	for _, p := range s.positions {
		if p.FollowerID == followerID && p.IsClosed {
			totalPnL += p.PnL
		}
	}

	return totalPnL
}

// cleanOldSignals cleans old signals
func (s *Service) cleanOldSignals() {
	cutoff := time.Now().Add(-s.MaxSignalAge)

	for id, signal := range s.activeSignals {
		if signal.Timestamp.Before(cutoff) {
			delete(s.activeSignals, id)
		}
	}
}

// PauseFollow pauses following
func (s *Service) PauseFollow(followerID, traderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s-%s", traderID, followerID)
	follower, ok := s.followers[key]
	if !ok {
		return fmt.Errorf("not following")
	}

	follower.Status = "PAUSED"

	return nil
}

// ResumeFollow resumes following
func (s *Service) ResumeFollow(followerID, traderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s-%s", traderID, followerID)
	follower, ok := s.followers[key]
	if !ok {
		return fmt.Errorf("not following")
	}

	follower.Status = "ACTIVE"

	return nil
}

// UpdateAllocation updates allocated amount
func (s *Service) UpdateAllocation(followerID, traderID string, newAmount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if newAmount < s.MinAllocation {
		return fmt.Errorf("minimum allocation: %.2f", s.MinAllocation)
	}

	key := fmt.Sprintf("%s-%s", traderID, followerID)
	follower, ok := s.followers[key]
	if !ok {
		return fmt.Errorf("not following")
	}

	follower.Allocated = newAmount

	return nil
}