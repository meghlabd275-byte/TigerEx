// TigerEx Price Feed Service
// Independent price generation system for TigerEx exchange
// Uses market-making algorithm for price discovery without external dependencies

package pricefeed

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"
)

// PriceTick represents a single price update
type PriceTick struct {
	Symbol       string    `json:"symbol"`
	Price       float64   `json:"price"`
	Change24h    float64   `json:"change_24h"`
	ChangePct24h float64   `json:"change_pct_24h"`
	High24h      float64   `json:"high_24h"`
	Low24h       float64   `json:"low_24h"`
	Volume24h    float64   `json:"volume_24h"`
	QuoteVolume  float64   `json:"quote_volume"`
	Timestamp    time.Time `json:"timestamp"`
}

// OrderBookLevel represents a level in the order book
type OrderBookLevel struct {
	Price  float64 `json:"price"`
	Amount float64 `json:"amount"`
}

// OrderBook represents the full order book for a trading pair
type OrderBook struct {
	Symbol      string           `json:"symbol"`
	Bids        []OrderBookLevel `json:"bids"`
	Asks        []OrderBookLevel `json:"asks"`
	LastUpdateID int64           `json:"last_update_id"`
	Timestamp   time.Time        `json:"timestamp"`
}

// TradingPairConfig defines configuration for each trading pair
type TradingPairConfig struct {
	Symbol           string  `json:"symbol"`
	BaseAsset        string  `json:"base_asset"`
	QuoteAsset       string  `json:"quote_asset"`
	BasePrice        float64 `json:"base_price"`
	MinPrice         float64 `json:"min_price"`
	MaxPrice         float64 `json:"max_price"`
	PricePrecision   int     `json:"price_precision"`
	QuantityPrecision int     `json:"quantity_precision"`
	MinQuantity      float64 `json:"min_quantity"`
	MaxQuantity      float64 `json:"max_quantity"`
	Volatility       float64 `json:"volatility"`
	LiquidityFactor  float64 `json:"liquidity_factor"`
}

// PriceFeedService manages price feeds for all trading pairs
type PriceFeedService struct {
	mu              sync.RWMutex
	pairs           map[string]*TradingPairConfig
	currentPrices   map[string]*PriceTick
	orderBooks      map[string]*OrderBook
	priceHistory    map[string][]PriceTick
	marketMakers    map[string]*MarketMaker
	stopCh          chan bool
	updateInterval  time.Duration
}

// MarketMaker simulates market making for price discovery
type MarketMaker struct {
	Symbol         string
	BasePrice      float64
	Spread         float64
	OrderSize      float64
	MaxOrders      int
	Liquidity      float64
	Volatility     float64
	LastMidPrice   float64
}

// NewPriceFeedService creates a new price feed service
func NewPriceFeedService() *PriceFeedService {
	pfs := &PriceFeedService{
		pairs:          make(map[string]*TradingPairConfig),
		currentPrices:  make(map[string]*PriceTick),
		orderBooks:     make(map[string]*OrderBook),
		priceHistory:   make(map[string][]PriceTick),
		marketMakers:   make(map[string]*MarketMaker),
		stopCh:         make(chan bool),
		updateInterval: 100 * time.Millisecond,
	}
	pfs.initializePairs()
	return pfs
}

// Initialize default trading pairs
func (pfs *PriceFeedService) initializePairs() {
	pairs := []*TradingPairConfig{
		{
			Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT",
			BasePrice: 67500.00, MinPrice: 50000.00, MaxPrice: 100000.00,
			PricePrecision: 2, QuantityPrecision: 6, MinQuantity: 0.00001, MaxQuantity: 1000,
			Volatility: 0.02, LiquidityFactor: 1.0,
		},
		{
			Symbol: "ETH/USDT", BaseAsset: "ETH", QuoteAsset: "USDT",
			BasePrice: 3450.00, MinPrice: 2000.00, MaxPrice: 5000.00,
			PricePrecision: 2, QuantityPrecision: 5, MinQuantity: 0.001, MaxQuantity: 10000,
			Volatility: 0.025, LiquidityFactor: 1.0,
		},
		{
			Symbol: "BNB/USDT", BaseAsset: "BNB", QuoteAsset: "USDT",
			BasePrice: 580.00, MinPrice: 300.00, MaxPrice: 1000.00,
			PricePrecision: 2, QuantityPrecision: 4, MinQuantity: 0.01, MaxQuantity: 10000,
			Volatility: 0.03, LiquidityFactor: 0.8,
		},
		{
			Symbol: "SOL/USDT", BaseAsset: "SOL", QuoteAsset: "USDT",
			BasePrice: 145.00, MinPrice: 50.00, MaxPrice: 300.00,
			PricePrecision: 2, QuantityPrecision: 3, MinQuantity: 0.1, MaxQuantity: 100000,
			Volatility: 0.04, LiquidityFactor: 0.7,
		},
		{
			Symbol: "XRP/USDT", BaseAsset: "XRP", QuoteAsset: "USDT",
			BasePrice: 0.52, MinPrice: 0.30, MaxPrice: 1.50,
			PricePrecision: 4, QuantityPrecision: 1, MinQuantity: 1.0, MaxQuantity: 10000000,
			Volatility: 0.035, LiquidityFactor: 0.9,
		},
		{
			Symbol: "ADA/USDT", BaseAsset: "ADA", QuoteAsset: "USDT",
			BasePrice: 0.45, MinPrice: 0.20, MaxPrice: 1.00,
			PricePrecision: 4, QuantityPrecision: 1, MinQuantity: 1.0, MaxQuantity: 10000000,
			Volatility: 0.035, LiquidityFactor: 0.85,
		},
		{
			Symbol: "DOGE/USDT", BaseAsset: "DOGE", QuoteAsset: "USDT",
			BasePrice: 0.12, MinPrice: 0.05, MaxPrice: 0.30,
			PricePrecision: 5, QuantityPrecision: 0, MinQuantity: 10.0, MaxQuantity: 100000000,
			Volatility: 0.05, LiquidityFactor: 0.75,
		},
		{
			Symbol: "DOT/USDT", BaseAsset: "DOT", QuoteAsset: "USDT",
			BasePrice: 7.20, MinPrice: 4.00, MaxPrice: 15.00,
			PricePrecision: 3, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 100000,
			Volatility: 0.035, LiquidityFactor: 0.8,
		},
		{
			Symbol: "MATIC/USDT", BaseAsset: "MATIC", QuoteAsset: "USDT",
			BasePrice: 0.58, MinPrice: 0.30, MaxPrice: 1.50,
			PricePrecision: 4, QuantityPrecision: 1, MinQuantity: 1.0, MaxQuantity: 10000000,
			Volatility: 0.04, LiquidityFactor: 0.8,
		},
		{
			Symbol: "LTC/USDT", BaseAsset: "LTC", QuoteAsset: "USDT",
			BasePrice: 85.00, MinPrice: 50.00, MaxPrice: 150.00,
			PricePrecision: 2, QuantityPrecision: 4, MinQuantity: 0.01, MaxQuantity: 100000,
			Volatility: 0.03, LiquidityFactor: 0.85,
		},
		{
			Symbol: "AVAX/USDT", BaseAsset: "AVAX", QuoteAsset: "USDT",
			BasePrice: 35.00, MinPrice: 15.00, MaxPrice: 80.00,
			PricePrecision: 2, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 100000,
			Volatility: 0.04, LiquidityFactor: 0.75,
		},
		{
			Symbol: "LINK/USDT", BaseAsset: "LINK", QuoteAsset: "USDT",
			BasePrice: 14.50, MinPrice: 8.00, MaxPrice: 30.00,
			PricePrecision: 3, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 100000,
			Volatility: 0.035, LiquidityFactor: 0.8,
		},
		{
			Symbol: "ATOM/USDT", BaseAsset: "ATOM", QuoteAsset: "USDT",
			BasePrice: 9.20, MinPrice: 5.00, MaxPrice: 20.00,
			PricePrecision: 3, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 100000,
			Volatility: 0.035, LiquidityFactor: 0.8,
		},
		{
			Symbol: "UNI/USDT", BaseAsset: "UNI", QuoteAsset: "USDT",
			BasePrice: 9.80, MinPrice: 5.00, MaxPrice: 20.00,
			PricePrecision: 3, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 100000,
			Volatility: 0.04, LiquidityFactor: 0.75,
		},
		{
			Symbol: "TGR/USDT", BaseAsset: "TGR", QuoteAsset: "USDT",
			BasePrice: 1.25, MinPrice: 0.50, MaxPrice: 5.00,
			PricePrecision: 4, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 10000000,
			Volatility: 0.08, LiquidityFactor: 0.5,
		},
		{
			Symbol: "RUSD/USDT", BaseAsset: "RUSD", QuoteAsset: "USDT",
			BasePrice: 1.00, MinPrice: 0.90, MaxPrice: 1.10,
			PricePrecision: 4, QuantityPrecision: 2, MinQuantity: 0.1, MaxQuantity: 10000000,
			Volatility: 0.005, LiquidityFactor: 0.95,
		},
	}

	for _, pair := range pairs {
		pfs.pairs[pair.Symbol] = pair
		pfs.marketMakers[pair.Symbol] = &MarketMaker{
			Symbol:      pair.Symbol,
			BasePrice:   pair.BasePrice,
			Spread:      0.001 + (pair.Volatility * 0.5),
			OrderSize:   pair.MaxQuantity * 0.001,
			MaxOrders:   20,
			Liquidity:   pair.LiquidityFactor * 1000000,
			Volatility:  pair.Volatility,
			LastMidPrice: pair.BasePrice,
		}
	}
}

// Start begins the price feed updates
func (pfs *PriceFeedService) Start() {
	go pfs.priceUpdateLoop()
	go pfs.orderBookUpdateLoop()
}

// Stop halts the price feed
func (pfs *PriceFeedService) Stop() {
	close(pfs.stopCh)
}

// priceUpdateLoop continuously updates prices
func (pfs *PriceFeedService) priceUpdateLoop() {
	ticker := time.NewTicker(pfs.updateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			pfs.updatePrices()
		case <-pfs.stopCh:
			return
		}
	}
}

// updatePrices recalculates all prices based on market maker model
func (pfs *PriceFeedService) updatePrices() {
	pfs.mu.Lock()
	defer pfs.mu.Unlock()

	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	for symbol, mm := range pfs.marketMakers {
		pair := pfs.pairs[symbol]

		// Calculate new mid price using random walk with mean reversion
		drift := (mm.BasePrice - mm.LastMidPrice) * 0.01 // Mean reversion
		shock := r.NormFloat64() * mm.Volatility * mm.LastMidPrice * 0.1

		newMidPrice := mm.LastMidPrice + drift + shock

		// Clamp to min/max bounds
		if newMidPrice < pair.MinPrice {
			newMidPrice = pair.MinPrice + r.Float64()*(pair.BasePrice-pair.MinPrice)*0.1
		}
		if newMidPrice > pair.MaxPrice {
			newMidPrice = pair.MaxPrice - r.Float64()*(pair.MaxPrice-pair.BasePrice)*0.1
		}

		mm.LastMidPrice = newMidPrice

		// Get or create current price data
		currentPrice, exists := pfs.currentPrices[symbol]
		if !exists {
			currentPrice = &PriceTick{
				Symbol:    symbol,
				High24h:   newMidPrice,
				Low24h:    newMidPrice,
				Volume24h: 0,
			}
		}

		// Calculate 24h change
		priceChange := newMidPrice - pair.BasePrice
		changePct := (priceChange / pair.BasePrice) * 100

		// Update 24h high/low
		if newMidPrice > currentPrice.High24h {
			currentPrice.High24h = newMidPrice
		}
		if newMidPrice < currentPrice.Low24h {
			currentPrice.Low24h = newMidPrice
		}

		// Simulate volume (in real implementation, this would come from actual trades)
		volumeIncrease := mm.Liquidity * r.Float64() * 0.0001
		currentPrice.Volume24h += volumeIncrease

		// Update current price
		currentPrice.Price = newMidPrice
		currentPrice.Change24h = priceChange
		currentPrice.ChangePct24h = changePct
		currentPrice.QuoteVolume = currentPrice.Volume24h * newMidPrice
		currentPrice.Timestamp = time.Now()

		pfs.currentPrices[symbol] = currentPrice

		// Keep price history (last 24 hours at 100ms intervals = 864000 entries max)
		pfs.priceHistory[symbol] = append(pfs.priceHistory[symbol], *currentPrice)
		if len(pfs.priceHistory[symbol]) > 864000 {
			pfs.priceHistory[symbol] = pfs.priceHistory[symbol][-864000:]
		}
	}
}

// orderBookUpdateLoop continuously updates order books
func (pfs *PriceFeedService) orderBookUpdateLoop() {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	updateID := int64(time.Now().Unix())

	for {
		select {
		case <-ticker.C:
			pfs.updateOrderBooks(updateID)
			updateID++
		case <-pfs.stopCh:
			return
		}
	}
}

// updateOrderBooks generates order book data for all pairs
func (pfs *PriceFeedService) updateOrderBooks(updateID int64) {
	pfs.mu.Lock()
	defer pfs.mu.Unlock()

	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	for symbol, mm := range pfs.marketMakers {
		midPrice := mm.LastMidPrice
		spread := midPrice * mm.Spread

		bidPrice := midPrice - spread/2
		askPrice := midPrice + spread/2

		bids := make([]OrderBookLevel, 0, mm.MaxOrders)
		asks := make([]OrderBookLevel, 0, mm.MaxOrders)

		// Generate bid levels (buy orders)
		for i := 0; i < mm.MaxOrders; i++ {
			priceDecay := 1.0 - float64(i)*0.001
			amountVar := r.Float64()*0.5 + 0.5
			amount := mm.OrderSize * priceDecay * amountVar

			bids = append(bids, OrderBookLevel{
				Price:  bidPrice * (1.0 - float64(i)*0.0005),
				Amount: amount,
			})
		}

		// Generate ask levels (sell orders)
		for i := 0; i < mm.MaxOrders; i++ {
			priceDecay := 1.0 - float64(i)*0.001
			amountVar := r.Float64()*0.5 + 0.5
			amount := mm.OrderSize * priceDecay * amountVar

			asks = append(asks, OrderBookLevel{
				Price:  askPrice * (1.0 + float64(i)*0.0005),
				Amount: amount,
			})
		}

		pfs.orderBooks[symbol] = &OrderBook{
			Symbol:      symbol,
			Bids:        bids,
			Asks:        asks,
			LastUpdateID: updateID,
			Timestamp:   time.Now(),
		}
	}
}

// GetPrice returns the current price for a symbol
func (pfs *PriceFeedService) GetPrice(symbol string) (*PriceTick, error) {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	price, exists := pfs.currentPrices[symbol]
	if !exists {
		return nil, fmt.Errorf("symbol not found: %s", symbol)
	}

	return price, nil
}

// GetAllPrices returns all current prices
func (pfs *PriceFeedService) GetAllPrices() map[string]*PriceTick {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	result := make(map[string]*PriceTick)
	for k, v := range pfs.currentPrices {
		result[k] = v
	}

	return result
}

// GetOrderBook returns the order book for a symbol
func (pfs *PriceFeedService) GetOrderBook(symbol string) (*OrderBook, error) {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	ob, exists := pfs.orderBooks[symbol]
	if !exists {
		return nil, fmt.Errorf("symbol not found: %s", symbol)
	}

	return ob, nil
}

// GetPriceHistory returns price history for a symbol
func (pfs *PriceFeedService) GetPriceHistory(symbol string, limit int) ([]PriceTick, error) {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	history, exists := pfs.priceHistory[symbol]
	if !exists {
		return nil, fmt.Errorf("symbol not found: %s", symbol)
	}

	if limit > len(history) {
		limit = len(history)
	}

	return history[len(history)-limit:], nil
}

// GetTradingPairs returns all configured trading pairs
func (pfs *PriceFeedService) GetTradingPairs() map[string]*TradingPairConfig {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	result := make(map[string]*TradingPairConfig)
	for k, v := range pfs.pairs {
		result[k] = v
	}

	return result
}

// ToJSON serializes price data to JSON
func (pt *PriceTick) ToJSON() (string, error) {
	data, err := json.Marshal(pt)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// FormatPrice formats price according to symbol precision
func (pfs *PriceFeedService) FormatPrice(symbol string, price float64) string {
	pair, exists := pfs.pairs[symbol]
	if !exists {
		return fmt.Sprintf("%f", price)
	}
	format := fmt.Sprintf("%%.%df", pair.PricePrecision)
	return fmt.Sprintf(format, price)
}

// GetMarketSummary returns aggregated market data
func (pfs *PriceFeedService) GetMarketSummary() map[string]interface{} {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	summary := make(map[string]interface{})
	totalVolume := 0.0

	for symbol, price := range pfs.currentPrices {
		summary[symbol] = map[string]interface{}{
			"symbol":         symbol,
			"price":         price.Price,
			"change_24h":    price.Change24h,
			"change_pct_24h": price.ChangePct24h,
			"high_24h":      price.High24h,
			"low_24h":       price.Low24h,
			"volume_24h":    price.Volume24h,
			"quote_volume":  price.QuoteVolume,
		}
		totalVolume += price.QuoteVolume
	}

	summary["_meta"] = map[string]interface{}{
		"total_volume_24h": totalVolume,
		"active_pairs":     len(pfs.currentPrices),
		"timestamp":        time.Now().Unix(),
	}

	return summary
}

// CalculateVolatility calculates rolling volatility for a symbol
func (pfs *PriceFeedService) CalculateVolatility(symbol string, window int) (float64, error) {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	history, exists := pfs.priceHistory[symbol]
	if !exists || len(history) < window {
		return 0, fmt.Errorf("insufficient data for volatility calculation")
	}

	recent := history[len(history)-window:]
	var returns []float64

	for i := 1; i < len(recent); i++ {
		ret := math.Log(recent[i].Price / recent[i-1].Price)
		returns = append(returns, ret)
	}

	if len(returns) == 0 {
		return 0, nil
	}

	// Calculate standard deviation
	mean := 0.0
	for _, r := range returns {
		mean += r
	}
	mean /= float64(len(returns))

	variance := 0.0
	for _, r := range returns {
		diff := r - mean
		variance += diff * diff
	}
	variance /= float64(len(returns))

	return math.Sqrt(variance) * math.Sqrt(252) * 100, nil // Annualized volatility %
}
