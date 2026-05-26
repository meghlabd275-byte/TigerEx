// Package leverage_engine provides leveraged token products.
// Migrated from TypeScript to Go for leveraged tokens (3x, 5x, etc.)
package main

import (
	"fmt"
	"sync"
	"time"
)

// Leveraged token product
type LeveragedToken struct {
	ID        string  `json:"id"`
	Name     string  `json:"name"`
	Asset    string  `json:"asset"`
	Target   float64 `json:"target"` // 3x, 5x, -3x
	RebalanceThreshold float64 `json:"rebalanceThreshold"` // when to rebalance
	Fee       float64 `json:"fee"`
	Status   string  `json:"status"`
}

// Holding
type Holding struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	TokenID   string  `json:"tokenId"`
	Quantity  float64 `json:"quantity"`
	EntryNav  float64 `json:"entryNav"`
	CurrentNav float64 `json:"currentNav"`
}

// Vault (for rebalancing)
type Vault struct {
	ID          string  `json:"id"`
	TokenID   string  `json:"tokenId"`
	TokensHeld float64 `json:"tokensHeld"`
	Value     float64 `json:"value"`
	LastRebalance int64  `json:"lastRebalance"`
}

// Store
type LeverageStore struct {
	mu       sync.RWMutex
	tokens   map[string]*LeveragedToken
	holdings map[string]*Holding
	vaults   map[string]*Vault
}

var (
	levStore = &LeverageStore{
		tokens: make(map[string]*LevergedToken),
		holdings: make(map[string]*Holding),
		vaults: make(map[string]*Vault),
	}
)

// InitializeLeveredTokens
func init() {
	tokens := []*LeveragedToken{
		{ID: "BTC3L", Name: "Bull 3x BTC", Asset: "BTC", Target: 3.0, RebalanceThreshold: 0.15, Fee: 0.001, Status: "active"},
		{ID: "BTC3S", Name: "Bear 3x BTC", Asset: "BTC", Target: -3.0, RebalanceThreshold: 0.15, Fee: 0.001, Status: "active"},
		{ID: "BTC5L", Name: "Bull 5x BTC", Asset: "BTC", Target: 5.0, RebalanceThreshold: 0.20, Fee: 0.002, Status: "active"},
		{ID: "BTC5S", Name: "Bear 5x BTC", Asset: "BTC", Target: -5.0, RebalanceThreshold: 0.20, Fee: 0.002, Status: "active"},
		{ID: "ETH3L", Name: "Bull 3x ETH", Asset: "ETH", Target: 3.0, RebalanceThreshold: 0.15, Fee: 0.001, Status: "active"},
		{ID: "ETH3S", Name: "Bear 3x ETH", Asset: "ETH", Target: -3.0, RebalanceThreshold: 0.15, Fee: 0.001, Status: "active"},
		{ID: "ETH5L", Name: "Bull 5x ETH", Asset: "ETH", Target: 5.0, RebalanceThreshold: 0.20, Fee: 0.002, Status: "active"},
		{ID: "ETH5S", Name: "Bear 5x ETH", Asset: "ETH", Target: -5.0, RebalanceThreshold: 0.20, Fee: 0.002, Status: "active"},
	}

	levStore.mu.Lock()
	defer levStore.mu.Unlock()

	for _, t := range tokens {
		levStore.tokens[t.ID] = t
	}
}

// Mint (buy) leveraged token
func Mint(userID, tokenID string, amount float64) (*Holding, error) {
	levStore.mu.Lock()
	defer levStore.mu.Unlock()

	token, ok := levStore.tokens[tokenID]
	if !ok {
		return nil, fmt.Errorf("token not found")
	}

	if token.Status != "active" {
		return nil, fmt.Errorf("token not active")
	}

	nav := 1.0 // Start at $1 NAV
	holding := &Holding{
		ID: fmt.Sprintf("hold_%d", time.Now().UnixNano()),
		UserID: userID,
		TokenID: tokenID,
		Quantity: amount / nav, // tokens at $1 NAV
		EntryNav: nav,
		CurrentNav: nav,
	}

	levStore.holdings[holding.ID] = holding

	// Add to vault
	vault, ok := levStore.vaults[tokenID]
	if !ok {
		vault = &Vault{
			ID: fmt.Sprintf("vault_%s", tokenID),
			TokenID: tokenID,
			TokensHeld: 0,
			Value: 0,
		}
		levStore.vaults[tokenID] = vault
	}
	vault.TokensHeld += holding.Quantity
	vault.Value += amount

	return holding, nil
}

// Burn (sell) leveraged token
func Burn(holdingID string) (float64, error) {
	levStore.mu.Lock()
	defer levStore.mu.Unlock()

	holding, ok := levStore.holdings[holdingID]
	if !ok {
		return 0, fmt.Errorf("holding not found")
	}

	returnValue := holding.Quantity * holding.CurrentNav

	// Update vault
	vault, ok := levStore.vaults[holding.TokenID]
	if ok {
		vault.TokensHeld -= holding.Quantity
		vault.Value -= returnValue
	}

	delete(levStore.holdings, holdingID)

	return returnValue, nil
}

// RebalanceToken - rebalance when threshold hit
func RebalanceToken(tokenID, underlyingPrice string) error {
	levStore.mu.Lock()
	defer levStore.mu.Unlock()

	token, ok := levStore.tokens[tokenID]
	if !ok {
		return fmt.Errorf("token not found")
	}

	vault, ok := levStore.vaults[tokenID]
	if !ok {
		return fmt.Errorf("vault not found")
	}

	// In real impl: rebalance based on price move
	fmt.Printf("Rebalancing %s at threshold %.2f%%\n", tokenID, token.RebalanceThreshold*100)

	vault.LastRebalance = time.Now().UnixMilli()

	return nil
}

func main() {
	fmt.Println("Leverage Engine initialized")

	token, _ := levStore.tokens["BTC3L"]
	fmt.Printf("Token: %s (%s) - Target %.1fx\n", token.Name, token.Asset, token.Target)

	holding, _ := Mint("user_001", "BTC3L", 1000)
	fmt.Printf("Minted: %.4f %s at $%.4f NAV\n", holding.Quantity, holding.TokenID, holding.EntryNav)

	value, _ := Burn(holding.ID)
	fmt.Printf("Burned for: $%.2f\n", value)
}