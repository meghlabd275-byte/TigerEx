// TigerEx Wallet Service
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"
)

type Wallet struct {
	ID        string
	UserID   string
	Address  string
	Chain    string
	Balance  map[string]*big.Int
	Status   string
	CreatedAt time.Time
}

type Transaction struct {
	ID        string
	WalletID string
	Hash     string
	From     string
	To       string
	Amount   *big.Int
	Currency string
	Status   string
	Confirmations int
	Timestamp time.Time
}

type WalletService struct {
	mu         sync.RWMutex
	wallets    map[string]*Wallet
	transactions map[string]*Transaction
	stats      WalletStats
}

type WalletStats struct {
	TotalWallets   int64
	TotalDeposits  int64
	TotalWithdrawals int64
	TotalVolume   *big.Int
}

func NewWalletService() *WalletService {
	return &WalletService{
		wallets: make(map[string]*Wallet),
		transactions: make(map[string]*Transaction),
	}
}

func (ws *WalletService) CreateWallet(userID, chain string) *Wallet {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	
	wallet := &Wallet{
		ID: generateID("WALLET"),
		UserID: userID,
		Address: generateAddress(chain),
		Chain: chain,
		Balance: make(map[string]*big.Int),
		Status: "ACTIVE",
		CreatedAt: time.Now(),
	}
	
	ws.wallets[wallet.ID] = wallet
	ws.stats.TotalWallets++
	
	return wallet
}

func (ws *WalletService) GetWallet(id string) (*Wallet, error) {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	
	if w, ok := ws.wallets[id]; ok {
		return w, nil
	}
	
	return nil, fmt.Errorf("wallet not found")
}

func (ws *WalletService) Deposit(walletID, currency string, amount *big.Int) *Transaction {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	
	tx := &Transaction{
		ID: generateID("TX"),
		WalletID: walletID,
		Hash: generateTxHash(),
		To: ws.wallets[walletID].Address,
		Amount: amount,
		Currency: currency,
		Status: "PENDING",
		Timestamp: time.Now(),
	}
	
	// Update balance
	ws.wallets[walletID].Balance[currency] = new(big.Int).Add(
		ws.wallets[walletID].Balance[currency], amount,
	)
	
	ws.transactions[tx.ID] = tx
	ws.stats.TotalDeposits++
	ws.stats.TotalVolume.Add(ws.stats.TotalVolume, amount)
	
	return tx
}

func (ws *WalletService) Withdraw(walletID, currency, to string, amount *big.Int) (*Transaction, error) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	
	wallet := ws.wallets[walletID]
	
	// Check balance
	balance := wallet.Balance[currency]
	if balance == nil || balance.Cmp(amount) < 0 {
		return nil, fmt.Errorf("insufficient balance")
	}
	
	tx := &Transaction{
		ID: generateID("TX"),
		WalletID: walletID,
		Hash: generateTxHash(),
		From: wallet.Address,
		To: to,
		Amount: amount,
		Currency: currency,
		Status: "PENDING",
		Timestamp: time.Now(),
	}
	
	// Update balance
	wallet.Balance[currency] = new(big.Int).Sub(balance, amount)
	
	ws.transactions[tx.ID] = tx
	ws.stats.TotalWithdrawals++
	ws.stats.TotalVolume.Sub(ws.stats.TotalVolume, amount)
	
	return tx, nil
}

func (ws *WalletService) GetTransactions(walletID string) []*Transaction {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	
	var txs []*Transaction
	for _, tx := range ws.transactions {
		if tx.WalletID == walletID {
			txs = append(txs, tx)
		}
	}
	
	return txs
}

func (ws *WalletService) GetBalance(walletID, currency string) *big.Int {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	
	if balance, ok := ws.wallets[walletID].Balance[currency]; ok {
		return balance
	}
	
	return big.NewInt(0)
}

func generateID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func generateAddress(chain string) string {
	return fmt.Sprintf("0x%x", time.Now().UnixNano())
}

func generateTxHash() string {
	return fmt.Sprintf("0x%x", time.Now().UnixNano())
}

func main() {
	fmt.Println("TigerEx Wallet Service")
	fmt.Println("====================")
	
	ws := NewWalletService()
	
	// Create wallet
	wallet := ws.CreateWallet("user1", "ETH")
	fmt.Printf("\nWallet created: %s\n", wallet.ID)
	fmt.Printf("Address: %s\n", wallet.Address)
	
	// Deposit
	deposit := ws.Deposit(wallet.ID, "ETH", big.NewInt(1000000000000000000)) // 1 ETH
	fmt.Printf("\nDeposit: %s\n", deposit.ID)
	
	// Withdraw
	withdraw, _ := ws.Withdraw(wallet.ID, "ETH", "0xDEST", big.NewInt(500000000000000000))
	fmt.Printf("Withdraw: %s\n", withdraw.ID)
	
	// Balance
	balance := ws.GetBalance(wallet.ID, "ETH")
	fmt.Printf("\nBalance: %s WEI\n", balance.String())
	
	// Transactions
	txs := ws.GetTransactions(wallet.ID)
	fmt.Printf("\nTransactions: %d\n", len(txs))
}
