package trading_engine

import (
    "errors"
    "sync"
    "time"
)

var (
    ErrInvalidOrder       = errors.New("invalid order")
    ErrInsufficientFunds  = errors.New("insufficient funds")
    ErrOrderNotFound      = errors.New("order not found")
    ErrOrderBookEmpty     = errors.New("order book empty")
    ErrInvalidPrice      = errors.New("invalid price")
    ErrInvalidQuantity    = errors.New("invalid quantity")
    ErrMarketClosed       = errors.New("market is closed")
    ErrRateLimitExceeded  = errors.New("rate limit exceeded")
)

type OrderType string
type Side string
type TimeInForce string
type OrderStatus string

const (
    OrderTypeMarket       OrderType = "market"
    OrderTypeLimit        OrderType = "limit"
    OrderTypeStopLoss     OrderType = "stop_loss"
    OrderTypeStopLimit    OrderType = "stop_limit"
    OrderTypeTakeProfit   OrderType = "take_profit"
    OrderTypeIceberg      OrderType = "iceberg"
    OrderTypeTrailingStop OrderType = "trailing_stop"
    
    SideBuy  Side = "buy"
    SideSell Side = "sell"
    
    TIFGTC TimeInForce = "GTC"
    TIFIOC TimeInForce = "IOC"
    TIF_FOK TimeInForce = "FOK"
    TIFGTX TimeInForce = "GTX"
    
    StatusNew            OrderStatus = "new"
    StatusPartiallyFilled OrderStatus = "partially_filled"
    StatusFilled         OrderStatus = "filled"
    StatusCancelled      OrderStatus = "cancelled"
    StatusRejected       OrderStatus = "rejected"
    StatusExpired        OrderStatus = "expired"
)

type Order struct {
    ID              string       `json:"id"`
    UserID          string       `json:"user_id"`
    ClientOrderID   string       `json:"client_order_id"`
    Symbol          string       `json:"symbol"`
    Side            Side         `json:"side"`
    OrderType       OrderType    `json:"order_type"`
    Price           float64      `json:"price"`
    StopPrice       float64      `json:"stop_price"`
    Quantity        float64      `json:"quantity"`
    FilledQuantity   float64      `json:"filled_quantity"`
    RemainingQty    float64      `json:"remaining_quantity"`
    AvgFillPrice    float64      `json:"avg_fill_price"`
    TimeInForce     TimeInForce  `json:"time_in_force"`
    Status          OrderStatus  `json:"status"`
    IsLiquidation   bool         `json:"is_liquidation"`
    CreatedAt       time.Time    `json:"created_at"`
    UpdatedAt       time.Time    `json:"updated_at"`
    FilledAt        *time.Time   `json:"filled_at,omitempty"`
}

type Trade struct {
    ID              string    `json:"id"`
    OrderID         string    `json:"order_id"`
    MatchOrderID    string    `json:"match_order_id"`
    Symbol          string    `json:"symbol"`
    Side            Side      `json:"side"`
    Price           float64   `json:"price"`
    Quantity        float64   `json:"quantity"`
    MakerOrderID    string    `json:"maker_order_id"`
    TakerOrderID    string    `json:"maker_order_id"`
    MakerUserID     string    `json:"maker_user_id"`
    TakerUserID     string    `json:"taker_user_id"`
    MakerFee        float64   `json:"maker_fee"`
    TakerFee        float64   `json:"taker_fee"`
    IsMaker         bool      `json:"is_maker"`
    CreatedAt       time.Time `json:"created_at"`
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

type Market struct {
    Symbol         string    `json:"symbol"`
    BaseCurrency   string    `json:"base_currency"`
    QuoteCurrency  string    `json:"quote_currency"`
    Status         string    `json:"status"`
    MinPrice       float64   `json:"min_price"`
    MaxPrice       float64   `json:"max_price"`
    TickSize       float64   `json:"tick_size"`
    MinQuantity    float64   `json:"min_quantity"`
    MinNotional    float64   `json:"min_notional"`
    MakerFee       float64   `json:"maker_fee"`
    TakerFee       float64   `json:"taker_fee"`
}

type MatchingEngine struct {
    mu      sync.RWMutex
    books   map[string]*orderBook
    markets map[string]*Market
    fees    map[string]*FeeConfig
}

type orderBook struct {
    bids    []OrderBookLevel
    asks    []OrderBookLevel
    lastID  uint64
}

type FeeConfig struct {
    MakerFee float64
    TakerFee float64
}

func NewMatchingEngine() *MatchingEngine {
    return &MatchingEngine{
        books:   make(map[string]*orderBook),
        markets: make(map[string]*Market),
        fees:    make(map[string]*FeeConfig),
    }
}

func (me *MatchingEngine) InitializeMarket(symbol string, market *Market) {
    me.mu.Lock()
    defer me.mu.Unlock()
    me.books[symbol] = &orderBook{
        bids:   make([]OrderBookLevel, 0),
        asks:   make([]OrderBookLevel, 0),
        lastID: 0,
    }
    me.markets[symbol] = market
    me.fees[symbol] = &FeeConfig{
        MakerFee: market.MakerFee,
        TakerFee: market.TakerFee,
    }
}

func (me *MatchingEngine) AddOrder(order *Order) (*Trade, error) {
    me.mu.Lock()
    defer me.mu.Unlock()
    if err := me.validateOrder(order); err != nil {
        order.Status = StatusRejected
        return nil, err
    }
    book, exists := me.books[order.Symbol]
    if !exists {
        return nil, ErrMarketClosed
    }
    if order.OrderType == OrderTypeMarket {
        return me.executeMarketOrder(order, book)
    }
    return me.executeLimitOrder(order, book)
}

func (me *MatchingEngine) validateOrder(order *Order) error {
    if order.Symbol == "" {
        return ErrInvalidOrder
    }
    if order.Quantity <= 0 {
        return ErrInvalidQuantity
    }
    if order.OrderType == OrderTypeLimit || order.OrderType == OrderTypeStopLimit {
        if order.Price <= 0 {
            return ErrInvalidPrice
        }
    }
    return nil
}

func (me *MatchingEngine) executeLimitOrder(order *Order, book *orderBook) (*Trade, error) {
    var trades []*Trade
    if order.Side == SideBuy {
        trades = me.matchAgainstSide(order, book.asks)
        for i := len(book.asks) - 1; i >= 0; i-- {
            if book.asks[i].Price > order.Price {
                break
            }
            book.asks = book.asks[:len(book.asks)-1]
        }
    } else {
        trades = me.matchAgainstSide(order, book.bids)
        for i := len(book.bids) - 1; i >= 0; i-- {
            if book.bids[i].Price < order.Price {
                break
            }
            book.bids = book.bids[:len(book.bids)-1]
        }
    }
    if len(trades) == 0 {
        me.addToBook(order, book)
        order.Status = StatusNew
        return nil, nil
    }
    order.FilledQuantity = order.Quantity
    order.AvgFillPrice = me.calculateAvgFillPrice(trades)
    order.Status = StatusFilled
    now := time.Now()
    order.FilledAt = &now
    return trades[0], nil
}

func (me *MatchingEngine) executeMarketOrder(order *Order, book *orderBook) (*Trade, error) {
    var levels []OrderBookLevel
    if order.Side == SideBuy {
        levels = book.asks
    } else {
        levels = book.bids
    }
    if len(levels) == 0 {
        return nil, ErrOrderBookEmpty
    }
    var trades []*Trade
    remainingQty := order.Quantity
    for _, level := range levels {
        if remainingQty <= 0 {
            break
        }
        fillQty := min(remainingQty, level.Quantity)
        trade := &Trade{
            ID:           generateID(),
            OrderID:      order.ID,
            Symbol:       order.Symbol,
            Side:         order.Side,
            Price:        level.Price,
            Quantity:     fillQty,
            IsMaker:      false,
            CreatedAt:   time.Now(),
        }
        trades = append(trades, trade)
        remainingQty -= fillQty
    }
    if len(trades) == 0 {
        return nil, ErrOrderBookEmpty
    }
    order.FilledQuantity = order.Quantity - remainingQty
    order.AvgFillPrice = me.calculateAvgFillPrice(trades)
    if remainingQty > 0 {
        order.Status = StatusPartiallyFilled
    } else {
        order.Status = StatusFilled
        now := time.Now()
        order.FilledAt = &now
    }
    return trades[0], nil
}

func (me *MatchingEngine) matchAgainstSide(order *Order, levels []OrderBookLevel) []*Trade {
    var trades []*Trade
    remainingQty := order.Quantity
    for i := 0; i < len(levels) && remainingQty > 0; i++ {
        level := levels[i]
        fillQty := min(remainingQty, level.Quantity)
        trade := &Trade{
            ID:        generateID(),
            OrderID:   order.ID,
            Symbol:    order.Symbol,
            Side:      order.Side,
            Price:     level.Price,
            Quantity:  fillQty,
            IsMaker:   order.Side == SideSell,
            CreatedAt: time.Now(),
        }
        trades = append(trades, trade)
        remainingQty -= fillQty
        level.Quantity -= fillQty
    }
    return trades
}

func (me *MatchingEngine) addToBook(order *Order, book *orderBook) {
    level := OrderBookLevel{
        Price:    order.Price,
        Quantity: order.RemainingQty,
    }
    if order.Side == SideBuy {
        book.bids = append(book.bids, level)
        me.sortLevels(book.bids, true)
    } else {
        book.asks = append(book.asks, level)
        me.sortLevels(book.asks, false)
    }
}

func (me *MatchingEngine) sortLevels(levels []OrderBookLevel, descending bool) {
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

func (me *MatchingEngine) calculateAvgFillPrice(trades []*Trade) float64 {
    var totalValue, totalQty float64
    for _, t := range trades {
        totalValue += t.Price * t.Quantity
        totalQty += t.Quantity
    }
    if totalQty == 0 {
        return 0
    }
    return totalValue / totalQty
}

func (me *MatchingEngine) CancelOrder(orderID, userID, symbol string) error {
    me.mu.Lock()
    defer me.mu.Unlock()
    book, exists := me.books[symbol]
    if !exists {
        return ErrOrderNotFound
    }
    for i, bid := range book.bids {
        if bid.Quantity > 0 {
            book.bids = append(book.bids[:i], book.bids[i+1:]...)
            return nil
        }
    }
    for i, ask := range book.asks {
        if ask.Quantity > 0 {
            book.asks = append(book.asks[:i], book.asks[i+1:]...)
            return nil
        }
    }
    return ErrOrderNotFound
}

func (me *MatchingEngine) GetOrderBook(symbol string) *OrderBook {
    me.mu.RLock()
    defer me.mu.RUnlock()
    book, exists := me.books[symbol]
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

func (me *MatchingEngine) GetMarkets() map[string]*Market {
    me.mu.RLock()
    defer me.mu.RUnlock()
    return me.markets
}

func (me *MatchingEngine) GetMarket(symbol string) *Market {
    me.mu.RLock()
    defer me.mu.RUnlock()
    return me.markets[symbol]
}

func generateID() string {
    return time.Now().Format("20060102150405") + "-" + randomString(8)
}

func randomString(n int) string {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    b := make([]byte, n)
    for i := range b {
        b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
    }
    return string(b)
}

func (o *Order) Remaining() float64 {
    return o.Quantity - o.FilledQuantity
}

func (o *Order) UpdateStatus() {
    if o.FilledQuantity >= o.Quantity {
        o.Status = StatusFilled
        now := time.Now()
        o.FilledAt = &now
    } else if o.FilledQuantity > 0 {
        o.Status = StatusPartiallyFilled
    }
    o.UpdatedAt = time.Now()
}

func (o *Order) IsActive() bool {
    return o.Status == StatusNew || o.Status == StatusPartiallyFilled
}

func ValidateTimeInForce(tif string) bool {
    validTIF := map[string]bool{
        "GTC": true,
        "IOC": true,
        "FOK": true,
        "GTX": true,
    }
    return validTIF[tif]
}

func min(a, b float64) float64 {
    if a < b {
        return a
    }
    return b
}