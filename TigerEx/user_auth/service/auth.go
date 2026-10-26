// Package service provides authentication and security services.
package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// RegisterRequest is the payload for RegisterUser.
type RegisterRequest struct {
	Email        string `json:"email"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	ConfirmPass  string `json:"confirm_password"`
	Country      string `json:"country"`
	ReferralCode string `json:"referral_code,omitempty"`
}

// LoginRequest is the payload for Login.
type LoginRequest struct {
	// Email accepts either an email address or a username.
	Email     string `json:"email"`
	Password  string `json:"password"`
	IP        string `json:"ip"`
	UserAgent string `json:"user_agent"`
}

// AuthService handles authentication
type AuthService struct {
	mu        sync.RWMutex
	users     map[string]*User
	sessions  map[string]*Session
	policies  map[string]*PasswordPolicy
	otpSecret []byte
	// passwordResets holds single-use reset tokens keyed by user id.
	passwordResets map[string]*passwordReset
	// loginAttempts records authentication attempts for auditing. It is
	// guarded by attemptMu because callers append to it while already
	// holding as.mu.
	loginAttempts []*LoginAttempt
	attemptMu     sync.Mutex
	db            *sql.DB
}

// PasswordPolicy defines password requirements
type PasswordPolicy struct {
	MinLength      int  `json:"min_length"`
	RequireUpper   bool `json:"require_upper"`
	RequireLower   bool `json:"require_lower"`
	RequireNumber  bool `json:"require_number"`
	RequireSpecial bool `json:"require_special"`
	ExpiryDays     int  `json:"expiry_days"`
	HistoryCount   int  `json:"history_count"`
}

// User represents a user
type User struct {
	ID               string         `json:"id" db:"id"`
	Email            string         `json:"email" db:"email"`
	Username         string         `json:"username" db:"username"`
	PasswordHash     string         `json:"-" db:"password_hash"`
	PasswordSalt     string         `json:"-" db:"password_salt"`
	TwoFactorSecret  sql.NullString `json:"-" db:"two_factor_secret"`
	TwoFactorEnabled bool           `json:"two_factor_enabled" db:"two_factor_enabled"`
	KYCStatus        string         `json:"kyc_status" db:"kyc_status"`
	KYCLevel         int            `json:"kyc_level" db:"kyc_level"`
	Status           string         `json:"status" db:"status"`
	Country          string         `json:"country" db:"country"`
	ReferralCode     string         `json:"referral_code" db:"referral_code"`
	ReferrerID       sql.NullString `json:"referrer_id" db:"referrer_id"`
	CreatedAt        time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at" db:"updated_at"`
	LastLoginAt      sql.NullTime   `json:"last_login_at" db:"last_login_at"`
	LockedUntil      sql.NullTime   `json:"locked_until" db:"locked_until"`
	LoginAttempts    int            `json:"login_attempts" db:"login_attempts"`
}

// Session represents an authenticated session
type Session struct {
	ID           string    `json:"id" db:"id"`
	UserID       string    `json:"user_id" db:"user_id"`
	Token        string    `json:"token" db:"token"`
	RefreshToken string    `json:"refresh_token" db:"refresh_token"`
	IPAddress    string    `json:"ip_address" db:"ip_address"`
	UserAgent    string    `json:"user_agent" db:"user_agent"`
	ExpiresAt    time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	LastActivity time.Time `json:"last_activity" db:"last_activity"`
}

// JWTClaims represents JWT claims
type JWTClaims struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	Username  string `json:"username"`
	SessionID string `json:"session_id"`
	jwt.RegisteredClaims
}

// Device represents a trusted device
type Device struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	DeviceType  string    `json:"device_type"`
	Browser     string    `json:"browser"`
	OS          string    `json:"os"`
	IPAddress   string    `json:"ip_address"`
	Fingerprint string    `json:"fingerprint"`
	LastUsed    time.Time `json:"last_used"`
	Trusted     bool      `json:"trusted"`
}

// LoginAttempt records failed login attempts
type LoginAttempt struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	IPAddress string    `json:"ip_address"`
	Success   bool      `json:"success"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"created_at"`
}

// TwoFactorType represents 2FA method
type TwoFactorType string

const (
	TwoFactorNone  TwoFactorType = ""
	TwoFactorTOTP  TwoFactorType = "TOTP"
	TwoFactorSMS   TwoFactorType = "SMS"
	TwoFactorEmail TwoFactorType = "EMAIL"
)

// NewAuthService creates a new auth service
func NewAuthService() *AuthService {
	return &AuthService{
		users:          make(map[string]*User),
		sessions:       make(map[string]*Session),
		policies:       defaultPolicies(),
		passwordResets: make(map[string]*passwordReset),
	}
}

func defaultPolicies() map[string]*PasswordPolicy {
	return map[string]*PasswordPolicy{
		"default": {
			MinLength:      8,
			RequireUpper:   true,
			RequireLower:   true,
			RequireNumber:  true,
			RequireSpecial: false,
			ExpiryDays:     90,
			HistoryCount:   5,
		},
	}
}

// RegisterUser registers a new user
func (as *AuthService) RegisterUser(ctx context.Context, req *RegisterRequest) (*User, error) {
	// Validate email
	if !isValidEmail(req.Email) {
		return nil, fmt.Errorf("invalid email address")
	}

	// Validate password
	if err := as.validatePassword(req.Password, "default"); err != nil {
		return nil, err
	}

	// Check existing user
	as.mu.RLock()
	for _, u := range as.users {
		if u.Email == req.Email {
			as.mu.RUnlock()
			return nil, fmt.Errorf("email already registered")
		}
	}
	as.mu.RUnlock()

	// Hash password
	salt := generateSalt()
	hash, err := hashPassword(req.Password, salt)
	if err != nil {
		return nil, err
	}

	// Generate unique ID
	userID := generateUserID()

	user := &User{
		ID:           userID,
		Email:        req.Email,
		Username:     req.Username,
		PasswordHash: hash,
		PasswordSalt: salt,
		Status:       "active",
		ReferralCode: generateReferralCode(),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	as.mu.Lock()
	as.users[userID] = user
	as.mu.Unlock()

	return user, nil
}

// Login authenticates a user
func (as *AuthService) Login(ctx context.Context, req *LoginRequest) (*Session, *User, error) {
	as.mu.Lock()
	defer as.mu.Unlock()

	var user *User
	var userID string

	// Find user by email or username
	for _, u := range as.users {
		if u.Email == req.Email || u.Username == req.Email {
			user = u
			userID = u.ID
			break
		}
	}

	if user == nil {
		// Record failed attempt
		as.recordLoginAttempt(ctx, req.Email, req.IP, false, "user_not_found")
		return nil, nil, fmt.Errorf("invalid credentials")
	}

	// Check locked
	if user.LockedUntil.Valid && user.LockedUntil.Time.After(time.Now()) {
		return nil, nil, fmt.Errorf("account locked until %s", user.LockedUntil.Time.Format(time.RFC3339))
	}

	// Verify password
	if !verifyPassword(req.Password, user.PasswordHash, user.PasswordSalt) {
		user.LoginAttempts++

		// Lock after 5 failed attempts
		if user.LoginAttempts >= 5 {
			user.LockedUntil.Time = time.Now().Add(15 * time.Minute)
			user.LockedUntil.Valid = true
		}

		as.recordLoginAttempt(ctx, user.Email, req.IP, false, "invalid_password")
		return nil, nil, fmt.Errorf("invalid credentials")
	}

	// Reset login attempts
	user.LoginAttempts = 0

	// Create session
	session := as.createSession(ctx, userID, req.IP, req.UserAgent)
	user.LastLoginAt.Time = time.Now()
	user.LastLoginAt.Valid = true

	as.sessions[session.Token] = session

	as.recordLoginAttempt(ctx, user.Email, req.IP, true, "")

	return session, user, nil
}

// Logout ends a session
func (as *AuthService) Logout(ctx context.Context, token string) error {
	as.mu.Lock()
	defer as.mu.Unlock()

	session, ok := as.sessions[token]
	if !ok {
		return nil
	}

	delete(as.sessions, token)
	session.ExpiresAt = time.Now()

	return nil
}

// RefreshToken refreshes a session token
func (as *AuthService) RefreshToken(ctx context.Context, refreshToken string) (*Session, error) {
	as.mu.RLock()

	var session *Session
	for _, s := range as.sessions {
		if s.RefreshToken == refreshToken {
			session = s
			break
		}
	}
	as.mu.RUnlock()

	if session == nil {
		return nil, fmt.Errorf("invalid refresh token")
	}

	if session.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("refresh token expired")
	}

	// Create new tokens
	as.mu.Lock()
	delete(as.sessions, session.Token)
	newSession := as.createSession(ctx, session.UserID, session.IPAddress, session.UserAgent)
	as.sessions[newSession.Token] = newSession
	as.mu.Unlock()

	return newSession, nil
}

// ValidateToken validates a JWT token
func (as *AuthService) ValidateToken(ctx context.Context, tokenString string) (*JWTClaims, error) {
	secret, err := jwtSecret()
	if err != nil {
		return nil, err
	}

	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Pin the algorithm. Accepting whatever the token declares allows
		// "none" and HMAC-with-public-key forgeries.
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	// Check session exists
	as.mu.RLock()
	session, ok := as.sessions[claims.SessionID]
	as.mu.RUnlock()

	if !ok || session.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("session expired")
	}

	return claims, nil
}

// minJWTSecretLength is the shortest signing key accepted.
const minJWTSecretLength = 32

// jwtSecret loads the JWT signing key.
//
// The old code passed os.Getenv("JWT_SECRET") straight through, so an unset
// variable produced a token signed with the empty string.
func jwtSecret() ([]byte, error) {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < minJWTSecretLength {
		return nil, fmt.Errorf("JWT_SECRET must be set and at least %d characters", minJWTSecretLength)
	}
	return []byte(secret), nil
}

// EnableTwoFactor enables 2FA for a user
func (as *AuthService) EnableTwoFactor(ctx context.Context, userID string, method TwoFactorType, secret string) error {
	as.mu.Lock()
	defer as.mu.Unlock()

	user, ok := as.users[userID]
	if !ok {
		return fmt.Errorf("user not found")
	}

	// Validate secret for TOTP
	if method == TwoFactorTOTP && !isValidTOTPSecret(secret) {
		return fmt.Errorf("invalid TOTP secret")
	}

	user.TwoFactorSecret.String = secret
	user.TwoFactorSecret.Valid = true
	user.TwoFactorEnabled = true

	return nil
}

// DisableTwoFactor disables 2FA
func (as *AuthService) DisableTwoFactor(ctx context.Context, userID, code string) error {
	as.mu.Lock()
	defer as.mu.Unlock()

	user, ok := as.users[userID]
	if !ok {
		return fmt.Errorf("user not found")
	}

	// Verify code
	if !verifyTOTPCode(user.TwoFactorSecret.String, code) {
		return fmt.Errorf("invalid 2FA code")
	}

	user.TwoFactorEnabled = false
	user.TwoFactorSecret.String = ""
	user.TwoFactorSecret.Valid = false

	return nil
}

// VerifyTwoFactor verifies 2FA code
func (as *AuthService) VerifyTwoFactor(ctx context.Context, userID, code string) bool {
	as.mu.RLock()
	user, ok := as.users[userID]
	as.mu.RUnlock()

	if !ok {
		return false
	}
	if !user.TwoFactorEnabled {
		// Nothing was verified. Returning true here is what let the old
		// code be read as "2FA satisfied". Callers that only want to know
		// whether a factor is required should call TwoFactorRequired.
		return false
	}

	return verifyTOTPCode(user.TwoFactorSecret.String, code)
}

// TwoFactorRequired reports whether the user has a second factor enabled.
func (as *AuthService) TwoFactorRequired(userID string) bool {
	as.mu.RLock()
	defer as.mu.RUnlock()

	user, ok := as.users[userID]
	return ok && user.TwoFactorEnabled
}

// ChangePassword changes user password
func (as *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	as.mu.Lock()
	defer as.mu.Unlock()

	user, ok := as.users[userID]
	if !ok {
		return fmt.Errorf("user not found")
	}

	// Verify old password
	if !verifyPassword(oldPassword, user.PasswordHash, user.PasswordSalt) {
		return fmt.Errorf("invalid current password")
	}

	// Validate new password
	if err := as.validatePassword(newPassword, "default"); err != nil {
		return err
	}

	// Update password
	salt := generateSalt()
	hash, err := hashPassword(newPassword, salt)
	if err != nil {
		return err
	}

	user.PasswordHash = hash
	user.PasswordSalt = salt
	user.UpdatedAt = time.Now()

	return nil
}

// passwordResetTTL is how long a password reset token stays valid.
const passwordResetTTL = 30 * time.Minute

// passwordReset is a pending, single-use password reset.
type passwordReset struct {
	UserID string
	// Hash is the SHA-256 of the token handed to the user. The plaintext is
	// never stored, so a database leak does not hand over account access.
	Hash      string
	ExpiresAt time.Time
}

// HashResetToken hashes a reset token for storage or comparison.
func HashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// RequestPasswordReset issues a single-use reset token for an email address.
//
// It returns an empty token when the address is unknown, so the caller cannot
// use it to enumerate accounts.
func (as *AuthService) RequestPasswordReset(ctx context.Context, email string) (string, error) {
	as.mu.Lock()
	defer as.mu.Unlock()

	var user *User
	for _, u := range as.users {
		if u.Email == email {
			user = u
			break
		}
	}

	if user == nil {
		return "", nil
	}

	token, err := generateSecureToken(32)
	if err != nil {
		return "", err
	}
	as.passwordResets[user.ID] = &passwordReset{
		UserID:    user.ID,
		Hash:      HashResetToken(token),
		ExpiresAt: time.Now().Add(passwordResetTTL),
	}

	return token, nil
}

// generateSecureToken returns a URL safe token from a cryptographic source.
func generateSecureToken(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// ResetPassword resets password via email
func (as *AuthService) ResetPassword(ctx context.Context, email, resetToken, newPassword string) error {
	as.mu.RLock()
	var user *User
	for _, u := range as.users {
		if u.Email == email {
			user = u
			break
		}
	}
	as.mu.RUnlock()

	if user == nil {
		return fmt.Errorf("user not found")
	}

	// The token must match the one issued for this user, must not have
	// expired, and must not have been used. The old check only looked at the
	// token length, so any 32 character string reset any account.
	as.mu.RLock()
	pending, ok := as.passwordResets[user.ID]
	as.mu.RUnlock()
	if !ok || pending == nil {
		return fmt.Errorf("invalid or expired reset token")
	}
	if time.Now().After(pending.ExpiresAt) {
		as.mu.Lock()
		delete(as.passwordResets, user.ID)
		as.mu.Unlock()
		return fmt.Errorf("invalid or expired reset token")
	}
	if subtle.ConstantTimeCompare([]byte(pending.Hash), []byte(HashResetToken(resetToken))) != 1 {
		return fmt.Errorf("invalid or expired reset token")
	}

	// Validate new password
	if err := as.validatePassword(newPassword, "default"); err != nil {
		return err
	}

	// Update password
	salt := generateSalt()
	hash, err := hashPassword(newPassword, salt)
	if err != nil {
		return err
	}

	as.mu.Lock()
	user.PasswordHash = hash
	user.PasswordSalt = salt
	user.UpdatedAt = time.Now()
	// A reset token is single use.
	delete(as.passwordResets, user.ID)
	// Clear all sessions - force re-login
	for token, sess := range as.sessions {
		if sess.UserID == user.ID {
			delete(as.sessions, token)
		}
	}
	as.mu.Unlock()

	return nil
}

// GetUser gets a user by ID
func (as *AuthService) GetUser(userID string) (*User, bool) {
	as.mu.RLock()
	defer as.mu.RUnlock()
	user, ok := as.users[userID]
	return user, ok
}

// GetActiveSessions returns active sessions for a user
func (as *AuthService) GetActiveSessions(userID string) []*Session {
	as.mu.RLock()
	defer as.mu.RUnlock()

	var result []*Session
	for _, session := range as.sessions {
		if session.UserID == userID && session.ExpiresAt.After(time.Now()) {
			result = append(result, session)
		}
	}
	return result
}

// Helper functions
func (as *AuthService) createSession(ctx context.Context, userID, ip, userAgent string) *Session {
	token := generateToken()
	refreshToken := generateToken()

	return &Session{
		ID:           generateSessionID(),
		UserID:       userID,
		Token:        token,
		RefreshToken: refreshToken,
		IPAddress:    ip,
		UserAgent:    userAgent,
		ExpiresAt:    time.Now().Add(24 * time.Hour),
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}
}

func (as *AuthService) validatePassword(password, policyName string) error {
	policy, ok := as.policies[policyName]
	if !ok {
		policy = as.policies["default"]
	}

	if len(password) < policy.MinLength {
		return fmt.Errorf("password must be at least %d characters", policy.MinLength)
	}

	if policy.RequireUpper && !containsUpper(password) {
		return fmt.Errorf("password must contain uppercase letter")
	}

	if policy.RequireLower && !containsLower(password) {
		return fmt.Errorf("password must contain lowercase letter")
	}

	if policy.RequireNumber && !containsNumber(password) {
		return fmt.Errorf("password must contain number")
	}

	return nil
}

func (as *AuthService) recordLoginAttempt(ctx context.Context, email, ip string, success bool, reason string) {
	attempt := &LoginAttempt{
		ID:        generateAttemptID(),
		Email:     email,
		IPAddress: ip,
		Success:   success,
		Reason:    reason,
		CreatedAt: time.Now(),
	}

	as.attemptMu.Lock()
	as.loginAttempts = append(as.loginAttempts, attempt)
	// Bound memory; a real deployment also ships these to a SIEM.
	const maxRetainedAttempts = 10000
	if len(as.loginAttempts) > maxRetainedAttempts {
		as.loginAttempts = as.loginAttempts[len(as.loginAttempts)-maxRetainedAttempts:]
	}
	as.attemptMu.Unlock()
}

// LoginAttempts returns a copy of the recorded authentication attempts.
func (as *AuthService) LoginAttempts() []*LoginAttempt {
	as.attemptMu.Lock()
	defer as.attemptMu.Unlock()

	out := make([]*LoginAttempt, len(as.loginAttempts))
	copy(out, as.loginAttempts)
	return out
}

func hashPassword(password, salt string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password+salt), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func verifyPassword(password, hash, salt string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password+salt))
	return err == nil
}

func generateSalt() string {
	buf := make([]byte, 16)
	rand.Read(buf)
	return base64.StdEncoding.EncodeToString(buf)
}

func isValidEmail(email string) bool {
	// Basic email validation
	return len(email) > 3 && containsAt(email)
}

func containsAt(s string) bool {
	for _, c := range s {
		if c == '@' {
			return true
		}
	}
	return false
}

func containsUpper(s string) bool {
	for _, c := range s {
		if c >= 'A' && c <= 'Z' {
			return true
		}
	}
	return false
}

func containsLower(s string) bool {
	for _, c := range s {
		if c >= 'a' && c <= 'z' {
			return true
		}
	}
	return false
}

func containsNumber(s string) bool {
	for _, c := range s {
		if c >= '0' && c <= '9' {
			return true
		}
	}
	return false
}

func generateToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// generateUserID returns a random identifier.
//
// The previous version built ids from the clock, so they were guessable and
// could collide when two accounts were created in the same nanosecond.
func generateUserID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return "UID" + hex.EncodeToString(buf)
}

func generateSessionID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return "SES" + hex.EncodeToString(buf)
}

func generateAttemptID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return "ATT" + hex.EncodeToString(buf)
}

func generateReferralCode() string {
	buf := make([]byte, 5)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("secure random unavailable: %v", err))
	}
	return "REF" + strings.ToUpper(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf))
}

// isValidTOTPSecret reports whether a secret is a usable base32 key. Length
// alone is not enough: an undecodable secret can never produce a valid code.
func isValidTOTPSecret(secret string) bool {
	if len(secret) < 16 {
		return false
	}
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	return err == nil && len(key) >= 10
}

// totpPeriod is the TOTP time step in seconds, fixed by RFC 6238.
const totpPeriod int64 = 30

// totpSkew is how many steps either side of the current one are accepted, to
// tolerate clock drift between the server and the authenticator.
const totpSkew = 1

// verifyTOTPCode checks a TOTP code against an RFC 6238 secret.
//
// The previous version returned true for any six digit string (and for the
// literal 123456), so two factor authentication could be bypassed by typing
// six arbitrary digits.
func verifyTOTPCode(secret, code string) bool {
	if secret == "" {
		return false
	}
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}

	counter := time.Now().Unix() / totpPeriod
	for offset := -totpSkew; offset <= totpSkew; offset++ {
		expected := hotp(secret, uint64(counter+int64(offset)))
		if subtle.ConstantTimeCompare([]byte(expected), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// hotp derives a six digit code from a secret and counter per RFC 4226.
func hotp(secret string, counter uint64) string {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil || len(key) == 0 {
		return ""
	}

	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0F
	value := (uint32(sum[offset])&0x7F)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])

	return fmt.Sprintf("%06d", value%1000000)
}

// GenerateTOTPSecret creates a fresh base32 TOTP secret for enrolment.
func GenerateTOTPSecret() (string, error) {
	buf := make([]byte, 20) // 160 bits, the RFC 4226 recommendation
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}
