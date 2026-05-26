package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// ============ CORE TRADING SERVICE (GO) ============

type TradingService struct {
	db          *sql.DB
	orderBooks  map[string]*OrderBook
	positions   map[string]*Position
	userOrders  map[string]map[string]*Order
	mu          sync.RWMutex
}

type OrderBook struct {
	symbol      string
	mu          sync.RWMutex
	bids        map[float64]*PriceLevel
	asks        map[float64]*PriceLevel
	orders      map[string]*Order
	recentTrades []Trade
	lastTicker  Ticker
}

type PriceLevel struct {
	Price    float64
	Quantity float64
	Orders  int
}

type Order struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Symbol        string    `json:"symbol"`
	Side          string    `json:"side"` // buy, sell
	Type          string    `json:"type"` // market, limit, stop_limit
	Price         float64   `json:"price"`
	Quantity      float64   `json:"quantity"`
	FilledQty     float64   `json:"filled_qty"`
	AvgPrice     float64   `json:"avg_price"`
	Status       string    `json:"status"` // pending, open, filled, partially_filled, cancelled
	TimeInForce  string    `json:"time_in_force"`
	StopPrice   float64   `json:"stop_price"`
	ReduceOnly  bool      `json:"reduce_only"`
CreatedAt    int64     `json:"created_at"`
	UpdatedAt   int64     `json:"updated_at"`
}

type Trade struct {
	ID            string  `json:"id"`
	OrderID       string  `json:"order_id"`
	UserID       string  `json:"user_id"`
	Symbol       string  `json:"symbol"`
	Side          string  `json:"side"`
	Price        float64 `json:"price"`
	Quantity     float64 `json:"quantity"`
	Fee          float64 `json:"fee"`
	FeeCurrency   string  `json:"fee_currency"`
	Role         string  `json:"role"` // maker, taker
	Timestamp    int64   `json:"timestamp"`
}

type Position struct {
	ID               string  `json:"id"`
	UserID           string  `json:"user_id"`
	Symbol          string  `json:"symbol"`
	Side            string  `json:"side"` // long, short
	Quantity        float64 `json:"quantity"`
	EntryPrice     float64 `json:"entry_price"`
	MarkPrice      float64 `json:"mark_price"`
	UnrealizedPnL  float64 `json:"unrealized_pnl"`
	Leverage       float64 `json:"leverage"`
	Margin         float64 `json:"margin"`
	LiquidationPrice float64 `json:"liquidation_price"`
	MarginRatio   float64 `json:"margin_ratio"`
	Isolated      bool    `json:"isolated"`
}

type Ticker struct {
	Symbol         string  `json:"symbol"`
	LastPrice     float64 `json:"last_price"`
	PriceChange  float64 `json:"price_change"`
	ChangePercent float64 `json:"change_percent"`
	HighPrice    float64 `json:"high_price"`
	LowPrice    float64 `json:"low_price"`
	Volume      float64 `json:"volume"`
	QuoteVolume float64 `json:"quote_volume"`
}

type Market struct {
	Symbol       string  `json:"symbol"`
	BaseAsset   string  `json:"base_asset"`
	QuoteAsset  string  `json:"quote_asset"`
	Status     string  `json:"status"`
	Precision  int     `json:"precision"`
	MinQty     float64 `json:"min_qty"`
	MaxQty     float64 `json:"max_qty"`
	StepSize   float64 `json:"step_size"`
	MakerFee   float64 `json:"maker_fee"`
	TakerFee   float64 `json:"taker_fee"`
}

func NewTradingService(db *sql.DB) *TradingService {
	ts := &TradingService{
		db:         db,
		orderBooks: make(map[string]*OrderBook),
		positions:  make(map[string]*Position),
		userOrders: make(map[string]map[string]*Order),
	}
	
	// Initialize default markets
	defaults := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ADA/USDT"}
	for _, sym := range defaults {
		ts.orderBooks[sym] = NewOrderBook(sym)
	}
	
	return ts
}

func NewOrderBook(symbol string) *OrderBook {
	return &OrderBook{
		symbol: symbol,
		bids:   make(map[float64]*PriceLevel),
		asks:   make(map[float64]*PriceLevel),
		orders: make(map[string]*Order),
	}
}

// ============ ORDER OPERATIONS ============

func (ts *TradingService) CreateOrder(ctx context.Context, req CreateOrderInput) (*Order, []Trade, error) {
	order := &Order{
		ID:           fmt.Sprintf("ord_%d", time.Now().UnixNano()),
		UserID:       req.UserID,
		Symbol:      req.Symbol,
		Side:        req.Side,
		Type:        req.Type,
		Price:       req.Price,
		Quantity:    req.Quantity,
		FilledQty:   0,
		AvgPrice:   0,
		Status:     "open",
		TimeInForce: req.TimeInForce,
		StopPrice: req.StopPrice,
		ReduceOnly: req.ReduceOnly,
		CreatedAt:  time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}
	
	ts.mu.Lock()
	defer ts.mu.Unlock()
	
	// Get or create order book
	book, ok := ts.orderBooks[req.Symbol]
	if !ok {
		book = NewOrderBook(req.Symbol)
		ts.orderBooks[req.Symbol] = book
	}
	
	// Store order
	book.orders[order.ID] = order
	
	// Track user orders
	if ts.userOrders[req.UserID] == nil {
		ts.userOrders[req.UserID] = make(map[string]*Order)
	}
	ts.userOrders[req.UserID][order.ID] = order
	
	// Match order if market or limit
	var trades []Trade
	if order.Type == "market" || order.Price > 0 {
		trades = book.MatchOrder(order)
		order.Status = "filled"
		if order.FilledQty < order.Quantity {
			if order.FilledQty > 0 {
				order.Status = "partially_filled"
			} else {
				order.Status = "open"
			}
		}
	}
	
	order.UpdatedAt = time.Now().Unix()
	
	return order, trades, nil
}

func (ob *OrderBook) MatchOrder(order *Order) []Trade {
	var trades []Trade
	
	isBuy := order.Side == "buy"
	
	for _, level := range ob.getLevels(isBuy) {
		// Skip if limit price not met
		if order.Type == "limit" {
			if isBuy && level.Price > order.Price {
				continue
			}
			if !isBuy && level.Price < order.Price {
				continue
			}
		}
		
		fillQty := math.Min(order.Quantity-order.FilledQty, level.Quantity)
		if fillQty <= 0 {
			continue
		}
		
		execPrice := level.Price
		order.FilledQty += fillQty
		order.AvgPrice = (order.AvgPrice*(order.FilledQty-fillQty) + execPrice*fillQty) / order.FilledQty
		
		trade := Trade{
			ID:           fmt.Sprintf("t%d", time.Now().UnixNano()),
			OrderID:      order.ID,
			UserID:       order.UserID,
			Symbol:      order.Symbol,
			Side:        order.Side,
			Price:       execPrice,
			Quantity:    fillQty,
			Fee:        fillQty * execPrice * 0.001,
			FeeCurrency: "USDT",
			Role:       "taker",
			Timestamp:  time.Now().Unix(),
		}
		trades = append(trades, trade)
		ob.recentTrades = append(ob.recentTrades, trade)
		
		level.Quantity -= fillQty
		if level.Quantity <= 0 {
			if isBuy {
				delete(ob.bids, level.Price)
			} else {
				delete(ob.asks, level.Price)
			}
		}
		
		if order.FilledQty >= order.Quantity {
			break
		}
	}
	
	return trades
}

func (ob *OrderBook) getLevels(buy bool) []*PriceLevel {
	var levels []*PriceLevel
	book := ob.bids
	if !buy {
		book = ob.asks
	}
	
	for _, level := range book {
		levels = append(levels, level)
	}
	
	if buy {
		sort.Slice(levels, func(i, j int) bool { return levels[i].Price > levels[j].Price })
	} else {
		sort.Slice(levels, func(i, j int) bool { return levels[i].Price < levels[j].Price })
	}
	
	return levels
}

func (ts *TradingService) CancelOrder(ctx context.Context, userID, orderID, symbol string) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	
	book, ok := ts.orderBooks[symbol]
	if !ok {
		return fmt.Errorf("symbol not found")
	}
	
	order, ok := book.orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}
	
	if order.UserID != userID {
		return fmt.Errorf("unauthorized")
	}
	
	if order.Status == "filled" || order.Status == "cancelled" {
		return fmt.Errorf("order already %s", order.Status)
	}
	
	order.Status = "cancelled"
	order.UpdatedAt = time.Now().Unix()
	
	return nil
}

func (ts *TradingService) GetOrders(ctx context.Context, userID, symbol, status string) ([]Order, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	
	var orders []Order
	
	if ordersMap, ok := ts.userOrders[userID]; ok {
		for _, o := range ordersMap {
			if symbol != "" && o.Symbol != symbol {
				continue
			}
			if status != "" && o.Status != status {
				continue
			}
			orders = append(orders, *o)
		}
	}
	
	return orders, nil
}

func (ts *TradingService) GetTrades(ctx context.Context, symbol string, limit int) ([]Trade, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	
	book, ok := ts.orderBooks[symbol]
	if !ok {
		return nil, nil
	}
	
	start := len(book.recentTrades) - limit
	if start < 0 {
		start = 0
	}
	
	return book.recentTrades[start:], nil
}

// ============ MARKET OPERATIONS ============

func (ts *TradingService) GetMarkets() []Market {
	return []Market{
		{Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.00001, MaxQty: 1000, StepSize: 0.00001, MakerFee: 0.001, TakerFee: 0.001},
		{Symbol: "ETH/USDT", BaseAsset: "ETH", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.0001, MaxQty: 10000, StepSize: 0.0001, MakerFee: 0.001, TakerFee: 0.001},
		{Symbol: "SOL/USDT", BaseAsset: "SOL", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.01, MaxQty: 100000, StepSize: 0.01, MakerFee: 0.002, TakerFee: 0.002},
		{Symbol: "BNB/USDT", BaseAsset: "BNB", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.001, MaxQty: 10000, StepSize: 0.001, MakerFee: 0.001, TakerFee: 0.001},
		{Symbol: "XRP/USDT", BaseAsset: "XRP", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 1, MaxQty: 10000000, StepSize: 1, MakerFee: 0.001, TakerFee: 0.001},
		{Symbol: "ADA/USDT", BaseAsset: "ADA", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 1, MaxQty: 10000000, StepSize: 1, MakerFee: 0.001, TakerFee: 0.001},
	}
}

func (ts *TradingService) GetTicker(symbol string) *Ticker {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	
	book, ok := ts.orderBooks[symbol]
	if !ok {
		return nil
	}
	
	ticker := book.lastTicker
	if ticker.LastPrice == 0 {
		// Default values
		 defaults := map[string]float64{
			"BTC/USDT": 43250, "ETH/USDT": 2650, "SOL/USDT": 98.5,
			"BNB/USDT": 312, "XRP/USDT": 0.62, "ADA/USDT": 0.58,
		}
		ticker.Symbol = symbol
		if price, ok := defaults[symbol]; ok {
			ticker.LastPrice = price
			ticker.PriceChange = price * 0.02
			ticker.ChangePercent = 2.0
			ticker.HighPrice = price * 1.03
			ticker.LowPrice = price * 0.97
			ticker.Volume = 2500000000
			ticker.QuoteVolume = 2500000000 * price
		}
	}
	
	return &ticker
}

func (ts *TradingService) GetOrderBook(symbol string, limit int) (bids, asks [][]float64) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	
	book, ok := ts.orderBooks[symbol]
	if !ok {
		return
	}
	
	count := 0
	for _, level := range book.bids {
		if count >= limit {
			break
		}
		bids = append(bids, []float64{level.Price, level.Quantity})
		count++
	}
	
	count = 0
	for _, level := range book.asks {
		if count >= limit {
			break
		}
		asks = append(asks, []float64{level.Price, level.Quantity})
		count++
	}
	
	return
}

// ============ POSITION OPERATIONS ============

func (ts *TradingService) OpenPosition(ctx context.Context, req OpenPositionInput) (*Position, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	
	key := fmt.Sprintf("%s:%s:%s", req.UserID, req.Symbol, req.Side)
	
	pos, ok := ts.positions[key]
	if !ok {
		pos = &Position{
			ID:           fmt.Sprintf("pos_%d", time.Now().UnixNano()),
			UserID:       req.UserID,
			Symbol:       req.Symbol,
			Side:         req.Side,
			Quantity:     req.Quantity,
			EntryPrice:  req.EntryPrice,
			Margin:      req.Quantity * req.EntryPrice / req.Leverage,
			Leverage:    req.Leverage,
		}
		ts.positions[key] = pos
	} else {
		// Average in
		newQty := pos.Quantity + req.Quantity
		pos.AvgPrice = (pos.EntryPrice*pos.Quantity + req.EntryPrice*req.Quantity) / newQty
		pos.Quantity = newQty
		pos.Margin += req.Quantity * req.EntryPrice / req.Leverage
	}
	
	// Calculate liquidation price
	liquidationPrice := CalculateLiquidationPrice(pos.Side, pos.EntryPrice, pos.Leverage)
	pos.LiquidationPrice = liquidationPrice
	
	return pos, nil
}

func CalculateLiquidationPrice(side string, entryPrice, leverage float64) float64 {
	marginRatio := 1.0 / leverage * 100 // Maintenance margin ratio
	if side == "long" {
		return entryPrice * (1 - marginRatio/100)
	}
	return entryPrice * (1 + marginRatio/100)
}

func (ts *TradingService) GetPositions(ctx context.Context, userID string) ([]Position, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	
	var positions []Position
	for _, pos := range ts.positions {
		if pos.UserID == userID && pos.Quantity > 0 {
			positions = append(positions, *pos)
		}
	}
	
	return positions, nil
}

type CreateOrderInput struct {
	UserID      string  `json:"user_id"`
	Symbol      string  `json:"symbol"`
	Side       string  `json:"side"`
	Type       string  `json:"type"`
	Price       float64 `json:"price"`
	Quantity   float64 `json:"quantity"`
	TimeInForce string  `json:"time_in_force"`
	StopPrice  float64 `json:"stop_price"`
	ReduceOnly bool    `json:"reduce_only"`
}

type OpenPositionInput struct {
	UserID     string  `json:"user_id"`
	Symbol     string  `json:"symbol"`
	Side      string  `json:"side"`
	Quantity  float64 `json:"quantity"`
	EntryPrice float64 `json:"entry_price"`
	Leverage   float64 `json:"leverage"`
}

// ============ USER SERVICE ============

type UserService struct {
	db *sql.DB
}

func NewUserService(db *sql.DB) *UserService {
	return &UserService{db: db}
}

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	Status       string    `json:"status"`
	KYCLevel    int       `json:"kyc_level"`
	TwoFactor   bool      `json:"two_factor_enabled"`
	CreatedAt   int64     `json:"created_at"`
	LastLogin   int64      `json:"last_login"`
}

func (us *UserService) Register(ctx context.Context, email, password, username string) (*User, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	
	user := &User{
		ID:         fmt.Sprintf("usr_%d", time.Now().UnixNano()),
		Email:      email,
		Username:   username,
		Status:    "active",
		KYCLevel: 0,
		TwoFactor: false,
		CreatedAt: time.Now().Unix(),
	}
	
	_ = us.db // In real impl, insert to database
	
	return user, nil
}

func (us *UserService) GetProfile(ctx context.Context, userID string) (*User, error) {
	// Mock - return demo user
	return &User{
		ID:         userID,
		Email:      "user@example.com",
		Username:  "trader",
		Status:    "active",
		KYCLevel:  2,
		TwoFactor: true,
		CreatedAt: time.Now().Add(-30 * 24 * time.Hour).Unix(),
	}, nil
}

// ============ WALLET SERVICE ============

type WalletService struct {
	db       *sql.DB
	balances map[string]map[string]float64
	mu       sync.RWMutex
}

func NewWalletService(db *sql.DB) *WS {
	ws := &WalletService{
		db:       db,
		balances: make(map[string]map[string]float64),
	}
	
	// Initialize with demo balances
	defaults := map[string]float64{
		"BTC":  1.5,
		"ETH":  15.0,
		"USDT": 50000,
		"BNB":  100,
	}
	ws.balances["demo"] = defaults
	
	return ws
}

func (ws *WalletService) GetBalance(ctx context.Context, userID, currency string) (float64, float64, error) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	
	if balances, ok := ws.balances[userID]; ok {
		balance := balances[currency]
		locked := balances[currency+"_locked"]
		return balance, locked, nil
	}
	
	return 0, 0, nil
}

func (ws *WalletService) GetDepositAddress(ctx context.Context, userID, currency, chain string) (string, error) {
	addresses := map[string]string{
		"BTC:   "bc1qxy2kgdxfgqcxgcwryq8yn8dwr4ky5je00q9kz7",
		"ETH":  "0x742d35Cc6634C0532925a3b844Bc454e4438f",
		"USDT": "0x742d35Cc6634C0532925a3b844Bc454e4438f",
	}
	
	if addr, ok := addresses[currency]; ok {
		return addr, nil
	}
	
	return "", nil
}

func (ws *WalletService) Withdraw(ctx context.Context, userID, currency, amount, address string) (string, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	
	txID := fmt.Sprintf("tx_%d", time.Now().UnixNano())
	
	// Deduct balance
	if balances, ok := ws.balances[userID]; ok {
		balances[currency] -= 0 // In real impl, subtract amount
	}
	
	return txID, nil
}