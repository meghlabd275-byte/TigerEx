package main

import (
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Identity handling for the KYC service.
//
// The previous middleware accepted any non-empty X-API-Key and never verified
// who the caller was, then took the user id from a client-supplied X-User-ID
// header. Any anonymous caller could therefore read other users' applications
// and documents, upload documents and selfies for them, trigger AML checks, and
// reach the review endpoint that approves or rejects a KYC tier. The user id
// and the admin role now come from a signed token, and the role is checked
// before privileged handlers run.

var (
	// ErrNoAuthSecret is returned when the service has no token signing secret.
	ErrNoAuthSecret = errors.New("auth secret not configured")
	// ErrBadToken is returned for a missing, malformed, or unverifiable token.
	ErrBadToken = errors.New("invalid or expired token")
	// ErrForbidden is returned when the caller lacks the required role.
	ErrForbidden = errors.New("insufficient privileges")
)

// tokenClaims is the payload carried by an access token.
type tokenClaims struct {
	Subject   string `json:"sub"`
	Role      string `json:"role"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

const (
	roleUser  = "user"
	roleAdmin = "admin"
)

// tokenSigner signs and verifies access tokens with HMAC-SHA256.
type tokenSigner struct {
	secret []byte
	ttl    time.Duration
}

// newTokenSigner builds a signer from the configured secret. An empty secret is
// rejected so the service cannot start without a way to authenticate callers.
func newTokenSigner(secret string, ttl time.Duration) (*tokenSigner, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, ErrNoAuthSecret
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("%w: secret must be at least 32 bytes", ErrNoAuthSecret)
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	return &tokenSigner{secret: []byte(secret), ttl: ttl}, nil
}

// sign produces a compact token of the form base64url(payload).base64url(mac).
func (ts *tokenSigner) sign(subject, role string) (string, error) {
	return ts.signAt(subject, role, time.Now())
}

// signAt signs a token as if it were issued at the given time. It exists so the
// expiry path can be tested without waiting.
func (ts *tokenSigner) signAt(subject, role string, now time.Time) (string, error) {
	if strings.TrimSpace(subject) == "" {
		return "", fmt.Errorf("%w: subject is required", ErrBadToken)
	}
	claims := tokenClaims{
		Subject:   subject,
		Role:      role,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(ts.ttl).Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return encoded + "." + ts.mac(encoded), nil
}

// verify checks the MAC in constant time and returns the claims if the token is
// well formed and unexpired.
func (ts *tokenSigner) verify(token string) (*tokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, ErrBadToken
	}
	expected := ts.mac(parts[0])
	// hmac.Equal is constant time; a byte-by-byte compare would leak the MAC.
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return nil, ErrBadToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, ErrBadToken
	}
	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, ErrBadToken
	}
	if claims.ExpiresAt != 0 && time.Now().Unix() > claims.ExpiresAt {
		return nil, ErrBadToken
	}
	if strings.TrimSpace(claims.Subject) == "" {
		return nil, ErrBadToken
	}
	return &claims, nil
}

func (ts *tokenSigner) mac(encodedPayload string) string {
	m := hmac.New(sha256.New, ts.secret)
	m.Write([]byte(encodedPayload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// bearerToken extracts a token from the Authorization header or the X-API-Key
// header. Both are accepted so existing API clients keep working, but the value
// must be a token this service signed.
func bearerToken(header, apiKey string) string {
	if header != "" {
		if len(header) > 7 && strings.EqualFold(header[:7], "Bearer ") {
			return strings.TrimSpace(header[7:])
		}
		return strings.TrimSpace(header)
	}
	return strings.TrimSpace(apiKey)
}

// hashPII returns a keyed hash of a personal identifier. Plain SHA-256 of a
// document number is trivially brute-forced because the space is small; the
// keyed digest prevents that while still allowing duplicate detection.
func hashPII(secret []byte, value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(normalized))
	return hex.EncodeToString(m.Sum(nil))
}

// randomID returns a hex identifier with n random bytes from crypto/rand. It is
// used for application, document, selfie, and AML identifiers, which must not
// be predictable: a guessable application id would let one user address
// another's records.
func randomID(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := cryptorand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// parseAmountToMinorUnits is a helper for limit checks that keeps money in
// integer minor units instead of floats.
func parseAmountToMinorUnits(amount string, decimals int) (int64, error) {
	trimmed := strings.TrimSpace(amount)
	if trimmed == "" {
		return 0, errors.New("empty amount")
	}
	if decimals < 0 || decimals > 18 {
		return 0, errors.New("invalid decimals")
	}

	negative := false
	if strings.HasPrefix(trimmed, "-") {
		negative = true
		trimmed = trimmed[1:]
	}

	whole := trimmed
	fraction := ""
	if idx := strings.Index(trimmed, "."); idx >= 0 {
		whole = trimmed[:idx]
		fraction = trimmed[idx+1:]
	}
	if whole == "" {
		whole = "0"
	}
	if len(fraction) > decimals {
		fraction = fraction[:decimals]
	}
	for len(fraction) < decimals {
		fraction += "0"
	}

	units, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, err
	}
	scale := int64(1)
	for i := 0; i < decimals; i++ {
		scale *= 10
	}
	units *= scale
	if fraction != "" {
		frac, err := strconv.ParseInt(fraction, 10, 64)
		if err != nil {
			return 0, err
		}
		units += frac
	}
	if negative {
		units = -units
	}
	return units, nil
}
