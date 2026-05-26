package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// WALLET TYPES
// ============================================================================

type WalletType string

const (
	WalletTypeSpot     WalletType = "spot"
	WalletTypeFunding  WalletType = "funding"
	WalletTypeMargin  WalletType = "margin"
	WalletTypeEarn    WalletType = "earn"
)

type TransactionType string

const (
	TxTypeDeposit    TransactionType = "deposit"
	TxTypeWithdrawal TransactionType = "withdrawal"
	TxTypeTransfer   TransactionType = "transfer"
	TxTypeTrade     TransactionType = "trade"
	TxTypeFee       TransactionType = "fee"
	TxTypeReward    TransactionType = "reward"
	TxTypeAdjustment TransactionType = "adjustment"
)

type TransactionStatus string

const (
	TxStatusPending   TransactionStatus = "pending"
	TxStatusProcessing TransactionStatus = "processing"
	TxStatusCompleted TransactionStatus = "completed"
	TxStatusFailed   TransactionStatus = "failed"
	TxStatusCancelled TransactionStatus = "cancelled"
)

type Wallet struct {
	WalletID      string    `json:"walletId"`
	UserID        string    `json:"userId"`
	Asset         string    `json:"asset"`
	WalletType    WalletType `json:"walletType"`
	Balance       float64   `json:"balance"`
	LockedBalance float64   `json:"lockedBalance"`
	FrozenBalance float64   `json:"frozenBalance"`
	UpdatedAt     int64     `json:"updatedAt"`
}

type Transaction struct {
	TxID         string           `json:"txId"`
	UserID       string           `json:"userId"`
	WalletID     string           `json:"walletId"`
	Type         TransactionType  `json:"type"`
	Status       TransactionStatus `json:"status"`
	Asset        string           `json:"asset"`
	Amount       float64          `json:"amount"`
	Fee          float64          `json:"fee"`
	NetAmount    float64          `json:"netAmount"`
	FromAddress  string          `json:"fromAddress,omitempty"`
	ToAddress    string          `json:"toAddress,omitempty"`
	TxHash       string          `json:"txHash,omitempty"`
	Reference    string          `json:"reference,omitempty"`
	CreatedAt    int64           `json:"createdAt"`
	CompletedAt  int64           `json:"completedAt,omitempty"`
	FailureReason string         `json:"failureReason,omitempty"`
}

// ============================================================================
// WALLET MANAGER
// ============================================================================

type WalletManager struct {
	mu sync.RWMutex

	// Wallets: userID + asset + type -> Wallet
	wallets map[string]*Wallet

	// Transactions
	transactions map[string]*Transaction
	userTxs     map[string][]string // userID -> txIDs

	// Withdrawal limits
	WithdrawalLimits map[string]float64 // asset -> min withdrawal
	WithdrawalFees   map[string]float64 // asset -> fee

	// Metrics
	TotalDeposits   int64 `json:"totalDeposits"`
	TotalWithdrawals int64 `json:"totalWithdrawals"`
	TotalTransfers  int64 `json:"totalTransfers"`
}

func NewWalletManager() *WalletManager {
	return &WalletManager{
		wallets:         make(map[string]*Wallet),
		transactions:    make(map[string]*Transaction),
		userTxs:        make(map[string][]string),
		WithdrawalLimits: map[string]float64{
			"BTC":  0.001,
			"ETH":  0.01,
			"USDT": 10,
		},
		WithdrawalFees: map[string]float64{
			"BTC":  0.0005,
			"ETH":  0.005,
			"USDT": 1,
		},
	}
}

func (wm *WalletManager) walletKey(userID, asset string, wtype WalletType) string {
	return fmt.Sprintf("%s:%s:%s", userID, asset, wtype)
}

// GetOrCreateWallet gets or creates a wallet
func (wm *WalletManager) GetOrCreateWallet(userID, asset string, wtype WalletType) *Wallet {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	key := wm.walletKey(userID, asset, wtype)
	
	wallet, exists := wm.wallets[key]
	if !exists {
		wallet = &Wallet{
			WalletID:      uuid.New().String(),
			UserID:        userID,
			Asset:         asset,
			WalletType:    wtype,
			Balance:       0,
			LockedBalance: 0,
			FrozenBalance: 0,
			UpdatedAt:     time.Now().UnixMilli(),
		}
		wm.wallets[key] = wallet
	}

	return wallet
}

// GetBalance returns available balance
func (wm *WalletManager) GetBalance(userID, asset string) float64 {
	wallet := wm.GetOrCreateWallet(userID, asset, WalletTypeSpot)
	return wallet.Balance - wallet.LockedBalance - wallet.FrozenBalance
}

// GetFullBalance returns full balance info
func (wm *WalletManager) GetFullBalance(userID, asset string) map[string]interface{} {
	wallet := wm.GetOrCreateWallet(userID, asset, WalletTypeSpot)
	return map[string]interface{}{
		"balance":        wallet.Balance,
		"lockedBalance":  wallet.LockedBalance,
		"frozenBalance": wallet.FrozenBalance,
		"available":      wallet.Balance - wallet.LockedBalance - wallet.FrozenBalance,
	}
}

// Credit adds funds to wallet
func (wm *WalletManager) Credit(userID, asset string, amount float64, txType TransactionType, reference string) (*Transaction, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	wallet := wm.GetOrCreateWallet(userID, asset, WalletTypeSpot)
	
	// Create transaction
	tx := &Transaction{
		TxID:      uuid.New().String(),
		UserID:     userID,
		WalletID:  wallet.WalletID,
		Type:      txType,
		Status:    TxStatusCompleted,
		Asset:     asset,
		Amount:    amount,
		Fee:       0,
		NetAmount: amount,
		Reference: reference,
		CreatedAt: time.Now().UnixMilli(),
		CompletedAt: time.Now().UnixMilli(),
	}

	// Credit wallet
	wallet.Balance += amount
	wallet.UpdatedAt = time.Now().UnixMilli()

	// Store transaction
	wm.transactions[tx.TxID] = tx
	wm.userTxs[userID] = append(wm.userTxs[userID], tx.TxID)

	// Update metrics
	if txType == TxTypeDeposit {
		atomic.AddInt64(&wm.TotalDeposits, 1)
	}

	return tx, nil
}

// Debit removes funds from wallet
func (wm *WalletManager) Debit(userID, asset string, amount float64, txType TransactionType, reference string) (*Transaction, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	wallet := wm.GetOrCreateWallet(userID, asset, WalletTypeSpot)
	available := wallet.Balance - wallet.LockedBalance - wallet.FrozenBalance

	if available < amount {
		return nil, fmt.Errorf("insufficient balance: have %.8f, need %.8f", available, amount)
	}

	// Create transaction
	tx := &Transaction{
		TxID:      uuid.New().String(),
		UserID:     userID,
		WalletID:  wallet.WalletID,
		Type:      txType,
		Status:    TxStatusCompleted,
		Asset:     asset,
		Amount:    amount,
		Fee:       0,
		NetAmount: amount,
		Reference: reference,
		CreatedAt: time.Now().UnixMilli(),
		CompletedAt: time.Now().UnixMilli(),
	}

	// Debit wallet
	wallet.Balance -= amount
	wallet.UpdatedAt = time.Now().UnixMilli()

	// Store transaction
	wm.transactions[tx.TxID] = tx
	wm.userTxs[userID] = append(wm.userTxs[userID], tx.TxID)

	// Update metrics
	if txType == TxTypeWithdrawal {
		atomic.AddInt64(&wm.TotalWithdrawals, 1)
	}

	return tx, nil
}

// CreateWithdrawal creates withdrawal request
func (wm *WalletManager) CreateWithdrawal(userID, asset, toAddress string, amount float64) (*Transaction, error) {
	// Check minimum
	minWithdrawal := wm.WithdrawalLimits[asset]
	if minWithdrawal == 0 {
		minWithdrawal = 0.0001
	}

	if amount < minWithdrawal {
		return nil, fmt.Errorf("minimum withdrawal for %s is %.8f", asset, minWithdrawal)
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	wallet := wm.GetOrCreateWallet(userID, asset, WalletTypeSpot)
	available := wallet.Balance - wallet.LockedBalance - wallet.FrozenBalance

	if available < amount {
		return nil, fmt.Errorf("insufficient balance")
	}

	// Calculate fee
	fee := wm.WithdrawalFees[asset]
	if fee == 0 {
		fee = 0.0001
	}

	netAmount := amount - fee

	// Freeze funds
	wallet.LockedBalance += amount

	// Create transaction
	tx := &Transaction{
		TxID:        uuid.New().String(),
		UserID:      userID,
		WalletID:    wallet.WalletID,
		Type:        TxTypeWithdrawal,
		Status:      TxStatusPending,
		Asset:       asset,
		Amount:      amount,
		Fee:         fee,
		NetAmount:   netAmount,
		ToAddress:   toAddress,
		Reference:   fmt.Sprintf("WD-%d", time.Now().Unix()),
		CreatedAt:   time.Now().UnixMilli(),
	}

	// Store transaction
	wm.transactions[tx.TxID] = tx
	wm.userTxs[userID] = append(wm.userTxs[userID], tx.TxID)

	atomic.AddInt64(&wm.TotalWithdrawals, 1)

	return tx, nil
}

// ConfirmWithdrawal confirms withdrawal after blockchain confirmation
func (wm *WalletManager) ConfirmWithdrawal(txID, txHash string) error {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	tx, exists := wm.transactions[txID]
	if !exists {
		return fmt.Errorf("transaction not found")
	}

	if tx.Status != TxStatusPending {
		return fmt.Errorf("transaction not pending")
	}

	// Update transaction
	tx.Status = TxStatusCompleted
	tx.TxHash = txHash
	tx.CompletedAt = time.Now().UnixMilli()

	// Update wallet
	wallet, exists := wm.wallets[wm.walletKey(tx.UserID, tx.Asset, WalletTypeSpot)]
	if exists {
		wallet.Balance -= tx.Amount
		wallet.LockedBalance -= tx.Amount
		wallet.UpdatedAt = time.Now().UnixMilli()
	}

	return nil
}

// CancelWithdrawal cancels pending withdrawal
func (wm *WalletManager) CancelWithdrawal(txID string) error {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	tx, exists := wm.transactions[txID]
	if !exists {
		return fmt.Errorf("transaction not found")
	}

	if tx.Status != TxStatusPending {
		return fmt.Errorf("transaction not pending")
	}

	// Cancel transaction
	tx.Status = TxStatusCancelled
	tx.CompletedAt = time.Now().UnixMilli()

	// Unlock funds
	wallet, exists := wm.wallets[wm.walletKey(tx.UserID, tx.Asset, WalletTypeSpot)]
	if exists {
		wallet.LockedBalance -= tx.Amount
		wallet.UpdatedAt = time.Now().UnixMilli()
	}

	return nil
}

// Transfer performs internal transfer
func (wm *WalletManager) Transfer(fromUser, toUser, asset string, amount float64) (*Transaction, *Transaction, error) {
	if amount <= 0 {
		return nil, nil, fmt.Errorf("invalid amount")
	}

	wm.mu.Lock()
	defer wm.mu.Unlock()

	// Check sender balance
	fromWallet := wm.GetOrCreateWallet(fromUser, asset, WalletTypeSpot)
	available := fromWallet.Balance - fromWallet.LockedBalance - fromWallet.FrozenBalance

	if available < amount {
		return nil, nil, fmt.Errorf("insufficient balance")
	}

	// Debit sender
	fromWallet.Balance -= amount

	// Credit receiver
	toWallet := wm.GetOrCreateWallet(toUser, asset, WalletTypeSpot)
	toWallet.Balance += amount

	// Create transactions
	now := time.Now().UnixMilli()

	senderTx := &Transaction{
		TxID:       uuid.New().String(),
		UserID:     fromUser,
		WalletID:   fromWallet.WalletID,
		Type:       TxTypeTransfer,
		Status:     TxStatusCompleted,
		Asset:      asset,
		Amount:     amount,
		Fee:        0,
		NetAmount:  amount,
		ToAddress:  toUser,
		CreatedAt: now,
		CompletedAt: now,
	}

	receiverTx := &Transaction{
		TxID:       uuid.New().String(),
		UserID:     toUser,
		WalletID:   toWallet.WalletID,
		Type:       TxTypeTransfer,
		Status:     TxStatusCompleted,
		Asset:      asset,
		Amount:     amount,
		Fee:        0,
		NetAmount:  amount,
		FromAddress: fromUser,
		CreatedAt: now,
		CompletedAt: now,
	}

	// Store transactions
	wm.transactions[senderTx.TxID] = senderTx
	wm.transactions[receiverTx.TxID] = receiverTx
	wm.userTxs[fromUser] = append(wm.userTxs[fromUser], senderTx.TxID)
	wm.userTxs[toUser] = append(wm.userTxs[toUser], receiverTx.TxID)

	atomic.AddInt64(&wm.TotalTransfers, 2)

	return senderTx, receiverTx, nil
}

// GetTransaction returns transaction by ID
func (wm *WalletManager) GetTransaction(txID string) (*Transaction, error) {
	tx, exists := wm.transactions[txID]
	if !exists {
		return nil, fmt.Errorf("transaction not found")
	}
	return tx, nil
}

// GetUserTransactions returns user's transaction history
func (wm *WalletManager) GetUserTransactions(userID string, limit int) []*Transaction {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	txIDs := wm.userTxs[userID]
	if len(txIDs) == 0 {
		return []*Transaction{}
	}

	// Get last 'limit' transactions
	start := 0
	if len(txIDs) > limit {
		start = len(txIDs) - limit
	}

	txs := make([]*Transaction, 0, limit)
	for i := start; i < len(txIDs); i++ {
		if tx, ok := wm.transactions[txIDs[i]]; ok {
			txs = append(txs, tx)
		}
	}

	return txs
}

// GetAllBalances returns all balances for user
func (wm *WalletManager) GetAllBalances(userID string) map[string]interface{} {
	wm.mu.RLock()
	defer wm.mu.RUnlock()

	balances := make(map[string]interface{})

	for key, wallet := range wm.wallets {
		if wallet.UserID == userID {
			balances[wallet.Asset] = map[string]interface{}{
				"balance":        wallet.Balance,
				"lockedBalance":  wallet.LockedBalance,
				"available":      wallet.Balance - wallet.LockedBalance - wallet.FrozenBalance,
			}
		}
	}

	return balances
}

// GetMetrics returns wallet metrics
func (wm *WalletManager) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"totalWallets":     len(wm.wallets),
		"totalTransactions": len(wm.transactions),
		"totalDeposits":    atomic.LoadInt64(&wm.TotalDeposits),
		"totalWithdrawals": atomic.LoadInt64(&wm.TotalWithdrawals),
		"totalTransfers":  atomic.LoadInt64(&wm.TotalTransfers),
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Wallet Manager (Go)")
	fmt.Println("==============================\n")

	wm := NewWalletManager()

	// Credit some funds
	tx1, err := wm.Credit("user1", "BTC", 1.5, TxTypeDeposit, "initial-deposit")
	if err != nil {
		log.Printf("Credit error: %v", err)
	} else {
		fmt.Printf("Credit: %s - %.8f BTC\n", tx1.TxID[:8], tx1.Amount)
	}

	tx2, err := wm.Credit("user1", "USDT", 50000, TxTypeDeposit, "initial-deposit")
	if err != nil {
		log.Printf("Credit error: %v", err)
	} else {
		fmt.Printf("Credit: %s - %.2f USDT\n", tx2.TxID[:8], tx2.Amount)
	}

	// Check balance
	balance := wm.GetBalance("user1", "BTC")
	fmt.Printf("\nBTC Balance: %.8f\n", balance)

	// Full balance
	full := wm.GetFullBalance("user1", "BTC")
	fullJSON, _ := json.MarshalIndent(full, "", "  ")
	fmt.Printf("Full Balance: %s\n", string(fullJSON))

	// All balances
	all := wm.GetAllBalances("user1")
	allJSON, _ := json.MarshalIndent(all, "", "  ")
	fmt.Printf("\nAll Balances:\n%s\n", string(allJSON))

	// Create withdrawal
	wdTx, err := wm.CreateWithdrawal("user1", "BTC", "bc1q...", 0.5)
	if err != nil {
		log.Printf("Withdrawal error: %v", err)
	} else {
		fmt.Printf("\nWithdrawal: %s - %.8f BTC\n", wdTx.TxID[:8], wdTx.Amount)
	}

	// Transfer
	_, receiverTx, err := wm.Transfer("user1", "user2", "USDT", 1000)
	if err != nil {
		log.Printf("Transfer error: %v", err)
	} else {
		fmt.Printf("\nTransfer: %s received %.2f USDT\n", receiverTx.TxID[:8], receiverTx.Amount)
	}

	// Get transactions
	txs := wm.GetUserTransactions("user1", 10)
	fmt.Printf("\nUser Transactions: %d\n", len(txs))
	for _, tx := range txs {
		fmt.Printf("  %s - %s - %.8f %s\n", tx.TxID[:8], tx.Type, tx.Amount, tx.Asset)
	}

	// Metrics
	metrics := wm.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nWallet Manager ready.")
}