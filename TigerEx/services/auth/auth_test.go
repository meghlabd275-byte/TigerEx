package auth

import "testing"

func TestValidateEmail(t *testing.T) {
	valid := []string{"a@b.co", "trader.name@tigerex.io", "x@y.example.com"}
	for _, e := range valid {
		if err := ValidateEmail(e); err != nil {
			t.Errorf("expected %q valid, got %v", e, err)
		}
	}
	invalid := []string{"", "no-at", "@nodomain.com", "user@nodot", "a@b.", "a b@c.com", "a@@b.com", "a@"}
	for _, e := range invalid {
		if err := ValidateEmail(e); err == nil {
			t.Errorf("expected %q invalid", e)
		}
	}
}

func TestValidatePasswordStrength(t *testing.T) {
	if err := ValidatePasswordStrength("Short1Ab"); err != nil {
		t.Fatalf("8-char mixed password should pass: %v", err)
	}
	if err := ValidatePasswordStrength("alllowercase"); err != ErrWeakPassword {
		t.Fatalf("single-class password should fail, got %v", err)
	}
	if err := ValidatePasswordStrength("Ab1"); err != ErrWeakPassword {
		t.Fatalf("too-short password should fail, got %v", err)
	}
}

func TestLoginAndSessionLifecycle(t *testing.T) {
	s := NewAuthService()
	if _, err := s.Register("trader@tigerex.io", "Sup3rSecret"); err != nil {
		t.Fatalf("register: %v", err)
	}
	sess, err := s.Login("trader@tigerex.io", "Sup3rSecret", "10.0.0.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := s.ValidateSession(sess.TokenHash); err != nil {
		t.Fatalf("validate: %v", err)
	}
	s.Logout(sess.TokenHash)
	if _, err := s.ValidateSession(sess.TokenHash); err != ErrInvalidToken {
		t.Fatalf("logged-out session must be invalid, got %v", err)
	}
}

func TestLoginLocksAfterRepeatedFailures(t *testing.T) {
	s := NewAuthService()
	if _, err := s.Register("victim@tigerex.io", "Sup3rSecret"); err != nil {
		t.Fatalf("register: %v", err)
	}
	for i := 0; i < MaxFailedAttempts; i++ {
		if _, err := s.Login("victim@tigerex.io", "wrong", "10.0.0.1"); err != ErrInvalidCredentials {
			t.Fatalf("attempt %d: expected ErrInvalidCredentials, got %v", i, err)
		}
	}
	// The next attempt with the correct password is refused while locked.
	if _, err := s.Login("victim@tigerex.io", "Sup3rSecret", "10.0.0.1"); err != ErrAccountLocked {
		t.Fatalf("expected ErrAccountLocked, got %v", err)
	}
}

func TestGenerateAPIKeyReturnsSecretOnce(t *testing.T) {
	s := NewAuthService()
	key, secret, err := s.GenerateAPIKey("user-1", "bot", []string{"trade"})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if key.KeyID == "" || secret == "" {
		t.Fatal("key id and secret must both be present")
	}
	if key.ID == "" {
		t.Fatal("api key must have an id")
	}
}
