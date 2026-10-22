package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	// Password requirements
	MinPasswordLength = 8
	MaxPasswordLength = 128
	BcryptCost        = 12

	// Token durations
	AccessTokenExpiry  = 15 * time.Minute
	RefreshTokenExpiry = 7 * 24 * time.Hour
	SessionExpiry      = 24 * time.Hour

	// Security
	MaxFailedAttempts = 5
	LockoutDuration   = 15 * time.Minute
)

var (
	ErrInvalidEmail       = errors.New("invalid email format")
	ErrInvalidPassword    = errors.New("password does not meet requirements")
	ErrWeakPassword       = errors.New("password is too weak")
	ErrAccountLocked      = errors.New("account is temporarily locked")
	ErrInvalidToken       = errors.New("invalid or expired token")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserNotFound       = errors.New("user not found")
	ErrUserExists         = errors.New("user already exists")
	Err2FARequired        = errors.New("2FA code required")
	ErrInvalid2FA         = errors.New("invalid 2FA code")
)

// =============================================================================
// TYPES
// =============================================================================

type User struct {
	ID                string    `json:"id"`
	Email             string    `json:"email"`
	Username          string    `json:"username"`
	PasswordHash      string    `json:"-"`
	PasswordSalt      string    `json:"-"`
	TwoFactorSecret   string    `json:"two_factor_secret,omitempty"`
	TwoFactorEnabled  bool      `json:"two_factor_enabled"`
	KYCLevel          int       `json:"kyc_level"`
	Status            string    `json:"status"` // active, suspended, locked, closed
	FailedAttempts    int       `json:"failed_attempts"`
	LockedUntil       time.Time `json:"locked_until,omitempty"`
	EmailVerified     bool      `json:"email_verified"`
	PhoneVerified     bool      `json:"phone_verified"`
	ReferralCode     string    `json:"referral_code"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type Session struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	AccessToken    string    `json:"access_token"`
	RefreshToken   string    `json:"refresh_token"`
	IPAddress      string    `json:"ip_address"`
	UserAgent      string    `json:"user_agent"`
	DeviceID       string    `json:"device_id"`
	Trusted        bool      `json:"trusted"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
	LastActiveAt   time.Time `json:"last_active_at"`
}

type LoginRequest struct {
	Email         string `json:"email"`
	Password      string `json:"password"`
	TwoFactorCode string `json:"two_factor_code,omitempty"`
	DeviceID      string `json:"device_id,omitempty"`
	IPAddress     string `json:"ip_address,omitempty"`
	UserAgent     string `json:"user_agent,omitempty"`
}

type RegisterRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	Username    string `json:"username"`
	Phone       string `json:"phone,omitempty"`
	ReferralCode string `json:"referral_code,omitempty"`
}

type AuthResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    int64     `json:"expires_at"`
	TokenType    string    `json:"token_type"`
	User         *User     `json:"user,omitempty"`
}

type TokenClaims struct {
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	DeviceID string `json:"device_id"`
	jwt.RegisteredClaims
}

// =============================================================================
// SERVICE
// =============================================================================

type AuthService struct {
	jwtSecret        []byte
	jwtRefreshSecret []byte
}

// NewAuthService creates a new authentication service
func NewAuthService(jwtSecret, jwtRefreshSecret string) *AuthService {
	return &AuthService{
		jwtSecret:        []byte(jwtSecret),
		jwtRefreshSecret: []byte(jwtRefreshSecret),
	}
}

// =============================================================================
// PASSWORD OPERATIONS
// =============================================================================

// HashPassword creates a bcrypt hash of the password
func (s *AuthService) HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword verifies a password against a hash
func (s *AuthService) VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// GenerateSalt generates a random salt
func (s *AuthService) GenerateSalt() (string, error) {
	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(salt), nil
}

// HashPasswordWithSalt hashes password with salt using SHA256
func (s *AuthService) HashPasswordWithSalt(password, salt string) string {
	hash := sha256.Sum256([]byte(password + salt))
	return base64.StdEncoding.EncodeToString(hash[:])
}

// ValidatePassword checks password meets requirements
func (s *AuthService) ValidatePassword(password string) error {
	if len(password) < MinPasswordLength {
		return ErrWeakPassword
	}
	if len(password) > MaxPasswordLength {
		return ErrInvalidPassword
	}

	// Check for complexity
	hasUpper := false
	hasLower := false
	hasDigit := false
	hasSpecial := false

	for _, c := range password {
		switch {
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= '0' && c <= '9':
			hasDigit = true
		case c == '!' || c == '@' || c == '#' || c == '$' || c == '%' || c == '^' || c == '&' || c == '*':
			hasSpecial = true
		}
	}

	if !hasUpper || !hasLower || !hasDigit || !hasSpecial {
		return ErrWeakPassword
	}

	return nil
}

// =============================================================================
// TOKEN OPERATIONS
// =============================================================================

// GenerateAccessToken creates a new JWT access token
func (s *AuthService) GenerateAccessToken(user *User, deviceID string) (string, error) {
	claims := TokenClaims{
		UserID:   user.ID,
		Email:    user.Email,
		DeviceID: deviceID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(AccessTokenExpiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "tigerex",
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

// GenerateRefreshToken creates a new refresh token
func (s *AuthService) GenerateRefreshToken(user *User) (string, error) {
	claims := TokenClaims{
		UserID: user.ID,
		Email:  user.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(RefreshTokenExpiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "tigerex",
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtRefreshSecret)
}

// VerifyAccessToken verifies an access token
func (s *AuthService) VerifyAccessToken(tokenString string) (*TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		return s.jwtSecret, nil
	})

	if err != nil {
		return nil, ErrInvalidToken
	}

	if claims, ok := token.Claims.(*TokenClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrInvalidToken
}

// VerifyRefreshToken verifies a refresh token
func (s *AuthService) VerifyRefreshToken(tokenString string) (*TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		return s.jwtRefreshSecret, nil
	})

	if err != nil {
		return nil, ErrInvalidToken
	}

	if claims, ok := token.Claims.(*TokenClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrInvalidToken
}

// =============================================================================
// SESSION OPERATIONS
// =============================================================================

// CreateSession creates a new user session
func (s *AuthService) CreateSession(ctx context.Context, user *User, req *LoginRequest) (*Session, error) {
	// Generate tokens
	accessToken, err := s.GenerateAccessToken(user, req.DeviceID)
	if err != nil {
		return nil, err
	}

	refreshToken, err := s.GenerateRefreshToken(user)
	if err != nil {
		return nil, err
	}

	session := &Session{
		ID:           uuid.New().String(),
		UserID:        user.ID,
		AccessToken:   accessToken,
		RefreshToken:  refreshToken,
		IPAddress:     req.IPAddress,
		UserAgent:     req.UserAgent,
		DeviceID:      req.DeviceID,
		Trusted:       false,
		ExpiresAt:     time.Now().Add(SessionExpiry),
		CreatedAt:     time.Now(),
		LastActiveAt:  time.Now(),
	}

	return session, nil
}

// ValidateSession validates a session token
func (s *AuthService) ValidateSession(ctx context.Context, tokenString string) (*TokenClaims, error) {
	return s.VerifyAccessToken(tokenString)
}

// RefreshSession refreshes an access token using refresh token
func (s *AuthService) RefreshSession(ctx context.Context, refreshToken string) (string, error) {
	claims, err := s.VerifyRefreshToken(refreshToken)
	if err != nil {
		return "", err
	}

	// Create minimal user for token generation
	user := &User{
		ID:    claims.UserID,
		Email: claims.Email,
	}

	return s.GenerateAccessToken(user, claims.DeviceID)
}

// =============================================================================
// USER OPERATIONS
// =============================================================================

// ValidateLoginRequest validates login credentials
func (s *AuthService) ValidateLoginRequest(ctx context.Context, req *LoginRequest) (*User, error) {
	// Email validation
	if req.Email == "" {
		return nil, ErrInvalidEmail
	}

	// Password validation
	if req.Password == "" {
		return nil, ErrInvalidCredentials
	}

	// Note: In production, fetch user from database
	// This is a placeholder that always fails
	// Real implementation would query database
	return nil, ErrInvalidCredentials
}

// ValidateRegisterRequest validates registration data
func (s *AuthService) ValidateRegisterRequest(ctx context.Context, req *RegisterRequest) error {
	// Email validation
	if req.Email == "" {
		return ErrInvalidEmail
	}

	// Password validation
	if err := s.ValidatePassword(req.Password); err != nil {
		return err
	}

	// Username validation
	if req.Username == "" || len(req.Username) < 3 {
		return errors.New("username must be at least 3 characters")
	}

	return nil
}

// CreateUser creates a new user
func (s *AuthService) CreateUser(ctx context.Context, req *RegisterRequest) (*User, error) {
	// Validate request
	if err := s.ValidateRegisterRequest(ctx, req); err != nil {
		return nil, err
	}

	// Generate salt and hash password
	salt, err := s.GenerateSalt()
	if err != nil {
		return nil, err
	}

	passwordHash, err := s.HashPassword(req.Password)
	if err != nil {
		return nil, err
	}

	// Generate unique ID and referral code
	userID := uuid.New().String()
	referralCode := s.generateReferralCode()

	user := &User{
		ID:            userID,
		Email:         req.Email,
		Username:      req.Username,
		PasswordHash:  passwordHash,
		PasswordSalt:  salt,
		KYCLevel:      0,
		Status:        "active",
		FailedAttempts: 0,
		EmailVerified: false,
		PhoneVerified: false,
		ReferralCode:  referralCode,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	return user, nil
}

// =============================================================================
// ACCOUNT SECURITY
// =============================================================================

// CheckAccountLock checks if account is locked
func (s *AuthService) CheckAccountLock(user *User) error {
	if user.Status == "locked" {
		return ErrAccountLocked
	}

	if user.LockedUntil.After(time.Now()) {
		return ErrAccountLocked
	}

	return nil
}

// IncrementFailedAttempts increments failed login attempts
func (s *AuthService) IncrementFailedAttempts(user *User) {
	user.FailedAttempts++

	if user.FailedAttempts >= MaxFailedAttempts {
		user.Status = "locked"
		user.LockedUntil = time.Now().Add(LockoutDuration)
	}
}

// ResetFailedAttempts resets failed login attempts
func (s *AuthService) ResetFailedAttempts(user *User) {
	user.FailedAttempts = 0
	user.LockedUntil = time.Time{}
}

// =============================================================================
// UTILITIES
// =============================================================================

// generateReferralCode generates a unique referral code
func (s *AuthService) generateReferralCode() string {
	code := make([]byte, 8)
	rand.Read(code)
	return base64.URLEncoding.EncodeToString(code)[:8]
}

// GenerateAPIKey generates an API key for users
func (s *AuthService) GenerateAPIKey() (string, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

// HashAPIKey hashes an API key for storage
func (s *AuthService) HashAPIKey(apiKey string) string {
	hash := sha256.Sum256([]byte(apiKey))
	return base64.StdEncoding.EncodeToString(hash[:])
}
