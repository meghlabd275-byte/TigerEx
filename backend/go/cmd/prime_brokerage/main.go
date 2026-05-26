// Package prime_brokerage provides institutional brokerage services.
// Prime brokerage for institutional clients.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Prime Account
type PrimeAccount struct {
	ID            string  `json:"id"`
	InstitutionID string  `json:"institutionId"`
	AccountType string  `json:"accountType"` // hedge_fund, family_office, prop_firm
	Status      string  `json:"status"` // pending, active, suspended
	TradingLimit float64 `json:"tradingLimit"` // daily limit
	FeeStructure string  `json:"feeStructure"` // volume_based, flat
}

// Sub-account
type SubAccount struct {
	ID          string  `json:"id"`
	PrimeID    string  `json:"primeId"`
	Name       string  `json:"name"`
	Allocation float64 `json:"allocation"`
	Used      float64 `json:"used"`
}

// Prime Order (smart order router)
type PrimeOrder struct {
	ID           string  `json:"id"`
	PrimeID     string  `json:"primeId"`
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	OrderType  string  `json:"orderType"` // algorithm, direct
	Algo       string  `json:"algo"` // TWAP, VWAP, POV, IS
	Size       float64 `json:"size"`
	LimitPrice float64 `json:"limitPrice"`
	SplitCount int    `json:"splitCount"`
	Interval   int     `json:"interval"` // seconds
	Status    string  `json:"status"` // pending, partial, completed, cancelled
	Filled     float64 `json:"filled"`
}

// Execution Report
type ExecutionReport struct {
	OrderID    string  `json:"orderId"`
	ExecID     string  `json:"execId"`
	Price      float64 `json:"price"`
	Size       float64 `json:"size"`
	Commission float64 `json:"commission"`
	ExecType   string  `json:"execType"` // new, fill, partial
	Timestamp int64   `json:"timestamp"`
}

// Store
type PrimeStore struct {
	mu       sync.RWMutex
	accounts map[string]*PrimeAccount
	subaccs  map[string]*SubAccount
	orders   map[string]*PrimeOrder
	reports map[string][]ExecutionReport
}

var primeStore = &PrimeStore{
	accounts: make(map[string]*PrimeAccount),
	subaccs: make(map[string]*SubAccount),
	orders: make(map[string]*PrimeOrder),
	reports: make(map[string][]ExecutionReport),
}

// Create prime account
func CreatePrimeAccount(institutionID, accountType string, limit float64, feeStruct string) *PrimeAccount {
	account := &PrimeAccount{
		ID: fmt.Sprintf("prime_%d", time.Now().UnixNano()),
		InstitutionID: institutionID,
		AccountType: accountType,
		Status: "active",
		TradingLimit: limit,
		FeeStructure: feeStruct,
	}

	primeStore.mu.Lock()
	primeStore.accounts[account.ID] = account
	primeStore.mu.Unlock()

	return account
}

// Create sub-account
func CreateSubAccount(primeID, name string, allocation float64) *SubAccount {
	sub := &SubAccount{
		ID: fmt.Sprintf("sub_%d", time.Now().UnixNano()),
		PrimeID: primeID,
		Name: name,
		Allocation: allocation,
		Used: 0,
	}

	primeStore.mu.Lock()
	primeStore.subaccs[sub.ID] = sub
	primeStore.mu.Unlock()

	return sub
}

// Submit smart order
func SubmitSmartOrder(primeID, symbol, side, algo string, size, price float64, splitCount, interval int) *PrimeOrder {
	order := &PrimeOrder{
		ID: fmt.Sprintf("algo_%d", time.Now().UnixNano()),
		PrimeID: primeID,
		Symbol: symbol,
		Side: side,
		OrderType: "algorithm",
		Algo: algo,
		Size: size,
		LimitPrice: price,
		SplitCount: splitCount,
		Interval: interval,
		Status: "pending",
		Filled: 0,
	}

	primeStore.mu.Lock()
	primeStore.orders[order.ID] = order
	primeStore.mu.Unlock()

	return order
}

// Execute slice
func ExecuteSlice(orderID string, execPrice, execSize float64) *ExecutionReport {
	primeStore.mu.RLock()
	order, ok := primeStore.orders[orderID]
	primeStore.mu.RUnlock()

	if !ok {
		return nil
	}

	commission := execSize * execPrice * 0.0001 // 0.01%

	report := &ExecutionReport{
		OrderID: orderID,
		ExecID: fmt.Sprintf("exec_%d", time.Now().UnixNano()),
		Price: execPrice,
		Size: execSize,
		Commission: commission,
		ExecType: "fill",
		Timestamp: time.Now().UnixMilli(),
	}

	primeStore.mu.Lock()
	order.Filled += execSize
	if order.Filled >= order.Size {
		order.Status = "completed"
	} else {
		order.Status = "partial"
	}
	primeStore.reports[orderID] = append(primeStore.reports[orderID], *report)
	primeStore.mu.Unlock()

	return report
}

// Get executions
func GetExecutions(orderID string) []ExecutionReport {
	primeStore.mu.RLock()
	defer primeStore.mu.RUnlock()
	return primeStore.reports[orderID]
}

func main() {
	fmt.Println("Prime Brokerage service initialized")

	// Create account
	acc := CreatePrimeAccount("inst1", "hedge_fund", 100000000, "volume_based")
	fmt.Printf("Prime account: %s\n", acc.ID)

	// Submit TWAP order
	order := SubmitSmartOrder(acc.ID, "BTCUSDT", "buy", "TWAP", 10.0, 65000, 100, 60)
	fmt.Printf("Smart order: %s Algo: %s\n", order.ID, order.Algo)
}