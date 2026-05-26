// Package custody_service provides custody services.
// Institutional-grade cold storage management.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Cold Wallet
type ColdWallet struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Address  string  `json:"address"`
	Status   string  `json:"status"`
	Balance  float64 `json:"balance"`
}

// Custody Account
type CustodyAcc struct {
	UserID   string  `json:"userId"`
	Asset    string  `json:"asset"`
	Balance  float64 `json:"balance"`
	Available float64 `json:"available"`
	Locked   float64 `json:"locked"`
}

// Withdrawal
type WithdrawalReq struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Asset      string  `json:"asset"`
	Amount     float64 `json:"amount"`
	DestAddr   string  `json:"destAddr"`
	Status    string  `json:"status"`
	ApprovedBy string  `json:"approvedBy"`
}

// Store
type CustodyService struct {
	mu       sync.RWMutex
	wallets  map[string]*ColdWallet
	accounts map[string]*CustodyAcc
	withdraws map[string]*WithdrawalReq
}

var csStore = &CustodyService{
	wallets: make(map[string]*ColdWallet),
	accounts: make(map[string]*CustodyAcc),
	withdraws: make(map[string]*WithdrawalReq),
}

func init() {
	ws := []*ColdWallet{
		{"cold_1", "Vault 1", "0xC1", "active", 100000000},
		{"cold_2", "Vault 2", "0xC2", "active", 100000000},
		{"warm_1", "Warm", "0xW1", "active", 10000000},
	}
	csStore.mu.Lock()
	for _, w := range ws {
		csStore.wallets[w.ID] = w
	}
	csStore.mu.Unlock()
}

// Get balance
func GetBalance(userID, asset string) float64 {
	key := userID + "_" + asset
	csStore.mu.RLock()
	defer csStore.mu.RUnlock()
	if acc, ok := csStore.accounts[key]; ok {
		return acc.Balance
	}
	return 0
}

// Deposit
func Deposit(userID, asset, txHash string, amount float64) {
	key := userID + "_" + asset
	csStore.mu.Lock()
	if acc, ok := csStore.accounts[key]; ok {
		acc.Balance += amount
		acc.Available += amount
	} else {
		csStore.accounts[key] = &CustodyAcc{UserID: userID, Asset: asset, Balance: amount, Available: amount}
	}
	csStore.mu.Unlock()
}

// Request withdrawal
func RequestWithdrawal(userID, asset string, amount float64, addr string) (*WithdrawalReq, error) {
	key := userID + "_" + asset
	csStore.mu.RLock()
	acc, ok := csStore.accounts[key]
	csStore.mu.RUnlock()
	if !ok || acc.Available < amount {
		return nil, fmt.Errorf("insufficient balance")
	}
	req := &WithdrawalReq{ID: fmt.Sprintf("wr_%d", time.Now().UnixNano()), UserID: userID, Asset: asset, Amount: amount, DestAddr: addr, Status: "pending"}
	csStore.mu.Lock()
	acc.Available -= amount
	csStore.withdraws[req.ID] = req
	csStore.mu.Unlock()
	return req, nil
}

// Approve
func ApproveWithdrawal(reqID, approverID string) error {
	csStore.mu.RLock()
	req, ok := csStore.withdraws[reqID]
	csStore.mu.RUnlock()
	if !ok {
		return fmt.Errorf("not found")
	}
	csStore.mu.Lock()
	req.Status = "approved"
	req.ApprovedBy = approverID
	csStore.mu.Unlock()
	return nil
}

// Process
func ProcessWithdrawal(reqID string) error {
	csStore.mu.RLock()
	req, ok := csStore.withdraws[reqID]
	if !ok || req.Status != "approved" {
		csStore.mu.RUnlock()
		return fmt.Errorf("not approved")
	}
	csStore.mu.RUnlock()
	csStore.mu.Lock()
	req.Status = "completed"
	csStore.mu.Unlock()
	return nil
}

func main() {
	fmt.Println("Custody service initialized")
	Deposit("user1", "BTC", "tx1", 10.0)
	fmt.Printf("Balance: %.4f\n", GetBalance("user1", "BTC"))
}