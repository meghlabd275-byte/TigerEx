package totp

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// The test vectors below are the published ones from RFC 4226 (HOTP) and
// RFC 6238 (TOTP). Matching them proves the implementation interoperates with
// any conforming authenticator app; a self-consistent implementation that
// matched only its own output would not.

func TestRFC4226HOTPVectors(t *testing.T) {
	// RFC 4226 appendix D: the secret is the ASCII string "12345678901234567890".
	secret := []byte("12345678901234567890")
	c := Config{Secret: secret}

	cases := []struct {
		counter uint64
		code    string
	}{
		{0, "755224"},
		{1, "287082"},
		{2, "359152"},
		{3, "969429"},
		{4, "338314"},
		{5, "254676"},
		{6, "287922"},
		{7, "162583"},
		{8, "399871"},
		{9, "520489"},
	}

	for _, tc := range cases {
		got, err := hotp(c, tc.counter)
		if err != nil {
			t.Fatalf("counter %d: %v", tc.counter, err)
		}
		if got != tc.code {
			t.Fatalf("counter %d: got %s, want %s", tc.counter, got, tc.code)
		}
	}
}

func TestRFC6238TOTPVectors(t *testing.T) {
	// RFC 6238 appendix B gives secrets of 20, 32, and 64 bytes for SHA-1,
	// SHA-256, and SHA-512 respectively.
	secretSHA1 := []byte("12345678901234567890")
	secretSHA256 := []byte("12345678901234567890123456789012")
	secretSHA512 := []byte("1234567890123456789012345678901234567890123456789012345678901234")

	cases := []struct {
		unix  int64
		sha1  string
		sha26 string
		sha51 string
	}{
		{59, "94287082", "46119246", "90693936"},
		{1111111109, "07081804", "68084774", "25091201"},
		{1111111111, "14050471", "67062674", "99943326"},
		{1234567890, "89005924", "91819424", "93441116"},
		{2000000000, "69279037", "90698825", "38618901"},
		{20000000000, "65353130", "77737706", "47863826"},
	}

	for _, tc := range cases {
		at := time.Unix(tc.unix, 0)

		got, err := Generate(Config{Secret: secretSHA1, Digits: 8, Algorithm: SHA1}, at)
		if err != nil {
			t.Fatalf("sha1 %d: %v", tc.unix, err)
		}
		if got != tc.sha1 {
			t.Fatalf("sha1 %d: got %s, want %s", tc.unix, got, tc.sha1)
		}

		got, err = Generate(Config{Secret: secretSHA256, Digits: 8, Algorithm: SHA256}, at)
		if err != nil {
			t.Fatalf("sha256 %d: %v", tc.unix, err)
		}
		if got != tc.sha26 {
			t.Fatalf("sha256 %d: got %s, want %s", tc.unix, got, tc.sha26)
		}

		got, err = Generate(Config{Secret: secretSHA512, Digits: 8, Algorithm: SHA512}, at)
		if err != nil {
			t.Fatalf("sha512 %d: %v", tc.unix, err)
		}
		if got != tc.sha51 {
			t.Fatalf("sha512 %d: got %s, want %s", tc.unix, got, tc.sha51)
		}
	}
}

func TestGenerateAndValidateRoundTrip(t *testing.T) {
	secret, err := GenerateSecret(20)
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	c := Config{Secret: secret}
	at := time.Unix(1700000000, 0)

	code, err := Generate(c, at)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("code length: got %d", len(code))
	}
	if !Validate(c, code, at) {
		t.Fatal("a freshly generated code was rejected")
	}
}

// TestValidateRejectsWrongCode is the regression test for verification that
// always returned true.
func TestValidateRejectsWrongCode(t *testing.T) {
	secret := []byte("12345678901234567890")
	c := Config{Secret: secret}
	at := time.Unix(1700000000, 0)

	// A code that is not the current one must be rejected.
	if Validate(c, "000000", at) {
		// "000000" is astronomically unlikely but check explicitly.
		code, _ := Generate(c, at)
		if code == "000000" {
			t.Skip("generated code happens to be 000000")
		}
		t.Fatal("an incorrect code was accepted")
	}
	if Validate(c, "999999", at) {
		code, _ := Generate(c, at)
		if code != "999999" {
			t.Fatal("an incorrect code was accepted")
		}
	}
}

// TestValidateRejectsMalformedCode checks the shape checks.
func TestValidateRejectsMalformedCode(t *testing.T) {
	secret := []byte("12345678901234567890")
	c := Config{Secret: secret}
	at := time.Unix(1700000000, 0)
	valid, _ := Generate(c, at)

	cases := []string{
		"",
		"12345",     // too short
		"1234567",   // too long
		"12345a",    // non-digit
		" 12345",    // whitespace
		valid + "0", // valid code plus a digit
	}
	for _, bad := range cases {
		if Validate(c, bad, at) {
			t.Fatalf("malformed code %q was accepted", bad)
		}
	}
}

// TestValidateAllowsOnePeriodSkew checks the drift window.
func TestValidateAllowsOnePeriodSkew(t *testing.T) {
	secret := []byte("12345678901234567890")
	c := Config{Secret: secret}
	at := time.Unix(1700000000, 0)

	previous, _ := Generate(c, at.Add(-30*time.Second))
	next, _ := Generate(c, at.Add(30*time.Second))
	twoAgo, _ := Generate(c, at.Add(-60*time.Second))

	if !Validate(c, previous, at) {
		t.Fatal("the previous period's code was rejected")
	}
	if !Validate(c, next, at) {
		t.Fatal("the next period's code was rejected")
	}
	if Validate(c, twoAgo, at) {
		t.Fatal("a code two periods old was accepted with a skew of 1")
	}
	if !ValidateWithSkew(c, twoAgo, at, 2) {
		t.Fatal("a code two periods old was rejected with a skew of 2")
	}
}

// TestValidateRejectsEmptySecret checks that a user without a secret cannot
// pass verification.
func TestValidateRejectsEmptySecret(t *testing.T) {
	at := time.Unix(1700000000, 0)
	if Validate(Config{}, "123456", at) {
		t.Fatal("an empty secret was accepted")
	}
	if Validate(Config{Secret: []byte{}}, "123456", at) {
		t.Fatal("an empty secret was accepted")
	}
}

// TestSecretEncodingRoundTrip checks the base32 handling.
func TestSecretEncodingRoundTrip(t *testing.T) {
	secret, err := GenerateSecret(20)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	encoded := EncodeSecret(secret)
	if strings.Contains(encoded, "=") {
		t.Fatalf("encoded secret contains padding: %s", encoded)
	}

	decoded, err := DecodeSecret(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if hex.EncodeToString(decoded) != hex.EncodeToString(secret) {
		t.Fatal("secret did not survive the encoding round trip")
	}

	// Lower case and padded input should decode to the same bytes.
	lower := strings.ToLower(encoded) + "="
	decoded, err = DecodeSecret(lower)
	if err != nil {
		t.Fatalf("decode lower/padded: %v", err)
	}
	if hex.EncodeToString(decoded) != hex.EncodeToString(secret) {
		t.Fatal("lower case or padded secret did not decode")
	}
}

func TestDecodeSecretRejectsInvalid(t *testing.T) {
	for _, bad := range []string{"", "   ", "not-base32!!", "1111"} {
		if _, err := DecodeSecret(bad); err == nil {
			t.Fatalf("invalid secret %q was accepted", bad)
		}
	}
}

// TestKnownSecretProducesKnownCode checks a value an authenticator app would
// also produce, using the ASCII secret from the RFC.
func TestKnownSecretProducesKnownCode(t *testing.T) {
	// "12345678901234567890" base32-encoded.
	encoded := EncodeSecret([]byte("12345678901234567890"))
	secret, err := DecodeSecret(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	code, err := Generate(Config{Secret: secret, Digits: 8}, time.Unix(59, 0))
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if code != "94287082" {
		t.Fatalf("got %s, want 94287082", code)
	}
}

func TestConfigValidation(t *testing.T) {
	cases := []Config{
		{Secret: nil},
		{Secret: []byte("abc"), Digits: 5},
		{Secret: []byte("abc"), Digits: 11},
		{Secret: []byte("abc"), Period: -1},
		{Secret: []byte("abc"), Period: 601},
	}
	for i, c := range cases {
		if err := c.Validate(); err == nil {
			t.Fatalf("case %d: invalid config was accepted", i)
		}
	}

	valid := []Config{
		{Secret: []byte("abc")},
		{Secret: []byte("abc"), Digits: 8, Period: 60, Algorithm: SHA512},
	}
	for i, c := range valid {
		if err := c.Validate(); err != nil {
			t.Fatalf("case %d: valid config rejected: %v", i, err)
		}
	}
}

// TestGenerateSecretIsRandom checks that two secrets differ.
func TestGenerateSecretIsRandom(t *testing.T) {
	a, err := GenerateSecret(20)
	if err != nil {
		t.Fatalf("generate a: %v", err)
	}
	b, err := GenerateSecret(20)
	if err != nil {
		t.Fatalf("generate b: %v", err)
	}
	if hex.EncodeToString(a) == hex.EncodeToString(b) {
		t.Fatal("two generated secrets were identical")
	}
	if len(a) != 20 {
		t.Fatalf("secret length: got %d, want 20", len(a))
	}
}

func TestProvisioningURI(t *testing.T) {
	secret := []byte("12345678901234567890")
	uri, err := ProvisioningURI("TigerEx", "alice@example.com", Config{Secret: secret})
	if err != nil {
		t.Fatalf("uri: %v", err)
	}
	for _, want := range []string{
		"otpauth://totp/",
		// The label is issuer:account with the separator colon literal and each
		// component escaped, per the Key URI format.
		"TigerEx:alice@example.com",
		"secret=" + EncodeSecret(secret),
		"issuer=TigerEx",
		"algorithm=SHA1",
		"digits=6",
		"period=30",
	} {
		if !strings.Contains(uri, want) {
			t.Fatalf("URI %q does not contain %q", uri, want)
		}
	}

	// A colon or space inside a component must be escaped so it cannot be
	// confused with the separator.
	escaped, err := ProvisioningURI("My Issuer", "a:b", Config{Secret: secret})
	if err != nil {
		t.Fatalf("uri: %v", err)
	}
	if !strings.Contains(escaped, "My%20Issuer:a%3Ab") {
		t.Fatalf("components were not escaped: %s", escaped)
	}

	if _, err := ProvisioningURI("", "a@b.c", Config{Secret: secret}); err == nil {
		t.Fatal("an empty issuer was accepted")
	}
	if _, err := ProvisioningURI("TigerEx", "", Config{Secret: secret}); err == nil {
		t.Fatal("an empty account was accepted")
	}
}

// TestCounterAdvancesWithTime checks that codes change each period.
func TestCounterAdvancesWithTime(t *testing.T) {
	secret := []byte("12345678901234567890")
	c := Config{Secret: secret}

	// Start at a timestamp aligned to the period boundary so the three samples
	// below fall in three different periods.
	base := int64(1700000010) // divisible by 30
	first, _ := Generate(c, time.Unix(base, 0))
	// Same period: 29 seconds later.
	same, _ := Generate(c, time.Unix(base+29, 0))
	if first != same {
		t.Fatal("the code changed within the same period")
	}
	// Next period.
	next, _ := Generate(c, time.Unix(base+30, 0))
	if first == next {
		t.Fatal("the code did not change between periods")
	}
}
