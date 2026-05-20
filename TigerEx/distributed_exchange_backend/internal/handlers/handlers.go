package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"tigerex-backend/internal/service"
)

// AuthHandler handles authentication
type AuthHandler struct {
	authService *service.AuthService
}

func NewAuthHandler(as *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: as}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
		Phone   string `json:"phone"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.authService.Register(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "User already exists"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"user": user})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Identifier string `json:"identifier" binding:"required"`
		Password  string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.authService.Login(c.Request.Context(), req.Identifier, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tokens, err := h.authService.RefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
		return
	}

	c.JSON(http.StatusOK, tokens)
}

// OrderHandler handles order operations
type OrderHandler struct {
	orderService *service.OrderService
}

func NewOrderHandler(os *service.OrderService) *OrderHandler {
	return &OrderHandler{orderService: os}
}

func (h *OrderHandler) CreateOrder(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Symbol    string  `json:"symbol" binding:"required"`
		Side     string  `json:"side" binding:"required,oneof=BUY SELL"`
		Type     string  `json:"type" binding:"required,oneof=LIMIT MARKET"`
		Price   int64   `json:"price"`
		Quantity int64   `json:"quantity" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	order, err := h.orderService.CreateOrder(c.Request.Context(), userID, req.Symbol, req.Side, req.Type, req.Price, req.Quantity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"order": order})
}

func (h *OrderHandler) GetOrder(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	order, err := h.orderService.GetOrder(c.Request.Context(), userID, orderID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"order": order})
}

func (h *OrderHandler) ListOrders(c *gin.Context) {
	userID := c.GetString("user_id")
	symbol := c.Query("symbol")
	limit := c.DefaultQuery("limit", "50")
	status := c.Query("status")

	orders, err := h.orderService.ListOrders(c.Request.Context(), userID, symbol, status, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

func (h *OrderHandler) CancelOrder(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetString("user_id")

	err := h.orderService.CancelOrder(c.Request.Context(), userID, orderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// WalletHandler handles wallet operations  
type WalletHandler struct {
	walletService *service.WalletService
}

func NewWalletHandler(ws *service.WalletService) *WalletHandler {
	return &WalletHandler{walletService: ws}
}

func (h *WalletHandler) ListWallets(c *gin.Context) {
	userID := c.GetString("user_id")

	wallets, err := h.walletService.ListWallets(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"wallets": wallets})
}

func (h *WalletHandler) GetBalance(c *gin.Context) {
	userID := c.GetString("user_id")
	currency := c.Param("currency")

	balance, err := h.walletService.GetBalance(c.Request.Context(), userID, currency)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"balance": balance})
}

func (h *WalletHandler) Deposit(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Currency string `json:"currency" binding:"required"`
		Amount   int64  `json:"amount" binding:"required,gt=0"`
		TxHash  string `json:"tx_hash"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	deposit, err := h.walletService.Deposit(c.Request.Context(), userID, req.Currency, req.Amount, req.TxHash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"deposit": deposit})
}

func (h *WalletHandler) Withdraw(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Currency string `json:"currency" binding:"required"`
		Amount  int64  `json:"amount" binding:"required,gt=0"`
		Address string `json:"address" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := h.walletService.Withdraw(c.Request.Context(), userID, req.Currency, req.Amount, req.Address)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"tx": tx})
}