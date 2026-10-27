package wallet

// BIP39 mnemonic handling and BIP32/SLIP-0010 key derivation.
//
// The previous derivation was `sha256(seed + path)`, which is not a key
// derivation function. Two things followed from that. The mnemonic's checksum
// was never verified, so a mistyped phrase silently produced a different
// wallet. And the phrase was treated as a passphrase rather than being
// stretched with PBKDF2, so a derived private key could be traced back to the
// mnemonic by brute force over the small space of plausible phrases. Addresses
// from that scheme also match no standard wallet, so a user could not recover
// funds with Ledger, Trezor, or MetaMask.
//
// This file implements the standards the industry uses:
//
//   - BIP39: mnemonic to entropy, checksum validation, PBKDF2-HMAC-SHA512
//     (2048 rounds, salt "mnemonic" + passphrase) to a 64-byte seed.
//   - BIP32: master key from the seed, hardened and non-hardened derivation,
//     CKDpriv with HMAC-SHA512.
//   - SLIP-0010: the ed25519 variant used by Solana, which forbids
//     non-hardened derivation.
//   - Cosmos bech32 addresses with the ripemd160(sha256(compressed pubkey))
//     payload, and TON's own HMAC/PBKDF2 derivation and v4r2 address.

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/bech32"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/crypto/pbkdf2"
	"golang.org/x/crypto/ripemd160"
)

// bip39EnglishWords is the official BIP39 English wordlist (2048 words).
var bip39EnglishWords = strings.Fields(bip39EnglishWordList)

var bip39WordIndex = func() map[string]int {
	m := make(map[string]int, len(bip39EnglishWords))
	for i, w := range bip39EnglishWords {
		m[w] = i
	}
	return m
}()

// Errors returned by the mnemonic helpers.
var (
	ErrInvalidMnemonic   = errors.New("invalid BIP39 mnemonic")
	ErrInvalidDerivePath = errors.New("invalid derivation path")
)

// secp256k1N is the order of the secp256k1 curve.
var secp256k1N, _ = new(big.Int).SetString(
	"fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16)

// entropySizeForWords returns the entropy length in bytes for a valid word
// count. BIP39 allows 12, 15, 18, 21, and 24 words.
func entropySizeForWords(words int) (int, error) {
	switch words {
	case 12:
		return 16, nil
	case 15:
		return 20, nil
	case 18:
		return 24, nil
	case 21:
		return 28, nil
	case 24:
		return 32, nil
	default:
		return 0, fmt.Errorf("%w: %d words", ErrInvalidMnemonic, words)
	}
}

// NormalizeMnemonic collapses whitespace and lowercases, which is the
// normalisation BIP39 expects for ASCII mnemonics.
func NormalizeMnemonic(mnemonic string) string {
	return strings.ToLower(strings.Join(strings.Fields(mnemonic), " "))
}

// MnemonicToSeed converts a validated mnemonic and optional passphrase into the
// 64-byte BIP39 seed using PBKDF2-HMAC-SHA512 with 2048 iterations.
func MnemonicToSeed(mnemonic, passphrase string) ([]byte, error) {
	if _, err := MnemonicToEntropy(mnemonic); err != nil {
		return nil, err
	}
	normalized := NormalizeMnemonic(mnemonic)
	salt := "mnemonic" + passphrase
	return pbkdf2.Key([]byte(normalized), []byte(salt), 2048, 64, sha512.New), nil
}

// MnemonicToEntropy decodes a mnemonic back to its entropy, verifying the
// checksum. This is what catches a mistyped or reordered word.
func MnemonicToEntropy(mnemonic string) ([]byte, error) {
	words := strings.Fields(NormalizeMnemonic(mnemonic))
	entropyBytes, err := entropySizeForWords(len(words))
	if err != nil {
		return nil, err
	}

	totalBits := len(words) * 11
	checksumBits := totalBits - entropyBytes*8

	// Collect every bit, including the trailing partial byte, so the checksum
	// bits are not lost.
	bits := make([]byte, 0, totalBits)
	for _, w := range words {
		idx, ok := bip39WordIndex[w]
		if !ok {
			return nil, fmt.Errorf("%w: unknown word %q", ErrInvalidMnemonic, w)
		}
		for shift := 10; shift >= 0; shift-- {
			bits = append(bits, byte(idx>>uint(shift))&1)
		}
	}

	entropy := make([]byte, entropyBytes)
	for i := 0; i < entropyBytes*8; i++ {
		entropy[i/8] |= bits[i] << uint(7-i%8)
	}

	var checksum byte
	for i := 0; i < checksumBits; i++ {
		checksum |= bits[entropyBytes*8+i] << uint(checksumBits-1-i)
	}

	expected := sha256.Sum256(entropy)
	expectedChecksum := expected[0] >> uint(8-checksumBits)
	if checksum != expectedChecksum {
		return nil, fmt.Errorf("%w: checksum mismatch", ErrInvalidMnemonic)
	}

	return entropy, nil
}

// EntropyToMnemonic encodes entropy as a mnemonic. The entropy length must be
// 16, 20, 24, 28, or 32 bytes.
func EntropyToMnemonic(entropy []byte) (string, error) {
	switch len(entropy) {
	case 16, 20, 24, 28, 32:
	default:
		return "", fmt.Errorf("%w: %d bytes of entropy", ErrInvalidMnemonic, len(entropy))
	}

	checksumLen := len(entropy) * 8 / 32
	hash := sha256.Sum256(entropy)

	bits := make([]byte, 0, len(entropy)*8+checksumLen)
	for _, b := range entropy {
		for i := 7; i >= 0; i-- {
			bits = append(bits, (b>>uint(i))&1)
		}
	}
	for i := 0; i < checksumLen; i++ {
		bits = append(bits, (hash[0]>>uint(7-i))&1)
	}

	words := make([]string, 0, len(bits)/11)
	for i := 0; i+11 <= len(bits); i += 11 {
		idx := 0
		for j := 0; j < 11; j++ {
			idx = idx<<1 | int(bits[i+j])
		}
		words = append(words, bip39EnglishWords[idx])
	}
	return strings.Join(words, " "), nil
}

// GenerateMnemonic creates a new 24-word mnemonic from the system CSPRNG.
func GenerateMnemonic() (string, error) {
	entropy := make([]byte, 32)
	if _, err := rand.Read(entropy); err != nil {
		return "", err
	}
	return EntropyToMnemonic(entropy)
}

// ValidateMnemonic reports whether a mnemonic is well formed with a correct
// checksum.
func ValidateMnemonic(mnemonic string) error {
	_, err := MnemonicToEntropy(mnemonic)
	return err
}

// derivePathComponent parses one component of a derivation path. A trailing
// apostrophe or the letter h marks a hardened index.
func derivePathComponent(part string) (uint32, bool, error) {
	hardened := false
	switch {
	case strings.HasSuffix(part, "'"):
		hardened = true
		part = strings.TrimSuffix(part, "'")
	case strings.HasSuffix(part, "h"), strings.HasSuffix(part, "H"):
		hardened = true
		part = part[:len(part)-1]
	}
	if part == "" {
		return 0, false, fmt.Errorf("%w: empty component", ErrInvalidDerivePath)
	}
	n, err := strconv.ParseUint(part, 10, 31)
	if err != nil {
		return 0, false, fmt.Errorf("%w: %q", ErrInvalidDerivePath, part)
	}
	return uint32(n), hardened, nil
}

// ParseDerivationPath parses a path such as "m/44'/60'/0'/0/0".
func ParseDerivationPath(path string) ([]uint32, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("%w: empty path", ErrInvalidDerivePath)
	}
	parts := strings.Split(path, "/")
	if parts[0] == "m" || parts[0] == "M" {
		parts = parts[1:]
	}
	// "m" on its own is the master key: a valid path with no components.
	if len(parts) == 0 {
		return nil, nil
	}
	if len(parts) > 16 {
		return nil, fmt.Errorf("%w: too deep", ErrInvalidDerivePath)
	}

	out := make([]uint32, 0, len(parts))
	for _, p := range parts {
		index, hardened, err := derivePathComponent(p)
		if err != nil {
			return nil, err
		}
		if hardened {
			index |= 0x80000000
		}
		out = append(out, index)
	}
	return out, nil
}

// DeriveBIP32PrivateKey derives a secp256k1 private key from a mnemonic at the
// given BIP32 path.
func DeriveBIP32PrivateKey(mnemonic, passphrase, path string) (*btcec.PrivateKey, error) {
	seed, err := MnemonicToSeed(mnemonic, passphrase)
	if err != nil {
		return nil, err
	}
	return DeriveBIP32FromSeed(seed, path)
}

// DeriveBIP32FromSeed derives a secp256k1 private key from a raw BIP32 seed.
// It is separate from DeriveBIP32PrivateKey so the implementation can be
// checked against the official BIP32 test vectors, which are specified as
// seeds rather than mnemonics.
func DeriveBIP32FromSeed(seed []byte, path string) (*btcec.PrivateKey, error) {
	indices, err := ParseDerivationPath(path)
	if err != nil {
		return nil, err
	}

	// BIP32 master key: HMAC-SHA512(key="Bitcoin seed", msg=seed).
	mac := hmac.New(sha512.New, []byte("Bitcoin seed"))
	mac.Write(seed)
	sum := mac.Sum(nil)
	key := make([]byte, 32)
	chain := make([]byte, 32)
	copy(key, sum[:32])
	copy(chain, sum[32:])

	for _, index := range indices {
		key, chain, err = ckdPriv(key, chain, index)
		if err != nil {
			return nil, err
		}
	}

	priv, _ := btcec.PrivKeyFromBytes(key)
	return priv, nil
}

// ckdPriv performs one BIP32 CKDpriv step. A hardened child hashes the parent
// private key; a normal child hashes the compressed parent public key.
func ckdPriv(parentKey, parentChain []byte, index uint32) ([]byte, []byte, error) {
	priv, _ := btcec.PrivKeyFromBytes(parentKey)

	data := make([]byte, 0, 37)
	if index >= 0x80000000 {
		data = append(data, 0x00)
		data = append(data, parentKey...)
	} else {
		data = append(data, priv.PubKey().SerializeCompressed()...)
	}
	var idxBytes [4]byte
	binary.BigEndian.PutUint32(idxBytes[:], index)
	data = append(data, idxBytes[:]...)

	mac := hmac.New(sha512.New, parentChain)
	mac.Write(data)
	sum := mac.Sum(nil)
	il, ir := sum[:32], sum[32:]

	// child = (IL + kpar) mod n. Reject the two negligible-probability cases
	// BIP32 specifies: IL >= n, or the resulting key is zero.
	ilInt := new(big.Int).SetBytes(il)
	if ilInt.Cmp(secp256k1N) >= 0 {
		return nil, nil, errors.New("BIP32 derivation produced an out-of-range key")
	}
	keyInt := new(big.Int).SetBytes(parentKey)
	sumInt := new(big.Int).Add(ilInt, keyInt)
	sumInt.Mod(sumInt, secp256k1N)
	if sumInt.Sign() == 0 {
		return nil, nil, errors.New("BIP32 derivation produced a zero child key")
	}

	child := make([]byte, 32)
	b := sumInt.Bytes()
	copy(child[32-len(b):], b)
	return child, ir, nil
}

// DeriveSlip10Ed25519 derives a 32-byte ed25519 seed from a mnemonic using
// SLIP-0010. Every component of an ed25519 path must be hardened, which is why
// the Solana path is m/44'/501'/0'/0'.
func DeriveSlip10Ed25519(mnemonic, passphrase, path string) ([]byte, error) {
	seed, err := MnemonicToSeed(mnemonic, passphrase)
	if err != nil {
		return nil, err
	}
	return DeriveSlip10FromSeed(seed, path)
}

// DeriveSlip10FromSeed derives an ed25519 seed from a raw BIP32 seed. It is
// separate from DeriveSlip10Ed25519 so the implementation can be checked
// against the official SLIP-0010 test vectors.
func DeriveSlip10FromSeed(seed []byte, path string) ([]byte, error) {
	indices, err := ParseDerivationPath(path)
	if err != nil {
		return nil, err
	}

	// SLIP-0010 master key: HMAC-SHA512(key="ed25519 seed", msg=seed).
	mac := hmac.New(sha512.New, []byte("ed25519 seed"))
	mac.Write(seed)
	sum := mac.Sum(nil)
	key := make([]byte, 32)
	chain := make([]byte, 32)
	copy(key, sum[:32])
	copy(chain, sum[32:])

	for _, index := range indices {
		if index < 0x80000000 {
			return nil, fmt.Errorf("%w: SLIP-0010 requires hardened components", ErrInvalidDerivePath)
		}
		data := make([]byte, 0, 37)
		data = append(data, 0x00)
		data = append(data, key...)
		var idxBytes [4]byte
		binary.BigEndian.PutUint32(idxBytes[:], index)
		data = append(data, idxBytes[:]...)

		mac := hmac.New(sha512.New, chain)
		mac.Write(data)
		child := mac.Sum(nil)
		key = make([]byte, 32)
		chain = make([]byte, 32)
		copy(key, child[:32])
		copy(chain, child[32:])
	}

	out := make([]byte, 32)
	copy(out, key)
	return out, nil
}

// evmAddressFromPrivateKey returns the EIP-55 checksummed address for a
// secp256k1 key.
func evmAddressFromPrivateKey(priv *btcec.PrivateKey) string {
	return evmAddressFromUncompressed(priv.PubKey().SerializeUncompressed())
}

// evmAddressFromUncompressed computes the EIP-55 checksummed address from a
// 65-byte uncompressed public key.
func evmAddressFromUncompressed(pub []byte) string {
	hash := crypto.Keccak256(pub[1:])
	return common.BytesToAddress(hash[12:]).Hex()
}

// bitcoinP2PKHAddress returns the legacy base58check address for a secp256k1
// key.
func bitcoinP2PKHAddress(priv *btcec.PrivateKey) (string, error) {
	compressed := priv.PubKey().SerializeCompressed()
	addr, err := btcutil.NewAddressPubKeyHash(btcutil.Hash160(compressed), &chaincfg.MainNetParams)
	if err != nil {
		return "", err
	}
	return addr.EncodeAddress(), nil
}

// cosmosAddress returns a bech32 address with the given human-readable prefix,
// using the ripemd160(sha256(compressed pubkey)) payload Cosmos chains use.
func cosmosAddress(priv *btcec.PrivateKey, hrp string) (string, error) {
	compressed := priv.PubKey().SerializeCompressed()
	sha := sha256.Sum256(compressed)
	ripemd := ripemd160.New()
	ripemd.Write(sha[:])
	payload := ripemd.Sum(nil)

	converted, err := bech32.ConvertBits(payload, 8, 5, true)
	if err != nil {
		return "", err
	}
	return bech32.Encode(hrp, converted)
}

// tonPrivateKeyFromMnemonic implements TON's own derivation, which is not BIP39
// seed expansion: HMAC-SHA512(key=phrase, msg="") then
// PBKDF2-HMAC-SHA512(entropy, "TON default seed", 100000, 64). The first 32
// bytes are the ed25519 seed.
func tonPrivateKeyFromMnemonic(mnemonic string) ([]byte, error) {
	mac := hmac.New(sha512.New, []byte(NormalizeMnemonic(mnemonic)))
	mac.Write([]byte{})
	entropy := mac.Sum(nil)

	derived := pbkdf2.Key(entropy, []byte("TON default seed"), 100000, 64, sha512.New)
	out := make([]byte, 32)
	copy(out, derived[:32])
	return out, nil
}

// tonPublicKey derives the 32-byte ed25519 public key for a 32-byte TON seed.
func tonPublicKey(seed []byte) []byte {
	priv := ed25519.NewKeyFromSeed(seed)
	pub := priv.Public().(ed25519.PublicKey)
	out := make([]byte, 32)
	copy(out, pub)
	return out
}

// TON wallet v4r2 code cell hash, from the reference contract.
var tonV4R2CodeHash = mustHex("feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0")

// tonDefaultWalletID is the default subwallet id for wallet v4r2.
const tonDefaultWalletID = uint32(698983191)

// tonCellRef is a reference from one TON cell to another.
type tonCellRef struct {
	hash  []byte
	depth uint16
}

// tonV4R2Address builds the base64 "friendly" address of a wallet v4r2 contract
// owned by publicKey: the hash of the StateInit cell, workchain 0, mainnet.
func tonV4R2Address(publicKey []byte) (string, error) {
	if len(publicKey) != 32 {
		return "", errors.New("TON public key must be 32 bytes")
	}

	data := make([]byte, 0, 41)
	var seqno [4]byte
	data = append(data, seqno[:]...)
	var walletID [4]byte
	binary.BigEndian.PutUint32(walletID[:], tonDefaultWalletID)
	data = append(data, walletID[:]...)
	data = append(data, publicKey...)
	data = append(data, 0) // plugins: empty Maybe

	dataHash := tonCellHash(data, 321, nil)

	// split_depth(0) tick_tock(0) code:Maybe(1) data:Maybe(1) library:Maybe(0)
	stateInit := []byte{0b0011_0000}
	stateInitHash := tonCellHash(stateInit, 5, []tonCellRef{
		{hash: tonV4R2CodeHash, depth: 0},
		{hash: dataHash, depth: 0},
	})

	return tonFriendlyAddress(0, stateInitHash)
}

// tonCellHash computes sha256(d1 || d2 || data || ref_depths || ref_hashes).
// d1 encodes the reference count and d2 the bit length; the data is padded with
// a single set bit after the last used bit, as the TVM representation requires.
func tonCellHash(data []byte, bitLen int, refs []tonCellRef) []byte {
	byteLen := (bitLen + 7) / 8
	buffer := make([]byte, 0, 2+byteLen+len(refs)*34)
	buffer = append(buffer, byte(len(refs)))
	buffer = append(buffer, byte(bitLen/8+byteLen))

	payload := make([]byte, byteLen)
	copy(payload, data)
	if remainder := bitLen % 8; remainder != 0 {
		payload[byteLen-1] |= 1 << uint(8-remainder-1)
	}
	buffer = append(buffer, payload...)

	for _, r := range refs {
		var d [2]byte
		binary.BigEndian.PutUint16(d[:], r.depth)
		buffer = append(buffer, d[:]...)
	}
	for _, r := range refs {
		buffer = append(buffer, r.hash...)
	}

	sum := sha256.Sum256(buffer)
	return sum[:]
}

// tonFriendlyAddress encodes a workchain and 32-byte hash as a base64 address
// with the TON CRC-16/XMODEM checksum.
func tonFriendlyAddress(workchain int8, hash []byte) (string, error) {
	if len(hash) != 32 {
		return "", errors.New("TON account hash must be 32 bytes")
	}
	buffer := make([]byte, 0, 36)
	buffer = append(buffer, 0x11) // mainnet, bounceable
	buffer = append(buffer, byte(workchain))
	buffer = append(buffer, hash...)
	checksum := crc16XMODEM(buffer)
	var c [2]byte
	binary.BigEndian.PutUint16(c[:], checksum)
	buffer = append(buffer, c[:]...)
	return base64.StdEncoding.EncodeToString(buffer), nil
}

// crc16XMODEM is the checksum TON uses for friendly addresses.
func crc16XMODEM(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

func mustHex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic("invalid hex constant: " + s)
	}
	return b
}

// sha256Sum is a small helper used by tests.
func sha256Sum(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:]
}
