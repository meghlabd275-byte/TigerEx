package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// TRADING SERVICE - Complete Production Implementation
// =============================================================================

// TradingService handles all trading operations
type TradingService struct {
	db         *pgxpool.Pool
	matchingEngine *MatchingEngine
	orderCache *OrderCache
	stats    *TradingStats
}

// MatchingEngine for order execution
type MatchingEngine struct {
	mu sync.RWMutex
	markets map[string]*Market
	orders map[string]*Order
	trades map[string]*Trade
}

type Market struct {
	Symbol         string
	BaseCurrency  string
	QuoteCurrency string
	Bids        *PriceLevels
	Asks        *PriceLevels
	LastPrice   float64
	Volume24h  float64
	TickSize   float64
	LotSize    float64
}

type PriceLevels []*PriceLevel

type PriceLevel struct {
	Price    float64
	Quantity float64
	Orders   []*Order
}

type Order struct {
	OrderID        string
	UserID        string
	MarketSymbol  string
	Side          OrderSide
	Type          OrderType
	TimeInForce  TimeInForce
	Quantity     float64
	FilledQuantity float64
	Remaining   float64
	Price       float64
	StopPrice   float64
	Status      OrderStatus
	ClientOrderID string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Trade struct {
	TradeID   string
	OrderID  string
	MarketSymbol string
	MakerUserID string
	TakerUserID string
	Side      OrderSide
	Price     float64
	Quantity  float64
	Fee       float64
	Timestamp time.Time
}

type OrderCache struct {
	mu    sync.RWMutex
	orders map[string]*Order
}

type TradingStats struct {
	mu           sync.RWMutex
	OrdersToday  int64
	TradesToday int64
	VolumeToday float64
}

// Order types
type OrderSide string
type OrderType string
type TimeInForce string
type OrderStatus string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"

	OrderTypeLimit       OrderType = "limit"
	OrderTypeMarket     OrderType = "market"
	OrderTypeStopLoss   OrderType = "stop_loss"
	OrderTypeStopLimit  OrderType = "stop_limit"
	OrderTypeTakeProfit OrderType = "take_profit"

	TimeInForceGTC TimeInForce = "GTC"
	TimeInForceIOC TimeInForce = "IOC"
	TimeInForceFOK TimeInForce = "FOK"

	OrderStatusNew             OrderStatus = "new"
	OrderStatusPartiallyFilled OrderStatus = "partially_filled"
	OrderStatusFilled         OrderStatus = "filled"
	OrderStatusCanceled       OrderStatus = "canceled"
	OrderStatusRejected       OrderStatus = "rejected"
)

// =============================================================================
// ORDER MANAGEMENT
// =============================================================================

// PlaceOrder creates a new order
func (ts *TradingService) PlaceOrder(ctx context.Context, req *PlaceOrderRequest) (*Order, error) {
	// Validate market
	market, err := ts.getMarket(ctx, req.MarketSymbol)
	if err != nil {
		return nil, fmt.Errorf("market not found: %w", err)
	}
	
	// Validate order parameters
	if err := ts.validateOrderRequest(req); err != nil {
		return nil, err
	}
	
	// Check balance
	hasBalance, err := ts.checkOrderBalance(ctx, req)
	if err != nil {
		return nil, err
	}
	
	if !hasBalance {
		return nil, errors.New("insufficient balance")
	}
	
	// Generate order ID
	orderID := generateOrderID()
	now := time.Now()
	
	order := &Order{
		OrderID:       orderID,
		UserID:        req.UserID,
		MarketSymbol:  req.MarketSymbol,
		Side:          OrderSide(req.Side),
		Type:          OrderType(req.OrderType),
		TimeInForce:   TimeInForce(req.TimeInForce),
		Quantity:      req.Quantity,
		FilledQuantity: 0,
		Remaining:     req.Quantity,
		Price:        req.Price,
		StopPrice:    req.StopPrice,
		Status:        OrderStatusNew,
		ClientOrderID: req.ClientOrderID,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	
	// Lock funds for buy orders
	if order.Side == OrderSideBuy {
		if err := ts.lockOrderFunds(ctx, req); err != nil {
			return nil, err
		}
	}
	
	// Save to database
	_, err = ts.db.Exec(ctx,
		`INSERT INTO orders (order_id, user_id, market_symbol, side, order_type, time_in_force,
		 quantity, filled_quantity, limit_price, stop_price, order_status, client_order_id, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		order.OrderID, order.UserID, order.MarketSymbol, order.Side, order.Type,
		order.TimeInForce, order.Quantity, order.FilledQuantity, order.Price,
		order.StopPrice, order.Status, order.ClientOrderID, order.CreatedAt,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to save order: %w", err)
	}
	
	// Process order through matching engine
	if order.Type == OrderTypeMarket {
		ts.executeMarketOrder(ctx, order, market)
	} else {
		ts.executeLimitOrder(ctx, order, market)
	}
	
	// Update stats
	ts.stats.mu.Lock()
	ts.stats.OrdersToday++
	ts.stats.VolumeToday += order.FilledQuantity * order.Price
	ts.stats.mu.Unlock()
	
	return order, nil
}

// CancelOrder cancels an existing order
func (ts *TradingService) CancelOrder(ctx context.Context, userID, orderID string) error {
	// Get order
	var order Order
	err := ts.db.QueryRow(ctx,
		`SELECT order_id, user_id, market_symbol, side, order_status, filled_quantity, quantity
		 FROM orders WHERE order_id = $1`,
		orderID,
	).Scan(&order.OrderID, &order.UserID, &order.MarketSymbol, &order.Side, 
		&order.Status, &order.FilledQuantity, &order.Quantity)
	
	if err != nil {
		return errors.New("order not found")
	}
	
	// Verify ownership
	if order.UserID != userID {
		return errors.New("unauthorized")
	}
	
	// Check if cancellable
	if order.Status != OrderStatusNew && order.Status != OrderStatusPartiallyFilled {
		return errors.New("order cannot be cancelled")
	}
	
	// Update status
	now := time.Now()
	_, err = ts.db.Exec(ctx,
		`UPDATE orders SET order_status = 'canceled', updated_at = $1 WHERE order_id = $2`,
		now, orderID,
	)
	
	if err != nil {
		return fmt.Errorf("failed to cancel order: %w", err)
	}
	
	// Unlock funds for buy orders
	if order.Side == OrderSideBuy {
		ts.unlockOrderFunds(ctx, userID, order.MarketSymbol, order.Remaining*order.Price)
	}
	
	return nil
}

// ModifyOrder modifies an existing order
func (ts *TradingService) ModifyOrder(ctx context.Context, userID, orderID string, newPrice, newQuantity float64) (*Order, error) {
	// Get order
	var order Order
	err := ts.db.QueryRow(ctx,
		`SELECT order_id, user_id, market_symbol, side, order_status, quantity, limit_price
		 FROM orders WHERE order_id = $1`,
		orderID,
	).Scan(&order.OrderID, &order.UserID, &order.MarketSymbol, &order.Side,
		&order.Status, &order.Quantity, &order.Price)
	
	if err != nil {
		return nil, errors.New("order not found")
	}
	
	// Verify ownership
	if order.UserID != userID {
		return nil, errors.New("unauthorized")
	}
	
	// Check if modifiable
	if order.Status != OrderStatusNew {
		return nil, errors.New("order cannot be modified")
	}
	
	// Calculate fund difference
	oldValue := order.Quantity * order.Price
	newValue := newQuantity * newPrice
	fundDiff := newValue - oldValue
	
	// Adjust funds if needed
	if fundDiff > 0 {
		hasBalance, err := ts.checkUserBalance(ctx, userID, order.MarketSymbol, fundDiff)
		if err != nil || !hasBalance {
			return nil, errors.New("insufficient balance for modification")
		}
		ts.lockAdditionalFunds(ctx, userID, order.MarketSymbol, fundDiff)
	} else if fundDiff < 0 {
		ts.unlockOrderFunds(ctx, userID, order.MarketSymbol, -fundDiff)
	}
	
	// Update order
	now := time.Now()
	_, err = ts.db.Exec(ctx,
		`UPDATE orders SET 
		 quantity = $1, limit_price = $2, updated_at = $3
		 WHERE order_id = $4`,
		newQuantity, newPrice, now, orderID,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to modify order: %w", err)
	}
	
	order.Quantity = newQuantity
	order.Price = newPrice
	order.UpdatedAt = now
	
	return &order, nil
}

// GetOpenOrders returns user's open orders
func (ts *TradingService) GetOpenOrders(ctx context.Context, userID, marketSymbol string, limit int) ([]Order, error) {
	query := `SELECT order_id, user_id, market_symbol, side, order_type, time_in_force,
	 quantity, filled_quantity, limit_price, stop_price, order_status, client_order_id, created_at
	 FROM orders WHERE user_id = $1 AND order_status IN ('new', 'partially_filled')`
	
	args := []interface{}{userID}
	argIdx := 2
	
	if marketSymbol != "" {
		query += fmt.Sprintf(" AND market_symbol = $%d", argIdx)
		args = append(args, marketSymbol)
		argIdx++
	}
	
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	
	rows, err := ts.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var orders []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(
			&o.OrderID, &o.UserID, &o.MarketSymbol, &o.Side, &o.Type,
			&o.TimeInForce, &o.Quantity, &o.FilledQuantity, &o.Price,
			&o.StopPrice, &o.Status, &o.ClientOrderID, &o.CreatedAt,
		); err == nil {
			o.Remaining = o.Quantity - o.FilledQuantity
			orders = append(orders, o)
		}
	}
	
	if orders == nil {
		orders = []Order{}
	}
	
	return orders, nil
}

// GetOrderHistory returns user's order history
func (ts *TradingService) GetOrderHistory(ctx context.Context, userID, marketSymbol string, limit int) ([]Order, error) {
	query := `SELECT order_id, user_id, market_symbol, side, order_type, time_in_force,
	 quantity, filled_quantity, limit_price, stop_price, order_status, client_order_id, created_at
	 FROM orders WHERE user_id = $1 AND order_status IN ('filled', 'canceled', 'rejected')`
	
	args := []interface{}{userID}
	argIdx := 2
	
	if marketSymbol != "" {
		query += fmt.Sprintf(" AND market_symbol = $%d", argIdx)
		args = append(args, marketSymbol)
		argIdx++
	}
	
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	
	rows, err := ts.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var orders []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(
			&o.OrderID, &o.UserID, &o.MarketSymbol, &o.Side, &o.Type,
			&o.TimeInForce, &o.Quantity, &o.FilledQuantity, &o.Price,
			&o.StopPrice, &o.Status, &o.ClientOrderID, &o.CreatedAt,
		); err == nil {
			o.Remaining = o.Quantity - o.FilledQuantity
			orders = append(orders, o)
		}
	}
	
	if orders == nil {
		orders = []Order{}
	}
	
	return orders, nil
}

// =============================================================================
// MY ORDERS (Trade History)
// =============================================================================

// GetMyTrades returns user's trade history
func (ts *TradingService) GetMyTrades(ctx context.Context, userID, marketSymbol string, limit int) ([]Trade, error) {
	query := `SELECT trade_id, order_id, market_symbol, side, price, quantity, 
	 (price * quantity) as quote_quantity, maker_fee, taker_fee, created_at
	 FROM trades WHERE (maker_user_id = $1 OR taker_user_id = $1)`
	
	args := []interface{}{userID}
	argIdx := 2
	
	if marketSymbol != "" {
		query += fmt.Sprintf(" AND market_symbol = $%d", argIdx)
		args = append(args, marketSymbol)
		argIdx++
	}
	
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	
	rows, err := ts.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var trades []Trade
	for rows.Next() {
		var t Trade
		var quoteQty float64
		if err := rows.Scan(
			&t.TradeID, &t.OrderID, &t.MarketSymbol, &t.Side,
			&t.Price, &t.Quantity, &quoteQty, &t.Fee, &t.Fee, &t.Timestamp,
		); err == nil {
			trades = append(trades, t)
		}
	}
	
	if trades == nil {
		trades = []Trade{}
	}
	
	return trades, nil
}

// =============================================================================
// ORDER BOOK
// =============================================================================

// GetOrderBook returns aggregated order book
func (ts *TradingService) GetOrderBook(ctx context.Context, symbol string, limit int) (*OrderBook, error) {
	market, err := ts.getMarket(ctx, symbol)
	if err != nil {
		return nil, err
	}
	
	// Get bids
	bidRows, err := ts.db.Query(ctx,
		`SELECT price, SUM(remaining_quantity) as qty
		 FROM orders
		 WHERE market_symbol = $1 AND side = 'buy' 
		 AND order_status IN ('new', 'partially_filled')
		 GROUP BY price
		 ORDER BY price DESC
		 LIMIT $2`,
		symbol, limit,
	)
	
	if err != nil {
		return nil, err
	}
	
	var bids []PriceLevel
	for bidRows.Next() {
		var p PriceLevel
		if err := bidRows.Scan(&p.Price, &p.Quantity); err == nil {
			bids = append(bids, &p)
		}
	}
	bidRows.Close()
	
	// Get asks
	askRows, err := ts.db.Query(ctx,
		`SELECT price, SUM(remaining_quantity) as qty
		 FROM orders
		 WHERE market_symbol = $1 AND side = 'sell'
		 AND order_status IN ('new', 'partially_filled')
		 GROUP BY price
		 ORDER BY price ASC
		 LIMIT $2`,
		symbol, limit,
	)
	
	if err != nil {
		return nil, err
	}
	
	var asks []PriceLevel
	for askRows.Next() {
		var p PriceLevel
		if err := askRows.Scan(&p.Price, &p.Quantity); err == nil {
			asks = append(asks, &p)
		}
	}
	askRows.Close()
	
	return &OrderBook{
		MarketSymbol: symbol,
		LastUpdateID: time.Now().UnixMilli(),
		Bids:      bids,
		Asks:      asks,
		LastPrice: market.LastPrice,
	}, nil
}

type OrderBook struct {
	MarketSymbol string
	LastUpdateID int64
	Bids      []PriceLevel
	Asks      []PriceLevel
	LastPrice float64
}

// =============================================================================
// MARKET DATA
// =============================================================================

// GetTicker returns 24h ticker for market
func (ts *TradingService) GetTicker(ctx context.Context, symbol string) (*Ticker, error) {
	var ticker Ticker
	
	err := ts.db.QueryRow(ctx,
		`SELECT m.market_symbol, 
		 COALESCE(ms.price_change, 0),
		 COALESCE(ms.price_change_percent, 0),
		 COALESCE(ms.last_price, 0),
		 COALESCE(ms.high_price, 0),
		 COALESCE(ms.low_price, 0),
		 COALESCE(ms.volume_24h_base, 0),
		 COALESCE(ms.volume_24h_quote, 0),
		 COALESCE(ms.trades_count, 0)
		 FROM markets m
		 LEFT JOIN market_states ms ON m.market_id = ms.market_id
		 WHERE m.market_symbol = $1`,
		symbol,
	).Scan(
		&ticker.Symbol, &ticker.PriceChange, &ticker.PriceChangePercent,
		&ticker.LastPrice, &ticker.HighPrice, &ticker.LowPrice,
		&ticker.Volume, &ticker.QuoteVolume, &ticker.TradesCount,
	)
	
	if err != nil {
		return nil, err
	}
	
	return &ticker, nil
}

type Ticker struct {
	Symbol            string
	PriceChange       float64
	PriceChangePercent float64
	LastPrice        float64
	HighPrice        float64
	LowPrice         float64
	Volume           float64
	QuoteVolume      float64
	TradesCount      int64
}

// GetTickers returns all tickers
func (ts *TradingService) GetTickers(ctx context.Context) ([]Ticker, error) {
	rows, err := ts.db.Query(ctx,
		`SELECT m.market_symbol,
		 COALESCE(ms.price_change, 0),
		 COALESCE(ms.price_change_percent, 0),
		 COALESCE(ms.last_price, 0),
		 COALESCE(ms.high_price, 0),
		 COALESCE(ms.low_price, 0),
		 COALESCE(ms.volume_24h_base, 0),
		 COALESCE(ms.volume_24h_quote, 0),
		 COALESCE(ms.trades_count, 0)
		 FROM markets m
		 LEFT JOIN market_states ms ON m.market_id = ms.market_id
		 WHERE m.market_status = 'active'`,
	)
	
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var tickers []Ticker
	for rows.Next() {
		var t Ticker
		if err := rows.Scan(
			&t.Symbol, &t.PriceChange, &t.PriceChangePercent,
			&t.LastPrice, &t.HighPrice, &t.LowPrice,
			&t.Volume, &t.QuoteVolume, &t.TradesCount,
		); err == nil {
			tickers = append(tickers, t)
		}
	}
	
	return tickers, nil
}

// =============================================================================
// EXECUTION ENGINE
// =============================================================================

func (ts *TradingService) executeMarketOrder(ctx context.Context, order *Order, market *Market) {
	// Execute at current market price
	if order.Side == OrderSideBuy {
		// Execute against lowest asks
		ts.executeAgainstAsks(ctx, order, market)
	} else {
		// Execute against highest bids
		ts.executeAgainstBids(ctx, order, market)
	}
	
	ts.updateOrderStatus(ctx, order)
}

func (ts *TradingService) executeLimitOrder(ctx context.Context, order *Order, market *Market) {
	if order.Side == OrderSideBuy && order.Price >= market.LastPrice {
		// Can execute immediately at market or limit price
		ts.executeAgainstAsks(ctx, order, market)
	} else if order.Side == OrderSideSell && order.Price <= market.LastPrice {
		ts.executeAgainstBids(ctx, order, market)
	}
	
	// If remaining quantity, add to order book
	if order.Remaining > 0 {
		ts.addToOrderBook(ctx, order)
	}
	
	ts.updateOrderStatus(ctx, order)
}

func (ts *TradingService) executeAgainstAsks(ctx context.Context, order *Order, market *Market) {
	// Get matching asks
	rows, err := ts.db.Query(ctx,
		`SELECT order_id, user_id, limit_price, remaining_quantity
		 FROM orders
		 WHERE market_symbol = $1 AND side = 'sell'
		 AND order_status IN ('new', 'partially_filled')
		 AND limit_price <= $2
		 ORDER BY limit_price ASC, created_at ASC
		 LIMIT 100`,
		order.MarketSymbol, order.Price,
	)
	
	if err != nil {
		return
	}
	defer rows.Close()
	
	for rows.Next() && order.Remaining > 0 {
		var makerOrderID, makerUserID string
		var makerPrice, makerQty float64
		
		if err := rows.Scan(&makerOrderID, &makerUserID, &makerPrice, &makerQty); err != nil {
			continue
		}
		
		execQty := math.Min(order.Remaining, makerQty)
		
		// Create trade
		trade := ts.createTrade(ctx, order, makerOrderID, makerUserID, makerPrice, execQty)
		
		// Update order filled quantities
		order.FilledQuantity += execQty
		order.Remaining -= execQty
		
		// Update maker order
		ts.db.Exec(ctx,
			`UPDATE orders SET 
			 filled_quantity = filled_quantity + $1,
			 remaining_quantity = remaining_quantity - $1,
			 updated_at = NOW()
			 WHERE order_id = $2`,
			execQty, makerOrderID,
		)
		
		// Update balances
		ts.settleTrade(ctx, order, makerUserID, makerPrice, execQty)
		
		_ = trade // Log trade
	}
}

func (ts *TradingService) executeAgainstBids(ctx context.Context, order *Order, market *Market) {
	rows, err := ts.db.Query(ctx,
		`SELECT order_id, user_id, limit_price, remaining_quantity
		 FROM orders
		 WHERE market_symbol = $1 AND side = 'buy'
		 AND order_status IN ('new', 'partially_filled')
		 AND limit_price >= $2
		 ORDER BY limit_price DESC, created_at ASC
		 LIMIT 100`,
		order.MarketSymbol, order.Price,
	)
	
	if err != nil {
		return
	}
	defer rows.Close()
	
	for rows.Next() && order.Remaining > 0 {
		var makerOrderID, makerUserID string
		var makerPrice, makerQty float64
		
		if err := rows.Scan(&makerOrderID, &makerUserID, &makerPrice, &makerQty); err != nil {
			continue
		}
		
		execQty := math.Min(order.Remaining, makerQty)
		
		trade := ts.createTrade(ctx, order, makerOrderID, makerUserID, makerPrice, execQty)
		
		order.FilledQuantity += execQty
		order.Remaining -= execQty
		
		ts.db.Exec(ctx,
			`UPDATE orders SET 
			 filled_quantity = filled_quantity + $1,
			 remaining_quantity = remaining_quantity - $1,
			 updated_at = NOW()
			 WHERE order_id = $2`,
			execQty, makerOrderID,
		)
		
		ts.settleTrade(ctx, order, makerUserID, makerPrice, execQty)
		
		_ = trade
	}
}

func (ts *TradingService) createTrade(ctx context.Context, takerOrder, makerOrder *Order, makerUserID string, price, quantity float64) *Trade {
	trade := &Trade{
		TradeID:      generateTradeID(),
		OrderID:     takerOrder.OrderID,
		MarketSymbol: takerOrder.MarketSymbol,
		MakerUserID: makerUserID,
		TakerUserID: takerOrder.UserID,
		Side:        takerOrder.Side,
		Price:       price,
		Quantity:    quantity,
		Fee:         price * quantity * 0.001, // 0.1% fee
		Timestamp:   time.Now(),
	}
	
	// Save trade
	ts.db.Exec(ctx,
		`INSERT INTO trades 
		 (trade_id, order_id, market_symbol, maker_user_id, taker_user_id, side,
		  price, quantity, maker_fee, taker_fee, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		trade.TradeID, trade.OrderID, trade.MarketSymbol, trade.MakerUserID,
		trade.TakerUserID, trade.Side, trade.Price, trade.Quantity,
		trade.Fee/2, trade.Fee/2, trade.Timestamp,
	)
	
	// Update stats
	ts.stats.mu.Lock()
	ts.stats.TradesToday++
	ts.stats.VolumeToday += price * quantity
	ts.stats.mu.Unlock()
	
	return trade
}

func (ts *TradingService) settleTrade(ctx context.Context, order *Order, counterUserID string, price, quantity float64) {
	parts := []string{order.MarketSymbol, "/"}
	baseCurrency := parts[0]
	quoteCurrency := parts[1]
	
	if order.Side == OrderSideBuy {
		// Taker (buyer) receives base, pays quote
		// Maker (seller) receives quote, pays base
		
		// Deduct quote from taker
		ts.db.Exec(ctx,
			`UPDATE balances SET locked_amount = locked_amount - $1 WHERE user_id = $2 AND currency = $3`,
			price*quantity, order.UserID, quoteCurrency,
		)
		
		// Add quote to maker
		ts.db.Exec(ctx,
			`UPDATE balances SET available_amount = available_amount + $1 WHERE user_id = $2 AND currency = $3`,
			price*quantity, counterUserID, quoteCurrency,
		)
		
		// Add base to taker
		ts.db.Exec(ctx,
			`UPDATE balances SET available_amount = available_amount + $1 WHERE user_id = $2 AND currency = $3`,
			quantity, order.UserID, baseCurrency,
		)
		
		// Deduct base from maker
		ts.db.Exec(ctx,
			`UPDATE balances SET available_amount = available_amount - $1 WHERE user_id = $2 AND currency = $3`,
			quantity, counterUserID, baseCurrency,
		)
	} else {
		// Seller receives quote, buyer receives base
		
		// Deduct base from taker (seller)
		ts.db.Exec(ctx,
			`UPDATE balances SET available_amount = available_amount - $1 WHERE user_id = $2 AND currency = $3`,
			quantity, order.UserID, baseCurrency,
		)
		
		// Add base to maker (buyer)
		ts.db.Exec(ctx,
			`UPDATE balances SET available_amount = available_amount + $1 WHERE user_id = $2 AND currency = $3`,
			quantity, counterUserID, baseCurrency,
		)
		
		// Add quote to taker (seller)
		ts.db.Exec(ctx,
			`UPDATE balances SET available_amount = available_amount + $1 WHERE user_id = $2 AND currency = $3`,
			price*quantity, order.UserID, quoteCurrency,
		)
		
		// Deduct quote from maker (buyer)
		ts.db.Exec(ctx,
			`UPDATE balances SET locked_amount = locked_amount - $1 WHERE user_id = $2 AND currency = $3`,
			price*quantity, counterUserID, quoteCurrency,
		)
	}
}

func (ts *TradingService) addToOrderBook(ctx context.Context, order *Order) {
	// Order stays in order book for later execution
}

func (ts *TradingService) updateOrderStatus(ctx context.Context, order *Order) {
	if order.Remaining <= 0 {
		order.Status = OrderStatusFilled
	} else if order.FilledQuantity > 0 {
		order.Status = OrderStatusPartiallyFilled
	} else {
		order.Status = OrderStatusNew
	}
	
	ts.db.Exec(ctx,
		`UPDATE orders SET 
		 filled_quantity = $1, remaining_quantity = $2, 
		 order_status = $3, updated_at = NOW()
		 WHERE order_id = $4`,
		order.FilledQuantity, order.Remaining, order.Status, order.OrderID,
	)
}

// =============================================================================
// HELPERS
// =============================================================================

type PlaceOrderRequest struct {
	UserID        string
	MarketSymbol  string
	Side         string
	OrderType    string
	TimeInForce  string
	Quantity     float64
	Price        float64
	StopPrice    float64
	ClientOrderID string
}

func (ts *TradingService) validateOrderRequest(req *PlaceOrderRequest) error {
	if req.Quantity <= 0 {
		return errors.New("quantity must be positive")
	}
	
	if req.OrderType != "limit" && req.OrderType != "market" {
		return errors.New("invalid order type")
	}
	
	if req.OrderType == "limit" && req.Price <= 0 {
		return errors.New("price required for limit orders")
	}
	
	if req.Side != "buy" && req.Side != "sell" {
		return errors.New("invalid order side")
	}
	
	return nil
}

func (ts *TradingService) getMarket(ctx context.Context, symbol string) (*Market, error) {
	var market Market
	err := ts.db.QueryRow(ctx,
		`SELECT market_symbol, base_currency, quote_currency
		 FROM markets WHERE market_symbol = $1`,
		symbol,
	).Scan(&market.Symbol, &market.BaseCurrency, &market.QuoteCurrency)
	
	if err != nil {
		return nil, err
	}
	
	return &market, nil
}

func (ts *TradingService) checkOrderBalance(ctx context.Context, req *PlaceOrderRequest) (bool, error) {
	parts := []string{req.MarketSymbol, "/"}
	quoteCurrency := parts[1]
	
	if req.Side == "buy" {
		required := req.Quantity * req.Price
		var balance float64
		
		err := ts.db.QueryRow(ctx,
			`SELECT COALESCE(available_amount, 0) 
			 FROM balances b
			 JOIN wallets w ON b.wallet_id = w.wallet_id
			 WHERE b.user_id = $1 AND w.currency = $2 AND w.wallet_type = 'spot'`,
			req.UserID, quoteCurrency,
		).Scan(&balance)
		
		if err != nil {
			return false, err
		}
		
		return balance >= required, nil
	} else {
		baseCurrency := parts[0]
		var balance float64
		
		err := ts.db.QueryRow(ctx,
			`SELECT COALESCE(available_amount, 0)
			 FROM balances b
			 JOIN wallets w ON b.wallet_id = w.wallet_id
			 WHERE b.user_id = $1 AND w.currency = $2 AND w.wallet_type = 'spot'`,
			req.UserID, baseCurrency,
		).Scan(&balance)
		
		if err != nil {
			return false, err
		}
		
		return balance >= req.Quantity, nil
	}
}

func (ts *TradingService) checkUserBalance(ctx context.Context, userID, marketSymbol string, amount float64) (bool, error) {
	parts := []string{marketSymbol, "/"}
	quoteCurrency := parts[1]
	
	var balance float64
	err := ts.db.QueryRow(ctx,
		`SELECT COALESCE(available_amount, 0)
		 FROM balances b
		 JOIN wallets w ON b.wallet_id = w.wallet_id
		 WHERE b.user_id = $1 AND w.currency = $2 AND w.wallet_type = 'spot'`,
		userID, quoteCurrency,
	).Scan(&balance)
	
	if err != nil {
		return false, err
	}
	
	return balance >= amount, nil
}

func (ts *TradingService) lockOrderFunds(ctx context.Context, req *PlaceOrderRequest) error {
	parts := []string{req.MarketSymbol, "/"}
	quoteCurrency := parts[1]
	
	required := req.Quantity * req.Price
	
	_, err := ts.db.Exec(ctx,
		`UPDATE balances SET 
		 available_amount = available_amount - $1,
		 locked_amount = locked_amount + $1
		 WHERE user_id = $2 AND currency = $3 AND available_amount >= $1`,
		required, req.UserID, quoteCurrency,
	)
	
	return err
}

func (ts *TradingService) unlockOrderFunds(ctx context.Context, userID, marketSymbol string, amount float64) error {
	parts := []string{marketSymbol, "/"}
	quoteCurrency := parts[1]
	
	_, err := ts.db.Exec(ctx,
		`UPDATE balances SET
		 available_amount = available_amount + $1,
		 locked_amount = locked_amount - $1
		 WHERE user_id = $2 AND currency = $3`,
		amount, userID, quoteCurrency,
	)
	
	return err
}

func (ts *TradingService) lockAdditionalFunds(ctx context.Context, userID, marketSymbol string, amount float64) error {
	return ts.lockOrderFunds(ctx, &PlaceOrderRequest{
		UserID: userID, MarketSymbol: marketSymbol, Quantity: 1, Price: amount,
	})
}

func generateOrderID() string {
	buf := make([]byte, 8)
	rand.Read(buf)
	return "ORD_" + hex.EncodeToString(buf)[:12]
}

func generateTradeID() string {
	buf := make([]byte, 8)
	rand.Read(buf)
	return "TRD_" + hex.EncodeToString(buf)[:12]
}

// =============================================================================
// SORT INTERFACES
// =============================================================================

func (pl PriceLevels) Len() int           { return len(pl) }
func (pl PriceLevels) Less(i, j int) bool { return pl[i].Price > pl[j].Price }
func (pl PriceLevels) Swap(i, j int)      { pl[i], pl[j] = pl[j], pl[i] }

func init() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

func main() {
	log.Println("Trading Service - Use as library")
}
