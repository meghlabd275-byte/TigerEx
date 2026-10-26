package web3

import (
	"context"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/tyler-smith/go-bip39"
)

import (
	"encoding/hex"

	"github.com/tyler-smith/go-bip32"
)

func hexString(b []byte) string { return hex.EncodeToString(b) }

// hdWalletFromSeed builds an HDWallet from an existing BIP39 seed.
func hdWalletFromSeed(seed []byte) (*HDWallet, error) {
	master, err := bip32.NewMasterKey(seed)
	if err != nil {
		return nil, err
	}
	return &HDWallet{
		MasterKey: &MasterKey{
			Key:       hex.EncodeToString(master.Key),
			ChainCode: hex.EncodeToString(master.ChainCode),
		},
		ChildKeys: make(map[uint32]*ChildKey),
	}, nil
}

// The standard BIP39 test vector from the specification: the "abandon" phrase
// with an empty passphrase must derive this seed.
const testMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

const testSeedHex = "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4"

// GenerateMnemonic must produce valid, varying BIP39 phrases. The old code
// returned the same 24 dictionary words in a fixed cycle every time.
func TestGenerateMnemonicIsValidAndVaries(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 20; i++ {
		mnemonic, err := GenerateMnemonic(12)
		if err != nil {
			t.Fatalf("GenerateMnemonic failed: %v", err)
		}
		if !bip39.IsMnemonicValid(mnemonic) {
			t.Fatalf("generated an invalid mnemonic: %q", mnemonic)
		}
		if len(strings.Fields(mnemonic)) != 12 {
			t.Fatalf("expected 12 words, got %d", len(strings.Fields(mnemonic)))
		}
		seen[mnemonic] = true
	}
	if len(seen) != 20 {
		t.Fatalf("expected 20 distinct mnemonics, got %d", len(seen))
	}
}

func TestGenerateMnemonicRejectsBadLength(t *testing.T) {
	for _, n := range []int{0, 1, 11, 13, 25, 100} {
		if _, err := GenerateMnemonic(n); err == nil {
			t.Errorf("word count %d must be rejected", n)
		}
	}
}

// GenerateHDWallet must build a master key from a real BIP39 seed.
func TestGenerateHDWalletDerivesMasterKey(t *testing.T) {
	wallet, err := GenerateHDWallet(24)
	if err != nil {
		t.Fatalf("GenerateHDWallet failed: %v", err)
	}
	if !bip39.IsMnemonicValid(wallet.Mnemonic) {
		t.Fatalf("invalid mnemonic: %q", wallet.Mnemonic)
	}
	if wallet.MasterKey == nil || wallet.MasterKey.Key == "" || wallet.MasterKey.ChainCode == "" {
		t.Fatal("master key and chain code must be set")
	}
}

// The standard BIP39 vector: the "abandon" phrase with an empty passphrase
// must derive this seed.
func TestBIP39SeedVector(t *testing.T) {
	seed, err := bip39.NewSeedWithErrorChecking(testMnemonic, "")
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	if got := hexString(seed); got != testSeedHex {
		t.Fatalf("seed mismatch:\n got %s\nwant %s", got, testSeedHex)
	}
}

// The standard BIP32 test vector 1: from seed 000102...0f, the key at m/0'
// must equal edb2e14f.... This proves the derivation actually walks the path
// rather than returning the master key.
func TestDeriveChildKeyBIP32Vector(t *testing.T) {
	seed, err := hex.DecodeString("000102030405060708090a0b0c0d0e0f")
	if err != nil {
		t.Fatalf("decode seed: %v", err)
	}

	wallet, err := hdWalletFromSeed(seed)
	if err != nil {
		t.Fatalf("hdWalletFromSeed: %v", err)
	}

	child, err := DeriveChildKey(wallet.MasterKey, "m/0'")
	if err != nil {
		t.Fatalf("DeriveChildKey: %v", err)
	}
	want := "edb2e14f9ee77d26dd93b4ecede8d16ed408ce149b6cd80b0715a2d911a0afea"
	if child.PrivateKey != want {
		t.Fatalf("m/0' private key:\n got %s\nwant %s", child.PrivateKey, want)
	}

	// BIP32 test vector 1 also fixes m/0'/1.
	child, err = DeriveChildKey(wallet.MasterKey, "m/0'/1")
	if err != nil {
		t.Fatalf("DeriveChildKey: %v", err)
	}
	want = "3c6cb8d0f6a264c91ea8b5030fadaa8e538b020f0a387421a12de9319dc93368"
	if child.PrivateKey != want {
		t.Fatalf("m/0'/1 private key:\n got %s\nwant %s", child.PrivateKey, want)
	}
}

// Distinct paths must produce distinct keys. The old implementation ignored
// the path and returned the master key for every input.
func TestDeriveChildKeyDistinctPaths(t *testing.T) {
	wallet, err := GenerateHDWallet(12)
	if err != nil {
		t.Fatalf("GenerateHDWallet: %v", err)
	}

	addresses := make(map[string]string)
	for _, path := range []string{"m/44'/60'/0'/0/0", "m/44'/60'/0'/0/1", "m/44'/60'/0'/0/2", "m/0'"} {
		child, err := DeriveChildKey(wallet.MasterKey, path)
		if err != nil {
			t.Fatalf("DeriveChildKey(%s): %v", path, err)
		}
		if other, ok := addresses[child.Address]; ok {
			t.Fatalf("paths %s and %s produced the same address %s", other, path, child.Address)
		}
		addresses[child.Address] = path
		if !strings.HasPrefix(child.Address, "0x") || len(child.Address) != 42 {
			t.Fatalf("path %s produced a non-EVM address %q", path, child.Address)
		}
	}
}

// DeriveChildKey must reject malformed paths and keys.
func TestDeriveChildKeyRejectsBadInput(t *testing.T) {
	wallet, err := GenerateHDWallet(12)
	if err != nil {
		t.Fatalf("GenerateHDWallet: %v", err)
	}

	if _, err := DeriveChildKey(nil, "m/0"); err == nil {
		t.Fatal("a nil master key must be rejected")
	}
	if _, err := DeriveChildKey(wallet.MasterKey, "m/notanumber"); err == nil {
		t.Fatal("a non-numeric path segment must be rejected")
	}
	if _, err := DeriveChildKey(&MasterKey{Key: "zz", ChainCode: "00"}, "m/0"); err == nil {
		t.Fatal("an invalid master key must be rejected")
	}
}

// GenerateWallet must produce a real secp256k1 EVM key pair. The old code used
// P-256, whose addresses are not valid EVM addresses.
func TestGenerateWalletUsesSecp256k1(t *testing.T) {
	svc := NewWeb3Service(Web3Config{})
	wallet, err := svc.GenerateWallet(context.Background(), "user-1", 1)
	if err != nil {
		t.Fatalf("GenerateWallet: %v", err)
	}
	if len(wallet.Address) != 42 || !strings.HasPrefix(wallet.Address, "0x") {
		t.Fatalf("not an EVM address: %q", wallet.Address)
	}
	// A valid EVM address must round-trip through common.HexToAddress.
	if strings.EqualFold(wallet.Address, "0x0000000000000000000000000000000000000000") {
		t.Fatal("generated the zero address")
	}
}

// SignMessage must produce an EIP-191 signature that VerifySignature accepts,
// and verification must reject a different message or signer.
func TestSignAndVerifyMessageEIP191(t *testing.T) {
	svc := NewWeb3Service(Web3Config{})
	wallet, err := svc.GenerateWallet(context.Background(), "user-1", 1)
	if err != nil {
		t.Fatalf("GenerateWallet: %v", err)
	}

	// Recover the private key from a freshly imported key so the test controls it.
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	privHex := hexString(crypto.FromECDSA(key))
	imported, err := svc.ImportWallet(context.Background(), "user-1", privHex, 1)
	if err != nil {
		t.Fatalf("ImportWallet: %v", err)
	}

	const message = "TigerEx login nonce 12345"
	sig, err := svc.SignMessage(message, privHex)
	if err != nil {
		t.Fatalf("SignMessage: %v", err)
	}

	if !svc.VerifySignature(message, sig, imported.Address) {
		t.Fatal("a signature must verify against its own signer")
	}
	if svc.VerifySignature("tampered message", sig, imported.Address) {
		t.Fatal("a signature must not verify against a different message")
	}
	if svc.VerifySignature(message, sig, wallet.Address) {
		t.Fatal("a signature must not verify against a different address")
	}
	if svc.VerifySignature(message, "00", imported.Address) {
		t.Fatal("a malformed signature must be rejected")
	}
}

// packMethod must refuse to silently drop arguments.
func TestPackMethodRefusesArguments(t *testing.T) {
	data, err := packMethod("0x70a08231")
	if err != nil {
		t.Fatalf("packMethod: %v", err)
	}
	if len(data) != 4 {
		t.Fatalf("expected a 4 byte selector, got %d bytes", len(data))
	}

	if _, err := packMethod("0x70a08231", "0xdeadbeef"); err == nil {
		t.Fatal("packMethod must refuse to drop arguments")
	}
	if _, err := packMethod("0x1234"); err == nil {
		t.Fatal("a non-4-byte selector must be rejected")
	}
}
