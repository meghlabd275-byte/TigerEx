package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/schema"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"
)

// =============================================================================
// CONFIGURATION
// =============================================================================

var (
	// Build info
	BuildVersion   = "3.0.0"
	BuildTime    = time.Now().Format(time.RFC3339)
	GitCommit   = "dev"
	
	// Config
	config       *Config
	dbPool       *pgxpool.Pool
	redisPool    *RedisPool
	
	// Rate limiter
	globalRateLimiter *GlobalLimiter
	
	// Server stats
	serverStats = &ServerStats{
		StartedAt: time.Now(),
	}
)

// Config holds all configuration
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Security SecurityConfig
}

type ServerConfig struct {
	Port            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	MaxHeaderBytes int
	EnableTLS      bool
	TLSCertFile   string
	TLSKeyFile    string
}

type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	MaxOpenConns     int
	MaxIdleConns    int
	MinConnLifetime time.Duration
}

type RedisConfig struct {
	Host string
	Port int
}

type SecurityConfig struct {
	JWT_SECRET          string
	JWT_EXPIRY         time.Duration
	JWT_REFRESH_EXPIRY time.Duration
	BCRYPT_ROUNDS      int
	SESSION_DURATION   time.Duration
	MAX_LOGIN_ATTEMPTS int
	LOCKOUT_DURATION  time.Duration
	
	// Rate limits
	DEFAULT_RATE_LIMIT     int           // requests per minute
	DEFAULT_RATE_BURST int           // burst
	API_KEY_RATE_LIMIT  int           // for API keys per minute
	ADMIN_RATE_LIMIT   int           // for admin endpoints
	
	// Password requirements
	PASSWORD_MIN_LENGTH   int
	PASSWORD_REQUIRE_UPPER bool
	PASSWORD_REQUIRE_LOWER bool
	PASSWORD_REQUIRE_DIGIT bool
	PASSWORD_REQUIRE_SPECIAL bool
}

// =============================================================================
// SERVER STATISTICS
// =============================================================================

type ServerStats struct {
	mu sync.RWMutex
	
	StartedAt         time.Time
	RequestsTotal    int64
	RequestsByMethod map[string]int64
	RequestsByPath  map[string]int64
	ErrorsByCode   map[int]int64
	ActiveUsers   int64
	MaxConcurrent int64
	
	Uptime        time.Duration
	MemoryUsage   uint64
}

func (s *ServerStats) RecordRequest(method, path string, status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.RequestsTotal++
	s.RequestsByMethod[method]++
	s.RequestsByPath[path]++
	if status >= 400 {
		s.ErrorsByCode[status]++
	}
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

// API Response generic wrapper
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

// Pagination
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Page       int       `json:"page"`
	PageSize   int       `json:"pageSize"`
	TotalItems int64     `json:"totalItems"`
	TotalPages int       `json:"totalPages"`
}

// Auth Responses
type LoginResponse struct {
	User          *User   `json:"user"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt   int64  `json:"expiresAt"`
}

type RegisterRequest struct {
	Email           string `json:"email"`
	Username       string `json:"username"`
	Password       string `json:"password"`
	FirstName     string `json:"firstName"`
	LastName      string `json:"lastName"`
	CountryCode   string `json:"countryCode"`
	ReferralCode  string `json:"referralCode,omitempty"`
	TermsAccepted bool   `json:"termsAccepted"`
}

type User struct {
	UserID       string `json:"userId"`
	Email       string `json:"email"`
	Username    string `json:"username"`
	FirstName   string `json:"firstName,omitempty"`
	LastName    string `json:"lastName,omitempty"`
	CountryCode string `json:"countryCode"`
	KYCLevel    int    `json:"kycLevel"`
	AccountStatus string `json:"accountStatus"`
	CreatedAt   int64  `json:"createdAt"`
	TwoFactorEnabled bool  `json:"twoFactorEnabled"`
}

type UserProfile struct {
	User       *User
	Profile    *UserProfileData
	Preferences *UserPreferences
}

type UserProfileData struct {
	Phone         string `json:"phone,omitempty"`
	DateOfBirth string `json:"dateOfBirth,omitempty"`
	Timezone    string `json:"timezone,omitempty"`
	Language    string `json:"language,omitempty"`
}

type UserPreferences struct {
	Theme         string `json:"theme"`
	Currency     string `json:"currency"`
	PriceDisplay string `json:"priceDisplay"`
}

// Wallet Responses
type WalletResponse struct {
	WalletID   string  `json:"walletId"`
	WalletType string  `json:"walletType"`
	Currency  string  `json:"currency"`
	Balance   float64 `json:"balance"`
	Locked    float64 `json:"locked"`
	Available float64 `json:"available"`
}

type BalanceResponse struct {
	Currency  string  `json:"currency"`
	Available float64 `json:"available"`
	Locked    float64 `json:"locked"`
	Total     float64 `json:"total"`
}

// Order Responses
type OrderResponse struct {
	OrderID           string  `json:"orderId"`
	ClientOrderID     string  `json:"clientOrderId,omitempty"`
	MarketSymbol     string  `json:"marketSymbol"`
	Side           string  `json:"side"`
	OrderType       string  `json:"orderType"`
	Quantity        float64 `json:"quantity"`
	FilledQuantity  float64 `json:"filledQuantity"`
	Remaining      float64 `json:"remaining"`
	Price          float64 `json:"price,omitempty"`
	StopPrice      float64 `json:"stopPrice,omitempty"`
	AveragePrice  float64 `json:"avgPrice,omitempty"`
	Commission    float64 `json:"commission"`
	Status        string  `json:"status"`
	TimeInForce   string  `json:"timeInForce"`
	CreatedAt     int64   `json:"createdAt"`
	UpdatedAt     int64   `json:"updatedAt"`
}

type OrderBookResponse struct {
	LastUpdateID int64          `json:"lastUpdateId"`
	Bids      []PriceLevel  `json:"bids"`
	Asks      []PriceLevel  `json:"asks"`
}

type PriceLevel struct {
	Price     float64 `json:"price"`
	Quantity  float64 `json:"quantity"`
	Total     float64 `json:"total,omitempty"`
}

type TickerResponse struct {
	Symbol            string  `json:"symbol"`
	PriceChange       float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	LastPrice        float64 `json:"lastPrice"`
	HighPrice        float64 `json:"highPrice"`
	LowPrice        float64 `json:"lowPrice"`
	Volume          float64 `json:"volume"`
	QuoteVolume     float64 `json:"quoteVolume"`
	TradesCount    int64   `json:"tradesCount"`
}

// Trade Responses
type TradeResponse struct {
	TradeID       string  `json:"tradeId"`
	OrderID      string  `json:"orderId"`
	MarketSymbol string  `json:"symbol"`
	Side        string  `json:"side"`
	Price       float64 `json:"price"`
	Quantity    float64 `json:"quantity"`
	Commission  float64 `json:"commission"`
	IsMaker     bool    `json:"isMaker"`
	Timestamp   int64   `json:"timestamp"`
}

// API Key responses
type APIKeyResponse struct {
	KeyID      string `json:"keyId"`
	KeyName    string `json:"keyName"`
	KeyPrefix  string `json:"keyPrefix"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"createdAt"`
}

// =============================================================================
// GLOBAL RATE LIMITER
// =============================================================================

type GlobalLimiter struct {
	clients    map[string]*ClientLimiter
	defaultLimiter *ClientLimiter
	adminLimiter *ClientLimiter
	mu         sync.RWMutex
}

type ClientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
	banned  bool
}

func NewGlobalLimiter(defaultRate, defaultBurst, adminRate int) *GlobalLimiter {
	return &GlobalLimiter{
		clients: make(map[string]*ClientLimiter),
		defaultLimiter: &ClientLimiter{
			limiter: rate.New(float64(defaultRate), defaultBurst),
		},
		adminLimiter: &ClientLimiter{
			limiter: rate.New(float64(adminRate), adminRate*2),
		},
	}
}

func (g *GlobalLimiter) Allow(key string, isAdmin bool) bool {
	g.mu.RLock()
	var limiter *ClientLimiter
	var ok bool
	
	if isAdmin {
		limiter, ok = g.adminLimiter
	} else {

		limiter, ok = g.clients[key]
		if !ok {
			limiter = g.defaultLimiter
		}
	}
	g.mu.RUnlock()
	
	if limiter == nil || limiter.banned {
		return false
	}
	
	return limiter.limiter.Allow()
}

func (g *GlobalLimiter) Limit(key string, isAdmin bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	
	var limiter *ClientLimiter
	if isAdmin {
		limiter = g.adminLimiter
	} else {
		var ok bool
		limiter, ok = g.clients[key]
		if !ok {
			limiter = &ClientLimiter{
				limiter: rate.New(float64(config.Security.DEFAULT_RATE_LIMIT), config.Security.DEFAULT_RATE_BURST),
			}
			g.clients[key] = limiter
		}
	}
	
	if limiter != nil {
		limiter.lastSeen = time.Now()
	}
}

func (g *GlobalLimiter) GetRemaining(key string, isAdmin bool) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	
	var limiter *ClientLimiter
	var ok bool
	
	if isAdmin {
		limiter, ok = g.adminLimiter
	} else {
		limiter, ok = g.clients[key]
		if !ok {
			limiter = g.defaultLimiter
		}
	}
	
	if limiter == nil || limiter.limiter == nil {
		return 0
	}
	
	// Return remaining tokens estimate
	return int(limiter.limiter.Tokens())
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Logging middleware
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		
		// Create response recorder
		rec := &ResponseRecorder{
			ResponseWriter: w,
			StatusCode:   http.StatusOK,
		}
		
		next.ServeHTTP(rec, r)
		
		duration := time.Since(start)
		
		log.Printf("%s %s %d %v - %s",
			r.Method,
			r.URL.Path,
			rec.StatusCode,
			duration,
			r.RemoteAddr,
		)
		
		serverStats.RecordRequest(r.Method, r.URL.Path, rec.StatusCode)
	})
}

// ResponseRecorder captures response status
type ResponseRecorder struct {
	http.ResponseWriter
	StatusCode int
	Written   bool
}

func (r *ResponseRecorder) WriteHeader(code int) {
	r.StatusCode = code
	r.Written = true
	r.ResponseWriter.WriteHeader(code)
}

// Recovery middleware
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("PANIC: %v", err)
				WriteJSON(w, http.StatusInternalServerError, APIResponse{
					Success: false,
					Error: &APIError{
						Code:    500,
						Message: "Internal server error",
					},
				})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Authentication middleware
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check API key first
		apiKey := r.Header.Get("X-API-Key")
		if apiKey != "" {
			// Validate API key
			userID, err := validateAPIKey(r.Context(), apiKey)
			if err != nil {
				WriteJSON(w, http.StatusUnauthorized, APIResponse{
					Success: false,
					Error: &APIError{Code: 401, Message: "Invalid API key"},
				})
				return
			}
			
			// Set user ID in context
			ctx := context.WithValue(r.Context(), "userID", userID)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		
		// Check JWT token
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			WriteJSON(w, http.StatusUnauthorized, APIResponse{
				Success: false,
				Error: &APIError{Code: 401, Message: "Missing authorization header"},
			})
			return
		}
		
		token := strings.TrimPrefix(authHeader, "Bearer ")
		userID, err := validateJWT(r.Context(), token)
		if err != nil {
			WriteJSON(w, http.StatusUnauthorized, APIResponse{
				Success: false,
				Error: &APIError{Code: 401, Message: "Invalid or expired token"},
			})
			return
		}
		
		ctx := context.WithValue(r.Context(), "userID", userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Optional auth middleware (doesn't require auth, but sets user if present)
func OptionalAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check for user ID in context
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token := strings.TrimPrefix(authHeader, "Bearer ")
			if userID, err := validateJWT(r.Context(), token); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), "userID", userID))
			}
		}
		
		next.ServeHTTP(w, r)
	})
}

// Rate limiting middleware
func RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get client key
		key := r.RemoteAddr
		
		// Check if admin
		isAdmin := false
		if userID := r.Context().Value("userID"); userID != nil {
			if role := r.Context().Value("userRole"); role == "admin" {
				isAdmin = true
			} else {
				key = userID.(string)
			}
		}
		
		// Check rate limit
		if !globalRateLimiter.Allow(key, isAdmin) {
			remaining := globalRateLimiter.GetRemaining(key, isAdmin)
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			
			WriteJSON(w, http.StatusTooManyRequests, APIResponse{
				Success: false,
				Error:  &APIError{Code: 429, Message: "Rate limit exceeded"},
			})
			return
		}
		
		globalRateLimiter.Limit(key, isAdmin)
		
		next.ServeHTTP(w, r)
	})
}

// CORS middleware
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, X-Request-ID")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, X-RateLimit-Remaining")
		}
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// WriteJSON helper
func WriteJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-ID", uuid.New().String()[:8])
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// ParseJSON helper
func ParseJSON(r *http.Request, dest interface{}) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

// Form decoder
var formDecoder = schema.NewDecoder()

func ParseForm(r *http.Request, dest interface{}) error {
	if err := r.ParseForm(); err != nil {
		return err
	}
	return formDecoder.Decode(dest, r.Form)
}

// Get user ID from context
func GetUserID(ctx context.Context) (string, error) {
	userID := ctx.Value("userID")
	if userID == nil {
		return "", errors.New("no user in context")
	}
	return userID.(string), nil
}

// Require user ID
func RequireUserID(ctx context.Context) (string, error) {
	userID, err := GetUserID(ctx)
	if err != nil {
		return "", err
	}
	
	// Validate user still exists and active
	status, err := getUserStatus(ctx, userID)
	if err != nil {
		return "", err
	}
	
	if status != "active" {
		return "", errors.New("account not active")
	}
	
	return userID, nil
}

// =============================================================================
// VALIDATORS
// =============================================================================

// Email validation
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

func ValidateEmail(email string) error {
	if !emailRegex.MatchString(email) {
		return errors.New("invalid email format")
	}
	if len(email) > 255 {
		return errors.New("email too long")
	}
	return nil
}

// Username validation
var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,20}$`)

func ValidateUsername(username string) error {
	if !usernameRegex.MatchString(username) {
		return errors.New("username must be 3-20 alphanumeric characters")
	}
	return nil
}

// Password validation
func ValidatePassword(password string, config *SecurityConfig) error {
	if len(password) < config.PASSWORD_MIN_LENGTH {
		return fmt.Errorf("password must be at least %d characters", config.PASSWORD_MIN_LENGTH)
	}
	
	hasUpper := false
	hasLower := false
	hasDigit := false
	hasSpecial := false
	
	for _, c := range password {
		switch {
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= '0' && c <= '9':
			hasDigit = true
		case strings.ContainsRune("!@#$%^&*()_+-=[]{}|;:,.<>?", c):
			hasSpecial = true
		}
	}
	
	if config.PASSWORD_REQUIRE_UPPER && !hasUpper {
		return errors.New("password must contain uppercase letter")
	}
	if config.PASSWORD_REQUIRE_LOWER && !hasLower {
		return errors.New("password must contain lowercase letter")
	}
	if config.PASSWORD_REQUIRE_DIGIT && !hasDigit {
		return errors.New("password must contain digit")
	}
	if config.PASSWORD_REQUIRE_SPECIAL && !hasSpecial {
		return errors.New("password must contain special character")
	}
	
	return nil
}

// Symbol validation
var symbolRegex = regexp.MustCompile(`^[A-Z0-9]+/[A-Z]+$`)

func ValidateMarketSymbol(symbol string) error {
	if !symbolRegex.MatchString(symbol) {
		return errors.New("invalid symbol format")
	}
	return nil
}

// =============================================================================
// DATABASE HELPERS
// =============================================================================

// Get user status
func getUserStatus(ctx context.Context, userID string) (string, error) {
	var status string
	err := dbPool.QueryRow(ctx,
		"SELECT account_status FROM users WHERE user_id = $1",
		userID,
	).Scan(&status)
	
	if err == pgx.ErrNoRows {
		return "", errors.New("user not found")
	}
	if err != nil {
		return "", err
	}
	
	return status, nil
}

// Validate API key
func validateAPIKey(ctx context.Context, keyHash string) (string, error) {
	var userID string
	err := dbPool.QueryRow(ctx,
		`SELECT user_id FROM api_keys 
		 WHERE key_hash = $1 AND status = 'active' 
		 AND (expires_at IS NULL OR expires_at > NOW())`,
		keyHash,
	).Scan(&userID)
	
	if err == pgx.ErrNoRows {
		return "", errors.New("invalid key")
	}
	if err != nil {
		return "", err
	}
	
	return userID, nil
}

// Generate JWT validation
func validateJWT(ctx context.Context, token string) (string, error) {
	// Decode JWT (simplified - should use proper JWT library in production)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("invalid token format")
	}
	
	// Decode payload
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	
	var claims struct {
		UserID   string `json:"userId"`
		Expiry  int64  `json:"exp"`
		Scope   string `json:"scope"`
	}
	
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", err
	}
	
	// Check expiry
	if claims.Expiry > 0 && claims.Expiry < time.Now().Unix() {
		return "", errors.New("token expired")
	}
	
	return claims.UserID, nil
}

// =============================================================================
// ENCRYPTION
// =============================================================================

// Encrypt data with AES-GCM
func EncryptData(key, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt data with AES-GCM
func DecryptData(key []byte, ciphertext string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, err
	}
	
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	
	return plaintext, nil
}

// Hash password with bcrypt-like cost
func HashPassword(password, salt []byte) ([]byte, int, error) {
	// Simplified - use proper bcrypt in production
	h := sha256.Sum256(append(password, salt...))
	return h[:], 12, nil
}

// Constant-time compare (prevent timing attacks)
func ConstCompare(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// =============================================================================
// REDIS POOL (Stub)
// =============================================================================

type RedisPool struct{}

func (r *RedisPool) Get(conn *pgx.Conn) (*pgx.Conn, error) {
	return conn, nil
}

func (r *RedisPool) Close() error {
	return nil
}

// =============================================================================
// HANDLERS
// =============================================================================

// Root handler
func RootHandler(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"name":    "TigerEx API",
			"version": BuildVersion,
			"time":    time.Now().Unix(),
		},
	})
}

// Health handler
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	health := map[string]interface{}{
		"status": "healthy",
	}
	
	// Check database
	if err := dbPool.Ping(r.Context()); err != nil {
		health["status"] = "degraded"
		health["database"] = "unhealthy"
		health["databaseError"] = err.Error()
	} else {
		health["database"] = "healthy"
	}
	
	// Memory
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	health["memoryAlloc"] = mem.Alloc
	health["memoryTotal"] = mem.TotalAlloc
	
	// Stats
	serverStats.mu.RLock()
	health["requestsTotal"] = serverStats.RequestsTotal
	health["uptimeSeconds"] = time.Since(serverStats.StartedAt).Seconds()
	serverStats.mu.RUnlock()
	
	status := http.StatusOK
	if health["status"] != "healthy" {
		status = http.StatusServiceUnavailable
	}
	
	WriteJSON(w, status, APIResponse{Success: health["status"] == "healthy", Data: health})
}

// =============================================================================
// USER HANDLERS
// =============================================================================

// Register handler
func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		WriteJSON(w, http.StatusMethodNotAllowed, APIResponse{
			Success: false,
			Error:   &APIError{Code: 405, Message: "Method not allowed"},
		})
		return
	}
	
	var req RegisterRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid request body"},
		})
		return
	}
	
	// Validate fields
	if err := ValidateEmail(req.Email); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: err.Error(), Field: "email"},
		})
		return
	}
	
	if req.Username != "" {
		if err := ValidateUsername(req_USERNAME); err != nil {
			WriteJSON(w, http.StatusBadRequest, APIResponse{
				Success: false,
				Error:   &APIError{Code: 400, Message: err.Error(), Field: "username"},
			})
			return
		}
	}
	
	if err := ValidatePassword(req.Password, &config.Security); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: err.Error(), Field: "password"},
		})
		return
	}
	
	if !req.TermsAccepted {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Terms must be accepted", Field: "termsAccepted"},
		})
		return
	}
	
	// Generate user ID
	userID := uuid.New().String()
	
	// Hash password
	salt := make([]byte, 16)
	rand.Read(salt)
	passwordHash, _, err := HashPassword([]byte(req.Password), salt)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to process password"},
		})
		return
	}
	
	// Generate salts
	saltStr := hex.EncodeToString(salt)
	hashStr := hex.EncodeToString(passwordHash)
	
	// Generate referral code
	referralCode := generateReferralCode(req.Email)
	
	// Check referral code validity
	var referrerID *string
	if req.ReferralCode != "" {
		var exists bool
		err := dbPool.QueryRow(r.Context(),
			"SELECT true FROM users WHERE referral_code = $1 AND account_status = 'active'",
			req.ReferralCode,
		).Scan(&exists)
		
		if err == nil {
			referrerID = &req.ReferralCode
		}
	}
	
	// Create user
	_, err = dbPool.Exec(r.Context(),
		`INSERT INTO users (user_id, email, username, password_hash, password_salt, 
		 country_code, referral_code, referrer_id, account_status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())`,
		userID, req.Email, req.Username, hashStr, saltStr, req.CountryCode, referralCode, referrerID,
	)
	
	if err != nil {
		// Check duplicate
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			WriteJSON(w, http.StatusConflict, APIResponse{
				Success: false,
				Error:   &APIError{Code: 409, Message: "Email already registered"},
			})
			return
		}
		
		log.Printf("Register error: %v", err)
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to create account"},
		})
		return
	}
	
	// Create default wallet (spot USDT)
	walletID := uuid.New().String()
	dbPool.Exec(r.Context(),
		`INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, is_default)
		 VALUES ($1, $2, 'spot', 'USDT', true)`,
		walletID, userID,
	)
	
	// Generate tokens
	accessToken, expiresAt, err := generateAccessToken(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to generate token"},
		})
		return
	}
	
	refreshToken, _, err := generateRefreshToken(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to generate token"},
		})
		return
	}
	
	// Return response
	user := &User{
		UserID:        userID,
		Email:        req.Email,
		Username:     req.Username,
		CountryCode:  req.CountryCode,
		KYCLevel:     0,
		AccountStatus: "active",
		CreatedAt:   time.Now().Unix(),
	}
	
	WriteJSON(w, http.StatusCreated, APIResponse{
		Success: true,
		Data: LoginResponse{
			User:          user,
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresAt:    expiresAt,
		},
	})
}

// Login handler
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		WriteJSON(w, http.StatusMethodNotAllowed, APIResponse{
			Success: false,
			Error:   &APIError{Code: 405, Message: "Method not allowed"},
		})
		return
	}
	
	var req struct {
		Email       string `json:"email"`
		Password   string `json:"password"`
		TwoFactorCode string `json:"twoFactorCode,omitempty"`
	}
	
	if err := ParseJSON(r, &req); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid request body"},
		})
		return
	}
	
	// Get user
	var userID, passwordHash, passwordSalt, accountStatus string
	var twoFactorSecret sql.NullString
	var loginAttempts int
	var lockedUntil sql.NullTime
	
	err := dbPool.QueryRow(r.Context(),
		`SELECT user_id, password_hash, password_salt, account_status, 
		 two_factor_secret, login_attempts, locked_until
		 FROM users WHERE email = $1`,
		req.Email,
	).Scan(&userID, &passwordHash, &passwordSalt, &accountStatus, &twoFactorSecret, &loginAttempts, &lockedUntil)
	
	if err == pgx.ErrNoRows {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: "Invalid credentials"},
		})
		return
	}
	
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Login failed"},
		})
		return
	}
	
	// Check account status
	if accountStatus == "locked" || accountStatus == "suspended" {
		msg := "Account is " + accountStatus
		if lockedUntil.Valid {
			msg += " until " + lockedUntil.Time.Format(time.RFC3339)
		}
		WriteJSON(w, http.StatusForbidden, APIResponse{
			Success: false,
			Error:   &APIError{Code: 403, Message: msg},
		})
		return
	}
	
	// Check lockout
	if lockedUntil.Valid && lockedUntil.Time.After(time.Now()) {
		retryAfter := int(time.Until(lockedUntil.Time).Seconds())
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		WriteJSON(w, http.StatusTooManyRequests, APIResponse{
			Success: false,
			Error:   &APIError{Code: 429, Message: "Account is temporarily locked"},
		})
		return
	}
	
	// Verify password
	salt, _ := hex.DecodeString(passwordSalt)
	expectedHash, _, _ := HashPassword([]byte(req.Password), salt)
	
	if hex.EncodeToString(expectedHash) != passwordHash {
		// Increment failed login attempts
		dbPool.Exec(r.Context(),
			`UPDATE users SET 
			 login_attempts = login_attempts + 1,
			 locked_until = CASE 
			  WHEN login_attempts >= $1 THEN NOW() + interval '15 minutes'
			  ELSE NULL END,
			 updated_at = NOW()
			 WHERE user_id = $2`,
			config.Security.MAX_LOGIN_ATTEMPTS, userID,
		)
		
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: "Invalid credentials"},
		})
		return
	}
	
	// Check 2FA
	if twoFactorSecret.Valid {
		if req.TwoFactorCode == "" {
			WriteJSON(w, http.StatusBadRequest, APIResponse{
				Success: false,
				Error:   &APIError{Code: 400, Message: "Two-factor code required"},
			})
			return
		}
		
		// Verify 2FA code (simplified - use proper TOTP in production)
		codeValid := req.TwoFactorCode == "123456" // Replace with actual verification
		if !codeValid {
			dbPool.Exec(r.Context(),
				"UPDATE users SET login_attempts = login_attempts + 1, updated_at = NOW() WHERE user_id = $1",
				userID,
			)
			WriteJSON(w, http.StatusUnauthorized, APIResponse{
				Success: false,
				Error:   &APIError{Code: 401, Message: "Invalid two-factor code"},
			})
			return
		}
	}
	
	// Reset login attempts
	dbPool.Exec(r.Context(),
		"UPDATE users SET login_attempts = 0, last_login_at = NOW(), updated_at = NOW() WHERE user_id = $1",
		userID,
	)
	
	// Update last login IP
	dbPool.Exec(r.Context(),
		"UPDATE users SET last_login_ip = $1 WHERE user_id = $2",
		r.RemoteAddr, userID,
	)
	
	// Generate tokens
	accessToken, expiresAt, err := generateAccessToken(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to generate token"},
		})
		return
	}
	
	refreshToken, _, err := generateRefreshToken(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to generate token"},
		})
		return
	}
	
	// Get user info
	var user User
	err = dbPool.QueryRow(r.Context(),
		`SELECT user_id, email, username, country_code, kyc_level, 
		 account_status, two_factor_enabled, created_at
		 FROM users WHERE user_id = $1`,
		userID,
	).Scan(&user.UserID, &user.Email, &user.Username, &user.CountryCode,
		&user.KYCLevel, &user.AccountStatus, &user.TwoFactorEnabled, &user.CreatedAt)
	
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to get user info"},
		})
		return
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: LoginResponse{
			User:          &user,
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresAt:    expiresAt,
		},
	})
}

// Get profile handler
func GetProfileHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	var profile UserProfile
	err = dbPool.QueryRow(r.Context(),
		`SELECT u.user_id, u.email, u.username, u.first_name, u.last_name,
		 u.country_code, u.account_status, u.kyc_level, u.two_factor_enabled,
		 u.created_at, p.phone, p.date_of_birth, p.timezone, p.language
		 FROM users u
		 LEFT JOIN user_profiles p ON u.user_id = p.user_id
		 WHERE u.user_id = $1`,
		userID,
	).Scan(
		&profile.User.UserID, &profile.User.Email, &profile.User.Username,
		&profile.User.FirstName, &profile.User.LastName,
		&profile.User.CountryCode, &profile.User.AccountStatus,
		&profile.User.KYCLevel, &profile.User.TwoFactorEnabled,
		&profile.User.CreatedAt, &profile.Profile.Phone,
		&profile.Profile.DateOfBirth, &profile.Profile.Timezone,
		&profile.Profile.Language,
	)
	
	if err == pgx.ErrNoRows {
		WriteJSON(w, http.StatusNotFound, APIResponse{
			Success: false,
			Error:   &APIError{Code: 404, Message: "User not found"},
		})
		return
	}
	
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to get profile"},
		})
		return
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{Success: true, Data: &profile})
}

// Token helpers
func generateAccessToken(userID string) (string, int64, error) {
	now := time.Now()
	expires := now.Add(config.Security.JWT_EXPIRY)
	
	claims := map[string]interface{}{
		"userId": userID,
		"type":  "access",
		"exp":   expires.Unix(),
		"iat":   now.Unix(),
	}
	
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", 0, err
	}
	
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	token := fmt.Sprintf("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.%s.signature", encoded)
	
	return token, expires.Unix(), nil
}

func generateRefreshToken(userID string) (string, int64, error) {
	return generateAccessToken(userID)
}

func generateReferralCode(email string) string {
	hasher := sha256.New()
	hasher.Write([]byte(email + time.Now().Format(time.RFC3339Nano)))
	hash := hasher.Sum(nil)
	
	code := make([]byte, 0)
	for _, b := range hash[:6] {
		if b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' {
			code = append(code, b)
		}
		if len(code) >= 8 {
			break
		}
	}
	
	return string(code)
}

// =============================================================================
// ACCOUNT HANDLERS
// =============================================================================

// Get account info
func GetAccountHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	// Query account info
	var info struct {
		UserID         string `json:"userId"`
		Email          string `json:"email"`
		Username      string `json:"username"`
		AccountStatus string `json:"accountStatus"`
		KYCLevel      int    `json:"kycLevel"`
		IsEnabled     bool   `json:"isTradingEnabled"`
		CanDeposit   bool   `json:"canDeposit"`
		CanWithdraw bool   `json:"canWithdraw"`
		CreatedAt     int64  `json:"createdAt"`
	}
	
	err = dbPool.QueryRow(r.Context(),
		`SELECT user_id, email, username, account_status, kyc_level,
		 trading_enabled, deposit_enabled, withdrawal_enabled, created_at
		 FROM users WHERE user_id = $1`,
		userID,
	).Scan(&info.UserID, &info.Email, &info.Username, &info.AccountStatus,
		&info.KYCLevel, &info.IsEnabled, &info.CanDeposit, &info.CanWithdraw, &info.CreatedAt)
	
	if err != nil {
		WriteJSON(w, http.StatusNotFound, APIResponse{
			Success: false,
			Error:   &APIError{Code: 404, Message: "User not found"},
		})
		return
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{Success: true, Data: &info})
}

// Logout handler
func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	userID, _ := GetUserID(r.Context())
	
	if userID != "" {
		// Revoke session
		dbPool.Exec(r.Context(),
			"DELETE FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()",
			userID,
		)
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:   map[string]string{"message": "Logged out successfully"},
	})
}

// =============================================================================
// WALLET HANDLERS
// =============================================================================

// Get balance handler
func GetBalanceHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	walletType := r.URL.Query().Get("walletType")
	if walletType == "" {
		walletType = "spot"
	}
	
	var balances []BalanceResponse
	
	rows, err := dbPool.Query(r.Context(),
		`SELECT b.currency, b.available_amount, b.locked_amount,
		 b.available_amount + b.locked_amount AS total
		 FROM balances b
		 JOIN wallets w ON b.wallet_id = w.wallet_id
		 WHERE b.user_id = $1 AND w.wallet_type = $2
		 AND (b.available_amount > 0 OR b.locked_amount > 0)`,
		userID, walletType,
	)
	
	if err != nil && err != pgx.ErrNoRows {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to get balances"},
		})
		return
	}
	defer rows.Close()
	
	for rows.Next() {
		var b BalanceResponse
		if err := rows.Scan(&b.Currency, &b.Available, &b.Locked, &b.Total); err != nil {
			continue
		}
		balances = append(balances, b)
	}
	
	if len(balances) == 0 {
		balances = []BalanceResponse{}
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    balances,
	})
}

// Get deposit address handler
func GetDepositAddressHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	currency := r.URL.Query().Get("currency")
	network := r.URL.Query().Get("network")
	
	if currency == "" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "currency is required"},
		})
		return
	}
	
	// Get or create deposit address
	var addressID, address, addressTag string
	
	err = dbPool.QueryRow(r.Context(),
		`SELECT address_id, address, address_tag 
		 FROM wallet_addresses
		 WHERE user_id = $1 AND currency = $2 
		 AND (network = $3 OR ($3 IS NULL AND network IS NULL))
		 AND is_default_for_deposit = true`,
		userID, currency, network,
	).Scan(&addressID, &address, &addressTag)
	
	if err == pgx.ErrNoRows {
		// Generate new address (simplified - use actual blockchain in prod)
		addressID = uuid.New().String()
		address = generateCryptoAddress(currency)
		
		_, err = dbPool.Exec(r.Context(),
			`INSERT INTO wallet_addresses 
			 (address_id, user_id, currency, network, address, is_default_for_deposit)
			 VALUES ($1, $2, $3, $4, $5, true)`,
			addressID, userID, currency, network, address,
		)
		
		if err != nil {
			WriteJSON(w, http.StatusInternalServerError, APIResponse{
				Success: false,
				Error:   &APIError{Code: 500, Message: "Failed to generate address"},
			})
			return
		}
	}
	
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to get address"},
		})
		return
	}
	
	response := map[string]interface{}{
		"address":    address,
		"addressTag": addressTag,
		"currency":  currency,
		"network":   network,
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{Success: true, Data: response})
}

// Generate crypto address (simplified)
func generateCryptoAddress(currency string) string {
	prefix := map[string]string{
		"BTC": "bc1q",
		"ETH": "0x",
		"USDT": "0x",
	}
	
	pre := prefix[currency]
	if pre == "" {
		pre = currency[:3]
	}
	
	buf := make([]byte, 34)
	rand.Read(buf)
	return pre + hex.EncodeToString(buf)[:len(buf)]
}

// =============================================================================
// TRADING HANDLERS
// =============================================================================

// Get order book
func GetOrderBookHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	symbol := vars["symbol"]
	
	if err := ValidateMarketSymbol(symbol); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: err.Error()},
		})
		return
	}
	
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	
	// Get order book from database (simplified - use Redis cache in production)
	var bids, asks []PriceLevel
	
	bidRows, err := dbPool.Query(r.Context(),
		`SELECT price, SUM(remaining_quantity) as qty
		 FROM orders
		 WHERE market_symbol = $1 AND side = 'buy' 
		 AND order_status IN ('new', 'partially_filled')
		 GROUP BY price
		 ORDER BY price DESC
		 LIMIT $2`,
		symbol, limit,
	)
	
	if err == nil {
		defer bidRows.Close()
		for bidRows.Next() {
			var p PriceLevel
			if err := bidRows.Scan(&p.Price, &p.Quantity); err == nil {
				bids = append(bids, p)
			}
		}
	}
	
	askRows, err := dbPool.Query(r.Context(),
		`SELECT price, SUM(remaining_quantity) as qty
		 FROM orders
		 WHERE market_symbol = $1 AND side = 'sell'
		 AND order_status IN ('new', 'partially_filled')
		 GROUP BY price
		 ORDER BY price ASC
		 LIMIT $2`,
		symbol, limit,
	)
	
	if err == nil {
		defer askRows.Close()
		for askRows.Next() {
			var p PriceLevel
			if err := askRows.Scan(&p.Price, &p.Quantity); err == nil {
				asks = append(asks, p)
			}
		}
	}
	
	// Calculate totals
	var bidTotal, askTotal float64
	for i := range bids {
		bidTotal += bids[i].Quantity
		bids[i].Total = bidTotal
	}
	for i := range asks {
		askTotal += asks[i].Quantity
		asks[i].Total = askTotal
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: OrderBookResponse{
			LastUpdateID: time.Now().UnixMilli(),
			Bids:      bids,
			Asks:      asks,
		},
	})
}

// Get ticker
func GetTickerHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	symbol := vars["symbol"]
	
	if err := ValidateMarketSymbol(symbol); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: err.Error()},
		})
		return
	}
	
	var ticker TickerResponse
	err := dbPool.QueryRow(r.Context(),
		`SELECT ms.market_symbol, 
		 COALESCE(ms.price_change, 0),
		 COALESCE(ms.price_change_percent, 0),
		 COALESCE(ms.last_price, 0),
		 COALESCE(ms.high_price, 0),
		 COALESCE(ms.low_price, 0),
		 COALESCE(ms.volume_24h_base, 0),
		 COALESCE(ms.volume_24h_quote, 0),
		 COALESCE(ms.trades_count, 0)
		 FROM market_states ms
		 JOIN markets m ON ms.market_id = m.market_id
		 WHERE m.market_symbol = $1`,
		symbol,
	).Scan(
		&ticker.Symbol, &ticker.PriceChange, &ticker.PriceChangePercent,
		&ticker.LastPrice, &ticker.HighPrice, &ticker.LowPrice,
		&ticker.Volume, &ticker.QuoteVolume, &ticker.TradesCount,
	)
	
	if err == pgx.ErrNoRows {
		ticker = TickerResponse{Symbol: symbol}
	} else if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to get ticker"},
		})
		return
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{Success: true, Data: &ticker})
}

// Place order
func PlaceOrderHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	var req struct {
		MarketSymbol string  `json:"marketSymbol"`
		Side       string  `json:"side"`
		OrderType  string  `json:"orderType"`
		Quantity  float64 `json:"quantity"`
		Price     float64 `json:"price,omitempty"`
		StepPrice float64 `json:"stopPrice,omitempty"`
		TimeInForce string `json:"timeInForce"`
		ClientOrderID string `json:"clientOrderId,omitempty"`
	}
	
	if err := ParseJSON(r, &req); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid request body"},
		})
		return
	}
	
	// Validate
	if err := ValidateMarketSymbol(req.MarketSymbol); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: err.Error(), Field: "marketSymbol"},
		})
		return
	}
	
	if req.Side != "buy" && req.Side != "sell" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid side", Field: "side"},
		})
		return
	}
	
	if req.Quantity <= 0 {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Quantity must be > 0", Field: "quantity"},
		})
		return
	}
	
	if req.OrderType != "limit" && req.OrderType != "market" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid order type", Field: "orderType"},
		})
		return
	}
	
	if req.OrderType == "limit" && req.Price <= 0 {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Price required for limit orders", Field: "price"},
		})
		return
	}
	
	// Check market exists and trading enabled
	var tradingEnabled bool
	err = dbPool.QueryRow(r.Context(),
		"SELECT is_trading_enabled FROM markets WHERE market_symbol = $1",
		req.MarketSymbol,
	).Scan(&tradingEnabled)
	
	if err == pgx.ErrNoRows {
		WriteJSON(w, http.StatusNotFound, APIResponse{
			Success: false,
			Error:   &APIError{Code: 404, Message: "Market not found", Field: "marketSymbol"},
		})
		return
	}
	
	if !tradingEnabled {
		WriteJSON(w.http.StatusServiceUnavailable, APIResponse{
			Success: false,
			Error:   &APIError{Code: 503, Message: "Market trading disabled"},
		})
		return
	}
	
	// Check balance
	quoteCurrency := strings.Split(req.MarketSymbol, "/")[1]
	var available float64
	
	if req.Side == "buy" {
		err = dbPool.QueryRow(r.Context(),
			`SELECT COALESCE(b.available_amount, 0)
			 FROM balances b
			 JOIN wallets w ON b.wallet_id = w.wallet_id
			 WHERE b.user_id = $1 AND w.wallet_type = 'spot' AND w.currency = $2`,
			userID, quoteCurrency,
		).Scan(&available)
		
		needed := req.Quantity * req.Price
		if err == nil && available < needed {
			WriteJSON(w, http.StatusBadRequest, APIResponse{
				Success: false,
				Error:   &APIError{Code: 400, Message: "Insufficient balance"},
			})
			return
		}
	} else {
		err = dbPool.QueryRow(r.Context(),
			`SELECT COALESCE(b.available_amount, 0)
			 FROM balances b
			 JOIN wallets w ON b.wallet_id = w.wallet_id
			 WHERE b.user_id = $1 AND w.wallet_type = 'spot' AND w.currency = $2`,
			userID, strings.Split(req.MarketSymbol, "/")[0],
		).Scan(&available)
		
		if err == nil && available < req.Quantity {
			WriteJSON(w, http.StatusBadRequest, APIResponse{
				Success: false,
				Error:   &APIError{Code: 400, Message: "Insufficient balance"},
			})
			return
		}
	}
	
	// Create order
	orderID := uuid.New().String()
	now := time.Now()
	
	_, err = dbPool.Exec(r.Context(),
		`INSERT INTO orders 
		 (order_id, user_id, market_symbol, side, order_type, time_in_force,
		  quantity, client_order_id, order_status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', $9)`,
		orderID, userID, req.MarketSymbol, req.Side, req.OrderType,
		req.TimeInForce, req.Quantity, req.ClientOrderID, now,
	)
	
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to place order"},
		})
		return
	}
	
	order := &OrderResponse{
		OrderID:        orderID,
		ClientOrderID:  req.ClientOrderID,
		MarketSymbol:  req.MarketSymbol,
		Side:         req.Side,
		OrderType:     req.OrderType,
		Quantity:     req.Quantity,
		Price:        req.Price,
		StopPrice:    req.StepPrice,
		Status:       "new",
		TimeInForce:  req.TimeInForce,
		CreatedAt:    now.Unix(),
		UpdatedAt:    now.Unix(),
	}
	
	WriteJSON(w, http.StatusCreated, APIResponse{Success: true, Data: order})
}

// Get orders
func GetOrdersHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	symbol := r.URL.Query().Get("symbol")
	status := r.URL.Query().Get("status")
	limit := 50
	
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	
	query := `SELECT order_id, market_symbol, side, order_type, quantity, filled_quantity,
	    limit_price, avg_fill_price, order_status, time_in_force, created_at, updated_at
	    FROM orders WHERE user_id = $1`
	args := []interface{}{userID}
	argIdx := 2
	
	if symbol != "" {
		query += fmt.Sprintf(" AND market_symbol = $%d", argIdx)
		args = append(args, symbol)
		argIdx++
	}
	
	if status != "" {
		query += fmt.Sprintf(" AND order_status = $%d", argIdx)
		args = append(args, status)
		argIdx++
	}
	
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	
	rows, err := dbPool.Query(r.Context(), query, args...)
	if err != nil && err != pgx.ErrNoRows {
		WriteJSON(w, http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to get orders"},
		})
		return
	}
	defer rows.Close()
	
	var orders []OrderResponse
	for rows.Next() {
		var o OrderResponse
		if err := rows.Scan(
			&o.OrderID, &o.MarketSymbol, &o.Side, &o.OrderType,
			&o.Quantity, &o.FilledQuantity, &o.Price, &o.AveragePrice,
			&o.Status, &o.TimeInForce, &o.CreatedAt, &o.UpdatedAt,
		); err == nil {
			o.Remaining = o.Quantity - o.FilledQuantity
			orders = append(orders, o)
		}
	}
	
	if orders == nil {
		orders = []OrderResponse{}
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{Success: true, Data: orders})
}

// Cancel order
func CancelOrderHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := RequireUserID(r.Context())
	if err != nil {
		WriteJSON(w, http.StatusUnauthorized, APIResponse{
			Success: false,
			Error:   &APIError{Code: 401, Message: err.Error()},
		})
		return
	}
	
	orderID := mux.Vars(r)["orderId"]
	
	// Check order belongs to user and is cancelable
	var dbStatus string
	err = dbPool.QueryRow(r.Context(),
		`SELECT order_status FROM orders 
		 WHERE order_id = $1 AND user_id = $2
		 AND order_status IN ('new', 'partially_filled')`,
		orderID, userID,
	).Scan(&dbStatus)
	
	if err == pgx.ErrNoRows {
		WriteJSON(w.http.StatusNotFound, APIResponse){
			Success: false,
			Error:   &APIError{Code: 404, Message: "Order not found or cannot be cancelled"},
		})
		return
	}
	
	if err != nil {
		WriteJSON(w.http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to cancel order"},
		})
		return
	}
	
	// Update order status
	now := time.Now()
	_, err = dbPool.Exec(r.Context(),
		`UPDATE orders SET 
		 order_status = 'canceled', updated_at = $1
		 WHERE order_id = $2 AND user_id = $3`,
		now, orderID, userID,
	)
	
	if err != nil {
		WriteJSON(w.http.StatusInternalServerError, APIResponse{
			Success: false,
			Error:   &APIError{Code: 500, Message: "Failed to cancel order"},
		})
		return
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:   map[string]string{"orderId": orderID, "status": "canceled"},
	})
}

// =============================================================================
// EXCHANGE INFO
// =============================================================================

// Get exchange info
func GetExchangeInfoHandler(w http.ResponseWriter, r *http.Request) {
	var markets []map[string]interface{}
	
	rows, err := dbPool.Query(r.Context(),
		`SELECT market_symbol, market_type, status,
		 price_precision, quantity_precision,
		 maker_fee, taker_fee
		 FROM markets WHERE market_status = 'active'`,
	)
	
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var m map[string]interface{}
			if err := rows.Scan(
				&m["symbol"], &m["type"], &m["status"],
				&m["pricePrecision"], &m["qtyPrecision"],
				&m["makerFee"], &m["takerFee"],
			); err == nil {
				markets = append(markets, m)
			}
		}
	}
	
	if markets == nil {
		markets = []map[string]interface{}{}
	}
	
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"timezone":     "UTC",
			"serverTime":   time.Now().UnixMilli(),
			"exchangeRules": map[string]interface{}{
				"orderTypes":      []string{"limit", "market", "stop_loss", "stop_limit"},
				"timeInForce":    []string{"GTC", "IOC", "FOK"},
				"allowedSymbols": markets,
			},
		},
	})
}

// =============================================================================
// SERVER SETUP
// =============================================================================

func main() {
	log.Printf("TigerEx API Gateway v%s", BuildVersion)
	log.Printf("Build: %s, Commit: %s", BuildTime, GitCommit)
	
	// Load configuration (use defaults for now)
	config = &Config{
		Server: ServerConfig{
			Port:         getEnv("PORT", "8080"),
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
		},
		Security: SecurityConfig{
			JWT_SECRET:           getEnv("JWT_SECRET", "dev-secret-change-in-production"),
			JWT_EXPIRY:          15 * time.Minute,
			JWT_REFRESH_EXPIRY:  7 * 24 * time.Hour,
			BCRYPT_ROUNDS:       12,
			SESSION_DURATION:    7 * 24 * time.Hour,
			MAX_LOGIN_ATTEMPTS:  5,
			LOCKOUT_DURATION:   15 * time.Minute,
			PASSWORD_MIN_LENGTH: 8,
			PASSWORD_REQUIRE_UPPER: true,
			PASSWORD_REQUIRE_LOWER: true,
			PASSWORD_REQUIRE_DIGIT: true,
			PASSWORD_REQUIRE_SPECIAL: false,
			DEFAULT_RATE_LIMIT:  60,
			DEFAULT_RATE_BURST:  100,
			API_KEY_RATE_LIMIT:  600,
			ADMIN_RATE_LIMIT:    1200,
		},
	}
	
	// Initialize rate limiter
	globalRateLimiter = NewGlobalLimiter(
		config.Security.DEFAULT_RATE_LIMIT,
		config.Security.DEFAULT_RATE_BURST,
		config.Security.ADMIN_RATE_LIMIT,
	)
	
	// Connect to database
	connStr := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?pool_max_conns=%d",
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", ""),
		getEnv("DB_HOST", "localhost"),
		config.Database.Port,
		getEnv("DB_NAME", "tigerex"),
		20,
	)
	
	// For demo purposes, skip actual DB connection if not available
	log.Println("Initializing handlers...")
	
	// Create router
	router := mux.NewRouter()
	router.Use(LoggingMiddleware, RecoveryMiddleware, CORSMiddleware, RateLimitMiddleware)
	
	// Public routes
	router.HandleFunc("/", RootHandler).Methods("GET")
	router.HandleFunc("/health", HealthHandler).Methods("GET")
	router.HandleFunc("/api/v3/ping", RootHandler).Methods("GET")
	
	// Auth
	router.HandleFunc("/api/v3/user/register", RegisterHandler).Methods("POST")
	router.HandleFunc("/api/v3/user/login", LoginHandler).Methods("POST")
	router.HandleFunc("/api/v3/user/logout", LogoutHandler).Methods("POST")
	
	// Protected routes
	protected := router.PathPrefix("/api/v3").Subrouter()
	protected.Use(AuthMiddleware)
	
	// User
	protected.HandleFunc("/account/info", GetAccountHandler).Methods("GET")
	protected.HandleFunc("/account/profile", GetProfileHandler).Methods("GET")
	
	// Wallet
	protected.HandleFunc("/account/balance", GetBalanceHandler).Methods("GET")
	protected.HandleFunc("/account/deposit/address", GetDepositAddressHandler).Methods("GET")
	
	// Trading (demo - routes shown, would require DB)
	router.HandleFunc("/api/v3/depth/{symbol}", GetOrderBookHandler).Methods("GET")
	router.HandleFunc("/api/v3/ticker/{symbol}", GetTickerHandler).Methods("GET")
	router.HandleFunc("/api/v3/order", PlaceOrderHandler).Methods("POST")
	router.HandleFunc("/api/v3/openOrders", GetOrdersHandler).Methods("GET")
	router.HandleFunc("/api/v3/order/{orderId}", CancelOrderHandler).Methods("DELETE")
	
	// Exchange
	router.HandleFunc("/api/v3/exchangeinfo", GetExchangeInfoHandler).Methods("GET")
	
	// Start server
	port := config.Server.Port
	log.Printf("Starting server on port %s", port)
	
	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		
		log.Println("Shutting down gracefully...")
		
		ctx, cancel := context.WithTimeout(context.Background(), 10 * time.Second)
		defer cancel()
		
		// Note: Can't actually shutdown without server reference
		log.Println("Server stopped")
	}()
	
	// NOTE: For demonstration, we'd normally start the HTTP server here
	// log.Println(http.ListenAndServe(":"+port, router))
	log.Printf("Server configured - would listen on :%s", port)
	log.Printf("This is a demonstration build - database connection simulated")
	log.Printf("Full database integration required for production")
}

// Helper to get environment variable
func getEnv(key, defaultValue string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return defaultValue
}

// Placeholders for compilation
var (
	_ = big.NewInt
	_ = pgx.Conn{}
	_ = schema.Decoder{}
)

const (
	http_StatusServiceUnavailable = 0 
)

type nullTime = struct{} 

func (nt nullTime) Scan(src interface{}) error { return nil }

var errStatusServiceUnavailable = fmt.Errorf("service unavailable")
var http_StatusServiceUnavailable = 0
var api_Error = &APIError{}

func (w *ResponseRecorder) HttpStatusOK() int { return w.StatusCode } 

func (r *http.Request) PostFormValue(key string) string {
	if r.PostForm == nil {
		r.ParseForm()
	}
	return r.PostForm.Get(key)
}