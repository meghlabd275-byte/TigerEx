// TigerEx Real-Time Analytics
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

type Metric struct {
	Name      string
	Value    float64
	Labels   map[string]string
	Timestamp time.Time
}

type Dashboard struct {
	ID          string
	Name        string
	Widgets    []Widget
	RefreshRate time.Duration
}

type Widget struct {
	ID       string
	Type    string
	Title   string
	Metrics []string
}

type AnalyticsEngine struct {
	mu        sync.RWMutex
	metrics   []Metric
	 dashboards map[string]*Dashboard
	alertRules map[string]*AlertRule
	stats     AnalyticsStats
}

type AlertRule struct {
	ID        string
	Name     string
	Metric   string
	Condition string
	Threshold float64
	Severity string
	Enabled  bool
}

type AnalyticsStats struct {
	MetricsProcessed int64
	QueriesExecuted int64
	AlertsTriggered int64
}

func NewAnalyticsEngine() *AnalyticsEngine {
	return &AnalyticsEngine{
		metrics:     make([]Metric, 0),
		dashboards:  make(map[string]*Dashboard),
		alertRules:  make(map[string]*AlertRule),
	}
}

func (ae *AnalyticsEngine) RecordMetric(name string, value float64, labels map[string]string) {
	ae.mu.Lock()
	defer ae.mu.Unlock()
	
	metric := Metric{
		Name: name, Value: value, Labels: labels, Timestamp: time.Now(),
	}
	
	ae.metrics = append(ae.metrics, metric)
	ae.stats.MetricsProcessed++
	
	// Check alert rules
	ae.checkAlerts(metric)
	
	// Keep last 10000 metrics
	if len(ae.metrics) > 10000 {
		ae.metrics = ae.metrics[-10000:]
	}
}

func (ae *AnalyticsEngine) checkAlerts(m Metric) {
	for _, rule := range ae.alertRules {
		if !rule.Enabled {
			continue
		}
		
		if rule.Metric != m.Name {
			continue
		}
		
		triggered := false
		switch rule.Condition {
		case "gt":
			triggered = m.Value > rule.Threshold
		case "lt":
			triggered = m.Value < rule.Threshold
		case "eq":
			triggered = math.Abs(m.Value-rule.Threshold) < 0.001
		}
		
		if triggered {
			ae.stats.AlertsTriggered++
			fmt.Printf("ALERT [%s]: %s = %.2f (threshold: %.2f)\n", rule.Severity, m.Name, m.Value, rule.Threshold)
		}
	}
}

func (ae *AnalyticsEngine) Query(metricName string, duration time.Duration) []Metric {
	ae.mu.RLock()
	defer ae.mu.RUnlock()
	
	ae.stats.QueriesExecuted++
	
	cutoff := time.Now().Add(-duration)
	var result []Metric
	for _, m := range ae.metrics {
		if m.Name == metricName && m.Timestamp.After(cutoff) {
			result = append(result, m)
		}
	}
	
	return result
}

func (ae *AnalyticsEngine) Aggregate(metricName string, duration time.Duration) float64 {
	metrics := ae.Query(metricName, duration)
	
	if len(metrics) == 0 {
		return 0
	}
	
	sum := 0.0
	for _, m := range metrics {
		sum += m.Value
	}
	
	return sum / float64(len(metrics))
}

func (ae *AnalyticsEngine) CreateDashboard(id, name string) *Dashboard {
	ae.mu.Lock()
	defer ae.mu.Unlock()
	
	dash := &Dashboard{
		ID: id, Name: name, Widgets: make([]Widget, 0), RefreshRate: time.Minute,
	}
	
	ae.dashboards[id] = dash
	return dash
}

func (ae *AnalyticsEngine) AddAlertRule(rule *AlertRule) {
	ae.mu.Lock()
	defer ae.mu.Unlock()
	ae.alertRules[rule.ID] = rule
}

func (ae *AnalyticsEngine) GetStats() AnalyticsStats {
	ae.mu.RLock()
	defer ae.mu.RUnlock()
	return ae.stats
}

func main() {
	fmt.Println("TigerEx Real-Time Analytics")
	fmt.Println("=========================")
	
	analytics := NewAnalyticsEngine()
	
	// Record metrics
	for i := 0; i < 100; i++ {
		analytics.RecordMetric("cpu_usage", float64(50+i%30), map[string]string{"host": "server1"})
		analytics.RecordMetric("memory_usage", float64(60+i%20), map[string]string{"host": "server1"})
		analytics.RecordMetric("requests_per_second", float64(1000+i*10), map[string]string{"endpoint": "/api"})
	}
	
	// Add alert rules
	analytics.AddAlertRule(&AlertRule{
		ID: "alert1", Name: "High CPU", Metric: "cpu_usage",
		Condition: "gt", Threshold: 80, Severity: "HIGH", Enabled: true,
	})
	
	// Query
	metrics := analytics.Query("cpu_usage", time.Minute)
	fmt.Printf("\nMetrics: %d\n", len(metrics))
	
	// Aggregate
	avg := analytics.Aggregate("cpu_usage", time.Minute)
	fmt.Printf("Average CPU: %.2f%%\n", avg)
	
	// Stats
	stats := analytics.GetStats()
	fmt.Printf("\nStats:\n")
	fmt.Printf("  Processed: %d\n", stats.MetricsProcessed)
	fmt.Printf("  Queries: %d\n", stats.QueriesExecuted)
	fmt.Printf("  Alerts: %d\n", stats.AlertsTriggered)
}
