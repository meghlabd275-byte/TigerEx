// Package trading provides trading pair management
package trading

import (
	"fmt"
	"strings"
	"sync"
)

// TradingPairType represents the type of trading pair
type TradingPairType string

const (
	Spot       TradingPairType = "spot"
	Futures    TradingPairType = "futures"
	Option     TradingPairType = "option"
	Leveraged  TradingPairType = "leveraged"
	Margin    TradingPairType = "margin"
	Perpetual TradingPairType = "perpetual"
)

// TradingPairStatus represents trading pair status
type TradingPairStatus string

const (
	Active  TradingPairStatus = "active"
	Halted  TradingPairStatus = "halted"
	Paused  TradingPairStatus = "paused"
	Delisted TradingPairStatus = "delisted"
)

// PricePrecision defines price precision levels
type PricePrecision int

const (
	PricePrecisionZero PricePrecision = iota
	PricePrecisionOne
	PricePrecisionTwo
	PricePrecisionThree
	PricePrecisionFour
	PricePrecisionFive
	PricePrecisionSix
	PricePrecisionSeven
	PricePrecisionEight
)

// TradingPair represents a trading pair on the exchange
type TradingPair struct {
	ID                string          `json:"id"`
	Symbol           string          `json:"symbol"`
	BaseAsset        string          `json:"baseAsset"`
	QuoteAsset       string          `json:"quoteAsset"`
	Network          string          `json:"network,omitempty"`
	PairType         TradingPairType `json:"pairType"`
	Status           TradingPairStatus `json:"status"`
	MinQuantity      float64         `json:"minQuantity"`
	MaxQuantity      float64         `json:"maxQuantity"`
	MinPrice         float64         `json:"minPrice"`
	MaxPrice         float64         `json:"maxPrice"`
	TickSize         float64         `json:"tickSize"`
	LotSize          float64         `json:"lotSize"`
	PricePrecision   PricePrecision `json:"pricePrecision"`
	QuantityPrecision int         `json:"quantityPrecision"`
}

// TradingPairGroup groups trading pairs by category
type TradingPairGroup struct {
	Category string        `json:"category"`
	Pairs   []*TradingPair `json:"pairs"`
}

// TradingPairManager manages all trading pairs
type TradingPairManager struct {
	mu           sync.RWMutex
	pairs        map[string]*TradingPair
	pairsByNetwork map[string][]*TradingPair
	pairsByType   map[TradingPairType][]*TradingPair
}

// Global manager instance
var (
	defaultManager     *TradingPairManager
	defaultManagerOnce sync.Once
)

// NewTradingPairManager creates a new trading pair manager
func NewTradingPairManager() *TradingPairManager {
	m := &TradingPairManager{
		pairs:          make(map[string]*TradingPair),
		pairsByNetwork: make(map[string][]*TradingPair),
		pairsByType:    make(map[TradingPairType][]*TradingPair),
	}
	m.initializeDefaultPairs()
	return m
}

// GetDefaultManager returns the global trading pair manager
func GetDefaultManager() *TradingPairManager {
	defaultManagerOnce.Do(func() {
		defaultManager = NewTradingPairManager()
	})
	return defaultManager
}

func (m *TradingPairManager) initializeDefaultPairs() {
	// Major spot pairs - Top liquid
	defaultPairs := []*TradingPair{
		// Tier 1 - Major pairs
		{Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 1, MaxPrice: 1000000, TickSize: 0.01, LotSize: 0.00001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 8},
		{Symbol: "ETH/USDT", BaseAsset: "ETH", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.0001, MaxQuantity: 100000, MinPrice: 0.01, MaxPrice: 100000, TickSize: 0.01, LotSize: 0.0001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 8},
		{Symbol: "BNB/USDT", BaseAsset: "BNB", QuoteAsset: "USDT", Network: "bsc_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.001, MaxQuantity: 100000, MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.01, LotSize: 0.001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 6},
		{Symbol: "SOL/USDT", BaseAsset: "SOL", QuoteAsset: "USDT", Network: "solana_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 1000000, MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionThree, QuantityPrecision: 4},
		{Symbol: "XRP/USDT", BaseAsset: "XRP", QuoteAsset: "USDT", Network: "xrp_ledger", PairType: Spot, Status: Active, MinQuantity: 1, MaxQuantity: 100000000, MinPrice: 0.0001, MaxPrice: 100, TickSize: 0.0001, LotSize: 1, PricePrecision: PricePrecisionFive, QuantityPrecision: 2},
		{Symbol: "ADA/USDT", BaseAsset: "ADA", QuoteAsset: "USDT", Network: "cardano_mainnet", PairType: Spot, Status: Active, MinQuantity: 1, MaxQuantity: 100000000, MinPrice: 0.0001, MaxPrice: 100, TickSize: 0.0001, LotSize: 1, PricePrecision: PricePrecisionFive, QuantityPrecision: 2},
		{Symbol: "DOGE/USDT", BaseAsset: "DOGE", QuoteAsset: "USDT", Network: "doge_mainnet", PairType: Spot, Status: Active, MinQuantity: 10, MaxQuantity: 1000000000, MinPrice: 0.00001, MaxPrice: 10, TickSize: 0.00001, LotSize: 10, PricePrecision: PricePrecisionSix, QuantityPrecision: 2},
		{Symbol: "DOT/USDT", BaseAsset: "DOT", QuoteAsset: "USDT", Network: "polkadot_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.1, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.1, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "MATIC/USDT", BaseAsset: "MATIC", QuoteAsset: "USDT", Network: "polygon_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.1, MaxQuantity: 10000000, MinPrice: 0.0001, MaxPrice: 100, TickSize: 0.0001, LotSize: 0.1, PricePrecision: PricePrecisionFive, QuantityPrecision: 4},
		{Symbol: "LTC/USDT", BaseAsset: "LTC", QuoteAsset: "USDT", Network: "ltc_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.001, MaxQuantity: 100000, MinPrice: 1, MaxPrice: 10000, TickSize: 0.01, LotSize: 0.001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 6},
		
		// Altcoins Tier 1
		{Symbol: "AVAX/USDT", BaseAsset: "AVAX", QuoteAsset: "USDT", Network: "avax_cchain", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 1000000, MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.01, LotSize: 0.01, PricePrecision: PricePrecisionThree, QuantityPrecision: 4},
		{Symbol: "LINK/USDT", BaseAsset: "LINK", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "ATOM/USDT", BaseAsset: "ATOM", QuoteAsset: "USDT", Network: "cosmos_hub", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "UNI/USDT", BaseAsset: "UNI", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "XLM/USDT", BaseAsset: "XLM", QuoteAsset: "USDT", Network: "xlm_stellar", PairType: Spot, Status: Active, MinQuantity: 0.1, MaxQuantity: 100000000, MinPrice: 0.0001, MaxPrice: 10, TickSize: 0.0001, LotSize: 0.1, PricePrecision: PricePrecisionFive, QuantityPrecision: 2},

		// Stablecoins
		{Symbol: "USDC/USDT", BaseAsset: "USDC", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 100000000, MinPrice: 0.99, MaxPrice: 1.01, TickSize: 0.0001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "DAI/USDT", BaseAsset: "DAI", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.99, MaxPrice: 1.01, TickSize: 0.0001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "FRAX/USDT", BaseAsset: "FRAX", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.99, MaxPrice: 1.01, TickSize: 0.0001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},

		// Fiat pairs
		{Symbol: "BTC/BRL", BaseAsset: "BTC", QuoteAsset: "BRL", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 10000, MaxPrice: 10000000, TickSize: 1, LotSize: 0.00001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 8},
		{Symbol: "ETH/BRL", BaseAsset: "ETH", QuoteAsset: "BRL", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.0001, MaxQuantity: 10000, MinPrice: 100, MaxPrice: 1000000, TickSize: 0.01, LotSize: 0.0001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 8},
		{Symbol: "BTC/GBP", BaseAsset: "BTC", QuoteAsset: "GBP", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 10000, MaxPrice: 1000000, TickSize: 1, LotSize: 0.00001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 8},
		{Symbol: "ETH/EUR", BaseAsset: "ETH", QuoteAsset: "EUR", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.0001, MaxQuantity: 10000, MinPrice: 100, MaxPrice: 100000, TickSize: 0.01, LotSize: 0.0001, PricePrecision: PricePrecisionTwo, QuantityPrecision: 8},
		{Symbol: "BTC/JPY", BaseAsset: "BTC", QuoteAsset: "JPY", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 100000, MaxPrice: 10000000, TickSize: 1, LotSize: 0.00001, PricePrecision: PricePrecisionZero, QuantityPrecision: 8},
		
		// Additional altcoins
		{Symbol: "NEAR/USDT", BaseAsset: "NEAR", QuoteAsset: "USDT", Network: "near_protocol", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "APT/USDT", BaseAsset: "APT", QuoteAsset: "USDT", Network: "aptos_mainnet", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "ARB/USDT", BaseAsset: "ARB", QuoteAsset: "USDT", Network: "arbitrum_one", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "OP/USDT", BaseAsset: "OP", QuoteAsset: "USDT", Network: "optimism", PairType: Spot, Status: Active, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: PricePrecisionFour, QuantityPrecision: 4},
		{Symbol: "SHIB/USDT", BaseAsset: "SHIB", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: Spot, Status: Active, MinQuantity: 1000, MaxQuantity: 10000000000, MinPrice: 0.000001, MaxPrice: 1, TickSize: 0.000001, LotSize: 1000, PricePrecision: PricePrecisionSeven, QuantityPrecision: 0},
	}

	for i, p := range defaultPairs {
		p.ID = fmt.Sprintf("%d", i+1)
		m.AddPair(p)
	}
}

// AddPair adds a trading pair to the manager
func (m *TradingPairManager) AddPair(pair *TradingPair) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.pairs[pair.Symbol] = pair

	// Index by network
	if pair.Network != "" {
		m.pairsByNetwork[pair.Network] = append(m.pairsByNetwork[pair.Network], pair)
	}

	// Index by type
	m.pairsByType[pair.PairType] = append(m.pairsByType[pair.PairType], pair)
}

// GetAllPairs returns all trading pairs
func (m *TradingPairManager) GetAllPairs() []*TradingPair {
	m.mu.RLock()
	defer m.mu.RUnlock()

	pairs := make([]*TradingPair, 0, len(m.pairs))
	for _, p := range m.pairs {
		pairs = append(pairs, p)
	}
	return pairs
}

// GetActivePairs returns all active trading pairs
func (m *TradingPairManager) GetActivePairs() []*TradingPair {
	m.mu.RLock()
	defer m.mu.RUnlock()

	pairs := make([]*TradingPair, 0)
	for _, p := range m.pairs {
		if p.Status == Active {
			pairs = append(pairs, p)
		}
	}
	return pairs
}

// GetPairBySymbol returns a trading pair by symbol
func (m *TradingPairManager) GetPairBySymbol(symbol string) *TradingPair {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.pairs[strings.ToUpper(symbol)]
}

// GetPairsByNetwork returns pairs filtered by network
func (m *TradingPairManager) GetPairsByNetwork(networkID string) []*TradingPair {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.pairsByNetwork[networkID]
}

// GetPairsByType returns pairs filtered by type
func (m *TradingPairManager) GetPairsByType(ptype TradingPairType) []*TradingPair {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.pairsByType[ptype]
}

// GetSpotPairs returns all spot trading pairs
func (m *TradingPairManager) GetSpotPairs() []*TradingPair {
	return m.GetPairsByType(Spot)
}

// GetFuturesPairs returns all futures trading pairs
func (m *TradingPairManager) GetFuturesPairs() []*TradingPair {
	return m.GetPairsByType(Futures)
}

// GetStats returns trading pair statistics
func (m *TradingPairManager) GetStats() map[string]int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return map[string]int{
		"total":    len(m.pairs),
		"active":   len(m.pairsByType[Spot]),
		"spot":     len(m.pairsByType[Spot]),
		"futures":  len(m.pairsByType[Futures]),
	}
}

// ValidSymbols returns a list of valid trading pair symbols
func ValidSymbols() []string {
	m := GetDefaultManager()
	pairs := m.GetActivePairs()
	symbols := make([]string, len(pairs))
	for i, p := range pairs {
		symbols[i] = p.Symbol
	}
	return symbols
}