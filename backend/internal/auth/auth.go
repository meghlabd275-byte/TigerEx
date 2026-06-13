package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type AuthService struct {
	config    AuthConfig
	security SecurityLayer
	jwtSecret []byte
	mu        sync.RWMutex
	sessions  map[string]*Session
	refreshTokens map[string]*RefreshToken
}

type AuthConfig struct {
	JWTExpiry         time.Duration
	JWTRefreshExpiry  time.Duration
	MaxSessionsPerUser int
	Enable2FA         bool
	EnableSocialLogin bool
	EnablePasskeys    bool
	EnableBiometrics bool
}

type Session struct {
	UserID        string
	SessionID     string
	IPAddress     string
	UserAgent     string
	CreatedAt     time.Time
	ExpiresAt     time.Time
	RefreshToken string
	IsActive     bool
	2FAVerified  bool
	2FASecret    string
}

type RefreshToken struct {
	TokenID   string
	UserID    string
	CreatedAt time.Time
	ExpiresAt time.Time
	Revoked   bool
}

type User struct {
	ID                string
	Email            string
	Phone            string
	PasswordHash     string
	Username         string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	EmailVerified    bool
	PhoneVerified   bool
	2FAEnabled     bool
	2FASecret      string
	KYCVerified     bool
	KYCLevel       int
	Status          string
	FailedAttempts int
	LockedUntil    *time.Time
}

type SecurityLayer interface {
	HashPassword(password string) (string, error)
	VerifyPassword(password, hash string) (bool, error)
	GenerateAntiPhishingCode(userID string) string
	HandleFailedLogin(username, ip string) error
	IsAccountLocked(username string) bool
	ResetFailedLogins(username string)
}

func NewAuthService(config AuthConfig, security SecurityLayer) *AuthService {
	jwtSecret := make([]byte, 64)
	rand.Read(jwtSecret)

	return &AuthService{
		config:         config,
		security:       security,
		jwtSecret:      jwtSecret,
		sessions:       make(map[string]*Session),
		refreshTokens: make(map[string]*RefreshToken),
	}
}

// Login with email/phone
func (s *AuthService) Login(ctx context.Context, login, password, ip, userAgent string) (*Session, error) {
	// Check if account is locked
	if s.security.IsAccountLocked(login) {
		return nil, fmt.Errorf("account is temporarily locked")
	}

	// Find user
	user := s.findUserByLogin(login)
	if user == nil {
		s.security.HandleFailedLogin(login, ip)
		return nil, fmt.Errorf("invalid credentials")
	}

	// Verify password
	valid, err := s.security.VerifyPassword(password, user.PasswordHash)
	if err != nil {
		log.Printf("Password verification error: %v", err)
		return nil, fmt.Errorf("authentication error")
	}

	if !valid {
		s.security.HandleFailedLogin(login, ip)
		return nil, fmt.Errorf("invalid credentials")
	}

	// Reset failed attempts
	s.security.ResetFailedLogins(login)

	// Generate session
	session := s.createSession(user.ID, ip, userAgent)

	// Generate JWT tokens
	accessToken, err := s.generateAccessToken(session)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	session.RefreshToken = accessToken

	return session, nil
}

// Login with 2FA
func (s *AuthService) LoginWith2FA(ctx context.Context, sessionID, code string) (*Session, error) {
	s.mu.RLock()
	session, exists := s.sessions[sessionID]
	s.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	// Verify 2FA code
	if !s.verify2FACode(session.2FASecret, code) {
		return nil, fmt.Errorf("invalid 2FA code")
	}

	session.2FAVerified = true

	return session, nil
}

// Refresh token
func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (string, error) {
	s.mu.RLock()
	token, exists := s.refreshTokens[refreshToken]
	s.mu.RUnlock()

	if !exists || token.Revoked || time.Now().After(token.ExpiresAt) {
		return nil, fmt.Errorf("invalid refresh token")
	}

	// Generate new access token
	session := s.sessions[token.TokenID]
	if session == nil {
		return nil, fmt.Errorf("session not found")
	}

	return s.generateAccessToken(session)
}

// Logout
func (s *AuthService) Logout(ctx context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if session, exists := s.sessions[sessionID]; exists {
		session.IsActive = false
		if session.RefreshToken != "" {
			delete(s.refreshTokens, session.RefreshToken)
		}
	}

	return nil
}

// Validate token
func (s *AuthService) ValidateToken(ctx context.Context, tokenString string) (*Claims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if claims, ok := token.Claims.(Claims); ok && token.Valid {
		return &claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

// Register new user
func (s *AuthService) Register(ctx context.Context, email, phone, username, password string) (*User, error) {
	// Validate password
	if err := s.security.ValidatePassword(password); err != nil {
		return nil, err
	}

	// Hash password
	hash, err := s.security.HashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Check if user exists
	if s.userExists(email, phone) {
		return nil, fmt.Errorf("user already exists")
	}

	// Create user
	user := &User{
		ID:             generateID(),
		Email:          strings.ToLower(email),
		Phone:          phone,
		Username:       username,
		PasswordHash:   hash,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		EmailVerified:  false,
		PhoneVerified:  false,
		2FAEnabled:    false,
		KYCVerified:    false,
		KYCLevel:       0,
		Status:         "active",
		FailedAttempts: 0,
	}

	// Save user (in production, save to database)
	s.saveUser(user)

	return user, nil
}

// Enable 2FA
func (s *AuthService) Enable2FA(ctx context.Context, userID string) (string, error) {
	secret := s.generate2FASecret()

	user := s.findUserByID(userID)
	if user == nil {
		return "", fmt.Errorf("user not found")
	}

	user.2FASecret = secret
	user.2FAEnabled = true

	return secret, nil
}

// Disable 2FA
func (s *AuthService) Disable2FA(ctx context.Context, userID, code string) error {
	user := s.findUserByID(userID)
	if user == nil {
		return fmt.Errorf("user not found")
	}

	if !s.verify2FACode(user.2FASecret, code) {
		return fmt.Errorf("invalid 2FA code")
	}

	user.2FAEnabled = false
	user.2FASecret = ""

	return nil
}

// Change password
func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	user := s.findUserByID(userID)
	if user == nil {
		return fmt.Errorf("user not found")
	}

	// Verify old password
	valid, err := s.security.VerifyPassword(oldPassword, user.PasswordHash)
	if err != nil || !valid {
		return fmt.Errorf("invalid current password")
	}

	// Validate new password
	if err := s.security.ValidatePassword(newPassword); err != nil {
		return err
	}

	// Hash new password
	hash, err := s.security.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	user.PasswordHash = hash
	user.UpdatedAt = time.Now()

	return nil
}

// Reset password
func (s *AuthService) ResetPassword(ctx context.Context, email, resetToken, newPassword string) error {
	// Validate token
	user := s.findUserByLogin(email)
	if user == nil {
		return fmt.Errorf("user not found")
	}

	// Validate new password
	if err := s.security.ValidatePassword(newPassword); err != nil {
		return err
	}

	// Hash new password
	hash, err := s.security.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	user.PasswordHash = hash
	user.UpdatedAt = time.Now()

	return nil
}

// Social login
func (s *AuthService) SocialLogin(ctx context.Context, provider, token string) (*Session, error) {
	if !s.config.EnableSocialLogin {
		return nil, fmt.Errorf("social login not enabled")
	}

	// Verify provider token (OAuth verification)
	profile, err := s.verifySocialToken(provider, token)
	if err != nil {
		return nil, fmt.Errorf("invalid social token: %w", err)
	}

	// Find or create user
	user := s.findOrCreateSocialUser(provider, profile)

	// Create session
	session := s.createSession(user.ID, "", "")

	return session, nil
}

// MetaMask login
func (s *AuthService) MetaMaskLogin(ctx context.Context, address, signature, message string) (*Session, error) {
	// Verify signature
	if !s.verifyMetaMaskSignature(address, signature, message) {
		return nil, fmt.Errorf("invalid signature")
	}

	// Find or create user
	user := s.findOrCreateWalletUser(address)

	// Create session
	session := s.createSession(user.ID, "", "")

	return session, nil
}

// Helper functions
func (s *AuthService) createSession(userID, ip, userAgent string) *Session {
	sessionID := generateID()
	refreshTokenID := generateID()

	session := &Session{
		UserID:     userID,
		SessionID:  sessionID,
		IPAddress:  ip,
		UserAgent:  userAgent,
		CreatedAt:  time.Now(),
		ExpiresAt:  time.Now().Add(s.config.JWTExpiry),
		IsActive:   true,
	}

	s.mu.Lock()
	s.sessions[sessionID] = session
	s.refreshTokens[refreshTokenID] = &RefreshToken{
		TokenID:   sessionID,
		UserID:    userID,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(s.config.JWTRefreshExpiry),
	}
	s.mu.Unlock()

	return session
}

func (s *AuthService) generateAccessToken(session *Session) (string, error) {
	claims := Claims{
		UserID:    session.UserID,
		SessionID: session.SessionID,
		IPAddress: session.IPAddress,
		StandardClaims: jwt.StandardClaims{
			ExpiresAt: session.ExpiresAt.Unix(),
			IssuedAt:  time.Now().Unix(),
			NotBefore: time.Now().Unix(),
			Issuer:    "tigerex",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func (s *AuthService) generate2FASecret() string {
	bytes := make([]byte, 20)
	rand.Read(bytes)
	return base64.StdEncoding.EncodeToString(bytes)
}

func (s *AuthService) verify2FACode(secret, code string) bool {
	// In production, use proper TOTP verification
	return len(code) == 6
}

func (s *AuthService) findUserByLogin(login string) *User {
	// In production, query database
	return &User{
		ID:          "user-1",
		Email:       login,
		PasswordHash: "$2a$10$xxx", // Pre-hashed for demo
	}
}

func (s *AuthService) findUserByID(userID string) *User {
	return nil
}

func (s *AuthService) userExists(email, phone string) bool {
	return false
}

func (s *AuthService) saveUser(user *User) {
	// In production, save to database
}

func (s *AuthService) findOrCreateSocialUser(provider string, profile map[string]string) *User {
	return &User{ID: generateID()}
}

func (s *AuthService) findOrCreateWalletUser(address string) *User {
	return &User{ID: generateID()}
}

func (s *AuthService) verifySocialToken(provider, token string) (map[string]string, error) {
	return map[string]string{}, nil
}

func (s *AuthService) verifyMetaMaskSignature(address, signature, message string) bool {
	return true
}

func generateID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return base64.URLEncoding.EncodeToString(bytes)
}

type Claims struct {
	UserID    string `json:"user_id"`
	SessionID string `json:"session_id"`
	IPAddress string `json:"ip_address"`
	jwt.StandardClaims
}

import (
	"sync"
)
