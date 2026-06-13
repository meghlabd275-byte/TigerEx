package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// Config holds application configuration
type Config struct {
	Port        string
	MongoDBURI  string
	RateLimitMax int
	CORSOrigin  string
	AppName    string
}

// App represents the application
type App struct {
	Router *gin.Engine
	Server *http.Server
	Config *Config
}

// NewApp creates a new application
func NewApp() *App {
	cfg := &Config{
		Port:        getEnv("PORT", "8080"),
		MongoDBURI:  getEnv("MONGODB_URI", "mongodb://localhost:27017"),
		RateLimitMax: getEnvInt("RATE_LIMIT_MAX", 100),
		CORSOrigin: getEnv("CORS_ORIGIN", "*"),
		AppName:   getEnv("APP_NAME", "TigerEx"),
	}

	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.CORSOrigin},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	app := &App{
		Router: router,
		Config: cfg,
	}

	app.setupRoutes()
	app.setupServer()

	return app
}

func (a *App) setupRoutes() {
	r := a.Router

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":   "ok",
			"service": a.Config.AppName,
			"version": "1.0.0",
		})
	})

	// API v1 group
	v1 := r.Group("/api/v1")
	{
		// Auth routes
		auth := v1.Group("/auth")
		{
			auth.POST("/register", a.register)
			auth.POST("/login", a.login)
			auth.POST("/logout", a.logout)
			auth.POST("/refresh", a.refreshToken)
			auth.POST("/forgot-password", a.forgotPassword)
			auth.POST("/reset-password", a.resetPassword)
			auth.POST("/verify-email", a.verifyEmail)
		}

		// User routes (protected)
		users := v1.Group("/users")
		users.Use(a.authMiddleware())
		{
			users.GET("/me", a.getMe)
			users.PUT("/profile", a.updateProfile)
			users.PUT("/settings", a.updateSettings)
			users.POST("/2fa/enable", a.enable2FA)
			users.POST("/2fa/disable", a.disable2FA)
		}

		// Admin routes
		admin := v1.Group("/admin")
		admin.Use(a.authMiddleware())
		admin.Use(a.adminMiddleware())
		{
			admin.GET("/users", a.listUsers)
			admin.GET("/users/:id", a.getUser)
			admin.PUT("/users/:id/status", a.updateUserStatus)
			admin.DELETE("/users/:id", a.deleteUser)
			admin.GET("/stats", a.getStats)
		}

		// Wallet routes
		wallet := v1.Group("/wallet")
		wallet.Use(a.authMiddleware())
		{
			wallet.GET("/balance", a.getBalance)
			wallet.GET("/address", a.getDepositAddress)
			wallet.POST("/withdraw", a.withdraw)
			wallet.GET("/history", a.getTransactionHistory)
		}

		// Trading routes
		trading := v1.Group("/trading")
		trading.Use(a.authMiddleware())
		{
			trading.GET("/markets", a.listMarkets)
			trading.GET("/orderbook/:symbol", a.getOrderBook)
			trading.GET("/trades/:symbol", a.getRecentTrades)
			trading.POST("/order", a.placeOrder)
			trading.DELETE("/order/:id", a.cancelOrder)
			trading.PUT("/order/:id", a.modifyOrder)
			trading.GET("/orders", a.getOrders)
			trading.GET("/positions", a.getPositions)
		}
	}

	r.GET("/ws", a.handleWebSocket)
}

func (a *App) setupServer() {
	a.Server = &http.Server{
		Addr:         ":" + a.Config.Port,
		Handler:      a.Router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
}

func (a *App) Run() error {
	log.Printf("Starting %s on port %s", a.Config.AppName, a.Config.Port)

	go func() {
		if err := a.Server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := a.Server.Shutdown(ctx); err != nil {
		return err
	}

	log.Println("Server stopped")
	return nil
}

// Auth handlers
func (a *App) register(c *gin.Context) {
	type RegisterReq struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
		Username string `json:"username" binding:"required,min=3"`
	}
	var req RegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Registration successful"})
}

func (a *App) login(c *gin.Context) {
	type LoginReq struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	var req LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token":   "jwt_token",
		"refresh": "refresh_token",
		"expires": time.Now().Add(24 * time.Hour).Unix(),
	})
}

func (a *App) logout(c *gin.Context)    { c.JSON(http.StatusOK, gin.H{"message": "Logged out"}) }
func (a *App) refreshToken(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"token": "new_token"}) }
func (a *App) forgotPassword(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"message": "Reset email sent"}) }
func (a *App) resetPassword(c *gin.Context)  { c.JSON(http.StatusOK, gin.H{"message": "Password reset"}) }
func (a *App) verifyEmail(c *gin.Context)   { c.JSON(http.StatusOK, gin.H{"message": "Email verified"}) }

// User handlers
func (a *App) getMe(c *gin.Context)         { c.JSON(http.StatusOK, gin.H{"id": "user_123", "email": "user@example.com"}) }
func (a *App) updateProfile(c *gin.Context)  { c.JSON(http.StatusOK, gin.H{"message": "Profile updated"}) }
func (a *App) updateSettings(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"message": "Settings updated"}) }
func (a *App) enable2FA(c *gin.Context)      { c.JSON(http.StatusOK, gin.H{"secret": "2fa_secret"}) }
func (a *App) disable2FA(c *gin.Context)    { c.JSON(http.StatusOK, gin.H{"message": "2FA disabled"}) }

// Admin handlers
func (a *App) listUsers(c *gin.Context)        { c.JSON(http.StatusOK, gin.H{"users": []interface{}{}, "total": 0}) }
func (a *App) getUser(c *gin.Context)         { c.JSON(http.StatusOK, gin.H{"id": c.Param("id")}) }
func (a *App) updateUserStatus(c *gin.Context)  { c.JSON(http.StatusOK, gin.H{"status": "updated"}) }
func (a *App) deleteUser(c *gin.Context)      { c.JSON(http.StatusOK, gin.H{"deleted": true}) }
func (a *App) getStats(c *gin.Context)        { c.JSON(http.StatusOK, gin.H{"totalUsers": 0, "dailyVolume": "0"}) }

// Wallet handlers
func (a *App) getBalance(c *gin.Context)           { c.JSON(http.StatusOK, gin.H{"BTC": gin.H{"available": "0"}, "USDT": gin.H{"available": "0"}}) }
func (a *App) getDepositAddress(c *gin.Context)      { c.JSON(http.StatusOK, gin.H{"BTC": "bc1q...", "USDT": "0x..."}) }
func (a *App) withdraw(c *gin.Context)            { c.JSON(http.StatusOK, gin.H{"txid": "tx123"}) }
func (a *App) getTransactionHistory(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"transactions": []interface{}{}}) }

// Trading handlers
func (a *App) listMarkets(c *gin.Context)      { c.JSON(http.StatusOK, gin.H{"markets": []gin.H{{"symbol": "BTC/USDT", "price": "50000"}}}) }
func (a *App) getOrderBook(c *gin.Context)  { c.JSON(http.StatusOK, gin.H{"symbol": c.Param("symbol"), "bids": []interface{}{}, "asks": []interface{}{}}) }
func (a *App) getRecentTrades(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"trades": []interface{}{}}) }
func (a *App) placeOrder(c *gin.Context)    { c.JSON(http.StatusCreated, gin.H{"orderId": "ord123", "status": "new"}) }
func (a *App) cancelOrder(c *gin.Context)   { c.JSON(http.StatusOK, gin.H{"orderId": c.Param("id"), "status": "cancelled"}) }
func (a *App) modifyOrder(c *gin.Context)  { c.JSON(http.StatusOK, gin.H{"orderId": c.Param("id"), "status": "modified"}) }
func (a *App) getOrders(c *gin.Context)      { c.JSON(http.StatusOK, gin.H{"orders": []interface{}{}}) }
func (a *App) getPositions(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"positions": []interface{}{}}) }

func (a *App) handleWebSocket(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"message": "WebSocket endpoint"}) }

// Middleware
func (a *App) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Authorization") == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "No authorization"})
			c.Abort()
			return
		}
		c.Set("user_id", "user_123")
		c.Next()
	}
}

func (a *App) adminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) { c.Next() }
}

// Helpers
func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var i int
		if _, err := fmt.Sscanf(v, "%d", &i); err == nil {
			return i
		}
	}
	return def
}

func main() {
	app := NewApp()
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}