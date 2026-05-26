package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// User represents a user account
type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Phone     string `json:"phone,omitempty"`
	KYCLevel  int    `json:"kycLevel"`
	Level    int    `json:"level"`
	CanTrade  bool   `json:"canTrade"`
	CanWithdraw bool `json:"canWithdraw"`
	CanDeposit  bool `json:"canDeposit"`
	Created   int64  `json:"created"`
}

// Auth result
type AuthResult struct {
	Success     bool   `json:"success"`
	Token       string `json:"token,omitempty"`
	RefreshToken string `json:"refreshToken,omitempty"`
	User        *User  `json:"user,omitempty"`
	Message     string `json:"message,omitempty"`
}

// KYC status
type KYCStatus struct {
	Level      int    `json:"level"`
	Status     string `json:"status"`
	VerifiedAt int64  `json:"verifiedAt,omitempty"`
}

// Session info
type Session struct {
	UserID    string
	Token     string
	ExpiresAt time.Time
}

// User authentication service
type UserAuth struct {
	users    map[string]*User
	sessions map[string]*Session
}

// NewUserAuth creates new auth service
func NewUserAuth() *UserAuth {
	auth := &UserAuth{
		users:    make(map[string]*User),
		sessions: make(map[string]*Session),
	}
	
	// Create demo user
	auth.users["demo@example.com"] = &User{
		ID:          "user_demo",
		Email:       "demo@example.com",
		KYCLevel:    2,
		Level:      2,
		CanTrade:   true,
		CanWithdraw: true,
		CanDeposit: true,
		Created:   time.Now().UnixMilli(),
	}
	
	return auth
}

// Generate token
func (a *UserAuth) generateToken() string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	return hex.EncodeToString(hash[:])
}

// Register new user
func (a *UserAuth) Register(email, password, referralCode string) AuthResult {
	// Check if email exists
	if _, exists := a.users[email]; exists {
		return AuthResult{
			Success: false,
			Message: "Email already registered",
		}
	}
	
	user := &User{
		ID:        fmt.Sprintf("user_%d", time.Now().UnixMilli()),
		Email:     email,
		KYCLevel:  0,
		Level:    1,
		CanTrade: true,
		CanWithdraw: false,
		CanDeposit: false,
		Created: time.Now().UnixMilli(),
	}
	
	a.users[email] = user
	
	token := a.generateToken()
	refreshToken := a.generateToken()
	
	// Create session
	a.sessions[token] = &Session{
		UserID: user.ID,
		Token: token,
		ExpiresAt: time.Now().Add(time.Hour * 24 * 7),
	}
	
	return AuthResult{
		Success: true,
		Token: token,
		RefreshToken: refreshToken,
		User: user,
		Message: "Registration successful",
	}
}

// Login
func (a *UserAuth) Login(email, password string) AuthResult {
	user, exists := a.users[email]
	if !exists {
		return AuthResult{
			Success: false,
			Message: "Invalid credentials",
		}
	}
	
	token := a.generateToken()
	refreshToken := a.generateToken()
	
	// Create session
	a.sessions[token] = &Session{
		UserID: user.ID,
		Token: token,
		ExpiresAt: time.Now().Add(time.Hour * 24 * 7),
	}
	
	return AuthResult{
		Success: true,
		Token: token,
		RefreshToken: refreshToken,
		User: user,
		Message: "Login successful",
	}
}

// Logout
func (a *UserAuth) Logout(token string) bool {
	session, exists := a.sessions[token]
	if !exists {
		return false
	}
	
	delete(a.sessions, token)
	_ = session.UserID
	return true
}

// Verify token
func (a *UserAuth) VerifyToken(token string) (*User, bool) {
	session, exists := a.sessions[token]
	if !exists {
		return nil, false
	}
	
	// Check expiration
	if time.Now().After(session.ExpiresAt) {
		delete(a.sessions, token)
		return nil, false
	}
	
	// Find user by ID
	for _, user := range a.users {
		if user.ID == session.UserID {
			return user, true
		}
	}
	
	return nil, false
}

// Get user by email
func (a *UserAuth) GetUser(email string) (*User, bool) {
	user, exists := a.users[email]
	return user, exists
}

// Get user by ID
func (a *UserAuth) GetUserByID(id string) *User {
	for _, user := range a.users {
		if user.ID == id {
			return user
		}
	}
	return nil
}

// Update KYC level
func (a *UserAuth) UpdateKYCLevel(email string, level int) bool {
	user, exists := a.users[email]
	if !exists {
		return false
	}
	
	user.KYCLevel = level
	
	// Update permissions based on level
	switch level {
	case 0:
		user.CanWithdraw = false
		user.CanDeposit = false
	case 1:
		user.CanWithdraw = true
		user.CanDeposit = true
	case 2:
		user.CanWithdraw = true
		user.CanDeposit = true
	default:
		user.CanWithdraw = true
		user.CanDeposit = true
	}
	
	return true
}

// Refresh token
func (a *UserAuth) RefreshToken(refreshToken string) AuthResult {
	// In real implementation, verify refresh token
	// For now, generate new tokens
	newToken := a.generateToken()
	newRefreshToken := a.generateToken()
	
	// Create new session
	a.sessions[newToken] = &Session{
		Token: newToken,
		ExpiresAt: time.Now().Add(time.Hour * 24 * 7),
	}
	
	return AuthResult{
		Success: true,
		Token: newToken,
		RefreshToken: newRefreshToken,
	}
}

// Enable 2FA
func (a *UserAuth) Enable2FA(email string) (string, bool) {
	user, exists := a.users[email]
	if !exists {
		return "", false
	}
	
	secret := a.generateToken()
	_ = secret // In real impl, store and return QR code
	
	return secret, true
}

// Verify 2FA
func (a *UserAuth) Verify2FA(email, code string) bool {
	// In real impl, verify TOTP code
	_ = email
	_ = code
	return true
}

func main() {
	auth := NewUserAuth()
	
	// Test registration
	result := auth.Register("newuser@example.com", "password123", "")
	fmt.Printf("Register: %+v\n", result)
	
	// Test login
	loginResult := auth.Login("demo@example.com", "password")
	fmt.Printf("Login: %+v\n", loginResult)
	
	// Test token verification
	if loginResult.Success {
		user, valid := auth.VerifyToken(loginResult.Token)
		fmt.Printf("Verify Token: valid=%v, user=%+v\n", valid, user)
	}
	
	// Update KYC
	auth.UpdateKYCLevel("demo@example.com", 2)
	user, _ := auth.GetUser("demo@example.com")
	fmt.Printf("Updated KYC: %+v\n", user)
}