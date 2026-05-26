package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// ============================================================================
// REQUEST ROUTER - Go Implementation
// High-performance request routing for TigerEx
// ============================================================================

// Request represents an incoming HTTP request
type Request struct {
	Path    string                 `json:"path"`
	Method  string                 `json:"method"`
	Headers map[string]string      `json:"headers"`
	Body    map[string]interface{} `json:"body,omitempty"`
}

// Response represents the HTTP response
type Response struct {
	Status  int                    `json:"status"`
	Body    map[string]interface{} `json:"body"`
	Headers map[string]string      `json:"headers"`
}

// RouteHandler is the function type for route handlers
type RouteHandler func(*Request) *Response

// Router manages route registration and dispatching
type Router struct {
	mu      sync.RWMutex
	routes  map[string]RouteHandler
	middleware []MiddlewareFunc
}

// MiddlewareFunc is the middleware function type
type MiddlewareFunc func(*Request, *Router) *Response

// NewRouter creates a new router instance
func NewRouter() *Router {
	return &Router{
		routes:   make(map[string]RouteHandler),
		middleware: make([]MiddlewareFunc, 0),
	}
}

// AddRoute registers a new route
func (r *Router) AddRoute(path string, handler RouteHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.routes[path] = handler
}

// AddMiddleware adds a middleware function
func (r *Router) AddMiddleware(m MiddlewareFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.middleware = append(r.middleware, m)
}

// Route dispatches the request to the appropriate handler
func (r *Router) Route(req *Request) *Response {
	// Apply middleware
	for _, m := range r.middleware {
		resp := m(req, r)
		if resp != nil {
			return resp
		}
	}

	// Find handler
	r.mu.RLock()
	handler, ok := r.routes[req.Path]
	r.mu.RUnlock()

	if !ok {
		return &Response{
			Status: http.StatusNotFound,
			Body: map[string]interface{}{
				"error": "Not Found",
				"path": req.Path,
			},
		}
	}

	return handler(req)
}

// ListRoutes returns all registered routes
func (r *Router) ListRoutes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	routes := make([]string, 0, len(r.routes))
	for path := range r.routes {
		routes = append(routes, path)
	}
	return routes
}

// ============================================================================
// BUILT-IN HANDLERS
// ============================================================================

// HealthHandler handles /health endpoint
func HealthHandler(req *Request) *Response {
	return &Response{
		Status: http.StatusOK,
		Body: map[string]interface{}{
			"status": "OK",
			"service": "tigerex-router",
		},
	}
}

// NotFoundHandler handles 404 responses
func NotFoundHandler(req *Request) *Response {
	return &Response{
		Status: http.StatusNotFound,
		Body: map[string]interface{}{
			"error": "Endpoint not found",
		},
	}
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	router := NewRouter()

	// Add routes
	router.AddRoute("/health", HealthHandler)
	router.AddRoute("/api/v1/ticker", TickerHandler)

	// Test routing
	req := &Request{
		Path:   "/health",
		Method: "GET",
	}

	resp := router.Route(req)
	fmt.Printf("Response: %+v\n", resp)

	// List routes
	fmt.Printf("Routes: %v\n", router.ListRoutes())
}

// TickerHandler handles ticker endpoint
func TickerHandler(req *Request) *Response {
	data := map[string]interface{}{
		"symbol": "BTC/USDT",
		"price": 65000.0,
		"change_24h": 2.5,
		"volume_24h": 1000000000.0,
	}

	return &Response{
		Status: http.StatusOK,
		Body: data,
	}
}

// MarshalJSON implements custom JSON marshaling
func (r *Response) MarshalJSON() ([]byte, error) {
	return json.Marshal(r.Body)
}