package main

import (
	"fmt"
	"time"
)

// Convert quote
type ConvertQuote struct {
	ID        string  `json:"id"`
	FromToken string  `json:"fromToken"`
	ToToken  string  `json:"toToken"`
	FromAmount float64 `json:"fromAmount"`
	ToAmount float64 `json:"toAmount"`
	Price    float64 `json:"price"`
	Fee      float64 `json:"fee"`
	ExpireTime int64   `json:"expireTime"`
}

// Convert order status
type ConvertOrderStatus string

const (
	ConvertPending  ConvertOrderStatus = "pending"
	ConvertCompleted ConvertOrderStatus = "completed"
	ConvertFailed ConvertOrderStatus = "failed"
)

// Convert order
type ConvertOrder struct {
	ID        string            `json:"id"`
	UserID   string            `json:"userId"`
	FromToken string            `json:"fromToken"`
	ToToken  string            `json:"toToken"`
	FromAmount float64         `json:"fromAmount"`
	ToAmount float64         `json:"toAmount"`
	Price    float64         `json:"price"`
	Fee      float64         `json:"fee"`
	Status   ConvertOrderStatus `json:"status"`
	CreatedAt int64           `json:"createdAt"`
}

// Convert system
type ConvertSystem struct {
	Quotes map[string]*ConvertQuote
	Orders map[string]*ConvertOrder
	Rates map[string]float64
}

// New creates system
func NewConvertSystem() *ConvertSystem {
	return &ConvertSystem{
		Quotes: make(map[string]*ConvertQuote),
		Orders: make(map[string]*ConvertOrder),
		Rates: map[string]float64{
			"BTC": 50000, "ETH": 3000, "BNB": 400, "SOL": 120,
			"XRP": 0.60, "ADA": 0.50, "DOGE": 0.09, "DOT": 8.0,
			"USDT": 1.0, "USDC": 1.0, "BUSD": 1.0,
		},
	}
}

// Get rate
func (c *ConvertSystem) getRate(fromToken, toToken string) float64 {
	fromRate := c.Rates[fromToken]
	toRate := c.Rates[toToken]
	
	if fromRate == 0 || toRate == 0 {
		return 0
	}
	
	return fromRate / toRate
}

// Get quote
func (c *ConvertSystem) GetQuote(fromToken, toToken string, amount float64) *ConvertQuote {
	rate := c.getRate(fromToken, toToken)
	if rate == 0 {
		return nil
	}
	
	toAmount := amount * rate
	fee := amount * 0.001 // 0.1% fee
	
	quote := &ConvertQuote{
		ID: fmt.Sprintf("quote_%d", time.Now().UnixNano()),
		FromToken: fromToken,
		ToToken:  toToken,
		FromAmount: amount,
		ToAmount: toAmount - fee,
		Price: rate,
		Fee: fee,
		ExpireTime: time.Now().Add(30 * time.Second).UnixMilli(),
	}
	
	c.Quotes[quote.ID] = quote
	return quote
}

// Execute conversion
func (c *ConvertSystem) Execute(userID string, quoteID string) *ConvertOrder {
	quote, ok := c.Quotes[quoteID]
	if !ok {
		return nil
	}
	
	order := &ConvertOrder{
		ID: fmt.Sprintf("conv_%d", time.Now().UnixNano()),
		UserID: userID,
		FromToken: quote.FromToken,
		ToToken: quote.ToToken,
		FromAmount: quote.FromAmount,
		ToAmount: quote.ToAmount,
		Price: quote.Price,
		Fee: quote.Fee,
		Status: ConvertCompleted,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	c.Orders[order.ID] = order
	return order
}

// Get order
func (c *ConvertSystem) GetOrder(orderID string) *ConvertOrder {
	return c.Orders[orderID]
}

func main() {
	sys := NewConvertSystem()
	
	// Get quote
	quote := sys.GetQuote("BTC", "ETH", 1.0)
	if quote != nil {
		fmt.Printf("Quote: %.4f BTC -> %.4f ETH (fee: %.6f)\n", 
			quote.FromAmount, quote.ToAmount, quote.Fee)
	}
	
	// Execute
	order := sys.Execute("user1", quote.ID)
	fmt.Printf("Order: %s - %s\n", order.ID, order.Status)
}