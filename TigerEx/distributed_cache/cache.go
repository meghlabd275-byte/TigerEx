// TigerEx Distributed Cache
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type CacheEntry struct {
	Key        string
	Value      interface{}
	Expiration time.Time
	Hits       int64
	CreatedAt  time.Time
}

type CacheNode struct {
	ID        string
	Address   string
	IsHealthy bool
	LastPing  time.Time
}

type DistributedCache struct {
	mu         sync.RWMutex
	localCache map[string]*CacheEntry
	nodes      map[string]*CacheNode
	shardCount int
	stats      CacheStats
}

type CacheStats struct {
	Hits      int64
	Misses    int64
	Evictions int64
	Bytes     int64
}

func NewDistributedCache(shardCount int) *DistributedCache {
	return &DistributedCache{
		localCache: make(map[string]*CacheEntry),
		nodes:      make(map[string]*CacheNode),
		shardCount: shardCount,
	}
}

func (c *DistributedCache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := &CacheEntry{
		Key: key, Value: value,
		Expiration: time.Now().Add(ttl),
		Hits: 0, CreatedAt: time.Now(),
	}
	c.localCache[key] = entry
	return nil
}

func (c *DistributedCache) Get(ctx context.Context, key string) (interface{}, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, exists := c.localCache[key]
	if !exists {
		c.stats.Misses++
		return nil, false
	}
	if time.Now().After(entry.Expiration) {
		delete(c.localCache, key)
		c.stats.Misses++
		return nil, false
	}
	entry.Hits++
	c.stats.Hits++
	return entry.Value, true
}

func (c *DistributedCache) Delete(ctx context.Context, key string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.localCache, key)
	return nil
}

func (c *DistributedCache) AddNode(address string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	nodeID := generateNodeID(address)
	c.nodes[nodeID] = &CacheNode{ID: nodeID, Address: address, IsHealthy: true, LastPing: time.Now()}
}

func (c *DistributedCache) GetStats() CacheStats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.stats
}

func generateNodeID(addr string) string {
	h := sha256.Sum256([]byte(addr + fmt.Sprintf("%d", time.Now().Unix())))
	return hex.EncodeToString(h[:8])
}

func main() {
	fmt.Println("TigerEx Distributed Cache")
	fmt.Println("========================")
	
	cache := NewDistributedCache(10)
	cache.AddNode("cache-1.tigerex.com:6379")
	cache.AddNode("cache-2.tigerex.com:6379")
	
	cache.Set(context.Background(), "user:1", map[string]string{"name": "John"}, time.Hour)
	cache.Set(context.Background(), "price:BTC", 50000.0, time.Minute)
	
	if val, ok := cache.Get(context.Background(), "user:1"); ok {
		fmt.Printf("user:1 = %v\n", val)
	}
	
	stats := cache.GetStats()
	fmt.Printf("\nStats: Hits=%d, Misses=%d\n", stats.Hits, stats.Misses)
}
