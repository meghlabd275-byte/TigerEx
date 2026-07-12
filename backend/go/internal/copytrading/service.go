package copytrading

import (
	"context"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
)

var (
	ErrTraderNotFound    = errors.New("trader not found")
	ErrFollowerNotFound = errors.New("follower not found")
	ErrInsufficientCopyBalance = errors.New("insufficient copy balance")
	ErrTraderNotActive   = errors.New("trader is not active")
)

// Trader represents a copy trading signal provider
type Trader struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	TotalTrades     int64
	WinRate         float64
	TotalPNL        *big.Int
	FollowersCount  int64
	TotalAUM        *big.Int
	IsVerified      bool
	IsActive        bool
	PerformanceData string // JSON string of historical performance
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Follower represents a user copying a trader
type Follower struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	TraderID       uuid.UUID
	Allocation     *big.Int // Total allocation for this trader
	CopiedPositions []CopiedPosition
	CopyRatio       float64 // 0.1 to 1.0
	IsActive        bool
	CreatedAt      time.Time
	UpdatedAt       time.Time
}

// CopiedPosition represents a copied position
type CopiedPosition struct {
	ID              uuid.UUID
	FollowerID      uuid.UUID
	OriginalOrderID uuid.UUID
	CopiedOrderID   uuid.UUID
	Size            *big.Int
	EntryPrice      *big.Int
	CurrentPrice    *big.Int
	UnrealizedPNL   *big.Int
	RealizedPNL     *big.Int
	Status          string
	CreatedAt       time.Time
	ClosedAt        *time.Time
}

// CopySettings represents copy trading settings
type CopySettings struct {
	FollowerID      uuid.UUID
	MaxAllocation   *big.Int
	MaxOpenPositions int
	StopLossPercent float64
	TakeProfitPercent float64
	AutoCopyNewTrades bool
}

// Service handles copy trading operations
type Service struct {
	traders  map[uuid.UUID]*Trader
	followers map[uuid.UUID]*Follower
}

// NewService creates a new copy trading service
func NewService() *Service {
	return &Service{
		traders:  make(map[uuid.UUID]*Trader),
		followers: make(map[uuid.UUID]*Follower),
	}
}

// RegisterAsTrader registers a user as a copy trading signal provider
func (s *Service) RegisterAsTrader(ctx context.Context, userID uuid.UUID) (*Trader, error) {
	trader := &Trader{
		ID:             uuid.New(),
		UserID:         userID,
		TotalTrades:    0,
		WinRate:        0,
		TotalPNL:       big.NewInt(0),
		FollowersCount: 0,
		TotalAUM:       big.NewInt(0),
		IsVerified:     false,
		IsActive:       true,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	s.traders[trader.ID] = trader
	return trader, nil
}

// GetTrader returns trader by ID
func (s *Service) GetTrader(ctx context.Context, traderID uuid.UUID) (*Trader, error) {
	trader, ok := s.traders[traderID]
	if !ok {
		return nil, ErrTraderNotFound
	}
	return trader, nil
}

// GetTraderByUser returns trader by user ID
func (s *Service) GetTraderByUser(ctx context.Context, userID uuid.UUID) (*Trader, error) {
	for _, t := range s.traders {
		if t.UserID == userID {
			return t, nil
		}
	}
	return nil, ErrTraderNotFound
}

// GetTopTraders returns top performing traders
func (s *Service) GetTopTraders(ctx context.Context, limit int) ([]Trader, error) {
	traders := make([]Trader, 0)
	for _, t := range s.traders {
		if t.IsActive {
			traders = append(traders, *t)
		}
	}
	// Sort by TotalPNL descending
	// Return top 'limit' traders
	if len(traders) > limit {
		traders = traders[:limit]
	}
	return traders, nil
}

// FollowTrader starts copying a trader
func (s *Service) FollowTrader(ctx context.Context, userID, traderID uuid.UUID, allocation *big.Int, copyRatio float64) (*Follower, error) {
	// Validate trader exists and is active
	trader, ok := s.traders[traderID]
	if !ok {
		return nil, ErrTraderNotFound
	}
	if !trader.IsActive {
		return nil, ErrTraderNotActive
	}

	follower := &Follower{
		ID:          uuid.New(),
		UserID:      userID,
		TraderID:    traderID,
		Allocation: allocation,
		CopyRatio:  copyRatio,
		IsActive:   true,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	s.followers[follower.ID] = follower
	
	// Update trader stats
	trader.FollowersCount++
	trader.TotalAUM.Add(trader.TotalAUM, allocation)

	return follower, nil
}

// UnfollowTrader stops copying a trader
func (s *Service) UnfollowTrader(ctx context.Context, followerID uuid.UUID) error {
	follower, ok := s.followers[followerID]
	if !ok {
		return ErrFollowerNotFound
	}

	// Close all copied positions
	for i := range follower.CopiedPositions {
		follower.CopiedPositions[i].Status = "closed"
		now := time.Now()
		follower.CopiedPositions[i].ClosedAt = &now
	}

	// Update trader stats
	if trader, ok := s.traders[follower.TraderID]; ok {
		trader.FollowersCount--
		trader.TotalAUM.Sub(trader.TotalAUM, follower.Allocation)
	}

	follower.IsActive = false
	return nil
}

// CopyTrade copies a trade from trader to followers
func (s *Service) CopyTrade(ctx context.Context, traderID uuid.UUID, order *struct {
	ID        uuid.UUID
	Size      *big.Int
	Price     *big.Int
	Side      string
	MarketID  uuid.UUID
}) error {
	trader, ok := s.traders[traderID]
	if !ok || !trader.IsActive {
		return ErrTraderNotFound
	}

	// Find all active followers
	for _, follower := range s.followers {
		if !follower.IsActive || follower.TraderID != traderID {
			continue
		}

		// Calculate copied size based on allocation and copy ratio
		copiedSize := new(big.Int).Mul(order.Size, big.NewInt(int64(follower.CopyRatio*1000)))
		copiedSize = new(big.Int).Div(copiedSize, big.NewInt(1000))

		// Create copied position
		copiedPos := CopiedPosition{
			ID:            uuid.New(),
			FollowerID:    follower.ID,
			OriginalOrderID: order.ID,
			Size:         copiedSize,
			EntryPrice:   order.Price,
			CurrentPrice: order.Price,
			UnrealizedPNL: big.NewInt(0),
			RealizedPNL:  big.NewInt(0),
			Status:       "open",
			CreatedAt:    time.Now(),
		}
		follower.CopiedPositions = append(follower.CopiedPositions, copiedPos)
	}

	// Update trader stats
	trader.TotalTrades++
	return nil
}

// UpdateCopiedPosition updates a copied position with current price
func (s *Service) UpdateCopiedPosition(ctx context.Context, followerID uuid.UUID, positionID uuid.UUID, currentPrice *big.Int) error {
	follower, ok := s.followers[followerID]
	if !ok {
		return ErrFollowerNotFound
	}

	for i := range follower.CopiedPositions {
		if follower.CopiedPositions[i].ID == positionID {
			follower.CopiedPositions[i].CurrentPrice = currentPrice
			// Calculate unrealized PnL
			priceDiff := new(big.Int).Sub(currentPrice, follower.CopiedPositions[i].EntryPrice)
			follower.CopiedPositions[i].UnrealizedPNL = new(big.Int).Mul(priceDiff, follower.CopiedPositions[i].Size)
			return nil
		}
	}

	return ErrFollowerNotFound
}

// CloseCopiedPosition closes a copied position
func (s *Service) CloseCopiedPosition(ctx context.Context, followerID uuid.UUID, positionID uuid.UUID, exitPrice *big.Int) (*big.Int, error) {
	follower, ok := s.followers[followerID]
	if !ok {
		return nil, ErrFollowerNotFound
	}

	for i := range follower.CopiedPositions {
		if follower.CopiedPositions[i].ID == positionID {
			// Calculate realized PnL
			priceDiff := new(big.Int).Sub(exitPrice, follower.CopiedPositions[i].EntryPrice)
			realizedPNL := new(big.Int).Mul(priceDiff, follower.CopiedPositions[i].Size)
			
			follower.CopiedPositions[i].CurrentPrice = exitPrice
			follower.CopiedPositions[i].RealizedPNL = realizedPNL
			follower.CopiedPositions[i].Status = "closed"
			now := time.Now()
			follower.CopiedPositions[i].ClosedAt = &now

			return realizedPNL, nil
		}
	}

	return nil, ErrFollowerNotFound
}

// GetFollowers returns all followers of a trader
func (s *Service) GetFollowers(ctx context.Context, traderID uuid.UUID) ([]Follower, error) {
	followers := make([]Follower, 0)
	for _, f := range s.followers {
		if f.TraderID == traderID && f.IsActive {
			followers = append(followers, *f)
		}
	}
	return followers, nil
}

// GetFollowerPositions returns all positions for a follower
func (s *Service) GetFollowerPositions(ctx context.Context, followerID uuid.UUID) ([]CopiedPosition, error) {
	follower, ok := s.followers[followerID]
	if !ok {
		return nil, ErrFollowerNotFound
	}
	return follower.CopiedPositions, nil
}

// UpdateTraderPerformance updates trader performance data
func (s *Service) UpdateTraderPerformance(ctx context.Context, traderID uuid.UUID, pnl *big.Int, isWin bool) error {
	trader, ok := s.traders[traderID]
	if !ok {
		return ErrTraderNotFound
	}

	trader.TotalTrades++
	trader.TotalPNL.Add(trader.TotalPNL, pnl)

	// Update win rate
	if isWin {
		currentWins := float64(trader.TotalTrades-1) * trader.WinRate
		trader.WinRate = (currentWins + 1) / float64(trader.TotalTrades)
	} else {
		currentWins := float64(trader.TotalTrades-1) * trader.WinRate
		trader.WinRate = currentWins / float64(trader.TotalTrades)
	}

	trader.UpdatedAt = time.Now()
	return nil
}

// GetAllTraders returns all traders
func (s *Service) GetAllTraders(ctx context.Context) ([]Trader, error) {
	traders := make([]Trader, 0, len(s.traders))
	for _, t := range s.traders {
		traders = append(traders, *t)
	}
	return traders, nil
}

// GetAllFollowers returns all followers
func (s *Service) GetAllFollowers(ctx context.Context) ([]Follower, error) {
	followers := make([]Follower, 0, len(s.followers))
	for _, f := range s.followers {
		followers = append(followers, *f)
	}
	return followers, nil
}
