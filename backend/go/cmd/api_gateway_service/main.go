// Package api_gateway_service provides unified API Gateway.
// Migrated from TypeScript to Go for ultra-high performance.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Route definition
type Route struct {
	Path      string
	Method   string
	Handler  string // service name
	Auth     bool
	RateLimit int // requests per minute
}

// Service endpoint
type ServiceEndpoint struct {
	Name    string
	URL     string
	Healthy bool
	LastCheck int64
}

// Middleware chain
type Middleware func http.HandlerFunc http.HandlerFunc

// Rate limiter
type RateLimiter struct {
	mu       sync.RWMutex
	requests map[string][]int64 // IP -> timestamps
	limit    int
	window   int // seconds
}

var (
	gateway     *APIGateway
	rateLimiter = &RateLimiter{
		requests: make(map[string][]int64),
		limit:    120, // 120 req/min default
		window:   60,
	}
)

// APIGateway main struct
type APIGateway struct {
	mu          sync.RWMutex
	routes      map[string]*Route
	services   map[string]*ServiceEndpoint
	middleware []Middleware
	startedAt  int64
}

// Initialize gateway
func init() {
	gateway = &APIGateway{
		routes:    make(map[string]*Route),
		services:  make(map[string]*ServiceEndpoint),
		middleware: make([]Middleware, 0),
		startedAt: time.Now().UnixMilli(),
	}

	// Register default routes
	routes := []*Route{
		{Path: "/api/v1/auth/*", Method: "POST", Handler: "auth", Auth: false, RateLimit: 10},
		{Path: "/api/v1/trade/*", Method: "*", Handler: "trading", Auth: true, RateLimit: 100},
		{Path: "/api/v1/wallet/*", Method: "*", Handler: "wallet", Auth: true, RateLimit: 60},
		{Path: "/api/v1/market/*", Method: "*", Handler: "market", Auth: false, RateLimit: 200},
		{Path: "/api/v1/user/*", Method: "*", Handler: "user", Auth: true, RateLimit: 60},
		{Path: "/api/v1/admin/*", Method: "*", Handler: "admin", Auth: true, RateLimit: 30},
		{Path: "/ws/*", Method: "WS", Handler: "websocket", Auth: true, RateLimit: 10},
	}

	for _, r := range routes {
		key := fmt.Sprintf("%s:%s", r.Method, r.Path)
		gateway.routes[key] = r
	}

	// Register services
	services := []*ServiceEndpoint{
		{Name: "auth", URL: "http://auth-service:8081", Healthy: true, LastCheck: time.Now().UnixMilli()},
		{Name: "trading", URL: "http://trading-service:8082", Healthy: true, LastCheck: time.Now().UnixMilli()},
		{Name: "wallet", URL: "http://wallet-service:8083", Healthy: true, LastCheck: time.Now().UnixMilli()},
		{Name: "market", URL: "http://market-service:8084", Healthy: true, LastCheck: time.Now().UnixMilli()},
		{Name: "user", URL: "http://user-service:8085", Healthy: true, LastCheck: time.Now().UnixMilli()},
		{Name: "admin", URL: "http://admin-service:8086", Healthy: true, LastCheck: time.Now().UnixMilli()},
		{Name: "websocket", URL: "http://ws-service:8087", Healthy: true, LastCheck: time.Now().UnixMilli()},
	}

	for _, s := range services {
		gateway.services[s.Name] = s
	}
}

// Add route
func AddRoute(route *Route) {
	gateway.mu.Lock()
	defer gateway.mu.Unlock()

	key := fmt.Sprintf("%s:%s", route.Method, route.Path)
	gateway.routes[key] = route
}

// Get route
func GetRoute(method, path string) *Route {
	gateway.mu.RLock()
	defer gateway.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", method, path)
	if r, ok := gateway.routes[key]; ok {
		return r
	}

	// Wildcard match
	for _, route := range gateway.routes {
		if matchPattern(route.Path, path) {
			return route
		}
	}

	return nil
}

// Service health check
func CheckService(name string) bool {
	gateway.mu.RLock()
	defer gateway.mu.RUnlock()

	s, ok := gateway.services[name]
	if !ok {
		return false
	}

	// Check if healthy (5 min window)
	return s.Healthy && (time.Now().UnixMilli()-s.LastCheck) < 300000
}

// Update service health
func UpdateServiceHealth(name string, healthy bool) {
	gateway.mu.Lock()
	defer gateway.mu.Unlock()

	if s, ok := gateway.services[name]; ok {
		s.Healthy = healthy
		s.LastCheck = time.Now().UnixMilli()
	}
}

// Rate limiting
func AllowRequest(key string) bool {
	rateLimiter.mu.Lock()
	defer rateLimiter.mu.Unlock()

	now := time.Now().UnixMilli()
	windowStart := now - int64(rateLimiter.window*1000)

	// Clean old requests
	recent := make([]int64, 0)
	for _, ts := range rateLimiter.requests[key] {
		if ts > windowStart {
			recent = append(recent, ts)
		}
	}

	if len(recent) >= rateLimiter.limit {
		return false
	}

	rateLimiter.requests[key] = append(recent, now)
	return true
}

// Authentication middleware
func AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check Authorization header
		auth := r.Header.Get("Authorization")
		if auth == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Validate token (simplified - real impl would call auth service)
		if !strings.HasPrefix(auth, "Bearer ") {
			http.Error(w, "Invalid token format", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	}
}

// Logging middleware
func LoggingMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		
		next.ServeHTTP(w, r)
		
		duration := time.Since(start)
		fmt.Printf("%s %s %dms\n", r.Method, r.URL.Path, duration.Milliseconds())
	}
}

// CORS middleware
func CORSMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		next.ServeHTTP(w, r)
	}
}

// Global rate limit config
func SetGlobalRateLimit(limit int, window int) {
	rateLimiter.mu.Lock()
	defer rateLimiter.mu.Unlock()
	
	rateLimiter.limit = limit
	rateLimiter.window = window
}

// Route wildcard match
func matchPattern(pattern, path string) bool {
	if strings.HasSuffix(pattern, "/*") {
		prefix := strings.TrimSuffix(pattern, "/*")
		return strings.HasPrefix(path, prefix)
	}
	return pattern == path
}

// Metrics
func GetMetrics() map[string]interface{} {
	gateway.mu.RLock()
	defer gateway.mu.RUnlock()

	healthy := 0
	for _, s := range gateway.services {
		if s.Healthy {
			healthy++
		}
	}

	return map[string]interface{}{
		"routes":    len(gateway.routes),
		"services": len(gateway.services),
		"healthy":  healthy,
		"uptime":   time.Now().UnixMilli() - gateway.startedAt,
	}
}

func main() {
	fmt.Println("API Gateway Service initialized")
	
	// Demo routes
	route := GetRoute("POST", "/api/v1/trade/order")
	if route != nil {
		fmt.Printf("Route: %s -> %s\n", route.Path, route.Handler)
	}
	
	// Service health
	fmt.Printf("Trading service healthy: %v\n", CheckService("trading"))
	
	// Metrics
	metrics := GetMetrics()
	jsonMetrics, _ := json.Marshal(metrics)
	fmt.Printf("Metrics: %s\n", string(jsonMetrics))
}