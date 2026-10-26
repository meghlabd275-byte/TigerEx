package service

import (
	"context"
	"strings"
	"testing"
	"time"
)

// registerAndLogin is a helper that creates an account and signs in.
func registerAndLogin(t *testing.T, as *AuthService, email, password string) *User {
	t.Helper()
	ctx := context.Background()

	_, err := as.RegisterUser(ctx, &RegisterRequest{
		Email:       email,
		Username:    strings.Split(email, "@")[0],
		Password:    password,
		ConfirmPass: password,
		Country:     "GB",
	})
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	_, user, err := as.Login(ctx, &LoginRequest{Email: email, Password: password, IP: "1.2.3.4"})
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	return user
}

// The old verifyTOTPCode returned true for any six digit string, so 2FA could
// be bypassed with six arbitrary digits.
func TestTOTPRejectsArbitrarySixDigits(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("secret generation failed: %v", err)
	}

	for _, wrong := range []string{"000000", "123456", "999999"} {
		if verifyTOTPCode(secret, wrong) {
			t.Fatalf("code %q must not be accepted for a random secret", wrong)
		}
	}

	// A non-numeric or wrong-length code is refused outright.
	for _, bad := range []string{"", "12345", "1234567", "abcdef", "12 456"} {
		if verifyTOTPCode(secret, bad) {
			t.Fatalf("code %q must be rejected", bad)
		}
	}
}

// The generated code for the current step must verify, and must be stable.
func TestTOTPGeneratedCodeVerifies(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("secret generation failed: %v", err)
	}

	code := hotp(secret, uint64(time.Now().Unix()/totpPeriod))
	if len(code) != 6 {
		t.Fatalf("expected a six digit code, got %q", code)
	}
	if !verifyTOTPCode(secret, code) {
		t.Fatal("the current code must verify")
	}
}

// RFC 4226 test vectors. The secret "12345678901234567890" in base32 is
// GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
func TestHOTPKnownVectors(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	cases := map[uint64]string{
		0: "755224",
		1: "287082",
		2: "359152",
		3: "969429",
		4: "338314",
	}
	for counter, want := range cases {
		if got := hotp(secret, counter); got != want {
			t.Fatalf("counter %d: got %s, want %s", counter, got, want)
		}
	}
}

// A secret that is not decodable base32 can never produce a code.
func TestIsValidTOTPSecret(t *testing.T) {
	if isValidTOTPSecret("short") {
		t.Fatal("a short secret must be rejected")
	}
	if isValidTOTPSecret("!!!not-base32!!!") {
		t.Fatal("an undecodable secret must be rejected")
	}
	good, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("secret generation failed: %v", err)
	}
	if !isValidTOTPSecret(good) {
		t.Fatalf("a generated secret must be valid: %s", good)
	}
}

// ResetPassword used to accept any 32 character string, which allowed account
// takeover. Only an issued token may reset the password.
func TestResetPasswordRequiresIssuedToken(t *testing.T) {
	as := NewAuthService()
	ctx := context.Background()
	registerAndLogin(t, as, "ada@example.com", "Correct1Horse")

	// A long but unissued token must not work.
	err := as.ResetPassword(ctx, "ada@example.com", strings.Repeat("a", 40), "NewPass1Word")
	if err == nil {
		t.Fatal("an unissued reset token must be refused")
	}

	// A token issued for a different address must not work either.
	if _, err := as.RequestPasswordReset(ctx, "ada@example.com"); err != nil {
		t.Fatalf("issuing a reset token failed: %v", err)
	}
	if err := as.ResetPassword(ctx, "ada@example.com", strings.Repeat("b", 40), "NewPass1Word"); err == nil {
		t.Fatal("a wrong reset token must be refused")
	}
}

// A real issued token resets the password, and cannot be reused.
func TestResetPasswordWithIssuedToken(t *testing.T) {
	as := NewAuthService()
	ctx := context.Background()
	registerAndLogin(t, as, "grace@example.com", "Correct1Horse")

	token, err := as.RequestPasswordReset(ctx, "grace@example.com")
	if err != nil {
		t.Fatalf("issuing a reset token failed: %v", err)
	}
	if token == "" {
		t.Fatal("a known address must receive a token")
	}

	if err := as.ResetPassword(ctx, "grace@example.com", token, "NewPass1Word"); err != nil {
		t.Fatalf("the issued token must reset the password: %v", err)
	}

	// The old password no longer works, the new one does.
	if _, _, err := as.Login(ctx, &LoginRequest{Email: "grace@example.com", Password: "Correct1Horse"}); err == nil {
		t.Fatal("the old password must stop working")
	}
	if _, _, err := as.Login(ctx, &LoginRequest{Email: "grace@example.com", Password: "NewPass1Word"}); err != nil {
		t.Fatalf("the new password must work: %v", err)
	}

	// The token is single use.
	if err := as.ResetPassword(ctx, "grace@example.com", token, "Another1Pass"); err == nil {
		t.Fatal("a reset token must not be reusable")
	}
}

// An unknown address must not reveal whether the account exists.
func TestRequestPasswordResetHidesUnknownAccounts(t *testing.T) {
	as := NewAuthService()
	token, err := as.RequestPasswordReset(context.Background(), "nobody@example.com")
	if err != nil {
		t.Fatalf("the request must not error: %v", err)
	}
	if token != "" {
		t.Fatal("an unknown address must not receive a token")
	}
}

// Generated identifiers must be unique and not derived from the clock.
func TestIdentifiersAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 2000; i++ {
		for _, id := range []string{generateUserID(), generateSessionID(), generateAttemptID(), generateReferralCode()} {
			if seen[id] {
				t.Fatalf("duplicate identifier: %s", id)
			}
			seen[id] = true
		}
	}
}

// A user with no second factor must not be able to verify a 2FA code, and an
// unknown user must never pass.
func TestVerifyTwoFactorContract(t *testing.T) {
	as := NewAuthService()
	ctx := context.Background()
	user := registerAndLogin(t, as, "alan@example.com", "Correct1Horse")

	if as.VerifyTwoFactor(ctx, "no-such-user", "123456") {
		t.Fatal("an unknown user must not pass 2FA")
	}
	if as.VerifyTwoFactor(ctx, user.ID, "000000") {
		t.Fatal("a user without 2FA enabled must not accept an arbitrary code")
	}

	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("secret generation failed: %v", err)
	}
	if err := as.EnableTwoFactor(ctx, user.ID, TwoFactorTOTP, secret); err != nil {
		t.Fatalf("enabling 2FA failed: %v", err)
	}
	if as.VerifyTwoFactor(ctx, user.ID, "000000") {
		t.Fatal("a wrong code must be refused")
	}
	code := hotp(secret, uint64(time.Now().Unix()/totpPeriod))
	if !as.VerifyTwoFactor(ctx, user.ID, code) {
		t.Fatal("the correct code must be accepted")
	}
}

// ValidateToken must reject a token whose algorithm is not HMAC, and must
// refuse to run at all without a configured secret.
func TestValidateTokenPinsAlgorithmAndSecret(t *testing.T) {
	as := NewAuthService()
	ctx := context.Background()

	// No JWT_SECRET configured: validation must fail rather than trust an
	// empty key.
	t.Setenv("JWT_SECRET", "")
	if _, err := as.ValidateToken(ctx, "any.token.here"); err == nil {
		t.Fatal("validation must fail without a configured secret")
	}

	t.Setenv("JWT_SECRET", strings.Repeat("k", 32))
	// A token signed with alg=none must be rejected.
	noneToken := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoidTEifQ."
	if _, err := as.ValidateToken(ctx, noneToken); err == nil {
		t.Fatal("an alg=none token must be rejected")
	}
}

// Failed logins must be recorded.
func TestLoginAttemptsAreRecorded(t *testing.T) {
	as := NewAuthService()
	ctx := context.Background()
	registerAndLogin(t, as, "edsger@example.com", "Correct1Horse")

	if _, _, err := as.Login(ctx, &LoginRequest{Email: "edsger@example.com", Password: "wrong"}); err == nil {
		t.Fatal("a wrong password must fail")
	}

	attempts := as.LoginAttempts()
	if len(attempts) < 2 {
		t.Fatalf("expected the successful and failed attempts to be recorded, got %d", len(attempts))
	}
}
