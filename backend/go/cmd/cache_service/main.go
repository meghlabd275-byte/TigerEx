// Package cache - Cache Service with Redis-like API
package main

import (
	"fmt"
	"sync"
	"time"
)

type CacheService struct {
	mu sync.RWMutex
	data map[string]cacheItem
}

type cacheItem struct {
	Value    interface{}
	ExpireAt time.Time
}

func New() *CacheService {
	return &CacheService{data: make(map[string]cacheItem)}
}

func (c *CacheService) Set(key string, val interface{}, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data[key] = cacheItem{
		Value:    val,
		ExpireAt: time.Now().Add(ttl),
	}
}

func (c *CacheService) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	item, ok := c.data[key]
	if !ok || time.Now().After(item.ExpireAt) {
		return nil, false
	}
	return item.Value, true
}

func (c *CacheService) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.data, key)
}

func main() {
	c := New()
	c.Set("user:1", "John", 5*time.Minute)
	val, ok := c.Get("user:1")
	fmt.Println(val, ok)
}