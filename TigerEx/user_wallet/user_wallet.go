package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// Deposit address
type DepositAddress struct {
	Coin   string `json:"coin"`
	Chain  string `json:"chain"`
	Address string `json:"address"`
	Tag    string `json:"tag,omitempty"`
	Memo   string `json:"memo,omitempty"`
}

// Deposit record
type DepositRecord struct {
	ID           string  `json:"id"`
	Coin         string  `json:"coin"`
	Amount       float64 `json:"amount"`
	FromAddress  string  `json:"fromAddress"`
	ToAddress    string  `json:"toAddress"`
	TxHash      string  `json:"txHash"`
	Status      string  `json:"status"`
	Confirmations int    `json:"confirmations"`
	Time        int64   `json:"time"`
}

// Withdrawal record
type WithdrawalRecord struct {
	ID        string  `json:"id"`
	Coin     string  `json:"coin"`
	Amount   float64 `json:"amount"`
	Fee      float64 `json:"fee"`
	ToAddress string  `json:"toAddress"`
	TxHash   string  `json:"txHash,omitempty"`
	Status   string  `json:"status"`
	Time     int64   `json:"time"`
}

// Transfer record
type TransferRecord struct {
	ID       string  `json:"id"`
	Coin     string  `json:"coin"`
	Amount   float64 `json:"amount"`
	FromUser string  `json:"fromUser"`
	ToUser   string  `json:"toUser"`
	Type     string  `json:"type"`
	Status   string  `json:"status"`
	Time     int64   `json:"time"`
}

// Wallet balance
type WalletBalance struct {
	Coin      string  `json:"coin"`
	Free     float64 `json:"free"`
	Locked   float64 `json:"locked"`
	Freeze   float64 `json:"freeze"`
	Waived   float64 `json:"waived"`
}

// User wallet service
type UserWallet struct {
	deposits    map[string]*DepositRecord
	withdrawals map[string]*WithdrawalRecord
	transfers  map[string]*TransferRecord
	balances  map[string]map[string]*WalletBalance
}

// NewUserWallet creates wallet service
func NewUserWallet() *UserWallet {
	return &UserWallet{
		deposits:   make(map[string]*DepositRecord),
		withdrawals: make(map[string]*WithdrawalRecord),
		transfers:  make(map[string]*TransferRecord),
		balances:  make(map[string]map[string]*WalletBalance),
	}
}

// Generate crypto address
func generateAddress() string {
	b := make([]byte, 20)
	rand.Read(b)
	return "0x" + hex.EncodeToString(b)[:40]
}

// Generate deposit address
func (uw *UserWallet) GenerateDepositAddress(userID, coin, chain string) *DepositAddress {
	return &DepositAddress{
		Coin:    coin,
		Chain:   chain,
		Address: generateAddress(),
	}
}

// Record deposit
func (uw *UserWallet) RecordDeposit(userID, coin, amount float64, txHash string) *DepositRecord {
	id := fmt.Sprintf("dep_%d", time.Now().UnixNano())
	record := &DepositRecord{
		ID:           id,
		Coin:         coin,
		Amount:       amount,
		FromAddress:  "external",
		ToAddress:    generateAddress(),
		TxHash:      txHash,
		Status:      "completed",
		Confirmations: 6,
		Time:        time.Now().UnixMilli(),
	}
	
	uw.deposits[id] = record
	uw.updateBalance(userID, coin, amount, true)
	
	return record
}

// Request withdrawal
func (uw *UserWallet) RequestWithdrawal(userID, coin string, amount, fee float64, toAddress string) *WithdrawalRecord {
	id := fmt.Sprintf("wd_%d", time.Now().UnixNano())
	record := &WithdrawalRecord{
		ID:        id,
		Coin:      coin,
		Amount:    amount,
		Fee:       fee,
		ToAddress: toAddress,
		Status:    "pending",
		Time:     time.Now().UnixMilli(),
	}
	
	uw.withdrawals[id] = record
	return record
}

// Internal transfer
func (uw *UserWallet) Transfer(fromUser, toUser, coin string, amount float64, transferType string) *TransferRecord {
	id := fmt.Sprintf("tx_%d", time.Now().UnixNano())
	record := &TransferRecord{
		ID:       id,
		Coin:     coin,
		Amount:   amount,
		FromUser: fromUser,
		ToUser:   toUser,
		Type:     transferType,
		Status:  "completed",
		Time:     time.Now().UnixMilli(),
	}
	
	uw.transfers[id] = record
	uw.updateBalance(fromUser, coin, -amount, true)
	uw.updateBalance(toUser, coin, amount, true)
	
	return record
}

// Update balance
func (uw *UserWallet) updateBalance(userID, coin string, amount float64, isFree bool) {
	if _, ok := uw.balances[userID]; !ok {
		uw.balances[userID] = make(map[string]*WalletBalance)
	}
	
	if _, ok := uw.balances[userID][coin]; !ok {
		uw.balances[userID][coin] = &WalletBalance{Coin: coin}
	}
	
	if isFree {
		uw.balances[userID][coin].Free += amount
	} else {
		uw.balances[userID][coin].Locked += amount
	}
}

// Get balance
func (uw *UserWallet) GetBalance(userID, coin string) *WalletBalance {
	if balances, ok := uw.balances[userID]; ok {
		if balance, ok := balances[coin]; ok {
			return balance
		}
	}
	return &WalletBalance{Coin: coin}
}

// Get deposits
func (uw *UserWallet) GetDeposits(userID string) []*DepositRecord {
	var result []*DepositRecord
	for _, d := range uw.deposits {
		if d.ToAddress != "" {
			result = append(result, d)
		}
	}
	return result
}

// Get withdrawals
func (uw *UserWallet) GetWithdrawals(userID string) []*WithdrawalRecord {
	var result []*WithdrawalRecord
	for _, w := range uw.withdrawals {
		result = append(result, w)
	}
	return result
}

// JSON output
func (r *DepositRecord) String() string {
	b, _ := json.Marshal(r)
	return string(b)
}

func main() {
	wallet := NewUserWallet()
	
	// Generate deposit address
	addr := wallet.GenerateDepositAddress("user1", "BTC", "Bitcoin")
	fmt.Printf("Deposit addr: %+v\n", addr)
	
	// Record deposit
	dep := wallet.RecordDeposit("user1", "BTC", 1.0, "0xtxh123")
	fmt.Printf("Deposit: %s\n", dep.String())
	
	// Check balance
	bal := wallet.GetBalance("user1", "BTC")
	fmt.Printf("Balance: %+v\n", bal)
	
	// Request withdrawal
	wd := wallet.RequestWithdrawal("user1", "BTC", 0.5, 0.0001, "0xwithdraw123")
	fmt.Printf("Withdrawal: %+v\n", wd)
}