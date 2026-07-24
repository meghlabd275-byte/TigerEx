// =============================================================================
// TIGEREX WHITE LABEL ADMIN SERVICE - Go Implementation
// Comprehensive white label management with full CRUD operations
// =============================================================================

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// WHITE LABEL TYPES
// =============================================================================

type WhiteLabelClient struct {
	ID                    string              `json:"id"`
	Name                  string              `json:"name"`
	Domain                string              `json:"domain"`
	DomainAliases         []string           `json:"domainAliases"`
	Status                string              `json:"status"` // active, suspended, halted, pending
	CreatedAt             int64               `json:"createdAt"`
	UpdatedAt             int64               `json:"updatedAt"`
	CreatedBy             string              `json:"createdBy"`
	
	// Configuration
	Config                WhiteLabelConfig    `json:"config"`
	
	// Products
	Products              []WLProduct         `json:"products"`
	
	// Branding
	Branding              WhiteLabelBranding  `json:"branding"`
	
	// Features
	Features              map[string]bool     `json:"features"`
	
	// Limits
	TradingLimits         WLTradingLimits    `json:"tradingLimits"`
	WithdrawalLimits      WLWithdrawalLimits `json:"withdrawalLimits"`
	
	// Liquidity
	LiquidityEnabled      bool               `json:"liquidityEnabled"`
	LiquiditySource       string             `json:"liquiditySource"` // tigerex, own, external
	
	// Pairs
	TradingPairs          []string           `json:"tradingPairs"`
	
	// Custom Chains
	CustomChains          []string           `json:"customChains"`
	
	// Fee Structure
	FeeStructure          WLFeeStructure     `json:"feeStructure"`
	
	// Permissions
	Permissions           WLPermissions      `json:"permissions"`
	
	// Statistics
	Stats                 WLStats            `json:"stats"`
}

type WhiteLabelConfig struct {
	KYCRequired          bool                `json:"kycRequired"`
	KYCLevelRequired     int                 `json:"kycLevelRequired"`
	AllowRegistration    bool                `json:"allowRegistration"`
	AllowDeposit         bool                `json:"allowDeposit"`
	AllowWithdrawal      bool                `json:"allowWithdrawal"`
	AllowTrading         bool                `json:"allowTrading"`
	AllowP2P            bool                `json:"allowP2P"`
	AllowStaking        bool                `json:"allowStaking"`
	AllowNFT            bool                `json:"allowNFT"`
	AllowWeb3Wallet     bool                `json:"allowWeb3Wallet"`
	SupportedAssets      []string            `json:"supportedAssets"`
	SupportedChains      []string            `json:"supportedChains"`
}

type WLProduct struct {
	ProductID   string `json:"productId"`
	ProductType string `json:"productType"` // cex, dex, cex_dex, p2p, staking, nft, web3_wallet
	Name        string `json:"name"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type WhiteLabelBranding struct {
	Logo               string `json:"logo"`
	LogoDark          string `json:"logoDark"`
	Favicon           string `json:"favicon"`
	PrimaryColor      string `json:"primaryColor"`
	SecondaryColor    string `json:"secondaryColor"`
	BackgroundColor   string `json:"backgroundColor"`
	TextColor         string `json:"textColor"`
	AccentColor       string `json:"accentColor"`
	AppName           string `json:"appName"`
	Tagline           string `json:"tagline"`
	SupportEmail      string `json:"supportEmail"`
	SupportURL        string `json:"supportUrl"`
	TermsURL          string `json:"termsUrl"`
	PrivacyURL        string `json:"privacyUrl"`
}

type WLTradingLimits struct {
	MaxOrderValue    float64 `json:"maxOrderValue"`
	MaxPositionSize  float64 `json:"maxPositionSize"`
	MaxLeverage      int     `json:"maxLeverage"`
	DailyVolumeLimit float64 `json:"dailyVolumeLimit"`
}

type WLWithdrawalLimits struct {
	DailyLimit    float64 `json:"dailyLimit"`
	MonthlyLimit  float64 `json:"monthlyLimit"`
	MinWithdrawal float64 `json:"minWithdrawal"`
}

type WLFeeStructure struct {
	MakerFee     float64 `json:"makerFee"`
	TakerFee     float64 `json:"takerFee"`
	WithdrawalFee float64 `json:"withdrawalFee"`
	DepositFee   float64 `json:"depositFee"`
}

type WLPermissions struct {
	CanImportPairs        bool `json:"canImportPairs"`
	CanImportLiquidity  bool `json:"canImportLiquidity"`
	CanCreatePairs       bool `json:"canCreatePairs"`
	CanAdjustFees       bool `json:"canAdjustFees"`
	CanManageUsers      bool `json:"canManageUsers"`
	CanManageKYC        bool `json:"canManageKYC"`
	CanViewAnalytics    bool `json:"canViewAnalytics"`
	CanManageProducts   bool `json:"canManageProducts"`
	CanManageBranding   bool `json:"canManageBranding"`
	CanWhitelistIPs    bool `json:"canWhitelistIPs"`
}

type WLStats struct {
	TotalUsers        int64   `json:"totalUsers"`
	ActiveUsers      int64   `json:"activeUsers"`
	TotalVolume     float64 `json:"totalVolume"`
	TotalTrades     int64   `json:"totalTrades"`
	TotalDeposits   float64 `json:"totalDeposits"`
	TotalWithdrawals float64 `json:"totalWithdrawals"`
}

// =============================================================================
// WHITE LABEL ADMIN
// =============================================================================

type WhiteLabelAdmin struct {
	ID              string   `json:"id"`
	WhiteLabelID   string   `json:"whiteLabelId"`
	Username       string   `json:"username"`
	Email          string   `json:"email"`
	Role           string   `json:"role"` // owner, admin, manager, support
	Permissions    []string `json:"permissions"`
	Status         string   `json:"status"` // active, inactive, suspended
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`
	LastLoginAt    int64    `json:"lastLoginAt"`
}

// =============================================================================
// TRADING PAIR MANAGEMENT
// =============================================================================

type TradingPair struct {
	ID                string    `json:"id"`
	Symbol            string    `json:"symbol"` // BTCUSDT
	BaseAsset         string    `json:"baseAsset"`
	QuoteAsset        string    `json:"quoteAsset"`
	Status            string    `json:"status"` // trading, halted, suspended
	WhiteLabelID      string    `json:"whiteLabelId"`
	MinPrice          float64   `json:"minPrice"`
	MaxPrice          float64   `json:"maxPrice"`
	PricePrecision    int       `json:"pricePrecision"`
	MinQuantity       float64   `json:"minQuantity"`
	MaxQuantity       float64   `json:"maxQuantity"`
	QuantityPrecision int       `json:"quantityPrecision"`
	MakerFee          float64   `json:"makerFee"`
	TakerFee          float64   `json:"takerFee"`
	IsSpot            bool      `json:"isSpot"`
	IsMargin          bool      `json:"isMargin"`
	IsFutures        bool      `json:"isFutures"`
	ImportedFrom     string    `json:"importedFrom"` // tigerex, binance, bybit, etc.
	CreatedAt        int64     `json:"createdAt"`
	UpdatedAt        int64     `json:"updatedAt"`
}

// =============================================================================
// MARKET MAKER BOT
// =============================================================================

type MarketMakerBot struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	WhiteLabelID   string    `json:"whiteLabelId"`
	Status          string    `json:"status"` // active, paused, stopped
	TradingPairs    []string  `json:"tradingPairs"`
	Strategy        string    `json:"strategy"` // arbitrage, spread, liquidity
	Config          MMConfig  `json:"config"`
	Stats           MMStats   `json:"stats"`
	CreatedAt       int64     `json:"createdAt"`
	UpdatedAt       int64     `json:"updatedAt"`
}

type MMConfig struct {
	SpreadBPS      float64 `json:"spreadBps"` // basis points
	MinSpread      float64 `json:"minSpread"`
	MaxSpread      float64 `json:"maxSpread"`
	OrderSize      float64 `json:"orderSize"`
	MaxOrderSize   float64 `json:"maxOrderSize"`
	RefreshMs      int     `json:"refreshMs"`
	MaxPositions   int     `json:"maxPositions"`
}

type MMStats struct {
	TotalVolume    float64 `json:"totalVolume"`
	TotalTrades    int64   `json:"totalTrades"`
	ProfitLoss     float64 `json:"profitLoss"`
	ActiveOrders   int     `json:"activeOrders"`
}

// =============================================================================
// TOKEN/COIN MANAGEMENT
// =============================================================================

type VirtualCoin struct {
	ID              string    `json:"id"`
	Symbol          string    `json:"symbol"`
	Name            string    `json:"name"`
	Blockchain      string    `json:"blockchain"`
	ContractAddress string   `json:"contractAddress"`
	Decimals        int       `json:"decimals"`
	Status          string    `json:"status"` // active, inactive, delisted
	WhiteLabelID   string    `json:"whiteLabelId"`
	DepositEnabled  bool      `json:"depositEnabled"`
	WithdrawEnabled bool      `json:"withdrawEnabled"`
	TradingEnabled  bool      `json:"tradingEnabled"`
	MinDeposit      float64   `json:"minDeposit"`
	MinWithdrawal   float64   `json:"minWithdrawal"`
	WithdrawalFee   float64   `json:"withdrawalFee"`
	Network         string    `json:"network"`
	LogoURL         string    `json:"logoUrl"`
	CreatedAt       int64     `json:"createdAt"`
	UpdatedAt       int64     `json:"updatedAt"`
}

// =============================================================================
// INSTITUTIONAL CLIENT
// =============================================================================

type InstitutionalClient struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Email           string    `json:"email"`
	Type            string    `json:"type"` // broker, fund, corporate, family_office
	Status          string    `json:"status"` // active, pending, suspended
	WhiteLabelID   string    `json:"whiteLabelId"`
	TradingLimit    float64   `json:"tradingLimit"`
	FeeDiscount     float64   `json:"feeDiscount"`
	APIEnabled      bool      `json:"apiEnabled"`
	ContactPerson   string    `json:"contactPerson"`
	ContactEmail    string    `json:"contactEmail"`
	CreatedAt       int64     `json:"createdAt"`
	UpdatedAt       int64     `json:"updatedAt"`
}

// =============================================================================
// NFT COLLECTION
// =============================================================================

type NFTCollection struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Symbol          string    `json:"symbol"`
	Description     string    `json:"description"`
	ContractAddress string   `json:"contractAddress"`
	Blockchain      string    `json:"blockchain"`
	WhiteLabelID   string    `json:"whiteLabelId"`
	 royalty        float64   `json:"royalty"`
	CreatorAddress  string    `json:"creatorAddress"`
	Status          string    `json:"status"` // active, inactive
	TotalMinted    int64     `json:"totalMinted"`
	MaxSupply      int64     `json:"maxSupply"`
	LogoURL        string    `json:"logoUrl"`
	FeaturedURL    string    `json:"featuredUrl"`
	CreatedAt       int64     `json:"createdAt"`
	UpdatedAt       int64     `json:"updatedAt"`
}

// =============================================================================
// WHITE LABEL ADMIN SERVICE
// =============================================================================

type WhiteLabelAdminService struct {
	mu sync.RWMutex

	// White label clients
	whiteLabels map[string]*WhiteLabelClient

	// White label admins
	admins map[string]*WhiteLabelAdmin

	// Trading pairs
	pairs map[string]*TradingPair // symbol -> pair

	// Market maker bots
	marketMakerBots map[string]*MarketMakerBot

	// Virtual coins
	virtualCoins map[string]*VirtualCoin

	// Institutional clients
	institutionalClients map[string]*InstitutionalClient

	// NFT collections
	nftCollections map[string]*NFTCollection

	// Statistics
	stats WhiteLabelAdminStats

	// Configuration
	config WhiteLabelAdminConfig

	ctx    context.Context
	cancel context.CancelFunc
}

type WhiteLabelAdminStats struct {
	TotalWhiteLabels   int64 `json:"totalWhiteLabels"`
	ActiveWhiteLabels  int64 `json:"activeWhiteLabels"`
	TotalPairs         int64 `json:"totalPairs"`
	TotalCoins         int64 `json:"totalCoins"`
	TotalMarketMakers  int64 `json:"totalMarketMakers"`
	TotalInstitutional int64 `json:"totalInstitutional"`
}

type WhiteLabelAdminConfig struct {
	AllowMultipleWhiteLabels bool
	MaxWhiteLabelsPerAdmin   int
	DefaultFeeStructure      WLFeeStructure
	ImportSources           []string // binance, bybit, coinbase, kucoin, okx, etc.
}

func NewWhiteLabelAdminService() *WhiteLabelAdminService {
	ctx, cancel := context.WithCancel(context.Background())

	return &WhiteLabelAdminService{
		whiteLabels:       make(map[string]*WhiteLabelClient),
		admins:            make(map[string]*WhiteLabelAdmin),
		pairs:             make(map[string]*TradingPair),
		marketMakerBots:   make(map[string]*MarketMakerBot),
		virtualCoins:      make(map[string]*VirtualCoin),
		institutionalClients: make(map[string]*InstitutionalClient),
		nftCollections:    make(map[string]*NFTCollection),
		config: WhiteLabelAdminConfig{
			AllowMultipleWhiteLabels: true,
			MaxWhiteLabelsPerAdmin:   10,
			DefaultFeeStructure: WLFeeStructure{
				MakerFee: 0.001,
				TakerFee: 0.001,
			},
			ImportSources: []string{"tigerex", "binance", "bybit", "coinbase", "kucoin", "okx", "gate", "huobi", "bitget"},
		},
		ctx:    ctx,
		cancel: cancel,
	}
}

// =============================================================================
// WHITE LABEL CRUD OPERATIONS
// =============================================================================

func (s *WhiteLabelAdminService) CreateWhiteLabel(creatorID string, name, domain string, config WhiteLabelConfig) (*WhiteLabelClient, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check domain uniqueness
	for _, wl := range s.whiteLabels {
		if wl.Domain == domain {
			return nil, errors.New("domain already exists")
		}
		for _, alias := range wl.DomainAliases {
			if alias == domain {
				return nil, errors.New("domain already exists")
			}
		}
	}

	whiteLabel := &WhiteLabelClient{
		ID:            uuid.New().String(),
		Name:          name,
		Domain:        domain,
		DomainAliases: []string{},
		Status:        "pending",
		CreatedAt:     time.Now().UnixMilli(),
		UpdatedAt:     time.Now().UnixMilli(),
		CreatedBy:     creatorID,
		Config:        config,
		Features:      make(map[string]bool),
		TradingLimits: WLTradingLimits{
			MaxOrderValue:    1000000,
			MaxPositionSize:  10000000,
			MaxLeverage:      125,
			DailyVolumeLimit: 100000000,
		},
		WithdrawalLimits: WLWithdrawalLimits{
			DailyLimit:    100000,
			MonthlyLimit:  1000000,
			MinWithdrawal: 10,
		},
		FeeStructure: s.config.DefaultFeeStructure,
		Permissions: WLPermissions{
			CanImportPairs:       true,
			CanImportLiquidity:   true,
			CanCreatePairs:       true,
			CanAdjustFees:        true,
			CanManageUsers:       true,
			CanManageKYC:         true,
			CanViewAnalytics:     true,
			CanManageProducts:    true,
			CanManageBranding:    true,
			CanWhitelistIPs:      true,
		},
		Products: []WLProduct{
			{ProductID: "cex", ProductType: "cex", Name: "Centralized Exchange", Enabled: true},
			{ProductID: "dex", ProductType: "dex", Name: "Decentralized Exchange", Enabled: true},
			{ProductID: "p2p", ProductType: "p2p", Name: "P2P Trading", Enabled: true},
			{ProductID: "staking", ProductType: "staking", Name: "Staking", Enabled: true},
			{ProductID: "nft", ProductType: "nft", Name: "NFT Marketplace", Enabled: true},
			{ProductID: "web3_wallet", ProductType: "web3_wallet", Name: "Web3 Wallet", Enabled: true},
		},
		Branding: WhiteLabelBranding{
			PrimaryColor:   "#1E88E5",
			SecondaryColor: "#424242",
			AppName:        name,
			Tagline:        "Your Trusted Crypto Exchange",
		},
	}

	s.whiteLabels[whiteLabel.ID] = whiteLabel
	atomic.AddInt64(&s.stats.TotalWhiteLabels, 1)
	atomic.AddInt64(&s.stats.ActiveWhiteLabels, 1)

	log.Printf("[INFO] White label created: %s - %s", name, domain)

	return whiteLabel, nil
}

func (s *WhiteLabelAdminService) GetWhiteLabel(id string) (*WhiteLabelClient, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	wl, ok := s.whiteLabels[id]
	if !ok {
		return nil, errors.New("white label not found")
	}

	return wl, nil
}

func (s *WhiteLabelAdminService) GetWhiteLabelByDomain(domain string) (*WhiteLabelClient, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, wl := range s.whiteLabels {
		if wl.Domain == domain {
			return wl, nil
		}
		for _, alias := range wl.DomainAliases {
			if alias == domain {
				return wl, nil
			}
		}
	}

	return nil, errors.New("white label not found")
}

func (s *WhiteLabelAdminService) UpdateWhiteLabel(id string, updates map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wl, ok := s.whiteLabels[id]
	if !ok {
		return errors.New("white label not found")
	}

	// Apply updates
	if name, ok := updates["name"].(string); ok {
		wl.Name = name
	}
	if status, ok := updates["status"].(string); ok {
		wl.Status = status
	}
	if domain, ok := updates["domain"].(string); ok {
		wl.Domain = domain
	}
	if aliases, ok := updates["domainAliases"].([]interface{}); ok {
		for _, a := range aliases {
			if alias, ok := a.(string); ok {
				wl.DomainAliases = append(wl.DomainAliases, alias)
			}
		}
	}

	// Update config
	if config, ok := updates["config"].(map[string]interface{}); ok {
		if kyc, ok := config["kycRequired"].(bool); ok {
			wl.Config.KYCRequired = kyc
		}
		if allowReg, ok := config["allowRegistration"].(bool); ok {
			wl.Config.AllowRegistration = allowReg
		}
	}

	// Update branding
	if branding, ok := updates["branding"].(map[string]interface{}); ok {
		if primary, ok := branding["primaryColor"].(string); ok {
			wl.Branding.PrimaryColor = primary
		}
		if appName, ok := branding["appName"].(string); ok {
			wl.Branding.AppName = appName
		}
	}

	// Update permissions
	if perms, ok := updates["permissions"].(map[string]interface{}); ok {
		if importPairs, ok := perms["canImportPairs"].(bool); ok {
			wl.Permissions.CanImportPairs = importPairs
		}
		if importLiq, ok := perms["canImportLiquidity"].(bool); ok {
			wl.Permissions.CanImportLiquidity = importLiq
		}
	}

	// Update features
	if features, ok := updates["features"].(map[string]interface{}); ok {
		for k, v := range features {
			if enabled, ok := v.(bool); ok {
				wl.Features[k] = enabled
			}
		}
	}

	wl.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] White label updated: %s", id)

	return nil
}

func (s *WhiteLabelAdminService) DeleteWhiteLabel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.whiteLabels[id]; !ok {
		return errors.New("white label not found")
	}

	delete(s.whiteLabels, id)
	atomic.AddInt64(&s.stats.TotalWhiteLabels, -1)

	log.Printf("[INFO] White label deleted: %s", id)

	return nil
}

func (s *WhiteLabelAdminService) ListWhiteLabels() []*WhiteLabelClient {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*WhiteLabelClient, 0, len(s.whiteLabels))
	for _, wl := range s.whiteLabels {
		result = append(result, wl)
	}

	return result
}

func (s *WhiteLabelAdminService) HaltWhiteLabel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wl, ok := s.whiteLabels[id]
	if !ok {
		return errors.New("white label not found")
	}

	wl.Status = "halted"
	wl.UpdatedAt = time.Now().UnixMilli()
	atomic.AddInt64(&s.stats.ActiveWhiteLabels, -1)

	log.Printf("[INFO] White label halted: %s", id)

	return nil
}

func (s *WhiteLabelAdminService) ResumeWhiteLabel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wl, ok := s.whiteLabels[id]
	if !ok {
		return errors.New("white label not found")
	}

	wl.Status = "active"
	wl.UpdatedAt = time.Now().UnixMilli()
	atomic.AddInt64(&s.stats.ActiveWhiteLabels, 1)

	log.Printf("[INFO] White label resumed: %s", id)

	return nil
}

func (s *WhiteLabelAdminService) SuspendWhiteLabel(id, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wl, ok := s.whiteLabels[id]
	if !ok {
		return errors.New("white label not found")
	}

	wl.Status = "suspended"
	wl.UpdatedAt = time.Now().UnixMilli()
	atomic.AddInt64(&s.stats.ActiveWhiteLabels, -1)

	log.Printf("[INFO] White label suspended: %s, reason: %s", id, reason)

	return nil
}

// =============================================================================
// TRADING PAIR MANAGEMENT
// =============================================================================

func (s *WhiteLabelAdminService) CreateTradingPair(whiteLabelID string, pair *TradingPair) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	pair.ID = uuid.New().String()
	pair.WhiteLabelID = whiteLabelID
	pair.Status = "trading"
	pair.CreatedAt = time.Now().UnixMilli()
	pair.UpdatedAt = time.Now().UnixMilli()

	s.pairs[pair.Symbol] = pair
	atomic.AddInt64(&s.stats.TotalPairs, 1)

	log.Printf("[INFO] Trading pair created: %s for white label %s", pair.Symbol, whiteLabelID)

	return nil
}

func (s *WhiteLabelAdminService) ImportTradingPairsFrom(whiteLabelID, source string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if source is valid
	validSources := s.config.ImportSources
	isValid := false
	for _, s := range validSources {
		if s == source {
			isValid = true
			break
		}
	}

	if !isValid {
		return nil, errors.New("invalid import source")
	}

	// Get white label
	wl, ok := s.whiteLabels[whiteLabelID]
	if !ok {
		return nil, errors.New("white label not found")
	}

	if !wl.Permissions.CanImportPairs {
		return nil, errors.New("permission denied: cannot import pairs")
	}

	// Import pairs based on source (simulated)
	importedPairs := []string{}

	pairsToImport := getTradingPairsFromSource(source)

	for _, pair := range pairsToImport {
		newPair := &TradingPair{
			ID:                uuid.New().String(),
			Symbol:            pair.Symbol,
			BaseAsset:         pair.BaseAsset,
			QuoteAsset:        pair.QuoteAsset,
			Status:            "trading",
			WhiteLabelID:      whiteLabelID,
			MinPrice:          pair.MinPrice,
			MaxPrice:          pair.MaxPrice,
			PricePrecision:    pair.PricePrecision,
			MinQuantity:       pair.MinQuantity,
			MaxQuantity:       pair.MaxQuantity,
			QuantityPrecision: pair.QuantityPrecision,
			MakerFee:          wl.FeeStructure.MakerFee,
			TakerFee:          wl.FeeStructure.TakerFee,
			IsSpot:            true,
			ImportedFrom:      source,
			CreatedAt:         time.Now().UnixMilli(),
			UpdatedAt:         time.Now().UnixMilli(),
		}

		s.pairs[newPair.Symbol] = newPair
		importedPairs = append(importedPairs, newPair.Symbol)
	}

	// Update white label trading pairs
	wl.TradingPairs = append(wl.TradingPairs, importedPairs...)

	atomic.AddInt64(&s.stats.TotalPairs, int64(len(importedPairs)))

	log.Printf("[INFO] Imported %d trading pairs from %s to white label %s", len(importedPairs), source, whiteLabelID)

	return importedPairs, nil
}

func getTradingPairsFromSource(source string) []*TradingPair {
	// Common trading pairs
	return []*TradingPair{
		{Symbol: "BTCUSDT", BaseAsset: "BTC", QuoteAsset: "USDT", MinPrice: 1, MaxPrice: 1000000, PricePrecision: 2, MinQuantity: 0.00001, MaxQuantity: 10000, QuantityPrecision: 5},
		{Symbol: "ETHUSDT", BaseAsset: "ETH", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 100000, PricePrecision: 2, MinQuantity: 0.0001, MaxQuantity: 100000, QuantityPrecision: 4},
		{Symbol: "BNBUSDT", BaseAsset: "BNB", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 10000, PricePrecision: 2, MinQuantity: 0.001, MaxQuantity: 100000, QuantityPrecision: 3},
		{Symbol: "SOLUSDT", BaseAsset: "SOL", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 10000, PricePrecision: 3, MinQuantity: 0.01, MaxQuantity: 1000000, QuantityPrecision: 2},
		{Symbol: "XRPUSDT", BaseAsset: "XRP", QuoteAsset: "USDT", MinPrice: 0.0001, MaxPrice: 100, PricePrecision: 5, MinQuantity: 1, MaxQuantity: 100000000, QuantityPrecision: 0},
		{Symbol: "ADAUSDT", BaseAsset: "ADA", QuoteAsset: "USDT", MinPrice: 0.0001, MaxPrice: 10, PricePrecision: 5, MinQuantity: 1, MaxQuantity: 100000000, QuantityPrecision: 0},
		{Symbol: "DOGEUSDT", BaseAsset: "DOGE", QuoteAsset: "USDT", MinPrice: 0.00001, MaxPrice: 10, PricePrecision: 6, MinQuantity: 1, MaxQuantity: 1000000000, QuantityPrecision: 0},
		{Symbol: "AVAXUSDT", BaseAsset: "AVAX", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 1000, PricePrecision: 2, MinQuantity: 0.01, MaxQuantity: 100000, QuantityPrecision: 2},
		{Symbol: "DOTUSDT", BaseAsset: "DOT", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 1000, PricePrecision: 3, MinQuantity: 0.1, MaxQuantity: 1000000, QuantityPrecision: 2},
		{Symbol: "MATICUSDT", BaseAsset: "MATIC", QuoteAsset: "USDT", MinPrice: 0.0001, MaxPrice: 100, PricePrecision: 5, MinQuantity: 0.1, MaxQuantity: 100000000, QuantityPrecision: 1},
		{Symbol: "LINKUSDT", BaseAsset: "LINK", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 1000, PricePrecision: 3, MinQuantity: 0.01, MaxQuantity: 10000000, QuantityPrecision: 2},
		{Symbol: "LTCUSDT", BaseAsset: "LTC", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 10000, PricePrecision: 2, MinQuantity: 0.001, MaxQuantity: 100000, QuantityPrecision: 4},
		{Symbol: "ATOMUSDT", BaseAsset: "ATOM", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 1000, PricePrecision: 3, MinQuantity: 0.01, MaxQuantity: 10000000, QuantityPrecision: 2},
		{Symbol: "NEARUSDT", BaseAsset: "NEAR", QuoteAsset: "USDT", MinPrice: 0.001, MaxPrice: 1000, PricePrecision: 3, MinQuantity: 0.01, MaxQuantity: 10000000, QuantityPrecision: 2},
		{Symbol: "APTUSDT", BaseAsset: "APT", QuoteAsset: "USDT", MinPrice: 0.01, MaxPrice: 1000, PricePrecision: 2, MinQuantity: 0.01, MaxQuantity: 10000000, QuantityPrecision: 2},
	}
}

func (s *WhiteLabelAdminService) ImportLiquidityFrom(whiteLabelID, source string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	wl, ok := s.whiteLabels[whiteLabelID]
	if !ok {
		return errors.New("white label not found")
	}

	if !wl.Permissions.CanImportLiquidity {
		return errors.New("permission denied: cannot import liquidity")
	}

	wl.LiquidityEnabled = true
	wl.LiquiditySource = source
	wl.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Enabled liquidity import from %s for white label %s", source, whiteLabelID)

	return nil
}

func (s *WhiteLabelAdminService) UpdateTradingPair(symbol string, updates map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	pair, ok := s.pairs[symbol]
	if !ok {
		return errors.New("trading pair not found")
	}

	if status, ok := updates["status"].(string); ok {
		pair.Status = status
	}
	if makerFee, ok := updates["makerFee"].(float64); ok {
		pair.MakerFee = makerFee
	}
	if takerFee, ok := updates["takerFee"].(float64); ok {
		pair.TakerFee = takerFee
	}

	pair.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Trading pair updated: %s", symbol)

	return nil
}

func (s *WhiteLabelAdminService) DeleteTradingPair(symbol string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.pairs[symbol]; !ok {
		return errors.New("trading pair not found")
	}

	delete(s.pairs, symbol)
	atomic.AddInt64(&s.stats.TotalPairs, -1)

	log.Printf("[INFO] Trading pair deleted: %s", symbol)

	return nil
}

func (s *WhiteLabelAdminService) GetTradingPairs(whiteLabelID string) []*TradingPair {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*TradingPair
	for _, pair := range s.pairs {
		if pair.WhiteLabelID == whiteLabelID {
			result = append(result, pair)
		}
	}

	return result
}

// =============================================================================
// MARKET MAKER BOT MANAGEMENT
// =============================================================================

func (s *WhiteLabelAdminService) CreateMarketMakerBot(whiteLabelID string, bot *MarketMakerBot) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot.ID = uuid.New().String()
	bot.WhiteLabelID = whiteLabelID
	bot.Status = "paused"
	bot.CreatedAt = time.Now().UnixMilli()
	bot.UpdatedAt = time.Now().UnixMilli()
	bot.Stats = MMStats{}

	s.marketMakerBots[bot.ID] = bot
	atomic.AddInt64(&s.stats.TotalMarketMakers, 1)

	log.Printf("[INFO] Market maker bot created: %s for white label %s", bot.Name, whiteLabelID)

	return nil
}

func (s *WhiteLabelAdminService) StartMarketMakerBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.marketMakerBots[botID]
	if !ok {
		return errors.New("market maker bot not found")
	}

	bot.Status = "active"
	bot.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Market maker bot started: %s", botID)

	return nil
}

func (s *WhiteLabelAdminService) StopMarketMakerBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.marketMakerBots[botID]
	if !ok {
		return errors.New("market maker bot not found")
	}

	bot.Status = "stopped"
	bot.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Market maker bot stopped: %s", botID)

	return nil
}

func (s *WhiteLabelAdminService) PauseMarketMakerBot(botID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bot, ok := s.marketMakerBots[botID]
	if !ok {
		return errors.New("market maker bot not found")
	}

	bot.Status = "paused"
	bot.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Market maker bot paused: %s", botID)

	return nil
}

// =============================================================================
// VIRTUAL COIN/TOKEN MANAGEMENT
// =============================================================================

func (s *WhiteLabelAdminService) CreateVirtualCoin(whiteLabelID string, coin *VirtualCoin) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	coin.ID = uuid.New().String()
	coin.WhiteLabelID = whiteLabelID
	coin.Status = "active"
	coin.DepositEnabled = true
	coin.WithdrawalEnabled = true
	coin.TradingEnabled = true
	coin.CreatedAt = time.Now().UnixMilli()
	coin.UpdatedAt = time.Now().UnixMilli()

	s.virtualCoins[coin.Symbol] = coin
	atomic.AddInt64(&s.stats.TotalCoins, 1)

	log.Printf("[INFO] Virtual coin created: %s for white label %s", coin.Symbol, whiteLabelID)

	return nil
}

func (s *WhiteLabelAdminService) UpdateVirtualCoin(symbol string, updates map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	coin, ok := s.virtualCoins[symbol]
	if !ok {
		return errors.New("virtual coin not found")
	}

	if status, ok := updates["status"].(string); ok {
		coin.Status = status
	}
	if deposit, ok := updates["depositEnabled"].(bool); ok {
		coin.DepositEnabled = deposit
	}
	if withdraw, ok := updates["withdrawEnabled"].(bool); ok {
		coin.WithdrawalEnabled = withdraw
	}
	if trading, ok := updates["tradingEnabled"].(bool); ok {
		coin.TradingEnabled = trading
	}
	if minDep, ok := updates["minDeposit"].(float64); ok {
		coin.MinDeposit = minDep
	}
	if minWd, ok := updates["minWithdrawal"].(float64); ok {
		coin.MinWithdrawal = minWd
	}
	if fee, ok := updates["withdrawalFee"].(float64); ok {
		coin.WithdrawalFee = fee
	}

	coin.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Virtual coin updated: %s", symbol)

	return nil
}

func (s *WhiteLabelAdminService) DeleteVirtualCoin(symbol string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.virtualCoins[symbol]; !ok {
		return errors.New("virtual coin not found")
	}

	delete(s.virtualCoins, symbol)
	atomic.AddInt64(&s.stats.TotalCoins, -1)

	log.Printf("[INFO] Virtual coin deleted: %s", symbol)

	return nil
}

func (s *WhiteLabelAdminService) GetVirtualCoins(whiteLabelID string) []*VirtualCoin {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*VirtualCoin
	for _, coin := range s.virtualCoins {
		if coin.WhiteLabelID == whiteLabelID {
			result = append(result, coin)
		}
	}

	return result
}

// =============================================================================
// INSTITUTIONAL CLIENT MANAGEMENT
// =============================================================================

func (s *WhiteLabelAdminService) CreateInstitutionalClient(whiteLabelID string, client *InstitutionalClient) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	client.ID = uuid.New().String()
	client.WhiteLabelID = whiteLabelID
	client.Status = "pending"
	client.CreatedAt = time.Now().UnixMilli()
	client.UpdatedAt = time.Now().UnixMilli()

	s.institutionalClients[client.ID] = client
	atomic.AddInt64(&s.stats.TotalInstitutional, 1)

	log.Printf("[INFO] Institutional client created: %s for white label %s", client.Name, whiteLabelID)

	return nil
}

func (s *WhiteLabelAdminService) ApproveInstitutionalClient(clientID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	client, ok := s.institutionalClients[clientID]
	if !ok {
		return errors.New("institutional client not found")
	}

	client.Status = "active"
	client.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Institutional client approved: %s", clientID)

	return nil
}

func (s *WhiteLabelAdminService) SuspendInstitutionalClient(clientID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	client, ok := s.institutionalClients[clientID]
	if !ok {
		return errors.New("institutional client not found")
	}

	client.Status = "suspended"
	client.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] Institutional client suspended: %s", clientID)

	return nil
}

// =============================================================================
// NFT MANAGEMENT
// =============================================================================

func (s *WhiteLabelAdminService) CreateNFTCollection(whiteLabelID string, collection *NFTCollection) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	collection.ID = uuid.New().String()
	collection.WhiteLabelID = whiteLabelID
	collection.Status = "active"
	collection.TotalMinted = 0
	collection.CreatedAt = time.Now().UnixMilli()
	collection.UpdatedAt = time.Now().UnixMilli()

	s.nftCollections[collection.ID] = collection

	log.Printf("[INFO] NFT collection created: %s for white label %s", collection.Name, whiteLabelID)

	return nil
}

func (s *WhiteLabelAdminService) UpdateNFTCollection(collectionID string, updates map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	collection, ok := s.nftCollections[collectionID]
	if !ok {
		return errors.New("NFT collection not found")
	}

	if status, ok := updates["status"].(string); ok {
		collection.Status = status
	}
	if royalty, ok := updates["royalty"].(float64); ok {
		collection.royalty = royalty
	}

	collection.UpdatedAt = time.Now().UnixMilli()

	log.Printf("[INFO] NFT collection updated: %s", collectionID)

	return nil
}

// =============================================================================
// ANALYTICS
// =============================================================================

func (s *WhiteLabelAdminService) GetAnalytics(whiteLabelID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	wl, ok := s.whiteLabels[whiteLabelID]
	if !ok {
		return nil
	}

	var pairCount, coinCount, botCount int

	for _, p := range s.pairs {
		if p.WhiteLabelID == whiteLabelID {
			pairCount++
		}
	}

	for _, c := range s.virtualCoins {
		if c.WhiteLabelID == whiteLabelID {
			coinCount++
		}
	}

	for _, b := range s.marketMakerBots {
		if b.WhiteLabelID == whiteLabelID {
			botCount++
		}
	}

	return map[string]interface{}{
		"whiteLabel":         wl.Name,
		"status":            wl.Status,
		"tradingPairs":      pairCount,
		"virtualCoins":      coinCount,
		"marketMakerBots":   botCount,
		"totalUsers":        wl.Stats.TotalUsers,
		"activeUsers":       wl.Stats.ActiveUsers,
		"totalVolume":       wl.Stats.TotalVolume,
		"totalTrades":       wl.Stats.TotalTrades,
		"totalDeposits":     wl.Stats.TotalDeposits,
		"totalWithdrawals":  wl.Stats.TotalWithdrawals,
	}
}

var _ = fmt.Errorf
var _ = json.Marshal
var _ = strings.TrimSpace
var _ = sha256.Sum256
