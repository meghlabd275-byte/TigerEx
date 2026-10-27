package pricefeed

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeSource is an in-memory MarketDataSource. It stands in for the exchange's
// real market data service so the service's own behaviour can be tested without
// a network. It returns data, never invents it.
type fakeSource struct {
	tickers []*PriceTick
	pairs   []*PairConfig
	book    *OrderBook
	trades  []Trade
	klines  []Kline
	err     error
}

func (f *fakeSource) Tickers(context.Context) ([]*PriceTick, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.tickers, nil
}

func (f *fakeSource) Ticker(_ context.Context, symbol string) (*PriceTick, error) {
	if f.err != nil {
		return nil, f.err
	}
	for _, t := range f.tickers {
		if t.Symbol == symbol {
			return t, nil
		}
	}
	return nil, ErrSymbolNotFound
}

func (f *fakeSource) OrderBook(_ context.Context, _ string, _ int) (*OrderBook, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.book, nil
}

func (f *fakeSource) Trades(_ context.Context, _ string, _ int) ([]Trade, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.trades, nil
}

func (f *fakeSource) Klines(_ context.Context, _, _ string, _ int) ([]Kline, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.klines, nil
}

func (f *fakeSource) Pairs(context.Context) ([]*PairConfig, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.pairs, nil
}

func sampleSource() *fakeSource {
	now := time.Now()
	return &fakeSource{
		tickers: []*PriceTick{
			{Symbol: "BTC/USDT", Price: 61000, Change24h: 1000, ChangePct24h: 1.66, High24h: 62000, Low24h: 60000, Volume24h: 12, QuoteVolume: 732000, Timestamp: now},
		},
		pairs: []*PairConfig{
			{Symbol: "BTC/USDT", BaseAsset: "BTC", QuoteAsset: "USDT", Status: "TRADING", PricePrecision: 2, TickSize: 0.01, MinQuantity: 0.00001, StepSize: 0.00001, MinNotional: 10},
		},
		book: &OrderBook{
			Symbol:       "BTC/USDT",
			Bids:         []OrderBookLevel{{Price: 60999, Amount: 0.5}},
			Asks:         []OrderBookLevel{{Price: 61001, Amount: 0.4}},
			LastUpdateID: 42,
			Timestamp:    now,
		},
		trades: []Trade{{ID: 7, Price: 61000, Qty: 0.1, Time: now, IsBuyerMaker: true}},
		klines: []Kline{
			{OpenTime: now.Add(-2 * time.Hour), Open: 60000, High: 61000, Low: 59500, Close: 60500, Volume: 10},
			{OpenTime: now.Add(-1 * time.Hour), Open: 60500, High: 61500, Low: 60400, Close: 61000, Volume: 12},
		},
	}
}

func TestNoSourceFailsClosed(t *testing.T) {
	svc := NewPriceFeedService(nil)

	if _, err := svc.GetPrice("BTC/USDT"); !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("GetPrice with no source: want ErrSourceUnavailable, got %v", err)
	}
	if _, err := svc.GetOrderBook("BTC/USDT"); !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("GetOrderBook with no source: want ErrSourceUnavailable, got %v", err)
	}
	if _, err := svc.GetTrades("BTC/USDT", 10); !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("GetTrades with no source: want ErrSourceUnavailable, got %v", err)
	}
	if _, err := svc.GetKlines("BTC/USDT", "1m", 10); !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("GetKlines with no source: want ErrSourceUnavailable, got %v", err)
	}
	if _, err := svc.CalculateVolatility("BTC/USDT", "1h", 10); !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("CalculateVolatility with no source: want ErrSourceUnavailable, got %v", err)
	}
	if len(svc.GetAllPrices()) != 0 {
		t.Fatalf("GetAllPrices with no source: want empty, got %d", len(svc.GetAllPrices()))
	}
	if svc.Healthy() {
		t.Fatal("Healthy with no source: want false")
	}
}

func TestSourceErrorsPropagate(t *testing.T) {
	upstream := errors.New("upstream down")
	svc := NewPriceFeedService(&fakeSource{err: upstream})

	if _, err := svc.GetOrderBook("BTC/USDT"); !errors.Is(err, upstream) {
		t.Fatalf("want upstream error, got %v", err)
	}

	svc.Start()
	defer svc.Stop()
	time.Sleep(50 * time.Millisecond)

	if svc.Healthy() {
		t.Fatal("Healthy with failing source: want false")
	}
}

func TestServesSourceData(t *testing.T) {
	svc := NewPriceFeedService(sampleSource())
	svc.Start()
	defer svc.Stop()
	time.Sleep(50 * time.Millisecond)

	tick, err := svc.GetPrice("BTC/USDT")
	if err != nil {
		t.Fatalf("GetPrice: %v", err)
	}
	if tick.Price != 61000 {
		t.Fatalf("want price 61000, got %v", tick.Price)
	}

	book, err := svc.GetOrderBookLimit("BTC/USDT", 10)
	if err != nil {
		t.Fatalf("GetOrderBookLimit: %v", err)
	}
	if len(book.Bids) != 1 || book.Bids[0].Price != 60999 {
		t.Fatalf("book bids not from source: %+v", book.Bids)
	}

	trades, err := svc.GetTrades("BTC/USDT", 10)
	if err != nil {
		t.Fatalf("GetTrades: %v", err)
	}
	if len(trades) != 1 || trades[0].ID != 7 {
		t.Fatalf("trades not from source: %+v", trades)
	}

	klines, err := svc.GetKlines("BTC/USDT", "1h", 10)
	if err != nil {
		t.Fatalf("GetKlines: %v", err)
	}
	if len(klines) != 2 || klines[1].Close != 61000 {
		t.Fatalf("klines not from source: %+v", klines)
	}

	if !svc.Healthy() {
		t.Fatal("Healthy with working source: want true")
	}
}

func TestVolatilityFromRealKlines(t *testing.T) {
	source := sampleSource()
	// Varying closes give the log-return series non-zero variance.
	source.klines = []Kline{
		{Close: 60000},
		{Close: 61000},
		{Close: 60500},
		{Close: 61500},
	}
	svc := NewPriceFeedService(source)

	vol, err := svc.CalculateVolatility("BTC/USDT", "1h", 4)
	if err != nil {
		t.Fatalf("CalculateVolatility: %v", err)
	}
	if vol <= 0 {
		t.Fatalf("want positive volatility, got %v", vol)
	}

	// A flat series must produce exactly zero volatility.
	source.klines = []Kline{{Close: 61000}, {Close: 61000}, {Close: 61000}}
	vol, err = svc.CalculateVolatility("BTC/USDT", "1h", 3)
	if err != nil {
		t.Fatalf("CalculateVolatility flat: %v", err)
	}
	if vol != 0 {
		t.Fatalf("flat series: want 0 volatility, got %v", vol)
	}
}

func TestInputValidation(t *testing.T) {
	svc := NewPriceFeedService(sampleSource())

	cases := []struct {
		name string
		err  error
	}{
		{"empty symbol price", mustErr(func() error { _, e := svc.GetPrice(""); return e })},
		{"blank symbol book", mustErr(func() error { _, e := svc.GetOrderBookLimit("  ", 10); return e })},
		{"zero limit book", mustErr(func() error { _, e := svc.GetOrderBookLimit("BTC/USDT", 0); return e })},
		{"negative limit trades", mustErr(func() error { _, e := svc.GetTrades("BTC/USDT", -1); return e })},
		{"empty interval klines", mustErr(func() error { _, e := svc.GetKlines("BTC/USDT", "", 10); return e })},
		{"small window volatility", mustErr(func() error { _, e := svc.CalculateVolatility("BTC/USDT", "1h", 1); return e })},
	}

	for _, tc := range cases {
		if !errors.Is(tc.err, ErrInvalidRequest) {
			t.Fatalf("%s: want ErrInvalidRequest, got %v", tc.name, tc.err)
		}
	}
}

func mustErr(f func() error) error { return f() }

func TestHandlersServeSourceData(t *testing.T) {
	svc := NewPriceFeedService(sampleSource())
	svc.Start()
	defer svc.Stop()
	time.Sleep(50 * time.Millisecond)

	handler := NewHandler(svc)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// The price endpoint must return the source's price, not a generated one.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/ticker/price?symbol=BTC/USDT", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("price status %d: %s", rec.Code, rec.Body.String())
	}
	var resp PriceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Success {
		t.Fatalf("price not successful: %s", rec.Body.String())
	}
	data, _ := resp.Data.(map[string]interface{})
	if data["price"].(float64) != 61000 {
		t.Fatalf("want price 61000, got %v", data["price"])
	}

	// A malformed limit is a client error.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/depth?symbol=BTC/USDT&limit=abc", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad limit: want 400, got %d", rec.Code)
	}

	// An unsupported interval is a client error.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/klines?symbol=BTC/USDT&interval=7m", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad interval: want 400, got %d", rec.Code)
	}

	// Health reflects the working source.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health: want 200, got %d", rec.Code)
	}
}

func TestHandlerFailsClosedWithoutSource(t *testing.T) {
	svc := NewPriceFeedService(nil)
	handler := NewHandler(svc)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/ticker/price?symbol=BTC/USDT", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no source: want 503, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("health no source: want 503, got %d", rec.Code)
	}

	// An unknown symbol must be 404, not a generated price.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/orderbook", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing symbol: want 400, got %d", rec.Code)
	}
}

func TestHTTPSourceReadsServiceEnvelope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1/ticker/BTC/USDT":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"data": map[string]interface{}{
					"symbol": "BTC/USDT", "last_price": 61000.0, "price_change": 1000.0,
					"price_change_percent": 1.66, "high_24h": 62000.0, "low_24h": 60000.0,
					"volume_24h": 12.0, "quote_volume_24h": 732000.0,
				},
			})
		case r.URL.Path == "/api/v1/tickers":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"data": []map[string]interface{}{
					{"symbol": "BTC/USDT", "last_price": 61000.0},
				},
			})
		case strings.HasPrefix(r.URL.Path, "/api/v1/orderbook/"):
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"data": map[string]interface{}{
					"symbol":         "BTC/USDT",
					"bids":           []map[string]interface{}{{"price": 60999.0, "quantity": 0.5}},
					"asks":           []map[string]interface{}{{"price": 61001.0, "quantity": 0.4}},
					"last_update_id": 42,
				},
			})
		case r.URL.Path == "/api/v1/symbols":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"data": []map[string]interface{}{
					{"symbol": "BTC/USDT", "base_asset": "BTC", "quote_asset": "USDT", "status": "TRADING", "tick_size": 0.01},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "not found"})
		}
	}))
	defer server.Close()

	source := NewHTTPSource(server.URL)

	tick, err := source.Ticker(context.Background(), "BTC/USDT")
	if err != nil {
		t.Fatalf("Ticker: %v", err)
	}
	if tick.Price != 61000 {
		t.Fatalf("want 61000, got %v", tick.Price)
	}

	book, err := source.OrderBook(context.Background(), "BTC/USDT", 20)
	if err != nil {
		t.Fatalf("OrderBook: %v", err)
	}
	if len(book.Bids) != 1 || book.Bids[0].Price != 60999 {
		t.Fatalf("bad book: %+v", book)
	}
	if book.LastUpdateID != 42 {
		t.Fatalf("want update id 42, got %d", book.LastUpdateID)
	}

	pairs, err := source.Pairs(context.Background())
	if err != nil {
		t.Fatalf("Pairs: %v", err)
	}
	if len(pairs) != 1 || pairs[0].BaseAsset != "BTC" {
		t.Fatalf("bad pairs: %+v", pairs)
	}

	// An unknown symbol upstream maps to ErrSymbolNotFound.
	if _, err := source.Ticker(context.Background(), "NOPE/USDT"); !errors.Is(err, ErrSymbolNotFound) {
		t.Fatalf("want ErrSymbolNotFound, got %v", err)
	}
}

func TestHTTPSourceUnreachableFailsClosed(t *testing.T) {
	source := NewHTTPSource("http://127.0.0.1:1")
	if _, err := source.Ticker(context.Background(), "BTC/USDT"); !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("want ErrSourceUnavailable, got %v", err)
	}
}

func TestStopIsIdempotent(t *testing.T) {
	svc := NewPriceFeedService(sampleSource())
	svc.Start()
	svc.Stop()
	svc.Stop()
}
