package main

import (
	"context"
	"fmt"
	"time"
)

// Cache keys
const (
	KeyTicker    = "ticker:%s"
	KeyOrder    = "order:%s"
	KeyUser    = "user:%s"
	KeyMarket  = "market:%s"
)

// Cache entry with TTL
type CacheEntry struct {
	Value     interface{}
	ExpiresAt time.Time
}

// In-memory cache (placeholder for Redis)
type Cache struct {
	data map[string]CacheEntry
}

// NewCache creates new cache
func NewCache() *Cache {
	return &Cache{data: make(map[string]CacheEntry)}
}

// Get value from cache
func (c *Cache) Get(ctx context.Context, key string) (interface{}, error) {
	entry, ok := c.data[key]
	if !ok {
		return nil, nil
	}
	
	if time.Now().After(entry.ExpiresAt) {
		delete(c.data, key)
		return nil, nil
	}
	
	return entry.Value, nil
}

// Set value in cache
func (c *Cache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	expiresAt := time.Now().Add(ttl)
	c.data[key] = CacheEntry{
		Value:     value,
		ExpiresAt: expiresAt,
	}
	return nil
}

// Delete key from cache
func (c *Cache) Delete(ctx context.Context, key string) error {
	delete(c.data, key)
	return nil
}

// Exists check
func (c *Cache) Exists(ctx context.Context, key string) (bool, error) {
	_, err := c.Get(ctx, key)
	return err == nil, nil
}

// Hot cache for real-time data
type HotCache struct {
	tickers map[string]interface{}
}

// NewHotCache creates hot cache
func NewHotCache() *HotCache {
	return &HotCache{tickers: make(map[string]interface{})}
}

// Set ticker data
func (hc *HotCache) SetTicker(symbol string, data interface{}) {
	hc.tickers[symbol] = data
}

// Get ticker data
func (hc *HotCache) GetTicker(symbol string) interface{} {
	return hc.tickers[symbol]
}

// Delete ticker
func (hc *HotCache) DeleteTicker(symbol string) {
	delete(hc.tickers, symbol)
}

// Rate limiter
type RateLimiter struct {
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

// NewRateLimiter creates rate limiter
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
}

// Check if request is allowed
func (rl *RateLimiter) Check(key string) bool {
	now := time.Now()
	
	// Clean old requests
	requests := rl.requests[key]
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

// Get remaining requests
func (rl *RateLimiter) Remaining(key string) int {
	now := time.Now()
	
	requests := rl.requests[key]
	var count int
	for _, t := range requests {
		if now.Sub(t) < rl.window {
			count++
		}
	}
	
	return rl.limit - count
}

// Redis client placeholder
type RedisClient struct {
	cache    *Cache
	hotCache *HotCache
}

// NewRedisClient creates Redis client
func NewRedisClient() *RedisClient {
	return &RedisClient{
		cache:    NewCache(),
		hotCache: NewHotCache(),
	}
}

// Cache operations
func (rc *RedisClient) Get(key string) (interface{}, error) {
	return rc.cache.Get(context.Background(), key)
}

func (rc *RedisClient) Set(key string, value interface{}, ttl time.Duration) error {
	return rc.cache.Set(context.Background(), key, value, ttl)
}

func (rc *RedisClient) Delete(key string) error {
	return rc.cache.Delete(context.Background(), key)
}

// Hot cache operations
func (rc *RedisClient) SetTicker(symbol string, data interface{}) {
	rc.hotCache.SetTicker(symbol, data)
}

func (rc *RedisClient) GetTicker(symbol string) interface{} {
	return rc.hotCache.GetTicker(symbol)
}

func main() {
	client := NewRedisClient()
	
	// Test cache
	err := client.Set("test_key", "test_value", time.Minute*5)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	value, err := client.Get("test_key")
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	
	fmt.Println("Cached value:", value)
	
	// Test rate limiter
	limiter := NewRateLimiter(10, time.Minute)
	for i := 0; i < 12; i++ {
		allowed := limiter.Check("user1")
		remaining := limiter.Remaining("user1")
		fmt.Printf("Request %d: allowed=%v, remaining=%d\n", i+1, allowed, remaining)
	}
}