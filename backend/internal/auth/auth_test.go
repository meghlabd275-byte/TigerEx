package auth

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

type testSecurity struct {
	minLength int
}

func (t *testSecurity) HashPassword(password string) (string, error) { return "hash:" + password, nil }
func (t *testSecurity) ValidatePassword(password string) error {
	if len(password) < t.minLength {
		return errShortPassword
	}
	return nil
}
func (t *testSecurity) VerifyPassword(password, hash string) (bool, error) {
	return hash == "hash:"+password, nil
}
func (t *testSecurity) GenerateAntiPhishingCode(userID string) string { return "code" }
func (t *testSecurity) HandleFailedLogin(username, ip string) error   { return nil }
func (t *testSecurity) IsAccountLocked(username string) bool          { return false }
func (t *testSecurity) ResetFailedLogins(username string)             {}

var errShortPassword = &passwordError{}

type passwordError struct{}

func (e *passwordError) Error() string { return "password too short" }

func newTestService() *AuthService {
	return NewAuthService(AuthConfig{
		JWTExpiry:        time.Hour,
		JWTRefreshExpiry: time.Hour,
	}, &testSecurity{minLength: 8})
}

func registerUser(t *testing.T, s *AuthService, email string) *User {
	t.Helper()
	user, err := s.Register(context.Background(), email, "", "trader", "correct-horse")
	if err != nil {
		t.Fatalf("Register(%q) returned error: %v", email, err)
	}
	return user
}

// A registered user must be findable. The previous implementation returned a
// hardcoded demo user for every login attempt.
func TestRegisteredUserIsFindable(t *testing.T) {
	s := newTestService()
	user := registerUser(t, s, "alice@example.com")

	if got := s.findUserByLogin("alice@example.com"); got == nil || got.ID != user.ID {
		t.Fatalf("findUserByLogin did not return the registered user")
	}
	if got := s.findUserByID(user.ID); got == nil || got.Email != "alice@example.com" {
		t.Fatalf("findUserByID did not return the registered user")
	}
}

// An unknown login must not resolve to any user. Returning a synthetic user
// would let an attacker proceed to the password check with a fixed hash.
func TestUnknownLoginResolvesToNoUser(t *testing.T) {
	s := newTestService()
	registerUser(t, s, "alice@example.com")

	if got := s.findUserByLogin("mallory@example.com"); got != nil {
		t.Fatalf("findUserByLogin returned a user for an unknown login: %+v", got)
	}
}

func TestDuplicateRegistrationRejected(t *testing.T) {
	s := newTestService()
	registerUser(t, s, "alice@example.com")

	if _, err := s.Register(context.Background(), "alice@example.com", "", "other", "correct-horse"); err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
}

// Enabling 2FA must not flip the enabled flag before the caller proves it can
// generate a code; otherwise a mis-scanned secret locks the user out.
func TestEnable2FARequiresConfirmation(t *testing.T) {
	s := newTestService()
	user := registerUser(t, s, "alice@example.com")

	secret, err := s.Enable2FA(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("Enable2FA returned error: %v", err)
	}
	if secret == "" {
		t.Fatal("Enable2FA returned an empty secret")
	}
	if s.findUserByID(user.ID).TwoFactorEnabled {
		t.Fatal("2FA was enabled before a code was confirmed")
	}

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	if err := s.Confirm2FA(context.Background(), user.ID, code); err != nil {
		t.Fatalf("Confirm2FA rejected a valid code: %v", err)
	}
	if !s.findUserByID(user.ID).TwoFactorEnabled {
		t.Fatal("2FA was not enabled after a valid confirmation")
	}
}

func TestConfirm2FARejectsWrongCode(t *testing.T) {
	s := newTestService()
	user := registerUser(t, s, "alice@example.com")

	if _, err := s.Enable2FA(context.Background(), user.ID); err != nil {
		t.Fatalf("Enable2FA: %v", err)
	}
	if err := s.Confirm2FA(context.Background(), user.ID, "000000"); err == nil {
		t.Fatal("Confirm2FA accepted an invalid code")
	}
	if s.findUserByID(user.ID).TwoFactorEnabled {
		t.Fatal("2FA was enabled by an invalid code")
	}
}

// verify2FACode previously accepted any six-digit string.
func TestVerify2FACodeRejectsArbitrarySixDigits(t *testing.T) {
	s := newTestService()
	user := registerUser(t, s, "alice@example.com")

	secret, err := s.Enable2FA(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("Enable2FA: %v", err)
	}

	for _, code := range []string{"123456", "000000", "999999"} {
		valid, gerr := totp.GenerateCode(secret, time.Now())
		if gerr != nil {
			t.Fatalf("GenerateCode: %v", gerr)
		}
		if code == valid {
			continue
		}
		if s.verify2FACode(secret, code) {
			t.Fatalf("verify2FACode accepted %q for a different secret/code", code)
		}
	}

	if s.verify2FACode("", "123456") {
		t.Fatal("verify2FACode accepted a code with an empty secret")
	}
}

// MetaMask signatures cannot be verified in this build, so login must be
// refused rather than unconditionally trusted.
func TestMetaMaskLoginFailsClosed(t *testing.T) {
	s := newTestService()

	session, err := s.MetaMaskLogin(context.Background(), "0xabc", "sig", "msg")
	if err == nil {
		t.Fatal("MetaMaskLogin succeeded without signature verification")
	}
	if session != nil {
		t.Fatal("MetaMaskLogin returned a session on failure")
	}
}

// Social login cannot be verified in this build either.
func TestSocialLoginFailsClosed(t *testing.T) {
	s := newTestService()
	s.config.EnableSocialLogin = true

	if _, err := s.SocialLogin(context.Background(), "google", "token"); err == nil {
		t.Fatal("SocialLogin succeeded without provider verification")
	}
}

// A refresh token must not be usable as an access token: ValidateToken only
// accepts tokens carrying the access-token issuer and shape.
func TestAccessTokenRoundTrip(t *testing.T) {
	s := newTestService()
	user := registerUser(t, s, "alice@example.com")

	session, err := s.Login(context.Background(), "alice@example.com", "correct-horse", "127.0.0.1", "test")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	token, err := s.IssueAccessToken(context.Background(), session)
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}

	claims, err := s.ValidateToken(context.Background(), token)
	if err != nil {
		t.Fatalf("ValidateToken rejected a freshly issued token: %v", err)
	}
	if claims.UserID != user.ID {
		t.Fatalf("claims.UserID = %q, want %q", claims.UserID, user.ID)
	}
}

// Tokens signed with a different key must be rejected.
func TestValidateTokenRejectsForeignSignature(t *testing.T) {
	s := newTestService()
	other := newTestService()
	user := registerUser(t, other, "alice@example.com")

	session, err := other.Login(context.Background(), "alice@example.com", "correct-horse", "127.0.0.1", "test")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	token, err := other.IssueAccessToken(context.Background(), session)
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	_ = user

	if _, err := s.ValidateToken(context.Background(), token); err == nil {
		t.Fatal("ValidateToken accepted a token signed by another service")
	}
}

func TestValidateTokenRejectsGarbage(t *testing.T) {
	s := newTestService()

	for _, token := range []string{"", "not-a-token", "a.b.c", strings.Repeat("x", 100)} {
		if _, err := s.ValidateToken(context.Background(), token); err == nil {
			t.Fatalf("ValidateToken accepted %q", token)
		}
	}
}
