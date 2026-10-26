// TigerEx API Gateway
// High-performance API gateway for distributed systems
// Built with Go for high-load worldwide distributed systems

package apigateway

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"sync"
	"time"
)

type Route struct {
	Pattern   string
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
	// proxies caches one reverse proxy per backend URL. Building one per
	// request would leak a transport and defeat connection reuse.
	proxies map[string]*httputil.ReverseProxy
}

type GatewayStats struct {
	Requests   int64
	Errors     int64
	LatencySum float64
	MaxLatency float64
	BytesIn    int64
	BytesOut   int64
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
		routes:      make(map[string]*Route),
		middleware:  make([]Middleware, 0),
		rateLimiter: NewRateLimiter(100, time.Minute),
		proxies:     make(map[string]*httputil.ReverseProxy),
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

	// Proxy to the backend that owns this route.
	g.proxyRequest(w, r, route.Backend)

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

// proxyRequest forwards the request to the backend that owns the route.
//
// The previous version answered 200 with a canned JSON body and never
// contacted the backend, so every gateway route silently returned a fake
// success. This builds and caches a real reverse proxy per backend.
func (g *Gateway) proxyRequest(w http.ResponseWriter, r *http.Request, backend string) {
	proxy, err := g.proxyFor(backend)
	if err != nil {
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		g.mu.Lock()
		g.stats.Errors++
		g.mu.Unlock()
		return
	}

	proxy.ServeHTTP(w, r)
}

// proxyFor returns the cached reverse proxy for a backend URL.
func (g *Gateway) proxyFor(backend string) (*httputil.ReverseProxy, error) {
	g.mu.RLock()
	cached, ok := g.proxies[backend]
	g.mu.RUnlock()
	if ok {
		return cached, nil
	}

	target, err := url.Parse(backend)
	if err != nil {
		return nil, fmt.Errorf("invalid backend URL %q: %w", backend, err)
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("unsupported backend scheme %q", target.Scheme)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	// A backend failure must surface as 502, never as a fabricated 200.
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
	}

	g.mu.Lock()
	if existing, ok := g.proxies[backend]; ok {
		g.mu.Unlock()
		return existing, nil
	}
	g.proxies[backend] = proxy
	g.mu.Unlock()

	return proxy, nil
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
