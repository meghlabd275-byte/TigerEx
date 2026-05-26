package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// Wallet type enumeration
type WalletType string

const (
	WalletTypeSpot     WalletType = "spot"
	WalletTypeMargin   WalletType = "margin"
	WalletTypeFutures  WalletType = "futures"
	WalletTypeEarn    WalletType = "earn"
	WalletTypeFee     WalletType = "fee"
	WalletTypeCollateral WalletType = "collateral"
)

// Transaction type
type TransactionType string

const (
	TypeDeposit    TransactionType = "deposit"
	TypeWithdrawal TransactionType = "withdrawal"
	TypeTransfer  TransactionType = "transfer"
	TypeTrade     TransactionType = "trade"
	TypeFee      TransactionType = "fee"
	TypeReward   TransactionType = "reward"
	TypeStaking  TransactionType = "staking"
	TypeEarn    TransactionType = "earn"
	TypeReferral TransactionType = "referral"
)

// Transaction status
type TransactionStatus string

const (
	StatusPending   TransactionStatus = "pending"
	StatusProcessing TransactionStatus = "processing"
	StatusCompleted TransactionStatus = "completed"
	StatusFailed    TransactionStatus = "failed"
	StatusCancelled TransactionStatus = "cancelled"
)

// Wallet entity
type Wallet struct {
	ID           string     `json:"id"`
	UserID       string     `json:"userId"`
	Type         WalletType `json:"type"`
	Asset        string    `json:"asset"`
	Balance     float64   `json:"balance"`
	LockedBalance float64 `json:"lockedBalance"`
	UpdatedAt   int64     `json:"updatedAt"`
}

// Transaction entity
type Transaction struct {
	ID         string           `json:"id"`
	UserID     string           `json:"userId"`
	WalletID   string           `json:"walletId"`
	Type       TransactionType `json:"type"`
	Asset      string          `json:"asset"`
	Amount     float64         `json:"amount"`
	Fee        float64         `json:"fee"`
	Status     TransactionStatus `json:"status"`
	TxHash     string          `json:"txHash,omitempty"`
	Address    string          `json:"address,omitempty"`
	CreatedAt  int64          `json:"createdAt"`
	CompletedAt *int64        `json:"completedAt,omitempty"`
}

// Withdrawal request
type WithdrawalRequest struct {
	UserID   string  `json:"userId"`
	Asset   string  `json:"asset"`
	Amount  float64 `json:"amount"`
	Address string  `json:"address"`
	Network string  `json:"network"`
	Fee     float64 `json:"fee"`
}

// Deposit address
type DepositAddress struct {
	Asset   string `json:"asset"`
	Address string `json:"address"`
	Network string `json:"network"`
	Memo    string `json:"memo,omitempty"`
	QRCode string `json:"qrCode"`
}

// Wallet system
type WalletSystem struct {
	wallets       map[string]*Wallet
	transactions map[string]*Transaction
}

// NewWalletSystem creates wallet system
func NewWalletSystem() *WalletSystem {
	return &WalletSystem{
		wallets:       make(map[string]*Wallet),
		transactions: make(map[string]*Transaction),
	}
}

// Generate random address
func generateAddress() string {
	b := make([]byte, 20)
	rand.Read(b)
	return "0x" + hex.EncodeToString(b)[:40]
}

// Generate deposit address
func (ws *WalletSystem) GenerateDepositAddress(userID, asset, network string) *DepositAddress {
	addr := generateAddress()
	return &DepositAddress{
		Asset:   asset,
		Address: addr,
		Network: network,
		QRCode:  "qr://" + addr,
	}
}

// Create wallet
func (ws *WalletSystem) CreateWallet(userID, asset string, walletType WalletType) *Wallet {
	wallet := &Wallet{
		ID:             fmt.Sprintf("wallet_%d_%s_%s", time.Now().UnixNano(), userID, asset),
		UserID:         userID,
		Type:           walletType,
		Asset:          asset,
		Balance:       0,
		LockedBalance: 0,
		UpdatedAt:     time.Now().UnixMilli(),
	}
	
	ws.wallets[wallet.ID] = wallet
	return wallet
}

// Get wallet balance
func (ws *WalletSystem) GetBalance(walletID string) float64 {
	wallet, exists := ws.wallets[walletID]
	if !exists {
		return 0
	}
	return wallet.Balance
}

// Get available balance (excluding locked)
func (ws *WalletSystem) GetAvailableBalance(walletID string) float64 {
	wallet, exists := ws.wallets[walletID]
	if !exists {
		return 0
	}
	return wallet.Balance - wallet.LockedBalance
}

// Credit deposit
func (ws *WalletSystem) CreditDeposit(userID, asset, txHash string, amount float64) *Transaction {
	tx := &Transaction{
		ID:        fmt.Sprintf("tx_%d", time.Now().UnixNano()),
		UserID:   userID,
		WalletID: ws.FindWallet(userID, asset, WalletTypeSpot),
		Type:     TypeDeposit,
		Asset:    asset,
		Amount:   amount,
		Fee:      0,
		Status:   StatusCompleted,
		TxHash:   txHash,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	walletID := tx.WalletID
	if wallet, exists := ws.wallets[walletID]; exists {
		wallet.Balance += amount
		wallet.UpdatedAt = time.Now().UnixMilli()
	}
	
	ws.transactions[tx.ID] = tx
	return tx
}

// Process withdrawal
func (ws *WalletSystem) ProcessWithdrawal(req *WithdrawalRequest) *Transaction {
	tx := &Transaction{
		ID:        fmt.Sprintf("tx_%d", time.Now().UnixNano()),
		UserID:    req.UserID,
		WalletID:  ws.FindWallet(req.UserID, req.Asset, WalletTypeSpot),
		Type:      TypeWithdrawal,
		Asset:    req.Asset,
		Amount:   req.Amount,
		Fee:       req.Fee,
		Status:   StatusProcessing,
		Address:  req.Address,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	walletID := tx.WalletID
	if wallet, exists := ws.wallets[walletID]; exists {
		total := req.Amount + req.Fee
		if wallet.Balance >= total {
			wallet.Balance -= total
			wallet.UpdatedAt = time.Now().UnixMilli()
		}
	}
	
	ws.transactions[tx.ID] = tx
	return tx
}

// Transfer between wallets
func (ws *WalletSystem) Transfer(fromUserID, toUserID, asset string, amount float64) (*Transaction, *Transaction) {
	fromWallet := ws.FindWallet(fromUserID, asset, WalletTypeSpot)
	toWallet := ws.FindWallet(toUserID, asset, WalletTypeSpot)
	
	now := time.Now().UnixMilli()
	
	// Debit from sender
	tx1 := &Transaction{
		ID:        fmt.Sprintf("tx_%d", now),
		UserID:    fromUserID,
		WalletID: fromWallet,
		Type:     TypeTransfer,
		Asset:    asset,
		Amount:   amount,
		Status:   StatusCompleted,
		CreatedAt: now,
	}
	
	// Credit receiver
	tx2 := &Transaction{
		ID:        fmt.Sprintf("tx_%d", now+1),
		UserID:    toUserID,
		WalletID: toWallet,
		Type:     TypeTransfer,
		Asset:    asset,
		Amount:   amount,
		Status:   StatusCompleted,
		CreatedAt: now,
	}
	
	// Update balances
	if fw, ok := ws.wallets[fromWallet]; ok {
		fw.Balance -= amount
		fw.UpdatedAt = now
	}
	if tw, ok := ws.wallets[toWallet]; ok {
		tw.Balance += amount
		tw.UpdatedAt = now
	}
	
	ws.transactions[tx1.ID] = tx1
	ws.transactions[tx2.ID] = tx2
	
	return tx1, tx2
}

// Find wallet
func (ws *WalletSystem) FindWallet(userID, asset string, walletType WalletType) string {
	for _, w := range ws.wallets {
		if w.UserID == userID && w.Asset == asset && w.Type == walletType {
			return w.ID
		}
	}
	return ""
}

// Get transaction
func (ws *WalletSystem) GetTransaction(txID string) *Transaction {
	return ws.transactions[txID]
}

// Get user transactions
func (ws *WalletSystem) GetUserTransactions(userID string) []*Transaction {
	var txs []*Transaction
	for _, tx := range ws.transactions {
		if tx.UserID == userID {
			txs = append(txs, tx)
		}
	}
	return txs
}

// Convert to JSON
func (t *Transaction) ToJSON() string {
	b, _ := json.MarshalIndent(t, "", "  ")
	return string(b)
}

func main() {
	ws := NewWalletSystem()
	
	// Create a wallet for user
	wallet := ws.CreateWallet("user123", "BTC", WalletTypeSpot)
	fmt.Printf("Created wallet: %s\n", wallet.ID)
	
	// Simulate a deposit
	tx := ws.CreditDeposit("user123", "BTC", "0xabc123", 1.5)
	fmt.Printf("Deposit TX: %s\n", tx.ToJSON())
	
	// Check balance
	balance := ws.GetBalance(wallet.ID)
	fmt.Printf("Balance: %.8f\n", balance)
	
	// Request withdrawal
	req := &WithdrawalRequest{
		UserID:   "user123",
		Asset:   "BTC",
		Amount:  0.5,
		Address: "0xwithdraw123",
		Network: "Bitcoin",
		Fee:     0.0001,
	}
	withdrawal := ws.ProcessWithdrawal(req)
	fmt.Printf("Withdrawal TX: %s\n", withdrawal.ToJSON())
	
	// Generate deposit address
	depositAddr := ws.GenerateDepositAddress("user123", "BTC", "Bitcoin")
	fmt.Printf("Deposit Address: %+v\n", depositAddr)
}