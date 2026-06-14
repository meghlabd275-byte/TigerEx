package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"tigerEx/rest_api_gateway/internal/models"
)

// ============================================================================
// TRADING SERVICE
// ============================================================================

// TradingService handles trading operations
type TradingService struct {
	mu            sync.RWMutex
	orders        map[string]*models.Order
	orderIndex    map[string]map[string]*models.Order // userID -> orderID -> order
	trades        map[string]*models.Trade
	orderCounter  int64
	tradeCounter  int64
}

// NewTradingService creates a new trading service
func NewTradingService() *TradingService {
	return &TradingService{
		orders:     make(map[string]*models.Order),
		orderIndex: make(map[string]map[string]*models.Order),
		trades:     make(map[string]*models.Trade),
	}
}

// ============================================================================
// ORDER OPERATIONS
// ============================================================================

// CreateOrder creates a new order
func (ts *TradingService) CreateOrder(ctx context.Context, req *CreateOrderRequest) (*models.Order, error) {
	// Validate request
	if err := ts.validateOrderRequest(req); err != nil {
		return nil, err
	}

	ts.mu.Lock()
	defer ts.mu.Unlock()

	ts.orderCounter++
	orderID := fmt.Sprintf("ORD_%d", ts.orderCounter)
	orderUUID := generateUUID()

	order := &models.Order{
		ID:              orderID,
		UserID:          req.UserID,
		OrderUUID:       orderUUID,
		Symbol:          req.Symbol,
		Side:            models.OrderSide(req.Side),
		Type:            models.OrderType(req.Type),
		Price:           req.Price,
		StopPrice:       req.StopPrice,
		Quantity:        req.Quantity,
		Status:          models.OrderStatusNew,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
		TimeInForce:     models.TimeInForce(req.TimeInForce),
		IcebergQty:      req.IcebergQty,
	}

	// Calculate quote quantity
	if req.Price > 0 {
		order.QuoteQuantity = req.Quantity * req.Price
	}

	// Index by user
	if ts.orderIndex[req.UserID] == nil {
		ts.orderIndex[req.UserID] = make(map[string]*models.Order)
	}
	ts.orderIndex[req.UserID][orderID] = order
	ts.orders[orderID] = order

	// If market order, fill immediately
	if order.Type == models.OrderTypeMarket {
		order.Status = models.OrderStatusFilled
		order.AvgPrice = getMarketPrice(order.Symbol) // In production, get from matching engine
		order.FilledQty = order.Quantity
		order.Amount = order.Quantity * order.AvgPrice

		// Create trade
		ts.createTrade(order)
	}

	return order, nil
}

// CancelOrder cancels an order
func (ts *TradingService) CancelOrder(ctx context.Context, orderID, userID string) (*models.Order, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	order, ok := ts.orders[orderID]
	if !ok {
		return nil, models.NewErrorResponse(404, "Order not found")
	}

	if order.UserID != userID {
		return nil, models.NewErrorResponse(403, "Unauthorized")
	}

	if order.Status == models.OrderStatusFilled || order.Status == models.OrderStatusCanceled {
		return nil, models.NewErrorResponse(400, "Order already completed")
	}

	order.Status = models.OrderStatusCanceled
	order.UpdatedAt = time.Now()

	return order, nil
}

// GetOrder gets an order by ID
func (ts *TradingService) GetOrder(ctx context.Context, orderID string) (*models.Order, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	order, ok := ts.orders[orderID]
	if !ok {
		return nil, models.NewErrorResponse(404, "Order not found")
	}

	return order, nil
}

// GetOrders gets orders for a user with filters
func (ts *TradingService) GetOrders(ctx context.Context, userID string, filters *OrderFilters) ([]*models.Order, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	userOrders, ok := ts.orderIndex[userID]
	if !ok {
		return []*models.Order{}, nil
	}

	var result []*models.Order
	for _, order := range userOrders {
		if filters != nil {
			if filters.Symbol != "" && order.Symbol != filters.Symbol {
				continue
			}
			if filters.Status != "" && order.Status != models.OrderStatus(filters.Status) {
				continue
			}
			if filters.Side != "" && order.Side != models.OrderSide(filters.Side) {
				continue
			}
			if filters.StartTime > 0 && order.CreatedAt.Unix() < filters.StartTime {
				continue
			}
			if filters.EndTime > 0 && order.CreatedAt.Unix() > filters.EndTime {
				continue
			}
		}
		result = append(result, order)
	}

	// Apply limit
	if filters != nil && filters.Limit > 0 && len(result) > filters.Limit {
		result = result[:filters.Limit]
	}

	return result, nil
}

// GetOpenOrders gets all open orders for a user
func (ts *TradingService) GetOpenOrders(ctx context.Context, userID string) ([]*models.Order, error) {
	return ts.GetOrders(ctx, userID, &OrderFilters{
		Status: string(models.OrderStatusNew),
	})
}

// ============================================================================
// ORDER VALIDATION
// ============================================================================

// CreateOrderRequest represents a create order request
type CreateOrderRequest struct {
	UserID       string
	Symbol       string
	Side         string
	Type         string
	Price        float64
	StopPrice    float64
	Quantity     float64
	TimeInForce  string
	IcebergQty   float64
	ReduceOnly  bool
}

// OrderFilters represents order filters
type OrderFilters struct {
	Symbol    string
	Side      string
	Status    string
	StartTime int64
	EndTime   int64
	Limit     int
}

// validateOrderRequest validates an order request
func (ts *TradingService) validateOrderRequest(req *CreateOrderRequest) error {
	if req.Symbol == "" {
		return models.NewErrorResponse(400, "Symbol is required")
	}
	if req.Side != "BUY" && req.Side != "SELL" {
		return models.NewErrorResponse(400, "Invalid side")
	}
	if req.Type == "" {
		req.Type = "LIMIT"
	}
	if req.Type == "LIMIT" && req.Price <= 0 {
		return models.NewErrorResponse(400, "Price is required for limit orders")
	}
	if req.Quantity <= 0 {
		return models.NewErrorResponse(400, "Quantity must be greater than 0")
	}
	if req.Type == "ICEBERG" && req.IcebergQty <= 0 {
		return models.NewErrorResponse(400, "Iceberg quantity is required for iceberg orders")
	}
	return nil
}

// ============================================================================
// TRADE OPERATIONS
// ============================================================================

// createTrade creates a trade for an order
func (ts *TradingService) createTrade(order *models.Order) {
	ts.tradeCounter++
	tradeID := fmt.Sprintf("TRADE_%d", ts.tradeCounter)

	trade := &models.Trade{
		ID:              tradeID,
		OrderID:         order.ID,
		UserID:          order.UserID,
		Symbol:          order.Symbol,
		Side:            order.Side,
		Price:           order.AvgPrice,
		Quantity:        order.FilledQty,
		QuoteQuantity:   order.FilledQty * order.AvgPrice,
		Commission:     order.FilledQty * order.AvgPrice * 0.001, // 0.1% fee
		CommissionAsset: "USDT",
		Maker:          false,
		TradeTime:       time.Now(),
	}

	order.Commission = trade.Commission
	ts.trades[tradeID] = trade
}

// GetTrades gets trades for a user
func (ts *TradingService) GetTrades(ctx context.Context, userID string, filters *TradeFilters) ([]*models.Trade, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	var result []*models.Trade
	for _, trade := range ts.trades {
		if trade.UserID != userID {
			continue
		}
		if filters != nil {
			if filters.Symbol != "" && trade.Symbol != filters.Symbol {
				continue
			}
			if filters.OrderID != "" && trade.OrderID != filters.OrderID {
				continue
			}
			if filters.StartTime > 0 && trade.TradeTime.Unix() < filters.StartTime {
				continue
			}
			if filters.EndTime > 0 && trade.TradeTime.Unix() > filters.EndTime {
				continue
			}
		}
		result = append(result, trade)
	}

	if filters != nil && filters.Limit > 0 && len(result) > filters.Limit {
		result = result[:filters.Limit]
	}

	return result, nil
}

// TradeFilters represents trade filters
type TradeFilters struct {
	Symbol    string
	OrderID   string
	StartTime int64
	EndTime   int64
	Limit     int
}

// ============================================================================
// OPEN ORDERS COUNT
// ============================================================================

// GetOpenOrdersCount gets count of open orders for a symbol
func (ts *TradingService) GetOpenOrdersCount(symbol string) int {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	count := 0
	for _, order := range ts.orders {
		if order.Symbol == symbol && (order.Status == models.OrderStatusNew || order.Status == models.OrderStatusPartial) {
			count++
		}
	}
	return count
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateUUID() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), ts.orderCounter)
}

func getMarketPrice(symbol string) float64 {
	// In production, get from matching engine
	// For now, return mock price
	return 50000.0
}