// Package auth provides authentication and authorization services
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"tigerex/backend/internal/api"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound       = errors.New("user not found")
	ErrUserExists         = errors.New("user already exists")
	ErrTokenExpired       = errors.New("token expired")
	ErrInvalidToken       = errors.New("invalid token")
	ErrStoreRequired      = ErrStoreUnavailable
)

// Config holds authentication configuration
type Config struct {
	JWT              JWTConfig
	MaxLoginAttempts int
	LockoutDuration  time.Duration
	SessionExpiry    time.Duration
}

// JWTConfig holds JWT configuration
type JWTConfig struct {
	Secret        []byte
	AccessExpiry  time.Duration
	RefreshExpiry time.Duration
}

// Service handles authentication
type Service struct {
	config        Config
	store         Store
	securityStore SecurityStore
}

// NewService creates a new authentication service. Persistence is attached
// separately with WithStore so that a misconfigured deployment fails loudly on
// the first request rather than serving fabricated results.
func NewService(config Config) *Service {
	return &Service{config: config}
}

// CreateUser creates a new user
func (s *Service) CreateUser(ctx context.Context, user *api.User) error {
	if user == nil {
		return ErrUserNotFound
	}
	if s.store == nil {
		return ErrStoreUnavailable
	}
	if !isBcryptHash(user.Password) {
		// Refusing a non-hashed password keeps a caller mistake from writing
		// plaintext credentials to the database.
		return errors.New("password must be stored as a bcrypt hash")
	}

	if user.ID == "" {
		user.ID = uuid.New().String()
	}
	if user.CreatedAt == 0 {
		user.CreatedAt = api.Now()
	}
	user.UpdatedAt = api.Now()

	return s.store.CreateUser(ctx, user)
}

// GetUserByEmail retrieves a user by email
func (s *Service) GetUserByEmail(ctx context.Context, email string) (*api.User, error) {
	if email == "" {
		return nil, ErrUserNotFound
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}
	return s.store.GetUserByEmail(ctx, email)
}

// GetUserByID retrieves a user by ID
func (s *Service) GetUserByID(ctx context.Context, userID string) (*api.User, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}
	return s.store.GetUserByID(ctx, userID)
}

// UsernameExists checks if username is already taken
func (s *Service) UsernameExists(ctx context.Context, username string) bool {
	if username == "" {
		return false
	}
	if s.store == nil {
		// Without a store the answer is unknown. Reporting "exists" makes the
		// caller refuse registration, which is the safe direction.
		return true
	}
	exists, err := s.store.UsernameExists(ctx, username)
	if err != nil {
		return true
	}
	return exists
}

// EmailExists checks if email is already registered
func (s *Service) EmailExists(ctx context.Context, email string) bool {
	if email == "" {
		return false
	}
	if s.store == nil {
		return true
	}
	exists, err := s.store.EmailExists(ctx, email)
	if err != nil {
		return true
	}
	return exists
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

func isBcryptHash(password string) bool {
	// bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 characters long.
	if len(password) != 60 {
		return false
	}
	return strings.HasPrefix(password, "$2a$") ||
		strings.HasPrefix(password, "$2b$") ||
		strings.HasPrefix(password, "$2y$")
}

// GenerateTokenPair generates access and refresh tokens
func (s *Service) GenerateTokenPair(user *api.User) (string, string, int64, error) {
	if user == nil {
		return "", "", 0, ErrUserNotFound
	}
	if len(s.config.JWT.Secret) == 0 {
		return "", "", 0, ErrStoreUnavailable
	}

	now := time.Now()
	expiresAt := now.Add(s.config.JWT.AccessExpiry).Unix()

	accessClaims := jwt.MapClaims{
		"sub":   user.ID,
		"email": user.Email,
		"iat":   now.Unix(),
		"exp":   expiresAt,
		"type":  "access",
		// sv binds the token to the account's security version. Changing a
		// password, enabling 2FA, or rotating a whitelist bumps the version and
		// invalidates every token issued before the change.
		"sv": user.SecurityVersion,
	}
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString(s.config.JWT.Secret)
	if err != nil {
		return "", "", 0, err
	}

	refreshExpiresAt := now.Add(s.config.JWT.RefreshExpiry).Unix()
	refreshClaims := jwt.MapClaims{
		"sub":  user.ID,
		"iat":  now.Unix(),
		"exp":  refreshExpiresAt,
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
	if tokenString == "" || len(s.config.JWT.Secret) == 0 {
		return nil, ErrInvalidToken
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return s.config.JWT.Secret, nil
	})

	if err != nil {
		// jwt.Parse enforces exp itself, so an expired token surfaces here
		// rather than at the explicit check below.
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrInvalidToken
	}
	if !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	exp, ok := claims["exp"].(float64)
	if !ok {
		return nil, ErrInvalidToken
	}
	if int64(exp) < time.Now().Unix() {
		return nil, ErrTokenExpired
	}

	return claims, nil
}

// GeneratePasswordResetToken generates a password reset token and records its
// hash. Only the hash is persisted, so a database leak does not yield usable
// reset tokens.
func (s *Service) GeneratePasswordResetToken(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", ErrUserNotFound
	}
	if s.store == nil {
		return "", ErrStoreUnavailable
	}
	if _, err := s.store.GetUserByID(ctx, userID); err != nil {
		return "", err
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(tokenBytes)

	expiry := time.Now().Add(time.Hour)
	if s.config.SessionExpiry > 0 {
		expiry = time.Now().Add(s.config.SessionExpiry)
	}
	if err := s.store.StoreResetToken(ctx, HashResetToken(token), userID, expiry); err != nil {
		return "", err
	}
	return token, nil
}

// ConsumePasswordResetToken validates a reset token and returns the user it
// belongs to. The token is single use.
func (s *Service) ConsumePasswordResetToken(ctx context.Context, token string) (string, error) {
	if token == "" || s.store == nil {
		return "", ErrInvalidToken
	}
	return s.store.ConsumeResetToken(ctx, HashResetToken(token))
}

// RecordFailedAttempt records a failed login attempt and locks the account once
// the configured threshold is reached.
func (s *Service) RecordFailedAttempt(ctx context.Context, userID string) {
	if userID == "" || s.store == nil {
		return
	}
	_, _ = s.store.RecordFailedAttempt(ctx, userID)
}

// ClearFailedAttempts clears failed login attempts
func (s *Service) ClearFailedAttempts(ctx context.Context, userID string) {
	if userID == "" || s.store == nil {
		return
	}
	_ = s.store.ClearFailedAttempts(ctx, userID)
}

// IsAccountLocked checks if account is locked
func (s *Service) IsAccountLocked(ctx context.Context, userID string) bool {
	if userID == "" || s.store == nil {
		return false
	}
	locked, err := s.store.IsLocked(ctx, userID)
	if err != nil {
		// On a store error, treat the account as locked. Failing open would let
		// an attacker keep guessing while the store is unhealthy.
		return true
	}
	return locked
}

// UpdateUser updates user information
func (s *Service) UpdateUser(ctx context.Context, user *api.User) error {
	if user == nil {
		return ErrUserNotFound
	}
	if s.store == nil {
		return ErrStoreUnavailable
	}
	user.UpdatedAt = api.Now()
	return s.store.UpdateUser(ctx, user)
}

// GetAPIKeys retrieves API keys for a user
func (s *Service) GetAPIKeys(ctx context.Context, userID string) ([]api.APIKey, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}
	keys, err := s.store.ListAPIKeys(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Never return secret material in a listing.
	for i := range keys {
		keys[i].Secret = ""
	}
	return keys, nil
}

// APIKeyRequest represents an API key creation request
type APIKeyRequest struct {
	UserID      string
	Label       string
	Permissions []string
	ExpiresAt   int64
	IPWhitelist []string
}

// CreateAPIKey creates a new API key. The plaintext secret is returned once;
// only a bcrypt hash of it is stored.
func (s *Service) CreateAPIKey(ctx context.Context, req *APIKeyRequest) (*api.APIKey, error) {
	if req == nil || req.UserID == "" || req.Label == "" {
		return nil, ErrUserNotFound
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}

	keyBytes := make([]byte, 16)
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, err
	}
	if _, err := rand.Read(secretBytes); err != nil {
		return nil, err
	}
	plaintextSecret := hex.EncodeToString(secretBytes)

	secretHash, err := bcrypt.GenerateFromPassword([]byte(plaintextSecret), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	stored := api.APIKey{
		ID:          uuid.New().String(),
		Key:         hex.EncodeToString(keyBytes),
		Secret:      string(secretHash),
		Label:       req.Label,
		Permissions: req.Permissions,
		ExpiresAt:   req.ExpiresAt,
		CreatedAt:   api.Now(),
		Enabled:     true,
		IPWhitelist: req.IPWhitelist,
	}
	if err := s.store.CreateAPIKey(ctx, req.UserID, &stored); err != nil {
		return nil, err
	}

	// Return the plaintext secret exactly once.
	created := stored
	created.Secret = plaintextSecret
	return &created, nil
}

// DeleteAPIKey deletes an API key
func (s *Service) DeleteAPIKey(ctx context.Context, userID, keyID string) error {
	if userID == "" || keyID == "" {
		return ErrUserNotFound
	}
	if s.store == nil {
		return ErrStoreUnavailable
	}
	return s.store.DeleteAPIKey(ctx, userID, keyID)
}

// GetSettings retrieves user settings
func (s *Service) GetSettings(ctx context.Context, userID string) (*api.UserSettings, error) {
	if userID == "" {
		return nil, ErrUserNotFound
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}
	return s.store.GetSettings(ctx, userID)
}

// ValidateAPIKey validates an API key and secret, honouring the key's IP
// allowlist and expiry.
func (s *Service) ValidateAPIKey(ctx context.Context, key, secret, ip string) (*api.APIKey, error) {
	if key == "" || secret == "" {
		return nil, ErrInvalidCredentials
	}
	if s.store == nil {
		return nil, ErrStoreUnavailable
	}

	stored, err := s.store.GetAPIKeyByKeyID(ctx, key)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	if !stored.Enabled {
		return nil, ErrInvalidCredentials
	}
	if stored.ExpiresAt != 0 && stored.ExpiresAt < api.Now() {
		return nil, ErrTokenExpired
	}
	if bcrypt.CompareHashAndPassword([]byte(stored.Secret), []byte(secret)) != nil {
		return nil, ErrInvalidCredentials
	}
	if !ipAllowed(stored.IPWhitelist, ip) {
		return nil, ErrInvalidCredentials
	}

	result := *stored
	result.Secret = ""
	return &result, nil
}

// ipAllowed reports whether ip is permitted by the allowlist. An empty
// allowlist permits any address, which is the documented behaviour of the
// endpoint; a non-empty allowlist requires an exact match.
func ipAllowed(allowlist []string, ip string) bool {
	if len(allowlist) == 0 {
		return true
	}
	for _, allowed := range allowlist {
		if strings.TrimSpace(allowed) == ip {
			return true
		}
	}
	return false
}

// Sign returns the hex HMAC-SHA256 of data under secret, the signature scheme
// documented for the REST API.
func (s *Service) Sign(data string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

// Verify checks an API signature in constant time.
func (s *Service) Verify(data, signature, secret string) bool {
	expected := s.Sign(data, secret)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
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
