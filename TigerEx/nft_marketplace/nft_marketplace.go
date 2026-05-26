package main

import (
	"fmt"
	"time"
)

// NFT Standard
type NFTStandard string

const (
	NFTStandardERC721 NFTStandard = "ERC721"
	NFTStandardERC1155 NFTStandard = "ERC1155"
	NFTStandardSOL NFTStandard = "SPL"
	NFTStandardTON NFTStandard = "TON"
)

// NFT category
type NFTCategory string

const (
	NFTCategoryArt NFTCategory = "Art"
	NFTCategoryCollectible NFTCategory = "Collectible"
	NFTCategoryGaming NFTCategory = "Gaming"
	NFTCategorySports NFTCategory = "Sports"
	NFTCategoryMusic NFTCategory = "Music"
	NFTCategoryDomain NFTCategory = "Domain"
	NFTCategoryUtility NFTCategory = "Utility"
	NFTCategoryPFP NFTCategory = "PFP"
)

// Auction type
type AuctionType string

const (
	AuctionEnglish AuctionType = "english"
	AuctionDutch AuctionType = "dutch"
	AuctionSealedBid AuctionType = "sealed_bid"
	AuctionFixedPrice AuctionType = "fixed_price"
)

// Sale status
type SaleStatus string

const (
	SaleListed SaleStatus = "listed"
	SaleSold SaleStatus = "sold"
	SaleCancelled SaleStatus = "cancelled"
	SaleExpired SaleStatus = "expired"
)

// NFT attribute
type NFTAttribute struct {
	TraitType string      `json:"trait_type"`
	Value    interface{} `json:"value"`
}

// NFT metadata
type NFTMetadata struct {
	Name         string        `json:"name"`
	Description string        `json:"description"`
	Image       string        `json:"image"`
	ExternalURL string        `json:"external_url,omitempty"`
	Attributes  []NFTAttribute `json:"attributes"`
	AnimationURL string      `json:"animation_url,omitempty"`
	BackgroundColor string    `json:"background_color,omitempty"`
}

// NFT listing
type NFTListing struct {
	ID          string    `json:"id"`
	TokenID     string    `json:"tokenId"`
	Collection  string    `json:"collection"`
	Seller     string    `json:"seller"`
	Price      float64   `json:"price"`
	Currency   string    `json:"currency"`
	Status     SaleStatus `json:"status"`
	ListedAt   int64     `json:"listedAt"`
	ExpiresAt  int64     `json:"expiresAt"`
}

// NFT collection
type NFTCollection struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Symbol    string     `json:"symbol"`
	Standard NFTStandard `json:"standard"`
	Category  NFTCategory `json:"category"`
	Owner    string     `json:"owner"`
	FloorPrice float64  `json:"floorPrice"`
	TotalNFTs int      `json:"totalNfts"`
}

// Bid
type Bid struct {
	ID        string  `json:"id"`
	ListingID string  `json:"listingId"`
	Bidder   string  `json:"bidder"`
	Amount   float64 `json:"amount"`
	Time     int64   `json:"time"`
}

// NFT Marketplace
type NFTMarketplace struct {
	Listings   map[string]*NFTListing
	Collections map[string]*NFTCollection
	Bids      map[string][]*Bid
}

// New creates marketplace
func NewNFTMarketplace() *NFTMarketplace {
	return &NFTMarketplace{
		Listings: make(map[string]*NFTListing),
		Collections: make(map[string]*NFTCollection),
		Bids: make(map[string][]*Bid),
	}
}

// Create collection
func (m *NFTMarketplace) CreateCollection(name, symbol string, standard NFTStandard, category NFTCategory, owner string) *NFTCollection {
	id := fmt.Sprintf("col_%d", time.Now().UnixNano())
	collection := &NFTCollection{
		ID: id,
		Name: name,
		Symbol: symbol,
		Standard: standard,
		Category: category,
		Owner: owner,
		FloorPrice: 0,
		TotalNFTs: 0,
	}
	m.Collections[id] = collection
	return collection
}

// List NFT for sale
func (m *NFTMarketplace) ListNFT(tokenID, collection, seller string, price float64, currency string, durationHours int) *NFTListing {
	id := fmt.Sprintf("listing_%d", time.Now().UnixNano())
	now := time.Now().UnixMilli()
	
	listing := &NFTListing{
		ID: id,
		TokenID: tokenID,
		Collection: collection,
		Seller: seller,
		Price: price,
		Currency: currency,
		Status: SaleListed,
		ListedAt: now,
		ExpiresAt: now + int64(durationHours*3600000),
	}
	
	m.Listings[id] = listing
	
	// Update collection count
	if col := m.Collections[collection]; col != nil {
		col.TotalNFTs++
	}
	
	return listing
}

// Buy NFT
func (m *NFTMarketplace) Buy(listingID, buyer string) bool {
	listing, ok := m.Listings[listingID]
	if !ok || listing.Status != SaleListed {
		return false
	}
	
	listing.Status = SaleSold
	return true
}

// Cancel listing
func (m *NFTMarketplace) Cancel(listingID string) bool {
	listing, ok := m.Listings[listingID]
	if !ok {
		return false
	}
	
	listing.Status = SaleCancelled
	return true
}

// Place bid
func (m *NFTMarketplace) PlaceBid(listingID, bidder string, amount float64) {
	bid := &Bid{
		ID: fmt.Sprintf("bid_%d", time.Now().UnixNano()),
		ListingID: listingID,
		Bidder: bidder,
		Amount: amount,
		Time: time.Now().UnixMilli(),
	}
	
	m.Bids[listingID] = append(m.Bids[listingID], bid)
}

// Get lowest listing for collection
func (m *NFTMarketplace) GetFloorPrice(collectionID string) float64 {
	var floor float64 = 0
	
	for _, listing := range m.Listings {
		if listing.Collection == collectionID && listing.Status == SaleListed {
			if floor == 0 || listing.Price < floor {
				floor = listing.Price
			}
		}
	}
	
	return floor
}

func main() {
	m := NewNFTMarketplace()
	
	// Create collection
	col := m.CreateCollection("Bored Ape", "BAYC", NFTStandardERC721, NFTCategoryArt, "creator1")
	fmt.Printf("Created: %s\n", col.Name)
	
	// List NFT
	listing := m.ListNFT("token1", col.ID, "seller1", 100.0, "ETH", 24)
	fmt.Printf("Listed: %s @ %.2f %s\n", listing.TokenID, listing.Price, listing.Currency)
	
	// Buy
	m.Buy(listing.ID, "buyer1")
	fmt.Printf("Status: %s\n", listing.Status)
	
	// Floor price
	m.ListNFT("token2", col.ID, "seller2", 80.0, "ETH", 24)
	floor := m.GetFloorPrice(col.ID)
	fmt.Printf("Floor: %.2f\n", floor)
}