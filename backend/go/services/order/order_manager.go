// TigerEx Order Management Service
// Complete order execution, tracking, and management

package order

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	// Order types
	OrderTypeLimit      = "limit"
	OrderTypeMarket     = "market"
	OrderTypeStopLoss  = "stop_loss"
	OrderTypeStopLimit = "stop_limit"
	OrderTypeTakeProfit = "take_profit"

	// Order sides
	OrderSideBuy  = "buy"
	OrderSideSell = "sell"

	// Order status
	OrderStatusNew           = "new"
	OrderStatusPending       = "pending"
	OrderStatusOpen          = "open"
	OrderStatusPartiallyFilled = "partially_filled"
	OrderStatusFilled        = "filled"
	OrderStatusCancelled     = "cancelled"
	OrderStatusRejected      = "rejected"
	OrderStatusExpired       = "expired"

	// Time in force
	TimeInForceGTC = "GTC" // Good Till Cancel
	TimeInForceIOC  = "IOC" // Immediate or Cancel
	TimeInForceFOK  = "FOK" // Fill or Kill

	// Maximums
	MaxOrdersPerUser = 1000
	MaxOpenOrders   = 100
	OrderIDLength   = 32
)

// ============================================================================
// DATA STRUCTURES
// ============================================================================

// Order represents a trading order
type Order struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	Symbol            string    `json:"symbol"`
	Side              string    `json:"side"`
	Type              string    `json:"type"`
	TimeInForce       string    `json:"time_in_force"`
	Price             float64   `json:"price"`
	StopPrice         float64   `json:"stop_price,omitempty"`
	Quantity          float64   `json:"quantity"`
	FilledQuantity    float64   `json:"filled_quantity"`
	RemainingQuantity float64   `json:"remaining_quantity"`
	AvgFillPrice      float64   `json:"avg_fill_price"`
	Commission        float64   `json:"commission"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
	ExpiresAt         time.Time `json:"expires_at,omitempty"`
	TriggeredAt       time.Time `json:"triggered_at,omitempty"`
	MarginUsed        float64   `json:"margin_used,omitempty"`
	Leverage          int       `json:"leverage,omitempty"`
}

// OrderRequest represents a new order request
type OrderRequest struct {
	Symbol      string  `json:"symbol" validate:"required"`
	Side        string  `json:"side" validate:"required,oneof=buy sell"`
	Type        string  `json:"type" validate:"required,oneof=limit market stop_loss stop_limit take_profit"`
	TimeInForce string  `json:"time_in_force" validate:"omitempty,oneof=GTC IOC FOK"`
	Quantity    float64 `json:"quantity" validate:"required,gt=0"`
	Price       float64 `json:"price"`
	StopPrice   float64 `json:"stop_price"`
	ReduceOnly  bool    `json:"reduce_only"`
	PostOnly    bool    `json:"post_only"`
	MarginUsed  float64 `json:"margin_used"`
	Leverage    int     `json:"leverage"`
}

// Fill represents an order fill
type Fill struct {
	ID             string    `json:"id"`
	OrderID        string    `json:"order_id"`
	UserID         string    `json:"user_id"`
	Symbol         string    `json:"symbol"`
	Side           string    `json:"side"`
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	Commission     float64   `json:"commission"`
	Maker          bool      `json:"maker"`
	TradeID        string    `json:"trade_id"`
	TransactionID  string    `json:"transaction_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// OrderBook represents the order book for a symbol
type OrderBook struct {
	Symbol       string        `json:"symbol"`
	Bids         []OrderLevel  `json:"bids"`
	Asks         []OrderLevel  `json:"asks"`
	LastUpdateID int64         `json:"last_update_id"`
	Timestamp    time.Time     `json:"timestamp"`
}

// OrderLevel represents a price level in the order book
type OrderLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Orders   int     `json:"orders"`
}

// ============================================================================
// ORDER MANAGER
// ============================================================================

// OrderManager manages all orders
type OrderManager struct {
	mu           sync.RWMutex
	orders       map[string]*Order
	userOrders   map[string]map[string]*Order
	orderBook    map[string]*OrderBook
	fills        map[string][]Fill
	orderCounter uint64
}

// NewOrderManager creates a new order manager
func NewOrderManager() *OrderManager {
	return &OrderManager{
		orders:     make(map[string]*Order),
		userOrders: make(map[string]map[string]*Order),
		orderBook:  make(map[string]*OrderBook),
		fills:      make(map[string][]Fill),
	}
}

// CreateOrder creates a new order
func (om *OrderManager) CreateOrder(userID string, req *OrderRequest) (*Order, error) {
	om.mu.Lock()
	defer om.mu.Unlock()

	// Validate order request
	if err := om.validateOrderRequest(req); err != nil {
		return nil, err
	}

	// Check user order limits
	if userOrders, exists := om.userOrders[userID]; exists {
		if len(userOrders) >= MaxOpenOrders {
			return nil, errors.New("maximum open orders exceeded")
		}
	}

	// Generate order ID
	orderID := om.generateOrderID()

	// Set default time in force
	timeInForce := req.TimeInForce
	if timeInForce == "" {
		timeInForce = TimeInForceGTC
	}

	now := time.Now()
	order := &Order{
		ID:                orderID,
		UserID:            userID,
		Symbol:            req.Symbol,
		Side:              req.Side,
		Type:              req.Type,
		TimeInForce:       timeInForce,
		Price:             req.Price,
		StopPrice:         req.StopPrice,
		Quantity:          req.Quantity,
		FilledQuantity:    0,
		RemainingQuantity: req.Quantity,
		AvgFillPrice:      0,
		Commission:        0,
		Status:            OrderStatusNew,
		CreatedAt:         now,
		UpdatedAt:         now,
		MarginUsed:        req.MarginUsed,
		Leverage:          req.Leverage,
	}

	// Set expiration for GTC orders
	if timeInForce == TimeInForceGTC {
		order.ExpiresAt = now.Add(30 * 24 * time.Hour) // 30 days
	}

	// Store order
	om.orders[orderID] = order

	// Add to user orders
	if _, exists := om.userOrders[userID]; !exists {
		om.userOrders[userID] = make(map[string]*Order)
	}
	om.userOrders[userID][orderID] = order

	// Process order based on type
	if req.Type == OrderTypeMarket {
		// Market orders execute immediately
		order.Status = OrderStatusFilled
		order.FilledQuantity = order.Quantity
		order.RemainingQuantity = 0
		order.UpdatedAt = time.Now()
	}

	return order, nil
}

// validateOrderRequest validates an order request
func (om *OrderManager) validateOrderRequest(req *OrderRequest) error {
	if req.Symbol == "" {
		return errors.New("symbol is required")
	}
	if req.Side != OrderSideBuy && req.Side != OrderSideSell {
		return errors.New("invalid order side")
	}
	if req.Type != OrderTypeLimit && req.Type != OrderTypeMarket && 
	   req.Type != OrderTypeStopLoss && req.Type != OrderTypeStopLimit && 
	   req.Type != OrderTypeTakeProfit {
		return errors.New("invalid order type")
	}
	if req.Quantity <= 0 {
		return errors.New("quantity must be greater than 0")
	}
	if (req.Type == OrderTypeLimit || req.Type == OrderTypeStopLimit) && req.Price <= 0 {
		return errors.New("price must be greater than 0 for limit orders")
	}
	if (req.Type == OrderTypeStopLoss || req.Type == OrderTypeStopLimit || req.Type == OrderTypeTakeProfit) && req.StopPrice <= 0 {
		return errors.New("stop price must be greater than 0")
	}
	if req.Leverage < 1 || req.Leverage > 125 {
		return errors.New("leverage must be between 1 and 125")
	}
	return nil
}

// CancelOrder cancels an order
func (om *OrderManager) CancelOrder(orderID, userID string) (*Order, error) {
	om.mu.Lock()
	defer om.mu.Unlock()

	order, exists := om.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}

	if order.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	if order.Status == OrderStatusFilled || order.Status == OrderStatusCancelled {
		return nil, errors.New("order cannot be cancelled")
	}

	order.Status = OrderStatusCancelled
	order.UpdatedAt = time.Now()

	return order, nil
}

// GetOrder retrieves an order by ID
func (om *OrderManager) GetOrder(orderID string) (*Order, error) {
	om.mu.RLock()
	defer om.mu.RUnlock()

	order, exists := om.orders[orderID]
	if !exists {
		return nil, errors.New("order not found")
	}

	return order, nil
}

// GetUserOrders retrieves all orders for a user
func (om *OrderManager) GetUserOrders(userID string, status string) []*Order {
	om.mu.RLock()
	defer om.mu.RUnlock()

	userOrders, exists := om.userOrders[userID]
	if !exists {
		return nil
	}

	var orders []*Order
	for _, order := range userOrders {
		if status == "" || order.Status == status {
			orders = append(orders, order)
		}
	}

	return orders
}

// GetOpenOrders retrieves all open orders for a user
func (om *OrderManager) GetOpenOrders(userID string) []*Order {
	return om.GetUserOrders(userID, OrderStatusOpen)
}

// GetOrderHistory retrieves order history for a user
func (om *OrderManager) GetOrderHistory(userID string, limit int) []*Order {
	om.mu.RLock()
	defer om.mu.RUnlock()

	userOrders, exists := om.userOrders[userID]
	if !exists {
		return nil
	}

	var orders []*Order
	for _, order := range userOrders {
		if order.Status == OrderStatusFilled || order.Status == OrderStatusCancelled {
			orders = append(orders, order)
		}
	}

	if limit > 0 && len(orders) > limit {
		orders = orders[:limit]
	}

	return orders
}

// ProcessFill processes an order fill
func (om *OrderManager) ProcessFill(orderID string, price, quantity float64, maker bool) error {
	om.mu.Lock()
	defer om.mu.Unlock()

	order, exists := om.orders[orderID]
	if !exists {
		return errors.New("order not found")
	}

	// Calculate commission (0.1% for makers, 0.2% for takers)
	commissionRate := 0.001
	if !maker {
		commissionRate = 0.002
	}
	commission := price * quantity * commissionRate

	// Update order
	order.FilledQuantity += quantity
	order.RemainingQuantity = order.Quantity - order.FilledQuantity
	
	// Update average fill price
	totalValue := order.AvgFillPrice*order.FilledQuantity + price*quantity
	order.FilledQuantity += quantity
	order.AvgFillPrice = totalValue / order.FilledQuantity
	
	order.Commission += commission
	order.UpdatedAt = time.Now()

	// Update status
	if order.RemainingQuantity <= 0 {
		order.Status = OrderStatusFilled
	} else {
		order.Status = OrderStatusPartiallyFilled
	}

	// Record fill
	fill := Fill{
		ID:         om.generateFillID(),
		OrderID:    orderID,
		UserID:     order.UserID,
		Symbol:     order.Symbol,
		Side:       order.Side,
		Price:      price,
		Quantity:   quantity,
		Commission: commission,
		Maker:      maker,
		TradeID:    om.generateTradeID(),
		CreatedAt:  time.Now(),
	}

	om.fills[orderID] = append(om.fills[orderID], fill)

	return nil
}

// GetFills retrieves fills for an order
func (om *OrderManager) GetFills(orderID string) []Fill {
	om.mu.RLock()
	defer om.mu.RUnlock()

	return om.fills[orderID]
}

// UpdateOrderBook updates the order book for a symbol
func (om *OrderManager) UpdateOrderBook(symbol string, bids, asks []OrderLevel) {
	om.mu.Lock()
	defer om.mu.Unlock()

	om.orderBook[symbol] = &OrderBook{
		Symbol:       symbol,
		Bids:         bids,
		Asks:         asks,
		LastUpdateID: time.Now().UnixNano(),
		Timestamp:    time.Now(),
	}
}

// GetOrderBook retrieves the order book for a symbol
func (om *OrderManager) GetOrderBook(symbol string) (*OrderBook, error) {
	om.mu.RLock()
	defer om.mu.RUnlock()

	ob, exists := om.orderBook[symbol]
	if !exists {
		return nil, errors.New("order book not found")
	}

	return ob, nil
}

// generateOrderID generates a unique order ID
func (om *OrderManager) generateOrderID() string {
	om.orderCounter++
	return fmt.Sprintf("ORD%d%d%08x", time.Now().Unix(), om.orderCounter, time.Now().Nanosecond())
}

// generateFillID generates a unique fill ID
func (om *OrderManager) generateFillID() string {
	return fmt.Sprintf("FLL%d%d", time.Now().Unix(), time.Now().Nanosecond())
}

// generateTradeID generates a unique trade ID
func (om *OrderManager) generateTradeID() string {
	return fmt.Sprintf("TRD%d%d", time.Now().Unix(), time.Now().Nanosecond())
}

// ValidateOrder validates an order against current market conditions
func (om *OrderManager) ValidateOrder(order *Order, currentPrice float64) error {
	switch order.Type {
	case OrderTypeLimit:
		maxDeviation := 0.1
		if order.Side == OrderSideBuy && order.Price > currentPrice*(1+maxDeviation) {
			return errors.New("buy limit price too high")
		}
		if order.Side == OrderSideSell && order.Price < currentPrice*(1-maxDeviation) {
			return errors.New("sell limit price too low")
		}
	case OrderTypeStopLoss, OrderTypeStopLimit:
		if order.Side == OrderSideBuy && order.StopPrice <= currentPrice {
			return errors.New("buy stop price must be above current price")
		}
		if order.Side == OrderSideSell && order.StopPrice >= currentPrice {
			return errors.New("sell stop price must be below current price")
		}
	case OrderTypeTakeProfit:
		if order.Side == OrderSideBuy && order.StopPrice >= currentPrice {
			return errors.New("buy take profit price must be below current price")
		}
		if order.Side == OrderSideSell && order.StopPrice <= currentPrice {
			return errors.New("sell take profit price must be above current price")
		}
	}
	return nil
}

// ToJSON converts an order to JSON
func (o *Order) ToJSON() (string, error) {
	data, err := json.Marshal(o)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// OrderFromJSON creates an order from JSON
func OrderFromJSON(data string) (*Order, error) {
	var order Order
	err := json.Unmarshal([]byte(data), &order)
	if err != nil {
		return nil, err
	}
	return &order, nil
}

// HashPassword creates a bcrypt hash
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword compares password with hash
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}
