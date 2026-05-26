// Package savings provides savings account services.
// Migrated from TypeScript to Go for crypto savings.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Savings account
type SavingsAccount struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Balance  float64 `json:"balance"`
	Currency string  `json:"currency"`
	APY      float64 `json:"apy"` // annual percentage yield
}

// Savings interest
type InterestAccrual struct {
	AccountID string  `json:"accountId"`
	Accrued   float64 `json:"accrued"`
	LastAccruedAt int64 `json:"lastAccruedAt"`
}

// Store
type SavingsStore struct {
	mu       sync.RWMutex
	accounts map[string]*SavingsAccount
	interest map[string]*InterestAccrual
}

var (
	saveStore = &SavingsStore{
		accounts: make(map[string]*SavingsAccount),
		interest: make(map[string]*InterestAccrual),
	}
)

// Open savings account
func OpenAccount(userID, currency string, apy float64) *SavingsAccount {
	account := &SavingsAccount{
		ID: fmt.Sprintf("save_%d", time.Now().UnixNano()),
		UserID: userID,
		Balance: 0,
		Currency: currency,
		APY: apy,
	}

	saveStore.mu.Lock()
	defer saveStore.mu.Unlock()
	saveStore.accounts[account.ID] = account
	saveStore.interest[account.ID] = &InterestAccrual{
		AccountID: account.ID,
		Accrued: 0,
		LastAccruedAt: time.Now().UnixMilli(),
	}

	return account
}

// Deposit
func Deposit(accountID string, amount float64) error {
	saveStore.mu.Lock()
	defer saveStore.mu.Unlock()

	account, ok := saveStore.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}

	account.Balance += amount
	return nil
}

// Withdraw
func Withdraw(accountID string, amount float64) error {
	saveStore.mu.Lock()
	defer saveStore.mu.Unlock()

	account, ok := saveStore.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}

	if account.Balance < amount {
		return fmt.Errorf("insufficient balance")
	}

	account.Balance -= amount
	return nil
}

// Accrue interest (daily)
func AccrueInterest(accountID string) error {
	saveStore.mu.Lock()
	defer saveStore.mu.Unlock()

	account, ok := saveStore.accounts[accountID]
	if !ok {
		return fmt.Errorf("account not found")
	}

	accrual, ok := saveStore.interest[accountID]
	if !ok {
		return fmt.Errorf("interest record not found")
	}

	// Balance * APY / 365
	dailyInterest := account.Balance * account.APY / 365
	accrual.Accrued += dailyInterest

	return nil
}

// Get balance with interest
func GetBalance(accountID string) (float64, error) {
	saveStore.mu.RLock()
	defer saveStore.mu.RUnlock()

	account, ok := saveStore.accounts[accountID]
	if !ok {
		return 0, fmt.Errorf("account not found")
	}

	interest := saveStore.interest[accountID]
	return account.Balance + interest.Accrued, nil
}

func main() {
	fmt.Println("Savings service initialized")

	// Open account
	account := OpenAccount("user_001", "USDT", 0.05)
	fmt.Printf("Account opened: %s @ %.1f%% APY\n", account.Currency, account.APY*100)

	// Deposit
	Deposit(account.ID, 5000)
	balance, _ := GetBalance(account.ID)
	fmt.Printf("Balance: $%.2f\n", balance)

	// Accrue
	AccrueInterest(account.ID)
	balance, _ = GetBalance(account.ID)
	fmt.Printf("After interest: $%.2f\n", balance)
}