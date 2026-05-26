package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Health status levels
type HealthStatus string

const (
	StatusHealthy  HealthStatus = "healthy"
	StatusDegraded       = "degraded"
	StatusUnhealthy     = "unhealthy"
)

// Health check statuses
type CheckStatus string

const (
	CheckOk      CheckStatus = "ok"
	CheckWarning           = "warning"
	CheckError            = "error"
)

// Health check result
type HealthCheck struct {
	Name    string     `json:"name"`
	Status  CheckStatus `json:"status"`
	Latency int64     `json:"latency,omitempty"`
	Message string    `json:"message,omitempty"`
}

// Health status response
type HealthStatusResponse struct {
	Status    HealthStatus `json:"status"`
	Timestamp string     `json:"timestamp"`
	Uptime   int64      `json:"uptime"`
	Version  string     `json:"version"`
	Checks   []HealthCheck `json:"checks"`
}

// Readiness status
type ReadinessStatus struct {
	Ready   bool          `json:"ready"`
	Services []ServiceReady `json:"services"`
}

// Service ready status
type ServiceReady struct {
	Name  string `json:"name"`
	Ready bool   `json:"ready"`
	Err  string `json:"error,omitempty"`
}

// Health service
type HealthService struct {
	startTime time.Time
	version  string
	checks  map[string]HealthCheck
}

// NewHealthService creates a new health service
func NewHealthService() *HealthService {
	return &HealthService{
		startTime: time.Now(),
		version:  "1.0.0",
		checks:   make(map[string]HealthCheck),
	}
}

// GetHealth returns overall health status
func (h *HealthService) GetHealth() HealthStatusResponse {
	checks := h.runChecks()
	
	status := StatusHealthy
	for _, c := range checks {
		if c.Status == CheckError {
			status = StatusUnhealthy
			break
		}
		if c.Status == CheckWarning {
			status = StatusDegraded
		}
	}
	
	return HealthStatusResponse{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Uptime:   time.Since(h.startTime).Milliseconds(),
		Version:  h.version,
		Checks:   checks,
	}
}

// GetReadiness returns readiness status
func (h *HealthService) GetReadiness() ReadinessStatus {
	services := h.checkServices()
	
	allReady := true
	for _, s := range services {
		if !s.Ready {
			allReady = false
			break
		}
	}
	
	return ReadinessStatus{
		Ready:   allReady,
		Services: services,
	}
}

// IsAlive liveness probe
func (h *HealthService) IsAlive() bool {
	return true
}

// Run all health checks
func (h *HealthService) runChecks() []HealthCheck {
	return []HealthCheck{
		h.checkDatabase(),
		h.checkRedis(),
		h.checkKafka(),
	}
}

// Check database health
func (h *HealthService) checkDatabase() HealthCheck {
	start := time.Now()
	
	// TODO: Implement actual DB check
	return HealthCheck{
		Name:    "database",
		Status:  CheckOk,
		Latency: time.Since(start).Milliseconds(),
	}
}

// Check Redis health
func (h *HealthService) checkRedis() HealthCheck {
	start := time.Now()
	
	// TODO: Implement actual Redis check
	return HealthCheck{
		Name:    "redis",
		Status:  CheckOk,
		Latency: time.Since(start).Milliseconds(),
	}
}

// Check Kafka health
func (h *HealthService) checkKafka() HealthCheck {
	start := time.Now()
	
	// TODO: Implement actual Kafka check
	return HealthCheck{
		Name:    "kafka",
		Status:  CheckOk,
		Latency: time.Since(start).Milliseconds(),
	}
}

// Check service readiness
func (h *HealthService) checkServices() []ServiceReady {
	return []ServiceReady{
		{Name: "database", Ready: true},
		{Name: "redis", Ready: true},
		{Name: "kafka", Ready: true},
		{Name: "message_queue", Ready: true},
	}
}

// RegisterCustomCheck registers a custom health check
func (h *HealthService) RegisterCustomCheck(check HealthCheck) {
	h.checks[check.Name] = check
}

// HTTP handlers
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	service := NewHealthService()
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(service.GetHealth())
}

func ReadinessHandler(w http.ResponseWriter, r *http.Request) {
	service := NewHealthService()
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(service.GetReadiness())
}

func LivenessHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "OK")
}

func main() {
	// Parse port from env or default
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	// Register routes
	http.HandleFunc("/health", HealthHandler)
	http.HandleFunc("/readiness", ReadinessHandler)
	http.HandleFunc("/liveness", LivenessHandler)
	
	fmt.Printf("Health service starting on port %s\n", port)
	
	// Start server
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		fmt.Printf("Server error: %v\n", err)
		os.Exit(1)
	}
}