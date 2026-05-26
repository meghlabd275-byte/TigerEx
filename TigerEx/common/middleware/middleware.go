package common

import (
	"fmt"
	"sync"
	"time"
)

// AuthRequest represents authenticated request data
type AuthRequest struct {
	UserID string
	APIKey string
	Role  string
	Method string
	Path   string
}

// AuthMiddleware validates authentication
func AuthMiddleware(req *AuthRequest) error {
	if req.UserID == "" && req.APIKey == "" {
		return fmt.Errorf("unauthorized")
	}
	return nil
}

// APIKeyMiddleware validates API keys
func APIKeyMiddleware(req *AuthRequest, validKeys []string) error {
	if req.APIKey == "" {
		return fmt.Errorf("invalid API key")
	}
	for _, key := range validKeys {
		if req.APIKey == key {
			return nil
		}
	}
	return fmt.Errorf("invalid API key")
}

// RateLimiter token bucket rate limiter
type RateLimiter struct {
	mu       sync.Mutex
	requests map[string][]int64
	Limit    int
	WindowMs int64
}

// NewRateLimiter creates new rate limiter
func NewRateLimiter(limit int, windowMs int64) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]int64),
		Limit:    limit,
		WindowMs: windowMs,
	}
}

// Check verifies rate limit
func (r *RateLimiter) Check(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UnixMilli()
	window := r.requests[key]

	// Filter valid timestamps
	valid := make([]int64, 0)
	for _, t := range window {
		if now-t < r.WindowMs {
			valid = append(valid, t)
		}
	}

	if len(valid) >= r.Limit {
		r.requests[key] = valid
		return false
	}

	valid = append(valid, now)
	r.requests[key] = valid
	return true
}

// Reset clears rate limit for a key
func (r *RateLimiter) Reset(key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.requests, key)
}

// LogEntry represents a log entry
type LogEntry struct {
	Timestamp time.Time
	Method    string
	Path      string
	StatusCode int
	Duration  int64
	UserID    string
	Error    string
}

// Logger in-memory logger
type Logger struct {
	mu   sync.Mutex
	logs []LogEntry
}

// Log adds a log entry
func (l *Logger) Log(entry LogEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry.Timestamp = time.Now()
	l.logs = append(l.logs, entry)

	// Keep last 10000 logs
	if len(l.logs) > 10000 {
		l.logs = l.logs[1:]
	}
}

// GetLogs returns filtered logs
func (l *Logger) GetLogs(filters *LogFilter) []LogEntry {
	l.mu.Lock()
	defer l.mu.Unlock()

	result := make([]LogEntry, 0)
	for _, log := range l.logs {
		if filters != nil {
			if filters.Method != "" && log.Method != filters.Method {
				continue
			}
			if filters.Path != "" && !containsString(log.Path, filters.Path) {
				continue
			}
		}
		result = append(result, log)
	}
	return result
}

// LogFilter for filtering logs
type LogFilter struct {
	Method string
	Path   string
}

// Global logger instance
var logger = &Logger{}

// LoggingMiddleware logs requests
func LoggingMiddleware(req *AuthRequest, statusCode int, duration int64) {
	logger.Log(LogEntry{
		Method:    req.Method,
		Path:      req.Path,
		StatusCode: statusCode,
		Duration:  duration,
		UserID:    req.UserID,
	})
}

// Contains checks if string contains substring
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsAny(s, substr))
}

func containsAny(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// CORSHeaders generates CORS headers
func CORSHeaders(origins []string) map[string]string {
	headers := map[string]string{
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
	}
	if len(origins) > 0 {
		headers["Access-Control-Allow-Origin"] = origins[0]
	}
	return headers
}