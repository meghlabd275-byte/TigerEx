// Rate Limiter - Real-Time Path in Go
// Sliding window rate limiting

package limiter

import (
	"fmt"
	"sync"
	"time"
)

// Sliding window limiter
type SlidingWindow struct {
	requests []time.Time
	window   time.Duration
	maxReq   int
	mu       sync.Mutex
}

// NewSlidingWindow creates new limiter
func NewSlidingWindow(maxReq int, window time.Duration) *SlidingWindow {
	return &SlidingWindow{
		requests: make([]time.Time, 0, maxReq),
		window:   window,
		maxReq:   maxReq,
	}
}

// Allow check if request allowed
func (s *SlidingWindow) Allow() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	now := time.Now()
	cutoff := now.Add(-s.window)
	
	// Remove old
	valid := make([]time.Time, 0)
	for _, t := range s.requests {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	s.requests = valid
	
	// Check
	if len(s.requests) >= s.maxReq {
		return false
	}
	
	s.requests = append(s.requests, now)
	return true
}

// Reset clears the limiter
func (s *SlidingWindow) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = s.requests[:0]
}

// RateLimiter main type
type RateLimiter struct {
	global     *SlidingWindow
	endpoints  map[string]*SlidingWindow
	ipLimits   map[string]*IPLimit
	userLimits map[string]*UserLimit
	mu         sync.RWMutex
}

type IPLimit struct {
	limiter   *SlidingWindow
	blocked   bool
	blockedAt time.Time
}

type UserLimit struct {
	limiter *SlidingWindow
	tier    string
}

// NewRateLimiter creates new rate limiter
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		global:     NewSlidingWindow(10000, time.Second), // 10K/sec global
		endpoints:  make(map[string]*SlidingWindow),
		ipLimits:   make(map[string]*IPLimit),
		userLimits: make(map[string]*UserLimit),
	}
}

// Allow checks rate limits
func (r *RateLimiter) Allow(endpoint, ip, userID string) (bool, string) {
	// Global
	if !r.global.Allow() {
		return false, "global_rate_limit"
	}
	
	// Endpoint
	r.mu.RLock()
	if lim, ok := r.endpoints[endpoint]; ok {
		r.mu.RUnlock()
		if !lim.Allow() {
			return false, fmt.Sprintf("endpoint:%s", endpoint)
		}
	} else {
		r.mu.RUnlock()
	}
	
	// IP
	if ip != "" {
		if !r.allowIP(ip) {
			return false, "ip_rate_limit"
		}
	}
	
	// User
	if userID != "" {
		if !r.allowUser(userID) {
			return false, "user_rate_limit"
		}
	}
	
	return true, ""
}

func (r *RateLimiter) allowIP(ip string) bool {
	r.mu.RLock()
	lim, ok := r.ipLimits[ip]
	r.mu.RUnlock()
	
	if !ok {
		r.mu.Lock()
		r.ipLimits[ip] = &IPLimit{
			limiter: NewSlidingWindow(100, time.Second),
		}
		r.mu.Unlock()
		lim = r.ipLimits[ip]
	}
	
	// Check blocked
	if lim.blocked && time.Since(lim.blockedAt) < 5*time.Minute {
		return false
	}
	
	return lim.limiter.Allow()
}

func (r *RateLimiter) allowUser(userID string) bool {
	r.mu.RLock()
	lim, ok := r.userLimits[userID]
	r.mu.RUnlock()
	
	if !ok {
		r.mu.Lock()
		r.userLimits[userID] = &UserLimit{
			limiter: NewSlidingWindow(1000, time.Second),
		}
		r.mu.Unlock()
		lim = r.userLimits[userID]
	}
	
	return lim.limiter.Allow()
}

// SetEndpointLimit sets endpoint-specific limit
func (r *RateLimiter) SetEndpointLimit(endpoint string, requests int, window time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.endpoints[endpoint] = NewSlidingWindow(requests, window)
}