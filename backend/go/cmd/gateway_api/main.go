// Package gateway_api provides unified API gateway.
// Migrated from TypeScript to Go for centralized API entry point.
package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// API endpoint
type Endpoint struct {
	Path        string  `json:"path"`
	Method     string  `json:"method"`
	Service    string  `json:"service"`
	Version    string  `json:"version"`
	Middleware []string `json:"middleware"`
	Timeout    int     `json:"timeout"` // ms, 0 = no timeout
	RateLimit  int     `json:"rateLimit"` // req/min
}

// Request context
type Request struct {
	ID        string  `json:"id"`
	Path     string  `json:"path"`
	Method   string  `json:"method"`
	Headers  map[string]string `json:"headers"`
	Query    map[string]string `json:"query"`
	Body     []byte  `json:"body"`
	UserID   string  `json:"userId"`
	StartedAt int64  `json:"startedAt"`
}

// Response
type Response struct {
	StatusCode int         `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       []byte      `json:"body"`
	Latency    int64       `json:"latency"` // ms
}

// Middleware
type Middleware func(*Request) error

// Store
type GatewayStore struct {
	mu          sync.RWMutex
	endpoints   map[string]*Endpoint
	middleware map[string]Middleware
	stats      map[string]int // path -> requests
}

var (
	gateway = &GatewayStore{
		endpoints: make(map[string]*Endpoint),
		middleware: make(map[string]Middleware),
		stats: make(map[string]int),
	}
)

// Initialize
func init() {
	endpoints := []*Endpoint{
		{Path: "/api/v1/auth/login", Method: "POST", Service: "auth", Version: "v1", Timeout: 5000, RateLimit: 60},
		{Path: "/api/v1/user/profile", Method: "GET", Service: "user", Version: "v1", Timeout: 3000, RateLimit: 120},
		{Path: "/api/v1/market/ticker", Method: "GET", Service: "market", Version: "v1", Timeout: 1000, RateLimit: 300},
		{Path: "/api/v1/order", Method: "POST", Service: "order", Version: "v1", Timeout: 1000, RateLimit: 120},
		{Path: "/api/v1/order", Method: "DELETE", Service: "order", Version: "v1", Timeout: 1000, RateLimit: 120},
		{Path: "/api/v1/wallet/balance", Method: "GET", Service: "wallet", Version: "v1", Timeout: 2000, RateLimit: 120},
		{Path: "/api/v1/deposit/address", Method: "POST", Service: "deposit", Version: "v1", Timeout: 3000, RateLimit: 60},
		{Path: "/api/v1/withdraw", Method: "POST", Service: "withdraw", Version: "v1", Timeout: 5000, RateLimit: 10},
		{Path: "/api/v1/kyc", Method: "POST", Service: "kyc", Version: "v1", Timeout: 10000, RateLimit: 5},
		{Path: "/api/v1/webhook", Method: "POST", Service: "webhook", Version: "v1", Timeout: 5000, RateLimit: 60},
	}

	gateway.mu.Lock()
	defer gateway.mu.Unlock()

	for _, e := range endpoints {
		key := fmt.Sprintf("%s:%s", e.Method, e.Path)
		gateway.endpoints[key] = e
	}
}

// Register middleware
func RegisterMiddleware(name string, mw Middleware) {
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	gateway.middleware[name] = mw
}

// Route request
func Route(req *Request) (*Response, error) {
	key := fmt.Sprintf("%s:%s", req.Method, req.Path)

	gateway.mu.RLock()
	endpoint, ok := gateway.endpoints[key]
	gateway.mu.RUnlock()

	if !ok {
		return &Response{
			StatusCode: http.StatusNotFound,
			Body: []byte(`{"error": "not found"}`),
		}, fmt.Errorf("endpoint not found")
	}

	// Check rate limit
	if endpoint.RateLimit > 0 {
		gateway.mu.Lock()
		gateway.stats[key]++
		count := gateway.stats[key]
		gateway.mu.Unlock()

		if count > endpoint.RateLimit {
			return &Response{
				StatusCode: http.StatusTooManyRequests,
				Body: []byte(`{"error": "rate limit exceeded"}`),
			}, fmt.Errorf("rate limited")
		}
	}

	// Execute middleware
	for _, mwName := range endpoint.Middleware {
		if mw, ok := gateway.middleware[mwName]; ok {
			if err := mw(req); err != nil {
				return &Response{
					StatusCode: http.StatusUnauthorized,
					Body: []byte(`{"error": "unauthorized"}`),
				}, err
			}
		}
	}

	// Simulate response (in real impl, call backend service)
	resp := &Response{
		StatusCode: http.StatusOK,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
		Body: []byte(fmt.Sprintf(`{"service": "%s", "version": "%s"}`, endpoint.Service, endpoint.Version)),
		Latency: int64(time.Since(time.UnixMilli(req.StartedAt))),
	}

	return resp, nil
}

// Health check
func Health() map[string]string {
	return map[string]string{
		"status":   "healthy",
		"version": "1.0.0",
		"uptime":  "86400",
	}
}

func main() {
	fmt.Println("API Gateway initialized")

	// Routes
	routes := []string{"POST /api/v1/auth/login", "GET /api/v1/market/ticker", "POST /api/v1/order"}
	for _, r := range routes {
		parts := strings.Split(r, " ")
		key := fmt.Sprintf("%s:%s", parts[0], parts[1])
		if e, ok := gateway.endpoints[key]; ok {
			fmt.Printf("Route: %s -> %s (timeout: %dms, rate: %d/min)\n", 
				r, e.Service, e.Timeout, e.RateLimit)
		}
	}

	// Health
	h := Health()
	fmt.Printf("Health: %s\n", h["status"])
}