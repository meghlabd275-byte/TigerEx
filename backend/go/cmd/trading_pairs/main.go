// Package trading_pairs provides trading pair management service.
// Migrated from TypeScript TigerEx/trading_pairs to Go.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
)

// TradingPairType defines the type of trading pair
type TradingPairType string

const (
	SPOT      TradingPairType = "spot"
	FUTURES   TradingPairType = "futures"
	OPTION   TradingPairType = "option"
	LEVERAGED TradingPairType = "leveraged"
	MARGIN    TradingPairType = "margin"
	PERPETUAL TradingPairType = "perpetual"
)

// TradingPairStatus defines the status of trading pair
type TradingPairStatus string

const (
	ACTIVE   TradingPairStatus = "active"
	HALTED   TradingPairStatus = "halted"
	PAUSED   TradingPairStatus = "paused"
	DELISTED TradingPairStatus = "delisted"
)

// TradingPair represents a trading pair in the exchange
type TradingPair struct {
	ID                 string          `json:"id"`
	Symbol             string          `json:"symbol"`
	BaseAsset          string          `json:"baseAsset"`
	QuoteAsset         string          `json:"quoteAsset"`
	Network            string          `json:"network,omitempty"`
	PairType           TradingPairType `json:"pairType"`
	Status            TradingPairStatus `json:"status"`
	MinQuantity        float64         `json:"minQuantity"`
	MaxQuantity        float64         `json:"maxQuantity"`
	MinPrice           float64         `json:"minPrice"`
	MaxPrice           float64         `json:"maxPrice"`
	TickSize           float64         `json:"tickSize"`
	LotSize            float64         `json:"lotSize"`
	PricePrecision    int             `json:"pricePrecision"`
	QuantityPrecision int            `json:"quantityPrecision"`
	IsVirtual          bool            `json:"isVirtual,omitempty"`
	Underlying         string          `json:"underlying,omitempty"`
	ExpiryDate         string          `json:"expiryDate,omitempty"`
	StrikePrice       float64         `json:"strikePrice,omitempty"`
	OptionType        string          `json:"optionType,omitempty"`
	LeverageMin       float64         `json:"leverageMin,omitempty"`
	LeverageMax       float64         `json:"leverageMax,omitempty"`
}

// TradingPairManager manages all trading pairs
type TradingPairManager struct {
	mu               sync.RWMutex
	pairs            map[string]*TradingPair
	pairsByNetwork    map[string][]*TradingPair
	pairsByType      map[TradingPairType][]*TradingPair
}

var (
	manager = &TradingPairManager{
		pairs:         make(map[string]*TradingPair),
		pairsByNetwork: make(map[string][]*TradingPair),
		pairsByType:   make(map[TradingPairType][]*TradingPair),
	}
)

// Initialize default pairs
func init() {
	defaultPairs := []*TradingPair{
		// Major pairs
		{ID: "BTCUSDT", Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 1, MaxPrice: 1000000, TickSize: 0.01, LotSize: 0.00001, PricePrecision: 2, QuantityPrecision: 8},
		{ID: "ETHUSDT", Symbol: "ETH/USDT", BaseAsset: "ETH", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.0001, MaxQuantity: 100000, MinPrice: 0.01, MaxPrice: 100000, TickSize: 0.01, LotSize: 0.0001, PricePrecision: 2, QuantityPrecision: 8},
		{ID: "BNBUSDT", Symbol: "BNB/USDT", BaseAsset: "BNB", QuoteAsset: "USDT", Network: "bsc_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.001, MaxQuantity: 100000, MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.01, LotSize: 0.001, PricePrecision: 2, QuantityPrecision: 6},
		{ID: "SOLUSDT", Symbol: "SOL/USDT", BaseAsset: "SOL", QuoteAsset: "USDT", Network: "solana_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 1000000, MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.001, LotSize: 0.01, PricePrecision: 3, QuantityPrecision: 4},
		{ID: "XRPUSDT", Symbol: "XRP/USDT", BaseAsset: "XRP", QuoteAsset: "USDT", Network: "xrp_ledger", PairType: SPOT, Status: ACTIVE, MinQuantity: 1, MaxQuantity: 100000000, MinPrice: 0.0001, MaxPrice: 100, TickSize: 0.0001, LotSize: 1, PricePrecision: 5, QuantityPrecision: 2},
		{ID: "ADAUSDT", Symbol: "ADA/USDT", BaseAsset: "ADA", QuoteAsset: "USDT", Network: "cardano_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 1, MaxQuantity: 100000000, MinPrice: 0.0001, MaxPrice: 100, TickSize: 0.0001, LotSize: 1, PricePrecision: 5, QuantityPrecision: 2},
		{ID: "DOGEUSDT", Symbol: "DOGE/USDT", BaseAsset: "DOGE", QuoteAsset: "USDT", Network: "doge_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 10, MaxQuantity: 1000000000, MinPrice: 0.00001, MaxPrice: 10, TickSize: 0.00001, LotSize: 10, PricePrecision: 6, QuantityPrecision: 2},
		{ID: "DOTUSDT", Symbol: "DOT/USDT", BaseAsset: "DOT", QuoteAsset: "USDT", Network: "polkadot_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.1, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.1, PricePrecision: 4, QuantityPrecision: 4},
		{ID: "MATICUSDT", Symbol: "MATIC/USDT", BaseAsset: "MATIC", QuoteAsset: "USDT", Network: "polygon_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.1, MaxQuantity: 10000000, MinPrice: 0.0001, MaxPrice: 100, TickSize: 0.0001, LotSize: 0.1, PricePrecision: 5, QuantityPrecision: 4},
		{ID: "LTCUSDT", Symbol: "LTC/USDT", BaseAsset: "LTC", QuoteAsset: "USDT", Network: "ltc_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.001, MaxQuantity: 100000, MinPrice: 1, MaxPrice: 10000, TickSize: 0.01, LotSize: 0.001, PricePrecision: 2, QuantityPrecision: 6},
		{ID: "AVAXUSDT", Symbol: "AVAX/USDT", BaseAsset: "AVAX", QuoteAsset: "USDT", Network: "avax_cchain", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 1000000, MinPrice: 0.01, MaxPrice: 10000, TickSize: 0.01, LotSize: 0.01, PricePrecision: 3, QuantityPrecision: 4},
		{ID: "LINKUSDT", Symbol: "LINK/USDT", BaseAsset: "LINK", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: 4, QuantityPrecision: 4},
		{ID: "ATOMUSDT", Symbol: "ATOM/USDT", BaseAsset: "ATOM", QuoteAsset: "USDT", Network: "cosmos_hub", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: 4, QuantityPrecision: 4},
		{ID: "UNIUSDT", Symbol: "UNI/USDT", BaseAsset: "UNI", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.001, MaxPrice: 1000, TickSize: 0.001, LotSize: 0.01, PricePrecision: 4, QuantityPrecision: 4},
		{ID: "XLMUSDT", Symbol: "XLM/USDT", BaseAsset: "XLM", QuoteAsset: "USDT", Network: "xlm_stellar", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.1, MaxQuantity: 100000000, MinPrice: 0.0001, MaxPrice: 10, TickSize: 0.0001, LotSize: 0.1, PricePrecision: 5, QuantityPrecision: 2},
		// Stablecoins
		{ID: "USDCC", Symbol: "USDC/USDT", BaseAsset: "USDC", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 100000000, MinPrice: 0.99, MaxPrice: 1.01, TickSize: 0.0001, LotSize: 0.01, PricePrecision: 4, QuantityPrecision: 4},
		{ID: "DAIC", Symbol: "DAI/USDT", BaseAsset: "DAI", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.99, MaxPrice: 1.01, TickSize: 0.0001, LotSize: 0.01, PricePrecision: 4, QuantityPrecision: 4},
		{ID: "FRAX", Symbol: "FRAX/USDT", BaseAsset: "FRAX", QuoteAsset: "USDT", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 10000000, MinPrice: 0.99, MaxPrice: 1.01, TickSize: 0.0001, LotSize: 0.01, PricePrecision: 4, QuantityPrecision: 4},
		// Fiat pairs
		{ID: "BTCBRL", Symbol: "BTC/BRL", BaseAsset: "BTC", QuoteAsset: "BRL", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 10000, MaxPrice: 10000000, TickSize: 1, LotSize: 0.00001, PricePrecision: 2, QuantityPrecision: 8},
		{ID: "ETHBRL", Symbol: "ETH/BRL", BaseAsset: "ETH", QuoteAsset: "BRL", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.0001, MaxQuantity: 10000, MinPrice: 100, MaxPrice: 1000000, TickSize: 0.01, LotSize: 0.0001, PricePrecision: 2, QuantityPrecision: 8},
		{ID: "BTCGBP", Symbol: "BTC/GBP", BaseAsset: "BTC", QuoteAsset: "GBP", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 10000, MaxPrice: 1000000, TickSize: 1, LotSize: 0.00001, PricePrecision: 2, QuantityPrecision: 8},
		{ID: "ETHEUR", Symbol: "ETH/EUR", BaseAsset: "ETH", QuoteAsset: "EUR", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.0001, MaxQuantity: 10000, MinPrice: 100, MaxPrice: 100000, TickSize: 0.01, LotSize: 0.0001, PricePrecision: 2, QuantityPrecision: 8},
		{ID: "BTCJPY", Symbol: "BTC/JPY", BaseAsset: "BTC", QuoteAsset: "JPY", Network: "eth_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.00001, MaxQuantity: 1000, MinPrice: 100000, MaxPrice: 10000000, TickSize: 1, LotSize: 0.00001, PricePrecision: 0, QuantityPrecision: 8},
		{ID: "SOLJPY", Symbol: "SOL/JPY", BaseAsset: "SOL", QuoteAsset: "JPY", Network: "solana_mainnet", PairType: SPOT, Status: ACTIVE, MinQuantity: 0.01, MaxQuantity: 100000, MinPrice: 100, MaxPrice: 100000, TickSize: 1, LotSize: 0.01, PricePrecision: 0, QuantityPrecision: 4},
	}

	for _, p := range defaultPairs {
		manager.pairs[p.ID] = p
		if p.Network != "" {
			manager.pairsByNetwork[p.Network] = append(manager.pairsByNetwork[p.Network], p)
		}
		manager.pairsByType[p.PairType] = append(manager.pairsByType[p.PairType], p)
	}
}

// GetAllPairs returns all trading pairs
func GetAllPairs() []*TradingPair {
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	result := make([]*TradingPair, 0, len(manager.pairs))
	for _, p := range manager.pairs {
		result = append(result, p)
	}
	return result
}

// GetActivePairs returns active trading pairs
func GetActivePairs() []*TradingPair {
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	var result []*TradingPair
	for _, p := range manager.pairs {
		if p.Status == ACTIVE {
			result = append(result, p)
		}
	}
	return result
}

// GetPairByID returns a pair by its ID
func GetPairByID(id string) (*TradingPair, bool) {
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	p, ok := manager.pairs[id]
	return p, ok
}

// GetPairsByNetwork returns pairs by network
func GetPairsByNetwork(network string) []*TradingPair {
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	return manager.pairsByNetwork[network]
}

// GetPairsByType returns pairs by type
func GetPairsByType(pairType TradingPairType) []*TradingPair {
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	return manager.pairsByType[pairType]
}

// GetSpotPairs returns spot pairs
func GetSpotPairs() []*TradingPair {
	return GetPairsByType(SPOT)
}

// GetFuturesPairs returns futures pairs
func GetFuturesPairs() []*TradingPair {
	return GetPairsByType(FUTURES)
}

// AddPair adds a new trading pair
func AddPair(pair *TradingPair) {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	manager.pairs[pair.ID] = pair
	if pair.Network != "" {
		manager.pairsByNetwork[pair.Network] = append(manager.pairsByNetwork[pair.Network], pair)
	}
	manager.pairsByType[pair.PairType] = append(manager.pairsByType[pair.PairType], pair)
}

// GetStats returns statistics about trading pairs
func GetStats() map[string]int {
	active := GetActivePairs()
	spot := GetSpotPairs()
	futures := GetFuturesPairs()

	return map[string]int{
		"total":   len(manager.pairs),
		"active":  len(active),
		"spot":    len(spot),
		"futures": len(futures),
	}
}

func main() {
	fmt.Println("Trading pairs service initialized")

	pairs := GetAllPairs()
	fmt.Printf("Loaded %d trading pairs\n", len(pairs))

	stats := GetStats()
	jsonStats, _ := json.Marshal(stats)
	fmt.Printf("Stats: %s\n", string(jsonStats))
}