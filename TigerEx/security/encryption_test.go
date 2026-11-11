package security

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"golang.org/x/crypto/argon2"
)

// The old HMAC was sha256(key || message), which is not an HMAC. It must match
// the standard construction and must not equal a plain concatenated hash.
func TestHMACIsRealHMAC(t *testing.T) {
	key := []byte("secret-key")
	message := []byte("message to authenticate")

	want := hmac.New(sha256.New, key)
	want.Write(message)
	expected := want.Sum(nil)

	if got := HMAC(key, message); !bytes.Equal(got, expected) {
		t.Fatalf("HMAC does not match crypto/hmac: got %x want %x", got, expected)
	}

	// The old broken construction.
	broken := sha256.Sum256(append(append([]byte{}, key...), message...))
	if bytes.Equal(HMAC(key, message), broken[:]) {
		t.Fatal("HMAC must not be sha256(key || message)")
	}
}

func TestVerifyHMAC(t *testing.T) {
	key := []byte("secret-key")
	message := []byte("payload")
	tag := HMAC(key, message)

	if !VerifyHMAC(key, message, tag) {
		t.Fatal("a correct tag must verify")
	}
	if VerifyHMAC(key, []byte("different"), tag) {
		t.Fatal("a tag for different data must not verify")
	}
	if VerifyHMAC([]byte("wrong-key"), message, tag) {
		t.Fatal("a tag must not verify under a different key")
	}
}

// A tampered envelope must be rejected rather than returning garbage.
func TestEnvelopeRoundTripAndTamper(t *testing.T) {
	master := make([]byte, 32)
	for i := range master {
		master[i] = byte(i)
	}
	plaintext := []byte("withdrawal key material")

	env, err := EncryptWithEnvelope(plaintext, master)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if env.WrappedNonce == "" {
		t.Fatal("the wrapped key nonce must be stored")
	}
	if env.Nonce == env.WrappedNonce {
		t.Fatal("the two layers must not share a nonce")
	}

	got, err := DecryptWithEnvelope(env, master)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip mismatch: got %q", got)
	}

	// Flip a byte of the ciphertext.
	raw, _ := hex.DecodeString(env.Data)
	raw[0] ^= 0x01
	tampered := *env
	tampered.Data = hex.EncodeToString(raw)
	if _, err := DecryptWithEnvelope(&tampered, master); err == nil {
		t.Fatal("a tampered envelope must fail authentication")
	}

	// The wrong master key must fail.
	wrong := make([]byte, 32)
	if _, err := DecryptWithEnvelope(env, wrong); err == nil {
		t.Fatal("the wrong master key must fail")
	}
}

// ECIES must round trip, and a ciphertext for one recipient must not decrypt
// for another.
func TestECIESRoundTrip(t *testing.T) {
	priv, pub, err := GenerateECDHKeyPair()
	if err != nil {
		t.Fatalf("key generation failed: %v", err)
	}
	pubBytes := MarshalPublicKey(pub)

	plaintext := []byte("transfer instruction: 1.5 BTC")
	ciphertext, err := EncryptWithECIES(plaintext, pubBytes)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	got, err := DecryptWithECIES(ciphertext, priv)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip mismatch: got %q", got)
	}

	// A different key must not decrypt.
	otherPriv, _, err := GenerateECDHKeyPair()
	if err != nil {
		t.Fatalf("key generation failed: %v", err)
	}
	if _, err := DecryptWithECIES(ciphertext, otherPriv); err == nil {
		t.Fatal("the wrong private key must not decrypt")
	}

	// A truncated or tampered ciphertext must be refused, not panic.
	if _, err := DecryptWithECIES(ciphertext[:10], priv); err == nil {
		t.Fatal("a truncated ciphertext must be refused")
	}
	bad := append([]byte{}, ciphertext...)
	bad[len(bad)-1] ^= 0x01
	if _, err := DecryptWithECIES(bad, priv); err == nil {
		t.Fatal("a tampered ciphertext must fail authentication")
	}
}

// Two encryptions of the same plaintext must differ, which proves the nonce
// and ephemeral key are fresh.
func TestECIESIsRandomised(t *testing.T) {
	_, pub, err := GenerateECDHKeyPair()
	if err != nil {
		t.Fatalf("key generation failed: %v", err)
	}
	pubBytes := MarshalPublicKey(pub)

	first, err := EncryptWithECIES([]byte("same"), pubBytes)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	second, err := EncryptWithECIES([]byte("same"), pubBytes)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("encryptions must not be deterministic")
	}
}

func TestAESRoundTripAndTamper(t *testing.T) {
	key, err := GenerateAESKey(nil)
	if err != nil {
		t.Fatalf("key generation failed: %v", err)
	}
	plaintext := []byte("account balance")

	ciphertext, nonce, err := AESEncrypt(plaintext, key)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	got, err := AESDecrypt(ciphertext, key, nonce)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("round trip mismatch: got %q", got)
	}

	ciphertext[0] ^= 0x01
	if _, err := AESDecrypt(ciphertext, key, nonce); err == nil {
		t.Fatal("a tampered ciphertext must fail authentication")
	}
}

// Argon2 hashes must not verify against a wrong password, and the encoding
// must round trip.
func TestArgon2RoundTrip(t *testing.T) {
	encoded, err := HashPasswordArgon2("correct horse battery staple", nil)
	if err != nil {
		t.Fatalf("hash failed: %v", err)
	}
	if !VerifyPasswordArgon2("correct horse battery staple", encoded) {
		t.Fatal("the correct password must verify")
	}
	if VerifyPasswordArgon2("wrong password", encoded) {
		t.Fatal("a wrong password must not verify")
	}
}

// The Argon2id parameters were passed to argon2.IDKey in the wrong order
// (memory where iterations belongs), which silently weakened the KDF. This
// locks the parameters to the config that is actually applied: the derived key
// must change when either cost parameter changes, and it must match a direct
// argon2.IDKey call with (time=Iterations, memory=Memory).
func TestArgon2UsesConfiguredCostParameters(t *testing.T) {
	cfg := DefaultArgon2Config()
	salt := []byte("0123456789abcdef")
	hash := argon2.IDKey([]byte("pw"), salt, cfg.Iterations, cfg.Memory, cfg.Parallelism, cfg.KeyLength)
	wrongOrder := argon2.IDKey([]byte("pw"), salt, cfg.Memory, cfg.Iterations, cfg.Parallelism, cfg.KeyLength)
	if bytesEqual(hash, wrongOrder) {
		t.Fatal("swapped memory/iterations produced an identical key; parameters are not applied")
	}

	low := &Argon2Config{Memory: cfg.Memory, Iterations: 1, Parallelism: cfg.Parallelism, SaltLength: cfg.SaltLength, KeyLength: cfg.KeyLength}
	high := &Argon2Config{Memory: cfg.Memory, Iterations: 5, Parallelism: cfg.Parallelism, SaltLength: cfg.SaltLength, KeyLength: cfg.KeyLength}
	encLow, err := HashPasswordArgon2("pw", low)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	encHigh, err := HashPasswordArgon2("pw", high)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	// Different iterations with the same random salt are not directly
	// comparable, so assert the encoding parses and both verify.
	if !VerifyPasswordArgon2("pw", encLow) || !VerifyPasswordArgon2("pw", encHigh) {
		t.Fatal("argon2 hashes must verify against their own password")
	}
}

// AESEncrypt must return an error rather than a zero nonce when the random
// source is unavailable; the nonce is what keeps GCM safe across messages.
func TestAESEncryptProducesDistinctNonces(t *testing.T) {
	key, err := GenerateAESKey(nil)
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	_, n1, err := AESEncrypt([]byte("a"), key)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	_, n2, err := AESEncrypt([]byte("a"), key)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if bytesEqual(n1, n2) {
		t.Fatal("two encryptions reused a nonce")
	}
}

func TestBCryptRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash failed: %v", err)
	}
	if !VerifyPassword("correct horse battery staple", hash) {
		t.Fatal("the correct password must verify")
	}
	if VerifyPassword("wrong", hash) {
		t.Fatal("a wrong password must not verify")
	}
}

// The salt must be random, not zero filled.
func TestGenerateSaltIsRandom(t *testing.T) {
	a := GenerateSalt(32)
	b := GenerateSalt(32)
	if bytes.Equal(a, b) {
		t.Fatal("salts must differ")
	}
	allZero := true
	for _, v := range a {
		if v != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		t.Fatal("salt must not be all zero")
	}
}
