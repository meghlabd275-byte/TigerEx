// =============================================================================
// TIGEREX ADMIN CEX+DEX TRADING SERVICE - Go Implementation
// Complete trading service with all user and admin features
// =============================================================================

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// ORDER TYPES
// =============================================================================

type OrderSide string
type OrderType string
type OrderStatus string
type TimeInForce string

const (
	SideBuy  OrderSide = "buy"
	SideSell OrderSide = "sell"

	TypeMarket       OrderType = "market"
	TypeLimit        OrderType = "limit"
	TypeStopLoss     OrderType = "stop_loss"
	TypeStopLimit    OrderType = "stop_limit"
	TypeTakeProfit   OrderType = "take_profit"
	TypeTrailingStop OrderType = "trailing_stop"
	TypeIceberg      OrderType = "iceberg"
	TypeTWAP         OrderType = "twap"
	TypeVWAP         OrderType = "vwap"
	TypeOCO          OrderType = "oco"

	StatusNew             OrderStatus = "new"
	StatusPartiallyFilled OrderStatus = "partially_filled"
	StatusFilled          OrderStatus = "filled"
	StatusCancelled       OrderStatus = "cancelled"
	StatusRejected        OrderStatus = "rejected"
	StatusPending         OrderStatus = "pending"

	TIFGTC TimeInForce = "GTC" // Good Till Cancel
	TIFIOC TimeInForce = "IOC" // Immediate Or Cancel
	TIFGFD TimeInForce = "GFD" // Good For Day
	TIFFOK TimeInForce = "FOK" // Fill Or Kill
)

// =============================================================================
// ORDER STRUCTURES
// =============================================================================

type Order struct {
	OrderID          string      `json:"orderId"`
	UserID           string      `json:"userId"`
	Symbol           string      `json:"symbol"`
	Side             OrderSide   `json:"side"`
	Type             OrderType   `json:"type"`
	Price            float64     `json:"price"`
	Quantity         float64     `json:"quantity"`
	FilledQuantity   float64     `json:"filledQuantity"`
	RemainingQuantity float64    `json:"remainingQuantity"`
	AvgFillPrice     float64     `json:"avgFillPrice"`
	StopPrice        float64     `json:"stopPrice"`
	TimeInForce      TimeInForce `json:"timeInForce"`
	Status           OrderStatus `json:"status"`
	Leverage         int         `json:"leverage"`
	MarginType       string      `json:"marginType"` // isolated, cross
	PositionSide     string      `json:"positionSide"` // long, short, both
	IsReduceOnly     bool        `json:"isReduceOnly"`
	IsPostOnly       bool        `json:"isPostOnly"`
	CreatedAt        int64       `json:"createdAt"`
	UpdatedAt        int64       `json:"updatedAt"`
}

type Trade struct {
	TradeID        string    `json:"tradeId"`
	OrderID        string    `json:"orderId"`
	UserID         string    `json:"userId"`
	Symbol         string    `json:"symbol"`
	Side           OrderSide `json:"side"`
	Price          float64   `json:"price"`
	Quantity       float64   `json:"quantity"`
	Fee            float64   `json:"fee"`
	FeeSymbol      string    `json:"feeSymbol"`
	Maker          bool      `json:"maker"`
	RealizedPnl    float64   `json:"realizedPnl"`
	Timestamp      int64     `json:"timestamp"`
}

type Position struct {
	PositionID      string     `json:"positionId"`
	UserID          string     `json:"userId"`
	Symbol          string     `json:"symbol"`
	Side            OrderSide  `json:"side"`
	Quantity        float64    `json:"quantity"`
	EntryPrice      float64    `json:"entryPrice"`
	MarkPrice       float64    `json:"markPrice"`
	Leverage        int        `json:"leverage"`
	LiquidationPrice float64   `json:"liquidationPrice"`
	Margin          float64    `json:"margin"`
	MarginType      string     `json:"marginType"`
	UnrealizedPnl   float64    `json:"unrealizedPnl"`
	RealizedPnl     float64    `json:"realizedPnl"`
	PositionSide    string     `json:"positionSide"`
	StopLoss        float64    `json:"stopLoss"`
	TakeProfit      float64    `json:"takeProfit"`
	CreatedAt       int64      `json:"createdAt"`
	UpdatedAt       int64      `json:"updatedAt"`
}

// =============================================================================
// MARKET DATA
// =============================================================================

type Ticker struct {
	Symbol            string  `json:"symbol"`
	LastPrice         float64 `json:"lastPrice"`
	PriceChange       float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	HighPrice         float64 `json:"highPrice"`
	LowPrice          float64 `json:"lowPrice"`
	Volume            float64 `json:"volume"`
	QuoteVolume       float64 `json:"quoteVolume"`
	OpenPrice         float64 `json:"openPrice"`
	WeightedAvgPrice  float64 `json:"weightedAvgPrice"`
}

type OrderBook struct {
	Symbol     string       `json:"symbol"`
	Bids       []PriceLevel `json:"bids"`
	Asks       []PriceLevel `json:"asks"`
	Timestamp  int64        `json:"timestamp"`
}

type PriceLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

type KLine struct {
	OpenTime      int64   `json:"openTime"`
	Open          float64 `json:"open"`
	High          float64 `json:"high"`
	Low           float64 `json:"low"`
	Close         float64 `json:"close"`
	Volume        float64 `json:"volume"`
	CloseTime     int64   `json:"closeTime"`
	QuoteVolume   float64 `json:"quoteVolume"`
	Trades        int64   `json:"trades"`
}

// =============================================================================
// TRADING SERVICE
// =============================================================================

type TradingService struct {
	mu sync.RWMutex

	// Orders and positions
	orders      map[string]*Order // orderID -> Order
	positions   map[string]*Position // positionID -> Position
	trades      map[string]*Trade // tradeID -> Trade

	// User orders (symbol -> userID -> orders)
	userOrders    map[string]map[string][]*Order

	// Market data
	tickers    map[string]*Ticker
	orderBooks map[string]*OrderBook

	// Fees
	feeRates map[string]FeeRate // symbol -> fee rate

	// Configuration
	config TradingConfig

	// Statistics
	stats TradingStats

	ctx    context.Context
	cancel context.CancelFunc
}

type FeeRate struct {
	MakerFee float64 `json:"makerFee"`
	TakerFee float64 `json:"takerFee"`
}

type TradingConfig struct {
	MaxLeverage            int     `json:"maxLeverage"`
	MinOrderQuantity      float64 `json:"minOrderQuantity"`
	MaxOrderQuantity      float64 `json:"maxOrderQuantity"`
	PricePrecision        int     `json:"pricePrecision"`
	QuantityPrecision     int     `json:"quantityPrecision"`
	DefaultMakerFee       float64 `json:"defaultMakerFee"`
	DefaultTakerFee       float64 `json:"defaultTakerFee"`
	AllowMarketOrders     bool    `json:"allowMarketOrders"`
	AllowStopOrders       bool    `json:"allowStopOrders"`
	AllowMarginTrading    bool    `json:"allowMarginTrading"`
	AllowFutures          bool    `json:"allowFutures"`
	AllowOptions         bool    `json:"allowOptions"`
	EnableWhiteLabelMode  bool    `json:"enableWhiteLabelMode"`
}

type TradingStats struct {
	TotalOrders     int64   `json:"totalOrders"`
	TotalTrades     int64   `json:"totalTrades"`
	TotalVolume    float64 `json:"totalVolume"`
	TotalFees      float64 `json:"totalFees"`
	ActiveOrders   int64   `json:"activeOrders"`
	ActivePositions int64  `json:"activePositions"`
}

func NewTradingService() *TradingService {
	ctx, cancel := context.WithCancel(context.Background())

	return &TradingService{
		orders:        make(map[string]*Order),
		positions:     make(map[string]*Position),
		trades:        make(map[string]*Trade),
		userOrders:    make(map[string]map[string][]*Order),
		tickers:       make(map[string]*Ticker),
		orderBooks:    make(map[string]*OrderBook),
		feeRates:      make(map[string]FeeRate),
		config: TradingConfig{
			MaxLeverage:         125,
			MinOrderQuantity:    0.0001,
			MaxOrderQuantity:    1000000,
			PricePrecision:      2,
			QuantityPrecision:   5,
			DefaultMakerFee:      0.001,
			DefaultTakerFee:      0.001,
			AllowMarketOrders:   true,
			AllowStopOrders:     true,
			AllowMarginTrading:  true,
			AllowFutures:        true,
			AllowOptions:        true,
			EnableWhiteLabelMode: false,
		},
		stats: TradingStats{},
		ctx:    ctx,
		cancel: cancel,
	}
}

// =============================================================================
// ORDER OPERATIONS
// =============================================================================

func (s *TradingService) PlaceOrder(userID, symbol string, orderReq OrderRequest) (*Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate order
	if err := s.validateOrder(orderReq); err != nil {
		return nil, err
	}

	order := &Order{
		OrderID:            uuid.New().String(),
		UserID:             userID,
		Symbol:             symbol,
		Side:               orderReq.Side,
		Type:               orderReq.Type,
		Quantity:           orderReq.Quantity,
		FilledQuantity:     0,
		RemainingQuantity:  orderReq.Quantity,
		Price:              orderReq.Price,
		StopPrice:          orderReq.StopPrice,
		TimeInForce:        orderReq.TimeInForce,
		Status:             StatusNew,
		Leverage:           orderReq.Leverage,
		MarginType:         orderReq.MarginType,
		PositionSide:       orderReq.PositionSide,
		IsReduceOnly:       orderReq.IsReduceOnly,
		IsPostOnly:         orderReq.IsPostOnly,
		CreatedAt:          time.Now().UnixMilli(),
		UpdatedAt:          time.Now().UnixMilli(),
	}

	// Execute order based on type
	switch order.Type {
	case TypeMarket:
		s.executeMarketOrder(order)
	case TypeLimit:
		s.addToOrderBook(order)
	case TypeStopLoss, TypeStopLimit:
		s.addStopOrder(order)
	case TypeOCO:
		s.addOCOOrder(order)
	}

	// Store order
	s.orders[order.OrderID] = order

	// Add to user orders
	if _, ok := s.userOrders[symbol]; !ok {
		s.userOrders[symbol] = make(map[string][]*Order)
	}
	s.userOrders[symbol][userID] = append(s.userOrders[symbol][userID], order)

	atomic.AddInt64(&s.stats.TotalOrders, 1)
	atomic.AddInt64(&s.stats.ActiveOrders, 1)

	log.Printf("[INFO] Order placed: %s %s %s %f @ %f", 
		order.OrderID, userID, order.Side, order.Quantity, order.Price)

	return order, nil
}

type OrderRequest struct {
	Side          OrderSide  `json:"side"`
	Type          OrderType  `json:"type"`
	Price         float64    `json:"price"`
	Quantity      float64    `json:"quantity"`
	StopPrice     float64    `json:"stopPrice"`
	TimeInForce   TimeInForce `json:"timeInForce"`
	Leverage      int        `json:"leverage"`
	MarginType    string     `json:"marginType"`
	PositionSide  string     `json:"positionSide"`
	IsReduceOnly bool       `json:"isReduceOnly"`
	IsPostOnly    bool       `json:"isPostOnly"`
}

func (s *TradingService) validateOrder(req OrderRequest) error {
	if req.Quantity < s.config.MinOrderQuantity {
		return errors.New("quantity below minimum")
	}
	if req.Quantity > s.config.MaxOrderQuantity {
		return errors.New("quantity above maximum")
	}
	if req.Leverage > s.config.MaxLeverage || req.Leverage < 1 {
		return errors.New("invalid leverage")
	}
	if req.Type == TypeMarket && !s.config.AllowMarketOrders {
		return errors.New("market orders not allowed")
	}
	if (req.Type == TypeStopLoss || req.Type == TypeStopLimit) && !s.config.AllowStopOrders {
		return errors.New("stop orders not allowed")
	}
	return nil
}

func (s *TradingService) executeMarketOrder(order *Order) {
	// Get current market price from ticker
	ticker, ok := s.tickers[order.Symbol]
	if !ok {
		order.Status = StatusRejected
		return
	}

	price := ticker.LastPrice
	order.AvgFillPrice = price
	order.FilledQuantity = order.Quantity
	order.RemainingQuantity = 0
	order.Status = StatusFilled

	// Create trade
	s.createTrade(order, price)

	log.Printf("[INFO] Market order filled: %s @ %f", order.Symbol, price)
}

func (s *TradingService) addToOrderBook(order *Order) {
	order.Status = StatusNew
	log.Printf("[INFO] Limit order added to book: %s @ %f", order.Symbol, order.Price)
}

func (s *TradingService) addStopOrder(order *Order) {
	order.Status = StatusPending
	log.Printf("[INFO] Stop order added: %s stop: %f", order.Symbol, order.StopPrice)
}

func (s *TradingService) addOCOOrder(order *Order) {
	order.Status = StatusNew
	log.Printf("[INFO] OCO order added: %s", order.Symbol)
}

func (s *TradingService) createTrade(order *Order, price float64) {
	fee := s.calculateFee(order.Symbol, price*order.FilledQuantity, order.Side)

	trade := &Trade{
		TradeID:     uuid.New().String(),
		OrderID:     order.OrderID,
		UserID:      order.UserID,
		Symbol:      order.Symbol,
		Side:        order.Side,
		Price:       price,
		Quantity:    order.FilledQuantity,
		Fee:         fee,
		FeeSymbol:   getQuoteAsset(order.Symbol),
		Timestamp:   time.Now().UnixMilli(),
	}

	s.trades[trade.TradeID] = trade

	atomic.AddInt64(&s.stats.TotalTrades, 1)
	atomic.AddInt64(&s.stats.TotalVolume, int64(price*order.FilledQuantity))
	atomic.AddInt64(&s.stats.TotalFees, int64(fee))

	log.Printf("[INFO] Trade created: %s %s %f @ %f (fee: %f)", 
		trade.TradeID, trade.Symbol, trade.Quantity, trade.Price, trade.Fee)
}

func (s *TradingService) CancelOrder(orderID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	order, ok := s.orders[orderID]
	if !ok {
		return errors.New("order not found")
	}

	if order.UserID != userID {
		return errors.New("unauthorized")
	}

	if order.Status == StatusFilled || order.Status == StatusCancelled {
		return errors.New("order cannot be cancelled")
	}

	order.Status = StatusCancelled
	order.UpdatedAt = time.Now().UnixMilli()

	atomic.AddInt64(&s.stats.ActiveOrders, -1)

	log.Printf("[INFO] Order cancelled: %s", orderID)

	return nil
}

func (s *TradingService) GetOrder(orderID string) (*Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	order, ok := s.orders[orderID]
	if !ok {
		return nil, errors.New("order not found")
	}

	return order, nil
}

func (s *TradingService) GetUserOrders(userID, symbol string, limit int) []*Order {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Order
	orders := s.userOrders[symbol][userID]

	count := 0
	for i := len(orders) - 1; i >= 0 && count < limit; i-- {
		result = append(result, orders[i])
		count++
	}

	return result
}

func (s *TradingService) GetOpenOrders(userID, symbol string) []*Order {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Order
	orders := s.userOrders[symbol][userID]

	for _, order := range orders {
		if order.Status == StatusNew || order.Status == StatusPartiallyFilled {
			result = append(result, order)
		}
	}

	return result
}

// =============================================================================
// POSITION OPERATIONS
// =============================================================================

func (s *TradingService) OpenPosition(req PositionRequest) (*Position, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate
	if !s.config.AllowFutures {
		return nil, errors.New("futures trading disabled")
	}

	margin := req.Quantity * req.EntryPrice / float64(req.Leverage)

	position := &Position{
		PositionID:       uuid.New().String(),
		UserID:           req.UserID,
		Symbol:           req.Symbol,
		Side:             req.Side,
		Quantity:         req.Quantity,
		EntryPrice:       req.EntryPrice,
		Margin:           margin,
		Leverage:         req.Leverage,
		MarginType:       req.MarginType,
		PositionSide:     req.PositionSide,
		LiquidationPrice:  s.calculateLiquidationPrice(req),
		StopLoss:         req.StopLoss,
		TakeProfit:       req.TakeProfit,
		CreatedAt:        time.Now().UnixMilli(),
		UpdatedAt:        time.Now().UnixMilli(),
	}

	s.positions[position.PositionID] = position

	atomic.AddInt64(&s.stats.ActivePositions, 1)

	log.Printf("[INFO] Position opened: %s %s %s %f @ %f (leverage: %dx)", 
		position.PositionID, req.UserID, req.Side, req.Quantity, req.EntryPrice, req.Leverage)

	return position, nil
}

type PositionRequest struct {
	UserID         string     `json:"userId"`
	Symbol         string     `json:"symbol"`
	Side           OrderSide  `json:"side"`
	Quantity       float64    `json:"quantity"`
	EntryPrice     float64    `json:"entryPrice"`
	Leverage       int        `json:"leverage"`
	MarginType     string     `json:"marginType"`
	PositionSide   string     `json:"positionSide"`
	StopLoss       float64    `json:"stopLoss"`
	TakeProfit     float64    `json:"takeProfit"`
}

func (s *TradingService) ClosePosition(positionID string, userID string, quantity float64) (*Trade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	position, ok := s.positions[positionID]
	if !ok {
		return nil, errors.New("position not found")
	}

	if position.UserID != userID {
		return nil, errors.New("unauthorized")
	}

	// Get current price
	ticker, ok := s.tickers[position.Symbol]
	if !ok {
		return nil, errors.New("price not available")
	}

	// Calculate PnL
	pnl := calculatePositionPnL(position, ticker.LastPrice, quantity)

	// Create trade
	trade := &Trade{
		TradeID:      uuid.New().String(),
		UserID:       userID,
		Symbol:       position.Symbol,
		Side:         position.Side,
		Price:        ticker.LastPrice,
		Quantity:     quantity,
		RealizedPnl:  pnl,
		Timestamp:    time.Now().UnixMilli(),
	}

	// Update position
	if quantity >= position.Quantity {
		position.Quantity = 0
		position.Status = "closed"
		delete(s.positions, positionID)
		atomic.AddInt64(&s.stats.ActivePositions, -1)
	} else {
		position.Quantity -= quantity
	}

	position.RealizedPnl += pnl
	position.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Position closed: %s PnL: %f", positionID, pnl)

	return trade, nil
}

func (s *TradingService) GetPosition(positionID string) (*Position, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	position, ok := s.positions[positionID]
	if !ok {
		return nil, errors.New("position not found")
	}

	return position, nil
}

func (s *TradingService) GetUserPositions(userID string) []*Position {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Position

	for _, pos := range s.positions {
		if pos.UserID == userID && pos.Quantity > 0 {
			// Update mark price and unrealized PnL
			if ticker, ok := s.tickers[pos.Symbol]; ok {
				pos.MarkPrice = ticker.LastPrice
				pos.UnrealizedPnl = calculatePositionPnL(pos, ticker.LastPrice, pos.Quantity)
			}
			result = append(result, pos)
		}
	}

	return result
}

func (s *TradingService) SetStopLoss(positionID string, userID string, stopLoss float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	position, ok := s.positions[positionID]
	if !ok {
		return errors.New("position not found")
	}

	if position.UserID != userID {
		return errors.New("unauthorized")
	}

	position.StopLoss = stopLoss
	position.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Stop loss set: %s @ %f", positionID, stopLoss)

	return nil
}

func (s *TradingService) SetTakeProfit(positionID string, userID string, takeProfit float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	position, ok := s.positions[positionID]
	if !ok {
		return errors.New("position not found")
	}

	if position.UserID != userID {
		return errors.New("unauthorized")
	}

	position.TakeProfit = takeProfit
	position.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Take profit set: %s @ %f", positionID, takeProfit)

	return nil
}

// =============================================================================
// MARGIN TRADING
// =============================================================================

func (s *TradingService) AdjustLeverage(userID, symbol string, leverage int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if leverage > s.config.MaxLeverage || leverage < 1 {
		return errors.New("invalid leverage")
	}

	log.Printf("[INFO] Leverage adjusted: %s %s %dx", userID, symbol, leverage)

	return nil
}

func (s *TradingService) GetMarginInfo(userID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	positions := s.GetUserPositions(userID)

	var totalMargin, totalUnrealizedPnl float64

	for _, pos := range positions {
		totalMargin += pos.Margin
		totalUnrealizedPnl += pos.UnrealizedPnl
	}

	return map[string]interface{}{
		"totalMargin":       totalMargin,
		"totalUnrealizedPnl": totalUnrealizedPnl,
		"totalPositionValue": totalMargin * 10, // Simplified
		"marginRatio":       0.5, // Simplified
	}
}

// =============================================================================
// MARKET DATA
// =============================================================================

func (s *TradingService) GetTicker(symbol string) (*Ticker, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ticker, ok := s.tickers[symbol]
	if !ok {
		return nil, errors.New("ticker not found")
	}

	return ticker, nil
}

func (s *TradingService) GetAllTickers() []*Ticker {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tickers := make([]*Ticker, 0, len(s.tickers))
	for _, t := range s.tickers {
		tickers = append(tickers, t)
	}

	return tickers
}

func (s *TradingService) GetOrderBook(symbol string) (*OrderBook, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ob, ok := s.orderBooks[symbol]
	if !ok {
		return nil, errors.New("order book not found")
	}

	return ob, nil
}

func (s *TradingService) GetKLines(symbol string, interval string, limit int) []*KLine {
	// Simplified - would fetch from actual market data
	return []*KLine{}
}

func (s *TradingService) UpdateTicker(ticker *Ticker) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.tickers[ticker.Symbol] = ticker
}

func (s *TradingService) UpdateOrderBook(symbol string, bids, asks []PriceLevel) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.orderBooks[symbol] = &OrderBook{
		Symbol:    symbol,
		Bids:      bids,
		Asks:      asks,
		Timestamp: time.Now().UnixMilli(),
	}
}

// =============================================================================
// SPOT TRADING
// =============================================================================

func (s *TradingService) SpotTrade(userID, symbol, side string, quantity, price float64) (*Order, error) {
	req := OrderRequest{
		Side:        OrderSide(side),
		Type:        TypeLimit,
		Quantity:    quantity,
		Price:       price,
		TimeInForce: TIFGTC,
	}

	return s.PlaceOrder(userID, symbol, req)
}

func (s *TradingService) GetSpotBalances(userID string) map[string]float64 {
	// Simplified - would fetch from wallet service
	return map[string]float64{}
}

// =============================================================================
// FUTURES TRADING
// =============================================================================

func (s *TradingService) OpenFuturesPosition(req PositionRequest) (*Position, error) {
	if !s.config.AllowFutures {
		return nil, errors.New("futures trading disabled")
	}

	return s.OpenPosition(req)
}

func (s *TradingService) CloseFuturesPosition(positionID string, userID string) (*Trade, error) {
	position, err := s.GetPosition(positionID)
	if err != nil {
		return nil, err
	}

	return s.ClosePosition(positionID, userID, position.Quantity)
}

// =============================================================================
// MARGIN TRADING
// =============================================================================

func (s *TradingService) OpenMarginPosition(req PositionRequest) (*Position, error) {
	if !s.config.AllowMarginTrading {
		return nil, errors.New("margin trading disabled")
	}

	req.MarginType = "isolated"
	return s.OpenPosition(req)
}

func (s *TradingService) AddMargin(positionID string, userID string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	position, ok := s.positions[positionID]
	if !ok {
		return errors.New("position not found")
	}

	if position.UserID != userID {
		return errors.New("unauthorized")
	}

	position.Margin += amount
	position.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Margin added: %s %f", positionID, amount)

	return nil
}

// =============================================================================
// OPTIONS TRADING
// =============================================================================

type OptionContract struct {
	ContractID   string  `json:"contractId"`
	Symbol       string  `json:"symbol"`
	Type         string  `json:"type"` // call, put
	StrikePrice  float64 `json:"strikePrice"`
	ExpiryDate   int64   `json:"expiryDate"`
	Underlying   string  `json:"underlying"`
	Status       string  `json:"status"`
}

func (s *TradingService) GetOptionContracts(symbol string) []*OptionContract {
	if !s.config.AllowOptions {
		return nil
	}

	// Would fetch from options data
	return []*OptionContract{}
}

func (s *TradingService) TradeOption(userID, contractID string, side OrderSide, quantity float64) (*Order, error) {
	if !s.config.AllowOptions {
		return nil, errors.New("options trading disabled")
	}

	// Simplified options trading
	order := &Order{
		OrderID:   uuid.New().String(),
		UserID:    userID,
		Symbol:    contractID,
		Side:      side,
		Type:      TypeLimit,
		Quantity:  quantity,
		Status:    StatusNew,
		CreatedAt: time.Now().UnixMilli(),
	}

	s.orders[order.OrderID] = order

	return order, nil
}

// =============================================================================
// P2P TRADING
// =============================================================================

type P2POrder struct {
	OrderID     string    `json:"orderId"`
	UserID      string    `json:"userId"`
	Type        string    `json:"type"` // buy, sell
	Asset       string    `json:"asset"`
	FiatAmount  float64   `json:"fiatAmount"`
	CryptoAmount float64  `json:"cryptoAmount"`
	Price       float64   `json:"price"`
	PaymentMethod string  `json:"paymentMethod"`
	Status      string    `json:"status"` // pending, processing, completed, cancelled
	Fiat        string    `json:"fiat"`
	CreatedAt   int64     `json:"createdAt"`
}

func (s *TradingService) CreateP2POrder(userID string, req P2POrderRequest) (*P2POrder, error) {
	order := &P2POrder{
		OrderID:      uuid.New().String(),
		UserID:       userID,
		Type:         req.Type,
		Asset:        req.Asset,
		FiatAmount:   req.FiatAmount,
		CryptoAmount: req.CryptoAmount,
		Price:        req.Price,
		PaymentMethod: req.PaymentMethod,
		Status:       "pending",
		Fiat:         req.Fiat,
		CreatedAt:    time.Now().UnixMilli(),
	}

	log.Printf("[INFO] P2P order created: %s %s %s", order.OrderID, order.Type, order.Asset)

	return order, nil
}

type P2POrderRequest struct {
	Type         string `json:"type"`
	Asset        string `json:"asset"`
	FiatAmount   float64 `json:"fiatAmount"`
	CryptoAmount float64 `json:"cryptoAmount"`
	Price        float64 `json:"price"`
	PaymentMethod string `json:"paymentMethod"`
	Fiat         string `json:"fiat"`
}

// =============================================================================
// TRADFI (STOCKS CFD)
// =============================================================================

type CFDContract struct {
	ContractID string  `json:"contractId"`
	Symbol    string  `json:"symbol"`
	Asset     string  `json:"asset"` // AAPL, TSLA, etc.
	Type      string  `json:"type"` // stock, index
	Price     float64 `json:"price"`
}

func (s *TradingService) OpenCFDPosition(userID, symbol, side string, quantity int, leverage int) (*Position, error) {
	ticker, ok := s.tickers[symbol]
	if !ok {
		return nil, errors.New("CFD symbol not found")
	}

	req := PositionRequest{
		UserID:       userID,
		Symbol:       symbol,
		Side:         OrderSide(side),
		Quantity:     float64(quantity),
		EntryPrice:   ticker.LastPrice,
		Leverage:     leverage,
		MarginType:   "isolated",
		PositionSide: side,
	}

	return s.OpenPosition(req)
}

// =============================================================================
// PRE-MARKET TRADING
// =============================================================================

type PreMarketOrder struct {
	OrderID    string    `json:"orderId"`
	UserID     string    `json:"userId"`
	Symbol     string    `json:"symbol"`
	Side       OrderSide `json:"side"`
	Quantity   float64   `json:"quantity"`
	LimitPrice float64   `json:"limitPrice"`
	LaunchPrice float64  `json:"launchPrice"`
	Status     string    `json:"status"` // pending, filled, expired
	ExpiresAt  int64     `json:"expiresAt"`
}

func (s *TradingService) PlacePreMarketOrder(userID, symbol string, req PreMarketOrderRequest) (*PreMarketOrder, error) {
	order := &PreMarketOrder{
		OrderID:     uuid.New().String(),
		UserID:      userID,
		Symbol:      symbol,
		Side:        req.Side,
		Quantity:    req.Quantity,
		LimitPrice:  req.LimitPrice,
		LaunchPrice: 0, // Will be set at launch
		Status:      "pending",
		ExpiresAt:   time.Now().Add(24 * time.Hour).UnixMilli(),
	}

	log.Printf("[INFO] Pre-market order placed: %s %s %s", order.OrderID, order.Symbol, order.Side)

	return order, nil
}

type PreMarketOrderRequest struct {
	Side       OrderSide `json:"side"`
	Quantity   float64   `json:"quantity"`
	LimitPrice float64   `json:"limitPrice"`
}

// =============================================================================
// GRID TRADING
// =============================================================================

type GridStrategy struct {
	StrategyID    string    `json:"strategyId"`
	UserID       string    `json:"userId"`
	Symbol       string    `json:"symbol"`
	GridCount    int       `json:"gridCount"`
	MinPrice     float64   `json:"minPrice"`
	MaxPrice     float64   `json:"maxPrice"`
	InvestAmount float64   `json:"investAmount"`
	GridSpacing  float64   `json:"gridSpacing"`
	Status       string    `json:"status"` // active, paused, stopped
	CreatedAt    int64     `json:"createdAt"`
}

func (s *TradingService) CreateGridStrategy(userID string, req GridStrategyRequest) (*GridStrategy, error) {
	strategy := &GridStrategy{
		StrategyID:   uuid.New().String(),
		UserID:       userID,
		Symbol:       req.Symbol,
		GridCount:    req.GridCount,
		MinPrice:     req.MinPrice,
		MaxPrice:     req.MaxPrice,
		InvestAmount: req.InvestAmount,
		GridSpacing:  (req.MaxPrice - req.MinPrice) / float64(req.GridCount),
		Status:       "active",
		CreatedAt:    time.Now().UnixMilli(),
	}

	log.Printf("[INFO] Grid strategy created: %s %s %d grids", strategy.StrategyID, strategy.Symbol, strategy.GridCount)

	return strategy, nil
}

type GridStrategyRequest struct {
	Symbol       string  `json:"symbol"`
	GridCount    int     `json:"gridCount"`
	MinPrice     float64 `json:"minPrice"`
	MaxPrice     float64 `json:"maxPrice"`
	InvestAmount float64 `json:"investAmount"`
}

// =============================================================================
// COPY TRADING
// =============================================================================

type CopyTrading struct {
	CopyID       string    `json:"copyId"`
	TraderID     string    `json:"traderId"`
	FollowerID   string    `json:"followerId"`
	CopyRatio    float64   `json:"copyRatio"`
	Status       string    `json:"status"` // active, paused, stopped
	TotalProfit  float64   `json:"totalProfit"`
	CreatedAt    int64     `json:"createdAt"`
}

func (s *TradingService) StartCopyTrading(traderID, followerID string, copyRatio float64) (*CopyTrading, error) {
	copyTrade := &CopyTrading{
		CopyID:     uuid.New().String(),
		TraderID:   traderID,
		FollowerID: followerID,
		CopyRatio:  copyRatio,
		Status:     "active",
		CreatedAt:  time.Now().UnixMilli(),
	}

	log.Printf("[INFO] Copy trading started: %s following %s", followerID, traderID)

	return copyTrade, nil
}

// =============================================================================
// STAKING & EARN
// =============================================================================

type StakingProduct struct {
	ProductID    string  `json:"productId"`
	Asset        string  `json:"asset"`
	Duration     int     `json:"duration"` // days
	APY          float64 `json:"apy"`
	MinAmount    float64 `json:"minAmount"`
	MaxAmount    float64 `json:"maxAmount"`
	Status       string  `json:"status"` // active, inactive
}

type StakingPosition struct {
	PositionID   string  `json:"positionId"`
	UserID       string  `json:"userId"`
	ProductID    string  `json:"productId"`
	Amount       float64 `json:"amount"`
	APY          float64 `json:"apy"`
	StartDate    int64   `json:"startDate"`
	EndDate      int64   `json:"endDate"`
	Status       string  `json:"status"` // active, claimed
}

func (s *TradingService) Stake(userID, productID string, amount float64) (*StakingPosition, error) {
	// Simplified staking
	position := &StakingPosition{
		PositionID: uuid.New().String(),
		UserID:     userID,
		ProductID:  productID,
		Amount:     amount,
		APY:        5.0, // Would get from product
		StartDate:  time.Now().UnixMilli(),
		EndDate:    time.Now().Add(30 * 24 * time.Hour).UnixMilli(),
		Status:     "active",
	}

	log.Printf("[INFO] Staking: %s %f %s", userID, amount, productID)

	return position, nil
}

// =============================================================================
// LAUNCHPAD & LAUNCHPOOL
// =============================================================================

type LaunchpadProject struct {
	ProjectID    string  `json:"projectId"`
	Name         string  `json:"name"`
	TokenSymbol  string  `json:"tokenSymbol"`
	TotalSupply  float64 `json:"totalSupply"`
	HardCap      float64 `json:"hardCap"`
	StartDate    int64   `json:"startDate"`
	EndDate      int64   `json:"endDate"`
	Status       string  `json:"status"` // upcoming, active, ended
}

func (s *TradingService) SubscribeLaunchpad(userID, projectID string, amount float64) (float64, error) {
	// Simplified - would calculate allocation
	allocation := amount * 10 // Simplified

	log.Printf("[INFO] Launchpad subscription: %s %f for %s", userID, amount, projectID)

	return allocation, nil
}

// =============================================================================
// CONVERT
// =============================================================================

func (s *TradingService) Convert(userID, fromAsset, toAsset string, amount float64) (float64, float64, error) {
	// Simplified convert
	fromTicker, ok := s.tickers[fromAsset+"USDT"]
	if !ok {
		return 0, 0, errors.New("from asset not found")
	}

	toTicker, ok := s.tickers[toAsset+"USDT"]
	if !ok {
		return 0, 0, errors.New("to asset not found")
	}

	usdtValue := amount * fromTicker.LastPrice
	outputAmount := usdtValue / toTicker.LastPrice
	fee := outputAmount * 0.001

	netOutput := outputAmount - fee

	log.Printf("[INFO] Convert: %s %f %s -> %f %s (fee: %f)", 
		userID, amount, fromAsset, netOutput, toAsset, fee)

	return netOutput, fee, nil
}

// =============================================================================
// TRANSFER
// =============================================================================

func (s *TradingService) Transfer(fromUserID, toUserID, asset string, amount float64) error {
	// Simplified transfer
	log.Printf("[INFO] Transfer: %s -> %s: %f %s", fromUserID, toUserID, amount, asset)
	return nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func (s *TradingService) calculateFee(symbol string, amount float64, side OrderSide) float64 {
	feeRate := s.feeRates[symbol]
	if feeRate.TakerFee == 0 {
		feeRate.TakerFee = s.config.DefaultTakerFee
	}

	return amount * feeRate.TakerFee
}

func (s *TradingService) calculateLiquidationPrice(req PositionRequest) float64 {
	marginRatio := 1.0 / float64(req.Leverage)
	maintenanceMargin := 0.5 // 50% maintenance margin

	if req.Side == SideBuy {
		return req.EntryPrice * (1 - marginRatio + maintenanceMargin)
	}

	return req.EntryPrice * (1 + marginRatio - maintenanceMargin)
}

func calculatePositionPnL(pos *Position, currentPrice float64, closeQuantity float64) float64 {
	var pnl float64

	if pos.Side == SideBuy {
		pnl = (currentPrice - pos.EntryPrice) * closeQuantity
	} else {
		pnl = (pos.EntryPrice - currentPrice) * closeQuantity
	}

	return pnl - (closeQuantity * currentPrice * 0.001) // Fee deduction
}

func getQuoteAsset(symbol string) string {
	parts := strings.Split(symbol, "")
	if len(parts) >= 4 {
		return strings.Join(parts[len(parts)-4:], "")
	}
	return "USDT"
}

var _ = fmt.Errorf
var _ = json.Marshal
var _ = big.NewInt
var _ = math.Pow
