package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// Order management constants
const (
	OrderStatusPending   = "pending"
	OrderStatusNew       = "new"
	OrderStatusPartial   = "partially_filled"
	OrderStatusFilled    = "filled"
	OrderStatusCanceled  = "canceled"
	OrderStatusRejected  = "rejected"

	OrderSideBuy  = "buy"
	OrderSideSell = "sell"

	OrderTypeLimit    = "limit"
	OrderTypeMarket   = "market"
	OrderTypeStopLoss = "stop_loss"
	OrderTypeStopLimit = "stop_limit"

	TimeInForceGTC = "GTC"
	TimeInForceIOC = "IOC"
	TimeInForceFOK = "FOK"
)

// Order represents a trading order
type Order struct {
	OrderID           string    `json:"orderId"`
	UserID            string    `json:"userId"`
	Market            string    `json:"market"`
	Side             string    `json:"side"`
	Type             string    `json:"type"`
	TimeInForce      string    `json:"timeInForce"`
	Price            float64   `json:"price"`
	StopPrice        float64   `json:"stopPrice,omitempty"`
	Quantity         float64   `json:"quantity"`
	FilledQuantity   float64   `json:"filledQuantity"`
	Remaining        float64   `json:"remaining"`
	AverageFillPrice float64   `json:"avgFillPrice"`
	Status           string    `json:"status"`
	Fees             float64   `json:"fees"`
	Leverage         float64   `json:"leverage"`
	MarginUsed       float64   `json:"marginUsed"`
	CreatedAt        int64     `json:"createdAt"`
	UpdatedAt        int64     `json:"updatedAt"`
}

// Trade represents an executed trade
type Trade struct {
	TradeID       string  `json:"tradeId"`
	OrderID       string  `json:"orderId"`
	Market        string  `json:"market"`
	Side          string  `json:"side"`
	Price         float64 `json:"price"`
	Quantity      float64 `json:"quantity"`
	QuoteQuantity float64 `json:"quoteQuantity"`
	MakerFee      float64 `json:"makerFee"`
	TakerFee      float64 `json:"takerFee"`
	Timestamp     int64   `json:"timestamp"`
}

// OrderBook price level
type PriceLevel struct {
	Price    float64  `json:"price"`
	Quantity float64  `json:"quantity"`
	Orders   []*Order `json:"orders"`
}

// Market represents a trading market
type Market struct {
	Symbol         string       `json:"symbol"`
	BaseAsset      string       `json:"baseAsset"`
	QuoteAsset     string       `json:"quoteAsset"`
	Status         string       `json:"status"`
	PricePrecision int          `json:"pricePrecision"`
	QtyPrecision   int          `json:"qtyPrecision"`
	TickSize      float64      `json:"tickSize"`
	LotSize       float64      `json:"lotSize"`
	Bids          []*PriceLevel `json:"bids"`
	Asks          []*PriceLevel `json:"asks"`

	// Stats
	LastPrice   float64 `json:"lastPrice"`
	High24h     float64 `json:"high24h"`
	Low24h      float64 `json:"low24h"`
	Volume24h   float64 `json:"volume24h"`
	Trades24h   int64   `json:"trades24h"`
	LastUpdated  int64   `json:"lastUpdated"`
}

// OrderManager - High-performance order management system
type OrderManager struct {
	mu sync.RWMutex

	// Order storage
	orders      map[string]*Order
	userOrders map[string]map[string]*Order // userID -> orderID -> Order
	marketOrders map[string]map[string]*Order // market -> orderID -> Order

	// Markets
	markets map[string]*Market

	// Order channels for matching
	orderChan chan *Order
	tradeChan chan *Trade

	// Metrics
	TotalOrders     int64 `json:"totalOrders"`
	ActiveOrders   int64 `json:"activeOrders"`
	TotalTrades    int64 `json:"totalTrades"`
	OrdersPerSec   int64 `json:"ordersPerSec"`

	// Fee config
	MakerFee float64
	TakerFee float64

	// Running state
	running bool
}

// NewOrderManager creates a new order manager
func NewOrderManager() *OrderManager {
	return &OrderManager{
		orders:        make(map[string]*Order),
		userOrders:    make(map[string]map[string]*Order),
		marketOrders:  make(map[string]map[string]*Order),
		markets:       make(map[string]*Market),
		orderChan:    make(chan *Order, 10000),
		tradeChan:    make(chan *Trade, 10000),
		MakerFee:      0.001,
		TakerFee:      0.001,
		running:      false,
	}
}

// InitializeMarket creates a new market
func (om *OrderManager) InitializeMarket(symbol, base, quote string, tickSize, lotSize float64) error {
	om.mu.Lock()
	defer om.mu.Unlock()

	if _, exists := om.markets[symbol]; exists {
		return fmt.Errorf("market %s already exists", symbol)
	}

	om.markets[symbol] = &Market{
		Symbol:     symbol,
		BaseAsset:  base,
		QuoteAsset: quote,
		Status:     "trading",
		TickSize:   tickSize,
		LotSize:    lotSize,
		Bids:       make([]*PriceLevel, 0),
		Asks:       make([]*PriceLevel, 0),
		High24h:    0,
		Low24h:     0,
		Volume24h:   0,
	}

	return nil
}

// SubmitOrder creates and processes a new order
func (om *OrderManager) SubmitOrder(order *Order) (*Order, error) {
	om.mu.Lock()
	defer om.mu.Unlock()

	// Validate market
	market, exists := om.markets[order.Market]
	if !exists {
		order.Status = OrderStatusRejected
		return order, fmt.Errorf("market not found: %s", order.Market)
	}

	// Validate order
	if order.Quantity <= 0 {
		order.Status = OrderStatusRejected
		return order, fmt.Errorf("invalid quantity")
	}

	if order.Type == OrderTypeLimit && order.Price <= 0 {
		order.Status = OrderStatusRejected
		return order, fmt.Errorf("price required for limit order")
	}

	// Generate order ID
	order.OrderID = uuid.New().String()
	order.Status = OrderStatusNew
	order.FilledQuantity = 0
	order.Remaining = order.Quantity
	order.AverageFillPrice = 0
	order.Fees = 0
	order.CreatedAt = time.Now().UnixMilli()
	order.UpdatedAt = order.CreatedAt

	// Store order
	om.orders[order.OrderID] = order

	// Index by user
	if om.userOrders[order.UserID] == nil {
		om.userOrders[order.UserID] = make(map[string]*Order)
	}
	om.userOrders[order.UserID][order.OrderID] = order

	// Index by market
	if om.marketOrders[order.Market] == nil {
		om.marketOrders[order.Market] = make(map[string]*Order)
	}
	om.marketOrders[order.Market][order.OrderID] = order

	// Update metrics
	atomic.AddInt64(&om.TotalOrders, 1)
	atomic.AddInt64(&om.ActiveOrders, 1)

	// Process order based on type
	switch order.Type {
	case OrderTypeMarket:
		om.executeMarketOrder(order, market)
	case OrderTypeLimit:
		om.executeLimitOrder(order, market)
	}

	return order, nil
}

// executeMarketOrder executes a market order immediately
func (om *OrderManager) executeMarketOrder(order *Order, market *Market) {
	var trades []Trade

	// Get opposing side
	var levels []*PriceLevel
	if order.Side == OrderSideBuy {
		levels = market.Asks
	} else {
		levels = market.Bids
	}

	// Match against book
	remaining := order.Remaining
	for _, level := range levels {
		if remaining <= 0 {
			break
		}

		if level.Quantity <= 0 {
			continue
		}

		qty := min(remaining, level.Quantity)
		trade := Trade{
			TradeID:       uuid.New().String(),
			OrderID:       order.OrderID,
			Market:        order.Market,
			Side:          order.Side,
			Price:         level.Price,
			Quantity:      qty,
			QuoteQuantity: level.Price * qty,
			MakerFee:      level.Price * qty * om.MakerFee,
			TakerFee:      level.Price * qty * om.TakerFee,
			Timestamp:     time.Now().UnixMilli(),
		}
		trades = append(trades, trade)

		order.FilledQuantity += qty
		order.Fees += trade.TakerFee
		remaining -= qty

		level.Quantity -= qty

		// Update market stats
		market.LastPrice = level.Price
		market.Volume24h += qty
		market.Trades24h++
		if market.High24h == 0 || level.Price > market.High24h {
			market.High24h = level.Price
		}
		if market.Low24h == 0 || level.Price < market.Low24h {
			market.Low24h = level.Price
		}
	}

	order.Remaining = remaining
	if order.FilledQuantity > 0 {
		if order.Remaining <= 0 {
			order.Status = OrderStatusFilled
			atomic.AddInt64(&om.ActiveOrders, -1)
		} else {
			order.Status = OrderStatusPartial
		}
		order.AverageFillPrice = calculateAvgPrice(trades)
	} else {
		order.Status = OrderStatusRejected
		order.Fees = 0
	}

	order.UpdatedAt = time.Now().UnixMilli()
	atomic.AddInt64(&om.TotalTrades, int64(len(trades)))
}

// executeLimitOrder adds limit order to book
func (om *OrderManager) executeLimitOrder(order *Order, market *Market) {
	// Normalize price
	order.Price = normalizePrice(order.Price, market.TickSize)

	// Add to appropriate side
	level := &PriceLevel{
		Price:    order.Price,
		Quantity: order.Remaining,
		Orders:   []*Order{order},
	}

	if order.Side == OrderSideBuy {
		market.Bids = addPriceLevel(market.Bids, level, true)
	} else {
		market.Asks = addPriceLevel(market.Asks, level, false)
	}

	order.Status = OrderStatusNew
}

// CancelOrder cancels an order
func (om *OrderManager) CancelOrder(orderID, userID string) error {
	om.mu.Lock()
	defer om.mu.Unlock()

	order, exists := om.orders[orderID]
	if !exists {
		return fmt.Errorf("order not found")
	}

	if order.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if order.Status == OrderStatusFilled || order.Status == OrderStatusCanceled {
		return fmt.Errorf("order already %s", order.Status)
	}

	order.Status = OrderStatusCanceled
	order.UpdatedAt = time.Now().UnixMilli()
	atomic.AddInt64(&om.ActiveOrders, -1)

	return nil
}

// GetOrder returns order by ID
func (om *OrderManager) GetOrder(orderID string) (*Order, error) {
	om.mu.RLock()
	defer om.mu.RUnlock()

	order, exists := om.orders[orderID]
	if !exists {
		return nil, fmt.Errorf("order not found")
	}

	return order, nil
}

// GetUserOrders returns all orders for a user
func (om *OrderManager) GetUserOrders(userID string) []*Order {
	om.mu.RLock()
	defer om.mu.RUnlock()

	orders := make([]*Order, 0)
	if userOrders, ok := om.userOrders[userID]; ok {
		for _, order := range userOrders {
			orders = append(orders, order)
		}
	}

	return orders
}

// GetMarketOrders returns all orders for a market
func (om *OrderManager) GetMarketOrders(market string) []*Order {
	om.mu.RLock()
	defer om.mu.RUnlock()

	orders := make([]*Order, 0)
	if marketOrders, ok := om.marketOrders[market]; ok {
		for _, order := range marketOrders {
			orders = append(orders, order)
		}
	}

	return orders
}

// GetOpenOrders returns all open orders for a user
func (om *OrderManager) GetOpenOrders(userID string) []*Order {
	om.mu.RLock()
	defer om.mu.RUnlock()

	orders := make([]*Order, 0)
	if userOrders, ok := om.userOrders[userID]; ok {
		for _, order := range userOrders {
			if order.Status == OrderStatusNew || order.Status == OrderStatusPartial {
				orders = append(orders, order)
			}
		}
	}

	return orders
}

// GetOrderBook returns market depth
func (om *OrderManager) GetOrderBook(symbol string, limit int) (map[string]interface{}, error) {
	om.mu.RLock()
	defer om.mu.RUnlock()

	market, exists := om.markets[symbol]
	if !exists {
		return nil, fmt.Errorf("market not found")
	}

	bids := make([]map[string]interface{}, 0)
	for i, level := range market.Bids {
		if i >= limit {
			break
		}
		if level.Quantity > 0 {
			bids = append(bids, map[string]interface{}{
				"price":    level.Price,
				"quantity": level.Quantity,
			})
		}
	}

	asks := make([]map[string]interface{}, 0)
	for i, level := range market.Asks {
		if i >= limit {
			break
		}
		if level.Quantity > 0 {
			asks = append(asks, map[string]interface{}{
				"price":    level.Price,
				"quantity": level.Quantity,
			})
		}
	}

	return map[string]interface{}{
		"symbol":       symbol,
		"bids":         bids,
		"asks":         asks,
		"lastUpdateId": market.LastUpdated,
	}, nil
}

// GetTicker returns market ticker
func (om *OrderManager) GetTicker(symbol string) (map[string]interface{}, error) {
	om.mu.RLock()
	defer om.mu.RUnlock()

	market, exists := om.markets[symbol]
	if !exists {
		return nil, fmt.Errorf("market not found")
	}

	return map[string]interface{}{
		"symbol":        symbol,
		"lastPrice":     market.LastPrice,
		"high24h":       market.High24h,
		"low24h":        market.Low24h,
		"volume24h":     market.Volume24h,
		"trades24h":     market.Trades24h,
		"priceChange":    market.LastPrice - (market.LastPrice - market.Volume24h), // Simplified
		"priceChange24h": (market.LastPrice - market.Low24h) / market.Low24h * 100,
	}, nil
}

// GetMetrics returns order manager metrics
func (om *OrderManager) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"totalOrders":   atomic.LoadInt64(&om.TotalOrders),
		"activeOrders": atomic.LoadInt64(&om.ActiveOrders),
		"totalTrades":  atomic.LoadInt64(&om.TotalTrades),
		"ordersPerSec": atomic.LoadInt64(&om.OrdersPerSec),
	}
}

// Helper functions
func normalizePrice(price, tick float64) float64 {
	return mathRound(price/tick) * tick
}

func mathRound(val float64) float64 {
	if val < 0 {
		return mathCeil(val - 0.5)
	}
	return mathFloor(val + 0.5)
}

func mathFloor(val float64) float64 {
	return float64(int64(val))
}

func mathCeil(val float64) float64 {
	if val == float64(int64(val)) {
		return val
	}
	return float64(int64(val) + 1)
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func calculateAvgPrice(trades []Trade) float64 {
	if len(trades) == 0 {
		return 0
	}

	var total, qty float64
	for _, t := range trades {
		total += t.Price * t.Quantity
		qty += t.Quantity
	}

	if qty == 0 {
		return 0
	}

	return total / qty
}

func addPriceLevel(levels []*PriceLevel, newLevel *PriceLevel, descending bool) []*PriceLevel {
	for i, level := range levels {
		if descending {
			if level.Price < newLevel.Price {
				// Insert before
				return append(levels[:i], append([]*PriceLevel{newLevel}, levels[i:]...)...)
			}
			if level.Price == newLevel.Price {
				// Combine
				level.Quantity += newLevel.Quantity
				level.Orders = append(level.Orders, newLevel.Orders...)
				return levels
			}
		} else {
			if level.Price > newLevel.Price {
				return append(levels[:i], append([]*PriceLevel{newLevel}, levels[i:]...)...)
			}
			if level.Price == newLevel.Price {
				level.Quantity += newLevel.Quantity
				level.Orders = append(level.Orders, newLevel.Orders...)
				return levels
			}
		}
	}

	// Append at end
	return append(levels, newLevel)
}

// Main entry point
func main() {
	fmt.Println("TigerEx Order Manager (Go)")
	fmt.Println("============================\n")

	om := NewOrderManager()

	// Initialize markets
	markets := []struct{ Symbol, Base, Quote string }{
		{"BTC/USDT", "BTC", "USDT"},
		{"ETH/USDT", "ETH", "USDT"},
		{"SOL/USDT", "SOL", "USDT"},
	}

	for _, m := range markets {
		err := om.InitializeMarket(m.Symbol, m.Base, m.Quote, 0.01, 0.0001)
		if err != nil {
			log.Printf("Market init error: %v", err)
		}
	}

	// Submit orders
	orders := []*Order{
		{UserID: "user1", Market: "BTC/USDT", Side: OrderSideBuy, Type: OrderTypeLimit, Price: 50000, Quantity: 1.0, TimeInForce: TimeInForceGTC},
		{UserID: "user2", Market: "BTC/USDT", Side: OrderSideSell, Type: OrderTypeLimit, Price: 50100, Quantity: 0.5, TimeInForce: TimeInForceGTC},
		{UserID: "user3", Market: "BTC/USDT", Side: OrderSideBuy, Type: OrderTypeMarket, Quantity: 0.1},
	}

	for _, o := range orders {
		submitted, err := om.SubmitOrder(o)
		if err != nil {
			fmt.Printf("Order error: %v\n", err)
			continue
		}
		fmt.Printf("Order %s: %s - filled %.4f @ %.2f\n", 
			submitted.OrderID[:8], submitted.Status, submitted.FilledQuantity, submitted.AverageFillPrice)
	}

	// Get order book
	book, _ := om.GetOrderBook("BTC/USDT", 5)
	bookJSON, _ := json.MarshalIndent(book, "", "  ")
	fmt.Printf("\nOrder Book:\n%s\n", string(bookJSON))

	// Get ticker
	ticker, _ := om.GetTicker("BTC/USDT")
	tickerJSON, _ := json.MarshalIndent(ticker, "", "  ")
	fmt.Printf("\nTicker:\n%s\n", string(tickerJSON))

	// Get metrics
	metrics := om.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nOrder Manager ready.")
}