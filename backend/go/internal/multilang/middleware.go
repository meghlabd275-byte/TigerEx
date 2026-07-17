// Multi-Language API Middleware
//
// Gin middleware for multi-language API routing

package multilang

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Middleware returns a Gin middleware for multi-language routing
func Middleware() gin.HandlerFunc {
	router := GetRouter()
	
	return func(c *gin.Context) {
		// Extract API name from the path
		apiName := extractAPIName(c.Request.URL.Path)
		
		if apiName == "" {
			c.Next()
			return
		}

		// Check if this is a registered API
		_, err := router.GetAPIConfig(apiName)
		if err != nil {
			c.Next()
			return
		}

		// Route the request
		start := time.Now()
		
		lang, err := router.GetBestLanguage(apiName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "No available backend",
			})
			return
		}

		// Set the selected language header
		c.Header("X-Backend-Language", string(lang))
		c.Header("X-API-Name", apiName)

		// Process the request
		c.Next()

		// Record metrics
		latency := time.Since(start)
		success := c.Writer.Status() < 400
		
		var errMsg string
		if !success {
			errMsg = c.Errors.ByType(gin.ErrorTypePrivate).String()
		}
		
		router.RecordRequest(apiName, lang, latency, success, errMsg)
	}
}

// APIMiddlewareHandler handles API requests using the multi-language router
func APIMiddlewareHandler(apiName string) gin.HandlerFunc {
	router := GetRouter()
	
	return func(c *gin.Context) {
		lang, err := router.GetBestLanguage(apiName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Set context values
		c.Set("backend_language", lang)
		c.Set("api_name", apiName)

		c.Next()
	}
}

// HealthCheckHandler returns a handler for health checks
func HealthCheckHandler() gin.HandlerFunc {
	router := GetRouter()
	
	return func(c *gin.Context) {
		apis := router.ListAPIs()
		
		healthData := make(map[string]interface{})
		healthData["status"] = "healthy"
		healthData["timestamp"] = time.Now().Unix()
		healthData["apis"] = make(map[string]interface{})
		
		for _, apiName := range apis {
			metrics := router.GetMetrics(apiName)
			apiHealth := make(map[string]interface{})
			
			for lang, m := range metrics {
				apiHealth[string(lang)] = map[string]interface{}{
					"healthy":    m.HealthStatus,
					"total_req":  m.TotalRequests,
					"success":    m.SuccessCount,
					"failures":   m.FailureCount,
				}
			}
			
			healthData["apis"].(map[string]interface{})[apiName] = apiHealth
		}
		
		c.JSON(http.StatusOK, healthData)
	}
}

// MetricsHandler returns a handler for viewing metrics
func MetricsHandler() gin.HandlerFunc {
	router := GetRouter()
	
	return func(c *gin.Context) {
		apiName := c.Query("api")
		
		if apiName != "" {
			metrics := router.GetMetrics(apiName)
			c.JSON(http.StatusOK, gin.H{
				"api":     apiName,
				"metrics": metrics,
			})
			return
		}
		
		// Return all metrics
		apis := router.ListAPIs()
		allMetrics := make(map[string]map[Language]*PerformanceMetrics)
		
		for _, name := range apis {
			allMetrics[name] = router.GetMetrics(name)
		}
		
		c.JSON(http.StatusOK, gin.H{
			"metrics": allMetrics,
		})
	}
}

// SwitchLanguageHandler allows manual language switching
func SwitchLanguageHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		apiName := c.Param("api")
		language := c.Param("language")
		
		if apiName == "" || language == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing api or language parameter",
			})
			return
		}
		
		router := GetRouter()
		config, err := router.GetAPIConfig(apiName)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": err.Error(),
			})
			return
		}
		
		// Check if language is available
		langConfig, ok := config.AvailableLanguages[Language(language)]
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Language not available for this API",
			})
			return
		}
		
		if !langConfig.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Language is currently disabled",
			})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"message":       "Language switched successfully",
			"api":           apiName,
			"language":      language,
			"endpoint":      langConfig.Endpoint,
		})
	}
}

// extractAPIName extracts the API name from the URL path
func extractAPIName(path string) string {
	// Remove leading slash
	path = strings.TrimPrefix(path, "/")
	
	// Common API path patterns
	paths := []string{
		"api/v2/",
		"api/v1/",
		"ws/",
		"websocket/",
		"fix/",
		"api/",
	}
	
	for _, p := range paths {
		if strings.HasPrefix(path, p) {
			// Get the next segment
			rest := strings.TrimPrefix(path, p)
			parts := strings.SplitN(rest, "/", 2)
			if len(parts) > 0 && parts[0] != "" {
				return parts[0]
			}
		}
	}
	
	// Check for known API names in path
	knownAPIs := []string{
		"rest_api_v2", "websocket_v2", "fix_api", "order_service",
		"trading_service", "marketdata", "future_trading", "margin_trading",
		"ai_trading", "predictive_analytics", "banking_integration",
		"compliance_reporting", "custody_service", "matching_engine",
		"p2p_trading", "payment_gateway", "wallet_service", "staking",
	}
	
	for _, api := range knownAPIs {
		if strings.Contains(path, api) {
			return api
		}
	}
	
	return ""
}

// RegisterRoutes registers the multi-language router routes
func RegisterRoutes(r *gin.Engine) {
	router := GetRouter()
	
	// Health check endpoint
	r.GET("/health", HealthCheckHandler())
	
	// Metrics endpoint
	r.GET("/metrics", MetricsHandler())
	
	// Manual language switch endpoint
	r.POST("/api/:api/switch/:language", SwitchLanguageHandler())
	
	// API info endpoint
	r.GET("/api/info", func(c *gin.Context) {
		apis := router.ListAPIs()
		apiInfo := make([]map[string]interface{}, 0)
		
		for _, name := range apis {
			config, _ := router.GetAPIConfig(name)
			if config != nil {
				apiInfo = append(apiInfo, map[string]interface{}{
					"name":                config.Name,
					"category":           config.Category,
					"preferred_language": config.PreferredLanguage,
					"failover_enabled":   config.FailoverEnabled,
					"load_balance":       config.LoadBalanceEnabled,
					"available_languages": func() []string {
						langs := make([]string, 0)
						for l := range config.AvailableLanguages {
							langs = append(langs, string(l))
						}
						return langs
					}(),
				})
			}
		}
		
		c.JSON(http.StatusOK, gin.H{
			"apis": apiInfo,
		})
	})
	
	// Start health check background job
	router.StartHealthCheck()
}
