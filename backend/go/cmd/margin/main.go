// Package margin - Margin Trading Service
package main

import (
	"fmt"
	"sync"
)

type MarginAccount struct {
	UserID string `json:"userId"`
	Collateral float64 `json:"collateral"`
	Borrowed float64 `json:"borrowed"`
	Available float64 `json:"available"`
	Leverage float64 `json:"leverage"`
}

type Loan struct {
	ID string `json:"id"`
	UserID string `json:"userId"`
	Asset string `json:"asset"`
	Amount float64 `json:"amount"`
	Interest float64 `json:"interest"`
	Status string `json:"status"`
}

type MarginService struct {
	mu sync.RWMutex
	accounts map[string]*MarginAccount
	loans map[string]*Loan
	counter uint64
}

func NewMarginService() *MarginService {
	return &MarginService{
		accounts: make(map[string]*MarginAccount),
		loans: make(map[string]*Loan),
	}
}

func (ms *MarginService) OpenAccount(userID string, collateral float64) *MarginAccount {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	acc := &MarginAccount{
		UserID: userID,
		Collateral: collateral,
		Borrowed: 0,
		Available: collateral,
		Leverage: 1,
	}
	ms.accounts[userID] = acc
	return acc
}

func (ms *MarginService) Borrow(userID, asset string, amount float64) (*Loan, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	acc, ok := ms.accounts[userID]
	if !ok {
		return nil, fmt.Errorf("no account")
	}

	maxBorrow := acc.Collateral * 3 // 3x leverage
	if acc.Borrowed+amount > maxBorrow {
		return nil, fmt.Errorf("exceeds limit")
	}

	ms.counter++
	loan := &Loan{
		ID: fmt.Sprintf("loan_%d", ms.counter),
		UserID: userID,
		Asset: asset,
		Amount: amount,
		Interest: 0.001, // 0.1% daily
		Status: "active",
	}

	ms.loans[loan.ID] = loan
	acc.Borrowed += amount
	acc.Available -= amount

	return loan, nil
}

func (ms *MarginService) Repay(userID, loanID string, amount float64) error {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	loan, ok := ms.loans[loanID]
	if !ok || loan.UserID != userID {
		return fmt.Errorf("loan not found")
	}

	acc := ms.accounts[userID]
	acc.Borrowed -= amount
	acc.Available += amount

	if amount >= loan.Amount {
		loan.Status = "repaid"
	}

	return nil
}

func (ms *MarginService) GetLiquidationPrice(acc *MarginAccount, side string, entry float64) float64 {
	margin := acc.Collateral - acc.Borrowed
	if side == "long" {
		return entry * (1 - margin/acc.Collateral)
	}
	return entry * (1 + margin/acc.Collateral)
}

func main() {
	ms := NewMarginService()
	acc := ms.OpenAccount("user1", 10000)
	fmt.Printf("Account: leverage %.1fx\n", acc.Leverage)

	loan, _ := ms.Borrow("user1", "USDT", 5000)
	fmt.Printf("Borrowed: %s\n", loan.ID)
}