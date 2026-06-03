// Package engine provides the core spot trading matching engine.
// This implements a high-performance central limit order book (CLOB).
package engine

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"TigerEx/spot_trading/types"

	"github.com/shopspring/decimal"
)

// MatchEngine represents the spot trading match engine
type MatchEngine struct {
	mu           sync.RWMutex
	markets     map[string]*types.Market
	orderBooks  map[string]*OrderBook
	orders      map[string]*types.Order
	userOrders  map[string]map[string]*types.Order
	trades      map[string]*types.Trade
	feeCalc     *FeeCalculator
	widthDb    func(ctx context.Context, query string, args ...interface{}) error
	queryRow   func(ctx context.Context, query string, args ...interface{}) error
	query     func(ctx context.Context, query string, args ...interface{}) ([]interface{}, error)
}

// OrderBook manages bids and asks for a symbol
type OrderBook struct {
	symbol       string
	bids         map[string]*types.Order // price -> order
	asks         map[string]*types.Order
	bidPrices    []string
	askPrices    []string
	lastUpdateID int64
	timestamp    time.Time
	mu           sync.RWMutex
}

// FeeCalculator calculates trading fees
type FeeCalculator struct {
	makerFees map[string]decimal.Decimal
	takerFees map[string]decimal.Decimal
	defaultMaker decimal.Decimal
	defaultTaker decimal.Decimal
}

// NewMatchEngine creates a new match engine
func NewMatchEngine() *MatchEngine {
	return &MatchEngine{
		markets:    make(map[string]*types.Market),
		orderBooks: make(map[string]*OrderBook),
		orders:    make(map[string]*types.Order),
		userOrders: make(map[string]map[string]*types.Order),
		trades:    make(map[string]*types.Trade),
		feeCalc:   NewFeeCalculator(),
	}
}

// NewOrderBook creates a new order book for a symbol
func NewOrderBook(symbol string) *OrderBook {
	return &OrderBook{
		symbol:    symbol,
		bids:     make(map[string]*types.Order),
		asks:    make(map[string]*types.Order),
		bidPrices: []string{},
		askPrices: []string{},
	}
}

// NewFeeCalculator creates a new fee calculator
func NewFeeCalculator() *FeeCalculator {
	return &FeeCalculator{
		makerFees:   make(map[string]decimal.Decimal),
		takerFees:  make(map[string]decimal.Decimal),
		defaultMaker: decimal.NewFromFloat(0.001),
		defaultTaker: decimal.NewFromFloat(0.001),
	}
}

// SetFee sets the maker/taker fee for a symbol
func (fc *FeeCalculator) SetFee(symbol string, maker, taker decimal.Decimal) {
	fc.makerFees[symbol] = maker
	fc.takerFees[symbol] = taker
}

// CalculateFee calculates the fee for a trade
func (fc *FeeCalculator) CalculateFee(tradeAmount decimal.Decimal, symbol string, isMaker bool) decimal.Decimal {
	var feeRate decimal.Decimal
	if isMaker {
		feeRate = fc.makerFees[symbol]
		if feeRate.Equal(decimal.Zero) {
			feeRate = fc.defaultMaker
		}
	} else {
		feeRate = fc.takerFees[symbol]
		if feeRate.Equal(decimal.Zero) {
			feeRate = fc.defaultTaker
		}
	}
	return tradeAmount.Mul(feeRate)
}

// RegisterMarket registers a new market
func (me *MatchEngine) RegisterMarket(market *types.Market) error {
	me.mu.Lock()
	defer me.mu.Unlock()

	if _, exists := me.markets[market.Symbol]; exists {
		return fmt.Errorf("market %s already exists", market.Symbol)
	}
	me.markets[market.Symbol] = market
	me.orderBooks[market.Symbol] = NewOrderBook(market.Symbol)
	
	// Set fees from market
	me.feeCalc.SetFee(market.Symbol, market.MakerFee, market.TakerFee)
	
	return nil
}

// GetMarket returns a market by symbol
func (me *MatchEngine) GetMarket(symbol string) (*types.Market, bool) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	market, ok := me.markets[symbol]
	return market, ok
}

// GetOrderBook returns the order book for a symbol
func (me *MatchEngine) GetOrderBook(symbol string) (*OrderBook, bool) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	ob, ok := me.orderBooks[symbol]
	return ob, ok
}

// SubmitOrder submits a new order to the engine
func (me *MatchEngine) SubmitOrder(ctx context.Context, order *types.Order) (*types.Order, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	// Validate market exists
	market, ok := me.markets[order.Symbol]
	if !ok {
		return nil, fmt.Errorf("market %s not found", order.Symbol)
	}

	// Validate order
	if err := order.Validate(); err != nil {
		return nil, err
	}

	// Check market is tradable
	if !market.IsTradable {
		return nil, fmt.Errorf("market %s is not tradable", order.Symbol)
	}

	// Handle different order types
	switch order.OrderType {
	case types.OrderTypeMarket:
		return me.processMarketOrder(ctx, order)
	case types.OrderTypeLimit:
		return me.processLimitOrder(ctx, order)
	case types.OrderTypeStopLoss, types.OrderTypeStopLimit:
		return me.processStopOrder(ctx, order)
	default:
		return nil, fmt.Errorf("unsupported order type: %s", order.OrderType)
	}
}

// processMarketOrder processes a market order
func (me *MatchEngine) processMarketOrder(ctx context.Context, order *types.Order) (*types.Order, error) {
	ob := me.orderBooks[order.Symbol]
	order.Status = types.OrderStatusOpen
	
	// Get best price from opposite side
	var bestPrice decimal.Decimal
	if order.Side == types.OrderSideBuy {
		if len(ob.askPrices) > 0 {
			bestPrice, _ = decimal.NewFromString(ob.askPrices[0])
		}
	} else {
		if len(ob.bidPrices) > 0 {
			bestPrice, _ = decimal.NewFromString(ob.bidPrices[0])
		}
	}

	// If no liquidity, reject market order
	if bestPrice.Equal(decimal.Zero) {
		order.Status = types.OrderStatusRejected
		return order, fmt.Errorf("no liquidity for market order")
	}

	// Execute at best price
	order.Price = bestPrice

	// Try to match immediately
	matches := ob.match(order)
	if len(matches) > 0 {
		filled, trades, err := ob.executeMatches(ctx, order, matches, me.feeCalc)
		if err != nil {
			return nil, err
		}
		
		// Update order
		order.FilledQuantity = filled
		order.RemainingQuantity = order.Quantity.Sub(filled)
		order.AverageFillPrice = calculateAvgPrice(trades)
		
		if order.RemainingQuantity.GreaterThan(decimal.Zero) && order.TimeInForce == types.TimeInForceIOC {
			order.Status = types.OrderStatusPartially
			// Cancel remaining
			order.Status = types.OrderStatusCancelled
		} else if order.IsFullyFilled() {
			order.Status = types.OrderStatusFilled
		} else {
			order.Status = types.OrderStatusPartially
		}
		
		// Save trades
		for _, trade := range trades {
			me.trades[trade.ID] = trade
		}
	} else {
		order.Status = types.OrderStatusRejected
		return order, fmt.Errorf("no matching orders")
	}

	order.UpdatedAt = time.Now()
	me.orders[order.ID] = order
	return order, nil
}

// processLimitOrder processes a limit order
func (me *MatchEngine) processLimitOrder(ctx context.Context, order *types.Order) (*types.Order, error) {
	ob := me.orderBooks[order.Symbol]
	order.Status = types.OrderStatusOpen

	// Check for immediate match
	matches := ob.match(order)
	if len(matches) > 0 {
		filled, trades, err := ob.executeMatches(ctx, order, matches, me.feeCalc)
		if err != nil {
			return nil, err
		}

		order.FilledQuantity = filled
		order.RemainingQuantity = order.Quantity.Sub(filled)
		order.AverageFillPrice = calculateAvgPrice(trades)

		if order.RemainingQuantity.GreaterThan(decimal.Zero) && order.TimeInForce == types.TimeInForceIOC {
			order.Status = types.OrderStatusPartially
			order.Status = types.OrderStatusCancelled
		} else if order.IsFullyFilled() {
			order.Status = types.OrderStatusFilled
		} else {
			// Add remaining to order book
			ob.addOrder(order)
			order.Status = types.OrderStatusOpen
		}

		for _, trade := range trades {
			me.trades[trade.ID] = trade
		}
	} else {
		// Add to order book
		ob.addOrder(order)
		order.Status = types.OrderStatusOpen
	}

	order.UpdatedAt = time.Now()
	me.orders[order.ID] = order
	
	// Initialize user orders map if needed
	if me.userOrders[order.UserID] == nil {
		me.userOrders[order.UserID] = make(map[string]*types.Order)
	}
	me.userOrders[order.UserID][order.ID] = order
	
	return order, nil
}

// processStopOrder processes stop loss/limit orders
func (me *MatchEngine) processStopOrder(ctx context.Context, order *types.Order) (*types.Order, error) {
	order.Status = types.OrderStatusOpen
	
	// Add to pending stop orders (would need a separate handler in production)
	// For now, treat as limit order
	return me.processLimitOrder(ctx, order)
}

// match finds matching orders for an incoming order
func (ob *OrderBook) match(incoming *types.Order) []*types.Order {
	var matches []*types.Order
	targetQty := incoming.Quantity

	if incoming.Side == types.OrderSideBuy {
		// Match with asks (sellers) - need lowest ask <= our bid
		for _, askPrice := range ob.askPrices {
			askPriceDec, _ := decimal.NewFromString(askPrice)
			
			// For market orders, any price matches
			// For limit orders, only match if price >= our limit
			if incoming.OrderType == types.OrderTypeLimit && 
			   askPriceDec.GreaterThan(incoming.Price) {
				break
			}

			for _, askOrder := range ob.asks {
				if askOrder.Status != types.OrderStatusOpen {
					continue
				}
				if askOrder.RemainingQty().IsZero() {
					continue
				}

				matchQty := minDecimal(targetQty, askOrder.RemainingQuantity)
				fillOrder(askOrder, matchQty)
				matches = append(matches, askOrder)
				targetQty = targetQty.Sub(matchQty)

				if targetQty.IsZero() {
					return matches
				}
			}
		}
	} else {
		// Match with bids (buyers) - need highest bid <= our ask
		for _, bidPrice := range ob.bidPrices {
			bidPriceDec, _ := decimal.NewFromString(bidPrice)
			
			if incoming.OrderType == types.OrderTypeLimit && 
			   bidPriceDec.LessThan(incoming.Price) {
				break
			}

			for _, bidOrder := range ob.bids {
				if bidOrder.Status != types.OrderStatusOpen {
					continue
				}
				if bidOrder.RemainingQty().IsZero() {
					continue
				}

				matchQty := minDecimal(targetQty, bidOrder.RemainingQuantity)
				fillOrder(bidOrder, matchQty)
				matches = append(matches, bidOrder)
				targetQty = targetQty.Sub(matchQty)

				if targetQty.IsZero() {
					return matches
				}
			}
		}
	}

	return matches
}

// addOrder adds an order to the order book
func (ob *OrderBook) addOrder(order *types.Order) {
	key := order.Price.StringFixed(8)
	
	if order.Side == types.OrderSideBuy {
		ob.bids[key] = order
		ob.updatePriceLevels(true)
	} else {
		ob.asks[key] = order
		ob.updatePriceLevels(false)
	}
}

// updatePriceLevels updates sorted price lists
func (ob *OrderBook) updatePriceLevels(bids bool) {
	if bids {
		ob.bidPrices = make([]string, 0, len(ob.bids))
		for price := range ob.bids {
			ob.bidPrices = append(ob.bidPrices, price)
		}
		sort.Slice(ob.bidPrices, func(i, j int) bool {
			p1, _ := decimal.NewFromString(ob.bidPrices[i])
			p2, _ := decimal.NewFromString(ob.bidPrices[j])
			return p1.GreaterThan(p2) // Descending for bids (highest first)
		})
	} else {
		ob.askPrices = make([]string, 0, len(ob.asks))
		for price := range ob.asks {
			ob.askPrices = append(ob.askPrices, price)
		}
		sort.Slice(ob.askPrices, func(i, j int) bool {
			p1, _ := decimal.NewFromString(ob.askPrices[i])
			p2, _ := decimal.NewFromString(ob.askPrices[j])
			return p1.LessThan(p2) // Ascending for asks (lowest first)
		})
	}
}

// executeMatches executes matched orders and creates trades
func (ob *OrderBook) executeMatches(ctx context.Context, order *types.Order, matches []*types.Order, feeCalc *FeeCalculator) (decimal.Decimal, []*types.Trade, error) {
	var totalFilled decimal.Decimal
	var trades []*types.Trade
	var avgPriceSum decimal.Decimal

	for _, matched := range matches {
		fillQty := minDecimal(order.Quantity.Sub(totalFilled), matched.RemainingQuantity)
		fillPrice := matched.Price
		
		tradeValue := fillQty.Mul(fillPrice)
		fee := feeCalc.CalculateFee(tradeValue, order.Symbol, true)

		trade := &types.Trade{
			ID:            generateTradeID(),
			OrderID:       order.ID,
			Symbol:       order.Symbol,
			Side:         order.Side,
			Price:        fillPrice,
			Quantity:     fillQty,
			Commission:   fee,
			MakerOrderID:  matched.ID,
			ExecutedAt:   time.Now(),
		}
		
		trades = append(trades, trade)
		totalFilled = totalFilled.Add(fillQty)
		avgPriceSum = avgPriceSum.Add(fillPrice.Mul(fillQty))

		// Update matched order
		if matched.IsFullyFilled() {
			matched.Status = types.OrderStatusFilled
		} else {
			matched.Status = types.OrderStatusPartially
		}
	}

	return totalFilled, trades, nil
}

// CancelOrder cancels an order
func (me *MatchEngine) CancelOrder(ctx context.Context, orderID, userID string) (*types.Order, error) {
	me.mu.Lock()
	defer me.mu.Unlock()

	order, ok := me.orders[orderID]
	if !ok {
		return nil, fmt.Errorf("order not found")
	}
	
	if order.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	if !order.CanFill() {
		return nil, fmt.Errorf("order cannot be cancelled in current state")
	}

	order.Status = types.OrderStatusCancelled
	order.UpdatedAt = time.Now()

	// Remove from order book
	ob, ok := me.orderBooks[order.Symbol]
	if ok {
		key := order.Price.StringFixed(8)
		if order.Side == types.OrderSideBuy {
			delete(ob.bids, key)
			ob.updatePriceLevels(true)
		} else {
			delete(ob.asks, key)
			ob.updatePriceLevels(false)
		}
	}

	return order, nil
}

// GetOrder returns an order by ID
func (me *MatchEngine) GetOrder(orderID string) (*types.Order, bool) {
	me.mu.RLock()
	defer me.mu.RUnlock()
	order, ok := me.orders[orderID]
	return order, ok
}

// GetUserOrders returns all orders for a user
func (me *MatchEngine) GetUserOrders(userID string) []*types.Order {
	me.mu.RLock()
	defer me.mu.RUnlock()

	orders := me.userOrders[userID]
	if orders == nil {
		return nil
	}

	result := make([]*types.Order, 0, len(orders))
	for _, order := range orders {
		result = append(result, order)
	}
	return result
}

// GetOpenOrders returns open orders for a symbol
func (me *MatchEngine) GetOpenOrders(symbol string) []*types.Order {
	me.mu.RLock()
	defer me.mu.RUnlock()

	var result []*types.Order
	ob, ok := me.orderBooks[symbol]
	if !ok {
		return nil
	}

	for _, order := range ob.bids {
		if order.CanFill() {
			result = append(result, order)
		}
	}
	for _, order := range ob.asks {
		if order.CanFill() {
			result = append(result, order)
		}
	}
	return result
}

// GetTrades returns trade history
func (me *MatchEngine) GetTrades(symbol string, limit int) []*types.Trade {
	me.mu.RLock()
	defer me.mu.RUnlock()

	var result []*types.Trade
	for _, trade := range me.trades {
		if trade.Symbol == symbol {
			result = append(result, trade)
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	return result
}

// GetDepth returns market depth
func (me *MatchEngine) GetDepth(symbol string, limit int) (*types.OrderBook, error) {
	me.mu.RLock()
	defer me.mu.RUnlock()

	ob, ok := me.orderBooks[symbol]
	if !ok {
		return nil, fmt.Errorf("order book not found")
	}

	depth := &types.OrderBook{
		Symbol:     symbol,
		LastUpdateID: ob.lastUpdateID,
		Timestamp: ob.timestamp,
		Bids:       []types.OrderBookEntry{},
		Asks:       []types.OrderBookEntry{},
	}

	count := limit
	if count <= 0 {
		count = 20
	}

	// Get top bids
	for i := 0; i < count && i < len(ob.bidPrices); i++ {
		price := ob.bidPrices[i]
		order := ob.bids[price]
		qty := order.RemainingQuantity
		
		depth.Bids = append(depth.Bids, types.OrderBookEntry{
			Price:    order.Price,
			Quantity: qty,
			Orders:  1,
		})
	}

	// Get top asks
	for i := 0; i < count && i < len(ob.askPrices); i++ {
		price := ob.askPrices[i]
		order := ob.asks[price]
		qty := order.RemainingQuantity
		
		depth.Asks = append(depth.Asks, types.OrderBookEntry{
			Price:    order.Price,
			Quantity: qty,
			Orders:  1,
		})
	}

	return depth, nil
}

// Helper functions
func fillOrder(order *types.Order, qty decimal.Decimal) {
	order.FilledQuantity = order.FilledQuantity.Add(qty)
	order.RemainingQuantity = order.Quantity.Sub(order.FilledQuantity)
}

func minDecimal(a, b decimal.Decimal) decimal.Decimal {
	if a.LessThan(b) {
		return a
	}
	return b
}

func calculateAvgPrice(trades []*types.Trade) decimal.Decimal {
	if len(trades) == 0 {
		return decimal.Zero
	}
	var total decimal.Decimal
	var totalQty decimal.Decimal
	for _, t := range trades {
		total = total.Add(t.Price.Mul(t.Quantity))
		totalQty = totalQty.Add(t.Quantity)
	}
	if totalQty.IsZero() {
		return decimal.Zero
	}
	return total.Div(totalQty)
}

func generateOrderID() string {
	return fmt.Sprintf("ORD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateTradeID() string {
	return fmt.Sprintf("TRD%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}