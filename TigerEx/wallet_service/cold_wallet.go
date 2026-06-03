package wallet

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// ColdWalletConfig holds cold wallet configuration
type ColdWalletConfig struct {
	Threshold       uint8  `json:"threshold"`       // Signatures required (e.g., 2 of 3)
	TotalSigners   uint8  `json:"total_signers"`   // Total signers
	AdminKeys     []string `json:"admin_keys"`  // Admin public keys
	HotWalletAddr string  `json:"hot_wallet_addr"`
	ColdWalletAddr string `json:"cold_wallet_addr"`
	MaxDailyWithdrawal uint64 `json:"max_daily_withdrawal"`
	MinWithdrawal   uint64 `json:"min_withdrawal"`
}

// MultiSigWallet represents a multi-signature wallet
type MultiSigWallet struct {
	mu            sync.RWMutex
	config        ColdWalletConfig
	balance       map[string]*big.Int
	pendingTXs    map[string]*PendingTransaction
	signatures    map[string]map[string]bool // txHash -> signerAddress -> signed
	nonce        uint64
	lastWithdraw time.Time
	dailyAmount  uint64
}

// PendingTransaction represents a pending multi-sig transaction
type PendingTransaction struct {
	ID            string            `json:"id"`
	Type          string            `json:"type"` // "transfer" or "setup"
	To            string            `json:"to"`
	Amount        *big.Int         `json:"amount"`
	Token         string            `json:"token"`
	Data          []byte           `json:"data"`
	Signatures    []string         `json:"signatures"`
	RequiredSigs uint8            `json:"required_sigs"`
	CreatedAt     time.Time       `json:"created_at"`
	ExpiresAt     time.Time       `json:"expires_at"`
	Executed      bool            `json:"executed"`
	Cancelled     bool            `json:"cancelled"`
}

// ColdStorage manages offline cold storage
type ColdStorage struct {
	mu            sync.RWMutex
	config        ColdWalletConfig
	wallets      map[string]*Wallet // currency -> wallet
	online       bool
	lastSync     time.Time
	airGapMode   bool
	hsms        []HardwareSecurityModule
}

// HardwareSecurityModule interface for HSM integration
type HardwareSecurityModule interface {
	Sign(data []byte) ([]byte, error)
	GetPublicKey() ([]byte, error)
	IsConnected() bool
}

// Vault represents secure vault for large amounts
type Vault struct {
	mu           sync.RWMutex
	config      ColdWalletConfig
	level       VaultLevel
	balance     map[string]*big.Int
	authorized map[string]*AuthorizedUser
	timeLock   time.Duration
	lastAccess time.Time
}

// VaultLevel represents security level of vault
type VaultLevel struct {
	Name        string
	RequiredSigs uint8
	TimeLock    time.Duration
	DailyLimit  *big.Int
}

// AuthorizedUser represents authorized vault user
type AuthorizedUser struct {
	Address       string
	PublicKey     string
	Level        string
	CanWithdraw  bool
	CanApprove   bool
	LastActivity time.Time
}

// NewColdWallet creates a new cold wallet system
func NewColdWallet(config ColdWalletConfig) (*ColdStorage, error) {
	// Validate config
	if config.Threshold == 0 || config.TotalSigners == 0 {
		return nil, fmt.Errorf("invalid threshold or total signers")
	}
	if config.Threshold > config.TotalSigners {
		return nil, fmt.Errorf("threshold cannot exceed total signers")
	}
	if len(config.AdminKeys) < int(config.TotalSigners) {
		return nil, fmt.Errorf("insufficient admin keys")
	}

	cw := &ColdStorage{
		config:   config,
		wallets: make(map[string]*Wallet),
		online:  false, // Starts offline for security
		airGapMode: true,
		hsms:    make([]HardwareSecurityModule, 0),
	}

	// Generate cold wallet addresses for supported currencies
	for _, currency := range []string{"BTC", "ETH", "USDT", "USDC"} {
		wallet, err := cw.createWallet(currency)
		if err != nil {
			return nil, fmt.Errorf("failed to create %s wallet: %w", currency, err)
		}
		cw.wallets[currency] = wallet
	}

	return cw, nil
}

// Create MultiSigWallet
func NewMultiSigWallet(config ColdWalletConfig) (*MultiSigWallet, error) {
	if config.Threshold == 0 || config.TotalSigners == 0 {
		return nil, fmt.Errorf("invalid threshold or total signers")
	}

	msw := &MultiSigWallet{
		config:     config,
		balance:    make(map[string]*big.Int),
		pendingTXs: make(map[string]*PendingTransaction),
		signatures: make(map[string]map[string]bool),
		nonce:     1,
	}

	// Initialize balances
	for _, curr := range []string{"BTC", "ETH", "USDT", "USDC"} {
		msw.balance[curr] = big.NewInt(0)
	}

	return msw, nil
}

// CreateWallet generates a new wallet with key generation
func (cw *ColdStorage) createWallet(currency string) (*Wallet, error) {
	switch currency {
	case "ETH":
		key, err := crypto.GenerateKey()
		if err != nil {
			return nil, err
		}
		privateKeyBytes := crypto.FromECDSA(key)
		
		return &Wallet{
			Currency:    currency,
			PrivateKey: hex.EncodeToString(privateKeyBytes),
			PublicKey:  hex.EncodeToString(crypto.CompressPubKey(&key.PublicKey)),
			Address:    crypto.PubkeyToAddress(key.PublicKey).Hex(),
			WalletType: "cold",
			CreatedAt:  time.Now(),
			IsHot:     false,
		}, nil
		
	case "BTC":
		// Generate secp256k1 key for Bitcoin
		key, err := ecdsa.GenerateKey(secp256k1Curve(), rand.Reader)
		if err != nil {
			return nil, err
		}
		
		pubKeyHash := sha256.Sum256(key.PublicKey.BytesCompressed()[1:])
		addr := generateBTCAddress(pubKeyHash[:])
		
		return &Wallet{
			Currency:    currency,
			PrivateKey: hex.EncodeToString(key.D.Bytes()),
			PublicKey:  hex.EncodeToString(key.PublicKey.BytesCompressed()),
			Address:    addr,
			WalletType: "cold",
			CreatedAt:  time.Now(),
			IsHot:     false,
		}, nil
		
	default:
		return nil, fmt.Errorf("unsupported currency: %s", currency)
	}
}

// secp256k1Curve returns the secp256k1 curve
func secp256k1Curve() elliptic.Curve {
	return elliptic.S256()
}

// BTC address generation (P2PKH)
func generateBTCAddress(pubKeyHash []byte) string {
	// Add version byte (0x00 for mainnet)
	versioned := append([]byte{0x00}, pubKeyHash...)
	
	// Double hash for checksum
	h1 := sha256.Sum256(versioned)
	h2 := sha256.Sum256(h1[:])
	
	// First 4 bytes as checksum
	checkSum := append(versioned, h2[:4]...)
	
	return base58Encode(checkSum)
}

// Base58 encoding
func base58Encode(data []byte) string {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	
	result := make([]byte, 0, len(data)*2)
	for _, b := range data {
		if b == 0 {
			result = append(result, '1')
			continue
		}
		
		num := new(big.Int).SetBytes(data)
		base := big.NewInt(58)
		
		for num.BitLen() > 0 {
			div := new(big.Int).DivMod(num, base, num)
			digit := num.Int64()
			result = append([]byte{alphabet[digit]}, result...)
			num = div
		}
		
		data = data[:len(data)-1]
		for len(data) > 0 && data[0] == 0 {
			result = append([]byte{'1'}, result...)
			data = data[1:]
		}
		break
	}
	
	return string(result)
}

// CreateWithdrawalProposal creates a multi-sig withdrawal proposal
func (msw *MultiSigWallet) CreateWithdrawalProposal(
	withdrawer string,
	to string,
	amount *big.Int,
	token string,
) (*PendingTransaction, error) {
	msw.mu.Lock()
	defer msw.mu.Unlock()

	// Check daily limits
	if !msw.checkDailyLimit(amount) {
		return nil, fmt.Errorf("daily withdrawal limit exceeded")
	}

	tx := &PendingTransaction{
		ID:            fmt.Sprintf("tx_%d", msw.nonce),
		Type:         "transfer",
		To:           to,
		Amount:       amount,
		Token:       token,
		Signatures:   make([]string, 0, msw.config.Threshold),
		RequiredSigs: msw.config.Threshold,
		CreatedAt:   time.Now(),
		ExpiresAt:  time.Now().Add(24 * time.Hour),
	}

	msw.pendingTXs[tx.ID] = tx
	msw.signatures[tx.ID] = make(map[string]bool)
	msw.nonce++

	return tx, nil
}

// SignTransaction signs a pending transaction
func (msw *MultiSigWallet) SignTransaction(txID string, signer string) error {
	msw.mu.Lock()
	defer msw.mu.Unlock()

	tx, ok := msw.pendingTXs[txID]
	if !ok {
		return fmt.Errorf("transaction not found")
	}

	if tx.Executed || tx.Cancelled {
		return fmt.Errorf("transaction already processed")
	}

	// Check signer is authorized
	if !msw.isAuthorizedSigner(signer, tx.Token) {
		return fmt.Errorf("unauthorized signer")
	}

	// Add signature
	if !msw.signatures[txID][signer] {
		tx.Signatures = append(tx.Signatures, signer)
		msw.signatures[txID][signer] = true
	}

	// Check if enough signatures
	if len(tx.Signatures) >= int(tx.RequiredSigs) {
		return msw.executeTransactionLocked(tx)
	}

	return nil
}

// ExecuteTransaction executes a multi-sig transaction after enough signatures
func (msw *MultiSigWallet) executeTransactionLocked(tx *PendingTransaction) error {
	tx.Executed = true
	
	// Update balance
	currentBalance := msw.balance[tx.Token]
	newBalance := new(big.Int).Sub(currentBalance, tx.Amount)
	msw.balance[tx.Token] = newBalance
	
	// Update daily limit
	msw.dailyAmount += tx.Amount.Uint64()
	msw.lastWithdraw = time.Now()

	return nil
}

// CancelTransaction cancels a pending transaction
func (msw *MultiSigWallet) CancelTransaction(txID string, canceler string) error {
	msw.mu.Lock()
	defer msw.mu.Unlock()

	tx, ok := msw.pendingTXs[txID]
	if !ok {
		return fmt.Errorf("transaction not found")
	}

	// Only admin can cancel
	if !msw.isAdmin(canceller) {
		return fmt.Errorf("only admin can cancel")
	}

	tx.Cancelled = true
	delete(msw.pendingTXs, txID)
	delete(msw.signatures, txID)

	return nil
}

// GetTransaction gets a pending transaction by ID
func (msw *MultiStorage) GetTransaction(txID string) (*PendingTransaction, error) {
	msw.mu.RLock()
	defer msw.mu.RUnlock()

	tx, ok := msw.pendingTXs[txID]
	if !ok {
		return nil, fmt.Errorf("transaction not found")
	}

	return tx, nil
}

// isAuthorizedSigner checks if signer is authorized
func (msw *MultiSigWallet) isAuthorizedSigner(address, token string) bool {
	for _, key := range msw.config.AdminKeys {
		addr := strings.ToLower(key)
		if strings.ToLower(address) == addr {
			return true
		}
	}
	return false
}

// isAdmin checks if address is admin
func (msw *MultiSigWallet) isAdmin(address string) bool {
	return msw.isAuthorizedSigner(address, "")
}

// checkDailyLimit checks if withdrawal is within daily limit
func (msw *MultiSigWallet) checkDailyLimit(amount *big.Int) bool {
	if time.Since(msw.lastWithdraw) > 24*time.Hour {
		msw.dailyAmount = 0
	}
	
	totalWithdrawal := msw.dailyAmount + amount.Uint64()
	return totalWithdrawal <= msw.config.MaxDailyWithdrawal
}

// Vault System

// NewVault creates a new vault system
func NewVault(config ColdWalletConfig) *Vault {
	return &Vault{
		config:      config,
		level:      VaultLevel{
			Name:        "standard",
			RequiredSigs: 2,
			TimeLock:    24 * time.Hour,
			DailyLimit:  big.NewInt(1_000_000_000), // 1000 ETH
		},
		balance:     make(map[string]*big.Int),
		authorized: make(map[string]*AuthorizedUser),
		timeLock:   24 * time.Hour,
	}
}

// AuthorizeUser adds authorized user to vault
func (v *Vault) AuthorizeUser(user AuthorizedUser) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	user.LastActivity = time.Now()
	v.authorized[user.Address] = &user
	
	return nil
}

// RequestWithdrawal requests a withdrawal from vault with time lock
func (v *Vault) RequestWithdrawal(
	requester string,
	amount *big.Int,
	currency string,
) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	user, ok := v.authorized[requester]
	if !ok {
		return "", fmt.Errorf("unauthorized user")
	}

	if !user.CanWithdraw {
		return "", fmt.Errorf("user cannot withdraw")
	}

	// Check time lock for larger withdrawals
	if amount.Cmp(v.level.DailyLimit) > 0 {
		if timeSince(v.lastAccess) < v.timeLock {
			return "", fmt.Errorf("time lock active for large withdrawal")
		}
	}

	// Authorization required for large amounts
	txID := fmt.Sprintf("vault_%d_%d", time.Now().UnixNano(), amount.Int64())
	v.lastAccess = time.Now()

	return txID, nil
}

// ApproveWithdrawal approves vault withdrawal
func (v *Vault) ApproveWithdrawal(approver string, txID string) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	// Verify approver
	user, ok := v.authorized[approver]
	if !ok {
		return fmt.Errorf("unauthorized approver")
	}

	if !user.CanApprove {
		return fmt.Errorf("user cannot approve transactions")
	}

	return nil
}

// Security functions

// SignWithHSM signs data using hardware security module
func (cw *ColdStorage) SignWithHSM(data []byte) ([]byte, error) {
	if len(cw.hsms) == 0 {
		return nil, fmt.Errorf("no HSM connected")
	}

	// Use first available HSM
	hsm := cw.hsms[0]
	if !hsm.IsConnected() {
		return nil, fmt.Errorf("HSM not connected")
	}

	return hsm.Sign(data)
}

// GetColdWalletAddress returns cold wallet address
func (cw *ColdStorage) GetColdWalletAddress(currency string) (string, error) {
	cw.mu.RLock()
	defer cw.mu.RUnlock()

	wallet, ok := cw.wallets[currency]
	if !ok {
		return "", fmt.Errorf("currency not supported")
	}

	return wallet.Address, nil
}

// Sync synchronizes cold storage with online reference
func (cw *ColdStorage) Sync() error {
	cw.mu.Lock()
	defer cw.mu.Unlock()

	if !cw.online {
		// Re-connection for sync - should verify via HSM or air-gapped machine
		cw.lastSync = time.Now()
		cw.airGapMode = true
	}

	return nil
}

// IsOnline returns if cold storage is online
func (cw *ColdStorage) IsOnline() bool {
	cw.mu.RLock()
	defer cw.mu.RUnlock()

	return cw.online
}

// JSON serialization helpers

type walletJSON struct {
	Currency    string `json:"currency"`
	Address    string `json:"address"`
	WalletType string `json:"wallet_type"`
	Balance    string `json:"balance"`
	CreatedAt  int64  `json:"created_at"`
	IsHot      bool   `json:"is_hot"`
}

// ToJSON converts wallet to JSON format (never exposes private key)
func (w *Wallet) ToJSON() ([]byte, error) {
	json := walletJSON{
		Currency:    w.Currency,
		Address:    w.Address,
		WalletType: w.WalletType,
		Balance:   w.Balance.String(),
		CreatedAt:  w.CreatedAt.Unix(),
		IsHot:     w.IsHot,
	}

	return json.MarshalJSON()
}

// Helper functions

func timeSince(t time.Time) time.Duration {
	if t.IsZero() {
		return time.Duration(1 << 62)
	}
	return time.Since(t)
}

var _ = common.Address{} // Import check

// EthCommon imports
var _ = common.HexToAddress
var _ = crypto.Keccak256