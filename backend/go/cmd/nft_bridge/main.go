// Package nft_bridge provides cross-chain NFT bridge services.
// Migrated from TypeScript to Go for NFT bridging between chains.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Bridge request
type BridgeRequest struct {
	ID          string  `json:"id"`
	UserID     string  `json:"userId"`
	Collection string  `json:"collection"`
	TokenID   string  `json:"tokenId"`
	SourceChain string  `json:"sourceChain"`
	DestChain string  `json:"destChain"`
	Status   string  `json:"status"` // pending, wrapping, waiting_confirmation, completed, failed
	SourceTx  string  `json:"sourceTx"`
	DestTx    string  `json:"destTx"`
	CreatedAt int64   `json:"createdAt"`
}

// Chain config
type ChainConfig struct {
	ID        string  `json:"id"`
	Name     string  `json:"name"`
	BridgeContract string `json:"bridgeContract"`
	GasLimit  int     `json:"gasLimit"`
}

// Store
type BridgeStore struct {
	mu       sync.RWMutex
	requests map[string]*BridgeRequest
	chains   map[string]*ChainConfig
}

var (
	bridgeStore = &BridgeStore{
		requests: make(map[string]*BridgeRequest),
		chains: make(map[string]*ChainConfig),
	}
)

// Initialize chains
func init() {
	chains := []*ChainConfig{
		{ID: "ethereum", Name: "Ethereum", BridgeContract: "0xETH_BRIDGE", GasLimit: 200000},
		{ID: "polygon", Name: "Polygon", BridgeContract: "0xMATIC_BRIDGE", GasLimit: 150000},
		{ID: "bsc", Name: "BNB Chain", BridgeContract: "0xBSC_BRIDGE", GasLimit: 150000},
		{ID: "avalanche", Name: "Avalanche", BridgeContract: "0xAVAX_BRIDGE", GasLimit: 200000},
		{ID: "optimism", Name: "Optimism", BridgeContract: "0xOP_BRIDGE", GasLimit: 150000},
		{ID: "arbitrum", Name: "Arbitrum", BridgeContract: "0xARB_BRIDGE", GasLimit: 250000},
	}

	bridgeStore.mu.Lock()
	defer bridgeStore.mu.Unlock()

	for _, c := range chains {
		bridgeStore.chains[c.ID] = c
	}
}

// Initiate bridge
func InitiateBridge(userID, collection, tokenID, sourceChain, destChain string) (*BridgeRequest, error) {
	bridgeStore.mu.RLock()
	_, sourceOk := bridgeStore.chains[sourceChain]
	_, destOk := bridgeStore.chains[destChain]
	bridgeStore.mu.RUnlock()

	if !sourceOk || !destOk {
		return nil, fmt.Errorf("unsupported chain")
	}

	request := &BridgeRequest{
		ID: fmt.Sprintf("bridge_%d", time.Now().UnixNano()),
		UserID: userID,
		Collection: collection,
		TokenID: tokenID,
		SourceChain: sourceChain,
		DestChain: destChain,
		Status: "pending",
		CreatedAt: time.Now().UnixMilli(),
	}

	bridgeStore.mu.Lock()
	defer bridgeStore.mu.Unlock()
	bridgeStore.requests[request.ID] = request

	return request, nil
}

// Confirm wrap (source chain deposit received)
func ConfirmWrap(requestID, sourceTx string) error {
	bridgeStore.mu.Lock()
	defer bridgeStore.mu.Unlock()

	request, ok := bridgeStore.requests[requestID]
	if !ok {
		return fmt.Errorf("request not found")
	}

	request.Status = "waiting_confirmation"
	request.SourceTx = sourceTx

	return nil
}

// Complete bridge (destination chain mint)
func CompleteBridge(requestID, destTx string) error {
	bridgeStore.mu.Lock()
	defer bridgeStore.mu.Unlock()

	request, ok := bridgeStore.requests[requestID]
	if !ok {
		return fmt.Errorf("request not found")
	}

	request.Status = "completed"
	request.DestTx = destTx

	return nil
}

// Get status
func GetStatus(requestID string) (string, error) {
	bridgeStore.mu.RLock()
	defer bridgeStore.mu.RUnlock()

	request, ok := bridgeStore.requests[requestID]
	if !ok {
		return "", fmt.Errorf("request not found")
	}

	return request.Status, nil
}

// Supported chains
func GetSupportedChains() []*ChainConfig {
	bridgeStore.mu.RLock()
	defer bridgeStore.mu.RUnlock()

	var result []*ChainConfig
	for _, c := range bridgeStore.chains {
		result = append(result, c)
	}

	return result
}

func main() {
	fmt.Println("NFT Bridge service initialized")

	// Show chains
	chains := GetSupportedChains()
	fmt.Printf("Supported chains: %d\n", len(chains))
	for _, c := range chains {
		fmt.Printf("  - %s (%s)\n", c.Name, c.ID)
	}

	// Initiate bridge
	request, _ := InitiateBridge("user_001", "Bored Ape", "123", "ethereum", "polygon")
	fmt.Printf("Bridge initiated: %s from %s to %s\n", 
		request.Collection, request.SourceChain, request.DestChain)
}