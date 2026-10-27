package institutional

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
)

// The stores below are real implementations of the dependency interfaces, not
// mocks: they keep data in memory but perform the same accounting the
// production ledger and account store do. They exist so the service logic is
// exercised end to end rather than against stubbed return values.

type memAccounts struct {
	mu       sync.Mutex
	subs     map[string]*SubAccount
	masters  map[string]*MasterAccount
	groups   map[string]*PermissionGroup
	quotes   map[string]*OTCQuote
	custody  map[string]*CustodyAccount
	failSave error
}

func newMemAccounts() *memAccounts {
	return &memAccounts{
		subs:    map[string]*SubAccount{},
		masters: map[string]*MasterAccount{},
		groups:  map[string]*PermissionGroup{},
		quotes:  map[string]*OTCQuote{},
		custody: map[string]*CustodyAccount{},
	}
}

func (m *memAccounts) SaveSubAccount(_ context.Context, sub *SubAccount) error {
	if m.failSave != nil {
		return m.failSave
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	clone := *sub
	m.subs[sub.ID] = &clone
	return nil
}

func (m *memAccounts) GetSubAccount(_ context.Context, id string) (*SubAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sub, ok := m.subs[id]
	if !ok {
		return nil, ErrNotFound
	}
	clone := *sub
	return &clone, nil
}

func (m *memAccounts) ListSubAccounts(_ context.Context, masterID string) ([]*SubAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*SubAccount, 0)
	for _, sub := range m.subs {
		if sub.MasterID == masterID {
			clone := *sub
			out = append(out, &clone)
		}
	}
	return out, nil
}

func (m *memAccounts) SaveMasterAccount(_ context.Context, a *MasterAccount) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	clone := *a
	m.masters[a.ID] = &clone
	return nil
}

func (m *memAccounts) GetMasterAccount(_ context.Context, id string) (*MasterAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.masters[id]
	if !ok {
		return nil, ErrNotFound
	}
	clone := *a
	return &clone, nil
}

func (m *memAccounts) SavePermissionGroup(_ context.Context, g *PermissionGroup) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	clone := *g
	m.groups[g.ID] = &clone
	return nil
}

func (m *memAccounts) GetPermissionGroup(_ context.Context, id string) (*PermissionGroup, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.groups[id]
	if !ok {
		return nil, ErrNotFound
	}
	clone := *g
	return &clone, nil
}

func (m *memAccounts) ListPermissionGroups(_ context.Context) ([]*PermissionGroup, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*PermissionGroup, 0, len(m.groups))
	for _, g := range m.groups {
		clone := *g
		out = append(out, &clone)
	}
	return out, nil
}

func (m *memAccounts) SaveOTCQuote(_ context.Context, q *OTCQuote) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	clone := *q
	m.quotes[q.ID] = &clone
	return nil
}

func (m *memAccounts) GetOTCQuote(_ context.Context, id string) (*OTCQuote, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	q, ok := m.quotes[id]
	if !ok {
		return nil, ErrNotFound
	}
	clone := *q
	return &clone, nil
}

func (m *memAccounts) SaveCustodyAccount(_ context.Context, a *CustodyAccount) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	clone := *a
	m.custody[a.ID] = &clone
	return nil
}

func (m *memAccounts) GetCustodyAccount(_ context.Context, id string) (*CustodyAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.custody[id]
	if !ok {
		return nil, ErrNotFound
	}
	clone := *a
	return &clone, nil
}

func (m *memAccounts) ListCustodyAccounts(_ context.Context, userID string) ([]*CustodyAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*CustodyAccount, 0)
	for _, a := range m.custody {
		if a.UserID == userID {
			clone := *a
			out = append(out, &clone)
		}
	}
	return out, nil
}

// memLedger keeps balances per account and moves them on transfer.
type memLedger struct {
	mu       sync.Mutex
	balances map[string]map[string]float64
	settled  int
	failWith error
}

func newMemLedger() *memLedger {
	return &memLedger{balances: map[string]map[string]float64{}}
}

func (l *memLedger) credit(accountID, asset string, amount float64) {
	if l.balances[accountID] == nil {
		l.balances[accountID] = map[string]float64{}
	}
	l.balances[accountID][asset] += amount
}

func (l *memLedger) Balances(_ context.Context, accountID string) (map[string]float64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := map[string]float64{}
	for k, v := range l.balances[accountID] {
		out[k] = v
	}
	return out, nil
}

func (l *memLedger) TransferSubAccount(_ context.Context, fromID, toID, asset string, amount float64) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failWith != nil {
		return l.failWith
	}
	if l.balances[fromID][asset] < amount {
		return fmt.Errorf("insufficient balance in %s", fromID)
	}
	l.balances[fromID][asset] -= amount
	if l.balances[toID] == nil {
		l.balances[toID] = map[string]float64{}
	}
	l.balances[toID][asset] += amount
	return nil
}

func (l *memLedger) TransferCustody(_ context.Context, fromID, toID string, amount float64) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.balances[fromID]["USD"] < amount {
		return errors.New("insufficient balance")
	}
	l.balances[fromID]["USD"] -= amount
	if l.balances[toID] == nil {
		l.balances[toID] = map[string]float64{}
	}
	l.balances[toID]["USD"] += amount
	return nil
}

func (l *memLedger) SettleOTC(_ context.Context, userID, asset, side string, amount, total, fee float64) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failWith != nil {
		return l.failWith
	}
	l.settled++
	return nil
}

// memMarkets returns a configurable price and can be made to fail.
type memMarkets struct {
	prices map[string]float64
	err    error
}

func (m *memMarkets) USDPrice(_ context.Context, asset string) (float64, error) {
	if m.err != nil {
		return 0, m.err
	}
	p, ok := m.prices[asset]
	if !ok {
		return 0, ErrMarketUnavailable
	}
	return p, nil
}

// memAudit records audit entries.
type memAudit struct {
	entries []*AuditLog
	err     error
}

func (a *memAudit) Append(_ context.Context, e *AuditLog) error {
	if a.err != nil {
		return a.err
	}
	a.entries = append(a.entries, e)
	return nil
}

func (a *memAudit) List(_ context.Context, userID string, limit int) ([]*AuditLog, error) {
	if a.err != nil {
		return nil, a.err
	}
	out := make([]*AuditLog, 0)
	for _, e := range a.entries {
		if e.UserID == userID {
			out = append(out, e)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// memManagers is a small CRM directory.
type memManagers struct {
	managers map[string]*DedicatedAccountManager
	assigned map[string]string
}

func newMemManagers() *memManagers {
	return &memManagers{
		managers: map[string]*DedicatedAccountManager{
			"mgr_1": {ID: "mgr_1", Name: "Ada Lovelace", Email: "ada@tigerex.com", Language: "en"},
		},
		assigned: map[string]string{},
	}
}

func (m *memManagers) Lookup(managerID string) (*DedicatedAccountManager, error) {
	mgr, ok := m.managers[managerID]
	if !ok {
		return nil, ErrNotFound
	}
	clone := *mgr
	return &clone, nil
}

func (m *memManagers) Assign(userID, managerID string) error {
	if _, ok := m.managers[managerID]; !ok {
		return ErrNotFound
	}
	m.assigned[userID] = managerID
	return nil
}

type harness struct {
	svc      *Service
	accounts *memAccounts
	ledger   *memLedger
	markets  *memMarkets
	audit    *memAudit
	managers *memManagers
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		accounts: newMemAccounts(),
		ledger:   newMemLedger(),
		markets:  &memMarkets{prices: map[string]float64{"BTC": 45000, "ETH": 3000}},
		audit:    &memAudit{},
		managers: newMemManagers(),
	}
	h.svc = NewService(Config{MaxSubAccounts: 3}, h.accounts, h.ledger, h.markets, h.audit, h.managers)
	return h
}

// TestSubAccountLifecycle covers create, read, update, and close.
func TestSubAccountLifecycle(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	sub, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk A", "desk-a@example.com", []string{"spot.trade"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if sub.Status != "active" || !sub.TradingEnabled || sub.WithdrawalEnabled {
		t.Fatalf("unexpected defaults: %+v", sub)
	}

	got, err := h.svc.GetSubAccount("master_1", sub.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "Desk A" {
		t.Fatalf("name round trip failed: %q", got.Name)
	}

	updated, err := h.svc.UpdateSubAccount("master_1", sub.ID, map[string]interface{}{
		"name":              "Desk A Prime",
		"withdrawalEnabled": true,
		"status":            "suspended",
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Desk A Prime" || !updated.WithdrawalEnabled || updated.Status != "suspended" {
		t.Fatalf("update did not apply: %+v", updated)
	}

	// The update must be persisted, not only returned.
	reloaded, err := h.svc.GetSubAccount("master_1", sub.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Name != "Desk A Prime" || !reloaded.WithdrawalEnabled {
		t.Fatalf("update was not persisted: %+v", reloaded)
	}

	if err := h.svc.DeleteSubAccount("master_1", sub.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	closed, err := h.svc.GetSubAccount("master_1", sub.ID)
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if closed.Status != "closed" {
		t.Fatalf("status after delete: %q", closed.Status)
	}
}

// TestUpdateSubAccountWrongTypeDoesNotPanic is the regression test for the
// unchecked type assertions that used to panic.
func TestUpdateSubAccountWrongTypeDoesNotPanic(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	sub, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk A", "a@example.com", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	cases := []map[string]interface{}{
		{"name": 123},
		{"permissions": "spot.trade"},
		{"tradingEnabled": "yes"},
		{"withdrawalEnabled": 1},
		{"status": 42},
	}
	for i, updates := range cases {
		if _, err := h.svc.UpdateSubAccount("master_1", sub.ID, updates); err == nil {
			t.Fatalf("case %d: wrong type was accepted", i)
		}
	}
}

// TestSubAccountCrossMasterDenied checks that one master cannot read another's
// sub-account.
func TestSubAccountCrossMasterDenied(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	sub, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk A", "a@example.com", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := h.svc.GetSubAccount("master_2", sub.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-master read: want ErrUnauthorized, got %v", err)
	}
	if _, err := h.svc.UpdateSubAccount("master_2", sub.ID, map[string]interface{}{"name": "hijack"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-master update: want ErrUnauthorized, got %v", err)
	}
	if err := h.svc.DeleteSubAccount("master_2", sub.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-master delete: want ErrUnauthorized, got %v", err)
	}
}

// TestSubAccountLimitEnforced checks the configured cap.
func TestSubAccountLimitEnforced(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := h.svc.CreateSubAccount(ctx, "master_1", fmt.Sprintf("Desk %d", i), "", nil); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if _, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk 4", "", nil); !errors.Is(err, ErrSubAccountLimit) {
		t.Fatalf("want ErrSubAccountLimit, got %v", err)
	}
}

// TestUnknownPermissionRejected checks that a typo cannot be stored.
func TestUnknownPermissionRejected(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	if _, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk", "", []string{"spot.traed"}); !errors.Is(err, ErrInvalidPermission) {
		t.Fatalf("want ErrInvalidPermission, got %v", err)
	}
	if _, err := h.svc.CreatePermissionGroup("Desk", "", []string{"not.a.permission"}); !errors.Is(err, ErrInvalidPermission) {
		t.Fatalf("group: want ErrInvalidPermission, got %v", err)
	}
}

// TestTransferMovesFundsInLedger checks that the transfer reaches the ledger
// rather than only returning nil.
func TestTransferMovesFundsInLedger(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	from, err := h.svc.CreateSubAccount(ctx, "master_1", "From", "", nil)
	if err != nil {
		t.Fatalf("create from: %v", err)
	}
	to, err := h.svc.CreateSubAccount(ctx, "master_1", "To", "", nil)
	if err != nil {
		t.Fatalf("create to: %v", err)
	}

	h.ledger.credit(from.ID, "BTC", 5)

	if err := h.svc.TransferBetweenSubAccounts("master_1", from.ID, to.ID, "BTC", 2); err != nil {
		t.Fatalf("transfer: %v", err)
	}

	fromBal, err := h.svc.GetSubAccountBalance(ctx, "master_1", from.ID)
	if err != nil {
		t.Fatalf("from balance: %v", err)
	}
	toBal, err := h.svc.GetSubAccountBalance(ctx, "master_1", to.ID)
	if err != nil {
		t.Fatalf("to balance: %v", err)
	}
	if fromBal.Balances["BTC"] != 3 {
		t.Fatalf("from balance: got %v, want 3", fromBal.Balances["BTC"])
	}
	if toBal.Balances["BTC"] != 2 {
		t.Fatalf("to balance: got %v, want 2", toBal.Balances["BTC"])
	}
}

// TestTransferValidation checks the amount and state guards.
func TestTransferValidation(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	from, _ := h.svc.CreateSubAccount(ctx, "master_1", "From", "", nil)
	to, _ := h.svc.CreateSubAccount(ctx, "master_1", "To", "", nil)
	h.ledger.credit(from.ID, "BTC", 5)

	if err := h.svc.TransferBetweenSubAccounts("master_1", from.ID, to.ID, "BTC", 0); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("zero amount: want ErrInvalidAmount, got %v", err)
	}
	if err := h.svc.TransferBetweenSubAccounts("master_1", from.ID, to.ID, "BTC", -1); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("negative amount: want ErrInvalidAmount, got %v", err)
	}
	if err := h.svc.TransferBetweenSubAccounts("master_1", from.ID, to.ID, "BTC", 100); err == nil {
		t.Fatal("overdraft was allowed")
	}

	// A closed account cannot transfer.
	if err := h.svc.DeleteSubAccount("master_1", to.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := h.svc.TransferBetweenSubAccounts("master_1", from.ID, to.ID, "BTC", 1); err == nil {
		t.Fatal("transfer to a closed account was allowed")
	}
}

// TestOTCQuoteUsesLivePrice is the regression test for the hardcoded 45000
// placeholder price.
func TestOTCQuoteUsesLivePrice(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	h.markets.prices["BTC"] = 61000
	quote, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "buy", 1000)
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	// A buy quote is below market by the 0.2% discount.
	want := 61000 * (1 - 0.002)
	if quote.QuotePrice != want {
		t.Fatalf("quote price: got %v, want %v", quote.QuotePrice, want)
	}
	if quote.Fee != 1000*want*0.001 {
		t.Fatalf("fee: got %v", quote.Fee)
	}
}

// TestOTCQuoteFailsWithoutPrice checks that a missing market price is an error
// rather than a default.
func TestOTCQuoteFailsWithoutPrice(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	if _, err := h.svc.RequestOTCQuote(ctx, "user_1", "UNKNOWN", "buy", 1000); !errors.Is(err, ErrMarketUnavailable) {
		t.Fatalf("want ErrMarketUnavailable, got %v", err)
	}

	h.markets.err = errors.New("upstream down")
	if _, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "buy", 1000); err == nil {
		t.Fatal("a market data failure was ignored")
	}
}

// TestOTCQuoteValidation checks side and amount.
func TestOTCQuoteValidation(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	if _, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "hodl", 1000); !errors.Is(err, ErrInvalidSide) {
		t.Fatalf("want ErrInvalidSide, got %v", err)
	}
	if _, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "buy", -5); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("want ErrInvalidAmount, got %v", err)
	}
}

// TestOTCQuoteFlow covers quote, confirm, and execute, and checks the ledger
// settlement is reached.
func TestOTCQuoteFlow(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	quote, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "sell", 2)
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	if quote.Status != "pending" {
		t.Fatalf("status: %q", quote.Status)
	}

	// Another user cannot confirm or execute.
	if err := h.svc.ConfirmOTCQuote("user_2", quote.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-user confirm: want ErrUnauthorized, got %v", err)
	}
	if _, err := h.svc.ExecuteOTC("user_2", quote.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-user execute: want ErrUnauthorized, got %v", err)
	}

	// Execute before confirm is refused.
	if _, err := h.svc.ExecuteOTC("user_1", quote.ID); err == nil {
		t.Fatal("execute before confirm was allowed")
	}

	if err := h.svc.ConfirmOTCQuote("user_1", quote.ID); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	done, err := h.svc.ExecuteOTC("user_1", quote.ID)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if done.Status != "completed" || done.FinalPrice != quote.QuotePrice {
		t.Fatalf("executed quote: %+v", done)
	}
	if h.ledger.settled != 1 {
		t.Fatalf("ledger settlements: got %d, want 1", h.ledger.settled)
	}

	// A ledger failure must surface, and the quote must not be marked complete.
	h.ledger.failWith = errors.New("ledger unavailable")
	quote2, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "buy", 1)
	if err != nil {
		t.Fatalf("quote2: %v", err)
	}
	if err := h.svc.ConfirmOTCQuote("user_1", quote2.ID); err != nil {
		t.Fatalf("confirm2: %v", err)
	}
	if _, err := h.svc.ExecuteOTC("user_1", quote2.ID); err == nil {
		t.Fatal("a ledger failure was ignored")
	}
}

// TestExpiredQuoteRejected checks the expiry guard.
func TestExpiredQuoteRejected(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	quote, err := h.svc.RequestOTCQuote(ctx, "user_1", "BTC", "buy", 1)
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	// Move the expiry into the past.
	quote.ExpiresAt = 1
	if err := h.accounts.SaveOTCQuote(ctx, quote); err != nil {
		t.Fatalf("save: %v", err)
	}

	if err := h.svc.ConfirmOTCQuote("user_1", quote.ID); !errors.Is(err, ErrQuoteExpired) {
		t.Fatalf("want ErrQuoteExpired, got %v", err)
	}
}

// TestCustodyTransferMovesFunds checks the custody path reaches the ledger.
func TestCustodyTransferMovesFunds(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	hot, err := h.svc.CreateCustodyAccount(ctx, "user_1", "Hot", "hot", "bitcoin")
	if err != nil {
		t.Fatalf("create hot: %v", err)
	}
	cold, err := h.svc.CreateCustodyAccount(ctx, "user_1", "Cold", "cold", "bitcoin")
	if err != nil {
		t.Fatalf("create cold: %v", err)
	}

	h.ledger.credit(hot.ID, "USD", 1000)

	if err := h.svc.TransferToCustody("user_1", hot.ID, cold.ID, 400); err != nil {
		t.Fatalf("transfer: %v", err)
	}

	hotBal, _ := h.ledger.Balances(ctx, hot.ID)
	coldBal, _ := h.ledger.Balances(ctx, cold.ID)
	if hotBal["USD"] != 600 || coldBal["USD"] != 400 {
		t.Fatalf("balances: hot=%v cold=%v", hotBal["USD"], coldBal["USD"])
	}

	// Another user cannot touch these accounts.
	if err := h.svc.TransferToCustody("user_2", hot.ID, cold.ID, 1); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-user transfer: want ErrUnauthorized, got %v", err)
	}
}

// TestCustodyAccountTypeValidated checks the enum.
func TestCustodyAccountTypeValidated(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	if _, err := h.svc.CreateCustodyAccount(ctx, "user_1", "X", "warm", "bitcoin"); !errors.Is(err, ErrInvalidAccountType) {
		t.Fatalf("want ErrInvalidAccountType, got %v", err)
	}
}

// TestFeeTierBoundaries checks the volume-to-fee mapping.
func TestFeeTierBoundaries(t *testing.T) {
	cases := []struct {
		volume float64
		want   float64
	}{
		{0, 0.005},
		{999999, 0.005},
		{1000000, 0.002},
		{10000000, 0.001},
		{50000000, 0.0005},
		{100000000, 0.0},
	}
	for _, tc := range cases {
		if got := feeTierForVolume(tc.volume); got != tc.want {
			t.Fatalf("volume %v: got %v, want %v", tc.volume, got, tc.want)
		}
	}
}

// TestUpdateFeeTierPersists checks the tier is written through the store.
func TestUpdateFeeTierPersists(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	account, err := h.svc.CreateMasterAccount(ctx, "user_1", "Fund", "institutional", 0.005)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := h.svc.UpdateFeeTier(account.ID, 12000000); err != nil {
		t.Fatalf("update fee tier: %v", err)
	}
	got, err := h.svc.GetMasterAccount("user_1", account.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.FeeTier != 0.001 || got.MonthlyVolume != 12000000 {
		t.Fatalf("fee tier not persisted: %+v", got)
	}

	if err := h.svc.UpdateFeeTier(account.ID, -1); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("negative volume: want ErrInvalidAmount, got %v", err)
	}
}

// TestMasterAccountTypeValidated checks the enum and the owner check.
func TestMasterAccountTypeValidated(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	if _, err := h.svc.CreateMasterAccount(ctx, "user_1", "Fund", "retail", 0.005); !errors.Is(err, ErrInvalidAccountType) {
		t.Fatalf("want ErrInvalidAccountType, got %v", err)
	}

	account, err := h.svc.CreateMasterAccount(ctx, "user_1", "Fund", "master", 0.005)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := h.svc.GetMasterAccount("user_2", account.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-user read: want ErrUnauthorized, got %v", err)
	}
}

// TestAssignPermissionGroupPersists checks the group's permissions are applied
// and stored.
func TestAssignPermissionGroupPersists(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	group, err := h.svc.CreatePermissionGroup("Trading", "spot only", []string{"spot.trade", "report.view"})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	sub, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk", "", nil)
	if err != nil {
		t.Fatalf("create sub: %v", err)
	}

	if err := h.svc.AssignPermissionGroup("master_1", sub.ID, group.ID); err != nil {
		t.Fatalf("assign: %v", err)
	}

	reloaded, err := h.svc.GetSubAccount("master_1", sub.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(reloaded.Permissions) != 2 || reloaded.Permissions[0] != "spot.trade" {
		t.Fatalf("permissions not persisted: %+v", reloaded.Permissions)
	}
}

// TestAssignAccountManagerUsesDirectory is the regression test for the
// hardcoded "John Doe" placeholder manager.
func TestAssignAccountManagerUsesDirectory(t *testing.T) {
	h := newHarness(t)

	mgr, err := h.svc.AssignAccountManager("user_1", "mgr_1")
	if err != nil {
		t.Fatalf("assign: %v", err)
	}
	if mgr.Name != "Ada Lovelace" || mgr.Email != "ada@tigerex.com" {
		t.Fatalf("manager was not read from the directory: %+v", mgr)
	}
	if mgr.UserID != "user_1" || mgr.AssignedAt == 0 {
		t.Fatalf("assignment not recorded: %+v", mgr)
	}
	if h.managers.assigned["user_1"] != "mgr_1" {
		t.Fatal("assignment was not persisted to the directory")
	}

	if _, err := h.svc.AssignAccountManager("user_1", "mgr_missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown manager: want ErrNotFound, got %v", err)
	}
}

// TestAuditLogIsPersisted is the regression test for audit entries being
// created and then discarded.
func TestAuditLogIsPersisted(t *testing.T) {
	h := newHarness(t)

	entry, err := h.svc.LogAction("user_1", "login", "session", "sess_1", "203.0.113.5", "curl/8", "ok")
	if err != nil {
		t.Fatalf("log action: %v", err)
	}
	if entry.ID == "" {
		t.Fatal("audit entry has no id")
	}

	logs, err := h.svc.GetAuditLogs("user_1", 10)
	if err != nil {
		t.Fatalf("get audit logs: %v", err)
	}
	if len(logs) != 1 || logs[0].Action != "login" {
		t.Fatalf("audit entry was not persisted: %+v", logs)
	}

	// A store failure must be reported.
	h.audit.err = errors.New("audit store down")
	if _, err := h.svc.LogAction("user_1", "login", "session", "sess_2", "", "", ""); err == nil {
		t.Fatal("audit store failure was ignored")
	}
}

// TestMutationsWriteAuditTrail checks that the mutating operations record what
// happened.
func TestMutationsWriteAuditTrail(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	sub, err := h.svc.CreateSubAccount(ctx, "master_1", "Desk", "", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := h.svc.DeleteSubAccount("master_1", sub.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	actions := map[string]bool{}
	for _, e := range h.audit.entries {
		actions[e.Action] = true
	}
	for _, want := range []string{"subaccount.create", "subaccount.close"} {
		if !actions[want] {
			t.Fatalf("missing audit action %q in %v", want, actions)
		}
	}
}

// TestNilDependenciesFailClosed checks that a service built without stores
// reports the missing dependency instead of appearing to succeed.
func TestNilDependenciesFailClosed(t *testing.T) {
	svc := NewService(Config{}, nil, nil, nil, nil, nil)
	ctx := context.Background()

	if _, err := svc.CreateSubAccount(ctx, "m", "n", "", nil); !errors.Is(err, ErrDependencyMissing) {
		t.Fatalf("create: want ErrDependencyMissing, got %v", err)
	}
	if err := svc.TransferBetweenSubAccounts("m", "a", "b", "BTC", 1); !errors.Is(err, ErrDependencyMissing) {
		t.Fatalf("transfer: want ErrDependencyMissing, got %v", err)
	}
	if _, err := svc.RequestOTCQuote(ctx, "u", "BTC", "buy", 1); !errors.Is(err, ErrDependencyMissing) {
		t.Fatalf("quote: want ErrDependencyMissing, got %v", err)
	}
	if _, err := svc.AssignAccountManager("u", "m"); !errors.Is(err, ErrDependencyMissing) {
		t.Fatalf("manager: want ErrDependencyMissing, got %v", err)
	}
	if _, err := svc.LogAction("u", "a", "r", "i", "", "", ""); !errors.Is(err, ErrDependencyMissing) {
		t.Fatalf("audit: want ErrDependencyMissing, got %v", err)
	}
}

// TestDefaultSubAccountLimit checks the default cap is applied.
func TestDefaultSubAccountLimit(t *testing.T) {
	h := &harness{
		accounts: newMemAccounts(),
		ledger:   newMemLedger(),
		markets:  &memMarkets{prices: map[string]float64{"BTC": 1}},
		audit:    &memAudit{},
		managers: newMemManagers(),
	}
	h.svc = NewService(Config{}, h.accounts, h.ledger, h.markets, h.audit, h.managers)
	if h.svc.config.MaxSubAccounts != 300 {
		t.Fatalf("default limit: got %d, want 300", h.svc.config.MaxSubAccounts)
	}
}
