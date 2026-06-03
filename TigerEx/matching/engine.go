package matching

import (
	"container/heap"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// CORE TYPES
// =============================================================================

// Order represents a limit order
type Order struct {
	ID          string
	UserID     string
	Symbol     string
	Side       Side
	Type       OrderType
	Price      float64
	Quantity   float64
	Filled     float64
	StopPrice  float64
	TimeInForce TimeInForce
	Status     OrderStatus
	CreatedAt   time.Time
	UpdatedAt  time.Time
}

// Remaining returns remaining quantity
func (o *Order) Remaining() float64 {
	return o.Quantity - o.Filled
}

// Side order side
type Side string

const (
	Buy  Side = "BUY"
	Sell Side = "SELL"
)

// OrderType order type
type OrderType string

const (
	TypeMarket     OrderType = "MARKET"
	TypeLimit     OrderType = "LIMIT"
	TypeStopLoss  OrderType = "STOP_LOSS"
	TypeStopLimit OrderType = "STOP_LIMIT"
	TypeIOC      OrderType = "IOC"
	TypeFOK      OrderType = "FOK"
	TypePostOnly OrderType = "POST_ONLY"
)

// TimeInForce time in force
type TimeInForce string

const (
	GTC TimeInForce = "GTC"
	IOC TimeInForce = "IOC"
	FOK TimeInForce = "FOK"
	GTX TimeInForce = "GTX"
)

// OrderStatus order status
type OrderStatus string

const (
	StatusNew        OrderStatus = "NEW"
	StatusOpen       OrderStatus = "OPEN"
	StatusPartially OrderStatus = "PARTIALLY_FILLED"
	StatusFilled    OrderStatus = "FILLED"
	StatusCancelled OrderStatus = "CANCELLED"
	StatusRejected OrderStatus = "REJECTED"
	StatusExpired   OrderStatus = "EXPIRED"
)

// =============================================================================
// PRICE LEVEL
// =============================================================================

// Level represents a price level
type Level struct {
	Price    float64
	Quantity float64
	Orders   []string
}

// =============================================================================
// ORDER BOOK
// =============================================================================

// OrderBook represents a limit order book
type OrderBook struct {
	mu sync.RWMutex
	symbol  string

	// Price levels
	bids priceHeap
	asks priceHeap

	// Order lookup
	orders map[string]*Order

	// Market data
	lastPrice float64
	volume24h float64
}

// NewOrderBook creates a new order book
func NewOrderBook(symbol string) *OrderBook {
	ob := &OrderBook{
		symbol:  symbol,
		bids:   make(priceHeap, 0),
		asks:  make(priceHeap, 0),
		orders: make(map[string]*Order),
	}
	heap.Init(&ob.bids)
	heap.Init(&ob.asks)
	return ob
}

// AddOrder adds an order to the book
func (ob *OrderBook) AddOrder(order *Order) error {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	order.Status = StatusOpen
	order.CreatedAt = time.Now()
	order.UpdatedAt = time.Now()

	ob.orders[order.ID] = order

	if order.Side == Buy {
		ob.addToLevel(&ob.bids, order.Price, order.Remaining())
	} else {
		ob.addToLevel(&ob.asks, order.Price, order.Remaining())
	}

	return nil
}

// CancelOrder cancels an order
func (ob *OrderBook) CancelOrder(orderID string) error {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	order, ok := ob.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status != StatusOpen && order.Status != StatusPartially {
		return fmt.Errorf("order cannot be cancelled")
	}

	order.Status = StatusCancelled
	order.UpdatedAt = time.Now()

	return nil
}

// Match executes matching
func (ob *OrderBook) Match() ([]*Trade, error) {
	ob.mu.Lock()
	defer ob.mu.Unlock()

	var trades []*Trade

	for ob.bids.Len() > 0 && ob.asks.Len() > 0 {
		bestBid := ob.bids[0]
		bestAsk := ob.asks[0]

		if bestBid.Price < bestAsk.Price {
			break
		}

		bidQty := bestBid.Quantity
		askQty := bestAsk.Quantity
		quantity := minFloat(bidQty, askQty)
		price := bestAsk.Price

		trade := &Trade{
			ID:        uuid.New().String(),
			Symbol:   ob.symbol,
			Price:    price,
			Quantity: quantity,
			Time:     time.Now(),
		}
		trades = append(trades, trade)

		ob.bids[0].Quantity -= quantity
		ob.asks[0].Quantity -= quantity

		if ob.bids[0].Quantity <= 0 {
			heap.Pop(&ob.bids)
		}
		if ob.asks[0].Quantity <= 0 {
			heap.Pop(&ob.asks)
		}

		ob.lastPrice = price
		ob.volume24h += quantity
	}

	return trades, nil
}

// GetBestBid returns best bid
func (ob *OrderBook) GetBestBid() (float64, bool) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	if ob.bids.Len() > 0 {
		return ob.bids[0].Price, true
	}
	return 0, false
}

// GetBestAsk returns best ask
func (ob *OrderBook) GetBestAsk() (float64, bool) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	if ob.asks.Len() > 0 {
		return ob.asks[0].Price, true
	}
	return 0, false
}

// GetSpread returns spread
func (ob *OrderBook) GetSpread() (float64, error) {
	bid, _ := ob.GetBestBid()
	ask, _ := ob.GetBestAsk()

	if bid == 0 || ask == 0 {
		return 0, fmt.Errorf("no spread")
	}

	return ask - bid, nil
}

// GetDepth returns depth
func (ob *OrderBook) GetDepth(depth int) ([]*Level, []*Level) {
	ob.mu.RLock()
	defer ob.mu.RUnlock()

	bids := make([]*Level, 0)
	for i := 0; i < minInt(depth, ob.bids.Len()); i++ {
		bids = append(bids, &Level{
			Price:    ob.bids[i].Price,
			Quantity: ob.bids[i].Quantity,
		})
	}

	asks := make([]*Level, 0)
	for i := 0; i < minInt(depth, ob.asks.Len()); i++ {
		asks = append(asks, &Level{
			Price:    ob.asks[i].Price,
			Quantity: ob.asks[i].Quantity,
		})
	}

	return bids, asks
}

// AddToLevel adds quantity to price level
func (ob *OrderBook) addToLevel(h *priceHeap, price, qty float64) {
	for i, level := range *h {
		if level.Price == price {
			level.Quantity += qty
			heap.Fix(h, i)
			return
		}
	}
	heap.Push(h, &priceLevel{Price: price, Quantity: qty})
}

// =============================================================================
// PRICE HEAP
// =============================================================================

type priceLevel struct {
	Price    float64
	Quantity float64
}

type priceHeap []*priceLevel

func (h priceHeap) Len() int { return len(h) }

func (h priceHeap) Less(i, j int) bool {
	return h[i].Price < h[j].Price || (h[i].Price == h[j].Price && h[i].Quantity < h[j].Quantity)
}

func (h priceHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
}

func (h *priceHeap) Push(x interface{}) {
	*h = append(*h, x.(*priceLevel))
}

func (h priceHeap) Pop() interface{} {
	old := h
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	*h = old[0:n-1]
	return item
}

// =============================================================================
// TRADE
// =============================================================================

type Trade struct {
	ID        string
	Symbol   string
	Side     Side
	Price    float64
	Quantity float64
	MakerID  string
	TakerID  string
	Time     time.Time
}

// =============================================================================
// MATCHING ENGINE
// =============================================================================

// Engine represents matching engine
type Engine struct {
	mu sync.RWMutex
	books  map[string]*OrderBook
	orders map[string]*Order
}

// NewEngine creates matching engine
func NewEngine() *Engine {
	return &Engine{
		books:  make(map[string]*OrderBook),
		orders: make(map[string]*Order),
	}
}

// GetOrCreateBook gets or creates book
func (e *Engine) GetOrCreateBook(symbol string) *OrderBook {
	e.mu.Lock()
	defer e.mu.Unlock()

	book, ok := e.books[symbol]
	if !ok {
		book = NewOrderBook(symbol)
		e.books[symbol] = book
	}
	return book
}

// SubmitOrder submits order
func (e *Engine) SubmitOrder(order *Order) ([]*Trade, error) {
	book := e.GetOrCreateBook(order.Symbol)

	var trades []*Trade
	var err error

	if order.Type == TypeMarket {
		trades, err = e.executeMarketOrder(order)
		order.Status = StatusFilled
		return trades, err
	}

	if err := book.AddOrder(order); err != nil {
		return nil, err
	}

	e.mu.Lock()
	e.orders[order.ID] = order
	e.mu.Unlock()

	return book.Match()
}

// CancelOrder cancels order
func (e *Engine) CancelOrder(orderID string) error {
	e.mu.Lock()
	order, ok := e.orders[orderID]
	e.mu.Unlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	book := e.GetOrCreateBook(order.Symbol)
	return book.CancelOrder(orderID)
}

// ExecuteMarketOrder executes market order
func (e *Engine) executeMarketOrder(order *Order) ([]*Trade, error) {
	book := e.GetOrCreateBook(order.Symbol)
	var trades []*Trade

	if order.Side == Buy {
		for book.asks.Len() > 0 && order.Remaining() > 0 {
			ask := book.asks[0]
			qty := minFloat(order.Remaining(), ask.Quantity)

			trades = append(trades, &Trade{
				ID:        uuid.New().String(),
				Symbol:   order.Symbol,
				Side:     Buy,
				Price:    ask.Price,
				Quantity: qty,
				Time:    time.Now(),
			})

			order.Filled += qty
			ask.Quantity -= qty

			if ask.Quantity <= 0 {
				heap.Pop(&book.asks)
			}
		}
	} else {
		for book.bids.Len() > 0 && order.Remaining() > 0 {
			bid := book.bids[0]
			qty := minFloat(order.Remaining(), bid.Quantity)

			trades = append(trades, &Trade{
				ID:        uuid.New().String(),
				Symbol:   order.Symbol,
				Side:     Sell,
				Price:    bid.Price,
				Quantity: qty,
				Time:    time.Now(),
			})

			order.Filled += qty
			bid.Quantity -= qty

			if bid.Quantity <= 0 {
				heap.Pop(&book.bids)
			}
		}
	}

	if order.Remaining() > 0 {
		if order.TimeInForce == IOC || order.TimeInForce == FOK {
			order.Status = StatusCancelled
		} else {
			order.Status = StatusPartially
		}
	} else {
		order.Status = StatusFilled
	}

	return trades, nil
}

// GetOrder returns order
func (e *Engine) GetOrder(orderID string) (*Order, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	order, ok := e.orders[orderID]
	return order, ok
}

// GetTicker returns ticker
func (e *Engine) GetTicker(symbol string) (*Ticker, error) {
	book, ok := e.books[symbol]
	if !ok {
		return nil, fmt.Errorf("symbol not found")
	}

	bid, _ := book.GetBestBid()
	ask, _ := book.GetBestAsk()

	return &Ticker{
		Symbol:    symbol,
		LastPrice: book.lastPrice,
		BidPrice: bid,
		AskPrice: ask,
		Volume:  book.volume24h,
	}, nil
}

// Ticker ticker data
type Ticker struct {
	Symbol    string
	LastPrice float64
	BidPrice  float64
	AskPrice  float64
	Volume   float64
}

// Helpers
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}