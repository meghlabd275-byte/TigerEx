// Health, readiness and metrics for the TigerEx gateway.
//
// Liveness is unconditional: the process answers as long as it is running.
// Readiness is real — it pings every dependency the operator configured and
// reports not-ready when one is unreachable, so a load balancer stops sending
// trading traffic to an instance that cannot serve it. A dependency that is not
// configured is reported as "disabled" rather than "up", so a deployment that
// forgot to set it is visible instead of appearing healthy.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var processStartedAt = time.Now()

// requestCount counts handled requests for the metrics endpoint. It is a plain
// counter; per-route breakdowns belong in a real metrics backend.
var requestCount atomic.Int64

func countRequests() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestCount.Add(1)
		c.Next()
	}
}

type dependencyStatus struct {
	Name    string `json:"name"`
	Status  string `json:"status"` // up | down | disabled
	Detail  string `json:"detail,omitempty"`
	Latency int64  `json:"latencyMs"`
}

// databaseDSN is the connection string the gateway already uses for persistence.
func databaseDSN() string {
	return strings.TrimSpace(os.Getenv("TIGEREX_DATABASE_DSN"))
}

// redisAddress resolves the Redis endpoint from a URL or host/port pair.
func redisAddress() string {
	if url := strings.TrimSpace(os.Getenv("TIGEREX_REDIS_URL")); url != "" {
		return url
	}
	if url := strings.TrimSpace(os.Getenv("REDIS_URL")); url != "" {
		return url
	}
	host := strings.TrimSpace(os.Getenv("REDIS_HOST"))
	if host == "" {
		return ""
	}
	port := strings.TrimSpace(os.Getenv("REDIS_PORT"))
	if port == "" {
		port = "6379"
	}
	return fmt.Sprintf("%s:%s", host, port)
}

func probeDatabase(ctx context.Context) dependencyStatus {
	dsn := databaseDSN()
	if dsn == "" {
		return dependencyStatus{Name: "database", Status: "disabled", Detail: "TIGEREX_DATABASE_DSN is not set"}
	}
	start := time.Now()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return dependencyStatus{Name: "database", Status: "down", Detail: err.Error(), Latency: time.Since(start).Milliseconds()}
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return dependencyStatus{Name: "database", Status: "down", Detail: err.Error(), Latency: time.Since(start).Milliseconds()}
	}
	return dependencyStatus{Name: "database", Status: "up", Latency: time.Since(start).Milliseconds()}
}

func probeRedis(ctx context.Context) dependencyStatus {
	addr := redisAddress()
	if addr == "" {
		return dependencyStatus{Name: "redis", Status: "disabled", Detail: "TIGEREX_REDIS_URL is not set"}
	}
	start := time.Now()
	opts, err := redis.ParseURL(addr)
	if err != nil {
		// Not a URL; treat it as host:port.
		opts = &redis.Options{Addr: addr}
	}
	client := redis.NewClient(opts)
	defer client.Close()
	if err := client.Ping(ctx).Err(); err != nil {
		return dependencyStatus{Name: "redis", Status: "down", Detail: err.Error(), Latency: time.Since(start).Milliseconds()}
	}
	return dependencyStatus{Name: "redis", Status: "up", Latency: time.Since(start).Milliseconds()}
}

func gatherReadiness() []dependencyStatus {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return []dependencyStatus{probeDatabase(ctx), probeRedis(ctx)}
}

// registerHealthRoutes wires the probe endpoints onto the router.
func registerHealthRoutes(r *gin.Engine) {
	// Liveness: the process is up. Never depends on a downstream system, so a
	// database blip does not restart a healthy process.
	r.GET("/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "uptimeSeconds": int64(time.Since(processStartedAt).Seconds())})
	})

	// Readiness: every configured dependency is reachable. A dependency that is
	// configured but down makes the instance not-ready.
	ready := func(c *gin.Context) {
		checks := gatherReadiness()
		status := "ok"
		for _, check := range checks {
			if check.Status == "down" {
				status = "fail"
				break
			}
		}
		code := http.StatusOK
		if status != "ok" {
			code = http.StatusServiceUnavailable
		}
		c.JSON(code, gin.H{
			"status":        status,
			"uptimeSeconds": int64(time.Since(processStartedAt).Seconds()),
			"checks":        checks,
		})
	}
	r.GET("/health/ready", ready)
	// Backwards-compatible alias.
	r.GET("/health", ready)

	r.GET("/metrics", func(c *gin.Context) {
		checks := gatherReadiness()
		var b strings.Builder
		b.WriteString("# HELP tigerex_uptime_seconds Process uptime\n# TYPE tigerex_uptime_seconds gauge\n")
		fmt.Fprintf(&b, "tigerex_uptime_seconds %d\n", int64(time.Since(processStartedAt).Seconds()))
		b.WriteString("# HELP tigerex_http_requests_total Requests handled\n# TYPE tigerex_http_requests_total counter\n")
		fmt.Fprintf(&b, "tigerex_http_requests_total %d\n", requestCount.Load())
		for _, check := range checks {
			value := 0
			if check.Status == "up" {
				value = 1
			}
			fmt.Fprintf(&b, "# HELP tigerex_dependency_up Whether %s is reachable\n# TYPE tigerex_dependency_up gauge\n", check.Name)
			fmt.Fprintf(&b, "tigerex_dependency_up{name=%q} %d\n", check.Name, value)
		}
		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(b.String()))
	})
}
