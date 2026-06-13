package matching

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

type Engine struct {
	config MatchingConfig
	orderBooks map[string]*OrderBook
	mu        sync.RWMutex
}

type MatchingConfig struct {
	OrderBookDepth    int
	MaxOrdersPerPair int
	PricePrecision   int
	LatencyTarget    time.Duration
	EngineType       string
}

type OrderBook struct {
	Symbol     string
	Bids      []*Order // Buy orders (price descending)
	Asks      []*Order // Sell orders (price ascending)
	LastPrice float64
	LastTime  time.Time
}

type Order struct {
	OrderID     string
	UserID      string
	Symbol      string
	Side        OrderSide
	Type        OrderType
	Price       float64
	Quantity    float64
	Remaining   float64
	Timestamp   time.Time
	Status      OrderStatus
	StopPrice   float64
}

type OrderSide string
type OrderType string
type OrderStatus string

const (
	SideBuy  OrderSide = "buy"
	SideSell OrderSide = "sell"

	TypeLimit        OrderType = "limit"
	TypeMarket      OrderType = "market"
	TypeStopLoss    OrderType = "stop_loss"
	TypeStopLimit   OrderType = "stop_limit"
	TypeOCO         OrderType = "oco"
	TypeTrailingStop OrderType = "trailing_stop"

	StatusNew        OrderStatus = "new"
	StatusPartial    OrderStatus = "partial"
	StatusFilled     OrderStatus = "filled"
	StatusCancelled  OrderStatus = "cancelled"
	StatusRejected   OrderStatus = "rejected"
)

func NewEngine(config MatchingConfig) *Engine {
	return &Engine{
		config:     config,
		orderBooks: make(map[string]*OrderBook),
	}
}

func (e *Engine) AddOrder(order *Order) ([]*Trade, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	ob := e.getOrCreateOrderBook(order.Symbol)

	switch order.Type {
	case TypeMarket:
		return e.executeMarketOrder(ob, order)
	case TypeLimit:
		return e.executeLimitOrder(ob, order)
	case TypeStopLoss, TypeStopLimit:
		return e.addStopOrder(ob, order)
	case TypeOCO:
		return e.executeOCO(ob, order)
	case TypeTrailingStop:
		return e.executeTrailingStop(ob, order)
	default:
		return nil, fmt.Errorf("unsupported order type")
	}
}

func (e *Engine) CancelOrder(orderID, symbol string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	ob, exists := e.orderBooks[symbol]
	if !exists {
		return fmt.Errorf("order book not found")
	}

	// Remove from bids
	for i, order := range ob.Bids {
		if order.OrderID == orderID {
			order.Status = StatusCancelled
			ob.Bids = append(ob.Bids[:i], ob.Bids[i+1:]...)
			return nil
		}
	}

	// Remove from asks
	for i, order := range ob.Asks {
		if order.OrderID == orderID {
			order.Status = StatusCancelled
			ob.Asks = append(ob.Asks[:i], ob.Asks[i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("order not found")
}

func (e *Engine) GetOrderBook(symbol string) (*OrderBook, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	ob, exists := e.orderBooks[symbol]
	if !exists {
		return nil, fmt.Errorf("order book not found")
	}

	return ob, nil
}

func (e *Engine) getOrCreateOrderBook(symbol string) *OrderBook {
	if ob, exists := e.orderBooks[symbol]; exists {
		return ob
	}

	ob := &OrderBook{
		Symbol: symbol,
		Bids:   make([]*Order, 0),
		Asks:   make([]*Order, 0),
	}
	e.orderBooks[symbol] = ob
	return ob
}

func (e *Engine) executeMarketOrder(ob *OrderBook, order *Order) ([]*Trade, error) {
	var trades []*Trade

	if order.Side == SideBuy {
		// Match with lowest asks
		for len(ob.Asks) > 0 && order.Remaining > 0 {
			ask := ob.Asks[0]
			if ask.Status == StatusCancelled {
				ob.Asks = ob.Asks[1:]
				continue
			}

			tradeQty := min(order.Remaining, ask.Remaining)
			price := ask.Price

			trades = append(trades, &Trade{
				MakerOrderID: ask.OrderID,
				TakerOrderID: order.OrderID,
				Symbol:      order.Symbol,
				Price:       price,
				Quantity:    tradeQty,
				Time:        time.Now(),
			})

			order.Remaining -= tradeQty
			ask.Remaining -= tradeQty

			if ask.Remaining <= 0 {
				ask.Status = StatusFilled
				ob.Asks = ob.Asks[1:]
			} else {
				ask.Status = StatusPartial
			}
		}
	} else {
		// Match with highest bids
		for len(ob.Bids) > 0 && order.Remaining > 0 {
			bid := ob.Bids[0]
			if bid.Status == StatusCancelled {
				ob.Bids = ob.Bids[1:]
				continue
			}

			tradeQty := min(order.Remaining, bid.Remaining)
			price := bid.Price

			trades = append(trades, &Trade{
				MakerOrderID: bid.OrderID,
				TakerOrderID: order.OrderID,
				Symbol:      order.Symbol,
				Price:       price,
				Quantity:    tradeQty,
				Time:        time.Now(),
			})

			order.Remaining -= tradeQty
			bid.Remaining -= tradeQty

			if bid.Remaining <= 0 {
				bid.Status = StatusFilled
				ob.Bids = ob.Bids[1:]
			} else {
				bid.Status = StatusPartial
			}
		}
	}

	if order.Remaining > 0 {
		order.Status = StatusPartial
	} else {
		order.Status = StatusFilled
	}

	if len(trades) > 0 {
		ob.LastPrice = trades[len(trades)-1].Price
		ob.LastTime = time.Now()
	}

	return trades, nil
}

func (e *Engine) executeLimitOrder(ob *OrderBook, order *Order) ([]*Trade, error) {
	var trades []*Trade

	if order.Side == SideBuy {
		// Check if we can match with existing asks
		for len(ob.Asks) > 0 && order.Remaining > 0 && ob.Asks[0].Price <= order.Price {
			ask := ob.Asks[0]
			if ask.Status == StatusCancelled {
				ob.Asks = ob.Asks[1:]
				continue
			}

			tradeQty := min(order.Remaining, ask.Remaining)
			price := ask.Price

			trades = append(trades, &Trade{
				MakerOrderID: ask.OrderID,
				TakerOrderID: order.OrderID,
				Symbol:      order.Symbol,
				Price:       price,
				Quantity:    tradeQty,
				Time:        time.Now(),
			})

			order.Remaining -= tradeQty
			ask.Remaining -= tradeQty

			if ask.Remaining <= 0 {
				ask.Status = StatusFilled
				ob.Asks = ob.Asks[1:]
			} else {
				ask.Status = StatusPartial
			}
		}

		// Add remaining to order book
		if order.Remaining > 0 {
			order.Remaining = order.Quantity
			order.Status = StatusNew
			ob.Bids = append(ob.Bids, order)
			sort.Slice(ob.Bids, func(i, j int) bool {
				return ob.Bids[i].Price > ob.Bids[j].Price
			})
		}
	} else {
		// Check if we can match with existing bids
		for len(ob.Bids) > 0 && order.Remaining > 0 && ob.Bids[0].Price >= order.Price {
			bid := ob.Bids[0]
			if bid.Status == StatusCancelled {
				ob.Bids = ob.Bids[1:]
				continue
			}

			tradeQty := min(order.Remaining, bid.Remaining)
			price := bid.Price

			trades = append(trades, &Trade{
				MakerOrderID: bid.OrderID,
				TakerOrderID: order.OrderID,
				Symbol:      order.Symbol,
				Price:       price,
				Quantity:    tradeQty,
				Time:        time.Now(),
			})

			order.Remaining -= tradeQty
			bid.Remaining -= tradeQty

			if bid.Remaining <= 0 {
				bid.Status = StatusFilled
				ob.Bids = ob.Bids[1:]
			} else {
				bid.Status = StatusPartial
			}
		}

		// Add remaining to order book
		if order.Remaining > 0 {
			order.Remaining = order.Quantity
			order.Status = StatusNew
			ob.Asks = append(ob.Asks, order)
			sort.Slice(ob.Asks, func(i, j int) bool {
				return ob.Asks[i].Price < ob.Asks[j].Price
			})
		}
	}

	if len(trades) > 0 {
		ob.LastPrice = trades[len(trades)-1].Price
		ob.LastTime = time.Now()
	}

	return trades, nil
}

func (e *Engine) executeOCO(ob *OrderBook, order *Order) ([]*Trade, error) {
	// One Cancels Other - implement logic
	return nil, nil
}

func (e *Engine) executeTrailingStop(ob *OrderBook, order *Order) ([]*Trade, error) {
	// Trailing stop - implement logic
	return nil, nil
}

func (e *Engine) addStopOrder(ob *OrderBook, order *Order) error {
	// Add stop order to pending list
	return nil
}

func (e *Engine) Shutdown() {
	// Cleanup
}

type Trade struct {
	MakerOrderID string
	TakerOrderID string
	Symbol      string
	Price       float64
	Quantity    float64
	Time        time.Time
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}