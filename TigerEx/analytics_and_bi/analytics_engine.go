package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

type MarketStats struct {
	Symbol         string    `json:"symbol"`
	Price          float64   `json:"price"`
	PriceChange    float64   `json:"priceChange"`
	PriceChange24h float64   `json:"priceChange24h"`
	High24h        float64   `json:"high24h"`
	Low24h         float64   `json:"low24h"`
	Volume24h      float64   `json:"volume24h"`
	QuoteVolume24h float64   `json:"quoteVolume24h"`
	Trades24h     int64     `json:"trades24h"`
	WeightedAvgPrice float64 `json:"weightedAvgPrice"`
	Timestamp      int64     `json:"timestamp"`
}

type UserStats struct {
	UserID           string  `json:"userId"`
	TotalTrades     int64   `json:"totalTrades"`
	TotalVolume    float64 `json:"totalVolume"`
	TotalFees      float64 `json:"totalFees"`
	WinRate        float64 `json:"winRate"`
	ProfitFactor   float64 `json:"profitFactor"`
	AvgTradeSize   float64 `json:"avgTradeSize"`
	LargestTrade   float64 `json:"largestTrade"`
	MostTraded    string  `json:"mostTraded"`
}

type Trade struct {
	TradeID     string  `json:"tradeId"`
	UserID      string  `json:"userId"`
	Symbol      string  `json:"symbol"`
	Side        string  `json:"side"`
	Price       float64 `json:"price"`
	Quantity    float64 `json:"quantity"`
	Fee         float64 `json:"fee"`
	RealizedPNL float64 `json:"realizedPnl"`
	Timestamp   int64   `json:"timestamp"`
}

// ============================================================================
// ANALYTICS ENGINE
// ============================================================================

type AnalyticsEngine struct {
	mu sync.RWMutex

	// Market statistics
	marketStats map[string]*MarketStats
	priceHistory map[string][]float64 // symbol -> recent prices

	// User statistics
	userStats map[string]*UserStats
	userTrades map[string][]*Trade

	// Aggregations
	tradeVolume   map[string]float64 // symbol -> daily volume
	dailyVolume   float64
	hourlyVolume  map[int]float64 // hour -> volume

	// Metrics
	TotalTrades    int64   `json:"totalTrades"`
	TotalVolume   float64 `json:"totalVolume"`
	TotalFees    float64 `json:"totalFees"`
	AvgTradeSize float64 `json:"avgTradeSize"`

	// Window sizes
	priceWindow int
	volumeWindow time.Duration
}

func NewAnalyticsEngine() *AnalyticsEngine {
	return &AnalyticsEngine{
		marketStats:  make(map[string]*MarketStats),
		priceHistory: make(map[string][]float64),
		userStats:   make(map[string]*UserStats),
		userTrades:  make(map[string][]*Trade),
		tradeVolume: make(map[string]float64),
		hourlyVolume: make(map[int]float64),
		priceWindow: 100,
		volumeWindow: 24 * time.Hour,
	}
}

// ============================================================================
// MARKET ANALYTICS
// ============================================================================

func (ae *AnalyticsEngine) RecordTrade(trade *Trade) {
	ae.mu.Lock()
	defer ae.mu.Unlock()

	// Update market stats
	ae.updateMarketStats(trade.Symbol, trade.Price, trade.Quantity)

	// Update user stats
	ae.updateUserStats(trade)

	// Update aggregations
	ae.tradeVolume[trade.Symbol] += trade.Price * trade.Quantity
	ae.dailyVolume += trade.Price * trade.Quantity
	ae.hourlyVolume[time.Now().Hour()] += trade.Price * trade.Quantity

	// Update metrics
	atomic.AddInt64(&ae.TotalTrades, 1)
	atomic.AddFloat64(&ae.TotalVolume, trade.Price*trade.Quantity)
	atomic.AddFloat64(&ae.TotalFees, trade.Fee)
}

func (ae *AnalyticsEngine) updateMarketStats(symbol string, price, quantity float64) {
	stats, exists := ae.marketStats[symbol]
	if !exists {
		stats = &MarketStats{
			Symbol:  symbol,
			High24h: price,
			Low24h:  price,
			Timestamp: time.Now().UnixMilli(),
		}
		ae.marketStats[symbol] = stats
	}

	// Update stats
	stats.Price = price
	stats.Volume24h += quantity
	stats.QuoteVolume24h += price * quantity
	stats.Trades24h++

	if price > stats.High24h {
		stats.High24h = price
	}
	if price < stats.Low24h || stats.Low24h == 0 {
		stats.Low24h = price
	}

	// Calculate price change
	if len(ae.priceHistory[symbol]) > 0 {
		firstPrice := ae.priceHistory[symbol][0]
		stats.PriceChange = price - firstPrice
		if firstPrice > 0 {
			stats.PriceChange24h = (stats.PriceChange / firstPrice) * 100
		}
	}

	// Update price history
	ae.priceHistory[symbol] = append(ae.priceHistory[symbol], price)
	if len(ae.priceHistory[symbol]) > ae.priceWindow {
		ae.priceHistory[symbol] = ae.priceHistory[symbol][1:]
	}

	// Calculate VWAP
	if stats.Trades24h > 0 {
		stats.WeightedAvgPrice = stats.QuoteVolume24h / stats.Volume24h
	}

	stats.Timestamp = time.Now().UnixMilli()
}

func (ae *AnalyticsEngine) updateUserStats(trade *Trade) {
	// Get or create user stats
	stats, exists := ae.userStats[trade.UserID]
	if !exists {
		stats = &UserStats{
			UserID: trade.UserID,
		}
		ae.userStats[trade.UserID] = stats
	}

	// Update statistics
	stats.TotalTrades++
	stats.TotalVolume += trade.Price * trade.Quantity
	stats.TotalFees += trade.Fee

	// Update trade history
	ae.userTrades[trade.UserID] = append(ae.userTrades[trade.UserID], trade)

	// Keep last 10000 trades
	if len(ae.userTrades[trade.UserID]) > 10000 {
		ae.userTrades[trade.UserID] = ae.userTrades[trade.UserID][1:]
	}

	// Calculate averages
	if stats.TotalTrades > 0 {
		stats.AvgTradeSize = stats.TotalVolume / float64(stats.TotalTrades)
	}

	// Track largest trade
	tradeValue := trade.Price * trade.Quantity
	if tradeValue > stats.LargestTrade {
		stats.LargestTrade = tradeValue
	}

	// Calculate win rate (for closed positions)
	var wins, losses float64
	for _, t := range ae.userTrades[trade.UserID] {
		if t.RealizedPNL > 0 {
			wins += t.RealizedPNL
		} else if t.RealizedPNL < 0 {
			losses += math.Abs(t.RealizedPNL)
		}
	}

	if wins+losses > 0 {
		stats.WinRate = (wins / (wins + losses)) * 100
	}

	if losses > 0 {
		stats.ProfitFactor = wins / losses
	}
}

// ============================================================================
// QUERY METHODS
// ============================================================================

func (ae *AnalyticsEngine) GetMarketStats(symbol string) (*MarketStats, error) {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	stats, exists := ae.marketStats[symbol]
	if !exists {
		return nil, fmt.Errorf("no data for symbol: %s", symbol)
	}

	return stats, nil
}

func (ae *AnalyticsEngine) GetAllMarketStats() map[string]*MarketStats {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	result := make(map[string]*MarketStats)
	for k, v := range ae.marketStats {
		result[k] = v
	}

	return result
}

func (ae *AnalyticsEngine) GetUserStats(userID string) (*UserStats, error) {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	stats, exists := ae.userStats[userID]
	if !exists {
		return nil, fmt.Errorf("no data for user: %s", userID)
	}

	return stats, nil
}

func (ae *AnalyticsEngine) GetUserTrades(userID string, limit int) []*Trade {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	trades := ae.userTrades[userID]
	if len(trades) == 0 {
		return []*Trade{}
	}

	start := 0
	if len(trades) > limit {
		start = len(trades) - limit
	}

	return trades[start:]
}

func (ae *AnalyticsEngine) GetTopMarkets(limit int) []map[string]interface{} {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	type marketVol struct {
		symbol string
		volume float64
	}

	var markets []marketVol
	for symbol, vol := range ae.tradeVolume {
		markets = append(markets, marketVol{symbol, vol})
	}

	// Sort by volume
	for i := 0; i < len(markets)-1; i++ {
		for j := i + 1; j < len(markets); j++ {
			if markets[j].volume > markets[i].volume {
				markets[i], markets[j] = markets[j], markets[i]
			}
		}
	}

	// Return top N
	result := make([]map[string]interface{}, 0, limit)
	for i := 0; i < len(markets) && i < limit; i++ {
		result = append(result, map[string]interface{}{
			"symbol": markets[i].symbol,
			"volume": markets[i].volume,
		})
	}

	return result
}

func (ae *AnalyticsEngine) GetTopTraders(limit int) []map[string]interface{} {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	type trader struct {
		userID string
		volume float64
	}

	var traders []trader
	for userID, stats := range ae.userStats {
		traders = append(traders, trader{userID, stats.TotalVolume})
	}

	// Sort by volume
	for i := 0; i < len(traders)-1; i++ {
		for j := i + 1; j < len(traders); j++ {
			if traders[j].volume > traders[i].volume {
				traders[i], traders[j] = traders[j], traders[i]
			}
		}
	}

	// Return top N
	result := make([]map[string]interface{}, 0, limit)
	for i := 0; i < len(traders) && i < limit; i++ {
		result = append(result, map[string]interface{}{
			"userId": traders[i].userID,
			"volume": traders[i].volume,
		})
	}

	return result
}

func (ae *AnalyticsEngine) GetVolumeBreakdown() map[string]interface{} {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	return map[string]interface{}{
		"totalDailyVolume": ae.dailyVolume,
		"bySymbol":         ae.tradeVolume,
		"byHour":           ae.hourlyVolume,
	}
}

// ============================================================================
// REAL-TIME AGGREGATIONS
// ============================================================================

func (ae *AnalyticsEngine) GetRollingAverage(symbol string, window int) float64 {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	prices := ae.priceHistory[symbol]
	if len(prices) == 0 {
		return 0
	}

	start := 0
	if len(prices) > window {
		start = len(prices) - window
	}

	var sum float64
	for i := start; i < len(prices); i++ {
		sum += prices[i]
	}

	return sum / float64(len(prices) - start)
}

func (ae *AnalyticsEngine) GetVolatility(symbol string) float64 {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	prices := ae.priceHistory[symbol]
	if len(prices) < 2 {
		return 0
	}

	// Calculate standard deviation
	var sum, mean float64
	for _, p := range prices {
		sum += p
	}
	mean = sum / float64(len(prices))

	var variance float64
	for _, p := range prices {
		diff := p - mean
		variance += diff * diff
	}
	variance /= float64(len(prices))

	return math.Sqrt(variance)
}

func (ae *AnalyticsEngine) GetPriceMomentum(symbol string, shortWindow, longWindow int) float64 {
	ae.mu.RLock()
	defer ae.mu.RUnlock()

	prices := ae.priceHistory[symbol]
	if len(prices) < longWindow {
		return 0
	}

	// Short MA
	shortStart := len(prices) - shortWindow
	shortSum := 0.0
	for i := shortStart; i < len(prices); i++ {
		shortSum += prices[i]
	}
	shortMA := shortSum / float64(shortWindow)

	// Long MA
	longStart := len(prices) - longWindow
	longSum := 0.0
	for i := longStart; i < len(prices); i++ {
		longSum += prices[i]
	}
	longMA := longSum / float64(longWindow)

	// Momentum = (short MA - long MA) / long MA * 100
	if longMA == 0 {
		return 0
	}

	return ((shortMA - longMA) / longMA) * 100
}

// ============================================================================
// METRICS
// ============================================================================

func (ae *AnalyticsEngine) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"totalTrades":    atomic.LoadInt64(&ae.TotalTrades),
		"totalVolume":   atomic.LoadFloat64(&ae.TotalVolume),
		"totalFees":    atomic.LoadFloat64(&ae.TotalFees),
		"avgTradeSize": atomic.LoadFloat64(&ae.AvgTradeSize),
		"uniqueMarkets": len(ae.marketStats),
		"uniqueUsers":  len(ae.userStats),
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Analytics Engine (Go)")
	fmt.Println("=================================\n")

	engine := NewAnalyticsEngine()

	// Simulate trades
	symbols := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT"}
	users := []string{"user1", "user2", "user3", "user4", "user5"}

	fmt.Println("Processing sample trades...")

	for i := 0; i < 100; i++ {
		symbol := symbols[i%len(symbols)]
		user := users[i%len(users)]

		price := 50000.0 + float64(i%1000)
		quantity := 0.1 + float64(i%10)*0.1

		trade := &Trade{
			TradeID:     uuid.New().String(),
			UserID:      user,
			Symbol:      symbol,
			Side:        []string{"buy", "sell"}[i%2],
			Price:       price,
			Quantity:    quantity,
			Fee:         price * quantity * 0.001,
			RealizedPNL: (float64(i%3) - 1) * 10, // Random P&L
			Timestamp:   time.Now().UnixMilli(),
		}

		engine.RecordTrade(trade)

		if i%20 == 0 {
			fmt.Printf("Recorded trade %d: %s %s %.4f @ %.2f\n", 
				i, trade.Side, trade.Symbol, trade.Quantity, trade.Price)
		}
	}

	// Get market stats
	fmt.Println("\n--- Market Statistics ---")
	stats, _ := engine.GetMarketStats("BTC/USDT")
	statsJSON, _ := json.MarshalIndent(stats, "", "  ")
	fmt.Printf("BTC/USDT:\n%s\n", string(statsJSON))

	// Get user stats
	fmt.Println("\n--- User Statistics ---")
	userStats, _ := engine.GetUserStats("user1")
	userJSON, _ := json.MarshalIndent(userStats, "", "  ")
	fmt.Printf("user1:\n%s\n", string(userJSON))

	// Get top markets
	fmt.Println("\n--- Top Markets ---")
	topMarkets := engine.GetTopMarkets(3)
	for _, m := range topMarkets {
		fmt.Printf("  %s: %.2f\n", m["symbol"], m["volume"])
	}

	// Get top traders
	fmt.Println("\n--- Top Traders ---")
	topTraders := engine.GetTopTraders(3)
	for _, t := range topTraders {
		fmt.Printf("  %s: %.2f\n", t["userId"], t["volume"])
	}

	// Get analytics
	fmt.Println("\n--- Analytics ---")
	fmt.Printf("BTC Momentum: %.2f%%\n", engine.GetPriceMomentum("BTC/USDT", 10, 30))
	fmt.Printf("BTC Volatility: %.2f\n", engine.GetVolatility("BTC/USDT"))
	fmt.Printf("BTC MA(10): %.2f\n", engine.GetRollingAverage("BTC/USDT", 10))

	// Get metrics
	metrics := engine.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nAnalytics engine ready.")
}