package wallet

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
)

// The vectors in this file are the published ones from BIP39, BIP32, and
// SLIP-0010. They are the only way to know that a derivation is interoperable
// with Ledger, Trezor, MetaMask, and Phantom rather than merely self-consistent.

// TestBIP39MnemonicToSeedOfficialVector uses the first BIP39 test vector: the
// 12-word all-zero-entropy mnemonic and the empty passphrase.
func TestBIP39MnemonicToSeedOfficialVector(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	want := "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4"

	seed, err := MnemonicToSeed(mnemonic, "")
	if err != nil {
		t.Fatalf("MnemonicToSeed: %v", err)
	}
	if got := hex.EncodeToString(seed); got != want {
		t.Fatalf("seed mismatch:\n got %s\nwant %s", got, want)
	}
}

// TestBIP39MnemonicToSeedWithPassphrase covers the "TREZOR" passphrase vector.
func TestBIP39MnemonicToSeedWithPassphrase(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	want := "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"

	seed, err := MnemonicToSeed(mnemonic, "TREZOR")
	if err != nil {
		t.Fatalf("MnemonicToSeed: %v", err)
	}
	if got := hex.EncodeToString(seed); got != want {
		t.Fatalf("seed mismatch:\n got %s\nwant %s", got, want)
	}

	// The passphrase must change the seed relative to the empty passphrase.
	empty, err := MnemonicToSeed(mnemonic, "")
	if err != nil {
		t.Fatalf("MnemonicToSeed: %v", err)
	}
	if hex.EncodeToString(empty) == want {
		t.Fatal("passphrase did not change the seed")
	}
}

// TestMnemonicEntropyRoundTrip checks the entropy encoding and the checksum.
func TestMnemonicEntropyRoundTrip(t *testing.T) {
	// All-zero 16-byte entropy is the vector behind the "abandon ... about"
	// mnemonic.
	entropy := make([]byte, 16)
	mnemonic, err := EntropyToMnemonic(entropy)
	if err != nil {
		t.Fatalf("EntropyToMnemonic: %v", err)
	}
	want := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	if mnemonic != want {
		t.Fatalf("mnemonic mismatch:\n got %s\nwant %s", mnemonic, want)
	}

	back, err := MnemonicToEntropy(mnemonic)
	if err != nil {
		t.Fatalf("MnemonicToEntropy: %v", err)
	}
	if hex.EncodeToString(back) != hex.EncodeToString(entropy) {
		t.Fatalf("entropy round trip failed: %x", back)
	}
}

// TestMnemonicChecksumRejectsBadPhrase ensures a mistyped word is caught.
func TestMnemonicChecksumRejectsBadPhrase(t *testing.T) {
	// Swap the last word for one with a different index; the checksum must fail.
	bad := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
	if err := ValidateMnemonic(bad); err == nil {
		t.Fatal("mnemonic with a bad checksum was accepted")
	}

	// An unknown word is rejected outright.
	if err := ValidateMnemonic("abandon abandon notaword abandon abandon abandon abandon abandon abandon abandon abandon about"); err == nil {
		t.Fatal("mnemonic with an unknown word was accepted")
	}

	// A wrong word count is rejected.
	if err := ValidateMnemonic("abandon abandon abandon"); err == nil {
		t.Fatal("3-word mnemonic was accepted")
	}
}

// TestGenerateMnemonicIsValidAndUnique checks the generator.
func TestGenerateMnemonicIsValidAndUnique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 32; i++ {
		m, err := GenerateMnemonic()
		if err != nil {
			t.Fatalf("GenerateMnemonic: %v", err)
		}
		if err := ValidateMnemonic(m); err != nil {
			t.Fatalf("generated mnemonic does not validate: %v", err)
		}
		if len(strings.Fields(m)) != 24 {
			t.Fatalf("want 24 words, got %d", len(strings.Fields(m)))
		}
		if seen[m] {
			t.Fatal("GenerateMnemonic repeated a phrase")
		}
		seen[m] = true
	}
}

// TestBIP32OfficialVector1 is BIP32 test vector 1: seed 000102030405060708090a0b0c0d0e0f.
func TestBIP32OfficialVector1(t *testing.T) {
	seed, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f")

	cases := []struct{ path, want string }{
		{"m", "e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35"},
		{"m/0'", "edb2e14f9ee77d26dd93b4ecede8d16ed408ce149b6cd80b0715a2d911a0afea"},
		{"m/0'/1", "3c6cb8d0f6a264c91ea8b5030fadaa8e538b020f0a387421a12de9319dc93368"},
		{"m/0'/1/2'", "cbce0d719ecf7431d88e6a89fa1483e02e35092af60c042b1df2ff59fa424dca"},
		{"m/0'/1/2'/2", "0f479245fb19a38a1954c5c7c0ebab2f9bdfd96a17563ef28a6a4b1a2a764ef4"},
		{"m/0'/1/2'/2/1000000000", "471b76e389e528d6de6d816857e012c5455051cad6660850e58372a6c3e6e7c8"},
	}

	for _, tc := range cases {
		priv, err := DeriveBIP32FromSeed(seed, tc.path)
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		if got := hex.EncodeToString(priv.Serialize()); got != tc.want {
			t.Fatalf("%s: got %s, want %s", tc.path, got, tc.want)
		}
	}
}

// TestBIP32OfficialVector2 is BIP32 test vector 2, which exercises a different
// seed length.
func TestBIP32OfficialVector2(t *testing.T) {
	seed, _ := hex.DecodeString("fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542")

	cases := []struct{ path, want string }{
		{"m", "4b03d6fc340455b363f51020ad3ecca4f0850280cf436c70c727923f6db46c3e"},
		{"m/0", "abe74a98f6c7eabee0428f53798f0ab8aa1bd37873999041703c742f15ac7e1e"},
		{"m/0/2147483647'", "877c779ad9687164e9c2f4f0f4ff0340814392330693ce95a58fe18fd52e6e93"},
	}

	for _, tc := range cases {
		priv, err := DeriveBIP32FromSeed(seed, tc.path)
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		if got := hex.EncodeToString(priv.Serialize()); got != tc.want {
			t.Fatalf("%s: got %s, want %s", tc.path, got, tc.want)
		}
	}
}

// TestBIP32KnownEVMVector checks the standard m/44'/60'/0'/0/0 account for the
// well-known "test test test ... junk" mnemonic used across wallet test suites.
func TestBIP32KnownEVMVector(t *testing.T) {
	// The widely used Hardhat/ethers test mnemonic.
	mnemonic := "test test test test test test test test test test test junk"
	priv, err := DeriveBIP32PrivateKey(mnemonic, "", "m/44'/60'/0'/0/0")
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	want := "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
	if got := hex.EncodeToString(priv.Serialize()); got != want {
		t.Fatalf("private key: got %s, want %s", got, want)
	}

	if got := evmAddressFromPrivateKey(priv); got != "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" {
		t.Fatalf("EVM address: got %s", got)
	}
}

// TestSlip10OfficialVector1 is SLIP-0010 test vector 1 for ed25519, seed
// 000102030405060708090a0b0c0d0e0f.
func TestSlip10OfficialVector1(t *testing.T) {
	seed, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f")

	cases := []struct{ path, want string }{
		{"m", "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"},
		{"m/0'", "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3"},
		{"m/0'/1'", "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2"},
	}

	for _, tc := range cases {
		raw, err := DeriveSlip10FromSeed(seed, tc.path)
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		if got := hex.EncodeToString(raw); got != tc.want {
			t.Fatalf("%s: got %s, want %s", tc.path, got, tc.want)
		}
	}
}

// TestSlip10RejectsNonHardened checks the ed25519 constraint.
func TestSlip10RejectsNonHardened(t *testing.T) {
	seed, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f")
	if _, err := DeriveSlip10FromSeed(seed, "m/0"); err == nil {
		t.Fatal("SLIP-0010 accepted a non-hardened component")
	}
}

// TestCosmosAddressFormat checks the bech32 prefix and payload length.
func TestCosmosAddressFormat(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	priv, err := DeriveBIP32PrivateKey(mnemonic, "", "m/44'/118'/0'/0/0")
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	addr, err := cosmosAddress(priv, "cosmos")
	if err != nil {
		t.Fatalf("cosmosAddress: %v", err)
	}
	if !strings.HasPrefix(addr, "cosmos1") {
		t.Fatalf("address %q lacks the cosmos1 prefix", addr)
	}
	if len(addr) != 45 {
		t.Fatalf("address %q has unexpected length %d", addr, len(addr))
	}
}

// TestBitcoinAddressFormat checks that a P2PKH address is produced.
func TestBitcoinAddressFormat(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	priv, err := DeriveBIP32PrivateKey(mnemonic, "", "m/44'/0'/0'/0/0")
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	addr, err := bitcoinP2PKHAddress(priv)
	if err != nil {
		t.Fatalf("bitcoinP2PKHAddress: %v", err)
	}
	if !strings.HasPrefix(addr, "1") {
		t.Fatalf("address %q does not look like a mainnet P2PKH address", addr)
	}
}

// TestTONAddressFormat checks the v4r2 friendly address shape.
func TestTONAddressFormat(t *testing.T) {
	seed := make([]byte, 32)
	seed[0] = 7
	pub := tonPublicKey(seed)
	addr, err := tonV4R2Address(pub)
	if err != nil {
		t.Fatalf("tonV4R2Address: %v", err)
	}
	// A friendly address is 36 bytes base64 encoded, so 48 characters.
	if len(addr) != 48 {
		t.Fatalf("TON address %q has length %d, want 48", addr, len(addr))
	}
}

// TestDerivationIsDeterministic guards against reintroducing a scheme that
// depends on anything other than the mnemonic and the path.
func TestDerivationIsDeterministic(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	first, err := deriveEVmKeyFromSeed(mnemonic, 0)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	second, err := deriveEVmKeyFromSeed(mnemonic, 0)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if hex.EncodeToString(first.D.Bytes()) != hex.EncodeToString(second.D.Bytes()) {
		t.Fatal("derivation is not deterministic")
	}

	// A different index must give a different key.
	other, err := deriveEVmKeyFromSeed(mnemonic, 1)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if hex.EncodeToString(first.D.Bytes()) == hex.EncodeToString(other.D.Bytes()) {
		t.Fatal("different indices produced the same key")
	}
}

// TestSeedDerivationIsNotPlainHash is the regression test for the old
// `sha256(seed + path)` scheme. Under the real scheme, a mnemonic and the
// concatenation of a different mnemonic and the path cannot collide.
func TestSeedDerivationIsNotPlainHash(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	priv, err := deriveEVmKeyFromSeed(mnemonic, 0)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	// The old scheme fed sha256("abandon ... about" + "m/44'/60'/0'/0/0").
	// That value must not appear as the derived key.
	old := sha256Sum([]byte(mnemonic + "m/44'/60'/0'/0/0"))
	if hex.EncodeToString(priv.D.Bytes()) == hex.EncodeToString(old) {
		t.Fatal("derivation still uses sha256(mnemonic+path)")
	}
}

func TestParseDerivationPath(t *testing.T) {
	idx, err := ParseDerivationPath("m/44'/60'/0'/0/0")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []uint32{44 | 0x80000000, 60 | 0x80000000, 0x80000000, 0, 0}
	if len(idx) != len(want) {
		t.Fatalf("got %d components, want %d", len(idx), len(want))
	}
	for i := range want {
		if idx[i] != want[i] {
			t.Fatalf("component %d: got %d, want %d", i, idx[i], want[i])
		}
	}

	// The h suffix is also hardened.
	if idx, err := ParseDerivationPath("m/44h/60h"); err != nil || idx[0] != 44|0x80000000 {
		t.Fatalf("h suffix not treated as hardened: %v %v", idx, err)
	}

	for _, bad := range []string{"", "m/", "m/x", "m/44'/-1", "m/9999999999999"} {
		if _, err := ParseDerivationPath(bad); err == nil {
			t.Fatalf("path %q was accepted", bad)
		}
	}
}

// TestPrivateKeyDerivesMatchingPublicKey checks the key pair is consistent.
func TestPrivateKeyDerivesMatchingPublicKey(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	priv, err := DeriveBIP32PrivateKey(mnemonic, "", "m/44'/60'/0'/0/0")
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	reparsed, _ := btcec.PrivKeyFromBytes(priv.Serialize())
	if !reparsed.PubKey().IsEqual(priv.PubKey()) {
		t.Fatal("serialised key does not reproduce the public key")
	}
}
