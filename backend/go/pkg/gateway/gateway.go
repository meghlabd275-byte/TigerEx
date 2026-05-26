// Package gateway provides API gateway functionality
// Production API gateway with rate limiting, circuit breakers, and request validation
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// RateLimitTier defines API rate limit tiers
type RateLimitTier string

const (
	TierFree RateLimitTier = "free"
	TierBasic RateLimitTier = "basic"
	TierProfessional RateLimitTier = "professional"
	TierInstitutional RateLimitTier = "institutional"
)

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// ApiKey represents an API key
type ApiKey struct {
	Key         string    `json:"key"`
	Secret     string    `json:"secret"`
	Label      string    `json:"label"`
	UserID     string    `json:"userId"`
	Tier       RateLimitTier `json:"tier"`
	Permissions []string `json:"permissions"`
	RateLimit  int       `json:"rateLimit"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	IsActive   bool      `json:"isActive"`
}

// ApiKeyInput for creating API keys
type ApiKeyInput struct {
	Label      string     `json:"label"`
	UserID     string     `json:"userId"`
	Tier       RateLimitTier `json:"tier"`
	Permissions []string `json:"permissions"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

// ApiKeyCreated response
type ApiKeyCreated struct {
	Key       string     `json:"key"`
	Secret   string     `json:"secret"` // Only shown once!
	Tier     RateLimitTier `json:"tier"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

// ApiRequestInput represents an incoming API request
type ApiRequestInput struct {
	ApiKey   string `json:"apiKey"`
	Endpoint string `json:"endpoint"`
	Method  string `json:"method"`
	IP     string `json:"ip"`
}

// ApiGatewayResponse response
type ApiGatewayResponse struct {
	Allowed   bool   `json:"allowed"`
	Error    string `json:"error,omitempty"`
	RetryAfter *int64 `json:"retryAfter,omitempty"`
}

// RateLimitCheck result
type RateLimitCheck struct {
	Allowed    bool   `json:"allowed"`
	Remaining int   `json:"remaining"`
	ResetAt   int64 `json:"resetAt"`
}

// CircuitBreakerState for circuit breaker pattern
type CircuitBreakerState struct {
	Endpoint    string    `json:"endpoint"`
	Failures   int      `json:"failures"`
	LastFailure time.Time `json:"lastFailure"`
	IsOpen     bool      `json:"isOpen"`
	Threshold  int      `json:"threshold"` // Failures before opening
}

// =============================================================================
// API GATEWAY PLATFORM
// =============================================================================

// ApiGatewayPlatform main gateway struct
type ApiGatewayPlatform struct {
	mu             sync.RWMutex
	rateLimiters    map[string]*RateLimiter
	apiKeys       map[string]*ApiKey
	apiKeySecrets map[string]string // Secret storage (key -> secret)
	circuitBreakers map[string]*CircuitBreakerState
	requestLog    []ApiRequest
}

// ApiRequest logged request
type ApiRequest struct {
	ID        string    `json:"id"`
	ApiKey   string    `json:"apiKey"`
	Endpoint string   `json:"endpoint"`
	Method  string    `json:"method"`
	IP      string    `json:"ip"`
	Status  int       `json:"status"`
	Latency int64     `json:"latency"`
	Time    time.Time `json:"time"`
}

// RateLimiter tracks rate limits
type RateLimiter struct {
	Key          string
	Requests    []int64 // Timestamps of recent requests
	Limit      int
	WindowSecs  int
}

// NewApiGatewayPlatform creates new gateway
func NewApiGatewayPlatform() *ApiGatewayPlatform {
	return &ApiGatewayPlatform{
		rateLimiters:    make(map[string]*RateLimiter),
		apiKeys:       make(map[string]*ApiKey),
		apiKeySecrets: make(map[string]string),
		circuitBreakers: make(map[string]*CircuitBreakerState),
		requestLog:    make([]ApiRequest, 0, 10000),
	}
}

// CreateApiKey creates a new API key
func (g *ApiGatewayPlatform) CreateApiKey(input ApiKeyInput) (*ApiKeyCreated, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	key := generateKey("pk")
	secret := generateKey("sk")

	rateLimit := getRateLimitForTier(input.Tier)

	apiKey := &ApiKey{
		Key:         key,
		Secret:     secret,
		Label:      input.Label,
		UserID:     input.UserID,
		Tier:       input.Tier,
		Permissions: input.Permissions,
		RateLimit:  rateLimit,
		CreatedAt:  time.Now(),
		ExpiresAt:  input.ExpiresAt,
		IsActive:   true,
	}

	g.apiKeys[key] = apiKey
	g.apiKeySecrets[secret] = key

	return &ApiKeyCreated{
		Key:       key,
		Secret:   secret,
		Tier:     input.Tier,
		ExpiresAt: input.ExpiresAt,
	}, nil
}

// ProcessRequest processes an incoming API request
func (g *ApiGatewayPlatform) ProcessRequest(ctx context.Context, req ApiRequestInput) (ApiGatewayResponse, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	apiKey, ok := g.apiKeys[req.ApiKey]
	if !ok {
		return ApiGatewayResponse{Allowed: false, Error: "Invalid API key"}, nil
	}

	if !apiKey.IsActive {
		return ApiGatewayResponse{Allowed: false, Error: "API key disabled"}, nil
	}

	if apiKey.ExpiresAt != nil && apiKey.ExpiresAt.Before(time.Now()) {
		return ApiGatewayResponse{Allowed: false, Error: "API key expired"}, nil
	}

	// Check rate limit
	rateCheck := g.checkRateLimit(apiKey.Key, apiKey.RateLimit)
	if !rateCheck.Allowed {
		retryAfter := rateCheck.ResetAt - time.Now().UnixMilli()
		return ApiGatewayResponse{
			Allowed:   false,
			Error:    "Rate limit exceeded",
			RetryAfter: &retryAfter,
		}, nil
	}

	// Check circuit breaker
	circuitCheck := g.checkCircuitBreaker(req.Endpoint)
	if !circuitCheck.Allowed {
		return ApiGatewayResponse{Allowed: false, Error: "Service temporarily unavailable"}, nil
	}

	return ApiGatewayResponse{Allowed: true}, nil
}

// RecordSuccess records successful request
func (g *ApiGatewayPlatform) RecordSuccess(endpoint string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if cb, ok := g.circuitBreakers[endpoint]; ok {
		cb.Failures = 0
		cb.IsOpen = false
	}
}

// RecordFailure records failed request
func (g *ApiGatewayPlatform) RecordFailure(endpoint string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	cb, ok := g.circuitBreakers[endpoint]
	if !ok {
		cb = &CircuitBreakerState{
			Endpoint:  endpoint,
			Threshold: 5,
		}
		g.circuitBreakers[endpoint] = cb
	}

	cb.Failures++
	cb.LastFailure = time.Now()

	if cb.Failures >= cb.Threshold {
		cb.IsOpen = true
	}
}

// checkRateLimit checks rate limits
func (g *ApiGatewayPlatform) checkRateLimit(key string, limit int) RateLimitCheck {
	g.mu.Lock()
	defer g.mu.Unlock()

	limiter, ok := g.rateLimiters[key]
	if !ok {
		limiter = &RateLimiter{
			Key:       key,
			Limit:    limit,
			WindowSecs: 60,
		}
		g.rateLimiters[key] = limiter
	}

	now := time.Now().UnixMilli()
	windowStart := now - 60000

	// Filter to current window
	var recentRequests []int64
	for _, ts := range limiter.Requests {
		if ts > windowStart {
			recentRequests = append(recentRequests, ts)
		}
	}

	remaining := limiter.Limit - len(recentRequests)
	if remaining < 0 {
		remaining = 0
	}

	// Find reset time
	var resetAt int64
	if len(recentRequests) > 0 {
		resetAt = recentRequests[0] + 60000
	} else {
		resetAt = now + 60000
	}

	return RateLimitCheck{
		Allowed:   len(recentRequests) < limiter.Limit,
		Remaining: remaining,
		ResetAt:   resetAt,
	}
}

// checkCircuitBreaker checks circuit breaker state
func (g *ApiGatewayPlatform) checkCircuitBreaker(endpoint string) RateLimitCheck {
	g.mu.RLock()
	defer g.mu.RUnlock()

	cb, ok := g.circuitBreakers[endpoint]
	if !ok {
		return RateLimitCheck{Allowed: true}
	}

	if !cb.IsOpen {
		return RateLimitCheck{Allowed: true}
	}

	// Half-open after 30 seconds
	if time.Since(cb.LastFailure) > 30*time.Second {
		return RateLimitCheck{Allowed: true}
	}

	return RateLimitCheck{Allowed: false}
}

// VerifyPermission checks if API key has required permission
func (g *ApiGatewayPlatform) VerifyPermission(key, permission string) bool {
	g.mu.RLock()
	defer g.mu.RUnlock()

	apiKey, ok := g.apiKeys[key]
	if !ok || !apiKey.IsActive {
		return false
	}

	for _, p := range apiKey.Permissions {
		if p == permission || p == "*" {
			return true
		}
	}

	return false
}

// RevokeApiKey revokes an API key
func (g *ApiGatewayPlatform) RevokeApiKey(key string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	apiKey, ok := g.apiKeys[key]
	if !ok {
		return fmt.Errorf("API key not found")
	}

	apiKey.IsActive = false
	return nil
}

// =============================================================================
// HELPERS
// =============================================================================

func generateKey(prefix string) string {
	chars := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := prefix + "_"
	for i := 0; i < 32; i++ {
		if i%2 == 0 {
			result += string(chars[i%len(chars)])
		} else {
			result += string(chars[(i*3)%len(chars)])
		}
	}
	return result
}

func getRateLimitForTier(tier RateLimitTier) int {
	switch tier {
	case TierFree:
		return 100
	case TierBasic:
		return 1000
	case TierProfessional:
		return 10000
	case TierInstitutional:
		return 100000
	default:
		return 100
	}
}

// Handler converts gateway to HTTP handler
func (g *ApiGatewayPlatform) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey := r.Header.Get("X-API-Key")
		if apiKey == "" {
			apiKey = r.URL.Query().Get("apiKey")
		}

		if apiKey == "" {
			http.Error(w, "Missing API key", http.StatusUnauthorized)
			return
		}

		req := ApiRequestInput{
			ApiKey:   apiKey,
			Endpoint: r.URL.Path,
			Method:  r.Method,
			IP:      getClientIP(r),
		}

		resp, _ := g.ProcessRequest(r.Context(), req)
		if !resp.Allowed {
			if resp.RetryAfter != nil {
				w.Header().Set("Retry-After", fmt.Sprintf("%d", *resp.RetryAfter))
			}
			http.Error(w, resp.Error, http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func getClientIP(r *http.Request) string {
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		return strings.Split(forwarded, ",")[0]
	}
	return r.RemoteAddr
}

func init() {
	// Validate regex patterns at startup
	_ = regexp.MustCompile(`^/api/v[0-9]+/.*`)
}