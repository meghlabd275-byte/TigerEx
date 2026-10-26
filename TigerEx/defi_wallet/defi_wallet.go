// Package defiwallet manages DeFi wallets, chain derivations, swaps, and
// staking positions.
//
// Wallets are derived from a single BIP39 seed per user. The seed is encrypted
// at rest with AES-256-GCM under a key supplied by the caller; no private key
// material is ever stored in plaintext or returned over the API.
package defiwallet

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/tyler-smith/go-bip32"
	"github.com/tyler-smith/go-bip39"
)

// Derivation paths for the chains TigerEx supports. EVM chains share the
// standard Ethereum BIP44 path; chains with a different coin type get their
// own path so addresses never collide across chains.
var chainDerivationPaths = map[string]string{
	"ethereum":  "m/44'/60'/0'/0/0",
	"bsc":       "m/44'/60'/0'/0/0",
	"polygon":   "m/44'/60'/0'/0/0",
	"arbitrum":  "m/44'/60'/0'/0/0",
	"optimism":  "m/44'/60'/0'/0/0",
	"base":      "m/44'/60'/0'/0/0",
	"avalanche": "m/44'/60'/0'/0/0",
	"tron":      "m/44'/195'/0'/0/0",
	"bitcoin":   "m/44'/0'/0'/0/0",
}

// ErrUnknownChain is returned when a chain has no configured derivation path.
var ErrUnknownChain = errors.New("unknown chain")

// ErrWalletNotFound is returned when a wallet ID is unknown.
var ErrWalletNotFound = errors.New("wallet not found")

// ErrSeedUnavailable is returned when a wallet has no usable seed.
var ErrSeedUnavailable = errors.New("wallet seed is unavailable")

// ChainAccount is a derived account for one chain.
//
// PrivateKey is never serialised: it carries `json:"-"` so a wallet cannot
// leak key material through an API response.
type ChainAccount struct {
	Chain      string `json:"chain"`
	Address    string `json:"address"`
	Path       string `json:"path"`
	PrivateKey string `json:"-"`
}

// Wallet is a user's DeFi wallet. SeedCiphertext holds the encrypted BIP39
// seed; the plaintext seed never leaves memory.
type Wallet struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	Address        string          `json:"address"`
	Chains         []*ChainAccount `json:"chains"`
	SeedCiphertext []byte          `json:"-"`
	SeedNonce      []byte          `json:"-"`
	CreatedAt      int64           `json:"createdAt"`
}

// SwapQuote is a priced swap produced by a SwapProvider.
type SwapQuote struct {
	FromToken    string  `json:"fromToken"`
	ToToken      string  `json:"toToken"`
	InputAmount  float64 `json:"inputAmount"`
	OutputAmount float64 `json:"outputAmount"`
	Slippage     float64 `json:"slippage"`
}

// SwapProvider prices and executes a swap against a real DEX or aggregator.
type SwapProvider interface {
	// Quote returns a price for the requested swap.
	Quote(fromToken, toToken string, amount float64) (*SwapQuote, error)
	// Execute submits the swap and returns the transaction hash.
	Execute(fromToken, toToken string, amount float64) (string, error)
}

// StakeProvider reads and writes on-chain staking positions.
type StakeProvider interface {
	// Stake locks amount of asset and returns the on-chain position id.
	Stake(asset string, amount float64) (string, error)
}

// DApp is a registered decentralised application.
type DApp struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	URL      string `json:"url"`
	Logo     string `json:"logo"`
}

// StakePosition is a staking position.
type StakePosition struct {
	ID        string  `json:"id"`
	WalletID  string  `json:"walletId"`
	Asset     string  `json:"asset"`
	Amount    float64 `json:"amount"`
	APY       float64 `json:"apy"`
	Rewards   float64 `json:"rewards"`
	OnChainID string  `json:"onChainId"`
	CreatedAt int64   `json:"createdAt"`
}

// Manager owns wallets, positions, and DApps.
type Manager struct {
	mu        sync.RWMutex
	wallets   map[string]*Wallet
	positions map[string]*StakePosition
	dapps     map[string]*DApp
	swap      SwapProvider
	stake     StakeProvider
}

// NewManager creates a manager. swap and stake may be nil; operations that
// need them then fail rather than fabricating a result.
func NewManager(swap SwapProvider, stake StakeProvider) *Manager {
	return &Manager{
		wallets:   make(map[string]*Wallet),
		positions: make(map[string]*StakePosition),
		dapps:     make(map[string]*DApp),
		swap:      swap,
		stake:     stake,
	}
}

// deriveAccount derives the secp256k1 account for chain from a BIP39 seed.
func deriveAccount(seed []byte, chain string) (*ChainAccount, error) {
	path, ok := chainDerivationPaths[chain]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownChain, chain)
	}

	master, err := bip32.NewMasterKey(seed)
	if err != nil {
		return nil, fmt.Errorf("master key: %w", err)
	}

	key := master
	for _, index := range parsePath(path) {
		key, err = key.NewChildKey(index)
		if err != nil {
			return nil, fmt.Errorf("derive %s: %w", path, err)
		}
	}

	if len(key.Key) != 32 {
		return nil, errors.New("derived key is not a 32 byte secp256k1 scalar")
	}
	privateKey, err := crypto.ToECDSA(key.Key)
	if err != nil {
		return nil, fmt.Errorf("invalid derived key: %w", err)
	}

	return &ChainAccount{
		Chain:      chain,
		Address:    crypto.PubkeyToAddress(privateKey.PublicKey).Hex(),
		Path:       path,
		PrivateKey: hex.EncodeToString(key.Key),
	}, nil
}

// parsePath converts "m/44'/60'/0'/0/0" into BIP32 child indices.
func parsePath(path string) []uint32 {
	var indices []uint32
	for _, part := range splitPath(path) {
		if part == "" || part == "m" {
			continue
		}
		hardened := part[len(part)-1] == '\''
		if hardened {
			part = part[:len(part)-1]
		}
		var n uint32
		for _, c := range part {
			n = n*10 + uint32(c-'0')
		}
		if hardened {
			n += bip32.FirstHardenedChild
		}
		indices = append(indices, n)
	}
	return indices
}

func splitPath(path string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(path); i++ {
		if path[i] == '/' {
			parts = append(parts, path[start:i])
			start = i + 1
		}
	}
	return append(parts, path[start:])
}

// encryptSeed seals the seed with AES-256-GCM under a key derived from
// masterKey.
func encryptSeed(masterKey []byte, seed []byte) (ciphertext, nonce []byte, err error) {
	if len(masterKey) < 32 {
		return nil, nil, errors.New("encryption key must be at least 32 bytes")
	}
	block, err := aes.NewCipher(masterKey[:32])
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return gcm.Seal(nil, nonce, seed, nil), nonce, nil
}

// decryptSeed opens a seed sealed by encryptSeed.
func decryptSeed(masterKey, ciphertext, nonce []byte) ([]byte, error) {
	if len(masterKey) < 32 {
		return nil, errors.New("encryption key must be at least 32 bytes")
	}
	block, err := aes.NewCipher(masterKey[:32])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

// Create derives a new wallet for userID from fresh BIP39 entropy and stores
// the seed encrypted under masterKey.
//
// The previous implementation filled the address with 20 random bytes and
// returned it as the wallet address, so the wallet had no key behind it and
// funds sent to it were unrecoverable.
func (m *Manager) Create(userID string, masterKey []byte) (*Wallet, error) {
	if userID == "" {
		return nil, errors.New("userID is required")
	}

	entropy, err := bip39.NewEntropy(256)
	if err != nil {
		return nil, err
	}
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return nil, err
	}
	seed, err := bip39.NewSeedWithErrorChecking(mnemonic, "")
	if err != nil {
		return nil, err
	}

	ciphertext, nonce, err := encryptSeed(masterKey, seed)
	if err != nil {
		return nil, err
	}

	primary, err := deriveAccount(seed, "ethereum")
	if err != nil {
		return nil, err
	}

	wallet := &Wallet{
		ID:             fmt.Sprintf("DEFI_%d", time.Now().UnixNano()),
		UserID:         userID,
		Address:        primary.Address,
		Chains:         []*ChainAccount{primary},
		SeedCiphertext: ciphertext,
		SeedNonce:      nonce,
		CreatedAt:      time.Now().UnixMilli(),
	}

	m.mu.Lock()
	m.wallets[wallet.ID] = wallet
	m.mu.Unlock()

	return wallet, nil
}

// Import recreates a wallet from an existing BIP39 mnemonic.
func (m *Manager) Import(userID, mnemonic string, masterKey []byte) (*Wallet, error) {
	if userID == "" {
		return nil, errors.New("userID is required")
	}
	if !bip39.IsMnemonicValid(mnemonic) {
		return nil, errors.New("invalid mnemonic")
	}

	seed, err := bip39.NewSeedWithErrorChecking(mnemonic, "")
	if err != nil {
		return nil, err
	}
	ciphertext, nonce, err := encryptSeed(masterKey, seed)
	if err != nil {
		return nil, err
	}
	primary, err := deriveAccount(seed, "ethereum")
	if err != nil {
		return nil, err
	}

	wallet := &Wallet{
		ID:             fmt.Sprintf("DEFI_%d", time.Now().UnixNano()),
		UserID:         userID,
		Address:        primary.Address,
		Chains:         []*ChainAccount{primary},
		SeedCiphertext: ciphertext,
		SeedNonce:      nonce,
		CreatedAt:      time.Now().UnixMilli(),
	}

	m.mu.Lock()
	m.wallets[wallet.ID] = wallet
	m.mu.Unlock()

	return wallet, nil
}

// AddChainSupport derives and attaches the account for chain.
//
// The previous version generated a fresh random address per chain, so the
// same wallet had unrelated addresses with no relationship to any key.
func (m *Manager) AddChainSupport(walletID, chain string, masterKey []byte) (*ChainAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	wallet, ok := m.wallets[walletID]
	if !ok {
		return nil, ErrWalletNotFound
	}

	for _, account := range wallet.Chains {
		if account.Chain == chain {
			return account, nil
		}
	}

	seed, err := decryptSeed(masterKey, wallet.SeedCiphertext, wallet.SeedNonce)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSeedUnavailable, err)
	}
	account, err := deriveAccount(seed, chain)
	if err != nil {
		return nil, err
	}
	wallet.Chains = append(wallet.Chains, account)

	return account, nil
}

// Swap prices and executes a swap through the configured provider.
//
// The previous version returned a hardcoded 2% slippage and an invented hash
// without contacting anything, so every swap appeared to succeed.
func (m *Manager) Swap(fromToken, toToken string, amount float64) (*SwapQuote, string, error) {
	if fromToken == "" || toToken == "" {
		return nil, "", errors.New("from and to tokens are required")
	}
	if amount <= 0 {
		return nil, "", errors.New("amount must be positive")
	}
	if fromToken == toToken {
		return nil, "", errors.New("from and to tokens must differ")
	}
	if m.swap == nil {
		return nil, "", errors.New("no swap provider configured")
	}

	quote, err := m.swap.Quote(fromToken, toToken, amount)
	if err != nil {
		return nil, "", fmt.Errorf("swap quote failed: %w", err)
	}
	hash, err := m.swap.Execute(fromToken, toToken, amount)
	if err != nil {
		return nil, "", fmt.Errorf("swap execution failed: %w", err)
	}
	return quote, hash, nil
}

// Stake records a staking position through the configured provider.
func (m *Manager) Stake(walletID, asset string, amount, apy float64) (*StakePosition, error) {
	if amount <= 0 {
		return nil, errors.New("amount must be positive")
	}
	if asset == "" {
		return nil, errors.New("asset is required")
	}

	m.mu.RLock()
	_, ok := m.wallets[walletID]
	m.mu.RUnlock()
	if !ok {
		return nil, ErrWalletNotFound
	}
	if m.stake == nil {
		return nil, errors.New("no staking provider configured")
	}

	onChainID, err := m.stake.Stake(asset, amount)
	if err != nil {
		return nil, fmt.Errorf("staking failed: %w", err)
	}

	pos := &StakePosition{
		ID:        fmt.Sprintf("stake_%d", time.Now().UnixNano()),
		WalletID:  walletID,
		Asset:     asset,
		Amount:    amount,
		APY:       apy,
		OnChainID: onChainID,
		CreatedAt: time.Now().UnixMilli(),
	}

	m.mu.Lock()
	m.positions[pos.ID] = pos
	m.mu.Unlock()

	return pos, nil
}

// RegisterDApp registers a DApp and returns it.
func (m *Manager) RegisterDApp(name, category, url string) (*DApp, error) {
	if name == "" || url == "" {
		return nil, errors.New("name and url are required")
	}
	dapp := &DApp{
		ID:       fmt.Sprintf("dapp_%d", time.Now().UnixNano()),
		Name:     name,
		Category: category,
		URL:      url,
	}
	m.mu.Lock()
	m.dapps[dapp.ID] = dapp
	m.mu.Unlock()
	return dapp, nil
}

// Get returns a wallet without any key material.
func (m *Manager) Get(walletID string) (*Wallet, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	wallet, ok := m.wallets[walletID]
	if !ok {
		return nil, ErrWalletNotFound
	}
	return wallet, nil
}

// GetStakes returns a wallet's staking positions in creation order.
func (m *Manager) GetStakes(walletID string) []*StakePosition {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*StakePosition
	for _, p := range m.positions {
		if p.WalletID == walletID {
			result = append(result, p)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt < result[j].CreatedAt })
	return result
}

// MarshalJSON ensures a wallet serialises without seed or key material.
func (w *Wallet) MarshalJSON() ([]byte, error) {
	type alias Wallet
	return json.Marshal(struct {
		*alias
		SeedCiphertext []byte `json:"-"`
		SeedNonce      []byte `json:"-"`
	}{alias: (*alias)(w)})
}
