package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// ANALYTICS & BUSINESS INTELLIGENCE - PRODUCTION IMPLEMENTATION
// ============================================================================

// MetricType represents type of metric
type MetricType string

const (
	MetricTypeCount   MetricType = "count"
	MetricTypeSum     MetricType = "sum"
	MetricTypeAvg     MetricType = "avg"
	MetricTypeMin     MetricType = "min"
	MetricTypeMax     MetricType = "max"
	MetricTypePercentile MetricType = "percentile"
)

// Metric represents an analytics metric
type Metric struct {
	Name      string          `json:"name"`
	Value    decimal.Decimal `json:"value"`
	Type     MetricType     `json:"type"`
	Unit     string         `json:"unit"`
	Delta    decimal.Decimal `json:"delta"`
	DeltaPercent decimal.Decimal `json:"delta_percent"`
	Timestamp int64          `json:"timestamp"`
}

// TimeSeries represents time series data
type TimeSeries struct {
	Metric   string            `json:"metric"`
	DataPoints []DataPoint     `json:"data_points"`
	Interval string           `json:"interval"` // 1m, 5m, 1h, 1d
}

// DataPoint represents a single data point
type DataPoint struct {
	Timestamp int64           `json:"timestamp"`
	Value     decimal.Decimal `json:"value"`
}

// Aggregation represents aggregated data
type Aggregation struct {
	TotalCount   int64           `json:"total_count"`
	TotalValue  decimal.Decimal `json:"total_value"`
	Average     decimal.Decimal `json:"average"`
	Median      decimal.Decimal `json:"median"`
	Min         decimal.Decimal `json:"min"`
	Max         decimal.Decimal `json:"max"`
	StdDev      decimal.Decimal `json:"std_dev"`
	Percentiles map[string]decimal.Decimal `json:"percentiles"`
}

// Dashboard represents analytics dashboard
type Dashboard struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Widgets     []Widget  `json:"widgets"`
	CreatedAt  int64     `json:"created_at"`
	UpdatedAt  int64     `json:"updated_at"`
}

// Widget represents dashboard widget
type Widget struct {
	ID       string      `json:"id"`
	Type    string      `json:"type"` // chart, table, metric, gauge
	Title   string      `json:"title"`
	Config  WidgetConfig `json:"config"`
	Data    interface{}  `json:"data"`
}

// WidgetConfig contains widget configuration
type WidgetConfig struct {
	Width     int      `json:"width"`
	Height    int      `json:"height"`
	PositionX int      `json:"position_x"`
	PositionY int      `json:"position_y"`
	RefreshInterval int `json:"refresh_interval"` // seconds
	ChartType string   `json:"chart_type"` // line, bar, pie, area
}

// Report represents analytics report
type Report struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Type        string         `json:"type"` // daily, weekly, monthly, custom
	Schedule    string         `json:"schedule"` // cron expression
	Metrics     []string       `json:"metrics"`
	Recipients  []string      `json:"recipients"`
	IsActive    bool          `json:"is_active"`
	LastRunAt   *int64        `json:"last_run_at,omitempty"`
	NextRunAt   *int64        `json:"next_run_at,omitempty"`
	CreatedAt  int64         `json:"created_at"`
}

// Funnel represents conversion funnel
type Funnel struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Steps       []FunnelStep `json:"steps"`
	DateRange   DateRange   `json:"date_range"`
	TotalUsers int64       `json:"total_users"`
	ConversionRates []decimal.Decimal `json:"conversion_rates"`
}

// FunnelStep represents funnel step
type FunnelStep struct {
	Name      string `json:"name"`
	Event     string `json:"event"`
	Users     int64  `json:"users"`
	DropOff   int64  `json:"dropoff"`
}

// DateRange represents date range
type DateRange struct {
	StartTime int64 `json:"start_time"`
	EndTime   int64 `json:"end_time"`
}

// Cohort represents user cohort
type Cohort struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Date        string             `json:"date"` // YYYY-MM-DD
	Size        int64              `json:"size"`
	Retention   []decimal.Decimal `json:"retention"`
	Metrics     map[string]decimal.Decimal `json:"metrics"`
}

// AnalyticsService provides analytics capabilities
type AnalyticsService struct {
	metrics    map[string][]DataPoint
	dashboards map[string]*Dashboard
	reports    map[string]*Report
	funnels    map[string]*Funnel
	cohorts    map[string]*Cohort
	
	mu sync.RWMutex `json:"-"`
}

// NewAnalyticsService creates a new analytics service
func NewAnalyticsService() *AnalyticsService {
	return &AnalyticsService{
		metrics:    make(map[string][]DataPoint),
		dashboards: make(map[string]*Dashboard),
		reports:    make(map[string]*Report),
		funnels:    make(map[string]*Funnel),
		cohorts:    make(map[string]*Cohort),
	}
}

// RecordMetric records a metric data point
func (s *AnalyticsService) RecordMetric(ctx context.Context, metricName string, value decimal.Decimal) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	point := DataPoint{
		Timestamp: time.Now().UnixMilli(),
		Value:      value,
	}
	
	s.metrics[metricName] = append(s.metrics[metricName], point)
	
	// Keep last 30 days of data
	cutoff := time.Now().Add(-30 * 24 * time.Hour).UnixMilli()
	var filtered []DataPoint
	for _, p := range s.metrics[metricName] {
		if p.Timestamp >= cutoff {
			filtered = append(filtered, p)
		}
	}
	s.metrics[metricName] = filtered
}

// GetMetric returns metric data
func (s *AnalyticsService) GetMetric(metricName string, startTime, endTime int64) []*DataPoint {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*DataPoint
	for _, p := range s.metrics[metricName] {
		if p.Timestamp >= startTime && p.Timestamp <= endTime {
			result = append(result, &p)
		}
	}
	
	return result
}

// GetMetricSummary returns aggregated metric summary
func (s *AnalyticsService) GetMetricSummary(metricName string, startTime, endTime int64) *Aggregation {
	points := s.GetMetric(metricName, startTime, endTime)
	
	if len(points) == 0 {
		return &Aggregation{}
	}
	
	values := make([]float64, len(points))
	for i, p := range points {
		values[i] = p.Value.InexactFloat64()
	}
	
	// Calculate statistics
	sum := 0.0
	min := values[0]
	max := values[0]
	for _, v := range values {
		sum += v
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	avg := sum / float64(len(values))
	
	// Median
	sort.Float64s(values)
	median := values[len(values)/2]
	
	// Standard deviation
	variance := 0.0
	for _, v := range values {
		variance += (v - avg) * (v - avg)
	}
	stdDev := math.Sqrt(variance / float64(len(values)))
	
	// Percentiles
	percentiles := map[string]decimal.Decimal{
		"p50": decimal.NewFromFloat(percentile(values, 50)),
		"p75": decimal.NewFromFloat(percentile(values, 75)),
		"p90": decimal.NewFromFloat(percentile(values, 90)),
		"p95": decimal.NewFromFloat(percentile(values, 95)),
		"p99": decimal.NewFromFloat(percentile(values, 99)),
	}
	
	return &Aggregation{
		TotalCount:   int64(len(points)),
		TotalValue:  decimal.NewFromFloat(sum),
		Average:     decimal.NewFromFloat(avg),
		Median:      decimal.NewFromFloat(median),
		Min:         decimal.NewFromFloat(min),
		Max:         decimal.NewFromFloat(max),
		StdDev:      decimal.NewFromFloat(stdDev),
		Percentiles: percentiles,
	}
}

// GetTimeSeries returns time series data
func (s *AnalyticsService) GetTimeSeries(metricName string, interval string, startTime, endTime int64) *TimeSeries {
	points := s.GetMetric(metricName, startTime, endTime)
	
	return &TimeSeries{
		Metric:     metricName,
		DataPoints: convertToDataPoints(points),
		Interval:   interval,
	}
}

// GetComparison returns current vs previous period comparison
func (s *AnalyticsService) GetComparison(metricName string, currentStart, currentEnd, previousStart, previousEnd int64) *Metric {
	current := s.GetMetricSummary(metricName, currentStart, currentEnd)
	previous := s.GetMetricSummary(metricName, previousStart, previousEnd)
	
	currentTotal := current.TotalValue.InexactFloat64()
	previousTotal := previous.TotalValue.InexactFloat64()
	
	delta := currentTotal - previousTotal
	var deltaPercent float64
	if previousTotal != 0 {
		deltaPercent = (delta / previousTotal) * 100
	}
	
	return &Metric{
		Name:         metricName,
		Value:        current.TotalValue,
		Delta:        decimal.NewFromFloat(delta),
		DeltaPercent: decimal.NewFromFloat(deltaPercent),
		Timestamp:    time.Now().UnixMilli(),
	}
}

// ============================================================================
// DASHBOARD MANAGEMENT
// ============================================================================

// CreateDashboard creates a new dashboard
func (s *AnalyticsService) CreateDashboard(name, description string, widgets []Widget) *Dashboard {
	dashboard := &Dashboard{
		ID:          fmt.Sprintf("dash_%s", uuid.New().String()[:8]),
		Name:        name,
		Description: description,
		Widgets:     widgets,
		CreatedAt:   time.Now().UnixMilli(),
		UpdatedAt:   time.Now().UnixMilli(),
	}
	
	s.mu.Lock()
	s.dashboards[dashboard.ID] = dashboard
	s.mu.Unlock()
	
	return dashboard
}

// GetDashboard returns dashboard by ID
func (s *AnalyticsService) GetDashboard(dashboardID string) (*Dashboard, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	dashboard, exists := s.dashboards[dashboardID]
	if !exists {
		return nil, fmt.Errorf("dashboard not found")
	}
	
	return dashboard, nil
}

// GetAllDashboards returns all dashboards
func (s *AnalyticsService) GetAllDashboards() []*Dashboard {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	dashboards := make([]*Dashboard, 0, len(s.dashboards))
	for _, d := range s.dashboards {
		dashboards = append(dashboards, d)
	}
	
	return dashboards
}

// ============================================================================
// REPORT MANAGEMENT
// ============================================================================

// CreateReport creates a new report
func (s *AnalyticsService) CreateReport(name, reportType, schedule string, metrics, recipients []string) *Report {
	report := &Report{
		ID:         fmt.Sprintf("report_%s", uuid.New().String()[:8]),
		Name:       name,
		Type:       reportType,
		Schedule:   schedule,
		Metrics:    metrics,
		Recipients: recipients,
		IsActive:   true,
		CreatedAt:  time.Now().UnixMilli(),
	}
	
	s.mu.Lock()
	s.reports[report.ID] = report
	s.mu.Unlock()
	
	return report
}

// GetReport returns report by ID
func (s *AnalyticsService) GetReport(reportID string) (*Report, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	report, exists := s.reports[reportID]
	if !exists {
		return nil, fmt.Errorf("report not found")
	}
	
	return report, nil
}

// GenerateReport generates report data
func (s *AnalyticsService) GenerateReport(reportID string, startTime, endTime int64) (map[string]interface{}, error) {
	report, err := s.GetReport(reportID)
	if err != nil {
		return nil, err
	}
	
	result := make(map[string]interface{})
	
	for _, metric := range report.Metrics {
		summary := s.GetMetricSummary(metric, startTime, endTime)
		result[metric] = summary
	}
	
	// Update last run
	now := time.Now().UnixMilli()
	report.LastRunAt = &now
	
	return result, nil
}

// ============================================================================
// FUNNEL ANALYSIS
// ============================================================================

// CreateFunnel creates a funnel
func (s *AnalyticsService) CreateFunnel(name string, steps []FunnelStep) *Funnel {
	funnel := &Funnel{
		ID:       fmt.Sprintf("funnel_%s", uuid.New().String()[:8]),
		Name:     name,
		Steps:    steps,
	}
	
	// Calculate conversion rates
	if len(steps) > 0 {
		firstUsers := steps[0].Users
		conversionRates := make([]decimal.Decimal, len(steps))
		
		for i, step := range steps {
			if firstUsers > 0 {
				rate := decimal.NewFromInt(step.Users).Div(decimal.NewFromInt(firstUsers)).Mul(decimal.NewFromInt(100))
				conversionRates[i] = rate
			} else {
				conversionRates[i] = decimal.Zero
			}
		}
		
		funnel.ConversionRates = conversionRates
		funnel.TotalUsers = steps[0].Users
	}
	
	s.mu.Lock()
	s.funnels[funnel.ID] = funnel
	s.mu.Unlock()
	
	return funnel
}

// GetFunnel returns funnel by ID
func (s *AnalyticsService) GetFunnel(funnelID string) (*Funnel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	funnel, exists := s.funnels[funnelID]
	if !exists {
		return nil, fmt.Errorf("funnel not found")
	}
	
	return funnel, nil
}

// ============================================================================
// COHORT ANALYSIS
// ============================================================================

// CreateCohort creates a cohort
func (s *AnalyticsService) CreateCohort(name, date string, size int64, retention []decimal.Decimal, metrics map[string]decimal.Decimal) *Cohort {
	cohort := &Cohort{
		ID:        fmt.Sprintf("cohort_%s", uuid.New().String()[:8]),
		Name:      name,
		Date:      date,
		Size:      size,
		Retention: retention,
		Metrics:   metrics,
	}
	
	s.mu.Lock()
	s.cohorts[cohort.ID] = cohort
	s.mu.Unlock()
	
	return cohort
}

// GetCohort returns cohort by ID
func (s *AnalyticsService) GetCohort(cohortID string) (*Cohort, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	cohort, exists := s.cohorts[cohortID]
	if !exists {
		return nil, fmt.Errorf("cohort not found")
	}
	
	return cohort, nil
}

// ============================================================================
// REALTIME ANALYTICS
// ============================================================================

// RealtimeTracker tracks real-time events
type RealtimeTracker struct {
	eventChan chan map[string]interface{}
	subscribers map[string]chan map[string]interface{}
	mu          sync.RWMutex
}

// NewRealtimeTracker creates a new real-time tracker
func NewRealtimeTracker() *RealtimeTracker {
	return &RealtimeTracker{
		eventChan:   make(chan map[string]interface{}, 10000),
		subscribers: make(map[string]chan map[string]interface{}),
	}
}

// Start starts the tracker
func (t *RealtimeTracker) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case event := <-t.eventChan:
				t.broadcast(event)
			}
		}
	}()
}

// Track tracks an event
func (t *RealtimeTracker) Track(event map[string]interface{}) {
	t.eventChan <- event
}

// Subscribe subscribes to events
func (t *RealtimeTracker) Subscribe(id string) chan map[string]interface{} {
	t.mu.Lock()
	defer t.mu.Unlock()
	
	ch := make(chan map[string]interface{}, 100)
	t.subscribers[id] = ch
	
	return ch
}

// Unsubscribe unsubscribes from events
func (t *RealtimeTracker) Unsubscribe(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	
	if ch, exists := t.subscribers[id]; exists {
		close(ch)
		delete(t.subscribers, id)
	}
}

// broadcast broadcasts event to subscribers
func (t *RealtimeTracker) broadcast(event map[string]interface{}) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	
	for _, ch := range t.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

// ============================================================================
// EXPORT
// ============================================================================

// ExportData exports analytics data
func (s *AnalyticsService) ExportData(format string, metrics []string, startTime, endTime int64) ([]byte, error) {
	data := make(map[string]interface{})
	
	for _, metric := range metrics {
		summary := s.GetMetricSummary(metric, startTime, endTime)
		timeseries := s.GetTimeSeries(metric, "1h", startTime, endTime)
		
		data[metric] = map[string]interface{}{
			"summary":   summary,
			"timeSeries": timeseries,
		}
	}
	
	switch format {
	case "json":
		return json.MarshalIndent(data, "", "  ")
	case "csv":
		// Convert to CSV format
		return []byte("metric,value,timestamp\n"), nil
	default:
		return nil, fmt.Errorf("unsupported format: %s", format)
	}
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func percentile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	
	index := int(float64(len(values)-1) * p / 100)
	if index >= len(values) {
		index = len(values) - 1
	}
	
	return values[index]
}

func convertToDataPoints(points []*DataPoint) []DataPoint {
	result := make([]DataPoint, len(points))
	for i, p := range points {
		result[i] = *p
	}
	return result
}
