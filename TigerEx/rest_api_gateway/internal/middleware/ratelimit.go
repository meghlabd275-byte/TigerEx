package middleware

import (
	"context"
	"fmt"
	"sync"
	"time"

	"tigerEx/rest_api_gateway/internal/config"
	"tigerEx/rest_api_gateway/internal/models"
)

// ============================================================================
// RATE LIMITER
// ============================================================================

// RateLimiter implements token bucket rate limiting
type RateLimiter struct {
	config        *config.RateLimitConfig
	buckets     map[string]*tokenBucket
	mu          sync.RWMutex
	blockList  map[string]blockedKey
	blockTimer  *time.Timer
}

// tokenBucket represents a token bucket
type tokenBucket struct {
	tokens    float64
	maxTokens float64
	lastFill  time.Time
}

// blockedKey represents a blocked key with expiry
type blockedKey struct {
	expires   time.Time
	reason    string
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(cfg *config.RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{
		config:    cfg,
		buckets:   make(map[string]*tokenBucket),
		blockList: make(map[string]blockedKey),
	}

	// Start cleanup timer
	rl.blockTimer = time.AfterFunc(5*time.Minute, func() {
		rl.cleanup()
	})

	return rl
}

// Allow checks if a request should be allowed
func (rl *RateLimiter) Allow(key string) (bool, *models.APIResponse) {
	// Check whitelist
	for _, w := range rl.config.WhiteList {
		if key == w {
			return true, nil
		}
	}

	// Check if blocked
	rl.mu.RLock()
	if blocked, ok := rl.blockList[key]; ok {
		rl.mu.RUnlock()
		if time.Now().Before(blocked.expires) {
			return false, models.NewErrorResponse(429, fmt.Sprintf("Rate limit exceeded: %s", blocked.reason))
		}
		// Unblock
		rl.mu.Lock()
		delete(rl.blockList, key)
		rl.mu.Unlock()
	}
	rl.mu.RUnlock()

	// Get or create bucket
	rl.mu.Lock()
	bucket, ok := rl.buckets[key]
	if !ok {
		bucket = &tokenBucket{
			tokens:    float64(rl.config.BurstSize),
			maxTokens: float64(rl.config.BurstSize),
			lastFill:  time.Now(),
		}
		rl.buckets[key] = bucket
	}
	rl.mu.Unlock()

	// Refill tokens
	rl.refill(bucket)

	// Check if allowed
	if bucket.tokens >= 1 {
		bucket.tokens--
		return true, nil
	}

	// Block key
	rl.mu.Lock()
	rl.blockList[key] = blockedKey{
		expires: time.Now().Add(rl.config.BlockDuration),
		reason:  "Rate limit exceeded",
	}
	rl.mu.Unlock()

	return false, models.NewErrorResponse(429, "Rate limit exceeded")
}

// refill refills the token bucket
func (rl *RateLimiter) refill(bucket *tokenBucket) {
	now := time.Now()
	elapsed := now.Sub(bucket.lastFill).Seconds()
	
	// Refill based on requests per minute
	refillRate := float64(rl.config.RequestsPerMinute) / 60.0
	tokensToAdd := elapsed * refillRate
	
	bucket.tokens += tokensToAdd
	if bucket.tokens > bucket.maxTokens {
		bucket.tokens = bucket.maxTokens
	}
	
	bucket.lastFill = now
}

// cleanup removes expired blocks
func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	now := time.Now()
	for key, blocked := range rl.blockList {
		if now.After(blocked.expires) {
			delete(rl.blockList, key)
		}
	}
}

// GetRemaining returns remaining requests for a key
func (rl *RateLimiter) GetRemaining(key string) int {
	rl.mu.RLock()
	bucket, ok := rl.buckets[key]
	rl.mu.RUnlock()
	
	if !ok {
		return rl.config.BurstSize
	}
	
	rl.refill(bucket)
	return int(bucket.tokens)
}

// Reset resets rate limit for a key
func (rl *RateLimiter) Reset(key string) {
	rl.mu.Lock()
	delete(rl.buckets, key)
	delete(rl.blockList, key)
	rl.mu.Unlock()
}

// ============================================================================
// IP RATE LIMITER
// ============================================================================

// IPRateLimiter limits requests by IP address
type IPRateLimiter struct {
	*RateLimiter
	trustedProxies []string
}

// NewIPRateLimiter creates a new IP rate limiter
func NewIPRateLimiter(cfg *config.RateLimitConfig, trustedProxies []string) *IPRateLimiter {
	return &IPRateLimiter{
		RateLimiter:    NewRateLimiter(cfg),
		trustedProxies: trustedProxies,
	}
}

// GetClientIP extracts client IP from request
func (irl *IPRateLimiter) GetClientIP(xForwardedFor, remoteAddr string) string {
	// Check X-Forwarded-For header
	if xForwardedFor != "" {
		// Take first IP (original client)
		for i := 0; i < len(xForwardedFor); i++ {
			if xForwardedFor[i] == ',' {
				return xForwardedFor[:i]
			}
		}
		return xForwardedFor
	}
	
	// Remove port from remote addr
	for i := len(remoteAddr) - 1; i >= 0; i-- {
		if remoteAddr[i] == ':' {
			return remoteAddr[:i]
		}
	}
	return remoteAddr
}

// ============================================================================
// API KEY RATE LIMITER
// ============================================================================

// APIKeyRateLimiter limits requests by API key tier
type APIKeyRateLimiter struct {
	tierLimits map[string]*RateLimiter
}

// NewAPIKeyRateLimiter creates a new API key rate limiter
func NewAPIKeyRateLimiter(cfg *config.APIKeysConfig) *APIKeyRateLimiter {
	akrl := &APIKeyRateLimiter{
		tierLimits: make(map[string]*RateLimiter),
	}

	// Create rate limiter for each tier
	for tier, limit := range cfg.RateLimits {
		akrl.tierLimits[tier] = NewRateLimiter(&config.RateLimitConfig{
			Enabled:            true,
			RequestsPerMinute: limit,
			BurstSize:         limit / 10,
			BlockDuration:    15 * time.Minute,
		})
	}

	return akrl
}

// Allow checks if request is allowed for tier
func (akrl *APIKeyRateLimiter) Allow(tier, key string) (bool, *models.APIResponse) {
	rl, ok := akrl.tierLimits[tier]
	if !ok {
		rl = akrl.tierLimits["free"] // Default to free tier
	}
	return rl.Allow(key)
}

// ============================================================================
// CONTEXT-BASED RATE LIMITER
// ============================================================================

type rateLimitKey struct{}

func WithRateLimiter(ctx context.Context, rl *RateLimiter) context.Context {
	return context.WithValue(ctx, rateLimitKey{}, rl)
}

func GetRateLimiter(ctx context.Context) *RateLimiter {
	if rl, ok := ctx.Value(rateLimitKey{}).(*RateLimiter); ok {
		return rl
	}
	return nil
}

// ============================================================================
// CORS MIDDLEWARE
// ============================================================================

// CORSConfig holds CORS configuration
type CORSConfig struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders  []string
	ExposedHeaders  []string
	AllowCredentials bool
	MaxAge          int
}

// CORS middleware
type CORS struct {
	config *CORSConfig
}

// NewCORS creates a new CORS middleware
func NewCORS(cfg *CORSConfig) *CORS {
	return &CORS{config: cfg}
}

// Handle handles CORS for request
func (c *CORS) Handle(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		
		// Check if origin is allowed
		allowed := false
		for _, o := range c.config.AllowedOrigins {
			if o == "*" || o == origin {
				allowed = true
				break
			}
		}
		
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", joinStrings(c.config.AllowedMethods))
			w.Header().Set("Access-Control-Allow-Headers", joinStrings(c.config.AllowedHeaders))
			w.Header().Set("Access-Control-Expose-Headers", joinStrings(c.config.ExposedHeaders))
			
			if c.config.AllowCredentials {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			if c.config.MaxAge > 0 {
				w.Header().Set("Access-Control-Max-Age", fmt.Sprintf("%d", c.config.MaxAge))
			}
		}
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

func joinStrings(ss []string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += ", "
		}
		result += s
	}
	return result
}