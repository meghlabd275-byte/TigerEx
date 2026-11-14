// Package trading provides trading services
package trading

import (
	"context"
	"errors"
	"math"
	"strings"

	"tigerex/backend/internal/api"
	"tigerex/backend/internal/exchange"
)

var (
	ErrInvalidSymbol          = errors.New("invalid symbol")
	ErrInvalidOrder           = errors.New("invalid order")
	ErrNoLiquidity            = errors.New("no liquidity")
	ErrTradingPaused          = errors.New("trading paused")
	ErrMarketDataUnavailable  = errors.New("market data provider is not configured")
	ErrPersistenceUnavailable = errors.New("durable trading persistence is not configured")
)

// Config holds trading configuration
type Config struct {
}

// OrderRequest represents an order request
type OrderRequest struct {
	UserID           string
	Symbol           string
	Side             string
	Type             string
	Quantity         float64
	Price            float64
	StopPrice        float64
	TimeInForce      string
	ClientOrderID    string
	TrailingDistance float64
	ReduceOnly       bool
}

// StakeRequest represents a stake request
type StakeRequest struct {
	UserID    string
	Asset     string
	Amount    float64
	ProductID string
	Compound  bool
}

// UnstakeRequest represents an unstake request
type UnstakeRequest struct {
	UserID     string
	PositionID string
	Amount     float64
}

// Service handles trading operations.
type Service struct {
	config Config
	store  *exchange.Store
}

// NewService creates a new trading service. Without a store every market-data
// and order call fails closed.
func NewService(config Config) *Service {
	return &Service{config: config}
}

// WithStore attaches the durable PostgreSQL data layer. When set, market data,
// orders, balances and custody reads and writes go to the database instead of
// returning "unavailable".
func (s *Service) WithStore(store *exchange.Store) *Service {
	s.store = store
	return s
}

// Store returns the attached data layer, or nil when unconfigured.
func (s *Service) Store() *exchange.Store {
	return s.store
}

// GetMarkets returns every tradable market. With no store configured it returns
// an empty list rather than advertising hard-coded or illustrative instruments.
func (s *Service) GetMarkets(ctx context.Context) []api.Market {
	markets, err := s.ListMarkets(ctx)
	if err != nil {
		return nil
	}
	return markets
}

// ListMarkets returns every tradable market, or an error when the market
// repository is unreachable so the caller can report unavailable rather than an
// empty exchange.
func (s *Service) ListMarkets(ctx context.Context) ([]api.Market, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrMarketDataUnavailable
	}
	return s.store.ListMarkets(ctx)
}

// GetTicker retrieves 24-hour ticker data for a symbol from the trade tape.
func (s *Service) GetTicker(ctx context.Context, symbol string) (*api.Ticker, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, ErrInvalidSymbol
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrMarketDataUnavailable
	}
	return s.store.Ticker24h(ctx, symbol)
}

// GetOrderBookDepth retrieves order book depth.
func (s *Service) GetOrderBookDepth(ctx context.Context, symbol string, limit int) (*api.OrderBook, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, ErrInvalidSymbol
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 1000 {
		return nil, ErrInvalidOrder
	}
	if s.store == nil {
		return nil, ErrMarketDataUnavailable
	}
	return s.store.OrderBook(ctx, symbol, limit)
}

// GetRecentTrades retrieves recent trades from durable market-data storage.
func (s *Service) GetRecentTrades(ctx context.Context, symbol string, limit int, fromID int64) ([]api.Trade, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, ErrInvalidSymbol
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrMarketDataUnavailable
	}
	return s.store.RecentTrades(ctx, symbol, limit, fromID)
}

// GetKlines retrieves kline/candlestick data
func (s *Service) GetKlines(ctx context.Context, symbol, interval string, startTime, endTime int64, limit int) ([]api.KLine, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, ErrInvalidSymbol
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrMarketDataUnavailable
	}
	return s.store.Klines(ctx, symbol, interval, startTime, endTime, limit)
}

// GetExchangeInfo reports live exchange metadata from storage. When the store is
// unavailable it reports a degraded status rather than a frozen symbol list.
func (s *Service) GetExchangeInfo(ctx context.Context) *api.ExchangeInfo {
	if s.store == nil {
		return &api.ExchangeInfo{
			Timezone:       "UTC",
			ServerTime:     api.Now(),
			ExchangeStatus: "degraded",
			Symbols:        nil,
		}
	}
	info, err := s.store.ExchangeInfo(ctx)
	if err != nil {
		return &api.ExchangeInfo{
			Timezone:       "UTC",
			ServerTime:     api.Now(),
			ExchangeStatus: "degraded",
			Symbols:        nil,
		}
	}
	return info
}

// CreateOrder validates request shape but refuses execution until live market metadata,
// durable order storage, a matching engine, and an atomic ledger are wired in.
// Returning an order here would falsely imply that it was accepted or persisted.
func (s *Service) CreateOrder(ctx context.Context, req *OrderRequest) (*api.Order, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.UserID) == "" || strings.TrimSpace(req.Symbol) == "" {
		return nil, ErrInvalidOrder
	}
	if req.Quantity <= 0 || math.IsNaN(req.Quantity) || math.IsInf(req.Quantity, 0) {
		return nil, ErrInvalidOrder
	}
	side := strings.ToLower(strings.TrimSpace(req.Side))
	if side != "buy" && side != "sell" {
		return nil, ErrInvalidOrder
	}
	orderType := strings.ToLower(strings.TrimSpace(req.Type))
	switch orderType {
	case "market":
	case "limit":
		if req.Price <= 0 || math.IsNaN(req.Price) || math.IsInf(req.Price, 0) {
			return nil, ErrInvalidOrder
		}
	case "stop_loss":
		if req.StopPrice <= 0 || math.IsNaN(req.StopPrice) || math.IsInf(req.StopPrice, 0) {
			return nil, ErrInvalidOrder
		}
	case "stop_limit":
		if req.Price <= 0 || req.StopPrice <= 0 || math.IsNaN(req.Price) || math.IsInf(req.Price, 0) || math.IsNaN(req.StopPrice) || math.IsInf(req.StopPrice, 0) {
			return nil, ErrInvalidOrder
		}
	case "trailing_stop":
		if req.TrailingDistance <= 0 || math.IsNaN(req.TrailingDistance) || math.IsInf(req.TrailingDistance, 0) {
			return nil, ErrInvalidOrder
		}
	default:
		return nil, ErrInvalidOrder
	}
	if s.store == nil {
		return nil, ErrTradingPaused
	}
	// Persist the order and reserve its funds in one transaction. Matching is the
	// canonical engine's job; this never fabricates a fill.
	return s.store.PlaceOrder(ctx, &exchange.OrderRequest{
		UserID:        req.UserID,
		Symbol:        req.Symbol,
		Side:          side,
		Type:          orderType,
		Quantity:      req.Quantity,
		Price:         req.Price,
		StopPrice:     req.StopPrice,
		TimeInForce:   req.TimeInForce,
		ClientOrderID: req.ClientOrderID,
		ReduceOnly:    req.ReduceOnly,
	})
}

// getMarket retrieves market by symbol
func (s *Service) getMarket(symbol string) *api.Market {
	markets := s.GetMarkets(context.Background())
	for i := range markets {
		if markets[i].Symbol == symbol {
			return &markets[i]
		}
	}
	return nil
}

// roundToStep rounds a value to the step size
func (s *Service) roundToStep(value, step float64) float64 {
	if step <= 0 {
		return value
	}
	return math.Floor(value/step+0.5) * step
}

// GetOrders retrieves orders from durable storage.
func (s *Service) GetOrders(ctx context.Context, userID, symbol, side, status string, limit int, fromID string) ([]api.Order, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrPersistenceUnavailable
	}
	return s.store.GetOrders(ctx, userID, symbol, side, status, limit)
}

// GetOrder retrieves a single order from durable storage.
func (s *Service) GetOrder(ctx context.Context, userID, orderID string) (*api.Order, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(orderID) == "" {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrPersistenceUnavailable
	}
	return s.store.GetOrder(ctx, userID, orderID)
}

// CancelOrder cancels a resting order and releases the funds it locked.
func (s *Service) CancelOrder(ctx context.Context, userID, orderID string) (*api.Order, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(orderID) == "" {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrPersistenceUnavailable
	}
	return s.store.CancelOrder(ctx, userID, orderID)
}

// CancelAllOrders cancels every open order for a user, releasing their funds.
func (s *Service) CancelAllOrders(ctx context.Context, userID, symbol string) ([]api.Order, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrPersistenceUnavailable
	}
	return s.store.CancelAllOrders(ctx, userID, symbol)
}

// GetUserTrades retrieves trades from durable trade history.
func (s *Service) GetUserTrades(ctx context.Context, userID, symbol string, limit int, fromID int64) ([]api.Trade, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, ErrPersistenceUnavailable
	}
	return s.store.GetUserTrades(ctx, userID, symbol, limit)
}

// GetStakingProducts returns no products until configured products are loaded from
// an authoritative provider/repository. It never advertises invented yields.
func (s *Service) GetStakingProducts(ctx context.Context) []api.StakingProduct {
	return nil
}

// Stake fails closed until a durable staking provider and ledger are configured.
func (s *Service) Stake(ctx context.Context, req *StakeRequest) (*api.StakingPosition, error) {
	if req == nil || strings.TrimSpace(req.UserID) == "" || strings.TrimSpace(req.Asset) == "" || req.Amount <= 0 || math.IsNaN(req.Amount) || math.IsInf(req.Amount, 0) {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, ErrPersistenceUnavailable
}

// Unstake fails closed until a durable staking provider and ledger are configured.
func (s *Service) Unstake(ctx context.Context, req *UnstakeRequest) (*api.StakingPosition, error) {
	if req == nil || strings.TrimSpace(req.UserID) == "" || strings.TrimSpace(req.PositionID) == "" || (req.Amount != 0 && (req.Amount < 0 || math.IsNaN(req.Amount) || math.IsInf(req.Amount, 0))) {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, ErrPersistenceUnavailable
}

// GetStakingPositions retrieves positions from durable storage.
func (s *Service) GetStakingPositions(ctx context.Context, userID string) ([]api.StakingPosition, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidOrder
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, ErrPersistenceUnavailable
}

// GetSavingsProducts returns no products until authoritative rates and terms are configured.
func (s *Service) GetSavingsProducts(ctx context.Context) []api.SavingsProduct {
	return nil
}

// GetLendingProducts returns no products until authoritative rates and terms are configured.
func (s *Service) GetLendingProducts(ctx context.Context) []api.LendingProduct {
	return nil
}

// StakingPosition represents a staking position (for API compatibility)
type StakingPosition struct {
	ID             string  `json:"id"`
	UserID         string  `json:"userId"`
	Asset          string  `json:"asset"`
	Amount         float64 `json:"amount"`
	APY            float64 `json:"apy"`
	StartTime      int64   `json:"startTime"`
	LockPeriodDays int     `json:"lockPeriodDays"`
}
