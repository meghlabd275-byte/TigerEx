// Package trading provides trading execution service
package trading

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type OrderType string
type OrderSide string
type OrderStatus string
type TimeInForce string

const (
	OrderTypeMarket      OrderType = "market"
	OrderTypeLimit     OrderType = "limit"
	OrderTypeStopLoss OrderType = "stop_loss"
	OrderTypeTakeProfit OrderType = "take_profit"

	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"

	OrderStatusNew        OrderStatus = "new"
	OrderStatusOpen     OrderStatus = "open"
	OrderStatusPartial OrderStatus = "partially_filled"
	OrderStatusFilled OrderStatus = "filled"
	OrderStatusCancelled OrderStatus = "cancelled"
	OrderStatusRejected OrderStatus = "rejected"

	TimeInForceGTC TimeInForce = "good_till_cancel"
	TimeInForceIOC TimeInForce = "immediate_or_cancel"
	TimeInForceFOK TimeInForce = "fill_or_kill"
)

// Order represents a trading order
type Order struct {
	ID             string    `json:"id"`
	UserID         string    `json:"userId"`
	Symbol         string    `json:"symbol"`
	Side           OrderSide `json:"side"`
	OrderType     OrderType `json:"orderType"`
	Quantity      float64   `json:"quantity"`
	Price         float64   `json:"price"`
	StopPrice     float64   `json:"stopPrice,omitempty"`
	FilledQuantity float64  `json:"filledQuantity"`
	AvgFillPrice  float64   `json:"avgFillPrice"`
	Status       OrderStatus `json:"status"`
	TimeInForce  TimeInForce `json:"timeInForce"`
	CreatedAt    int64     `json:"createdAt"`
	UpdatedAt    int64     `json:"updatedAt"`
}

// ============================================================================
// TRADING SERVICE
// ============================================================================

type TradingService struct {
	mu          sync.RWMutex
	orders      map[string]*Order
	userOrders  map[string]map[string]*Order
	orderCounter uint64
	filledOrders uint64
}

func NewTradingService() *TradingService {
	return &TradingService{
		orders:    make(map[string]*Order),
		userOrders: make(map[string]map[string]*Order),
	}
}

// ============================================================================
// ORDER OPERATIONS
// ============================================================================

// Place new order
func (s *TradingService) PlaceOrder(userID, symbol string, side OrderSide, orderType OrderType, quantity, price float64, tif TimeInForce) (*Order, error) {
	if quantity <= 0 {
		return nil, errors.New("quantity must be positive")
	}

	if orderType == OrderTypeLimit && price <= 0 {
		return nil, errors.New("limit orders require price")
	}

	if orderType != OrderTypeMarket && tif == "" {
		tif = TimeInForceGTC
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.orderCounter++
	now := time.Now().Unix()

	order := &Order{
		ID:            fmt.Sprintf("ord_%d", s.orderCounter),
		UserID:        userID,
		Symbol:        symbol,
		Side:         side,
		OrderType:     orderType,
		Quantity:     quantity,
		Price:        price,
		FilledQuantity: 0,
		AvgFillPrice:  0,
		Status:       OrderStatusNew,
		TimeInForce:  tif,
		CreatedAt:    now,
		UpdatedAt:   now,
	}

	s.orders[order.ID] = order

	// Index by user
	if s.userOrders[userID] == nil {
		s.userOrders[userID] = make(map[string]*Order)
	}
	s.userOrders[userID][order.ID] = order

	return order, nil
}

// Execute market order (instant fill simulation)
func (s *TradingService) ExecuteMarketOrder(order *Order, marketPrice float64) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if order.Status != OrderStatusNew && order.Status != OrderStatusOpen {
		return order, errors.New("order cannot be executed")
	}

	order.FilledQuantity = order.Quantity
	order.AvgFillPrice = marketPrice
	order.Status = OrderStatusFilled
	order.UpdatedAt = time.Now().Unix()

	s.filledOrders++

	return order, nil
}

// Cancel order
func (s *TradingService) CancelOrder(orderID, userID string) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, errors.New("order not found")
	}

	if order.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status == OrderStatusFilled || order.Status == OrderStatusCancelled {
		return nil, errors.New("order cannot be cancelled")
	}

	order.Status = OrderStatusCancelled
	order.UpdatedAt = time.Now().Unix()

	return order, nil
}

// Modify order
func (s *TradingService) ModifyOrder(orderID, userID string, newPrice, newQuantity float64) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, errors.New("order not found")
	}

	if order.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status != OrderStatusNew && order.Status != OrderStatusOpen {
		return nil, errors.New("order cannot be modified")
	}

	if newQuantity > 0 {
		order.Quantity = newQuantity
	}
	if newPrice > 0 {
		order.Price = newPrice
	}
	order.UpdatedAt = time.Now().Unix()

	return order, nil
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

// Get order by ID
func (s *TradingService) GetOrder(orderID string) (*Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, errors.New("order not found")
	}

	return order, nil
}

// Get user's orders
func (s *TradingService) GetUserOrders(userID string, limit int) []*Order {
	s.mu.RLock()
	defer s.mu.RUnlock()

	orders := s.userOrders[userID]
	if orders == nil {
		return []*Order{}
	}

	result := make([]*Order, 0, len(orders))
	for _, order := range orders {
		result = append(result, order)
	}

	// Return most recent first
	if limit > 0 && len(result) > limit {
		return result[len(result)-limit:]
	}
	return result
}

// Get open orders for symbol
func (s *TradingService) GetOpenOrders(symbol string) []*Order {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Order
	for _, order := range s.orders {
		if order.Symbol == symbol && (order.Status == OrderStatusNew || order.Status == OrderStatusOpen || order.Status == OrderStatusPartial) {
			result = append(result, order)
		}
	}
	return result
}

// ============================================================================
// STATISTICS
// ============================================================================

// Get order stats
func (s *TradingService) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	openCount := 0
	for _, o := range s.orders {
		if o.Status == OrderStatusNew || o.Status == OrderStatusOpen {
			openCount++
		}
	}

	return map[string]interface{}{
		"total_orders":  len(s.orders),
		"open_orders": openCount,
		"filled_orders": s.filledOrders,
	}
}

// ============================================================================
// MAIN EXAMPLE
// ============================================================================

func main() {
	service := NewTradingService()

	// Place orders
	order1, _ := service.PlaceOrder("user1", "BTC/USDT", OrderSideBuy, OrderTypeLimit, 0.5, 50000.0, TimeInForceGTC)
	order2, _ := service.PlaceOrder("user1", "ETH/USDT", OrderSideBuy, OrderTypeMarket, 2.0, 0, TimeInForceIOC)

	fmt.Printf("Order 1: %s - %s\n", order1.ID, order1.Status)
	fmt.Printf("Order 2: %s - %s\n", order2.ID, order2.Status)

	// Execute market order
	service.ExecuteMarketOrder(order2, 3000.0)

	// Get stats
	stats := service.GetStats()
	fmt.Printf("Stats: %v\n", stats)
}