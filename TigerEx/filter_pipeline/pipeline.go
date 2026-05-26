package main

import (
	"fmt"
	"strings"
)

// ============================================================================
// FILTER PIPELINE - Go Implementation
// High-performance filter pipeline for TigerEx
// ============================================================================

// FilterFunc represents a filter function
type FilterFunc func(map[string]interface{}) bool

// FilterPipeline manages a chain of filters
type FilterPipeline struct {
	filters []FilterFunc
}

// NewFilterPipeline creates a new filter pipeline
func NewFilterPipeline() *FilterPipeline {
	return &FilterPipeline{
		filters: make([]FilterFunc, 0),
	}
}

// Add adds a filter to the pipeline
func (fp *FilterPipeline) Add(fn FilterFunc) {
	fp.filters = append(fp.filters, fn)
}

// Process processes data through all filters
func (fp *FilterPipeline) Process(data map[string]interface{}) bool {
	for _, fn := range fp.filters {
		if !fn(data) {
			return false
		}
	}
	return true
}

// Len returns number of filters
func (fp *FilterPipeline) Len() int {
	return len(fp.filters)
}

// Clear removes all filters
func (fp *FilterPipeline) Clear() {
	fp.filters = make([]FilterFunc, 0)
}

// ============================================================================
// BUILT-IN FILTERS
// ============================================================================

// IPFilter checks for valid IP address
func IPFilter(data map[string]interface{}) bool {
	ip, ok := data["ip"].(string)
	if !ok || ip == "" {
		return false
	}
	return strings.Contains(ip, ".")
}

// RateFilter checks rate limit
func RateFilter(data map[string]interface{}) bool {
	rate, ok := data["rate"].(float64)
	if !ok {
		return true // No rate limit in request
	}
	return rate < 1000
}

// AmountFilter checks transaction amount
func AmountFilter(data map[string]interface{}) bool {
	amount, ok := data["amount"].(float64)
	if !ok {
		return true
	}
	return amount > 0 && amount < 1000000
}

// CountryFilter checks allowed countries
func CountryFilter(allowedCountries []string) FilterFunc {
	allowed := make(map[string]bool)
	for _, c := range allowedCountries {
		allowed[c] = true
	}
	return func(data map[string]interface{}) bool {
		country, ok := data["country"].(string)
		if !ok {
			return false
		}
		return allowed[country]
	}
}

// ScoreFilter minimum trust score
func ScoreFilter(minScore float64) FilterFunc {
	return func(data map[string]interface{}) bool {
		score, ok := data["trustScore"].(float64)
		if !ok {
			return false
		}
		return score >= minScore
	}
}

// ============================================================================
// PIPELINE BUILDER
// ============================================================================

// PipelineBuilder builds pipelines fluently
type PipelineBuilder struct {
	pipeline *FilterPipeline
}

// NewPipelineBuilder creates a new builder
func NewPipelineBuilder() *PipelineBuilder {
	return &PipelineBuilder{
		pipeline: NewFilterPipeline(),
	}
}

// With adds a filter
func (b *PipelineBuilder) With(fn FilterFunc) *PipelineBuilder {
	b.pipeline.Add(fn)
	return b
}

// WithIP adds IP filter
func (b *PipelineBuilder) WithIP() *PipelineBuilder {
	b.pipeline.Add(IPFilter)
	return b
}

// WithRate adds rate filter
func (b *PipelineBuilder) WithRate() *PipelineBuilder {
	b.pipeline.Add(RateFilter)
	return b
}

// WithAmount adds amount filter
func (b *PipelineBuilder) WithAmount() *PipelineBuilder {
	b.pipeline.Add(AmountFilter)
	return b
}

// Build builds the pipeline
func (b *PipelineBuilder) Build() *FilterPipeline {
	return b.pipeline
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	// Basic pipeline
	pipeline := NewFilterPipeline()
	pipeline.Add(IPFilter)
	pipeline.Add(RateFilter)
	
	// Test data
	data := map[string]interface{}{
		"ip":   "1.2.3.4",
		"rate": 100.0,
	}
	
	result := pipeline.Process(data)
	fmt.Printf("Basic pipeline result: %v\n", result)
	
	// Fluent builder
	builder := NewPipelineBuilder().
		WithIP().
		WithRate().
		WithAmount()
	
	result2 := builder.Build().Process(data)
	fmt.Printf("Builder pipeline result: %v\n", result2)
	
	// Custom score filter
	pipeline2 := NewFilterPipeline()
	pipeline2.Add(ScoreFilter(50.0))
	
	data2 := map[string]interface{}{
		"trustScore": 75.0,
	}
	
	result3 := pipeline2.Process(data2)
	fmt.Printf("Score filter result: %v\n", result3)
}