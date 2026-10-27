// TigerEx Price Feed Service
//
// This service exposes the exchange's market data over HTTP. It is a caching
// read-through layer in front of a MarketDataSource; it does not invent prices.
//
// The previous implementation generated prices with a math/rand random walk
// seeded from the clock, generated order books from a spread and a random size
// jitter, and produced trades by pairing its own fake bids and asks. Every
// number it served was fabricated, including 24h volume, klines, and volatility.
// A market data feed that invents prices is worse than no feed: it feeds the
// risk engine, the mark price, and every client UI.
package pricefeed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
)

var (
	// ErrSourceUnavailable is returned when no market data source is configured.
	ErrSourceUnavailable = errors.New("market data source unavailable")
	// ErrSymbolNotFound is returned for an unknown symbol.
	ErrSymbolNotFound = errors.New("symbol not found")
	// ErrInvalidRequest is returned for a malformed request.
	ErrInvalidRequest = errors.New("invalid request")
)

// PriceTick is the current state of a market.
type PriceTick struct {
	Symbol       string    `json:"symbol"`
	Price        float64   `json:"price"`
	Change24h    float64   `json:"change_24h"`
	ChangePct24h float64   `json:"change_pct_24h"`
	High24h      float64   `json:"high_24h"`
	Low24h       float64   `json:"low_24h"`
	Volume24h    float64   `json:"volume_24h"`
	QuoteVolume  float64   `json:"quote_volume"`
	Timestamp    time.Time `json:"timestamp"`
}

// OrderBookLevel is one price level.
type OrderBookLevel struct {
	Price  float64 `json:"price"`
	Amount float64 `json:"amount"`
}

// OrderBook is the current book for a market.
type OrderBook struct {
	Symbol       string           `json:"symbol"`
	Bids         []OrderBookLevel `json:"bids"`
	Asks         []OrderBookLevel `json:"asks"`
	LastUpdateID int64            `json:"last_update_id"`
	Timestamp    time.Time        `json:"timestamp"`
}

// Trade is a public trade print.
type Trade struct {
	ID           int64     `json:"id"`
	Price        float64   `json:"price"`
	Qty          float64   `json:"qty"`
	Time         time.Time `json:"time"`
	IsBuyerMaker bool      `json:"is_buyer_maker"`
}

// Kline is a candlestick.
type Kline struct {
	OpenTime time.Time `json:"open_time"`
	Open     float64   `json:"open"`
	High     float64   `json:"high"`
	Low      float64   `json:"low"`
	Close    float64   `json:"close"`
	Volume   float64   `json:"volume"`
}

// PairConfig is the static trading metadata for a market. Prices are never part
// of this struct; a market's price comes from the source.
type PairConfig struct {
	Symbol            string  `json:"symbol"`
	BaseAsset         string  `json:"base_asset"`
	QuoteAsset        string  `json:"quote_asset"`
	Status            string  `json:"status"`
	PricePrecision    int     `json:"price_precision"`
	QuantityPrecision int     `json:"quantity_precision"`
	MinPrice          float64 `json:"min_price"`
	MaxPrice          float64 `json:"max_price"`
	TickSize          float64 `json:"tick_size"`
	MinQuantity       float64 `json:"min_quantity"`
	MaxQuantity       float64 `json:"max_quantity"`
	StepSize          float64 `json:"step_size"`
	MinNotional       float64 `json:"min_notional"`
}

// MarketDataSource is the authoritative market data provider. A real
// implementation reads from the exchange's own matching engine and trade store.
type MarketDataSource interface {
	// Tickers returns the current ticker for every listed market.
	Tickers(ctx context.Context) ([]*PriceTick, error)
	// Ticker returns the current ticker for one market.
	Ticker(ctx context.Context, symbol string) (*PriceTick, error)
	// OrderBook returns the current book for a market, up to limit levels per side.
	OrderBook(ctx context.Context, symbol string, limit int) (*OrderBook, error)
	// Trades returns the most recent public trades, newest first.
	Trades(ctx context.Context, symbol string, limit int) ([]Trade, error)
	// Klines returns candlesticks for a market and interval, oldest first.
	Klines(ctx context.Context, symbol, interval string, limit int) ([]Kline, error)
	// Pairs returns the listed markets and their trading metadata.
	Pairs(ctx context.Context) ([]*PairConfig, error)
}

// PriceFeedService caches market data from a MarketDataSource.
type PriceFeedService struct {
	source MarketDataSource

	mu       sync.RWMutex
	pairs    map[string]*PairConfig
	prices   map[string]*PriceTick
	lastSync time.Time
	lastErr  error

	refreshInterval time.Duration
	stopCh          chan struct{}
	stopOnce        sync.Once
	wg              sync.WaitGroup
}

// NewPriceFeedService creates the service around source. A nil source is
// accepted so callers can construct the service before wiring the source, but
// every data method then fails with ErrSourceUnavailable rather than returning
// invented data.
func NewPriceFeedService(source MarketDataSource) *PriceFeedService {
	return &PriceFeedService{
		source:          source,
		pairs:           make(map[string]*PairConfig),
		prices:          make(map[string]*PriceTick),
		refreshInterval: time.Second,
		stopCh:          make(chan struct{}),
	}
}

// SetSource installs or replaces the market data source.
func (pfs *PriceFeedService) SetSource(source MarketDataSource) {
	pfs.mu.Lock()
	pfs.source = source
	pfs.mu.Unlock()
}

// Start begins periodic cache refreshes from the source.
func (pfs *PriceFeedService) Start() {
	pfs.wg.Add(1)
	go pfs.refreshLoop()
}

// Stop halts the refresh loop. It is safe to call more than once.
func (pfs *PriceFeedService) Stop() {
	pfs.stopOnce.Do(func() { close(pfs.stopCh) })
	pfs.wg.Wait()
}

func (pfs *PriceFeedService) refreshLoop() {
	defer pfs.wg.Done()

	ticker := time.NewTicker(pfs.refreshInterval)
	defer ticker.Stop()

	// Prime the cache so the first request is not a cold miss.
	pfs.refresh(context.Background())

	for {
		select {
		case <-ticker.C:
			pfs.refresh(context.Background())
		case <-pfs.stopCh:
			return
		}
	}
}

// refresh pulls the current tickers and market list into the cache.
func (pfs *PriceFeedService) refresh(ctx context.Context) {
	source := pfs.sourceRef()
	if source == nil {
		pfs.mu.Lock()
		pfs.lastErr = ErrSourceUnavailable
		pfs.mu.Unlock()
		return
	}

	tickers, err := source.Tickers(ctx)
	if err != nil {
		pfs.mu.Lock()
		pfs.lastErr = err
		pfs.mu.Unlock()
		return
	}
	pairs, err := source.Pairs(ctx)
	if err != nil {
		pfs.mu.Lock()
		pfs.lastErr = err
		pfs.mu.Unlock()
		return
	}

	pfs.mu.Lock()
	defer pfs.mu.Unlock()

	pfs.prices = make(map[string]*PriceTick, len(tickers))
	for _, tick := range tickers {
		if tick != nil && tick.Symbol != "" {
			pfs.prices[tick.Symbol] = tick
		}
	}
	pfs.pairs = make(map[string]*PairConfig, len(pairs))
	for _, pair := range pairs {
		if pair != nil && pair.Symbol != "" {
			pfs.pairs[pair.Symbol] = pair
		}
	}
	pfs.lastSync = time.Now()
	pfs.lastErr = nil
}

func (pfs *PriceFeedService) sourceRef() MarketDataSource {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()
	return pfs.source
}

// GetPrice returns the current ticker for symbol, reading through to the source
// on a cache miss.
func (pfs *PriceFeedService) GetPrice(symbol string) (*PriceTick, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("%w: symbol is required", ErrInvalidRequest)
	}

	pfs.mu.RLock()
	tick, ok := pfs.prices[symbol]
	source := pfs.source
	pfs.mu.RUnlock()
	if ok {
		return tick, nil
	}

	if source == nil {
		return nil, ErrSourceUnavailable
	}
	tick, err := source.Ticker(context.Background(), symbol)
	if err != nil {
		return nil, err
	}
	if tick == nil {
		return nil, fmt.Errorf("%w: %s", ErrSymbolNotFound, symbol)
	}

	pfs.mu.Lock()
	pfs.prices[symbol] = tick
	pfs.mu.Unlock()

	return tick, nil
}

// GetAllPrices returns the cached tickers.
func (pfs *PriceFeedService) GetAllPrices() map[string]*PriceTick {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	result := make(map[string]*PriceTick, len(pfs.prices))
	for k, v := range pfs.prices {
		result[k] = v
	}
	return result
}

// GetOrderBook returns the current order book for symbol.
func (pfs *PriceFeedService) GetOrderBook(symbol string) (*OrderBook, error) {
	return pfs.GetOrderBookLimit(symbol, 100)
}

// GetOrderBookLimit returns up to limit levels per side for symbol.
func (pfs *PriceFeedService) GetOrderBookLimit(symbol string, limit int) (*OrderBook, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("%w: symbol is required", ErrInvalidRequest)
	}
	if limit <= 0 {
		return nil, fmt.Errorf("%w: limit must be positive", ErrInvalidRequest)
	}

	source := pfs.sourceRef()
	if source == nil {
		return nil, ErrSourceUnavailable
	}

	book, err := source.OrderBook(context.Background(), symbol, limit)
	if err != nil {
		return nil, err
	}
	if book == nil {
		return nil, fmt.Errorf("%w: %s", ErrSymbolNotFound, symbol)
	}
	return book, nil
}

// GetTrades returns recent public trades for symbol.
func (pfs *PriceFeedService) GetTrades(symbol string, limit int) ([]Trade, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, fmt.Errorf("%w: symbol is required", ErrInvalidRequest)
	}
	if limit <= 0 {
		return nil, fmt.Errorf("%w: limit must be positive", ErrInvalidRequest)
	}

	source := pfs.sourceRef()
	if source == nil {
		return nil, ErrSourceUnavailable
	}
	return source.Trades(context.Background(), symbol, limit)
}

// GetKlines returns candlesticks for symbol and interval.
func (pfs *PriceFeedService) GetKlines(symbol, interval string, limit int) ([]Kline, error) {
	if strings.TrimSpace(symbol) == "" || strings.TrimSpace(interval) == "" {
		return nil, fmt.Errorf("%w: symbol and interval are required", ErrInvalidRequest)
	}
	if limit <= 0 {
		return nil, fmt.Errorf("%w: limit must be positive", ErrInvalidRequest)
	}

	source := pfs.sourceRef()
	if source == nil {
		return nil, ErrSourceUnavailable
	}
	return source.Klines(context.Background(), symbol, interval, limit)
}

// GetTradingPairs returns the listed markets.
func (pfs *PriceFeedService) GetTradingPairs() map[string]*PairConfig {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	result := make(map[string]*PairConfig, len(pfs.pairs))
	for k, v := range pfs.pairs {
		result[k] = v
	}
	return result
}

// ToJSON serialises price data to JSON.
func (pt *PriceTick) ToJSON() (string, error) {
	data, err := json.Marshal(pt)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// FormatPrice formats price according to the symbol's price precision.
func (pfs *PriceFeedService) FormatPrice(symbol string, price float64) string {
	pfs.mu.RLock()
	pair, exists := pfs.pairs[symbol]
	pfs.mu.RUnlock()

	if !exists {
		return fmt.Sprintf("%f", price)
	}
	return fmt.Sprintf("%.*f", pair.PricePrecision, price)
}

// GetMarketSummary returns the cached tickers and an aggregate total.
func (pfs *PriceFeedService) GetMarketSummary() map[string]interface{} {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	summary := make(map[string]interface{})
	totalVolume := 0.0

	for symbol, price := range pfs.prices {
		summary[symbol] = map[string]interface{}{
			"symbol":         symbol,
			"price":          price.Price,
			"change_24h":     price.Change24h,
			"change_pct_24h": price.ChangePct24h,
			"high_24h":       price.High24h,
			"low_24h":        price.Low24h,
			"volume_24h":     price.Volume24h,
			"quote_volume":   price.QuoteVolume,
		}
		totalVolume += price.QuoteVolume
	}

	summary["_meta"] = map[string]interface{}{
		"total_volume_24h": totalVolume,
		"active_pairs":     len(pfs.prices),
		"timestamp":        time.Now().Unix(),
		"last_sync":        pfs.lastSync.Unix(),
	}
	return summary
}

// CalculateVolatility returns the annualised volatility of symbol over window
// klines at the given interval, computed from real candles.
func (pfs *PriceFeedService) CalculateVolatility(symbol, interval string, window int) (float64, error) {
	if strings.TrimSpace(symbol) == "" {
		return 0, fmt.Errorf("%w: symbol is required", ErrInvalidRequest)
	}
	if window < 2 {
		return 0, fmt.Errorf("%w: window must be at least 2", ErrInvalidRequest)
	}

	klines, err := pfs.GetKlines(symbol, interval, window+1)
	if err != nil {
		return 0, err
	}
	if len(klines) < 2 {
		return 0, fmt.Errorf("%w: insufficient klines for volatility", ErrSourceUnavailable)
	}

	returns := make([]float64, 0, len(klines)-1)
	for i := 1; i < len(klines); i++ {
		prev := klines[i-1].Close
		cur := klines[i].Close
		if prev <= 0 || cur <= 0 {
			continue
		}
		returns = append(returns, math.Log(cur/prev))
	}
	if len(returns) == 0 {
		return 0, fmt.Errorf("%w: no usable closes for volatility", ErrSourceUnavailable)
	}

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

	return math.Sqrt(variance) * math.Sqrt(periodsPerYear(interval)) * 100, nil
}

// periodsPerYear converts a kline interval to the number of such intervals in a
// 365 day year. Unknown intervals return 1 so the result stays finite.
func periodsPerYear(interval string) float64 {
	minutes, ok := intervalMinutes[interval]
	if !ok || minutes <= 0 {
		return 1
	}
	return (365 * 24 * 60) / float64(minutes)
}

var intervalMinutes = map[string]int{
	"1m":  1,
	"3m":  3,
	"5m":  5,
	"15m": 15,
	"30m": 30,
	"1h":  60,
	"2h":  120,
	"4h":  240,
	"6h":  360,
	"12h": 720,
	"1d":  1440,
	"1w":  10080,
}

// Healthy reports whether the cache was refreshed successfully and recently.
func (pfs *PriceFeedService) Healthy() bool {
	pfs.mu.RLock()
	defer pfs.mu.RUnlock()

	if pfs.source == nil || pfs.lastErr != nil {
		return false
	}
	return !pfs.lastSync.IsZero() && time.Since(pfs.lastSync) < 10*pfs.refreshInterval
}
