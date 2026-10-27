// Package totp implements TOTP (RFC 6238) on top of HOTP (RFC 4226).
//
// The previous implementations of one-time-password verification in this
// repository were not TOTP. One hashed the secret with SHA-256 and the time
// step and took the first four bytes, which is not the RFC 4226 truncation and
// does not interoperate with Google Authenticator, Authy, or 1Password. The
// other returned true unconditionally. A user who enabled 2FA was either
// unable to log in or was not protected at all.
//
// This package implements the algorithms as specified so that codes are
// interoperable and verification is real.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"hash"
	"strings"
	"time"
)

// Algorithm selects the HMAC hash used to derive codes. SHA-1 is the default
// because authenticator apps assume it unless the provisioning URI says
// otherwise.
type Algorithm int

const (
	SHA1 Algorithm = iota
	SHA256
	SHA512
)

func (a Algorithm) hash() (func() hash.Hash, error) {
	switch a {
	case SHA1:
		return sha1.New, nil
	case SHA256:
		return sha256.New, nil
	case SHA512:
		return sha512.New, nil
	default:
		return nil, errors.New("unsupported TOTP algorithm")
	}
}

// DefaultPeriod is the time step in seconds, and DefaultDigits the code length.
const (
	DefaultPeriod = 30
	DefaultDigits = 6
)

// noPadding is the base32 alphabet authenticator apps use: RFC 4648 base32
// without the "=" padding.
var noPadding = base32.StdEncoding.WithPadding(base32.NoPadding)

// Config describes a TOTP secret and the parameters used to derive codes from
// it.
type Config struct {
	// Secret is the raw shared key, not its base32 encoding.
	Secret []byte
	// Digits is the number of decimal digits in a code. Zero means 6.
	Digits int
	// Period is the time step in seconds. Zero means 30.
	Period int
	// Algorithm selects the HMAC hash. The zero value is SHA-1.
	Algorithm Algorithm
}

func (c Config) digits() int {
	if c.Digits <= 0 {
		return DefaultDigits
	}
	return c.Digits
}

func (c Config) period() int {
	if c.Period <= 0 {
		return DefaultPeriod
	}
	return c.Period
}

// Validate reports whether the configuration can produce codes.
func (c Config) Validate() error {
	if len(c.Secret) == 0 {
		return errors.New("TOTP secret is empty")
	}
	if c.Digits != 0 && (c.Digits < 6 || c.Digits > 10) {
		return errors.New("TOTP digits must be between 6 and 10")
	}
	if c.Period != 0 && (c.Period < 1 || c.Period > 600) {
		return errors.New("TOTP period must be between 1 and 600 seconds")
	}
	if _, err := c.Algorithm.hash(); err != nil {
		return err
	}
	return nil
}

// GenerateSecret returns a new random secret of the given byte length. Twenty
// bytes matches the SHA-1 block size, which is what RFC 4226 section 4
// recommends.
func GenerateSecret(size int) ([]byte, error) {
	if size <= 0 {
		size = 20
	}
	secret := make([]byte, size)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generating TOTP secret: %w", err)
	}
	return secret, nil
}

// EncodeSecret renders a secret as the unpadded base32 that provisioning URIs
// and authenticator apps expect.
func EncodeSecret(secret []byte) string {
	return noPadding.EncodeToString(secret)
}

// DecodeSecret parses a base32 secret. It accepts upper and lower case and
// tolerates padding and spaces, because users paste secrets from many sources.
func DecodeSecret(encoded string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(encoded), " ", ""))
	cleaned = strings.TrimRight(cleaned, "=")
	if cleaned == "" {
		return nil, errors.New("TOTP secret is empty")
	}
	secret, err := noPadding.DecodeString(cleaned)
	if err != nil {
		return nil, fmt.Errorf("TOTP secret is not valid base32: %w", err)
	}
	return secret, nil
}

// hotp computes the RFC 4226 HOTP value for a counter.
func hotp(c Config, counter uint64) (string, error) {
	newHash, err := c.Algorithm.hash()
	if err != nil {
		return "", err
	}

	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(newHash, c.Secret)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	// Dynamic truncation, RFC 4226 section 5.3: the low four bits of the last
	// byte select the offset, and the next four bytes form a 31-bit integer.
	offset := sum[len(sum)-1] & 0x0f
	code := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff

	mod := uint32(1)
	for i := 0; i < c.digits(); i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", c.digits(), code%mod), nil
}

// Generate returns the code for a specific moment.
func Generate(c Config, at time.Time) (string, error) {
	if err := c.Validate(); err != nil {
		return "", err
	}
	counter := uint64(at.Unix() / int64(c.period()))
	return hotp(c, counter)
}

// Validate checks a code against the current time, allowing one period of clock
// drift on either side by default.
//
// It returns false for a code of the wrong length or one containing non-digits,
// and it compares in constant time so a caller cannot learn a code by timing.
func Validate(c Config, code string, at time.Time) bool {
	return ValidateWithSkew(c, code, at, 1)
}

// ValidateWithSkew checks a code allowing skew periods before and after the
// current one. A skew of zero accepts only the current period.
func ValidateWithSkew(c Config, code string, at time.Time, skew int) bool {
	if err := c.Validate(); err != nil {
		return false
	}
	if skew < 0 {
		skew = 0
	}

	expected, err := Generate(c, at)
	if err != nil {
		return false
	}
	// Reject anything that is not the right shape before comparing, so a
	// malformed code cannot accidentally match a padded expectation.
	if len(code) != len(expected) {
		return false
	}
	for i := 0; i < len(code); i++ {
		if code[i] < '0' || code[i] > '9' {
			return false
		}
	}

	period := int64(c.period())
	counter := int64(at.Unix() / period)

	for offset := -skew; offset <= skew; offset++ {
		candidate, err := hotp(c, uint64(counter+int64(offset)))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// ProvisioningURI builds the otpauth:// URI an authenticator app scans. The
// issuer and account are escaped per the Key URI format so a name containing a
// colon or a space cannot corrupt the URI.
func ProvisioningURI(issuer, account string, c Config) (string, error) {
	if err := c.Validate(); err != nil {
		return "", err
	}
	if issuer == "" {
		return "", errors.New("issuer is required")
	}
	if account == "" {
		return "", errors.New("account is required")
	}

	algorithm := "SHA1"
	switch c.Algorithm {
	case SHA256:
		algorithm = "SHA256"
	case SHA512:
		algorithm = "SHA512"
	}

	label := escape(issuer) + ":" + escape(account)
	return fmt.Sprintf(
		"otpauth://totp/%s?secret=%s&issuer=%s&algorithm=%s&digits=%d&period=%d",
		label, EncodeSecret(c.Secret), escape(issuer), algorithm, c.digits(), c.period(),
	), nil
}

// escape percent-encodes the characters that would break the URI structure.
func escape(s string) string {
	replacer := strings.NewReplacer(
		"%", "%25",
		":", "%3A",
		"/", "%2F",
		"?", "%3F",
		"#", "%23",
		"&", "%26",
		"=", "%3D",
		" ", "%20",
	)
	return replacer.Replace(s)
}
