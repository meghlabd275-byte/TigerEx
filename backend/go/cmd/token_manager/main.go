// Package token_manager provides token management services.
// Migrated from TypeScript to Go for token lifecycle management.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Token info
type TokenInfo struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Symbol     string  `json:"symbol"`
	Decimals   int     `json:"decimals"`
	TotalSupply float64 `json:"totalSupply"`
	Circulating float64 `json:"circulating"`
	IsMintable bool    `json:"isMintable"`
	IsBurnable bool    `json:"isBurnable"`
	Status    string  `json:"status"` // active, paused, delisted
}

// Token holder
type TokenHolder struct {
	Address   string  `json:"address"`
	Balance   float64 `json:"balance"`
	BalanceRaw uint64 `json:"balanceRaw"`
}

// Mint event
type MintEvent struct {
	ID        string  `json:"id"`
	To       string  `json:"to"`
	Amount   float64 `json:"amount"`
	MintedBy string  `json:"mintedBy"`
	Timestamp int64  `json:"timestamp"`
}

// Burn event
type BurnEvent struct {
	ID        string  `json:"id"`
	From      string  `json:"from"`
	Amount   float64 `json:"amount"`
	BurnedBy string  `json:"burnedBy"`
	 Timestamp int64 `json:"timestamp"`
}

// Store
type TokenStore struct {
	mu       sync.RWMutex
	tokens   map[string]*TokenInfo
	holders map[string]map[string]*TokenHolder // token -> address -> holder
	mints   map[string][]*MintEvent
	burns   map[string][]*BurnEvent
}

var (
	tokenStore = &TokenStore{
		tokens: make(map[string]*TokenInfo),
		holders: make(map[string]map[string]*TokenHolder),
		mints: make(map[string][]*MintEvent),
		burns: make(map[string][]*BurnEvent),
	}
)

// Initialize default tokens
func init() {
	tokens := []*TokenInfo{
		{ID: "btc", Name: "Bitcoin", Symbol: "BTC", Decimals: 8, TotalSupply: 21000000, Circulating: 19500000, IsMintable: false, IsBurnable: false, Status: "active"},
		{ID: "eth", Name: "Ethereum", Symbol: "ETH", Decimals: 18, TotalSupply: 0, Circulating: 120000000, IsMintable: true, IsBurnable: true, Status: "active"},
		{ID: "usdt", Name: "Tether USD", Symbol: "USDT", Decimals: 6, TotalSupply: 0, Circulating: 83000000000, IsMintable: true, IsBurnable: true, Status: "active"},
		{ID: "usdc", Name: "USD Coin", Symbol: "USDC", Decimals: 6, TotalSupply: 0, Circulating: 32000000000, IsMintable: true, IsBurnable: true, Status: "active"},
		{ID: "bnb", Name: "BNB", Symbol: "BNB", Decimals: 18, TotalSupply: 200000000, Circulating: 153000000, IsMintable: false, IsBurnable: false, Status: "active"},
		{ID: "sol", Name: "Solana", Symbol: "SOL", Decimals: 9, TotalSupply: 1000000000, Circulating: 460000000, IsMintable: false, IsBurnable: false, Status: "active"},
	}

	tokenStore.mu.Lock()
	defer tokenStore.mu.Unlock()

	for _, t := range tokens {
		tokenStore.tokens[t.ID] = t
	}
}

// Mint tokens
func Mint(tokenID, to string, amount float64, mintedBy string) (*MintEvent, error) {
	tokenStore.mu.RLock()
	token, ok := tokenStore.tokens[tokenID]
	tokenStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("token not found")
	}

	if !token.IsMintable {
		return nil, fmt.Errorf("token is not mintable")
	}

	event := &MintEvent{
		ID: fmt.Sprintf("mint_%d", time.Now().UnixNano()),
		To: to,
		Amount: amount,
		MintedBy: mintedBy,
		Timestamp: time.Now().UnixMilli(),
	}

	tokenStore.mu.Lock()
	defer tokenStore.mu.Unlock()

	tokenStore.mints[tokenID] = append(tokenStore.mints[tokenID], event)
	token.Circulating += amount

	return event, nil
}

// Burn tokens
func Burn(tokenID, from string, amount float64, burnedBy string) (*BurnEvent, error) {
	tokenStore.mu.RLock()
	token, ok := tokenStore.tokens[tokenID]
	tokenStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("token not found")
	}

	if !token.IsBurnable {
		return nil, fmt.Errorf("token is not burnable")
	}

	// Check balance
	holderBal := tokenStore.holders[tokenID][from]
	if holderBal != nil && holderBal.Balance < amount {
		return nil, fmt.Errorf("insufficient balance")
	}

	event := &BurnEvent{
		ID: fmt.Sprintf("burn_%d", time.Now().UnixNano()),
		From: from,
		Amount: amount,
		BurnedBy: burnedBy,
		Timestamp: time.Now().UnixMilli(),
	}

	tokenStore.mu.Lock()
	defer tokenStore.mu.Unlock()

	tokenStore.burns[tokenID] = append(tokenStore.burns[tokenID], event)
	token.Circulating -= amount

	return event, nil
}

// Get token info
func GetToken(tokenID string) (*TokenInfo, bool) {
	tokenStore.mu.RLock()
	defer tokenStore.mu.RUnlock()

	token, ok := tokenStore.tokens[tokenID]
	return token, ok
}

func main() {
	fmt.Println("Token Manager service initialized")

	// Show tokens
	for _, t := range tokenStore.tokens {
		fmt.Printf("%s: %s (%.0f %s circulating)\n", t.Symbol, t.Name, t.Circulating, t.Symbol)
	}

	// Mint
	mint, _ := Mint("eth", "user_001", 1000, "treasury")
	fmt.Printf("Minted: %.2f ETH to %s\n", mint.Amount, mint.To)

	// Info
	info, _ := GetToken("eth")
	fmt.Printf("ETH circulating: %.2f\n", info.Circulating)
}