package auth_service

import (
	"fmt"
	"github.com/pquerna/otp/totp"
	"image/png"
	"bytes"
)

// GenerateTOTPSecret generates a new TOTP secret and returns it along with a QR code image.
func GenerateTOTPSecret(accountName, issuer string) (string, []byte, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: accountName,
	})
	if err != nil {
		return "", nil, fmt.Errorf("failed to generate TOTP key: %w", err)
	}

	// Convert TOTP key to QR code image
	var buf bytes.Buffer
	img, err := key.Image(200, 200)
	if err != nil {
		return "", nil, fmt.Errorf("failed to generate QR code image: %w", err)
	}
	png.Encode(&buf, img)

	return key.Secret(), buf.Bytes(), nil
}

// ValidateTOTPCode validates a TOTP code against a secret.
func ValidateTOTPCode(secret, code string) bool {
	return totp.Validate(code, secret)
}
