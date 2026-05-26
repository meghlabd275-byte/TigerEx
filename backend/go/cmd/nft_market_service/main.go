// Package nft_market_service provides NFT marketplace.
// Migrated from TypeScript to Go for NFT trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// NFT collection
type NFTCollection struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Symbol     string  `json:"symbol"`
	Blockchain string  `json:"blockchain"`
	FloorPrice float64 `json:"floorPrice"`
	Volume24h  float64 `json:"volume24h"`
}

// NFT item
type NFTItem struct {
	ID          string  `json:"id"`
	CollectionID string  `json:"collectionId"`
	TokenID    string  `json:"tokenId"`
	Owner      string  `json:"owner"`
	Price      float64 `json:"price"`
	Status     string  `json:"status"` // listed, sold, transferred
	ListedAt   int64   `json:"listedAt"`
}

// NFT trade
type NFTTrade struct {
	ID         string  `json:"id"`
	ItemID    string  `json:"itemId"`
	Seller    string  `json:"seller"`
	Buyer     string  `json:"buyer"`
	Price     float64 `json:"price"`
	Timestamp int64   `json:"timestamp"`
}

// Store
type NFTStore struct {
	mu         sync.RWMutex
	collections map[string]*NFTCollection
	items       map[string]*NFTItem
	trades      map[string]*NFTTrade
}

var (
	nftStore = &NFTStore{
		collections: make(map[string]*NFTCollection),
		items:       make(map[string]*NFTItem),
		trades:      make(map[string]*NFTTrade),
	}
)

// Initialize collections
func init() {
	collections := []*NFTCollection{
		{ID: "bored_ape", Name: "Bored Ape Yacht Club", Symbol: "BAYC", Blockchain: "eth", FloorPrice: 25.0, Volume24h: 500.0},
		{ID: "crypto_punks", Name: "CryptoPunks", Symbol: "PUNK", Blockchain: "eth", FloorPrice: 30.0, Volume24h: 1000.0},
		{ID: "azuki", Name: "Azuki", Symbol: "AZUKI", Blockchain: "eth", FloorPrice: 15.0, Volume24h: 300.0},
	}

	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()
	for _, c := range collections {
		nftStore.collections[c.ID] = c
	}
}

// List NFT for sale
func ListNFT(item *NFTItem) *NFTItem {
	item.ID = fmt.Sprintf("nft_%d", time.Now().UnixNano())
	item.Status = "listed"
	item.ListedAt = time.Now().UnixMilli()

	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()
	nftStore.items[item.ID] = item

	return item
}

// Buy NFT
func BuyNFT(itemID, buyerID string) (*NFTTrade, error) {
	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()

	item, ok := nftStore.items[itemID]
	if !ok {
		return nil, fmt.Errorf("item not found")
	}

	if item.Status != "listed" {
		return nil, fmt.Errorf("item not for sale")
	}

	trade := &NFTTrade{
		ID:         fmt.Sprintf("trade_%d", time.Now().UnixNano()),
		ItemID:    itemID,
		Seller:    item.Owner,
		Buyer:    buyerID,
		Price:     item.Price,
		Timestamp: time.Now().UnixMilli(),
	}

	// Update item
	item.Status = "sold"
	item.Owner = buyerID

	nftStore.trades[trade.ID] = trade
	return trade, nil
}

// Get floor price
func GetFloorPrice(collectionID string) (float64, bool) {
	nftStore.mu.RLock()
	defer nftStore.mu.RUnlock()

	c, ok := nftStore.collections[collectionID]
	return c.FloorPrice, ok
}

func main() {
	fmt.Println("NFT market service initialized")

	// List collections
	for _, c := range nftStore.collections {
		fmt.Printf("Collection: %s - Floor: %.2f ETH\n", c.Name, c.FloorPrice)
	}
}