// Package market provides NFT marketplace functionality.
package market

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
)

// NFTCollection represents an NFT collection
type NFTCollection struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Symbol        string           `json:"symbol"`
	Description   string           `json:"description"`
	ContractAddr  string           `json:"contract_address"`
	Chain        string           `json:"chain"`
	CreatorID     string           `json:"creator_id"`
	CreatorFee   decimal.Decimal `json:"creator_fee"` // Royalty percentage
	RoyaltyFee    decimal.Decimal `json:"royalty_fee"` // Secondary sale royalty
	Category     CollectionCategory `json:"category"`
	ImageURL     string          `json:"image_url"`
	BannerURL    string          `json:"banner_url"`
	IsVerified   bool            `json:"is_verified"`
	IsExclusive bool             `json:"is_exclusive"` // Creator-only minting
	MaxSupply   int             `json:"max_supply"`
	Minted      int             `json:"minted"`
	TotalVolume decimal.Decimal `json:"total_volume"`
	FloorPrice  decimal.Decimal `json:"floor_price"`
	Owners     int             `json:"owners"`
	CreatedAt  time.Time       `json:"created_at"`
}

// CollectionCategory represents category
type CollectionCategory string

const (
	CategoryArt           CollectionCategory = "ART"
	CategoryCollectible  CollectionCategory = "COLLECTIBLE"
	CategoryMusic        CollectionCategory = "MUSIC"
	CategoryDomain       CollectionCategory = "DOMAIN"
	CategoryVirtual     CollectionCategory = "VIRTUAL_WORLD"
	CategoryPFP         CollectionCategory = "PFP"
	CategoryUtility     CollectionCategory = "UTILITY"
)

// NFT represents a non-fungible token
type NFT struct {
	ID            string          `json:"id"`
	TokenID       string         `json:"token_id"`
	TokenURI      string         `json:"token_uri"`
	CollectionID string         `json:"collection_id"`
	Chain        string         `json:"chain"`
	OwnerID      string         `json:"owner_id"`
	CreatorID    string         `json:"creator_id"`
	Name         string         `json:"name"`
	Description string         `json:"description"`
	ImageURI    string         `json:"image_uri"`
	AnimationURI string         `json:"animation_uri"`
	Attributes  []Trait      `json:"attributes"` // Metadata traits
	MimeType     string       `json:"mime_type"`
	IsHidden     bool         `json:"is_hidden"`
	IsLocked    bool         `json:"is_locked"`
	ForSale     bool          `json:"for_sale"`
	Price       *decimal.Decimal `json:"price,omitempty"`
	PendingBuyer string       `json:"pending_buyer"`
	CreatorFee  decimal.Decimal `json:"creator_fee"`
	MintedAt    time.Time     `json:"minted_at"`
}

// Trait represents metadata trait
type Trait struct {
	Type   string `json:"type"`
	Value  string `json:"value"`
	Rarity string `json:"rarity"` // Percentage
}

// NFTOffer represents an offer for an NFT
type NFTOffer struct {
	ID         string          `json:"id"`
	NFTID      string         `json:"nft_id"`
	OffererID  string         `json:"offerer_id"`
	Price     decimal.Decimal `json:"price"`
	PaymentToken string     `json:"payment_token"`
	ExpiresAt time.Time   `json:"expires_at"`
	Status    OfferStatus  `json:"status"`
}

// OfferStatus represents offer status
type OfferStatus string

const (
	OfferStatusPending OfferStatus = "PENDING"
	OfferStatusAccepted OfferStatus = "ACCEPTED"
	OfferStatusExpired OfferStatus = "EXPIRED"
	OfferStatusCancelled OfferStatus = "CANCELLED"
)

// NFTBid represents an auction bid
type NFTBid struct {
	ID         string          `json:"id"`
	NFTID      string         `json:"nft_id"`
	BidderID  string         `json:"bidder_id"`
	Price     decimal.Decimal `json:"price"`
	PaymentToken string     `json:"payment_token"`
	ExpiresAt time.Time   `json:"expires_at"`
	Status    BidStatus   `json:"status"`
}

// BidStatus represents bid status
type BidStatus string

const (
	BidStatusActive  BidStatus = "ACTIVE"
	BidStatusWinning BidStatus = "WINNING"
	BidStatusOutbid BidStatus = "OUTBID"
	BidStatusWon    BidStatus = "WON"
)

// NFTAuction represents an auction
type NFTAuction struct {
	ID          string          `json:"id"`
	NFTID       string         `json:"nft_id"`
	SellerID    string         `json:"seller_id"`
	StartPrice decimal.Decimal `json:"start_price"`
	ReservePrice decimal.Decimal `json:"reserve_price"` // Minimum to accept
	BuyNowPrice decimal.Decimal `json:"buy_now_price"`
	StartTime  time.Time      `json:"start_time"`
	EndTime    time.Time      `json:"end_time"`
	HighestBid decimal.Decimal `json:"highest_bid"`
	HighestBidder string     `json:"highest_bidder"`
	Status     AuctionStatus `json:"status"`
}

// AuctionStatus represents auction status
type AuctionStatus string

const (
	AuctionStatusUpcoming AuctionStatus = "UPCOMING"
	AuctionStatusActive AuctionStatus = "ACTIVE"
	AuctionStatusEnded AuctionStatus = "ENDED"
	AuctionStatusSettled AuctionStatus = "SETTLED"
)

// NFTMarket manages NFT marketplace
type NFTMarket struct {
	mu           sync.RWMutex
	collections map[string]*NFTCollection
	nfts         map[string]*NFT
	offers       map[string]*NFTOffer
	bids         map[string]*NFTBid
	auctions     map[string]*NFTAuction
	offers      map[string]*NFTOffer
	transfers    map[string]*NFTTransfer
	blockchain NFTBlockchainAdapter
	ipfs      IPFSService
	ipfsGateway string
	cfg         *MarketConfig
}

// NFTBlockchainAdapter interfaces with blockchain
type NFTBlockchainAdapter interface {
	MintNFT(ctx context.Context, to, collection, tokenURI string) (tokenID string, err error)
	TransferNFT(ctx context.Context, from, to, collection, tokenID string) (err error)
	SetApproval(ctx context.Context, owner, operator, collection string, approved bool) (err error)
	BundleMint(ctx context.Context, to, collection, tokenURIs []string) ([]string, error)
}

// IPFSService handles IPFS storage
type IPFSService interface {
	Upload(data []byte) (cid string, err error)
	UploadJSON(metadata map[string]interface{}) (cid string, err error)
	Download(cid string) ([]byte, error)
}

// MarketConfig holds market configuration
type MarketConfig struct {
	ServiceFee decimal.Decimal // Platform fee
	MinPrice   decimal.Decimal
}

// NFTTransfer represents ownership transfer
type NFTTransfer struct {
	ID         string    `json:"id"`
	NFTID     string    `json:"nft_id"`
	FromID    string    `json:"from_id"`
	ToID      string    `json:"to_id"`
	Price     string    `json:"price"`
	TxHash    string    `json:"tx_hash"`
	Timestamp time.Time `json:"timestamp"`
}

// NFTCreateRequest represents NFT mint request
type NFTCreateRequest struct {
	CollectionID string         `json:"collection_id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ImageData   []byte        `json:"image_data"`
	AnimationData []byte       `json:"animation_data,omitempty"`
	Attributes []Trait      `json:"attributes"`
	MimeType   string       `json:"mime_type"`
	ForSale    bool         `json:"for_sale"`
	Price     *decimal.Decimal `json:"price,omitempty"`
}

// NewNFTMarket creates new NFT market
func NewNFTMarket() *NFTMarket {
	return &NFTMarket{
		collections: make(map[string]*NFTCollection),
		nfts:        make(map[string]*NFT),
		offers:      make(map[string]*NFTOffer),
		bid:        make(map[string]*NFTBid),
		auctions:   make(map[string]*NFTAuction),
		transfers:  make(map[string]*NFTTransfer),
		cfg:        &MarketConfig{
			ServiceFee: decimal.NewFromFloat(2.5), // 2.5%
			MinPrice:   decimal.NewFromFloat(0.001),
		},
	}
}

// CreateCollection creates a new collection
func (nm *NFTMarket) CreateCollection(ctx context.Context, creatorID string, req *CollectionRequest) (*NFTCollection, error) {
	// Validate
	if req.Name == "" || req.Symbol == "" {
		return nil, fmt.Errorf("name and symbol required")
	}

	collection := &NFTCollection{
		ID:           generateCollectionID(),
		Name:         req.Name,
		Symbol:       req.Symbol,
		Description:  req.Description,
		ContractAddr: generateContractAddress(),
		Chain:        req.Chain,
		CreatorID:    creatorID,
		CreatorFee:  decimal.Zero,
		RoyaltyFee:   req.RoyaltyFee,
		Category:    req.Category,
		ImageURL:    req.ImageURL,
		MaxSupply:   req.MaxSupply,
		IsVerified: false,
		IsExclusive: req.IsExclusive,
		CreatedAt:   time.Now(),
	}

	nm.mu.Lock()
	nm.collections[collection.ID] = collection
	nm.mu.Unlock()

	return collection, nil
}

// MintNFT mints a new NFT
func (nm *NFTMarket) MintNFT(ctx context.Context, creatorID string, req *NFTCreateRequest) (*NFT, error) {
	nm.mu.RLock()
	collection, ok := nm.collections[req.CollectionID]
	nm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("collection not found")
	}

	if collection.IsExclusive && collection.CreatorID != creatorID {
		return nil, fmt.Errorf("only collection creator can mint")
	}

	// Upload image to IPFS
	imageCID, err := nm.ipfs.Upload(req.ImageData)
	if err != nil {
		return nil, err
	}

	// Build metadata
	metadata := map[string]interface{}{
		"name":        req.Name,
		"description": req.Description,
		"image":       fmt.Sprintf("ipfs://%s", imageCID),
		"attributes":  req.Attributes,
	}

	// Upload metadata
	metadataCID, err := nm.ipfs.UploadJSON(metadata)
	if err != nil {
		return nil, err
	}

	// Mint on blockchain
	tokenID, err := nm.blockchain.MintNFT(ctx, creatorID, collection.ContractAddr, fmt.Sprintf("ipfs://%s", metadataCID))
	if err != nil {
		return nil, err
	}

	nft := &NFT{
		ID:            generateNFTID(),
		TokenID:       tokenID,
		TokenURI:      fmt.Sprintf("ipfs://%s", metadataCID),
		CollectionID: req.CollectionID,
		Chain:         collection.Chain,
		OwnerID:       creatorID,
		CreatorID:    creatorID,
		Name:         req.Name,
		Description: req.Description,
		ImageURI:    fmt.Sprintf("ipfs://%s", imageCID),
		Attributes:  req.Attributes,
		MimeType:     req.MimeType,
		IsHidden:    false,
		IsLocked:    false,
		ForSale:    req.ForSale,
		Price:      req.Price,
		MintedAt:   time.Now(),
	}

	nm.mu.Lock()
	nm.nfts[nft.ID] = nft
	collection.Minted++
	nm.mu.Unlock()

	return nft, nil
}

// ListForSale lists NFT for sale
func (nm *NFTMarket) ListForSale(ctx context.Context, userID, nftID string, price decimal.Decimal, expiresAt *time.Time) error {
	if price.LessThan(nm.cfg.MinPrice) {
		return fmt.Errorf("minimum price is %s", nm.cfg.MinPrice.String())
	}

	nm.mu.RLock()
	nft, ok := nm.nfts[nftID]
	nm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("NFT not found")
	}

	if nft.OwnerID != userID {
		return fmt.Errorf("unauthorized")
	}

	// Set approval for marketplace contract
	err := nm.blockchain.SetApproval(ctx, userID, "", nft.CollectionID, true)
	if err != nil {
		return err
	}

	nft.ForSale = true
	nft.Price = &price

	return nil
}

// Delist removes NFT from sale
func (nm *NFTMarket) Delist(ctx context.Context, userID, nftID string) error {
	nm.mu.RLock()
	nft, ok := nm.nfts[nftID]
	nm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("NFT not found")
	}

	if nft.OwnerID != userID {
		return fmt.Errorf("unauthorized")
	}

	nft.ForSale = false

	return nil
}

// Buy purchases an NFT
func (nm *NFTMarket) Buy(ctx context.Context, buyerID, nftID string) (*NFTTransfer, error) {
	nm.mu.RLock()
	nft, ok := nm.nfts[nftID]
	nm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}

	if !nft.ForSale {
		return nil, fmt.Errorf("NFT not for sale")
	}

	if nft.Price == nil {
		return nil, fmt.Errorf("price not set")
	}

	price := *nft.Price

	// Calculate fees
	serviceFee := price.Mul(nm.cfg.ServiceFee).Div(decimal.NewFromFloat(100))
	creatorFee := price.Mul(nft.CreatorFee).Div(decimal.NewFromFloat(100))
	totalFee := serviceFee.Add(creatorFee)

	// In production: would hold payment in escrow

	// Transfer ownership
	err := nm.blockchain.TransferNFT(ctx, nft.OwnerID, buyerID, nft.CollectionID, nft.TokenID)
	if err != nil {
		return nil, err
	}

	transfer := &NFTTransfer{
		ID:       generateTransferID(),
		NFTID:    nftID,
		FromID:   nft.OwnerID,
		ToID:     buyerID,
		Price:   price.String(),
		TxHash:  "",
		Timestamp: time.Now(),
	}

	nm.mu.Lock()
	nft.OwnerID = buyerID
	nft.ForSale = false
	nft.Price = nil
	nm.transfers[transfer.ID] = transfer
	nm.mu.Unlock()

	return transfer, nil
}

// CreateOffer creates an offer for an NFT
func (nm *NFTMarket) CreateOffer(ctx context.Context, userID, nftID string, price decimal.Decimal, expiresAt time.Time) (*NFTOffer, error) {
	nm.mu.RLock()
	nft, ok := nm.nfts[nftID]
	nm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}

	offer := &NFTOffer{
		ID:          generateOfferID(),
		NFTID:       nftID,
		OffererID:   userID,
		Price:      price,
		PaymentToken: "USDT",
		ExpiresAt:  expiresAt,
		Status:     OfferStatusPending,
	}

	nm.mu.Lock()
	nm.offers[offer.ID] = offer
	nm.mu.Unlock()

	return offer, nil
}

// AcceptOffer accepts an offer
func (nm *NFTMarket) AcceptOffer(ctx context.Context, ownerID, nftID, offerID string) error {
	nm.mu.RLock()
	nft, ok := nm.nfts[nftID]
	offer, offerOk := nm.offers[offerID]
	nm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("NFT not found")
	}

	if !offerOk {
		return fmt.Errorf("offer not found")
	}

	if nft.OwnerID != ownerID {
		return fmt.Errorf("unauthorized")
	}

	if offer.Status != OfferStatusPending {
		return fmt.Errorf("offer not pending")
	}

	if offer.ExpiresAt.Before(time.Now()) {
		return fmt.Errorf("offer expired")
	}

	// Accept - would transfer payment and NFT

	offer.Status = OfferStatusAccepted
	nft.OwnerID = offer.OffererID

	return nil
}

// CreateAuction creates an auction
func (nm *NFTMarket) CreateAuction(ctx context.Context, sellerID, nftID string, req *AuctionRequest) (*NFTAuction, error) {
	nm.mu.RLock()
	nft, ok := nm.nfts[nftID]
	nm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("NFT not found")
	}

	if nft.OwnerID != sellerID {
		return nil, fmt.Errorf("unauthorized")
	}

	auction := &NFTAuction{
		ID:           generateAuctionID(),
		NFTID:        nftID,
		SellerID:     sellerID,
		StartPrice:  req.StartPrice,
		ReservePrice: req.ReservePrice,
		BuyNowPrice: req.BuyNowPrice,
		StartTime:  req.StartTime,
		EndTime:   req.EndTime,
		Status:    AuctionStatusActive,
	}

	nm.mu.Lock()
	nm.auctions[auction.ID] = auction
	nm.mu.Unlock()

	return auction, nil
}

// PlaceBid places a bid
func (nm *NFTMarket) PlaceBid(ctx context.Context, bidderID, auctionID string, price decimal.Decimal) error {
	nm.mu.RLock()
	auction, ok := nm.auctions[auctionID]
	nm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("auction not found")
	}

	if auction.Status != AuctionStatusActive {
		return fmt.Errorf("auction not active")
	}

	if auction.EndTime.Before(time.Now()) {
		return fmt.Errorf("auction ended")
	}

	if price.LessThan(auction.HighestBid) && price.LessThan(auction.StartPrice) {
		return fmt.Errorf("bid must be higher than current highest or start price")
	}

	// Update bid
	prevHighestBidder := auction.HighestBidder

	auction.HighestBid = price
	auction.HighestBidder = bidderID

	// Could handle outbid notifications

	return nil
}

// SettleAuction settles an auction
func (nm *NFTMarket) SettleAuction(ctx context.Context, auctionID string) (*NFTTransfer, error) {
	nm.mu.RLock()
	auction, ok := nm.auctions[auctionID]
	nm.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("auction not found")
	}

	if auction.Status == AuctionStatusSettled {
		return nil, fmt.Errorf("auction already settled")
	}

	winner := auction.HighestBidder
	price := auction.HighestBid

	if winner == "" {
		// No winner - NFT returns to seller
		return nil, fmt.Errorf("auction had no bids")
	}

	// Transfer NFT to winner
	err := nm.blockchain.TransferNFT(ctx, auction.SellerID, winner, "", "")
	if err != nil {
		return nil, err
	}

	transfer := &NFTTransfer{
		ID:       generateTransferID(),
		NFTID:    auction.NFTID,
		FromID:   auction.SellerID,
		ToID:     winner,
		Price:   price.String(),
		TxHash:  "",
		Timestamp: time.Now(),
	}

	nm.mu.Lock()
	auction.Status = AuctionStatusSettled
	nm.transfers[transfer.ID] = transfer
	nm.mu.Unlock()

	return transfer, nil
}

// GetCollection returns collection by ID
func (nm *NFTMarket) GetCollection(collectionID string) (*NFTCollection, bool) {
	nm.mu.RLock()
	defer nm.mu.RUnlock()
	c, ok := nm.collections[collectionID]
	return c, ok
}

// GetNFT returns NFT by ID
func (nm *NFTMarket) GetNFT(nftID string) (*NFT, bool) {
	nm.mu.RLock()
	defer nm.mu.RUnlock()
	n, ok := nm.nfts[nftID]
	return n, ok
}

// SearchNFTs searches NFTs
func (nm *NFTMarket) SearchNFTs(filter *NFTFilter) []*NFT {
	nm.mu.RLock()
	defer nm.mu.RUnlock()

	var results []*NFT
	for _, nft := range nm.nfts {
		if filter != nil {
			if filter.CollectionID != "" && nft.CollectionID != filter.CollectionID {
				continue
			}
			if filter.OwnerID != "" && nft.OwnerID != filter.OwnerID {
				continue
			}
			if filter.ForSale && !nft.ForSale {
				continue
			}
		}
		results = append(results, nft)
		if len(results) >= 50 {
			break
		}
	}
	return results
}

// Request types
type CollectionRequest struct {
	Name        string
	Symbol     string
	Description string
	Chain      string
	RoyaltyFee decimal.Decimal
	Category  CollectionCategory
	ImageURL  string
	IsExclusive bool
	MaxSupply int
}

type AuctionRequest struct {
	StartPrice  decimal.Decimal
	ReservePrice decimal.Decimal
	BuyNowPrice decimal.Decimal
	StartTime  time.Time
	EndTime    time.Time
}

type NFTFilter struct {
	CollectionID string
	OwnerID     string
	ForSale    bool
}

// Helper functions
func generateCollectionID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("col-%d", time.Now().UnixNano())))
	return hex.EncodeToString(h[:8])
}

func generateContractAddress() string {
	return fmt.Sprintf("0x%x", sha256.Sum256([]byte(time.Now().String()))[:20])
}

func generateNFTID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("nft-%d", time.Now().UnixNano())))
	return hex.EncodeToString(h[:8])
}

func generateOfferID() string {
	return fmt.Sprintf("OFF%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateAuctionID() string {
	return fmt.Sprintf("AUC%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

func generateTransferID() string {
	return fmt.Sprintf("TRF%d%d", time.Now().UnixNano(), time.Now().Nanosecond())
}

var _ = decimal.Decimal{}