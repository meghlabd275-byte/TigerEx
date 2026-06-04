package trading

import (
    "crypto/rand"
    "encoding/base64"
    "errors"
    "sync"
    "time"
)

var (
    ErrInvalidOrder      = errors.New("invalid order")
    ErrInsufficientFunds = errors.New("insufficient funds")
    ErrOrderNotFound     = errors.New("order not found")
    ErrOrderBookEmpty    = errors.New("order book empty")
    ErrInvalidPrice     = errors.New("invalid price")
    ErrMarketClosed     = errors.New("market is closed")
)

type OrderType string
type Side string
type OrderStatus string
type TimeInForce string

const (
    TypeMarket       OrderType = "market"
    TypeLimit        OrderType = "limit"
    TypeStopLoss     OrderType = "stop_loss"
    TypeStopLimit    OrderType = "stop_limit"
    TypeTakeProfit   OrderType = "take_profit"
    
    Buy  Side = "buy"
    Sell Side = "sell"
    
    TIFGTC TimeInForce = "GTC"
    TIFIOC TimeInForce = "IOC"
    TIFGTE TimeInForce = "GTE"
    
    StatusNew            OrderStatus = "new"
    StatusPartiallyFilled OrderStatus = "partially_filled"
    StatusFilled         OrderStatus = "filled"
    StatusCancelled      OrderStatus = "cancelled"
    StatusRejected       OrderStatus = "rejected"
)

type Order struct {
    ID            string       `json:"id"`
    UserID        string       `json:"user_id"`
    ClientOrderID string       `json:"client_order_id"`
    Symbol        string       `json:"symbol"`
    Side          Side         `json:"side"`
    OrderType     OrderType    `json:"order_type"`
    Price         float64      `json:"price"`
    StopPrice     float64      `json:"stop_price"`
    Quantity      float64      `json:"quantity"`
    FilledQty     float64      `json:"filled_quantity"`
    AvgFillPrice  float64      `json:"avg_fill_price"`
    TimeInForce   TimeInForce  `json:"time_in_force"`
    Status        OrderStatus  `json:"status"`
    CreatedAt     time.Time    `json:"created_at"`
    UpdatedAt     time.Time    `json:"updated_at"`
    FilledAt      *time.Time   `json:"filled_at,omitempty"`
}

type Trade struct {
    ID           string    `json:"id"`
    OrderID      string    `json:"order_id"`
    Symbol       string    `json:"symbol"`
    Side         Side      `json:"side"`
    Price        float64   `json:"price"`
    Quantity     float64   `json:"quantity"`
    MakerFee     float64   `json:"maker_fee"`
    TakerFee     float64   `json:"taker_fee"`
    IsMaker      bool      `json:"is_maker"`
    CreatedAt    time.Time `json:"created_at"`
}

type Market struct {
    Symbol        string  `json:"symbol"`
    BaseCurrency  string  `json:"base_currency"`
    QuoteCurrency string  `json:"quote_currency"`
    Status        string  `json:"status"`
    MinPrice      float64 `json:"min_price"`
    MaxPrice      float64 `json:"max_price"`
    TickSize      float64 `json:"tick_size"`
    MinQuantity   float64 `json:"min_quantity"`
    MakerFee      float64 `json:"maker_fee"`
    TakerFee      float64 `json:"taker_fee"`
}

type OrderBookLevel struct {
    Price    float64 `json:"price"`
    Quantity float64 `json:"quantity"`
}

type OrderBook struct {
    Symbol    string           `json:"symbol"`
    Bids      []OrderBookLevel `json:"bids"`
    Asks      []OrderBookLevel `json:"asks"`
    Timestamp time.Time        `json:"timestamp"`
}

type TradingService struct {
    mu      sync.RWMutex
    books   map[string]*orderBook
    markets map[string]*Market
    orders  map[string]*Order
}

type orderBook struct {
    bids []OrderBookLevel
    asks []OrderBookLevel
}

func NewTradingService() *TradingService {
    return &TradingService{
        books:   make(map[string]*orderBook),
        markets: make(map[string]*Market),
        orders:  make(map[string]*Order),
    }
}

func (ts *TradingService) InitializeMarket(market *Market) {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    ts.markets[market.Symbol] = market
    ts.books[market.Symbol] = &orderBook{
        bids: make([]OrderBookLevel, 0),
        asks: make([]OrderBookLevel, 0),
    }
}

func (ts *TradingService) CreateOrder(order *Order) (*Order, error) {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    
    if err := ts.validateOrder(order); err != nil {
        order.Status = StatusRejected
        return order, err
    }
    
    market, exists := ts.markets[order.Symbol]
    if !exists {
        order.Status = StatusRejected
        return order, ErrMarketClosed
    }
    
    order.ID = generateID()
    order.Status = StatusNew
    order.CreatedAt = time.Now()
    order.UpdatedAt = time.Now()
    order.FilledQty = 0
    
    if order.TimeInForce == "" {
        order.TimeInForce = TIFGTC
    }
    
    ts.orders[order.ID] = order
    
    trades, err := ts.executeOrder(order, market)
    if err != nil {
        return order, err
    }
    
    if len(trades) > 0 {
        order.FilledQty = order.Quantity
        order.Status = StatusFilled
        now := time.Now()
        order.FilledAt = &now
    }
    
    return order, nil
}

func (ts *TradingService) validateOrder(order *Order) error {
    if order.Symbol == "" {
        return ErrInvalidOrder
    }
    if order.Quantity <= 0 {
        return ErrInvalidOrder
    }
    if order.OrderType == TypeLimit || order.OrderType == TypeStopLimit {
        if order.Price <= 0 {
            return ErrInvalidPrice
        }
    }
    return nil
}

func (ts *TradingService) executeOrder(order *Order, market *Market) ([]Trade, error) {
    book, exists := ts.books[order.Symbol]
    if !exists {
        return nil, ErrMarketClosed
    }
    
    if order.OrderType == TypeMarket {
        return ts.executeMarketOrder(order, book, market)
    }
    
    return ts.executeLimitOrder(order, book, market)
}

func (ts *TradingService) executeLimitOrder(order *Order, book *orderBook, market *Market) ([]Trade, error) {
    var trades []Trade
    var matched bool
    
    if order.Side == Buy {
        for i := 0; i < len(book.asks) && order.FilledQty < order.Quantity; i++ {
            ask := book.asks[i]
            if order.Price >= ask.Price {
                fillQty := min(order.Quantity-order.FilledQty, ask.Quantity)
                trades = append(trades, Trade{
                    ID:       generateID(),
                    OrderID:  order.ID,
                    Symbol:   order.Symbol,
                    Side:     order.Side,
                    Price:    ask.Price,
                    Quantity: fillQty,
                    MakerFee: market.MakerFee,
                    TakerFee: market.TakerFee,
                    IsMaker:  false,
                    CreatedAt: time.Now(),
                })
                order.FilledQty += fillQty
                ask.Quantity -= fillQty
                matched = true
            }
        }
        if ask := book.asks[0]; len(book.asks) > 0 && book.asks[0].Quantity <= 0 {
            book.asks = book.asks[1:]
        }
    } else {
        for i := 0; i < len(book.bids) && order.FilledQty < order.Quantity; i++ {
            bid := book.bids[i]
            if order.Price <= bid.Price {
                fillQty := min(order.Quantity-order.FilledQty, bid.Quantity)
                trades = append(trades, Trade{
                    ID:       generateID(),
                    OrderID:  order.ID,
                    Symbol:   order.Symbol,
                    Side:     order.Side,
                    Price:    bid.Price,
                    Quantity: fillQty,
                    MakerFee: market.MakerFee,
                    TakerFee: market.TakerFee,
                    IsMaker:  true,
                    CreatedAt: time.Now(),
                })
                order.FilledQty += fillQty
                bid.Quantity -= fillQty
                matched = true
            }
        }
        if len(book.bids) > 0 && book.bids[0].Quantity <= 0 {
            book.bids = book.bids[1:]
        }
    }
    
    if !matched && order.FilledQty == 0 {
        level := OrderBookLevel{Price: order.Price, Quantity: order.Quantity}
        if order.Side == Buy {
            book.bids = append(book.bids, level)
            ts.sortBook(book.bids, true)
        } else {
            book.asks = append(book.asks, level)
            ts.sortBook(book.asks, false)
        }
    }
    
    return trades, nil
}

func (ts *TradingService) executeMarketOrder(order *Order, book *orderBook, market *Market) ([]Trade, error) {
    var trades []Trade
    var levels []OrderBookLevel
    
    if order.Side == Buy {
        levels = book.asks
    } else {
        levels = book.bids
    }
    
    if len(levels) == 0 {
        return nil, ErrOrderBookEmpty
    }
    
    remaining := order.Quantity
    for _, level := range levels {
        if remaining <= 0 {
            break
        }
        fillQty := min(remaining, level.Quantity)
        trades = append(trades, Trade{
            ID:       generateID(),
            OrderID:  order.ID,
            Symbol:   order.Symbol,
            Side:     order.Side,
            Price:    level.Price,
            Quantity: fillQty,
            MakerFee: market.MakerFee,
            TakerFee: market.TakerFee,
            IsMaker:  false,
            CreatedAt: time.Now(),
        })
        remaining -= fillQty
    }
    
    order.FilledQty = order.Quantity - remaining
    return trades, nil
}

func (ts *TradingService) CancelOrder(orderID, userID string) error {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    
    order, exists := ts.orders[orderID]
    if !exists {
        return ErrOrderNotFound
    }
    
    if order.UserID != userID {
        return ErrOrderNotFound
    }
    
    if order.Status != StatusNew && order.Status != StatusPartiallyFilled {
        return errors.New("order cannot be cancelled")
    }
    
    order.Status = StatusCancelled
    order.UpdatedAt = time.Now()
    
    return nil
}

func (ts *TradingService) GetOrderBook(symbol string) *OrderBook {
    ts.mu.RLock()
    defer ts.mu.RUnlock()
    
    book, exists := ts.books[symbol]
    if !exists {
        return nil
    }
    
    return &OrderBook{
        Symbol:    symbol,
        Bids:      book.bids,
        Asks:      book.asks,
        Timestamp: time.Now(),
    }
}

func (ts *TradingService) GetOrdersByUser(userID string) []*Order {
    ts.mu.RLock()
    defer ts.mu.RUnlock()
    
    var userOrders []*Order
    for _, order := range ts.orders {
        if order.UserID == userID {
            userOrders = append(userOrders, order)
        }
    }
    return userOrders
}

func (ts *TradingService) sortBook(levels []OrderBookLevel, descending bool) {
    for i := 0; i < len(levels); i++ {
        for j := i + 1; j < len(levels); j++ {
            if descending {
                if levels[i].Price < levels[j].Price {
                    levels[i], levels[j] = levels[j], levels[i]
                }
            } else {
                if levels[i].Price > levels[j].Price {
                    levels[i], levels[j] = levels[j], levels[i]
                }
            }
        }
    }
}

func (o *Order) Remaining() float64 {
    return o.Quantity - o.FilledQty
}

func generateID() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}