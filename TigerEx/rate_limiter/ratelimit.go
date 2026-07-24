// TigerEx Rate Limiter
// Built with Go for high-load worldwide distributed systems

package main

import (
	"fmt"
	"sync"
	"time"
)

type RateLimiter struct {
	mu       sync.RWMutex
	buckets  map[string]*TokenBucket
	config   RateConfig
}

type RateConfig struct {
	RequestsPerSecond int
	BurstSize        int
	BlockDuration    time.Duration
}

type TokenBucket struct {
	tokens    int
	lastFill  time.Time
	blocked   bool
	blockedAt time.Time
}

func NewRateLimiter(config RateConfig) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*TokenBucket),
		config:  config,
	}
}

func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	bucket, exists := rl.buckets[key]
	if !exists {
		bucket = &TokenBucket{
			tokens:    rl.config.BurstSize,
			lastFill:  time.Now(),
		}
		rl.buckets[key] = bucket
	}
	
	// Check if blocked
	if bucket.blocked {
		if time.Since(bucket.blockedAt) > rl.config.BlockDuration {
			bucket.blocked = false
			bucket.tokens = rl.config.BurstSize
		} else {
			return false
		}
	}
	
	// Refill tokens
	now := time.Now()
	elapsed := now.Sub(bucket.lastFill)
	tokensToAdd := int(elapsed.Seconds()) * rl.config.RequestsPerSecond
	bucket.tokens = min(bucket.tokens + tokensToAdd, rl.config.BurstSize)
	bucket.lastFill = now
	
	// Check allowance
	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}
	
	// Block if no tokens
	bucket.blocked = true
	bucket.blockedAt = now
	return false
}

func (rl *RateLimiter) GetStats(key string) map[string]interface{} {
	rl.mu.RLock()
	defer rl.mu.RUnlock()
	
	if bucket, ok := rl.buckets[key]; ok {
		return map[string]interface{}{
			"tokens": bucket.tokens,
			"blocked": bucket.blocked,
		}
	}
	
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	fmt.Println("TigerEx Rate Limiter")
	
	config := RateConfig{
		RequestsPerSecond: 10,
		BurstSize:        20,
		BlockDuration:    time.Minute,
	}
	
	limiter := NewRateLimiter(config)
	
	// Test
	for i := 0; i < 25; i++ {
		allowed := limiter.Allow("user1")
		if !allowed {
			fmt.Printf("Request %d: BLOCKED\n", i+1)
		} else {
			fmt.Printf("Request %d: ALLOWED\n", i+1)
		}
	}
	
	stats := limiter.GetStats("user1")
	fmt.Printf("\nStats: %v\n", stats)
}
