// Package subaccount provides subaccount services.
// Managed subaccounts for institutions.
package main

import (
	"fmt"
	"sync"
	"time"
)

// SubAccount
type SubAccount struct {
	ID           string  `json:"id"`
	ParentID    string  `json:"parentId"`
	Name        string  `json:"name"`
	APIKeys     []string `json:"apiKeys"`
	Permissions []string `json:"permissions"`
	Status      string  `json:"status"` // active, frozen, closed
	CreatedAt   int64   `json:"createdAt"`
}

// Account Limit
type AccountLimit struct {
	SubAccountID string  `json:"subAccountId"`
	DailyQuota   float64 `json:"dailyQuota"`
	MonthlyLimit float64 `json:"monthlyLimit"`
	UsedDaliy   float64 `json:"usedDaily"`
	UsedMonthly float64 `json:"usedMonthly"`
}

// Sub Trade
type SubTrade struct {
	ID          string  `json:"id"`
	SubAccountID string  `json:"subAccountId"`
	Symbol      string  `json:"symbol"`
	Side        string  `json:"side"`
	Quantity    float64 `json:"quantity"`
	Price       float64 `json:"price"`
	Timestamp   int64   `json:"timestamp"`
	Status      string  `json:"status"`
}

// Store
type SubStore struct {
	mu       sync.RWMutex
	accounts map[string]*SubAccount
	limits   map[string]*AccountLimit
	trades   map[string]*SubTrade
}

var subStore = &SubStore{
	accounts: make(map[string]*SubAccount),
	limits: make(map[string]*AccountLimit),
	trades: make(map[string]*SubTrade),
}

// Create subaccount
func CreateSubAccount(parentID, name string, permissions []string) *SubAccount {
	sub := &SubAccount{
		ID: fmt.Sprintf("sub_%d", time.Now().UnixNano()),
		ParentID: parentID,
		Name: name,
		APIKeys: []string{},
		Permissions: permissions,
		Status: "active",
		CreatedAt: time.Now().UnixMilli(),
	}

	limit := &AccountLimit{
		SubAccountID: sub.ID,
		DailyQuota: 1000000,
		MonthlyLimit: 10000000,
		UsedDaliy: 0,
		UsedMonthly: 0,
	}

	subStore.mu.Lock()
	subStore.accounts[sub.ID] = sub
	subStore.limits[sub.ID] = limit
	subStore.mu.Unlock()

	return sub
}

// Generate API key
func GenAPIKey(subAccountID string) (string, error) {
	subStore.mu.RLock()
	sub, ok := subStore.accounts[subAccountID]
	subStore.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("subaccount not found")
	}

	key := fmt.Sprintf("tk_%d", time.Now().UnixNano())

	subStore.mu.Lock()
	sub.APIKeys = append(sub.APIKeys, key)
	subStore.mu.Unlock()

	return key, nil
}

// Trade with subaccount
func SubTrade(subAccountID, symbol, side string, quantity, price float64) (*SubTrade, error) {
	subStore.mu.RLock()
	acc, aok := subStore.accounts[subAccountID]
	lim, lok := subStore.limits[subAccountID]
	subStore.mu.RUnlock()

	if !aok {
		return nil, fmt.Errorf("subaccount not found")
	}

	if acc.Status != "active" {
		return nil, fmt.Errorf("subaccount not active")
	}

	value := quantity * price
	if lim.UsedDaliy+value > lim.DailyQuota {
		return nil, fmt.Errorf("daily quota exceeded")
	}

	trade := &SubTrade{
		ID: fmt.Sprintf("t_%d", time.now().UnixNano()),
		SubAccountID: subAccountID,
		Symbol: symbol,
		Side: side,
		Quantity: quantity,
		Price: price,
		Timestamp: time.Now().UnixMilli(),
		Status: "filled",
	}

	subStore.mu.Lock()
	subStore.trades[trade.ID] = trade
	lim.UsedDaliy += value
	lim.UsedMonthly += value
	subStore.mu.Unlock()

	return trade, nil
}

// Freeze subaccount
func FreezeSubAccount(subAccountID string) error {
	subStore.mu.RLock()
	sub, ok := subStore.accounts[subAccountID]
	subStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("not found")
	}

	subStore.mu.Lock()
	sub.Status = "frozen"
	subStore.mu.Unlock()

	return nil
}

// Close subaccount
func CloseSubAccount(subAccountID string) error {
	subStore.mu.RLock()
	sub, ok := subStore.accounts[subAccountID]
	subStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("not found")
	}

	subStore.mu.Lock()
	sub.Status = "closed"
	subStore.mu.Unlock()

	return nil
}

// Reset daily quota
func ResetDaily() {
	subStore.mu.Lock()
	for _, l := range subStore.limits {
		l.UsedDaliy = 0
	}
	subStore.mu.Unlock()
}

func main() {
	fmt.Println("SubAccount service initialized")

	sub := CreateSubAccount("parent1", "Trading Desk", []string{"trade", "read"})
	fmt.Printf("SubAccount: %s\n", sub.ID)

	key, _ := GenAPIKey(sub.ID)
	fmt.Printf("API Key: %s\n", key)
}