package main

import (
	"fmt"
	"time"
)

// Listing status
type ListingStatus string

const (
	ListingApplication ListingStatus = "application"
	ListingDueDiligence ListingStatus = "due_diligence"
	ListingTechnicalAudit ListingStatus = "technical_audit"
	ListingLegalReview ListingStatus = "legal_review"
	ListingMarketPrep ListingStatus = "market_prep"
	ListingListed ListingStatus = "listed"
	ListingDelisting ListingStatus = "delisting"
	ListingDelisted ListingStatus = "delisted"
)

// Delisting reason
type DelistingReason string

const (
	DelistLowVolume DelistingReason = "low_volume"
	DelistSecurityConcern DelistingReason = "security_concern"
	DelistRegulatory DelistingReason = "regulatory"
	DelistAbandoned DelistingReason = "project_abandoned"
	DelistFraud DelistingReason = "fraud"
)

// Listing application
type ListingApplication struct {
	ID          string       `json:"id"`
	ProjectName string       `json:"projectName"`
	TokenSymbol string     `json:"tokenSymbol"`
	TokenContract string   `json:"tokenContract"`
	Website    string      `json:"website"`
	Whitepaper string     `json:"whitepaper"`
	Status     ListingStatus `json:"status"`
	SubmittedAt int64      `json:"submittedAt"`
}

// Listed asset
type ListedAsset struct {
	ID              string         `json:"id"`
	TokenSymbol    string        `json:"tokenSymbol"`
	Contract     string        `json:"contract"`
	ListingPrice  float64      `json:"listingPrice"`
	MarketCap    float64      `json:"marketCap"`
	Volume24h    float64      `json:"volume24h"`
	Status      ListingStatus `json:"status"`
	ListedAt    int64        `json:"listedAt"`
}

// Governance platform
type AssetGovernance struct {
	Assets      map[string]*ListedAsset
	Applications map[string]*ListingApplication
	DelistingQueue []string
}

// New creates platform
func NewAssetGovernance() *AssetGovernance {
	return &AssetGovernance{
		Assets: make(map[string]*ListedAsset),
		Applications: make(map[string]*ListingApplication),
	}
}

// Submit application
func (g *AssetGovernance) SubmitApplication(projectName, tokenSymbol, contract, website string) *ListingApplication {
	id := fmt.Sprintf("APP-%d", time.Now().UnixNano())
	
	app := &ListingApplication{
		ID: id,
		ProjectName: projectName,
		TokenSymbol: tokenSymbol,
		TokenContract: contract,
		Website: website,
		Status: ListingApplication,
		SubmittedAt: time.Now().UnixMilli(),
	}
	
	g.Applications[id] = app
	return app
}

// Approve application
func (g *AssetGovernance) ApproveApplication(appID string) *ListedAsset {
	app, exists := g.Applications[appID]
	if !exists {
		return nil
	}
	
	app.Status = ListingListed
	
	asset := &ListedAsset{
		ID: app.TokenSymbol,
		TokenSymbol: app.TokenSymbol,
		Contract: app.TokenContract,
		ListingPrice: 0,
		MarketCap: 0,
		Volume24h: 0,
		Status: ListingListed,
		ListedAt: time.Now().UnixMilli(),
	}
	
	g.Assets[asset.ID] = asset
	return asset
}

// Queue for delisting
func (g *AssetGovernance) QueueDelisting(assetID string, reason DelistingReason) bool {
	asset, exists := g.Assets[assetID]
	if !exists {
		return false
	}
	
	asset.Status = ListingDelisting
	g.DelistingQueue = append(g.DelistingQueue, assetID)
	return true
}

// Get listed assets
func (g *AssetGovernance) GetListedAssets() []*ListedAsset {
	var result []*ListedAsset
	for _, a := range g.Assets {
		if a.Status == ListingListed {
			result = append(result, a)
		}
	}
	return result
}

func main() {
	plat := NewAssetGovernance()
	
	// Submit
	app := plat.SubmitApplication("BitcoinX", "BTCX", "0x123", "https://btcx.io")
	fmt.Printf("Application: %s\n", app.ProjectName)
	
	// Approve
	asset := plat.ApproveApplication(app.ID)
	fmt.Printf("Listed: %s\n", asset.TokenSymbol)
	
	// Queue delisting
	plat.QueueDelisting(asset.ID, DelistLowVolume)
	fmt.Printf("Delisting queue: %d\n", len(plat.DelistingQueue))
}