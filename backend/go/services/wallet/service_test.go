package wallet

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

// ---------------------------------------------------------------------------
// In-memory fakes for the injected dependencies.
// ---------------------------------------------------------------------------

type memDB struct {
	wallets      map[uint64]*Wallet
	byAddress    map[string]*Wallet
	balances     map[string]*Balance
	transactions map[string]*Transaction
	nextID       uint64
}

func newMemDB() *memDB {
	return &memDB{
		wallets:      make(map[uint64]*Wallet),
		byAddress:    make(map[string]*Wallet),
		balances:     make(map[string]*Balance),
		transactions: make(map[string]*Transaction),
		nextID:       1,
	}
}

func balanceKey(userID uint64, blockchain, token string) string {
	return blockchain + "|" + token + "|" + string(rune(userID))
}

func (m *memDB) CreateWallet(_ context.Context, w *Wallet) error {
	w.ID = m.nextID
	m.nextID++
	m.wallets[w.ID] = w
	m.byAddress[w.Address] = w
	return nil
}

func (m *memDB) GetWallet(_ context.Context, id uint64) (*Wallet, error) {
	if w, ok := m.wallets[id]; ok {
		return w, nil
	}
	return nil, errors.New("wallet not found")
}

func (m *memDB) GetWalletByAddress(_ context.Context, address string) (*Wallet, error) {
	if w, ok := m.byAddress[address]; ok {
		return w, nil
	}
	return nil, errors.New("wallet not found")
}

func (m *memDB) GetUserWallets(_ context.Context, userID uint64) ([]*Wallet, error) {
	var out []*Wallet
	for _, w := range m.wallets {
		if w.UserID == userID {
			out = append(out, w)
		}
	}
	return out, nil
}

func (m *memDB) UpdateWallet(_ context.Context, w *Wallet) error { m.wallets[w.ID] = w; return nil }
func (m *memDB) DeleteWallet(_ context.Context, id uint64) error { delete(m.wallets, id); return nil }

func (m *memDB) CreateTransaction(_ context.Context, tx *Transaction) error {
	tx.ID = m.nextID
	m.nextID++
	m.transactions[tx.Hash] = tx
	return nil
}

func (m *memDB) GetTransaction(_ context.Context, id uint64) (*Transaction, error) {
	for _, tx := range m.transactions {
		if tx.ID == id {
			return tx, nil
		}
	}
	return nil, errors.New("transaction not found")
}

func (m *memDB) GetTransactionByHash(_ context.Context, hash string) (*Transaction, error) {
	if tx, ok := m.transactions[hash]; ok {
		return tx, nil
	}
	return nil, errors.New("transaction not found")
}

func (m *memDB) GetUserTransactions(_ context.Context, userID uint64, limit int) ([]*Transaction, error) {
	return nil, nil
}

func (m *memDB) UpdateTransaction(_ context.Context, tx *Transaction) error {
	m.transactions[tx.Hash] = tx
	return nil
}

func (m *memDB) CreateDeposit(_ context.Context, d *Deposit) error               { return nil }
func (m *memDB) GetDeposit(_ context.Context, id uint64) (*Deposit, error)       { return nil, nil }
func (m *memDB) UpdateDeposit(_ context.Context, d *Deposit) error               { return nil }
func (m *memDB) CreateWithdrawal(_ context.Context, w *Withdrawal) error         { return nil }
func (m *memDB) GetWithdrawal(_ context.Context, id uint64) (*Withdrawal, error) { return nil, nil }
func (m *memDB) UpdateWithdrawal(_ context.Context, w *Withdrawal) error         { return nil }

func (m *memDB) GetBalance(_ context.Context, userID uint64, blockchain, token string) (*Balance, error) {
	if b, ok := m.balances[balanceKey(userID, blockchain, token)]; ok {
		return b, nil
	}
	return nil, errors.New("balance not found")
}

func (m *memDB) UpdateBalance(_ context.Context, userID uint64, blockchain, token string, b *Balance) error {
	m.balances[balanceKey(userID, blockchain, token)] = b
	return nil
}

// fakeChain is a scripted BlockchainClient.
type fakeChain struct {
	receipt     *TransactionReceipt
	receiptErr  error
	blockNumber uint64
	blockErr    error
	sentHash    string
	sendErr     error
	gasPrice    string
	gasPriceErr error
}

func (f *fakeChain) GetBalance(context.Context, string, string, string) (string, error) {
	return "0", nil
}
func (f *fakeChain) SendTransaction(context.Context, string, string, string, string, string) (string, error) {
	if f.sendErr != nil {
		return "", f.sendErr
	}
	return f.sentHash, nil
}
func (f *fakeChain) GetTransactionReceipt(context.Context, string, string) (*TransactionReceipt, error) {
	return f.receipt, f.receiptErr
}
func (f *fakeChain) GetGasPrice(context.Context, string) (string, error) {
	return f.gasPrice, f.gasPriceErr
}
func (f *fakeChain) GetNonce(context.Context, string, string) (uint64, error) { return 0, nil }
func (f *fakeChain) GetBlockNumber(context.Context, string) (uint64, error) {
	return f.blockNumber, f.blockErr
}
func (f *fakeChain) WatchAddress(context.Context, string, string, func(*BlockTx)) error { return nil }

type noopMPC struct{}

func (noopMPC) GenerateKey() (*MPCKey, error)                  { return &MPCKey{}, nil }
func (noopMPC) Sign(string, string) (string, error)            { return "", nil }
func (noopMPC) Recover(string, string) (string, error)         { return "", nil }
func (noopMPC) ThresholdSign([]string, string) (string, error) { return "", nil }

type noopCache struct{}

func (noopCache) Get(context.Context, string, interface{}) error                { return nil }
func (noopCache) Set(context.Context, string, interface{}, time.Duration) error { return nil }
func (noopCache) Delete(context.Context, string) error                          { return nil }

type noopNotifier struct{ deposits int }

func (n *noopNotifier) SendDepositNotification(uint64, string, string)    { n.deposits++ }
func (n *noopNotifier) SendWithdrawalNotification(uint64, string, string) {}
func (n *noopNotifier) SendTransferNotification(uint64, string, uint64)   {}

type noopAnalytics struct{ deposits int }

func (a *noopAnalytics) TrackEvent(string, map[string]interface{}) {}
func (a *noopAnalytics) TrackDeposit(uint64, float64, string)      { a.deposits++ }
func (a *noopAnalytics) TrackWithdrawal(uint64, float64, string)   {}
func (a *noopAnalytics) TrackTransfer(uint64, float64, uint64)     {}

type noopLogger struct{ warns []string }

func (l *noopLogger) Info(string, ...interface{})          {}
func (l *noopLogger) Warn(msg string, args ...interface{}) { l.warns = append(l.warns, msg) }
func (l *noopLogger) Error(string, ...interface{})         {}
func (l *noopLogger) Debug(string, ...interface{})         {}

// stubPrice is a scripted PriceProvider.
type stubPrice struct {
	price float64
	err   error
}

func (s *stubPrice) GetPrice(context.Context, string) (float64, error) { return s.price, s.err }

// newTestService builds a service around in-memory dependencies.
func newTestService(t *testing.T, chain *fakeChain, price PriceProvider) (*WalletService, *memDB, *noopNotifier, *noopLogger) {
	t.Helper()
	db := newMemDB()
	notifier := &noopNotifier{}
	logger := &noopLogger{}
	cfg := DefaultConfig
	cfg.Confirmations = 12

	svc := NewWalletService(cfg, db, noopCache{}, chain, noopMPC{}, notifier, &noopAnalytics{}, logger, price)

	wallet := &Wallet{
		UserID:     1,
		Blockchain: "ethereum",
		Address:    "0x1111111111111111111111111111111111111111",
		Status:     WalletStatusActive,
	}
	if err := db.CreateWallet(context.Background(), wallet); err != nil {
		t.Fatalf("CreateWallet: %v", err)
	}
	return svc, db, notifier, logger
}

func depositTx(hash, value string) *BlockTx {
	return &BlockTx{
		Hash:  hash,
		From:  "0xsender",
		To:    "0x1111111111111111111111111111111111111111",
		Value: value,
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// An unconfirmed deposit must not be credited. The old code credited any
// BlockTx immediately and marked it completed.
func TestHandleDepositRequiresConfirmations(t *testing.T) {
	chain := &fakeChain{
		receipt:     &TransactionReceipt{Status: true, BlockNumber: 1000, TransactionHash: "0xaaa"},
		blockNumber: 1002, // 3 confirmations, below the required 12
	}
	svc, db, notifier, _ := newTestService(t, chain, &stubPrice{price: 3000})

	if err := svc.HandleDeposit(context.Background(), depositTx("0xaaa", "1.5")); err != nil {
		t.Fatalf("HandleDeposit: %v", err)
	}

	balance, _ := db.GetBalance(context.Background(), 1, "ethereum", "ethereum")
	if balance != nil && balance.Available != "" && balance.Available != "0" {
		t.Fatalf("an unconfirmed deposit must not credit a balance, got %q", balance.Available)
	}
	if notifier.deposits != 0 {
		t.Fatalf("an unconfirmed deposit must not notify, got %d", notifier.deposits)
	}

	tx, err := db.GetTransactionByHash(context.Background(), "0xaaa")
	if err != nil {
		t.Fatalf("the deposit must be recorded for tracking: %v", err)
	}
	if tx.Status == TxStatusCompleted {
		t.Fatal("an unconfirmed deposit must not be marked completed")
	}
	if tx.Confirmations != 3 {
		t.Fatalf("confirmations %d, want 3", tx.Confirmations)
	}
}

// A deposit with enough confirmations must be credited exactly once.
func TestHandleDepositCreditsOnceConfirmed(t *testing.T) {
	chain := &fakeChain{
		receipt:     &TransactionReceipt{Status: true, BlockNumber: 1000, TransactionHash: "0xbbb"},
		blockNumber: 1011, // 12 confirmations
	}
	svc, db, notifier, _ := newTestService(t, chain, &stubPrice{price: 3000})

	if err := svc.HandleDeposit(context.Background(), depositTx("0xbbb", "1.5")); err != nil {
		t.Fatalf("HandleDeposit: %v", err)
	}

	balance, err := db.GetBalance(context.Background(), 1, "ethereum", "ethereum")
	if err != nil {
		t.Fatalf("GetBalance: %v", err)
	}
	if balance.Available != "1.5" {
		t.Fatalf("available %q, want 1.5", balance.Available)
	}
	if balance.USDValue != 4500 {
		t.Fatalf("usd value %v, want 4500", balance.USDValue)
	}
	if notifier.deposits != 1 {
		t.Fatalf("expected one notification, got %d", notifier.deposits)
	}

	// Replaying the same deposit must not credit again.
	if err := svc.HandleDeposit(context.Background(), depositTx("0xbbb", "1.5")); err != nil {
		t.Fatalf("replayed HandleDeposit: %v", err)
	}
	balance, _ = db.GetBalance(context.Background(), 1, "ethereum", "ethereum")
	if balance.Available != "1.5" {
		t.Fatalf("a replayed deposit must not double credit, got %q", balance.Available)
	}
	if notifier.deposits != 1 {
		t.Fatalf("a replayed deposit must not re-notify, got %d", notifier.deposits)
	}
}

// A failed or missing on-chain receipt must not credit a balance.
func TestHandleDepositRejectsFailedOrMissingReceipt(t *testing.T) {
	failed := &fakeChain{
		receipt:     &TransactionReceipt{Status: false, BlockNumber: 1000},
		blockNumber: 1011,
	}
	svc, db, _, _ := newTestService(t, failed, &stubPrice{price: 3000})
	if err := svc.HandleDeposit(context.Background(), depositTx("0xccc", "5")); err == nil {
		t.Fatal("a failed on-chain transaction must be rejected")
	}
	if b, _ := db.GetBalance(context.Background(), 1, "ethereum", "ethereum"); b != nil && b.Available != "" && b.Available != "0" {
		t.Fatalf("a failed deposit must not credit a balance, got %q", b.Available)
	}

	missing := &fakeChain{receipt: nil, blockNumber: 1011}
	svc2, db2, _, _ := newTestService(t, missing, &stubPrice{price: 3000})
	if err := svc2.HandleDeposit(context.Background(), depositTx("0xddd", "5")); err == nil {
		t.Fatal("a deposit with no receipt must be rejected")
	}
	if b, _ := db2.GetBalance(context.Background(), 1, "ethereum", "ethereum"); b != nil && b.Available != "" && b.Available != "0" {
		t.Fatalf("a deposit with no receipt must not credit a balance, got %q", b.Available)
	}

	lookupErr := &fakeChain{receiptErr: errors.New("rpc unavailable"), blockNumber: 1011}
	svc3, _, _, _ := newTestService(t, lookupErr, &stubPrice{price: 3000})
	if err := svc3.HandleDeposit(context.Background(), depositTx("0xeee", "5")); err == nil {
		t.Fatal("a receipt lookup error must fail the deposit")
	}
}

// A deposit with an invalid value must be rejected.
func TestHandleDepositRejectsInvalidValue(t *testing.T) {
	chain := &fakeChain{
		receipt:     &TransactionReceipt{Status: true, BlockNumber: 1000},
		blockNumber: 1011,
	}
	svc, _, _, _ := newTestService(t, chain, &stubPrice{price: 3000})

	for _, value := range []string{"", "abc", "0", "-1"} {
		if err := svc.HandleDeposit(context.Background(), depositTx("0x"+value, value)); err == nil {
			t.Errorf("value %q must be rejected", value)
		}
	}
}

// calculateUSDValue must use the price provider, and must fail rather than
// invent a price.
func TestCalculateUSDValueUsesProvider(t *testing.T) {
	svc, _, _, _ := newTestService(t, &fakeChain{}, &stubPrice{price: 123.45})

	value, err := svc.calculateUSDValue("2", "TGR")
	if err != nil {
		t.Fatalf("calculateUSDValue: %v", err)
	}
	if value != 246.9 {
		t.Fatalf("value %v, want 246.9", value)
	}

	if _, err := svc.calculateUSDValue("notanumber", "TGR"); err == nil {
		t.Fatal("an invalid amount must be rejected")
	}
}

func TestGetTokenPriceErrors(t *testing.T) {
	noPrice, _, _, _ := newTestService(t, &fakeChain{}, nil)
	if _, err := noPrice.getTokenPrice("BTC"); err == nil {
		t.Fatal("a missing price provider must be an error")
	}

	failing, _, _, _ := newTestService(t, &fakeChain{}, &stubPrice{err: errors.New("upstream down")})
	if _, err := failing.getTokenPrice("BTC"); err == nil {
		t.Fatal("a provider error must propagate")
	}

	zero, _, _, _ := newTestService(t, &fakeChain{}, &stubPrice{price: 0})
	if _, err := zero.getTokenPrice("BTC"); err == nil {
		t.Fatal("a non-positive price must be rejected")
	}
}

// The generated EVM key must be secp256k1 and must control the address.
func TestCreateEVMWalletUsesSecp256k1(t *testing.T) {
	svc, _, _, _ := newTestService(t, &fakeChain{}, nil)

	wallet, err := svc.createEVMWallet(context.Background(), &CreateWalletRequest{
		UserID:     1,
		Blockchain: "ethereum",
		Type:       WalletTypeHot,
	})
	if err != nil {
		t.Fatalf("createEVMWallet: %v", err)
	}
	if len(wallet.Address) != 42 || !strings.HasPrefix(wallet.Address, "0x") {
		t.Fatalf("not an EVM address: %q", wallet.Address)
	}

	key, err := crypto.HexToECDSA(wallet.PrivateKey)
	if err != nil {
		t.Fatalf("the generated key is not secp256k1: %v", err)
	}
	if got := crypto.PubkeyToAddress(key.PublicKey).Hex(); got != wallet.Address {
		t.Fatalf("private key controls %s, not %s", got, wallet.Address)
	}
}
