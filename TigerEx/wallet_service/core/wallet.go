// Package wallet provides crypto wallet services with hot/cold wallet architecture.
package wallet

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcec"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/shopspring/decimal"
)

// ChainType represents the blockchain type
type ChainType string

const (
	ChainBTC     ChainType = "BTC"
	ChainETH     ChainType = "ETH"
	ChainSOL    ChainType = "SOL"
	ChainTRX    ChainType = "TRX"
	ChainPolygon ChainType = "POLYGON"
	ChainArbitrum ChainType = "ARBITRUM"
	ChainOptimism ChainType = "OPTIMISM"
	ChainBSC     ChainType = "BSC"
	ChainAvalanche ChainType = "AVAX"
	ChainBase   ChainType = "BASE"
)

// WalletType represents wallet type (hot, cold, trading)
type WalletType string

const (
	WalletTypeHot     WalletType = "HOT"
	WalletTypeCold    WalletType = "COLD"
	WalletTypeTrading WalletType = "TRADING"
	WalletTypeFunding WalletType = "FUNDING"
)

// Network represents mainnet or testnet
type Network string

const (
	NetworkMainnet Network = "MAINNET"
	NetworkTestnet Network = "TESTNET"
)

// Balance represents a token balance
type Balance struct {
	UserID      string          `json:"user_id"`
	WalletType  WalletType     `json:"wallet_type"`
	Chain      ChainType      `json:"chain"`
	Token      string         `json:"token"`
	Symbol     string         `json:"symbol"`
	Amount     decimal.Decimal `json:"amount"`
	Locked     decimal.Decimal `json:"locked"`
	Available  decimal.Decimal `json:"available"`
	UpdatedAt  time.Time     `json:"updated_at"`
}

// Address represents a blockchain address
type Address struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Chain      ChainType  `json:"chain"`
	Address   string     `json:"address"`
	WalletType WalletType `json:"wallet_type"`
	PublicKey string     `json:"public_key"`
	IsPrimary bool      `json:"is_primary"`
	CreatedAt time.Time `json:"created_at"`
}

// Transaction represents an on-chain transaction
type Transaction struct {
	ID            string          `json:"id"`
	TxHash        string          `json:"tx_hash"`
	Chain         ChainType       `json:"chain"`
	FromAddress  string          `json:"from_address"`
	ToAddress    string          `json:"to_address"`
	Token        string          `json:"token"`
	Amount       decimal.Decimal `json:"amount"`
	Fee          decimal.Decimal `json:"fee"`
	Status       TxStatus       `json:"status"`
	Confirmations int            `json:"confirmations"`
	BlockNumber int64           `json:"block_number"`
	ExecutedAt *time.Time     `json:"executed_at,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
}

// TxStatus represents transaction status
type TxStatus string

const (
	TxStatusPending   TxStatus = "PENDING"
	TxStatusConfirming TxStatus = "CONFIRMING"
	TxStatusConfirmed TxStatus = "CONFIRMED"
	TxStatusFailed   TxStatus = "FAILED"
	TxStatusCancelled TxStatus = "CANCELLED"
)

// WalletService manages all wallet operations
type WalletService struct {
	mu            sync.RWMutex
	balances      map[string]map[string]*Balance // userID -> chain:token -> balance
	addresses    map[string][]*Address        // userID -> addresses
	transactions map[string]*Transaction       // txHash -> transaction
	network     Network
	signer      TransactionSigner
	feeOracle  FeeOracle
	keyManager *KeyManager
}

// KeyManager manages encryption keys for wallets
type KeyManager struct {
	mu         sync.Mutex
	keys       map[string][]byte // userID -> encrypted private key
	keyPath    string
	masterKey []byte
}

// TransactionSigner signs blockchain transactions
type TransactionSigner interface {
	Sign(tx *Transaction, privateKey []byte) (string, error)
	GetChain() ChainType
}

// FeeOracle provides gas/fee estimates
type FeeOracle interface {
	GetFee(chain ChainType, urgency string) (decimal.Decimal, error)
	GetGasPrice(chain ChainType) (decimal.Decimal, error)
	GetNonce(address string) (uint64, error)
}

// Keystore represents encrypted key storage
type Keystore struct {
	ID        string    `json:"id"`
	Cipher   string    `json:"cipher"`
	Address  string    `json:"address"`
	PublicKey string   `json:"public_key"`
}

// NewWalletService creates a new wallet service
func NewWalletService(network Network) *WalletService {
	return &WalletService{
		balances:      make(map[string]map[string]*Balance),
		addresses:    make(map[string][]*Address),
		transactions: make(map[string]*Transaction),
		network:     network,
		keyManager:  newKeyManager(),
	}
}

// CreateWallet creates a new wallet for a user
func (ws *WalletService) CreateWallet(ctx context.Context, userID string, chain ChainType) (*Address, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Generate key pair based on chain
	var pubKey, privKeyBytes []byte
	var addr string

	switch chain {
	case ChainBTC:
		pk, err := generateBTCKey()
		if err != nil {
			return nil, err
		}
		pubKey = pk.SerializeCompressed()
		privKeyBytes = pk.Serialize()
		addr = "bc1" + generateBTCAddress(pubKey)
	case ChainETH, ChainPolygon, ChainArbitrum, ChainOptimism, ChainBSC, ChainAvalanche, ChainBase:
		key, err := generateETHKey()
		if err != nil {
			return nil, err
		}
		pubKey = crypto.FromECDSAPub(&key.PublicKey)
		privKeyBytes = crypto.FromECDSA(key)
		addr = crypto.PubkeyToAddress(key.PublicKey).Hex()
	case ChainSOL:
		pub, priv, err := generateSOLKey()
		if err != nil {
			return nil, err
		}
		pubKey = pub
		privKeyBytes = priv
		addr = generateSOLAddress(pub)
	default:
		return nil, fmt.Errorf("unsupported chain: %s", chain)
	}

	// Encrypt and store key
	err := ws.keyManager.storeKey(userID, chain, privKeyBytes)
	if err != nil {
		return nil, err
	}

	address := &Address{
		ID:         generateAddressID(),
		UserID:     userID,
		Chain:     chain,
		Address:   addr,
		WalletType: WalletTypeHot,
		PublicKey: hex.EncodeToString(pubKey),
		IsPrimary: len(ws.addresses[userID]) == 0,
		CreatedAt: time.Now(),
	}

	ws.addresses[userID] = append(ws.addresses[userID], address)

	return address, nil
}

// GetBalance returns balance for a wallet
func (ws *WalletService) GetBalance(ctx context.Context, userID string, chain ChainType, token string) (*Balance, error) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", chain, token)
	if balances, ok := ws.balances[userID]; ok {
		if balance, ok := balances[key]; ok {
			return balance, nil
		}
	}

	// Return zero balance
	return &Balance{
		UserID:     userID,
		WalletType: WalletTypeHot,
		Chain:     chain,
		Token:     token,
		Symbol:    token,
		Amount:    decimal.Zero,
		Locked:    decimal.Zero,
		Available: decimal.Zero,
		UpdatedAt: time.Now(),
	}, nil
}

// Deposit processes a deposit
func (ws *WalletService) Deposit(ctx context.Context, userID, txHash, chain, token string, amount decimal.Decimal, fromAddress string) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	tx := &Transaction{
		ID:           generateTxID(),
		TxHash:       txHash,
		Chain:        ChainType(chain),
		FromAddress: fromAddress,
		ToAddress:   "", // Will be set
		Token:       token,
		Amount:     amount,
		Fee:        decimal.Zero,
		Status:     TxStatusConfirmed,
		Confirmations: 6,
		ExecutedAt: &time.Time{},
	}

	ws.transactions[txHash] = tx

	// Update balance
	key := fmt.Sprintf("%s:%s", chain, token)
	if ws.balances[userID] == nil {
		ws.balances[userID] = make(map[string]*Balance)
	}

	balance, ok := ws.balances[userID][key]
	if !ok {
		balance = &Balance{
			UserID:     userID,
			Chain:     ChainType(chain),
			Token:     token,
			Symbol:    token,
			Amount:    decimal.Zero,
			Locked:    decimal.Zero,
			Available: decimal.Zero,
		}
		ws.balances[userID][key] = balance
	}

	balance.Amount = balance.Amount.Add(amount)
	balance.Available = balance.Amount.Sub(balance.Locked)
	balance.UpdatedAt = time.Now()

	return nil
}

// Withdraw processes a withdrawal
func (ws *WalletService) Withdraw(ctx context.Context, userID, chain, token, toAddress string, amount decimal.Decimal) (*Transaction, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Check balance
	key := fmt.Sprintf("%s:%s", chain, token)
	balance, ok := ws.balances[userID][key]
	if !ok || balance.Available.LessThan(amount) {
		return nil, fmt.Errorf("insufficient balance")
	}

	// Get fee estimate
	fee := decimal.NewFromFloat(0.0001) // Default
	if ws.feeOracle != nil {
		feeEst, err := ws.feeOracle.GetFee(ChainType(chain), "standard")
		if err == nil {
			fee = feeEst
		}
	}

	totalRequired := amount.Add(fee)
	if balance.Available.LessThan(totalRequired) {
		return nil, fmt.Errorf("insufficient balance for withdrawal + fee")
	}

	// Update balance
	balance.Amount = balance.Amount.Sub(totalRequired)
	balance.Available = balance.Amount.Sub(balance.Locked)

	// Get user address
	var fromAddr string
	addrs := ws.addresses[userID]
	for _, a := range addrs {
		if string(a.Chain) == chain && a.WalletType == WalletTypeHot {
			fromAddr = a.Address
			break
		}
	}

	tx := &Transaction{
		ID:          generateTxID(),
		TxHash:      "",
		Chain:      ChainType(chain),
		FromAddress: fromAddr,
		ToAddress:  toAddress,
		Token:      token,
		Amount:     amount,
		Fee:        fee,
		Status:     TxStatusPending,
		CreatedAt:  time.Now(),
	}

	ws.transactions[tx.ID] = tx

	return tx, nil
}

// Transfer performs an internal transfer
func (ws *WalletService) Transfer(ctx context.Context, fromUserID, toUserID, chain, token string, amount decimal.Decimal) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	key := fmt.Sprintf("%s:%s", chain, token)

	// Deduct from sender
	fromBalance, ok := ws.balances[fromUserID][key]
	if !ok || fromBalance.Available.LessThan(amount) {
		return fmt.Errorf("insufficient balance")
	}

	fromBalance.Amount = fromBalance.Amount.Sub(amount)
	fromBalance.Available = fromBalance.Amount.Sub(fromBalance.Locked)

	// Add to receiver
	toBalance, ok := ws.balances[toUserID][key]
	if !ok {
		toBalance = &Balance{
			UserID:     toUserID,
			Chain:     ChainType(chain),
			Token:     token,
			Symbol:    token,
			Amount:    decimal.Zero,
			Locked:    decimal.Zero,
			Available: decimal.Zero,
		}
		ws.balances[toUserID][key] = toBalance
	}

	toBalance.Amount = toBalance.Amount.Add(amount)
	toBalance.Available = toBalance.Amount.Sub(toBalance.Locked)

	return nil
}

// LockBalance locks balance for an order
func (ws *WalletService) LockBalance(ctx context.Context, userID, chain, token string, amount decimal.Decimal) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	key := fmt.Sprintf("%s:%s", chain, token)
	balance, ok := ws.balances[userID][key]
	if !ok || balance.Available.LessThan(amount) {
		return fmt.Errorf("insufficient available balance")
	}

	balance.Locked = balance.Locked.Add(amount)
	balance.Available = balance.Amount.Sub(balance.Locked)

	return nil
}

// UnlockBalance unlocks balance
func (ws *WalletService) UnlockBalance(ctx context.Context, userID, chain, token string, amount decimal.Decimal) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	key := fmt.Sprintf("%s:%s", chain, token)
	balance, ok := ws.balances[userID][key]
	if !ok {
		return fmt.Errorf("balance not found")
	}

	balance.Locked = balance.Locked.Sub(amount)
	if balance.Locked.LessThan(decimal.Zero) {
		balance.Locked = decimal.Zero
	}
	balance.Available = balance.Amount.Sub(balance.Locked)

	return nil
}

// GetAddresses returns all addresses for a user
func (ws *WalletService) GetAddresses(userID string) []*Address {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	return ws.addresses[userID]
}

// GetTransactions returns transaction history
func (ws *WalletService) GetTransactions(userID string, limit int) []*Transaction {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	var result []*Transaction
	for _, tx := range ws.transactions {
		if tx.FromAddress != "" || limit <= 0 {
			result = append(result, tx)
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	return result
}

// Generate key helpers
func newKeyManager() *KeyManager {
	homeDir, _ := os.UserHomeDir()
	return &KeyManager{
		keys:    make(map[string][]byte),
		keyPath: filepath.Join(homeDir, ".tigerex", "keystore"),
	}
}

func (km *KeyManager) storeKey(userID, chain string, privKey []byte) error {
	// In production, encrypt with user's master key
	km.mu.Lock()
	defer km.mu.Unlock()
	km.keys[userID+":"+chain] = privKey
	return nil
}

func (km *KeyManager) getKey(userID, chain string) ([]byte, error) {
	km.mu.Lock()
	defer km.mu.Unlock()
	key, ok := km.keys[userID+":"+chain]
	if !ok {
		return nil, fmt.Errorf("key not found")
	}
	return key, nil
}

func generateBTCKey() (*btcec.PrivateKey, error) {
	_, priv, err := btcec.GenerateKey(btcec.S256())
	if err != nil {
		return nil, err
	}
	return priv, nil
}

func generateETHKey() (*btcec.PrivateKey, error) {
	key, err := btcec.GenerateKey(btcec.S256())
	if err != nil {
		return nil, err
	}
	return key, nil
}

func generateSOLKey() ([]byte, []byte, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	return pub[:], priv[:], nil
}

func generateBTCAddress(pubKey []byte) string {
	// Simplified - would use proper Base58Check encoding
	return hex.EncodeToString(pubKey[:20])[:42]
}

func generateSOLAddress(pubKey []byte) string {
	return base58Encode(pubKey)
}

func base58Encode(data []byte) string {
	// Simple base58 encoding
	alphabet := "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	result := make([]byte, len(data)*2)
	j := 0
	for _, b := range data {
		if b > 0 {
			result[j] = alphabet[int(b)%58]
			j++
		}
	}
	return string(result[:j])
}

func generateAddressID() string {
	return fmt.Sprintf("ADDR%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateTxID() string {
	return fmt.Sprintf("TX%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

// ColdWalletManager manages cold storage
type ColdWalletManager struct {
	mu       sync.RWMutex
	coldAddrs map[string]string // chain -> cold address
}

// NewColdWalletManager creates a new cold wallet manager
func NewColdWalletManager() *ColdWalletManager {
	return &ColdWalletManager{
		coldAddrs: make(map[string]string),
	}
}

// SetColdAddress sets the cold wallet address for a chain
func (cwm *ColdWalletManager) SetColdAddress(chain ChainType, address string) {
	cwm.mu.Lock()
	defer cwm.mu.Unlock()
	cwm.coldAddrs[string(chain)] = address
}

// GetColdAddress gets the cold wallet address for a chain
func (cwm *ColdWalletManager) GetColdAddress(chain ChainType) (string, bool) {
	cwm.mu.RLock()
	defer cwm.mu.RUnlock()
	addr, ok := cwm.coldAddrs[string(chain)]
	return addr, ok
}

// AccountsABI compatibility
var _ accounts.Wallet = (*Walleter)(nil)

type Walleter struct{}

func (w *Walleter) URL() accounts.URL {
	return accounts.URL{Scheme: "tigerex", Path: "wallet"}
}

func (w *Walleter) Status() (string, error) {
	return "Open", nil
}

func (w *Walleter) Open(passphrase string) (accounts.Wallet, error) {
	return w, nil
}

func (w *Walleter) Accounts() []accounts.Account {
	return []accounts.Account{}
}

func (w *Walleter) SignHash(account accounts.Account, hash []byte) ([]byte, error) {
	return nil, nil
}

func (w *Walleter) SignWithPassphrase(account accounts.Account, passphrase string, hash []byte) ([]byte, error) {
	return nil, nil
}

var _ = common.Address{} // Prevent unused import