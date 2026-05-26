package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// CACHE TYPES
// ============================================================================

type CacheEntry struct {
	Key        string
	Value     interface{}
	Expiration int64 // Unix timestamp
	CreatedAt int64
	AccessCount int64
	LastAccess int64
	Tags      []string
}

type CacheStats struct {
	Hits        int64 `json:"hits"`
	Misses      int64 `json:"misses"`
	Evictions   int64 `json:"evictions"`
	Items       int64 `json:"items"`
	MemoryUsage int64 `json:"memoryUsage"`
}

type CacheConfig struct {
	MaxItems       int
	MaxMemoryMB    int
	DefaultTTL    time.Duration
	CleanupInterval time.Duration
	EvictionPolicy string // "lru", "lfu", "fifo"
}

// ============================================================================
// DISTRIBUTED CACHE
// ============================================================================

type DistributedCache struct {
	mu sync.RWMutex

	// Storage
	items map[string]*CacheEntry

	// Indexes
	tagIndex   map[string]map[string]bool // tag -> keys
	expiryIndex map[int64][]string // timestamp -> keys

	// Configuration
	config *CacheConfig

	// Statistics
	stats CacheStats

	// LRU tracking
	lruHead *CacheEntry
	lruTail *CacheEntry
	lruMap  map[string]*CacheEntry

	// Running state
	running bool
}

func NewDistributedCache(config *CacheConfig) *DistributedCache {
	if config == nil {
		config = &CacheConfig{
			MaxItems:        1000000,
			MaxMemoryMB:     1024,
			DefaultTTL:       1 * time.Hour,
			CleanupInterval: 5 * time.Minute,
			EvictionPolicy:  "lru",
		}
	}

	dc := &DistributedCache{
		items:      make(map[string]*CacheEntry),
		tagIndex:   make(map[string]map[string]bool),
		expiryIndex: make(map[int64][]string),
		config:     config,
		lruMap:    make(map[string]*CacheEntry),
	}

	return dc
}

// ============================================================================
// CORE CACHE OPERATIONS
// ============================================================================

func (dc *DistributedCache) Set(key string, value interface{}, ttl time.Duration) error {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	now := time.Now().UnixMilli()
	var expiration int64
	if ttl > 0 {
		expiration = now + ttl.Milliseconds()
	} else {
		expiration = now + dc.config.DefaultTTL.Milliseconds()
	}

	entry := &CacheEntry{
		Key:        key,
		Value:      value,
		Expiration: expiration,
		CreatedAt:  now,
		AccessCount: 1,
		LastAccess: now,
	}

	// Check if exists for LRU update
	existing, exists := dc.items[key]

	if exists {
		// Remove from LRU list
		dc.removeFromLRU(existing)
	}

	// Add to storage
	dc.items[key] = entry

	// Add to LRU list
	dc.addToLRU(entry)

	// Update expiry index
	dc.expiryIndex[expiration] = append(dc.expiryIndex[expiration], key)

	// Check if eviction needed
	if len(dc.items) > dc.config.MaxItems {
		dc.evict()
	}

	return nil
}

func (dc *DistributedCache) Get(key string) (interface{}, bool) {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	entry, exists := dc.items[key]
	if !exists {
		dc.stats.Misses++
		return nil, false
	}

	// Check expiration
	if entry.Expiration > 0 && time.Now().UnixMilli() > entry.Expiration {
		dc.deleteEntry(key, entry)
		dc.stats.Misses++
		return nil, false
	}

	// Update access
	entry.AccessCount++
	entry.LastAccess = time.Now().UnixMilli()

	// Move to front of LRU
	dc.moveToFront(entry)

	dc.stats.Hits++
	dc.stats.Items = int64(len(dc.items))

	return entry.Value, true
}

func (dc *DistributedCache) Delete(key string) bool {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	entry, exists := dc.items[key]
	if !exists {
		return false
	}

	dc.deleteEntry(key, entry)
	return true
}

func (dc *DistributedCache) Exists(key string) bool {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	entry, exists := dc.items[key]
	if !exists {
		return false
	}

	// Check expiration
	if entry.Expiration > 0 && time.Now().UnixMilli() > entry.Expiration {
		return false
	}

	return true
}

// ============================================================================
// TAGGED OPERATIONS
// ============================================================================

func (dc *DistributedCache) SetWithTags(key string, value interface{}, tags []string, ttl time.Duration) error {
	if err := dc.Set(key, value, ttl); err != nil {
		return err
	}

	dc.mu.Lock()
	defer dc.mu.Unlock()

	entry := dc.items[key]
	if entry != nil {
		entry.Tags = tags
		for _, tag := range tags {
			if dc.tagIndex[tag] == nil {
				dc.tagIndex[tag] = make(map[string]bool)
			}
			dc.tagIndex[tag][key] = true
		}
	}

	return nil
}

func (dc *DistributedCache) GetByTag(tag string) []interface{} {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	keys, exists := dc.tagIndex[tag]
	if !exists {
		return nil
	}

	results := make([]interface{}, 0)
	now := time.Now().UnixMilli()

	for key := range keys {
		entry, exists := dc.items[key]
		if exists && (entry.Expiration == 0 || now <= entry.Expiration) {
			results = append(results, entry.Value)
		}
	}

	return results
}

func (dc *DistributedCache) DeleteByTag(tag string) int {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	keys, exists := dc.tagIndex[tag]
	if !exists {
		return 0
	}

	count := 0
	for key := range keys {
		entry, exists := dc.items[key]
		if exists {
			dc.deleteEntry(key, entry)
			count++
		}
	}

	delete(dc.tagIndex, tag)
	return count
}

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

func (dc *DistributedCache) Flush() {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	dc.items = make(map[string]*CacheEntry)
	dc.tagIndex = make(map[string]map[string]bool)
	dc.expiryIndex = make(map[int64][]string)
	dc.lruHead = nil
	dc.lruTail = nil
	dc.lruMap = make(map[string]*CacheEntry)

	dc.stats = CacheStats{}
}

func (dc *DistributedCache) Keys() []string {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	keys := make([]string, 0, len(dc.items))
	now := time.Now().UnixMilli()

	for key, entry := range dc.items {
		if entry.Expiration == 0 || now <= entry.Expiration {
			keys = append(keys, key)
		}
	}

	return keys
}

func (dc *DistributedCache) Size() int {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	now := time.Now().UnixMilli()
	count := 0

	for _, entry := range dc.items {
		if entry.Expiration == 0 || now <= entry.Expiration {
			count++
		}
	}

	return count
}

// ============================================================================
// LRU OPERATIONS
// ============================================================================

func (dc *DistributedCache) addToLRU(entry *CacheEntry) {
	if dc.lruHead == nil {
		dc.lruHead = entry
		dc.lruTail = entry
	} else {
		entry.Next = dc.lruHead
		dc.lruHead.Prev = entry
		dc.lruHead = entry
	}

	dc.lruMap[entry.Key] = entry
}

func (dc *DistributedCache) removeFromLRU(entry *CacheEntry) {
	if entry.Prev != nil {
		entry.Prev.Next = entry.Next
	} else {
		dc.lruHead = entry.Next
	}

	if entry.Next != nil {
		entry.Next.Prev = entry.Prev
	} else {
		dc.lruTail = entry.Prev
	}

	delete(dc.lruMap, entry.Key)
}

func (dc *DistributedCache) moveToFront(entry *CacheEntry) {
	dc.removeFromLRU(entry)
	dc.addToLRU(entry)
}

// ============================================================================
// EVICTION
// ============================================================================

func (dc *DistributedCache) evict() {
	evictCount := len(dc.items) - dc.config.MaxItems + 100

	for i := 0; i < evictCount; i++ {
		if dc.lruTail == nil {
			break
		}

		dc.deleteEntry(dc.lruTail.Key, dc.lruTail)
		dc.stats.Evictions++
	}
}

func (dc *DistributedCache) cleanupExpired() {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	now := time.Now().UnixMilli()
	expired := make([]string, 0)

	for timestamp, keys := range dc.expiryIndex {
		if timestamp < now {
			expired = append(expired, keys...)
			delete(dc.expiryIndex, timestamp)
		}
	}

	for _, key := range expired {
		if entry, exists := dc.items[key]; exists {
			dc.deleteEntry(key, entry)
		}
	}
}

func (dc *DistributedCache) deleteEntry(key string, entry *CacheEntry) {
	// Remove from LRU
	dc.removeFromLRU(entry)

	// Remove from storage
	delete(dc.items, key)

	// Remove from tag indexes
	for _, tag := range entry.Tags {
		if tagIndex, exists := dc.tagIndex[tag]; exists {
			delete(tagIndex, key)
			if len(tagIndex) == 0 {
				delete(dc.tagIndex, tag)
			}
		}
	}
}

// ============================================================================
// DISTRIBUTED CACHE (Redis-like interface)
// ============================================================================

type DistributedCacheService struct {
	localCache *DistributedCache
	shards     []*DistributedCache
	shardCount int
}

func NewDistributedCacheService(shardCount int) *DistributedCacheService {
	if shardCount <= 0 {
		shardCount = 16
	}

	service := &DistributedCacheService{
		localCache: NewDistributedCache(nil),
		shards:     make([]*DistributedCache, shardCount),
		shardCount: shardCount,
	}

	// Initialize shards
	for i := 0; i < shardCount; i++ {
		service.shards[i] = NewDistributedCache(nil)
	}

	return service
}

func (dcs *DistributedCacheService) getShard(key string) *DistributedCache {
	// Simple hash-based sharding
	hash := 0
	for _, c := range key {
		hash = hash*31 + int(c)
	}
	return dcs.shards[hash%dcs.shardCount]
}

func (dcs *DistributedCacheService) Set(key string, value interface{}, ttl time.Duration) error {
	return dcs.getShard(key).Set(key, value, ttl)
}

func (dcs *DistributedCacheService) Get(key string) (interface{}, bool) {
	return dcs.getShard(key).Get(key)
}

func (dcs *DistributedCacheService) Delete(key string) bool {
	return dcs.getShard(key).Delete(key)
}

func (dcs *DistributedCacheService) SetLocal(key string, value interface{}, ttl time.Duration) error {
	return dcs.localCache.Set(key, value, ttl)
}

func (dcs *DistributedCacheService) GetLocal(key string) (interface{}, bool) {
	return dcs.localCache.Get(key)
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

func (dc *DistributedCache) GetTTL(key string) (time.Duration, bool) {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	entry, exists := dc.items[key]
	if !exists {
		return 0, false
	}

	if entry.Expiration == 0 {
		return 0, true // No expiration
	}

	remaining := time.Until(time.UnixMilli(entry.Expiration))
	return remaining, true
}

func (dc *DistributedCache) Increment(key string, amount int64) (int64, error) {
	dc.mu.Lock()
	defer dc.mu.Unlock()

	var current int64

	entry, exists := dc.items[key]
	if exists {
		if v, ok := entry.Value.(int64); ok {
			current = v
		}
	}

	newValue := current + amount
	dc.items[key] = &CacheEntry{
		Key:         key,
		Value:       newValue,
		Expiration:  time.Now().Add(dc.config.DefaultTTL).UnixMilli(),
		CreatedAt:   time.Now().UnixMilli(),
		AccessCount: 1,
		LastAccess:  time.Now().UnixMilli(),
	}

	return newValue, nil
}

func (dc *DistributedCache) Decrement(key string, amount int64) (int64, error) {
	return dc.Increment(key, -amount)
}

// ============================================================================
// STATISTICS
// ============================================================================

func (dc *DistributedCache) GetStats() CacheStats {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	dc.stats.Items = int64(len(dc.items))

	return dc.stats
}

func (dc *DistributedCache) GetHitRate() float64 {
	dc.mu.RLock()
	defer dc.mu.RUnlock()

	total := dc.stats.Hits + dc.stats.Misses
	if total == 0 {
		return 0
	}

	return float64(dc.stats.Hits) / float64(total) * 100
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Distributed Cache (Go)")
	fmt.Println("==================================\n")

	// Create cache
	cache := NewDistributedCache(&CacheConfig{
		MaxItems:       100000,
		DefaultTTL:     1 * time.Hour,
		EvictionPolicy: "lru",
	})

	// Set values
	fmt.Println("Setting values...")

	cache.Set("user:1:name", "Alice", 1*time.Hour)
	cache.Set("user:2:name", "Bob", 1*time.Hour)
	cache.Set("user:3:name", "Charlie", 1*time.Hour)
	cache.Set("product:1:price", 99.99, 30*time.Minute)
	cache.Set("product:2:price", 149.99, 30*time.Minute)

	// Set with tags
	cache.SetWithTags("user:1:profile", map[string]interface{}{"email": "alice@example.com"}, []string{"user", "profile"}, 1*time.Hour)
	cache.SetWithTags("user:2:profile", map[string]interface{}{"email": "bob@example.com"}, []string{"user", "profile"}, 1*time.Hour)

	// Get values
	fmt.Println("\nGetting values...")

	if name, ok := cache.Get("user:1:name"); ok {
		fmt.Printf("user:1:name = %v\n", name)
	}

	if price, ok := cache.Get("product:1:price"); ok {
		fmt.Printf("product:1:price = %v\n", price)
	}

	// Test tags
	fmt.Println("\nTagged queries...")
	profiles := cache.GetByTag("profile")
	fmt.Printf("Profiles: %d found\n", len(profiles))

	// Increment
	count, _ := cache.Increment("visits:page1", 1)
	fmt.Printf("\nVisits: %d\n", count)

	count, _ = cache.Increment("visits:page1", 1)
	fmt.Printf("Visits: %d\n", count)

	// Statistics
	fmt.Println("\nStatistics...")
	stats := cache.GetStats()
	statsJSON, _ := json.MarshalIndent(stats, "", "  ")
	fmt.Printf("Stats: %s\n", string(statsJSON))

	fmt.Printf("Hit rate: %.2f%%\n", cache.GetHitRate())

	// Keys
	fmt.Println("\nAll keys:", cache.Keys())

	// Distributed cache service
	fmt.Println("\n--- Distributed Cache Service ---")

	distCache := NewDistributedCacheService(8)

	distCache.Set("session:abc123", map[string]interface{}{"user": "alice"}, 30*time.Minute)
	distCache.Set("session:def456", map[string]interface{}{"user": "bob"}, 30*time.Minute)

	if session, ok := distCache.Get("session:abc123"); ok {
		fmt.Printf("Session: %v\n", session)
	}

	fmt.Println("\nCache service ready.")
}