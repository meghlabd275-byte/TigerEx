package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Config holds JWT configuration
type Config struct {
	SecretKey       string
	AccessExpiry    time.Duration
	RefreshExpiry   time.Duration
	Issuer          string
	Audience        string
}

// NewConfig creates config from environment
func NewConfig() *Config {
	return &Config{
		SecretKey:      getEnv("JWT_SECRET_KEY", ""),
		AccessExpiry:   parseDuration(getEnv("JWT_ACCESS_EXPIRY", "15m"), 15*time.Minute),
		RefreshExpiry:  parseDuration(getEnv("JWT_REFRESH_EXPIRY", "7d"), 7*24*time.Hour),
		Issuer:        getEnv("JWT_ISSUER", "tigerex"),
		Audience:      getEnv("JWT_AUDIENCE", "tigerex"),
	}
}

// Claims represents JWT claims
type Claims struct {
	jwt.RegisteredClaims
	UserID   string `json:"userId"`
	Email    string `json:"email"`
	KYCLevel int    `json:"kycLevel"`
	Type     string `json:"type"` // access or refresh
}

// TokenPair represents access and refresh tokens
type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt   int64  `json:"expiresAt"`
	TokenType   string `json:"tokenType"` // Bearer
}

// JWTService handles JWT operations
type JWTService struct {
	config *Config
}

// NewJWTService creates a new JWT service
func NewJWTService(cfg *Config) (*JWTService, error) {
	// Generate secret if not provided
	if cfg.SecretKey == "" {
		secret := make([]byte, 64)
		rand.Read(secret)
		cfg.SecretKey = base64.StdEncoding.EncodeToString(secret)
	}

	return &JWTService{
		config: cfg,
	}, nil
}

// GenerateTokens generates access and refresh tokens
func (j *JWTService) GenerateTokens(ctx interface{}, userID, email string, kycLevel int) (*TokenPair, error) {
	_ = ctx // unused
	now := time.Now()

	// Access token
	accessClaims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(now.Add(j.config.AccessExpiry)),
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		Issuer:    j.config.Issuer,
		Audience: jwt.ClaimStrings{j.config.Audience},
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		RegisteredClaims: accessClaims,
		UserID:           userID,
		Email:            email,
		KYCLevel:         kycLevel,
		Type:             "access",
	})

	accessString, err := accessToken.SignedString([]byte(j.config.SecretKey))
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	// Refresh token (longer expiry)
	refreshExpiry := now.Add(j.config.RefreshExpiry)
	refreshClaims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(refreshExpiry),
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		Issuer:    j.config.Issuer,
		Audience: jwt.ClaimStrings{j.config.Audience},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		RegisteredClaims: refreshClaims,
		UserID:            userID,
		Email:             email,
		KYCLevel:          kycLevel,
		Type:              "refresh",
	})

	refreshString, err := refreshToken.SignedString([]byte(j.config.SecretKey))
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessString,
		RefreshToken: refreshString,
		ExpiresAt:   refreshExpiry.Unix(),
		TokenType:   "Bearer",
	}, nil
}

// ValidateToken validates a token and returns claims
func (j *JWTService) ValidateToken(ctx interface{}, tokenString string) (*Claims, error) {
	_ = ctx // unused

	// Parse token
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(j.config.SecretKey), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	// Validate claims
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	// Check if token is expired
	if claims.ExpiresAt != nil && claims.ExpiresAt.Time.Before(time.Now()) {
		return nil, fmt.Errorf("token expired")
	}

	// Verify issuer and audience
	if claims.Issuer != j.config.Issuer {
		return nil, fmt.Errorf("invalid issuer")
	}

	if claims.Audience != nil {
		found := false
		for _, aud := range claims.Audience {
			if aud == j.config.Audience {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("invalid audience")
		}
	}

	return claims, nil
}

// ValidateAccessToken validates an access token only
func (j *JWTService) ValidateAccessToken(ctx interface{}, tokenString string) (*Claims, error) {
	claims, err := j.ValidateToken(ctx, tokenString)
	if err != nil {
		return nil, err
	}

	if claims.Type != "access" {
		return nil, fmt.Errorf("not an access token")
	}

	return claims, nil
}

// ValidateRefreshToken validates a refresh token only
func (j *JWTService) ValidateRefreshToken(ctx interface{}, tokenString string) (*Claims, error) {
	claims, err := j.ValidateToken(ctx, tokenString)
	if err != nil {
		return nil, err
	}

	if claims.Type != "refresh" {
		return nil, fmt.Errorf("not a refresh token")
	}

	return claims, nil
}

// RefreshTokens generates new tokens from a refresh token
func (j *JWTService) RefreshTokens(ctx interface{}, refreshTokenString string) (*TokenPair, error) {
	claims, err := j.ValidateRefreshToken(ctx, refreshTokenString)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}

	return j.GenerateTokens(ctx, claims.UserID, claims.Email, claims.KYCLevel)
}

// GetTokenFromHeader extracts token from Authorization header
func GetTokenFromHeader(authHeader string) (string, error) {
	if authHeader == "" {
		return "", fmt.Errorf("authorization header missing")
	}

	// Expected format: "Bearer <token>"
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", fmt.Errorf("invalid authorization header format")
	}

	return parts[1], nil
}

// PasswordService handles password operations
type PasswordService struct {
	minLength     int
	requireUpper bool
	requireLower bool
	requireDigit bool
	requireSpecial bool
}

// NewPasswordService creates a new password service
func NewPasswordService() *PasswordService {
	return &PasswordService{
		minLength:     8,
		requireUpper: true,
		requireLower: true,
		requireDigit: true,
		requireSpecial: false,
	}
}

// ValidatePassword validates a password
func (p *PasswordService) ValidatePassword(password string) error {
	if len(password) < p.minLength {
		return fmt.Errorf("password must be at least %d characters", p.minLength)
	}

	hasUpper := false
	hasLower := false
	hasDigit := false

	for _, char := range password {
		switch {
		case char >= 'A' && char <= 'Z':
			hasUpper = true
		case char >= 'a' && char <= 'z':
			hasLower = true
		case char >= '0' && char <= '9':
			hasDigit = true
		}
	}

	if p.requireUpper && !hasUpper {
		return fmt.Errorf("password must contain at least one uppercase letter")
	}
	if p.requireLower && !hasLower {
		return fmt.Errorf("password must contain at least one lowercase letter")
	}
	if p.requireDigit && !hasDigit {
		return fmt.Errorf("password must contain at least one digit")
	}

	return nil
}

// HashPassword hashes a password using bcrypt
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// ComparePassword compares a password with a hash
func ComparePassword(password, hash string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// Errors
func ErrUnauthorized(message string) error {
	return &AuthError{Code: 401, Message: message}
}

type AuthError struct {
	Code    int
	Message string
}

func (e *AuthError) Error() string {
	return e.Message
}

// Helper functions
func getEnv(key, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

func parseDuration(val string, def time.Duration) time.Duration {
	val = strings.TrimSpace(val)
	if val == "" {
		return def
	}
	d, err := time.ParseDuration(val)
	if err != nil {
		return def
	}
	return d
}