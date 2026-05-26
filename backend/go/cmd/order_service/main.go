// Package order_service handles order management.
// Migrated from TypeScript to Go for high-performance order handling.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Order side
type OrderSide string

const (
	Buy  OrderSide = "buy"
	Sell OrderSide = "sell"
)

// Order type
type OrderType string

const (
	OrderTypeMarket    OrderType = "market"
	OrderTypeLimit   OrderType = "limit"
	OrderTypeStopLoss OrderType = "stop_loss"
	OrderTypeTakeProfit OrderType = "take_profit"
)

// Order status
type OrderStatus string

const (
	StatusPending   OrderStatus = "pending"
	StatusFilled   OrderStatus = "filled"
	StatusPartial OrderStatus = "partial"
	StatusCancelled OrderStatus = "cancelled"
	StatusRejected OrderStatus = "rejected"
)

// Order represents a trading order
type Order struct {
	ID         string     `json:"id"`
	UserID    string     `json:"userId"`
	Pair      string     `json:"pair"`
	Side      OrderSide  `json:"side"`
	Type      OrderType  `json:"orderType"`
	Quantity  float64   `json:"quantity"`
	Price     float64   `json:"price"`
	Filled    float64   `json:"filled"`
	Status    OrderStatus `json:"status"`
	CreatedAt int64      `json:"createdAt"`
	UpdatedAt int64      `json:"updatedAt"`
}

// Order store
type OrderStore struct {
	mu      sync.RWMutex
	orders map[string]*Order
}

var (
	store = &OrderStore{
		orders: make(map[string]*Order),
	}
)

// Create order
func CreateOrder(order *Order) *Order {
	order.ID = fmt.Sprintf("ord_%d", time.Now().UnixNano())
	order.Status = StatusPending
	order.CreatedAt = time.Now().UnixMilli()
	order.UpdatedAt = time.Now().UnixMilli()

	store.mu.Lock()
	defer store.mu.Unlock()
	store.orders[order.ID] = order

	return order
}

// Get order by ID
func GetOrder(id string) (*Order, bool) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	order, ok := store.orders[id]
	return order, ok
}

// Fill order (match)
func FillOrder(id string, fillQty float64) (*Order, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	order, ok := store.orders[id]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}

	order.Filled += fillQty
	order.UpdatedAt = time.Now().UnixMilli()

	if order.Filled >= order.Quantity {
		order.Status = StatusFilled
	} else {
		order.Status = StatusPartial
	}

	return order, nil
}

// Cancel order
func CancelOrder(id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	order, ok := store.orders[id]
	if !ok {
		return fmt.Errorf("order not found")
	}

	order.Status = StatusCancelled
	order.UpdatedAt = time.Now().UnixMilli()

	return nil
}

// Get user orders
func GetUserOrders(userID string) []*Order {
	store.mu.RLock()
	defer store.mu.RUnlock()

	var result []*Order
	for _, o := range store.orders {
		if o.UserID == userID {
			result = append(result, o)
		}
	}
	return result
}

// Get open orders for pair
func GetOpenOrders(pair string) []*Order {
	store.mu.RLock()
	defer store.mu.RUnlock()

	var result []*Order
	for _, o := range store.orders {
		if o.Pair == pair && (o.Status == StatusPending || o.Status == StatusPartial) {
			result = append(result, o)
		}
	}
	return result
}

func main() {
	fmt.Println("Order service initialized")

	// Demo order
	order := CreateOrder(&Order{
		UserID:   "user_demo",
		Pair:    "BTC/USDT",
		Side:    Buy,
		Type:    OrderTypeLimit,
		Quantity: 0.5,
		Price:   65000.0,
	})

	fmt.Printf("Created order: %s\n", order.ID)
}