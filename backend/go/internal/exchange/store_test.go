package exchange

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	walletderive "tigerex/backend/services/wallet"
)

var userSeq int64

// testStore connects to the database named by TIGEREX_TEST_DSN. When it is unset
// the test is skipped so the suite still runs on a machine without PostgreSQL;
// CI provides a live database so these paths are exercised for real, never mocked.
func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TIGEREX_TEST_DSN")
	if dsn == "" {
		t.Skip("TIGEREX_TEST_DSN not set; skipping live database test")
	}
	ctx := context.Background()
	store, err := New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := store.EnsureSchema(ctx); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	// The withdrawal whitelist lives in the auth security store's table, which
	// production also creates; create it here so the whitelist path is real.
	if _, err := store.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS withdrawal_addresses (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL,
			asset VARCHAR(20) NOT NULL,
			network VARCHAR(50) NOT NULL,
			address VARCHAR(255) NOT NULL,
			memo VARCHAR(255),
			label VARCHAR(100),
			created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
			UNIQUE (user_id, asset, address)
		)`); err != nil {
		t.Fatalf("create withdrawal_addresses: %v", err)
	}
	return store
}

// freshUser inserts a user and returns its id.
func freshUser(t *testing.T, s *Store) string {
	t.Helper()
	n := atomic.AddInt64(&userSeq, 1)
	suffix := fmt.Sprintf("%d-%d", os.Getpid(), n)
	email := "u" + suffix + "@test.local"
	username := "u" + suffix
	var id string
	err := s.pool.QueryRow(context.Background(), `
		INSERT INTO users (email, username, password_hash)
		VALUES ($1, $2, 'x') RETURNING id`, email, username).Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

// seedMarket inserts a market and returns its symbol.
func seedMarket(t *testing.T, s *Store, symbol, base, quote string) {
	t.Helper()
	_, err := s.pool.Exec(context.Background(), `
		INSERT INTO markets (symbol, base_asset, quote_asset, status, min_quantity,
			min_notional, step_size, maker_fee, taker_fee)
		VALUES ($1, $2, $3, 'trading', 0.00000001, 1, 0.00000001, 0.001, 0.001)
		ON CONFLICT (symbol) DO NOTHING`, symbol, base, quote)
	if err != nil {
		t.Fatalf("seed market: %v", err)
	}
}

func TestCreditDebitMovesRealBalances(t *testing.T) {
	s := testStore(t)
	defer s.Close()
	ctx := context.Background()

	user := freshUser(t, s)

	if err := s.Credit(ctx, user, "USDT", "main", 1000, "seed"); err != nil {
		t.Fatalf("credit: %v", err)
	}
	bal, err := s.GetBalance(ctx, user, "USDT")
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Available != 1000 {
		t.Fatalf("expected 1000 available, got %v", bal.Available)
	}

	if err := s.Debit(ctx, user, "USDT", 400, "test"); err != nil {
		t.Fatalf("debit: %v", err)
	}
	bal, _ = s.GetBalance(ctx, user, "USDT")
	if bal.Available != 600 {
		t.Fatalf("expected 600 after debit, got %v", bal.Available)
	}

	// A debit larger than the balance must fail closed and leave the balance intact.
	if err := s.Debit(ctx, user, "USDT", 10000, "test"); err != ErrInsufficientFunds {
		t.Fatalf("expected ErrInsufficientFunds, got %v", err)
	}
	bal, _ = s.GetBalance(ctx, user, "USDT")
	if bal.Available != 600 {
		t.Fatalf("failed debit changed balance to %v", bal.Available)
	}
}

func TestPlaceOrderLocksAndCancelReleasesFunds(t *testing.T) {
	s := testStore(t)
	defer s.Close()
	ctx := context.Background()

	user := freshUser(t, s)
	seedMarket(t, s, "BTC/RUSD", "BTC", "RUSD")

	if err := s.Credit(ctx, user, "RUSD", "main", 10000, "seed"); err != nil {
		t.Fatalf("credit: %v", err)
	}

	order, err := s.PlaceOrder(ctx, &OrderRequest{
		UserID: user, Symbol: "BTC/RUSD", Side: "buy", Type: "limit",
		Quantity: 1, Price: 5000,
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if order.Status != "new" {
		t.Fatalf("expected new order, got %s", order.Status)
	}

	// The buy reserved 5000 RUSD.
	bal, _ := s.GetBalance(ctx, user, "RUSD")
	if bal.Available != 5000 || bal.Locked != 5000 {
		t.Fatalf("expected 5000 available / 5000 locked, got %v / %v", bal.Available, bal.Locked)
	}

	// Cancelling releases the reservation.
	if _, err := s.CancelOrder(ctx, user, order.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	bal, _ = s.GetBalance(ctx, user, "RUSD")
	if bal.Available != 10000 || bal.Locked != 0 {
		t.Fatalf("expected 10000 available / 0 locked after cancel, got %v / %v", bal.Available, bal.Locked)
	}
}

func TestPlaceOrderWithoutFundsFailsClosed(t *testing.T) {
	s := testStore(t)
	defer s.Close()
	ctx := context.Background()

	user := freshUser(t, s)
	seedMarket(t, s, "ETH/RUSD", "ETH", "RUSD")

	_, err := s.PlaceOrder(ctx, &OrderRequest{
		UserID: user, Symbol: "ETH/RUSD", Side: "buy", Type: "limit",
		Quantity: 1, Price: 5000,
	})
	if err != ErrInsufficientFunds {
		t.Fatalf("expected ErrInsufficientFunds, got %v", err)
	}
	bal, _ := s.GetBalance(ctx, user, "RUSD")
	if bal.Available != 0 || bal.Locked != 0 {
		t.Fatalf("failed order changed balances: %v / %v", bal.Available, bal.Locked)
	}
}

func TestWithdrawalWhitelistEnforced(t *testing.T) {
	s := testStore(t)
	defer s.Close()
	ctx := context.Background()

	user := freshUser(t, s)
	if err := s.Credit(ctx, user, "USDT", "main", 1000, "seed"); err != nil {
		t.Fatalf("credit: %v", err)
	}

	approved := "0x1111111111111111111111111111111111111111"
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO withdrawal_addresses (id, user_id, asset, network, address, label)
		VALUES (gen_random_uuid(), $1, 'USDT', 'ethereum', $2, 'cold')`,
		user, approved); err != nil {
		t.Fatalf("add address: %v", err)
	}

	// An unapproved address is refused.
	_, err := s.CreateWithdrawal(ctx, &WithdrawalRequest{
		UserID: user, Asset: "USDT", Amount: 100, Fee: 1,
		Address: "0x2222222222222222222222222222222222222222",
	})
	if err == nil {
		t.Fatalf("expected withdrawal to unapproved address to fail")
	}

	// The approved address succeeds and debits the balance.
	w, err := s.CreateWithdrawal(ctx, &WithdrawalRequest{
		UserID: user, Asset: "USDT", Amount: 100, Fee: 1, Address: approved,
	})
	if err != nil {
		t.Fatalf("approved withdrawal: %v", err)
	}
	if w.NetAmount != 99 {
		t.Fatalf("expected net 99, got %v", w.NetAmount)
	}
	bal, _ := s.GetBalance(ctx, user, "USDT")
	if bal.Available != 900 || bal.Locked != 0 {
		t.Fatalf("expected 900 available / 0 locked, got %v / %v", bal.Available, bal.Locked)
	}
}

func TestDepositAddressIsDeterministicAndUnique(t *testing.T) {
	s := testStore(t)
	defer s.Close()
	ctx := context.Background()

	// A fixed, well-known test mnemonic (BIP-39 test vector). Never used for funds.
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	store := s.WithHD(NewHDDeriver(mnemonic, ""))

	user := freshUser(t, store)

	a1, err := store.GetDepositAddress(ctx, user, "USDT", "ethereum")
	if err != nil {
		t.Fatalf("deposit address: %v", err)
	}
	if len(a1.Address) != 42 {
		t.Fatalf("expected 0x address, got %q", a1.Address)
	}

	// A second call returns the same address (it is persisted).
	a2, _ := store.GetDepositAddress(ctx, user, "USDT", "ethereum")
	if a1.Address != a2.Address {
		t.Fatalf("deposit address not stable: %s vs %s", a1.Address, a2.Address)
	}

	// A different user gets a different address.
	other := freshUser(t, store)
	a3, _ := store.GetDepositAddress(ctx, other, "USDT", "ethereum")
	if a3.Address == a1.Address {
		t.Fatalf("two users share deposit address %s", a1.Address)
	}
}

func TestHDDerivationMatchesKnownVector(t *testing.T) {
	// m/44'/60'/0'/0/0 of the BIP-39 test vector is a published address; asserting
	// it proves the derivation is real BIP-44 and not an ad-hoc hash.
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	d := &HDDeriver{mnemonic: mnemonic}
	addr, err := d.deriveAddress("ethereum", 0)
	if err != nil {
		t.Fatalf("derive address: %v", err)
	}
	want := "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
	if addr != want {
		t.Fatalf("derivation mismatch: got %s want %s", addr, want)
	}
}

func TestUnconfiguredStoreFailsClosed(t *testing.T) {
	ctx := context.Background()
	var s *Store
	if _, err := s.ListMarkets(ctx); err == nil {
		t.Fatal("nil store should fail")
	}
	if _, err := s.GetDepositAddress(ctx, "00000000-0000-0000-0000-000000000000", "USDT", "ethereum"); err == nil {
		t.Fatal("nil store deposit address should fail")
	}
}

var _ = walletderive.DeriveBIP32PrivateKey
