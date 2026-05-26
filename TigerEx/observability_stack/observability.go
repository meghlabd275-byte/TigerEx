package main

import (
	"fmt"
	"sync"
	"time"
)

// Metric type
type MetricType string

const (
	MetricCounter MetricType = "counter"
	MetricGauge MetricType = "gauge"
	MetricHistogram MetricType = "histogram"
)

// Metric value
type MetricValue struct {
	Labels map[string]string
	Value  float64
}

// Prometheus exporter
type PrometheusExporter struct {
	Port       int
	MetricsPath string
	Counters   map[string][]MetricValue
	Gauges     map[string][]MetricValue
	Histograms map[string][]MetricValue
.mu       sync.RWMutex
}

// New creates exporter
func NewPrometheusExporter(port int) *PrometheusExporter {
	return &PrometheusExporter{
		Port:       port,
		MetricsPath: "/metrics",
		Counters:   make(map[string][]MetricValue),
		Gauges:    make(map[string][]MetricValue),
		Histograms: make(map[string][]MetricValue),
	}
}

// Inc counter
func (e *PrometheusExporter) IncCounter(name string, labels map[string]string, value float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.Counters[name] = append(e.Counters[name], MetricValue{
		Labels: labels,
		Value: value,
	})
}

// Set gauge
func (e *PrometheusExporter) SetGauge(name string, labels map[string]string, value float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.Gauges[name] = append(e.Gauges[name], MetricValue{
		Labels: labels,
		Value: value,
	})
}

// Observe histogram
func (e *PrometheusExporter) Observe(name string, labels map[string]string, value float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	
	e.Histograms[name] = append(e.Histograms[name], MetricValue{
		Labels: labels,
		Value: value,
	})
}

// Generate metrics output
func (e *PrometheusExporter) Generate() string {
	output := ""
	
	e.mu.RLock()
	defer e.mu.RUnlock()
	
	for name, values := range e.Counters {
		output += fmt.Sprintf("# TYPE %s counter\n", name)
		for _, v := range values {
			output += fmt.Sprintf("%s{%s} %.2f\n", name, formatLabels(v.Labels), v.Value)
		}
	}
	
	for name, values := range e.Gauges {
		output += fmt.Sprintf("# TYPE %s gauge\n", name)
		for _, v := range values {
			output += fmt.Sprintf("%s{%s} %.2f\n", name, formatLabels(v.Labels), v.Value)
		}
	}
	
	return output
}

func formatLabels(labels map[string]string) string {
	result := ""
	for k, v := range labels {
		if result != "" {
			result += ","
		}
		result += fmt.Sprintf("%s=\"%s\"", k, v)
	}
	return result
}

// Observability stack
type ObservabilityStack struct {
	Exporter   *PrometheusExporter
	AlertRules []AlertRule
	Dashboards []Dashboard
}

// Alert rule
type AlertRule struct {
	Name     string
	Expr    string
	For     int
	Severity string
}

// Dashboard
type Dashboard struct {
	Name    string
	Panels  []Panel
}

// Panel
type Panel struct {
	Name   string
	Metric string
}

// New creates stack
func NewObservabilityStack() *ObservabilityStack {
	return &ObservabilityStack{
		Exporter: NewPrometheusExporter(9090),
	}
}

// Add alert
func (s *ObservabilityStack) AddAlert(name, expr string, forSec int, severity string) {
	s.AlertRules = append(s.AlertRules, AlertRule{
		Name: name,
		Expr: expr,
		For: forSec,
		Severity: severity,
	})
}

func main() {
	stack := NewObservabilityStack()
	
	// Record metrics
	stack.Exporter.IncCounter("requests_total", map[string]string{"method": "GET", "status": "200"}, 1)
	stack.Exporter.SetGauge("active_connections", map[string]string{"service": "api"}, 100)
	stack.Exporter.Observe("request_latency_ms", map[string]string{}, 45.5)
	
	// Add alert
	stack.AddAlert("HighLatency", "request_latency_ms > 1000", 300, "warning")
	
	// Generate output
	output := stack.Exporter.Generate()
	fmt.Printf("Metrics:\n%s\n", output)
	
	fmt.Printf("Alerts: %d\n", len(stack.AlertRules))
}