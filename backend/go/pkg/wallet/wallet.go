// Package wallet provides user wallet functionality
package wallet

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// DepositAddress represents a deposit address
type DepositAddress struct {
	Coin    string `json:"coin"`
	Chain   string `json:"chain"`
	Address string `json:"address"`
	Tag     string `json:"tag,omitempty"`
	Memo    string `json:"memo,omitempty"`
}

// DepositRecord represents a deposit
type DepositRecord struct {
	ID          string    `json:"id"`
	Coin       string    `json:"coin"`
	Amount     float64   `json:"amount"`
	FromAddress string  `json:"fromAddress"`
	ToAddress  string    `json:"toAddress"`
	TxHash     string    `json:"txHash"`
	Status     string    `json:"status"`
	Confirmations int   `json:"confirmations"`
	Time       time.Time `json:"time"`
}

// WithdrawalRecord represents a withdrawal
type WithdrawalRecord struct {
	ID         string    `json:"id"`
	Coin       string    `json:"coin"`
	Amount    float64   `json:"amount"`
	Fee       float64   `json:"fee"`
	ToAddress string    `json:"toAddress"`
	TxHash    string    `json:"txHash,omitempty"`
	Status    string    `json:"status"`
	Time      time.Time `json:"time"`
}

// TransferRecord represents an internal transfer
type TransferRecord struct {
	ID        string    `json:"id"`
	Coin      string    `json:"coin"`
	Amount   float64   `json:"amount"`
	FromUser string    `json:"fromUser"`
	ToUser   string    `json:"toUser"`
	Type     string    `json:"type"`
	Status   string    `json:"status"`
	Time     time.Time `json:"time"`
}

// WalletBalance represents wallet balance
type WalletBalance struct {
	Coin   string  `json:"coin"`
	Free  float64 `json:"free"`
	Locked float64 `json:"locked"`
	Total float64 `json:"total"`
}

// ============================================================================
// USER WALLET
// ============================================================================

// UserWallet manages user wallet operations
type UserWallet struct {
	mu              sync.RWMutex
	userID           string
	balances         map[string]*WalletBalance
	depositAddresses  map[string]*DepositAddress
	deposits         map[string]*DepositRecord
	withdrawals      map[string]*WithdrawalRecord
	transfers       map[string]*TransferRecord
	depositCounter   uint64
	withdrawalCounter uint64
	transferCounter  uint64
}

// NewUserWallet creates a new user wallet
func NewUserWallet(userID string) *UserWallet {
	return &UserWallet{
		userID:          userID,
		balances:       make(map[string]*WalletBalance),
		depositAddresses: make(map[string]*DepositAddress),
		deposits:      make(map[string]*DepositRecord),
		withdrawals:    make(map[string]*WithdrawalRecord),
		transfers:     make(map[string]*TransferRecord),
	}
}

// =============================================================================
// BALANCE OPERATIONS
// =============================================================================

// GetBalance returns balance for a coin
func (w *UserWallet) GetBalance(coin string) *WalletBalance {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if balance, ok := w.balances[coin]; ok {
		return balance
	}

	return &WalletBalance{Coin: coin, Free: 0, Locked: 0, Total: 0}
}

// GetAllBalances returns all balances
func (w *UserWallet) GetAllBalances() []*WalletBalance {
	w.mu.RLock()
	defer w.mu.RUnlock()

	balances := make([]*WalletBalance, 0, len(w.balances))
	for _, b := range w.balances {
		balances = append(balances, b)
	}
	return balances
}

// UpdateBalance updates balance for a coin
func (w *UserWallet) UpdateBalance(coin string, free, locked float64) {
	w.mu.Lock()
	defer w.mu.Unlock()

	balance, ok := w.balances[coin]
	if !ok {
		balance = &WalletBalance{Coin: coin}
		w.balances[coin] = balance
	}

	balance.Free = free
	balance.Locked = locked
	balance.Total = free + locked
}

// LockFunds locks funds for an order
func (w *UserWallet) LockFunds(coin string, amount float64) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	balance, ok := w.balances[coin]
	if !ok {
		return fmt.Errorf("no balance for %s", coin)
	}

	if balance.Free < amount {
		return fmt.Errorf("insufficient balance")
	}

	balance.Free -= amount
	balance.Locked += amount
	balance.Total = balance.Free + balance.Locked

	return nil
}

// UnlockFunds unlocks funds
func (w *UserWallet) UnlockFunds(coin string, amount float64) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if balance, ok := w.balances[coin]; ok {
		balance.Locked -= amount
		if balance.Locked < 0 {
			balance.Locked = 0
		}
		balance.Total = balance.Free + balance.Locked
	}
}

// Debit debits an amount from balance
func (w *UserWallet) Debit(coin string, amount float64) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	balance, ok := w.balances[coin]
	if !ok {
		return fmt.Errorf("no balance for %s", coin)
	}

	totalAvailable := balance.Free + balance.Locked
	if totalAvailable < amount {
		return fmt.Errorf("insufficient balance")
	}

	// Deduct from locked first, then free
	if balance.Locked >= amount {
		balance.Locked -= amount
	} else {
		deductFromLocked := amount - balance.Locked
		balance.Locked = 0
		balance.Free -= deductFromLocked
	}

	if balance.Free < 0 {
		balance.Free = 0
	}

	balance.Total = balance.Free + balance.Locked
	return nil
}

// Credit credits an amount to balance
func (w *UserWallet) Credit(coin string, amount float64) {
	w.mu.Lock()
	defer w.mu.Unlock()

	balance, ok := w.balances[coin]
	if !ok {
		balance = &WalletBalance{Coin: coin}
		w.balances[coin] = balance
	}

	balance.Free += amount
	balance.Total = balance.Free + balance.Locked
}

// =============================================================================
// DEPOSIT OPERATIONS
// =============================================================================

// AddDepositAddress adds a deposit address
func (w *UserWallet) AddDepositAddress(coin, chain, address, tag, memo string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	key := fmt.Sprintf("%s_%s", coin, chain)
	w.depositAddresses[key] = &DepositAddress{
		Coin:    coin,
		Chain:   chain,
		Address: address,
		Tag:     tag,
		Memo:    memo,
	}
}

// GetDepositAddress returns deposit address
func (w *UserWallet) GetDepositAddress(coin, chain string) *DepositAddress {
	w.mu.RLock()
	defer w.mu.RUnlock()

	key := fmt.Sprintf("%s_%s", coin, chain)
	return w.depositAddresses[key]
}

// RecordDeposit records a deposit
func (w *UserWallet) RecordDeposit(coin string, amount float64, fromAddr, toAddr, txHash string) string {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.depositCounter++
	id := fmt.Sprintf("dep_%d", w.depositCounter)

	deposit := &DepositRecord{
		ID:           id,
		Coin:         coin,
		Amount:       amount,
		FromAddress: fromAddr,
		ToAddress:   toAddr,
		TxHash:      txHash,
		Status:      "pending",
		Confirmations: 0,
		Time:        time.Now(),
	}

	w.deposits[id] = deposit

	// Credit to balance
	w.Credit(coin, amount)

	return id
}

// ConfirmDeposit confirms a deposit
func (w *UserWallet) ConfirmDeposit(depositID string, confirmations int) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	deposit, ok := w.deposits[depositID]
	if !ok {
		return fmt.Errorf("deposit not found")
	}

	deposit.Confirmations = confirmations
	if confirmations >= 6 {
		deposit.Status = "confirmed"
	}

	return nil
}

// GetDeposits returns deposit history
func (w *UserWallet) GetDeposits(limit int) []*DepositRecord {
	w.mu.RLock()
	defer w.mu.RUnlock()

	deposits := make([]*DepositRecord, 0)
	for _, d := range w.deposits {
		deposits = append(deposits, d)
	}

	// Return most recent
	if len(deposits) > limit {
		return deposits[len(deposits)-limit:]
	}
	return deposits
}

// =============================================================================
// WITHDRAWAL OPERATIONS
// =============================================================================

// RequestWithdrawal requests a withdrawal
func (w *UserWallet) RequestWithdrawal(coin string, amount, fee float64, toAddr string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	totalRequired := amount + fee

	// Check balance
	balance, ok := w.balances[coin]
	if !ok {
		return "", fmt.Errorf("no balance for %s", coin)
	}

	if balance.Total < totalRequired {
		return "", fmt.Errorf("insufficient balance")
	}

	w.withdrawalCounter++
	id := fmt.Sprintf("wd_%d", w.withdrawalCounter)

	withdrawal := &WithdrawalRecord{
		ID:        id,
		Coin:      coin,
		Amount:   amount,
		Fee:      fee,
		ToAddress: toAddr,
		Status:   "pending",
		Time:     time.Now(),
	}

	w.withdrawals[id] = withdrawal

	// Deduct from balance
	balance.Total -= totalRequired
	balance.Free -= totalRequired
	if balance.Free < 0 {
		balance.Free = 0
	}

	return id, nil
}

// Confirm Withdrawal confirms a withdrawal
func (w *UserWallet) ConfirmWithdrawal(withdrawalID, txHash string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	withdrawal, ok := w.withdrawals[withdrawalID]
	if !ok {
		return fmt.Errorf("withdrawal not found")
	}

	withdrawal.TxHash = txHash
	withdrawal.Status = "completed"

	return nil
}

// CancelWithdrawal cancels a pending withdrawal
func (w *UserWallet) CancelWithdrawal(withdrawalID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	withdrawal, ok := w.withdrawals[withdrawalID]
	if !ok {
		return fmt.Errorf("withdrawal not found")
	}

	if withdrawal.Status != "pending" {
		return fmt.Errorf("cannot cancel withdrawal in current state")
	}

	// Refund
	totalRefund := withdrawal.Amount + withdrawal.Fee
	balance, ok := w.balances[withdrawal.Coin]
	if ok {
		balance.Free += totalRefund
		balance.Total += totalRefund
	}

	withdrawal.Status = "cancelled"

	return nil
}

// GetWithdrawals returns withdrawal history
func (w *UserWallet) GetWithdrawals(limit int) []*WithdrawalRecord {
	w.mu.RLock()
	defer w.mu.RUnlock()

	withdrawals := make([]*WithdrawalRecord, 0)
	for _, w := range w.withdrawals {
		withdrawals = append(withdrawals, w)
	}

	if len(withdrawals) > limit {
		return withdrawals[len(withdrawals)-limit:]
	}
	return withdrawals
}

// =============================================================================
// TRANSFER OPERATIONS (Internal)
// =============================================================================

// Transfer performs internal transfer
func (w *UserWallet) Transfer(toUser *UserWallet, coin string, amount float64, transferType string) (string, error) {
	// Lock both wallets
	w.mu.Lock()
	toUser.mu.Lock()
	defer w.mu.Unlock()
	defer toUser.mu.Unlock()

	// Check sender balance
	balance, ok := w.balances[coin]
	if !ok {
		return "", fmt.Errorf("no balance for %s", coin)
	}

	if balance.Total < amount {
		return "", fmt.Errorf("insufficient balance")
	}

	// Debit from sender
	balance.Total -= amount
	balance.Free -= amount
	if balance.Free < 0 {
		balance.Free = 0
	}

	// Credit to receiver
	toUser.Credit(coin, amount)

	w.transferCounter++
	id := fmt.Sprintf("tf_%d", w.transferCounter)

	record := &TransferRecord{
		ID:        id,
		Coin:      coin,
		Amount:   amount,
		FromUser: w.userID,
		ToUser:   toUser.userID,
		Type:     transferType,
		Status:   "completed",
		Time:     time.Now(),
	}

	w.transfers[id] = record

	return id, nil
}

// GetTransfers returns transfer history
func (w *UserWallet) GetTransfers(limit int) []*TransferRecord {
	w.mu.RLock()
	defer w.mu.RUnlock()

	transfers := make([]*TransferRecord, 0)
	for _, t := range w.transfers {
		transfers = append(transfers, t)
	}

	if len(transfers) > limit {
		return transfers[len(transfers)-limit:]
	}
	return transfers
}

// =============================================================================
// WALLET STATS
// =============================================================================

// GetTotalValue returns total portfolio value (simplified)
func (w *UserWallet) GetTotalValue() float64 {
	w.mu.RLock()
	defer w.mu.RUnlock()

	total := 0.0
	for _, b := range w.balances {
		total += b.Total
	}
	return total
}

// GetSummary returns wallet summary
func (w *UserWallet) GetSummary() map[string]interface{} {
	w.mu.RLock()
	defer w.mu.RUnlock()

	return map[string]interface{}{
		"userID":         w.userID,
		"totalValue":     w.GetTotalValue(),
		"balanceCount":  len(w.balances),
		"depositCount":  len(w.deposits),
		"withdrawalCount": len(w.withdrawals),
	}
}