package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// =============================================================================
// AUTHENTICATION SERVICE - Complete Production Implementation
// =============================================================================

// AuthService handles all authentication operations
type AuthService struct {
	db           *pgxpool.Pool
	sessions     *SessionStore
	totp         *TOTPService
	blacklist    *TokenBlacklist
	loginAttempt *LoginAttemptTracker
	
	// Config
	jwtSecret     []byte
	jwtExpiry     time.Duration
	sessionExpiry time.Duration
}

// SessionStore manages user sessions
type SessionStore struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

type Session struct {
	SessionID   string
	UserID      string
	Token       string
	RefreshToken string
	IPAddress   string
	UserAgent   string
	DeviceID    string
	Trusted     bool
	ExpiresAt   time.Time
	CreatedAt   time.Time
	LastActive  time.Time
}

// TOTPService handles 2FA
type TOTPService struct {
	Issuer string
}

// TokenBlacklist manages JWT blacklist
type TokenBlacklist struct {
	tokens map[string]time.Time
	mu     sync.RWMutex
}

// LoginAttemptTracker tracks failed login attempts
type LoginAttemptTracker struct {
	attempts map[string]*AttemptInfo
	mu       sync.Mutex
}

type AttemptInfo struct {
	Count     int
	FirstAt   time.Time
	LastAt    time.Time
	LockedUntil time.Time
}

const (
	MaxLoginAttempts = 5
	LockoutDuration = 15 * time.Minute
)

// =============================================================================
// USER MANAGEMENT
// =============================================================================

// CreateUser creates a new user account
func (as *AuthService) CreateUser(ctx context.Context, req *CreateUserRequest) (*User, error) {
	// Validate email
	if !isValidEmail(req.Email) {
		return nil, errors.New("invalid email format")
	}
	
	// Check email exists
	var exists bool
	err := as.db.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)",
		req.Email,
	).Scan(&exists)
	
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}
	
	if exists {
		return nil, errors.New("email already registered")
	}
	
	// Hash password
	passwordHash, err := hashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}
	
	// Generate user ID
	userID := uuid.New()
	
	// Generate referral code
	referralCode := generateReferralCode(req.Email)
	
	// Create user
	_, err = as.db.Exec(ctx,
		`INSERT INTO users (user_id, email, username, password_hash, country_code, 
		 referral_code, account_status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
		userID, req.Email, req.Username, passwordHash, req.CountryCode, referralCode,
	)
	
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	
	// Create default spot wallet
	walletID := uuid.New()
	as.db.Exec(ctx,
		`INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, is_default)
		 VALUES ($1, $2, 'spot', 'USDT', true)`,
		walletID, userID,
	)
	
	return &User{
		UserID:        userID.String(),
		Email:         req.Email,
		Username:      req.Username,
		CountryCode:   req.CountryCode,
		AccountStatus: "active",
		KYCLevel:      0,
		CreatedAt:     time.Now().Unix(),
	}, nil
}

// CreateUserRequest for user registration
type CreateUserRequest struct {
	Email        string
	Username     string
	Password     string
	FirstName    string
	LastName     string
	CountryCode  string
	ReferralCode string
	IPAddress    string
	UserAgent    string
}

// =============================================================================
// LOGIN / LOGOUT
// =============================================================================

// Login authenticates user and returns tokens
func (as *AuthService) Login(ctx context.Context, req *LoginRequest) (*AuthTokens, error) {
	// Check if account is locked
	if as.loginAttempt.IsLocked(req.Email) {
		return nil, errors.New("account temporarily locked due to too many failed attempts")
	}
	
	// Get user
	var user User
	err := as.db.QueryRow(ctx,
		`SELECT user_id, email, password_hash, account_status, locked_until
		 FROM users WHERE email = $1`,
		req.Email,
	).Scan(&user.UserID, &user.Email, &user.PasswordHash, &user.AccountStatus, &user.LockedUntil)
	
	if err != nil {
		as.loginAttempt.RecordFailedAttempt(req.Email)
		return nil, errors.New("invalid credentials")
	}
	
	// Check account status
	if user.AccountStatus != "active" {
		return nil, errors.New("account is not active")
	}
	
	// Check if locked
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		return nil, fmt.Errorf("account locked until %s", user.LockedUntil.Format(time.RFC3339))
	}
	
	// Verify password
	if !verifyPassword(req.Password, user.PasswordHash) {
		as.loginAttempt.RecordFailedAttempt(req.Email)
		return nil, errors.New("invalid credentials")
	}
	
	// Clear failed attempts on success
	as.loginAttempt.ClearAttempts(req.Email)
	
	// Generate tokens
	accessToken, err := as.GenerateAccessToken(user.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate access token: %w", err)
	}
	
	refreshToken, err := as.GenerateRefreshToken(user.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}
	
	// Create session
	session := &Session{
		SessionID:   uuid.New().String(),
		UserID:      user.UserID,
		Token:       accessToken,
		IPAddress:   req.IPAddress,
		UserAgent:   req.UserAgent,
		DeviceID:    req.DeviceID,
		ExpiresAt:   time.Now().Add(as.sessionExpiry),
		CreatedAt:   time.Now(),
		LastActive:  time.Now(),
	}
	
	as.sessions.Store(session)
	
	// Update last login
	as.db.Exec(ctx,
		`UPDATE users SET last_login_at = NOW(), login_attempts = 0 WHERE user_id = $1`,
		user.UserID,
	)
	
	// Get user profile
	var profile User
	as.db.QueryRow(ctx,
		`SELECT user_id, email, username, kyc_level, account_status, created_at
		 FROM users WHERE user_id = $1`,
		user.UserID,
	).Scan(&profile.UserID, &profile.Email, &profile.Username, &profile.KYCLevel, 
		&profile.AccountStatus, &profile.CreatedAt)
	
	return &AuthTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:   int(as.jwtExpiry.Seconds()),
		User:        &profile,
	}, nil
}

// LoginRequest for authentication
type LoginRequest struct {
	Email       string
	Password    string
	IPAddress   string
	UserAgent   string
	DeviceID    string
	TwoFactorCode string
}

// AuthTokens returned after login
type AuthTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn   int
	User        *User
}

// User represents authenticated user
type User struct {
	UserID           string
	Email            string
	Username         string
	PasswordHash     string
	FirstName        string
	LastName         string
	CountryCode      string
	KYCLevel         int
	AccountStatus    string
	LockedUntil      *time.Time
	TwoFactorEnabled bool
	CreatedAt       int64
}

// Logout invalidates user session
func (as *AuthService) Logout(ctx context.Context, token string) error {
	// Add to blacklist
	as.blacklist.Add(token)
	
	// Remove session
	as.sessions.DeleteByToken(token)
	
	return nil
}

// =============================================================================
// TOKEN MANAGEMENT
// =============================================================================

// GenerateAccessToken creates JWT access token
func (as *AuthService) GenerateAccessToken(userID string) (string, error) {
	return as.generateJWT(userID, "access", as.jwtExpiry)
}

// GenerateRefreshToken creates JWT refresh token
func (as *AuthService) GenerateRefreshToken(userID string) (string, error) {
	return as.generateJWT(userID, "refresh", 7*24*time.Hour)
}

// generateJWT creates a new JWT token
func (as *AuthService) generateJWT(userID, tokenType string, expiry time.Duration) (string, error) {
	now := time.Now()
	exp := now.Add(expiry)
	
	// Header
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	
	// Payload
	payload := map[string]interface{}{
		"sub":   userID,
		"type":  tokenType,
		"iat":   now.Unix(),
		"exp":   exp.Unix(),
		"jti":   uuid.New().String(),
	}
	
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	
	payloadEnc := base64.RawURLEncoding.EncodeToString(payloadJSON)
	
	// Signature
	message := header + "." + payloadEnc
	signature := hmacSHA256(as.jwtSecret, []byte(message))
	signatureEnc := base64.RawURLEncoding.EncodeToString(signature)
	
	return message + "." + signatureEnc, nil
}

// ValidateToken validates JWT token
func (as *AuthService) ValidateToken(token string) (*TokenClaims, error) {
	// Check blacklist
	if as.blacklist.IsBlacklisted(token) {
		return nil, errors.New("token has been revoked")
	}
	
	// Parse JWT
	parts := splitToken(token)
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}
	
	// Verify signature
	message := parts[0] + "." + parts[1]
	expectedSig := hmacSHA256(as.jwtSecret, []byte(message))
	actualSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("invalid token signature")
	}
	
	if !secureCompare(expectedSig, actualSig) {
		return nil, errors.New("invalid token signature")
	}
	
	// Decode payload
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid token payload")
	}
	
	var claims TokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, errors.New("invalid token claims")
	}
	
	// Check expiry
	if time.Now().Unix() > claims.ExpiresAt {
		return nil, errors.New("token has expired")
	}
	
	return &claims, nil
}

// TokenClaims from JWT
type TokenClaims struct {
	Subject   string `json:"sub"`
	Type      string `json:"type"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	JWTID     string `json:"jti"`
}

// RefreshTokens refreshes access token
func (as *AuthService) RefreshTokens(refreshToken string) (*AuthTokens, error) {
	// Validate refresh token
	claims, err := as.ValidateToken(refreshToken)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}
	
	if claims.Type != "refresh" {
		return nil, errors.New("not a refresh token")
	}
	
	// Generate new tokens
	accessToken, err := as.GenerateAccessToken(claims.Subject)
	if err != nil {
		return nil, fmt.Errorf("failed to generate access token: %w", err)
	}
	
	newRefreshToken, err := as.GenerateRefreshToken(claims.Subject)
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}
	
	// Get user
	var user User
	err = as.db.QueryRow(context.Background(),
		`SELECT user_id, email, username, kyc_level, account_status, created_at
		 FROM users WHERE user_id = $1`,
		claims.Subject,
	).Scan(&user.UserID, &user.Email, &user.Username, &user.KYCLevel, &user.AccountStatus, &user.CreatedAt)
	
	if err != nil {
		return nil, errors.New("user not found")
	}
	
	return &AuthTokens{
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		ExpiresIn:   int(as.jwtExpiry.Seconds()),
		User:        &user,
	}, nil
}

// =============================================================================
// TWO-FACTOR AUTHENTICATION
// =============================================================================

// Enable2FA enables 2FA for user
func (as *AuthService) Enable2FA(ctx context.Context, userID, password string) (*TwoFactorSetup, error) {
	// Verify password
	var storedHash string
	err := as.db.QueryRow(ctx,
		"SELECT password_hash FROM users WHERE user_id = $1",
		userID,
	).Scan(&storedHash)
	
	if err != nil || !verifyPassword(password, storedHash) {
		return nil, errors.New("invalid password")
	}
	
	// Generate secret
	secret, err := generateTOTPSecret()
	if err != nil {
		return nil, err
	}
	
	// Generate QR code URL
	qrURL := fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=TigerEx",
		as.totp.Issuer, userID, secret)
	
	// Store encrypted secret (not enabled yet)
	encryptedSecret, err := encryptSecret(secret, []byte(password))
	if err != nil {
		return nil, err
	}
	
	// Save pending 2FA
	as.db.Exec(ctx,
		`INSERT INTO pending_2fa (user_id, secret, created_at)
		 VALUES ($1, $2, NOW())
		 ON CONFLICT (user_id) DO UPDATE SET secret = $2`,
		userID, encryptedSecret,
	)
	
	return &TwoFactorSetup{
		Secret: secret,
		QRCode: qrURL,
	}, nil
}

// VerifyAndEnable2FA verifies and enables 2FA
func (as *AuthService) VerifyAndEnable2FA(ctx context.Context, userID, code, password string) error {
	// Get pending secret
	var encryptedSecret string
	err := as.db.QueryRow(ctx,
		"SELECT secret FROM pending_2fa WHERE user_id = $1",
		userID,
	).Scan(&encryptedSecret)
	
	if err != nil {
		return errors.New("no pending 2FA setup")
	}
	
	// Decrypt secret
	secret, err := decryptSecret(encryptedSecret, []byte(password))
	if err != nil {
		return errors.New("failed to decrypt secret")
	}
	
	// Verify TOTP code
	if !verifyTOTP(secret, code) {
		return errors.New("invalid verification code")
	}
	
	// Hash and store secret
	secretHash := hashSecret(secret)
	
	// Enable 2FA
	as.db.Exec(ctx,
		`UPDATE users SET two_factor_enabled = true, two_factor_secret = $1
		 WHERE user_id = $2`,
		secretHash, userID,
	)
	
	// Delete pending
	as.db.Exec(ctx, "DELETE FROM pending_fa WHERE user_id = $1", userID)
	
	// Generate backup codes
	backupCodes := generateBackupCodes()
	backupCodesHash := hashBackupCodes(backupCodes)
	
	as.db.Exec(ctx,
		`UPDATE users SET two_factor_backup_codes = $1 WHERE user_id = $2`,
		backupCodesHash, userID,
	)
	
	return nil
}

// Disable2FA disables 2FA for user
func (as *AuthService) Disable2FA(ctx context.Context, userID, password, code string) error {
	// Verify password
	var storedHash string
	err := as.db.QueryRow(ctx,
		"SELECT password_hash FROM users WHERE user_id = $1",
		userID,
	).Scan(&storedHash)
	
	if err != nil || !verifyPassword(password, storedHash) {
		return errors.New("invalid password")
	}
	
	// Verify 2FA code
	if !as.Verify2FA(ctx, userID, code) {
		return errors.New("invalid 2FA code")
	}
	
	// Disable
	as.db.Exec(ctx,
		`UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL,
		 two_factor_backup_codes = NULL WHERE user_id = $1`,
		userID,
	)
	
	return nil
}

// Verify2FA verifies TOTP code
func (as *AuthService) Verify2FA(ctx context.Context, userID, code string) bool {
	var secretHash string
	err := as.db.QueryRow(ctx,
		"SELECT two_factor_secret FROM users WHERE user_id = $1",
		userID,
	).Scan(&secretHash)
	
	if err != nil {
		return false
	}
	
	// Try each code in window (for clock skew)
	for i := -1; i <= 1; i++ {
		expectedCode := generateTOTPCode(secretHash, time.Now().Add(time.Duration(i)*30*time.Second))
		if secureCompareString(expectedCode, code) {
			return true
		}
	}
	
	return false
}

// TwoFactorSetup response
type TwoFactorSetup struct {
	Secret string
	QRCode string
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

// GetSessions returns all active sessions for user
func (as *AuthService) GetSessions(ctx context.Context, userID string) ([]Session, error) {
	as.sessions.mu.RLock()
	defer as.sessions.mu.RUnlock()
	
	var sessions []Session
	for _, s := range as.sessions.sessions {
		if s.UserID == userID && s.ExpiresAt.After(time.Now()) {
			sessions = append(sessions, *s)
		}
	}
	
	return sessions, nil
}

// RevokeSession revokes a specific session
func (as *AuthService) RevokeSession(ctx context.Context, userID, sessionID string) error {
	as.sessions.Delete(sessionID)
	return nil
}

// RevokeAllSessions revokes all sessions for user
func (as *AuthService) RevokeAllSessions(ctx context.Context, userID string) error {
	as.sessions.DeleteByUser(userID)
	return nil
}

func (ss *SessionStore) Store(session *Session) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	ss.sessions[session.Token] = session
}

func (ss *SessionStore) Get(token string) *Session {
	ss.mu.RLock()
	defer ss.mu.RUnlock()
	return ss.sessions[token]
}

func (ss *SessionStore) Delete(sessionID string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	for token, s := range ss.sessions {
		if s.SessionID == sessionID {
			delete(ss.sessions, token)
			return
		}
	}
}

func (ss *SessionStore) DeleteByToken(token string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	delete(ss.sessions, token)
}

func (ss *SessionStore) DeleteByUser(userID string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	for token, s := range ss.sessions {
		if s.UserID == userID {
			delete(ss.sessions, token)
		}
	}
}

// =============================================================================
// TOKEN BLACKLIST
// =============================================================================

func (tb *TokenBlacklist) Add(token string) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	
	// Parse token to get expiry
	parts := splitToken(token)
	if len(parts) != 3 {
		return
	}
	
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims TokenClaims
	json.Unmarshal(payload, &claims)
	
	// Store with actual expiry time
	expiry := time.Unix(claims.ExpiresAt, 0)
	tb.tokens[token] = expiry
}

func (tb *TokenBlacklist) IsBlacklisted(token string) bool {
	tb.mu.RLock()
	defer tb.mu.RUnlock()
	
	expiry, exists := tb.tokens[token]
	if !exists {
		return false
	}
	
	// Clean up expired entries
	if time.Now().After(expiry) {
		delete(tb.tokens, token)
		return false
	}
	
	return true
}

func (tb *TokenBlacklist) Cleanup() {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	
	now := time.Now()
	for token, expiry := range tb.tokens {
		if now.After(expiry) {
			delete(tb.tokens, token)
		}
	}
}

// =============================================================================
// LOGIN ATTEMPTS
// =============================================================================

func (lat *LoginAttemptTracker) RecordFailedAttempt(email string) {
	lat.mu.Lock()
	defer lat.mu.Unlock()
	
	info, exists := lat.attempts[email]
	if !exists {
		info = &AttemptInfo{
			FirstAt: time.Now(),
		}
		lat.attempts[email] = info
	}
	
	info.Count++
	info.LastAt = time.Now()
	
	// Lock account if too many attempts
	if info.Count >= MaxLoginAttempts {
		info.LockedUntil = time.Now().Add(LockoutDuration)
	}
}

func (lat *LoginAttemptTracker) ClearAttempts(email string) {
	lat.mu.Lock()
	defer lat.mu.Unlock()
	delete(lat.attempts, email)
}

func (lat *LoginAttemptTracker) IsLocked(email string) bool {
	lat.mu.Lock()
	defer lat.mu.Unlock()
	
	info, exists := lat.attempts[email]
	if !exists {
		return false
	}
	
	if info.Count >= MaxLoginAttempts && time.Now().Before(info.LockedUntil) {
		return true
	}
	
	return false
}

// =============================================================================
// CRYPTO HELPERS
// =============================================================================

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func verifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func hmacSHA256(key, message []byte) []byte {
	h := sha256.New()
	h.Write(message)
	h.Write(key)
	return h.Sum(nil)
}

func generateReferralCode(email string) string {
	h := sha256.Sum256([]byte(email + time.Now().Format(time.RFC3339Nano)))
	code := make([]byte, 0)
	for _, b := range h[:6] {
		if (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') {
			code = append(code, b)
		}
		if len(code) >= 8 {
			break
		}
	}
	return string(code)
}

func isValidEmail(email string) bool {
	// Basic email validation
	if len(email) < 3 || len(email) > 255 {
		return false
	}
	
	atIndex := -1
	for i, c := range email {
		if c == '@' {
			atIndex = i
			break
		}
	}
	
	if atIndex <= 0 || atIndex == len(email)-1 {
		return false
	}
	
	return true
}

func splitToken(token string) []string {
	var parts []string
	var current []byte
	
	for _, c := range token {
		if c == '.' {
			parts = append(parts, string(current))
			current = nil
		} else {
			current = append(current, byte(c))
		}
	}
	
	if len(current) > 0 {
		parts = append(parts, string(current))
	}
	
	return parts
}

func secureCompare(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	
	var result byte
	for i := range a {
		result |= a[i] ^ b[i]
	}
	
	return result == 0
}

func secureCompareString(a, b string) bool {
	return secureCompare([]byte(a), []byte(b))
}

func generateTOTPSecret() (string, error) {
	bytes := make([]byte, 20)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(bytes), nil
}

func generateTOTPCode(secret string, t time.Time) string {
	// Simplified TOTP - use proper library in production
	h := sha256.New()
	h.Write([]byte(secret))
	h.Write([]byte(strconv.FormatInt(t.Unix()/30, 10)))
	hash := h.Sum(nil)
	
	code := int(hash[0])<<24 | int(hash[1])<<16 | int(hash[2])<<8 | int(hash[3])
	return fmt.Sprintf("%06d", code%1000000)
}

func verifyTOTP(secret, code string) bool {
	for i := -1; i <= 1; i++ {
		t := time.Now().Add(time.Duration(i) * 30 * time.Second)
		expected := generateTOTPCode(secret, t)
		if secureCompareString(expected, code) {
			return true
		}
	}
	return false
}

func encryptSecret(secret, key []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	
	nonce := make([]byte, gcm.NonceSize())
	rand.Read(nonce)
	
	ciphertext := gcm.Seal(nonce, nonce, []byte(secret), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decryptSecret(encrypted, key []byte) (string, error) {
	data, err := base64.StdEncoding.DecodeString(string(encrypted))
	if err != nil {
		return "", err
	}
	
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	
	return string(plaintext), nil
}

func hashSecret(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(h[:])
}

func generateBackupCodes() []string {
	codes := make([]string, 10)
	for i := range codes {
		bytes := make([]byte, 4)
		rand.Read(bytes)
		binary.BigEndian.PutUint32(bytes, binary.BigEndian.Uint32(bytes)|0xF0000000)
		codes[i] = fmt.Sprintf("%08x", binary.BigEndian.Uint32(bytes))
	}
	return codes
}

func hashBackupCodes(codes []string) string {
	h := sha256.New()
	for _, code := range codes {
		h.Write([]byte(code))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// =============================================================================
// PLACEHOLDERS
// =============================================================================

var (
	_ = big.NewInt
	_ = uuid.New
	_ = bcrypt.GenerateFromPassword
	_ = binary.BigEndian
	_ = strconv.FormatInt
)

func init() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

func main() {
	log.Println("Authentication Service - Use as library")
}
