package payment_integration

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// CanonicalPaymentBytes builds the deterministic byte string that is signed for
// a payment. Every field that carries value or ownership is included, so a
// signature cannot be replayed against a different amount, currency, user or
// creation time.
func CanonicalPaymentBytes(id, userID, currency string, amount float64, createdAt time.Time) []byte {
	return []byte(fmt.Sprintf("tigerex-payment-v1|%s|%s|%.8f|%s|%d",
		id, userID, amount, strings.ToUpper(currency), createdAt.UnixMilli()))
}

// SignPaymentPayload signs a canonical payment payload with RSA PKCS#1 v1.5
// over SHA-256 and returns a base64 signature.
func SignPaymentPayload(payload []byte, privateKey *rsa.PrivateKey) (string, error) {
	if privateKey == nil {
		return "", fmt.Errorf("signing key is nil")
	}

	digest := sha256.Sum256(payload)
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign payment payload: %w", err)
	}

	return base64.StdEncoding.EncodeToString(signature), nil
}

// VerifyPaymentPayload checks a signature produced by SignPaymentPayload.
func VerifyPaymentPayload(payload []byte, signature string, publicKey *rsa.PublicKey) bool {
	if publicKey == nil {
		return false
	}

	sigBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return false
	}

	digest := sha256.Sum256(payload)
	return rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], sigBytes) == nil
}

// SerializePayment renders a payment as JSON.
func SerializePayment(payment *Payment) (string, error) {
	if payment == nil {
		return "", fmt.Errorf("payment is nil")
	}

	data, err := json.Marshal(payment)
	if err != nil {
		return "", fmt.Errorf("serialize payment: %w", err)
	}

	return string(data), nil
}

// DeserializePayment parses a payment from JSON.
func DeserializePayment(data string) (*Payment, error) {
	var payment Payment
	if err := json.Unmarshal([]byte(data), &payment); err != nil {
		return nil, fmt.Errorf("deserialize payment: %w", err)
	}
	if payment.ID == "" {
		return nil, fmt.Errorf("payment JSON carries no id")
	}

	return &payment, nil
}

// FormatCurrency renders an amount with the symbol for common currencies.
func FormatCurrency(amount float64, currency string) string {
	switch strings.ToUpper(currency) {
	case "USD":
		return fmt.Sprintf("$%.2f", amount)
	case "EUR":
		return fmt.Sprintf("€%.2f", amount)
	case "GBP":
		return fmt.Sprintf("£%.2f", amount)
	case "JPY":
		return fmt.Sprintf("¥%.0f", amount)
	case "BDT":
		return fmt.Sprintf("৳%.2f", amount)
	default:
		return fmt.Sprintf("%.2f %s", amount, currency)
	}
}

// LuhnValid reports whether a card number passes the Luhn checksum, the same
// check the card networks use to catch a mistyped digit.
func LuhnValid(cardNumber string) bool {
	digits := make([]int, 0, len(cardNumber))
	for _, r := range cardNumber {
		if r == ' ' || r == '-' {
			continue
		}
		if r < '0' || r > '9' {
			return false
		}
		digits = append(digits, int(r-'0'))
	}

	if len(digits) < 12 || len(digits) > 19 {
		return false
	}

	sum := 0
	double := false
	for i := len(digits) - 1; i >= 0; i-- {
		d := digits[i]
		if double {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		double = !double
	}

	return sum%10 == 0
}
