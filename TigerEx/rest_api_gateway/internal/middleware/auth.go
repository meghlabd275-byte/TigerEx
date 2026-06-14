package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
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
		return ctx, nil
	}

	if authHeader == "" {
		return ctx, models.NewErrorResponse(401, "Missing authentication header")
	}

	// Parse "Bearer <token>" or "APIKEY <key>"
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return ctx, models.NewErrorResponse(401, "Invalid authentication header format")
	}

	authType := strings.ToUpper(parts[0])
	token := parts[1]

	switch authType {
	case "BEARER":
		return am.authenticateJWT(ctx, token)
	case "APIKEY":
		return am.authenticateAPIKey(ctx, token)
	default:
		return ctx, models.NewErrorResponse(401, "Unsupported authentication type")
	}
}

// authenticateJWT authenticates using JWT
func (am *AuthMiddleware) authenticateJWT(ctx context.Context, token string) (context.Context, error) {
	// Parse and validate JWT token
	// In production, this would use a proper JWT library
	claims, err := am.parseJWT(token)
	if err != nil {
		return ctx, models.NewErrorResponse(401, "Invalid or expired token")
	}

	ctx = context.WithValue(ctx, ContextKeyUserID, claims["user_id"])
	return ctx, nil
}

// authenticateAPIKey authenticates using API key
func (am *AuthMiddleware) authenticateAPIKey(ctx context.Context, apiKey string) (context.Context, error) {
	// Validate API key format
	if len(apiKey) < 32 {
		return ctx, models.NewErrorResponse(401, "Invalid API key")
	}

	// Look up API key in database/cache
	// In production, this would validate against the database
	tier := "free" // default tier

	ctx = context.WithValue(ctx, ContextKeyAPIKey, apiKey)
	ctx = context.WithValue(ctx, ContextKeyAPIKeyTier, tier)
	ctx = context.WithValue(ctx, ContextKeyUserID, "default_user")

	return ctx, nil
}

// parseJWT parses a JWT token (simplified - production would use proper JWT library)
func (am *AuthMiddleware) parseJWT(token string) (map[string]interface{}, error) {
	// JWT format: header.payload.signature
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, models.NewErrorResponse(401, "Invalid token format")
	}

	// In production, verify signature and expiry
	// For now, return mock claims
	return map[string]interface{}{
		"user_id": "user_123",
		"exp":     time.Now().Add(am.config.JWT.Expiry).Unix(),
	}, nil
}

// GenerateJWT generates a JWT token for a user
func (am *AuthMiddleware) GenerateJWT(userID string) (string, error) {
	// In production, use proper JWT library
	header := base64URLEncode([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := base64URLEncode([]byte(`{"user_id":"` + userID + `","exp":` + string(time.Now().Add(am.config.JWT.Expiry).Unix()) + `}`))
	signature := am.sign([]byte(header + "." + payload))
	return header + "." + payload + "." + signature, nil
}

// sign generates HMAC signature
func (am *AuthMiddleware) sign(data []byte) string {
	h := hmac.New(sha256.New, []byte(am.config.JWT.Secret))
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

// base64URLEncode encodes data to base64 URL format
func base64URLEncode(data []byte) string {
	encoded := make([]byte, len(data)*2)
	n := 0
	for _, b := range data {
		switch {
		case b >= 'A' && b <= 'Z', b >= 'a' && b <= 'z', b >= '0' && b <= '9', b == '-', b == '_':
			encoded[n] = b
			n++
		default:
			encoded[n] = '='
			n++
		}
	}
	return string(encoded[:n])
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
			return models.NewErrorResponse(400, "Missing required field: "+field)
		}
	}
	return nil
}

// ValidateSymbol validates symbol format
func ValidateSymbol(symbol string) error {
	if symbol == "" {
		return models.NewErrorResponse(400, "Symbol is required")
	}
	// Symbol format: BASE/QUOTE (e.g., BTC/USDT)
	if !strings.Contains(symbol, "/") {
		return models.NewErrorResponse(400, "Invalid symbol format")
	}
	return nil
}

// ValidateOrderSide validates order side
func ValidateOrderSide(side string) error {
	side = strings.ToUpper(side)
	if side != "BUY" && side != "SELL" {
		return models.NewErrorResponse(400, "Invalid order side")
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
	return models.NewErrorResponse(400, "Invalid order type")
}

// ValidateQuantity validates quantity
func ValidateQuantity(quantity float64) error {
	if quantity <= 0 {
		return models.NewErrorResponse(400, "Quantity must be greater than 0")
	}
	return nil
}

// ValidatePrice validates price
func ValidatePrice(price float64, orderType string) error {
	if strings.ToUpper(orderType) == "MARKET" {
		return nil // Market orders don't need price validation
	}
	if price <= 0 {
		return models.NewErrorResponse(400, "Price must be greater than 0")
	}
	return nil
}