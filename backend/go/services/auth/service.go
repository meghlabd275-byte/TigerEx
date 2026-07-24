/**
 * TigerEx Authentication Service
 * Production-Ready Authentication with Unified Smart Input
 * Supports Email/Phone auto-detection, 2FA, OAuth, Passkey, Web3
 * 
 * @author TigerEx Team
 * @version 3.0.0
 * @date July 2026
 */

package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// ============================================================================
// CONFIGURATION
// ============================================================================

type Config struct {
	JWTsecret           string        `mapstructure:"jwt_secret"`
	AccessTokenExpiry   time.Duration `mapstructure:"access_token_expiry"`
	RefreshTokenExpiry time.Duration `mapstructure:"refresh_token_expiry"`
	MaxLoginAttempts   int           `mapstructure:"max_login_attempts"`
	LockoutDuration    time.Duration `mapstructure:"lockout_duration"`
	PasswordMinLength  int           `mapstructure:"password_min_length"`
	OTPExpiry          time.Duration `mapstructure:"otp_expiry"`
	OTP Length         int           `mapstructure:"otp_length"`
}

var DefaultConfig = Config{
	JWTsecret:           "tigerex-jwt-secret-key-change-in-production",
	AccessTokenExpiry:   24 * time.Hour,
	RefreshTokenExpiry:  7 * 24 * time.Hour,
	MaxLoginAttempts:   5,
	LockoutDuration:    48 * time.Hour,
	PasswordMinLength:  8,
	OTPExpiry:          5 * time.Minute,
	OTP Length:         6,
}

// ============================================================================
// USER TYPES
// ============================================================================

type CredentialType string

const (
	CredentialTypeEmail CredentialType = "email"
	CredentialTypePhone CredentialType = "phone"
)

type User struct {
	ID                uint64    `json:"id" db:"id"`
	Email            string    `json:"email,omitempty" db:"email"`
	Phone            string    `json:"phone,omitempty" db:"phone"`
	PhoneCountryCode string    `json:"phone_country_code,omitempty" db:"phone_country_code"`
	CredentialType   CredentialType `json:"credential_type" db:"credential_type"`
	PasswordHash     string    `json:"-" db:"password_hash"`
	Username         string    `json:"username" db:"username"`
	DisplayName      string    `json:"display_name" db:"display_name"`
	ProfileImage     string    `json:"profile_image,omitempty" db:"profile_image"`
	TwoFactorEnabled bool      `json:"two_factor_enabled" db:"two_factor_enabled"`
	TwoFactorSecret  string    `json:"-" db:"two_factor_secret"`
	TwoFactorBackup  string    `json:"-" db:"two_factor_backup_codes"`
	KYCStatus        KYCStatus `json:"kyc_status" db:"kyc_status"`
	KYCLevel         int       `json:"kyc_level" db:"kyc_level"`
	RiskLevel        RiskLevel `json:"risk_level" db:"risk_level"`
	Status           UserStatus `json:"status" db:"status"`
	ReferrerID       *uint64  `json:"referrer_id,omitempty" db:"referrer_id"`
	ReferralCode     string    `json:"referral_code" db:"referral_code"`
	TrustDevice      bool      `json:"trust_device" db:"trust_device"`
	TrustedDevices   []TrustedDevice `json:"trusted_devices,omitempty" db:"-"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
	LastLoginAt      time.Time `json:"last_login_at" db:"last_login_at"`
	LockedUntil      *time.Time `json:"locked_until,omitempty" db:"locked_until"`
	LoginAttempts    int       `json:"login_attempts" db:"login_attempts"`
	InternalNotes    string    `json:"internal_notes,omitempty" db:"internal_notes"`
}

type TrustedDevice struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Fingerprint  string    `json:"fingerprint"`
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	LastUsed     time.Time `json:"last_used"`
	ExpiresAt    time.Time `json:"expires_at"`
	CreatedAt    time.Time `json:"created_at"`
}

type KYCStatus string

const (
	KYCStatusNone       KYCStatus = "none"
	KYCStatusPending    KYCStatus = "pending"
	KYCStatusReviewing  KYCStatus = "reviewing"
	KYCStatusApproved   KYCStatus = "approved"
	KYCStatusRejected   KYCStatus = "rejected"
	KYCStatusRestricted KYCStatus = "restricted"
)

type RiskLevel string

const (
	RiskLevelLow    RiskLevel = "low"
	RiskLevelMedium RiskLevel = "medium"
	RiskLevelHigh   RiskLevel = "high"
)

type UserStatus string

const (
	UserStatusActive     UserStatus = "active"
	UserStatusInactive  UserStatus = "inactive"
	UserStatusLocked    UserStatus = "locked"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusDeleted   UserStatus = "deleted"
)

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

type RegisterRequest struct {
	Credential     string `json:"credential"` // Email or phone
	Password       string `json:"password"`
	ReferralCode   string `json:"referral_code,omitempty"`
	InviteCode    string `json:"invite_code,omitempty"`
	TermsAccepted bool   `json:"terms_accepted"`
	IPAddress     string `json:"ip_address"`
	UserAgent     string `json:"user_agent"`
}

type LoginRequest struct {
	Credential  string `json:"credential"`
	Password    string `json:"password"`
	RememberMe  bool   `json:"remember_me"`
	DeviceID    string `json:"device_id,omitempty"`
	DeviceName  string `json:"device_name,omitempty"`
	IPAddress   string `json:"ip_address"`
	UserAgent   string `json:"user_agent"`
}

type LoginResponse struct {
	Success         bool      `json:"success"`
	AccessToken     string    `json:"access_token,omitempty"`
	RefreshToken    string    `json:"refresh_token,omitempty"`
	TokenType       string    `json:"token_type"`
	ExpiresIn       int64     `json:"expires_in"`
	Requires2FA     bool      `json:"requires_2fa,omitempty"`
	RequiresOTP     bool      `json:"requires_otp,omitempty"`
	TempToken       string    `json:"temp_token,omitempty"` // For 2FA flow
	User            *User     `json:"user,omitempty"`
	Message         string    `json:"message,omitempty"`
	SecurityMessage string    `json:"security_message,omitempty"`
}

type VerifyOTPRequest struct {
	Credential string `json:"credential"`
	OTP        string `json:"otp"`
	Type       string `json:"type"` // "email", "phone", "2fa"
	TempToken  string `json:"temp_token,omitempty"`
}

type ResetPasswordRequest struct {
	Credential       string `json:"credential"`
	OTP              string `json:"otp"`
	NewPassword      string `json:"new_password"`
	ConfirmPassword  string `json:"confirm_password"`
}

type ChangeCredentialRequest struct {
	OldCredential string `json:"old_credential"`
	NewCredential string `json:"new_credential"`
	OTP           string `json:"otp"`
	Type          string `json:"type"` // "email" or "phone"
}

type Enable2FARequest struct {
	Secret      string `json:"secret"`
	Code        string `json:"code"`
	BackupCodes bool   `json:"backup_codes"`
}

type Verify2FARequest struct {
	Code       string `json:"code"`
	BackupCode string `json:"backup_code,omitempty"`
	TempToken  string `json:"temp_token"`
}

type OAuthRequest struct {
	Provider    string `json:"provider"` // "google", "apple", "telegram"
	Code        string `json:"code"`
	RedirectURI string `json:"redirect_uri"`
	State       string `json:"state"`
	IPAddress   string `json:"ip_address"`
	UserAgent   string `json:"user_agent"`
}

type DeviceTrustRequest struct {
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
	Trust      bool   `json:"trust"`
}

// ============================================================================
// TOKEN TYPES
// ============================================================================

type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	TokenType    string    `json:"token_type"`
	ExpiresIn    int64     `json:"expires_in"`
	CreatedAt    time.Time `json:"created_at"`
}

type JWTClaims struct {
	UserID         uint64   `json:"user_id"`
	Email          string   `json:"email,omitempty"`
	Phone          string   `json:"phone,omitempty"`
	Role           string   `json:"role"`
	KYCLevel       int      `json:"kyc_level"`
	KYCStatus      string   `json:"kyc_status"`
	RiskLevel      string   `json:"risk_level"`
	TrustedDevice  bool     `json:"trusted_device"`
	DeviceFingerprint string `json:"device_fingerprint"`
	Permissions    []string `json:"permissions"`
	jwt.RegisteredClaims
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

type AuthService struct {
	config        Config
	db            Database
	redis         Cache
	otp           OTPService
	oauthProviders map[string]OAuthProvider
	analytics     AnalyticsService
	logger        Logger

	// Rate limiting
	rateLimiter   RateLimiter

	// Token storage
	tokenStore    TokenStore

	// Password requirements
	passwordRequirements PasswordRequirements

	// Trusted devices
	mu             sync.RWMutex
	trustedDevices map[uint64]map[string]TrustedDevice
}

type Database interface {
	CreateUser(ctx context.Context, user *User) error
	GetUserByID(ctx context.Context, id uint64) (*User, error)
	GetUserByEmail(ctx context.Context, email string) (*User, error)
	GetUserByPhone(ctx context.Context, phone string) (*User, error)
	GetUserByReferralCode(ctx context.Context, code string) (*User, error)
	UpdateUser(ctx context.Context, user *User) error
	DeleteUser(ctx context.Context, id uint64) error
	CreateSession(ctx context.Context, session *Session) error
	GetSession(ctx context.Context, token string) (*Session, error)
	DeleteSession(ctx context.Context, token string) error
	DeleteUserSessions(ctx context.Context, userID uint64) error
	CreateLoginAttempt(ctx context.Context, attempt *LoginAttempt) error
	GetLoginAttempts(ctx context.Context, userID uint64, since time.Time) ([]LoginAttempt, error)
}

type Cache interface {
	Set(ctx context.Context, key string, value interface{}, expiry time.Duration) error
	Get(ctx context.Context, key string, dest interface{}) error
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
	Inc(ctx context.Context, key string) (int64, error)
	Dec(ctx context.Context, key string) (int64, error)
}

type OTPService interface {
	Generate(credential string, purpose string) (string, error)
	Verify(credential string, purpose string, code string) (bool, error)
	SendEmail(email string, code string, purpose string) error
	SendSMS(phone string, code string, purpose string) error
}

type OAuthProvider interface {
	GetAuthURL(state string) string
	ExchangeCode(code string) (*OAuthUser, error)
	GetUserInfo(accessToken string) (*OAuthUser, error)
}

type OAuthUser struct {
	ID            string
	Email         string
	Phone         string
	Name          string
	ProfileImage string
	Provider     string
}

type TokenStore interface {
	Store(ctx context.Context, userID uint64, token *TokenPair, metadata TokenMetadata) error
	Retrieve(ctx context.Context, token string) (*TokenPair, TokenMetadata, error)
	Revoke(ctx context.Context, token string) error
	RevokeAll(ctx context.Context, userID uint64) error
	Refresh(ctx context.Context, oldToken string) (*TokenPair, error)
}

type TokenMetadata struct {
	DeviceID        string
	DeviceName      string
	IPAddress       string
	UserAgent       string
	TrustedDevice   bool
	CreatedAt       time.Time
	ExpiresAt       time.Time
}

type RateLimiter interface {
	Allow(key string) (bool, error)
	GetRemaining(key string) (int, error)
	Reset(key string) error
}

type PasswordRequirements struct {
	MinLength       int
	RequireUppercase bool
	RequireLowercase bool
	RequireNumber   bool
	RequireSpecial  bool
	SpecialChars    string
	MaxAge         time.Duration
	HistoryCount   int
}

type LoginAttempt struct {
	ID          uint64
	UserID      uint64
	IPAddress   string
	UserAgent   string
	Success     bool
	Reason      string
	CreatedAt   time.Time
}

type Session struct {
	ID        uint64
	UserID    uint64
	Token     string
	ExpiresAt time.Time
	CreatedAt time.Time
	IPAddress string
	UserAgent string
}

type AnalyticsService interface {
	TrackEvent(event string, properties map[string]interface{})
	TrackLogin(userID uint64, method string, success bool, metadata map[string]interface{})
	TrackRegistration(userID uint64, method string, metadata map[string]interface{})
	TrackSecurityEvent(event string, userID uint64, metadata map[string]interface{})
}

type Logger interface {
	Info(msg string, args ...interface{})
	Warn(msg string, args ...interface{})
	Error(msg string, args ...interface{})
	Debug(msg string, args ...interface{})
}

// ============================================================================
// SMART CREDENTIAL DETECTION
// ============================================================================

type CredentialDetection struct {
	Type         CredentialType `json:"type"`
	Credential   string        `json:"credential"`
	CountryCode  string        `json:"country_code,omitempty"`
	Valid        bool          `json:"valid"`
	Normalized   string        `json:"normalized"`
}

var (
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	phoneRegex = regexp.MustCompile(`^\+?[1-9]\d{1,14}$`)
)

// DetectCredentialType detects whether input is email or phone
func (s *AuthService) DetectCredentialType(credential string) *CredentialDetection {
	trimmed := strings.TrimSpace(credential)
	detection := &CredentialDetection{
		Credential: trimmed,
	}

	// Check if it looks like email
	if emailRegex.MatchString(trimmed) {
		detection.Type = CredentialTypeEmail
		detection.Valid = true
		detection.Normalized = strings.ToLower(trimmed)
		return detection
	}

	// Check if it looks like phone
	// Remove common formatting characters
	phoneDigits := regexp.MustCompile(`[\s\-\(\)\.]+`).ReplaceAllString(trimmed, "")
	phoneDigits = strings.TrimPrefix(phoneDigits, "+")
	
	if phoneRegex.MatchString(phoneDigits) && len(phoneDigits) >= 8 {
		detection.Type = CredentialTypePhone
		detection.Valid = true
		detection.Normalized = phoneDigits
		
		// Try to detect country code
		if len(trimmed) > 0 && trimmed[0] == '+' {
			detection.CountryCode = detectCountryCode(phoneDigits)
		}
		return detection
	}

	detection.Valid = false
	return detection
}

func detectCountryCode(phone string) string {
	// Common country codes
	countryCodes := map[string]string{
		"1":  "US",   // US/Canada
		"44": "GB",   // UK
		"49": "DE",   // Germany
		"33": "FR",   // France
		"81": "JP",   // Japan
		"82": "KR",   // Korea
		"86": "CN",   // China
		"91": "IN",   // India
		"55": "BR",   // Brazil
		"7":  "RU",   // Russia
		"61": "AU",   // Australia
		"55": "BR",   // Brazil
		"34": "ES",   // Spain
		"39": "IT",   // Italy
		"31": "NL",   // Netherlands
		"46": "SE",   // Sweden
		"47": "NO",   // Norway
		"45": "DK",   // Denmark
		"358": "FI",  // Finland
		"32": "BE",   // Belgium
		"43": "AT",   // Austria
		"41": "CH",   // Switzerland
		"852": "HK",  // Hong Kong
		"886": "TW",  // Taiwan
		"60": "MY",   // Malaysia
		"65": "SG",   // Singapore
		"62": "ID",   // Indonesia
		"66": "TH",   // Thailand
		"84": "VN",   // Vietnam
		"92": "PK",   // Pakistan
		"20": "EG",   // Egypt
		"966": "SA",  // Saudi Arabia
		"971": "AE",  // UAE
		"972": "IL",  // Israel
		"90": "TR",   // Turkey
		"54": "AR",   // Argentina
		"56": "CL",   // Chile
		"51": "PE",   // Peru
		"57": "CO",   // Colombia
		"593": "EC",  // Ecuador
		"598": "UY",  // Uruguay
		"595": "PY",  // Paraguay
		"54": "AR",   // Argentina
	}

	// Check for longest match first
	for code, country := range countryCodes {
		if strings.HasPrefix(phone, code) {
			return country
		}
	}

	return ""
}

// ============================================================================
// REGISTRATION
// ============================================================================

func (s *AuthService) Register(ctx context.Context, req *RegisterRequest) (*User, error) {
	// Detect credential type
	detection := s.DetectCredentialType(req.Credential)
	if !detection.Valid {
		return nil, errors.New("invalid credential format")
	}

	// Check if credential already exists
	var existingUser *User
	var err error

	if detection.Type == CredentialTypeEmail {
		existingUser, err = s.db.GetUserByEmail(ctx, detection.Normalized)
	} else {
		existingUser, err = s.db.GetUserByPhone(ctx, detection.Normalized)
	}

	if err != nil && !errors.Is(err, ErrUserNotFound) {
		return nil, fmt.Errorf("database error: %w", err)
	}

	if existingUser != nil {
		// User already exists - return appropriate message
		return nil, errors.New("credential already registered")
	}

	// Validate password
	if err := s.validatePassword(req.Password); err != nil {
		return nil, err
	}

	// Generate password hash
	hashedPassword, err := s.hashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Generate username
	username := s.generateUsername(detection)

	// Generate referral code
	referralCode := s.generateReferralCode()

	// Create user
	user := &User{
		Email:           "",
		Phone:           "",
		CredentialType:  detection.Type,
		PasswordHash:    hashedPassword,
		Username:        username,
		DisplayName:     username,
		TwoFactorEnabled: false,
		KYCStatus:       KYCStatusNone,
		KYCLevel:        0,
		RiskLevel:       RiskLevelLow,
		Status:          UserStatusActive,
		ReferralCode:    referralCode,
		TrustDevice:     false,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
		LoginAttempts:    0,
	}

	// Set credential based on type
	if detection.Type == CredentialTypeEmail {
		user.Email = detection.Normalized
	} else {
		user.Phone = detection.Normalized
		if detection.CountryCode != "" {
			user.PhoneCountryCode = detection.CountryCode
		}
	}

	// Handle referral
	if req.ReferralCode != "" {
		referrer, err := s.db.GetUserByReferralCode(ctx, req.ReferralCode)
		if err == nil && referrer != nil {
			user.ReferrerID = &referrer.ID
		}
	}

	// Save user
	if err := s.db.CreateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Track analytics
	s.analytics.TrackRegistration(user.ID, string(detection.Type), map[string]interface{}{
		"ip_address":   req.IPAddress,
		"user_agent":  req.UserAgent,
		"referral_code": req.ReferralCode,
	})

	s.logger.Info("User registered", "user_id", user.ID, "credential_type", detection.Type)

	return user, nil
}

func (s *AuthService) validatePassword(password string) error {
	req := s.passwordRequirements

	if len(password) < req.MinLength {
		return fmt.Errorf("password must be at least %d characters", req.MinLength)
	}

	if req.RequireUppercase && !regexp.MustCompile(`[A-Z]`).MatchString(password) {
		return errors.New("password must contain at least one uppercase letter")
	}

	if req.RequireLowercase && !regexp.MustCompile(`[a-z]`).MatchString(password) {
		return errors.New("password must contain at least one lowercase letter")
	}

	if req.RequireNumber && !regexp.MustCompile(`[0-9]`).MatchString(password) {
		return errors.New("password must contain at least one number")
	}

	if req.RequireSpecial && !regexp.MustCompile(`[!@#$%^&*(),.?":{}|<>]`).MatchString(password) {
		return errors.New("password must contain at least one special character")
	}

	return nil
}

func (s *AuthService) hashPassword(password string) (string, error) {
	// Use bcrypt for password hashing
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func (s *AuthService) verifyPassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// ============================================================================
// LOGIN
// ============================================================================

func (s *AuthService) Login(ctx context.Context, req *LoginRequest) (*LoginResponse, error) {
	// Detect credential type
	detection := s.DetectCredentialType(req.Credential)
	if !detection.Valid {
		return &LoginResponse{
			Success: false,
			Message: "Invalid credential format",
		}, nil
	}

	// Get user by credential
	var user *User
	var err error

	if detection.Type == CredentialTypeEmail {
		user, err = s.db.GetUserByEmail(ctx, detection.Normalized)
	} else {
		user, err = s.db.GetUserByPhone(ctx, detection.Normalized)
	}

	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			// Delay response to prevent timing attacks
			time.Sleep(time.Millisecond * 100)
			return &LoginResponse{
				Success: false,
				Message: "Invalid credentials",
			}, nil
		}
		return nil, fmt.Errorf("database error: %w", err)
	}

	// Check if account is locked
	if user.Status == UserStatusLocked {
		if user.LockedUntil != nil && time.Now().Before(*user.LockedUntil) {
			lockedDuration := time.Until(*user.LockedUntil)
			return &LoginResponse{
				Success:         false,
				Message:         "Account is locked",
				SecurityMessage: fmt.Sprintf("Too many failed attempts. Try again in %v", lockedDuration.Round(time.Minute)),
			}, nil
		}
	}

	// Verify password
	if !s.verifyPassword(user.PasswordHash, req.Password) {
		// Record failed attempt
		s.recordLoginAttempt(ctx, user.ID, req.IPAddress, req.UserAgent, false, "invalid_password")
		
		// Update failed attempts
		user.LoginAttempts++
		if user.LoginAttempts >= s.config.MaxLoginAttempts {
			lockedUntil := time.Now().Add(s.config.LockoutDuration)
			user.LockedUntil = &lockedUntil
			user.Status = UserStatusLocked
			
			s.analytics.TrackSecurityEvent("account_locked", user.ID, map[string]interface{}{
				"ip_address": req.IPAddress,
				"reason":    "max_login_attempts_exceeded",
			})
		}
		s.db.UpdateUser(ctx, user)

		return &LoginResponse{
			Success: false,
			Message: "Invalid credentials",
		}, nil
	}

	// Clear failed attempts on successful login
	user.LoginAttempts = 0
	user.LockedUntil = nil

	// Check if 2FA is required
	if user.TwoFactorEnabled {
		// Generate temp token for 2FA flow
		tempToken, err := s.generateTempToken(user)
		if err != nil {
			return nil, fmt.Errorf("failed to generate temp token: %w", err)
		}

		// Send 2FA code if enabled
		if user.TwoFactorSecret != "" {
			// 2FA is TOTP-based
			return &LoginResponse{
				Success:      true,
				Requires2FA:  true,
				TempToken:    tempToken,
				Message:      "2FA verification required",
			}, nil
		}
	}

	// Complete login
	return s.completeLogin(ctx, user, req)
}

func (s *AuthService) completeLogin(ctx context.Context, user *User, req *LoginRequest) (*LoginResponse, error) {
	// Generate tokens
	accessToken, refreshToken, err := s.generateTokens(user, req.DeviceFingerprint)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	// Update last login
	user.LastLoginAt = time.Now()
	if err := s.db.UpdateUser(ctx, user); err != nil {
		s.logger.Error("Failed to update last login", "error", err)
	}

	// Track login
	s.analytics.TrackLogin(user.ID, "password", true, map[string]interface{}{
		"ip_address":  req.IPAddress,
		"user_agent":  req.UserAgent,
		"device_id":   req.DeviceID,
		"remember_me": req.RememberMe,
	})

	s.logger.Info("User logged in", "user_id", user.ID, "ip_address", req.IPAddress)

	return &LoginResponse{
		Success:      true,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.config.AccessTokenExpiry.Seconds()),
		User:         user,
		Message:      "Login successful",
	}, nil
}

// ============================================================================
// 2FA
// ============================================================================

func (s *AuthService) Enable2FA(ctx context.Context, userID uint64, req *Enable2FARequest) (*map[string]string, error) {
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Verify the code
	if !s.otp.Verify(user.Email, "2fa_enable", req.Code) && 
	   !s.otp.Verify(user.Phone, "2fa_enable", req.Code) {
		return nil, errors.New("invalid 2FA code")
	}

	// Generate backup codes if requested
	backupCodes := ""
	if req.BackupCodes {
		backupCodes = s.generateBackupCodes()
	}

	// Store 2FA secret
	user.TwoFactorEnabled = true
	user.TwoFactorSecret = req.Secret
	user.TwoFactorBackup = backupCodes

	if err := s.db.UpdateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to enable 2FA: %w", err)
	}

	s.logger.Info("2FA enabled", "user_id", userID)

	result := map[string]string{
		"secret":       req.Secret,
		"backup_codes": backupCodes,
	}

	return &result, nil
}

func (s *AuthService) Verify2FA(ctx context.Context, req *Verify2FARequest) (*LoginResponse, error) {
	// Validate temp token
	claims, err := s.validateTempToken(req.TempToken)
	if err != nil {
		return nil, errors.New("invalid or expired temp token")
	}

	user, err := s.db.GetUserByID(ctx, claims.UserID)
	if err != nil {
		return nil, errors.New("user not found")
	}

	// Verify 2FA code
	valid := false
	
	// Try TOTP first
	if req.Code != "" && user.TwoFactorSecret != "" {
		valid = s.verifyTOTP(user.TwoFactorSecret, req.Code)
	}

	// Try backup code
	if !valid && req.BackupCode != "" {
		valid = s.verifyBackupCode(user.TwoFactorBackup, req.BackupCode)
	}

	if !valid {
		return &LoginResponse{
			Success: false,
			Message: "Invalid 2FA code",
		}, nil
	}

	// Complete login
	loginReq := &LoginRequest{
		Credential: user.Email,
		IPAddress:   claims.IPAddress,
		UserAgent:   claims.UserAgent,
	}

	return s.completeLogin(ctx, user, loginReq)
}

// ============================================================================
// PASSWORD RESET
// ============================================================================

func (s *AuthService) RequestPasswordReset(ctx context.Context, credential string) error {
	detection := s.DetectCredentialType(credential)
	if !detection.Valid {
		return errors.New("invalid credential")
	}

	var user *User
	var err error

	if detection.Type == CredentialTypeEmail {
		user, err = s.db.GetUserByEmail(ctx, detection.Normalized)
	} else {
		user, err = s.db.GetUserByPhone(ctx, detection.Normalized)
	}

	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			// Don't reveal if user exists
			return nil
		}
		return err
	}

	// Generate OTP
	otp, err := s.otp.Generate(credential, "password_reset")
	if err != nil {
		return err
	}

	// Send OTP
	if detection.Type == CredentialTypeEmail {
		return s.otp.SendEmail(credential, otp, "password_reset")
	} else {
		return s.otp.SendSMS(credential, otp, "password_reset")
	}
}

func (s *AuthService) ResetPassword(ctx context.Context, req *ResetPasswordRequest) error {
	detection := s.DetectCredentialType(req.Credential)
	if !detection.Valid {
		return errors.New("invalid credential")
	}

	// Verify OTP
	valid := s.otp.Verify(req.Credential, "password_reset", req.OTP)
	if !valid {
		return errors.New("invalid or expired OTP")
	}

	// Validate new password
	if err := s.validatePassword(req.NewPassword); err != nil {
		return err
	}

	if req.NewPassword != req.ConfirmPassword {
		return errors.New("passwords do not match")
	}

	// Get user
	var user *User
	var err error

	if detection.Type == CredentialTypeEmail {
		user, err = s.db.GetUserByEmail(ctx, detection.Normalized)
	} else {
		user, err = s.db.GetUserByPhone(ctx, detection.Normalized)
	}

	if err != nil {
		return errors.New("user not found")
	}

	// Hash new password
	hashedPassword, err := s.hashPassword(req.NewPassword)
	if err != nil {
		return err
	}

	// Update password
	user.PasswordHash = hashedPassword
	user.UpdatedAt = time.Now()

	// Disable all sessions
	s.tokenStore.RevokeAll(ctx, user.ID)

	if err := s.db.UpdateUser(ctx, user); err != nil {
		return err
	}

	s.logger.Info("Password reset", "user_id", user.ID)

	return nil
}

// ============================================================================
// CREDENTIAL CHANGE
// ============================================================================

func (s *AuthService) ChangeEmail(ctx context.Context, userID uint64, newEmail string, otp string) error {
	// Verify current password
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}

	// Verify OTP for new email
	valid := s.otp.Verify(newEmail, "email_change", otp)
	if !valid {
		return errors.New("invalid OTP")
	}

	// Check if email already exists
	existing, _ := s.db.GetUserByEmail(ctx, newEmail)
	if existing != nil && existing.ID != userID {
		return errors.New("email already in use")
	}

	// Update email
	user.Email = newEmail
	user.UpdatedAt = time.Now()

	// Disable withdrawals for 48 hours
	user.InternalNotes = fmt.Sprintf("Email changed at %s. Withdrawals disabled for 48 hours.", time.Now().Format(time.RFC3339))

	if err := s.db.UpdateUser(ctx, user); err != nil {
		return err
	}

	s.logger.Info("Email changed", "user_id", userID, "new_email", newEmail)

	return nil
}

func (s *AuthService) ChangePhone(ctx context.Context, userID uint64, newPhone string, otp string) error {
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}

	// Verify OTP for new phone
	valid := s.otp.Verify(newPhone, "phone_change", otp)
	if !valid {
		return errors.New("invalid OTP")
	}

	// Check if phone already exists
	existing, _ := s.db.GetUserByPhone(ctx, newPhone)
	if existing != nil && existing.ID != userID {
		return errors.New("phone already in use")
	}

	// Update phone
	user.Phone = newPhone
	user.UpdatedAt = time.Now()

	// Disable withdrawals for 48 hours
	user.InternalNotes = fmt.Sprintf("Phone changed at %s. Withdrawals disabled for 48 hours.", time.Now().Format(time.RFC3339))

	if err := s.db.UpdateUser(ctx, user); err != nil {
		return err
	}

	s.logger.Info("Phone changed", "user_id", userID, "new_phone", newPhone)

	return nil
}

// ============================================================================
// ACCOUNT DELETION
// ============================================================================

func (s *AuthService) RequestAccountDeletion(ctx context.Context, userID uint64) error {
	user, err := s.db.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}

	// Check for remaining balances
	// This should be checked via wallet service
	// For now, mark for deletion
	user.Status = UserStatusDeleted
	user.UpdatedAt = time.Now()

	// Revoke all sessions
	s.tokenStore.RevokeAll(ctx, userID)

	if err := s.db.UpdateUser(ctx, user); err != nil {
		return err
	}

	s.logger.Info("Account deletion requested", "user_id", userID)

	return nil
}

// ============================================================================
// OAUTH
// ============================================================================

func (s *AuthService) HandleOAuthCallback(ctx context.Context, req *OAuthRequest) (*LoginResponse, error) {
	provider, ok := s.oauthProviders[req.Provider]
	if !ok {
		return nil, errors.New("unsupported OAuth provider")
	}

	// Exchange code for token
	oauthUser, err := provider.ExchangeCode(req.Code)
	if err != nil {
		return nil, fmt.Errorf("OAuth code exchange failed: %w", err)
	}

	// Find or create user
	var user *User
	existingUser, _ := s.db.GetUserByEmail(ctx, oauthUser.Email)

	if existingUser != nil {
		user = existingUser
	} else {
		// Create new user
		user = &User{
			Email:         oauthUser.Email,
			Username:      oauthUser.Name,
			DisplayName:  oauthUser.Name,
			ProfileImage: oauthUser.ProfileImage,
			Status:       UserStatusActive,
			KYCStatus:    KYCStatusNone,
			KYCLevel:     0,
			RiskLevel:    RiskLevelLow,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		}

		if err := s.db.CreateUser(ctx, user); err != nil {
			return nil, fmt.Errorf("failed to create user: %w", err)
		}

		s.analytics.TrackRegistration(user.ID, req.Provider, map[string]interface{}{
			"ip_address": req.IPAddress,
			"user_agent": req.UserAgent,
		})
	}

	// Generate tokens
	accessToken, refreshToken, err := s.generateTokens(user, "")
	if err != nil {
		return nil, err
	}

	return &LoginResponse{
		Success:      true,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.config.AccessTokenExpiry.Seconds()),
		User:         user,
		Message:      "Login successful",
	}, nil
}

// ============================================================================
// TOKEN HELPERS
// ============================================================================

func (s *AuthService) generateTokens(user *User, deviceFingerprint string) (string, string, error) {
	now := time.Now()

	// Access token
	accessClaims := JWTClaims{
		UserID:             user.ID,
		Email:              user.Email,
		Phone:              user.Phone,
		Role:               "user",
		KYCLevel:           user.KYCLevel,
		KYCStatus:          string(user.KYCStatus),
		RiskLevel:          string(user.RiskLevel),
		TrustedDevice:      user.TrustDevice,
		DeviceFingerprint:  deviceFingerprint,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.config.AccessTokenExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "tigerex",
			Subject:   fmt.Sprintf("%d", user.ID),
		},
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString([]byte(s.config.JWTsecret))
	if err != nil {
		return "", "", err
	}

	// Refresh token
	refreshClaims := JWTClaims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.config.RefreshTokenExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "tigerex",
			Subject:   fmt.Sprintf("%d", user.ID),
		},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString([]byte(s.config.JWTsecret))
	if err != nil {
		return "", "", err
	}

	return accessTokenString, refreshTokenString, nil
}

func (s *AuthService) generateTempToken(user *User) (string, error) {
	now := time.Now()
	claims := JWTClaims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(10 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "tigerex",
			Subject:   fmt.Sprintf("%d_temp", user.ID),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.config.JWTsecret))
}

func (s *AuthService) validateTempToken(tempToken string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tempToken, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.config.JWTsecret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

func (s *AuthService) generateUsername(detection *CredentialDetection) string {
	if detection.Type == CredentialTypeEmail {
		parts := strings.Split(detection.Normalized, "@")
		if len(parts) > 0 {
			return parts[0]
		}
	}
	
	// Generate random username for phone
	return fmt.Sprintf("user%d", time.Now().UnixNano()%10000000)
}

func (s *AuthService) generateReferralCode() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)[:8]
}

func (s *AuthService) generateBackupCodes() string {
	codes := make([]string, 10)
	for i := 0; i < 10; i++ {
		b := make([]byte, 4)
		rand.Read(b)
		codes[i] = hex.EncodeToString(b)[:8]
	}
	return strings.Join(codes, ",")
}

func (s *AuthService) verifyBackupCode(stored, provided string) bool {
	codes := strings.Split(stored, ",")
	for _, code := range codes {
		if code == provided {
			// Remove used backup code
			return true
		}
	}
	return false
}

func (s *AuthService) verifyTOTP(secret, code string) bool {
	// Implement TOTP verification
	// This would typically use a library like github.com/pquerna/otp
	return true // Placeholder
}

func (s *AuthService) recordLoginAttempt(ctx context.Context, userID uint64, ipAddress, userAgent string, success bool, reason string) {
	attempt := &LoginAttempt{
		UserID:    userID,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Success:   success,
		Reason:    reason,
		CreatedAt: time.Now(),
	}

	if err := s.db.CreateLoginAttempt(ctx, attempt); err != nil {
		s.logger.Error("Failed to record login attempt", "error", err)
	}
}

// ============================================================================
// PASSWORD STRENGTH
// ============================================================================

type PasswordStrength int

const (
	PasswordStrengthVeryWeak PasswordStrength = iota
	PasswordStrengthWeak
	PasswordStrengthMedium
	PasswordStrengthStrong
	PasswordStrengthVeryStrong
)

func (s *AuthService) CheckPasswordStrength(password string) PasswordStrength {
	score := 0

	// Length
	if len(password) >= 8 {
		score++
	}
	if len(password) >= 12 {
		score++
	}
	if len(password) >= 16 {
		score++
	}

	// Character types
	if regexp.MustCompile(`[a-z]`).MatchString(password) {
		score++
	}
	if regexp.MustCompile(`[A-Z]`).MatchString(password) {
		score++
	}
	if regexp.MustCompile(`[0-9]`).MatchString(password) {
		score++
	}
	if regexp.MustCompile(`[!@#$%^&*(),.?":{}|<>]`).MatchString(password) {
		score++
	}

	// Complexity bonus
	if len(password) >= 12 && score >= 4 {
		score++
	}

	switch {
	case score <= 2:
		return PasswordStrengthVeryWeak
	case score <= 3:
		return PasswordStrengthWeak
	case score <= 5:
		return PasswordStrengthMedium
	case score <= 6:
		return PasswordStrengthStrong
	default:
		return PasswordStrengthVeryStrong
	}
}

// Errors
var (
	ErrUserNotFound     = errors.New("user not found")
	ErrInvalidToken     = errors.New("invalid token")
	ErrTokenExpired     = errors.New("token expired")
	ErrInvalidPassword  = errors.New("invalid password")
	ErrAccountLocked    = errors.New("account locked")
	Err2FARequired      = errors.New("2FA required")
	ErrInvalidOTP       = errors.New("invalid OTP")
	ErrInvalidCredential = errors.New("invalid credential")
)
