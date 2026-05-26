package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// AUTH TYPES
// ============================================================================

type UserStatus string

const (
	UserStatusPending   UserStatus = "pending"
	UserStatusActive   UserStatus = "active"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusLocked   UserStatus = "locked"
)

type User struct {
	UserID           string    `json:"userId"`
	Email           string    `json:"email"`
	Username        string    `json:"username"`
	PasswordHash    string    `json:"-"`
	PasswordSalt    string    `json:"-"`
	Status          UserStatus `json:"status"`
	KYCLevel        int       `json:"kycLevel"`
	TwoFactorEnabled bool     `json:"twoFactorEnabled"`
	TwoFactorSecret string    `json:"-"`
	CreatedAt       int64     `json:"createdAt"`
	UpdatedAt       int64     `json:"updatedAt"`
	LastLoginAt     int64     `json:"lastLoginAt"`
	FailedAttempts  int       `json:"failedAttempts"`
	LockedUntil    int64     `json:"lockedUntil"`
}

type Session struct {
	SessionID    string    `json:"sessionId"`
	UserID      string    `json:"userId"`
	Token       string    `json:"token"`
	IPAddress   string    `json:"ipAddress"`
	UserAgent   string    `json:"userAgent"`
	CreatedAt   int64     `json:"createdAt"`
	ExpiresAt   int64     `json:"expiresAt"`
	LastActive  int64     `json:"lastActive"`
	Status      string    `json:"status"`
}

type LoginAttempt struct {
	UserID      string    `json:"userId"`
	IPAddress   string    `json:"ipAddress"`
	Success     bool      `json:"success"`
	Timestamp   int64     `json:"timestamp"`
	FailureReason string   `json:"failureReason,omitempty"`
}

// ============================================================================
// AUTH SERVICE
// ============================================================================

type AuthService struct {
	mu sync.RWMutex

	// User storage
	users      map[string]*User
	emailIndex map[string]string // email -> userID
	usernameIndex map[string]string // username -> userID

	// Sessions
	sessions    map[string]*Session
	userSessions map[string]map[string]*Session // userID -> sessionID -> Session

	// Login attempts
	loginAttempts map[string][]LoginAttempt // userID -> attempts

	// Security config
	MaxFailedAttempts int
	LockoutDuration   int64 // seconds
	SessionDuration    int64 // seconds

	// Metrics
	TotalLogins    int64 `json:"totalLogins"`
	FailedLogins  int64 `json:"failedLogins"`
	ActiveSessions int64 `json:"activeSessions"`
}

func NewAuthService() *AuthService {
	return &AuthService{
		users:          make(map[string]*User),
		emailIndex:    make(map[string]string),
		usernameIndex: make(map[string]string),
		sessions:      make(map[string]*Session),
		userSessions:  make(map[string]map[string]*Session),
		loginAttempts: make(map[string][]LoginAttempt),

		MaxFailedAttempts: 5,
		LockoutDuration:   30 * 60, // 30 minutes
		SessionDuration:   7 * 24 * 60 * 60, // 7 days
	}
}

// Register creates a new user
func (a *AuthService) Register(email, username, password string) (*User, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Check email exists
	if _, exists := a.emailIndex[email]; exists {
		return nil, fmt.Errorf("email already registered")
	}

	// Check username exists
	if _, exists := a.usernameIndex[username]; exists {
		return nil, fmt.Errorf("username already taken")
	}

	// Validate password (in production, use proper validation)
	if len(password) < 8 {
		return nil, fmt.Errorf("password must be at least 8 characters")
	}

	// Generate user ID
	userID := uuid.New().String()

	// Generate salt and hash password
	salt := uuid.New().String()
	// In production: use bcrypt/argon2
	passwordHash := a.hashPassword(password, salt)

	// Create user
	now := time.Now().UnixMilli()
	user := &User{
		UserID:        userID,
		Email:        email,
		Username:     username,
		PasswordHash: passwordHash,
		PasswordSalt: salt,
		Status:       UserStatusPending,
		KYCLevel:     0,
		CreatedAt:    now,
		UpdatedAt:    now,
		FailedAttempts: 0,
	}

	// Store user
	a.users[userID] = user
	a.emailIndex[email] = userID
	a.usernameIndex[username] = userID

	return user, nil
}

// Authenticate verifies credentials and returns session
func (a *AuthService) Authenticate(username, password, ipAddress, userAgent string) (*Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Find user
	userID, exists := a.usernameIndex[username]
	if !exists {
		// Also check email
		userID, exists = a.emailIndex[username]
	}

	if !exists {
		a.recordFailedLogin("", username, ipAddress, "user_not_found")
		atomic.AddInt64(&a.FailedLogins, 1)
		return nil, fmt.Errorf("invalid credentials")
	}

	user, exists := a.users[userID]
	if !exists {
		return nil, fmt.Errorf("user not found")
	}

	// Check if locked
	if user.LockedUntil > time.Now().UnixMilli() {
		return nil, fmt.Errorf("account locked until %d", user.LockedUntil)
	}

	// Verify password
	if !a.verifyPassword(password, user.PasswordHash, user.PasswordSalt) {
		a.recordFailedLogin(userID, username, ipAddress, "invalid_password")
		user.FailedAttempts++

		if user.FailedAttempts >= a.MaxFailedAttempts {
			user.LockedUntil = time.Now().Add(time.Duration(a.LockoutDuration) * time.Second).UnixMilli()
		}

		atomic.AddInt64(&a.FailedLogins, 1)
		return nil, fmt.Errorf("invalid credentials")
	}

	// Check status
	if user.Status == UserStatusSuspended || user.Status == UserStatusLocked {
		return nil, fmt.Errorf("account %s", user.Status)
	}

	// Reset failed attempts
	user.FailedAttempts = 0
	user.LockedUntil = 0

	// Update login time
	user.LastLoginAt = time.Now().UnixMilli()
	user.UpdatedAt = time.Now().UnixMilli()

	// Create session
	session := a.createSession(userID, ipAddress, userAgent)

	atomic.AddInt64(&a.TotalLogins, 1)

	return session, nil
}

// CreateSession creates new session for user
func (a *AuthService) createSession(userID, ipAddress, userAgent string) *Session {
	sessionID := uuid.New().String()
	token := uuid.New().String()
	now := time.Now().UnixMilli()
	expiresAt := now + a.SessionDuration*1000

	session := &Session{
		SessionID:   sessionID,
		UserID:      userID,
		Token:       token,
		IPAddress:  ipAddress,
		UserAgent:   userAgent,
		CreatedAt:   now,
		ExpiresAt:   expiresAt,
		LastActive:  now,
		Status:      "active",
	}

	// Store session
	a.sessions[sessionID] = session

	// Index by user
	if a.userSessions[userID] == nil {
		a.userSessions[userID] = make(map[string]*Session)
	}
	a.userSessions[userID][sessionID] = session

	atomic.AddInt64(&a.ActiveSessions, 1)

	return session
}

// ValidateSession validates session token
func (a *AuthService) ValidateSession(sessionID string) (*Session, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	session, exists := a.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	// Check expiry
	if session.ExpiresAt < time.Now().UnixMilli() {
		session.Status = "expired"
		return nil, fmt.Errorf("session expired")
	}

	// Check status
	if session.Status != "active" {
		return nil, fmt.Errorf("session not active")
	}

	// Update last active
	session.LastActive = time.Now().UnixMilli()

	return session, nil
}

// Logout invalidates session
func (a *AuthService) Logout(sessionID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	session, exists := a.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}

	session.Status = "revoked"

	// Remove from user sessions
	if userSess, ok := a.userSessions[session.UserID]; ok {
		delete(userSess, sessionID)
	}

	atomic.AddInt64(&a.ActiveSessions, -1)

	return nil
}

// GetUserByID returns user by ID
func (a *AuthService) GetUserByID(userID string) (*User, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	user, exists := a.users[userID]
	if !exists {
		return nil, fmt.Errorf("user not found")
	}

	return user, nil
}

// GetUserSessions returns all sessions for user
func (a *AuthService) GetUserSessions(userID string) []*Session {
	a.mu.RLock()
	defer a.mu.RUnlock()

	sessions := make([]*Session, 0)
	if userSess, ok := a.userSessions[userID]; ok {
		for _, session := range userSess {
			sessions = append(sessions, session)
		}
	}

	return sessions
}

// RevokeAllSessions revokes all sessions for user
func (a *AuthService) RevokeAllSessions(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if userSess, ok := a.userSessions[userID]; ok {
		for sessionID := range userSess {
			if session, ok := a.sessions[sessionID]; ok {
				session.Status = "revoked"
			}
			delete(userSess, sessionID)
		}
		atomic.AddInt64(&a.ActiveSessions, -1)
	}

	return nil
}

// ChangePassword changes user password
func (a *AuthService) ChangePassword(userID, oldPassword, newPassword string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	user, exists := a.users[userID]
	if !exists {
		return fmt.Errorf("user not found")
	}

	// Verify old password
	if !a.verifyPassword(oldPassword, user.PasswordHash, user.PasswordSalt) {
		return fmt.Errorf("current password incorrect")
	}

	// Validate new password
	if len(newPassword) < 8 {
		return fmt.Errorf("new password must be at least 8 characters")
	}

	// Hash new password
	salt := uuid.New().String()
	user.PasswordSalt = salt
	user.PasswordHash = a.hashPassword(newPassword, salt)
	user.UpdatedAt = time.Now().UnixMilli()

	// Revoke all sessions
	a.RevokeAllSessions(userID)

	return nil
}

// Enable2FA enables two-factor authentication
func (a *AuthService) Enable2FA(userID, secret string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	user, exists := a.users[userID]
	if !exists {
		return fmt.Errorf("user not found")
	}

	user.TwoFactorSecret = secret
	user.TwoFactorEnabled = true
	user.UpdatedAt = time.Now().UnixMilli()

	return nil
}

// Verify2FA verifies two-factor code
func (a *AuthService) Verify2FA(userID, code string) bool {
	a.mu.RLock()
	defer a.mu.RUnlock()

	user, exists := a.users[userID]
	if !exists || !user.TwoFactorEnabled {
		return false
	}

	// In production: verify against TOTP
	// Simple check: 6 digits
	if len(code) == 6 {
		return true
	}

	return false
}

// Helper functions
func (a *AuthService) hashPassword(password, salt string) string {
	// In production: use bcrypt/argon2
	// Simplified: use SHA256
	data := password + salt
	hash := fmt.Sprintf("%x", sha256(data))
	return hash
}

func (a *AuthService) verifyPassword(password, hash, salt string) bool {
	return a.hashPassword(password, salt) == hash
}

func (a *AuthService) recordFailedLogin(userID, username, ipAddress, reason string) {
	attempt := LoginAttempt{
		UserID:      userID,
		IPAddress:  ipAddress,
		Success:    false,
		Timestamp:   time.Now().UnixMilli(),
		FailureReason: reason,
	}

	a.loginAttempts[username] = append(a.loginAttempts[username], attempt)

	// Keep only last 10 attempts
	if len(a.loginAttempts[username]) > 10 {
		a.loginAttempts[username] = a.loginAttempts[username][-10:]
	}
}

func sha256(data string) []byte {
	h := sha256New()
	h.Write([]byte(data))
	return h.Sum(nil)
}

func sha256New() interface{ Write([]byte) (int, error); Sum([]byte) []byte } {
	type sha256 struct{}
	// Simplified - in production use crypto/sha256
	return &struct{ Write func([]byte) (int, error) }{Write: func(b []byte) (int, error) { return len(b), nil }}
}

// GetMetrics returns auth metrics
func (a *AuthService) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"totalUsers":      len(a.users),
		"totalSessions":   len(a.sessions),
		"activeSessions":  atomic.LoadInt64(&a.ActiveSessions),
		"totalLogins":    atomic.LoadInt64(&a.TotalLogins),
		"failedLogins":   atomic.LoadInt64(&a.FailedLogins),
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Auth Service (Go)")
	fmt.Println("==========================\n")

	auth := NewAuthService()

	// Register user
	user, err := auth.Register("user@example.com", "trader1", "SecurePass123!")
	if err != nil {
		log.Printf("Registration error: %v", err)
	} else {
		fmt.Printf("Registered: %s (%s)\n", user.Username, user.UserID[:8])
	}

	// Login
	session, err := auth.Authenticate("trader1", "SecurePass123!", "192.168.1.1", "Mozilla/5.0")
	if err != nil {
		fmt.Printf("Login error: %v\n", err)
	} else {
		fmt.Printf("Logged in: session=%s token=%s\n", session.SessionID[:8], session.Token[:16])
	}

	// Validate session
	validSession, err := auth.ValidateSession(session.SessionID)
	if err != nil {
		fmt.Printf("Validation error: %v\n", err)
	} else {
		fmt.Printf("Valid session for user: %s\n", validSession.UserID[:8])
	}

	// Change password
	err = auth.ChangePassword(user.UserID, "SecurePass123!", "NewPass456!")
	if err != nil {
		fmt.Printf("Password change error: %v\n", err)
	} else {
		fmt.Println("Password changed successfully")
	}

	// Get metrics
	metrics := auth.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nAuth Service ready.")
}