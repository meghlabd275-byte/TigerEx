// Multi-Language API Router
//
// This router automatically switches between Go, Rust, Python, and Java implementations
// based on performance characteristics, latency requirements, and load balancing.

package multilang

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Language represents the available backend implementations
type Language string

const (
	LanguageGo     Language = "go"
	LanguageRust   Language = "rust"
	LanguagePython Language = "python"
	LanguageJava   Language = "java"
)

// APICategory defines the performance requirements for each API
type APICategory string

const (
	CategoryUltraLowLatency APICategory = "ultra_low_latency" // C++/Rust only
	CategoryHighPerformance APICategory = "high_performance"  // Go/Rust
	CategoryStandard        APICategory = "standard"          // Any language
	CategoryComputeHeavy   APICategory = "compute_heavy"     // Python/Java
)

// LanguageConfig holds configuration for each language backend
type LanguageConfig struct {
	Enabled        bool          `json:"enabled"`
	Endpoint       string        `json:"endpoint"`
	Timeout        time.Duration `json:"timeout"`
	MaxRetries    int           `json:"max_retries"`
	Weight        int           `json:"weight"` // Load balancing weight
	HealthCheckURL string        `json:"health_check_url"`
}

// APIConfig defines the configuration for each API including available languages
type APIConfig struct {
	Name                string                   `json:"name"`
	Category            APICategory              `json:"category"`
	PreferredLanguage   Language                 `json:"preferred_language"`
	AvailableLanguages  map[Language]LanguageConfig `json:"available_languages"`
	FailoverEnabled    bool                     `json:"failover_enabled"`
	LoadBalanceEnabled bool                     `json:"load_balance_enabled"`
}

// PerformanceMetrics tracks performance for each language backend
type PerformanceMetrics struct {
	TotalRequests    int64     `json:"total_requests"`
	SuccessCount    int64     `json:"success_count"`
	FailureCount    int64     `json:"failure_count"`
	TotalLatency    int64     `json:"total_latency_ns"` // nanoseconds
	MinLatency      int64     `json:"min_latency_ns"`
	MaxLatency      int64     `json:"max_latency_ns"`
	LastRequestTime time.Time `json:"last_request_time"`
	LastError       string    `json:"last_error"`
	HealthStatus    bool      `json:"health_status"`
	mu             sync.RWMutex
}

// Router is the main router that manages multi-language API switching
type Router struct {
	apis            map[string]*APIConfig
	metrics         map[string]map[Language]*PerformanceMetrics
	mu              sync.RWMutex
	healthCheckInterval time.Duration
	latencySLA       time.Duration // Service Level Agreement threshold
	defaultTimeout   time.Duration
}

// RequestContext holds the context for each request
type RequestContext struct {
	RequestID    string                 `json:"request_id"`
	API          string                 `json:"api"`
	Language     Language               `json:"language"`
	StartTime    time.Time              `json:"start_time"`
	Latency      time.Duration          `json:"latency"`
	Success      bool                   `json:"success"`
	Error        string                 `json:"error,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// NewRouter creates a new multi-language router
func NewRouter() *Router {
	return &Router{
		apis:              make(map[string]*APIConfig),
		metrics:           make(map[string]map[Language]*PerformanceMetrics),
		healthCheckInterval: 30 * time.Second,
		latencySLA:        100 * time.Millisecond,
		defaultTimeout:    30 * time.Second,
	}
}

// RegisterAPI registers an API with its available language backends
func (r *Router) RegisterAPI(config APIConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.apis[config.Name] = &config
	
	// Initialize metrics for each language
	r.metrics[config.Name] = make(map[Language]*PerformanceMetrics)
	for lang := range config.AvailableLanguages {
		r.metrics[config.Name][lang] = &PerformanceMetrics{
			MinLatency: math.MaxInt64,
			HealthStatus: true,
		}
	}
}

// GetBestLanguage returns the best language for an API based on performance
func (r *Router) GetBestLanguage(apiName string) (Language, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	api, exists := r.apis[apiName]
	if !exists {
		return "", fmt.Errorf("API not found: %s", apiName)
	}

	// For ultra-low latency APIs, use C++/Rust only
	if api.Category == CategoryUltraLowLatency {
		if lang, ok := api.AvailableLanguages[LanguageRust]; ok && lang.Enabled {
			return LanguageRust, nil
		}
		return "", fmt.Errorf("no suitable backend for ultra-low latency API")
	}

	// Find the best performing language
	var bestLanguage Language
	var bestScore float64 = -1

	for lang, config := range api.AvailableLanguages {
		if !config.Enabled {
			continue
		}

		metrics := r.metrics[apiName][lang]
		score := r.calculateScore(metrics, config)

		if score > bestScore {
			bestScore = score
			bestLanguage = lang
		}
	}

	if bestLanguage == "" {
		return "", fmt.Errorf("no available backend for API: %s", apiName)
	}

	return bestLanguage, nil
}

// calculateScore calculates a performance score for a language backend
func (r *Router) calculateScore(metrics *PerformanceMetrics, config LanguageConfig) float64 {
	if !metrics.HealthStatus {
		return -1
	}

	// Calculate average latency
	avgLatency := float64(atomic.LoadInt64(&metrics.TotalLatency))
	totalReqs := atomic.LoadInt64(&metrics.TotalRequests)
	
	if totalReqs > 0 {
		avgLatency /= float64(totalReqs)
	} else {
		// Give priority to new backends that haven't been tested
		avgLatency = float64(r.latencySLA)
	}

	// Calculate success rate
	successCount := atomic.LoadInt64(&metrics.SuccessCount)
	successRate := 0.0
	if totalReqs > 0 {
		successRate = float64(successCount) / float64(totalReqs)
	}

	// Calculate score: higher is better
	// Factors: latency (lower is better), success rate (higher is better), weight
	latencyScore := 1.0 - (avgLatency / float64(r.latencySLA))
	if latencyScore < 0 {
		latencyScore = 0
	}

	score := (latencyScore * 0.5) + (successRate * 0.4) + (float64(config.Weight) * 0.1)

	return score
}

// RecordRequest records a request result for metrics
func (r *Router) RecordRequest(apiName string, lang Language, latency time.Duration, success bool, err string) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	metrics, exists := r.metrics[apiName][lang]
	if !exists {
		return
	}

	atomic.AddInt64(&metrics.TotalRequests, 1)
	atomic.AddInt64(&metrics.TotalLatency, int64(latency))

	if success {
		atomic.AddInt64(&metrics.SuccessCount, 1)
	} else {
		atomic.AddInt64(&metrics.FailureCount, 1)
	}

	// Update min/max latency
	latencyNs := int64(latency)
	for {
		currentMin := atomic.LoadInt64(&metrics.MinLatency)
		if latencyNs >= currentMin || atomic.CompareAndSwapInt64(&metrics.MinLatency, currentMin, latencyNs) {
			break
		}
	}

	for {
		currentMax := atomic.LoadInt64(&metrics.MaxLatency)
		if latencyNs <= currentMax || atomic.CompareAndSwapInt64(&metrics.MaxLatency, currentMax, latencyNs) {
			break
		}
	}

	metrics.LastRequestTime = time.Now()
	if err != "" {
		metrics.LastError = err
		metrics.HealthStatus = false
	} else {
		metrics.HealthStatus = true
	}
}

// RouteRequest routes a request to the best available backend
func (r *Router) RouteRequest(ctx *gin.Context, apiName string, handler func(lang Language) error) {
	reqCtx := &RequestContext{
		RequestID: uuid.New().String(),
		API:       apiName,
		StartTime: time.Now(),
		Metadata:  make(map[string]interface{}),
	}

	// Get the best language
	lang, err := r.GetBestLanguage(apiName)
	if err != nil {
		ctx.JSON(500, gin.H{"error": err.Error()})
		return
	}

	reqCtx.Language = lang

	// Execute handler for the selected language
	start := time.Now()
	err = handler(lang)
	reqCtx.Latency = time.Since(start)

	if err != nil {
		reqCtx.Success = false
		reqCtx.Error = err.Error()
		r.RecordRequest(apiName, lang, reqCtx.Latency, false, err.Error())
		
		// Try failover if enabled
		r.mu.RLock()
		api := r.apis[apiName]
		r.mu.RUnlock()

		if api.FailoverEnabled {
			ctx.JSON(503, gin.H{"error": "service temporarily unavailable", "request_id": reqCtx.RequestID})
			return
		}
		ctx.JSON(500, gin.H{"error": err.Error()})
		return
	}

	reqCtx.Success = true
	r.RecordRequest(apiName, lang, reqCtx.Latency, true, "")
}

// GetMetrics returns the performance metrics for all languages of an API
func (r *Router) GetMetrics(apiName string) map[Language]*PerformanceMetrics {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.metrics[apiName]
}

// HealthCheck performs health checks on all language backends
func (r *Router) HealthCheck() {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for apiName, langMetrics := range r.metrics {
		for lang, metrics := range langMetrics {
			go func(api string, l Language, m *PerformanceMetrics) {
				// Perform actual health check here
				// For now, mark as healthy if no recent errors
				m.mu.Lock()
				if time.Since(m.LastRequestTime) < 5*time.Minute && m.LastError == "" {
					m.HealthStatus = true
				} else if time.Since(m.LastRequestTime) > 5*time.Minute {
					m.HealthStatus = true // Reset if no recent requests
				}
				m.mu.Unlock()
			}(apiName, lang, metrics)
		}
	}
}

// StartHealthCheck starts periodic health checks
func (r *Router) StartHealthCheck() {
	ticker := time.NewTicker(r.healthCheckInterval)
	go func() {
		for range ticker.C {
			r.HealthCheck()
		}
	}()
}

// DefaultRouter is the global router instance
var defaultRouter *Router
var once sync.Once

// GetRouter returns the default router instance
func GetRouter() *Router {
	once.Do(func() {
		defaultRouter = NewRouter()
		defaultRouter.initializeDefaultAPIs()
	})
	return defaultRouter
}

// initializeDefaultAPIs initializes the default API configurations
func (r *Router) initializeDefaultAPIs() {
	// REST API v2 - High performance
	r.RegisterAPI(APIConfig{
		Name:              "rest_api_v2",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8080",
				Timeout:  5 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8081",
				Timeout:  3 * time.Second,
				Weight:   8,
			},
		},
	})

	// WebSocket v2 - High performance
	r.RegisterAPI(APIConfig{
		Name:              "websocket_v2",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "ws://localhost:8082",
				Timeout:  10 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "ws://localhost:8083",
				Timeout:  8 * time.Second,
				Weight:   8,
			},
		},
	})

	// FIX API - High performance
	r.RegisterAPI(APIConfig{
		Name:              "fix_api",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8084",
				Timeout:  5 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8085",
				Timeout:  5 * time.Second,
				Weight:   8,
			},
		},
	})

	// Order Service - High performance
	r.RegisterAPI(APIConfig{
		Name:              "order_service",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8086",
				Timeout:  2 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8087",
				Timeout:  2 * time.Second,
				Weight:   9,
			},
		},
	})

	// Trading Service - High performance
	r.RegisterAPI(APIConfig{
		Name:              "trading_service",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8088",
				Timeout:  5 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8089",
				Timeout:  5 * time.Second,
				Weight:   8,
			},
		},
	})

	// Market Data - High performance
	r.RegisterAPI(APIConfig{
		Name:              "marketdata",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8090",
				Timeout:  3 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8091",
				Timeout:  3 * time.Second,
				Weight:   8,
			},
		},
	})

	// Future Trading - High performance
	r.RegisterAPI(APIConfig{
		Name:              "future_trading",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8092",
				Timeout:  5 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8093",
				Timeout:  5 * time.Second,
				Weight:   8,
			},
		},
	})

	// Margin Trading - High performance
	r.RegisterAPI(APIConfig{
		Name:              "margin_trading",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8094",
				Timeout:  5 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8095",
				Timeout:  5 * time.Second,
				Weight:   8,
			},
		},
	})

	// AI Trading - Compute heavy
	r.RegisterAPI(APIConfig{
		Name:              "ai_trading",
		Category:          CategoryComputeHeavy,
		PreferredLanguage: LanguagePython,
		FailoverEnabled:   true,
		LoadBalanceEnabled: false,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguagePython: {
				Enabled:  true,
				Endpoint: "http://localhost:8096",
				Timeout:  60 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8097",
				Timeout:  30 * time.Second,
				Weight:   5,
			},
		},
	})

	// Predictive Analytics - Compute heavy
	r.RegisterAPI(APIConfig{
		Name:              "predictive_analytics",
		Category:          CategoryComputeHeavy,
		PreferredLanguage: LanguagePython,
		FailoverEnabled:   true,
		LoadBalanceEnabled: false,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguagePython: {
				Enabled:  true,
				Endpoint: "http://localhost:8098",
				Timeout:  120 * time.Second,
				Weight:   10,
			},
			LanguageJava: {
				Enabled:  true,
				Endpoint: "http://localhost:8099",
				Timeout:  90 * time.Second,
				Weight:   6,
			},
		},
	})

	// Banking Integration - Enterprise
	r.RegisterAPI(APIConfig{
		Name:              "banking_integration",
		Category:          CategoryStandard,
		PreferredLanguage: LanguageJava,
		FailoverEnabled:   true,
		LoadBalanceEnabled: false,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageJava: {
				Enabled:  true,
				Endpoint: "http://localhost:8100",
				Timeout:  30 * time.Second,
				Weight:   10,
			},
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8101",
				Timeout:  30 * time.Second,
				Weight:   7,
			},
		},
	})

	// Compliance Reporting - Enterprise
	r.RegisterAPI(APIConfig{
		Name:              "compliance_reporting",
		Category:          CategoryStandard,
		PreferredLanguage: LanguageJava,
		FailoverEnabled:   true,
		LoadBalanceEnabled: false,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageJava: {
				Enabled:  true,
				Endpoint: "http://localhost:8102",
				Timeout:  60 * time.Second,
				Weight:   10,
			},
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8103",
				Timeout:  60 * time.Second,
				Weight:   6,
			},
		},
	})

	// Custody Service - Ultra-low latency (Rust only for safety)
	r.RegisterAPI(APIConfig{
		Name:              "custody_service",
		Category:          CategoryUltraLowLatency,
		PreferredLanguage: LanguageRust,
		FailoverEnabled:   false,
		LoadBalanceEnabled: false,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8104",
				Timeout:  2 * time.Second,
				Weight:   10,
			},
		},
	})

	// Matching Engine - Ultra-low latency
	r.RegisterAPI(APIConfig{
		Name:              "matching_engine",
		Category:          CategoryUltraLowLatency,
		PreferredLanguage: LanguageRust,
		FailoverEnabled:   false,
		LoadBalanceEnabled: false,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8105",
				Timeout:  1 * time.Second,
				Weight:   10,
			},
		},
	})

	// P2P Trading - Standard
	r.RegisterAPI(APIConfig{
		Name:              "p2p_trading",
		Category:          CategoryStandard,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8106",
				Timeout:  10 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8107",
				Timeout:  10 * time.Second,
				Weight:   8,
			},
		},
	})

	// Payment Gateway - Standard
	r.RegisterAPI(APIConfig{
		Name:              "payment_gateway",
		Category:          CategoryStandard,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8108",
				Timeout:  30 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8109",
				Timeout:  30 * time.Second,
				Weight:   7,
			},
		},
	})

	// Wallet Service - Standard
	r.RegisterAPI(APIConfig{
		Name:              "wallet_service",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8110",
				Timeout:  10 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8111",
				Timeout:  10 * time.Second,
				Weight:   9,
			},
		},
	})

	// Staking - Standard
	r.RegisterAPI(APIConfig{
		Name:              "staking",
		Category:          CategoryStandard,
		PreferredLanguage: LanguageGo,
		FailoverEnabled:   true,
		LoadBalanceEnabled: true,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {
				Enabled:  true,
				Endpoint: "http://localhost:8112",
				Timeout:  15 * time.Second,
				Weight:   10,
			},
			LanguageRust: {
				Enabled:  true,
				Endpoint: "http://localhost:8113",
				Timeout:  15 * time.Second,
				Weight:   8,
			},
		},
	})
}

// GetAPIConfig returns the configuration for a specific API
func (r *Router) GetAPIConfig(apiName string) (*APIConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	api, exists := r.apis[apiName]
	if !exists {
		return nil, fmt.Errorf("API not found: %s", apiName)
	}

	return api, nil
}

// ListAPIs returns all registered APIs
func (r *Router) ListAPIs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	apis := make([]string, 0, len(r.apis))
	for name := range r.apis {
		apis = append(apis, name)
	}
	return apis
}

// MarshalJSON implements custom JSON marshaling
func (r *Router) MarshalJSON() ([]byte, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	data := make(map[string]interface{})
	for name, api := range r.apis {
		data[name] = api
	}
	return json.Marshal(data)
}
