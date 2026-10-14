// TigerEx REST API v2 - Production Exchange API
package rest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

// Config - Server Configuration
type Config struct {
	Port            int           `mapstructure:"port"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout"`
	IdleTimeout     time.Duration `mapstructure:"idle_timeout"`
	MaxHeaderBytes int           `mapstructure:"max_header_bytes"`
	RateLimit       int           `mapstructure:"rate_limit"`
	RateLimitBurst  int           `mapstructure:"rate_limit_burst"`
	EnableTLS       bool          `mapstructure:"enable_tls"`
	JWTSecret       string        `mapstructure:"jwt_secret"`
	JWTExpiry       time.Duration `mapstructure:"jwt_expiry"`
	EnableCORS      bool          `mapstructure:"enable_cors"`
	AllowedOrigins []string      `mapstructure:"allowed_origins"`
}

func DefaultConfig() *Config {
	return &Config{
		Port:            8443,
		ReadTimeout:     30 * time.Second,
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 4096,
		RateLimit:      100,
		RateLimitBurst: 200,
		EnableTLS:      false,
		JWTSecret:      os.Getenv("TIGEREX_JWT_SECRET"),
		JWTExpiry:     15 * time.Minute,
		EnableCORS:    false,
		AllowedOrigins: nil,
	}
}

func generateSecureSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Server - Main Server Structure
type Server struct {
	config    *Config
	router   *gin.Engine
	httpServer *http.Server
	stopCh   chan struct{}
	wg       sync.WaitGroup
	startedAt time.Time
	status   atomic.Int32
}

func NewServer(cfg *Config) *Server {
	if cfg == nil {
		cfg = DefaultConfig()
	}
	s := &Server{
		config:    cfg,
		stopCh:   make(chan struct{}),
		startedAt: time.Now(),
	}
	s.initRouter()
	return s
}

func (s *Server) initRouter() {
	gin.SetMode(gin.ReleaseMode)
	s.router = gin.New()
	s.router.Use(gin.Recovery())
	s.router.Use(gin.Logger())
	s.router.Use(s.securityMiddleware())
	s.router.Use(s.rateLimitMiddleware())
	if s.config.EnableCORS {
		s.router.Use(s.corsMiddleware())
	}
	s.loadRoutes()
}

func (s *Server) loadRoutes() {
	// Health
	s.router.GET("/health", s.handleHealth())
	s.router.GET("/ready", s.handleReady())

	// API v1
	v1 := s.router.Group("/api/v1")
	{
		v1.GET("/markets", s.GetMarkets())
		v1.GET("/ticker/:symbol", s.GetTicker())
		v1.GET("/orderbook/:symbol", s.GetOrderBook())
		v1.GET("/klines/:symbol", s.GetKlines())
		v1.GET("/trades/:symbol", s.GetRecentTrades())
	}

	// API v2 - Public
	v2 := s.router.Group("/api/v2")
	{
		v2.GET("/exchangeInfo", s.GetExchangeInfo())
		v2.GET("/depth/:symbol", s.GetDepth())
		v2.GET("/trades/historical", s.GetHistoricalTrades())
		v2.GET("/aggTrades", s.GetAggTrades())
		v2.GET("/ticker/price", s.GetTickerPrice())
		v2.GET("/ticker/book", s.GetBookTicker())
		v2.GET("/ticker/24hr", s.Get24hrTicker())

		// Protected
		protected := v2.Group("")
		protected.Use(s.authRequired())
		{
			protected.GET("/account", s.GetAccount())
			protected.GET("/account/balances", s.GetBalances())
			protected.POST("/order", s.PlaceOrder())
			protected.GET("/order", s.GetOrder())
			protected.DELETE("/order", s.CancelOrder())
			protected.GET("/order/open", s.GetOpenOrders())
			protected.GET("/order/history", s.GetOrderHistory())
			protected.GET("/myTrades", s.GetMyTrades())

			// Advanced orders
			protected.POST("/order/oco", s.PlaceOCOOrder())
			protected.POST("/order/trailing", s.PlaceTrailingStopOrder())
			protected.POST("/order/iceberg", s.PlaceIcebergOrder())
			protected.POST("/order/twap", s.PlaceTWAPOrder())
			protected.POST("/order/batch", s.PlaceBatchOrders())

			// Futures
			protected.GET("/fapi/v1/account", s.GetFuturesAccount())
			protected.GET("/fapi/v1/position", s.GetPosition())
			protected.POST("/fapi/v1/order", s.PlaceFuturesOrder())
			protected.DELETE("/fapi/v1/order", s.CancelFuturesOrder())
			protected.POST("/fapi/v1/leverage", s.SetLeverage())
			protected.POST("/fapi/v1/marginType", s.SetMarginType())
			protected.GET("/fapi/v1/fundingRate", s.GetFundingRate())
			protected.GET("/fapi/v1/openInterest", s.GetOpenInterest())

			// COIN-M Futures
			protected.GET("/dapi/v1/account", s.GetCoinFuturesAccount())
			protected.POST("/dapi/v1/order", s.PlaceCoinFuturesOrder())
			protected.DELETE("/dapi/v1/order", s.CancelCoinFuturesOrder())
			protected.POST("/dapi/v1/leverage", s.SetCoinLeverage())

			// Options
			protected.GET("/options/v1/account", s.GetOptionsAccount())
			protected.GET("/options/v1/position", s.GetOptionsPosition())
			protected.POST("/options/v1/order", s.PlaceOptionsOrder())
			protected.DELETE("/options/v1/order", s.CancelOptionsOrder())

			// Margin
			protected.GET("/sapi/v1/margin/account", s.GetMarginAccount())
			protected.POST("/sapi/v1/margin/transfer", s.MarginTransfer())
			protected.POST("/sapi/v1/margin/loan", s.ApplyMarginLoan())
			protected.POST("/sapi/v1/margin/repay", s.RepayMarginLoan())
			protected.POST("/sapi/v1/margin/order", s.PlaceMarginOrder())
			protected.DELETE("/sapi/v1/margin/order", s.CancelMarginOrder())

			// Wallet
			protected.GET("/sapi/v1/capital/deposit/address", s.GetDepositAddress())
			protected.POST("/sapi/v1/capital/withdraw/apply", s.ApplyWithdraw())
			protected.GET("/sapi/v1/capital/withdraw/history", s.GetWithdrawHistory())
			protected.GET("/sapi/v1/capital/deposit/history", s.GetDepositHistory())
			protected.POST("/sapi/v1/capital/transfer", s.Transfer())
			protected.GET("/sapi/v1/capital/balance", s.GetCapitalBalance())

			// Staking
			protected.GET("/sapi/v1/staking/product", s.GetStakingProducts())
			protected.POST("/sapi/v1/staking/subscribe", s.SubscribeStaking())
			protected.GET("/sapi/v1/staking/position", s.GetStakingPosition())
			protected.POST("/sapi/v1/staking/redeem", s.RedeemStaking())
			protected.POST("/sapi/v1/eth/staking", s.DoETHStaking())
			protected.POST("/sapi/v1/eth/staking/redeem", s.RedeemETHStaking())
			protected.GET("/sapi/v1/eth/staking", s.GetETHStaking())

			// Earn
			protected.GET("/sapi/v1/earn/product", s.GetEarnProducts())
			protected.POST("/sapi/v1/earn/subscribe", s.SubscribeEarn())
			protected.GET("/sapi/v1/earn/position", s.GetEarnPosition())
			protected.POST("/sapi/v1/earn/redeem", s.RedeemEarn())

			// Lending
			protected.GET("/sapi/v1/lending/product", s.GetLendingProducts())
			protected.POST("/sapi/v1/lending/subscribe", s.SubscribeLending())
			protected.GET("/sapi/v1/lending/account", s.GetLendingAccount())
			protected.POST("/sapi/v1/lending/redeem", s.RedeemLending())

			// Sub-account
			protected.GET("/sapi/v2/sub-account/list", s.ListSubAccounts())
			protected.POST("/sapi/v2/sub-account/create", s.CreateSubAccount())
			protected.POST("/sapi/v2/sub-account/transfer", s.TransferSubAccount())
			protected.GET("/sapi/v2/sub-account/balances", s.GetSubAccountBalances())

			// Copy trading
			protected.GET("/sapi/v1/copytrading/orders", s.GetCopyTradingOrders())
			protected.POST("/sapi/v1/copytrading/order", s.PlaceCopyTradingOrder())
			protected.DELETE("/sapi/v1/copytrading/order", s.CancelCopyTradingOrder())
			protected.GET("/sapi/v1/copytrading/openOrders", s.GetCopyTradingOpenOrders())
			protected.GET("/sapi/v1/copytrading/positions", s.GetCopyTradingPositions())

			// Trading bot
			protected.GET("/sapi/v1/tradingbot/orders", s.GetBotOrders())
			protected.POST("/sapi/v1/tradingbot/order", s.PlaceBotOrder())
			protected.DELETE("/sapi/v1/tradingbot/order", s.CancelBotOrder())
			protected.GET("/sapi/v1/tradingbot/openOrders", s.GetBotOpenOrders())
			protected.GET("/sapi/v1/tradingbot/positions", s.GetBotPositions())
			protected.POST("/sapi/v1/tradingbot/stop", s.StopBot())
			protected.POST("/sapi/v1/tradingbot/pause", s.PauseBot())
			protected.POST("/sapi/v1/tradingbot/resume", s.ResumeBot())
		}

		// WebSocket
		ws := s.router.Group("/ws")
		ws.Use(s.authOptional())
		{
			ws.GET("/stream", s.HandleWebSocket())
			ws.GET("/futures", s.HandleFuturesWebSocket())
			ws.GET("/delivery", s.HandleDeliveryWebSocket())
			ws.GET("/options", s.HandleOptionsWebSocket())
			ws.GET("/spot", s.HandleSpotWebSocket())
		}

		// API v3
		v3 := s.router.Group("/api/v3")
		{
			v3.GET("/ping", s.Ping())
			v3.GET("/time", s.GetServerTime())
			v3.GET("/exchangeInfo", s.GetExchangeInfoV3())
			v3.GET("/depth/:symbol", s.GetDepthV3())
			v3.GET("/trades/:symbol", s.GetTradesV3())
			v3.GET("/klines/:symbol", s.GetKlinesV3())
			v3.GET("/ticker/price", s.GetTickerPriceV3())
			v3.GET("/ticker/book", s.GetBookTickerV3())
			v3.GET("/ticker/24hr", s.Get24hrTickerV3())
		}

		// Admin
		admin := s.router.Group("/admin/api")
		admin.Use(s.adminAuthRequired())
		{
			admin.GET("/ping", s.AdminPing())
			admin.GET("/stats", s.AdminStats())
			admin.GET("/exchangeInfo", s.AdminExchangeInfo())
		}
	}

	s.router.GET("/api", s.handleAPIInfo())
}

func (s *Server) Start() error {
	s.httpServer = &http.Server{
		Addr:           fmt.Sprintf(":%d", s.config.Port),
		Handler:        s.router,
		ReadTimeout:   s.config.ReadTimeout,
		WriteTimeout:  s.config.WriteTimeout,
		IdleTimeout:    s.config.IdleTimeout,
		MaxHeaderBytes: s.config.MaxHeaderBytes,
	}

	s.status.Store(1)
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Server error: %v", err)
		}
	}()

	log.Printf("Server started on port %d", s.config.Port)
	return nil
}

func (s *Server) Stop() error {
	s.status.Store(0)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			return err
		}
	}
	log.Println("Server stopped")
	return nil
}

// Middleware
func (s *Server) securityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Next()
	}
}

func (s *Server) rateLimitMiddleware() gin.HandlerFunc {
	limiter := rate.NewLimiter(rate.Limit(s.config.RateLimit), s.config.RateLimitBurst)
	return func(c *gin.Context) {
		if c.Request.URL.Path == "/health" || c.Request.URL.Path == "/ready" {
			c.Next()
			return
		}
		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": gin.H{"code": 429, "message": "Too many requests"}})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allowed := false
		for _, candidate := range s.config.AllowedOrigins {
			if candidate != "" && candidate != "*" && origin == candidate {
				allowed = true
				break
			}
		}
		if origin != "" && allowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-API-Key")
		} else if origin != "" {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if c.Request.Method == http.MethodOptions {
			if !allowed {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func (s *Server) authRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		if len(s.config.JWTSecret) < 32 {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Authentication is unavailable: a stable JWT secret of at least 32 characters is not configured"}})
			c.Abort()
			return
		}
		token := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(token, "Bearer ") || len(strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))) == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
			c.Abort()
			return
		}
		parsedToken, err := jwt.Parse(strings.TrimSpace(strings.TrimPrefix(token, "Bearer ")), func(token *jwt.Token) (interface{}, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(s.config.JWTSecret), nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
		if err != nil || parsedToken == nil || !parsedToken.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
			c.Abort()
			return
		}
		claims, ok := parsedToken.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token claims"}})
			c.Abort()
			return
		}
		userID, ok := claims["user_id"].(string)
		if !ok || strings.TrimSpace(userID) == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Missing user identity"}})
			c.Abort()
			return
		}
		c.Set("user_id", userID)
		c.Next()
	}
}

func (s *Server) authOptional() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Optional authentication never upgrades an unverified token into an identity.
		token := strings.TrimSpace(c.GetHeader("Authorization"))
		if token != "" && len(s.config.JWTSecret) >= 32 && strings.HasPrefix(token, "Bearer ") {
			parsed, err := jwt.Parse(strings.TrimSpace(strings.TrimPrefix(token, "Bearer ")), func(t *jwt.Token) (interface{}, error) {
				if t.Method != jwt.SigningMethodHS256 {
					return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
				}
				return []byte(s.config.JWTSecret), nil
			}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
			if err == nil && parsed != nil && parsed.Valid {
				if claims, ok := parsed.Claims.(jwt.MapClaims); ok {
					if userID, ok := claims["user_id"].(string); ok && strings.TrimSpace(userID) != "" {
						c.Set("user_id", userID)
					}
				}
			}
		}
		c.Next()
	}
}

func (s *Server) adminAuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Presence of an API key is not authentication. This legacy service has no
		// persistent verifier, scope model, or rotation/revocation store configured.
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Admin authentication unavailable: API-key verification is not configured"}})
		c.Abort()
	}
}

// Market Data
func unavailableMarketData() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error": gin.H{
				"code": 503,
				"message": "Market data unavailable: no verified market-data provider is configured",
			},
		})
	}
}

var mockMarkets = map[string]struct {
	BaseAsset  string
	QuoteAsset string
	Status     string
}{
	"BTCUSDT": {BaseAsset: "BTC", QuoteAsset: "USDT", Status: "TRADING"},
	"ETHUSDT": {BaseAsset: "ETH", QuoteAsset: "USDT", Status: "TRADING"},
	"BNBUSDT": {BaseAsset: "BNB", QuoteAsset: "USDT", Status: "TRADING"},
	"SOLUSDT": {BaseAsset: "SOL", QuoteAsset: "USDT", Status: "TRADING"},
	"XRPUSDT": {BaseAsset: "XRP", QuoteAsset: "USDT", Status: "TRADING"},
	"ADAUSDT": {BaseAsset: "ADA", QuoteAsset: "USDT", Status: "TRADING"},
	"DOGEUSDT": {BaseAsset: "DOGE", QuoteAsset: "USDT", Status: "TRADING"},
}

func (s *Server) GetExchangeInfo() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetExchangeInfoV3() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetDepth() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetDepthV3() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetMarkets() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetTicker() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetOrderBook() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetKlines() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetKlinesV3() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetRecentTrades() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetTradesV3() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetHistoricalTrades() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetAggTrades() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetTickerPrice() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetTickerPriceV3() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetBookTicker() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) GetBookTickerV3() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) Get24hrTicker() gin.HandlerFunc {
	return unavailableMarketData()
}

func (s *Server) Get24hrTickerV3() gin.HandlerFunc {
	return unavailableMarketData()
}

// Health
func (s *Server) handleHealth() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"status": "ok", "uptime": time.Since(s.startedAt).String(), "version": "2.0.0", "go_version": runtime.Version()}})
	}
}

func (s *Server) handleReady() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"status": "ready"}})
	}
}

func (s *Server) handleAPIInfo() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"version": "v1", "api_version": "1.0", "server_time": time.Now().UnixMilli(), "exchange_name": "TigerEx"}})
	}
}

func (s *Server) Ping() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": "pong"})
	}
}

func (s *Server) GetServerTime() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"serverTime": time.Now().UnixMilli()}})
	}
}

// Account
func (s *Server) GetAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"makerCommission": 10, "takerCommission": 10, "canTrade": true, "canWithdraw": true, "canDeposit": true}})
	}
}

func (s *Server) GetBalances() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{{"asset": "BTC", "free": "1.0", "locked": "0.0"}, {"asset": "ETH", "free": "10.0", "locked": "0.0"}, {"asset": "USDT", "free": "10000.0", "locked": "0.0"}}})
	}
}

// Orders
func (s *Server) PlaceOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Symbol    string `json:"symbol" binding:"required"`
			Side      string `json:"side" binding:"required,oneof=BUY SELL"`
			Type      string `json:"type" binding:"required,oneof=LIMIT MARKET STOP_LIMIT STOP_MARKET"`
			Quantity  string `json:"quantity" binding:"required"`
			Price     string `json:"price"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"symbol": req.Symbol, "orderId": uuid.New().String(), "side": req.Side, "type": req.Type, "status": "NEW"}})
	}
}

func (s *Server) GetOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{}})
	}
}

func (s *Server) CancelOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"status": "CANCELED"}})
	}
}

func (s *Server) GetOpenOrders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) GetOrderHistory() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) GetMyTrades() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

// Advanced Orders
func (s *Server) PlaceOCOOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderListId": uuid.New().String(), "orderListStatus": "EXECUTING"}})
	}
}

func (s *Server) PlaceTrailingStopOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String(), "type": "TRAILING_STOP", "status": "NEW"}})
	}
}

func (s *Server) PlaceIcebergOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String(), "type": "LIMIT", "status": "NEW"}})
	}
}

func (s *Server) PlaceTWAPOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String(), "type": "TWAP", "status": "NEW"}})
	}
}

func (s *Server) PlaceBatchOrders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{{"orderId": uuid.New().String()}}})
	}
}

// Futures
func (s *Server) GetFuturesAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"feeTier": 5, "canTrade": true, "totalMargin": "10000.00"}})
	}
}

func (s *Server) GetPosition() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) PlaceFuturesOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String(), "status": "NEW"}})
	}
}

func (s *Server) CancelFuturesOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"status": "CANCELED"}})
	}
}

func (s *Server) SetLeverage() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"code": 200, "msg": "success"}})
	}
}

func (s *Server) SetMarginType() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"code": 200, "msg": "success"}})
	}
}

func (s *Server) GetFundingRate() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"symbol": "BTCUSDT", "fundingRate": "0.0001", "nextFundingTime": time.Now().Add(8*time.Hour).UnixMilli()}})
	}
}

func (s *Server) GetOpenInterest() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"symbol": "BTCUSDT", "openInterest": "500000.00"}})
	}
}

// COIN-M Futures
func (s *Server) GetCoinFuturesAccount() gin.HandlerFunc  { return s.GetFuturesAccount() }
func (s *Server) PlaceCoinFuturesOrder() gin.HandlerFunc { return s.PlaceFuturesOrder() }
func (s *Server) CancelCoinFuturesOrder() gin.HandlerFunc { return s.CancelFuturesOrder() }
func (s *Server) SetCoinLeverage() gin.HandlerFunc { return s.SetLeverage() }

// Options
func (s *Server) GetOptionsAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"free": "100.00", "locked": "0.00"}})
	}
}

func (s *Server) GetOptionsPosition() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) PlaceOptionsOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String(), "status": "NEW"}})
	}
}

func (s *Server) CancelOptionsOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"status": "CANCELED"}})
	}
}

// Margin
func (s *Server) GetMarginAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"marginLevel": "10.00", "totalMargin": "10000.00"}})
	}
}

func (s *Server) MarginTransfer() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"tranId": uuid.New().String()}})
	}
}

func (s *Server) ApplyMarginLoan() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"tranId": uuid.New().String()}})
	}
}

func (s *Server) RepayMarginLoan() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"tranId": uuid.New().String()}})
	}
}

func (s *Server) PlaceMarginOrder() gin.HandlerFunc { return s.PlaceOrder() }
func (s *Server) CancelMarginOrder() gin.HandlerFunc { return s.CancelOrder() }

// Wallet
func (s *Server) GetDepositAddress() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"address": "0x" + randomHex(40), "tag": ""}})
	}
}

func (s *Server) ApplyWithdraw() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"id": uuid.New().String(), "status": "pending"}})
	}
}

func (s *Server) GetWithdrawHistory() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) GetDepositHistory() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) Transfer() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"tranId": uuid.New().String()}})
	}
}

func (s *Server) GetCapitalBalance() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{{"coin": "BTC", "free": "1.0"}, {"coin": "USDT", "free": "10000.0"}}})
	}
}

// Staking
func (s *Server) GetStakingProducts() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{{"poolId": "ETH2", "poolName": "ETH 2.0", "asset": "ETH", "apy": 5.0}}})
	}
}

func (s *Server) SubscribeStaking() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"positionId": uuid.New().String()}})
	}
}

func (s *Server) GetStakingPosition() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) RedeemStaking() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"positionId": uuid.New().String()}})
	}
}

func (s *Server) DoETHStaking() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"validatorPubkey": randomHex(96), "txHash": randomHex(64)}})
	}
}

func (s *Server) RedeemETHStaking() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"txHash": randomHex(64)}})
	}
}

func (s *Server) GetETHStaking() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"totalStaked": "10000.00", "validatorCount": 100, "apr": 5.0}})
	}
}

// Earn
func (s *Server) GetEarnProducts() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{{"asset": "USDT", "apy": 10.0}}})
	}
}

func (s *Server) SubscribeEarn() gin.HandlerFunc { return s.SubscribeStaking() }
func (s *Server) GetEarnPosition() gin.HandlerFunc { return s.GetStakingPosition() }
func (s *Server) RedeemEarn() gin.HandlerFunc { return s.RedeemStaking() }

// Lending
func (s *Server) GetLendingProducts() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) SubscribeLending() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"id": uuid.New().String()}})
	}
}

func (s *Server) GetLendingAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"asset": "USDT", "lendFree": "10000.00"}})
	}
}

func (s *Server) RedeemLending() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"id": uuid.New().String()}})
	}
}

// Sub-account
func (s *Server) ListSubAccounts() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) CreateSubAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"email": "sub@" + randomHex(8) + ".example.com", "uid": uuid.New().String()}})
	}
}

func (s *Server) TransferSubAccount() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"tranId": uuid.New().String()}})
	}
}

func (s *Server) GetSubAccountBalances() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

// Copy Trading
func (s *Server) GetCopyTradingOrders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) PlaceCopyTradingOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String()}})
	}
}

func (s *Server) CancelCopyTradingOrder() gin.HandlerFunc { return s.CancelOrder() }
func (s *Server) GetCopyTradingOpenOrders() gin.HandlerFunc { return s.GetOpenOrders() }
func (s *Server) GetCopyTradingPositions() gin.HandlerFunc { return s.GetPosition() }

// Trading Bot
func (s *Server) GetBotOrders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": []gin.H{}})
	}
}

func (s *Server) PlaceBotOrder() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"orderId": uuid.New().String()}})
	}
}

func (s *Server) CancelBotOrder() gin.HandlerFunc { return s.CancelOrder() }
func (s *Server) GetBotOpenOrders() gin.HandlerFunc { return s.GetOpenOrders() }
func (s *Server) GetBotPositions() gin.HandlerFunc { return s.GetPosition() }

func (s *Server) StopBot() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"code": 200, "msg": "success"}})
	}
}

func (s *Server) PauseBot() gin.HandlerFunc { return s.StopBot() }
func (s *Server) ResumeBot() gin.HandlerFunc { return s.StopBot() }

// WebSocket
var wsUpgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (s *Server) HandleWebSocket() gin.HandlerFunc {
	return func(c *gin.Context) {
		conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("WebSocket upgrade error: %v", err)
			return
		}
		defer conn.Close()
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if mt == websocket.TextMessage {
				conn.WriteMessage(websocket.TextMessage, []byte(`{"e":"heartbeat"}`))
			}
		}
	}
}

func (s *Server) HandleFuturesWebSocket() gin.HandlerFunc { return s.HandleWebSocket() }
func (s *Server) HandleDeliveryWebSocket() gin.HandlerFunc { return s.HandleWebSocket() }
func (s *Server) HandleOptionsWebSocket() gin.HandlerFunc { return s.HandleWebSocket() }
func (s *Server) HandleSpotWebSocket() gin.HandlerFunc { return s.HandleWebSocket() }

// Admin
func (s *Server) AdminPing() gin.HandlerFunc { return s.Ping() }
func (s *Server) AdminStats() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"totalUsers": 100000, "totalVolume": "1000000000.00"}})
	}
}
func (s *Server) AdminExchangeInfo() gin.HandlerFunc { return s.GetExchangeInfo() }

// Helpers
func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Main
func main() {
	cfg := DefaultConfig()
	cfg.Port = 8443
	server := NewServer(cfg)
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		server.Stop()
	}()
	if err := server.Start(); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
	log.Printf("TigerEx API v2 server running on port %d", cfg.Port)
	select {}
}
