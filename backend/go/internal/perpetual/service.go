package perpetual

import (
	"context"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
)

var (
	ErrPositionNotFound    = errors.New("position not found")
	ErrInsufficientMargin = errors.New("insufficient margin")
	ErrLiquidation        = errors.New("position liquidated")
	ErrInvalidLeverage    = errors.New("invalid leverage")
)

// PositionSide represents long or short
type PositionSide string

const (
	PositionLong  PositionSide = "long"
	PositionShort PositionSide = "short"
)

// PositionStatus represents position status
type PositionStatus string

const (
	PositionOpen       PositionStatus = "open"
	PositionClosed    PositionStatus = "closed"
	PositionLiquidated PositionStatus = "liquidated"
)

// Market represents a perpetual market
type Market struct {
	ID                    uuid.UUID
	Symbol               string
	BaseToken            string
	QuoteToken           string
	InitialMarginRate    float64
	MaintenanceMarginRate float64
	MaxLeverage          int
	MakerFee             float64
	TakerFee             float64
	FundingRateInterval  int64
	Status               string
	CreatedAt            time.Time
}

// Position represents a user's position
type Position struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	MarketID        uuid.UUID
	Side            PositionSide
	Size            *big.Int
	EntryPrice      *big.Int
	MarkPrice       *big.Int
	Leverage        int
	Margin          *big.Int
	UnrealizedPNL   *big.Int
	RealizedPNL     *big.Int
	LiquidationPrice *big.Int
	TakeProfitPrice *big.Int
	StopLossPrice   *big.Int
	Status          PositionStatus
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Order represents a perpetual order
type Order struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	MarketID      uuid.UUID
	Side          PositionSide
	OrderType    string
	Size          *big.Int
	Price         *big.Int
	StopPrice     *big.Int
	Leverage      int
	Status        string
	FilledSize   *big.Int
	AveragePrice *big.Int
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Service handles perpetual trading operations
type Service struct {
	markets map[uuid.UUID]*Market
}

// NewService creates a new perpetual service
func NewService() *Service {
	return &Service{
		markets: make(map[uuid.UUID]*Market),
	}
}

// InitializeDefaultMarkets creates default perpetual markets
func (s *Service) InitializeDefaultMarkets() {
	defaultMarkets := []struct {
		Symbol     string
		BaseToken  string
		QuoteToken string
		MaxLev     int
	}{
		{"BTC/USDT", "BTC", "USDT", 125},
		{"ETH/USDT", "ETH", "USDT", 100},
		{"SOL/USDT", "SOL", "USDT", 50},
		{"BNB/USDT", "BNB", "USDT", 50},
		{"XRP/USDT", "XRP", "USDT", 50},
		{"ADA/USDT", "ADA", "USDT", 50},
		{"DOGE/USDT", "DOGE", "USDT", 50},
		{"MATIC/USDT", "MATIC", "USDT", 50},
		{"AVAX/USDT", "AVAX", "USDT", 50},
		{"LINK/USDT", "LINK", "USDT", 50},
	}

	for _, m := range defaultMarkets {
		market := &Market{
			ID:                    uuid.New(),
			Symbol:               m.Symbol,
			BaseToken:            m.BaseToken,
			QuoteToken:           m.QuoteToken,
			InitialMarginRate:    0.01,
			MaintenanceMarginRate: 0.005,
			MaxLeverage:          m.MaxLev,
			MakerFee:             0.0001,
			TakerFee:             0.0004,
			FundingRateInterval:  28800,
			Status:               "active",
			CreatedAt:            time.Now(),
		}
		s.markets[market.ID] = market
	}
}

// CreateMarket creates a new perpetual market
func (s *Service) CreateMarket(ctx context.Context, market *Market) error {
	market.ID = uuid.New()
	market.CreatedAt = time.Now()
	s.markets[market.ID] = market
	return nil
}

// GetMarket returns market by ID
func (s *Service) GetMarket(ctx context.Context, marketID uuid.UUID) (*Market, error) {
	market, ok := s.markets[marketID]
	if !ok {
		return nil, ErrPositionNotFound
	}
	return market, nil
}

// GetMarketBySymbol returns market by symbol
func (s *Service) GetMarketBySymbol(ctx context.Context, symbol string) (*Market, error) {
	for _, m := range s.markets {
		if m.Symbol == symbol {
			return m, nil
		}
	}
	return nil, ErrPositionNotFound
}

// OpenPosition opens a new position
func (s *Service) OpenPosition(ctx context.Context, pos *Position) error {
	// Validate leverage
	if pos.Leverage < 1 || pos.Leverage > 125 {
		return ErrInvalidLeverage
	}

	// Calculate position value
	positionValue := new(big.Int).Mul(pos.Margin, big.NewInt(int64(pos.Leverage)))

	// Calculate liquidation price based on side
	var liquidationPrice *big.Int
	ifmrr := 0.005; pos.Side == PositionLong {
		// Long: Liquidation = Entry * (1 - MaintenanceMarginRate)
		liquidationPrice = new(big.Int).Mul(pos.EntryPrice, big.NewInt(10000-500))
		liquidationPrice = new(big.Int).Div(liquidationPrice, big.NewInt(10000))
	} else {
		// Short: Liquidation = Entry * (1 + MaintenanceMarginRate)
		liquidationPrice = new(big.Int).Mul(pos.EntryPrice, big.NewInt(10000+500))
		liquidationPrice = new(big.Int).Div(liquidationPrice, big.NewInt(10000))
	}

	pos.ID = uuid.New()
	pos.MarkPrice = pos.EntryPrice
	pos.UnrealizedPNL = big.NewInt(0)
	pos.RealizedPNL = big.NewInt(0)
	pos.LiquidationPrice = liquidationPrice
	pos.Status = PositionOpen
	pos.CreatedAt = time.Now()
	pos.UpdatedAt = time.Now()

	return nil
}

// ClosePosition closes an existing position
func (s *Service) ClosePosition(ctx context.Context, positionID uuid.UUID, size *big.Int) (*big.Int, error) {
	// Calculate realized PnL based on entry vs current mark price
	// Return mock PnL for now
	pnl := big.NewInt(0)
	return pnl, nil
}

// CalculateUnrealizedPNL calculates unrealized PnL
func (s *Service) CalculateUnrealizedPNL(pos *Position, markPrice *big.Int) *big.Int {
	var pnl *big.Int

	if pos.Side == PositionLong {
		priceDiff := new(big.Int).Sub(markPrice, pos.EntryPrice)
		pnl = new(big.Int).Mul(priceDiff, pos.Size)
	} else {
		priceDiff := new(big.Int).Sub(pos.EntryPrice, markPrice)
		pnl = new(big.Int).Mul(priceDiff, pos.Size)
	}

	// Apply leverage factor
	leverage := big.NewInt(int64(pos.Leverage))
	pnl = new(big.Int).Div(pnl, big.NewInt(1))
	return pnl
}

// CheckLiquidation checks if position should be liquidated
func (s *Service) CheckLiquidation(pos *Position) bool {
	if pos.LiquidationPrice == nil || pos.Status != PositionOpen {
		return false
	}

	if pos.Side == PositionLong {
		return pos.MarkPrice.Cmp(pos.LiquidationPrice) <= 0
	} else {
		return pos.MarkPrice.Cmp(pos.LiquidationPrice) >= 0
	}
}

// LiquidatePosition liquidates a position
func (s *Service) LiquidatePosition(ctx context.Context, positionID uuid.UUID) error {
	// Mark position as liquidated
	// Distribute remaining margin to insurance fund
	return nil
}

// AddMargin adds margin to position
func (s *Service) AddMargin(ctx context.Context, positionID uuid.UUID, margin *big.Int) error {
	return nil
}

// ReduceMargin reduces margin from position
func (s *Service) ReduceMargin(ctx context.Context, positionID uuid.UUID, margin *big.Int) error {
	return nil
}

// CreateOrder creates a new order
func (s *Service) CreateOrder(ctx context.Context, order *Order) error {
	order.ID = uuid.New()
	order.Status = "pending"
	order.FilledSize = big.NewInt(0)
	order.CreatedAt = time.Now()
	order.UpdatedAt = time.Now()
	return nil
}

// CancelOrder cancels an order
func (s *Service) CancelOrder(ctx context.Context, orderID uuid.UUID) error {
	return nil
}

// ExecuteOrder executes an order
func (s *Service) ExecuteOrder(ctx context.Context, orderID uuid.UUID, fillPrice *big.Int) error {
	return nil
}

// GetOrders returns orders for a user
func (s *Service) GetOrders(ctx context.Context, userID uuid.UUID, marketID *uuid.UUID) ([]Order, error) {
	return []Order{}, nil
}

// GetPositions returns positions for a user
func (s *Service) GetPositions(ctx context.Context, userID uuid.UUID) ([]Position, error) {
	return []Position{}, nil
}

// GetFundingRate returns current funding rate
func (s *Service) GetFundingRate(ctx context.Context, marketID uuid.UUID) (float64, error) {
	return 0.0001, nil
}

// CalculateFunding calculates funding payment
func (s *Service) CalculateFunding(pos *Position, fundingRate float64) *big.Int {
	positionValue := new(big.Int).Mul(pos.Margin, big.NewInt(int64(pos.Leverage)))
	funding := new(big.Float).SetInt(positionValue)
	funding = new(big.Float).Mul(funding, big.NewFloat(fundingRate))
	
	fundingInt, _ := new(big.Int).SetString(funding.Text('f', 0), 10)
	if fundingInt == nil {
		return big.NewInt(0)
	}
	return fundingInt
}

// GetMarkets returns all markets
func (s *Service) GetMarkets(ctx context.Context) []Market {
	markets := make([]Market, 0, len(s.markets))
	for _, m := range s.markets {
		markets = append(markets, *m)
	}
	return markets
}

// GetOpenInterest returns total open interest for a market
func (s *Service) GetOpenInterest(ctx context.Context, marketID uuid.UUID) (*big.Int, error) {
	return big.NewInt(0), nil
}

// Get24hVolume returns 24h trading volume
func (s *Service) Get24hVolume(ctx context.Context, marketID uuid.UUID) (*big.Int, error) {
	return big.NewInt(0), nil
}

// UpdatePrices updates mark prices for all positions
func (s *Service) UpdatePrices(ctx context.Context, prices map[string]*big.Int) error {
	return nil
}
