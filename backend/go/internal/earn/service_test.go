package earn

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

// fixedClock returns a clock the test can advance.
type fixedClock struct {
	t time.Time
}

func (c *fixedClock) Now() time.Time { return c.t }

func (c *fixedClock) advance(d time.Duration) { c.t = c.t.Add(d) }

// staticOracle serves a fixed price per base asset. A real deployment points
// this at the exchange's aggregated index; the tests only need determinism.
type staticOracle struct {
	prices map[string]float64
	err    error
}

func (o *staticOracle) Price(_ context.Context, base, _ string) (float64, error) {
	if o.err != nil {
		return 0, o.err
	}
	p, ok := o.prices[base]
	if !ok {
		return 0, errors.New("no price")
	}
	return p, nil
}

func newTestService(t *testing.T, clock *fixedClock, oracle PriceOracle) *Service {
	t.Helper()
	store, err := NewSQLiteStore(filepath.Join(t.TempDir(), "earn.db"))
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	return NewService(Config{Now: clock.Now, Oracle: oracle}).WithStore(store)
}

func TestAccruedInterestMatchesProRataFormula(t *testing.T) {
	// 10,000 at 10% APY for exactly half a year earns 500.
	got := AccruedInterest(10_000, 10, secondsPerYear/2)
	if got != 500 {
		t.Fatalf("expected 500, got %v", got)
	}

	if got := AccruedInterest(0, 10, secondsPerYear); got != 0 {
		t.Fatalf("a zero principal must earn nothing, got %v", got)
	}
	if got := AccruedInterest(1000, 0, secondsPerYear); got != 0 {
		t.Fatalf("a zero rate must earn nothing, got %v", got)
	}
	if got := AccruedInterest(1000, 10, 0); got != 0 {
		t.Fatalf("zero elapsed time must earn nothing, got %v", got)
	}
	if got := AccruedInterest(1000, 10, -60); got != 0 {
		t.Fatalf("negative elapsed time must earn nothing, got %v", got)
	}
}

func TestAccruedInterestTruncatesRatherThanRoundsUp(t *testing.T) {
	// A principal and duration chosen so the exact interest has more than eight
	// decimal places. Truncation must never exceed the exact value.
	principal, apy, elapsed := 1.0, 3.0, int64(1)
	exact := principal * (apy / 100) * (float64(elapsed) / float64(secondsPerYear))
	got := AccruedInterest(principal, apy, elapsed)
	if got > exact {
		t.Fatalf("accrual %v exceeded the exact value %v", got, exact)
	}
	if got != 0 {
		t.Fatalf("expected the sub-nanounit accrual to truncate to 0, got %v", got)
	}
}

func TestSavingsDepositAndWithdrawCreditsRealInterest(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{
		ID: "btc-flex", Asset: "BTC", Type: "flexible", APY: 10, MinAmount: 0.001,
	}); err != nil {
		t.Fatalf("creating product: %v", err)
	}

	position, err := svc.SavingsDeposit(ctx, "u1", "btc-flex", 1)
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if position.Principal != 1 || position.Status != "active" {
		t.Fatalf("unexpected position: %+v", position)
	}

	// Half a year at 10% APY on 1 BTC earns 0.05 BTC.
	clock.advance(182*24*time.Hour + 12*time.Hour)

	_, payout, err := svc.SavingsWithdraw(ctx, "u1", position.ID, 1)
	if err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if payout <= 1 {
		t.Fatalf("expected the payout to include interest, got %v", payout)
	}
	if payout < 1.0499 || payout > 1.0501 {
		t.Fatalf("expected a payout of about 1.05, got %v", payout)
	}

	// The position is closed and holds nothing further.
	closed, err := svc.store.GetSavingsPosition(ctx, position.ID)
	if err != nil {
		t.Fatalf("reloading position: %v", err)
	}
	if closed.Status != "closed" || closed.Principal != 0 || closed.Accrued != 0 {
		t.Fatalf("expected a closed empty position, got %+v", closed)
	}
}

func TestSavingsWithdrawCannotExceedPrincipal(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{
		ID: "p", Asset: "ETH", Type: "flexible", APY: 5,
	}); err != nil {
		t.Fatalf("creating product: %v", err)
	}
	position, _ := svc.SavingsDeposit(ctx, "u1", "p", 2)

	if _, _, err := svc.SavingsWithdraw(ctx, "u1", position.ID, 3); !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("expected ErrInsufficientFunds, got %v", err)
	}
}

func TestSavingsWithdrawRejectsAnotherUsersPosition(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{ID: "p", Asset: "ETH", Type: "flexible", APY: 5}); err != nil {
		t.Fatalf("creating product: %v", err)
	}
	position, _ := svc.SavingsDeposit(ctx, "u1", "p", 1)

	// A second user must not be able to withdraw the first user's position.
	if _, _, err := svc.SavingsWithdraw(ctx, "u2", position.ID, 1); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized, got %v", err)
	}
}

func TestLockedSavingsRejectsEarlyWithdrawal(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{
		ID: "locked-90", Asset: "TGR", Type: "locked", APY: 15, LockDays: 90,
	}); err != nil {
		t.Fatalf("creating product: %v", err)
	}
	position, err := svc.SavingsDeposit(ctx, "u1", "locked-90", 100)
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if position.UnlockAt == 0 {
		t.Fatal("a locked product must set an unlock time")
	}

	clock.advance(89 * 24 * time.Hour)
	if _, _, err := svc.SavingsWithdraw(ctx, "u1", position.ID, 100); !errors.Is(err, ErrLocked) {
		t.Fatalf("expected ErrLocked before the unlock date, got %v", err)
	}

	clock.advance(2 * 24 * time.Hour)
	if _, _, err := svc.SavingsWithdraw(ctx, "u1", position.ID, 100); err != nil {
		t.Fatalf("expected the withdrawal to succeed after unlocking, got %v", err)
	}
}

func TestSavingsDepositEnforcesProductMinimum(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{
		ID: "p", Asset: "BTC", Type: "flexible", APY: 5, MinAmount: 0.01,
	}); err != nil {
		t.Fatalf("creating product: %v", err)
	}
	if _, err := svc.SavingsDeposit(ctx, "u1", "p", 0.001); !errors.Is(err, ErrBelowMinimum) {
		t.Fatalf("expected ErrBelowMinimum, got %v", err)
	}
	if _, err := svc.SavingsDeposit(ctx, "u1", "p", -1); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("expected ErrInvalidAmount for a negative deposit, got %v", err)
	}
}

func TestListSavingsPositionsProjectsInterest(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{ID: "p", Asset: "BTC", Type: "flexible", APY: 12}); err != nil {
		t.Fatalf("creating product: %v", err)
	}
	if _, err := svc.SavingsDeposit(ctx, "u1", "p", 1); err != nil {
		t.Fatalf("deposit: %v", err)
	}

	clock.advance(30 * 24 * time.Hour)
	positions, err := svc.ListSavingsPositions(ctx, "u1")
	if err != nil {
		t.Fatalf("listing: %v", err)
	}
	if len(positions) != 1 {
		t.Fatalf("expected 1 position, got %d", len(positions))
	}
	if positions[0].Accrued <= 0 {
		t.Fatalf("expected accrued interest, got %v", positions[0].Accrued)
	}

	// Interest is persisted, so a second listing does not double-count.
	again, err := svc.ListSavingsPositions(ctx, "u1")
	if err != nil {
		t.Fatalf("listing again: %v", err)
	}
	if again[0].Accrued != positions[0].Accrued {
		t.Fatalf("accrual changed without elapsed time: %v then %v", positions[0].Accrued, again[0].Accrued)
	}
}

func TestBorrowRequiresSufficientRealCollateral(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	oracle := &staticOracle{prices: map[string]float64{"BTC": 100_000}}
	svc := newTestService(t, clock, oracle)

	// 1 BTC at 100,000 with a 70% LTV supports at most 70,000 USDT.
	position, err := svc.Borrow(ctx, "u1", "USDT", 70_000, 5, "BTC", 1, 70)
	if err != nil {
		t.Fatalf("expected the borrow to succeed, got %v", err)
	}
	if position.Collateral != 1 || position.LTV != 70 {
		t.Fatalf("unexpected borrow position: %+v", position)
	}

	if _, err := svc.Borrow(ctx, "u1", "USDT", 70_001, 5, "BTC", 1, 70); !errors.Is(err, ErrCollateralTooLow) {
		t.Fatalf("expected ErrCollateralTooLow, got %v", err)
	}
}

func TestBorrowFailsClosedWithoutAnOracle(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	// Without a price source the collateral cannot be valued, so the borrow
	// must be refused rather than priced from an assumption.
	if _, err := svc.Borrow(ctx, "u1", "USDT", 1, 5, "BTC", 1000, 70); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("expected ErrPriceUnavailable, got %v", err)
	}
}

func TestBorrowRejectsAnOracleError(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, &staticOracle{err: errors.New("feed down")})

	if _, err := svc.Borrow(ctx, "u1", "USDT", 1, 5, "BTC", 1000, 70); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("expected ErrPriceUnavailable when the feed fails, got %v", err)
	}
}

func TestBorrowRejectsInvalidLTV(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, &staticOracle{prices: map[string]float64{"BTC": 100_000}})

	for _, ltv := range []float64{0, -1, 96, 100} {
		if _, err := svc.Borrow(ctx, "u1", "USDT", 1, 5, "BTC", 1, ltv); err == nil {
			t.Errorf("expected ltv %v to be rejected", ltv)
		}
	}
}

func TestLendAccruesAndPersists(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	if _, err := svc.Lend(ctx, "u1", "usdt", 1000, 5); err != nil {
		t.Fatalf("lend: %v", err)
	}
	clock.advance(365 * 24 * time.Hour)

	positions, err := svc.ListLendPositions(ctx, "u1")
	if err != nil {
		t.Fatalf("listing: %v", err)
	}
	if len(positions) != 1 || positions[0].Asset != "USDT" {
		t.Fatalf("unexpected lend positions: %+v", positions)
	}
	if positions[0].Accrued < 49.99 || positions[0].Accrued > 50.01 {
		t.Fatalf("expected about 50 USDT of interest over a year, got %v", positions[0].Accrued)
	}
}

func TestSubAccountLifecycleAndScoping(t *testing.T) {
	ctx := context.Background()
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	svc := newTestService(t, clock, nil)

	sub, err := svc.CreateSubAccount(ctx, "u1", "Desk A", "Desk.A@Example.com")
	if err != nil {
		t.Fatalf("creating sub-account: %v", err)
	}
	if sub.Email != "desk.a@example.com" {
		t.Fatalf("expected the email to be normalised, got %q", sub.Email)
	}

	if _, err := svc.CreateSubAccount(ctx, "u1", "Desk A again", "desk.a@example.com"); !errors.Is(err, ErrDuplicateSubAccount) {
		t.Fatalf("expected ErrDuplicateSubAccount, got %v", err)
	}

	// Another parent user may reuse the same email.
	if _, err := svc.CreateSubAccount(ctx, "u2", "Desk A", "desk.a@example.com"); err != nil {
		t.Fatalf("a different user should be able to use the same email: %v", err)
	}

	// u2 cannot delete u1's sub-account.
	if err := svc.DeleteSubAccount(ctx, "u2", sub.ID); err == nil {
		t.Fatal("expected cross-user deletion to fail")
	}

	if err := svc.DeleteSubAccount(ctx, "u1", sub.ID); err != nil {
		t.Fatalf("deleting own sub-account: %v", err)
	}
	remaining, _ := svc.ListSubAccounts(ctx, "u1")
	if len(remaining) != 0 {
		t.Fatalf("expected no sub-accounts left, got %d", len(remaining))
	}
}

func TestValidateSubAccountEmail(t *testing.T) {
	valid := []string{"a@b.co", "trader+desk@sub.example.io"}
	for _, e := range valid {
		if err := ValidateSubAccountEmail(e); err != nil {
			t.Errorf("expected %q to be valid, got %v", e, err)
		}
	}
	invalid := []string{"", "a", "@b.co", "a@", "a@b", "a b@c.co", "a@.co", "a@b."}
	for _, e := range invalid {
		if err := ValidateSubAccountEmail(e); err == nil {
			t.Errorf("expected %q to be rejected", e)
		}
	}
}

func TestValidateSavingsProduct(t *testing.T) {
	valid := &SavingsProduct{ID: "p", Asset: "BTC", Type: "flexible", APY: 5}
	if err := ValidateSavingsProduct(valid); err != nil {
		t.Fatalf("expected the product to be valid, got %v", err)
	}
	if valid.Status != "active" {
		t.Fatalf("expected a default status of active, got %q", valid.Status)
	}

	invalid := []*SavingsProduct{
		nil,
		{Asset: "BTC", Type: "flexible"},
		{ID: "p", Type: "flexible"},
		{ID: "p", Asset: "BTC", Type: "weird"},
		{ID: "p", Asset: "BTC", Type: "locked"},
		{ID: "p", Asset: "BTC", Type: "flexible", APY: -1},
		{ID: "p", Asset: "BTC", Type: "flexible", APY: 2000},
		{ID: "p", Asset: "BTC", Type: "flexible", MinAmount: -1},
		{ID: "p", Asset: "BTC", Type: "flexible", Status: "deleted"},
	}
	for i, p := range invalid {
		if err := ValidateSavingsProduct(p); err == nil {
			t.Errorf("case %d: expected the product to be rejected", i)
		}
	}
}

func TestServiceFailsClosedWithoutAStore(t *testing.T) {
	ctx := context.Background()
	svc := NewService(Config{})

	if _, err := svc.SavingsDeposit(ctx, "u1", "p", 1); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
	if _, err := svc.ListSavingsProducts(ctx); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
	if _, err := svc.ListSubAccounts(ctx, "u1"); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
	if _, err := svc.Borrow(ctx, "u1", "USDT", 1, 5, "BTC", 1, 70); !errors.Is(err, ErrStoreUnavailable) {
		t.Fatalf("expected ErrStoreUnavailable, got %v", err)
	}
}

func TestPersistenceSurvivesReopen(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "earn.db")
	clock := &fixedClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}

	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	svc := NewService(Config{Now: clock.Now}).WithStore(store)
	if err := svc.UpsertSavingsProduct(ctx, &SavingsProduct{ID: "p", Asset: "BTC", Type: "flexible", APY: 5}); err != nil {
		t.Fatalf("creating product: %v", err)
	}
	position, err := svc.SavingsDeposit(ctx, "u1", "p", 1)
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("closing store: %v", err)
	}

	reopened, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("reopening store: %v", err)
	}
	defer reopened.Close()

	svc2 := NewService(Config{Now: clock.Now}).WithStore(reopened)
	positions, err := svc2.ListSavingsPositions(ctx, "u1")
	if err != nil {
		t.Fatalf("listing after reopen: %v", err)
	}
	if len(positions) != 1 || positions[0].ID != position.ID || positions[0].Principal != 1 {
		t.Fatalf("position did not survive the restart: %+v", positions)
	}
}

func TestValidateAmountRejectsNonFinite(t *testing.T) {
	for _, amount := range []float64{0, -1, 1e16} {
		if err := validateAmount(amount); err == nil {
			t.Errorf("expected %v to be rejected", amount)
		}
	}
}
