// Package rest provides REST API server.
package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/time/rate"
)

// Server represents REST API server
type Server struct {
	mu           sync.RWMutex
	addr         string
	handler      *Handler
	middleware   []Middleware
	rateLimiter  *RateLimiter
	timeLimiter  []TimeLimiter
	certFile     string
	keyFile      string
	httpServer  *http.Server
}

// Handler represents API handler
type Handler struct {
	mu          sync.RWMutex
	services    map[string]interface{}
	authService interface{}
}

// Middleware represents middleware function
type Middleware func(http.Handler) http.Handler

// RateLimiter provides rate limiting
type RateLimiter struct {
	clients map[string]*clientLimiter
	mu      sync.Mutex
}

type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// TimeLimiter provides time-based rate limiting
type TimeLimiter struct {
	Start time.Time
	End   time.Time
	Limit rate.Limit
	Burst int
}

// APIResponse represents API response
type APIResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// APIError represents API error
type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// NewServer creates new REST API server
func NewServer(addr string) *Server {
	return &Server{
		addr:        addr,
		handler:    &Handler{services: make(map[string]interface{})},
		rateLimiter: newRateLimiter(),
	}
}

// SetHandler sets service handler
func (s *Server) SetHandler(name string, service interface{}) {
	s.handler.mu.Lock()
	s.handler.services[name] = service
	s.handler.mu.Unlock()
}

// Use adds middleware
func (s *Server) Use(m Middleware) {
	s.middleware = append(s.middleware, m)
}

// EnableTLS enables TLS
func (s *Server) EnableTLS(certFile, keyFile string) {
	s.certFile = certFile
	s.keyFile = keyFile
}

// Start starts the server
func (s *Server) Start(ctx context.Context) error {
	mux := http.NewServeMux()

	// Register routes
	s.registerRoutes(mux)

	// Apply middleware
	var handler http.Handler = mux
	for i := len(s.middleware) - 1; i >= 0; i-- {
		handler = s.middleware[i](handler)
	}

	s.httpServer = &http.Server{
		Addr:         s.addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("Starting REST API server on %s", s.addr)

	if s.certFile != "" && s.keyFile != "" {
		return s.httpServer.ListenAndServeTLS(s.certFile, s.keyFile)
	}

	return s.httpServer.ListenAndServe()
}

// Stop stops the server
func (s *Server) Stop(ctx context.Context) error {
	if s.httpServer == nil {
		return nil
	}

	log.Println("Stopping REST API server...")
	return s.httpServer.Shutdown(ctx)
}

// Wait waits for server to shutdown
func (s *Server) Wait() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh
	log.Println("Server stopped")
}

// registerRoutes registers API routes
func (s *Server) registerRoutes(mux *http.ServeMux) {
	// Health
	mux.HandleFunc("/health", s.handleHealth)

	// API Group
	api := "/api/v1"

	// Public endpoints
	mux.HandleFunc(api+"/ping", s.handlePing)
	
	// Markets
	mux.HandleFunc(api+"/markets", s.handleMarkets)
	mux.HandleFunc(api+"/markets/{symbol}", s.handleMarketTicker)
	mux.HandleFunc(api+"/depth", s.handleDepth)
	mux.HandleFunc(api+"/trades", s.handleRecentTrades)
	mux.HandleFunc(api+"/klines", s.handleKLines)
	mux.HandleFunc(api+"/tickers", s.handleTickers)

	// Auth (public)
	mux.HandleFunc(api+"/auth/register", s.handleRegister)
	mux.HandleFunc(api+"/auth/login", s.handleLogin)
	mux.HandleFunc(api+"/auth/refresh", s.handleRefreshToken)

	// Auth (private - requires auth middleware)
	protected := api + "/user"
	mux.HandleFunc(protected+"/account", s.handleAccount)
	mux.HandleFunc(protected+"/balance", s.handleBalance)
	mux.HandleFunc(protected+"/orders", s.handleOrders)
	mux.HandleFunc(protected+"/orders/{id}", s.handleOrder)
	mux.HandleFunc(protected+"/orders/{id}/cancel", s.handleCancelOrder)
	mux.HandleFunc(protected+"/deposit/address", s.handleDepositAddress)
	mux.HandleFunc(protected+"/withdraw", s.handleWithdraw)

	// Admin (admin only)
	admin := api + "/admin"
	mux.HandleFunc(admin+"/users", s.handleAdminUsers)
	mux.HandleFunc(admin+"/users/{id}", s.handleAdminUser)
	mux.HandleFunc(admin+"/kyc/approve", s.handleApproveKYC)
	mux.HandleFunc(admin+"/kyc/reject", s.handleRejectKYC)
	mux.HandleFunc(admin+"/markets", s.handleAdminMarkets)
	mux.HandleFunc(admin+"/fees", s.handleAdminFees)
}

// Handlers
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"status": "healthy",
		"time":  time.Now().Unix(),
	})
}

func (s *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"ping": "pong",
	})
}

func (s *Server) handleMarkets(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, []interface{}{})
}

func (s *Server) handleMarketTicker(w http.ResponseWriter, r *http.Request) {
	symbol := extractVar(r, "symbol")
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"symbol": symbol,
		"price": "0.00",
	})
}

func (s *Server) handleDepth(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	limit := r.URL.Query().Get("limit")

	depth := map[string]interface{}{
		"lastUpdateId": 0,
		"bids":        [][]string{},
		"asks":        [][]string{},
	}
	_ = limit

	jsonResponse(w, http.StatusOK, depth)
}

func (s *Server) handleRecentTrades(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, []interface{}{})
}

func (s *Server) handleKLines(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, []interface{}{})
}

func (s *Server) handleTickers(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, []interface{}{})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request")
		return
	}
	json.Unmarshal(body, &req)

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"user_id": uuid.New().String(),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"access_token":  "",
		"refresh_token": "",
		"expires_in":   3600,
	})
}

func (s *Server) handleRefreshToken(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"access_token":  "",
		"refresh_token": "",
		"expires_in":   3600,
	})
}

func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"id":      "",
		"email":   "",
		"created": 0,
	})
}

func (s *Server) handleBalance(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, []interface{}{})
}

func (s *Server) handleOrders(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, []interface{}{})
}

func (s *Server) handleOrder(w http.ResponseWriter, r *http.Request) {
	id := extractVar(r, "id")
	_ = id

	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleCancelOrder(w http.ResponseWriter, r *http.Request) {
	id := extractVar(r, "id")
	_ = id

	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleDepositAddress(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"address": "",
	})
}

func (s *Server) handleWithdraw(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"id":  uuid.New().String(),
	})
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleAdminUser(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleApproveKYC(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleRejectKYC(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleAdminMarkets(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

func (s *Server) handleAdminFees(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{})
}

// Helper functions
func jsonResponse(w http.ResponseWriter, code int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)

	resp := APIResponse{
		Code: code,
		Data: data,
	}

	json.NewEncoder(w).Encode(resp)
}

func jsonError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)

	resp := APIResponse{
		Code:  code,
		Error: message,
	}

	json.NewEncoder(w).Encode(resp)
}

func extractVar(r *http.Request, name string) string {
	return "" // Would extract from URL path
}

// Rate limiter
func newRateLimiter() *RateLimiter {
	return &RateLimiter{
		clients: make(map[string]*clientLimiter),
	}
}

func (rl *RateLimiter) limit(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	client, exists := rl.clients[ip]
	if !exists {
		rl.clients[ip] = &clientLimiter{
			limiter:  rate.NewLimiter(10, 20),
			lastSeen: time.Now(),
		}
		return false
	}

	client.lastSeen = time.Now()

	return !client.limiter.Allow()
}

// LoggingMiddleware provides request logging
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// RecoveryMiddleware recovers from panics
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				jsonError(w, http.StatusInternalServerError, "internal server error")
				log.Printf("panic: %v", err)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware adds CORS headers
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RateLimitMiddleware provides rate limiting
func RateLimitMiddleware(rl *RateLimiter) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := getIP(r)
			if rl.limit(ip) {
				jsonError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware provides authentication
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			jsonError(w, http.StatusUnauthorized, "missing authorization")
			return
		}

		token := strings.TrimPrefix(auth, "Bearer ")
		if token == "" {
			jsonError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		ctx := context.WithValue(r.Context(), "token", token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AdminMiddleware provides admin authorization
func AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if user has admin role
		next.ServeHTTP(w, r)
	})
}

func getIP(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		return strings.Split(xff, ",")[0]
	}
	return r.RemoteAddr
}

var _ = fmt.Stringer(&APIError{})