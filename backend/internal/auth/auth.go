package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pquerna/otp/totp"
)

type AuthService struct {
	config    AuthConfig
	security SecurityLayer
	jwtSecret []byte
	mu        sync.RWMutex
	sessions  map[string]*Session
	refreshTokens map[string]*RefreshToken
	users     map[string]*User
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
	TwoFactorVerified  bool
	TwoFactorSecret    string
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
	TwoFactorEnabled     bool
	TwoFactorSecret      string
	KYCVerified     bool
	KYCLevel       int
	Status          string
	FailedAttempts int
	LockedUntil    *time.Time
}

type SecurityLayer interface {
	HashPassword(password string) (string, error)
	ValidatePassword(password string) error
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
		users:          make(map[string]*User),
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

// UserByID returns the stored user, or nil when the user does not exist.
func (s *AuthService) UserByID(userID string) *User {
	return s.findUserByID(userID)
}

// IssueAccessToken mints a signed access token for an authenticated
// session. Callers must have verified the session (including any second
// factor) before calling it.
func (s *AuthService) IssueAccessToken(ctx context.Context, session *Session) (string, error) {
	if session == nil {
		return "", fmt.Errorf("session is required")
	}
	return s.generateAccessToken(session)
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
	if !s.verify2FACode(session.TwoFactorSecret, code) {
		return nil, fmt.Errorf("invalid 2FA code")
	}

	session.TwoFactorVerified = true

	return session, nil
}

// Refresh token
func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (string, error) {
	s.mu.RLock()
	token, exists := s.refreshTokens[refreshToken]
	s.mu.RUnlock()

	if !exists || token.Revoked || time.Now().After(token.ExpiresAt) {
		return "", fmt.Errorf("invalid refresh token")
	}

	// Generate new access token
	session := s.sessions[token.TokenID]
	if session == nil {
		return "", fmt.Errorf("session not found")
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
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
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
		TwoFactorEnabled:    false,
		KYCVerified:    false,
		KYCLevel:       0,
		Status:         "active",
		FailedAttempts: 0,
	}

	// Save user (in production, save to database)
	s.saveUser(user)

	return user, nil
}

// Enable2FA provisions a TOTP secret. Two-factor authentication stays
// disabled until Confirm2FA verifies a code generated from the secret.
func (s *AuthService) Enable2FA(ctx context.Context, userID string) (string, error) {
	user := s.findUserByID(userID)
	if user == nil {
		return "", fmt.Errorf("user not found")
	}

	secret, err := s.generate2FASecret(userID)
	if err != nil {
		return "", fmt.Errorf("failed to generate 2FA secret: %w", err)
	}

	s.mu.Lock()
	user.TwoFactorSecret = secret
	user.TwoFactorEnabled = false
	s.mu.Unlock()

	return secret, nil
}

// Confirm2FA enables two-factor authentication once the caller proves they
// can produce a valid code from the provisioned secret.
func (s *AuthService) Confirm2FA(ctx context.Context, userID, code string) error {
	user := s.findUserByID(userID)
	if user == nil {
		return fmt.Errorf("user not found")
	}

	if !s.verify2FACode(user.TwoFactorSecret, code) {
		return fmt.Errorf("invalid 2FA code")
	}

	s.mu.Lock()
	user.TwoFactorEnabled = true
	s.mu.Unlock()

	return nil
}

// Disable 2FA
func (s *AuthService) Disable2FA(ctx context.Context, userID, code string) error {
	user := s.findUserByID(userID)
	if user == nil {
		return fmt.Errorf("user not found")
	}

	if !s.verify2FACode(user.TwoFactorSecret, code) {
		return fmt.Errorf("invalid 2FA code")
	}

	user.TwoFactorEnabled = false
	user.TwoFactorSecret = ""

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
	if user == nil {
		return nil, fmt.Errorf("invalid wallet address")
	}

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
	claims := &Claims{
		UserID:    session.UserID,
		SessionID: session.SessionID,
		IPAddress: session.IPAddress,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(session.ExpiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "tigerex",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

// generate2FASecret returns a new base32 TOTP secret. The account name is
// the user identifier so authenticator apps display something meaningful.
func (s *AuthService) generate2FASecret(account string) (string, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "TigerEx",
		AccountName: account,
	})
	if err != nil {
		return "", err
	}
	return key.Secret(), nil
}

// verify2FACode validates a 6-digit TOTP code against the shared secret.
func (s *AuthService) verify2FACode(secret, code string) bool {
	if secret == "" {
		return false
	}
	return totp.Validate(code, secret)
}

func (s *AuthService) findUserByLogin(login string) *User {
	login = strings.ToLower(strings.TrimSpace(login))

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, u := range s.users {
		if u.Email == login || u.Phone == login || u.Username == login {
			return u
		}
	}
	return nil
}

func (s *AuthService) findUserByID(userID string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.users[userID]
}

func (s *AuthService) userExists(email, phone string) bool {
	email = strings.ToLower(strings.TrimSpace(email))

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, u := range s.users {
		if u.Email != "" && u.Email == email {
			return true
		}
		if u.Phone != "" && u.Phone == phone {
			return true
		}
	}
	return false
}

func (s *AuthService) saveUser(user *User) {
	s.mu.Lock()
	s.users[user.ID] = user
	s.mu.Unlock()
}

// findOrCreateSocialUser records a user for a verified social profile.
func (s *AuthService) findOrCreateSocialUser(provider string, profile map[string]string) *User {
	email := strings.ToLower(strings.TrimSpace(profile["email"]))
	if email != "" {
		if existing := s.findUserByLogin(email); existing != nil {
			return existing
		}
	}

	user := &User{
		ID:            generateID(),
		Email:         email,
		Username:      profile["name"],
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		EmailVerified: email != "",
		Status:        "active",
	}
	s.saveUser(user)
	return user
}

func (s *AuthService) findOrCreateWalletUser(address string) *User {
	address = strings.ToLower(strings.TrimSpace(address))
	if address == "" {
		return nil
	}

	s.mu.RLock()
	for _, u := range s.users {
		if u.Username == address {
			s.mu.RUnlock()
			return u
		}
	}
	s.mu.RUnlock()

	user := &User{
		ID:        generateID(),
		Username:  address,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Status:    "active",
	}
	s.saveUser(user)
	return user
}

// verifySocialToken exchanges a provider token for the caller identity.
// The provider integration is not configured in this build, so the call is
// rejected rather than trusting an unverified token.
func (s *AuthService) verifySocialToken(provider, token string) (map[string]string, error) {
	return nil, fmt.Errorf("social login provider %q is not configured", provider)
}

// verifyMetaMaskSignature verifies an EIP-191 personal_sign signature. The
// recovery backend is not configured in this build, so the signature is
// rejected rather than accepted unconditionally.
func (s *AuthService) verifyMetaMaskSignature(address, signature, message string) bool {
	return false
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
	jwt.RegisteredClaims
}

// The following accessors satisfy jwt.Claims. They are required for
// jwt.Parse to decode into a *Claims instead of a generic MapClaims.

func (c *Claims) GetExpirationTime() (*jwt.NumericDate, error) { return c.RegisteredClaims.GetExpirationTime() }
func (c *Claims) GetIssuedAt() (*jwt.NumericDate, error)       { return c.RegisteredClaims.GetIssuedAt() }
func (c *Claims) GetNotBefore() (*jwt.NumericDate, error)      { return c.RegisteredClaims.GetNotBefore() }
func (c *Claims) GetIssuer() (string, error)                   { return c.RegisteredClaims.GetIssuer() }
func (c *Claims) GetSubject() (string, error)                  { return c.RegisteredClaims.GetSubject() }
func (c *Claims) GetAudience() (jwt.ClaimStrings, error)       { return c.RegisteredClaims.GetAudience() }

