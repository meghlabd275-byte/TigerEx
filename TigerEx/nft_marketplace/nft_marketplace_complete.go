// =============================================================================
// COMPREHENSIVE NFT MARKETPLACE
// Complete NFT marketplace with minting, trading, auctions, and collections
// =============================================================================

package nft

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"
)

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	NFTStandardERC721 = "ERC721"
	NFTStandardERC1155 = "ERC1155"
	
	 SaleTypeFixed = "fixed_price"
	SaleTypeAuction = "auction"
	SaleTypeBid = "bid"
	
	StatusMinted = "minted"
	StatusListed = "listed"
	StatusSold = "sold"
	StatusAuctionActive = "auction_active"
	StatusTransferred = "transferred"
	StatusBurned = "burned"
)

// ============================================================================
// TYPES
// ============================================================================

// NFT represents a non-fungible token
type NFT struct {
	ID            string    `json:"id"`
	TokenID      string    `json:"token_id"`
	ContractAddress string `json:"contract_address"`
	Standard     string    `json:"standard"`
	Creator      string    `json:"creator"`
	Owner        string    `json:"owner"`
	Metadata     *NFTMetadata `json:"metadata"`
	Royalty     int       `json:"royalty"` // Creator royalty percentage
	CollectionID string    `json:"collection_id"`
	Status       string    `json:"status"`
	Price        float64   `json:"price"`
	Offers      []Offer   `json:"offers"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	
	mu          sync.RWMutex
}

// NFTMetadata contains token metadata
type NFTMetadata struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ImageURL    string            `json:"image_url"`
	AnimationURL string           `json:"animation_url"`
	ExternalURL string           `json:"external_url"`
	Attributes  []NFTAttribute    `json:"attributes"`
	Properties map[string]string `json:"properties"`
}

// NFTAttribute represents trait attributes
type NFTAttribute struct {
	TraitType   string  `json:"trait_type"`
	Value       string  `json:"value"`
	DisplayType string  `json:"display_type"`
	Rarity      float64 `json:"rarity"`
}

// Collection represents an NFT collection
type Collection struct {
	ID              string     `json:"id"`
	Name           string     `json:"name"`
	Symbol         string     `json:"symbol"`
	Description    string     `json:"description"`
	Creator        string     `json:"creator"`
	ContractAddress string   `json:"contract_address"`
	Standard       string     `json:"standard"`
	Category       string     `json:"category"`
	LogoURL        string     `json:"logo_url"`
	BannerURL      string     `json:"banner_url"`
	WebsiteURL     string     `json:"website_url"`
	TotalMinted    int        `json:"total_minted"`
	TotalBurned    int        `json:"total_burned"`
	OwnersCount    int        `json:"owners_count"`
	TradingVolume  float64    `json:"trading_volume"`
	FeePercent     float64    `json:"fee_percent"` // Marketplace fee
	IsVerified    bool       `json:"is_verified"`
	IsExclusive   bool       `json:"is_exclusive"`
	CreatedAt     time.Time  `json:"created_at"`
	
	mu             sync.RWMutex
}

// Listing represents an NFT for sale
type Listing struct {
	ID           string     `json:"id"`
	NFTID       string     `json:"nft_id"`
	Seller      string     `json:"seller"`
	Price       float64    `json:"price"`
	PaymentToken string    `json:"payment_token"` // "ETH", "USDT", etc.
	SaleType    string    `json:"sale_type"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	Status      string     `json:"status"` // "active", "sold", "cancelled", "expired"
	
	// Auction specific
	StartingPrice float64   `json:"starting_price"`
	ReservePrice  float64   `json:"reserve_price"`
	CurrentBid   float64   `json:"current_bid"`
	HighestBidder string    `json:"highest_bidder"`
	BidCount     int       `json:"bid_count"`
	
	// ERC1155 specific
	Quantity     int        `json:"quantity"` // For ERC1155
	
	CreatedAt    time.Time `json:"created_at"`
}

// Offer represents an offer on an NFT
type Offer struct {
	ID          string    `json:"id"`
	NFTID       string    `json:"nft_id"`
	Offerer     string    `json:"offerer"`
	Price       float64   `json:"price"`
	PaymentToken string   `json:"payment_token"`
	Status      string    `json:"status"` // "pending", "accepted", "rejected", "expired"
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

// Auction represents an auction
type Auction struct {
	ID              string     `json:"id"`
	NFTID           string     `json:"nft_id"`
	Seller          string     `json:"seller"`
	StartingPrice   float64    `json:"starting_price"`
	ReservePrice    float64    `json:"reserve_price"`
	BuyNowPrice    float64    `json:"buy_now_price"`
	CurrentPrice   float64    `json:"current_price"`
	HighestBidder  string     `json:"highest_bidder"`
	BidCount       int        `json:"bid_count"`
	StartTime      time.Time  `json:"start_time"`
	EndTime        time.Time  `json:"end_time"`
	Status         string     `json:"status"` // "upcoming", "active", "ended", "cancelled"
	Winner         string     `json:"winner"`
	PaymentToken   string     `json:"payment_token"`
	
	mu              sync.RWMutex
}

// Bid represents a bid in auction
type Bid struct {
	ID          string    `json:"id"`
	AuctionID   string    `json:"auction_id"`
	Bidder     string    `json:"bidder"`
	Price      float64   `json:"price"`
	Timestamp  time.Time `json:"timestamp"`
}

// NFTMarketplace is the main marketplace service
type NFTMarketplace struct {
	mu              sync.RWMutex
	nfts            map[string]*NFT
	collections     map[string]*Collection
	listings       map[string]*Listing
	auctions       map[string]*Auction
	offers         map[string]*Offer
	bids            map[string][]*Bid
	userCollections map[string]map[string]bool // userID -> collectionID
	orderIndex     map[string]string // nftID -> listingID
	
	feeCollector    map[string]float64 // userID -> fee amount
	config          Config
	
	status          string
	startTime      time.Time
}

// Config for marketplace
type Config struct {
	MarketplaceFee  float64   // Marketplace takes X%
	RoyaltyBPS     int       // Basis points for royalty
	MinListingPrice float64
	MaxListingPrice float64
	AuctionDuration time.Duration
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

func NewMarketplace(cfg Config) *NFTMarketplace {
	if cfg.MarketplaceFee <= 0 {
		cfg.MarketplaceFee = 2.5 // 2.5%
	}
	if cfg.RoyaltyBPS <= 0 {
		cfg.RoyaltyBPS = 750 // 7.5%
	}
	
	return &NFTMarketplace{
		nfts:            make(map[string]*NFT),
		collections:     make(map[string]*Collection),
		listings:       make(map[string]*Listing),
		auctions:       make(map[string]*Auction),
		offers:         make(map[string]*Offer),
		bids:           make(map[string][]*Bid),
		userCollections: make(map[string]map[string]bool),
		feeCollector:   make(map[string]float64),
		config:         cfg,
		status:         "active",
		startTime:     time.Now(),
	}
}

// ============================================================================
// COLLECTION MANAGEMENT
// ============================================================================

// CreateCollection creates a new NFT collection
func (m *NFTMarketplace) CreateCollection(ctx context.Context, creator string, req *CreateCollectionRequest) (*Collection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	if req.Name == "" || req.Symbol == "" {
		return nil, fmt.Errorf("name and symbol required")
	}
	
	collection := &Collection{
		ID:               generateCollectionID(),
		Name:            req.Name,
		Symbol:          req.Symbol,
		Description:     req.Description,
		Creator:         creator,
		Standard:       req.Standard,
		Category:       req.Category,
		LogoURL:        req.LogoURL,
		BannerURL:      req.BannerURL,
		WebsiteURL:     req.WebsiteURL,
		FeePercent:     m.config.MarketplaceFee,
		TotalMinted:    0,
		OwnersCount:    0,
		IsVerified:    false,
		CreatedAt:      time.Now(),
	}
	
	m.collections[collection.ID] = collection
	
	// Track user collections
	if m.userCollections[creator] == nil {
		m.userCollections[creator] = make(map[string]bool)
	}
	m.userCollections[creator][collection.ID] = true
	
	return collection, nil
}

// GetCollection gets a collection by ID
func (m *NFTMarketplace) GetCollection(ctx context.Context, collectionID string) (*Collection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	collection, ok := m.collections[collectionID]
	if !ok {
		return nil, fmt.Errorf("collection not found")
	}
	
	return collection, nil
}

// ListCollections lists all collections
func (m *NFTMarketplace) ListCollections(ctx context.Context, category string, limit, offset int) ([]*Collection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	collections := make([]*Collection, 0)
	for _, c := range m.collections {
		if category == "" || c.Category == category {
			collections = append(collections, c)
		}
	}
	
	// Apply pagination
	if offset >= len(collections) {
		return []*Collection{}, nil
	}
	
	end := offset + limit
	if end > len(collections) {
		end = len(collections)
	}
	
	return collections[offset:end], nil
}

// ============================================================================
// NFT MINTING
// ============================================================================

// MintNFT mints a new NFT
func (m *NFTMarketplace) MintNFT(ctx context.Context, creator string, req *MintNFTRequest) (*NFT, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Verify collection exists
	collection, ok := m.collections[req.CollectionID]
	if !ok {
		return nil, fmt.Errorf("collection not found")
	}
	
	// Verify creator is authorized
	if collection.Creator != creator && !m.userCollections[creator][req.CollectionID] {
		return nil, fmt.Errorf("not authorized to mint in this collection")
	}
	
	nft := &NFT{
		ID:             generateNFTID(),
		TokenID:       generateTokenID(),
		ContractAddress: collection.ContractAddress,
		Standard:      collection.Standard,
		Creator:       creator,
		Owner:         creator,
		Metadata: &NFTMetadata{
			Name:        req.Name,
			Description: req.Description,
			ImageURL:    req.ImageURL,
			Attributes:  req.Attributes,
			Properties:  req.Properties,
		},
		Royalty:     m.config.RoyaltyBPS,
		CollectionID: req.CollectionID,
		Status:      StatusMinted,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	
	m.nfts[nft.ID] = nft
	
	// Update collection stats
	collection.TotalMinted++
	collection.OwnersCount++
	
	return nft, nil
}

// MintBatch mints multiple NFTs (for ERC1155)
func (m *NFTMarketplace) MintBatch(ctx context.Context, creator string, req *MintBatchRequest) ([]*NFT, error) {
	nfts := make([]*NFT, 0)
	
	for i := 0; i < req.Quantity; i++ {
		nft, err := m.MintNFT(ctx, creator, &MintNFTRequest{
			CollectionID: req.CollectionID,
			Name:        fmt.Sprintf("%s #%d", req.BaseName, i+1),
			Description: req.Description,
			ImageURL:    req.ImageURL,
			Attributes: req.Attributes,
			Properties: req.Properties,
		})
		
		if err != nil {
			return nfts, err
		}
		
		nfts = append(nfts, nft)
	}
	
	return nfts, nil
}

// TransferNFT transfers ownership of an NFT
func (m *NFTMarketplace) TransferNFT(ctx context.Context, nftID, from, to string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	nft, ok := m.nfts[nftID]
	if !ok {
		return fmt.Errorf("NFT not found")
	}
	
	if nft.Owner != from {
		return fmt.Errorf("not owner")
	}
	
	nft.Owner = to
	nft.Status = StatusTransferred
	nft.UpdatedAt = time.Now()
	
	return nil
}

// BurnNFT burns an NFT
func (m *NFTMarketplace) BurnNFT(ctx context.Context, nftID, owner string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	nft, ok := m.nfts[nftID]
	if !ok {
		return fmt.Errorf("NFT not found")
	}
	
	if nft.Owner != owner {
		return fmt.Errorf("not owner")
	}
	
	nft.Status = StatusBurned
	nft.UpdatedAt = time.Now()
	
	// Update collection
	collection, _ := m.collections[nft.CollectionID]
	if collection != nil {
		collection.TotalBurned++
	}
	
	return nil
}

// ============================================================================
// LISTING & SALES
// ============================================================================

// CreateListing creates a listing for an NFT
func (m *NFTMarketplace) CreateListing(ctx context.Context, seller string, req *CreateListingRequest) (*Listing, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Verify ownership
	nft, ok := m.nfts[req.NFTID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	if nft.Owner != seller {
		return nil, fmt.Errorf("not owner")
	}
	
	if nft.Status == StatusListed {
		return nil, fmt.Errorf("already listed")
	}
	
	listing := &Listing{
		ID:           generateListingID(),
		NFTID:       req.NFTID,
		Seller:      seller,
		Price:       req.Price,
		PaymentToken: req.PaymentToken,
		SaleType:    req.SaleType,
		StartTime:   time.Now(),
		EndTime:     time.Now().Add(m.config.AuctionDuration),
		Status:      "active",
		Quantity:    req.Quantity,
		CreatedAt:   time.Now(),
	}
	
	// Auction specific
	if req.SaleType == SaleTypeAuction {
		listing.StartingPrice = req.StartingPrice
		listing.ReservePrice = req.ReservePrice
		listing.CurrentBid = req.StartingPrice
	}
	
	m.listings[listing.ID] = listing
	m.orderIndex[req.NFTID] = listing.ID
	
	// Update NFT status
	nft.Status = StatusListed
	nft.Price = req.Price
	nft.UpdatedAt = time.Now()
	
	return listing, nil
}

// BuyNFT purchases an NFT at fixed price
func (m *NFTMarketplace) BuyNFT(ctx context.Context, nftID, buyer string, paymentToken string) (*Transaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Get listing
	listingID, ok := m.orderIndex[nftID]
	if !ok {
		return nil, fmt.Errorf("not listed for sale")
	}
	
	listing, ok := m.listings[listingID]
	if !ok {
		return nil, fmt.Errorf("listing not found")
	}
	
	if listing.Status != "active" {
		return nil, fmt.Errorf("listing not active")
	}
	
	nft, ok := m.nfts[nftID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	// Calculate fees
	price := listing.Price
	marketplaceFee := price * (m.config.MarketplaceFee / 100)
	royaltyFee := price * (float64(nft.Royalty) / 10000)
	sellerReceives := price - marketplaceFee - royaltyFee
	
	// Update NFT ownership
	nft.Owner = buyer
	nft.Status = StatusSold
	nft.UpdatedAt = time.Now()
	
	// Update listing
	listing.Status = "sold"
	delete(m.orderIndex, nftID)
	
	// Update collection
	collection, _ := m.collections[nft.CollectionID]
	if collection != nil {
		collection.TradingVolume += price
		collection.OwnersCount++
	}
	
	// Collect fees
	m.feeCollector["marketplace"] += marketplaceFee
	m.feeCollector[nft.Creator] += royaltyFee
	
	return &Transaction{
		ID: generateTxID(),
		Type: "nft_sale",
		NFTID: nftID,
		From: listing.Seller,
		To: buyer,
		Amount: price,
		Fee: marketplaceFee,
		Status: "completed",
	}, nil
}

// CancelListing cancels a listing
func (m *NFTMarketplace) CancelListing(ctx context.Context, listingID, seller string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	listing, ok := m.listings[listingID]
	if !ok {
		return fmt.Errorf("listing not found")
	}
	
	if listing.Seller != seller {
		return fmt.Errorf("not seller")
	}
	
	if listing.Status != "active" {
		return fmt.Errorf("listing not active")
	}
	
	listing.Status = "cancelled"
	
	// Update NFT status
	nft, _ := m.nfts[listing.NFTID]
	if nft != nil {
		nft.Status = StatusMinted
		nft.UpdatedAt = time.Now()
	}
	
	delete(m.orderIndex, listing.NFTID)
	
	return nil
}

// ============================================================================
// AUCTIONS
// ============================================================================

// CreateAuction creates an auction for an NFT
func (m *NFTMarketplace) CreateAuction(ctx context.Context, seller string, req *CreateAuctionRequest) (*Auction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	nft, ok := m.nfts[req.NFTID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	if nft.Owner != seller {
		return nil, fmt.Errorf("not owner")
	}
	
	auction := &Auction{
		ID:             generateAuctionID(),
		NFTID:          req.NFTID,
		Seller:         seller,
		StartingPrice:  req.StartingPrice,
		ReservePrice:   req.ReservePrice,
		BuyNowPrice:   req.BuyNowPrice,
		CurrentPrice:  req.StartingPrice,
		StartTime:     time.Now(),
		EndTime:       time.Now().Add(req.Duration),
		Status:         "active",
		PaymentToken:  req.PaymentToken,
		BidCount:      0,
	}
	
	m.auctions[auction.ID] = auction
	m.bids[auction.ID] = make([]*Bid, 0)
	
	// Update NFT
	nft.Status = StatusAuctionActive
	nft.UpdatedAt = time.Now()
	
	return auction, nil
}

// PlaceBid places a bid on an auction
func (m *NFTMarketplace) PlaceBid(ctx context.Context, auctionID, bidder string, amount float64) (*Bid, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	auction, ok := m.auctions[auctionID]
	if !ok {
		return nil, fmt.Errorf("auction not found")
	}
	
	if auction.Status != "active" {
		return nil, fmt.Errorf("auction not active")
	}
	
	now := time.Now()
	if now.Before(auction.StartTime) || now.After(auction.EndTime) {
		return nil, fmt.Errorf("auction not accepting bids")
	}
	
	// Validate bid
	if amount <= auction.CurrentPrice {
		return nil, fmt.Errorf("bid must be higher than current price")
	}
	
	// Check minimum increment
	minIncrement := auction.CurrentPrice * 0.05 // 5% minimum
	if amount < auction.CurrentPrice+minIncrement && amount != auction.BuyNowPrice {
		return nil, fmt.Errorf("bid must be at least 5%% higher")
	}
	
	// Create bid
	bid := &Bid{
		ID: generateBidID(),
		AuctionID: auctionID,
		Bidder: bidder,
		Price: amount,
		Timestamp: now,
	}
	
	m.bids[auctionID] = append(m.bids[auctionID], bid)
	
	// Update auction
	auction.CurrentPrice = amount
	auction.HighestBidder = bidder
	auction.BidCount++
	
	return bid, nil
}

// SettleAuction settles a completed auction
func (m *NFTMarketplace) SettleAuction(ctx context.Context, auctionID string) (*Transaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	auction, ok := m.auctions[auctionID]
	if !ok {
		return nil, fmt.Errorf("auction not found")
	}
	
	if auction.Status == "settled" {
		return nil, fmt.Errorf("already settled")
	}
	
	// Get NFT
	nft, ok := m.nfts[auction.NFTID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	var winner string
	var finalPrice float64
	
	if auction.HighestBidder != "" {
		winner = auction.HighestBidder
		finalPrice = auction.CurrentPrice
		
		// Calculate fees
		marketplaceFee := finalPrice * (m.config.MarketplaceFee / 100)
		royaltyFee := finalPrice * (float64(nft.Royalty) / 10000)
		sellerReceives := finalPrice - marketplaceFee - royaltyFee
		
		// Transfer NFT
		nft.Owner = winner
		nft.Status = StatusSold
		
		// Update collection
		collection, _ := m.collections[nft.CollectionID]
		if collection != nil {
			collection.TradingVolume += finalPrice
			collection.OwnersCount++
		}
		
		// Collect fees
		m.feeCollector["marketplace"] += marketplaceFee
		m.feeCollector[nft.Creator] += royaltyFee
		
		auction.Winner = winner
		auction.Status = "settled"
		
		return &Transaction{
			ID: generateTxID(),
			Type: "auction_sale",
			NFTID: auction.NFTID,
			From: auction.Seller,
			To: winner,
			Amount: finalPrice,
			Fee: marketplaceFee,
			Status: "completed",
		}, nil
	}
	
	// No bids - auction cancelled
	auction.Status = "cancelled"
	nft.Status = StatusMinted
	
	return nil, fmt.Errorf("no bids placed")
}

// ============================================================================
// OFFERS
// ============================================================================

// MakeOffer makes an offer on an NFT
func (m *NFTMarketplace) MakeOffer(ctx context.Context, offerer string, req *MakeOfferRequest) (*Offer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Verify NFT exists
	_, ok := m.nfts[req.NFTID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	offer := &Offer{
		ID: generateOfferID(),
		NFTID: req.NFTID,
		Offerer: offerer,
		Price: req.Price,
		PaymentToken: req.PaymentToken,
		Status: "pending",
		ExpiresAt: time.Now().Add(24 * time.Hour),
		CreatedAt: time.Now(),
	}
	
	m.offers[offer.ID] = offer
	
	// Add to NFT
	nft, _ := m.nfts[req.NFTID]
	if nft != nil {
		nft.Offers = append(nft.Offers, *offer)
	}
	
	return offer, nil
}

// AcceptOffer accepts an offer
func (m *NFTMarketplace) AcceptOffer(ctx context.Context, offerID, seller string) (*Transaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	offer, ok := m.offers[offerID]
	if !ok {
		return nil, fmt.Errorf("offer not found")
	}
	
	if offer.Status != "pending" {
		return nil, fmt.Errorf("offer not pending")
	}
	
	// Verify NFT ownership
	nft, ok := m.nfts[offer.NFTID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	if nft.Owner != seller {
		return nil, fmt.Errorf("not owner")
	}
	
	// Calculate fees
	price := offer.Price
	marketplaceFee := price * (m.config.MarketplaceFee / 100)
	royaltyFee := price * (float64(nft.Royalty) / 10000)
	sellerReceives := price - marketplaceFee - royaltyFee
	
	// Transfer NFT
	nft.Owner = offer.Offerer
	nft.Status = StatusSold
	nft.UpdatedAt = time.Now()
	
	// Update offer
	offer.Status = "accepted"
	
	// Update collection
	collection, _ := m.collections[nft.CollectionID]
	if collection != nil {
		collection.TradingVolume += price
		collection.OwnersCount++
	}
	
	// Collect fees
	m.feeCollector["marketplace"] += marketplaceFee
	m.feeCollector[nft.Creator] += royaltyFee
	
	return &Transaction{
		ID: generateTxID(),
		Type: "offer_accepted",
		NFTID: offer.NFTID,
		From: seller,
		To: offer.Offerer,
		Amount: price,
		Fee: marketplaceFee,
		Status: "completed",
	}, nil
}

// ============================================================================
// QUERY METHODS
// ============================================================================

func (m *NFTMarketplace) GetNFT(ctx context.Context, nftID string) (*NFT, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	nft, ok := m.nfts[nftID]
	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}
	
	return nft, nil
}

func (m *NFTMarketplace) GetListing(ctx context.Context, listingID string) (*Listing, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	listing, ok := m.listings[listingID]
	if !ok {
		return nil, fmt.Errorf("listing not found")
	}
	
	return listing, nil
}

func (m *NFTMarketplace) GetListingsByNFT(ctx context.Context, nftID string) (*Listing, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	listingID, ok := m.orderIndex[nftID]
	if !ok {
		return nil, fmt.Errorf("no listing found")
	}
	
	return m.listings[listingID], nil
}

func (m *NFTMarketplace) SearchListings(ctx context.Context, collectionID string, minPrice, maxPrice float64, limit int) ([]*Listing, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	results := make([]*Listing, 0)
	
	for _, listing := range m.listings {
		if listing.Status != "active" {
			continue
		}
		
		nft := m.nfts[listing.NFTID]
		if nft == nil {
			continue
		}
		
		if collectionID != "" && nft.CollectionID != collectionID {
			continue
		}
		
		if minPrice > 0 && listing.Price < minPrice {
			continue
		}
		
		if maxPrice > 0 && listing.Price > maxPrice {
			continue
		}
		
		results = append(results, listing)
		
		if limit > 0 && len(results) >= limit {
			break
		}
	}
	
	return results, nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func generateCollectionID() string { return fmt.Sprintf("COL_%x", time.Now().UnixNano()) }
func generateNFTID() string { return fmt.Sprintf("NFT_%x", time.Now().UnixNano()) }
func generateTokenID() string { return fmt.Sprintf("0x%x", time.Now().UnixNano()) }
func generateListingID() string { return fmt.Sprintf("LIST_%x", time.Now().UnixNano()) }
func generateAuctionID() string { return fmt.Sprintf("AUCT_%x", time.Now().UnixNano()) }
func generateBidID() string { return fmt.Sprintf("BID_%x", time.Now().UnixNano()) }
func generateOfferID() string { return fmt.Sprintf("OFFER_%x", time.Now().UnixNano()) }
func generateTxID() string { return fmt.Sprintf("TX_%x", time.Now().UnixNano()) }

// Request types
type CreateCollectionRequest struct {
	Name, Symbol, Description, Category string
	Standard string
	LogoURL, BannerURL, WebsiteURL string
}

type MintNFTRequest struct {
	CollectionID string
	Name, Description, ImageURL string
	Attributes []NFTAttribute
	Properties map[string]string
}

type MintBatchRequest struct {
	CollectionID string
	Quantity int
	BaseName, Description, ImageURL string
	Attributes []NFTAttribute
	Properties map[string]string
}

type CreateListingRequest struct {
	NFTID string
	Price float64
	PaymentToken string
	SaleType string
	Quantity int
	StartingPrice, ReservePrice float64
}

type CreateAuctionRequest struct {
	NFTID string
	StartingPrice, ReservePrice, BuyNowPrice float64
	PaymentToken string
	Duration time.Duration
}

type MakeOfferRequest struct {
	NFTID string
	Price float64
	PaymentToken string
}

type Transaction struct {
	ID string
	Type string
	NFTID string
	From, To string
	Amount, Fee float64
	Status string
}

var _ = json.Marshal
var _ = sha256.New
var _ = hex.Encode
var _ = math.MaxFloat64

func init() {}

var (
	_ context.Context
	_ time.Time
)