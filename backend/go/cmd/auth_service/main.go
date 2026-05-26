// Package auth_service provides authentication services.
// Migrated from TypeScript to Go for secure authentication.
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// User account
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"passwordHash"`
	Salt         string    `json:"salt"`
	KYCLevel     int       `json:"kycLevel"`
	Status       string    `json:"status"` // active, suspended, frozen
	CreatedAt    int64     `json:"createdAt"`
	UpdatedAt    int64     `json:"updatedAt"`
	LastLogin    int64     `json:"lastLogin"`
}

// JWT claims
type Claims struct {
	UserID   string `json:"userId"`
	Email   string `json:"email"`
	Session string `json:"session"`
	Iat     int64  `json:"iat"`
	Exp     int64  `json:"exp"`
}

// Two-factor authentication
type TwoFactor struct {
	Enabled   bool   `json:"enabled"`
	Type      string `json:"type"` // totp, sms, email
	Secret    string `json:"secret,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Verified  bool   `json:"verified"`
}

// Session
type Session struct {
	ID        string `json:"id"`
	UserID   string `json:"userId"`
	Token    string `json:"token"`
	IPAddress string `json:"ipAddress"`
	UserAgent string `json:"userAgent"`
	ExpiresAt int64  `json:"expiresAt"`
	CreatedAt int64  `json:"createdAt"`
}

// Login attempt record
type LoginAttempt struct {
	UserID   string `json:"userId"`
	IP      string `json:"ip"`
	Success bool   `json:"success"`
	Time    int64  `json:"time"`
}

// Password requirements
type PasswordPolicy struct {
	MinLength     int
	RequireUpper  bool
	RequireLower bool
	RequireDigit bool
	RequireSpecial bool
}

var (
	// In production, these would be in config
	jwtSecret = []byte("tigerex-jwt-secret-change-in-production")
	
	// Rate limiting
	maxLoginAttempts = 5
	lockoutDuration = 15 * 60 * 1000 // 15 minutes
	
	// Password policy
	passwordPolicy = PasswordPolicy{
		MinLength:     8,
		RequireUpper: true,
		RequireLower: true,
		RequireDigit: true,
		RequireSpecial: false,
	}
)

// User store
type AuthStore struct {
	mu          sync.RWMutex
	users       map[string]*User
	sessions    map[string]*Session
	twoFactors  map[string]*TwoFactor
	loginAttempts map[string][]LoginAttempt
}

var (
	store = &AuthStore{
		users:       make(map[string]*User),
		sessions:    make(map[string]*Session),
		twoFactors: make(map[string]*TwoFactor),
		loginAttempts: make(map[string][]LoginAttempt),
	}
)

// Generate salt
func generateSalt(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)[:length]
}

// Hash password with salt
func hashPassword(password, salt string) string {
	data := []byte(password + salt)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// Validate password against policy
func ValidatePassword(password string) error {
	if len(password) < passwordPolicy.MinLength {
		return errors.New("password too short")
	}
	
	hasUpper := false
	hasLower := false
	hasDigit := false
	
	for _, c := range password {
		switch {
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= '0' && c <= '9':
			hasDigit = true
		}
	}
	
	if passwordPolicy.RequireUpper && !hasUpper {
		return errors.New("password must contain uppercase")
	}
	if passwordPolicy.RequireLower && !hasLower {
		return errors.New("password must contain lowercase")
	}
	if passwordPolicy.RequireDigit && !hasDigit {
		return errors.New("password must contain digit")
	}
	
	return nil
}

// Register user
func Register(email, username, password string) (*User, error) {
	// Validate password
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	
	store.mu.Lock()
	defer store.mu.Unlock()
	
	// Check email exists
	for _, u := range store.users {
		if u.Email == email {
			return nil, errors.New("email already registered")
		}
	}
	
	// Check username
	for _, u := range store.users {
		if u.Username == username {
			return nil, errors.New("username taken")
		}
	}
	
	salt := generateSalt(32)
	hash := hashPassword(password, salt)
	
	user := &User{
		ID:        fmt.Sprintf("usr_%d", time.Now().UnixNano()),
		Email:     email,
		Username:  username,
		PasswordHash: hash,
		Salt:      salt,
		KYCLevel:  0,
		Status:   "active",
		CreatedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}
	
	store.users[user.ID] = user
	return user, nil
}

// Login user
func Login(emailOrUsername, password, ip, userAgent string) (*Session, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	
	// Find user
	var user *User
	for _, u := range store.users {
		if u.Email == emailOrUsername || u.Username == emailOrUsername {
			user = u
			break
		}
	}
	
	if user == nil {
		recordAttempt("", ip, false, "user not found")
		return nil, errors.New("invalid credentials")
	}
	
	// Check status
	if user.Status != "active" {
		recordAttempt(user.ID, ip, false, "account "+user.Status)
		return nil, errors.New("account " + user.Status)
	}
	
	// Check lockout
	if isLockedOut(user.ID) {
		recordAttempt(user.ID, ip, false, "locked out")
		return nil, errors.New("account temporarily locked")
	}
	
	// Verify password
	hash := hashPassword(password, user.Salt)
	if hash != user.PasswordHash {
		recordAttempt(user.ID, ip, false, "wrong password")
		return nil, errors.New("invalid credentials")
	}
	
	// Generate session
	session := &Session{
		ID:        fmt.Sprintf("ses_%d", time.Now().UnixNano()),
		UserID:    user.ID,
		Token:    generateToken(64),
		IPAddress: ip,
		UserAgent: userAgent,
		ExpiresAt: time.Now().UnixMilli() + (7 * 24 * 60 * 60 * 1000), // 7 days
		CreatedAt: time.Now().UnixMilli(),
	}
	
	store.sessions[session.Token] = session
	
	// Update last login
	user.LastLogin = time.Now().UnixMilli()
	recordAttempt(user.ID, ip, true, "")
	
	return session, nil
}

// Generate random token
func generateToken(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)[:length]
}

// Record login attempt
func recordAttempt(userID, ip string, success bool, reason string) {
	attempt := LoginAttempt{
		UserID: userID,
		IP: ip,
		Success: success,
		Time: time.Now().UnixMilli(),
	}
	
	store.loginAttempts[ip] = append(store.loginAttempts[ip], attempt)
	
	// Keep only last 100
	if len(store.loginAttempts[ip]) > 100 {
		store.loginAttempts[ip] = store.loginAttempts[ip][-100:]
	}
}

// Check if IP is locked out
func isLockedOut(ip string) bool {
	recent := store.loginAttempts[ip]
	if len(recent) < maxLoginAttempts {
		return false
	}
	
	failedCount := 0
	windowStart := time.Now().UnixMilli() - lockoutDuration
	
	for _, a := range recent {
		if !a.Success && a.Time > windowStart {
			failedCount++
		}
	}
	
	return failedCount >= maxLoginAttempts
}

// Enable 2FA
func Enable2FA(userID, twoFactorType, secret string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	
	user, ok := store.users[userID]
	if !ok {
		return errors.New("user not found")
	}
	
	twoFactor := &TwoFactor{
		Enabled:  false, // Requires verification
		Type:    twoFactorType,
		Secret:  secret,
		Verified: false,
	}
	
	store.twoFactors[userID] = twoFactor
	return nil
}

// Verify 2FA
func Verify2FA(userID, code string) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	
	twoFactor, ok := store.twoFactors[userID]
	if !ok || !twoFactor.Enabled {
		return false, errors.New("2FA not enabled")
	}
	
	// Simplified verification (real impl would use TOTP)
	if len(code) != 6 {
		return false, errors.New("invalid code")
	}
	
	twoFactor.Verified = true
	return true, nil
}

// Validate session
func ValidateSession(token string) (*Session, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	
	session, ok := store.sessions[token]
	if !ok {
		return nil, errors.New("invalid session")
	}
	
	if session.ExpiresAt < time.Now().UnixMilli() {
		return nil, errors.New("session expired")
	}
	
	return session, nil
}

// Logout
func Logout(token string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	
	delete(store.sessions, token)
	return nil
}

// Get user
func GetUser(userID string) (*User, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	
	user, ok := store.users[userID]
	if !ok {
		return nil, errors.New("user not found")
	}
	
	return user, nil
}

func main() {
	fmt.Println("Auth service initialized")
	
	// Demo registration
	user, err := Register("demo@example.com", "demouser", "SecurePass123")
	if err != nil {
		fmt.Printf("Registration error: %v\n", err)
	} else {
		fmt.Printf("Registered user: %s\n", user.Username)
	}
	
	// Demo login
	session, err := Login("demo@example.com", "SecurePass123", "127.0.0.1", "DemoAgent")
	if err != nil {
		fmt.Printf("Login error: %v\n", err)
	} else {
		fmt.Printf("Logged in, session: %s\n", session.Token[:16]+"...")
	}
}