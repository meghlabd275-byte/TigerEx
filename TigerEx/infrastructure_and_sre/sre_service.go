// =============================================================================
// TIGEREX INFRASTRUCTURE AND SRE SERVICE
// Site Reliability Engineering, Monitoring, and Observability
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// Metric represents a system metric
type Metric struct {
	Name      string            `json:"name"`
	Value     float64           `json:"value"`
	Labels    map[string]string `json:"labels"`
	Timestamp time.Time         `json:"timestamp"`
}

// Alert represents an SRE alert
type Alert struct {
	ID          string    `json:"id"`
	Severity    string    `json:"severity"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Service     string    `json:"service"`
	Metric      string    `json:"metric"`
	Threshold   float64   `json:"threshold"`
	ActualValue float64   `json:"actualValue"`
	Status      string    `json:"status"`
	FiredAt    time.Time `json:"firedAt"`
	ResolvedAt *time.Time `json:"resolvedAt"`
}

// HealthCheck represents service health
type HealthCheck struct {
	Service     string  `json:"service"`
	Status      string  `json:"status"`
	Uptime      float64 `json:"uptime"`
	LatencyP50  float64 `json:"latencyP50"`
	LatencyP99  float64 `json:"latencyP99"`
	ErrorRate   float64 `json:"errorRate"`
	Requests    int64   `json:"requests"`
}

// Incident represents an incident
type Incident struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Severity    string          `json:"severity"`
	Status      string          `json:"status"`
	Service     string          `json:"service"`
	StartTime   time.Time       `json:"startTime"`
	EndTime     *time.Time     `json:"endTime"`
	Timeline    []IncidentEvent `json:"timeline"`
}

// IncidentEvent represents incident timeline event
type IncidentEvent struct {
	Timestamp time.Time `json:"timestamp"`
	Type      string    `json:"type"`
	Message   string    `json:"message"`
	Actor     string    `json:"actor"`
}

// =============================================================================
// SRE SERVICE
// =============================================================================

// SREService handles SRE operations
type SREService struct {
	mu          sync.RWMutex
	metrics     map[string][]Metric
	alerts      map[string]*Alert
	incidents   map[string]*Incident
	services    map[string]*HealthCheck
}

// NewSREService creates new SRE service
func NewSREService() *SREService {
	svc := &SREService{
		metrics:   make(map[string][]Metric),
		alerts:    make(map[string]*Alert),
		incidents: make(map[string]*Incident),
		services:  make(map[string]*HealthCheck),
	}
	svc.initServices()
	return svc
}

func (s *SREService) initServices() {
	s.services = map[string]*HealthCheck{
		"api-gateway":      {Service: "api-gateway", Status: "HEALTHY", Uptime: 99.99, LatencyP50: 25, LatencyP99: 80, ErrorRate: 0.01, Requests: 1000000},
		"websocket":        {Service: "websocket", Status: "HEALTHY", Uptime: 99.95, LatencyP50: 15, LatencyP99: 50, ErrorRate: 0.02, Requests: 500000},
		"matching-engine":  {Service: "matching-engine", Status: "HEALTHY", Uptime: 99.999, LatencyP50: 1, LatencyP99: 5, ErrorRate: 0.001, Requests: 10000000},
		"wallet-service":   {Service: "wallet-service", Status: "HEALTHY", Uptime: 99.99, LatencyP50: 30, LatencyP99: 100, ErrorRate: 0.01, Requests: 800000},
		"order-service":   {Service: "order-service", Status: "HEALTHY", Uptime: 99.99, LatencyP50: 20, LatencyP99: 60, ErrorRate: 0.01, Requests: 2000000},
	}
}

func (s *SREService) RecordMetric(name string, value float64, labels map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	metric := Metric{Name: name, Value: value, Labels: labels, Timestamp: time.Now()}
	s.metrics[name] = append(s.metrics[name], metric)
	
	if len(s.metrics[name]) > 1000 {
		s.metrics[name] = s.metrics[name][-1000:]
	}
	
	// Check alerts
	alertRules := map[string]struct{Threshold float64; Severity string}{
		"cpu_usage":   {80, "HIGH"},
		"memory_usage": {85, "HIGH"},
		"latency_p99":  {1000, "HIGH"},
		"error_rate":   {1.0, "CRITICAL"},
	}
	
	if rule, ok := alertRules[name]; ok && value >= rule.Threshold {
		alert := &Alert{
			ID: fmt.Sprintf("ALERT_%d", time.Now().Unix()), Severity: rule.Severity,
			Title: fmt.Sprintf("%s threshold exceeded", name), Description: fmt.Sprintf("Value %.2f > %.2f", value, rule.Threshold),
			Metric: name, Threshold: rule.Threshold, ActualValue: value, Status: "FIRING", FiredAt: time.Now(),
		}
		s.alerts[alert.ID] = alert
	}
}

func (s *SREService) GetAlerts(status string) []*Alert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Alert
	for _, alert := range s.alerts {
		if status == "" || alert.Status == status {
			result = append(result, alert)
		}
	}
	return result
}

func (s *SREService) ResolveAlert(alertID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if alert, ok := s.alerts[alertID]; ok {
		alert.Status = "RESOLVED"
		now := time.Now()
		alert.ResolvedAt = &now
		return nil
	}
	return fmt.Errorf("alert not found")
}

func (s *SREService) GetAllServiceHealth() []*HealthCheck {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*HealthCheck, 0)
	for _, health := range s.services {
		result = append(result, health)
	}
	return result
}

func (s *SREService) CreateIncident(title, severity, service string) *Incident {
	s.mu.Lock()
	defer s.mu.Unlock()
	incident := &Incident{
		ID: fmt.Sprintf("INC_%d", time.Now().Unix()), Title: title, Severity: severity,
		Status: "OPEN", Service: service, StartTime: time.Now(),
		Timeline: []IncidentEvent{{Timestamp: time.Now(), Type: "UPDATE", Message: "Incident created", Actor: "system"}},
	}
	s.incidents[incident.ID] = incident
	return incident
}

func (s *SREService) GetIncidents(status string) []*Incident {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Incident
	for _, inc := range s.incidents {
		if status == "" || inc.Status == status {
			result = append(result, inc)
		}
	}
	return result
}

func (s *SREService) RunHealthCheck() map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := map[string]interface{}{"timestamp": time.Now(), "status": "HEALTHY", "alerts": len(s.alerts), "incidents": len(s.incidents)}
	var downCount int
	for _, h := range s.services {
		if h.Status == "DOWN" {
			downCount++
		}
	}
	if downCount > 0 {
		result["status"] = "DOWN"
	}
	return result
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx Infrastructure & SRE Service")
	fmt.Println("=====================================")
	
	sre := NewSREService()
	sre.RecordMetric("cpu_usage", 45.0, map[string]string{"service": "api-gateway"})
	sre.RecordMetric("cpu_usage", 72.0, map[string]string{"service": "matching-engine"})
	sre.RecordMetric("latency_p99", 85.0, map[string]string{"service": "api-gateway"})
	sre.RecordMetric("error_rate", 0.02, map[string]string{"service": "api-gateway"})
	
	alerts := sre.GetAlerts("FIRING")
	fmt.Printf("\nActive Alerts: %d\n", len(alerts))
	for _, a := range alerts {
		fmt.Printf("  [%s] %s\n", a.Severity, a.Title)
	}
	
	health := sre.GetAllServiceHealth()
	fmt.Printf("\nService Health: %d services\n", len(health))
	for _, h := range health {
		fmt.Printf("  %s: %s (uptime: %.2f%%)\n", h.Service, h.Status, h.Uptime)
	}
	
	hc := sre.RunHealthCheck()
	fmt.Printf("\nOverall: %s\n", hc["status"])
}
