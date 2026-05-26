package main

import (
	"fmt"
	"time"
)

// Stock quote
type StockQuote struct {
	Symbol string  `json:"symbol"`
	Price  float64 `json:"price"`
	Change float64 `json:"change"`
	Volume int    `json:"volume"`
}

// Order type
type OrderType string

const (
	OrderMarket OrderType = "market"
	OrderLimit OrderType = "limit"
)

// Order side
type OrderSide string

const (
	OrderBuy OrderSide = "buy"
	OrderSell OrderSide = "sell"
)

// Stock order
type StockOrder struct {
	ID        string    `json:"id"`
	UserID   string    `json:"userId"`
	Symbol  string    `json:"symbol"`
	Side    OrderSide `json:"side"`
	Quantity int      `json:"quantity"`
	Price   float64   `json:"price"`
	Type    OrderType `json:"type"`
	Status  string    `json:"status"`
}

// Stock trading platform
type StockTrading struct {
	Quotes  map[string]*StockQuote
	Orders map[string]*StockOrder
}

// New creates platform
func NewStockTrading() *StockTrading {
	return &StockTrading{
		Quotes: make(map[string]*StockQuote),
		Orders: make(map[string]*StockOrder),
	}
}

// Get quote
func (s *StockTrading) GetQuote(symbol string) *StockQuote {
	if q, ok := s.Quotes[symbol]; ok {
		return q
	}
	
	// Mock data
	return &StockQuote{
		Symbol: symbol,
		Price: 150.0,
		Change: 2.5,
		Volume: 1000000,
	}
}

// Place market order
func (s *StockTrading) PlaceMarketOrder(userID, symbol string, quantity int, side OrderSide) *StockOrder {
	quote := s.GetQuote(symbol)
	
	order := &StockOrder{
		ID: fmt.Sprintf("order_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Quantity: quantity,
		Price: quote.Price,
		Type: OrderMarket,
		Status: "filled",
	}
	
	s.Orders[order.ID] = order
	return order
}

func main() {
	trading := NewStockTrading()
	
	// Get quote
	quote := trading.GetQuote("AAPL")
	fmt.Printf("AAPL: $%.2f (%.2f%%)\n", quote.Price, quote.Change)
	
	// Place order
	order := trading.PlaceMarketOrder("user1", "AAPL", 10, OrderBuy)
	fmt.Printf("Order: %s - %s %d @ $%.2f\n", order.ID, order.Symbol, order.Quantity, order.Price)
}