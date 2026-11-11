package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tigerex-backend/internal/repository"
)

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&repository.User{},
		&repository.Session{},
		&repository.Order{},
		&repository.Wallet{},
		&repository.Transaction{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestDepositCreditsExactlyOnce(t *testing.T) {
	db := newTestDB(t)
	svc := NewWalletService(db, nil)
	ctx := context.Background()

	tx, err := svc.Deposit(ctx, "user-1", "BTC", 100, "0xdeadbeef")
	if err != nil {
		t.Fatalf("first deposit: %v", err)
	}
	if tx.Amount != 100 {
		t.Fatalf("recorded amount = %d, want 100", tx.Amount)
	}

	balance, err := svc.GetBalance(ctx, "user-1", "BTC")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 100 {
		t.Fatalf("balance after first deposit = %d, want 100", balance)
	}

	// The same transaction hash must not credit a second time.
	if _, err := svc.Deposit(ctx, "user-1", "BTC", 100, "0xdeadbeef"); !errors.Is(err, ErrDuplicateDeposit) {
		t.Fatalf("replayed deposit err = %v, want ErrDuplicateDeposit", err)
	}

	balance, err = svc.GetBalance(ctx, "user-1", "BTC")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 100 {
		t.Fatalf("balance after replay = %d, want 100 (no mint)", balance)
	}
}

func TestDepositRejectsUnverifiedInput(t *testing.T) {
	db := newTestDB(t)
	svc := NewWalletService(db, nil)
	ctx := context.Background()

	if _, err := svc.Deposit(ctx, "user-1", "BTC", 0, "0xhash"); err == nil {
		t.Fatal("zero-amount deposit must be rejected")
	}
	if _, err := svc.Deposit(ctx, "user-1", "BTC", 10, ""); err == nil {
		t.Fatal("deposit without a tx hash must be rejected")
	}
}

func TestWithdrawFailsClosedOnInsufficientBalance(t *testing.T) {
	db := newTestDB(t)
	svc := NewWalletService(db, nil)
	ctx := context.Background()

	if _, err := svc.Deposit(ctx, "user-1", "ETH", 50, "0xaaa"); err != nil {
		t.Fatalf("deposit: %v", err)
	}

	if _, err := svc.Withdraw(ctx, "user-1", "ETH", 51, "0xdest"); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("over-withdraw err = %v, want ErrInsufficientBalance", err)
	}
	balance, _ := svc.GetBalance(ctx, "user-1", "ETH")
	if balance != 50 {
		t.Fatalf("balance after failed withdrawal = %d, want 50", balance)
	}

	if _, err := svc.Withdraw(ctx, "user-1", "ETH", 20, "0xdest"); err != nil {
		t.Fatalf("valid withdrawal: %v", err)
	}
	balance, _ = svc.GetBalance(ctx, "user-1", "ETH")
	if balance != 30 {
		t.Fatalf("balance after withdrawal = %d, want 30", balance)
	}
}

func TestGetBalanceUnknownWallet(t *testing.T) {
	db := newTestDB(t)
	svc := NewWalletService(db, nil)

	if _, err := svc.GetBalance(context.Background(), "nobody", "BTC"); !errors.Is(err, ErrWalletNotFound) {
		t.Fatalf("err = %v, want ErrWalletNotFound", err)
	}
}

func TestRegisterHashesPasswordAndNeverSerializesIt(t *testing.T) {
	db := newTestDB(t)
	svc := NewAuthService(db, nil)

	dto, err := svc.Register(context.Background(), "trader@example.com", "S3cret-Passw0rd!")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if dto.Email != "trader@example.com" {
		t.Fatalf("email = %q", dto.Email)
	}

	var stored repository.User
	if err := db.Where("id = ?", dto.ID).First(&stored).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if stored.Password == "S3cret-Passw0rd!" {
		t.Fatal("password stored in clear")
	}
	if !strings.HasPrefix(stored.Password, "$2") {
		t.Fatalf("password is not a bcrypt hash: %q", stored.Password)
	}

	blob, err := json.Marshal(stored)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(blob), stored.Password) {
		t.Fatal("password hash leaked into JSON")
	}

	// A second registration for the same address is rejected.
	if _, err := svc.Register(context.Background(), "trader@example.com", "An0ther-Passw0rd!"); !errors.Is(err, ErrEmailExists) {
		t.Fatalf("duplicate register err = %v, want ErrEmailExists", err)
	}
}
