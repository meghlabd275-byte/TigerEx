// Package nft - NFT Marketplace Service
package main

import (
	"fmt"
	"sync"
	"time"
)

type NFTStatus string
type SaleType string

const (
	StatusListed NFTStatus = "listed"
	StatusSold NFTStatus = "sold"
	StatusMinted NFTStatus = "minted"

	SaleFixed SaleType = "fixed"
	SaleAuction SaleType = "auction"
)

type NFT struct {
	ID string `json:"id"`
	Collection string `json:"collection"`
	Name string `json:"name"`
	OwnerID string `json:"ownerId"`
	URI string `json:"uri"`
	Metadata string `json:"metadata"`
	Royalties []int `json:"royalties"`
	Creator string `json:"creator"`
	Status NFTStatus `json:"status"`
	MintedAt time.Time `json:"mintedAt"`
}

type Listing struct {
	ID string `json:"id"`
	NFTID string `json:"nftId"`
	SellerID string `json:"sellerId"`
	Price float64 `json:"price"`
	Token string `json:"token"`
	SaleType SaleType `json:"saleType"`
	HighestBid float64 `json:"highestBid"`
	BidderID string `json:"bidderId"`
	EndsAt *time.Time `json:"endsAt"`
	Status string `json:"status"`
}

type Collection struct {
	ID string `json:"id"`
	Name string `json:"name"`
	Symbol string `json:"symbol"`
	Creator string `json:"creator"`
	FloorPrice float64 `json:"floorPrice"`
	Volume float64 `json:"volume"`
	Owners int `json:"owners"`
}

type NFTService struct {
	mu sync.RWMutex
	nfts map[string]*NFT
	listings map[string]*Listing
	collections map[string]*Collection
	counter uint64
}

func NewNFTService() *NFTService {
	ns := &NFTService{
		nfts: make(map[string]*NFT),
		listings: make(map[string]*Listing),
		collections: make(map[string]*Collection),
	}
	return ns
}

func (ns *NFTService) MintCollection(name, symbol, creator string) (*Collection, error) {
	ns.mu.Lock()
	defer ns.mu.Unlock()

	col := &Collection{
		ID: fmt.Sprintf("col_%d", ns.counter),
		Name: name,
		Symbol: symbol,
		Creator: creator,
		Volume: 0,
		Owners: 0,
	}

	ns.collections[col.ID] = col
	ns.counter++
	return col, nil
}

func (ns *NFTService) MintNFT(collection, name, ownerID, uri string, royalties []int) (*NFT, error) {
	ns.mu.Lock()
	defer ns.mu.Unlock()

	nft := &NFT{
		ID: fmt.Sprintf("nft_%d", ns.counter),
		Collection: collection,
		Name: name,
		OwnerID: ownerID,
		URI: uri,
		Royalties: royalties,
		Creator: ownerID,
		Status: StatusMinted,
		MintedAt: time.Now(),
	}

	ns.nfts[nft.ID] = nft
	ns.counter++
	return nft, nil
}

func (ns *NFTService) List(nftID, sellerID string, price float64, token string, saleType SaleType) (*Listing, error) {
	ns.mu.Lock()
	defer ns.mu.Unlock()

	nft, ok := ns.nfts[nftID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}

	if nft.OwnerID != sellerID {
		return nil, fmt.Errorf("not owner")
	}

	listing := &Listing{
		ID: fmt.Sprintf("list_%d", ns.counter),
		NFTID: nftID,
		SellerID: sellerID,
		Price: price,
		Token: token,
		SaleType: saleType,
		Status: "active",
	}

	ns.listings[listing.ID] = listing
	nft.Status = StatusListed
	ns.counter++
	return listing, nil
}

func (ns *NFTService) Buy(listingID, buyerID string) error {
	ns.mu.Lock()
	defer ns.mu.Unlock()

	lst, ok := ns.listings[listingID]
	if !ok {
		return fmt.Errorf("listing not found")
	}

	if lst.Status != "active" {
		return fmt.Errorf("not available")
	}

	nft := ns.nfts[lst.NFTID]
	nft.OwnerID = buyerID
	nft.Status = StatusSold
	lst.Status = "sold"

	col := ns.collections[nft.Collection]
	if col != nil {
		col.Volume += lst.Price
		col.Owners++
	}

	return nil
}

func (ns *NFTService) Bid(listingID, bidderID string, amount float64) error {
	ns.mu.Lock()
	defer ns.mu.Unlock()

	lst, ok := ns.listings[listingID]
	if !ok {
		return fmt.Errorf("listing not found")
	}

	if amount > lst.HighestBid {
		lst.HighestBid = amount
		lst.BidderID = bidderID
	}

	return nil
}

func (ns *NFTService) GetFloorPrice(collection string) float64 {
	ns.mu.RLock()
	defer ns.mu.RUnlock()

	minPrice := 0.0
	for _, lst := range ns.listings {
		if lst.Status == "active" {
			nft := ns.nfts[lst.NFTID]
			if nft.Collection == collection && (minPrice == 0 || lst.Price < minPrice) {
				minPrice = lst.Price
			}
		}
	}
	return minPrice
}

func main() {
	ns := NewNFTService()

	col, _ := ns.MintCollection("Tiger NFTs", "TIGER", "admin")
	fmt.Printf("Collection: %s\n", col.ID)

	nft, _ := ns.MintNFT(col.ID, "Tiger #1", "user1", "ipfs://...", []int{5})
	fmt.Printf("NFT: %s\n", nft.ID)

	lst, _ := ns.List(nft.ID, "user1", 1.5, "USDT", SaleFixed)
	fmt.Printf("Listed: %s @ %.2f USDT\n", lst.ID, lst.Price)

	ns.Buy(lst.ID, "user2")
	fmt.Printf("Sold!\n")
}