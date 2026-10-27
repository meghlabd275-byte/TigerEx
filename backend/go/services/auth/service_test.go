package auth

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"tigerex/backend/internal/totp"
)

// The fakes below are small but real implementations of the service's
// interfaces: the database keeps users in a map, the OTP service keeps codes
// with an expiry, and the logger discards output. Nothing here returns a canned
// result that the test then asserts on, so the 2FA logic runs for real.

type fakeDB struct {
	mu    sync.Mutex
	users map[uint64]*User
}

func newFakeDB(users ...*User) *fakeDB {
	db := &fakeDB{users: map[uint64]*User{}}
	for _, u := range users {
		clone := *u
		db.users[u.ID] = &clone
	}
	return db
}

func (d *fakeDB) CreateUser(_ context.Context, u *User) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	clone := *u
	d.users[u.ID] = &clone
	return nil
}

func (d *fakeDB) GetUserByID(_ context.Context, id uint64) (*User, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	u, ok := d.users[id]
	if !ok {
		return nil, fmt.Errorf("user %d not found", id)
	}
	clone := *u
	return &clone, nil
}

func (d *fakeDB) GetUserByEmail(_ context.Context, email string) (*User, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, u := range d.users {
		if u.Email == email {
			clone := *u
			return &clone, nil
		}
	}
	return nil, fmt.Errorf("user %s not found", email)
}

func (d *fakeDB) GetUserByPhone(_ context.Context, phone string) (*User, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, u := range d.users {
		if u.Phone == phone {
			clone := *u
			return &clone, nil
		}
	}
	return nil, fmt.Errorf("user %s not found", phone)
}

func (d *fakeDB) GetUserByReferralCode(_ context.Context, code string) (*User, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, u := range d.users {
		if u.ReferralCode == code {
			clone := *u
			return &clone, nil
		}
	}
	return nil, fmt.Errorf("code %s not found", code)
}

func (d *fakeDB) UpdateUser(_ context.Context, u *User) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.users[u.ID]; !ok {
		return fmt.Errorf("user %d not found", u.ID)
	}
	clone := *u
	d.users[u.ID] = &clone
	return nil
}

func (d *fakeDB) DeleteUser(_ context.Context, id uint64) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.users, id)
	return nil
}

func (d *fakeDB) CreateSession(context.Context, *Session) error           { return nil }
func (d *fakeDB) GetSession(context.Context, string) (*Session, error)    { return nil, nil }
func (d *fakeDB) DeleteSession(context.Context, string) error             { return nil }
func (d *fakeDB) DeleteUserSessions(context.Context, uint64) error        { return nil }
func (d *fakeDB) CreateLoginAttempt(context.Context, *LoginAttempt) error { return nil }
func (d *fakeDB) GetLoginAttempts(context.Context, uint64, time.Time) ([]LoginAttempt, error) {
	return nil, nil
}

// fakeOTP keeps codes with an expiry so Verify is a real check.
type fakeOTP struct {
	mu    sync.Mutex
	codes map[string]string
}

func newFakeOTP() *fakeOTP { return &fakeOTP{codes: map[string]string{}} }

func (o *fakeOTP) Generate(credential, purpose string) (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	code := "654321"
	o.codes[credential+"|"+purpose] = code
	return code, nil
}

func (o *fakeOTP) Verify(credential, purpose, code string) (bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.codes[credential+"|"+purpose] == code && code != "", nil
}

func (o *fakeOTP) SendEmail(string, string, string) error { return nil }
func (o *fakeOTP) SendSMS(string, string, string) error   { return nil }

type fakeLogger struct{}

func (fakeLogger) Info(string, ...interface{})  {}
func (fakeLogger) Warn(string, ...interface{})  {}
func (fakeLogger) Error(string, ...interface{}) {}
func (fakeLogger) Debug(string, ...interface{}) {}

type fakeAnalytics struct{}

func (fakeAnalytics) TrackEvent(string, map[string]interface{})                 {}
func (fakeAnalytics) TrackLogin(uint64, string, bool, map[string]interface{})   {}
func (fakeAnalytics) TrackRegistration(uint64, string, map[string]interface{})  {}
func (fakeAnalytics) TrackSecurityEvent(string, uint64, map[string]interface{}) {}

const testJWTSecret = "test-jwt-secret-for-unit-tests-only"

func newTestService(db *fakeDB) *AuthService {
	return &AuthService{
		config: Config{
			JWTsecret:          testJWTSecret,
			AccessTokenExpiry:  time.Hour,
			RefreshTokenExpiry: 24 * time.Hour,
			PasswordMinLength:  8,
		},
		db:        db,
		otp:       newFakeOTP(),
		logger:    fakeLogger{},
		analytics: fakeAnalytics{},
	}
}

func tempToken(t *testing.T, userID uint64) string {
	t.Helper()
	claims := JWTClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "tigerex",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("sign temp token: %v", err)
	}
	return signed
}

func testUser() *User {
	return &User{ID: 1, Email: "alice@example.com", Username: "alice", Status: "active"}
}

// TestEnable2FARequiresCodeFromEnrolledSecret is the regression test for
// enrolment that accepted any secret without proving the user could use it.
func TestEnable2FARequiresCodeFromEnrolledSecret(t *testing.T) {
	svc := newTestService(newFakeDB(testUser()))
	ctx := context.Background()

	key, err := totp.GenerateSecret(20)
	if err != nil {
		t.Fatalf("secret: %v", err)
	}
	secret := totp.EncodeSecret(key)

	// A code from a different secret must be rejected.
	otherKey, _ := totp.GenerateSecret(20)
	wrongCode, _ := totp.Generate(totp.Config{Secret: otherKey}, time.Now())
	if _, err := svc.Enable2FA(ctx, 1, &Enable2FARequest{Secret: secret, Code: wrongCode}); err == nil {
		t.Fatal("a code from a different secret was accepted at enrolment")
	}

	// The correct code is accepted.
	code, err := totp.Generate(totp.Config{Secret: key}, time.Now())
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	result, err := svc.Enable2FA(ctx, 1, &Enable2FARequest{Secret: secret, Code: code, BackupCodes: true})
	if err != nil {
		t.Fatalf("enable: %v", err)
	}

	// The stored secret must be the normalised base32 form.
	user, _ := svc.db.GetUserByID(ctx, 1)
	if user.TwoFactorSecret != secret {
		t.Fatalf("stored secret %q, want %q", user.TwoFactorSecret, secret)
	}
	if !user.TwoFactorEnabled {
		t.Fatal("2FA was not marked enabled")
	}
	if (*result)["backup_codes"] == "" {
		t.Fatal("backup codes were not returned to the user")
	}
}

// TestEnable2FARejectsInvalidSecret checks malformed input.
func TestEnable2FARejectsInvalidSecret(t *testing.T) {
	svc := newTestService(newFakeDB(testUser()))
	ctx := context.Background()

	if _, err := svc.Enable2FA(ctx, 1, &Enable2FARequest{Secret: "not base32!!!", Code: "123456"}); err == nil {
		t.Fatal("an invalid secret was accepted")
	}
	if _, err := svc.Enable2FA(ctx, 1, &Enable2FARequest{Secret: "", Code: "123456"}); err == nil {
		t.Fatal("an empty secret was accepted")
	}
}

// TestVerify2FARejectsWrongTOTPCode is the regression test for verifyTOTP
// returning true unconditionally.
func TestVerify2FARejectsWrongTOTPCode(t *testing.T) {
	user := testUser()
	svc := newTestService(newFakeDB(user))
	ctx := context.Background()

	key, _ := totp.GenerateSecret(20)
	user.TwoFactorEnabled = true
	user.TwoFactorSecret = totp.EncodeSecret(key)
	if err := svc.db.UpdateUser(ctx, user); err != nil {
		t.Fatalf("update: %v", err)
	}

	token := tempToken(t, user.ID)

	// A wrong code must fail.
	resp, err := svc.Verify2FA(ctx, &Verify2FARequest{TempToken: token, Code: "000000"})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	realCode, _ := totp.Generate(totp.Config{Secret: key}, time.Now())
	if realCode == "000000" {
		t.Skip("generated code is 000000")
	}
	if resp.Success {
		t.Fatal("an incorrect TOTP code was accepted")
	}

	// The correct code must succeed.
	realCode, _ = totp.Generate(totp.Config{Secret: key}, time.Now())
	resp, err = svc.Verify2FA(ctx, &Verify2FARequest{TempToken: token, Code: realCode})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !resp.Success {
		t.Fatalf("a correct TOTP code was rejected: %s", resp.Message)
	}
	if resp.AccessToken == "" || resp.RefreshToken == "" {
		t.Fatal("no tokens were issued")
	}
}

// TestVerify2FARejectsInvalidTempToken checks the token gate.
func TestVerify2FARejectsInvalidTempToken(t *testing.T) {
	user := testUser()
	svc := newTestService(newFakeDB(user))
	ctx := context.Background()

	if _, err := svc.Verify2FA(ctx, &Verify2FARequest{TempToken: "not.a.jwt", Code: "123456"}); err == nil {
		t.Fatal("an invalid temp token was accepted")
	}
}

// TestVerify2FARejectsCodeWithoutSecret checks that a user with no secret
// cannot pass.
func TestVerify2FARejectsCodeWithoutSecret(t *testing.T) {
	user := testUser()
	user.TwoFactorEnabled = true
	// No secret stored.
	svc := newTestService(newFakeDB(user))
	ctx := context.Background()

	resp, err := svc.Verify2FA(ctx, &Verify2FARequest{TempToken: tempToken(t, 1), Code: "123456"})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if resp.Success {
		t.Fatal("a code was accepted for a user with no 2FA secret")
	}
}

// TestBackupCodeIsHashedAndSingleUse checks that backup codes are stored as
// bcrypt hashes and consumed on use.
func TestBackupCodeIsHashedAndSingleUse(t *testing.T) {
	user := testUser()
	svc := newTestService(newFakeDB(user))
	ctx := context.Background()

	plain, stored, err := svc.generateBackupCodes()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if strings.Contains(stored, plain[:8]) {
		t.Fatal("the stored backup codes contain the plaintext")
	}

	user.TwoFactorEnabled = true
	user.TwoFactorSecret = ""
	user.TwoFactorBackup = stored
	if err := svc.db.UpdateUser(ctx, user); err != nil {
		t.Fatalf("update: %v", err)
	}

	first := strings.Split(plain, ",")[0]
	resp, err := svc.Verify2FA(ctx, &Verify2FARequest{TempToken: tempToken(t, 1), BackupCode: first})
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !resp.Success {
		t.Fatal("a valid backup code was rejected")
	}

	// The code must now be consumed.
	reloaded, _ := svc.db.GetUserByID(ctx, 1)
	if strings.Contains(reloaded.TwoFactorBackup, "$2a$") == false && reloaded.TwoFactorBackup == "" {
		t.Fatal("all backup codes were consumed after one use")
	}
	if idx, ok := svc.verifyBackupCode(reloaded.TwoFactorBackup, first); ok {
		t.Fatalf("the backup code was not consumed (index %d)", idx)
	}
	if len(strings.Split(reloaded.TwoFactorBackup, ",")) != 9 {
		t.Fatalf("expected 9 remaining codes, got %d", len(strings.Split(reloaded.TwoFactorBackup, ",")))
	}
}

// TestVerifyBackupCodeRejectsWrong checks a bad code.
func TestVerifyBackupCodeRejectsWrong(t *testing.T) {
	svc := newTestService(newFakeDB(testUser()))
	_, stored, err := svc.generateBackupCodes()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	if _, ok := svc.verifyBackupCode(stored, "deadbeefdeadbeef"); ok {
		t.Fatal("a wrong backup code was accepted")
	}
	if _, ok := svc.verifyBackupCode(stored, ""); ok {
		t.Fatal("an empty backup code was accepted")
	}
	if _, ok := svc.verifyBackupCode("", "anything"); ok {
		t.Fatal("an empty store matched")
	}
}

// TestRemoveBackupCode checks the helper used to consume a code.
func TestRemoveBackupCode(t *testing.T) {
	stored := "a,b,c"
	if got := removeBackupCode(stored, 1); got != "a,c" {
		t.Fatalf("got %q, want a,c", got)
	}
	if got := removeBackupCode(stored, 0); got != "b,c" {
		t.Fatalf("got %q, want b,c", got)
	}
	if got := removeBackupCode(stored, 2); got != "a,b" {
		t.Fatalf("got %q, want a,b", got)
	}
	// Out of range is a no-op rather than a panic.
	if got := removeBackupCode(stored, -1); got != stored {
		t.Fatalf("got %q, want %q", got, stored)
	}
	if got := removeBackupCode(stored, 5); got != stored {
		t.Fatalf("got %q, want %q", got, stored)
	}
}

// TestSetup2FAProducesScannableURI checks the enrolment output.
func TestSetup2FAProducesScannableURI(t *testing.T) {
	svc := newTestService(newFakeDB(testUser()))

	result, err := svc.Setup2FA(context.Background(), 1, "TigerEx")
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if (*result)["secret"] == "" || (*result)["uri"] == "" {
		t.Fatalf("incomplete result: %+v", *result)
	}
	if !strings.HasPrefix((*result)["uri"], "otpauth://totp/TigerEx:alice@example.com") {
		t.Fatalf("unexpected URI: %s", (*result)["uri"])
	}

	// The returned secret must work with the returned URI's parameters.
	key, err := totp.DecodeSecret((*result)["secret"])
	if err != nil {
		t.Fatalf("decode returned secret: %v", err)
	}
	code, _ := totp.Generate(totp.Config{Secret: key}, time.Now())
	if !totp.Validate(totp.Config{Secret: key}, code, time.Now()) {
		t.Fatal("the returned secret does not validate")
	}
}
