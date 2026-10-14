package wallet

import (
	"context"
	"errors"
	"testing"
)

func testService() *Service {
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	return NewService(Config{MasterKey: key})
}

func TestWalletReadsFailClosedWithoutDurableStore(t *testing.T) {
	s := testService()
	ctx := context.Background()

	if _, err := s.GetWallets(ctx, "user-1"); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("GetWallets error = %v, want ErrCustodyUnavailable", err)
	}
	if _, err := s.GetBalance(ctx, "user-1", "BTC"); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("GetBalance error = %v, want ErrCustodyUnavailable", err)
	}
	if _, err := s.GetDepositAddress(ctx, "user-1", "BTC", "Bitcoin"); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("GetDepositAddress error = %v, want ErrCustodyUnavailable", err)
	}
}

func TestFundMovementFailsClosedWithoutLedger(t *testing.T) {
	s := testService()
	ctx := context.Background()

	if _, err := s.RequestWithdrawal(ctx, &WithdrawalRequest{
		UserID: "user-1", Asset: "BTC", Amount: 1, Address: "bc1not-verified",
	}); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("RequestWithdrawal error = %v, want ErrCustodyUnavailable", err)
	}

	if _, err := s.InternalTransfer(ctx, &TransferRequest{
		FromUserID: "user-1", ToUserID: "user-2", Asset: "BTC", Amount: 1,
	}); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("InternalTransfer error = %v, want ErrCustodyUnavailable", err)
	}

	if err := s.CheckWithdrawalWhitelist(ctx, "user-1", "address"); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("CheckWithdrawalWhitelist error = %v, want ErrCustodyUnavailable", err)
	}
}

func TestWalletInputsAreValidatedBeforeUnavailableResponse(t *testing.T) {
	s := testService()
	ctx := context.Background()

	if _, err := s.GetBalance(ctx, "", "BTC"); !errors.Is(err, ErrInvalidAddress) {
		t.Fatalf("GetBalance invalid user error = %v, want ErrInvalidAddress", err)
	}
	if _, err := s.RequestWithdrawal(ctx, &WithdrawalRequest{
		UserID: "user-1", Asset: "BTC", Amount: 0, Address: "address",
	}); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("RequestWithdrawal invalid amount error = %v, want ErrInvalidAmount", err)
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	s := testService()
	encrypted, err := s.Encrypt("custody-secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if encrypted == "custody-secret" || encrypted == "" {
		t.Fatal("Encrypt did not produce ciphertext")
	}
	decrypted, err := s.Decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if decrypted != "custody-secret" {
		t.Fatalf("Decrypt = %q, want original plaintext", decrypted)
	}
	if _, err := s.Decrypt("00"); err == nil {
		t.Fatal("Decrypt accepted invalid/truncated ciphertext")
	}
}
