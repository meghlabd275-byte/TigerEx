// Package auth provides authentication and authorization services
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"tigerex-api/internal/api"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound       = errors.New("user not found")
	ErrUserExists         = errors.New("user already exists")
	ErrTokenExpired       = errors.New("token expired")
	ErrInvalidToken      = errors.New("invalid token")
)

// Config holds authentication configuration
type Config struct {
	JWT             JWTConfig
	MaxLoginAttempts int
	LockoutDuration time.Duration
	SessionExpiry  time.Duration
}

// JWTConfig holds JWT configuration
type JWTConfig {
	Secret        []byte
	AccessExpiry time.Duration
	RefreshExpiry time.Duration
}

// Service handles authentication
type Service struct {
	config Config
}

// NewService creates a new authentication service
func NewService(config Config) *Service {
	return &Service{config: config}
}

// CreateUser creates a new user
func (s *Service) CreateUser(ctx context.Context, user *api.User) error {
	if user == nil {
		return ErrUserNotFound
	}
	
	// Set defaults
	if user.ID == "" {
		user.ID = uuid.New().String()
	}
	if user.CreatedAt == 0 {
		user.CreatedAt = api.Now()
	}
	if user.UpdatedAt == 0 {
		user.UpdatedAt = api.Now()
	}
	
	return nil
}

// GetUserByEmail retrieves a user by email
func (s *Service) GetUserByEmail(ctx context.Context, email string) (*api.User, error) {
	if email == "" {
		return nil, ErrUserNotFound
	}
	
	// This is a placeholder - real implementation would query database
	// For now, return nil to indicate user doesn't exist
	return nil, ErrUserNotFound
}

// GetUserByID retrieves a user by ID
func (s *Service) GetUserByID(ctx context.Context, userID string) (*api.User, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	
	// This is a placeholder - real implementation would query database
	return nil, ErrUserNotFound
}

// UsernameExists checks if username is already taken
func (s *Service) UsernameExists(ctx context.Context, username string) bool {
	if username == "" {
		return false
	}
	
	// This is a placeholder - real implementation would query database
	return false
}

// EmailExists checks if email is already registered
func (s *Service) EmailExists(ctx context.Context, email string) bool {
	if email == "" {
		return false
	}
	
	// This is a placeholder - real implementation would query database
	return false
}

// VerifyPassword verifies a password against a hash
func (s *Service) VerifyPassword(password, hash string) error {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if err != nil {
		return ErrInvalidCredentials
	}
	return nil
}

// HashPassword creates a bcrypt hash of a password
func (s *Service) HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// GenerateTokenPair generates access and refresh tokens
func (s *Service) GenerateTokenPair(user *api.User) (string, string, int64, error) {
	if user == nil {
		return "", "", 0, ErrUserNotFound
	}
	
	now := time.Now()
	expiresAt := now.Add(s.config.JWT.AccessExpiry).Unix()
	
	// Access token
	accessClaims := jwt.MapClaims{
		"sub":   user.ID,
		"email": user.Email,
		"iat":   now.Unix(),
		"exp":   expiresAt,
		"type":  "access",
	}
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString(s.config.JWT.Secret)
	if err != nil {
		return "", "", 0, err
	}
	
	// Refresh token
	refreshExpiresAt := now.Add(s.config.JWT.RefreshExpiry).Unix()
	refreshClaims := jwt.MapClaims{
		"sub": user.ID,
		"iat": now.Unix(),
		"exp": refreshExpiresAt,
		"type": "refresh",
	}
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString(s.config.JWT.Secret)
	if err != nil {
		return "", "", 0, err
	}
	
	return accessTokenString, refreshTokenString, expiresAt, nil
}

// VerifyToken verifies a JWT token
func (s *Service) VerifyToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return s.config.JWT.Secret, nil
	})
	
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	
	// Check expiration
	exp, ok := claims["exp"].(float64)
	if !ok {
		return nil, ErrInvalidToken
	}
	
	if int64(exp) < time.Now().Unix() {
		return nil, ErrTokenExpired
	}
	
	return claims, nil
}

// GeneratePasswordResetToken generates a password reset token
func (s *Service) GeneratePasswordResetToken(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", ErrUserNotFound
	}
	
	// Generate random token
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(bytes)
	
	// Store token with expiration
	// This is a placeholder - real implementation would store in database with TTL
	
	return token, nil
}

// RecordFailedRecordFailedAttempt records a failed login attempt
func (s *Service) RecordFailedAttempt(ctx context.Context, userID string) {
	if userID == "" {
		return
	}
	
	// This is a placeholder - real implementation would store in database/Redis
}

// ClearFailedAttempts clears failed login attempts
func (s *Service) ClearFailedAttempts(ctx context.Context, userID string) {
	if userID == "" {
		return
	}
	
	// This is a placeholder - real implementation would clear from database/Redis
}

// IsAccountLocked checks if account is locked
func (s *Service) IsAccountLocked(ctx context.Context, userID string) bool {
	if userID == "" {
		return false
	}
	
	// This is a placeholder - real implementation would check database/Redis
	return false
}

// UpdateUser updates user information
func (s *Service) UpdateUser(ctx context.Context, user *api.User) error {
	if user == nil {
		return ErrUserNotFound
	}
	
	user.UpdatedAt = api.Now()
	
	// This is a placeholder - real implementation would update database
	return nil
}

// GetAPIKeys retrieves API keys for a user
func (s *Service) GetAPIKeys(ctx context.Context, userID string) ([]api.APIKey, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	
	// This is a placeholder - real implementation would query database
	return []api.APIKey{}, nil
}

// APIKeyRequest represents an API key creation request
type APIKeyRequest struct {
	UserID       string
	Label       string
	Permissions []string
	ExpiresAt   int64
	IPWhitelist []string
}

// CreateAPIKey creates a new API key
func (s *Service) CreateAPIKey(ctx context.Context, req *APIKeyRequest) (*api.APIKey, error) {
	if req == nil || req.UserID == "" || req.Label == "" {
		return nil, ErrUserNotFound
	}
	
	// Generate key and secret
	keyBytes := make([]byte, 16)
	secretBytes := make([]byte, 32)
	rand.Read(keyBytes)
	rand.Read(secretBytes)
	
	key := api.APIKey{
		ID:          uuid.New().String(),
		Key:         hex.EncodeToString(keyBytes),
		Secret:      hex.EncodeToString(secretBytes),
		Label:       req.Label,
		Permissions: req.Permissions,
		ExpiresAt:   req.ExpiresAt,
		CreatedAt:   api.Now(),
		Enabled:    true,
		IPWhitelist: req.IPWhitelist,
	}
	
	// This is a placeholder - real implementation would store in database
	
	return &key, nil
}

// DeleteAPIKey deletes an API key
func (s *Service) DeleteAPIKey(ctx context.Context, userID, keyID string) error {
	if userID == "" || keyID == "" {
		return ErrUserNotFound
	}
	
	// This is a placeholder - real implementation would delete from database
	return nil
}

// GetSettings retrieves user settings
func (s *Service) GetSettings(ctx context.Context, userID string) (*api.UserSettings, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	
	settings := &api.UserSettings{
		UserID:    userID,
		Language: "en",
		Timezone: "UTC",
		Theme:    "dark",
		Currency: "USD",
	}
	
	// This is a placeholder - real implementation would query database
	return settings, nil
}

// ValidateAPIKey validates an API key
func (s *Service) ValidateAPIKey(ctx context.Context, key, secret, ip string) (*api.APIKey, error) {
	if key == "" || secret == "" {
		return nil, ErrInvalidCredentials
	}
	
	// This is a placeholder - real implementation would query database
	return nil, ErrInvalidToken
}

// Sign signs data with API key secret
func (s *Service) Sign(data string, secret string) string {
	// Simple HMAC signature (not for production use)
	h := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"data": data,
	})
	token, _ := h.SignedString([]byte(secret))
	return token
}

// Verify verifies an API key signature
func (s *Service) Verify(data, signature, secret string) bool {
	token, err := jwt.Parse(signature, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	return token.Valid && err == nil
}

// SanitizeEmail sanitizes an email for display
func SanitizeEmail(email string) string {
	if email == "" {
		return ""
	}
	
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return ""
	}
	
	local := parts[0]
	domain := parts[1]
	
	// Show first and last character of local part
	if len(local) <= 2 {
		local = strings.Repeat("*", len(local))
	} else {
		local = string(local[0]) + strings.Repeat("*", len(local)-2) + string(local[len(local)-1])
	}
	
	return local + "@" + domain
}

// ConstantTimeCompare provides constant-time comparison to prevent timing attacks
func ConstantTimeCompare(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}