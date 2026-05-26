package main

import (
	"fmt"
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
	Service  string    `json:"service"`
	Status  string    `json:"status"` // "healthy", "unhealthy", "degraded"
	Latency  float64   `json:"latencyMs"`
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
			Time:   time.Now(),
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
			Time:   time.Now(),
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
		Time:   time.Now(),
	}
}

// CheckAll 健康检查 all服务
func (hc *HealthChecker) CheckAll() map[string] bool {
	results := hc.Check()
	status := make(map[string] bool)
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
// EXAMPLE CHECK FUNCTIONS
// ============================================================================

// DatabaseCheck checks database connectivity
func DatabaseCheck() bool {
	// Simulate DB check
	return true
}

// RedisCheck checks Redis connectivity
func RedisCheck() bool {
	return true
}

// APICheck checks external API
func APICheck() bool {
	return true
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