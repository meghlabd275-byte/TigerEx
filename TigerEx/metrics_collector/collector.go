package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// ============================================================================
// METRICS COLLECTOR - Go Implementation
// High-performance metrics collection for TigerEx
// ============================================================================

// Counter represents a metric counter
type Counter struct {
	value int64
	name  string
}

// NewCounter creates a new counter
func NewCounter(name string) *Counter {
	return &Counter{name: name}
}

// Inc increments the counter
func (c *Counter) Inc() {
	atomic.AddInt64(&c.value, 1)
}

// IncBy increments by delta
func (c *Counter) IncBy(delta int64) {
	atomic.AddInt64(&c.value, delta)
}

// Value returns current value
func (c *Counter) Value() int64 {
	return atomic.LoadInt64(&c.value)
}

// Reset resets the counter
func (c *Counter) Reset() {
	atomic.StoreInt64(&c.value, 0)
}

// Gauge represents a metric gauge
type Gauge struct {
	value int64
	name  string
}

// NewGauge creates a new gauge
func NewGauge(name string) *Gauge {
	return &Gauge{name: name}
}

// Set sets the gauge value
func (g *Gauge) Set(value int64) {
	atomic.StoreInt64(&g.value, value)
}

// Inc increments the gauge
func (g *Gauge) Inc() {
	atomic.AddInt64(&g.value, 1)
}

// Dec decrements the gauge
func (g *Gauge) Dec() {
	atomic.AddInt64(&g.value, -1)
}

// Value returns current value
func (g *Gauge) Value() int64 {
	return atomic.LoadInt64(&g.value)
}

// Histogram represents a histogram metric
type Histogram struct {
	mu      sync.Mutex
	values  []int64
	count   int64
	sum    int64
	max    int64
	min    int64
	name   string
}

// NewHistogram creates a new histogram
func NewHistogram(name string, capacity int) *Histogram {
	return &Histogram{
		values: make([]int64, 0, capacity),
		min:   1<<63 - 1,
	}
}

// Observe records an observation
func (h *Histogram) Observe(value int64) {
	h.mu.Lock()
	h.values = append(h.values, value)
	h.count++
	h.sum += value
	if value > h.max {
		h.max = value
	}
	if value < h.min {
		h.min = value
	}
	h.mu.Unlock()
}

// Stats returns histogram statistics
func (h *Histogram) Stats() map[string]int64 {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.count == 0 {
		return map[string]int64{
			"count": 0,
			"sum":   0,
			"max":   0,
			"min":   0,
		}
	}

	return map[string]int64{
		"count": h.count,
		"sum":   h.sum,
		"max":   h.max,
		"min":   h.min,
		"avg":   h.sum / h.count,
	}
}

// MetricsCollector aggregates all metrics
type MetricsCollector struct {
	mu        sync.RWMutex
	counters  map[string]*Counter
	gauges    map[string]*Gauge
	histograms map[string]*Histogram
	startTime time.Time
}

// NewMetricsCollector creates a new metrics collector
func NewMetricsCollector() *MetricsCollector {
	return &MetricsCollector{
		counters:   make(map[string]*Counter),
		gauges:    make(map[string]*Gauge),
		histograms: make(map[string]*Histogram),
		startTime: time.Now(),
	}
}

// GetCounter gets or creates a counter
func (mc *MetricsCollector) GetCounter(name string) *Counter {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	if c, ok := mc.counters[name]; ok {
		return c
	}

	c := NewCounter(name)
	mc.counters[name] = c
	return c
}

// GetGauge gets or creates a gauge
func (mc *MetricsCollector) GetGauge(name string) *Gauge {
	mc.mu.Lock()
	defer g.mu.Unlock()

	if g, ok := mc.gauges[name]; ok {
		return g
	}

	g := NewGauge(name)
	mc.gauges[name] = g
	return g
}

// GetHistogram gets or creates a histogram
func (mc *MetricsCollector) GetHistogram(name string) *Histogram {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	if h, ok := mc.histograms[name]; ok {
		return h
	}

	h := NewHistogram(name, 1000)
	mc.histograms[name] = h
	return h
}

// Inc increments a counter
func (mc *MetricsCollector) Inc(name string) {
	mc.GetCounter(name).Inc()
}

// IncBy increments a counter by value
func (mc *MetricsCollector) IncBy(name string, value int64) {
	mc.GetCounter(name).IncBy(value)
}

// SetGauge sets a gauge value
func (mc *MetricsCollector) SetGauge(name string, value int64) {
	mc.GetGauge(name).Set(value)
}

// Observe records a histogram observation
func (mc *MetricsCollector) Observe(name string, value int64) {
	mc.GetHistogram(name).Observe(value)
}

// Snapshot returns all metrics as JSON
func (mc *MetricsCollector) Snapshot() map[string]interface{} {
	mc.mu.RLock()
	defer mc.mu.RUnlock()

	snapshot := make(map[string]interface{})

	// Counters
	counters := make(map[string]int64)
	for name, c := range mc.counters {
		counters[name] = c.Value()
	}
	snapshot["counters"] = counters

	// Gauges
	gauges := make(map[string]int64)
	for name, g := range mc.gauges {
		gauges[name] = g.Value()
	}
	snapshot["gauges"] = gauges

	// Histograms
	histograms := make(map[string]interface{})
	for name, h := range mc.histograms {
		histograms[name] = h.Stats()
	}
	snapshot["histograms"] = histograms

	// Metadata
	snapshot["uptimeSeconds"] = int64(time.Since(mc.startTime).Seconds())

	return snapshot
}

// ToJSON returns metrics as JSON
func (mc *MetricsCollector) ToJSON() (string, error) {
	snap := mc.Snapshot()
	data, err := json.MarshalIndent(snap, "", "  ")
	return string(data), err
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

var metrics = NewMetricsCollector()

func main() {
	// Record some metrics
	metrics.Inc("requests_total")
	metrics.Inc("requests_total")
	metrics.IncBy("bytes_sent", 1024)

	metrics.SetGauge("active_connections", 100)
	metrics.SetGauge("queue_length", 50)

	metrics.Observe("request_latency_ms", 150)
	metrics.Observe("request_latency_ms", 200)
	metrics.Observe("request_latency_ms", 100)

	// Print snapshot
	snap := metrics.Snapshot()
	fmt.Printf("Metrics: %+v\n", snap)

	// Print JSON
	json, _ := metrics.ToJSON()
	fmt.Println(json)
}