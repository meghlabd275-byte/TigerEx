package userwallet

import (
	"strings"
	"testing"

	"github.com/tyler-smith/go-bip39"
)

// The service key must be a valid AES-256 key.
func testKey() []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	return key
}

func newTestWalletService(t *testing.T) *UserWalletService {
	t.Helper()
	return NewUserWalletService(testKey())
}

// A generated mnemonic must be valid BIP39, and two of them must differ.
func TestGenerateMnemonicIsValidBIP39(t *testing.T) {
	first, err := generateMnemonic()
	if err != nil {
		t.Fatalf("generateMnemonic failed: %v", err)
	}
	if !bip39.IsMnemonicValid(first) {
		t.Fatalf("generated mnemonic is not valid BIP39: %q", first)
	}
	if words := strings.Fields(first); len(words) != 24 {
		t.Fatalf("expected 24 words, got %d", len(words))
	}

	second, err := generateMnemonic()
	if err != nil {
		t.Fatalf("generateMnemonic failed: %v", err)
	}
	if first == second {
		t.Fatal("two generated mnemonics must not be identical")
	}
}

// A mnemonic with a broken checksum must be rejected, not just a wrong word
// count.
func TestValidateMnemonicChecksChecksum(t *testing.T) {
	valid, err := generateMnemonic()
	if err != nil {
		t.Fatalf("generateMnemonic failed: %v", err)
	}
	if !validateMnemonic(valid) {
		t.Fatal("a valid mnemonic must be accepted")
	}

	// 24 words, but the last word is swapped for another valid word, which
	// breaks the checksum.
	words := strings.Fields(valid)
	words[23] = "abandon"
	if words[23] == strings.Fields(valid)[23] {
		words[23] = "zoo"
	}
	if validateMnemonic(strings.Join(words, " ")) {
		t.Fatal("a mnemonic with a bad checksum must be rejected")
	}
}

// The standard BIP39 test vector must derive the standard first Ethereum
// address, which proves the derivation path and key handling are correct.
func TestDeriveAddressMatchesKnownVector(t *testing.T) {
	const mnemonic = "test test test test test test test test test test test junk"
	const wantAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

	address, pubKey, err := deriveAddress(mnemonic, "eth")
	if err != nil {
		t.Fatalf("deriveAddress failed: %v", err)
	}
	if !strings.EqualFold(address, wantAddress) {
		t.Fatalf("derived address %s, want %s", address, wantAddress)
	}
	if pubKey == "" {
		t.Fatal("public key must be returned")
	}
}

// The same mnemonic must always derive the same address, and different
// mnemonics must not collide.
func TestDeriveAddressIsDeterministic(t *testing.T) {
	const mnemonic = "test test test test test test test test test test test junk"

	first, _, err := deriveAddress(mnemonic, "eth")
	if err != nil {
		t.Fatalf("deriveAddress failed: %v", err)
	}
	second, _, err := deriveAddress(mnemonic, "eth")
	if err != nil {
		t.Fatalf("deriveAddress failed: %v", err)
	}
	if first != second {
		t.Fatalf("derivation is not deterministic: %s vs %s", first, second)
	}

	other, err := generateMnemonic()
	if err != nil {
		t.Fatalf("generateMnemonic failed: %v", err)
	}
	different, _, err := deriveAddress(other, "eth")
	if err != nil {
		t.Fatalf("deriveAddress failed: %v", err)
	}
	if first == different {
		t.Fatal("different mnemonics must not derive the same address")
	}
}

// An EVM address must be a well formed hex address, and a UTXO address must be
// base58. The old code fabricated addresses by hashing the chain name.
func TestDeriveAddressFormats(t *testing.T) {
	const mnemonic = "test test test test test test test test test test test junk"

	evm, _, err := deriveAddress(mnemonic, "eth")
	if err != nil {
		t.Fatalf("deriveAddress failed: %v", err)
	}
	if len(evm) != 42 || !strings.HasPrefix(evm, "0x") {
		t.Fatalf("EVM address is malformed: %q", evm)
	}

	btc, _, err := deriveAddress(mnemonic, "btc")
	if err != nil {
		t.Fatalf("deriveAddress failed: %v", err)
	}
	if len(btc) < 26 || len(btc) > 62 {
		t.Fatalf("UTXO address has an implausible length: %q", btc)
	}
	if strings.HasPrefix(btc, "0x") {
		t.Fatalf("UTXO address must not be hex: %q", btc)
	}
}

// The seed must be sealed at rest and recoverable only with the service key.
func TestSeedIsSealedAtRest(t *testing.T) {
	svc := newTestWalletService(t)

	wallet, err := svc.CreateWallet("user-1", "")
	if err != nil {
		t.Fatalf("CreateWallet failed: %v", err)
	}
	if !wallet.Encrypted {
		t.Fatal("the wallet must report its seed as sealed")
	}
	if bip39.IsMnemonicValid(wallet.Mnemonic) {
		t.Fatal("the stored seed must not be readable plaintext")
	}

	revealed, err := svc.RevealSeed("user-1")
	if err != nil {
		t.Fatalf("RevealSeed failed: %v", err)
	}
	if !bip39.IsMnemonicValid(revealed) {
		t.Fatalf("the revealed seed must be a valid mnemonic: %q", revealed)
	}

	// A different key must not open the seed.
	other := NewUserWalletService(make([]byte, 32))
	other.wallets["user-1"] = wallet
	if _, err := other.RevealSeed("user-1"); err == nil {
		t.Fatal("a different service key must not reveal the seed")
	}
}

// Importing a wallet must seal the seed and validate the checksum.
func TestImportWalletSealsAndValidates(t *testing.T) {
	svc := newTestWalletService(t)

	const mnemonic = "test test test test test test test test test test test junk"
	wallet, err := svc.ImportWallet("user-2", mnemonic, "")
	if err != nil {
		t.Fatalf("ImportWallet failed: %v", err)
	}
	if wallet.Mnemonic == mnemonic {
		t.Fatal("the imported seed must not be stored in plaintext")
	}
	if !wallet.Encrypted {
		t.Fatal("the imported seed must be sealed")
	}

	revealed, err := svc.RevealSeed("user-2")
	if err != nil {
		t.Fatalf("RevealSeed failed: %v", err)
	}
	if revealed != mnemonic {
		t.Fatalf("revealed %q, want %q", revealed, mnemonic)
	}

	// 24 arbitrary words must be refused.
	if _, err := svc.ImportWallet("user-3", strings.Repeat("notaword ", 24), ""); err == nil {
		t.Fatal("an invalid mnemonic must be refused")
	}
}

// A deposit must be recorded as pending and must not credit the balance.
func TestDepositDoesNotCreditBalance(t *testing.T) {
	svc := newTestWalletService(t)

	if _, err := svc.CreateWallet("user-4", ""); err != nil {
		t.Fatalf("CreateWallet failed: %v", err)
	}

	tx, err := svc.CreateDeposit("user-4", "eth", "0xSENDER", "0xabc123", 5.0)
	if err != nil {
		t.Fatalf("CreateDeposit failed: %v", err)
	}
	if tx.Status != "pending" {
		t.Fatalf("deposit status is %q, want pending", tx.Status)
	}

	balance, err := svc.GetBalance("user-4", "ETH")
	if err != nil {
		t.Fatalf("GetBalance failed: %v", err)
	}
	if balance.Available != 0 {
		t.Fatalf("an unconfirmed deposit must not be spendable, got %v", balance.Available)
	}

	// The same on-chain hash must not be credited twice.
	if _, err := svc.CreateDeposit("user-4", "eth", "0xSENDER", "0xabc123", 5.0); err == nil {
		t.Fatal("a replayed deposit hash must be rejected")
	}

	// Inputs must be validated.
	if _, err := svc.CreateDeposit("user-4", "eth", "0xSENDER", "", 1.0); err == nil {
		t.Fatal("a deposit without a transaction hash must be rejected")
	}
	if _, err := svc.CreateDeposit("user-4", "eth", "0xSENDER", "0xdef", -1.0); err == nil {
		t.Fatal("a negative deposit must be rejected")
	}
	if _, err := svc.CreateDeposit("no-such-user", "eth", "0xSENDER", "0xdef", 1.0); err == nil {
		t.Fatal("a deposit for an unknown wallet must be rejected")
	}
}
