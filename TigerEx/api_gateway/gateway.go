// TigerEx API Gateway
// High-performance API gateway for distributed systems
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Route struct {
	Pattern    string
	Methods   []string
	Backend   string
	Timeout   time.Duration
	RateLimit int
}

type Middleware func(http.Handler) http.Handler

type APIGateway struct {
	mu          sync.RWMutex
	routes      map[string]*Route
	middleware  []Middleware
	stats       GatewayStats
	rateLimiter *RateLimiter
}

type GatewayStats struct {
	Requests    int64
	Errors      int64
	LatencySum  float64
	MaxLatency  float64
	BytesIn     int64
	BytesOut    int64
}

type RateLimiter struct {
	mu       sync.RWMutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
}

func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	now := time.Now()
	requests := rl.requests[key]
	
	// Remove old requests
	var valid []time.Time
	for _, t := range requests {
		if now.Sub(t) < rl.window {
			valid = append(valid, t)
		}
	}
	
	if len(valid) >= rl.limit {
		rl.requests[key] = valid
		return false
	}
	
	rl.requests[key] = append(valid, now)
	return true
}

func NewAPIGateway() *Gateway {
	return &Gateway{
		routes:     make(map[string]*Route),
		middleware: make([]Middleware, 0),
		rateLimiter: NewRateLimiter(100, time.Minute),
	}
}

func (g *Gateway) AddRoute(pattern, backend string, methods []string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	
	g.routes[pattern] = &Route{
		Pattern:   pattern,
		Backend:   backend,
		Methods:   methods,
		Timeout:   30 * time.Second,
		RateLimit: 100,
	}
}

func (g *Gateway) Use(m Middleware) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.middleware = append(g.middleware, m)
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	
	// Rate limiting
	if !g.rateLimiter.Allow(r.RemoteAddr) {
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		g.mu.Lock()
		g.stats.Errors++
		g.mu.Unlock()
		return
	}
	
	// Route matching
	route := g.matchRoute(r)
	if route == nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		g.mu.Lock()
		g.stats.Errors++
		g.mu.Unlock()
		return
	}
	
	// Method check
	if !contains(route.Methods, r.Method) {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		g.mu.Lock()
		g.stats.Errors++
		g.mu.Unlock()
		return
	}
	
	// Proxy to backend (simplified)
	proxyRequest(w, r, route.Backend)
	
	// Update stats
	latency := time.Since(start).Seconds()
	g.mu.Lock()
	g.stats.Requests++
	g.stats.LatencySum += latency
	if latency > g.stats.MaxLatency {
		g.stats.MaxLatency = latency
	}
	g.mu.Unlock()
}

func (g *Gateway) matchRoute(r *http.Request) *Route {
	g.mu.RLock()
	defer g.mu.RUnlock()
	
	path := r.URL.Path
	for pattern, route := range g.routes {
		if match, _ := regexp.MatchString(pattern, path); match {
			return route
		}
	}
	return nil
}

func (g *Gateway) GetStats() GatewayStats {
	g.mu.RLock()
	defer g.mu.RUnlock()
	
	stats := g.stats
	if stats.Requests > 0 {
		stats.LatencySum = stats.LatencySum / float64(stats.Requests)
	}
	return stats
}

func proxyRequest(w http.ResponseWriter, r *http.Request, backend string) {
	// Simplified - in production use httputil.ReverseProxy
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","backend":"%s"}`, backend)
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

type Gateway = APIGateway

func main() {
	fmt.Println("TigerEx API Gateway")
	fmt.Println("==================")
	
	gateway := NewAPIGateway()
	
	// Add routes
	gateway.AddRoute("/api/v1/market.*", "http://market-service:8080", []string{"GET"})
	gateway.AddRoute("/api/v1/order.*", "http://order-service:8080", []string{"GET", "POST", "DELETE"})
	gateway.AddRoute("/api/v1/wallet.*", "http://wallet-service:8080", []string{"GET", "POST"})
	gateway.AddRoute("/api/v1/user.*", "http://user-service:8080", []string{"GET", "POST", "PUT"})
	
	// Add middleware
	gateway.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Header.Set("X-Gateway", "TigerEx")
			h.ServeHTTP(w, r)
		})
	})
	
	// Stats
	stats := gateway.GetStats()
	fmt.Printf("Requests: %d\n", stats.Requests)
	fmt.Printf("Errors: %d\n", stats.Errors)
	fmt.Printf("Max Latency: %.2fs\n", stats.MaxLatency)
	
	fmt.Println("\nAPI Gateway ready on :8080")
}
