package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// HEALTH CHECK - Go Implementation
// Service health monitoring for TigerEx
// ============================================================================

// HealthCheckFunc is the health check function type
type HealthCheckFunc func() bool

// HealthStatus represents health check result
type HealthStatus struct {
	Service string    `json:"service"`
	Status  string    `json:"status"` // "healthy", "unhealthy", "degraded"
	Latency float64   `json:"latencyMs"`
	Message string    `json:"message,omitempty"`
	Time    time.Time `json:"time"`
}

// HealthChecker manages service health checks
type HealthChecker struct {
	mu       sync.RWMutex
	services map[string]HealthCheckFunc
}

// NewHealthChecker creates a new health checker
func NewHealthChecker() *HealthChecker {
	return &HealthChecker{
		services: make(map[string]HealthCheckFunc),
	}
}

// Register registers a health check for a service
func (hc *HealthChecker) Register(service string, checkFn HealthCheckFunc) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	hc.services[service] = checkFn
}

// Unregister removes a health check
func (hc *HealthChecker) Unregister(service string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	delete(hc.services, service)
}

// Check performs all health checks
func (hc *HealthChecker) Check() []*HealthStatus {
	hc.mu.RLock()
	defer hc.mu.RUnlock()

	results := make([]*HealthStatus, 0, len(hc.services))
	for service, checkFn := range hc.services {
		start := time.Now()
		healthy := checkFn()
		latency := time.Since(start).Milliseconds()

		status := "healthy"
		if !healthy {
			status = "unhealthy"
		} else if latency > 1000 {
			status = "degraded"
		}

		results = append(results, &HealthStatus{
			Service: service,
			Status:  status,
			Latency: float64(latency),
			Time:    time.Now(),
		})
	}

	return results
}

// CheckService checks a specific service
func (hc *HealthChecker) CheckService(service string) *HealthStatus {
	hc.mu.RLock()
	checkFn, ok := hc.services[service]
	hc.mu.RUnlock()

	if !ok {
		return &HealthStatus{
			Service: service,
			Status:  "unknown",
			Message: "service not registered",
			Time:    time.Now(),
		}
	}

	start := time.Now()
	healthy := checkFn()
	latency := time.Since(start).Milliseconds()

	status := "healthy"
	if !healthy {
		status = "unhealthy"
	} else if latency > 1000 {
		status = "degraded"
	}

	return &HealthStatus{
		Service: service,
		Status:  status,
		Latency: float64(latency),
		Time:    time.Now(),
	}
}

// CheckAll 健康检查 all服务
func (hc *HealthChecker) CheckAll() map[string]bool {
	results := hc.Check()
	status := make(map[string]bool)
	for _, r := range results {
		status[r.Service] = r.Status == "healthy"
	}
	return status
}

// ListServices lists all registered services
func (hc *HealthChecker) ListServices() []string {
	hc.mu.RLock()
	defer hc.mu.RUnlock()

	services := make([]string, 0, len(hc.services))
	for s := range hc.services {
		services = append(services, s)
	}
	return services
}

// ============================================================================
// REAL CHECK FUNCTIONS
//
// Each probe dials the dependency for real. With its address unset the probe
// reports unhealthy rather than a fabricated success, so a health endpoint can
// never claim a service is up when the check was never performed.
// ============================================================================

func tcpReachable(addr string) bool {
	if addr == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// DatabaseCheck reports whether the PostgreSQL endpoint accepts a TCP
// connection. Address comes from TIGEREX_DB_ADDR (host:port).
func DatabaseCheck() bool {
	return tcpReachable(os.Getenv("TIGEREX_DB_ADDR"))
}

// RedisCheck sends a PING to the Redis endpoint and expects a PONG.
func RedisCheck() bool {
	addr := os.Getenv("TIGEREX_REDIS_ADDR")
	if addr == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write([]byte("PING\r\n")); err != nil {
		return false
	}
	buf := make([]byte, 16)
	n, err := conn.Read(buf)
	if err != nil {
		return false
	}
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(string(buf[:n]))), "+PONG")
}

// APICheck issues a GET to TIGEREX_API_HEALTH_URL and reports whether it returns
// a 2xx status.
func APICheck() bool {
	url := os.Getenv("TIGEREX_API_HEALTH_URL")
	if url == "" {
		return false
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	hc := NewHealthChecker()

	// Register health checks
	hc.Register("database", DatabaseCheck)
	hc.Register("redis", RedisCheck)
	hc.Register("external_api", APICheck)

	// List services
	fmt.Printf("Registered services: %v\n", hc.ListServices())

	// Check all
	results := hc.Check()
	for _, r := range results {
		fmt.Printf("[%s] %s (%.2fms)\n", r.Status, r.Service, r.Latency)
	}

	// Check specific service
	dbStatus := hc.CheckService("database")
	fmt.Printf("Database: %+v\n", dbStatus)
}
