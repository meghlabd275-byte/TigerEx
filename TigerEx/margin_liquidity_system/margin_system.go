package main

import (
	"fmt"
	"time"
)

// Liability
type Liability struct {
	Asset      string  `json:"asset"`
	Amount    float64 `json:"amount"`
	BorrowedAt int64   `json:"borrowedAt"`
	PaidBack  bool    `json:"paidBack"`
}

// Borrow result
type BorrowResult struct {
	Success      bool   `json:"success"`
	TransactionID string `json:"transactionId"`
	Asset       string `json:"asset"`
	Amount      float64 `json:"amount"`
}

// Repay result
type RepayResult struct {
	Success      bool   `json:"success"`
	TransactionID string `json:"transactionId"`
	RepaidAmount float64 `json:"repaidAmount"`
}

// Cross margin account
type CrossMarginAccount struct {
	Balances  map[string]float64
	Liabilities map[string][]Liability
}

// New creates account
func NewCrossMarginAccount() *CrossMarginAccount {
	return &CrossMarginAccount{
		Balances: make(map[string]float64),
		Liabilities: make(map[string][]Liability),
	}
}

// Deposit
func (a *CrossMarginAccount) Deposit(asset string, amount float64) {
	a.Balances[asset] += amount
}

// Borrow
func (a *CrossMarginAccount) Borrow(userID, asset string, amount float64) *BorrowResult {
	current := a.Balances[asset]
	
	// Simplified: can borrow up to 50% of balance
	maxBorrow := current * 0.5
	if amount > maxBorrow {
		return &BorrowResult{Success: false, TransactionID: ""}
	}
	
	txnID := fmt.Sprintf("br_%d", time.Now().UnixNano())
	
	liability := Liability{
		Asset: asset,
		Amount: amount,
		BorrowedAt: time.Now().UnixMilli(),
	}
	
	a.Liabilities[userID] = append(a.Liabilities[userID], liability)
	a.Balances[asset] -= amount
	
	return &BorrowResult{
		Success: true,
		TransactionID: txnID,
		Asset: asset,
		Amount: amount,
	}
}

// Repay
func (a *CrossMarginAccount) Repay(userID, asset string, amount float64) *RepayResult {
	liabilities := a.Liabilities[userID]
	if len(liabilities) == 0 {
		return &RepayResult{Success: false, TransactionID: ""}
	}
	
	totalDebt := 0.0
	for _, l := range liabilities {
		if !l.PaidBack && l.Asset == asset {
			totalDebt += l.Amount
		}
	}
	
	repayAmount := amount
	if amount > totalDebt {
		repayAmount = totalDebt
	}
	
	txnID := fmt.Sprintf("rp_%d", time.Now().UnixNano())
	a.Balances[asset] += repayAmount
	
	return &RepayResult{
		Success: true,
		TransactionID: txnID,
		RepaidAmount: repayAmount,
	}
}

// Get liabilities
func (a *CrossMarginAccount) GetLiabilities(userID string) []Liability {
	return a.Liabilities[userID]
}

// Get max borrow
func (a *CrossMarginAccount) GetMaxBorrow(userID, asset string) float64 {
	balance := a.Balances[asset]
	
	// Subtract existing debt
	for _, l := range a.Liabilities[userID] {
		if !l.PaidBack && l.Asset == asset {
			balance -= l.Amount
		}
	}
	
	if balance < 0 {
		return 0
	}
	
	return balance * 0.5 // 50% LTV
}

func main() {
	account := NewCrossMarginAccount()
	
	// Deposit
	account.Deposit("USDT", 10000)
	fmt.Printf("Balance: %.2f\n", account.Balances["USDT"])
	
	// Borrow
	result := account.Borrow("user1", "USDT", 1000)
	fmt.Printf("Borrow: %v, ID: %s\n", result.Success, result.TransactionID)
	
	// Max borrow
	max := account.GetMaxBorrow("user1", "USDT")
	fmt.Printf("Max Borrow: %.2f\n", max)
}