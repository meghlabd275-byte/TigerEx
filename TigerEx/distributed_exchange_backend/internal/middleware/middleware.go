// Package middleware provides the HTTP middleware chain for the distributed
// exchange backend: request logging, a same-origin CORS allowlist, a
// Redis-backed rate limiter with a local fallback, and fail-closed bearer-token
// authentication.
package middleware

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RequestLogger emits one structured line per request with method, path,
// status and latency.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf(
			"method=%s path=%s status=%d latency_ms=%d ip=%s",
			c.Request.Method,
			c.Request.URL.Path,
			c.Writer.Status(),
			time.Since(start).Milliseconds(),
			c.ClientIP(),
		)
	}
}

// corsOrigins reads the allowlist once per call. A wildcard is never accepted:
// the origin is compared exactly against each configured value.
func corsOrigins() []string {
	raw := os.Getenv("TIGEREX_CORS_ORIGINS")
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" && v != "*" {
			out = append(out, v)
		}
	}
	return out
}

// CORS reflects only a configured origin. A request from an unknown origin gets
// no CORS headers, so the browser blocks it; the request still reaches the
// handler, which authenticates independently.
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			for _, allowed := range corsOrigins() {
				if origin == allowed {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Vary", "Origin")
					c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
					c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
					c.Header("Access-Control-Allow-Credentials", "true")
					break
				}
			}
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// RateLimiter enforces a per-client fixed window. It prefers Redis so the limit
// is shared across replicas, and falls back to a process-local window when
// Redis is unreachable so a cache outage cannot take the whole API down.
func RateLimiter(rdb *redis.Client) gin.HandlerFunc {
	const (
		limit  = 1200 // requests
		window = time.Minute
	)
	local := &localLimiter{counts: make(map[string]*localBucket)}

	return func(c *gin.Context) {
		key := "ratelimit:" + c.ClientIP()

		if rdb != nil {
			ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
			count, err := rdb.Incr(ctx, key).Result()
			if err == nil {
				if count == 1 {
					rdb.Expire(ctx, key, window)
				}
				cancel()
				if count > limit {
					tooMany(c)
					return
				}
				c.Next()
				return
			}
			cancel()
			log.Printf("rate limiter: redis unavailable, using local fallback: %v", err)
		}

		if !local.allow(key, limit, window) {
			tooMany(c)
			return
		}
		c.Next()
	}
}

func tooMany(c *gin.Context) {
	c.Header("Retry-After", "60")
	c.JSON(http.StatusTooManyRequests, gin.H{"code": 429, "msg": "rate limit exceeded"})
	c.Abort()
}

type localBucket struct {
	count int
	reset time.Time
}

type localLimiter struct {
	mu     sync.Mutex
	counts map[string]*localBucket
}

func (l *localLimiter) allow(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.counts[key]
	if !ok || now.After(b.reset) {
		l.counts[key] = &localBucket{count: 1, reset: now.Add(window)}
		return true
	}
	b.count++
	return b.count <= limit
}

// AuthRequired resolves the bearer token to a session in Redis and stamps the
// user id on the context. It fails closed: a missing, unknown or expired token
// is rejected, and a Redis error is a 503 rather than an anonymous pass.
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			unauthorized(c, "missing bearer token")
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if token == "" {
			unauthorized(c, "empty bearer token")
			return
		}

		rdb := redisClient(c)
		if rdb == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "authentication backend unavailable"})
			c.Abort()
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		userID, err := rdb.Get(ctx, "session:"+token).Result()
		if err == redis.Nil {
			unauthorized(c, "invalid or expired token")
			return
		}
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "authentication backend unavailable"})
			c.Abort()
			return
		}
		c.Set("user_id", userID)
		c.Next()
	}
}

func unauthorized(c *gin.Context, msg string) {
	c.JSON(http.StatusUnauthorized, gin.H{"msg": msg})
	c.Abort()
}

// redisClient returns the client stored on the context by the router, or nil
// when the server was built without one.
func redisClient(c *gin.Context) *redis.Client {
	if v, ok := c.Get("redis"); ok {
		if client, ok := v.(*redis.Client); ok {
			return client
		}
	}
	return nil
}
