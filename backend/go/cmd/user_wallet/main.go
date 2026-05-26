// Package user_wallet provides wallet management services.
// Migrated from TypeScript TigerEx/user_wallet to Go.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Currency types supported
type Currency string

const (
	USDT Currency = "USDT"
	BTC  Currency = "BTC"
	ETH  Currency = "ETH"
	BNB  Currency = "BNB"
	SOL  Currency = "SOL"
)

// Wallet represents a user wallet
type Wallet struct {
	ID         string             `json:"id"`
	UserID    string             `json:"userId"`
	Balances  map[Currency]float64 `json:"balances"`
	Addresses map[Currency]string `json:"addresses"`
	Status    string             `json:"status"`
	CreatedAt int64              `json:"createdAt"`
	UpdatedAt int64              `json:"updatedAt"`
}

// Transaction represents a deposit/withdrawal transaction
type Transaction struct {
	ID         string    `json:"id"`
	WalletID  string    `json:"walletId"`
	Currency Currency  `json:"currency"`
	Type     string    `json:"type"` // deposit, withdrawal
	Amount   float64   `json:"amount"`
	Status   string    `json:"status"` // pending, completed, failed
	TxHash   string    `json:"txHash,omitempty"`
	Address  string    `json:"address,omitempty"`
	CreatedAt int64     `json:"createdAt"`
}

// WalletStore manages wallets
type WalletStore struct {
	mu        sync.RWMutex
	wallets   map[string]*Wallet
	txns     map[string][]*Transaction
}

var (
	store = &WalletStore{
		wallets: make(map[string]*Wallet),
		txns:    make(map[string][]*Transaction),
	}
)

// Initialize demo wallets
func init() {
	store.wallets["wallet_demo"] = &Wallet{
		ID:    "wallet_demo",
		UserID: "user_demo",
		Balances: map[Currency]float64{
			USDT: 10000.0,
			BTC:  1.5,
			ETH:  10.0,
			BNB:  100.0,
		},
		Addresses: map[Currency]string{
			BTC: "bc1qxy89kg49gvqupvvvlpxt5wixl2qppkhs8rq3c9",
			ETH: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
			SOL: "7xKXtg2CWJdzTqP5nVZKcHPaAWJDnmir38LRZvPRLUet",
		},
		Status:    "active",
		CreatedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}
}

// CreateWallet creates a new wallet
func CreateWallet(userID string) *Wallet {
	wallet := &Wallet{
		ID:        fmt.Sprintf("wallet_%s", userID),
		UserID:    userID,
		Balances: make(map[Currency]float64),
		Status:   "active",
		CreatedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	store.wallets[wallet.ID] = wallet

	return wallet
}

// GetWallet returns wallet by ID
func GetWallet(walletID string) (*Wallet, bool) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	w, ok := store.wallets[walletID]
	return w, ok
}

// GetWalletByUserID returns wallet by user ID
func GetWalletByUserID(userID string) *Wallet {
	store.mu.RLock()
	defer store.mu.RUnlock()

	for _, w := range store.wallets {
		if w.UserID == userID {
			return w
		}
	}
	return nil
}

// GetBalance returns balance for a currency
func GetBalance(walletID string, currency Currency) float64 {
	store.mu.RLock()
	defer store.mu.RUnlock()

	w, ok := store.wallets[walletID]
	if !ok {
		return 0
	}
	return w.Balances[currency]
}

// Deposit adds funds to wallet
func Deposit(walletID string, currency Currency, amount float64, txHash string) *Transaction {
	store.mu.Lock()
	defer store.mu.Unlock()

	w, ok := store.wallets[walletID]
	if !ok {
		return nil
	}

	w.Balances[currency] += amount
	w.UpdatedAt = time.Now().UnixMilli()

	tx := &Transaction{
		ID:        fmt.Sprintf("tx_%d", time.Now().UnixNano()),
		WalletID: walletID,
		Currency: currency,
		Type:     "deposit",
		Amount:   amount,
		Status:   "completed",
		TxHash:   txHash,
		CreatedAt: time.Now().UnixMilli(),
	}

	store.txns[walletID] = append(store.txns[walletID], tx)
	return tx
}

// Withdraw removes funds from wallet
func Withdraw(walletID string, currency Currency, amount float64, address string) (*Transaction, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	w, ok := store.wallets[walletID]
	if !ok {
		return nil, fmt.Errorf("wallet not found")
	}

	balance := w.Balances[currency]
	if balance < amount {
		return nil, fmt.Errorf("insufficient balance")
	}

	w.Balances[currency] -= balance
	w.UpdatedAt = time.Now().UnixMilli()

	tx := &Transaction{
		ID:        fmt.Sprintf("tx_%d", time.Now().UnixNano()),
		WalletID: walletID,
		Currency: currency,
		Type:     "withdrawal",
		Amount:   amount,
		Status:   "pending",
		Address:  address,
		CreatedAt: time.Now().UnixMilli(),
	}

	store.txns[walletID] = append(store.txns[walletID], tx)
	return tx, nil
}

// GetTransactions returns transaction history
func GetTransactions(walletID string) []*Transaction {
	store.mu.RLock()
	defer store.mu.RUnlock()

	return store.txns[walletID]
}

// GetDepositAddress returns deposit address for currency
func GetDepositAddress(walletID string, currency Currency) string {
	store.mu.RLock()
	defer store.mu.RUnlock()

	w, ok := store.wallets[walletID]
	if !ok {
		return ""
	}
	return w.Addresses[currency]
}

func main() {
	fmt.Println("User wallet service initialized")

	// Demo
	wallet := GetWallet("wallet_demo")
	if wallet != nil {
		jsonW, _ := json.Marshal(wallet)
		fmt.Printf("Demo wallet: %s\n", string(jsonW))
	}
}