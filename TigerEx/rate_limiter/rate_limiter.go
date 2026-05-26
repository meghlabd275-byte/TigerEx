package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// RATE LIMITER - Go Implementation
// Token bucket rate limiting for TigerEx
// ============================================================================

// RateLimiter implements token bucket rate limiting
type RateLimiter struct {
	mu         sync.Mutex
	tokens     int
	maxTokens  int
	refillRate time.Duration
	lastRefill time.Time
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(maxTokens int, refillRate time.Duration) *RateLimiter {
	return &RateLimiter{
		tokens:     maxTokens,
		maxTokens:  maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

// Allow checks if a request is allowed
func (rl *RateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(rl.lastRefill)

	// Refill tokens
	if elapsed >= rl.refillRate {
		refills := int(elapsed / rl.refillRate)
		rl.tokens = min(rl.tokens+refills, rl.maxTokens)
		rl.lastRefill = now
	}

	if rl.tokens > 0 {
		rl.tokens--
		return true
	}

	return false
}

// Remaining returns remaining tokens
func (rl *RateLimiter) Remaining() int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	return rl.tokens
}

// Reset resets the rate limiter
func (rl *RateLimiter) Reset() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.tokens = rl.maxTokens
	rl.lastRefill = time.Now()
}

// CheckResult represents the check result
type CheckResult struct {
	Allowed   bool   `json:"allowed"`
	Limit    int    `json:"limit"`
	Remaining int   `json:"remaining"`
	ResetIn  int64  `json:"resetInMs"`
}

// Check performs rate limiting and returns detailed result
func (rl *RateLimiter) Check() CheckResult {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(rl.lastRefill)

	// Refill tokens
	if elapsed >= rl.refillRate {
		refills := int(elapsed / rl.refillRate)
		rl.tokens = min(rl.tokens+refills, rl.maxTokens)
		rl.lastRefill = now
	}

	allowed := rl.tokens > 0
	if allowed {
		rl.tokens--
	}

	resetIn := rl.refillRate.Milliseconds()
	if rl.tokens > 0 {
		// Approximate reset time
		needed := rl.maxTokens - rl.tokens
		resetIn = int64(needed) * rl.refillRate.Milliseconds()
	}

	return CheckResult{
		Allowed:   allowed,
		Limit:    rl.maxTokens,
		Remaining: rl.tokens,
		ResetIn:  resetIn,
	}
}

// ============================================================================
// DISTRIBUTED RATE LIMITER
// ============================================================================

// DistributedLimiter distributes limiting across instances
type DistributedLimiter struct {
	limiters map[string]*RateLimiter
	mu      sync.RWMutex
}

// NewDistributedLimiter creates a distributed rate limiter
func NewDistributedLimiter() *DistributedLimiter {
	return &DistributedLimiter{
		limiters: make(map[string]*RateLimiter),
	}
}

// GetLimiter gets or creates a rate limiter for a client
func (dl *DistributedLimiter) GetLimiter(clientID string, limit int) *RateLimiter {
	dl.mu.Lock()
	defer dl.mu.Unlock()

	if limiter, ok := dl.limiters[clientID]; ok {
		return limiter
	}

	limiter := NewRateLimiter(limit, time.Second)
	dl.limiters[clientID] = limiter
	return limiter
}

// CheckClient checks rate limit for a client
func (dl *DistributedLimiter) CheckClient(clientID string, limit int) CheckResult {
	limiter := dl.GetLimiter(clientID, limit)
	return limiter.Check()
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	// Per-client rate limiter
	distLimiter := NewDistributedLimiter()

	// Check from different clients
	result1 := distLimiter.CheckClient("user_1", 100)
	fmt.Printf("User 1: %+v\n", result1)

	result2 := distLimiter.CheckClient("user_2", 50)
	fmt.Printf("User 2: %+v\n", result2)

	// Test burst allowance
	limiter := NewRateLimiter(10, time.Second)
	
	for i := 0; i < 15; i++ {
		result := limiter.Check()
		fmt.Printf("Request %d: allowed=%v, remaining=%d\n", i+1, result.Allowed, result.Remaining)
	}
}