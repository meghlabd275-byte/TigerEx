package main

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX DERIVATIVES SERVICE - GO
// Futures and options trading
// ============================================================================

type Derivative struct {
	Symbol        string  `json:"symbol"`
	Underlying    string  `json:"underlying"`
	Type         string  `json:"type"` // futures, perpetual, option
	Expiry       int64   `json:"expiry,omitempty"`
	StrikePrice  float64 `json:"strike_price,omitempty"`
	ContractSize float64 `json:"contract_size"`
	TickSize    float64 `json:"tick_size"`
	Status      string  `json:"status"` // active, expired, settled
}

type Position struct {
	UserID      string  `json:"user_id"`
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"` // long, short
	Qty         float64 `json:"qty"`
	EntryPrice float64 `json:"entry_price"`
	Leverage    float64 `json:"leverage"`
}

type Order struct {
	ID          string  `json:"id"`
	UserID     string  `json:"user_id"`
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	Type       string  `json:"type"` // market, limit
	Qty        float64 `json:"qty"`
	Price      float64 `json:"price,omitempty"`
	StopPrice  float64 `json:"stop_price,omitempty"`
	Status     string  `json:"status"` // pending, filled, cancelled
	FilledQty  float64 `json:"filled_qty"`
	CreatedAt  int64   `json:"created_at"`
}

type DerivativesService struct {
	derivatives map[string]*Derivative
	positions map[string]*Position
	orders    map[string]*Order
}

func NewDerivativesService() *DerivativesService {
	s := &DerivativesService{
		derivatives: make(map[string]*Derivative),
		positions: make(map[string]*Position),
		orders: make(map[string]*Order),
	}

	// Register derivatives
	s.derivatives["BTC-PERP"] = &Derivative{Symbol: "BTC-PERP", Underlying: "BTC", Type: "perpetual", ContractSize: 0.001, TickSize: 0.5, Status: "active"}
	s.derivatives["ETH-PERP"] = &Derivative{Symbol: "ETH-PERP", Underlying: "ETH", Type: "perpetual", ContractSize: 0.01, TickSize: 0.05, Status: "active"}
	s.derivatives["BTC-20240329-FUT"] = &Derivative{Symbol: "BTC-20240329-FUT", Underlying: "BTC", Type: "futures", Expiry: 1711632000, ContractSize: 0.001, TickSize: 0.5, Status: "active"}
	s.derivatives["BTC-45000-CALL"] = &Derivative{Symbol: "BTC-45000-CALL", Underlying: "BTC", Type: "option", StrikePrice: 45000, ContractSize: 0.01, TickSize: 0.5, Status: "active"}

	return s
}

func (s *DerivativesService) CreateOrder(userID, symbol, side, orderType string, qty, price float64) *Order {
	order := &Order{
		ID: fmt.Sprintf("deriv_order_%d", time.Now().UnixNano()),
		UserID: userID, Symbol: symbol, Side: side, Type: orderType,
		Qty: qty, Price: price, Status: "pending", FilledQty: 0,
		CreatedAt: time.Now().Unix(),
	}
	s.orders[order.ID] = order
	return order
}

func (s *DerivativesService) FillOrder(orderID string, price float64) error {
	order, ok := s.orders[orderID]
	if !ok || order.Status != "pending" {
		return fmt.Errorf("order not found or not pending")
	}

	order.Status = "filled"
	order.FilledQty = order.Qty

	// Open position
	posKey := fmt.Sprintf("%s_%s", order.UserID, order.Symbol)
	s.positions[posKey] = &Position{
		UserID: order.UserID, Symbol: order.Symbol, Side: order.Side,
		Qty: order.Qty, EntryPrice: price, Leverage: 1,
	}

	return nil
}

func (s *DerivativesService) GetPositions(userID string) []*Position {
	var result []*Position
	for _, p := range s.positions {
		if p.UserID == userID {
			result = append(result, p)
		}
	}
	return result
}

func (s *DerivativesService) GetOrders(userID string) []*Order {
	var result []*Order
	for _, o := range s.orders {
		if o.UserID == userID {
			result = append(result, o)
		}
	}
	return result
}

func (s *DerivativesService) GetDerivatives() []*Derivative {
	var result []*Derivative
	for _, d := range s.derivatives {
		result = append(result, d)
	}
	return result
}

func SetupDerivativesRoutes(r *gin.Engine, svc *DerivativesService) {
	api := r.Group("/api/v1/derivatives")

	api.GET("", func(c *gin.Context) {
		c.JSON(200, svc.GetDerivatives())
	})

	api.POST("/orders", func(c *gin.Context) {
		var req struct {
			UserID  string  `json:"user_id"`
			Symbol string  `json:"symbol"`
			Side   string  `json:"side"`
			Type   string  `json:"type"`
			Qty    float64 `json:"qty"`
			Price float64 `json:"price"`
		}
		c.ShouldBindJSON(&req)

		order := svc.CreateOrder(req.UserID, req.Symbol, req.Side, req.Type, req.Qty, req.Price)
		c.JSON(201, order)
	})

	api.POST("/orders/:id/fill", func(c *gin.Context) {
		id := c.Param("id")
		price := 42000.0 // Would be market price
		err := svc.FillOrder(id, price)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
		} else {
			c.JSON(200, gin.H{"success": true})
		}
	})

	api.GET("/positions", func(c *gin.Context) {
		userID := c.Query("user_id")
		positions := svc.GetPositions(userID)
		c.JSON(200, positions)
	})

	api.GET("/orders", func(c *gin.Context) {
		userID := c.Query("user_id")
		orders := svc.GetOrders(userID)
		c.JSON(200, orders)
	})
}

func main() {
	r := gin.Default()
	svc := NewDerivativesService()
	SetupDerivativesRoutes(r, svc)
	log.Fatal(r.Run(":8080"))
}