// TigerEx High-Performance Exchange API Server
//
// This is the main entry point for the TigerEx trading platform API.
// It provides REST and WebSocket endpoints for trading, wallet operations,
// KYC, and all exchange functionality.

package main

import (
	"context"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"tigerex-api/internal/api"
	"tigerex-api/internal/auth"
	"tigerex-api/internal/kyc"
	"tigerex-api/internal/security"
	"tigerex-api/internal/trading"
	"tigerex-api/internal/wallet"
)

// Config holds all configuration
type Config struct {
	Server struct {
		Port             string
		ReadTimeout      int
		WriteTimeout    int
		MaxHeaderBytes  int
		TLSEnabled     bool
		CertFile       string
		KeyFile        string
	}
	Database struct {
		Host     string
		Port     int
		User     string
		Password string
		DBName   string
		SSLMode  string
	}
	JWT struct {
		Secret          string
		AccessExpiry    int  // minutes
		RefreshExpiry   int  // days
	}
	RateLimit struct {
		RequestsPerMinute int
		Burst             int
	}
	Security struct {
		MaxLoginAttempts int
		LockoutDuration  int // minutes
		SessionExpiry    int // hours
	}
	Crypto struct {
		MasterKey string // hex-encoded 32 bytes
	}
}

var (
	config       *Config
	jwtSecret    []byte
	masterKey    [32]byte
	authService *auth.Service
	kycService   *kyc.Service
	walletSvc   *wallet.Service
	tradingSvc   *trading.Service
	securitySvc  *security.Service
)

// Initialize loads configuration
func init() {
	config = &Config{}
	config.Server.Port = getEnv("TIGEREX_PORT", "8443")
	config.Server.ReadTimeout = 30
	config.Server.WriteTimeout = 30
	config.Server.MaxHeaderBytes = 1 << 20
	config.Server.TLSEnabled = getEnvBool("TIGEREX_TLS_ENABLED", false)
	config.Server.CertFile = getEnv("TIGEREX_CERT_FILE", "cert.pem")
	config.Server.KeyFile = getEnv("TIGEREX_KEY_FILE", "key.pem")

	config.Database.Host = getEnv("TIGEREX_DB_HOST", "localhost")
	config.Database.Port = 5432
	config.Database.User = getEnv("TIGEREX_DB_USER", "tigerex")
	config.Database.Password = getEnv("TIGEREX_DB_PASSWORD", "")
	config.Database.DBName = getEnv("TIGEREX_DB_NAME", "tigerex")
	config.Database.SSLMode = getEnv("TIGEREX_DB_SSL_MODE", "disable")

	config.JWT.Secret = getEnv("TIGEREX_JWT_SECRET", "")
	config.JWT.AccessExpiry = 15
	config.JWT.RefreshExpiry = 7

	config.RateLimit.RequestsPerMinute = 60
	config.RateLimit.Burst = 10

	config.Security.MaxLoginAttempts = 5
	config.Security.LockoutDuration = 15
	config.Security.SessionExpiry = 24

	config.Crypto.MasterKey = getEnv("TIGEREX_MASTER_KEY", "")

	// Validate required config
	if config.JWT.Secret == "" {
		log.Fatal("TIGEREX_JWT_SECRET is required")
	}
	if len(config.JWT.Secret) < 32 {
		log.Fatal("TIGEREX_JWT_SECRET must be at least 32 characters")
	}

	jwtSecret = []byte(config.JWT.Secret)

	// Parse master key
	if config.Crypto.MasterKey != "" {
		keyBytes, err := hex.DecodeString(config.Crypto.MasterKey)
		if err != nil || len(keyBytes) != 32 {
			log.Fatal("TIGEREX_MASTER_KEY must be 64 hex characters (32 bytes)")
		}
		copy(masterKey[:], keyBytes)
	} else {
		// Generate random master key if not provided
		log.Println("Warning: Using generated master key (will not persist across restarts)")
	}

	// Initialize services
	authService = auth.NewService(auth.Config{
		JWT: auth.JWTConfig{
			Secret:        jwtSecret,
			AccessExpiry:  time.Duration(config.JWT.AccessExpiry) * time.Minute,
			RefreshExpiry:  time.Duration(config.JWT.RefreshExpiry) * 24 * time.Hour,
		},
		MaxLoginAttempts: config.Security.MaxLoginAttempts,
		LockoutDuration: time.Duration(config.Security.LockoutDuration) * time.Minute,
		SessionExpiry:  time.Duration(config.Security.SessionExpiry) * time.Hour,
	})

	kycService = kyc.NewService(kyc.Config{
		MaxLoginAttempts: config.Security.MaxLoginAttempts,
		LockoutDuration: time.Duration(config.Security.LockoutDuration) * time.Minute,
	})

	walletSvc = wallet.NewService(wallet.Config{
		MasterKey: masterKey,
	})

	tradingSvc = trading.NewService(trading.Config{})

	securitySvc = security.NewService(security.Config{
		MasterKey: masterKey,
	})
}

// getEnv gets environment variable or default
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		return value == "true" || value == "1"
	}
	return defaultValue
}

func main() {
	// Set Gin to Release mode for production
	gin.SetMode(gin.ReleaseMode)

	// Create router
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS configuration
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-ID"},
		ExposeHeaders:    []string{"Content-Length", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Health check endpoint (no auth required)
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"timestamp": time.Now().Unix(),
			"version":  "1.0.0",
		})
	})

	// API v1 routes
	v1 := r.Group("/api/v1")
	{
		// Public endpoints (no auth required)
		public := v1.Group("")
		{
			public.POST("/auth/register", handleRegister)
			public.POST("/auth/login", handleLogin)
			public.POST("/auth/refresh", handleRefreshToken)
			public.POST("/auth/forgot-password", handleForgotPassword)

			// Public market data
			public.GET("/markets", handleGetMarkets)
			public.GET("/markets/:symbol/ticker", handleGetTicker)
			public.GET("/markets/:symbol/depth", handleGetDepth)
			public.GET("/markets/:symbol/trades", handleGetTrades)
			public.GET("/markets/:symbol/klines", handleGetKlines)
			public.GET("/exchange-info", handleGetExchangeInfo)
		}

		// Protected endpoints (auth required)
		protected := v1.Group("")
		protected.Use(authMiddleware())
		{
			// Account
			protected.GET("/account", handleGetAccount)
			protected.PUT("/account", handleUpdateAccount)

			// Orders
			protected.POST("/orders", handleCreateOrder)
			protected.GET("/orders", handleGetOrders)
			protected.GET("/orders/:orderId", handleGetOrder)
			protected.DELETE("/orders/:orderId", handleCancelOrder)
			protected.DELETE("/orders", handleCancelAllOrders)

			// Trades
			protected.GET("/trades", handleGetTrades)
			protected.GET("/my-trades", handleGetMyTrades)

			// Wallet
			protected.GET("/wallets", handleGetWallets)
			protected.POST("/wallets/deposit", handleGetDepositAddress)
			protected.POST("/wallets/withdraw", handleWithdraw)
			protected.GET("/wallets/balance", handleGetBalance)
			protected.POST("/wallets/transfer", handleTransfer)

			// Staking & Earn
			protected.GET("/staking/products", handleGetStakingProducts)
			protected.POST("/staking/stake", handleStake)
			protected.POST("/staking/unstake", handleUnstake)
			protected.GET("/staking/positions", handleGetStakingPositions)

			protected.GET("/savings/products", handleGetSavingsProducts)
			protected.POST("/savings/deposit", handleSavingsDeposit)
			protected.POST("/savings/withdraw", handleSavingsWithdraw)
			protected.GET("/savings/positions", handleGetSavingsPositions)

			// Lending
			protected.GET("/lending/products", handleGetLendingProducts)
			protected.POST("/lending/lend", handleLend)
			protected.POST("/lending/borrow", handleBorrow)
			protected.GET("/lending/positions", handleGetLendingPositions)

			// Sub-accounts
			protected.GET("/sub-accounts", handleGetSubAccounts)
			protected.POST("/sub-accounts", handleCreateSubAccount)
			protected.DELETE("/sub-accounts/:subAccountId", handleDeleteSubAccount)

			// API Keys
			protected.GET("/api-keys", handleGetAPIKeys)
			protected.POST("/api-keys", handleCreateAPIKey)
			protected.DELETE("/api-keys/:keyId", handleDeleteAPIKey)

			// Security
			protected.POST("/security/2fa/enable", handleEnable2FA)
			protected.POST("/security/2fa/disable", handleDisable2FA)
			protected.POST("/security/withdrawal-whitelist", handleSetWithdrawalWhitelist)
			protected.POST("/security/ip-whitelist", handleSetIPWhitelist)
			protected.POST("/security/anti-phishing", handleSetAntiPhishing)

			// KYC
			protected.GET("/kyc/status", handleGetKYCStatus)
			protected.POST("/kyc/submit", handleSubmitKYC)
			protected.POST("/kyc/verify-phone", handleVerifyPhone)
			protected.POST("/kyc/verify-email", handleVerifyEmail)

			// Settings
			protected.GET("/settings", handleGetSettings)
			protected.PUT("/settings", handleUpdateSettings)
		}

		// WebSocket endpoint
		v1.GET("/ws", handleWebSocket)
	}

	// Admin endpoints (requires admin role)
	admin := v1.Group("/admin")
	admin.Use(authMiddleware(), adminMiddleware())
	{
		admin.GET("/users", handleAdminGetUsers)
		admin.GET("/users/:userId", handleAdminGetUser)
		admin.PUT("/users/:userId/kyc", handleAdminUpdateKYC)
		admin.GET("/orders", handleAdminGetAllOrders)
		admin.GET("/withdrawals", handleAdminGetWithdrawals)
		admin.POST("/withdrawals/:withdrawalId/approve", handleAdminApproveWithdrawal)
		admin.POST("/withdrawals/:withdrawalId/reject", handleAdminRejectWithdrawal)
		admin.GET("/deposits", handleAdminGetDeposits)
		admin.PUT("/markets/:symbol", handleAdminUpdateMarket)
		admin.GET("/stats", handleAdminGetStats)
	}

	// Create server
	srv := &http.Server{
		Addr:           ":" + config.Server.Port,
		Handler:        r,
		ReadTimeout:    time.Duration(config.Server.ReadTimeout) * time.Second,
		WriteTimeout:   time.Duration(config.Server.WriteTimeout) * time.Second,
		MaxHeaderBytes: config.Server.MaxHeaderBytes,
	}

	// Start server
	go func() {
		log.Printf("TigerEx API Server starting on port %s", config.Server.Port)
		
		if config.Server.TLSEnabled {
			// TLS mode
			srv.TLSConfig = &tls.Config{
				MinVersion:               tls.VersionTLS12,
				CurvePreferences:         []tls.CurveID{tls.CurveP256, tls.X25519},
				PreferServerCipherSuites:  true,
				CipherSuites: []uint16{
					tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
					tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
					tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
				},
			}
			if err := srv.ListenAndServeTLS(config.Server.CertFile, config.Server.KeyFile); err != nil && err != http.ErrServerClosed {
				log.Fatalf("Server failed: %v", err)
			}
		} else {
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Fatalf("Server failed: %v", err)
			}
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

// ============================================================================
// AUTH HANDLERS
// ============================================================================

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Username string `json:"username" binding:"required,min=3,max=32"`
	Password string `json:"password" binding:"required,min=8"`
	Phone    string `json:"phone"`
	RefCode  string `json:"refCode"`
}

type RegisterResponse struct {
	User         api.User   `json:"user"`
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    int64     `json:"expiresAt"`
}

func handleRegister(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate password strength
	if err := validatePasswordStrength(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if email already exists
	if authService.EmailExists(c.Request.Context(), req.Email) {
		c.JSON(http.StatusConflict, gin.H{"error": "Email already registered"})
		return
	}

	// Check if username already exists
	if authService.UsernameExists(c.Request.Context(), req.Username) {
		c.JSON(http.StatusConflict, gin.H{"error": "Username already taken"})
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process registration"})
		return
	}

	// Create user
	user := api.User{
		ID:        uuid.New().String(),
		Email:     req.Email,
		Username: req.Username,
		Password: string(hashedPassword),
		Phone:    req.Phone,
		RefCode:  req.RefCode,
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		KYCLevel: kyc.LevelNone,
	}

	if err := authService.CreateUser(c.Request.Context(), &user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Generate tokens
	accessToken, refreshToken, expiresAt, err := authService.GenerateTokenPair(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate tokens"})
		return
	}

	// Create default wallets
	if err := walletSvc.CreateDefaultWallets(c.Request.Context(), user.ID); err != nil {
		log.Printf("Failed to create default wallets: %v", err)
	}

	c.JSON(http.StatusCreated, RegisterResponse{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
	})
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	User         api.User   `json:"user"`
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    int64     `json:"expiresAt"`
	Requires2FA bool      `json:"requires2FA"`
}

func handleLogin(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user by email
	user, err := authService.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Check if account is locked
	if authService.IsAccountLocked(c.Request.Context(), user.ID) {
		c.JSON(http.StatusLocked, gin.H{"error": "Account locked. Try again later."})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		// Record failed attempt
		authService.RecordFailedAttempt(c.Request.Context(), user.ID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Check if 2FA is enabled
	if user.TwoFactorEnabled {
		// Return partial auth - requires 2FA
		c.JSON(http.StatusOK, LoginResponse{
			User:         *user,
			Requires2FA: true,
		})
		return
	}

	// Generate tokens
	accessToken, refreshToken, expiresAt, err := authService.GenerateTokenPair(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate tokens"})
		return
	}

	// Clear failed attempts on successful login
	authService.ClearFailedAttempts(c.Request.Context(), user.ID)

	c.JSON(http.StatusOK, LoginResponse{
		User:         *user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
	})
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

func handleRefreshToken(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Parse refresh token
	token, err := jwt.Parse(req.RefreshToken, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
		return
	}

	userID, ok := claims["sub"].(string)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
		return
	}

	// Get user
	user, err := authService.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
		return
	}

	// Generate new tokens
	accessToken, refreshToken, expiresAt, err := authService.GenerateTokenPair(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate tokens"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"accessToken":  accessToken,
		"refreshToken": refreshToken,
		"expiresAt":   expiresAt,
	})
}

type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

func handleForgotPassword(c *gin.Context) {
	var req ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user by email
	user, err := authService.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		// Don't reveal if email exists
		c.JSON(http.StatusOK, gin.H{"message": "If the email exists, a reset link has been sent"})
		return
	}

	// Generate password reset token
	resetToken, err := authService.GeneratePasswordResetToken(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "If the email exists, a reset link has been sent"})
		return
	}

	// TODO: Send reset email with resetToken
	log.Printf("Password reset token for %s: %s", user.Email, resetToken)

	c.JSON(http.StatusOK, gin.H{"message": "If the email exists, a reset link has been sent"})
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		// Extract token from "Bearer <token>"
		tokenString := authHeader
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			tokenString = authHeader[7:]
		}

		// Parse JWT token
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			return
		}

		userID, ok := claims["sub"].(string)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			return
		}

		// Get user from database
		user, err := authService.GetUserByID(c.Request.Context(), userID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			return
		}

		// Set user in context
		c.Set("user", user)
		c.Next()
	}
}

func adminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, exists := c.Get("user")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			return
		}

		u := user.(*api.User)
		if !u.IsAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			return
		}

		c.Next()
	}
}

// ============================================================================
// MARKET DATA HANDLERS
// ============================================================================

func handleGetMarkets(c *gin.Context) {
	markets := tradingSvc.GetMarkets(c.Request.Context())
	c.JSON(http.StatusOK, markets)
}

func handleGetTicker(c *gin.Context) {
	symbol := c.Param("symbol")
	ticker, err := tradingSvc.GetTicker(c.Request.Context(), symbol)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Symbol not found"})
		return
	}
	c.JSON(http.StatusOK, ticker)
}

func handleGetDepth(c *gin.Context) {
	symbol := c.Param("symbol")
	limit := getQueryInt(c, "limit", 100)
	depth, err := tradingSvc.GetOrderBookDepth(c.Request.Context(), symbol, limit)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Symbol not found"})
		return
	}
	c.JSON(http.StatusOK, depth)
}

func handleGetTrades(c *gin.Context) {
	symbol := c.Param("symbol")
	limit := getQueryInt(c, "limit", 100)
	fromID := getQueryInt64(c, "fromId", 0)
	trades, err := tradingSvc.GetRecentTrades(c.Request.Context(), symbol, limit, fromID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Symbol not found"})
		return
	}
	c.JSON(http.StatusOK, trades)
}

func handleGetKlines(c *gin.Context) {
	symbol := c.Param("symbol")
	interval := c.DefaultQuery("interval", "1h")
	startTime := getQueryInt64(c, "startTime", 0)
	endTime := getQueryInt64(c, "endTime", 0)
	limit := getQueryInt(c, "limit", 500)

	klines, err := tradingSvc.GetKlines(c.Request.Context(), symbol, interval, startTime, endTime, limit)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Symbol not found"})
		return
	}
	c.JSON(http.StatusOK, klines)
}

func handleGetExchangeInfo(c *gin.Context) {
	info := tradingSvc.GetExchangeInfo(c.Request.Context())
	c.JSON(http.StatusOK, info)
}

// ============================================================================
// ACCOUNT HANDLERS
// ============================================================================

func handleGetAccount(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	c.JSON(http.StatusOK, user)
}

func handleUpdateAccount(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req struct {
		Username string `json:"username"`
		Phone    string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Username != "" {
		user.Username = req.Username
	}
	if req.Phone != "" {
		user.Phone = req.Phone
	}
	user.UpdatedAt = time.Now().Unix()

	if err := authService.UpdateUser(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update account"})
		return
	}

	c.JSON(http.StatusOK, user)
}

// ============================================================================
// ORDER HANDLERS
// ============================================================================

type CreateOrderRequest struct {
	Symbol           string  `json:"symbol" binding:"required"`
	Side             string  `json:"side" binding:"required,oneof=buy sell"`
	Type             string  `json:"type" binding:"required,oneof=market limit stop_loss stop_limit trailing_stop"`
	Quantity        float64 `json:"quantity" binding:"required,gt=0"`
	Price           float64 `json:"price"`
	StopPrice       float64 `json:"stopPrice"`
	TimeInForce     string  `json:"timeInForce" binding:"oneof=GTC IOC FOK GTD"`
	ClientOrderID   string  `json:"clientOrderId"`
	TrailingDistance float64 `json:"trailingDistance"`
	ReduceOnly      bool    `json:"reduceOnly"`
}

func handleCreateOrder(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Create order
	order, err := tradingSvc.CreateOrder(c.Request.Context(), &trading.OrderRequest{
		UserID:            user.ID,
		Symbol:           req.Symbol,
		Side:             req.Side,
		Type:             req.Type,
		Quantity:        req.Quantity,
		Price:           req.Price,
		StopPrice:       req.StopPrice,
		TimeInForce:     req.TimeInForce,
		ClientOrderID:   req.ClientOrderID,
		TrailingDistance: req.TrailingDistance,
		ReduceOnly:      req.ReduceOnly,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, order)
}

func handleGetOrders(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	symbol := c.Query("symbol")
	side := c.Query("side")
	status := c.Query("status")
	limit := getQueryInt(c, "limit", 100)
	fromID := c.Query("fromId")

	orders, err := tradingSvc.GetOrders(c.Request.Context(), user.ID, symbol, side, status, limit, fromID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get orders"})
		return
	}

	c.JSON(http.StatusOK, orders)
}

func handleGetOrder(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	orderID := c.Param("orderId")

	order, err := tradingSvc.GetOrder(c.Request.Context(), user.ID, orderID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, order)
}

func handleCancelOrder(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	orderID := c.Param("orderId")

	order, err := tradingSvc.CancelOrder(c.Request.Context(), user.ID, orderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, order)
}

func handleCancelAllOrders(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	symbol := c.Query("symbol")

	orders, err := tradingSvc.CancelAllOrders(c.Request.Context(), user.ID, symbol)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, orders)
}

func handleGetMyTrades(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	symbol := c.Query("symbol")
	limit := getQueryInt(c, "limit", 100)
	fromID := getQueryInt64(c, "fromId", 0)

	trades, err := tradingSvc.GetUserTrades(c.Request.Context(), user.ID, symbol, limit, fromID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get trades"})
		return
	}

	c.JSON(http.StatusOK, trades)
}

// ============================================================================
// WALLET HANDLERS
// ============================================================================

func handleGetWallets(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	wallets, err := walletSvc.GetWallets(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get wallets"})
		return
	}

	c.JSON(http.StatusOK, wallets)
}

type DepositAddressRequest struct {
	Asset   string `json:"asset" binding:"required"`
	Network string `json:"network"`
}

func handleGetDepositAddress(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req DepositAddressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	address, err := walletSvc.GetDepositAddress(c.Request.Context(), user.ID, req.Asset, req.Network)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, address)
}

type WithdrawRequest struct {
	Asset     string  `json:"asset" binding:"required"`
	Amount    float64 `json:"amount" binding:"required,gt=0"`
	Address   string  `json:"address" binding:"required"`
	Memo      string  `json:"memo"`
	Network   string  `json:"network"`
	FeeLevel  string  `json:"feeLevel"`
}

func handleWithdraw(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req WithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check KYC level for withdrawal
	if err := kycService.CanWithdraw(c.Request.Context(), user.ID, req.Amount); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	// Check withdrawal whitelist
	if err := walletSvc.CheckWithdrawalWhitelist(c.Request.Context(), user.ID, req.Address); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	withdrawal, err := walletSvc.RequestWithdrawal(c.Request.Context(), &wallet.WithdrawalRequest{
		UserID:   user.ID,
		Asset:   req.Asset,
		Amount:  req.Amount,
		Address: req.Address,
		Memo:    req.Memo,
		Network: req.Network,
		FeeLevel: req.FeeLevel,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, withdrawal)
}

func handleGetBalance(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	asset := c.Query("asset")

	balance, err := walletSvc.GetBalance(c.Request.Context(), user.ID, asset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get balance"})
		return
	}

	c.JSON(http.StatusOK, balance)
}

type TransferRequest struct {
	Asset     string  `json:"asset" binding:"required"`
	Amount    float64 `json:"amount" binding:"required,gt=0"`
	ToUserID  string  `json:"toUserId" binding:"required"`
	Memo     string  `json:"memo"`
}

func handleTransfer(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transfer, err := walletSvc.InternalTransfer(c.Request.Context(), &wallet.TransferRequest{
		FromUserID: user.ID,
		ToUserID:  req.ToUserID,
		Asset:    req.Asset,
		Amount:   req.Amount,
		Memo:     req.Memo,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, transfer)
}

// ============================================================================
// STAKING & EARN HANDLERS
// ============================================================================

func handleGetStakingProducts(c *gin.Context) {
	products := tradingSvc.GetStakingProducts(c.Request.Context())
	c.JSON(http.StatusOK, products)
}

type StakeRequest struct {
	Asset      string  `json:"asset" binding:"required"`
	Amount     float64 `json:"amount" binding:"required,gt=0"`
	ProductID  string  `json:"productId" binding:"required"`
	Compound  bool    `json:"compound"`
}

func handleStake(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req StakeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	position, err := tradingSvc.Stake(c.Request.Context(), &trading.StakeRequest{
		UserID:     user.ID,
		Asset:     req.Asset,
		Amount:    req.Amount,
		ProductID: req.ProductID,
		Compound:  req.Compound,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, position)
}

type UnstakeRequest struct {
	PositionID string  `json:"positionId" binding:"required"`
	Amount    float64 `json:"amount"`
}

func handleUnstake(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req UnstakeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	position, err := tradingSvc.Unstake(c.Request.Context(), &trading.UnstakeRequest{
		UserID:     user.ID,
		PositionID: req.PositionID,
		Amount:    req.Amount,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, position)
}

func handleGetStakingPositions(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	positions, err := tradingSvc.GetStakingPositions(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get positions"})
		return
	}

	c.JSON(http.StatusOK, positions)
}

func handleGetSavingsProducts(c *gin.Context) {
	products := tradingSvc.GetSavingsProducts(c.Request.Context())
	c.JSON(http.StatusOK, products)
}

func handleSavingsDeposit(c *gin.Context) {
	// Similar to staking
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleSavingsWithdraw(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleGetSavingsPositions(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleGetLendingProducts(c *gin.Context) {
	products := tradingSvc.GetLendingProducts(c.Request.Context())
	c.JSON(http.StatusOK, products)
}

func handleLend(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleBorrow(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleGetLendingPositions(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

// ============================================================================
// SUB-ACCOUNTS & API KEYS
// ============================================================================

func handleGetSubAccounts(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleCreateSubAccount(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleDeleteSubAccount(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleGetAPIKeys(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	keys, err := authService.GetAPIKeys(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get API keys"})
		return
	}

	c.JSON(http.StatusOK, keys)
}

type CreateAPIKeyRequest struct {
	Label       string   `json:"label" binding:"required"`
	Permissions []string `json:"permissions" binding:"required"`
	ExpiresAt   int64    `json:"expiresAt"`
	IPWhitelist []string `json:"ipWhitelist"`
}

func handleCreateAPIKey(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req CreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key, err := authService.CreateAPIKey(c.Request.Context(), &auth.APIKeyRequest{
		UserID:       user.ID,
		Label:       req.Label,
		Permissions: req.Permissions,
		ExpiresAt:   req.ExpiresAt,
		IPWhitelist: req.IPWhitelist,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, key)
}

func handleDeleteAPIKey(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	keyID := c.Param("keyId")

	if err := authService.DeleteAPIKey(c.Request.Context(), user.ID, keyID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "API key deleted"})
}

// ============================================================================
// SECURITY HANDLERS
// ============================================================================

func handleEnable2FA(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleDisable2FA(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleSetWithdrawalWhitelist(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleSetIPWhitelist(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleSetAntiPhishing(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

// ============================================================================
// KYC HANDLERS
// ============================================================================

func handleGetKYCStatus(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	status, err := kycService.GetStatus(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get KYC status"})
		return
	}

	c.JSON(http.StatusOK, status)
}

type SubmitKYCRequest struct {
	DocumentType string `json:"documentType" binding:"required,oneof=passport national_id drivers_license"`
	FirstName  string `json:"firstName" binding:"required"`
	LastName  string `json:"lastName" binding:"required"`
	DOB       string `json:"dob" binding:"required"`
	Country   string `json:"country" binding:"required"`
	DocumentID string `json:"documentId" binding:"required"`
	Address  string `json:"address"`
	City     string `json:"city"`
	State    string `json:"state"`
	ZipCode  string `json:"zipCode"`
}

func handleSubmitKYC(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	var req SubmitKYCRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := kycService.Submit(c.Request.Context(), &kyc.SubmissionRequest{
		UserID:        user.ID,
		DocumentType: req.DocumentType,
		FirstName:    req.FirstName,
		LastName:    req.LastName,
		DOB:        req.DOB,
		Country:    req.Country,
		DocumentID:  req.DocumentID,
		Address:   req.Address,
		City:      req.City,
		State:     req.State,
		ZipCode:   req.ZipCode,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func handleVerifyPhone(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleVerifyEmail(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

// ============================================================================
// SETTINGS HANDLERS
// ============================================================================

func handleGetSettings(c *gin.Context) {
	user := c.MustGet("user").(*api.User)
	
	settings, err := authService.GetSettings(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get settings"})
		return
	}

	c.JSON(http.StatusOK, settings)
}

func handleUpdateSettings(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

// ============================================================================
// WEBSOCKET HANDLER
// ============================================================================

func handleWebSocket(c *gin.Context) {
	// Upgrade to WebSocket
	// This is a placeholder - full implementation would use gorilla/websocket
	c.JSON(http.StatusNotImplemented, gin.H{"error": "WebSocket not implemented"})
}

// ============================================================================
// ADMIN HANDLERS
// ============================================================================

func handleAdminGetUsers(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminGetUser(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminUpdateKYC(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminGetAllOrders(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminGetWithdrawals(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminApproveWithdrawal(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminRejectWithdrawal(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminGetDeposits(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminUpdateMarket(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

func handleAdminGetStats(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented"})
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

func validatePasswordStrength(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}

	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, c := range password {
		switch {
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= '0' && c <= '9':
			hasDigit = true
		case c >= 33 && c <= 126 && !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')):
			hasSpecial = true
		}
	}

	if !hasUpper || !hasLower || !hasDigit {
		return fmt.Errorf("password must contain uppercase, lowercase, and digit")
	}

	return nil
}

func getQueryInt(c *gin.Context, key string, defaultValue int) int {
	value := c.Query(key)
	if value == "" {
		return defaultValue
	}
	var result int
	if _, err := fmt.Sscanf(value, "%d", &result); err != nil {
		return defaultValue
	}
	return result
}

func getQueryInt64(c *gin.Context, key string, defaultValue int64) int64 {
	value := c.Query(key)
	if value == "" {
		return defaultValue
	}
	var result int64
	if _, err := fmt.Sscanf(value, "%d", &result); err != nil {
		return defaultValue
	}
	return result
}