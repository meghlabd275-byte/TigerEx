package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TIGEREX WALLET SERVICE
// Multi-currency wallet with hot/cold/multi-sig support
// ============================================================================

// Wallet Types
const (
	WalletTypeHot     = "hot"
	WalletTypeCold    = "cold"
	WalletTypeWarm    = "warm"
	WalletTypeCustody  = "custody"
	WalletTypeTrading = "trading"
)

// Wallet Status
const (
	WalletActive   = "active"
	WalletInactive = "inactive"
	WalletFrozen   = "frozen"
)

// ============================================================================
// WALLET TYPES
// ============================================================================

type Wallet struct {
	ID            string            `json:"id"`
	UserID        string            `json:"userId"`
	Type          string            `json:"type"` // hot, cold, warm, custody, trading
	Currency      string            `json:"currency"`
	Address       string            `json:"address"`
	PublicKey     string            `json:"publicKey"`
	Balance       float64           `json:"balance"`
	LockedBalance float64           `json:"lockedBalance"`
	AvailableBalance float64        `json:"availableBalance"`
	Status        string            `json:"status"`
	IsMultiSig    bool              `json:"isMultiSig"`
	MultiSigThreshold int           `json:"multiSigThreshold,omitempty"`
	Signers       []string          `json:"signers,omitempty"`
	CreatedAt     int64             `json:"createdAt"`
	UpdatedAt     int64             `json:"updatedAt"`
	LastActivity  int64             `json:"lastActivity"`
}

type WalletAddress struct {
	ID         string `json:"id"`
	WalletID   string `json:"walletId"`
	Address    string `json:"address"`
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"-"` // Never expose
	DerivationPath string `json:"derivationPath"`
	Index      int    `json:"index"`
	IsDefault  bool   `json:"isDefault"`
	Label      string `json:"label,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
}

type Transaction struct {
	ID            string  `json:"id"`
	WalletID      string  `json:"walletId"`
	Type          string  `json:"type"` // deposit, withdrawal, transfer, internal
	Status        string  `json:"status"` // pending, confirmed, failed
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	Fee           float64 `json:"fee"`
	FromAddress   string  `json:"fromAddress"`
	ToAddress     string  `json:"toAddress"`
	TxHash        string  `json:"txHash,omitempty"`
	Confirmations int     `json:"confirmations"`
	RequiredConfirmations int `json:"requiredConfirmations"`
	Timestamp     int64   `json:"timestamp"`
	ConfirmedAt   int64   `json:"confirmedAt,omitempty"`
	Memo          string  `json:"memo,omitempty"`
}

type WithdrawalRequest struct {
	ID           string  `json:"id"`
	UserID       string  `json:"userId"`
	Currency     string  `json:"currency"`
	Amount       float64 `json:"amount"`
	Address      string  `json:"address"`
	Network      string  `json:"network"`
	Fee          float64 `json:"fee"`
	Status       string  `json:"status"`
	TwoFactorCode string `json:"twoFactorCode,omitempty"`
	IPAddress    string  `json:"ipAddress"`
	UserAgent    string  `json:"userAgent"`
	CreatedAt    int64   `json:"createdAt"`
	ApprovedAt   int64   `json:"approvedAt,omitempty"`
	ProcessedAt  int64   `json:"processedAt,omitempty"`
}

// ============================================================================
// WALLET SERVICE
// ============================================================================

type WalletService struct {
	// User wallets
	wallets map[string]*Wallet // WalletID -> Wallet
	userWallets map[string][]*Wallet // UserID -> Wallets

	// Addresses
	addresses map[string]*WalletAddress // Address -> Address info
	walletAddresses map[string][]*WalletAddress // WalletID -> Addresses

	// Transactions
	transactions map[string]*Transaction // TxID -> Transaction
	userTransactions map[string][]*Transaction // UserID -> Transactions

	// Withdrawal requests
	withdrawals map[string]*WithdrawalRequest
	withdrawalQueue []*WithdrawalRequest

	// Hot wallet balance limits
	hotWalletMaxBalance float64
	hotWalletReplenishThreshold float64
	coldWalletAddress string

	// Multi-sig wallets
	multiSigWallets map[string]*MultiSigWallet

	// Callbacks
	onDeposit func(*Transaction) error
	onWithdrawal func(*WithdrawalRequest) error

	mu sync.RWMutex
}

type MultiSigWallet struct {
	ID          string   `json:"id"`
	Threshold   int      `json:"threshold"` // Number of signatures required
	Signers     []string `json:"signers"`   // List of signer public keys
	RequiredSigs int      `json:"requiredSigs"`
	PendingTxs  []*PendingTx `json:"pendingTxs"`
	CreatedAt   int64    `json:"createdAt"`
}

type PendingTx struct {
	TxID        string   `json:"txId"`
	ToAddress   string   `json:"toAddress"`
	Amount      float64  `json:"amount"`
	Currency    string   `json:"currency"`
	Signatures  []string `json:"signatures"` // Collected signatures
	Status      string   `json:"status"`
	CreatedAt   int64    `json:"createdAt"`
	ExpiresAt   int64    `json:"expiresAt"`
}

func NewWalletService() *WalletService {
	return &WalletService{
		wallets:               make(map[string]*Wallet),
		userWallets:           make(map[string][]*Wallet),
		addresses:            make(map[string]*WalletAddress),
		walletAddresses:      make(map[string][]*WalletAddress),
		transactions:         make(map[string]*Transaction),
		userTransactions:     make(map[string][]*Transaction),
		withdrawals:          make(map[string]*WithdrawalRequest),
		withdrawalQueue:      make([]*WithdrawalRequest, 0),
		multiSigWallets:       make(map[string]*MultiSigWallet),
		hotWalletMaxBalance:   1000000,  // 1M USD equivalent
		hotWalletReplenishThreshold: 500000, // Replenish at 500k
	}
}

// ============================================================================
// WALLET MANAGEMENT
// ============================================================================

func (ws *WalletService) CreateWallet(userID, currency, walletType string) (*Wallet, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Generate new address
	address, privateKey, err := ws.generateAddress(currency)
	if err != nil {
		return nil, err
	}

	walletID := fmt.Sprintf("wallet_%d_%s_%s", time.Now().UnixMilli(), userID[:8], currency)
	
	wallet := &Wallet{
		ID:                walletID,
		UserID:            userID,
		Type:             walletType,
		Currency:         currency,
		Address:          address,
		PublicKey:        ws.getPublicKey(privateKey),
		Balance:          0,
		LockedBalance:   0,
		AvailableBalance: 0,
		Status:           WalletActive,
		IsMultiSig:       false,
		CreatedAt:        time.Now().UnixMilli(),
		UpdatedAt:        time.Now().UnixMilli(),
	}

	ws.wallets[walletID] = wallet
	ws.userWallets[userID] = append(ws.userWallets[userID], wallet)

	// Create address record
	addrRecord := &WalletAddress{
		ID:            fmt.Sprintf("addr_%d", time.Now().UnixNano()),
		WalletID:     walletID,
		Address:      address,
		PublicKey:    ws.getPublicKey(privateKey),
		PrivateKey:   privateKey,
		DerivationPath: fmt.Sprintf("m/44'/0'/0'/0/0"),
		Index:        0,
		IsDefault:   true,
		CreatedAt:    time.Now().UnixMilli(),
	}

	ws.addresses[address] = addrRecord
	ws.walletAddresses[walletID] = append(ws.walletAddresses[walletID], addrRecord)

	return wallet, nil
}

func (ws *WalletService) GetWallet(walletID string) (*Wallet, error) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	wallet, exists := ws.wallets[walletID]
	if !exists {
		return nil, fmt.Errorf("wallet not found: %s", walletID)
	}

	return wallet, nil
}

func (ws *WalletService) GetUserWallets(userID string) []*Wallet {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	return ws.userWallets[userID]
}

func (ws *WalletService) GetWalletByAddress(address string) (*Wallet, error) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	addrInfo, exists := ws.addresses[address]
	if !exists {
		return nil, fmt.Errorf("address not found")
	}

	wallet, exists := ws.wallets[addrInfo.WalletID]
	if !exists {
		return nil, fmt.Errorf("wallet not found")
	}

	return wallet, nil
}

// ============================================================================
// ADDRESS GENERATION
// ============================================================================

func (ws *WalletService) generateAddress(currency string) (string, string, error) {
	// Generate ECDSA key pair
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}

	// Get public key
	pubKeyBytes := elliptic.Marshal(elliptic.P256(), privateKey.PublicKey.X, privateKey.PublicKey.Y)

	// Hash public key to create address
	hash := sha256.Sum256(pubKeyBytes)
	address := hex.EncodeToString(hash[:])[:40] // First 40 chars

	// Add currency prefix
	switch currency {
	case "BTC":
		address = "bc1" + address[:39-len("bc1")] // Legacy Bech32
	case "ETH", "USDT", "USDC":
		address = "0x" + address
	default:
		// Generic address format
	}

	privateKeyHex := hex.EncodeToString(privateKey.D.Bytes())

	return address, privateKeyHex, nil
}

func (ws *WalletService) getPublicKey(privateKeyHex string) string {
	return "pub_" + privateKeyHex[:40]
}

func (ws *WalletService) GenerateNewAddress(walletID string, label string) (*WalletAddress, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	wallet, exists := ws.wallets[walletID]
	if !exists {
		return nil, fmt.Errorf("wallet not found")
	}

	// Generate new address
	address, privateKey, err := ws.generateAddress(wallet.Currency)
	if err != nil {
		return nil, err
	}

	index := len(ws.walletAddresses[walletID])
	
	addrRecord := &WalletAddress{
		ID:            fmt.Sprintf("addr_%d", time.Now().UnixNano()),
		WalletID:     walletID,
		Address:      address,
		PublicKey:    ws.getPublicKey(privateKey),
		PrivateKey:   privateKey,
		DerivationPath: fmt.Sprintf("m/44'/0'/0'/0/%d", index),
		Index:        index,
		IsDefault:   false,
		Label:        label,
		CreatedAt:    time.Now().UnixMilli(),
	}

	ws.addresses[address] = addrRecord
	ws.walletAddresses[walletID] = append(ws.walletAddresses[walletID], addrRecord)

	return addrRecord, nil
}

// ============================================================================
// BALANCE MANAGEMENT
// ============================================================================

func (ws *WalletService) GetBalance(walletID string) (balance, locked, available float64, err error) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	wallet, exists := ws.wallets[walletID]
	if !exists {
		return 0, 0, 0, fmt.Errorf("wallet not found")
	}

	return wallet.Balance, wallet.LockedBalance, wallet.AvailableBalance, nil
}

func (ws *WalletService) UpdateBalance(walletID string, amount float64, operation string) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	wallet, exists := ws.wallets[walletID]
	if !exists {
		return fmt.Errorf("wallet not found")
	}

	switch operation {
	case "add":
		wallet.Balance += amount
	case "subtract":
		if wallet.Balance < amount {
			return fmt.Errorf("insufficient balance")
		}
		wallet.Balance -= amount
	case "lock":
		wallet.LockedBalance += amount
		wallet.AvailableBalance = wallet.Balance - wallet.LockedBalance
	case "unlock":
		wallet.LockedBalance -= amount
		wallet.AvailableBalance = wallet.Balance - wallet.LockedBalance
	default:
		return fmt.Errorf("invalid operation")
	}

	wallet.UpdatedAt = time.Now().UnixMilli()
	wallet.LastActivity = time.Now().UnixMilli()

	return nil
}

func (ws *WalletService) LockBalance(walletID string, amount float64) error {
	return ws.UpdateBalance(walletID, amount, "lock")
}

func (ws *WalletService) UnlockBalance(walletID string, amount float64) error {
	return ws.UpdateBalance(walletID, amount, "unlock")
}

// ============================================================================
// DEPOSITS
// ============================================================================

func (ws *WalletService) ProcessDeposit(userID, currency, amount float64, txHash string) (*Transaction, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Find user's wallet for this currency
	var wallet *Wallet
	wallets := ws.userWallets[userID]
	for _, w := range wallets {
		if w.Currency == currency && w.Status == WalletActive {
			wallet = w
			break
		}
	}

	if wallet == nil {
		return nil, fmt.Errorf("wallet not found for user %s currency %s", userID, currency)
	}

	// Create transaction
	txID := fmt.Sprintf("tx_deposit_%d_%s", time.Now().UnixMilli(), userID[:8])
	tx := &Transaction{
		ID:           txID,
		WalletID:     wallet.ID,
		Type:         "deposit",
		Status:       "confirmed",
		Amount:       amount,
		Currency:     currency,
		Fee:          0,
		FromAddress:  txHash,
		ToAddress:    wallet.Address,
		TxHash:       txHash,
		Confirmations: 6,
		RequiredConfirmations: 6,
		Timestamp:    time.Now().UnixMilli(),
		ConfirmedAt:  time.Now().UnixMilli(),
	}

	// Update wallet balance
	wallet.Balance += amount
	wallet.AvailableBalance = wallet.Balance - wallet.LockedBalance
	wallet.UpdatedAt = time.Now().UnixMilli()
	wallet.LastActivity = time.Now().UnixMilli()

	// Store transaction
	ws.transactions[txID] = tx
	ws.userTransactions[userID] = append(ws.userTransactions[userID], tx)

	if ws.onDeposit != nil {
		go ws.onDeposit(tx)
	}

	return tx, nil
}

func (ws *WalletService) GetDeposits(userID string, limit int) []*Transaction {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	var deposits []*Transaction
	for _, tx := range ws.userTransactions[userID] {
		if tx.Type == "deposit" {
			deposits = append(deposits, tx)
			if limit > 0 && len(deposits) >= limit {
				break
			}
		}
	}

	return deposits
}

// ============================================================================
// WITHDRAWALS
// ============================================================================

func (ws *WalletService) CreateWithdrawal(req *WithdrawalRequest) (*WithdrawalRequest, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Find user's wallet
	var wallet *Wallet
	wallets := ws.userWallets[req.UserID]
	for _, w := range wallets {
		if w.Currency == req.Currency && w.Status == WalletActive {
			wallet = w
			break
		}
	}

	if wallet == nil {
		return nil, fmt.Errorf("wallet not found")
	}

	// Check available balance
	if wallet.AvailableBalance < req.Amount+req.Fee {
		return nil, fmt.Errorf("insufficient balance")
	}

	// Create withdrawal request
	req.ID = fmt.Sprintf("withdraw_%d_%s", time.Now().UnixMilli(), req.UserID[:8])
	req.Status = "pending"
	req.CreatedAt = time.Now().UnixMilli()

	// Lock the balance
	wallet.LockedBalance += req.Amount + req.Fee
	wallet.AvailableBalance = wallet.Balance - wallet.LockedBalance

	ws.withdrawals[req.ID] = req
	ws.withdrawalQueue = append(ws.withdrawalQueue, req)

	return req, nil
}

func (ws *WalletService) ApproveWithdrawal(withdrawalID string, approverID string) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	req, exists := ws.withdrawals[withdrawalID]
	if !exists {
		return fmt.Errorf("withdrawal not found")
	}

	if req.Status != "pending" {
		return fmt.Errorf("withdrawal already processed")
	}

	req.Status = "approved"
	req.ApprovedAt = time.Now().UnixMilli()

	return nil
}

func (ws *WalletService) ProcessWithdrawal(withdrawalID string) (*Transaction, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	req, exists := ws.withdrawals[withdrawalID]
	if !exists {
		return nil, fmt.Errorf("withdrawal not found")
	}

	if req.Status != "approved" {
		return nil, fmt.Errorf("withdrawal not approved")
	}

	// Find wallet
	var wallet *Wallet
	for _, w := range ws.wallets {
		if w.UserID == req.UserID && w.Currency == req.Currency {
			wallet = w
			break
		}
	}

	if wallet == nil {
		return nil, fmt.Errorf("wallet not found")
	}

	// Create transaction
	txID := fmt.Sprintf("tx_withdraw_%d_%s", time.Now().UnixMilli(), req.UserID[:8])
	tx := &Transaction{
		ID:           txID,
		WalletID:     wallet.ID,
		Type:         "withdrawal",
		Status:       "pending",
		Amount:       req.Amount,
		Currency:     req.Currency,
		Fee:          req.Fee,
		FromAddress:  wallet.Address,
		ToAddress:    req.Address,
		Confirmations: 0,
		RequiredConfirmations: 6,
		Timestamp:    time.Now().UnixMilli(),
	}

	// Deduct from balance
	wallet.Balance -= (req.Amount + req.Fee)
	wallet.LockedBalance -= (req.Amount + req.Fee)
	wallet.AvailableBalance = wallet.Balance - wallet.LockedBalance

	req.Status = "processing"
	req.ProcessedAt = time.Now().UnixMilli()

	ws.transactions[txID] = tx
	ws.userTransactions[req.UserID] = append(ws.userTransactions[req.UserID], tx)

	if ws.onWithdrawal != nil {
		go ws.onWithdrawal(req)
	}

	return tx, nil
}

func (ws *WalletService) CancelWithdrawal(withdrawalID, userID string) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	req, exists := ws.withdrawals[withdrawalID]
	if !exists {
		return fmt.Errorf("withdrawal not found")
	}

	if req.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if req.Status != "pending" {
		return fmt.Errorf("cannot cancel withdrawal in status: %s", req.Status)
	}

	// Unlock balance
	var wallet *Wallet
	for _, w := range ws.wallets {
		if w.UserID == req.UserID && w.Currency == req.Currency {
			wallet = w
			break
		}
	}

	if wallet != nil {
		wallet.LockedBalance -= (req.Amount + req.Fee)
		wallet.AvailableBalance = wallet.Balance - wallet.LockedBalance
	}

	req.Status = "cancelled"

	return nil
}

func (ws *WalletService) GetWithdrawals(userID string, limit int) []*WithdrawalRequest {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	var withdrawals []*WithdrawalRequest
	for _, req := range ws.withdrawals {
		if req.UserID == userID {
			withdrawals = append(withdrawals, req)
			if limit > 0 && len(withdrawals) >= limit {
				break
			}
		}
	}

	return withdrawals
}

// ============================================================================
// TRANSFERS
// ============================================================================

func (ws *WalletService) InternalTransfer(fromUserID, toUserID, currency string, amount float64) (*Transaction, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}

	// Find sender wallet
	var fromWallet *Wallet
	for _, w := range ws.userWallets[fromUserID] {
		if w.Currency == currency && w.Status == WalletActive {
			fromWallet = w
			break
		}
	}

	if fromWallet == nil {
		return nil, fmt.Errorf("sender wallet not found")
	}

	if fromWallet.AvailableBalance < amount {
		return nil, fmt.Errorf("insufficient balance")
	}

	// Find receiver wallet
	var toWallet *Wallet
	for _, w := range ws.userWallets[toUserID] {
		if w.Currency == currency && w.Status == WalletActive {
			toWallet = w
			break
		}
	}

	if toWallet == nil {
		return nil, fmt.Errorf("receiver wallet not found")
	}

	// Create transfer transaction
	txID := fmt.Sprintf("tx_transfer_%d_%s", time.Now().UnixMilli(), fromUserID[:8])
	tx := &Transaction{
		ID:           txID,
		WalletID:     fromWallet.ID,
		Type:         "transfer",
		Status:       "confirmed",
		Amount:       amount,
		Currency:     currency,
		Fee:          0,
		FromAddress:  fromWallet.Address,
		ToAddress:    toWallet.Address,
		Confirmations: 1,
		RequiredConfirmations: 1,
		Timestamp:    time.Now().UnixMilli(),
		ConfirmedAt:  time.Now().UnixMilli(),
	}

	// Update balances
	fromWallet.Balance -= amount
	fromWallet.AvailableBalance = fromWallet.Balance - fromWallet.LockedBalance
	toWallet.Balance += amount
	toWallet.AvailableBalance = toWallet.Balance - toWallet.LockedBalance

	// Store
	ws.transactions[txID] = tx
	ws.userTransactions[fromUserID] = append(ws.userTransactions[fromUserID], tx)
	ws.userTransactions[toUserID] = append(ws.userTransactions[toUserID], tx)

	return tx, nil
}

func (ws *WalletService) GetTransactions(userID, currency string, limit int) []*Transaction {
	ws.mu.RLock()
	defer ws.mu.RUnlock()

	var txs []*Transaction
	for _, tx := range ws.userTransactions[userID] {
		if currency == "" || tx.Currency == currency {
			txs = append(txs, tx)
			if limit > 0 && len(txs) >= limit {
				break
			}
		}
	}

	return txs
}

// ============================================================================
// MULTI-SIG WALLETS
// ============================================================================

func (ws *WalletService) CreateMultiSigWallet(userID, currency string, threshold int, signers []string) (*Wallet, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if threshold < 2 || threshold > len(signers) {
		return nil, fmt.Errorf("invalid threshold")
	}

	// Generate multi-sig address
	address, _, err := ws.generateAddress(currency)
	if err != nil {
		return nil, err
	}

	walletID := fmt.Sprintf("multisig_%d_%s_%s", time.Now().UnixMilli(), userID[:8], currency)
	
	wallet := &Wallet{
		ID:                walletID,
		UserID:            userID,
		Type:              "multi-sig",
		Currency:          currency,
		Address:           address,
		Balance:           0,
		LockedBalance:     0,
		AvailableBalance:  0,
		Status:            WalletActive,
		IsMultiSig:        true,
		MultiSigThreshold: threshold,
		Signers:           signers,
		CreatedAt:         time.Now().UnixMilli(),
		UpdatedAt:         time.Now().UnixMilli(),
	}

	ws.wallets[walletID] = wallet
	ws.userWallets[userID] = append(ws.userWallets[userID], wallet)

	// Create multi-sig config
	msWallet := &MultiSigWallet{
		ID:          walletID,
		Threshold:   threshold,
		Signers:     signers,
		RequiredSigs: threshold,
		PendingTxs:  make([]*PendingTx, 0),
		CreatedAt:   time.Now().UnixMilli(),
	}

	ws.multiSigWallets[walletID] = msWallet

	return wallet, nil
}

func (ws *WalletService) CreateMultiSigTx(walletID, toAddress string, amount float64) (*PendingTx, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	msWallet, exists := ws.multiSigWallets[walletID]
	if !exists {
		return nil, fmt.Errorf("multi-sig wallet not found")
	}

	pendingTx := &PendingTx{
		TxID:      fmt.Sprintf("ms_tx_%d", time.Now().UnixNano()),
		ToAddress: toAddress,
		Amount:    amount,
		Currency:  ws.wallets[walletID].Currency,
		Signatures: make([]string, 0),
		Status:    "pending",
		CreatedAt: time.Now().UnixMilli(),
		ExpiresAt: time.Now().UnixMilli() + 24*60*60*1000, // 24 hours
	}

	msWallet.PendingTxs = append(msWallet.PendingTxs, pendingTx)

	return pendingTx, nil
}

func (ws *WalletService) AddMultiSigSignature(walletID, txID, signature string) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	msWallet, exists := ws.multiSigWallets[walletID]
	if !exists {
		return fmt.Errorf("multi-sig wallet not found")
	}

	for _, tx := range msWallet.PendingTxs {
		if tx.TxID == txID {
			tx.Signatures = append(tx.Signatures, signature)
			
			// Check if threshold reached
			if len(tx.Signatures) >= msWallet.RequiredSigs {
				tx.Status = "ready"
			}
			return nil
		}
	}

	return fmt.Errorf("transaction not found")
}

// ============================================================================
// COLD WALLET MANAGEMENT
// ============================================================================

func (ws *WalletService) SetColdWalletAddress(address string) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	ws.coldWalletAddress = address
}

func (ws *WalletService) GetColdWalletAddress() string {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	return ws.coldWalletAddress
}

func (ws *WalletService) ColdStorageTransfer(userID, currency string, amount float64) (*Transaction, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if ws.coldWalletAddress == "" {
		return nil, fmt.Errorf("cold wallet not configured")
	}

	// This would integrate with the main wallet service
	// For now, just return a mock transaction
	txID := fmt.Sprintf("tx_cold_%d_%s", time.Now().UnixMilli(), userID[:8])
	tx := &Transaction{
		ID:           txID,
		Type:         "cold_storage",
		Status:       "pending",
		Amount:       amount,
		Currency:     currency,
		ToAddress:    ws.coldWalletAddress,
		Timestamp:    time.Now().UnixMilli(),
	}

	ws.transactions[txID] = tx

	return tx, nil
}

func (ws *WalletService) HotWalletReplenishment() {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Logic to replenish hot wallet from cold storage
	// This would be called periodically
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Wallet Service v1.0")
	fmt.Println("Multi-currency wallet with hot/cold/multi-sig support")
	fmt.Println()

	ws := NewWalletService()

	// Create user wallets
	userID := "user123"
	currencies := []string{"BTC", "ETH", "USDT", "USDC"}

	for _, currency := range currencies {
		wallet, err := ws.CreateWallet(userID, currency, WalletTypeHot)
		if err != nil {
			fmt.Printf("Failed to create %s wallet: %v\n", currency, err)
			continue
		}
		fmt.Printf("Created %s wallet: %s (Address: %s)\n", currency, wallet.ID, wallet.Address)
	}

	// Test deposit
	fmt.Println()
	tx, err := ws.ProcessDeposit(userID, "BTC", 1.5, "0xabc123")
	if err != nil {
		fmt.Printf("Deposit failed: %v\n", err)
	} else {
		fmt.Printf("Deposit processed: %s (Amount: %.8f BTC)\n", tx.ID, tx.Amount)
	}

	// Check balance
	balance, locked, available, _ := ws.GetBalance("wallet_"+userID[:8]+"_BTC")
	fmt.Printf("Balance: %.8f BTC (Locked: %.8f, Available: %.8f)\n", balance, locked, available)

	fmt.Println()
	fmt.Println("Wallet Service initialized and ready!")
}

var _ = context.Background
var _ = rand.Reader