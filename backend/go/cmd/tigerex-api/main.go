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
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"tigerex/backend/internal/admin"

	"tigerex/backend/internal/api"
	"tigerex/backend/internal/auth"
	"tigerex/backend/internal/earn"
	"tigerex/backend/internal/kyc"
	"tigerex/backend/internal/security"
	"tigerex/backend/internal/totp"
	"tigerex/backend/internal/trading"
	"tigerex/backend/internal/wallet"
	"tigerex/backend/internal/ws"
)

// Config holds all configuration
type Config struct {
	Server struct {
		Port           string
		ReadTimeout    int
		WriteTimeout   int
		MaxHeaderBytes int
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
		Secret        string
		AccessExpiry  int // minutes
		RefreshExpiry int // days
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
	config      *Config
	wsHub       *ws.Hub
	jwtSecret   []byte
	masterKey   [32]byte
	authService *auth.Service
	kycService  *kyc.Service
	walletSvc   *wallet.Service
	tradingSvc  *trading.Service
	securitySvc *security.Service
	earnService *earn.Service
	adminStore  admin.Store
)

// Initialize loads configuration
func init() {
	config = &Config{}
	config.Server.Port = getEnv("TIGEREX_PORT", "8443")
	config.Server.ReadTimeout = 30
	config.Server.WriteTimeout = 30
	config.Server.MaxHeaderBytes = 1 << 20
	config.Server.TLSEnabled = getEnvBool("TIGEREX_TLS_ENABLED", os.Getenv("NODE_ENV") == "production")
	config.Server.CertFile = getEnv("TIGEREX_CERT_FILE", "cert.pem")
	config.Server.KeyFile = getEnv("TIGEREX_KEY_FILE", "key.pem")

	config.Database.Host = getEnv("TIGEREX_DB_HOST", "localhost")
	config.Database.Port = 5432
	config.Database.User = getEnv("TIGEREX_DB_USER", "tigerex")
	config.Database.Password = getEnv("TIGEREX_DB_PASSWORD", "")
	config.Database.DBName = getEnv("TIGEREX_DB_NAME", "tigerex")
	config.Database.SSLMode = getEnv("TIGEREX_DB_SSL_MODE", "require")

	config.JWT.Secret = getEnv("TIGEREX_JWT_SECRET", "")
	config.JWT.AccessExpiry = 15
	config.JWT.RefreshExpiry = 7

	config.RateLimit.RequestsPerMinute = 60
	config.RateLimit.Burst = 10

	config.Security.MaxLoginAttempts = 5
	config.Security.LockoutDuration = 15
	config.Security.SessionExpiry = 24

	config.Crypto.MasterKey = getEnv("TIGEREX_MASTER_KEY", "")

	// Fail closed: production services must never start with missing or ephemeral
	// signing/encryption keys, wildcard credentialed CORS, or plaintext transport.
	if config.JWT.Secret == "" {
		log.Fatal("TIGEREX_JWT_SECRET is required")
	}
	if len(config.JWT.Secret) < 32 {
		log.Fatal("TIGEREX_JWT_SECRET must be at least 32 characters")
	}
	if os.Getenv("NODE_ENV") == "production" && !config.Server.TLSEnabled {
		log.Fatal("TIGEREX_TLS_ENABLED must be true in production")
	}
	origins := strings.Split(os.Getenv("TIGEREX_CORS_ORIGINS"), ",")
	if len(origins) == 0 || strings.TrimSpace(origins[0]) == "" {
		log.Fatal("TIGEREX_CORS_ORIGINS must contain explicit trusted origins")
	}
	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
		if origins[i] == "" || origins[i] == "*" {
			log.Fatal("TIGEREX_CORS_ORIGINS must not contain empty or wildcard origins")
		}
	}
	if config.Crypto.MasterKey == "" {
		log.Fatal("TIGEREX_MASTER_KEY is required; ephemeral encryption keys are unsafe")
	}

	jwtSecret = []byte(config.JWT.Secret)

	// Parse master key
	if config.Crypto.MasterKey != "" {
		keyBytes, err := hex.DecodeString(config.Crypto.MasterKey)
		if err != nil || len(keyBytes) != 32 {
			log.Fatal("TIGEREX_MASTER_KEY must be 64 hex characters (32 bytes)")
		}
		copy(masterKey[:], keyBytes)
	}

	// Initialize services
	authService = auth.NewService(auth.Config{
		JWT: auth.JWTConfig{
			Secret:        jwtSecret,
			AccessExpiry:  time.Duration(config.JWT.AccessExpiry) * time.Minute,
			RefreshExpiry: time.Duration(config.JWT.RefreshExpiry) * 24 * time.Hour,
		},
		MaxLoginAttempts: config.Security.MaxLoginAttempts,
		LockoutDuration:  time.Duration(config.Security.LockoutDuration) * time.Minute,
		SessionExpiry:    time.Duration(config.Security.SessionExpiry) * time.Hour,
	})

	// Authentication needs durable storage. When a database DSN is configured
	// the service uses Postgres; otherwise it stays without a store and every
	// registration and login fails closed with "unavailable" instead of
	// appearing to succeed while persisting nothing.
	if dsn := os.Getenv("TIGEREX_DATABASE_DSN"); dsn != "" {
		store, err := auth.NewPgStore(
			context.Background(),
			dsn,
			config.Security.MaxLoginAttempts,
			time.Duration(config.Security.LockoutDuration)*time.Minute,
		)
		if err != nil {
			log.Fatalf("failed to initialise authentication store: %v", err)
		}
		if err := store.EnsureSecuritySchema(context.Background()); err != nil {
			log.Fatalf("failed to initialise security schema: %v", err)
		}
		authService = authService.WithStore(store).WithSecurityStore(store)
		log.Printf("authentication persistence enabled")
	} else {
		log.Printf("TIGEREX_DATABASE_DSN is not set; authentication endpoints will report unavailable")
	}

	kycService = kyc.NewService(kyc.Config{
		MaxLoginAttempts: config.Security.MaxLoginAttempts,
		LockoutDuration:  time.Duration(config.Security.LockoutDuration) * time.Minute,
	})

	// KYC decisions must survive a restart. An in-memory store would report a
	// user as unverified after a deploy while the operator believes they were
	// approved, so a real file path is required.
	if path := os.Getenv("TIGEREX_KYC_DB"); path != "" {
		store, err := kyc.NewSQLiteStore(path)
		if err != nil {
			log.Fatalf("failed to initialise KYC store: %v", err)
		}
		kycService = kycService.WithStore(store)
		log.Printf("KYC persistence enabled")
	} else {
		log.Printf("TIGEREX_KYC_DB is not set; KYC endpoints will report unavailable")
	}

	walletSvc = wallet.NewService(wallet.Config{
		MasterKey: masterKey,
	})

	tradingSvc = trading.NewService(trading.Config{})

	// Savings, lending, and sub-accounts need durable storage: a position

	// that vanishes on restart would silently lose a user's principal.

	earnService = earn.NewService(earn.Config{

		Oracle: marketPriceOracle{},
	})

	// The admin console reads live exchange state. It shares the same

	// database as authentication; without a DSN every admin endpoint

	// reports unavailable rather than showing an empty exchange.

	if dsn := os.Getenv("TIGEREX_DATABASE_DSN"); dsn != "" {

		store, err := admin.NewPGStore(context.Background(), dsn)

		if err != nil {

			log.Fatalf("failed to initialise admin store: %v", err)

		}

		adminStore = store

		log.Printf("admin persistence enabled")

	} else {

		log.Printf("TIGEREX_DATABASE_DSN is not set; admin endpoints will report unavailable")

	}

	if path := os.Getenv("TIGEREX_EARN_DB"); path != "" {

		store, err := earn.NewSQLiteStore(path)

		if err != nil {

			log.Fatalf("failed to initialise earn store: %v", err)

		}

		earnService = earnService.WithStore(store)

		log.Printf("earn persistence enabled")

	} else {

		log.Printf("TIGEREX_EARN_DB is not set; earn endpoints will report unavailable")

	}

	wsHub = ws.NewHub()
	go wsHub.Run()

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

	// Credentialed CORS must use explicit allowlisted origins, never "*".
	trustedOrigins := strings.Split(os.Getenv("TIGEREX_CORS_ORIGINS"), ",")
	for i := range trustedOrigins {
		trustedOrigins[i] = strings.TrimSpace(trustedOrigins[i])
	}
	r.Use(cors.New(cors.Config{
		AllowOrigins:     trustedOrigins,
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
			"version":   "1.0.0",
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
			public.POST("/auth/2fa/verify", handleVerify2FA)
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
			protected.GET("/security/2fa/setup", handleSetup2FA)
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
		admin.GET("/markets", handleAdminGetMarkets)
		admin.GET("/audit", handleAdminGetAudit)
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
				PreferServerCipherSuites: true,
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
	User         api.User `json:"user"`
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	ExpiresAt    int64    `json:"expiresAt"`
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
		Username:  req.Username,
		Password:  string(hashedPassword),
		Phone:     req.Phone,
		RefCode:   req.RefCode,
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		KYCLevel:  kyc.LevelNone,
	}

	if err := authService.CreateUser(c.Request.Context(), &user); err != nil {
		if errors.Is(err, auth.ErrStoreUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Registration is unavailable"})
			return
		}
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
	User         api.User `json:"user"`
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	ExpiresAt    int64    `json:"expiresAt"`
	Requires2FA  bool     `json:"requires2FA"`
	// TwoFactorToken is a short-lived token that authorises only the
	// /auth/2fa/verify call. It is present only when Requires2FA is true.
	TwoFactorToken   string `json:"twoFactorToken,omitempty"`
	TwoFactorExpires int64  `json:"twoFactorExpires,omitempty"`
}

// Token types. They are written into the "type" claim of every token so a
// token minted for one purpose cannot be replayed as another.
const (
	tokenTypeAccess    = "access"
	tokenTypeRefresh   = "refresh"
	tokenTypeChallenge = "2fa_challenge"
)

// twoFactorChallengeTTL bounds how long a password-only login may sit waiting
// for the second factor.
const twoFactorChallengeTTL = 5 * time.Minute

// securityStoreOrUnavailable returns the configured security store, or writes a
// 503 and returns false. Every handler that reads or writes account-security
// settings must call it rather than silently succeeding.
func securityStoreOrUnavailable(c *gin.Context) (auth.SecurityStore, bool) {
	store := authService.SecurityStore()
	if store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Security settings are unavailable"})
		return nil, false
	}
	return store, true
}

// numericClaim reads a numeric JWT claim. JSON numbers decode to float64, but
// a value that round-tripped through another encoder may arrive as json.Number
// or an integer, so all three are handled.
func numericClaim(claims jwt.MapClaims, key string) (int64, bool) {
	switch v := claims[key].(type) {
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case json.Number:
		n, err := v.Int64()
		if err != nil {
			return 0, false
		}
		return n, true
	}
	return 0, false
}

// issue2FAChallenge signs a token that is accepted only by the 2FA completion
// endpoint. It carries no API permissions and expires quickly.
func issue2FAChallenge(userID string) (string, error) {
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  userID,
		"iat":  now.Unix(),
		"exp":  now.Add(twoFactorChallengeTTL).Unix(),
		"type": tokenTypeChallenge,
	})
	return token.SignedString(jwtSecret)
}

// parse2FAChallenge validates a challenge token and returns the user ID.
func parse2FAChallenge(tokenString string) (string, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return "", errors.New("invalid 2FA challenge")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid 2FA challenge claims")
	}
	if typ, _ := claims["type"].(string); typ != tokenTypeChallenge {
		return "", errors.New("token is not a 2FA challenge")
	}
	userID, ok := claims["sub"].(string)
	if !ok || userID == "" {
		return "", errors.New("invalid 2FA challenge subject")
	}
	return userID, nil
}

type Verify2FARequest struct {
	TwoFactorToken string `json:"twoFactorToken" binding:"required"`
	Code           string `json:"code" binding:"required"`
}

// handleVerify2FA completes a password login by checking the TOTP code against
// the enrolled secret. Without this endpoint a 2FA-enabled account could never
// obtain a session.
func handleVerify2FA(c *gin.Context) {
	var req Verify2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, err := parse2FAChallenge(req.TwoFactorToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired 2FA challenge"})
		return
	}

	user, err := authService.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired 2FA challenge"})
		return
	}
	if !user.TwoFactorEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "2FA is not enabled for this account"})
		return
	}

	if authService.IsAccountLocked(c.Request.Context(), user.ID) {
		c.JSON(http.StatusLocked, gin.H{"error": "Account locked. Try again later."})
		return
	}

	key, err := totp.DecodeSecret(user.TwoFactorSecret)
	if err != nil || !totp.Validate(totp.Config{Secret: key}, req.Code, time.Now()) {
		authService.RecordFailedAttempt(c.Request.Context(), user.ID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid 2FA code"})
		return
	}

	accessToken, refreshToken, expiresAt, err := authService.GenerateTokenPair(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate tokens"})
		return
	}

	authService.ClearFailedAttempts(c.Request.Context(), user.ID)

	c.JSON(http.StatusOK, LoginResponse{
		User:         *user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
	})
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
		if errors.Is(err, auth.ErrStoreUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Login is unavailable"})
			return
		}
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

	// Check if 2FA is enabled. The password was correct, but no session is
	// issued yet: the client must complete the second factor against
	// /auth/2fa/verify using the short-lived challenge token below.
	if user.TwoFactorEnabled {
		challenge, err := issue2FAChallenge(user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start 2FA challenge"})
			return
		}
		c.JSON(http.StatusOK, LoginResponse{
			User:             *user,
			Requires2FA:      true,
			TwoFactorToken:   challenge,
			TwoFactorExpires: time.Now().Add(twoFactorChallengeTTL).Unix(),
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

	// Only a refresh token may be exchanged here.
	if typ, _ := claims["type"].(string); typ != tokenTypeRefresh {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
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
		"expiresAt":    expiresAt,
	})
}

type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

func handleForgotPassword(c *gin.Context) {
	var req ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Do not generate or log reset tokens until a real, verified email delivery
	// provider and single-use reset completion flow are configured.
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error": "Password reset is temporarily unavailable because email delivery is not configured",
	})

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

		// Only an access token may authorise an API call. A refresh token or a
		// 2FA challenge token is signed with the same secret but grants no
		// session on its own.
		if typ, _ := claims["type"].(string); typ != tokenTypeAccess {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token type"})
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

		// A session issued before a password change, a 2FA change, or a
		// whitelist change must stop working immediately.
		if issued, ok := numericClaim(claims, "sv"); ok && issued != user.SecurityVersion {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Session is no longer valid"})
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
	Quantity         float64 `json:"quantity" binding:"required,gt=0"`
	Price            float64 `json:"price"`
	StopPrice        float64 `json:"stopPrice"`
	TimeInForce      string  `json:"timeInForce" binding:"oneof=GTC IOC FOK GTD"`
	ClientOrderID    string  `json:"clientOrderId"`
	TrailingDistance float64 `json:"trailingDistance"`
	ReduceOnly       bool    `json:"reduceOnly"`
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
		UserID:           user.ID,
		Symbol:           req.Symbol,
		Side:             req.Side,
		Type:             req.Type,
		Quantity:         req.Quantity,
		Price:            req.Price,
		StopPrice:        req.StopPrice,
		TimeInForce:      req.TimeInForce,
		ClientOrderID:    req.ClientOrderID,
		TrailingDistance: req.TrailingDistance,
		ReduceOnly:       req.ReduceOnly,
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
	Asset    string  `json:"asset" binding:"required"`
	Amount   float64 `json:"amount" binding:"required,gt=0"`
	Address  string  `json:"address" binding:"required"`
	Memo     string  `json:"memo"`
	Network  string  `json:"network"`
	FeeLevel string  `json:"feeLevel"`
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

	// Enforce the withdrawal address whitelist. Once a user has approved at
	// least one address, every withdrawal must target one of them. An
	// unconfigured store means the check cannot be performed, so the request is
	// refused rather than allowed through unchecked.
	if err := enforceWithdrawalWhitelist(c.Request.Context(), user.ID, req.Asset, req.Address); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	withdrawal, err := walletSvc.RequestWithdrawal(c.Request.Context(), &wallet.WithdrawalRequest{
		UserID:   user.ID,
		Asset:    req.Asset,
		Amount:   req.Amount,
		Address:  req.Address,
		Memo:     req.Memo,
		Network:  req.Network,
		FeeLevel: req.FeeLevel,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, withdrawal)
}

// marketPriceOracle values collateral from the exchange's own market data.
//
// It reads the live ticker for the base/quote pair. When no market-data
// provider is configured the ticker lookup fails, and so does the valuation: a
// collateral check against an invented price would let a borrower take out an
// unbacked loan.
type marketPriceOracle struct{}

// Price returns the price of one unit of baseAsset in quoteAsset.
func (marketPriceOracle) Price(ctx context.Context, baseAsset, quoteAsset string) (float64, error) {
	baseAsset = strings.ToUpper(strings.TrimSpace(baseAsset))
	quoteAsset = strings.ToUpper(strings.TrimSpace(quoteAsset))
	if baseAsset == "" || quoteAsset == "" {
		return 0, errors.New("base and quote assets are required")
	}
	if baseAsset == quoteAsset {
		return 1, nil
	}
	if tradingSvc == nil {
		return 0, earn.ErrPriceUnavailable
	}

	ticker, err := tradingSvc.GetTicker(ctx, baseAsset+"/"+quoteAsset)
	if err != nil {
		return 0, err
	}
	if ticker == nil || ticker.Price <= 0 {
		return 0, earn.ErrPriceUnavailable
	}
	return ticker.Price, nil
}

// enforceWithdrawalWhitelist refuses a withdrawal to an address the user has
// not approved. When the user has approved no addresses the withdrawal is
// allowed, which preserves the default behaviour for accounts that have not
// opted into the whitelist.
func enforceWithdrawalWhitelist(ctx context.Context, userID, asset, address string) error {
	store := authService.SecurityStore()
	if store == nil {
		return errors.New("withdrawal whitelist is unavailable")
	}

	address = strings.TrimSpace(address)
	if address == "" {
		return errors.New("withdrawal address is required")
	}

	addresses, err := store.ListWithdrawalAddresses(ctx, userID)
	if err != nil {
		return errors.New("failed to load withdrawal whitelist")
	}
	if len(addresses) == 0 {
		return nil
	}

	asset = strings.ToUpper(strings.TrimSpace(asset))
	for _, entry := range addresses {
		if entry.Address == address && (asset == "" || entry.Asset == asset) {
			return nil
		}
	}
	return auth.ErrAddressNotWhitelisted
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
	Asset    string  `json:"asset" binding:"required"`
	Amount   float64 `json:"amount" binding:"required,gt=0"`
	ToUserID string  `json:"toUserId" binding:"required"`
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
		ToUserID:   req.ToUserID,
		Asset:      req.Asset,
		Amount:     req.Amount,
		Memo:       req.Memo,
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
	Asset     string  `json:"asset" binding:"required"`
	Amount    float64 `json:"amount" binding:"required,gt=0"`
	ProductID string  `json:"productId" binding:"required"`
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
		UserID:    user.ID,
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
	Amount     float64 `json:"amount"`
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
		Amount:     req.Amount,
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

// earnError maps an earn package error to an HTTP status. An unrecognised
// error is a server fault and is reported as such without leaking internals.
func earnError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, earn.ErrInvalidAmount),
		errors.Is(err, earn.ErrBelowMinimum),
		errors.Is(err, earn.ErrDuplicateSubAccount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, earn.ErrProductNotFound), errors.Is(err, earn.ErrPositionNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, earn.ErrUnauthorized):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, earn.ErrLocked),
		errors.Is(err, earn.ErrInsufficientFunds),
		errors.Is(err, earn.ErrCollateralTooLow),
		errors.Is(err, earn.ErrSubAccountLimit):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, earn.ErrPriceUnavailable), errors.Is(err, earn.ErrStoreUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request could not be completed"})
	}
}

func handleGetSavingsProducts(c *gin.Context) {
	products, err := earnService.ListSavingsProducts(c.Request.Context())
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusOK, products)
}

func handleSavingsDeposit(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req savingsDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	position, err := earnService.SavingsDeposit(c.Request.Context(), user.ID, req.ProductID, req.Amount)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusCreated, position)
}

type savingsDepositRequest struct {
	ProductID string  `json:"productId"`
	Amount    float64 `json:"amount"`
}

func handleSavingsWithdraw(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req savingsWithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	position, payout, err := earnService.SavingsWithdraw(c.Request.Context(), user.ID, req.PositionID, req.Amount)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"position": position, "payout": payout})
}

type savingsWithdrawRequest struct {
	PositionID string  `json:"positionId"`
	Amount     float64 `json:"amount"`
}

func handleGetSavingsPositions(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	positions, err := earnService.ListSavingsPositions(c.Request.Context(), user.ID)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusOK, positions)
}

func handleGetLendingProducts(c *gin.Context) {
	products := tradingSvc.GetLendingProducts(c.Request.Context())
	c.JSON(http.StatusOK, products)
}

func handleLend(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req lendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	position, err := earnService.Lend(c.Request.Context(), user.ID, req.Asset, req.Amount, req.APY)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusCreated, position)
}

type lendRequest struct {
	Asset  string  `json:"asset"`
	Amount float64 `json:"amount"`
	APY    float64 `json:"apy"`
}

func handleBorrow(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req borrowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	position, err := earnService.Borrow(c.Request.Context(), user.ID, req.Asset, req.Amount, req.APY,
		req.CollateralAsset, req.Collateral, req.LTV)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusCreated, position)
}

type borrowRequest struct {
	Asset           string  `json:"asset"`
	Amount          float64 `json:"amount"`
	APY             float64 `json:"apy"`
	CollateralAsset string  `json:"collateralAsset"`
	Collateral      float64 `json:"collateral"`
	LTV             float64 `json:"ltv"`
}

func handleGetLendingPositions(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	lend, err := earnService.ListLendPositions(c.Request.Context(), user.ID)
	if err != nil {
		earnError(c, err)
		return
	}
	borrow, err := earnService.ListBorrowPositions(c.Request.Context(), user.ID)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"lends": lend, "borrows": borrow})
}

// ============================================================================
// SUB-ACCOUNTS & API KEYS
// ============================================================================

func handleGetSubAccounts(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	subs, err := earnService.ListSubAccounts(c.Request.Context(), user.ID)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusOK, subs)
}

func handleCreateSubAccount(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req createSubAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	sub, err := earnService.CreateSubAccount(c.Request.Context(), user.ID, req.Name, req.Email)
	if err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusCreated, sub)
}

type createSubAccountRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func handleDeleteSubAccount(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	if err := earnService.DeleteSubAccount(c.Request.Context(), user.ID, c.Param("subAccountId")); err != nil {
		earnError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
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
		UserID:      user.ID,
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

type Enable2FARequest struct {
	// Secret is the base32 secret from the setup step.
	Secret string `json:"secret" binding:"required"`
	// Code is the current TOTP code from the authenticator app.
	Code string `json:"code" binding:"required"`
}

// handleEnable2FA enrols TOTP. The client first calls GET /security/2fa/setup
// to obtain a secret and otpauth URI, then calls this endpoint with a code
// proving the secret was imported. Storing the secret without that proof would
// leave the second factor unverified and the user locked out.
func handleEnable2FA(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req Enable2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key, err := totp.DecodeSecret(req.Secret)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid 2FA secret"})
		return
	}
	if !totp.Validate(totp.Config{Secret: key}, req.Code, time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid 2FA code"})
		return
	}

	user.TwoFactorEnabled = true
	user.TwoFactorSecret = totp.EncodeSecret(key)
	if err := authService.UpdateUser(c.Request.Context(), user); err != nil {
		if errors.Is(err, auth.ErrStoreUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "2FA enrolment is unavailable"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to enable 2FA"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"enabled": true})
}

// handleSetup2FA issues a fresh secret and provisioning URI. The secret is not
// persisted until the user proves they can produce a code from it.
func handleSetup2FA(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	key, err := totp.GenerateSecret(20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate 2FA secret"})
		return
	}
	uri, err := totp.ProvisioningURI("TigerEx", user.Email, totp.Config{Secret: key})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build provisioning URI"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"secret": totp.EncodeSecret(key),
		"uri":    uri,
	})
}

type Disable2FARequest struct {
	Code string `json:"code" binding:"required"`
}

// handleDisable2FA turns 2FA off after verifying a current code, so a stolen
// session alone cannot remove the second factor.
func handleDisable2FA(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req Disable2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !user.TwoFactorEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "2FA is not enabled"})
		return
	}

	key, err := totp.DecodeSecret(user.TwoFactorSecret)
	if err != nil || !totp.Validate(totp.Config{Secret: key}, req.Code, time.Now()) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid 2FA code"})
		return
	}

	user.TwoFactorEnabled = false
	user.TwoFactorSecret = ""
	if err := authService.UpdateUser(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to disable 2FA"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"enabled": false})
}

type WithdrawalWhitelistRequest struct {
	// Action is "add", "remove", or "list".
	Action  string `json:"action" binding:"required"`
	Asset   string `json:"asset,omitempty"`
	Network string `json:"network,omitempty"`
	Address string `json:"address,omitempty"`
	Memo    string `json:"memo,omitempty"`
	Label   string `json:"label,omitempty"`
	// AddressID identifies the entry to remove.
	AddressID string `json:"addressId,omitempty"`
}

// handleSetWithdrawalWhitelist manages the list of addresses a withdrawal may
// be sent to.
//
// This is the control that stops a stolen session from draining an account: the
// withdrawal handler refuses any address that is not on this list once the list
// is non-empty.
func handleSetWithdrawalWhitelist(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req WithdrawalWhitelistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store, ok := securityStoreOrUnavailable(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "list":
		addresses, err := store.ListWithdrawalAddresses(ctx, user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list addresses"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"addresses": addresses})
		return

	case "add":
		asset := strings.ToUpper(strings.TrimSpace(req.Asset))
		network := strings.ToLower(strings.TrimSpace(req.Network))
		if err := auth.ValidateWithdrawalAddress(asset, network, req.Address); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		entry := &api.WithdrawalAddress{
			ID:        uuid.New().String(),
			UserID:    user.ID,
			Asset:     asset,
			Network:   network,
			Address:   strings.TrimSpace(req.Address),
			Memo:      strings.TrimSpace(req.Memo),
			Label:     strings.TrimSpace(req.Label),
			CreatedAt: api.Now(),
		}
		if err := store.AddWithdrawalAddress(ctx, entry); err != nil {
			if errors.Is(err, auth.ErrDuplicateAddress) {
				c.JSON(http.StatusConflict, gin.H{"error": "Address is already whitelisted"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add address"})
			return
		}
		if _, err := store.BumpSecurityVersion(ctx, user.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update security version"})
			return
		}
		c.JSON(http.StatusCreated, entry)
		return

	case "remove":
		if strings.TrimSpace(req.AddressID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "addressId is required"})
			return
		}
		if err := store.RemoveWithdrawalAddress(ctx, user.ID, req.AddressID); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Address not found"})
			return
		}
		if _, err := store.BumpSecurityVersion(ctx, user.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update security version"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"removed": true})
		return

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "action must be add, remove, or list"})
	}
}

type IPWhitelistRequest struct {
	// KeyID identifies the API key. It is required: an IP allowlist belongs to
	// one key, not to the account.
	KeyID string `json:"keyId" binding:"required"`
	// IPs is the full replacement list of addresses or CIDR blocks. An empty
	// list removes the restriction.
	IPs []string `json:"ips"`
}

// handleSetIPWhitelist replaces the IP allowlist on one API key.
func handleSetIPWhitelist(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req IPWhitelistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rules, err := auth.ValidateIPWhitelist(req.IPs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store, ok := securityStoreOrUnavailable(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()
	if err := store.SetAPIKeyIPWhitelist(ctx, user.ID, req.KeyID, rules); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key not found"})
		return
	}
	if _, err := store.BumpSecurityVersion(ctx, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update security version"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ips": rules})
}

type AntiPhishingRequest struct {
	Code string `json:"code"`
}

// handleSetAntiPhishing sets or clears the anti-phishing code that appears in
// every message the exchange sends.
func handleSetAntiPhishing(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req AntiPhishingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := strings.TrimSpace(req.Code)
	if err := auth.ValidateAntiPhishingCode(code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store, ok := securityStoreOrUnavailable(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()
	settings, err := authService.GetSettings(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load settings"})
		return
	}
	settings.AntiPhishingCode = code

	if err := store.UpdateSettings(ctx, settings); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save anti-phishing code"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"antiPhishingCode": code})
}

// ============================================================================
// KYC HANDLERS
// ============================================================================

func handleGetKYCStatus(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	status, err := kycService.GetStatus(c.Request.Context(), user.ID)
	if err != nil {
		if errors.Is(err, kyc.ErrStoreUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "KYC is unavailable"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get KYC status"})
		return
	}

	c.JSON(http.StatusOK, status)
}

type SubmitKYCRequest struct {
	DocumentType string `json:"documentType" binding:"required,oneof=passport national_id drivers_license"`
	FirstName    string `json:"firstName" binding:"required"`
	LastName     string `json:"lastName" binding:"required"`
	DOB          string `json:"dob" binding:"required"`
	Country      string `json:"country" binding:"required"`
	DocumentID   string `json:"documentId" binding:"required"`
	Address      string `json:"address"`
	City         string `json:"city"`
	State        string `json:"state"`
	ZipCode      string `json:"zipCode"`
}

func handleSubmitKYC(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req SubmitKYCRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := kycService.Submit(c.Request.Context(), &kyc.SubmissionRequest{
		UserID:       user.ID,
		DocumentType: req.DocumentType,
		FirstName:    req.FirstName,
		LastName:     req.LastName,
		DOB:          req.DOB,
		Country:      req.Country,
		DocumentID:   req.DocumentID,
		Address:      req.Address,
		City:         req.City,
		State:        req.State,
		ZipCode:      req.ZipCode,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

type VerifyContactRequest struct {
	// Code is the one-time code delivered to the phone or mailbox.
	Code string `json:"code" binding:"required"`
	// Value is the phone number in E.164 format, or the email address.
	Value string `json:"value" binding:"required"`
}

// handleVerifyPhone validates a phone number. Delivery and checking of the
// one-time code is performed by the notification service; this endpoint only
// accepts a well-formed number and requires that a code was presented.
func handleVerifyPhone(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req VerifyContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := kycService.VerifyPhone(c.Request.Context(), user.ID, req.Value); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user.Phone = req.Value
	if err := authService.UpdateUser(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record phone number"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"verified": true})
}

// handleVerifyEmail validates an email address for the account.
func handleVerifyEmail(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req VerifyContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := kycService.VerifyEmail(c.Request.Context(), user.ID, req.Value); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"verified": true})
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

// handleUpdateSettings updates the mutable display and security preferences.
// The anti-phishing code is handled by its own endpoint so it can be audited
// separately.
func handleUpdateSettings(c *gin.Context) {
	user := c.MustGet("user").(*api.User)

	var req api.UserSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The caller cannot change which account is being edited.
	req.UserID = user.ID

	if err := auth.ValidateSettings(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store, ok := securityStoreOrUnavailable(c)
	if !ok {
		return
	}

	if err := store.UpdateSettings(c.Request.Context(), &req); err != nil {
		if errors.Is(err, auth.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update settings"})
		return
	}

	c.JSON(http.StatusOK, req)
}

// ============================================================================
// WEBSOCKET HANDLER
// ============================================================================

func handleWebSocket(c *gin.Context) {
	ws.HandleWebSocket(wsHub)(c.Writer, c.Request)
}

// ============================================================================
// ADMIN HANDLERS
// ============================================================================

// requireAdminStore reports whether the admin data layer is available.
func requireAdminStore(c *gin.Context) bool {
	if adminStore == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": admin.ErrUnavailable.Error()})
		return false
	}
	return true
}

// adminError maps an admin error to an HTTP status.
func adminError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, admin.ErrUserNotFound),
		errors.Is(err, admin.ErrWithdrawalNotFound),
		errors.Is(err, admin.ErrMarketNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, admin.ErrInvalidKYCLevel),
		errors.Is(err, admin.ErrInvalidStatus):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, admin.ErrAlreadyDecided):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, admin.ErrUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "request could not be completed"})
	}
}

// auditAdmin records an operator action. A failure to write the audit trail is
// logged but does not fail the request, because the action itself has already
// been committed; losing the audit line is preferable to telling the operator
// the change failed when it did not.
func auditAdmin(c *gin.Context, action, resourceType, resourceID string, details any) {
	if adminStore == nil {
		return
	}
	user, ok := c.Get("user")
	if !ok {
		return
	}
	adminUser, ok := user.(*api.User)
	if !ok {
		return
	}

	entry := &admin.AuditEntry{
		AdminID:      adminUser.ID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		IPAddress:    c.ClientIP(),
		UserAgent:    c.Request.UserAgent(),
	}
	if details != nil {
		if encoded, err := json.Marshal(details); err == nil {
			entry.Details = encoded
		}
	}

	if err := adminStore.AppendAudit(c.Request.Context(), entry); err != nil {
		log.Printf("failed to write audit entry for %s: %v", action, err)
	}
}

// pagingFromQuery reads limit and offset, defaulting to a bounded page.
func pagingFromQuery(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	return limit, offset
}

func handleAdminGetUsers(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}
	limit, offset := pagingFromQuery(c)

	users, total, err := adminStore.ListUsers(c.Request.Context(), limit, offset)
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users, "total": total})
}

func handleAdminGetUser(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	user, err := adminStore.GetUser(c.Request.Context(), c.Param("userId"))
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, user)
}

func handleAdminUpdateKYC(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	var req adminUpdateKYCRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	userID := c.Param("userId")
	if err := adminStore.SetKYCLevel(c.Request.Context(), userID, req.Level, req.Status); err != nil {
		adminError(c, err)
		return
	}

	auditAdmin(c, "kyc.update", "user", userID, gin.H{"level": req.Level, "status": req.Status})
	c.JSON(http.StatusOK, gin.H{"userId": userID, "kycLevel": req.Level, "status": req.Status})
}

type adminUpdateKYCRequest struct {
	Level  int    `json:"level"`
	Status string `json:"status"`
}

func handleAdminGetAllOrders(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}
	limit, offset := pagingFromQuery(c)

	orders, total, err := adminStore.ListOrders(c.Request.Context(), c.Query("symbol"), limit, offset)
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders, "total": total})
}

func handleAdminGetWithdrawals(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}
	limit, offset := pagingFromQuery(c)

	withdrawals, total, err := adminStore.ListWithdrawals(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": withdrawals, "total": total})
}

func handleAdminApproveWithdrawal(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	adminUser := c.MustGet("user").(*api.User)
	withdrawalID := c.Param("withdrawalId")

	record, err := adminStore.ApproveWithdrawal(c.Request.Context(), withdrawalID, adminUser.ID)
	if err != nil {
		adminError(c, err)
		return
	}

	auditAdmin(c, "withdrawal.approve", "withdrawal", withdrawalID, gin.H{
		"asset":  record.Asset,
		"amount": record.Amount,
		"status": record.Status,
	})
	c.JSON(http.StatusOK, record)
}

func handleAdminRejectWithdrawal(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	var req adminRejectWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	adminUser := c.MustGet("user").(*api.User)
	withdrawalID := c.Param("withdrawalId")

	record, err := adminStore.RejectWithdrawal(c.Request.Context(), withdrawalID, adminUser.ID, req.Reason)
	if err != nil {
		adminError(c, err)
		return
	}

	auditAdmin(c, "withdrawal.reject", "withdrawal", withdrawalID, gin.H{
		"reason": req.Reason,
		"status": record.Status,
	})
	c.JSON(http.StatusOK, record)
}

type adminRejectWithdrawalRequest struct {
	Reason string `json:"reason"`
}

func handleAdminGetDeposits(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}
	limit, offset := pagingFromQuery(c)

	deposits, total, err := adminStore.ListDeposits(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deposits": deposits, "total": total})
}

func handleAdminUpdateMarket(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	var req adminUpdateMarketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	symbol := c.Param("symbol")
	if err := adminStore.SetMarketStatus(c.Request.Context(), symbol, req.Status); err != nil {
		adminError(c, err)
		return
	}

	auditAdmin(c, "market.status", "market", symbol, gin.H{"status": req.Status})
	c.JSON(http.StatusOK, gin.H{"symbol": symbol, "status": req.Status})
}

type adminUpdateMarketRequest struct {
	Status string `json:"status"`
}

func handleAdminGetStats(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	stats, err := adminStore.Stats(c.Request.Context())
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, stats)
}

// handleAdminGetMarkets lists every market with its trading status.
func handleAdminGetMarkets(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}

	markets, err := adminStore.ListMarkets(c.Request.Context())
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, markets)
}

// handleAdminGetAudit returns the immutable operator action log.
func handleAdminGetAudit(c *gin.Context) {
	if !requireAdminStore(c) {
		return
	}
	limit, offset := pagingFromQuery(c)

	entries, err := adminStore.ListAudit(c.Request.Context(), limit, offset)
	if err != nil {
		adminError(c, err)
		return
	}
	c.JSON(http.StatusOK, entries)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

func validatePasswordStrength(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}

	var hasUpper, hasLower, hasDigit bool
	for _, c := range password {
		switch {
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= '0' && c <= '9':
			hasDigit = true
		case c >= 33 && c <= 126 && !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')):
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
