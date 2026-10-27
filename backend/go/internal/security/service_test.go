package security

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"tigerex/backend/internal/api"
	"tigerex/backend/internal/totp"
)

func testService(t *testing.T) *Service {
	t.Helper()
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	return NewService(Config{MasterKey: key})
}

// TestEncryptDecryptRoundTrip checks that ciphertext decrypts to the original
// and that a fresh nonce is used each time.
func TestEncryptDecryptRoundTrip(t *testing.T) {
	svc := testService(t)

	plaintext := "seed phrase or api secret"
	first, err := svc.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	second, err := svc.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if first == second {
		t.Fatal("two encryptions of the same plaintext were identical: the nonce was reused")
	}

	got, err := svc.Decrypt(first)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plaintext {
		t.Fatalf("got %q, want %q", got, plaintext)
	}
}

// TestDecryptRejectsTamperedCiphertext checks GCM authentication.
func TestDecryptRejectsTamperedCiphertext(t *testing.T) {
	svc := testService(t)

	ct, err := svc.Encrypt("important")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Flip a character in the body.
	tampered := []byte(ct)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := svc.Decrypt(string(tampered)); err == nil {
		t.Fatal("a tampered ciphertext decrypted successfully")
	}

	// Malformed inputs.
	for _, bad := range []string{"", "zz", "abcd", strings.Repeat("00", 4)} {
		if _, err := svc.Decrypt(bad); err == nil {
			t.Fatalf("malformed ciphertext %q was accepted", bad)
		}
	}
}

// TestGenerateSaltIsRandom checks that salts differ and are the requested size.
func TestGenerateSaltIsRandom(t *testing.T) {
	a, err := GenerateSalt(16)
	if err != nil {
		t.Fatalf("salt: %v", err)
	}
	b, err := GenerateSalt(16)
	if err != nil {
		t.Fatalf("salt: %v", err)
	}
	if len(a) != 16 {
		t.Fatalf("salt length: got %d", len(a))
	}
	if string(a) == string(b) {
		t.Fatal("two salts were identical")
	}
	if _, err := GenerateSalt(0); err == nil {
		t.Fatal("a zero-length salt was accepted")
	}
}

// TestGenerateOTPMatchesTOTP is the regression test for the home-grown OTP that
// did not match any authenticator app.
func TestGenerateOTPMatchesTOTP(t *testing.T) {
	key, err := totp.GenerateSecret(20)
	if err != nil {
		t.Fatalf("secret: %v", err)
	}
	secret := totp.EncodeSecret(key)
	at := time.Unix(1700000000, 0)

	got := GenerateOTP(secret, at.Unix())
	want, err := totp.Generate(totp.Config{Secret: key}, at)
	if err != nil {
		t.Fatalf("reference: %v", err)
	}
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
	if !VerifyOTP(secret, got, at.Unix(), 1) {
		t.Fatal("a freshly generated code was rejected")
	}
}

func TestVerifyOTPRejectsWrong(t *testing.T) {
	key, _ := totp.GenerateSecret(20)
	secret := totp.EncodeSecret(key)
	at := time.Unix(1700000000, 0)

	code := GenerateOTP(secret, at.Unix())
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if VerifyOTP(secret, wrong, at.Unix(), 1) {
		t.Fatal("an incorrect code was accepted")
	}
	if VerifyOTP("not base32!!", code, at.Unix(), 1) {
		t.Fatal("an invalid secret was accepted")
	}
	if VerifyOTP("", code, at.Unix(), 1) {
		t.Fatal("an empty secret was accepted")
	}
	if GenerateOTP("not base32!!", at.Unix()) != "" {
		t.Fatal("GenerateOTP returned a code for an invalid secret")
	}
}

// fakeDeriver returns a deterministic address so the test can assert on it.
type fakeDeriver struct {
	address string
	err     error
	calls   int
}

func (d *fakeDeriver) DeriveMultisigAddress(_ context.Context, _ []string, _ int) (string, error) {
	d.calls++
	return d.address, d.err
}

// TestCreateMultiSigWalletRequiresDeriver is the regression test for the
// fabricated "bc1"+hex address.
func TestCreateMultiSigWalletRequiresDeriver(t *testing.T) {
	svc := testService(t)
	ctx := context.Background()

	if _, err := svc.CreateMultiSigWallet(ctx, []string{"a", "b", "c"}, 2); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}

	// A real deriver produces the address.
	svc.WithAddressDeriver(&fakeDeriver{address: "bc1qrealscriptaddress"})
	wallet, err := svc.CreateMultiSigWallet(ctx, []string{"a", "b", "c"}, 2)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if wallet.Address != "bc1qrealscriptaddress" {
		t.Fatalf("address: got %s", wallet.Address)
	}
	if wallet.Network != "Bitcoin" {
		t.Fatalf("network: got %s", wallet.Network)
	}

	// A failing deriver surfaces the error rather than a fake address.
	svc.WithAddressDeriver(&fakeDeriver{err: errors.New("hsm unavailable")})
	if _, err := svc.CreateMultiSigWallet(ctx, []string{"a", "b", "c"}, 2); err == nil {
		t.Fatal("a deriver error was swallowed")
	}
}

func TestCreateMultiSigWalletValidatesThreshold(t *testing.T) {
	svc := testService(t).WithAddressDeriver(&fakeDeriver{address: "bc1q..."})
	ctx := context.Background()

	if _, err := svc.CreateMultiSigWallet(ctx, []string{"a"}, 2); err == nil {
		t.Fatal("a threshold above the signer count was accepted")
	}
	if _, err := svc.CreateMultiSigWallet(ctx, []string{"a", "b"}, 1); err == nil {
		t.Fatal("a single-signature cold wallet was accepted")
	}
}

// memApprovals is a real in-memory approval store.
type memApprovals struct {
	mu    sync.Mutex
	state map[string]bool
}

func newMemApprovals() *memApprovals { return &memApprovals{state: map[string]bool{}} }

func (a *memApprovals) Create(_ context.Context, id string, approvers []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.state[id] = false
	return nil
}

func (a *memApprovals) Status(_ context.Context, id string) (bool, bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	v, ok := a.state[id]
	return v, ok, nil
}

// TestWithdrawalApprovalRequiresStore is the regression test for the approval
// stubs that did nothing and reported "not approved" without looking anywhere.
func TestWithdrawalApprovalRequiresStore(t *testing.T) {
	svc := testService(t)
	ctx := context.Background()
	w := &api.Withdrawal{ID: "w-1"}

	if err := svc.CreateWithdrawalApproval(ctx, w, []string{"admin1", "admin2"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
	if _, err := svc.CheckWithdrawalApproval(ctx, "w-1"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}

	// A real store works.
	svc.WithApprovalStore(newMemApprovals())
	if err := svc.CreateWithdrawalApproval(ctx, w, []string{"admin1", "admin2"}); err != nil {
		t.Fatalf("create approval: %v", err)
	}
	approved, err := svc.CheckWithdrawalApproval(ctx, "w-1")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if approved {
		t.Fatal("a pending approval reported approved")
	}

	// An unknown withdrawal is an error, not a silent false.
	if _, err := svc.CheckWithdrawalApproval(ctx, "unknown"); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("expected ErrInvalidKey for an unknown withdrawal, got %v", err)
	}

	// Validation.
	if err := svc.CreateWithdrawalApproval(ctx, nil, []string{"a"}); err == nil {
		t.Fatal("a nil withdrawal was accepted")
	}
	if err := svc.CreateWithdrawalApproval(ctx, w, nil); err == nil {
		t.Fatal("an empty approver list was accepted")
	}
	if _, err := svc.CheckWithdrawalApproval(ctx, ""); err == nil {
		t.Fatal("an empty withdrawal id was accepted")
	}
}

// TestAntiPhishingCode checks length and randomness.
func TestAntiPhishingCode(t *testing.T) {
	a, err := GenerateAntiPhishingCode()
	if err != nil {
		t.Fatalf("code: %v", err)
	}
	b, err := GenerateAntiPhishingCode()
	if err != nil {
		t.Fatalf("code: %v", err)
	}
	if len(a) != 16 {
		t.Fatalf("length: got %d, want 16 hex characters", len(a))
	}
	if a == b {
		t.Fatal("two anti-phishing codes were identical")
	}
}

// TestDeriveKeyIsDeterministic checks the KDF.
func TestDeriveKeyIsDeterministic(t *testing.T) {
	master := []byte("master-key-material-32-bytes-ok!!")
	salt := []byte("salt")
	a := DeriveKey(master, salt)
	b := DeriveKey(master, salt)
	if string(a) != string(b) {
		t.Fatal("the same master key and salt produced different keys")
	}
	c := DeriveKey(master, []byte("other"))
	if string(a) == string(c) {
		t.Fatal("a different salt produced the same key")
	}
}

// TestHashPassword checks the PBKDF2 wrapper.
func TestHashPassword(t *testing.T) {
	salt, err := GenerateSalt(16)
	if err != nil {
		t.Fatalf("salt: %v", err)
	}
	a := HashPassword([]byte("correct horse"), salt)
	b := HashPassword([]byte("correct horse"), salt)
	if string(a) != string(b) {
		t.Fatal("the same password and salt produced different hashes")
	}
	c := HashPassword([]byte("different"), salt)
	if string(a) == string(c) {
		t.Fatal("different passwords produced the same hash")
	}
}
