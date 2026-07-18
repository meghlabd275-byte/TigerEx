package auth_service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"
	
	"golang.org/x/crypto/bcrypt"
	"github.com/pquerna/otp/totp"
)

const (
	MinPasswordLength = 8
	MaxPasswordLength = 128
	BcryptCost = 12
	SessionDuration = 24 * time.Hour
	MaxFailedAttempts = 5
	LockoutDuration = 15 * time.Minute
	RefreshTokenDuration = 7 * 24 * time.Hour
)

var (
	ErrInvalidEmail       = errors.New("invalid email format")
	ErrInvalidPassword    = errors.New("password does not meet requirements")
	ErrWeakPassword       = errors.New("password is too weak")
	ErrAccountLocked      = errors.New("account is temporarily locked")
	ErrInvalidToken       = errors.New("invalid or expired token")
	ErrInvalidCredentials = errors.New("invalid email or password")
)

type User struct {
	ID                 string    `json:"id"`
	Email              string    `json:"email"`
	PasswordHash       string    `json:"-"`
	TwoFactorSecret    string    `json:"-"`
	TwoFactorEnabled   bool      `json:"two_factor_enabled"`
	KYCLevel           int       `json:"kyc_level"`
	Status             string    `json:"status"`
	FailedLoginAttempts int      `json:"failed_login_attempts"`
	LockedUntil        time.Time `json:"locked_until"`
	CreatedAt          time.Time `json:"created_at"`
}

type Session struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	TokenHash      string    `json:"-"`
	RefreshToken   string    `json:"refresh_token"`
	IPAddress      string    `json:"ip_address"`
	UserAgent      string    `json:"user_agent"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
}

type ApiKey struct {
	ID          string   `json:"id"`
	UserID      string   `json:"user_id"`
	KeyID       string   `json:"key_id"`
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
	IPWhitelist []string `json:"ip_whitelist"`
	RateLimit   int      `json:"rate_limit"`
	LastUsedAt  time.Time `json:"last_used_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type AuthRequest struct {
	Email           string `json:"email"`
	Password        string `json:"password"`
	TwoFactorCode   string `json:"two_factor_code,omitempty"`
}

type AuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
	User         *User  `json:"user,omitempty"`
}

type RegisterRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	ConfirmPass string `json:"confirm_password"`
	ReferralCode string `json:"referral_code,omitempty"`
}

type PasswordResetRequest struct {
	Email string `json:"email"`
}

type PasswordUpdateRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type EmailVerification struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

func GenerateSecureToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}

func HashPassword(password string) (string, error) {
	if err := ValidatePasswordStrength(password); err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func VerifyPassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func HashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return base64.URLEncoding.EncodeToString(hash[:])
}

func ValidateEmail(email string) error {
	if len(email) < 3 || len(email) > 255 {
		return ErrInvalidEmail
	}
	atIndex := -1
	dotIndex := -1
	for i, ch := range email {
		if ch == '@' {
			if atIndex != -1 {
				return ErrInvalidEmail
			}
			atIndex = i
		}
		if ch == '.' && atIndex != -1 {
			dotIndex = i
		}
	}
	if atIndex < 1 || dotIndex < atIndex+2 || dotIndex >= len(email)-1 {
		return ErrInvalidEmail
	}
	return nil
}

func ValidatePasswordStrength(password string) error {
	if len(password) < MinPasswordLength {
		return ErrWeakPassword
	}
	if len(password) > MaxPasswordLength {
		return ErrWeakPassword
	}
	hasUpper := false
	hasLower := false
	hasDigit := false
	hasSpecial := false
	for _, ch := range password {
		switch {
		case ch >= 'A' && ch <= 'Z':
			hasUpper = true
		case ch >= 'a' && ch <= 'z':
			hasLower = true
		case ch >= '0' && ch <= '9':
			hasDigit = true
		case ch == '!' || ch == '@' || ch == '#' || ch == '$' || ch == '%' || 
			ch == '^' || ch == '&' || ch == '*' || ch == '(' || ch == ')' ||
			ch == '-' || ch == '_' || ch == '+' || ch == '=':
			hasSpecial = true
		}
	}
	strengthScore := 0
	if hasUpper {
		strengthScore++
	}
	if hasLower {
		strengthScore++
	}
	if hasDigit {
		strengthScore++
	}
	if hasSpecial {
		strengthScore++
	}
	if strengthScore < 3 {
		return ErrWeakPassword
	}
	return nil
}

func (u *User) IsLocked() bool {
	return u.LockedUntil.After(time.Now())
}

func (u *User) IncrementFailedAttempts() {
	u.FailedLoginAttempts++
	if u.FailedLoginAttempts >= MaxFailedAttempts {
		u.LockedUntil = time.Now().Add(LockoutDuration)
	}
}

func (u *User) ResetFailedAttempts() {
	u.FailedLoginAttempts = 0
	u.LockedUntil = time.Time{}
}

func (u *User) SetTwoFactorSecret(secret string) {
	u.TwoFactorSecret = secret
}

func (u *User) EnableTwoFactor() {
	u.TwoFactorEnabled = true
}

func (u *User) DisableTwoFactor() {
	u.TwoFactorEnabled = false
	u.TwoFactorSecret = ""
}

func (u *User) VerifyTwoFactorCode(code string) bool {
	return ValidateTOTPCode(u.TwoFactorSecret, code)
}

func (u *User) CanLogin() error {
	if u.Status == "locked" {
		return ErrAccountLocked
	}
	if u.Status == "suspended" {
		return errors.New("account is suspended")
	}
	if u.Status == "closed" {
		return errors.New("account is closed")
	}
	if u.IsLocked() {
		return ErrAccountLocked
	}
	return nil
}

func (s *Session) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

func GenerateAPIKey() (keyID, keySecret string, err error) {
	keyIDBytes := make([]byte, 16)
	if _, err := rand.Read(keyIDBytes); err != nil {
		return "", "", err
	}
	keyID = "TX" + base64.URLEncoding.EncodeToString(keyIDBytes)
	keySecretBytes := make([]byte, 32)
	if _, err := rand.Read(keySecretBytes); err != nil {
		return "", "", err
	}
	keySecret = base64.URLEncoding.EncodeToString(keySecretBytes)
	return keyID, keySecret, nil
}

type Permission string

const (
	PermReadMarket   Permission = "read:market"
	PermTrade        Permission = "trade"
	PermWithdraw     Permission = "withdraw"
	PermDeposit      Permission = "deposit"
	PermTransfer     Permission = "transfer"
	PermReadAccount  Permission = "read:account"
	PermWriteAccount Permission = "write:account"
	PermReadHistory  Permission = "read:history"
	PermAdmin        Permission = "admin"
)

func ValidatePermissions(perms []string) bool {
	validPerms := map[Permission]bool{
		PermReadMarket:   true,
		PermTrade:        true,
		PermWithdraw:     true,
		PermDeposit:      true,
		PermTransfer:     true,
		PermReadAccount:  true,
		PermWriteAccount: true,
		PermReadHistory:  true,
		PermAdmin:        true,
	}
	for _, p := range perms {
		if !validPerms[Permission(p)] {
			return false
		}
	}
	return true
}
