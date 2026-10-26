package payment_integration

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
)

// mustRSAKey generates a throwaway key for the signature tests.
func mustRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("key generation failed: %v", err)
	}
	return key
}
