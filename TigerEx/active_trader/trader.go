package main

import (
	"fmt"
	"time"
)

// Order types
type OrderType string

const (
	OrderMarket      OrderType = "market"
	OrderLimit     OrderType = "limit"
	OrderStopMarket OrderType = "stop_market"
	OrderStopLimit OrderType = "stop_limit"
	OrderTrailing  OrderType = "trailing_stop"
)

// Order status
type OrderStatus string

const (
	OrderPending  OrderStatus = "pending"
	OrderFilled OrderStatus = "filled"
	OrderCancelled OrderStatus = "cancelled"
)

// Order
type Order struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Symbol   string    `json:"symbol"`
	Side     string    `json:"side"` // "buy" or "sell"
	 Quantity   int       `json:"quantity"`
	Price    float64   `json:"price"`
	Type    OrderType  `json:"type"`
	Status  OrderStatus `json:"status"`
	CreateTime int64   `json:"createTime"`
}

// Active trader
type ActiveTrader struct {
	Orders map[string]*Order
}

// New creates
func NewActiveTrader() *ActiveTrader {
	return &ActiveTrader{
		Orders: make(map[string]*Order),
	}
}

// Place order
func (t *ActiveTrader) PlaceOrder(userID, symbol string, quantity int, price float64, orderType OrderType, side string) *Order {
	order := &Order{
		ID: fmt.Sprintf("ord_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Quantity: quantity,
		Price: price,
		Type: orderType,
		Status: OrderPending,
		CreateTime: time.Now().UnixMilli(),
	}
	
	t.Orders[order.ID] = order
	return order
}

// Cancel order
func (t *ActiveTrader) CancelOrder(orderID string) bool {
	order := t.Orders[orderID]
	if order == nil {
		return false
	}
	
	order.Status = OrderCancelled
	return true
}

// Fill order
func (t *ActiveTrader) FillOrder(orderID string) bool {
	order := t.Orders[orderID]
	if order == nil || order.Status != OrderPending {
		return false
	}
	
	order.Status = OrderFilled
	return true
}

func main() {
	trader := NewActiveTrader()
	
	// Place order
	order := trader.PlaceOrder("user1", "BTC/USDT", 1, 50000, OrderLimit, "buy")
	fmt.Printf("Order placed: %s - %s %d @ $%.2f\n", order.Symbol, order.Side, order.Quantity, order.Price)
	
	// Fill
	trader.FillOrder(order.ID)
	fmt.Printf("Status: %s\n", order.Status)
}