package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"
)

// ============================================================================
// DISTRIBUTED TRACER - Go Implementation
// Distributed tracing for TigerEx microservices
// ============================================================================

// Span represents a trace span
type Span struct {
	TraceID    string            `json:"traceId"`
	SpanID    string            `json:"spanId"`
	ParentID  string            `json:"parentId,omitempty"`
	Service  string            `json:"service"`
	Operation string           `json:"operation"`
	StartTime time.Time         `json:"startTime"`
	EndTime  *time.Time       `json:"endTime,omitempty"`
	Tags     map[string]string `json:"tags"`
	Logs     []SpanLog        `json:"logs"`
}

// SpanLog represents a span log entry
type SpanLog struct {
	Timestamp time.Time              `json:"timestamp"`
	Message  string               `json:"message"`
	Fields  map[string]interface{} `json:"fields,omitempty"`
}

// Tracer manages distributed tracing
type Tracer struct {
	serviceName string
	mu         sync.RWMutex
	spans      map[string]*Span
}

// NewTracer creates a new tracer
func NewTracer(serviceName string) *Tracer {
	return &Tracer{
		serviceName: serviceName,
		spans:     make(map[string]*Span),
	}
}

// GenerateID generates a unique ID
func GenerateID() string {
	const chars = "abcdef0123456789"
	id := make([]byte, 16)
	for i := range id {
		id[i] = chars[rand.Intn(len(chars))]
	}
	return string(id)
}

// StartSpan starts a new span
func (t *Tracer) StartSpan(operation string, traceID string) *Span {
	if traceID == "" {
		traceID = GenerateID()
	}
	spanID := GenerateID()[:8]

	span := &Span{
		TraceID:    traceID,
		SpanID:    spanID,
		Service:   t.serviceName,
		Operation: operation,
		StartTime: time.Now(),
		Tags:     make(map[string]string),
		Logs:     make([]SpanLog, 0),
	}

	t.mu.Lock()
	t.spans[spanID] = span
	t.mu.Unlock()

	return span
}

// EndSpan ends a span
func (t *Tracer) EndSpan(span *Span) {
	now := time.Now()
	span.EndTime = &now
}

// AddTag adds a tag to a span
func (t *Tracer) AddTag(span *Span, key, value string) {
	span.Tags[key] = value
}

// AddLog adds a log to a span
func (t *Tracer) AddLog(span *Span, message string, fields map[string]interface{}) {
	log := SpanLog{
		Timestamp: time.Now(),
		Message:  message,
		Fields:  fields,
	}
	span.Logs = append(span.Logs, log)
}

// GetDuration returns span duration in milliseconds
func (t *Tracer) GetDuration(span *Span) float64 {
	if span.EndTime == nil {
		return 0
	}
	return float64(span.EndTime.Sub(span.StartTime).Milliseconds())
}

// GetMetrics returns aggregated metrics
func (t *Tracer) GetMetrics() map[string]interface{} {
	t.mu.RLock()
	defer t.mu.RUnlock()

	durations := make(map[string][]float64)
	for _, span := range t.spans {
		if span.EndTime != nil {
			dur := float64(span.EndTime.Sub(span.StartTime).Milliseconds())
			durations[span.Operation] = append(durations[span.Operation], dur)
		}
	}

	metrics := make(map[string]interface{})
	for op, durs := range durations {
		if len(durs) == 0 {
			continue
		}
		var total float64
		for _, d := range durs {
			total += d
		}
		metrics[op] = map[string]interface{}{
			"count":   len(durs),
			"total":   total,
			"average": total / float64(len(durs)),
		}
	}

	return metrics
}

// GetSpan retrieves a span by ID
func (t *Tracer) GetSpan(spanID string) *Span {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.spans[spanID]
}

// Clear removes all spans
func (t *Tracer) Clear() {
	t.mu.Lock()
	t.spans = make(map[string]*Span)
	t.mu.Unlock()
}

// Export exports spans to JSON format
func (t *Tracer) Export() ([]byte, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return json.MarshalIndent(t.spans, "", "  ")
}

// ============================================================================
// TRACE CONTEXT
// ============================================================================

// TraceContext carries trace information
type TraceContext struct {
	TraceID string
	SpanID string
}

// NewTraceContext creates new trace context
func NewTraceContext(operation string) (*TraceContext, *Span) {
	tracer := NewTracer("default")
	span := tracer.StartSpan(operation, "")
	return &TraceContext{
		TraceID: span.TraceID,
		SpanID: span.SpanID,
	}, span
}

// Inject injects trace context into carrier
func (tc *TraceContext) Inject(carrier map[string]string) {
	carrier["x-trace-id"] = tc.TraceID
	carrier["x-span-id"] = tc.SpanID
}

// Extract extracts trace context from carrier
func Extract(carrier map[string]string) *TraceContext {
	return &TraceContext{
		TraceID: carrier["x-trace-id"],
		SpanID: carrier["x-span-id"],
	}
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	tracer := NewTracer("order-service")

	// Start a span
	span := tracer.StartSpan("create_order", "")

	// Add tags
	tracer.AddTag(span, "user_id", "12345")
	tracer.AddTag(span, "order_type", "market")

	// Add logs
	tracer.AddLog(span, "Starting order creation", map[string]interface{}{
		"symbol": "BTC/USDT",
	})

	// Simulate work
	time.Sleep(10 * time.Millisecond)

	tracer.AddLog(span, "Order created", map[string]interface{}{
		"order_id": "ORD-12345",
	})

	// End span
	tracer.EndSpan(span)

	// Get duration
	duration := tracer.GetDuration(span)
	fmt.Printf("Order duration: %.2fms\n", duration)

	// Get metrics
	metrics := tracer.GetMetrics()
	fmt.Printf("Metrics: %+v\n", metrics)

	// Export to JSON
	jsonData, _ := tracer.Export()
	fmt.Printf("Traces:\n%s\n", string(jsonData))

	// Test trace context
	ctx, testSpan := NewTraceContext("test_operation")
	fmt.Printf("\nTrace context - TraceID: %s, SpanID: %s\n", ctx.TraceID, ctx.SpanID)

	carrier := make(map[string]string)
	ctx.Inject(carrier)
	fmt.Printf("Injected carrier: %+v\n", carrier)

	extracted := Extract(carrier)
	fmt.Printf("Extracted - TraceID: %s, SpanID: %s\n", extracted.TraceID, extracted.SpanID)
}