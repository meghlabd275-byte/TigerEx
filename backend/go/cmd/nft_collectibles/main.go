// Package nft_minting provides NFT minting services.
// Migrated from TypeScript to Go for NFT creation.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// NFT collection
type NFTCollection struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Symbol     string  `json:"symbol"`
	Description string  `json:"description"`
	MintedBy   string  `json:"mintedBy"`
	Supply    int     `json:"supply"`
	Minted    int     `json:"minted"`
	FloorPrice float64 `json:"floorPrice"`
	Royalty   float64 `json:"royalty"` // creator royalty %
	Status    string  `json:"status"` // active, paused
}

// NFT metadata
type NFTMetadata struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ImageURL   string `json:"imageURL"`
	ExternalURL string `json:"externalURL"`
	Attributes []Attribute `json:"attributes"`
}

// Attribute
type Attribute struct {
	TraitType  string `json:"traitType"`
	Value     string `json:"value"`
	Rarity    string `json:"rarity"` // common, uncommon, rare, legendary
}

// NFT mint
type NFTMint struct {
	ID          string     `json:"id"`
	CollectionID string   `json:"collectionId"`
	TokenID     int       `json:"tokenId"`
	Owner      string    `json:"owner"`
	Creator    string   `json:"creator"`
	Metadata   NFTMetadata `json:"metadata"`
	URI        string    `json:"uri"` // IPFS URI
	SHA256     string    `json:"sha256"` // content hash
	MintedAt   int64     `json:"mintedAt"`
	Status    string    `json:"status"` // minted, burnt
}

// Store
type NFTMintingStore struct {
	mu         sync.RWMutex
	collections map[string]*NFTCollection
	mints      map[string]*NFTMint
	tokenCount map[string]int // collection -> count
}

var (
	nftStore = &NFTMintingStore{
		collections: make(map[string]*NFTCollection),
		mints:       make(map[string]*NFTMint),
		tokenCount:  make(map[string]int),
	}
)

// Create collection
func CreateCollection(name, symbol, description, creator string, supply int, royalty float64) *NFTCollection {
	collection := &NFTCollection{
		ID:          fmt.Sprintf("col_%d", time.Now().UnixNano()),
		Name:       name,
		Symbol:     symbol,
		Description: description,
		MintedBy:   creator,
		Supply:    supply,
		Minted:    0,
		Royalty:   royalty,
		Status:    "active",
	}

	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()
	nftStore.collections[collection.ID] = collection

	return collection
}

// Calculate IPFS hash (simplified)
func calculateIPFSHash(metadata NFTMetadata) string {
	data := []byte(metadata.Name + metadata.Description)
	hash := sha256.Sum256(data)
	return "ipfs://Qm" + hex.EncodeToString(hash[:])[:44]
}

// Mint NFT
func Mint(collectionID, owner, creator string, metadata NFTMetadata) (*NFTMint, error) {
	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()

	collection, ok := nftStore.collections[collectionID]
	if !ok {
		return nil, fmt.Errorf("collection not found")
	}

	if collection.Status != "active" {
		return nil, fmt.Errorf("collection not active")
	}

	if collection.Minted >= collection.Supply {
		return nil, fmt.Errorf("collection supply exceeded")
	}

	tokenID := nftStore.tokenCount[collectionID]
	nftStore.tokenCount[collectionID]++

	uri := calculateIPFSHash(metadata)

	mint := &NFTMint{
		ID:          fmt.Sprintf("mint_%d", time.Now().UnixNano()),
		CollectionID: collectionID,
		TokenID:     tokenID,
		Owner:      owner,
		Creator:    creator,
		Metadata:   metadata,
		URI:       uri,
		SHA256:     fmt.Sprintf("0x%x", sha256.Sum256([]byte(uri))),
		MintedAt:   time.Now().UnixMilli(),
		Status:    "minted",
	}

	collection.Minted++
	nftStore.mints[mint.ID] = mint

	return mint, nil
}

// Transfer NFT
func Transfer(mintID, newOwner string) error {
	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()

	mint, ok := nftStore.mints[mintID]
	if !ok {
		return fmt.Errorf("NFT not found")
	}

	mint.Owner = newOwner
	return nil
}

// Burn NFT
func Burn(mintID string) error {
	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()

	mint, ok := nftStore.mints[mintID]
	if !ok {
		return fmt.Errorf("NFT not found")
	}

	mint.Status = "burnt"

	// Update collection count
	collection, ok := nftStore.collections[mint.CollectionID]
	if ok {
		collection.Minted--
	}

	return nil
}

// Get collection NFTs
func GetCollectionNFTs(collectionID string) []*NFTMint {
	nftStore.mu.RLock()
	defer nftStore.mu.RUnlock()

	var result []*NFTMint
	for _, m := range nftStore.mints {
		if m.CollectionID == collectionID && m.Status == "minted" {
			result = append(result, m)
		}
	}
	return result
}

// Update floor price
func UpdateFloorPrice(collectionID string, price float64) error {
	nftStore.mu.Lock()
	defer nftStore.mu.Unlock()

	collection, ok := nftStore.collections[collectionID]
	if !ok {
		return fmt.Errorf("collection not found")
	}

	collection.FloorPrice = price
	return nil
}

func main() {
	fmt.Println("NFT Minting service initialized")

	// Create collection
	collection := CreateCollection("Tiger Collection", "TIGER", "Exclusive tiger NFTs", "creator_001", 1000, 5.0)
	fmt.Printf("Created collection: %s (supply: %d)\n", collection.Name, collection.Supply)

	// Mint NFT
	metadata := NFTMetadata{
		Name:        "Tiger #1",
		Description: "Rare golden tiger",
		ImageURL:   "ipfs://QmTiger1.png",
		Attributes: []Attribute{
			{TraitType: "color", Value: "gold", Rarity: "legendary"},
			{TraitType: "background", Value: "sunset", Rarity: "rare"},
		},
	}

	mint, err := Mint(collection.ID, "user_001", "creator_001", metadata)
	if err != nil {
		fmt.Printf("Mint error: %v\n", err)
	} else {
		fmt.Printf("Minted: %s (Token #%d)\n", mint.Metadata.Name, mint.TokenID)
	}
}