package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"tigerEx/rest_api_gateway/internal/config"
	"tigerEx/rest_api_gateway/internal/middleware"
	"tigerEx/rest_api_gateway/internal/models"
	"tigerEx/rest_api_gateway/internal/services"
)

// ============================================================================
// HANDLER STRUCT
// ============================================================================

// Handler holds all services and configuration
type Handler struct {
	config        *config.Config
	trading      *services.TradingService
	marketData   *services.MarketDataService
	auth        *middleware.AuthMiddleware
	rateLimiter *middleware.RateLimiter
}

// NewHandler creates a new handler
func NewHandler(cfg *config.Config) *Handler {
	return &Handler{
		config:        cfg,
		trading:      services.NewTradingService(),
		marketData:   services.NewMarketDataService(),
		auth:        middleware.NewAuthMiddleware(cfg),
		rateLimiter: middleware.NewRateLimiter(&cfg.RateLimit),
	}
}

// ============================================================================
// COMMON RESPONSE HELPERS
// ============================================================================

// respondWithJSON writes JSON response
func (h *Handler) respondWithJSON(w http.ResponseWriter, r *http.Request, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Response-Time", time.Now().Format(time.RFC3339))
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(models.NewSuccessResponse(data))
}

// respondWithError writes error response
func (h *Handler) respondWithError(w http.ResponseWriter, r *http.Request, statusCode int, err *models.APIError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(models.NewErrorResponse(err.Code, err.Message))
}

// parseQueryInt parses integer query parameter
func parseQueryInt(r *http.Request, key string, defaultValue int) int {
	value := r.URL.Query().Get(key)
	if value == "" {
		return defaultValue
	}
	i, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return i
}

// parseQueryInt64 parses int64 query parameter
func parseQueryInt64(r *http.Request, key string, defaultValue int64) int64 {
	value := r.URL.Query().Get(key)
	if value == "" {
		return defaultValue
	}
	i, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return defaultValue
	}
	return i
}

// parseQueryFloat parses float query parameter
func parseQueryFloat(r *http.Request, key string, defaultValue float64) float64 {
	value := r.URL.Query().Get(key)
	if value == "" {
		return defaultValue
	}
	f, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return defaultValue
	}
	return f
}

// ============================================================================
// MARKET DATA ENDPOINTS
// ============================================================================

// HandleExchangeInfo handles GET /api/v3/exchangeInfo
func (h *Handler) HandleExchangeInfo(w http.ResponseWriter, r *http.Request) {
	symbols, err := h.marketData.GetExchangeInfo(r.Context())
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, map[string]interface{}{
		"timezone":        "UTC",
		"serverTime":     time.Now().UnixMilli(),
		"exchangeFilters": []interface{}{},
		"symbols":       symbols,
	})
}

// HandlePrice handles GET /api/v3/ticker/price
func (h *Handler) HandlePrice(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	price, err := h.marketData.GetPrice(r.Context(), symbol)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, map[string]string{
		"symbol": symbol,
		"price":  fmt.Sprintf("%.8f", price),
	})
}

// HandleBookTicker handles GET /api/v3/ticker/bookTicker
func (h *Handler) HandleBookTicker(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	ticker, err := h.marketData.GetBookTicker(r.Context(), symbol)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, ticker)
}

// Handle24hTicker handles GET /api/v3/ticker/24hr
func (h *Handler) Handle24hTicker(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")

	if symbol == "" {
		// Return all tickers
		tickers, err := h.marketData.GetAllTickers(r.Context())
		if err != nil {
			h.respondWithError(w, r, 400, err.(*models.APIError))
			return
		}
		h.respondWithJSON(w, r, 200, tickers)
		return
	}

	ticker, err := h.marketData.Get24hTicker(r.Context(), symbol)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, ticker)
}

// HandleDepth handles GET /api/v3/depth
func (h *Handler) HandleDepth(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	limit := parseQueryInt(r, "limit", 100)
	depth, err := h.marketData.GetDepth(r.Context(), symbol, limit)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, depth)
}

// HandleTrades handles GET /api/v3/trades
func (h *Handler) HandleTrades(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	limit := parseQueryInt(r, "limit", 500)
	trades, err := h.marketData.GetRecentTrades(r.Context(), symbol, limit)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, trades)
}

// HandleKlines handles GET /api/v3/klines
func (h *Handler) HandleKlines(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1m"
	}

	limit := parseQueryInt(r, "limit", 500)
	startTime := parseQueryInt64(r, "startTime", 0)
	endTime := parseQueryInt64(r, "endTime", 0)

	klines, err := h.marketData.GetKlines(r.Context(), symbol, interval, startTime, endTime, limit)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	// Convert to array format
	var result [][]interface{}
	for _, k := range klines {
		result = append(result, []interface{}{
			k.OpenTime,
			fmt.Sprintf("%.8f", k.Open),
			fmt.Sprintf("%.8f", k.High),
			fmt.Sprintf("%.8f", k.Low),
			fmt.Sprintf("%.8f", k.Close),
			fmt.Sprintf("%.8f", k.Volume),
			k.CloseTime,
			fmt.Sprintf("%.f", k.QuoteVolume),
			k.NumTrades,
			fmt.Sprintf("%.8f", k.TakerBaseVol),
			fmt.Sprintf("%.8f", k.TakerQuoteVol),
			0,
		})
	}

	h.respondWithJSON(w, r, 200, result)
}

// HandleAvgPrice handles GET /api/v3/avgPrice
func (h *Handler) HandleAvgPrice(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	minutes := parseQueryInt(r, "minutes", 5)
	price, err := h.marketData.GetAvgPrice(r.Context(), symbol, minutes)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, map[string]interface{}{
		"mins":  minutes,
		"price": fmt.Sprintf("%.8f", price),
	})
}

// ============================================================================
// ACCOUNT ENDPOINTS
// ============================================================================

// HandleAccount handles GET /api/v3/account
func (h *Handler) HandleAccount(w http.ResponseWriter, r *http.Request) {
	userID := h.getUserID(r)

	account := &models.Account{
		MakerCommission:  0.001,
		TakerCommission: 0.001,
		BuyerCommission: 0.0,
		SellerCommission: 0.0,
		CanTrade:        true,
		CanWithdraw:    true,
		CanDeposit:     true,
		Balances: []models.Balance{
			{Asset: "BTC", Free: 1.5, Locked: 0.5},
			{Asset: "USDT", Free: 10000.0, Locked: 5000.0},
			{Asset: "ETH", Free: 10.0, Locked: 2.0},
		},
		AccountType: "SPOT",
	}

	h.respondWithJSON(w, r, 200, account)
}

// HandleMyTrades handles GET /api/v3/myTrades
func (h *Handler) HandleMyTrades(w http.ResponseWriter, r *http.Request) {
	userID := h.getUserID(r)
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	limit := parseQueryInt(r, "limit", 500)
	startTime := parseQueryInt64(r, "startTime", 0)
	endTime := parseQueryInt64(r, "endTime", 0)

	filters := &services.TradeFilters{
		Symbol:    symbol,
		StartTime: startTime,
		EndTime:  endTime,
		Limit:    limit,
	}

	trades, err := h.trading.GetTrades(r.Context(), userID, filters)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, trades)
}

// ============================================================================
// ORDER ENDPOINTS
// ============================================================================

// HandleOrder handles order operations
func (h *Handler) HandleOrder(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		h.handleGetOrder(w, r)
	case "POST":
		h.handleCreateOrder(w, r)
	case "DELETE":
		h.handleCancelOrder(w, r)
	default:
		h.respondWithError(w, r, 405, &models.APIError{Code: 405, Message: "Method not allowed"})
	}
}

func (h *Handler) handleGetOrder(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("orderId")
	if orderID == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "orderId is required"})
		return
	}

	order, err := h.trading.GetOrder(r.Context(), orderID)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	if order == nil {
		h.respondWithJSON(w, r, 200, nil)
		return
	}

	h.respondWithJSON(w, r, 200, order)
}

func (h *Handler) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	userID := h.getUserID(r)

	// Parse request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Invalid request body"})
		return
	}

	var req services.CreateOrderRequest
	if err := json.Unmarshal(body, &req); err != nil {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Invalid JSON"})
		return
	}

	req.UserID = userID

	order, err := h.trading.CreateOrder(r.Context(), &req)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 201, order)
}

func (h *Handler) handleCancelOrder(w http.ResponseWriter, r *http.Request) {
	userID := h.getUserID(r)
	orderID := r.URL.Query().Get("orderId")
	if orderID == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "orderId is required"})
		return
	}

	order, err := h.trading.CancelOrder(r.Context(), orderID, userID)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, order)
}

// HandleOpenOrders handles GET /api/v3/openOrders
func (h *Handler) HandleOpenOrders(w http.ResponseWriter, r *http.Request) {
	userID := h.getUserID(r)
	symbol := r.URL.Query().Get("symbol")

	filters := &services.OrderFilters{
		Status: string(models.OrderStatusNew),
		Symbol: symbol,
	}

	orders, err := h.trading.GetOrders(r.Context(), userID, filters)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, orders)
}

// HandleAllOrders handles GET /api/v3/allOrders
func (h *Handler) HandleAllOrders(w http.ResponseWriter, r *http.Request) {
	userID := h.getUserID(r)
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		h.respondWithError(w, r, 400, &models.APIError{Code: 400, Message: "Symbol is required"})
		return
	}

	limit := parseQueryInt(r, "limit", 500)
	startTime := parseQueryInt64(r, "startTime", 0)
	endTime := parseQueryInt64(r, "endTime", 0)

	filters := &services.OrderFilters{
		Symbol:    symbol,
		StartTime: startTime,
		EndTime:  endTime,
		Limit:    limit,
	}

	orders, err := h.trading.GetOrders(r.Context(), userID, filters)
	if err != nil {
		h.respondWithError(w, r, 400, err.(*models.APIError))
		return
	}

	h.respondWithJSON(w, r, 200, orders)
}

// ============================================================================
// USER ID HELPER
// ============================================================================

func (h *Handler) getUserID(r *http.Request) string {
	// Try to get from context (set by auth middleware)
	if userID := r.Context().Value(middleware.ContextKeyUserID); userID != nil {
		return userID.(string)
	}
	// Default user for testing
	return "default_user"
}

// ============================================================================
// UTILITY ENDPOINTS
// ============================================================================

// HandlePing handles GET /api/v3/ping
func (h *Handler) HandlePing(w http.ResponseWriter, r *http.Request) {
	h.respondWithJSON(w, r, 200, map[string]bool{})
}

// HandleTime handles GET /api/v3/time
func (h *Handler) HandleTime(w http.ResponseWriter, r *http.Request) {
	h.respondWithJSON(w, r, 200, map[string]int64{
		"serverTime": time.Now().UnixMilli(),
	})
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

// HandleHealth handles GET /health
func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	h.respondWithJSON(w, r, 200, map[string]string{
		"status":    "healthy",
		"service":  "rest-api-gateway",
		"version":  "1.0.0",
	})
}

// ============================================================================
// ROUTER
// ============================================================================

// Router creates HTTP handler
func (h *Handler) Router() http.Handler {
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", h.HandleHealth)

	// Market Data
	mux.HandleFunc("/api/v3/ping", h.HandlePing)
	mux.HandleFunc("/api/v3/time", h.HandleTime)
	mux.HandleFunc("/api/v3/exchangeInfo", h.HandleExchangeInfo)
	mux.HandleFunc("/api/v3/ticker/price", h.HandlePrice)
	mux.HandleFunc("/api/v3/ticker/bookTicker", h.HandleBookTicker)
	mux.HandleFunc("/api/v3/ticker/24hr", h.Handle24hTicker)
	mux.HandleFunc("/api/v3/depth", h.HandleDepth)
	mux.HandleFunc("/api/v3/trades", h.HandleTrades)
	mux.HandleFunc("/api/v3/klines", h.HandleKlines)
	mux.HandleFunc("/api/v3/avgPrice", h.HandleAvgPrice)

	// Account
	mux.HandleFunc("/api/v3/account", h.HandleAccount)
	mux.HandleFunc("/api/v3/myTrades", h.HandleMyTrades)

	// Orders
	mux.HandleFunc("/api/v3/order", h.HandleOrder)
	mux.HandleFunc("/api/v3/openOrders", h.HandleOpenOrders)
	mux.HandleFunc("/api/v3/allOrders", h.HandleAllOrders)

	// Rate limiting middleware
	if h.config.RateLimit.Enabled {
		return rateLimitMiddleware(h.rateLimiter, mux)
	}

	return mux
}

func rateLimitMiddleware(rl *middleware.RateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get client key (API key or IP)
		key := r.Header.Get("X-API-Key")
		if key == "" {
			key = r.RemoteAddr
		}

		allowed, resp := rl.Allow(key)
		if !allowed {
			h := w.(http.Hijacker)
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(resp)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ParseRequestBody parses JSON request body
func ParseRequestBody(r *http.Request, v interface{}) error {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("failed to read request body: %w", err)
	}

	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}

	return nil
}

// ExtractToken extracts bearer token from Authorization header
func ExtractToken(authHeader string) string {
	if authHeader == "" {
		return ""
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return ""
	}

	if strings.ToLower(parts[0]) != "bearer" {
		return ""
	}

	return parts[1]
}

// GetContextWithTimeout creates context with timeout
func GetContextWithTimeout(timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), timeout)
}