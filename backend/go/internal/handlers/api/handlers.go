package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"tigerex/backend/internal/services/trading"
)

// ============ API HANDLERS (GO) ============

type TradingHandler struct {
	service *trading.TradingService
}

func NewTradingHandler(svc *trading.TradingService) *TradingHandler {
	return &TradingHandler{service: svc}
}

// ---------- ORDERS ----------

func (h *TradingHandler) CreateOrder(c *gin.Context) {
	var req trading.CreateOrderInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.UserID = c.GetString("user_id")
	if req.UserID == "" {
		req.UserID = "demo" // Demo mode
	}
	req.TimeInForce = "gtc"
	if req.TimeInForce == "" {
		req.TimeInForce = c.DefaultQuery("time_in_force", "gtc")
	}

	order, trades, err := h.service.CreateOrder(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"order":  order,
		"trades": trades,
	})
}

func (h *TradingHandler) CancelOrder(c *gin.Context) {
	orderID := c.Param("orderId")
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}
	symbol := c.DefaultQuery("symbol", "BTC/USDT")

	err := h.service.CancelOrder(c.Request.Context(), userID, orderID, symbol)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *TradingHandler) GetOrders(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}
	symbol := c.Query("symbol")
	status := c.Query("status")

	orders, err := h.service.GetOrders(c.Request.Context(), userID, symbol, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, orders)
}

func (h *TradingHandler) GetOrder(c *gin.Context) {
	orderID := c.Param("orderId")
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	orders, err := h.service.GetOrders(c.Request.Context(), userID, "", "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	for _, o := range orders {
		if o.ID == orderID {
			c.JSON(http.StatusOK, o)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
}

// ---------- TRADES ----------

func (h *TradingHandler) GetTrades(c *gin.Context) {
	symbol := c.DefaultQuery("symbol", "BTC/USDT")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	trades, err := h.service.GetTrades(c.Request.Context(), symbol, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, trades)
}

// ---------- MARKETS ----------

func (h *TradingHandler) GetMarkets(c *gin.Context) {
	markets := h.service.GetMarkets()
	c.JSON(http.StatusOK, markets)
}

func (h *TradingHandler) GetTicker(c *gin.Context) {
	symbol := c.Param("symbol")

	ticker := h.service.GetTicker(symbol)
	if ticker == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "symbol not found"})
		return
	}

	c.JSON(http.StatusOK, ticker)
}

func (h *TradingHandler) GetOrderBook(c *gin.Context) {
	symbol := c.Param("symbol")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	bids, asks := h.service.GetOrderBook(symbol, limit)

	c.JSON(http.StatusOK, gin.H{
		"symbol":     symbol,
		"bids":       bids,
		"asks":       asks,
		"timestamp":  time.Now().Unix(),
	})
}

// ---------- POSITIONS ----------

func (h *TradingHandler) GetPositions(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	positions, err := h.service.GetPositions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, positions)
}

func (h *TradingHandler) OpenPosition(c *gin.Context) {
	var req struct {
		Symbol     string  `json:"symbol" binding:"required"`
		Side       string  `json:"side" binding:"required,oneof=long short"`
		Quantity  float64 `json:"quantity" binding:"required"`
		EntryPrice float64 `json:"entry_price" binding:"required"`
		Leverage   float64 `json:"leverage" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	input := trading.OpenPositionInput{
		UserID:     userID,
		Symbol:     req.Symbol,
		Side:       req.Side,
		Quantity:  req.Quantity,
		EntryPrice: req.EntryPrice,
		Leverage:   req.Leverage,
	}

	position, err := h.service.OpenPosition(c.Request.Context(), input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, position)
}

// ============ USER HANDLERS ============

type UserHandler struct {
	service *trading.UserService
}

func NewUserHandler(svc *trading.UserService) *UserHandler {
	return &UserHandler{service: svc}
}

func (h *UserHandler) Register(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
		Username string `json:"username" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.service.Register(c.Request.Context(), req.Email, req.Password, req.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, user)
}

func (h *UserHandler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	profile, err := h.service.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, profile)
}

// ============ WALLET HANDLERS ============

type WalletHandler struct {
	service *trading.WalletService
}

func NewWalletHandler(svc *trading.WalletService) *WalletHandler {
	return &WalletHandler{service: svc}
}

func (h *WalletHandler) GetBalance(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}
	currency := c.DefaultQuery("currency", "USDT")

	available, locked, err := h.service.GetBalance(c.Request.Context(), userID, currency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"currency": currency,
		"available": available,
		"locked":   locked,
		"total":    available + locked,
	})
}

func (h *WalletHandler) GetWallets(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	wallets := []gin.H{
		{"currency": "BTC", "chain": "bitcoin", "balance": 1.5, "locked": 0},
		{"currency": "ETH", "chain": "ethereum", "balance": 15.0, "locked": 0},
		{"currency": "USDT", "chain": "ethereum", "balance": 50000, "locked": 5000},
	}

	c.JSON(http.StatusOK, wallets)
}

func (h *WalletHandler) GetDepositAddress(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	currency := c.Param("currency")
	chain := c.DefaultQuery("chain", "bitcoin")

	address, err := h.service.GetDepositAddress(c.Request.Context(), userID, currency, chain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"currency": currency,
		"chain":    chain,
		"address":  address,
	})
}

func (h *WalletHandler) Withdraw(c *gin.Context) {
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

	userID := c.GetString("user_id")
	if userID == "" {
		userID = "demo"
	}

	txID, err := h.service.Withdraw(c.Request.Context(), userID, req.Currency, req.Address, req.Amount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":      txID,
		"status":  "pending",
		"currency": req.Currency,
		"amount":  req.Amount,
	})
}

// ============ WEBSOCKET HANDLER ============

type WSHub struct {
	clients    map[*WSClient]bool
	broadcast chan []byte
	register chan *WSClient
	unregister chan *WSClient
}

type WSClient struct {
	hub     *WSHub
	conn   *gin.Engine
	send   chan []byte
 Rooms   map[string]bool
}

func NewWSHub() *WSHub {
	return &WSHub{
		clients:    make(map[*WSClient]bool),
		broadcast:  make(chan []byte),
		register:  make(chan *WSClient),
		unregister: make(chan *WSClient),
	}
}

func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (hub *WSHub) BroadcastTicker(symbol string, ticker trading.Ticker) {
	msg := map[string]interface{}{
		"type":   "ticker",
		"symbol": symbol,
		"data":   ticker,
	}
	//hub.broadcast <- msg // Would broadcast to all subscribed clients
}