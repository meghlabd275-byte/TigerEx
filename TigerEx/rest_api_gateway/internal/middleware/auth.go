package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"encoding/hex"
	"strings"
	"time"

	"tigerEx/rest_api_gateway/internal/config"
	"tigerEx/rest_api_gateway/internal/models"
)

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

// ContextKey type for context keys
type ContextKey string

const (
	// ContextKeyUserID is the key for user ID in context
	ContextKeyUserID ContextKey = "user_id"
	// ContextKeyUser is the key for user object in context
	ContextKeyUser ContextKey = "user"
	// ContextKeyAPIKey is the key for API key in context
	ContextKeyAPIKey ContextKey = "api_key"
	// ContextKeyAPIKeyTier is the key for API key tier in context
	ContextKeyAPIKeyTier ContextKey = "api_key_tier"
)

// AuthMiddleware handles authentication
type AuthMiddleware struct {
	config *config.Config
}

// NewAuthMiddleware creates a new auth middleware
func NewAuthMiddleware(cfg *config.Config) *AuthMiddleware {
	return &AuthMiddleware{
		config: cfg,
	}
}

// Authenticate authenticates a request
func (am *AuthMiddleware) Authenticate(ctx context.Context, authHeader string) (context.Context, error) {
	if !am.config.Auth.Required {
		if am.config.Server.Mode == "production" {
			return ctx, models.NewAPIError(503, "Authentication cannot be disabled in production")
		}
		return ctx, nil
	}

	if authHeader == "" {
		return ctx, models.NewAPIError(401, "Missing authentication header")
	}

	// Parse "Bearer <token>" or "APIKEY <key>"
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return ctx, models.NewAPIError(401, "Invalid authentication header format")
	}

	authType := strings.ToUpper(parts[0])
	token := parts[1]

	switch authType {
	case "BEARER":
		return am.authenticateJWT(ctx, token)
	case "APIKEY":
		return am.authenticateAPIKey(ctx, token)
	default:
		return ctx, models.NewAPIError(401, "Unsupported authentication type")
	}
}

// authenticateJWT authenticates using JWT
func (am *AuthMiddleware) authenticateJWT(ctx context.Context, token string) (context.Context, error) {
	// Parse and validate JWT token
	// In production, this would use a proper JWT library
	claims, err := am.parseJWT(token)
	if err != nil {
		return ctx, models.NewAPIError(401, "Invalid or expired token")
	}

	ctx = context.WithValue(ctx, ContextKeyUserID, claims["user_id"])
	return ctx, nil
}

// authenticateAPIKey fails closed until a persistent, hashed API-key verifier is configured.
func (am *AuthMiddleware) authenticateAPIKey(ctx context.Context, apiKey string) (context.Context, error) {
	_ = apiKey
	return ctx, models.NewAPIError(503, "API key authentication is not configured")
}

// parseJWT verifies an HS256 JWT signature and its registered claims.
func (am *AuthMiddleware) parseJWT(token string) (map[string]interface{}, error) {
	if !am.jwtSecretUsable() {
		return nil, models.NewAPIError(503, "JWT signing secret is not safely configured")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil, models.NewAPIError(401, "Invalid token format")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil { return nil, models.NewAPIError(401, "Invalid token header") }
	var header struct { Algorithm string `json:"alg"`; Type string `json:"typ"` }
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" {
		return nil, models.NewAPIError(401, "Unsupported token algorithm")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil { return nil, models.NewAPIError(401, "Invalid token signature") }
	mac := hmac.New(sha256.New, []byte(am.config.JWT.Secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) { return nil, models.NewAPIError(401, "Invalid token signature") }
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil { return nil, models.NewAPIError(401, "Invalid token payload") }
	var claims struct {
		UserID string `json:"user_id"`
		Expiry int64 `json:"exp"`
		Issuer string `json:"iss"`
		Audience string `json:"aud"`
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil || claims.UserID == "" || claims.Expiry <= time.Now().Unix() {
		return nil, models.NewAPIError(401, "Invalid or expired token claims")
	}
	if am.config.JWT.Issuer != "" && claims.Issuer != am.config.JWT.Issuer {
		return nil, models.NewAPIError(401, "Invalid token issuer")
	}
	if am.config.JWT.Audience != "" && claims.Audience != am.config.JWT.Audience {
		return nil, models.NewAPIError(401, "Invalid token audience")
	}
	return map[string]interface{}{"user_id": claims.UserID, "exp": claims.Expiry}, nil
}

func (am *AuthMiddleware) jwtSecretUsable() bool {
	secret := am.config.JWT.Secret
	return len(secret) >= 32 && secret != "tigerex-secret-key-change-in-production"
}

// GenerateJWT creates a signed HS256 JWT for an authenticated user.
func (am *AuthMiddleware) GenerateJWT(userID string) (string, error) {
	if userID == "" { return "", models.NewAPIError(400, "User ID is required") }
	if !am.jwtSecretUsable() { return "", models.NewAPIError(503, "JWT signing secret is not safely configured") }
	headerJSON, err := json.Marshal(map[string]string{"alg":"HS256","typ":"JWT"})
	if err != nil { return "", err }
	payloadJSON, err := json.Marshal(struct {
		UserID string `json:"user_id"`
		Expiry int64 `json:"exp"`
		Issuer string `json:"iss"`
		Audience string `json:"aud"`
	}{userID, time.Now().Add(am.config.JWT.Expiry).Unix(), am.config.JWT.Issuer, am.config.JWT.Audience})
	if err != nil { return "", err }
	header := base64.RawURLEncoding.EncodeToString(headerJSON)
	payload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	input := header + "." + payload
	mac := hmac.New(sha256.New, []byte(am.config.JWT.Secret))
	_, _ = mac.Write([]byte(input))
	return input + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// ============================================================================
// SIGNATURE VERIFICATION
// ============================================================================

// VerifySignature verifies request signature
func VerifySignature(secret, method, path, queryString, body, timestamp, signature string) bool {
	// Create the string to sign: method\npath\ntimestamp\nhash(body)
	stringToSign := method + "\n" + path + "\n" + timestamp + "\n" + hashBody(body)

	// Calculate HMAC-SHA256
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(stringToSign))
	expectedSig := hex.EncodeToString(h.Sum(nil))

	// Constant time comparison
	return subtle.ConstantTimeCompare([]byte(signature), []byte(expectedSig)) == 1
}

// hashBody calculates SHA256 hash of body
func hashBody(body string) string {
	h := sha256.Sum256([]byte(body))
	return hex.EncodeToString(h[:])
}

// ============================================================================
// ANTI-PHIVISHING CODE
// ============================================================================

// AntiPhishingMiddleware handles anti-phishing code verification
type AntiPhishingMiddleware struct {
	userAntiPhishingCodes map[string]string // userID -> code
}

// NewAntiPhishingMiddleware creates a new anti-phishing middleware
func NewAntiPhishingMiddleware() *AntiPhishingMiddleware {
	return &AntiPhishingMiddleware{
		userAntiPhishingCodes: make(map[string]string),
	}
}

// SetAntiPhishingCode sets anti-phishing code for a user
func (ap *AntiPhishingMiddleware) SetAntiPhishingCode(userID, code string) {
	ap.userAntiPhishingCodes[userID] = code
}

// GetAntiPhishingCode gets anti-phishing code for a user
func (ap *AntiPhishingMiddleware) GetAntiPhishingCode(userID string) string {
	return ap.userAntiPhishingCodes[userID]
}

// VerifyAntiPhishingCode verifies anti-phishing code
func (ap *AntiPhishingMiddleware) VerifyAntiPhishingCode(userID, code string) bool {
	storedCode, ok := ap.userAntiPhishingCodes[userID]
	if !ok {
		return true // If no code set, skip verification
	}
	return subtle.ConstantTimeCompare([]byte(storedCode), []byte(code)) == 1
}

// ============================================================================
// DEVICE FINGERPRINT
// ============================================================================

// DeviceFingerprint represents device fingerprint
type DeviceFingerprint struct {
	ID           string `json:"id"`
	UserID      string `json:"userId"`
	Fingerprint string `json:"fingerprint"`
	DeviceInfo  string `json:"deviceInfo"`
	IPAddress   string `json:"ipAddress"`
	UserAgent  string `json:"userAgent"`
	CreatedAt   int64  `json:"createdAt"`
	Verified   bool   `json:"verified"`
}

// NewDeviceFingerprint creates a new device fingerprint
func NewDeviceFingerprint(userID, fingerprint, deviceInfo, ipAddress, userAgent string) *DeviceFingerprint {
	return &DeviceFingerprint{
		UserID:      userID,
		Fingerprint: fingerprint,
		DeviceInfo:  deviceInfo,
		IPAddress:   ipAddress,
		UserAgent:  userAgent,
		CreatedAt:  time.Now().Unix(),
		Verified:  false,
	}
}

// ============================================================================
// REQUEST VALIDATION
// ============================================================================

// ValidateRequiredFields validates required fields are present
func ValidateRequiredFields(data map[string]interface{}, fields ...string) error {
	for _, field := range fields {
		if _, ok := data[field]; !ok {
			return models.NewAPIError(400, "Missing required field: "+field)
		}
	}
	return nil
}

// ValidateSymbol validates symbol format
func ValidateSymbol(symbol string) error {
	if symbol == "" {
		return models.NewAPIError(400, "Symbol is required")
	}
	// Symbol format: BASE/QUOTE (e.g., BTC/USDT)
	if !strings.Contains(symbol, "/") {
		return models.NewAPIError(400, "Invalid symbol format")
	}
	return nil
}

// ValidateOrderSide validates order side
func ValidateOrderSide(side string) error {
	side = strings.ToUpper(side)
	if side != "BUY" && side != "SELL" {
		return models.NewAPIError(400, "Invalid order side")
	}
	return nil
}

// ValidateOrderType validates order type
func ValidateOrderType(orderType string) error {
	validTypes := []string{"LIMIT", "MARKET", "STOP_LOSS", "STOP_LIMIT", "ICEBERG", "OCO", "TRAILING_STOP"}
	for _, t := range validTypes {
		if strings.ToUpper(orderType) == t {
			return nil
		}
	}
	return models.NewAPIError(400, "Invalid order type")
}

// ValidateQuantity validates quantity
func ValidateQuantity(quantity float64) error {
	if quantity <= 0 {
		return models.NewAPIError(400, "Quantity must be greater than 0")
	}
	return nil
}

// ValidatePrice validates price
func ValidatePrice(price float64, orderType string) error {
	if strings.ToUpper(orderType) == "MARKET" {
		return nil // Market orders don't need price validation
	}
	if price <= 0 {
		return models.NewAPIError(400, "Price must be greater than 0")
	}
	return nil
}