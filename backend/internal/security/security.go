package security

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type SecurityLayer struct {
	config    SecurityConfig
	crypto   CryptoManager
	rateLimiter *RateLimiter
	ipWhitelist *IPWhitelist
	csrfTokens *CSRFTokenManager
	mu        sync.RWMutex
	loginAttempts map[string]*LoginAttemptTracker
	failedLogins map[string]int
	lockedAccounts map[string]time.Time
}

type SecurityConfig struct {
	Enable2FA           bool
	MaxLoginAttempts    int
	LockoutDuration    time.Duration
	PasswordMinLength  int
	SessionTimeout     time.Duration
	EnableIPWhitelist  bool
	EnableAntiPhishing bool
	CSRFEnabled        bool
	RateLimitEnabled   bool
	RateLimitBurst    int
	RateLimitRefill    int
}

type CryptoManager interface {
	HashPasswordArgon2(password string) (string, error)
	VerifyPasswordArgon2(password, encoded string) (bool, error)
	HashSHA256(data []byte) []byte
}

type RateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	rate     rate.Limit
	burst    int
}

type IPWhitelist struct {
	allowedIPs map[string]bool
	mu        sync.RWMutex
}

type CSRFTokenManager struct {
	tokens map[string]*csrfToken
	mu     sync.RWMutex
}

type csrfToken struct {
	token     string
	expires   time.Time
	used      bool
}

type LoginAttemptTracker struct {
	attempts  int
	firstAttempt time.Time
	locked    bool
}

func NewSecurityLayer(config SecurityConfig, crypto CryptoManager) *SecurityLayer {
	return &SecurityLayer{
		config:       config,
		crypto:      crypto,
		rateLimiter:  NewRateLimiter(100, 200),
		ipWhitelist:  NewIPWhitelist(),
		csrfTokens:   NewCSRFTokenManager(),
		loginAttempts: make(map[string]*LoginAttemptTracker),
		failedLogins: make(map[string]int),
		lockedAccounts: make(map[string]time.Time),
	}
}

func NewRateLimiter(rate int, burst int) *RateLimiter {
	return &RateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rate:     rate,
		burst:    burst,
	}
}

func (r *RateLimiter) Allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	limiter, exists := r.limiters[key]
	if !exists {
		limiter = rate.NewLimiter(rate.Limit(r.rate), r.burst)
		r.limiters[key] = limiter
	}

	return limiter.Allow()
}

func NewIPWhitelist() *IPWhitelist {
	return &IPWhitelist{
		allowedIPs: make(map[string]bool),
	}
}

func (i *IPWhitelist) Add(ip string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.allowedIPs[ip] = true
}

func (i *IPWhitelist) Remove(ip string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	delete(i.allowedIPs, ip)
}

func (i *IPWhitelist) IsAllowed(ip string) bool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.allowedIPs[ip]
}

func NewCSRFTokenManager() *CSRFTokenManager {
	return &CSRFTokenManager{
		tokens: make(map[string]*csrfToken),
	}
}

func (c *CSRFTokenManager) Generate(sessionID string) string {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Generate random token
	randomBytes := make([]byte, 32)
	// In production, use crypto/rand
	for i := range randomBytes {
		randomBytes[i] = byte(i * 17 % 256)
	}
	token := hex.EncodeToString(randomBytes)

	c.tokens[sessionID] = &csrfToken{
		token:   token,
		expires: time.Now().Add(24 * time.Hour),
		used:   false,
	}

	return token
}

func (c *CSRFTokenManager) Validate(sessionID, token string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	csrfToken, exists := c.tokens[sessionID]
	if !exists || csrfToken.used || time.Now().After(csrfToken.expires) {
		return false
	}

	if csrfToken.token != token {
		return false
	}

	csrfToken.used = true
	return true
}

// Rate limiting middleware
func (s *SecurityLayer) RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.config.RateLimitEnabled {
			next.ServeHTTP(w, r)
			return
		}

		clientIP := s.getClientIP(r)
		if !s.rateLimiter.Allow(clientIP) {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// IP whitelist middleware
func (s *SecurityLayer) IPWhitelist(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.config.EnableIPWhitelist {
			next.ServeHTTP(w, r)
			return
		}

		clientIP := s.getClientIP(r)
		if !s.ipWhitelist.IsAllowed(clientIP) {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// CSRF protection middleware
func (s *SecurityLayer) CSRFProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.config.CSRFEnabled {
			next.ServeHTTP(w, r)
			return
		}

		if r.Method == "GET" {
			// Generate CSRF token for session
			sessionID := s.getSessionID(r)
			token := s.csrfTokens.Generate(sessionID)
			http.SetCookie(w, &http.Cookie{
				Name:     "csrf_token",
				Value:    token,
				HttpOnly: true,
				Secure:   true,
				SameSite: http.SameSiteStrictMode,
			})
			next.ServeHTTP(w, r)
			return
		}

		// Validate CSRF token for state-changing requests
		cookie, err := r.Cookie("csrf_token")
		if err != nil {
			http.Error(w, "CSRF token missing", http.StatusForbidden)
			return
		}

		sessionID := s.getSessionID(r)
		if !s.csrfTokens.Validate(sessionID, cookie.Value) {
			http.Error(w, "CSRF token invalid", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Account lockout after failed attempts
func (s *SecurityLayer) HandleFailedLogin(username, ip string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.failedLogins[username]++

	if s.failedLogins[username] >= s.config.MaxLoginAttempts {
		s.lockedAccounts[username] = time.Now().Add(s.config.LockoutDuration)
		log.Printf("Account locked for %s due to %d failed login attempts", username, s.failedLogins[username])
		return fmt.Errorf("account locked for %v", s.config.LockoutDuration)
	}

	return nil
}

func (s *SecurityLayer) IsAccountLocked(username string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if lockedUntil, exists := s.lockedAccounts[username]; exists {
		if time.Now().Before(lockedUntil) {
			return true
		}
		// Unlock account
		delete(s.lockedAccounts, username)
	}

	return false
}

func (s *SecurityLayer) ResetFailedLogins(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.failedLogins, username)
}

func (s *SecurityLayer) getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		ip := net.ParseIP(xff)
		if ip != nil {
			return ip.String()
		}
	}

	// Check X-Real-IP header
	xri := r.Header.Get("X-Real-IP")
	if xri != "" {
		ip := net.ParseIP(xri)
		if ip != nil {
			return ip.String()
		}
	}

	// Fallback to RemoteAddr
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func (s *SecurityLayer) getSessionID(r *http.Request) string {
	cookie, err := r.Cookie("session_id")
	if err != nil {
		return ""
	}
	return cookie.Value
}

// Password validation
func (s *SecurityLayer) ValidatePassword(password string) error {
	if len(password) < s.config.PasswordMinLength {
		return fmt.Errorf("password must be at least %d characters", s.config.PasswordMinLength)
	}
	return nil
}

// Hash password for storage
func (s *SecurityLayer) HashPassword(password string) (string, error) {
	return s.crypto.HashPasswordArgon2(password)
}

// Verify password
func (s *SecurityLayer) VerifyPassword(password, hash string) (bool, error) {
	return s.crypto.VerifyPasswordArgon2(password, hash)
}

// Anti-phishing code
func (s *SecurityLayer) GenerateAntiPhishingCode(userID string) string {
	data := []byte(userID + time.Now().Format("2006-01-02"))
	hash := s.crypto.HashSHA256(data)
	return hex.EncodeToString(hash[:8])
}

// Secure headers middleware
func (s *SecurityLayer) SecureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// HSTS
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		
		// X-Frame-Options
		w.Header().Set("X-Frame-Options", "DENY")
		
		// X-Content-Type-Options
		w.Header().Set("X-Content-Type-Options", "nosniff")
		
		// X-XSS-Protection
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		
		// Content-Security-Policy
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';")
		
		// Referrer-Policy
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		
		// Permissions-Policy
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

		next.ServeHTTP(w, r)
	})
}

// Context with security info
type SecurityContext struct {
	UserID       string
	SessionID    string
	IPAddress    string
	AntiPhishing string
	IsVerified   bool
	2FAEnabled   bool
}

func (s *SecurityLayer) GetSecurityContext(r *http.Request) *SecurityContext {
	return &SecurityContext{
		UserID:     r.Header.Get("X-User-ID"),
		SessionID:  s.getSessionID(r),
		IPAddress:  s.getClientIP(r),
		IsVerified: true,
	}
}

func (s *SecurityLayer) Shutdown() {
	log.Println("Security layer shutdown complete")
}

// Rate limiter for API
func (s *SecurityLayer) CheckRateLimit(ctx context.Context, key string) error {
	if !s.config.RateLimitEnabled {
		return nil
	}

	if !s.rateLimiter.Allow(key) {
		return fmt.Errorf("rate limit exceeded")
	}

	return nil
}
