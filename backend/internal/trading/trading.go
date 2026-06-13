package trading

import (
	"fmt"
	"log"
	"sync"
	"time"

	"tigerex/backend/internal/matching"
	"tigerex/backend/internal/wallet"
)

type TradingService struct {
	config         TradingConfig
	matchingEngine *matching.Engine
	walletService *wallet.WalletService
	security     SecurityLayer
	mu           sync.RWMutex
	orders      map[string]*Order
	positions   map[string]*Position
}

type TradingConfig struct {
	EnableSpot         bool
	EnableFutures      bool
	EnableMargin      bool
	EnableOptions     bool
	MaxLeverage       int
	DefaultLeverage   int
	MaxOrderValue    float64
	MaxOpenOrders    int
	EnableStopLoss   bool
	EnableTakeProfit bool
	EnableOCO        bool
	EnableTrailingStop bool
	EnableGridTrading bool
	EnableCopyTrading bool
}

type SecurityLayer interface {
	GetSecurityContext(r interface{}) interface{}
}

type Order struct {
	OrderID        string
	UserID         string
	Symbol         string
	Side           matching.OrderSide
	Type           matching.OrderType
	Price          float64
	Quantity       float64
	FilledQuantity float64
	StopPrice      float64
	Status         matching.OrderStatus
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Metadata       map[string]interface{}
}

type Position struct {
	PositionID   string
	UserID       string
	Symbol       string
	Side         string
	Size         float64
	EntryPrice  float64
	MarkPrice   float64
	Leverage     int
	LiquidationPrice float64
	UnrealizedPNL float64
	RealizedPNL  float64
	OpenedAt     time.Time
	UpdatedAt    time.Time
}

func NewTradingService(config TradingConfig, matchingEngine *matching.Engine, walletService *wallet.WalletService, security SecurityLayer) *TradingService {
	return &TradingService{
		config:         config,
		matchingEngine: matchingEngine,
		walletService: walletService,
		security:     security,
		orders:       make(map[string]*Order),
		positions:    make(map[string]*Position),
	}
}

func (s *TradingService) PlaceOrder(userID, symbol string, side matching.OrderSide, orderType matching.OrderType, price, quantity, stopPrice float64) (*Order, error) {
	order := &Order{
		OrderID:    generateOrderID(),
		UserID:     userID,
		Symbol:     symbol,
		Side:       side,
		Type:       orderType,
		Price:     price,
		Quantity:  quantity,
		Status:    matching.StatusNew,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Metadata:  make(map[string]interface{}),
	}

	if stopPrice > 0 {
		order.StopPrice = stopPrice
	}

	s.mu.Lock()
	s.orders[order.OrderID] = order
	s.mu.Unlock()

	matchOrder := &matching.Order{
		OrderID:   order.OrderID,
		UserID:    userID,
		Symbol:    symbol,
		Side:      side,
		Type:      orderType,
		Price:     price,
		Quantity:  quantity,
		Timestamp: time.Now(),
		Status:    matching.StatusNew,
	}

	trades, err := s.matchingEngine.AddOrder(matchOrder)
	if err != nil {
		order.Status = matching.StatusRejected
		return order, err
	}

	for _, trade := range trades {
		order.FilledQuantity += trade.Quantity
		if order.FilledQuantity >= order.Quantity {
			order.Status = matching.StatusFilled
		} else {
			order.Status = matching.StatusPartial
		}
		order.UpdatedAt = time.Now()

		log.Printf("Trade executed: %s %f @ %f", symbol, trade.Quantity, trade.Price)
	}

	return order, nil
}

func (s *TradingService) CancelOrder(userID, orderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, exists := s.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	if order.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status == matching.StatusFilled || order.Status == matching.StatusCancelled {
		return fmt.Errorf("order cannot be cancelled")
	}

	err := s.matchingEngine.CancelOrder(orderID, order.Symbol)
	if err != nil {
		return err
	}

	order.Status = matching.StatusCancelled
	order.UpdatedAt = time.Now()

	return nil
}

func (s *TradingService) GetOrders(userID, symbol string) ([]*Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var userOrders []*Order
	for _, order := range s.orders {
		if order.UserID == userID {
			if symbol == "" || order.Symbol == symbol {
				userOrders = append(userOrders, order)
			}
		}
	}

	return userOrders, nil
}

func (s *TradingService) GetOrder(userID, orderID string) (*Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, exists := s.orders[orderID]
	if !exists {
		return nil, fmt.Errorf("order not found")
	}

	if order.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	return order, nil
}

func (s *TradingService) GetPositions(userID string) ([]*Position, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var userPositions []*Position
	for _, position := range s.positions {
		if position.UserID == userID {
			userPositions = append(userPositions, position)
		}
	}

	return userPositions, nil
}

func (s *TradingService) UpdatePositions() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, position := range s.positions {
		ob, err := s.matchingEngine.GetOrderBook(position.Symbol)
		if err != nil {
			continue
		}

		position.MarkPrice = ob.LastPrice
		position.UnrealizedPNL = s.calculatePNL(position)
		position.UpdatedAt = time.Now()
	}
}

func (s *TradingService) calculatePNL(position *Position) float64 {
	if position.Side == "long" {
		return (position.MarkPrice - position.EntryPrice) * position.Size
	}
	return (position.EntryPrice - position.MarkPrice) * position.Size
}

func (s *TradingService) CalculateLiquidationPrice(position *Position) float64 {
	leverage := float64(position.Leverage)
	if position.Side == "long" {
		return position.EntryPrice * (1 - 1/leverage + 0.005)
	}
	return position.EntryPrice * (1 + 1/leverage - 0.005)
}

func (s *TradingService) PlaceStopLoss(orderID string, stopPrice float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, exists := s.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	order.Metadata["stop_loss"] = stopPrice
	return nil
}

func (s *TradingService) PlaceTakeProfit(orderID string, takeProfitPrice float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, exists := s.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	order.Metadata["take_profit"] = takeProfitPrice
	return nil
}

func (s *TradingService) PlaceOCO(userID, symbol string, price, quantity, stopPrice, limitPrice float64) error {
	order1, err := s.PlaceOrder(userID, symbol, matching.SideBuy, matching.TypeStopLimit, limitPrice, quantity, stopPrice)
	if err != nil {
		return err
	}

	order2, err := s.PlaceOrder(userID, symbol, matching.SideSell, matching.TypeLimit, limitPrice, quantity, 0)
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.orders[order1.OrderID].Metadata["oco_order"] = order2.OrderID
	s.orders[order2.OrderID].Metadata["oco_order"] = order1.OrderID
	s.mu.Unlock()

	return nil
}

func (s *TradingService) PlaceTrailingStop(userID, symbol string, side matching.OrderSide, quantity, trailDistance, activationPrice float64) error {
	order := &Order{
		OrderID:   generateOrderID(),
		UserID:    userID,
		Symbol:    symbol,
		Side:      side,
		Type:      matching.TypeTrailingStop,
		Price:     activationPrice,
		Quantity:  quantity,
		Status:    matching.StatusNew,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Metadata: map[string]interface{}{
			"trail_distance": trailDistance,
		},
	}

	s.mu.Lock()
	s.orders[order.OrderID] = order
	s.mu.Unlock()

	return nil
}

func generateOrderID() string {
	return fmt.Sprintf("ORD-%d-%d", time.Now().UnixNano(), time.Now().Nanosecond()%1000)
}
