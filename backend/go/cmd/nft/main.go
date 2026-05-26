package main

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX NFT SERVICE - GO
// NFT marketplace, collections, and minting
// ============================================================================

type NFTCollection struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Description string  `json:"description"`
	Symbol    string  `json:"symbol"`
	Owner     string  `json:"owner"`
	FloorPrice float64 `json:"floor_price"`
	TotalMinted int    `json:"total_minted"`
	Royalty   float64 `json:"royalty"` // 0.0 to 1.0
	CreatedAt int64   `json:"created_at"`
}

type NFTAsset struct {
	ID          string  `json:"id"`
	CollectionID string `json:"collection_id"`
	TokenID   string `json:"token_id"`
	Owner     string `json:"owner"`
	Metadata  string `json:"metadata"` // URI
	Royalty   float64 `json:"royalty"`
	ForSale  bool    `json:"for_sale"`
	Price    float64 `json:"price,omitempty"`
	ListedAt int64   `json:"listed_at"`
}

type NFTOffer struct {
	ID        string  `json:"id"`
	AssetID  string  `json:"asset_id"`
	Bidder   string  `json:"bidder"`
	Price   float64 `json:"price"`
	Status  string  `json:"status"` // pending, accepted, rejected
	ExpiresAt int64  `json:"expires_at"`
}

type NFTService struct {
	collections map[string]*NFTCollection
	assets     map[string]*NFTAsset
	offers     map[string]*NFTOffer
}

func NewNFTService() *NFTService {
	return &NFTService{
		collections: make(map[string]*NFTCollection),
		assets: make(map[string]*NFTAsset),
		offers: make(map[string]*NFTOffer),
	}
}

func (s *NFTService) CreateCollection(name, desc, symbol, owner string, royalty float64) *NFTCollection {
	col := &NFTCollection{
		ID: fmt.Sprintf("col_%d", time.Now().UnixNano()),
		Name: name, Description: desc, Symbol: symbol,
		Owner: owner, Royalty: royalty,
		CreatedAt: time.Now().Unix(),
	}
	s.collections[col.ID] = col
	return col
}

func (s *NFTService) Mint(collectionID, owner, metadata string) *NFTAsset {
	col, ok := s.collections[collectionID]
	if !ok {
		return nil
	}

	asset := &NFTAsset{
		ID: fmt.Sprintf("nft_%d", time.Now().UnixNano()),
		CollectionID: collectionID,
		TokenID: fmt.Sprintf("%d", col.TotalMinted),
		Owner: owner, Metadata: metadata,
		Royalty: col.Royalty,
	}
	s.assets[asset.ID] = asset

	col.TotalMinted++
	col.FloorPrice = 0 // Initially free

	return asset
}

func (s *NFTService) ListForSale(assetID string, price float64) error {
	if asset, ok := s.assets[assetID]; ok {
		asset.ForSale = true
		asset.Price = price
		asset.ListedAt = time.Now().Unix()
		return nil
	}
	return fmt.Errorf("asset not found")
}

func (s *NFTService) CreateOffer(assetID, bidder string, price float64) *NFTOffer {
	offer := &NFTOffer{
		ID: fmt.Sprintf("offer_%d", time.Now().UnixNano()),
		AssetID: assetID, Bidder: bidder,
		Price: price, Status: "pending",
		ExpiresAt: time.Now().Add(24*time.Hour).Unix(),
	}
	s.offers[offer.ID] = offer
	return offer
}

func (s *NFTService) AcceptOffer(offerID string) error {
	offer, ok := s.offers[offerID]
	if !ok {
		return fmt.Errorf("offer not found")
	}

	asset, ok := s.assets[offer.AssetID]
	if !ok {
		return fmt.Errorf("asset not found")
	}

	// Transfer ownership
	oldOwner := asset.Owner
	asset.Owner = offer.Bidder
	asset.ForSale = false
	asset.Price = 0

	offer.Status = "accepted"

	return nil
}

func SetupNFTRoutes(r *gin.Engine, svc *NFTService) {
	api := r.Group("/api/v1/nft")

	api.POST("/collections", func(c *gin.Context) {
		var req struct {
			Name       string  `json:"name"`
			Description string `json:"description"`
			Symbol    string  `json:"symbol"`
			Owner    string  `json:"owner"`
			Royalty  float64 `json:"royalty"`
		}
		c.ShouldBindJSON(&req)

		col := svc.CreateCollection(req.Name, req.Description, req.Symbol, req.Owner, req.Royalty)
		c.JSON(201, col)
	})

	api.GET("/collections", func(c *gin.Context) {
		var cols []*NFTCollection
		for _, col := range svc.collections {
			cols = append(cols, col)
		}
		c.JSON(200, cols)
	})

	api.POST("/mint", func(c *gin.Context) {
		var req struct {
			CollectionID string `json:"collection_id"`
			Owner      string `json:"owner"`
			Metadata   string `json:"metadata"`
		}
		c.ShouldBindJSON(&req)

		nft := svc.Mint(req.CollectionID, req.Owner, req.Metadata)
		if nft == nil {
			c.JSON(400, gin.H{"error": "collection not found"})
			return
		}
		c.JSON(201, nft)
	})

	api.POST("/list", func(c *gin.Context) {
		var req struct {
			AssetID string  `json:"asset_id"`
			Price  float64 `json:"price"`
		}
		c.ShouldBindJSON(&req)

		err := svc.ListForSale(req.AssetID, req.Price)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
		} else {
			c.JSON(200, gin.H{"success": true})
		}
	})

	api.POST("/offers", func(c *gin.Context) {
		var req struct {
			AssetID string  `json:"asset_id"`
			Bidder string  `json:"bidder"`
			Price  float64 `json:"price"`
		}
		c.ShouldBindJSON(&req)

		offer := svc.CreateOffer(req.AssetID, req.Bidder, req.Price)
		c.JSON(201, offer)
	})
}

func main() {
	r := gin.Default()
	svc := NewNFTService()
	SetupNFTRoutes(r, svc)
	log.Fatal(r.Run(":8080"))
}