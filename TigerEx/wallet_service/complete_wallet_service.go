// =============================================================================
// TIGEREX v3.0 - COMPLETE WALLET SERVICE
// Hot, Cold, Multi-Sig wallet management
// =============================================================================

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// WALLET TYPES
// =============================================================================

type WalletType string
type WalletStatus string
type TransactionStatus string

const (
	WalletTypeHot     WalletType = "hot"
	WalletTypeCold    WalletType = "cold"
	WalletTypeWarm    WalletType = "warm"
	WalletTypeCustody WalletType = "custody"
	WalletTypeMultiSig WalletType = "multisig"
	WalletTypeMPC     WalletType = "mpc"

	WalletStatusActive    WalletStatus = "active"
	WalletStatusInactive  WalletStatus = "inactive"
	WalletStatusLocked    WalletStatus = "locked"
	WalletStatusSuspended WalletStatus = "suspended"

	TxStatusPending   TransactionStatus = "pending"
	TxStatusConfirming TransactionStatus = "confirming"
	TxStatusCompleted TransactionStatus = "completed"
	TxStatusFailed    TransactionStatus = "failed"
	TxStatusCanceled  TransactionStatus = "canceled"
)

// Wallet represents a user's wallet
type Wallet struct {
	WalletID       string       `json:"walletId"`
	UserID         string       `json:"userId"`
	Currency       string       `json:"currency"`
	Chain          string       `json:"chain"`
	Type           WalletType   `json:"type"`
	Status         WalletStatus `json:"status"`
	Address        string       `json:"address"`
	PublicKey      string       `json:"publicKey,omitempty"`
	Balance        float64      `json:"balance"`
	Available      float64      `json:"available"`
	Locked         float64      `json:"locked"`
	PendingDeposit float64      `json:"pendingDeposit"`
	PendingWithdraw float64     `json:"pendingWithdraw"`
	MinimumBalance float64      `json:"minimumBalance"`
	CreatedAt      int64        `json:"createdAt"`
	UpdatedAt      int64        `json:"updatedAt"`
}

// Transaction represents a blockchain transaction
type Transaction struct {
	TxID           string            `json:"txId"`
	UserID         string            `json:"userId"`
	WalletID      string            `json:"walletId"`
	Currency      string            `json:"currency"`
	Chain         string            `json:"chain"`
	Type          string            `json:"type"` // deposit, withdrawal, transfer, internal
	Direction     string            `json:"direction"` // in, out, internal
	Amount        float64           `json:"amount"`
	Fee           float64           `json:"fee"`
	NetAmount     float64           `json:"netAmount"`
	FromAddress   string            `json:"fromAddress"`
	ToAddress     string            `json:"toAddress"`
	TxHash        string            `json:"txHash,omitempty"`
	Status        TransactionStatus `json:"status"`
	Confirmations int              `json:"confirmations"`
	RequiredConfs int              `json:"requiredConfirmations"`
	Memo          string            `json:"memo,omitempty"`
	NetworkFee    float64           `json:"networkFee"`
	CreatedAt     int64             `json:"createdAt"`
	UpdatedAt     int64             `json:"updatedAt"`
	CompletedAt   int64            `json:"completedAt,omitempty"`
}

// WithdrawalRequest represents a withdrawal request
type WithdrawalRequest struct {
	UserID       string  `json:"userId"`
	Currency     string  `json:"currency"`
	Chain        string  `json:"chain"`
	Amount       float64 `json:"amount"`
	Address      string  `json:"address"`
	NetworkFee   float64 `json:"networkFee"`
	Memo         string  `json:"memo,omitempty"`
	TwoFactorCode string `json:"twoFactorCode"`
	IPAddress    string  `json:"ipAddress"`
}

// DepositAddress represents a generated deposit address
type DepositAddress struct {
	AddressID    string    `json:"addressId"`
	UserID       string    `json:"userId"`
	Currency     string    `json:"currency"`
	Chain        string    `json:"chain"`
	Address      string    `json:"address"`
	Label        string    `json:"label,omitempty"`
	Tag          string    `json:"tag,omitempty"` // For XRP, etc.
	IsUsed       bool      `json:"isUsed"`
	CreatedAt    int64     `json:"createdAt"`
	ExpiresAt    int64     `json:"expiresAt,omitempty"`
}

// =============================================================================
// WALLET SERVICE
// =============================================================================

type WalletService struct {
	mu sync.RWMutex

	// Wallets
	wallets     map[string]*Wallet // walletId -> Wallet
	userWallets map[string][]*Wallet // userId -> Wallets
	addresses   map[string]*Wallet // address -> Wallet

	// Transactions
	transactions map[string]*Transaction // txId -> Transaction
	userTxs      map[string][]*Transaction // userId -> Transactions

	// Deposit addresses
	depositAddresses map[string]*DepositAddress // address -> DepositAddress

	// Hot wallet addresses
	hotWallets map[string]*Wallet // currency -> Hot wallet

	// Cold wallet addresses
	coldWallets map[string]*Wallet // currency -> Cold wallet

	// Configuration
	config WalletConfig

	// Fee structure
	feeStructure map[string]*FeeConfig

	// Callbacks
	onDeposit     func(*Transaction)
	onWithdrawal  func(*Transaction)
	onTransfer    func(*Transaction)

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type WalletConfig struct {
	MinWithdrawal      float64
	MaxWithdrawal      float64
	DailyWithdrawalLimit float64
	MinDeposit         float64
	Confirmations      int
	HotWalletThreshold float64
	ColdWalletPercent  float64
	NetworkRetryLimit  int
	GasPriceRefresh    int64 // seconds
}

type FeeConfig struct {
	DepositFee    float64
	WithdrawFee   float64
	TransferFee   float64
	NetworkFeeMin float64
	NetworkFeeMax float64
}

// =============================================================================
// WALLET SERVICE METHODS
// =============================================================================

func NewWalletService() *WalletService {
	ctx, cancel := context.WithCancel(context.Background())

	service := &WalletService{
		wallets:         make(map[string]*Wallet),
		userWallets:     make(map[string][]*Wallet),
		addresses:       make(map[string]*Wallet),
		transactions:    make(map[string]*Transaction),
		userTxs:         make(map[string][]*Transaction),
		depositAddresses: make(map[string]*DepositAddress),
		hotWallets:      make(map[string]*Wallet),
		coldWallets:     make(map[string]*Wallet),
		ctx:             ctx,
		cancel:          cancel,
		config: WalletConfig{
			MinWithdrawal:      10,
			MaxWithdrawal:      1000000,
			DailyWithdrawalLimit: 5000000,
			MinDeposit:         0,
			Confirmations:      3,
			HotWalletThreshold: 1000000,
			ColdWalletPercent:  0.8,
			NetworkRetryLimit:  3,
			GasPriceRefresh:    60,
		},
		feeStructure: make(map[string]*FeeConfig),
	}

	// Initialize fee structures for common currencies
	service.initializeFeeStructures()

	// Start background workers
	service.startWorkers()

	return service
}

func (w *WalletService) initializeFeeStructures() {
	currencies := []string{"BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"}

	for _, currency := range currencies {
		w.feeStructure[currency] = &FeeConfig{
			DepositFee:    0,
			WithdrawFee:   0.0005, // 0.05%
			TransferFee:   0,
			NetworkFeeMin: 0.0001,
			NetworkFeeMax: 0.01,
		}
	}
}

func (w *WalletService) startWorkers() {
	// Transaction confirmation worker
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-w.ctx.Done():
				return
			case <-ticker.C:
				w.processConfirmations()
			}
		}
	}()

	// Balance sync worker
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-w.ctx.Done():
				return
			case <-ticker.C:
				w.syncBalances()
			}
		}
	}()
}

func (w *WalletService) Shutdown() {
	w.cancel()
	w.wg.Wait()
}

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

func (w *WalletService) CreateWallet(userID, currency, chain string, walletType WalletType) (*Wallet, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Check if wallet already exists
	for _, wallet := range w.userWallets[userID] {
		if wallet.Currency == currency && wallet.Chain == chain {
			return wallet, nil // Return existing wallet
		}
	}

	// Generate wallet address (simplified)
	address, err := w.generateAddress(currency, chain)
	if err != nil {
		return nil, err
	}

	walletID := uuid.New().String()[:16]

	wallet := &Wallet{
		WalletID:  walletID,
		UserID:    userID,
		Currency:  currency,
		Chain:     chain,
		Type:      walletType,
		Status:    WalletStatusActive,
		Address:   address,
		Balance:   0,
		Available: 0,
		Locked:    0,
		CreatedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}

	w.wallets[walletID] = wallet
	w.userWallets[userID] = append(w.userWallets[userID], wallet)
	w.addresses[address] = wallet

	log.Printf("[INFO] Wallet created: %s for user %s (%s %s)", walletID, userID, currency, chain)

	return wallet, nil
}

func (w *WalletService) generateAddress(currency, chain string) (string, error) {
	// Simplified address generation - in production would use proper key derivation
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", err
	}

	switch currency {
	case "BTC":
		if chain == "BTC" || chain == "" {
			return "bc1" + hex.EncodeToString(randomBytes)[:34], nil
		}
	case "ETH", "USDT", "USDC":
		if chain == "ETH" || chain == "ERC20" {
			return "0x" + hex.EncodeToString(randomBytes), nil
		}
	case "XRP":
		return "r" + hex.EncodeToString(randomBytes)[:24], nil
	case "SOL":
		return hex.EncodeToString(randomBytes)[:44], nil
	default:
		return hex.EncodeToString(randomBytes)[:40], nil
	}

	return hex.EncodeToString(randomBytes), nil
}

func (w *WalletService) GetWallet(walletID string) (*Wallet, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if wallet, ok := w.wallets[walletID]; ok {
		return wallet, nil
	}
	return nil, errors.New("wallet not found")
}

func (w *WalletService) GetUserWallets(userID string) []*Wallet {
	w.mu.RLock()
	defer w.mu.RUnlock()

	return w.userWallets[userID]
}

func (w *WalletService) GetWalletByAddress(address string) (*Wallet, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if wallet, ok := w.addresses[address]; ok {
		return wallet, nil
	}
	return nil, errors.New("wallet not found")
}

// =============================================================================
// BALANCE MANAGEMENT
// =============================================================================

func (w *WalletService) GetBalance(userID, currency, chain string) (float64, float64, float64) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	for _, wallet := range w.userWallets[userID] {
		if wallet.Currency == currency && (chain == "" || wallet.Chain == chain) {
			return wallet.Balance, wallet.Available, wallet.Locked
		}
	}

	return 0, 0, 0
}

func (w *WalletService) GetAllBalances(userID string) map[string]float64 {
	w.mu.RLock()
	defer w.mu.RUnlock()

	balances := make(map[string]float64)
	for _, wallet := range w.userWallets[userID] {
		key := wallet.Currency
		if wallet.Chain != "" && wallet.Chain != wallet.Currency {
			key = wallet.Currency + "-" + wallet.Chain
		}
		balances[key] = wallet.Balance
	}

	return balances
}

func (w *WalletService) LockFunds(userID, currency string, amount float64) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	wallet := w.findUserWallet(userID, currency, "")
	if wallet == nil {
		return errors.New("wallet not found")
	}

	if wallet.Available < amount {
		return errors.New("insufficient available balance")
	}

	wallet.Available -= amount
	wallet.Locked += amount
	wallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Locked %.8f %s for user %s", amount, currency, userID)
	return nil
}

func (w *WalletService) UnlockFunds(userID, currency string, amount float64) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	wallet := w.findUserWallet(userID, currency, "")
	if wallet == nil {
		return errors.New("wallet not found")
	}

	if wallet.Locked < amount {
		return errors.New("insufficient locked balance")
	}

	wallet.Locked -= amount
	wallet.Available += amount
	wallet.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Unlocked %.8f %s for user %s", amount, currency, userID)
	return nil
}

func (w *WalletService) findUserWallet(userID, currency, chain string) *Wallet {
	for _, wallet := range w.userWallets[userID] {
		if wallet.Currency == currency && (chain == "" || wallet.Chain == chain) {
			return wallet
		}
	}
	return nil
}

// =============================================================================
// DEPOSIT MANAGEMENT
// =============================================================================

func (w *WalletService) GenerateDepositAddress(userID, currency, chain string) (*DepositAddress, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Find or create wallet
	wallet := w.findUserWallet(userID, currency, chain)
	if wallet == nil {
		wallet, _ = w.CreateWallet(userID, currency, chain, WalletTypeHot)
	}

	// Generate new address
	address, err := w.generateAddress(currency, chain)
	if err != nil {
		return nil, err
	}

	depositAddr := &DepositAddress{
		AddressID: uuid.New().String()[:16],
		UserID:    userID,
		Currency:  currency,
		Chain:     chain,
		Address:   address,
		IsUsed:    false,
		CreatedAt: time.Now().UnixMilli(),
	}

	w.depositAddresses[address] = depositAddr

	log.Printf("[INFO] Generated deposit address for %s: %s", currency, address)
	return depositAddr, nil
}

func (w *WalletService) GetDepositAddress(userID, currency, chain string) (*DepositAddress, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	// Try to find existing unused address
	for _, addr := range w.depositAddresses {
		if addr.UserID == userID && addr.Currency == currency && addr.Chain == chain && !addr.IsUsed {
			return addr, nil
		}
	}

	return nil, errors.New("no deposit address found")
}

func (w *WalletService) ProcessDeposit(userID, currency, chain, txHash string, amount float64, fromAddress string) (*Transaction, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Find or create wallet
	wallet := w.findUserWallet(userID, currency, chain)
	if wallet == nil {
		wallet, _ = w.CreateWallet(userID, currency, chain, WalletTypeHot)
	}

	txID := uuid.New().String()[:16]

	tx := &Transaction{
		TxID:            txID,
		UserID:          userID,
		WalletID:        wallet.WalletID,
		Currency:       currency,
		Chain:           chain,
		Type:            "deposit",
		Direction:       "in",
		Amount:          amount,
		Fee:             0,
		NetAmount:       amount,
		FromAddress:     fromAddress,
		ToAddress:       wallet.Address,
		TxHash:          txHash,
		Status:          TxStatusConfirming,
		Confirmations:   0,
		RequiredConfs:   w.config.Confirmations,
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
	}

	w.transactions[txID] = tx
	w.userTxs[userID] = append(w.userTxs, tx)

	// Mark deposit address as used
	if addr, ok := w.depositAddresses[wallet.Address]; ok {
		addr.IsUsed = true
	}

	// Update wallet pending deposit
	wallet.PendingDeposit += amount

	log.Printf("[INFO] Deposit processing: %s %s %.8f tx: %s", txID, currency, amount, txHash)

	if w.onDeposit != nil {
		w.onDeposit(tx)
	}

	return tx, nil
}

func (w *WalletService) ConfirmDeposit(txID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	tx, ok := w.transactions[txID]
	if !ok {
		return errors.New("transaction not found")
	}

	tx.Confirmations++

	if tx.Confirmations >= tx.RequiredConfs {
		tx.Status = TxStatusCompleted
		tx.CompletedAt = time.Now().UnixMilli()

		// Update wallet balance
		if wallet, ok := w.wallets[tx.WalletID]; ok {
			wallet.Balance += tx.NetAmount
			wallet.Available += tx.NetAmount
			wallet.PendingDeposit -= tx.Amount
			wallet.UpdatedAt = time.Now().UnixMilli()
		}

		log.Printf("[INFO] Deposit confirmed: %s", txID)
	}

	tx.UpdatedAt = time.Now().UnixMilli()
	return nil
}

// =============================================================================
// WITHDRAWAL MANAGEMENT
// =============================================================================

func (w *WalletService) ProcessWithdrawal(req *WithdrawalRequest) (*Transaction, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Find user wallet
	wallet := w.findUserWallet(req.UserID, req.Currency, req.Chain)
	if wallet == nil {
		return nil, errors.New("wallet not found")
	}

	// Get fee config
	feeConfig := w.feeStructure[req.Currency]
	if feeConfig == nil {
		feeConfig = &FeeConfig{WithdrawFee: 0.0005}
	}

	// Calculate total amount including fees
	totalAmount := req.Amount + req.NetworkFee + (req.Amount * feeConfig.WithdrawFee)

	// Check available balance
	if wallet.Available < totalAmount {
		return nil, errors.New("insufficient balance")
	}

	txID := uuid.New().String()[:16]

	tx := &Transaction{
		TxID:          txID,
		UserID:        req.UserID,
		WalletID:      wallet.WalletID,
		Currency:      req.Currency,
		Chain:         req.Chain,
		Type:          "withdrawal",
		Direction:     "out",
		Amount:        req.Amount,
		Fee:           req.Amount * feeConfig.WithdrawFee,
		NetAmount:     req.Amount,
		NetworkFee:    req.NetworkFee,
		FromAddress:   wallet.Address,
		ToAddress:     req.Address,
		Memo:          req.Memo,
		Status:        TxStatusPending,
		RequiredConfs: w.config.Confirmations,
		CreatedAt:     time.Now().UnixMilli(),
		UpdatedAt:    time.Now().UnixMilli(),
	}

	// Lock funds
	wallet.Available -= totalAmount
	wallet.Locked += totalAmount
	wallet.PendingWithdraw += req.Amount
	wallet.UpdatedAt = time.Now().UnixMilli()

	w.transactions[txID] = tx
	w.userTxs[req.UserID] = append(w.userTxs, tx)

	log.Printf("[INFO] Withdrawal created: %s %s %.8f to %s", txID, req.Currency, req.Amount, req.Address)

	if w.onWithdrawal != nil {
		w.onWithdrawal(tx)
	}

	return tx, nil
}

func (w *WalletService) ApproveWithdrawal(txID string, signed bool) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	tx, ok := w.transactions[txID]
	if !ok {
		return errors.New("transaction not found")
	}

	if tx.Status != TxStatusPending {
		return errors.New("invalid transaction status")
	}

	if signed {
		// In production, would initiate blockchain transaction here
		tx.Status = TxStatusConfirming
		log.Printf("[INFO] Withdrawal approved: %s", txID)
	} else {
		// Reject and return funds
		tx.Status = TxStatusFailed

		if wallet, ok := w.wallets[tx.WalletID]; ok {
			totalAmount := tx.Amount + tx.NetworkFee + tx.Fee
			wallet.Locked -= totalAmount
			wallet.Available += totalAmount
			wallet.PendingWithdraw -= tx.Amount
		}

		log.Printf("[INFO] Withdrawal rejected: %s", txID)
	}

	tx.UpdatedAt = time.Now().UnixMilli()
	return nil
}

func (w *WalletService) CompleteWithdrawal(txID string, txHash string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	tx, ok := w.transactions[txID]
	if !ok {
		return errors.New("transaction not found")
	}

	tx.TxHash = txHash
	tx.Status = TxStatusCompleted
	tx.CompletedAt = time.Now().UnixMilli()

	// Update wallet
	if wallet, ok := w.wallets[tx.WalletID]; ok {
		totalAmount := tx.Amount + tx.NetworkFee + tx.Fee
		wallet.Locked -= totalAmount
		wallet.PendingWithdraw -= tx.Amount
	}

	log.Printf("[INFO] Withdrawal completed: %s tx: %s", txID, txHash)
	return nil
}

// =============================================================================
// INTERNAL TRANSFERS
// =============================================================================

func (w *WalletService) InternalTransfer(fromUserID, toUserID, currency, chain string, amount float64) (*Transaction, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Find wallets
	fromWallet := w.findUserWallet(fromUserID, currency, chain)
	toWallet := w.findUserWallet(toUserID, currency, chain)

	if fromWallet == nil || toWallet == nil {
		return nil, errors.New("wallet not found")
	}

	if fromWallet.Available < amount {
		return nil, errors.New("insufficient balance")
	}

	txID := uuid.New().String()[:16]

	tx := &Transaction{
		TxID:        txID,
		UserID:      fromUserID,
		WalletID:    fromWallet.WalletID,
		Currency:    currency,
		Chain:       chain,
		Type:        "transfer",
		Direction:   "internal",
		Amount:      amount,
		Fee:         0,
		NetAmount:   amount,
		FromAddress: fromWallet.Address,
		ToAddress:   toWallet.Address,
		Status:      TxStatusCompleted,
		CreatedAt:   time.Now().UnixMilli(),
		UpdatedAt:   time.Now().UnixMilli(),
		CompletedAt: time.Now().UnixMilli(),
	}

	// Update balances
	fromWallet.Available -= amount
	fromWallet.Balance -= amount

	toWallet.Balance += amount
	toWallet.Available += amount

	w.transactions[txID] = tx
	w.userTxs[fromUserID] = append(w.userTxs, tx)
	w.userTxs[toUserID] = append(w.userTxs, tx)

	log.Printf("[INFO] Internal transfer: %s %s %.8f from %s to %s", txID, currency, amount, fromUserID, toUserID)

	if w.onTransfer != nil {
		w.onTransfer(tx)
	}

	return tx, nil
}

// =============================================================================
// TRANSACTION QUERIES
// =============================================================================

func (w *WalletService) GetTransaction(txID string) (*Transaction, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if tx, ok := w.transactions[txID]; ok {
		return tx, nil
	}
	return nil, errors.New("transaction not found")
}

func (w *WalletService) GetUserTransactions(userID string, limit int) []*Transaction {
	w.mu.RLock()
	defer w.mu.RUnlock()

	txs := w.userTxs[userID]
	if limit > 0 && len(txs) > limit {
		return txs[len(txs)-limit:]
	}
	return txs
}

func (w *WalletService) GetTransactionHistory(userID, currency, txType string, limit int) []*Transaction {
	w.mu.RLock()
	defer w.mu.RUnlock()

	var txs []*Transaction
	for _, tx := range w.userTxs[userID] {
		if currency != "" && tx.Currency != currency {
			continue
		}
		if txType != "" && tx.Type != txType {
			continue
		}
		txs = append(txs, tx)
	}

	// Sort by created_at descending
	// In production would use proper sorting

	if limit > 0 && len(txs) > limit {
		return txs[len(txs)-limit:]
	}
	return txs
}

// =============================================================================
// HOT/COLD WALLET MANAGEMENT
// =============================================================================

func (w *WalletService) InitializeHotWallet(currency, chain string) (*Wallet, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	key := currency + "-" + chain

	address, err := w.generateAddress(currency, chain)
	if err != nil {
		return nil, err
	}

	wallet := &Wallet{
		WalletID:       "hot-" + key,
		UserID:          "system",
		Currency:        currency,
		Chain:           chain,
		Type:            WalletTypeHot,
		Status:          WalletStatusActive,
		Address:         address,
		MinimumBalance:  1000, // Minimum balance to maintain
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
	}

	w.hotWallets[key] = wallet
	w.addresses[address] = wallet

	log.Printf("[INFO] Hot wallet initialized: %s %s", currency, chain)
	return wallet, nil
}

func (w *WalletService) InitializeColdWallet(currency, chain string) (*Wallet, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	key := currency + "-" + chain

	address, err := w.generateAddress(currency, chain)
	if err != nil {
		return nil, err
	}

	wallet := &Wallet{
		WalletID:       "cold-" + key,
		UserID:          "system",
		Currency:        currency,
		Chain:           chain,
		Type:            WalletTypeCold,
		Status:          WalletStatusActive,
		Address:         address,
		MinimumBalance:  0,
		CreatedAt:       time.Now().UnixMilli(),
		UpdatedAt:       time.Now().UnixMilli(),
	}

	w.coldWallets[key] = wallet
	w.addresses[address] = wallet

	log.Printf("[INFO] Cold wallet initialized: %s %s", currency, chain)
	return wallet, nil
}

func (w *WalletService) SweepToCold(currency string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	key := currency + "-" + currency // simplified

	hotWallet := w.hotWallets[key]
	coldWallet := w.coldWallets[key]

	if hotWallet == nil || coldWallet == nil {
		return errors.New("wallet not found")
	}

	// Calculate amount to sweep (everything above minimum)
	sweepAmount := hotWallet.Balance - hotWallet.MinimumBalance
	if sweepAmount <= 0 {
		return nil
	}

	// In production, would create blockchain transaction
	// For now, just update balances
	hotWallet.Balance -= sweepAmount
	hotWallet.Available -= sweepAmount
	coldWallet.Balance += sweepAmount

	log.Printf("[INFO] Swept %.8f %s to cold wallet", sweepAmount, currency)
	return nil
}

// =============================================================================
// BACKGROUND WORKERS
// =============================================================================

func (w *WalletService) processConfirmations() {
	w.mu.Lock()
	defer w.mu.Unlock()

	for _, tx := range w.transactions {
		if tx.Status == TxStatusConfirming && tx.Confirmations < tx.RequiredConfs {
			// In production, would query blockchain for confirmations
			// For demo, just increment
			tx.Confirmations++

			if tx.Confirmations >= tx.RequiredConfs {
				tx.Status = TxStatusCompleted
				tx.CompletedAt = time.Now().UnixMilli()

				// Update wallet balance
				if wallet, ok := w.wallets[tx.WalletID]; ok {
					if tx.Direction == "in" {
						wallet.Balance += tx.NetAmount
						wallet.Available += tx.NetAmount
						wallet.PendingDeposit -= tx.Amount
					} else if tx.Direction == "out" {
						wallet.Locked -= (tx.Amount + tx.NetworkFee + tx.Fee)
						wallet.PendingWithdraw -= tx.Amount
					}
				}
			}

			tx.UpdatedAt = time.Now().UnixMilli()
		}
	}
}

func (w *WalletService) syncBalances() {
	w.mu.Lock()
	defer w.mu.Unlock()

	// In production, would sync with actual blockchain nodes
	// For now, just update timestamps
	for _, wallet := range w.wallets {
		wallet.UpdatedAt = time.Now().UnixMilli()
	}
}

// =============================================================================
// UTILITIES
// =============================================================================

func (w *WalletService) GetStats() map[string]interface{} {
	w.mu.RLock()
	defer w.mu.RUnlock()

	totalWallets := len(w.wallets)
	totalTransactions := len(w.transactions)

	var totalVolume float64
	for _, tx := range w.transactions {
		totalVolume += tx.Amount
	}

	return map[string]interface{}{
		"total_wallets":      totalWallets,
		"total_transactions": totalTransactions,
		"total_volume":       totalVolume,
		"hot_wallets":        len(w.hotWallets),
		"cold_wallets":       len(w.coldWallets),
	}
}

// Placeholder for unused imports
var _ = ed25519.PublicKey{}
var _ = sha256.Sum256{}