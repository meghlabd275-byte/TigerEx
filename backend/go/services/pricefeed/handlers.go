// Price Feed HTTP Handlers
//
// REST handlers over PriceFeedService. Every handler reads from the service,
// which reads from the configured MarketDataSource. Nothing is generated here.
//
// The previous version synthesised trades by pairing the fake order book's own
// bids and asks, aggregated klines from the fabricated random-walk price
// history, and advertised "status": "TRADING" for every configured symbol
// regardless of whether a market data source existed.
package pricefeed

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// Handler wraps PriceFeedService for HTTP handling.
type Handler struct {
	service *PriceFeedService
}

// NewHandler creates a new price feed handler.
func NewHandler(service *PriceFeedService) *Handler {
	return &Handler{service: service}
}

// PriceResponse is the API envelope.
type PriceResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// writeError maps a service error to an HTTP status and writes the envelope.
// Client mistakes are 400, unknown symbols are 404, and a missing upstream is
// 503 so clients can distinguish "no such market" from "try again later".
func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrInvalidRequest):
		status = http.StatusBadRequest
	case errors.Is(err, ErrSymbolNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrSourceUnavailable):
		status = http.StatusServiceUnavailable
	}

	w.WriteHeader(status)
	json.NewEncoder(w).Encode(PriceResponse{Success: false, Error: err.Error()})
}

func writeData(w http.ResponseWriter, data interface{}) {
	json.NewEncoder(w).Encode(PriceResponse{Success: true, Data: data})
}

// parseLimit reads a positive integer query parameter, clamped to max.
func parseLimit(r *http.Request, name string, def, max int) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return def, nil
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%w: %s must be a positive integer", ErrInvalidRequest, name)
	}
	if parsed > max {
		parsed = max
	}
	return parsed, nil
}

// Ticker24hrHandler returns the 24 hour ticker.
func (h *Handler) Ticker24hrHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeData(w, h.service.GetAllPrices())
		return
	}

	price, err := h.service.GetPrice(symbol)
	if err != nil {
		writeError(w, err)
		return
	}
	writeData(w, price)
}

// PriceHandler returns the current price for a symbol.
func (h *Handler) PriceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, fmt.Errorf("%w: symbol parameter required", ErrInvalidRequest))
		return
	}

	price, err := h.service.GetPrice(symbol)
	if err != nil {
		writeError(w, err)
		return
	}

	writeData(w, map[string]interface{}{
		"symbol": price.Symbol,
		"price":  price.Price,
	})
}

// OrderBookHandler returns the order book for a symbol.
func (h *Handler) OrderBookHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, fmt.Errorf("%w: symbol parameter required", ErrInvalidRequest))
		return
	}

	limit, err := parseLimit(r, "limit", 20, 100)
	if err != nil {
		writeError(w, err)
		return
	}

	book, err := h.service.GetOrderBookLimit(symbol, limit)
	if err != nil {
		writeError(w, err)
		return
	}

	// Trim a copy so the cached book is never mutated by a request.
	trimmed := *book
	if len(trimmed.Bids) > limit {
		trimmed.Bids = append([]OrderBookLevel(nil), trimmed.Bids[:limit]...)
	}
	if len(trimmed.Asks) > limit {
		trimmed.Asks = append([]OrderBookLevel(nil), trimmed.Asks[:limit]...)
	}

	writeData(w, &trimmed)
}

// KlinesHandler returns candlestick data.
func (h *Handler) KlinesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, fmt.Errorf("%w: symbol parameter required", ErrInvalidRequest))
		return
	}

	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1m"
	}
	if _, ok := intervalMinutes[interval]; !ok {
		writeError(w, fmt.Errorf("%w: unsupported interval %q", ErrInvalidRequest, interval))
		return
	}

	limit, err := parseLimit(r, "limit", 100, 1000)
	if err != nil {
		writeError(w, err)
		return
	}

	klines, err := h.service.GetKlines(symbol, interval, limit)
	if err != nil {
		writeError(w, err)
		return
	}

	rows := make([][]interface{}, 0, len(klines))
	for _, k := range klines {
		rows = append(rows, []interface{}{
			k.OpenTime.UnixMilli(),
			k.Open,
			k.High,
			k.Low,
			k.Close,
			k.Volume,
		})
	}

	writeData(w, rows)
}

// TradesHandler returns recent public trades.
func (h *Handler) TradesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, fmt.Errorf("%w: symbol parameter required", ErrInvalidRequest))
		return
	}

	limit, err := parseLimit(r, "limit", 50, 1000)
	if err != nil {
		writeError(w, err)
		return
	}

	trades, err := h.service.GetTrades(symbol, limit)
	if err != nil {
		writeError(w, err)
		return
	}

	rows := make([]map[string]interface{}, 0, len(trades))
	for _, t := range trades {
		rows = append(rows, map[string]interface{}{
			"id":             t.ID,
			"price":          t.Price,
			"qty":            t.Qty,
			"time":           t.Time.UnixMilli(),
			"is_buyer_maker": t.IsBuyerMaker,
		})
	}

	writeData(w, rows)
}

// DepthHandler returns market depth as price/amount string pairs.
func (h *Handler) DepthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, fmt.Errorf("%w: symbol parameter required", ErrInvalidRequest))
		return
	}

	limit, err := parseLimit(r, "limit", 100, 5000)
	if err != nil {
		writeError(w, err)
		return
	}

	book, err := h.service.GetOrderBookLimit(symbol, limit)
	if err != nil {
		writeError(w, err)
		return
	}

	bids := make([][]string, 0, len(book.Bids))
	for _, b := range book.Bids {
		bids = append(bids, []string{
			strconv.FormatFloat(b.Price, 'f', -1, 64),
			strconv.FormatFloat(b.Amount, 'f', -1, 64),
		})
	}
	asks := make([][]string, 0, len(book.Asks))
	for _, a := range book.Asks {
		asks = append(asks, []string{
			strconv.FormatFloat(a.Price, 'f', -1, 64),
			strconv.FormatFloat(a.Amount, 'f', -1, 64),
		})
	}

	writeData(w, map[string]interface{}{
		"lastUpdateId": book.LastUpdateID,
		"bids":         bids,
		"asks":         asks,
	})
}

// ExchangeInfoHandler returns exchange configuration and listed markets.
func (h *Handler) ExchangeInfoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pairs := h.service.GetTradingPairs()

	symbols := make([]map[string]interface{}, 0, len(pairs))
	for _, pair := range pairs {
		status := pair.Status
		if status == "" {
			status = "TRADING"
		}
		symbols = append(symbols, map[string]interface{}{
			"symbol":                 pair.Symbol,
			"status":                 status,
			"baseAsset":              pair.BaseAsset,
			"baseAssetPrecision":     8,
			"quoteAsset":             pair.QuoteAsset,
			"quotePrecision":         pair.PricePrecision,
			"quoteAssetPrecision":    8,
			"orderTypes":             []string{"LIMIT", "MARKET", "STOP_LOSS", "TAKE_PROFIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT", "LIMIT_MAKER"},
			"icebergAllowed":         true,
			"ocoAllowed":             true,
			"isSpotTradingAllowed":   true,
			"isMarginTradingAllowed": false,
			"filters": []map[string]interface{}{
				{
					"filterType": "PRICE_FILTER",
					"minPrice":   strconv.FormatFloat(pair.MinPrice, 'f', -1, 64),
					"maxPrice":   strconv.FormatFloat(pair.MaxPrice, 'f', -1, 64),
					"tickSize":   strconv.FormatFloat(pair.TickSize, 'f', -1, 64),
				},
				{
					"filterType": "LOT_SIZE",
					"minQty":     strconv.FormatFloat(pair.MinQuantity, 'f', -1, 64),
					"maxQty":     strconv.FormatFloat(pair.MaxQuantity, 'f', -1, 64),
					"stepSize":   strconv.FormatFloat(pair.StepSize, 'f', -1, 64),
				},
				{
					"filterType":  "MIN_NOTIONAL",
					"minNotional": strconv.FormatFloat(pair.MinNotional, 'f', -1, 64),
				},
			},
		})
	}

	exchangeStatus := "ok"
	if !h.service.Healthy() {
		exchangeStatus = "degraded"
	}

	writeData(w, map[string]interface{}{
		"timezone":        "UTC",
		"serverTime":      time.Now().UnixMilli(),
		"exchangeStatus":  exchangeStatus,
		"rateLimits":      []map[string]interface{}{},
		"exchangeFilters": []interface{}{},
		"symbols":         symbols,
	})
}

// MarketSummaryHandler returns the market summary.
func (h *Handler) MarketSummaryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	writeData(w, h.service.GetMarketSummary())
}

// VolatilityHandler returns annualised volatility for a symbol.
func (h *Handler) VolatilityHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		writeError(w, fmt.Errorf("%w: symbol parameter required", ErrInvalidRequest))
		return
	}

	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1h"
	}
	if _, ok := intervalMinutes[interval]; !ok {
		writeError(w, fmt.Errorf("%w: unsupported interval %q", ErrInvalidRequest, interval))
		return
	}

	window, err := parseLimit(r, "window", 100, 1000)
	if err != nil {
		writeError(w, err)
		return
	}
	if window < 2 {
		writeError(w, fmt.Errorf("%w: window must be at least 2", ErrInvalidRequest))
		return
	}

	volatility, err := h.service.CalculateVolatility(symbol, interval, window)
	if err != nil {
		writeError(w, err)
		return
	}

	writeData(w, map[string]interface{}{
		"symbol":           symbol,
		"interval":         interval,
		"volatility_pct":   volatility,
		"window":           window,
		"calculation_time": time.Now().Unix(),
	})
}

// HealthHandler reports whether the service is serving real market data.
func (h *Handler) HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	healthy := h.service.Healthy()
	status := "healthy"
	if !healthy {
		status = "degraded"
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  status,
		"service": "pricefeed",
	})
}

// RegisterRoutes registers all price feed routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/ticker/24hr", h.Ticker24hrHandler)
	mux.HandleFunc("/api/v1/ticker/price", h.PriceHandler)
	mux.HandleFunc("/api/v1/depth", h.DepthHandler)
	mux.HandleFunc("/api/v1/trades", h.TradesHandler)
	mux.HandleFunc("/api/v1/klines", h.KlinesHandler)
	mux.HandleFunc("/api/v1/orderbook", h.OrderBookHandler)
	mux.HandleFunc("/api/v1/exchangeInfo", h.ExchangeInfoHandler)
	mux.HandleFunc("/api/v1/market/summary", h.MarketSummaryHandler)
	mux.HandleFunc("/api/v1/market/volatility", h.VolatilityHandler)
	mux.HandleFunc("/health", h.HealthHandler)
}
