// Package metrics provides high-performance metrics collection
// for worldwide distributed monitoring
package metrics

import (
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// Counter metric with atomic operations
type Counter struct {
	value uint64
}

func (c *Counter) Inc(amount uint64) {
	atomic.AddUint64(&c.value, amount)
}

func (c *Counter) Value() uint64 {
	return atomic.LoadUint64(&c.value)
}

func (c *Counter) Reset() {
	atomic.StoreUint64(&c.value, 0)
}

// Gauge metric
type Gauge struct {
	value atomic.Value
}

func (g *Gauge) Set(value float64) {
	g.value.Store(value)
}

func (g *Gauge) Get() float64 {
	val := g.value.Load()
	if val == nil {
		return 0
	}
	return val.(float64)
}

func (g *Gauge) Inc(amount float64) {
	g.Set(g.Get() + amount)
}

func (g *Gauge) Dec(amount float64) {
	g.Set(g.Get() - amount)
}

// Histogram for latency distributions
type Histogram struct {
	buckets []uint64
	count  uint64
	sum    float64
	min   float64
	max   float64
	mu    sync.Mutex
}

func NewHistogram(bucketCounts int) *Histogram {
	return &Histogram{
		buckets: make([]uint64, bucketCounts+1),
	}
}

func (h *Histogram) Observe(value float64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	h.count++
	h.sum += value
	
	if h.count == 1 || value < h.min {
		h.min = value
	}
	if h.count == 1 || value > h.max {
		h.max = value
	}
}

func (h *Histogram) Count() uint64 {
	return atomic.LoadUint64(&h.count)
}

func (h *Histogram) Sum() float64 {
	return h.sum
}

func (h *Histogram) Avg() float64 {
	count := h.Count()
	if count == 0 {
		return 0
	}
	return h.sum / float64(count)
}

func (h *Histogram) Min() float64 {
	return h.min
}

func (h *Histogram) Max() float64 {
	return h.max
}

// Metric definition
type Metric struct {
	Name      string                 `json:"name"`
	Type     string                 `json:"type"`
	Value    float64              `json:"value"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// Registry holds all metrics
type Registry struct {
	mu        sync.RWMutex
	counters  map[string]*Counter
	gauges    map[string]*Gauge
	histos   map[string]*Histogram
	prefix   string
	exportC  chan []*Metric
}

// NewRegistry creates a new metrics registry
func NewRegistry(prefix string) *Registry {
	return &Registry{
		counters:  make(map[string]*Counter),
		gauges:   make(map[string]*Gauge),
		histos:   make(map[string]*Histogram),
		prefix:   prefix,
		exportC:  make(chan []*Metric, 1024),
	}
}

// GetCounter returns or creates a counter
func (r *Registry) GetCounter(name string) *Counter {
	r.mu.RLock()
	c, ok := r.counters[name]
	r.mu.RUnlock()

	if ok {
		return c
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if c, ok := r.counters[name]; ok {
		return c
	}

	c = &Counter{}
	r.counters[name] = c
	return c
}

// GetGauge returns or creates a gauge
func (r *Registry) GetGauge(name string) *Gauge {
	r.mu.RLock()
	g, ok := r.gauges[name]
	r.mu.RUnlock()

	if ok {
		return g
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if g, ok := r.gauges[name]; ok {
		return g
	}

	g = &Gauge{}
	r.gauges[name] = g
	return g
}

// GetHistogram returns or creates a histogram
func (r *Registry) GetHistogram(name string, buckets int) *Histogram {
	r.mu.RLock()
	h, ok := r.histos[name]
	r.mu.RUnlock()

	if ok {
		return h
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if h, ok := r.histos[name]; ok {
		return h
	}

	h = NewHistogram(buckets)
	r.histos[name] = h
	return h
}

// Counter operations
func (r *Registry) IncCounter(name string, amount uint64) {
	r.GetCounter(name).Inc(amount)
}

func (r *Registry) CounterValue(name string) uint64 {
	return r.GetCounter(name).Value()
}

// Gauge operations
func (r *Registry) SetGauge(name string, value float64) {
	r.GetGauge(name).Set(value)
}

func (r *Registry) GaugeValue(name string) float64 {
	return r.GetGauge(name).Get()
}

// Histogram operations
func (r *Registry) ObserveHistogram(name string, value float64, buckets int) {
	r.GetHistogram(name, buckets).Observe(value)
}

// Export all metrics in Prometheus format
func (r *Registry) ExportPrometheus() string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	lines := []string{}

	for name, c := range r.counters {
		lines = append(lines, fmt.Sprintf("%s%s %d", r.prefix, name, c.Value()))
	}

	for name, g := range r.gauges {
		lines = append(lines, fmt.Sprintf("%s%s %f", r.prefix, name, g.Get()))
	}

	for name, h := range r.histos {
		lines = append(lines, fmt.Sprintf("%s%s_count %d", r.prefix, name, h.Count()))
		lines = append(lines, fmt.Sprintf("%s%s_sum %f", r.prefix, name, h.Sum()))
		lines = append(lines, fmt.Sprintf("%s%s_avg %f", r.prefix, name, h.Avg()))
	}

	return Join(lines, "\n")
}

// Join strings
func Join(items []string, sep string) string {
	if len(items) == 0 {
		return ""
	}
	result := items[0]
	for i := 1; i < len(items); i++ {
		result += sep + items[i]
	}
	return result
}

// ExportJSON exports metrics as JSON
func (r *Registry) ExportJSON() ([]byte, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	metrics := make([]*Metric, 0)

	for name, c := range r.counters {
		metrics = append(metrics, &Metric{Name: r.prefix + name, Type: "counter", Value: float64(c.Value())})
	}

	for name, g := range r.gauges {
		metrics = append(metrics, &Metric{Name: r.prefix + name, Type: "gauge", Value: g.Get()})
	}

	return json.MarshalIndent(metrics, "", "  ")
}

// Predefined registry
var DefaultRegistry = NewRegistry("tigerex_")

// Convenience functions
func IncCounter(name string, amount uint64) {
	DefaultRegistry.IncCounter(name, amount)
}

func SetGauge(name string, value float64) {
	DefaultRegistry.SetGauge(name, value)
}

func Observe(name string, value float64) {
	DefaultRegistry.ObserveHistogram(name, value, 10)
}

func Export() string {
	return DefaultRegistry.ExportPrometheus()
}