// Package ratelimit - Rate Limiter Service
package main

import (
	"fmt"
	"sync"
	"time"
)

type Bucket struct {
	capacity int
	tokens int
	rate int
	last time.Time
}

type RateLimiter struct {
	mu sync.RWMutex
	buckets map[string]*Bucket
	counter uint64
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*Bucket),
	}
}

func (rl *RateLimiter) Allow(key string, capacity int, rate int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	bucket, ok := rl.buckets[key]
	if !ok {
		bucket = &Bucket{
			capacity: capacity,
			tokens: capacity,
			rate: rate,
			last: time.Now(),
		}
		rl.buckets[key] = bucket
		return true
	}

	now := time.Now()
	elapsed := now.Sub(bucket.last)
	add := int(elapsed.Seconds()) * bucket.rate
	
	bucket.tokens = min(bucket.capacity, bucket.tokens+add)
	bucket.last = now

	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}

	return false
}

func (rl *RateLimiter) GetLimit(key string) (int, int) {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	bucket, ok := rl.buckets[key]
	if !ok {
		return 0, 0
	}
	return bucket.tokens, bucket.capacity
}

func (rl *RateLimiter) Block(key string, duration time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	bucket, ok := rl.buckets[key]
	if ok {
		bucket.tokens = 0
	}
}

func main() {
	rl := NewRateLimiter()

	allowed := rl.Allow("user1", 100, 10)
	fmt.Printf("Allowed: %v\n", allowed)

	for i := 0; i < 5; i++ {
		ok := rl.Allow("user1", 100, 10)
		fmt.Printf("Request %d: %v\n", i+1, ok)
	}

	tokens, cap := rl.GetLimit("user1")
	fmt.Printf("Tokens: %d/%d\n", tokens, cap)
}