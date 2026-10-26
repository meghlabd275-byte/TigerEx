package defiwallet

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
)

var testKey = []byte("0123456789abcdef0123456789abcdef")

// stubSwap is a scripted SwapProvider.
type stubSwap struct {
	quote     *SwapQuote
	quoteErr  error
	hash      string
	execErr   error
	execCalls int
}

func (s *stubSwap) Quote(from, to string, amount float64) (*SwapQuote, error) {
	if s.quoteErr != nil {
		return nil, s.quoteErr
	}
	return s.quote, nil
}

func (s *stubSwap) Execute(from, to string, amount float64) (string, error) {
	s.execCalls++
	if s.execErr != nil {
		return "", s.execErr
	}
	return s.hash, nil
}

// stubStake is a scripted StakeProvider.
type stubStake struct {
	onChainID string
	err       error
}

func (s *stubStake) Stake(asset string, amount float64) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return s.onChainID, nil
}

// Create must derive a real secp256k1 address. The old code returned 20 random
// bytes with no key behind them.
func TestCreateDerivesRealAddress(t *testing.T) {
	m := NewManager(nil, nil)

	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if len(wallet.Address) != 42 || !strings.HasPrefix(wallet.Address, "0x") {
		t.Fatalf("not an EVM address: %q", wallet.Address)
	}
	if strings.EqualFold(wallet.Address, "0x0000000000000000000000000000000000000000") {
		t.Fatal("derived the zero address")
	}
	if len(wallet.SeedCiphertext) == 0 || len(wallet.SeedNonce) == 0 {
		t.Fatal("the seed must be stored encrypted")
	}
}

// The seed must be recoverable with the right key and not with a wrong one.
func TestSeedIsEncryptedAtRest(t *testing.T) {
	m := NewManager(nil, nil)
	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	seed, err := decryptSeed(testKey, wallet.SeedCiphertext, wallet.SeedNonce)
	if err != nil {
		t.Fatalf("the seed must decrypt with the correct key: %v", err)
	}
	if len(seed) != 64 {
		t.Fatalf("expected a 64 byte BIP39 seed, got %d", len(seed))
	}

	wrong := []byte("ffffffffffffffffffffffffffffffff")
	if _, err := decryptSeed(wrong, wallet.SeedCiphertext, wallet.SeedNonce); err == nil {
		t.Fatal("the seed must not decrypt with the wrong key")
	}
}

// Two wallets must have distinct seeds and addresses.
func TestCreateWalletsAreDistinct(t *testing.T) {
	m := NewManager(nil, nil)

	first, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	second, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if first.Address == second.Address {
		t.Fatal("two wallets must not share an address")
	}
	if string(first.SeedCiphertext) == string(second.SeedCiphertext) {
		t.Fatal("two wallets must not share a seed")
	}
}

// AddChainSupport must derive the chain account from the wallet seed, so the
// same seed always yields the same address.
func TestAddChainSupportIsDeterministic(t *testing.T) {
	m := NewManager(nil, nil)

	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	account, err := m.AddChainSupport(wallet.ID, "polygon", testKey)
	if err != nil {
		t.Fatalf("AddChainSupport: %v", err)
	}
	if len(account.Address) != 42 || !strings.HasPrefix(account.Address, "0x") {
		t.Fatalf("not an EVM address: %q", account.Address)
	}
	if account.PrivateKey == "" {
		t.Fatal("the derived account must carry its private key")
	}

	// Adding the same chain again must return the same account, not a new one.
	again, err := m.AddChainSupport(wallet.ID, "polygon", testKey)
	if err != nil {
		t.Fatalf("AddChainSupport: %v", err)
	}
	if again.Address != account.Address {
		t.Fatalf("expected the same address, got %s then %s", account.Address, again.Address)
	}

	// A different EVM chain shares the Ethereum path, so the address matches
	// the wallet's primary address.
	if account.Address != wallet.Address {
		t.Fatalf("EVM chains must share the BIP44 path: %s vs %s", account.Address, wallet.Address)
	}

	// Tron has its own coin type, so it must differ.
	tron, err := m.AddChainSupport(wallet.ID, "tron", testKey)
	if err != nil {
		t.Fatalf("AddChainSupport(tron): %v", err)
	}
	if tron.Address == wallet.Address {
		t.Fatal("a different coin type must derive a different address")
	}
}

// The derived private key must control the derived address.
func TestDerivedKeyControlsAddress(t *testing.T) {
	m := NewManager(nil, nil)
	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	account := wallet.Chains[0]
	key, err := crypto.HexToECDSA(account.PrivateKey)
	if err != nil {
		t.Fatalf("derived private key is not a valid secp256k1 key: %v", err)
	}
	if got := crypto.PubkeyToAddress(key.PublicKey).Hex(); got != account.Address {
		t.Fatalf("private key controls %s, not the recorded address %s", got, account.Address)
	}
}

func TestAddChainSupportErrors(t *testing.T) {
	m := NewManager(nil, nil)

	if _, err := m.AddChainSupport("missing", "polygon", testKey); !errors.Is(err, ErrWalletNotFound) {
		t.Fatalf("expected ErrWalletNotFound, got %v", err)
	}

	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := m.AddChainSupport(wallet.ID, "dogecoin", testKey); !errors.Is(err, ErrUnknownChain) {
		t.Fatalf("expected ErrUnknownChain, got %v", err)
	}
	if _, err := m.AddChainSupport(wallet.ID, "polygon", []byte("short")); err == nil {
		t.Fatal("a too-short encryption key must be rejected")
	}
}

// Import must accept a valid mnemonic and reject an invalid one.
func TestImportValidatesMnemonic(t *testing.T) {
	m := NewManager(nil, nil)
	const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	wallet, err := m.Import("user-1", mnemonic, testKey)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if len(wallet.Address) != 42 {
		t.Fatalf("not an EVM address: %q", wallet.Address)
	}

	// The known address for this mnemonic at m/44'/60'/0'/0/0.
	const want = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
	if !strings.EqualFold(wallet.Address, want) {
		t.Fatalf("address %s, want %s", wallet.Address, want)
	}

	if _, err := m.Import("user-1", "not a valid mnemonic at all", testKey); err == nil {
		t.Fatal("an invalid mnemonic must be rejected")
	}
}

// Swap must go through the provider and must fail without one.
func TestSwapRequiresProvider(t *testing.T) {
	m := NewManager(nil, nil)

	if _, _, err := m.Swap("ETH", "USDC", 1); err == nil {
		t.Fatal("a swap without a provider must fail")
	}
}

func TestSwapUsesProvider(t *testing.T) {
	swap := &stubSwap{
		quote: &SwapQuote{FromToken: "ETH", ToToken: "USDC", InputAmount: 1, OutputAmount: 2500, Slippage: 0.005},
		hash:  "0xabc123",
	}
	m := NewManager(swap, nil)

	quote, hash, err := m.Swap("ETH", "USDC", 1)
	if err != nil {
		t.Fatalf("Swap: %v", err)
	}
	if quote.OutputAmount != 2500 {
		t.Fatalf("output %v, want 2500", quote.OutputAmount)
	}
	if hash != "0xabc123" {
		t.Fatalf("hash %q, want 0xabc123", hash)
	}
	if swap.execCalls != 1 {
		t.Fatalf("expected one execute call, got %d", swap.execCalls)
	}
}

func TestSwapRejectsBadInputAndProviderErrors(t *testing.T) {
	m := NewManager(&stubSwap{quote: &SwapQuote{}, hash: "0x1"}, nil)

	if _, _, err := m.Swap("", "USDC", 1); err == nil {
		t.Fatal("a missing token must be rejected")
	}
	if _, _, err := m.Swap("ETH", "USDC", 0); err == nil {
		t.Fatal("a non-positive amount must be rejected")
	}
	if _, _, err := m.Swap("ETH", "ETH", 1); err == nil {
		t.Fatal("identical tokens must be rejected")
	}

	failing := NewManager(&stubSwap{quoteErr: errors.New("no route")}, nil)
	if _, _, err := failing.Swap("ETH", "USDC", 1); err == nil {
		t.Fatal("a quote error must fail the swap")
	}

	execFailing := NewManager(&stubSwap{quote: &SwapQuote{}, execErr: errors.New("reverted")}, nil)
	if _, _, err := execFailing.Swap("ETH", "USDC", 1); err == nil {
		t.Fatal("an execution error must fail the swap")
	}
}

// Stake must go through the provider and record the on-chain id.
func TestStakeRequiresProviderAndRecordsOnChainID(t *testing.T) {
	m := NewManager(nil, nil)
	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := m.Stake(wallet.ID, "ETH", 10, 0.05); err == nil {
		t.Fatal("staking without a provider must fail")
	}

	withStake := NewManager(nil, &stubStake{onChainID: "pos-42"})
	wallet, err = withStake.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	pos, err := withStake.Stake(wallet.ID, "ETH", 10, 0.05)
	if err != nil {
		t.Fatalf("Stake: %v", err)
	}
	if pos.OnChainID != "pos-42" {
		t.Fatalf("on-chain id %q, want pos-42", pos.OnChainID)
	}

	if _, err := withStake.Stake("missing", "ETH", 10, 0.05); !errors.Is(err, ErrWalletNotFound) {
		t.Fatalf("expected ErrWalletNotFound, got %v", err)
	}
	if _, err := withStake.Stake(wallet.ID, "ETH", -1, 0.05); err == nil {
		t.Fatal("a negative amount must be rejected")
	}

	stakes := withStake.GetStakes(wallet.ID)
	if len(stakes) != 1 || stakes[0].ID != pos.ID {
		t.Fatalf("expected the recorded position, got %#v", stakes)
	}
}

// A wallet must never serialise seed or key material.
func TestWalletJSONHidesSecrets(t *testing.T) {
	m := NewManager(nil, nil)
	wallet, err := m.Create("user-1", testKey)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := m.AddChainSupport(wallet.ID, "polygon", testKey); err != nil {
		t.Fatalf("AddChainSupport: %v", err)
	}

	encoded, err := json.Marshal(wallet)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	text := string(encoded)

	for _, forbidden := range []string{"seedCiphertext", "seedNonce", "privateKey", wallet.Chains[0].PrivateKey} {
		if forbidden == "" {
			continue
		}
		if strings.Contains(text, forbidden) {
			t.Fatalf("serialised wallet leaked %q: %s", forbidden, text)
		}
	}
	if !strings.Contains(text, wallet.Address) {
		t.Fatal("the serialised wallet must still expose the address")
	}
}
