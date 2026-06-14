package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// COPY TRADING
// Follow other traders' strategies with automatic position copying
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// Trader represents a strategy provider
type Trader struct {
	ID          string
	UserID      string
	Name        string
	Description string
	
	// Performance
	TotalPnL       float64
	WinRate       float64
	TotalTrades   int64
	FollowersCount int64
	AUM           float64 // Assets Under Management
	
	// Settings
	MaxFollowers int64
	MinCopyAmount float64
	FeePercent   float64
	
	Status       TraderStatus
	CreatedAt   time.Time
}

type TraderStatus string

const (
	TraderStatusActive  TraderStatus = "ACTIVE"
	TraderStatusPaused TraderStatus = "PAUSED"
	TraderStatusClosed TraderStatus = "CLOSED"
)

// Follower represents a follower
type Follower struct {
	ID          string
	TraderID   string
	UserID     string
	AllocatedAmount float64
	CopiedAmount   float64
	Status      FollowerStatus
	JoinedAt    time.Time
}

type FollowerStatus string

const (
	FollowerStatusActive  FollowerStatus = "ACTIVE"
	FollowerStatusPaused FollowerStatus = "PAUSED"
	FollowerStatusStopped FollowerStatus = "STOPPED"
)

// PositionCopy represents a copied position
type PositionCopy struct {
	ID            string
	FollowerID    string
	TraderOrderID string
	OriginalQty   float64
	CopiedQty     float64
	EntryPrice   float64
	CurrentPrice float64
	PnL          float64
	Status       PositionStatus
	OpenedAt     time.Time
	ClosedAt    *time.Time
}

type PositionStatus string

const (
	PositionStatusOpen   PositionStatus = "OPEN"
	PositionStatusClosed PositionStatus = "CLOSED"
)

// ============================================================================
// SERVICE
// ============================================================================

// Service manages copy trading
type Service struct {
	mu         sync.RWMutex
	traders    map[string]*Trader
	followers  map[string]*Follower
	positions map[string]*PositionCopy
	
	traderCounter  int64
	followerCounter int64
	positionCounter int64
}

// NewService creates copy trading service
func NewService() *Service {
	return &Service{
		traders:   make(map[string]*Trader),
		followers: make(map[string]*Follower),
		positions: make(map[string]*PositionCopy),
	}
}

// ============================================================================
// TRADER MANAGEMENT
// ============================================================================

// RegisterTrader registers a new strategy provider
func (s *Service) RegisterTrader(userID, name, description string, maxFollowers int64, minCopyAmount float64, feePercent float64) (*Trader, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.traderCounter++
	trader := &Trader{
		ID:             fmt.Sprintf("TRADER%d", s.traderCounter),
		UserID:         userID,
		Name:          name,
		Description:   description,
		MaxFollowers:   maxFollowers,
		MinCopyAmount: minCopyAmount,
		FeePercent:    feePercent,
		Status:       TraderStatusActive,
		CreatedAt:    time.Now(),
	}
	
	s.traders[trader.ID] = trader
	return trader, nil
}

// UpdateTraderPerformance updates trader performance
func (s *Service) UpdateTraderPerformance(traderID string, pnl float64, winRate float64, trades int64, aum float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	trader, ok := s.traders[traderID]
	if !ok {
		return fmt.Errorf("trader not found")
	}
	
	trader.TotalPnL = pnl
	trader.WinRate = winRate
	trader.TotalTrades = trades
	trader.AUM = aum
	
	return nil
}

// PauseTrader pauses a trader (no new followers)
func (s *Service) PauseTrader(traderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	trader, ok := s.traders[traderID]
	if !ok {
		return fmt.Errorf("trader not found")
	}
	
	trader.Status = TraderStatusPaused
	return nil
}

// ResumeTrader resumes a trader
func (s *Service) ResumeTrader(traderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	trader, ok := s.traders[traderID]
	if !ok {
		return fmt.Errorf("trader not found")
	}
	
	trader.Status = TraderStatusActive
	return nil
}

// ============================================================================
// FOLLOWER MANAGEMENT
// ============================================================================

// Follow follows a trader
func (s *Service) Follow(traderID, userID string, allocatedAmount float64) (*Follower, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Get trader
	trader, ok := s.traders[traderID]
	if !ok {
		return nil, fmt.Errorf("trader not found")
	}
	
	if trader.Status != TraderStatusActive {
		return nil, fmt.Errorf("trader not active")
	}
	
	// Check follower limit
	if trader.FollowersCount >= trader.MaxFollowers {
		return nil, fmt.Errorf("max followers reached")
	}
	
	// Check minimum
	if allocatedAmount < trader.MinCopyAmount {
		return nil, fmt.Errorf("below minimum copy amount: %.2f", trader.MinCopyAmount)
	}
	
	s.followerCounter++
	follower := &Follower{
		ID:               fmt.Sprintf("FOLLOWER%d", s.followerCounter),
		TraderID:        traderID,
		UserID:          userID,
		AllocatedAmount: allocatedAmount,
		Status:         FollowerStatusActive,
		JoinedAt:       time.Now(),
	}
	
	s.followers[follower.ID] = follower
	trader.FollowersCount++
	
	return follower, nil
}

// Unfollow stops following a trader
func (s *Service) Unfollow(followerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	follower, ok := s.followers[followerID]
	if !ok {
		return fmt.Errorf("follower not found")
	}
	
	// Close all open positions
	for _, pos := range s.positions {
		if pos.FollowerID == followerID && pos.Status == PositionStatusOpen {
			pos.Status = PositionStatusClosed
			now := time.Now()
			pos.ClosedAt = &now
		}
	}
	
	// Update trader
	trader, _ := s.traders[follower.TraderID]
	if trader != nil {
		trader.FollowersCount--
	}
	
	follower.Status = FollowerStatusStopped
	return nil
}

// ============================================================================
// POSITION COPYING
// ============================================================================

// CopyOrder copies a new order from trader
func (s *Service) CopyOrder(traderOrder *TraderOrder) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Get all active followers of this trader
	var followers []*Follower
	for _, f := range s.followers {
		if f.TraderID == traderOrder.TraderID && f.Status == FollowerStatusActive {
			followers = append(followers, f)
		}
	}
	
	if len(followers) == 0 {
		return nil
	}
	
	// Get trader
	trader, _ := s.traders[traderOrder.TraderID]
	
	// Copy to each follower
	for _, follower := range followers {
		// Calculate copy ratio
		ratio := follower.AllocatedAmount / trader.AUM
		if ratio > 1 {
			ratio = 1
		}
		
		copiedQty := traderOrder.Quantity * ratio
		
		// Check follower balance
		if copiedQty < follower.MinCopyAmount {
			continue
		}
		
		s.positionCounter++
		position := &PositionCopy{
			ID:            fmt.Sprintf("POS%d", s.positionCounter),
			FollowerID:    follower.ID,
			TraderOrderID: traderOrder.OrderID,
			OriginalQty:   traderOrder.Quantity,
			CopiedQty:     copiedQty,
			EntryPrice:   traderOrder.Price,
			CurrentPrice: traderOrder.Price,
			Status:       PositionStatusOpen,
			OpenedAt:     time.Now(),
		}
		
		s.positions[position.ID] = position
		follower.CopiedAmount += copiedQty
	}
	
	return nil
}

// UpdatePosition updates position PnL
func (s *Service) UpdatePosition(positionID string, currentPrice float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	position, ok := s.positions[positionID]
	if !ok || position.Status != PositionStatusOpen {
		return fmt.Errorf("position not found")
	}
	
	position.CurrentPrice = currentPrice
	position.PnL = (currentPrice - position.EntryPrice) * position.CopiedQty
	
	return nil
}

// ClosePosition closes a copied position
func (s *Service) ClosePosition(positionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	position, ok := s.positions[positionID]
	if !ok || position.Status != PositionStatusOpen {
		return fmt.Errorf("position not found")
	}
	
	position.Status = PositionStatusClosed
	now := time.Now()
	position.ClosedAt = &now
	
	// Update follower
	follower, _ := s.followers[position.FollowerID]
	if follower != nil {
		follower.CopiedAmount -= position.CopiedQty
	}
	
	return nil
}

// ============================================================================
// QUERIES
// ============================================================================

// GetTrendingTraders gets top performing traders
func (s *Service) GetTrendingTraders(limit int) []*Trader {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	// Sort by PnL
	type sortable struct {
		trader *Trader
		pnl    float64
	}
	
	var list []sortable
	for _, t := range s.traders {
		if t.Status == TraderStatusActive {
			list = append(list, sortable{t, t.TotalPnL})
		}
	}
	
	// Sort descending
	for i := 0; i < len(list)-1; i++ {
		for j := i + 1; j < len(list); j++ {
			if list[j].pnl > list[i].pnl {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	
	result := make([]*Trader, 0, limit)
	for i := 0; i < len(list) && i < limit; i++ {
		result = append(result, list[i].trader)
	}
	
	return result
}

// GetFollowerPositions gets follower's positions
func (s *Service) GetFollowerPositions(followerID string) []*PositionCopy {
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

// ============================================================================
// HELPER
// ============================================================================

type TraderOrder struct {
	OrderID   string
	TraderID  string
	Symbol   string
	Side     string
	Quantity float64
	Price    float64
}

func main() {
	fmt.Println("TigerEx Copy Trading v1.0.0")
	
	ct := NewService()
	
	// Register trader
	trader, _ := ct.RegisterTrader("user1", "Pro Trader", "Experienced BTC trader", 1000, 100, 20)
	
	fmt.Printf("Registered trader: %s\n", trader.ID)
	
	// Follow trader
	follower, _ := ct.Follow(trader.ID, "user2", 10000)
	
	fmt.Printf("Follower: %s\n", follower.ID)
	
	// Get trending
	trending := ct.GetTrendingTraders(10)
	fmt.Printf("Trending traders: %d\n", len(trending))
}