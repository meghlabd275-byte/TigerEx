package services

import (
	"context"
	"sync"
	"time"

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

	// Initialize with default symbols
	mds.initializeSymbols()

	return mds
}

// initializeSymbols initializes default trading symbols
func (mds *MarketDataService) initializeSymbols() {
	defaultSymbols := []struct {
		Symbol           string
		BaseAsset       string
		QuoteAsset      string
		MakerFee       float64
		TakerFee       float64
	}{
		{"BTC/USDT", "BTC", "USDT", 0.001, 0.001},
		{"ETH/USDT", "ETH", "USDT", 0.001, 0.001},
		{"BNB/USDT", "BNB", "USDT", 0.001, 0.001},
		{"SOL/USDT", "SOL", "USDT", 0.001, 0.001},
		{"XRP/USDT", "XRP", "USDT", 0.001, 0.001},
		{"ADA/USDT", "ADA", "USDT", 0.001, 0.001},
		{"DOGE/USDT", "DOGE", "USDT", 0.001, 0.001},
		{"DOT/USDT", "DOT", "USDT", 0.001, 0.001},
		{"MATIC/USDT", "MATIC", "USDT", 0.001, 0.001},
		{"LTC/USDT", "LTC", "USDT", 0.001, 0.001},
		{"AVAX/USDT", "AVAX", "USDT", 0.001, 0.001},
		{"LINK/USDT", "LINK", "USDT", 0.001, 0.001},
		{"ATOM/USDT", "ATOM", "USDT", 0.001, 0.001},
		{"UNI/USDT", "UNI", "USDT", 0.001, 0.001},
		{"XLM/USDT", "XLM", "USDT", 0.001, 0.001},
	}

	for _, s := range defaultSymbols {
		mds.symbols[s.Symbol] = &models.Symbol{
			Symbol:        s.Symbol,
			BaseAsset:     s.BaseAsset,
			QuoteAsset:    s.QuoteAsset,
			Status:       "TRADING",
			BasePrecision: 8,
			QuotePrecision: 8,
			MinQuantity:  0.00001,
			MaxQuantity:  1000000,
			MinPrice:     0.01,
			MaxPrice:     1000000,
			MinNotional:  10,
			MakerFee:     s.MakerFee,
			TakerFee:     s.TakerFee,
			IsMargin:     true,
			AllowSpot:   true,
			AllowMargin: true,
			AllowFutures: false,
		}

		// Initialize mock price
		mds.prices[s.Symbol] = mds.getInitialPrice(s.BaseAsset)
	}
}

// getInitialPrice returns initial price for an asset
func (mds *MarketDataService) getInitialPrice(baseAsset string) float64 {
	prices := map[string]float64{
		"BTC":  50000.0,
		"ETH":  3000.0,
		"BNB":  600.0,
		"SOL":  100.0,
		"XRP":  0.5,
		"ADA":  0.35,
		"DOGE": 0.08,
		"DOT":  7.0,
		"MATIC": 0.8,
		"LTC":  70.0,
		"AVAX": 35.0,
		"LINK": 15.0,
		"ATOM": 9.0,
		"UNI":  7.0,
		"XLM":  0.12,
	}
	if price, ok := prices[baseAsset]; ok {
		return price
	}
	return 1.0
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
		return nil, models.NewErrorResponse(404, "Symbol not found")
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
		return 0, models.NewErrorResponse(404, "Symbol not found")
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
	mds.mu.Lock()
	mds.prices[symbol] = price
	mds.mu.Unlock()
}

// ============================================================================
// TICKER OPERATIONS
// ============================================================================

// Get24hTicker gets 24h ticker for a symbol
func (mds *MarketDataService) Get24hTicker(ctx context.Context, symbol string) (*models.Ticker24h, error) {
	mds.mu.RLock()
	defer mds.mu.RUnlock()

	ticker, ok := mds.tickers[symbol]
	if !ok {
		// Generate mock ticker
		price := mds.prices[symbol]
		ticker = &models.Ticker24h{
			Symbol:             symbol,
			PriceChange:        price * 0.02,
			PriceChangePercent: 2.0,
			LastPrice:          price,
			HighPrice:          price * 1.05,
			LowPrice:           price * 0.95,
			Volume:             1000000,
			QuoteVolume:        50000000,
			OpenPrice:          price * 0.98,
			OpenTime:           time.Now().Add(-24*time.Hour).UnixMilli(),
			CloseTime:          time.Now().UnixMilli(),
			Count:             100000,
		}
	}

	return ticker, nil
}

// GetAllTickers gets all 24h tickers
func (mds *MarketDataService) GetAllTickers(ctx context.Context) ([]*models.Ticker24h, error) {
	mds.mu.RLock()
	defer mds.mu.RUnlock()

	var result []*models.Ticker24h
	for symbol := range mds.symbols {
		ticker, _ := mds.tickers[symbol]
		if ticker == nil {
			price := mds.prices[symbol]
			ticker = &models.Ticker24h{
				Symbol:             symbol,
				PriceChange:        price * 0.02,
				PriceChangePercent: 2.0,
				LastPrice:          price,
				HighPrice:          price * 1.05,
				LowPrice:           price * 0.95,
				Volume:             1000000,
				QuoteVolume:        50000000,
				OpenPrice:          price * 0.98,
				OpenTime:           time.Now().Add(-24*time.Hour).UnixMilli(),
				CloseTime:          time.Now().UnixMilli(),
				Count:             100000,
			}
		}
		result = append(result, ticker)
	}

	return result, nil
}

// ============================================================================
// BOOK TICKER OPERATIONS
// ============================================================================

// GetBookTicker gets book ticker (best bid/ask) for a symbol
func (mds *MarketDataService) GetBookTicker(ctx context.Context, symbol string) (*models.BookTicker, error) {
	mds.mu.RLock()
	price := mds.prices[symbol]
	mds.mu.RUnlock()

	spread := price * 0.001 // 0.1% spread
	return &models.BookTicker{
		Symbol:   symbol,
		BidPrice: price - spread/2,
		BidQty:   10.0,
		AskPrice: price + spread/2,
		AskQty:   10.0,
	}, nil
}

// ============================================================================
// DEPTH/ORDER BOOK OPERATIONS
// ============================================================================

// GetDepth gets order book depth for a symbol
func (mds *MarketDataService) GetDepth(ctx context.Context, symbol string, limit int) (*models.Depth, error) {
	mds.mu.RLock()
	price := mds.prices[symbol]
	mds.mu.RUnlock()

	if limit <= 0 {
		limit = 100
	}
	if limit > 5000 {
		limit = 5000
	}

	// Generate mock order book
	depth := &models.Depth{
		LastUpdateID: time.Now().UnixMilli(),
		Bids:         [][]string{},
		Asks:         [][]string{},
	}

	spread := price * 0.001
	for i := 0; i < limit; i++ {
		bidPrice := price - spread - float64(i)*price*0.0001
		bidQty := float64(10-i) * 0.5
		depth.Bids = append(depth.Bids, []string{
		 formatFloat(bidPrice),
		 formatFloat(bidQty),
		})

		askPrice := price + spread + float64(i)*price*0.0001
		askQty := float64(10-i) * 0.5
		depth.Asks = append(depth.Asks, []string{
		 formatFloat(askPrice),
		 formatFloat(askQty),
		})
	}

	return depth, nil
}

// ============================================================================
// KLINE/CANDLESTICK OPERATIONS
// ============================================================================

// GetKlines gets klines for a symbol
func (mds *MarketDataService) GetKlines(ctx context.Context, symbol, interval string, startTime, endTime int64, limit int) ([]*models.Kline, error) {
	mds.mu.RLock()
	price := mds.prices[symbol]
	mds.mu.RUnlock()

	if limit <= 0 {
		limit = 500
	}
	if limit > 1500 {
		limit = 1500
	}

	// Get interval in minutes
	intervalMinutes := getIntervalMinutes(interval)
	if intervalMinutes == 0 {
		return nil, models.NewErrorResponse(400, "Invalid interval")
	}

	// Generate mock klines
	var klines []*models.Kline
	now := time.Now()
	for i := limit - 1; i >= 0; i-- {
		openTime := now.Add(-time.Duration(i*intervalMinutes) * time.Minute)
		volatility := price * 0.02
		open := price + (float64(i%10)-5)*volatility/10
		close := price + (float64((i+1)%10)-5)*volatility/10
		high := max(open, close) + volatility/20
		low := min(open, close) - volatility/20
		volume := 1000.0 + float64(i)*10

		klines = append(klines, &models.Kline{
			OpenTime:     openTime.UnixMilli(),
			Open:        open,
			High:        high,
			Low:         low,
			Close:       close,
			Volume:      volume,
			CloseTime:   openTime.Add(time.Duration(intervalMinutes) * time.Minute).UnixMilli(),
			QuoteVolume: volume * price,
			NumTrades:   int64(100 + i),
			TakerBaseVol: volume * 0.8,
		})
	}

	return klines, nil
}

// ============================================================================
// RECENT TRADES
// ============================================================================

// GetRecentTrades gets recent trades for a symbol
func (mds *MarketDataService) GetRecentTrades(ctx context.Context, symbol string, limit int) ([]*models.WSAggTrade, error) {
	mds.mu.RLock()
	price := mds.prices[symbol]
	mds.mu.RUnlock()

	if limit <= 0 {
		limit = 500
	}
	if limit > 1000 {
		limit = 1000
	}

	// Generate mock trades
	var trades []*models.WSAggTrade
	now := time.Now()
	for i := 0; i < limit; i++ {
		tradeTime := now.Add(-time.Duration(i*10) * time.Second)
		volatility := price * 0.001
		tradePrice := price + (float64(i%5)-2)*volatility
		tradeQty := float64(1+i%10) * 0.1

		trades = append(trades, &models.WSAggTrade{
			Event:        "aggTrade",
			EventTime:   tradeTime.UnixMilli(),
			Symbol:      symbol,
			TradeID:     int64(1000000 + i),
			Price:       tradePrice,
			Quantity:    tradeQty,
			BuyerOrderID: int64(2000000 + i),
			SellerOrderID: int64(3000000 + i),
			TradeTime:   tradeTime.UnixMilli(),
			IsMaker:     i%2 == 0,
			IsBestMatch: true,
		})
	}

	return trades, nil
}

// ============================================================================
// AVERAGE PRICE
// ============================================================================

// GetAvgPrice gets average price for a symbol over a period
func (mds *MarketDataService) GetAvgPrice(ctx context.Context, symbol string, minutes int) (float64, error) {
	mds.mu.RLock()
	price := mds.prices[symbol]
	mds.mu.RUnlock()

	// Add some variance
	variance := price * 0.001
	return price + (float64(minutes%10)-5)*variance, nil
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
	return.Sprintf("%.8f", f)
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