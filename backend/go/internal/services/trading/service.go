package main

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ============ TRADER SERVICE ============
type TraderService struct{}

func NewTraderService() *TraderService {
	return &TraderService{}
}

// ============ SPOT TRADING ============
type SpotOrder struct {
	ID            string `json:"id"`
	UserID        string `json:"user_id"`
	Symbol        string `json:"symbol"`
	Side          string `json:"side"`
	Type          string `json:"type"`
	Price         string `json:"price"`
	Quantity      string `json:"quantity"`
	FilledQty     string `json:"filled_qty"`
	Status        string `json:"status"`
	TimeInForce  string `json:"time_in_force"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
}

type SpotTrade struct {
	ID          string `json:"id"`
	OrderID     string `json:"order_id"`
	UserID     string `json:"user_id"`
	Symbol     string `json:"symbol"`
	Side       string `json:"side"`
	Price      string `json:"price"`
	Quantity   string `json:"quantity"`
	Fee        string `json:"fee"`
	Role       string `json:"role"`
	Timestamp  int64  `json:"timestamp"`
}

type SpotMarket struct {
	Symbol       string `json:"symbol"`
	BaseAsset   string `json:"base_asset"`
	QuoteAsset  string `json:"quote_asset"`
	Status     string `json:"status"`
	Precision  int    `json:"precision"`
	MinQty     string `json:"min_qty"`
	MaxQty     string `json:"max_qty"`
	MakerFee   string `json:"maker_fee"`
	TakerFee   string `json:"taker_fee"`
}

type OrderBook struct {
	Symbol   string     `json:"symbol"`
	Bids     [][]string `json:"bids"`
	Asks     [][]string `json:"asks"`
	LastID   int64      `json:"last_update_id"`
}

// ============ MARGIN TRADING ============
type MarginPosition struct {
	ID               string `json:"id"`
	UserID           string `json:"user_id"`
	Symbol           string `json:"symbol"`
	Side            string `json:"side"` // long, short
	Quantity        string `json:"quantity"`
	EntryPrice      string `json:"entry_price"`
	MarkPrice      string `json:"mark_price"`
	UnrealizedPnL   string `json:"unrealized_pnl"`
	Leverage        int     `json:"leverage"`
	LiquidationPrice string `json:"liquidation_price"`
	MarginRatio    string `json:"margin_ratio"`
	Isolated      bool    `json:"isolated"`
}

type Borrowing struct {
	ID              string `json:"id"`
	UserID          string `json:"user_id"`
	Currency        string `json:"currency"`
	Amount         string `json:"amount"`
	Remaining      string `json:"remaining"`
	InterestRate   string `json:"interest_rate"`
	InterestAccrued string `json:"interest_accrued"`
	BorrowTime     int64  `json:"borrow_time"`
}

// ============ FUTURES TRADING ============
type FuturesPosition struct {
	ID                 string `json:"id"`
	UserID             string `json:"user_id"`
	Symbol             string `json:"symbol"`
	PositionSide       string `json:"position_side"` // long, short
	Quantity          string `json:"quantity"`
	EntryPrice        string `json:"entry_price"`
	MarkPrice        string `json:"mark_price"`
	UnrealizedPnL    string `json:"unrealized_pnl"`
	RealizedPnL      string `json:"realized_pnl"`
	Leverage         int    `json:"leverage"`
	Margin           string `json:"margin"`
	LiquidationPrice string `json:"liquidation_price"`
	MarginRatio     string `json:"margin_ratio"`
}

type FundingInfo struct {
	Symbol             string `json:"symbol"`
	FundingRate       string `json:"funding_rate"`
	NextFundingTime  int64  `json:"next_funding_time"`
	PredictedRate    string `json:"predicted_funding_rate"`
	IndexPrice      string `json:"index_price"`
}

// ============ WALLET SERVICE ============
type Wallet struct {
	ID       string `json:"id"`
	UserID   string `json:"user_id"`
	Currency string `json:"currency"`
	Chain   string `json:"chain"`
	Balance string `json:"balance"`
	Locked  string `json:"locked"`
	Address string `json:"address"`
}

type Transaction struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
	Type     string `json:"type"`
	Status   string `json:"status"`
	TxHash   string `json:"tx_hash"`
	CreatedAt int64  `json:"created_at"`
}

// ============ HANDLER IMPLEMENTATIONS ============

func (s *TraderService) handleCreateSpotOrder(c *gin.Context) {
	var req struct {
		Symbol    string `json:"symbol" binding:"required"`
		Side     string `json:"side" binding:"required,oneof=buy sell"`
		Type     string `json:"type" binding:"required,oneof=market limit stop_limit"`
		Price   string `json:"price"`
		Quantity string `json:"quantity" binding:"required"`
		TimeInForce string `json:"time_in_force" binding:"oneof=gtc ioc fok"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	order := SpotOrder{
		ID:         "ord_" + time.Now().Format("20060102150405"),
		UserID:     c.GetString("user_id"),
		Symbol:    req.Symbol,
		Side:      req.Side,
		Type:      req.Type,
		Price:     req.Price,
		Quantity:  req.Quantity,
		FilledQty:  "0",
		Status:    "pending",
		TimeInForce: req.TimeInForce,
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}

	c.JSON(http.StatusCreated, order)
}

func (s *TraderService) handleGetSpotOrders(c *gin.Context) {
	userID := c.GetString("user_id")
	symbol := c.Query("symbol")
	status := c.Query("status")

	// Mock response
	orders := []SpotOrder{
		{
			ID:        "ord_001",
			UserID:     userID,
			Symbol:    symbol,
			Side:      "buy",
			Type:      "limit",
			Price:     "43000.00",
			Quantity:  "0.5",
			FilledQty: "0",
			Status:    status,
		},
	}

	c.JSON(http.StatusOK, orders)
}

func (s *TraderService) handleGetSpotTrades(c *gin.Context) {
	userID := c.GetString("user_id")
	symbol := c.Query("symbol")

	trades := []SpotTrade{
		{
			ID:        "t001",
			OrderID:   "ord_001",
			UserID:    userID,
			Symbol:   symbol,
			Side:     "buy",
			Price:    "43200.00",
			Quantity: "0.5",
			Fee:      "2.16",
			Role:     "maker",
			Timestamp: time.Now().Unix(),
		},
	}

	c.JSON(http.StatusOK, trades)
}

func (s *TraderService) handleGetMarkets(c *gin.Context) {
	markets := []SpotMarket{
		{
			Symbol:    "BTC/USDT",
			BaseAsset:  "BTC",
			QuoteAsset: "USDT",
			Status:    "trading",
			Precision: 8,
			MinQty:    "0.00001",
			MaxQty:    "1000",
			MakerFee:  "0.01",
			TakerFee:  "0.01",
		},
		{
			Symbol:    "ETH/USDT",
			BaseAsset:  "ETH",
			QuoteAsset: "USDT",
			Status:    "trading",
			Precision: 8,
			MinQty:    "0.0001",
			MaxQty:    "10000",
			MakerFee:  "0.01",
			TakerFee:  "0.01",
		},
		{
			Symbol:    "SOL/USDT",
			BaseAsset:  "SOL",
			QuoteAsset: "USDT",
			Status:    "trading",
			Precision: 8,
			MinQty:    "0.01",
			MaxQty:    "100000",
			MakerFee:  "0.02",
			TakerFee:  "0.02",
		},
	}

	c.JSON(http.StatusOK, markets)
}

func (s *TraderService) handleGetOrderBook(c *gin.Context) {
	symbol := c.Param("symbol")
	limit := c.DefaultQuery("limit", "20")

	_ = limit

	bids := [][]string{
		{"43245.00", "2.5"},
		{"43240.00", "1.8"},
		{"43235.00", "3.2"},
	}
	asks := [][]string{
		{"43255.00", "1.2"},
		{"43260.00", "2.8"},
		{"43265.00", "0.9"},
	}

	ob := OrderBook{
		Symbol: symbol,
		Bids:   bids,
		Asks:  asks,
		LastID: time.Now().Unix(),
	}

	c.JSON(http.StatusOK, ob)
}

func (s *TraderService) handleGetTicker(c *gin.Context) {
	symbol := c.Param("symbol")

	tickers := map[string]struct {
		Symbol           string `json:"symbol"`
		LastPrice       string `json:"last_price"`
		PriceChange    string `json:"price_change"`
		ChangePercent string `json:"price_change_percent"`
		High         string `json:"high_price"`
		Low          string `json:"low_price"`
		Volume       string `json:"volume_24h"`
	}{
		"BTC/USDT": {
			43250.00, 1250.00, "2.98%", "44500", "41800", "2850000000",
		},
		"ETH/USDT": {
			2650.00, 85.00, "3.32%", "2750", "2500", "520000000",
		},
	}

	if ticker, ok := tickers[symbol]; ok {
		c.JSON(http.StatusOK, ticker)
	} else {
		c.JSON(http.StatusNotFound, gin.H{"error": "Symbol not found"})
	}
}

// ============ MARGIN HANDLERS ============

func (s *TraderService) handleMarginBorrow(c *gin.Context) {
	var req struct {
		Currency string `json:"currency" binding:"required"`
		Amount  string `json:"amount" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	borrowing := Borrowing{
		ID:              "br_" + time.Now().Format("20060102150405"),
		UserID:          c.GetString("user_id"),
		Currency:        req.Currency,
		Amount:         req.Amount,
		Remaining:      req.Amount,
		InterestRate:    "0.001",
		InterestAccrued: "0",
		BorrowTime:     time.Now().Unix(),
	}

	c.JSON(http.StatusCreated, borrowing)
}

func (s *TraderService) handleGetMarginPositions(c *gin.Context) {
	userID := c.GetString("user_id")

	positions := []MarginPosition{
		{
			ID:               "mp_001",
			UserID:           userID,
			Symbol:           "BTC/USDT",
			Side:            "long",
			Quantity:        "0.5",
			EntryPrice:      "42000.00",
			MarkPrice:      "43250.00",
			UnrealizedPnL:  "625.00",
			Leverage:        3,
			LiquidationPrice: "35000.00",
			MarginRatio:     "150%",
			Isolated:       false,
		},
	}

	c.JSON(http.StatusOK, positions)
}

// ============ FUTURES HANDLERS ============

func (s *TraderService) handleGetFuturesPositions(c *gin.Context) {
	userID := c.GetString("user_id")

	positions := []FuturesPosition{
		{
			ID:            "fp_001",
			UserID:        userID,
			Symbol:        "BTC/USDT",
			PositionSide: "long",
			Quantity:     "100",
			EntryPrice:  "42000.00",
			MarkPrice:   "43250.00",
			UnrealizedPnL: "125000",
			RealizedPnL:  "0",
			Leverage:     20,
			Margin:       "210000",
			LiquidationPrice: "39800.00",
			MarginRatio: "120%",
		},
	}

	c.JSON(http.StatusOK, positions)
}

func (s *TraderService) handleGetFundingRates(c *gin.Context) {
	funding := []FundingInfo{
		{
			Symbol:           "BTC/USDT",
			FundingRate:     "0.0001",
			NextFundingTime: time.Now().Add(8 * time.Hour).Unix(),
			PredictedRate:   "0.0001",
			IndexPrice:    "43250.00",
			MarkPrice:     "43254.00",
		},
	}

	c.JSON(http.StatusOK, funding)
}

// ============ WALLET HANDLERS ============

func (s *TraderService) handleGetWallets(c *gin.Context) {
	userID := c.GetString("user_id")

	wallets := []Wallet{
		{
			ID:       "w001",
			UserID:   userID,
			Currency: "BTC",
			Chain:   "bitcoin",
			Balance: "1.5234",
			Locked:  "0.1000",
		},
		{
			ID:       "w002",
			UserID:   userID,
			Currency: "USDT",
			Chain:   "ethereum",
			Balance: "25000.00",
			Locked:  "5000.00",
		},
	}

	c.JSON(http.StatusOK, wallets)
}

func (s *TraderService) handleGetTransactions(c *gin.Context) {
	userID := c.GetString("user_id")

	txs := []Transaction{
		{
			ID:        "tx001",
			UserID:    userID,
			Currency: "BTC",
			Amount:   "0.5",
			Type:     "deposit",
			Status:   "completed",
			TxHash:  "abc123",
			CreatedAt: time.Now().Add(-24 * time.Hour).Unix(),
		},
	}

	c.JSON(http.StatusOK, txs)
}

func (s *TraderService) handleWithdraw(c *gin.Context) {
	var req struct {
		Currency string `json:"currency" binding:"required"`
		Amount   string `json:"amount" binding:"required"`
		Address string `json:"address" binding:"required"`
		Chain   string `json:"chain"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx := Transaction{
		ID:        "tx_" + time.Now().Format("20060102150405"),
		UserID:    c.GetString("user_id"),
		Currency: req.Currency,
		Amount:   req.Amount,
		Type:     "withdrawal",
		Status:   "pending",
		CreatedAt: time.Now().Unix(),
	}

	c.JSON(http.StatusCreated, tx)
}