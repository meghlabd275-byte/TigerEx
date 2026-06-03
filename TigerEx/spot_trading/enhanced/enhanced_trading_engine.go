package spot_trading

import (
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// OrderType represents the type of order
type OrderType string

const (
	OrderTypeMarket    OrderType = "MARKET"
	OrderTypeLimit     OrderType = "LIMIT"
	OrderTypeStop      OrderType = "STOP"
	OrderTypeStopLimit OrderType = "STOP_LIMIT"
	OrderTypeOCO       OrderType = "OCO"
	OrderTypePostOnly  OrderType = "POST_ONLY"
	OrderTypeIOC       OrderType = "IOC"
	OrderTypeFOK       OrderType = "FOK"
)

// OrderSide represents buy or sell
type OrderSide string

const (
	OrderSideBuy  OrderSide = "BUY"
	OrderSideSell OrderSide = "SELL"
)

// OrderStatus represents the current status of an order
type OrderStatus string

const (
	OrderStatusPending  OrderStatus = "PENDING"
	OrderStatusOpen     OrderStatus = "OPEN"
	OrderStatusPartial  OrderStatus = "PARTIAL"
	OrderStatusFilled   OrderStatus = "FILLED"
	OrderStatusCancelled OrderStatus = "CANCELLED"
	OrderStatusRejected OrderStatus = "REJECTED"
	OrderStatusExpired  OrderStatus = "EXPIRED"
)

// TimeInForce represents order time in force
type TimeInForce string

const (
	TIFGTC TimeInForce = "GTC" // Good Till Cancel
	TIFIOC TimeInForce = "IOC" // Immediate Or Cancel
	TIFFOK TimeInForce = "FOK" // Fill Or Kill
	TIFGTD TimeInForce = "GTD" // Good Till Date
)

// Order represents a trading order
type Order struct {
	ID            string      `json:"id"`
	Symbol        string      `json:"symbol"`
	Type          OrderType   `json:"type"`
	Side          OrderSide   `json:"side"`
	Price         float64     `json:"price"`
	StopPrice     float64     `json:"stop_price,omitempty"`
	Quantity      float64     `json:"quantity"`
	FilledQty     float64     `json:"filled_quantity"`
	AvgFillPrice  float64     `json:"avg_fill_price"`
	TimeInForce   TimeInForce `json:"time_in_force"`
	Status        OrderStatus `json:"status"`
	UserID        string      `json:"user_id"`
	CreatedAt     time.Time   `json:"created_at"`
	UpdatedAt     time.Time   `json:"updated_at"`
	TriggeredAt   *time.Time  `json:"triggered_at,omitempty"`
	ExpiresAt     *time.Time  `json:"expires_at,omitempty"`
	ClientOrderID string      `json:"client_order_id,omitempty"`
	ReduceOnly    bool        `json:"reduce_only"`
	PostOnly      bool        `json:"post_only"`
}

// Trade represents an executed trade
type Trade struct {
	ID           string    `json:"id"`
	OrderID      string    `json:"order_id"`
	Symbol       string    `json:"symbol"`
	Side         OrderSide `json:"side"`
	Price        float64   `json:"price"`
	Quantity     float64   `json:"quantity"`
	QuoteQty     float64   `json:"quote_quantity"`
	Fee          float64   `json:"fee"`
	FeeAsset     string    `json:"fee_asset"`
	TakerOrMaker string    `json:"taker_or_maker"`
	TradeTime    time.Time `json:"trade_time"`
}

// OrderBookLevel represents a price level in the order book
type OrderBookLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Orders   int     `json:"orders"`
}

// OrderBook represents the full order book
type OrderBook struct {
	Symbol       string           `json:"symbol"`
	Bids         []OrderBookLevel `json:"bids"`
	Asks         []OrderBookLevel `json:"asks"`
	LastUpdateID int64            `json:"last_update_id"`
	Timestamp    time.Time        `json:"timestamp"`
}

// TradingPair represents a trading pair configuration
type TradingPair struct {
	Symbol      string  `json:"symbol"`
	BaseAsset   string  `json:"base_asset"`
	QuoteAsset  string  `json:"quote_asset"`
	MinQty      float64 `json:"min_quantity"`
	MaxQty      float64 `json:"max_quantity"`
	StepSize    float64 `json:"step_size"`
	MinPrice    float64 `json:"min_price"`
	MaxPrice    float64 `json:"max_price"`
	TickSize    float64 `json:"tick_size"`
	MakerFee    float64 `json:"maker_fee"`
	TakerFee    float64 `json:"taker_fee"`
	IsTrading   bool    `json:"is_trading"`
	MinNotional float64 `json:"min_notional"`
}

// OrderService handles order operations
type OrderService struct {
	mu           sync.RWMutex
	orders       map[string]*Order
	userOrders   map[string][]string
	symbolOrders map[string][]string

	buyOrders  map[string][]*Order
	sellOrders map[string][]*Order

	tradeChan chan *Trade

	tradingPairs map[string]*TradingPair

	makerFee float64
	takerFee float64
}

// NewOrderService creates a new order service
func NewOrderService(makerFee, takerFee float64) *OrderService {
	return &OrderService{
		orders:        make(map[string]*Order),
		userOrders:    make(map[string][]string),
		symbolOrders:  make(map[string][]string),
		buyOrders:     make(map[string][]*Order),
		sellOrders:    make(map[string][]*Order),
		tradeChan:     make(chan *Trade, 10000),
		tradingPairs:  make(map[string]*TradingPair),
		makerFee:      makerFee,
		takerFee:      takerFee,
	}
}

// RegisterTradingPair registers a new trading pair
func (s *OrderService) RegisterTradingPair(pair *TradingPair) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tradingPairs[pair.Symbol] = pair
}

// CreateOrder creates a new order
func (s *OrderService) CreateOrder(order *Order) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pair, exists := s.tradingPairs[order.Symbol]
	if !exists {
		return nil, ErrTradingPairNotFound
	}

	if !isValidOrderType(order.Type) {
		return nil, ErrInvalidOrderType
	}

	order.Quantity = roundToStep(order.Quantity, pair.StepSize)

	if order.Type == OrderTypeLimit || order.Type == OrderTypeStopLimit {
		order.Price = roundToStep(order.Price, pair.TickSize)
	}

	order.Status = OrderStatusPending
	order.CreatedAt = time.Now()
	order.UpdatedAt = time.Now()

	s.orders[order.ID] = order
	s.userOrders[order.UserID] = append(s.userOrders[order.UserID], order.ID)
	s.symbolOrders[order.Symbol] = append(s.symbolOrders[order.Symbol], order.ID)

	switch order.Type {
	case OrderTypeMarket:
		return s.executeMarketOrder(order, pair)
	case OrderTypeLimit, OrderTypePostOnly:
		return s.addLimitOrder(order, pair)
	case OrderTypeStop, OrderTypeStopLimit:
		return s.addStopOrder(order)
	case OrderTypeIOC:
		return s.executeIOCOrder(order, pair)
	case OrderTypeFOK:
		return s.executeFOKOrder(order, pair)
	}

	return order, nil
}

func (s *OrderService) executeMarketOrder(order *Order, pair *TradingPair) (*Order, error) {
	var bestPrice float64

	if order.Side == OrderSideBuy {
		if len(s.sellOrders[order.Symbol]) == 0 {
			return nil, ErrInsufficientLiquidity
		}
		bestPrice = s.sellOrders[order.Symbol][0].Price
	} else {
		if len(s.buyOrders[order.Symbol]) == 0 {
			return nil, ErrInsufficientLiquidity
		}
		bestPrice = s.buyOrders[order.Symbol][0].Price
	}

	order.Status = OrderStatusFilled
	order.FilledQty = order.Quantity
	order.AvgFillPrice = bestPrice
	order.UpdatedAt = time.Now()

	trade := s.createTrade(order, bestPrice, pair)
	select {
	case s.tradeChan <- trade:
	default:
	}

	return order, nil
}

func (s *OrderService) addLimitOrder(order *Order, pair *TradingPair) (*Order, error) {
	order.Status = OrderStatusOpen

	if order.Side == OrderSideBuy {
		s.buyOrders[order.Symbol] = append(s.buyOrders[order.Symbol], order)
		s.sortBuyOrders(order.Symbol)
	} else {
		s.sellOrders[order.Symbol] = append(s.sellOrders[order.Symbol], order)
		s.sortSellOrders(order.Symbol)
	}

	s.tryMatch(order, pair)

	return order, nil
}

func (s *OrderService) addStopOrder(order *Order) (*Order, error) {
	if order.StopPrice <= 0 {
		return nil, ErrInvalidStopPrice
	}
	order.Status = OrderStatusPending
	return order, nil
}

func (s *OrderService) executeIOCOrder(order *Order, pair *TradingPair) (*Order, error) {
	var filledQty float64
	var totalQuote float64

	if order.Side == OrderSideBuy {
		for _, sellOrder := range s.sellOrders[order.Symbol] {
			if sellOrder.Price > order.Price {
				break
			}
			if filledQty >= order.Quantity {
				break
			}
			execQty := min(order.Quantity-filledQty, sellOrder.Quantity-sellOrder.FilledQty)
			filledQty += execQty
			totalQuote += execQty * sellOrder.Price
			sellOrder.FilledQty += execQty
			if sellOrder.FilledQty >= sellOrder.Quantity {
				sellOrder.Status = OrderStatusFilled
			} else {
				sellOrder.Status = OrderStatusPartial
			}
		}
	} else {
		for _, buyOrder := range s.buyOrders[order.Symbol] {
			if buyOrder.Price < order.Price {
				break
			}
			if filledQty >= order.Quantity {
				break
			}
			execQty := min(order.Quantity-filledQty, buyOrder.Quantity-buyOrder.FilledQty)
			filledQty += execQty
			totalQuote += execQty * buyOrder.Price
			buyOrder.FilledQty += execQty
			if buyOrder.FilledQty >= buyOrder.Quantity {
				buyOrder.Status = OrderStatusFilled
			} else {
				buyOrder.Status = OrderStatusPartial
			}
		}
	}

	order.FilledQty = filledQty
	if filledQty > 0 {
		order.AvgFillPrice = totalQuote / filledQty
		order.Status = OrderStatusFilled
	} else {
		order.Status = OrderStatusExpired
	}
	order.UpdatedAt = time.Now()

	_ = pair
	return order, nil
}

func (s *OrderService) executeFOKOrder(order *Order, pair *TradingPair) (*Order, error) {
	var availableQty float64

	if order.Side == OrderSideBuy {
		for _, sellOrder := range s.sellOrders[order.Symbol] {
			if sellOrder.Price > order.Price {
				break
			}
			availableQty += sellOrder.Quantity - sellOrder.FilledQty
		}
	} else {
		for _, buyOrder := range s.buyOrders[order.Symbol] {
			if buyOrder.Price < order.Price {
				break
			}
			availableQty += buyOrder.Quantity - buyOrder.FilledQty
		}
	}

	if availableQty < order.Quantity {
		order.Status = OrderStatusExpired
		order.UpdatedAt = time.Now()
		return order, nil
	}

	_ = pair
	return s.executeMarketOrder(order, pair)
}

func (s *OrderService) tryMatch(order *Order, pair *TradingPair) {
	if order.Side == OrderSideBuy {
		s.matchBuyOrder(order, pair)
	} else {
		s.matchSellOrder(order, pair)
	}
	s.cleanOrderBook(order.Symbol)
}

func (s *OrderService) matchBuyOrder(order *Order, pair *TradingPair) {
	for i, sellOrder := range s.sellOrders[order.Symbol] {
		if sellOrder.Price > order.Price {
			break
		}
		if order.FilledQty >= order.Quantity {
			break
		}

		execQty := min(order.Quantity-order.FilledQty, sellOrder.Quantity-sellOrder.FilledQty)
		price := sellOrder.Price

		order.FilledQty += execQty
		sellOrder.FilledQty += execQty

		order.AvgFillPrice = (order.AvgFillPrice*float64(i) + price) / float64(i+1)

		if sellOrder.FilledQty >= sellOrder.Quantity {
			sellOrder.Status = OrderStatusFilled
		} else {
			sellOrder.Status = OrderStatusPartial
		}

		if order.FilledQty >= order.Quantity {
			order.Status = OrderStatusFilled
		} else {
			order.Status = OrderStatusPartial
		}

		trade := s.createTradeFromMatch(order, sellOrder, price, execQty, pair)
		select {
		case s.tradeChan <- trade:
		default:
		}
	}
}

func (s *OrderService) matchSellOrder(order *Order, pair *TradingPair) {
	for i, buyOrder := range s.buyOrders[order.Symbol] {
		if buyOrder.Price < order.Price {
			break
		}
		if order.FilledQty >= order.Quantity {
			break
		}

		execQty := min(order.Quantity-order.FilledQty, buyOrder.Quantity-buyOrder.FilledQty)
		price := buyOrder.Price

		order.FilledQty += execQty
		buyOrder.FilledQty += execQty

		order.AvgFillPrice = (order.AvgFillPrice*float64(i) + price) / float64(i+1)

		if buyOrder.FilledQty >= buyOrder.Quantity {
			buyOrder.Status = OrderStatusFilled
		} else {
			buyOrder.Status = OrderStatusPartial
		}

		if order.FilledQty >= order.Quantity {
			order.Status = OrderStatusFilled
		} else {
			order.Status = OrderStatusPartial
		}

		trade := s.createTradeFromMatch(order, buyOrder, price, execQty, pair)
		select {
		case s.tradeChan <- trade:
		default:
		}
	}
}

func (s *OrderService) cleanOrderBook(symbol string) {
	filteredBuys := make([]*Order, 0)
	for _, order := range s.buyOrders[symbol] {
		if order.Status != OrderStatusFilled {
			filteredBuys = append(filteredBuys, order)
		}
	}
	s.buyOrders[symbol] = filteredBuys

	filteredSells := make([]*Order, 0)
	for _, order := range s.sellOrders[symbol] {
		if order.Status != OrderStatusFilled {
			filteredSells = append(filteredSells, order)
		}
	}
	s.sellOrders[symbol] = filteredSells
}

// CancelOrder cancels an order
func (s *OrderService) CancelOrder(orderID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, exists := s.orders[orderID]
	if !exists {
		return ErrOrderNotFound
	}

	if order.UserID != userID {
		return ErrUnauthorized
	}

	if order.Status == OrderStatusFilled || order.Status == OrderStatusCancelled {
		return ErrCannotCancelOrder
	}

	order.Status = OrderStatusCancelled
	order.UpdatedAt = time.Now()

	return nil
}

// GetOrder retrieves an order
func (s *OrderService) GetOrder(orderID string) (*Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, exists := s.orders[orderID]
	if !exists {
		return nil, ErrOrderNotFound
	}

	return order, nil
}

// GetOrderBook retrieves the order book for a symbol
func (s *OrderService) GetOrderBook(symbol string, limit int) (*OrderBook, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, exists := s.tradingPairs[symbol]; !exists {
		return nil, ErrTradingPairNotFound
	}

	book := &OrderBook{
		Symbol:       symbol,
		LastUpdateID: time.Now().UnixNano(),
		Timestamp:    time.Now(),
	}

	bidMap := make(map[float64]OrderBookLevel)
	for _, order := range s.buyOrders[symbol] {
		if order.Status == OrderStatusOpen || order.Status == OrderStatusPartial {
			level := bidMap[order.Price]
			level.Price = order.Price
			level.Quantity += order.Quantity - order.FilledQty
			level.Orders++
			bidMap[order.Price] = level
		}
	}

	for price, level := range bidMap {
		book.Bids = append(book.Bids, level)
		if len(book.Bids) >= limit {
			break
		}
	}

	askMap := make(map[float64]OrderBookLevel)
	for _, order := range s.sellOrders[symbol] {
		if order.Status == OrderStatusOpen || order.Status == OrderStatusPartial {
			level := askMap[order.Price]
			level.Price = order.Price
			level.Quantity += order.Quantity - order.FilledQty
			level.Orders++
			askMap[order.Price] = level
		}
	}

	for price, level := range askMap {
		book.Asks = append(book.Asks, level)
		if len(book.Asks) >= limit {
			break
		}
	}

	return book, nil
}

func (s *OrderService) createTrade(order *Order, price float64, pair *TradingPair) *Trade {
	fee := price * order.Quantity * s.takerFee

	return &Trade{
		ID:           generateID(),
		OrderID:      order.ID,
		Symbol:       order.Symbol,
		Side:         order.Side,
		Price:        price,
		Quantity:     order.Quantity,
		QuoteQty:     price * order.Quantity,
		Fee:          fee,
		FeeAsset:     pair.QuoteAsset,
		TakerOrMaker: "TAKER",
		TradeTime:    time.Now(),
	}
}

func (s *OrderService) createTradeFromMatch(taker, maker *Order, price, qty float64, pair *TradingPair) *Trade {
	fee := price * qty * s.takerFee

	return &Trade{
		ID:           generateID(),
		OrderID:      taker.ID,
		Symbol:       taker.Symbol,
		Side:         taker.Side,
		Price:        price,
		Quantity:     qty,
		QuoteQty:     price * qty,
		Fee:          fee,
		FeeAsset:     pair.QuoteAsset,
		TakerOrMaker: "TAKER",
		TradeTime:    time.Now(),
	}
}

func (s *OrderService) sortBuyOrders(symbol string) {
	orders := s.buyOrders[symbol]
	for i := 0; i < len(orders)-1; i++ {
		for j := i + 1; j < len(orders); j++ {
			if orders[j].Price > orders[i].Price {
				orders[i], orders[j] = orders[j], orders[i]
			}
		}
	}
}

func (s *OrderService) sortSellOrders(symbol string) {
	orders := s.sellOrders[symbol]
	for i := 0; i < len(orders)-1; i++ {
		for j := i + 1; j < len(orders); j++ {
			if orders[j].Price < orders[i].Price {
				orders[i], orders[j] = orders[j], orders[i]
			}
		}
	}
}

func isValidOrderType(t OrderType) bool {
	validTypes := []OrderType{
		OrderTypeMarket, OrderTypeLimit, OrderTypeStop,
		OrderTypeStopLimit, OrderTypeOCO, OrderTypePostOnly,
		OrderTypeIOC, OrderTypeFOK,
	}
	for _, vt := range validTypes {
		if t == vt {
			return true
		}
	}
	return false
}

func roundToStep(value, step float64) float64 {
	return float64(int(value/step)) * step
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func generateID() string {
	return fmt.Sprintf("%d_%d", time.Now().UnixNano(), rand.Int63())
}

// Custom errors
var (
	ErrTradingPairNotFound   = errors.New("trading pair not found")
	ErrInvalidOrderType       = errors.New("invalid order type")
	ErrInvalidQuantity        = errors.New("invalid quantity")
	ErrInvalidPrice           = errors.New("invalid price")
	ErrInvalidStopPrice       = errors.New("invalid stop price")
	ErrBelowMinNotional       = errors.New("order value below minimum notional")
	ErrInsufficientLiquidity  = errors.New("insufficient liquidity")
	ErrWouldTakeLiquidity     = errors.New("post-only order would take liquidity")
	ErrOrderNotFound          = errors.New("order not found")
	ErrUnauthorized           = errors.New("unauthorized")
	ErrCannotCancelOrder      = errors.New("cannot cancel order")
)