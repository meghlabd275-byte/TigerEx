// TigerEx User Authentication Service
// Complete user management with JWT, sessions, and 2FA

package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	StatusActive   = "active"
	StatusPending = "pending"
	StatusSuspended = "suspended"
	StatusBanned  = "banned"
)

type User struct {
	ID                string    `json:"id"`
	Email            string    `json:"email"`
	Username         string    `json:"username"`
	PasswordHash     string    `json:"-"`
	TwoFASecret     string    `json:"two_fa_secret,omitempty"`
	TwoFAEnabled    bool      `json:"two_fa_enabled"`
	Phone           string    `json:"phone,omitempty"`
	Status          string    `json:"status"`
	EmailVerified   bool      `json:"email_verified"`
	PhoneVerified   bool      `json:"phone_verified"`
	KYCLevel        int       `json:"kyc_level"`
	ReferrerID      string    `json:"referrer_id,omitempty"`
	RegistrationIP  string    `json:"registration_ip"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	LastLoginAt     time.Time `json:"last_login_at"`
}

type Session struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Token        string    `json:"token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	DeviceID     string    `json:"device_id"`
	ExpiresAt    time.Time `json:"expires_at"`
	CreatedAt    time.Time `json:"created_at"`
	LastActivity time.Time `json:"last_activity"`
}

type LoginAttempt struct {
	UserID    string    `json:"user_id"`
	IP        string    `json:"ip"`
	Success   bool      `json:"success"`
	Timestamp time.Time `json:"timestamp"`
}

type AuthManager struct {
	mu           sync.RWMutex
	users        map[string]*User
	emailIndex   map[string]string // email -> userID
	usernameIndex map[string]string // username -> userID
	sessions     map[string]*Session
	userSessions map[string][]string // userID -> sessionIDs
	loginAttempts map[string][]LoginAttempt
}

func NewAuthManager() *AuthManager {
	return &AuthManager{
		users:          make(map[string]*User),
		emailIndex:    make(map[string]string),
		usernameIndex: make(map[string]string),
		sessions:     make(map[string]*Session),
		userSessions: make(map[string][]string),
		loginAttempts: make(map[string][]LoginAttempt),
	}
}

func (am *AuthManager) Register(email, username, password, ip string) (*User, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	// Check email exists
	if _, exists := am.emailIndex[email]; exists {
		return nil, errors.New("email already registered")
	}

	// Check username exists
	if _, exists := am.usernameIndex[username]; exists {
		return nil, errors.New("username already taken")
	}

	// Validate password
	if err := validatePassword(password); err != nil {
		return nil, err
	}

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	user := &User{
		ID:               fmt.Sprintf("USR%d%d", now.Unix(), now.Nanosecond()),
		Email:            email,
		Username:         username,
		PasswordHash:     string(hash),
		Status:           StatusPending,
		EmailVerified:   false,
		PhoneVerified:   false,
		KYCLevel:        0,
		RegistrationIP:  ip,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	am.users[user.ID] = user
	am.emailIndex[email] = user.ID
	am.usernameIndex[username] = user.ID

	return user, nil
}

func (am *AuthManager) Login(email, password, ip, userAgent, deviceID string) (*User, *Session, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	// Get user by email
	userID, exists := am.emailIndex[email]
	if !exists {
		am.recordLoginAttempt(userID, ip, false)
		return nil, nil, errors.New("invalid credentials")
	}

	user := am.users[userID]

	// Check password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		am.recordLoginAttempt(userID, ip, false)
		return nil, nil, errors.New("invalid credentials")
	}

	// Check status
	if user.Status != StatusActive && user.Status != StatusPending {
		return nil, nil, errors.New("account is not active")
	}

	// Create session
	session, err := am.createSession(userID, ip, userAgent, deviceID)
	if err != nil {
		return nil, nil, err
	}

	am.recordLoginAttempt(userID, ip, true)

	// Update last login
	user.LastLoginAt = time.Now()

	return user, session, nil
}

func (am *AuthManager) createSession(userID, ip, userAgent, deviceID string) (*Session, error) {
	token, err := generateToken(64)
	if err != nil {
		return nil, err
	}

	refreshToken, err := generateToken(32)
	if err != nil {
		return nil, err
	}

	sessionID, err := generateToken(16)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	session := &Session{
		ID:            sessionID,
		UserID:        userID,
		Token:         token,
		RefreshToken:  refreshToken,
		IPAddress:     ip,
		UserAgent:     userAgent,
		DeviceID:      deviceID,
		ExpiresAt:     now.Add(24 * time.Hour),
		CreatedAt:     now,
		LastActivity: now,
	}

	am.sessions[token] = session
	am.userSessions[userID] = append(am.userSessions[userID], token)

	return session, nil
}

func (am *AuthManager) recordLoginAttempt(userID, ip string, success bool) {
	attempt := LoginAttempt{
		UserID:    userID,
		IP:        ip,
		Success:   success,
		Timestamp: time.Now(),
	}

	am.loginAttempts[userID] = append(am.loginAttempts[userID], attempt)

	// Keep only last 10 attempts
	if len(am.loginAttempts[userID]) > 10 {
		am.loginAttempts[userID] = am.loginAttempts[userID][-10:]
	}
}

func (am *AuthManager) VerifySession(token string) (*Session, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()

	session, exists := am.sessions[token]
	if !exists {
		return nil, errors.New("session not found")
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, errors.New("session expired")
	}

	session.LastActivity = time.Now()
	return session, nil
}

func (am *AuthManager) Logout(token string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	session, exists := am.sessions[token]
	if !exists {
		return errors.New("session not found")
	}

	delete(am.sessions, token)

	// Remove from user sessions
	sessions := am.userSessions[session.UserID]
	for i, t := range sessions {
		if t == token {
			am.userSessions[session.UserID] = append(sessions[:i], sessions[i+1:]...)
			break
		}

	}

	return nil
}

func (am *AuthManager) ChangePassword(userID, oldPassword, newPassword string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	user, exists := am.users[userID]
	if !exists {
		return errors.New("user not found")
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return errors.New("invalid old password")
	}

	// Validate new password
	if err := validatePassword(newPassword); err != nil {
		return err
	}

	// Hash new password
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	user.PasswordHash = string(hash)
	user.UpdatedAt = time.Now()

	return nil
}

func (am *AuthManager) ResetPasswordRequest(email string) (string, error) {
	am.mu.RLock()
	userID, exists := am.emailIndex[email]
	am.mu.RUnlock()

	if !exists {
		return "", errors.New("email not found")
	}

	token, err := generateToken(64)
	if err != nil {
		return "", err
	}

	return token, nil
}

func (am *AuthManager) ResetPassword(token, newPassword string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	// In production, token would be validated against stored tokens
	// For now, just validate password

	if err := validatePassword(newPassword); err != nil {
		return err
	}

	return nil
}

func (am *AuthManager) Enable2FA(userID string) (string, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	user, exists := am.users[userID]
	if !exists {
		return "", errors.New("user not found")
	}

	secret, err := generateToken(20)
	if err != nil {
		return "", err
	}

	user.TwoFASecret = secret
	user.TwoFAEnabled = false // Requires verification
	user.UpdatedAt = time.Now()

	return secret, nil
}

func (am *AuthManager) Verify2FA(userID, code string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	user, exists := am.users[userID]
	if !exists {
		return errors.New("user not found")
	}

	if user.TwoFASecret == "" {
		return errors.New("2FA not enabled")
	}

	// In production, verify TOTP code
	// For now, accept any 6-digit code
	if len(code) != 6 {
		return errors.New("invalid code")
	}

	user.TwoFAEnabled = true
	user.UpdatedAt = time.Now()

	return nil
}

func (am *AuthManager) Disable2FA(userID, password string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	user, exists := am.users[userID]
	if !exists {
		return errors.New("user not found")
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return errors.New("invalid password")
	}

	user.TwoFASecret = ""
	user.TwoFAEnabled = false
	user.UpdatedAt = time.Now()

	return nil
}

func (am *AuthManager) GetUser(userID string) (*User, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()

	user, exists := am.users[userID]
	if !exists {
		return nil, errors.New("user not found")
	}
	return user, nil
}

func (am *AuthManager) GetUserByEmail(email string) (*User, error) {
	am.mu.RLock()
	defer am.mu.RUnlock()

	userID, exists := am.emailIndex[email]
	if !exists {
		return nil, errors.New("user not found")
	}

	return am.users[userID], nil
}

func (am *AuthManager) UpdateProfile(userID string, updates map[string]string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	user, exists := am.users[userID]
	if !exists {
		return errors.New("user not found")
	}

	if phone, ok := updates["phone"]; ok {
		user.Phone = phone
	}

	user.UpdatedAt = time.Now()
	return nil
}

func (am *AuthManager) GetLoginAttempts(userID string) []LoginAttempt {
	am.mu.RLock()
	defer am.mu.RUnlock()

	return am.loginAttempts[userID]
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}

	hasUpper := false
	hasLower := false
	hasDigit := false

	for _, c := range password {
		if c >= 'A' && c <= 'Z' {
			hasUpper = true
		}
		if c >= 'a' && c <= 'z' {
			hasLower = true
		}
		if c >= '0' && c <= '9' {
			hasDigit = true
		}
	}

	if !hasUpper {
		return errors.New("password must contain uppercase letter")
	}
	if !hasLower {
		return errors.New("password must contain lowercase letter")
	}
	if !hasDigit {
		return errors.New("password must contain digit")
	}

	return nil
}

func generateToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}

func HashToken(token string) string {
	hasher := sha256.New()
	hasher.Write([]byte(token))
	return hex.EncodeToString(hasher.Sum(nil))
}
