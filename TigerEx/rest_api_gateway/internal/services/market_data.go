package services

import (
	"context"
	"fmt"
	"math"
	"sync"

	"tigerEx/rest_api_gateway/internal/models"
)

// ============================================================================
// MARKET DATA SERVICE
// ============================================================================

// MarketDataService handles market data operations
type MarketDataService struct {
	mu          sync.RWMutex
	symbols     map[string]*models.Symbol
	tickers     map[string]*models.Ticker24h
	prices      map[string]float64
	depth       map[string]*models.Depth
	klines      map[string][][]*models.Kline
	aggTrades   map[string][]*models.WSAggTrade
}

// NewMarketDataService creates a new market data service
func NewMarketDataService() *MarketDataService {
	mds := &MarketDataService{
		symbols:   make(map[string]*models.Symbol),
		tickers:   make(map[string]*models.Ticker24h),
		prices:    make(map[string]float64),
		depth:     make(map[string]*models.Depth),
		klines:    make(map[string][][]*models.Kline),
		aggTrades: make(map[string][]*models.WSAggTrade),
	}

	// No market symbols or prices are seeded. A live market-data adapter must populate them.
	return mds
}

// ============================================================================
// SYMBOL OPERATIONS
// ============================================================================

// GetExchangeInfo gets exchange info
func (mds *MarketDataService) GetExchangeInfo(ctx context.Context) ([]*models.Symbol, error) {
	mds.mu.RLock()
	defer mds.mu.RUnlock()

	var result []*models.Symbol
	for _, symbol := range mds.symbols {
		result = append(result, symbol)
	}

	return result, nil
}

// GetSymbol gets a symbol
func (mds *MarketDataService) GetSymbol(ctx context.Context, symbol string) (*models.Symbol, error) {
	mds.mu.RLock()
	defer mds.mu.RUnlock()

	s, ok := mds.symbols[symbol]
	if !ok {
		return nil, models.NewAPIError(404, "Symbol not found")
	}

	return s, nil
}

// ============================================================================
// PRICE OPERATIONS
// ============================================================================

// GetPrice gets current price for a symbol
func (mds *MarketDataService) GetPrice(ctx context.Context, symbol string) (float64, error) {
	mds.mu.RLock()
	defer mds.mu.RUnlock()

	price, ok := mds.prices[symbol]
	if !ok {
		return 0, models.NewAPIError(404, "Symbol not found")
	}

	return price, nil
}

// GetPrices gets prices for multiple symbols
func (mds *MarketDataService) GetPrices(ctx context.Context, symbols []string) (map[string]float64, error) {
	mds.mu.RLock()
	defer mds.mu.RUnlock()

	result := make(map[string]float64)
	for _, symbol := range symbols {
		if price, ok := mds.prices[symbol]; ok {
			result[symbol] = price
		}
	}

	return result, nil
}

// UpdatePrice updates price for a symbol (called by matching engine)
func (mds *MarketDataService) UpdatePrice(symbol string, price float64) {
	if symbol == "" || price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) { return }
	mds.mu.Lock()
	mds.prices[symbol] = price
	mds.mu.Unlock()
}

// PublishTicker ingests a ticker supplied by an authenticated market-data adapter.
func (mds *MarketDataService) PublishTicker(ticker *models.Ticker24h) error {
	if ticker == nil || ticker.Symbol == "" || ticker.LastPrice <= 0 || math.IsNaN(ticker.LastPrice) || math.IsInf(ticker.LastPrice, 0) {
		return models.NewAPIError(400, "Invalid live ticker")
	}
	mds.mu.Lock()
	mds.tickers[ticker.Symbol] = ticker
	mds.prices[ticker.Symbol] = ticker.LastPrice
	mds.mu.Unlock()
	return nil
}

// PublishDepth ingests an actual order book snapshot from a trusted adapter.
func (mds *MarketDataService) PublishDepth(symbol string, depth *models.Depth) error {
	if symbol == "" || depth == nil { return models.NewAPIError(400, "Symbol and live depth are required") }
	mds.mu.Lock()
	mds.depth[symbol] = depth
	mds.mu.Unlock()
	return nil
}

// PublishKlines ingests actual candles for a symbol and interval.
func (mds *MarketDataService) PublishKlines(symbol, interval string, candles []*models.Kline) error {
	if symbol == "" || getIntervalMinutes(interval) == 0 || candles == nil { return models.NewAPIError(400, "Symbol, valid interval, and candle data are required") }
	for _, candle := range candles {
		if candle == nil || candle.Open <= 0 || candle.High < candle.Low || candle.Low <= 0 || candle.Close <= 0 || candle.Volume < 0 {
			return models.NewAPIError(400, "Invalid candle data")
		}
	}
	mds.mu.Lock()
	mds.klines[symbol+":"+interval] = [][]*models.Kline{append([]*models.Kline(nil), candles...)}
	mds.mu.Unlock()
	return nil
}

// PublishTrades ingests actual trades from a trusted adapter.
func (mds *MarketDataService) PublishTrades(symbol string, trades []*models.WSAggTrade) error {
	if symbol == "" || trades == nil { return models.NewAPIError(400, "Symbol and trade data are required") }
	for _, trade := range trades {
		if trade == nil || trade.Symbol != symbol || trade.Price <= 0 || trade.Quantity <= 0 {
			return models.NewAPIError(400, "Invalid trade data")
		}
	}
	mds.mu.Lock()
	mds.aggTrades[symbol] = append([]*models.WSAggTrade(nil), trades...)
	mds.mu.Unlock()
	return nil
}

// ============================================================================
// TICKER OPERATIONS
// ============================================================================

// Get24hTicker gets 24h ticker for a symbol
// Get24hTicker returns only a ticker published by a configured live market-data adapter.
func (mds *MarketDataService) Get24hTicker(ctx context.Context, symbol string) (*models.Ticker24h, error) {
	_ = ctx
	mds.mu.RLock()
	ticker, ok := mds.tickers[symbol]
	mds.mu.RUnlock()
	if !ok || ticker == nil { return nil, models.NewAPIError(503, "MARKET_DATA_NOT_CONFIGURED: no live 24-hour ticker is available") }
	return ticker, nil
}

// GetAllTickers returns only tickers published by a configured live market-data adapter.
func (mds *MarketDataService) GetAllTickers(ctx context.Context) ([]*models.Ticker24h, error) {
	_ = ctx
	mds.mu.RLock()
	defer mds.mu.RUnlock()
	result := make([]*models.Ticker24h, 0, len(mds.tickers))
	for _, ticker := range mds.tickers { if ticker != nil { result = append(result, ticker) } }
	return result, nil
}

// GetBookTicker returns live best bid/ask data only; it never derives a synthetic spread from last price.
func (mds *MarketDataService) GetBookTicker(ctx context.Context, symbol string) (*models.BookTicker, error) {
	_ = ctx
	_ = symbol
	return nil, models.NewAPIError(503, "MARKET_DATA_NOT_CONFIGURED: live order-book ticker adapter is not connected")
}

// GetDepth returns only an order book published by a live market-data adapter.
func (mds *MarketDataService) GetDepth(ctx context.Context, symbol string, limit int) (*models.Depth, error) {
	_ = ctx
	if limit < 0 || limit > 5000 { return nil, models.NewAPIError(400, "Invalid depth limit") }
	mds.mu.RLock()
	depth, ok := mds.depth[symbol]
	mds.mu.RUnlock()
	if !ok || depth == nil { return nil, models.NewAPIError(503, "MARKET_DATA_NOT_CONFIGURED: live order book is unavailable") }
	return depth, nil
}

// GetKlines returns persisted/published candles only; no candles are fabricated.
func (mds *MarketDataService) GetKlines(ctx context.Context, symbol, interval string, startTime, endTime int64, limit int) ([]*models.Kline, error) {
	_ = ctx
	if getIntervalMinutes(interval) == 0 { return nil, models.NewAPIError(400, "Invalid interval") }
	if limit < 0 || limit > 1500 { return nil, models.NewAPIError(400, "Invalid kline limit") }
	mds.mu.RLock()
	series, ok := mds.klines[symbol+":"+interval]
	mds.mu.RUnlock()
	if !ok || len(series) == 0 { return nil, models.NewAPIError(503, "MARKET_DATA_NOT_CONFIGURED: live or historical candle adapter is not connected") }
	var result []*models.Kline
	for _, candle := range series[0] {
		if candle == nil || (startTime > 0 && candle.OpenTime < startTime) || (endTime > 0 && candle.OpenTime > endTime) { continue }
		result = append(result, candle)
	}
	if limit > 0 && len(result) > limit { result = result[len(result)-limit:] }
	return result, nil
}

// GetRecentTrades returns only actual trades published by the market-data adapter.
func (mds *MarketDataService) GetRecentTrades(ctx context.Context, symbol string, limit int) ([]*models.WSAggTrade, error) {
	_ = ctx
	if limit < 0 || limit > 1000 { return nil, models.NewAPIError(400, "Invalid recent-trades limit") }
	mds.mu.RLock()
	trades, ok := mds.aggTrades[symbol]
	mds.mu.RUnlock()
	if !ok { return nil, models.NewAPIError(503, "MARKET_DATA_NOT_CONFIGURED: live trade feed is not connected") }
	if limit > 0 && len(trades) > limit { trades = trades[len(trades)-limit:] }
	return trades, nil
}

// GetAvgPrice fails closed until a real weighted-average price provider is connected.
func (mds *MarketDataService) GetAvgPrice(ctx context.Context, symbol string, minutes int) (float64, error) {
	_ = ctx
	_ = symbol
	if minutes <= 0 { return 0, models.NewAPIError(400, "Average-price window must be positive") }
	return 0, models.NewAPIError(503, "MARKET_DATA_NOT_CONFIGURED: weighted-average price provider is not connected")
}

func getIntervalMinutes(interval string) int {
	switch interval {
	case "1m":
		return 1
	case "3m":
		return 3
	case "5m":
		return 5
	case "15m":
		return 15
	case "30m":
		return 30
	case "1h":
		return 60
	case "2h":
		return 120
	case "4h":
		return 240
	case "6h":
		return 360
	case "8h":
		return 480
	case "12h":
		return 720
	case "1d":
		return 1440
	case "1w":
		return 10080
	case "1M":
		return 43200
	default:
		return 0
	}
}

func formatFloat(f float64) string {
	return fmt.Sprintf("%.8f", f)
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}