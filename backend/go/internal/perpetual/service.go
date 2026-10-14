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
	ErrServiceUnavailable = errors.New("perpetual trading requires a configured durable matching and risk engine")
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
// Static seed markets are intentionally disabled; markets must come from the authoritative market registry.
}

// CreateMarket creates a new perpetual market
func (s *Service) CreateMarket(ctx context.Context, market *Market) error {
// Do not accept a market until it can be persisted in the canonical market registry.
	return ErrServiceUnavailable
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
// Position opening must atomically reserve collateral, validate risk and submit to the matching engine.
	return ErrServiceUnavailable
}

// ClosePosition closes an existing position
func (s *Service) ClosePosition(ctx context.Context, positionID uuid.UUID, size *big.Int) (*big.Int, error) {
// Never fabricate PnL or report a close before matching and ledger settlement complete.
	return nil, ErrServiceUnavailable
}

// CalculateUnrealizedPNL calculates unrealized PnL
func (s *Service) CalculateUnrealizedPNL(pos *Position, markPrice *big.Int) *big.Int {
	if pos == nil || markPrice == nil || pos.EntryPrice == nil || pos.Size == nil {
		return nil
	}

	var priceDiff *big.Int
	if pos.Side == PositionLong {
		priceDiff = new(big.Int).Sub(markPrice, pos.EntryPrice)
	} else if pos.Side == PositionShort {
		priceDiff = new(big.Int).Sub(pos.EntryPrice, markPrice)
	} else {
		return nil
	}
	return new(big.Int).Mul(priceDiff, pos.Size)
}

// CheckLiquidation checks if position should be liquidated
func (s *Service) CheckLiquidation(pos *Position) bool {
	if pos == nil || pos.LiquidationPrice == nil || pos.MarkPrice == nil || pos.Status != PositionOpen {
		return false
	}

	if pos.Side == PositionLong {
		return pos.MarkPrice.Cmp(pos.LiquidationPrice) <= 0
	}
	if pos.Side == PositionShort {
		return pos.MarkPrice.Cmp(pos.LiquidationPrice) >= 0
	}
	return false
}

// LiquidatePosition liquidates a position
func (s *Service) LiquidatePosition(ctx context.Context, positionID uuid.UUID) error {
return ErrServiceUnavailable
}

// AddMargin adds margin to position
func (s *Service) AddMargin(ctx context.Context, positionID uuid.UUID, margin *big.Int) error {
return ErrServiceUnavailable
}

// ReduceMargin reduces margin from position
func (s *Service) ReduceMargin(ctx context.Context, positionID uuid.UUID, margin *big.Int) error {
return ErrServiceUnavailable
}

// CreateOrder creates a new order
func (s *Service) CreateOrder(ctx context.Context, order *Order) error {
return ErrServiceUnavailable
}

// CancelOrder cancels an order
func (s *Service) CancelOrder(ctx context.Context, orderID uuid.UUID) error {
return ErrServiceUnavailable
}

// ExecuteOrder executes an order
func (s *Service) ExecuteOrder(ctx context.Context, orderID uuid.UUID, fillPrice *big.Int) error {
return ErrServiceUnavailable
}

// GetOrders returns orders for a user
func (s *Service) GetOrders(ctx context.Context, userID uuid.UUID, marketID *uuid.UUID) ([]Order, error) {
return nil, ErrServiceUnavailable
}

// GetPositions returns positions for a user
func (s *Service) GetPositions(ctx context.Context, userID uuid.UUID) ([]Position, error) {
return nil, ErrServiceUnavailable
}

// GetFundingRate returns current funding rate
func (s *Service) GetFundingRate(ctx context.Context, marketID uuid.UUID) (float64, error) {
return 0, ErrServiceUnavailable
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
// No durable market registry is configured.
	return []Market{}
}

// GetOpenInterest returns total open interest for a market
func (s *Service) GetOpenInterest(ctx context.Context, marketID uuid.UUID) (*big.Int, error) {
return nil, ErrServiceUnavailable
}

// Get24hVolume returns 24h trading volume
func (s *Service) Get24hVolume(ctx context.Context, marketID uuid.UUID) (*big.Int, error) {
return nil, ErrServiceUnavailable
}

// UpdatePrices updates mark prices for all positions
func (s *Service) UpdatePrices(ctx context.Context, prices map[string]*big.Int) error {
return ErrServiceUnavailable
}
