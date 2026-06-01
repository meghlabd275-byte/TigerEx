#!/usr/bin/env python3
"""
Production Cache Manager

High-performance caching system with:
- In-memory caching with TTL
- Redis-backed distributed cache
- LRU eviction
- Cache warming
- Metrics and monitoring
"""

import asyncio
import time
import logging
import threading
from typing import Any, Optional, Dict, Callable
from dataclasses import dataclass, field
from collections import OrderedDict
from enum import Enum
import hashlib
import json
import pickle

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CacheStrategy(Enum):
    """Cache strategies"""
    LRU = "least_recently_used"
    LFU = "least_frequently_used"
    FIFO = "first_in_first_out"
    TTL = "time_to_live"


@dataclass
class CacheEntry:
    """Cache entry with metadata"""
    value: Any
    expires: float
    created_at: float = field(default_factory=time.time)
    access_count: int = 0
    last_access: float = field(default_factory=time.time)
    size_bytes: int = 0
    
    def touch(self):
        """Update access metadata"""
        self.access_count += 1
        self.last_access = time.time()
    
    def is_expired(self) -> bool:
        """Check if entry is expired"""
        return time.time() > self.expires if self.expires > 0 else False


class InMemoryCache:
    """
    High-performance in-memory cache with LRU eviction
    
    Features:
    - O(1) get/put operations
    - Automatic expiration
    - Size limits with eviction
    - Thread-safe operations
    - Cache statistics
    """
    
    def __init__(
        self,
        max_size: int = 10000,
        default_ttl: int = 300,
        strategy: CacheStrategy = CacheStrategy.LRU
    ):
        self.max_size = max_size
        self.default_ttl = default_ttl
        self.strategy = strategy
        
        # Storage with order for LRU
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        
        # Thread safety
        self._lock = threading.RLock()
        
        # Stats
        self._stats = {
            "hits": 0,
            "misses": 0,
            "evictions": 0,
            "expirations": 0,
            "sets": 0,
            "deletes": 0
        }
        
        # Metrics collection
        self._metrics_lock = threading.Lock()
        
        logger.info(f"Initialized in-memory cache: max={max_size}, ttl={default_ttl}s, strategy={strategy.value}")
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None, size_hint: int = 0) -> bool:
        """
        Set a cache entry
        
        Args:
            key: Cache key
            value: Value to cache
            ttl: Time to live in seconds (uses default if not provided)
            size_hint: Estimated size in bytes for memory tracking
            
        Returns:
            True if successful
        """
        with self._lock:
            # Check if we need to evict
            if key not in self._cache and len(self._cache) >= self.max_size:
                self._evict()
            
            # Calculate expiration
            expires = time.time() + (ttl if ttl is not None else self.default_ttl)
            
            # Estimate size if not provided
            size = size_hint
            if size == 0:
                try:
                    size = len(pickle.dumps(value))
                except:
                    size = len(str(value))
            
            # Create entry
            entry = CacheEntry(
                value=value,
                expires=expires,
                size_bytes=size
            )
            
            # Move to end (most recently used)
            if key in self._cache:
                del self._cache[key]
            self._cache[key] = entry
            
            self._stats["sets"] += 1
            
            return True
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a cache entry
        
        Args:
            key: Cache key
            default: Default value if not found
            
        Returns:
            Cached value or default
        """
        with self._lock:
            entry = self._cache.get(key)
            
            if entry is None:
                self._record_miss()
                return default
            
            # Check expiration
            if entry.is_expired():
                self._remove_expired(key)
                self._record_miss()
                return default
            
            # Update access metadata
            entry.touch()
            
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            
            self._record_hit()
            
            return entry.value
    
    def delete(self, key: str) -> bool:
        """
        Delete a cache entry
        
        Args:
            key: Cache key
            
        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                self._stats["deletes"] += 1
                return True
            return False
    
    def exists(self, key: str) -> bool:
        """Check if key exists and is not expired"""
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return False
            if entry.is_expired():
                self._remove_expired(key)
                return False
            return True
    
    def clear(self):
        """Clear all cache entries"""
        with self._lock:
            self._cache.clear()
            logger.info("Cache cleared")
    
    def _evict(self):
        """Evict entry based on strategy"""
        if not self._cache:
            return
        
        if self.strategy == CacheStrategy.LRU:
            # Remove oldest (first) entry
            key = next(iter(self._cache))
            del self._cache[key]
            self._stats["evictions"] += 1
            
        elif self.strategy == CacheStrategy.LFU:
            # Remove least frequently used
            min_count = min(e.access_count for e in self._cache.values())
            for key, entry in self._cache.items():
                if entry.access_count == min_count:
                    del self._cache[key]
                    self._stats["evictions"] += 1
                    break
        
        logger.debug(f"Evicted entry, strategy={self.strategy.value}")
    
    def _remove_expired(self, key: str):
        """Remove expired entry"""
        if key in self._cache:
            del self._cache[key]
            self._stats["expirations"] += 1
    
    def _record_hit(self):
        """Record cache hit"""
        with self._metrics_lock:
            self._stats["hits"] += 1
    
    def _record_miss(self):
        """Record cache miss"""
        with self._metrics_lock:
            self._stats["misses"] += 1
    
    def get_stats(self) -> Dict:
        """Get cache statistics"""
        with self._lock:
            stats = self._stats.copy()
            
            # Calculate hit rate
            total = stats["hits"] + stats["misses"]
            if total > 0:
                stats["hit_rate"] = stats["hits"] / total
            else:
                stats["hit_rate"] = 0
            
            stats["size"] = len(self._cache)
            stats["max_size"] = self.max_size
            
            # Estimated memory usage
            total_bytes = sum(e.size_bytes for e in self._cache.values())
            stats["memory_bytes"] = total_bytes
            
            return stats
    
    def cleanup_expired(self):
        """Remove all expired entries"""
        with self._lock:
            expired_keys = [
                key for key, entry in self._cache.items()
                if entry.is_expired()
            ]
            for key in expired_keys:
                del self._cache[key]
                self._stats["expirations"] += 1
            
            if expired_keys:
                logger.info(f"Cleaned up {len(expired_keys)} expired entries")
    
    def get_or_set(self, key: str, factory: Callable[[], Any, None], ttl: Optional[int] = None) -> Any:
        """
        Get from cache or compute and set
        
        Args:
            key: Cache key
            factory: Callable that produces the value
            ttl: Time to live
            
        Returns:
            Cached or computed value
        """
        value = self.get(key)
        if value is not None:
            return value
        
        # Compute value
        value = factory()
        
        # Cache it
        if value is not None:
            self.set(key, value, ttl)
        
        return value
    
    def get_many(self, keys: list) -> Dict[str, Any]:
        """Get multiple keys"""
        return {key: self.get(key) for key in keys}
    
    def set_many(self, items: Dict[str, Any], ttl: Optional[int] = None):
        """Set multiple keys"""
        for key, value in items.items():
            self.set(key, value, ttl)


class RedisCache:
    """
    Redis-backed distributed cache
    
    Features:
    - Distributed caching
    -Automatic serialization
    - Key prefixes
    - Pipeline support
    """
    
    def __init__(self, redis_client=None, prefix: str = "tigerex:cache:", default_ttl: int = 300):
        self.redis = redis_client
        self.prefix = prefix
        self.default_ttl = default_ttl
        
        # For when Redis is not available
        self._fallback = InMemoryCache(max_size=1000, default_ttl=default_ttl)
        
        self._enabled = redis_client is not None
        
        if self._enabled:
            logger.info(f"Redis cache enabled: prefix={prefix}")
        else:
            logger.warning("Redis cache disabled, using in-memory fallback")
    
    def _key(self, key: str) -> str:
        """Apply prefix to key"""
        return f"{self.prefix}{key}"
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set cache entry"""
        if not self._enabled:
            return self._fallback.set(key, value, ttl)
        
        # Serialize
        try:
            serialized = json.dumps(value)
        except:
            serialized = str(value)
        
        # Store in Redis
        expiry = ttl if ttl is not None else self.default_ttl
        
        try:
            return self.redis.setex(
                self._key(key),
                expiry,
                serialized
            )
        except Exception as e:
            logger.error(f"Redis set error: {e}")
            return self._fallback.set(key, value, ttl)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get cache entry"""
        if not self._enabled:
            return self._fallback.get(key, default)
        
        try:
            value = self.redis.get(self._key(key))
            if value is None:
                return default
            
            return json.loads(value)
        except Exception as e:
            logger.error(f"Redis get error: {e}")
            return self._fallback.get(key, default)
    
    def delete(self, key: str) -> bool:
        """Delete cache entry"""
        if not self._enabled:
            return self._fallback.delete(key)
        
        try:
            return bool(self.redis.delete(self._key(key)))
        except Exception as e:
            logger.error(f"Redis delete error: {e}")
            return self._fallback.delete(key)
    
    def exists(self, key: str) -> bool:
        """Check if key exists"""
        if not self._enabled:
            return self._fallback.exists(key)
        
        try:
            return bool(self.redis.exists(self._key(key)))
        except Exception as e:
            logger.error(f"Redis exists error: {e}")
            return self._fallback.exists(key)
    
    def clear_pattern(self, pattern: str):
        """Clear all keys matching pattern"""
        if not self._enabled:
            return
        
        try:
            keys = self.redis.keys(self._key(pattern))
            if keys:
                self.redis.delete(*keys)
                logger.info(f"Cleared {len(keys)} keys matching {pattern}")
        except Exception as e:
            logger.error(f"Redis clear_pattern error: {e}")


class CacheManager:
    """
    Unified cache manager combining in-memory and Redis caches
    
    Features:
    - Multi-level caching (L1: memory, L2: Redis)
    - Read-through and write-through
    - Cache aside pattern support
    - InvalidatIO
    """
    
    def __init__(
        self,
        l1_max_size: int = 10000,
        l1_ttl: int = 60,
        redis_client=None,
        l2_prefix: str = "tigerex:l2:",
        enable_l1: bool = True,
        enable_l2: bool = True
    ):
        self.enable_l1 = enable_l1
        self.enable_l2 = enable_l2
        
        # L1: In-memory cache
        self.l1 = InMemoryCache(
            max_size=l1_max_size,
            default_ttl=l1_ttl
        ) if enable_l1 else None
        
        # L2: Redis cache
        self.l2 = RedisCache(
            redis_client=redis_client,
            prefix=l2_prefix
        ) if enable_l2 else None
        
        # Settings
        self.read_through = True
        self.write_through = True
        
        logger.info(f"Initialized cache manager: L1={'enabled' if enable_l1 else 'disabled'}, L2={'enabled' if enable_l2 else 'disabled'}")
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get from cache (L1 -> L2)"""
        # Try L1 first
        if self.enable_l1 and self.l1:
            value = self.l1.get(key)
            if value is not None:
                return value
        
        # Try L2
        if self.enable_l2 and self.l2:
            value = self.l2.get(key)
            if value is not None:
                # Populate L1
                if self.enable_l1 and self.l1:
                    self.l1.set(key, value)
                return value
        
        return default
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """Set in cache (L1 -> L2)"""
        # Write to L1
        if self.enable_l1 and self.l1:
            self.l1.set(key, value, ttl)
        
        # Write to L2
        if self.enable_l2 and self.l2:
            self.l2.set(key, value, ttl)
    
    def delete(self, key: str):
        """Delete from all cache levels"""
        if self.enable_l1 and self.l1:
            self.l1.delete(key)
        if self.enable_l2 and self.l2:
            self.l2.delete(key)
    
    def invalidate_pattern(self, pattern: str):
        """Invalidate all keys matching pattern"""
        if self.enable_l2 and self.l2:
            self.l2.clear_pattern(pattern)
    
    def get_or_compute(self, key: str, factory: Callable[[], Any], ttl: Optional[int] = None) -> Any:
        """Get or compute value"""
        value = self.get(key)
        if value is not None:
            return value
        
        # Compute
        value = factory()
        
        if value is not None:
            self.set(key, value, ttl)
        
        return value
    
    def get_stats(self) -> Dict:
        """Get combined statistics"""
        stats = {}
        
        if self.enable_l1 and self.l1:
            stats["l1"] = self.l1.get_stats()
        
        if self.enable_l2 and self.l2:
            stats["l2"] = {"enabled": True}
        
        return stats


# Global cache manager
cache_manager = CacheManager()


def demo():
    """Demonstrate cache manager"""
    print("=== Cache Manager Demo ===\n")
    
    # Create cache with limited size
    cache = InMemoryCache(max_size=100, default_ttl=10)
    
    # Set some values
    for i in range(110):  # More than max_size
        cache.set(f"key{i}", f"value{i}", ttl=5)
    
    # Get values
    print(f"Got: {cache.get('key0')}")
    print(f"Missing: {cache.get('nonexistent', 'default')}")
    
    # Stats
    print(f"\nStats: {cache.get_stats()}")
    
    # Test expiration
    import time
    cache.set("temp", "temp_value", ttl=1)
    time.sleep(1.1)
    print(f"After sleep: {cache.get('temp')}")
    
    print("\n=== Demo Complete ===")


if __name__ == "__main__":
    demo()