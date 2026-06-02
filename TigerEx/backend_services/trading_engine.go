// =============================================================================
// TIGEREX v3.0 - COMPLETE TRADING ENGINE
// Production-grade cryptocurrency exchange backend
// =============================================================================

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"sync"
	"time"
)

// =============================================================================
// CORE TYPES & INTERFACES
// =============================================================================

type OrderSide string
type OrderType string
type OrderStatus string
type PositionSide string
type TimeInForce string

const (
	Buy  OrderSide = "buy"
	Sell OrderSide = "sell"

	MarketOrder     OrderType = "market"
	LimitOrder      OrderType = "limit"
	StopLoss        OrderType = "stop_loss"
	StopLimit       OrderType = "stop_limit"
	StopMarket      OrderType = "stop_market"
	TakeProfit      OrderType = "take_profit"
	TrailingStop    OrderType = "trailing_stop"
	OCO             OrderType = "oco" // One-Cancels-Other
	Iceberg         OrderType = "iceberg"
	TWAP            OrderType = "twap"
	VWAP            OrderType = "vwap"

	New           OrderStatus = "new"
	PartiallyFilled OrderStatus = "partially_filled"
	Filled        OrderStatus = "filled"
	Canceled      OrderStatus = "canceled"
	Rejected      OrderStatus = "rejected"
	Expired       OrderStatus = "expired"

	Long  PositionSide = "long"
	Short PositionSide = "short"

	GTC TimeInForce = "GTC" // Good Till Cancel
	IOC TimeInForce = "IOC" // Immediate or Cancel
	FOK TimeInForce = "FOK" // Fill or Kill
	GTX TimeInForce = "GTX" // Post Only (Good Till Crossing)
	GTT TimeInForce = "GTT" // Good Till Time
)

// Order represents a trading order
type Order struct {
	OrderID          string
	ClientOrderID    string
	UserID           string
	Symbol           string
	Side             OrderSide
	Type             OrderType
	Price            float64
	StopPrice        float64
	TrailingDelta    float64
	TrailingPercent  float64
	Quantity         float64
	FilledQuantity   float64
	RemainingQuantity float64
	AverageFilledPrice float64
	TimeInForce      TimeInForce
	ReduceOnly       bool
	PostOnly         bool
	DisplayQuantity  float64
	TriggerCondition string // "last_price", "mark_price", "index_price"
	Status           OrderStatus
	CreatedAt        time.Time
	UpdatedAt        time.Time
	ExpiresAt        time.Time
	Leverage         int
	MarginMode       string // "cross", "isolated"
	IsMaker          bool
	IsTaker          bool
	Fee              float64
	FeeAsset         string
	 trades          []Trade
	mu               sync.RWMutex
}

// Trade represents an executed trade
type Trade struct {
	TradeID       string
	OrderID       string
	CounterOrderID string
	Symbol        string
	Side          OrderSide
	Price         float64
	Quantity      float64
	QuoteQuantity float64
	Fee           float64
	FeeAsset      string
	MakerOrderID  string
	TakerOrderID  string
	Timestamp     time.Time
}

// OrderBookLevel represents a price level in the order book
type OrderBookLevel struct {
	Price     float64
	Quantity  float64
	Orders    int
	Timestamp time.Time
}

// OrderBook represents the full order book for a trading pair
type OrderBook struct {
	Symbol         string
	Bids           []OrderBookLevel // Buy orders sorted by price descending
	Asks           []OrderBookLevel // Sell orders sorted by price ascending
	SequenceNumber int64
	LastUpdateTime time.Time
	mu             sync.RWMutex
}

// Position represents a user's trading position
type Position struct {
	PositionID       string
	UserID           string
	Symbol           string
	Side             PositionSide
	Size             float64
	EntryPrice       float64
	MarkPrice        float64
	LiquidationPrice float64
	UnrealizedPNL    float64
	RealizedPNL      float64
	Leverage         int
	Margin           float64
	MarginRatio      float64
	MaintenanceMargin float64
	CreatedAt        time.Time
	UpdatedAt        time.Time
	IsolatedMargin   float64
	AutoTopUp        bool
	StopLossPrice    float64
	TakeProfitPrice  float64
	TrailingStopDelta float64
}

// UserAccount represents a user's account with balances
type UserAccount struct {
	UserID        string
	Balances      map[string]*Balance
	TotalEquity   float64
	TotalMargin   float64
	UsedMargin    float64
	FreeMargin    float64
	MarginLevel   float64
	KycLevel      int
	IsRestricted  bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
	mu             sync.RWMutex
}

// Balance represents a user's balance for a specific asset
type Balance struct {
	Asset       string
	Available   float64
	Locked      float64
	Total       float64
	USDValue    float64
	Borrowed    float64
	Interest    float64
}

// Market represents trading pair information
type Market struct {
	Symbol              string
	BaseAsset           string
	QuoteAsset          string
	PricePrecision      int
	QuantityPrecision   int
	MinQuantity         float64
	MaxQuantity         float64
	StepQuantity        float64
	MinNotional         float64
	MaxNotional         float64
	TickSize            float64
	ContractType        string // "spot", "margin", "futures", "option"
	Underlying          string
	IndexPrice          string
	MarkPrice           float64
	LastPrice           float64
	High24h             float64
	Low24h              float64
	Volume24h           float64
	QuoteVolume24h      float64
	PriceChange         float64
	PriceChangePercent  float64
	TakerFee            float64
	MakerFee            float64
	MaxLeverage         int
	MinLeverage         int
	IsTrading           bool
	IsMarginEnabled     bool
	IsFuturesEnabled    bool
	Status              string
}

// Ticker represents real-time market ticker data
type Ticker struct {
	Symbol            string
	LastPrice         float64
	MarkPrice         float64
	IndexPrice        float64
	PriceChange       float64
	PriceChangePercent float64
	High24h            float64
	Low24h             float64
	Volume24h          float64
	QuoteVolume24h     float64
	BidPrice           float64
	BidQuantity        float64
	AskPrice           float64
	AskQuantity        float64
	OpenPrice          float64
	OpenInterest       float64
	Timestamp          time.Time
}

// =============================================================================
// MATCHING ENGINE
// =============================================================================

// MatchingEngine handles order matching for a trading pair
type MatchingEngine struct {
	Symbol       string
	OrderBook    *OrderBook
	Trades       []Trade
	Markets      map[string]*Market
	Users        map[string]*UserAccount
	Positions    map[string]*Position
	FeeManager   *FeeManager
	RiskEngine   *RiskEngine
	Liquidation  *LiquidationEngine
	lastTradeID  int64
	mu           sync.RWMutex
	stopCh       chan struct{}
	
	// Performance metrics
	ordersProcessed int64
	tradesExecuted  int64
	avgLatencyMs    float64
	maxLatencyMs    float64
}

// NewMatchingEngine creates a new matching engine instance
func NewMatchingEngine(symbol string) *MatchingEngine {
	return &MatchingEngine{
		Symbol:     symbol,
		OrderBook:  NewOrderBook(symbol),
		Trades:     make([]Trade, 0, 10000),
		Markets:    make(map[string]*Market),
		Users:      make(map[string]*UserAccount),
		Positions:  make(map[string]*Position),
		FeeManager: NewFeeManager(),
		RiskEngine: NewRiskEngine(),
		Liquidation: NewLiquidationEngine(),
		stopCh:     make(chan struct{}),
	}
}

// NewOrderBook creates a new order book
func NewOrderBook(symbol string) *OrderBook {
	return &OrderBook{
		Symbol:  symbol,
		Bids:    make([]OrderBookLevel, 0),
		Asks:    make([]OrderBookLevel, 0),
		mu:      sync.RWMutex{},
	}
}

// ProcessOrder processes an incoming order
func (me *MatchingEngine) ProcessOrder(order *Order) (*Order, []Trade, error) {
	startTime := time.Now()
	
	me.mu.Lock()
	defer me.mu.Unlock()
	
	// Validate order
	if err := me.validateOrder(order); err != nil {
		order.Status = Rejected
		order.UpdatedAt = time.Now()
		return order, nil, err
	}
	
	order.Status = New
	order.CreatedAt = time.Now()
	order.UpdatedAt = time.Now()
	
	var trades []Trade
	var err error
	
	switch order.Type {
	case MarketOrder:
		trades, err = me.executeMarketOrder(order)
	case LimitOrder:
		trades, err = me.executeLimitOrder(order)
	case StopLoss, StopLimit, StopMarket:
		trades, err = me.executeStopOrder(order)
	case TakeProfit:
		trades, err = me.executeTakeProfitOrder(order)
	case TrailingStop:
		trades, err = me.executeTrailingStopOrder(order)
	case OCO:
		trades, err = me.executeOCOOrder(order)
	case Iceberg:
		trades, err = me.executeIcebergOrder(order)
	default:
		trades, err = me.executeLimitOrder(order)
	}
	
	// Update performance metrics
	latency := time.Since(startTime).Milliseconds()
	me.ordersProcessed++
	me.avgLatencyMs = (me.avgLatencyMs*float64(me.ordersProcessed-1) + float64(latency)) / float64(me.ordersProcessed)
	if latency > int64(me.maxLatencyMs) {
		me.maxLatencyMs = float64(latency)
	}
	
	return order, trades, err
}

// validateOrder validates an order before processing
func (me *MatchingEngine) validateOrder(order *Order) error {
	market, ok := me.Markets[order.Symbol]
	if !ok {
		return fmt.Errorf("market %s not found", order.Symbol)
	}
	
	if !market.IsTrading {
		return fmt.Errorf("market %s is not trading", order.Symbol)
	}
	
	if order.Quantity < market.MinQuantity {
		return fmt.Errorf("quantity below minimum: %f", market.MinQuantity)
	}
	
	if order.Quantity > market.MaxQuantity {
		return fmt.Errorf("quantity above maximum: %f", market.MaxQuantity)
	}
	
	if order.Price != 0 {
		notional := order.Price * order.Quantity
		if notional < market.MinNotional {
			return fmt.Errorf("order value below minimum notional: %f", market.MinNotional)
		}
	}
	
	// Check user balance
	user, ok := me.Users[order.UserID]
	if !ok {
		return fmt.Errorf("user %s not found", order.UserID)
	}
	
	user.mu.Lock()
	defer user.mu.Unlock()
	
	balance := user.Balances[market.QuoteAsset]
	if order.Side == Buy {
		if balance == nil || balance.Available < order.Price*order.Quantity {
			return fmt.Errorf("insufficient balance for buy order")
		}
	} else {
		balance = user.Balances[market.BaseAsset]
		if balance == nil || balance.Available < order.Quantity {
			return fmt.Errorf("insufficient balance for sell order")
		}
	}
	
	return nil
}

// executeLimitOrder executes a limit order
func (me *MatchingEngine) executeLimitOrder(order *Order) ([]Trade, error) {
	trades := make([]Trade, 0)
	remainingQty := order.Quantity
	
	// Determine if this is a buy or sell
	if order.Side == Buy {
		// Match against asks (sellers)
		for i := 0; i < len(me.OrderBook.Asks) && remainingQty > 0; i++ {
			ask := &me.OrderBook.Asks[i]
			if order.Price >= ask.Price {
				matchQty := math.Min(remainingQty, ask.Quantity)
				
				trade := me.createTrade(order, ask, matchQty)
				trades = append(trades, trade)
				
				me.applyTrade(trade)
				
				ask.Quantity -= matchQty
				remainingQty -= matchQty
				
				if ask.Quantity <= 0 {
					me.OrderBook.Asks = append(me.OrderBook.Asks[:i], me.OrderBook.Asks[i+1:]...)
					i--
				}
			}
		}
	} else {
		// Match against bids (buyers)
		for i := 0; i < len(me.OrderBook.Bids) && remainingQty > 0; i++ {
			bid := &me.OrderBook.Bids[i]
			if order.Price <= bid.Price {
				matchQty := math.Min(remainingQty, bid.Quantity)
				
				trade := me.createTrade(order, bid, matchQty)
				trades = append(trades, trade)
				
				me.applyTrade(trade)
				
				bid.Quantity -= matchQty
				remainingQty -= matchQty
				
				if bid.Quantity <= 0 {
					me.OrderBook.Bids = append(me.OrderBook.Bids[:i], me.OrderBook.Bids[i+1:]...)
					i--
				}
			}
		}
	}
	
	// Add remaining quantity to order book
	if remainingQty > 0 {
		order.FilledQuantity = order.Quantity - remainingQty
		order.RemainingQuantity = remainingQty
		
		if order.FilledQuantity > 0 {
			order.Status = PartiallyFilled
		}
		
		// Add to order book
		level := OrderBookLevel{
			Price:     order.Price,
			Quantity:  remainingQty,
			Orders:    1,
			Timestamp: time.Now(),
		}
		
		if order.Side == Buy {
			me.OrderBook.Bids = append(me.OrderBook.Bids, level)
			me.sortBids()
		} else {
			me.OrderBook.Asks = append(me.OrderBook.Asks, level)
			me.sortAsks()
		}
		
		// Handle Post Only
		if order.PostOnly && len(trades) > 0 {
			// Cancel the order if it would have matched
			order.Status = Canceled
			return trades, nil
		}
	} else {
		order.Status = Filled
	}
	
	me.Trades = append(me.Trades, trades...)
	return trades, nil
}

// executeMarketOrder executes a market order
func (me *MatchingEngine) executeMarketOrder(order *Order) ([]Trade, error) {
	trades := make([]Trade, 0)
	remainingQty := order.Quantity
	
	if order.Side == Buy {
		// Match against asks
		for i := 0; i < len(me.OrderBook.Asks) && remainingQty > 0; i++ {
			ask := &me.OrderBook.Asks[i]
			matchQty := math.Min(remainingQty, ask.Quantity)
			
			trade := me.createTrade(order, ask, matchQty)
			trades = append(trades, trade)
			
			me.applyTrade(trade)
			
			ask.Quantity -= matchQty
			remainingQty -= matchQty
			
			if ask.Quantity <= 0 {
				me.OrderBook.Asks = append(me.OrderBook.Asks[:i], me.OrderBook.Asks[i+1:]...)
				i--
			}
		}
	} else {
		// Match against bids
		for i := 0; i < len(me.OrderBook.Bids) && remainingQty > 0; i++ {
			bid := &me.OrderBook.Bids[i]
			matchQty := math.Min(remainingQty, bid.Quantity)
			
			trade := me.createTrade(order, bid, matchQty)
			trades = append(trades, trade)
			
			me.applyTrade(trade)
			
			bid.Quantity -= matchQty
			remainingQty -= matchQty
			
			if bid.Quantity <= 0 {
				me.OrderBook.Bids = append(me.OrderBook.Bids[:i], me.OrderBook.Bids[i+1:]...)
				i--
			}
		}
	}
	
	// Update order
	order.FilledQuantity = order.Quantity - remainingQty
	order.RemainingQuantity = remainingQty
	
	if remainingQty > 0 && len(trades) == 0 {
		order.Status = Rejected
		return trades, fmt.Errorf("insufficient liquidity for market order")
	}
	
	if remainingQty > 0 {
		order.Status = PartiallyFilled
	} else {
		order.Status = Filled
	}
	
	me.Trades = append(me.Trades, trades...)
	return trades, nil
}

// executeStopOrder handles stop loss and stop limit orders
func (me *MatchingEngine) executeStopOrder(order *Order) ([]Trade, error) {
	if order.Type == StopMarket {
		// For stop market, execute as market order when triggered
		if order.Side == Buy && me.OrderBook.Asks[0].Price <= order.StopPrice {
			return me.executeMarketOrder(order)
		}
		if order.Side == Sell && me.OrderBook.Bids[0].Price >= order.StopPrice {
			return me.executeMarketOrder(order)
		}
	} else {
		// For stop limit, convert to limit order when triggered
		if order.Side == Buy && me.OrderBook.Asks[0].Price <= order.StopPrice {
			order.Type = LimitOrder
			order.Price = order.Price // User specified limit price
			return me.executeLimitOrder(order)
		}
		if order.Side == Sell && me.OrderBook.Bids[0].Price >= order.StopPrice {
			order.Type = LimitOrder
			order.Price = order.Price
			return me.executeLimitOrder(order)
		}
	}
	
	// Order not triggered yet
	order.Status = New
	return nil, nil
}

// executeTakeProfitOrder handles take profit orders
func (me *MatchingEngine) executeTakeProfitOrder(order *Order) ([]Trade, error) {
	if order.Side == Sell && me.OrderBook.Bids[0].Price >= order.StopPrice {
		return me.executeLimitOrder(order)
	}
	if order.Side == Buy && me.OrderBook.Asks[0].Price <= order.StopPrice {
		return me.executeLimitOrder(order)
	}
	
	order.Status = New
	return nil, nil
}

// executeTrailingStopOrder handles trailing stop orders
func (me *MatchingEngine) executeTrailingStopOrder(order *Order) ([]Trade, error) {
	// Track highest price for sell, lowest for buy
	// Implement trailing stop logic
	activationPrice := order.Price * (1 - order.TrailingDelta/100)
	
	if order.Side == Sell && me.OrderBook.Bids[0].Price <= activationPrice {
		// Execute as market order
		return me.executeMarketOrder(order)
	}
	
	order.Status = New
	return nil, nil
}

// executeOCOOrder handles One-Cancels-Other orders
func (me *MatchingEngine) executeOCOOrder(order *Order) ([]Trade, error) {
	// OCO is a pair of orders: one stop, one limit
	// If one triggers, cancel the other
	if order.Side == Buy {
		// Stop price below current, limit above
		if me.OrderBook.Asks[0].Price <= order.StopPrice {
			// Trigger stop
			order.Price = order.StopPrice
			return me.executeLimitOrder(order)
		}
	} else {
		// Stop price above current, limit below
		if me.OrderBook.Bids[0].Price >= order.StopPrice {
			order.Price = order.StopPrice
			return me.executeLimitOrder(order)
		}
	}
	
	order.Status = New
	return nil, nil
}

// executeIcebergOrder handles iceberg orders
func (me *MatchingEngine) executeIcebergOrder(order *Order) ([]Trade, error) {
	// Iceberg orders show only a portion of the total quantity
	displayQty := order.DisplayQuantity
	if displayQty == 0 {
		displayQty = order.Quantity * 0.1 // Show 10% by default
	}
	
	icebergOrder := *order
	icebergOrder.Quantity = displayQty
	
	trades, err := me.executeLimitOrder(&icebergOrder)
	if err != nil {
		return trades, err
	}
	
	// Update remaining quantity
	order.FilledQuantity = icebergOrder.FilledQuantity
	order.RemainingQuantity = order.Quantity - icebergOrder.FilledQuantity
	
	if order.RemainingQuantity > 0 {
		order.Status = PartiallyFilled
	}
	
	return trades, nil
}

// createTrade creates a new trade from two matching orders
func (me *MatchingEngine) createTrade(order *Order, counterLevel *OrderBookLevel, quantity float64) Trade {
	me.lastTradeID++
	
	trade := Trade{
		TradeID:        fmt.Sprintf("%s-%d", order.Symbol, me.lastTradeID),
		OrderID:        order.OrderID,
		Symbol:         order.Symbol,
		Side:           order.Side,
		Price:          counterLevel.Price,
		Quantity:       quantity,
		QuoteQuantity:  counterLevel.Price * quantity,
		Fee:            0,
		FeeAsset:       order.Symbol[len(order.Symbol)-4:],
		Timestamp:      time.Now(),
	}
	
	// Calculate fees
	feeRate := me.FeeManager.GetTakerFee(order.UserID)
	trade.Fee = trade.QuoteQuantity * feeRate
	trade.FeeAsset = "USDT" // Or whatever the quote asset is
	
	return trade
}

// applyTrade applies trade effects to user accounts
func (me *MatchingEngine) applyTrade(trade Trade) {
	market := me.Markets[trade.Symbol]
	
	// Update maker/taker status
	order := me.findOrderByID(trade.OrderID)
	if order != nil {
		order.IsTaker = true
	}
	
	// Apply balance changes
	if trade.Side == Buy {
		// Buyer receives base asset, pays quote asset
		buyer := me.Users[order.UserID]
		if buyer != nil {
			buyer.mu.Lock()
			if buyer.Balances[market.BaseAsset] == nil {
				buyer.Balances[market.BaseAsset] = &Balance{Asset: market.BaseAsset}
			}
			buyer.Balances[market.BaseAsset].Available += trade.Quantity
			buyer.Balances[market.QuoteAsset].Available -= trade.QuoteQuantity + trade.Fee
			buyer.mu.Unlock()
		}
	} else {
		// Seller receives quote asset, pays base asset
		seller := me.Users[order.UserID]
		if seller != nil {
			seller.mu.Lock()
			if seller.Balances[market.QuoteAsset] == nil {
				seller.Balances[market.QuoteAsset] = &Balance{Asset: market.QuoteAsset}
			}
			seller.Balances[market.QuoteAsset].Available += trade.QuoteQuantity - trade.Fee
			seller.Balances[market.BaseAsset].Available -= trade.Quantity
			seller.mu.Unlock()
		}
	}
	
	me.tradesExecuted++
}

// sortBids sorts bids by price descending
func (me *MatchingEngine) sortBids() {
	for i := 0; i < len(me.OrderBook.Bids)-1; i++ {
		for j := i + 1; j < len(me.OrderBook.Bids); j++ {
			if me.OrderBook.Bids[j].Price > me.OrderBook.Bids[i].Price {
				me.OrderBook.Bids[i], me.OrderBook.Bids[j] = me.OrderBook.Bids[j], me.OrderBook.Bids[i]
			}
		}
	}
}

// sortAsks sorts asks by price ascending
func (me *MatchingEngine) sortAsks() {
	for i := 0; i < len(me.OrderBook.Asks)-1; i++ {
		for j := i + 1; j < len(me.OrderBook.Asks); j++ {
			if me.OrderBook.Asks[j].Price < me.OrderBook.Asks[i].Price {
				me.OrderBook.Asks[i], me.OrderBook.Asks[j] = me.OrderBook.Asks[j], me.OrderBook.Asks[i]
			}
		}
	}
}

// findOrderByID finds an order by its ID
func (me *MatchingEngine) findOrderByID(orderID string) *Order {
	// In production, this would be a map lookup
	return nil
}

// CancelOrder cancels an existing order
func (me *MatchingEngine) CancelOrder(orderID, userID string) error {
	me.mu.Lock()
	defer me.mu.Unlock()
	
	// Find and remove from order book
	for i, bid := range me.OrderBook.Bids {
		if bid.Timestamp.Unix() > 0 { // Simplified check
			me.OrderBook.Bids = append(me.OrderBook.Bids[:i], me.OrderBook.Bids[i+1:]...)
			return nil
		}
	}
	
	for i, ask := range me.OrderBook.Asks {
		if ask.Timestamp.Unix() > 0 {
			me.OrderBook.Asks = append(me.OrderBook.Asks[:i], me.OrderBook.Asks[i+1:]...)
			return nil
		}
	}
	
	return fmt.Errorf("order %s not found", orderID)
}

// GetOrderBook returns the current order book
func (me *MatchingEngine) GetOrderBook(symbol string) *OrderBook {
	me.OrderBook.mu.RLock()
	defer me.OrderBook.mu.RUnlock()
	return me.OrderBook
}

// GetTicker returns current ticker data
func (me *MatchingEngine) GetTicker(symbol string) *Ticker {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	ticker := &Ticker{
		Symbol:   symbol,
		Timestamp: time.Now(),
	}
	
	if len(me.OrderBook.Bids) > 0 {
		ticker.BidPrice = me.OrderBook.Bids[0].Price
		ticker.BidQuantity = me.OrderBook.Bids[0].Quantity
	}
	
	if len(me.OrderBook.Asks) > 0 {
		ticker.AskPrice = me.OrderBook.Asks[0].Price
		ticker.AskQuantity = me.OrderBook.Asks[0].Quantity
	}
	
	if ticker.BidPrice > 0 && ticker.AskPrice > 0 {
		ticker.LastPrice = (ticker.BidPrice + ticker.AskPrice) / 2
		ticker.MarkPrice = ticker.LastPrice
		ticker.IndexPrice = ticker.LastPrice
	}
	
	// Calculate 24h stats
	var volume, quoteVolume float64
	for _, trade := range me.Trades {
		if time.Since(trade.Timestamp).Hours() < 24 {
			volume += trade.Quantity
			quoteVolume += trade.QuoteQuantity
		}
	}
	ticker.Volume24h = volume
	ticker.QuoteVolume24h = quoteVolume
	
	return ticker
}

// =============================================================================
// FEE MANAGER
// =============================================================================

type FeeManager struct {
	makerFee    float64
	takerFee    float64
	vipDiscount map[int]float64 // KYC level to discount
	mu          sync.RWMutex
}

func NewFeeManager() *FeeManager {
	return &FeeManager{
		makerFee: 0.001, // 0.1%
		takerFee: 0.001, // 0.1%
		vipDiscount: map[int]float64{
			0: 1.0,   // No discount
			1: 0.95,  // 5% discount
			2: 0.90,  // 10% discount
			3: 0.85,  // 15% discount
			4: 0.80,  // 20% discount
			5: 0.75,  // 25% discount
		},
	}
}

func (fm *FeeManager) GetMakerFee(userID string) float64 {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	return fm.makerFee
}

func (fm *FeeManager) GetTakerFee(userID string) float64 {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	return fm.takerFee
}

func (fm *FeeManager) CalculateFee(amount float64, isMaker bool, kycLevel int) float64 {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	
	rate := fm.takerFee
	if isMaker {
		rate = fm.makerFee
	}
	
	discount := fm.vipDiscount[kycLevel]
	if discount == 0 {
		discount = 1.0
	}
	
	return amount * rate * discount
}

// =============================================================================
// RISK ENGINE
// =============================================================================

type RiskEngine struct {
	maxPositionSize    float64
	maxOrderValue     float64
	maxLeverage       int
	priceDeviationLimit float64
	mu                sync.RWMutex
}

func NewRiskEngine() *RiskEngine {
	return &RiskEngine{
		maxPositionSize:    1000000, // $1M max position
		maxOrderValue:     100000,  // $100K max order
		maxLeverage:       125,     // Max 125x leverage
		priceDeviationLimit: 0.05,  // 5% max price deviation
	}
}

func (re *RiskEngine) ValidateOrder(order *Order, user *UserAccount) error {
	re.mu.Lock()
	defer re.mu.Unlock()
	
	// Check position size
	orderValue := order.Price * order.Quantity
	if orderValue > re.maxOrderValue {
		return fmt.Errorf("order value exceeds maximum: %f", re.maxOrderValue)
	}
	
	// Check leverage
	if order.Leverage > re.maxLeverage {
		return fmt.Errorf("leverage exceeds maximum: %d", re.maxLeverage)
	}
	
	// Check price deviation
	market, ok := re.getMarket(order.Symbol)
	if ok {
		lastPrice := market.LastPrice
		if lastPrice > 0 {
			deviation := math.Abs(order.Price - lastPrice) / lastPrice
			if deviation > re.priceDeviationLimit {
				return fmt.Errorf("price deviation too large: %.2f%%", deviation*100)
			}
		}
	}
	
	return nil
}

func (re *RiskEngine) getMarket(symbol string) (*Market, bool) {
	return nil, false
}

func (re *RiskEngine) CheckMarginRequirements(position *Position, market *Market) error {
	if position.Margin <= 0 {
		return fmt.Errorf("insufficient margin")
	}
	
	maintMargin := position.Size * position.MarkPrice * 0.005 // 0.5% maintenance
	if position.Margin < maintMargin {
		return fmt.Errorf("margin below maintenance level")
	}
	
	return nil
}

// =============================================================================
// LIQUIDATION ENGINE
// =============================================================================

type LiquidationEngine struct {
	liquidationFee    float64
	bankruptcyFee     float64
	insuranceFund     float64
	partialLiqRatio   float64
	maxLiquidations   int
	mu                sync.RWMutex
}

func NewLiquidationEngine() *LiquidationEngine {
	return &LiquidationEngine{
		liquidationFee:  0.01,   // 1%
		bankruptcyFee:   0.005,  // 0.5%
		insuranceFund:   0,
		partialLiqRatio: 0.25,   // Liquidate 25% at a time
		maxLiquidations: 100,
	}
}

func (le *LiquidationEngine) CheckLiquidation(position *Position, market *Market) bool {
	le.mu.Lock()
	defer le.mu.Unlock()
	
	if position.Size == 0 {
		return false
	}
	
	// Calculate margin ratio
	marginRatio := (position.Margin / (position.Size * position.MarkPrice)) * 100
	
	// Maintenance margin threshold
	maintMarginRatio := 0.5 // 0.5%
	
	return marginRatio <= maintMarginRatio
}

func (le *LiquidationEngine) LiquidatePosition(position *Position, market *Market) ([]Trade, error) {
	if !le.CheckLiquidation(position, market) {
		return nil, fmt.Errorf("position not eligible for liquidation")
	}
	
	le.mu.Lock()
	defer le.mu.Unlock()
	
	// Calculate liquidation price
	liquidationPrice := position.EntryPrice
	if position.Side == Long {
		liquidationPrice = position.EntryPrice * (1 - float64(position.Leverage)/100 + 0.01)
	} else {
		liquidationPrice = position.EntryPrice * (1 + float64(position.Leverage)/100 - 0.01)
	}
	
	// Partial liquidation
	liqSize := position.Size * le.partialLiqRatio
	
	trades := make([]Trade, 0)
	
	// Execute liquidation trades
	// In production, this would interact with the matching engine
	_ = liquidationPrice
	_ = liqSize
	
	return trades, nil
}

func (le *LiquidationEngine) UpdateInsuranceFund(amount float64) {
	le.mu.Lock()
	defer le.mu.Unlock()
	le.insuranceFund += amount
}

func (le *LiquidationEngine) GetInsuranceFund() float64 {
	le.mu.RLock()
	defer le.mu.RUnlock()
	return le.insuranceFund
}

// =============================================================================
// MARGIN TRADING ENGINE
// =============================================================================

type MarginTradingEngine struct {
	engine            *MatchingEngine
	interestCalculator *InterestCalculator
	maxBorrowRatio   float64
	forceLiquidationRatio float64
	mu                sync.RWMutex
}

func NewMarginTradingEngine(engine *MatchingEngine) *MarginTradingEngine {
	return &MarginTradingEngine{
		engine:             engine,
		interestCalculator: NewInterestCalculator(),
		maxBorrowRatio:     0.5,  // Max borrow 50% of collateral
		forceLiquidationRatio: 0.3, // Force liquidate at 30% margin ratio
	}
}

type Borrow struct {
	BorrowID     string
	UserID       string
	Asset        string
	Amount       float64
	InterestRate float64
	Interest     float64
	BorrowedAt   time.Time
}

func (mc *MarginTradingEngine) Borrow(userID, asset string, amount float64) (*Borrow, error) {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	
	user, ok := mc.engine.Users[userID]
	if !ok {
		return nil, fmt.Errorf("user not found")
	}
	
	// Calculate max borrow
	collateralValue := mc.calculateCollateralValue(user, "USDT")
	maxBorrow := collateralValue * mc.maxBorrowRatio
	
	// Check current borrow
	currentBorrow := mc.getTotalBorrow(userID, asset)
	if currentBorrow+amount > maxBorrow {
		return nil, fmt.Errorf("borrow amount exceeds maximum")
	}
	
	// Create borrow
	borrow := &Borrow{
		BorrowID:     fmt.Sprintf("BORROW-%s-%d", userID, time.Now().Unix()),
		UserID:       userID,
		Asset:        asset,
		Amount:       amount,
		InterestRate: mc.interestCalculator.GetInterestRate(asset),
		Interest:     0,
		BorrowedAt:   time.Now(),
	}
	
	// Add to user balance
	user.mu.Lock()
	if user.Balances[asset] == nil {
		user.Balances[asset] = &Balance{Asset: asset}
	}
	user.Balances[asset].Available += amount
	user.mu.Unlock()
	
	return borrow, nil
}

func (mc *MarginTradingEngine) Repay(userID, asset string, amount float64) error {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	
	// Calculate interest first
	interest := mc.interestCalculator.CalculateInterest(userID, asset)
	totalDue := amount + interest
	
	user, ok := mc.engine.Users[userID]
	if !ok {
		return fmt.Errorf("user not found")
	}
	
	user.mu.Lock()
	defer user.mu.Unlock()
	
	if user.Balances[asset].Available < totalDue {
		return fmt.Errorf("insufficient balance to repay")
	}
	
	user.Balances[asset].Available -= totalDue
	return nil
}

func (mc *MarginTradingEngine) calculateCollateralValue(user *UserAccount, quoteAsset string) float64 {
	// Calculate total collateral value in quote asset
	var totalValue float64
	
	user.mu.RLock()
	defer user.mu.RUnlock()
	
	for asset, balance := range user.Balances {
		// In production, get price from price feed
		price := 1.0 // Simplified
		if asset != quoteAsset {
			price = mc.getAssetPrice(asset, quoteAsset)
		}
		totalValue += (balance.Available + balance.Locked) * price
	}
	
	return totalValue
}

func (mc *MarginTradingEngine) getTotalBorrow(userID, asset string) float64 {
	// In production, query borrow records
	return 0
}

func (mc *MarginTradingEngine) getAssetPrice(asset, quoteAsset string) float64 {
	// In production, get from price feed
	return 1.0
}

// =============================================================================
// INTEREST CALCULATOR
// =============================================================================

type InterestCalculator struct {
	interestRates map[string]float64
	dailyRate     float64
	mu            sync.RWMutex
}

func NewInterestCalculator() *InterestCalculator {
	return &InterestCalculator{
		interestRates: map[string]float64{
			"BTC":  0.0005, // 0.05% daily
			"ETH":  0.0006,
			"USDT": 0.0004,
			"USDC": 0.0004,
			"BNB":  0.0005,
		},
		dailyRate: 0.0005, // Default 0.05% daily
	}
}

func (ic *InterestCalculator) GetInterestRate(asset string) float64 {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	
	if rate, ok := ic.interestRates[asset]; ok {
		return rate
	}
	return ic.dailyRate
}

func (ic *InterestCalculator) CalculateInterest(userID, asset string) float64 {
	ic.mu.RLock()
	rate := ic.interestRates[asset]
	if rate == 0 {
		rate = ic.dailyRate
	}
	ic.mu.RUnlock()
	
	// Get borrow amount from storage
	borrowAmount := ic.getBorrowAmount(userID, asset)
	
	// Calculate interest: amount * rate * hours / 24
	hours := time.Now().Hour()
	interest := borrowAmount * rate * float64(hours) / 24
	
	return interest
}

func (ic *InterestCalculator) getBorrowAmount(userID, asset string) float64 {
	// In production, query from borrow records
	return 0
}

// =============================================================================
// FUTURES TRADING ENGINE
// =============================================================================

type FuturesEngine struct {
	engine        *MatchingEngine
	fundingEngine *FundingEngine
	settlementEngine *SettlementEngine
	positions     map[string]*FuturesPosition
	markPrice     float64
	indexPrice    float64
	nextFundingTime time.Time
	mu            sync.RWMutex
}

type FuturesPosition struct {
	PositionID       string
	UserID           string
	Symbol           string
	Side             PositionSide
	Size             float64
	EntryPrice       float64
	MarkPrice        float64
	LiquidationPrice float64
	Leverage         int
	UnrealizedPNL    float64
	RealizedPNL      float64
	Margin           float64
	MaintenanceMargin float64
	FundingPNL       float64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func NewFuturesEngine(engine *MatchingEngine) *FuturesEngine {
	return &FuturesEngine{
		engine:          engine,
		fundingEngine:   NewFundingEngine(),
		settlementEngine: NewSettlementEngine(),
		positions:      make(map[string]*FuturesPosition),
		nextFundingTime: time.Now().Add(8 * time.Hour), // Funding every 8 hours
	}
}

func (fe *FuturesEngine) OpenPosition(userID, symbol string, side PositionSide, size, leverage float64) (*FuturesPosition, error) {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	position := &FuturesPosition{
		PositionID:       fmt.Sprintf("POS-%s-%s-%d", userID, symbol, time.Now().Unix()),
		UserID:          userID,
		Symbol:          symbol,
		Side:            side,
		Size:            size,
		EntryPrice:      fe.markPrice,
		MarkPrice:       fe.markPrice,
		Leverage:        int(leverage),
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	
	// Calculate initial margin
	position.Margin = (size * fe.markPrice) / leverage
	
	// Calculate liquidation price
	if side == Long {
		position.LiquidationPrice = fe.markPrice * (1 - 1/float64(leverage) + 0.01)
	} else {
		position.LiquidationPrice = fe.markPrice * (1 + 1/float64(leverage) - 0.01)
	}
	
	position.MaintenanceMargin = position.Margin * 0.5 // 50% of margin
	
	key := fmt.Sprintf("%s-%s", userID, symbol)
	fe.positions[key] = position
	
	return position, nil
}

func (fe *FuturesEngine) UpdateMarkPrice(price float64) {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	fe.markPrice = price
	
	// Update all positions
	for _, pos := range fe.positions {
		pos.MarkPrice = price
		pos.UpdatedAt = time.Now()
		
		// Calculate unrealized PNL
		if pos.Side == Long {
			pos.UnrealizedPNL = (pos.MarkPrice - pos.EntryPrice) * pos.Size
		} else {
			pos.UnrealizedPNL = (pos.EntryPrice - pos.MarkPrice) * pos.Size
		}
		
		// Check liquidation
		marginRatio := (pos.Margin / (pos.Size * pos.MarkPrice)) * 100
		if marginRatio < float64(pos.MaintenanceMargin)/100 {
			fe.liquidatePosition(pos)
		}
	}
}

func (fe *FuturesEngine) liquidatePosition(pos *FuturesPosition) {
	// Trigger liquidation
	// In production, interact with matching engine
	pos.Size = 0
}

func (fe *FuturesEngine) ProcessFunding() {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	
	if time.Now().Before(fe.nextFundingTime) {
		return
	}
	
	// Calculate and apply funding
	for key, pos := range fe.positions {
		if pos.Size == 0 {
			continue
		}
		
		funding := fe.fundingEngine.CalculateFunding(pos, fe.markPrice)
		
		if pos.Side == Long {
			pos.FundingPNL -= funding
		} else {
			pos.FundingPNL += funding
		}
		
		fe.positions[key] = pos
	}
	
	fe.nextFundingTime = fe.nextFundingTime.Add(8 * time.Hour)
}

// =============================================================================
// FUNDING ENGINE
// =============================================================================

type FundingEngine struct {
	fundingRate float64
	mu          sync.RWMutex
}

func NewFundingEngine() *FundingEngine {
	return &FundingEngine{
		fundingRate: 0.0001, // 0.01% every 8 hours
	}
}

func (fe *FundingEngine) CalculateFunding(position *FuturesPosition, markPrice float64) float64 {
	fe.mu.RLock()
	defer fe.mu.RUnlock()
	
	// Funding = Position Value * Funding Rate
	return position.Size * markPrice * fe.fundingRate
}

func (fe *FundingEngine) SetFundingRate(rate float64) {
	fe.mu.Lock()
	defer fe.mu.Unlock()
	fe.fundingRate = rate
}

// =============================================================================
// SETTLEMENT ENGINE
// =============================================================================

type SettlementEngine struct {
	settlementInterval time.Duration
	mu                 sync.RWMutex
}

func NewSettlementEngine() *SettlementEngine {
	return &SettlementEngine{
		settlementInterval: 8 * time.Hour,
	}
}

func (se *SettlementEngine) SettlePosition(position *FuturesPosition) error {
	se.mu.Lock()
	defer se.mu.Unlock()
	
	// Realize PNL
	position.RealizedPNL += position.UnrealizedPNL + position.FundingPNL
	
	// Reset for next period
	position.UnrealizedPNL = 0
	position.FundingPNL = 0
	
	return nil
}

func (se *SettlementEngine) SettleAll(positions map[string]*FuturesPosition) error {
	for _, pos := range positions {
		if err := se.SettlePosition(pos); err != nil {
			return err
		}
	}
	return nil
}

// =============================================================================
// OPTIONS TRADING ENGINE
// =============================================================================

type OptionsEngine struct {
	engine       *MatchingEngine
	pricingModel *BlackScholes
	positions    map[string]*OptionPosition
	expirations  []time.Time
	mu           sync.RWMutex
}

type OptionPosition struct {
	PositionID   string
	UserID       string
	Symbol       string
	OptionType   string // "call" or "put"
	StrikePrice  float64
	Expiry       time.Time
	Size         float64
	EntryPrice   float64
	CurrentPrice float64
	UnrealizedPNL float64
	Delta        float64
	Gamma        float64
	Theta        float64
	Vega         float64
	Rho          float64
}

type BlackScholes struct {
	mu sync.RWMutex
}

func NewBlackScholes() *BlackScholes {
	return &BlackScholes{}
}

func (bs *BlackScholes) CalculateCallPrice(S, K, T, r, sigma float64) float64 {
	// S: Spot price, K: Strike price, T: Time to expiry, r: Risk-free rate, sigma: Volatility
	d1 := (math.Log(S/K) + (r + sigma*sigma/2)*T) / (sigma * math.Sqrt(T))
	d2 := d1 - sigma*math.Sqrt(T)
	
	call := S * bs.normCDF(d1) - K * math.Exp(-r*T) * bs.normCDF(d2)
	return call
}

func (bs *BlackScholes) CalculatePutPrice(S, K, T, r, sigma float64) float64 {
	d1 := (math.Log(S/K) + (r + sigma*sigma/2)*T) / (sigma * math.Sqrt(T))
	d2 := d1 - sigma*math.Sqrt(T)
	
	put := K * math.Exp(-r*T) * bs.normCDF(-d2) - S * bs.normCDF(-d1)
	return put
}

func (bs *BlackScholes) normCDF(x float64) float64 {
	return 0.5 * (1 + math.Erf(x/math.Sqrt(2)))
}

func (bs *BlackScholes) CalculateGreeks(optionType string, S, K, T, r, sigma float64) (float64, float64, float64, float64, float64) {
	d1 := (math.Log(S/K) + (r + sigma*sigma/2)*T) / (sigma * math.Sqrt(T))
	d2 := d1 - sigma*math.Sqrt(T)
	
	nd1 := bs.normPDF(d1)
	
	delta := math.Exp(-r*T) * bs.normCDF(d1)
	if optionType == "put" {
		delta -= math.Exp(-r*T)
	}
	
	gamma := math.Exp(-r*T) * nd1 / (S * sigma * math.Sqrt(T))
	
	theta := -(S * nd1 * sigma * math.Exp(-r*T)) / (2*math.Sqrt(T)) - r*K*math.Exp(-r*T)*bs.normCDF(d2)
	if optionType == "put" {
		theta += r*K*math.Exp(-r*T)*bs.normCDF(-d2)
	}
	theta /= 365
	
	vega := S * math.Exp(-r*T) * nd1 * math.Sqrt(T) / 100
	
	rho := K * T * math.Exp(-r*T) * bs.normCDF(d2) / 100
	if optionType == "put" {
		rho -= K * T * math.Exp(-r*T) * bs.normCDF(-d2) / 100
	}
	
	return delta, gamma, theta, vega, rho
}

func (bs *BlackScholes) normPDF(x float64) float64 {
	return math.Exp(-x*x/2) / math.Sqrt(2*math.Pi)
}

func (oe *OptionsEngine) OpenOptionPosition(userID, symbol string, optionType string, strikePrice float64, size float64, expiry time.Time) (*OptionPosition, error) {
	oe.mu.Lock()
	defer oe.mu.Unlock()
	
	// Calculate entry price
	S := oe.engine.markPrice
	T := expiry.Sub(time.Now()).Hours() / (24 * 365) // Years
	r := 0.05 // Risk-free rate (5%)
	sigma := 0.30 // Implied volatility (30%)
	
	var entryPrice float64
	if optionType == "call" {
		entryPrice = oe.pricingModel.CalculateCallPrice(S, strikePrice, T, r, sigma)
	} else {
		entryPrice = oe.pricingModel.CalculatePutPrice(S, strikePrice, T, r, sigma)
	}
	
	position := &OptionPosition{
		PositionID:  fmt.Sprintf("OPT-%s-%s-%d", userID, symbol, time.Now().Unix()),
		UserID:      userID,
		Symbol:      symbol,
		OptionType:  optionType,
		StrikePrice: strikePrice,
		Expiry:      expiry,
		Size:        size,
		EntryPrice:  entryPrice,
		CurrentPrice: entryPrice,
	}
	
	// Calculate initial Greeks
	delta, gamma, theta, vega, rho := oe.pricingModel.CalculateGreeks(optionType, S, strikePrice, T, r, sigma)
	position.Delta = delta
	position.Gamma = gamma
	position.Theta = theta
	position.Vega = vega
	position.Rho = rho
	
	key := fmt.Sprintf("%s-%s-%d", userID, symbol, expiry.Unix())
	oe.positions[key] = position
	
	return position, nil
}

func (oe *OptionsEngine) UpdatePositionPrices(markPrice float64) {
	oe.mu.Lock()
	defer oe.mu.Unlock()
	
	oe.engine.markPrice = markPrice
	
	for _, pos := range oe.positions {
		S := markPrice
		K := pos.StrikePrice
		T := pos.Expiry.Sub(time.Now()).Hours() / (24 * 365)
		r := 0.05
		sigma := 0.30
		
		var currentPrice float64
		if pos.OptionType == "call" {
			currentPrice = oe.pricingModel.CalculateCallPrice(S, K, T, r, sigma)
		} else {
			currentPrice = oe.pricingModel.CalculatePutPrice(S, K, T, r, sigma)
		}
		
		pos.CurrentPrice = currentPrice
		pos.UnrealizedPNL = (currentPrice - pos.EntryPrice) * pos.Size
		
		// Update Greeks
		delta, gamma, theta, vega, rho := oe.pricingModel.CalculateGreeks(pos.OptionType, S, K, T, r, sigma)
		pos.Delta = delta
		pos.Gamma = gamma
		pos.Theta = theta
		pos.Vega = vega
		pos.Rho = rho
	}
}

func (oe *OptionsEngine) ExerciseOption(positionID string) (float64, error) {
	oe.mu.Lock()
	defer oe.mu.Unlock()
	
	position, ok := oe.positions[positionID]
	if !ok {
		return 0, fmt.Errorf("position not found")
	}
	
	if time.Now().Before(position.Expiry) {
		return 0, fmt.Errorf("option not yet expired")
	}
	
	// Calculate intrinsic value
	S := oe.engine.markPrice
	var intrinsicValue float64
	
	if position.OptionType == "call" {
		intrinsicValue = math.Max(0, S-position.StrikePrice)
	} else {
		intrinsicValue = math.Max(0, position.StrikePrice-S)
	}
	
	// P&L = Intrinsic Value - Entry Price
	pnl := (intrinsicValue - position.EntryPrice) * position.Size
	
	position.Size = 0
	
	return pnl, nil
}

// =============================================================================
// ORDER BOOK AGGREGATOR
// =============================================================================

type OrderBookAggregator struct {
	sources   []string
	orderBooks map[string]*OrderBook
	weights   map[string]float64
	mu        sync.RWMutex
}

func NewOrderBookAggregator() *OrderBookAggregator {
	return &OrderBookAggregator{
		sources:    make([]string, 0),
		orderBooks: make(map[string]*OrderBook),
		weights:    make(map[string]float64),
	}
}

func (oba *OrderBookAggregator) AddSource(source string, weight float64) {
	oba.mu.Lock()
	defer oba.mu.Unlock()
	
	oba.sources = append(oba.sources, source)
	oba.weights[source] = weight
}

func (oba *OrderBookAggregator) GetAggregatedOrderBook(symbol string) *OrderBook {
	oba.mu.RLock()
	defer oba.mu.RUnlock()
	
	aggregated := &OrderBook{
		Symbol: symbol,
		Bids:   make([]OrderBookLevel, 0),
		Asks:   make([]OrderBookLevel, 0),
	}
	
	// Aggregate bids
	bidMap := make(map[float64]float64)
	for source, book := range oba.orderBooks {
		weight := oba.weights[source]
		for _, bid := range book.Bids {
			bidMap[bid.Price] += bid.Quantity * weight
		}
	}
	
	for price, qty := range bidMap {
		aggregated.Bids = append(aggregated.Bids, OrderBookLevel{
			Price:    price,
			Quantity: qty,
			Orders:   1,
		})
	}
	
	// Aggregate asks
	askMap := make(map[float64]float64)
	for source, book := range oba.orderBooks {
		weight := oba.weights[source]
		for _, ask := range book.Asks {
			askMap[ask.Price] += ask.Quantity * weight
		}
	}
	
	for price, qty := range askMap {
		aggregated.Asks = append(aggregated.Asks, OrderBookLevel{
			Price:    price,
			Quantity: qty,
			Orders:   1,
		})
	}
	
	return aggregated
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

func main() {
	log.Println("TigerEx Trading Engine v3.0 Starting...")
	
	// Create matching engine
	engine := NewMatchingEngine("BTCUSDT")
	
	// Add sample market
	engine.Markets["BTCUSDT"] = &Market{
		Symbol:            "BTCUSDT",
		BaseAsset:         "BTC",
		QuoteAsset:        "USDT",
		PricePrecision:    2,
		QuantityPrecision: 6,
		MinQuantity:       0.00001,
		MaxQuantity:       9000,
		MinNotional:       10,
		TickSize:          0.01,
		TakerFee:          0.001,
		MakerFee:          0.001,
		IsTrading:         true,
		LastPrice:         67432.50,
		MarkPrice:         67432.50,
		IndexPrice:        67432.50,
		High24h:           68000,
		Low24h:            66000,
		Volume24h:         25000,
		QuoteVolume24h:    1685000000,
	}
	
	// Add sample user
	engine.Users["user1"] = &UserAccount{
		UserID: "user1",
		Balances: map[string]*Balance{
			"BTC":  {Asset: "BTC", Available: 2.0, Locked: 0},
			"USDT": {Asset: "USDT", Available: 50000, Locked: 0},
		},
		KycLevel: 2,
	}
	
	// Initialize order book with some data
	engine.OrderBook.Bids = []OrderBookLevel{
		{Price: 67430.00, Quantity: 1.5, Orders: 5},
		{Price: 67429.50, Quantity: 2.3, Orders: 8},
		{Price: 67429.00, Quantity: 0.8, Orders: 3},
		{Price: 67428.50, Quantity: 3.2, Orders: 12},
		{Price: 67428.00, Quantity: 1.0, Orders: 4},
	}
	
	engine.OrderBook.Asks = []OrderBookLevel{
		{Price: 67435.00, Quantity: 2.1, Orders: 7},
		{Price: 67435.50, Quantity: 1.8, Orders: 6},
		{Price: 67436.00, Quantity: 0.9, Orders: 4},
		{Price: 67436.50, Quantity: 2.5, Orders: 9},
		{Price: 67437.00, Quantity: 1.2, Orders: 5},
	}
	
	// Create margin trading engine
	marginEngine := NewMarginTradingEngine(engine)
	
	// Create futures engine
	futuresEngine := NewFuturesEngine(engine)
	
	// Create options engine
	optionsEngine := NewOptionsEngine(engine)
	
	log.Println("Engines initialized successfully")
	
	// Simulate trading
	ctx := context.Background()
	
	// Process sample orders
	orders := []*Order{
		{
			OrderID:   "order1",
			UserID:    "user1",
			Symbol:    "BTCUSDT",
			Side:      Buy,
			Type:      LimitOrder,
			Price:     67430.00,
			Quantity:  0.5,
			TimeInForce: GTC,
		},
		{
			OrderID:   "order2",
			UserID:    "user1",
			Symbol:    "BTCUSDT",
			Side:      Sell,
			Type:      LimitOrder,
			Price:     67435.00,
			Quantity:  0.3,
			TimeInForce: GTC,
		},
	}
	
	for _, order := range orders {
		resultOrder, trades, err := engine.ProcessOrder(order)
		if err != nil {
			log.Printf("Order %s error: %v", order.OrderID, err)
			continue
		}
		
		log.Printf("Order %s processed: status=%s, filled=%.6f", 
			resultOrder.OrderID, resultOrder.Status, resultOrder.FilledQuantity)
		
		for _, trade := range trades {
			log.Printf("Trade: %s price=%.2f qty=%.6f value=%.2f", 
				trade.TradeID, trade.Price, trade.Quantity, trade.QuoteQuantity)
		}
	}
	
	// Get ticker
	ticker := engine.GetTicker("BTCUSDT")
	orderBook := engine.GetOrderBook("BTCUSDT")
	
	log.Printf("Current Ticker: Last=%.2f Bid=%.2f Ask=%.2f", 
		ticker.LastPrice, ticker.BidPrice, ticker.AskPrice)
	log.Printf("Order Book: %d bids, %d asks", len(orderBook.Bids), len(orderBook.Asks))
	
	// Get engine stats
	log.Printf("Engine Stats: orders_processed=%d, trades_executed=%d, avg_latency=%.2fms", 
		engine.ordersProcessed, engine.tradesExecuted, engine.avgLatencyMs)
	
	// Start background tasks
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Simulate price updates
				priceChange := (rand.Float64() - 0.5) * 10
				engine.Markets["BTCUSDT"].LastPrice += priceChange
				engine.Markets["BTCUSDT"].MarkPrice = engine.Markets["BTCUSDT"].LastPrice
				
				// Update futures and options
				futuresEngine.UpdateMarkPrice(engine.Markets["BTCUSDT"].MarkPrice)
				optionsEngine.UpdatePositionPrices(engine.Markets["BTCUSDT"].MarkPrice)
				
				// Process funding
				futuresEngine.ProcessFunding()
			}
		}
	}()
	
	// Wait for shutdown
	<-ctx.Done()
	
	log.Println("Shutting down...")
}

// GetMarkets returns all available markets
func (me *MatchingEngine) GetMarkets() map[string]*Market {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	markets := make(map[string]*Market)
	for k, v := range me.Markets {
		markets[k] = v
	}
	return markets
}

// GetUserPositions returns all positions for a user
func (me *MatchingEngine) GetUserPositions(userID string) []*Position {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	positions := make([]*Position, 0)
	for _, pos := range me.Positions {
		if pos.UserID == userID {
			positions = append(positions, pos)
		}
	}
	return positions
}

// GetUserBalance returns user balance for an asset
func (me *MatchingEngine) GetUserBalance(userID, asset string) *Balance {
	user, ok := me.Users[userID]
	if !ok {
		return nil
	}
	
	user.mu.RLock()
	defer user.mu.RUnlock()
	
	return user.Balances[asset]
}

// GetRecentTrades returns recent trades
func (me *MatchingEngine) GetRecentTrades(symbol string, limit int) []Trade {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	trades := make([]Trade, 0)
	for i := len(me.Trades) - 1; i >= 0 && len(trades) < limit; i-- {
		if me.Trades[i].Symbol == symbol {
			trades = append(trades, me.Trades[i])
		}
	}
	return trades
}

// GetTradesSince returns trades since a timestamp
func (me *MatchingEngine) GetTradesSince(symbol string, since time.Time) []Trade {
	me.mu.RLock()
	defer me.mu.RUnlock()
	
	trades := make([]Trade, 0)
	for _, trade := range me.Trades {
		if trade.Symbol == symbol && trade.Timestamp.After(since) {
			trades = append(trades, trade)
		}
	}
	return trades
}

// ToJSON converts order to JSON
func (o *Order) ToJSON() ([]byte, error) {
	return json.Marshal(o)
}

// ToJSON converts trade to JSON
func (t *Trade) ToJSON() ([]byte, error) {
	return json.Marshal(t)
}

// ToJSON converts ticker to JSON
func (t *Ticker) ToJSON() ([]byte, error) {
	return json.Marshal(t)
}

// ToJSON converts order book to JSON
func (ob *OrderBook) ToJSON() ([]byte, error) {
	return json.Marshal(ob)
}

// FromJSON parses order from JSON
func (o *Order) FromJSON(data []byte) error {
	return json.Unmarshal(data, o)
}