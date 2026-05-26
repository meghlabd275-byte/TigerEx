package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX CORE SERVICES - GO (49 files equivalent)
// ============================================================================

// ------------------ MODELS ------------------

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Username     string `json:"username"`
	Status      string `json:"status"`
	KYCLevel    int    `json:"kyc_level"`
	TwoFactor   bool   `json:"two_factor_enabled"`
	ReferralCode string `json:"referral_code"`
	CreatedAt   int64  `json:"created_at"`
}

type Wallet struct {
	ID       string  `json:"id"`
	UserID   string  `json:"user_id"`
	Currency string  `json:"currency"`
	Chain   string  `json:"chain"`
	Balance float64 `json:"balance"`
	Locked  float64 `json:"locked"`
	Address string  `json:"address"`
}

type Order struct {
	ID           string  `json:"id"`
	UserID       string  `json:"user_id"`
	Symbol       string  `json:"symbol"`
	Side         string  `json:"side"`
	Type         string  `json:"type"`
	Price        float64 `json:"price"`
	Quantity     float64 `json:"quantity"`
	FilledQty    float64 `json:"filled_qty"`
	AvgPrice    float64 `json:"avg_price"`
	Status      string  `json:"status"`
	TimeInForce string  `json:"time_in_force"`
	StopPrice   float64 `json:"stop_price"`
	ReduceOnly bool    `json:"reduce_only"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

type Trade struct {
	ID        string  `json:"id"`
	OrderID   string  `json:"order_id"`
	UserID   string  `json:"user_id"`
	Symbol   string  `json:"symbol"`
	Side     string  `json:"side"`
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Fee      float64 `json:"fee"`
	Role     string  `json:"role"`
	CreatedAt int64 `json:"created_at"`
}

type Position struct {
	ID             string  `json:"id"`
	UserID         string  `json:"user_id"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"`
	Quantity      float64 `json:"quantity"`
	EntryPrice    float64 `json:"entry_price"`
	MarkPrice     float64 `json:"mark_price"`
	UnrealizedPnL float64 `json:"unrealized_pnl"`
	Leverage      float64 `json:"leverage"`
	Margin        float64 `json:"margin"`
	LiqPrice     float64 `json:"liquidation_price"`
}

type Market struct {
	Symbol      string  `json:"symbol"`
	BaseAsset  string  `json:"base_asset"`
	QuoteAsset string  `json:"quote_asset"`
	Status    string  `json:"status"`
	Precision int     `json:"precision"`
	MinQty     float64 `json:"min_qty"`
	MaxQty     float64 `json:"max_qty"`
	MakerFee   float64 `json:"maker_fee"`
	TakerFee   float64 `json:"taker_fee"`
}

type Ticker struct {
	Symbol         string  `json:"symbol"`
	LastPrice     float64 `json:"last_price"`
	PriceChange   float64 `json:"price_change"`
	ChangePercent float64 `json:"change_percent"`
	HighPrice     float64 `json:"high_price"`
	LowPrice      float64 `json:"low_price"`
	Volume        float64 `json:"volume"`
	QuoteVolume   float64 `json:"quote_volume"`
}

// ------------------ TRADING SERVICE ------------------

type TradingService struct {
	mu      sync.RWMutex
	markets map[string]*Market
	books   map[string]*OrderBook
	orders  map[string]map[string]*Order
	trades  []Trade
}

type OrderBook struct {
	symbol string
	bids   map[float64]*PriceLevel
	asks   map[float64]*PriceLevel
}

type PriceLevel struct {
	Price    float64
	Quantity float64
}

func NewTradingService() *TradingService {
	defaults := map[string]*Market{
		"BTC/USDT": {Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.00001, MaxQty: 1000, MakerFee: 0.001, TakerFee: 0.001},
		"ETH/USDT": {Symbol: "ETH/USDT", BaseAsset: "ETH", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.0001, MaxQty: 10000, MakerFee: 0.001, TakerFee: 0.001},
		"SOL/USDT": {Symbol: "SOL/USDT", BaseAsset: "SOL", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.01, MaxQty: 100000, MakerFee: 0.002, TakerFee: 0.002},
		"BNB/USDT": {Symbol: "BNB/USDT", BaseAsset: "BNB", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 0.001, MaxQty: 10000, MakerFee: 0.001, TakerFee: 0.001},
		"XRP/USDT": {Symbol: "XRP/USDT", BaseAsset: "XRP", QuoteAsset: "USDT", Status: "trading", Precision: 8, MinQty: 1, MaxQty: 10000000, MakerFee: 0.001, TakerFee: 0.001},
	}

	ts := &TradingService{
		markets: defaults,
		books:   make(map[string]*OrderBook),
		orders:  make(map[string]map[string]*Order),
	}

	for symbol := range defaults {
		ts.books[symbol] = &OrderBook{symbol: symbol, bids: make(map[float64]*PriceLevel), asks: make(map[float64]*PriceLevel)}
	}

	return ts
}

func (s *TradingService) CreateOrder(ctx context.Context, userID, symbol, side, orderType, timeInForce string, price, quantity, stopPrice float64, reduceOnly bool) (*Order, []Trade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	order := &Order{
		ID:          fmt.Sprintf("ord_%d", time.Now().UnixNano()),
		UserID:       userID,
		Symbol:      symbol,
		Side:        side,
		Type:        orderType,
		Price:       price,
		Quantity:    quantity,
		FilledQty:   0,
		AvgPrice:    0,
		Status:      "open",
		TimeInForce: timeInForce,
		StopPrice:  stopPrice,
		ReduceOnly: reduceOnly,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:  time.Now().Unix(),
	}

	if s.orders[userID] == nil {
		s.orders[userID] = make(map[string]*Order)
	}
	s.orders[userID][order.ID] = order

	var trades []Trade
	if orderType == "market" || (orderType == "limit" && price > 0) {
		trades = s.matchOrder(order)
	}

	return order, trades, nil
}

func (s *TradingService) matchOrder(order *Order) []Trade {
	book, ok := s.books[order.Symbol]
	if !ok {
		return nil
	}

	var trades []Trade
	bookMap := book.asks
	opposite := book.bids
	if order.Side == "buy" {
		bookMap = book.bids
		opposite = book.asks
	}

	for price, level := range bookMap {
		if order.Type == "limit" && order.Side == "buy" && price > order.Price {
			continue
		}
		if order.Type == "limit" && order.Side == "sell" && price < order.Price {
			continue
		}

		fillQty := math.Min(order.Quantity-order.FilledQty, level.Quantity)
		if fillQty <= 0 {
			continue
		}

		order.FilledQty += fillQty
		if order.FilledQty > 0 {
			order.AvgPrice = (order.AvgPrice*(order.FilledQty-fillQty) + price*fillQty) / order.FilledQty
		} else {
			order.AvgPrice = price
		}

		trade := Trade{
			ID:         fmt.Sprintf("t%d", time.Now().UnixNano()),
			OrderID:    order.ID,
			UserID:    order.UserID,
			Symbol:   order.Symbol,
			Side:     order.Side,
			Price:    price,
			Quantity: fillQty,
			Fee:      fillQty * price * 0.001,
			Role:     "taker",
			CreatedAt: time.Now().Unix(),
		}
		trades = append(trades, trade)
		s.trades = append(s.trades, trade)

		level.Quantity -= fillQty
		if level.Quantity <= 0 {
			delete(opposite, price)
		}

		if order.FilledQty >= order.Quantity {
			break
		}
	}

	if order.FilledQty >= order.Quantity {
		order.Status = "filled"
	} else if order.FilledQty > 0 {
		order.Status = "partially_filled"
	}

	return trades
}

func (s *TradingService) CancelOrder(ctx context.Context, userID, orderID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	orders, ok := s.orders[userID]
	if !ok {
		return fmt.Errorf("no orders found")
	}

	order, ok := orders[orderID]
	if !ok {
		return fmt.Errorf("order not found")
	}

	if order.Status == "filled" || order.Status == "cancelled" {
		return fmt.Errorf("order already %s", order.Status)
	}

	order.Status = "cancelled"
	order.UpdatedAt = time.Now().Unix()
	return nil
}

func (s *TradingService) GetOrders(ctx context.Context, userID, symbol, status string) ([]Order, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []Order
	if orders, ok := s.orders[userID]; ok {
		for _, o := range orders {
			if symbol != "" && o.Symbol != symbol {
				continue
			}
			if status != "" && o.Status != status {
				continue
			}
			result = append(result, *o)
		}
	}
	return result, nil
}

func (s *TradingService) GetTrades(ctx context.Context, symbol string, limit int) ([]Trade, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	start := len(s.trades) - limit
	if start < 0 {
		start = 0
	}
	return s.trades[start:], nil
}

func (s *TradingService) GetMarkets() []Market {
	var result []Market
	for _, m := range s.markets {
		result = append(result, *m)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Symbol < result[j].Symbol })
	return result
}

func (s *TradingService) GetTicker(symbol string) *Ticker {
	prices := map[string]float64{"BTC/USDT": 43250, "ETH/USDT": 2650, "SOL/USDT": 98.5, "BNB/USDT": 312, "XRP/USDT": 0.62}
	lastPrice := prices[symbol]
	if lastPrice == 0 {
		lastPrice = 40000
	}

	return &Ticker{
		Symbol:          symbol,
		LastPrice:      lastPrice,
		PriceChange:   lastPrice * 0.02,
		ChangePercent: 2.0,
		HighPrice:    lastPrice * 1.03,
		LowPrice:     lastPrice * 0.97,
		Volume:      2500000000,
		QuoteVolume:  2500000000 * lastPrice,
	}
}

func (s *TradingService) GetOrderBook(symbol string, limit int) (bids, asks [][]float64) {
	book, ok := s.books[symbol]
	if !ok {
		return
	}

	count := 0
	for price, level := range book.bids {
		if count >= limit {
			break
		}
		bids = append(bids, []float64{price, level.Quantity})
		count++
	}

	count = 0
	for price, level := range book.asks {
		if count >= limit {
			break
		}
		asks = append(asks, []float64{price, level.Quantity})
		count++
	}
	return
}

func (s *TradingService) OpenPosition(ctx context.Context, userID, symbol, side string, quantity, entryPrice, leverage float64) (*Position, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pos := &Position{
		ID:           fmt.Sprintf("pos_%d", time.Now().UnixNano()),
		UserID:       userID,
		Symbol:      symbol,
		Side:       side,
		Quantity:   quantity,
		EntryPrice: entryPrice,
		Margin:     (quantity * entryPrice) / leverage,
		Leverage:   leverage,
	}

	marginRatio := 1.0 / leverage
	if side == "long" {
		pos.LiqPrice = entryPrice * (1 - marginRatio)
	} else {
		pos.LiqPrice = entryPrice * (1 + marginRatio)
	}

	return pos, nil
}

func (s *TradingService) GetPositions(ctx context.Context, userID string) ([]Position, error) {
	return []Position{
		{ID: "pos_1", UserID: userID, Symbol: "BTC/USDT", Side: "long", Quantity: 0.5, EntryPrice: 42000, MarkPrice: 43250, UnrealizedPnL: 625, Leverage: 3, Margin: 7000, LiqPrice: 35000},
	}, nil
}

// ------------------ USER SERVICE ------------------

type UserService struct {
	users map[string]*User
	mu    sync.RWMutex
}

func NewUserService() *UserService {
	return &UserService{users: make(map[string]*User)}
}

func (s *UserService) Register(ctx context.Context, email, username, password string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, u := range s.users {
		if u.Email == email {
			return nil, fmt.Errorf("email already exists")
		}
	}

	user := &User{
		ID:           fmt.Sprintf("usr_%d", time.Now().UnixNano()),
		Email:        email,
		Username:    username,
		Status:      "active",
		KYCLevel:    0,
		TwoFactor:  false,
		ReferralCode: fmt.Sprintf("TIGER%x", time.Now().UnixNano()),
		CreatedAt:  time.Now().Unix(),
	}

	s.users[user.ID] = user
	return user, nil
}

func (s *UserService) GetByID(ctx context.Context, userID string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if user, ok := s.users[userID]; ok {
		return user, nil
	}
	return nil, fmt.Errorf("user not found")
}

// ------------------ WALLET SERVICE ------------------

type WalletService struct {
	wallets map[string]map[string]*Wallet
	mu       sync.RWMutex
}

func NewWalletService() *WalletService {
	ws := &WalletService{wallets: make(map[string]map[string]*Wallet)}

	defaults := map[string]map[string]*Wallet{
		"demo": {
			"BTC": {ID: "w_btc", UserID: "demo", Currency: "BTC", Chain: "bitcoin", Balance: 1.5, Locked: 0, Address: "bc1qxy2..."},
			"ETH": {ID: "w_eth", UserID: "demo", Currency: "ETH", Chain: "ethereum", Balance: 15.0, Locked: 0, Address: "0x742d..."},
			"USDT": {ID: "w_usdt", UserID: "demo", Currency: "USDT", Chain: "ethereum", Balance: 50000, Locked: 5000},
		},
	}

	for uid, wm := range defaults {
		ws.wallets[uid] = wm
	}

	return ws
}

func (s *WalletService) GetBalance(ctx context.Context, userID, currency string) (float64, float64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if wallets, ok := s.wallets[userID]; ok {
		if wallet, ok := wallets[currency]; ok {
			return wallet.Balance, wallet.Locked, nil
		}
	}
	return 0, 0, nil
}

func (s *WalletService) GetDepositAddress(ctx context.Context, userID, currency, chain string) (string, error) {
	addresses := map[string]string{
		"BTC:bitcoin":  "bc1qxy2kgdxfgqcxgcwryq8yn8dwr4ky5je00q9kz7",
		"ETH:ethereum": "0x742d35Cc6634C0532925a3b844Bc454e4438f",
		"USDT:ethereum": "0x742d35Cc6634C0532925a3b844Bc454e4438f",
	}

	key := currency + ":" + chain
	if addr, ok := addresses[key]; ok {
		return addr, nil
	}
	return "", nil
}

func (s *WalletService) Withdraw(ctx context.Context, userID, currency, amountStr, address, chain string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	amount, _ := strconv.ParseFloat(amountStr, 64)

	if wallets, ok := s.wallets[userID]; ok {
		if wallet, ok := wallets[currency]; ok {
			if wallet.Balance+wallet.Locked < amount {
				return "", fmt.Errorf("insufficient balance")
			}
			wallet.Balance -= amount
		}
	}

	return fmt.Sprintf("tx_%d", time.Now().UnixNano()), nil
}

// ------------------ HTTP HANDLERS ------------------

func SetupRoutes(r *gin.Engine, ts *TradingService, us *UserService, ws *WalletService) {
	api := r.Group("/api/v1")

	api.POST("/orders", func(c *gin.Context) {
		var req struct {
			Symbol     string  `json:"symbol" binding:"required"`
			Side      string  `json:"side" binding:"required,oneof=buy sell"`
			Type      string  `json:"type" binding:"required,oneof=market limit stop_limit"`
			Price     float64 `json:"price"`
			Quantity  float64 `json:"quantity" binding:"required"`
			TimeInForce string `json:"time_in_force"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		order, trades, err := ts.CreateOrder(c.Request.Context(), "demo", req.Symbol, req.Side, req.Type, req.TimeInForce, req.Price, req.Quantity, 0, false)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(201, gin.H{"order": order, "trades": trades})
	})

	api.GET("/orders", func(c *gin.Context) {
		orders, _ := ts.GetOrders(c.Request.Context(), "demo", c.Query("symbol"), c.Query("status"))
		c.JSON(200, orders)
	})

	api.DELETE("/orders/:id", func(c *gin.Context) {
		id := c.Param("id")
		if err := ts.CancelOrder(c.Request.Context(), "demo", id); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true})
	})

	api.GET("/markets", func(c *gin.Context) {
		c.JSON(200, ts.GetMarkets())
	})

	api.GET("/markets/:symbol/ticker", func(c *gin.Context) {
		symbol := c.Param("symbol")
		ticker := ts.GetTicker(symbol)
		if ticker == nil {
			c.JSON(404, gin.H{"error": "not found"})
			return
		}
		c.JSON(200, ticker)
	})

	api.GET("/markets/:symbol/orderbook", func(c *gin.Context) {
		symbol := c.Param("symbol")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		bids, asks := ts.GetOrderBook(symbol, limit)
		c.JSON(200, gin.H{"symbol": symbol, "bids": bids, "asks": asks, "timestamp": time.Now().Unix()})
	})

	api.GET("/positions", func(c *gin.Context) {
		positions, _ := ts.GetPositions(c.Request.Context(), "demo")
		c.JSON(200, positions)
	})

	api.GET("/user/profile", func(c *gin.Context) {
		user, _ := us.GetByID(c.Request.Context(), "demo")
		c.JSON(200, user)
	})

	api.GET("/wallets", func(c *gin.Context) {
		wallets := []gin.H{
			{"currency": "BTC", "balance": 1.5, "locked": 0},
			{"currency": "ETH", "balance": 15.0, "locked": 0},
			{"currency": "USDT", "balance": 50000, "locked": 5000},
		}
		c.JSON(200, wallets)
	})

	api.GET("/wallets/:currency/address", func(c *gin.Context) {
		currency := c.Param("currency")
		chain := c.DefaultQuery("chain", "bitcoin")
		addr, _ := ws.GetDepositAddress(c.Request.Context(), "demo", currency, chain)
		c.JSON(200, gin.H{"currency": currency, "chain": chain, "address": addr})
	})

	api.POST("/wallets/withdraw", func(c *gin.Context) {
		var req struct {
			Currency string `json:"currency" binding:"required"`
			Amount   string `json:"amount" binding:"required"`
			Address string `json:"address" binding:"required"`
			Chain   string `json:"chain"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		txID, err := ws.Withdraw(c.Request.Context(), "demo", req.Currency, req.Amount, req.Address, req.Chain)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		c.JSON(201, gin.H{"id": txID, "status": "pending"})
	})

	api.GET("/trades", func(c *gin.Context) {
		symbol := c.DefaultQuery("symbol", "BTC/USDT")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		trades, _ := ts.GetTrades(c.Request.Context(), symbol, limit)
		c.JSON(200, trades)
	})
}

// ------------------ MAIN ------------------

func main() {
	r := gin.Default()

	ts := NewTradingService()
	us := NewUserService()
	ws := NewWalletService()

	SetupRoutes(r, ts, us, ws)

	log.Fatal(r.Run(":8080"))
}