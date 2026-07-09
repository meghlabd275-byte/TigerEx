package models

import (
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// UserStatus represents the status of a user account
type UserStatus string

const (
	UserStatusPending   UserStatus = "pending"
	UserStatusActive    UserStatus = "active"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusBanned    UserStatus = "banned"
	UserStatusClosed    UserStatus = "closed"
)

// KYCLevel represents the KYC verification level
type KYCLevel string

const (
	KYCLevelNone         KYCLevel = "none"
	KYCLevelBasic        KYCLevel = "basic"
	KYCLevelIntermediate KYCLevel = "intermediate"
	KYCLevelFull         KYCLevel = "full"
	KYCLevelInstitution  KYCLevel = "institution"
)

// User represents a user in the system
type User struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	Email          string     `json:"email" db:"email"`
	Username       string     `json:"username" db:"username"`
	PasswordHash   string     `json:"-" db:"password_hash"`
	Phone          *string    `json:"phone,omitempty" db:"phone"`
	Country        string     `json:"country" db:"country"`
	KYCLevel       KYCLevel   `json:"kyc_level" db:"kyc_level"`
	Status         UserStatus `json:"status" db:"status"`
	RiskLevel      int        `json:"risk_level" db:"risk_level"`
	ReferralCode   *string    `json:"referral_code,omitempty" db:"referral_code"`
	ReferredBy     *uuid.UUID `json:"referred_by,omitempty" db:"referred_by"`
	DepositEnabled  bool       `json:"deposit_enabled" db:"deposit_enabled"`
	WithdrawalEnabled bool     `json:"withdrawal_enabled" db:"withdrawal_enabled"`
	TradingEnabled  bool       `json:"trading_enabled" db:"trading_enabled"`
	OTPSecret      *string    `json:"-" db:"otp_secret"`
	OTPEnabled     bool       `json:"otp_enabled" db:"otp_enabled"`
	AntiPhishingCode *string `json:"anti_phishing_code,omitempty" db:"anti_phishing_code"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at" db:"updated_at"`
	LastLoginAt    *time.Time `json:"last_login_at,omitempty" db:"last_login_at"`
	LastLoginIP    *string    `json:"last_login_ip,omitempty" db:"last_login_ip"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty" db:"email_verified_at"`
	PhoneVerifiedAt *time.Time `json:"phone_verified_at,omitempty" db:"phone_verified_at"`
	BannedAt       *time.Time `json:"banned_at,omitempty" db:"banned_at"`
	BanReason      *string    `json:"ban_reason,omitempty" db:"ban_reason"`
}

// SetPassword sets the user's password with bcrypt hashing
func (u *User) SetPassword(password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hash)
	return nil
}

// CheckPassword verifies the user's password
func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// IsActive checks if the user is active
func (u *User) IsActive() bool {
	return u.Status == UserStatusActive
}

// CanTrade checks if the user can trade
func (u *User) CanTrade() bool {
	return u.IsActive() && u.TradingEnabled
}

// CanWithdraw checks if the user can withdraw
func (u *User) CanWithdraw() bool {
	return u.IsActive() && u.WithdrawalEnabled
}

// CanDeposit checks if the user can deposit
func (u *User) CanDeposit() bool {
	return u.IsActive() && u.DepositEnabled
}

// UserSession represents a user session
type UserSession struct {
	ID           uuid.UUID `json:"id" db:"id"`
	UserID       uuid.UUID `json:"user_id" db:"user_id"`
	SessionToken string    `json:"session_token" db:"session_token"`
	RefreshToken *string   `json:"refresh_token,omitempty" db:"refresh_token"`
	IPAddress    string    `json:"ip_address" db:"ip_address"`
	UserAgent    *string  `json:"user_agent,omitempty" db:"user_agent"`
	DeviceID     *string  `json:"device_id,omitempty" db:"device_id"`
	ExpiresAt    time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	LastActivityAt time.Time `json:"last_activity_at" db:"last_activity_at"`
}

// APIKey represents an API key for programmatic access
type APIKey struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	UserID      uuid.UUID  `json:"user_id" db:"user_id"`
	KeyHash     string     `json:"-" db:"key_hash"`
	SecretHash  *string    `json:"-" db:"secret_hash"`
	Name        string     `json:"name" db:"name"`
	Permissions []string   `json:"permissions" db:"permissions"`
	IPWhitelist *string    `json:"ip_whitelist,omitempty" db:"ip_whitelist"`
	Enabled     bool       `json:"enabled" db:"enabled"`
	LastUsedAt  *time.Time `json:"last_used_at,omitempty" db:"last_used_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// LoginAttempt tracks login attempts for security
type LoginAttempt struct {
	ID        uuid.UUID `json:"id" db:"id"`
	UserID    *uuid.UUID `json:"user_id,omitempty" db:"user_id"`
	Email     string    `json:"email" db:"email"`
	IPAddress string    `json:"ip_address" db:"ip_address"`
	Success   bool      `json:"success" db:"success"`
	Reason    *string   `json:"reason,omitempty" db:"reason"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// RefreshToken represents a JWT refresh token
type RefreshToken struct {
	ID        uuid.UUID `json:"id" db:"id"`
	UserID    uuid.UUID `json:"user_id" db:"user_id"`
	Token     string    `json:"token" db:"token"`
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// PasswordReset represents a password reset request
type PasswordReset struct {
	ID        uuid.UUID `json:"id" db:"id"`
	UserID    uuid.UUID `json:"user_id" db:"user_id"`
	Token     string    `json:"token" db:"token"`
	Used      bool      `json:"used" db:"used"`
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UsedAt    *time.Time `json:"used_at,omitempty" db:"used_at"`
}

// EmailVerification represents an email verification token
type EmailVerification struct {
	ID        uuid.UUID `json:"id" db:"id"`
	UserID    uuid.UUID `json:"user_id" db:"user_id"`
	Token     string    `json:"token" db:"token"`
	Used      bool      `json:"used" db:"used"`
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UsedAt    *time.Time `json:"used_at,omitempty" db:"used_at"`
}
