package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// NFT MARKETPLACE
// Full-featured NFT marketplace with minting, trading, and auctions
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// NFT represents a non-fungible token
type NFT struct {
	ID          string
	TokenID    string
	CollectionID string
	Owner      string
	Creator    string
	Metadata   NFTMetadata
	Royalty    float64 // Creator royalty percentage
	Status    NFTStatus
	Price      float64
	PriceAsset string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type NFTMetadata struct {
	Name        string
	Description string
	Image      string
	Animation  string
	ExternalURL string
	Attributes []Attribute
}

type Attribute struct {
	TraitType  string `json:"trait_type"`
	Value     string `json:"value"`
	DisplayType string `json:"display_type,omitempty"`
}

type NFTStatus string

const (
	NFTStatusMinted    NFTStatus = "MINTED"
	NFTStatusListed   NFTStatus = "LISTED"
	NFTStatusSold     NFTStatus = "SOLD"
	NFTStatusTransferred NFTStatus = "TRANSFERRED"
	NFTStatusBurned   NFTStatus = "BURNED"
)

// Collection represents an NFT collection
type Collection struct {
	ID          string
	Name        string
	Symbol     string
	Creator    string
	Description string
	Image      string
	ContractAddress string
	Royalty    float64
	Category   string
	Status     CollectionStatus
	NFTCount   int64
	OwnerCount int64
	Volume    float64
	CreatedAt time.Time
}

type CollectionStatus string

const (
	CollectionStatusPending  CollectionStatus = "PENDING"
	CollectionStatusActive  CollectionStatus = "ACTIVE"
	CollectionStatusPaused CollectionStatus = "PAUSED"
)

// Sale represents an NFT sale
type Sale struct {
	ID         string
	NFTID     string
	Seller    string
	Buyer     string
	Price     float64
	PriceAsset string
	Fee       float64
	Status    SaleStatus
	CreatedAt time.Time
}

type SaleStatus string

const (
	SaleStatusPending  SaleStatus = "PENDING"
	SaleStatusCompleted SaleStatus = "COMPLETED"
	SaleStatusCancelled SaleStatus = "CANCELLED"
)

// Auction represents an auction
type Auction struct {
	ID          string
	NFTID       string
	Seller     string
	StartPrice float64
	EndPrice   float64
	CurrentBid float64
	Bidder    string
	StartTime time.Time
	EndTime  time.Time
	Status   AuctionStatus
	Bids     []Bid
}

type Bid struct {
	Bidder   string
	Price   float64
	Time    time.Time
}

type AuctionStatus string

const (
	AuctionStatusPending AuctionStatus = "PENDING"
	AuctionStatusActive AuctionStatus = "ACTIVE"
	AuctionStatusEnded  AuctionStatus = "ENDED"
	AuctionStatusCancelled AuctionStatus = "CANCELLED"
)

// ============================================================================
// SERVICE
// ============================================================================

type NFTService struct {
	mu          sync.RWMutex
	collections map[string]*Collection
	nfts       map[string]*NFT
	sales      map[string]*Sale
	auctions   map[string]*Auction
	
	nftCounter    int64
	saleCounter   int64
	auctionCounter int64
}

func NewNFTService() *NFTService {
	return &NFTService{
		collections: make(map[string]*Collection),
		nfts:       make(map[string]*NFT),
		sales:      make(map[string]*Sale),
		auctions:   make(map[string]*Auction),
	}
}

// ============================================================================
// COLLECTION
// ============================================================================

func (s *NFTService) CreateCollection(creator, name, symbol, description, image, category string, royalty float64) (*Collection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	collection := &Collection{
		ID:            generateID("COL"),
		Name:          name,
		Symbol:       symbol,
		Creator:      creator,
		Description: description,
		Image:        image,
		Royalty:     royalty,
		Category:    category,
		Status:      CollectionStatusActive,
		NFTCount:    0,
		Volume:      0,
		CreatedAt:  time.Now(),
	}
	
	s.collections[collection.ID] = collection
	return collection, nil
}

func (s *NFTService) GetCollection(collectionID string) (*Collection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	collection, ok := s.collections[collectionID]
	if !ok {
		return nil, fmt.Errorf("collection not found")
	}
	
	return collection, nil
}

func (s *NFTService) GetCollections() []*Collection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*Collection
	for _, c := range s.collections {
		result = append(result, c)
	}
	
	return result
}

// ============================================================================
// NFT MINTING
// ============================================================================

func (s *NFTService) MintNFT(owner, creator, collectionID string, metadata NFTMetadata, royalty float64) (*NFT, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Validate collection
	collection, ok := s.collections[collectionID]
	if !ok {
		return nil, fmt.Errorf("collection not found")
	}
	
	s.nftCounter++
	nft := &NFT{
		ID:          fmt.Sprintf("NFT%d", s.nftCounter),
		TokenID:    fmt.Sprintf("%d", s.nftCounter),
		CollectionID: collectionID,
		Owner:      owner,
		Creator:    creator,
		Metadata:   metadata,
		Royalty:    royalty,
		Status:     NFTStatusMinted,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	
	s.nfts[nft.ID] = nft
	collection.NFTCount++
	
	return nft, nil
}

func (s *NFTService) GetNFT(nftID string) (*NFT, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	nft, ok := s.nfts[nftID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	return nft, nil
}

func (s *NFTService) GetNFTsByOwner(owner string) []*NFT {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*NFT
	for _, nft := range s.nfts {
		if nft.Owner == owner {
			result = append(result, nft)
		}
	}
	
	return result
}

func (s *NFTService) GetNFTsByCollection(collectionID string) []*NFT {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*NFT
	for _, nft := range s.nfts {
		if nft.CollectionID == collectionID {
			result = append(result, nft)
		}
	}
	
	return result
}

// ============================================================================
// LISTING & SALES
// ============================================================================

func (s *NFTService) ListNFT(nftID string, price float64, priceAsset string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	nft, ok := s.nfts[nftID]
	if !ok {
		return fmt.Errorf("NFT not found")
	}
	
	if nft.Status != NFTStatusMinted {
		return fmt.Errorf("NFT not available for listing")
	}
	
	nft.Price = price
	nft.PriceAsset = priceAsset
	nft.Status = NFTStatusListed
	nft.UpdatedAt = time.Now()
	
	return nil
}

func (s *NFTService) BuyNFT(nftID, buyer string) (*Sale, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	nft, ok := s.nfts[nftID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	if nft.Status != NFTStatusListed {
		return nil, fmt.Errorf("NFT not listed for sale")
	}
	
	saleCounter++
	sale := &Sale{
		ID:         fmt.Sprintf("SALE%d", s.saleCounter),
		NFTID:     nftID,
		Seller:    nft.Owner,
		Buyer:     buyer,
		Price:     nft.Price,
		PriceAsset: nft.PriceAsset,
		Fee:        nft.Price * 0.025, // 2.5% fee
		Status:    SaleStatusCompleted,
		CreatedAt: time.Now(),
	}
	
	s.sales[sale.ID] = sale
	
	// Update NFT
	nft.Owner = buyer
	nft.Status = NFTStatusSold
	nft.UpdatedAt = time.Now()
	
	// Update collection volume
	collection, _ := s.collections[nft.CollectionID]
	if collection != nil {
		collection.Volume += nft.Price
	}
	
	return sale, nil
}

func (s *NFTService) TransferNFT(nftID, from, to string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	nft, ok := s.nfts[nftID]
	if !ok {
		return fmt.Errorf("NFT not found")
	}
	
	if nft.Owner != from {
		return fmt.Errorf("not the owner")
	}
	
	nft.Owner = to
	nft.Status = NFTStatusTransferred
	nft.UpdatedAt = time.Now()
	
	return nil
}

// ============================================================================
// AUCTIONS
// ============================================================================

func (s *NFTService) CreateAuction(nftID, seller string, startPrice, endPrice float64, duration time.Duration) (*Auction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	nft, ok := s.nfts[nftID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	if nft.Status != NFTStatusMinted && nft.Status != NFTStatusListed {
		return nil, fmt.Errorf("NFT not available for auction")
	}
	
	s.auctionCounter++
	auction := &Auction{
		ID:          fmt.Sprintf("AUCTION%d", s.auctionCounter),
		NFTID:      nftID,
		Seller:     seller,
		StartPrice: startPrice,
		EndPrice:   endPrice,
		StartTime: time.Now(),
		EndTime:   time.Now().Add(duration),
		Status:    AuctionStatusActive,
		Bids:      []Bid{},
	}
	
	s.auctions[auction.ID] = auction
	
	// Update NFT status
	nft.Status = NFTStatusListed
	nft.UpdatedAt = time.Now()
	
	return auction, nil
}

func (s *NFTService) PlaceBid(auctionID, bidder string, price float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	auction, ok := s.auctions[auctionID]
	if !ok {
		return fmt.Errorf("auction not found")
	}
	
	if auction.Status != AuctionStatusActive {
		return fmt.Errorf("auction not active")
	}
	
	if time.Now().After(auction.EndTime) {
		return fmt.Errorf("auction ended")
	}
	
	if price <= auction.CurrentBid && auction.CurrentBid > 0 {
		return fmt.Errorf("bid must be higher than current bid")
	}
	
	// Place bid
	bid := Bid{
		Bidder: bidder,
		Price: price,
		Time:  time.Now(),
	}
	
	auction.Bids = append(auction.Bids, bid)
	auction.CurrentBid = price
	auction.Bidder = bidder
	
	return nil
}

func (s *NFTService) EndAuction(auctionID string) (*Sale, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	auction, ok := s.auctions[auctionID]
	if !ok {
		return nil, fmt.Errorf("auction not found")
	}
	
	if auction.Status != AuctionStatusActive {
		return nil, fmt.Errorf("auction not active")
	}
	
	auction.Status = AuctionStatusEnded
	
	if auction.CurrentBid > 0 && auction.Bidder != "" {
		// Complete sale
		nft, _ := s.nfts[auction.NFTID]
		
		saleCounter++
		sale := &Sale{
			ID:         fmt.Sprintf("SALE%d", s.saleCounter),
			NFTID:     auction.NFTID,
			Seller:    auction.Seller,
			Buyer:     auction.Bidder,
			Price:     auction.CurrentBid,
			PriceAsset: "USDT",
			Fee:        auction.CurrentBid * 0.025,
			Status:    SaleStatusCompleted,
			CreatedAt: time.Now(),
		}
		
		s.sales[sale.ID] = sale
		
		// Transfer NFT
		if nft != nil {
			nft.Owner = auction.Bidder
			nft.Status = NFTStatusSold
			nft.UpdatedAt = time.Now()
		}
		
		return sale, nil
	}
	
	return nil, nil
}

// ============================================================================
// STATS
// ============================================================================

func (s *NFTService) GetMarketStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var totalVolume float64
	var totalSales int64
	
	for _, sale := range s.sales {
		if sale.Status == SaleStatusCompleted {
			totalVolume += sale.Price
			totalSales++
		}
	}
	
	return map[string]interface{}{
		"total_collections": len(s.collections),
		"total_nfts":      len(s.nfts),
		"total_sales":     totalSales,
		"total_volume":    totalVolume,
	}
}

// ============================================================================
// HELPER
// ============================================================================

func generateID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%s%s%s", prefix, time.Now().Format("20060102"), hex.EncodeToString(b)[:6])
}

func main() {
	fmt.Println("TigerEx NFT Marketplace v1.0.0")
	
	nft := NewNFTService()
	
	// Create collection
	col, _ := nft.CreateCollection("user1", "Tiger NFT Collection", "TIGER", "Awesome tiger NFTs", "https://tigerex.com/collection.png", "Art", 5.0)
	fmt.Printf("Collection: %s\n", col.Name)
	
	// Mint NFT
	metadata := NFTMetadata{
		Name:        "Tiger #1",
		Description: "A rare tiger NFT",
		Image:      "https://tigerex.com/tiger1.png",
		Attributes: []Attribute{
			{TraitType: "Background", Value: "Blue"},
			{TraitType: "Tier", Value: "Legendary"},
		},
	}
	
	nft1, _ := nft.MintNFT("user1", "user1", col.ID, metadata, 5.0)
	fmt.Printf("Minted NFT: %s\n", nft1.TokenID)
	
	// List for sale
	nft.ListNFT(nft1.ID, 10.0, "USDT")
	
	// Buy NFT
	sale, _ := nft.BuyNFT(nft1.ID, "user2")
	fmt.Printf("Sold for: %.2f %s\n", sale.Price, sale.PriceAsset)
	
	// Get stats
	stats := nft.GetMarketStats()
	fmt.Printf("Market Stats: %+v\n", stats)
}