package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"tigerex/backend/internal/services"
)

// TradeHandler handles trading endpoints
type TradeHandler struct {
	tradeService *services.TradeService
}

func NewTradeHandler(s *services.TradeService) *TradeHandler {
	return &TradeHandler{tradeService: s}
}

func (h *TradeHandler) CreateOrder(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Symbol       string `json:"symbol" binding:"required"`
		Side         string `json:"side" binding:"required,oneof=buy sell"`
		Type         string `json:"type" binding:"required,oneof=market limit stop_loss take_profit"`
		Quantity    string `json:"quantity" binding:"required"`
		Price       string `json:"price"`
		StopPrice   string `json:"stop_price"`
		TimeInForce string `json:"time_in_force" binding:"oneof=gtc ioc fok"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.tradeService.CreateOrder(c.Request.Context(), userID, req.Symbol, req.Side, req.Type, req.Quantity, req.Price, req.StopPrice, req.TimeInForce)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, resp)
}

func (h *TradeHandler) GetOrders(c *gin.Context) {
	userID := c.GetString("user_id")
	symbol := c.Query("symbol")
	status := c.Query("status")
	page := c.DefaultQuery("page", "1")
	limit := c.DefaultQuery("limit", "50")

	resp, err := h.tradeService.GetOrders(c.Request.Context(), userID, symbol, status, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *TradeHandler) GetOrder(c *gin.Context) {
	userID := c.GetString("user_id")
	orderID := c.Param("orderId")

	resp, err := h.tradeService.GetOrder(c.Request.Context(), userID, orderID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *TradeHandler) CancelOrder(c *gin.Context) {
	userID := c.GetString("user_id")
	orderID := c.Param("orderId")

	resp, err := h.tradeService.CancelOrder(c.Request.Context(), userID, orderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *TradeHandler) GetPositions(c *gin.Context) {
	userID := c.GetString("user_id")

	resp, err := h.tradeService.GetPositions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *TradeHandler) GetTrades(c *gin.Context) {
	userID := c.GetString("user_id")
	page := c.DefaultQuery("page", "1")
	limit := c.DefaultQuery("limit", "50")

	resp, err := h.tradeService.GetTrades(c.Request.Context(), userID, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

func (h *TradeHandler) HandleWebSocket(c *gin.Context) {
	marketService := services.NewMarketService(nil)
	marketService.HandleWebSocket(c.Writer, c.Request)
}