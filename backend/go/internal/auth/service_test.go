package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"tigerex/backend/internal/api"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	svc := NewService(Config{
		JWT: JWTConfig{
			Secret:        []byte("test-secret-at-least-32-characters-long"),
			AccessExpiry:  15 * time.Minute,
			RefreshExpiry: 7 * 24 * time.Hour,
		},
		MaxLoginAttempts: 3,
		LockoutDuration:  15 * time.Minute,
		SessionExpiry:    time.Hour,
	})
	return svc.WithStore(NewMemStore(3, 15*time.Minute))
}

func hash(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	return string(h)
}

// TestCreateUserRequiresStore is the regression test for a registration that
// silently persisted nothing.
func TestCreateUserRequiresStore(t *testing.T) {
	svc := NewService(Config{})
	user := &api.User{Email: "a@b.c", Username: "a", Password: hash(t, "password123")}

	if err := svc.CreateUser(context.Background(), user); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
	if _, err := svc.GetUserByEmail(context.Background(), "a@b.c"); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
}

// TestCreateAndLoginRoundTrip checks that a registered user can be found and
// their password verified.
func TestCreateAndLoginRoundTrip(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	user := &api.User{
		ID:       "11111111-1111-1111-1111-111111111111",
		Email:    "alice@example.com",
		Username: "alice",
		Password: hash(t, "s3cret-password"),
	}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create: %v", err)
	}
	if user.CreatedAt == 0 {
		t.Fatal("created_at was not set")
	}

	got, err := svc.GetUserByEmail(ctx, "alice@example.com")
	if err != nil {
		t.Fatalf("get by email: %v", err)
	}
	if got.ID != user.ID {
		t.Fatalf("id: got %s, want %s", got.ID, user.ID)
	}
	if err := svc.VerifyPassword("s3cret-password", got.Password); err != nil {
		t.Fatalf("verify password: %v", err)
	}
	if err := svc.VerifyPassword("wrong", got.Password); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected invalid credentials, got %v", err)
	}

	// Case-insensitive lookup.
	if _, err := svc.GetUserByEmail(ctx, "ALICE@EXAMPLE.COM"); err != nil {
		t.Fatalf("case-insensitive lookup failed: %v", err)
	}
}

// TestCreateUserRejectsPlaintextPassword checks the hash guard.
func TestCreateUserRejectsPlaintextPassword(t *testing.T) {
	svc := newTestService(t)
	user := &api.User{Email: "a@b.c", Username: "a", Password: "plaintext"}

	if err := svc.CreateUser(context.Background(), user); err == nil {
		t.Fatal("a plaintext password was accepted")
	}
}

// TestCreateUserRejectsDuplicate checks uniqueness on email and username.
func TestCreateUserRejectsDuplicate(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	first := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, first); err != nil {
		t.Fatalf("first create: %v", err)
	}

	dupEmail := &api.User{ID: "id-2", Email: "A@B.C", Username: "bob", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, dupEmail); !errors.Is(err, ErrUserExists) {
		t.Fatalf("expected ErrUserExists for duplicate email, got %v", err)
	}

	dupUser := &api.User{ID: "id-3", Email: "c@d.e", Username: "ALICE", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, dupUser); !errors.Is(err, ErrUserExists) {
		t.Fatalf("expected ErrUserExists for duplicate username, got %v", err)
	}

	if !svc.EmailExists(ctx, "a@b.c") {
		t.Fatal("EmailExists returned false for a registered email")
	}
	if !svc.UsernameExists(ctx, "alice") {
		t.Fatal("UsernameExists returned false for a registered username")
	}
	if svc.EmailExists(ctx, "nobody@example.com") {
		t.Fatal("EmailExists returned true for an unregistered email")
	}
}

// TestExistsFailsClosedWithoutStore checks the safe direction when no store is
// configured.
func TestExistsFailsClosedWithoutStore(t *testing.T) {
	svc := NewService(Config{})
	if !svc.EmailExists(context.Background(), "a@b.c") {
		t.Fatal("EmailExists should report true (taken) without a store, to block registration")
	}
	if !svc.UsernameExists(context.Background(), "alice") {
		t.Fatal("UsernameExists should report true without a store")
	}
}

// TestAccountLockoutAfterFailedAttempts checks the lockout counter.
func TestAccountLockoutAfterFailedAttempts(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	user := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create: %v", err)
	}

	if svc.IsAccountLocked(ctx, user.ID) {
		t.Fatal("a fresh account was locked")
	}

	for i := 0; i < 2; i++ {
		svc.RecordFailedAttempt(ctx, user.ID)
	}
	if svc.IsAccountLocked(ctx, user.ID) {
		t.Fatal("the account locked before reaching the threshold")
	}
	svc.RecordFailedAttempt(ctx, user.ID)
	if !svc.IsAccountLocked(ctx, user.ID) {
		t.Fatal("the account did not lock after reaching the threshold")
	}

	svc.ClearFailedAttempts(ctx, user.ID)
	if svc.IsAccountLocked(ctx, user.ID) {
		t.Fatal("the account stayed locked after clearing failed attempts")
	}
}

// TestLockoutExpires checks that a lockout is not permanent.
func TestLockoutExpires(t *testing.T) {
	store := NewMemStore(1, time.Millisecond)
	ctx := context.Background()
	if err := store.CreateUser(ctx, &api.User{ID: "id-1", Email: "a@b.c", Username: "a"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.RecordFailedAttempt(ctx, "id-1"); err != nil {
		t.Fatalf("record: %v", err)
	}
	locked, err := store.IsLocked(ctx, "id-1")
	if err != nil {
		t.Fatalf("is locked: %v", err)
	}
	if !locked {
		t.Fatal("the account was not locked")
	}

	time.Sleep(5 * time.Millisecond)
	locked, err = store.IsLocked(ctx, "id-1")
	if err != nil {
		t.Fatalf("is locked: %v", err)
	}
	if locked {
		t.Fatal("the lockout did not expire")
	}
}

// TestPasswordResetTokenIsSingleUse checks the reset flow.
func TestPasswordResetTokenIsSingleUse(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	user := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create: %v", err)
	}

	token, err := svc.GeneratePasswordResetToken(ctx, user.ID)
	if err != nil {
		t.Fatalf("generate reset: %v", err)
	}
	if token == "" {
		t.Fatal("empty reset token")
	}

	gotID, err := svc.ConsumePasswordResetToken(ctx, token)
	if err != nil {
		t.Fatalf("consume: %v", err)
	}
	if gotID != user.ID {
		t.Fatalf("user id: got %s, want %s", gotID, user.ID)
	}

	// A second use must fail.
	if _, err := svc.ConsumePasswordResetToken(ctx, token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a reset token was usable twice: %v", err)
	}
	// An unknown token must fail.
	if _, err := svc.ConsumePasswordResetToken(ctx, "deadbeef"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("an unknown token was accepted: %v", err)
	}
	// Generating for an unknown user must fail.
	if _, err := svc.GeneratePasswordResetToken(ctx, "no-such-user"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

// TestResetTokenIsStoredHashed checks that the raw token is not persisted.
func TestResetTokenIsStoredHashed(t *testing.T) {
	store := NewMemStore(3, time.Minute)
	ctx := context.Background()
	if err := store.CreateUser(ctx, &api.User{ID: "id-1", Email: "a@b.c", Username: "a"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := store.StoreResetToken(ctx, HashResetToken("raw-token"), "id-1", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("store: %v", err)
	}
	if _, ok := store.resetKeys["raw-token"]; ok {
		t.Fatal("the raw reset token was stored")
	}
	if _, ok := store.resetKeys[HashResetToken("raw-token")]; !ok {
		t.Fatal("the hashed reset token was not stored")
	}
}

// TestAPIKeyLifecycle checks creation, listing, validation, and deletion.
func TestAPIKeyLifecycle(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	user := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create user: %v", err)
	}

	created, err := svc.CreateAPIKey(ctx, &APIKeyRequest{
		UserID:      user.ID,
		Label:       "bot",
		Permissions: []string{"read", "trade"},
		IPWhitelist: []string{"203.0.113.5"},
	})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if created.Secret == "" {
		t.Fatal("the plaintext secret was not returned on creation")
	}
	plaintext := created.Secret

	// The listing must not expose secrets.
	keys, err := svc.GetAPIKeys(ctx, user.ID)
	if err != nil {
		t.Fatalf("list keys: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(keys))
	}
	if keys[0].Secret != "" {
		t.Fatal("the listing exposed the secret hash")
	}

	// Validation with the correct secret and an allowed IP succeeds.
	validated, err := svc.ValidateAPIKey(ctx, created.Key, plaintext, "203.0.113.5")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if validated.ID != created.ID {
		t.Fatalf("validated wrong key: %s", validated.ID)
	}
	if validated.Secret != "" {
		t.Fatal("validation returned secret material")
	}

	// Wrong secret fails.
	if _, err := svc.ValidateAPIKey(ctx, created.Key, "wrong", "203.0.113.5"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected invalid credentials for a wrong secret, got %v", err)
	}
	// Wrong IP fails.
	if _, err := svc.ValidateAPIKey(ctx, created.Key, plaintext, "198.51.100.9"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected invalid credentials for a disallowed IP, got %v", err)
	}
	// Unknown key fails.
	if _, err := svc.ValidateAPIKey(ctx, "no-such-key", plaintext, "203.0.113.5"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected invalid credentials for an unknown key, got %v", err)
	}

	// Deletion.
	if err := svc.DeleteAPIKey(ctx, user.ID, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	keys, err = svc.GetAPIKeys(ctx, user.ID)
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("expected 0 keys after delete, got %d", len(keys))
	}
	if err := svc.DeleteAPIKey(ctx, user.ID, created.ID); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("deleting a missing key should be ErrInvalidToken, got %v", err)
	}
}

// TestAPIKeyExpiry checks that an expired key is refused.
func TestAPIKeyExpiry(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	user := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create user: %v", err)
	}

	created, err := svc.CreateAPIKey(ctx, &APIKeyRequest{
		UserID:    user.ID,
		Label:     "expired",
		ExpiresAt: api.Now() - 60,
	})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if _, err := svc.ValidateAPIKey(ctx, created.Key, created.Secret, ""); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

// TestTokenPairAndVerify checks JWT issuance and validation.
func TestTokenPairAndVerify(t *testing.T) {
	svc := newTestService(t)
	user := &api.User{ID: "id-1", Email: "a@b.c"}

	access, refresh, expiresAt, err := svc.GenerateTokenPair(user)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if access == "" || refresh == "" || expiresAt == 0 {
		t.Fatal("incomplete token pair")
	}
	if access == refresh {
		t.Fatal("access and refresh tokens are identical")
	}

	claims, err := svc.VerifyToken(access)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims["sub"] != user.ID {
		t.Fatalf("sub: got %v, want %s", claims["sub"], user.ID)
	}
	if claims["type"] != "access" {
		t.Fatalf("type: got %v", claims["type"])
	}

	// A tampered token is rejected.
	if _, err := svc.VerifyToken(access + "x"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a tampered token was accepted: %v", err)
	}
	// A token signed with a different key is rejected.
	other := NewService(Config{JWT: JWTConfig{Secret: []byte("another-secret-at-least-32-characters")}})
	if _, err := other.VerifyToken(access); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a token signed with another key was accepted: %v", err)
	}
	// No secret means no token.
	empty := NewService(Config{})
	if _, _, _, err := empty.GenerateTokenPair(user); err == nil {
		t.Fatal("a token pair was generated without a signing secret")
	}
	if _, err := empty.VerifyToken(access); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("a token was verified without a signing secret: %v", err)
	}
}

// TestVerifyTokenRejectsExpired checks expiry.
func TestVerifyTokenRejectsExpired(t *testing.T) {
	svc := NewService(Config{JWT: JWTConfig{
		Secret:       []byte("test-secret-at-least-32-characters-long"),
		AccessExpiry: -time.Hour,
	}})
	access, _, _, err := svc.GenerateTokenPair(&api.User{ID: "id-1"})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := svc.VerifyToken(access); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

// TestSignAndVerify checks the HMAC API signature scheme.
func TestSignAndVerify(t *testing.T) {
	svc := newTestService(t)
	sig := svc.Sign("payload", "secret")
	if sig == "" {
		t.Fatal("empty signature")
	}
	if !svc.Verify("payload", sig, "secret") {
		t.Fatal("a valid signature was rejected")
	}
	if svc.Verify("payload", sig, "other-secret") {
		t.Fatal("a signature verified under the wrong secret")
	}
	if svc.Verify("tampered", sig, "secret") {
		t.Fatal("a signature verified for different data")
	}
}

// TestGetSettings checks defaults and unknown users.
func TestGetSettings(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	user := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create: %v", err)
	}

	settings, err := svc.GetSettings(ctx, user.ID)
	if err != nil {
		t.Fatalf("settings: %v", err)
	}
	if settings.Language != "en" || settings.Theme != "dark" {
		t.Fatalf("unexpected defaults: %+v", settings)
	}
	if _, err := svc.GetSettings(ctx, "no-such-user"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

// TestUpdateUser checks persistence of an update.
func TestUpdateUser(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	user := &api.User{ID: "id-1", Email: "a@b.c", Username: "alice", Password: hash(t, "password123")}
	if err := svc.CreateUser(ctx, user); err != nil {
		t.Fatalf("create: %v", err)
	}

	user.TwoFactorEnabled = true
	user.TwoFactorSecret = "SOMEBASE32SECRET"
	if err := svc.UpdateUser(ctx, user); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := svc.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !got.TwoFactorEnabled || got.TwoFactorSecret != "SOMEBASE32SECRET" {
		t.Fatalf("update did not persist: %+v", got)
	}

	// Updating an unknown user is an error.
	unknown := &api.User{ID: "no-such-user"}
	if err := svc.UpdateUser(ctx, unknown); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
	if err := svc.UpdateUser(ctx, nil); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound for nil user, got %v", err)
	}
}

// TestSanitizeEmail checks masking.
func TestSanitizeEmail(t *testing.T) {
	cases := map[string]string{
		"alice@example.com": "a***e@example.com",
		"ab@example.com":    "**@example.com",
		"a@example.com":     "*@example.com",
		"":                  "",
		"not-an-email":      "",
	}
	for in, want := range cases {
		if got := SanitizeEmail(in); got != want {
			t.Fatalf("SanitizeEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestConstantTimeCompare checks the helper.
func TestConstantTimeCompare(t *testing.T) {
	if !ConstantTimeCompare("abc", "abc") {
		t.Fatal("equal strings compared unequal")
	}
	if ConstantTimeCompare("abc", "abd") {
		t.Fatal("different strings compared equal")
	}
	if ConstantTimeCompare("abc", "abcd") {
		t.Fatal("different-length strings compared equal")
	}
}

// TestMemStoreIsSafeForConcurrentUse exercises the mutex under -race.
func TestMemStoreIsSafeForConcurrentUse(t *testing.T) {
	store := NewMemStore(5, time.Minute)
	ctx := context.Background()

	done := make(chan struct{})
	for i := 0; i < 8; i++ {
		go func(n int) {
			defer func() { done <- struct{}{} }()
			id := "user-" + string(rune('a'+n))
			_ = store.CreateUser(ctx, &api.User{ID: id, Email: id + "@example.com", Username: id})
			_, _ = store.RecordFailedAttempt(ctx, id)
			_, _ = store.IsLocked(ctx, id)
			_, _ = store.GetUserByID(ctx, id)
			_, _ = store.EmailExists(ctx, id+"@example.com")
		}(i)
	}
	for i := 0; i < 8; i++ {
		<-done
	}

	ids := store.SortedUserIDs()
	if len(ids) != 8 {
		t.Fatalf("expected 8 users, got %d", len(ids))
	}
}

// TestStoreStringDoesNotLeak checks the debug representation.
func TestStoreStringDoesNotLeak(t *testing.T) {
	store := NewMemStore(3, time.Minute)
	_ = store.CreateUser(context.Background(), &api.User{ID: "id-1", Email: "secret@example.com", Username: "u"})
	if strings.Contains(store.String(), "secret@example.com") {
		t.Fatal("the store's string form leaked an email address")
	}
}
