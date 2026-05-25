package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"tigerex/backend/internal/handlers"
	"tigerex/backend/internal/middleware"
	"tigerex/backend/internal/services"
	"tigerex/backend/pkg/config"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Initialize services
	authService := services.NewAuthService(cfg)
	userService := services.NewUserService(cfg)
	tradeService := services.NewTradeService(cfg)
	walletService := services.NewWalletService(cfg)
	marketService := services.NewMarketService(cfg)

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(authService)
	userHandler := handlers.NewUserHandler(userService)
	tradeHandler := handlers.NewTradeHandler(tradeService)
	walletHandler := handlers.NewWalletHandler(walletService)
	marketHandler := handlers.NewMarketHandler(marketService)

	// Setup router
	router := setupRouter(cfg, authHandler, userHandler, tradeHandler, walletHandler, marketHandler)

	// Start server
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Printf("TigerEx API Gateway started on port %s", cfg.Port)
	log.Printf("WebSocket market data: ws://localhost:%s/ws/markets", cfg.Port)

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}
	log.Println("Server exited")
}

func setupRouter(
	cfg *config.Config,
	authHandler *handlers.AuthHandler,
	userHandler *handlers.UserHandler,
	tradeHandler *handlers.TradeHandler,
	walletHandler *handlers.WalletHandler,
	marketHandler *handlers.MarketHandler,
) *gin.Engine {
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())
	router.Use(middleware.CORS())
	router.Use(middleware.RateLimit())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Unix(),
		})
	})

	// API v1
	v1 := router.Group("/api/v1")
	{
		// Public endpoints
		v1.GET("/markets", marketHandler.GetMarkets)
		v1.GET("/markets/:symbol/ticker", marketHandler.GetTicker)
		v1.GET("/markets/:symbol/orderbook", marketHandler.GetOrderBook)
		v1.GET("/markets/:symbol/trades", marketHandler.GetRecentTrades)
		v1.GET("/klines", marketHandler.GetKlines)

		// Auth (public)
		v1.POST("/auth/register", authHandler.Register)
		v1.POST("/auth/login", authHandler.Login)
		v1.POST("/auth/refresh", authHandler.RefreshToken)

		// Protected endpoints
		protected := v1.Group("")
		protected.Use(middleware.JWTAuth(cfg.JWTSecret))
		{
			// User management
			protected.GET("/user/profile", userHandler.GetProfile)
			protected.PUT("/user/profile", userHandler.UpdateProfile)
			protected.POST("/user/kyc", userHandler.SubmitKYC)
			protected.GET("/user/verification", userHandler.GetVerificationStatus)

			// Trading
			protected.POST("/orders", tradeHandler.CreateOrder)
			protected.GET("/orders", tradeHandler.GetOrders)
			protected.GET("/orders/:orderId", tradeHandler.GetOrder)
			protected.DELETE("/orders/:orderId", tradeHandler.CancelOrder)
			protected.GET("/positions", tradeHandler.GetPositions)
			protected.GET("/trades", tradeHandler.GetTrades)

			// Wallet
			protected.GET("/wallets", walletHandler.GetWallets)
			protected.POST("/wallets/deposit", walletHandler.GetDepositAddress)
			protected.POST("/wallets/withdraw", walletHandler.Withdraw)
			protected.GET("/transactions", walletHandler.GetTransactions)
			protected.GET("/balance", walletHandler.GetBalance)
		}

		// WebSocket for real-time data
		ws := v1.Group("/ws")
		ws.Use(middleware.JWTAuth(cfg.JWTSecret))
		{
			ws.GET("/markets", marketHandler.HandleWebSocket)
			ws.GET("/trades", tradeHandler.HandleTradeWebSocket)
			ws.GET("/account", walletHandler.HandleAccountWebSocket)
		}
	}

	return router
}