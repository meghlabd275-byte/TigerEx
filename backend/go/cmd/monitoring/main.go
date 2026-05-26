// Package monitoring provides monitoring services.
// Migrated from TypeScript to Go for observability.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Metric type
type Metric struct {
	Name      string  `json:"name"`
	Value     float64 `json:"value"`
	Type      string  `json:"type"` // counter, gauge, histogram
	Labels    map[string]string `json:"labels"`
	Timestamp int64   `json:"timestamp"`
}

// Alert rule
type AlertRule struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Condition  string  `json:"condition"` // e.g., "cpu > 80"
	Severity   string  `json:"severity"` // warning, critical
	Status    string  `json:"status"` // active, paused
}

// Alert
type Alert struct {
	ID        string  `json:"id"`
	RuleID   string  `json:"ruleId"`
	Message string  `json:"message"`
	Severity string  `json:"severity"`
	Status  string  `json:"status"` // firing, resolved
	FiredAt  int64   `json:"firedAt"`
}

// Store
type MonitorStore struct {
	mu    sync.RWMutex
	metrics map[string][]Metric
	rules  map[string]*AlertRule
	alerts map[string]*Alert
}

var (
	monStore = &MonitorStore{
		metrics: make(map[string][]Metric),
		rules: make(map[string]*AlertRule),
		alerts: make(map[string]*Alert),
	}
)

// Record metric
func RecordMetric(name string, value float64, metricType string, labels map[string]string) {
	metric := Metric{
		Name: name,
		Value: value,
		Type: metricType,
		Labels: labels,
		Timestamp: time.Now().UnixMilli(),
	}

	monStore.mu.Lock()
	defer monStore.mu.Unlock()

	monStore.metrics[name] = append(monStore.metrics[name], metric)
}

// Query metrics
func QueryMetrics(name string, from, to int64) []Metric {
	monStore.mu.RLock()
	defer monStore.mu.RUnlock()

	var result []Metric
	for _, m := range monStore.metrics[name] {
		if m.Timestamp >= from && m.Timestamp <= to {
			result = append(result, m)
		}
	}
	return result
}

// Create alert rule
func CreateAlertRule(name, condition, severity string) *AlertRule {
	rule := &AlertRule{
		ID: fmt.Sprintf("rule_%d", time.Now().UnixNano()),
		Name: name,
		Condition: condition,
		Severity: severity,
		Status: "active",
	}

	monStore.mu.Lock()
	defer monStore.mu.Unlock()
	monStore.rules[rule.ID] = rule

	return rule
}

// Evaluate alerts
func EvaluateAlerts() {
	monStore.mu.RLock()
	rules := monStore.rules
	monStore.mu.RUnlock()

	// Simplified evaluation
	for _, rule := range rules {
		if rule.Status == "active" {
			// Check condition (simplified)
		}
	}
}

// Trigger alert
func TriggerAlert(ruleID, message string) *Alert {
	monStore.mu.RLock()
	rule, ok := monStore.rules[ruleID]
	monStore.mu.RUnlock()

	if !ok {
		return nil
	}

	alert := &Alert{
		ID: fmt.Sprintf("alert_%d", time.Now().UnixNano()),
		RuleID: ruleID,
		Message: message,
		Severity: rule.Severity,
		Status: "firing",
		FiredAt: time.Now().UnixMilli(),
	}

	monStore.mu.Lock()
	defer monStore.mu.Unlock()
	monStore.alerts[alert.ID] = alert

	return alert
}

// Resolve alert
func ResolveAlert(alertID string) error {
	monStore.mu.Lock()
	defer monStore.mu.Unlock()

	if alert, ok := monStore.alerts[alertID]; ok {
		alert.Status = "resolved"
		return nil
	}

	return fmt.Errorf("alert not found")
}

// Get active alerts
func GetActiveAlerts() []*Alert {
	monStore.mu.RLock()
	defer monStore.mu.RUnlock()

	var result []*Alert
	for _, a := range monStore.alerts {
		if a.Status == "firing" {
			result = append(result, a)
		}
	}
	return result
}

func main() {
	fmt.Println("Monitoring service initialized")

	// Record metrics
	RecordMetric("cpu_usage", 75.5, "gauge", map[string]string{"host": "server1"})
	RecordMetric("requests_total", 1000, "counter", map[string]string{"endpoint": "/api"})

	// Alert rule
	rule := CreateAlertRule("High CPU", "cpu_usage > 80", "warning")
	fmt.Printf("Alert rule: %s\n", rule.Name)

	// Evaluate
	EvaluateAlerts()
}