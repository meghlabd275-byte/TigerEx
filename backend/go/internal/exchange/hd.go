package exchange

import (
	"fmt"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/ethereum/go-ethereum/crypto"

	// services/wallet owns the audited BIP-39/BIP-32/SLIP-0010 derivation. It is
	// a leaf package (it imports no other tigerex package), so reusing its key
	// derivation here introduces no import cycle and no second implementation.
	walletderive "tigerex/backend/services/wallet"
)

// networkScheme describes how a network derives addresses.
type networkScheme struct {
	// kind is "evm" or "btc".
	kind     string
	coinType uint32
}

// networkSchemes maps a network name to its derivation scheme. An unknown
// network is refused rather than guessed.
var networkSchemes = map[string]networkScheme{
	"ethereum":  {"evm", 60},
	"erc20":     {"evm", 60},
	"eth":       {"evm", 60},
	"bsc":       {"evm", 60},
	"bep20":     {"evm", 60},
	"polygon":   {"evm", 60},
	"arbitrum":  {"evm", 60},
	"optimism":  {"evm", 60},
	"base":      {"evm", 60},
	"avalanche": {"evm", 60},
	"bitcoin":   {"btc", 0},
	"btc":       {"btc", 0},
}

// HDDeriver derives deposit addresses from a BIP-39 mnemonic. Private keys are
// computed on demand and never persisted: only the derived public address is
// stored, so a database leak cannot move funds.
type HDDeriver struct {
	mnemonic   string
	passphrase string
}

// NewHDDeriver builds a deriver. An empty mnemonic yields a nil deriver, which
// makes every address request fail closed.
func NewHDDeriver(mnemonic, passphrase string) *HDDeriver {
	if strings.TrimSpace(mnemonic) == "" {
		return nil
	}
	return &HDDeriver{mnemonic: mnemonic, passphrase: passphrase}
}

// WithHD attaches an HD deriver to the store.
func (s *Store) WithHD(d *HDDeriver) *Store {
	s.hd = d
	return s
}

// deriveAddress derives the address for an asset/network at a BIP-44 index.
func (d *HDDeriver) deriveAddress(network string, index uint32) (string, error) {
	if d == nil {
		return "", fmt.Errorf("%w: HD wallet mnemonic is not configured", ErrUnavailable)
	}
	scheme, ok := networkSchemes[strings.ToLower(strings.TrimSpace(network))]
	if !ok {
		return "", fmt.Errorf("%w: unsupported network %q", ErrInvalidInput, network)
	}
	path := fmt.Sprintf("m/44'/%d'/0'/0/%d", scheme.coinType, index)
	priv, err := walletderive.DeriveBIP32PrivateKey(d.mnemonic, d.passphrase, path)
	if err != nil {
		return "", fmt.Errorf("derive key: %w", err)
	}

	switch scheme.kind {
	case "evm":
		ecdsaKey, err := crypto.ToECDSA(priv.Serialize())
		if err != nil {
			return "", fmt.Errorf("derive evm key: %w", err)
		}
		return crypto.PubkeyToAddress(ecdsaKey.PublicKey).Hex(), nil
	case "btc":
		return bitcoinP2PKH(priv)
	default:
		return "", fmt.Errorf("%w: unsupported scheme %q", ErrInvalidInput, scheme.kind)
	}
}

// bitcoinP2PKH builds a mainnet P2PKH address from a secp256k1 private key.
func bitcoinP2PKH(priv *btcec.PrivateKey) (string, error) {
	pubKey := priv.PubKey()
	hash := btcutil.Hash160(pubKey.SerializeCompressed())
	addr, err := btcutil.NewAddressPubKeyHash(hash, &chaincfg.MainNetParams)
	if err != nil {
		return "", err
	}
	return addr.EncodeAddress(), nil
}
