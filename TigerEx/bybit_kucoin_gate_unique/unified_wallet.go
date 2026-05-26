package main

import (
	"fmt"
	"time"
)

// Account balance
type Balance struct {
	Total     float64 `json:"total"`
	Available float64 `json:"available"`
	Locked    float64 `json:"locked"`
}

// Transfer result
type TransferResult struct {
	Transferred bool   `json:"transferred"`
	TxID       string `json:"txId"`
}

// Unified wallet
type UnifiedWallet struct {
	Balances  map[string]float64
	Locked    map[string]float64
}

// New creates wallet
func NewUnifiedWallet() *UnifiedWallet {
	return &UnifiedWallet{
		Balances: make(map[string]float64),
		Locked: make(map[string]float64),
	}
}

// Get balance
func (w *UnifiedWallet) GetBalance(userID string) *Balance {
	total := w.Balances[userID]
	locked := w.Locked[userID]
	
	return &Balance{
		Total: total,
		Available: total - locked,
		Locked: locked,
	}
}

// Deposit
func (w *UnifiedWallet) Deposit(userID string, amount float64) {
	w.Balances[userID] += amount
}

// Transfer to contract
func (w *UnifiedWallet) TransferToContract(userID string, amount float64) *TransferResult {
	balance := w.Balances[userID]
	available := balance - w.Locked[userID]
	
	if amount > available {
		return &TransferResult{Transferred: false, TxID: ""}
	}
	
	w.Locked[userID] += amount
	
	return &TransferResult{
		Transferred: true,
		TxID: fmt.Sprintf("tx_%d", time.Now().UnixNano()),
	}
}

// Transfer to spot
func (w *UnifiedWallet) TransferToSpot(userID string, amount float64) *TransferResult {
	if amount > w.Locked[userID] {
		return &TransferResult{Transferred: false, TxID: ""}
	}
	
	w.Locked[userID] -= amount
	
	return &TransferResult{
		Transferred: true,
		TxID: fmt.Sprintf("tx_%d", time.Now().UnixNano()),
	}
}

func main() {
	wallet := NewUnifiedWallet()
	
	// Deposit
	wallet.Deposit("user1", 10000)
	balance := wallet.GetBalance("user1")
	fmt.Printf("Balance: Total %.2f Available %.2f\n", balance.Total, balance.Available)
	
	// Transfer to contract
	result := wallet.TransferToContract("user1", 2000)
	fmt.Printf("Transfer to Contract: %v\n", result.Transferred)
	
	// Check locked
	balance = wallet.GetBalance("user1")
	fmt.Printf("Locked: %.2f\n", balance.Locked)
}