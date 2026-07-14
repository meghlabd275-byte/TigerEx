// Price Feed HTTP Handlers
// REST API handlers for price feed service

package pricefeed

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"
)

// Handler wraps PriceFeedService for HTTP handling
type Handler struct {
	service *PriceFeedService
}

// NewHandler creates a new price feed handler
func NewHandler(service *PriceFeedService) *Handler {
	return &Handler{service: service}
}

// PriceResponse represents API response for price data
type PriceResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// Ticker24hrHandler returns 24-hour price ticker
func (h *Handler) Ticker24hrHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")

	var response interface{}

	if symbol != "" {
		price, err := h.service.GetPrice(symbol)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(PriceResponse{
				Success: false,
				Error:   err.Error(),
			})
			return
		}
		response = price
	} else {
		response = h.service.GetAllPrices()
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data:    response,
	})
}

// PriceHandler returns current price for a symbol
func (h *Handler) PriceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   "symbol parameter required",
		})
		return
	}

	price, err := h.service.GetPrice(symbol)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data: map[string]interface{}{
			"symbol": price.Symbol,
			"price":  price.Price,
		},
	})
}

// OrderBookHandler returns order book for a symbol
func (h *Handler) OrderBookHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   "symbol parameter required",
		})
		return
	}

	ob, err := h.service.GetOrderBook(symbol)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
			if limit > 100 {
				limit = 100
			}
		}
	}

	// Limit the response
	if len(ob.Bids) > limit {
		ob.Bids = ob.Bids[:limit]
	}
	if len(ob.Asks) > limit {
		ob.Asks = ob.Asks[:limit]
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data:    ob,
	})
}

// KlinesHandler returns kline/candlestick data
func (h *Handler) KlinesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   "symbol parameter required",
		})
		return
	}

	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1m"
	}

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
			if limit > 1000 {
				limit = 1000
			}
		}
	}

	// Get historical prices
	history, err := h.service.GetPriceHistory(symbol, limit*60) // Get more for aggregation
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	// Aggregate into klines based on interval
	var klines [][]interface{}
	intervalSeconds := map[string]int{
		"1m":  60,
		"5m":  300,
		"15m": 900,
		"1h":  3600,
		"4h":  14400,
		"1d":  86400,
	}

	seconds, ok := intervalSeconds[interval]
	if !ok {
		seconds = 60
	}

	// Aggregate prices into klines
	var currentKline []float64
	for i, tick := range history {
		timestamp := float64(tick.Timestamp.Unix()) / float64(seconds)
		currentTimestamp := float64(tick.Timestamp.Unix()) / float64(seconds)

		if i == 0 || int(timestamp) != int(currentTimestamp) {
			if currentKline != nil {
				klines = append(klines, []interface{}{
					int64(currentKline[0]), // Open time
					currentKline[1],        // Open
					currentKline[2],        // High
					currentKline[3],        // Low
					currentKline[4],        // Close
					currentKline[5],        // Volume
				})
			}
			currentKline = []float64{
				float64(tick.Timestamp.Unix() * 1000), // Open time (ms)
				tick.Price,  // Open
				tick.Price,  // High
				tick.Price,  // Low
				tick.Price,  // Close
				tick.Volume24h / float64(len(history)), // Approximate volume
			}
		} else {
			// Update high, low, close, volume
			if tick.Price > currentKline[2] {
				currentKline[2] = tick.Price
			}
			if tick.Price < currentKline[3] {
				currentKline[3] = tick.Price
			}
			currentKline[4] = tick.Price
			currentKline[5] += tick.Volume24h / float64(len(history))
		}
	}

	// Add last kline
	if currentKline != nil {
		klines = append(klines, []interface{}{
			int64(currentKline[0]),
			currentKline[1],
			currentKline[2],
			currentKline[3],
			currentKline[4],
			currentKline[5],
		})
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data:    klines,
	})
}

// TradesHandler returns recent trades
func (h *Handler) TradesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   "symbol parameter required",
		})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
			if limit > 1000 {
				limit = 1000
			}
		}
	}

	// Generate synthetic trades from order book
	ob, err := h.service.GetOrderBook(symbol)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	var trades []map[string]interface{}
	baseTime := time.Now().Unix() * 1000

	for i := 0; i < limit && i < len(ob.Bids); i++ {
		isBuy := i%2 == 0
		price := ob.Bids[i].Price
		if !isBuy && i < len(ob.Asks) {
			price = ob.Asks[i].Price
		}

		trades = append(trades, map[string]interface{}{
			"id":           baseTime + int64(i),
			"price":        price,
			"qty":          ob.Bids[i].Amount,
			"time":         baseTime - int64(i*1000),
			"is_buyer_maker": isBuy,
		})
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data:    trades,
	})
}

// DepthHandler returns market depth
func (h *Handler) DepthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   "symbol parameter required",
		})
		return
	}

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
			if limit > 5000 {
				limit = 5000
			}
		}
	}

	ob, err := h.service.GetOrderBook(symbol)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	// Limit and format
	if len(ob.Bids) > limit {
		ob.Bids = ob.Bids[:limit]
	}
	if len(ob.Asks) > limit {
		ob.Asks = ob.Asks[:limit]
	}

	bids := make([][]string, len(ob.Bids))
	asks := make([][]string, len(ob.Asks))

	for i, b := range ob.Bids {
		bids[i] = []string{
			fmt.Sprintf("%.8f", b.Price),
			fmt.Sprintf("%.8f", b.Amount),
		}
	}
	for i, a := range ob.Asks {
		asks[i] = []string{
			fmt.Sprintf("%.8f", a.Price),
			fmt.Sprintf("%.8f", a.Amount),
		}
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data: map[string]interface{}{
			"lastUpdateId": ob.LastUpdateID,
			"bids":        bids,
			"asks":        asks,
		},
	})
}

// ExchangeInfoHandler returns exchange configuration
func (h *Handler) ExchangeInfoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pairs := h.service.GetTradingPairs()

	rates := map[string]interface{}{
		"symbol":           "USDT",
		"pid":              1,
		"bidPrice":         "1.00000000",
		"bidQty":           "10000.00000000",
		"askPrice":         "1.00000000",
		"askQty":           "10000.00000000",
	}

	var symbols []map[string]interface{}
	for _, pair := range pairs {
		symbols = append(symbols, map[string]interface{}{
			"symbol":                pair.Symbol,
			"status":                "TRADING",
			"baseAsset":             pair.BaseAsset,
			"baseAssetPrecision":    8,
			"quoteAsset":            pair.QuoteAsset,
			"quotePrecision":        pair.PricePrecision,
			"quoteAssetPrecision":   8,
			"orderTypes":           []string{"LIMIT", "MARKET", "STOP_LOSS", "TAKE_PROFIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT", "LIMIT_MAKER"},
			"icebergAllowed":        true,
			"ocoAllowed":            true,
			"isSpotTradingAllowed":  true,
			"isMarginTradingAllowed": false,
			"filters": []map[string]interface{}{
				{
					"filterType": "PRICE_FILTER",
					"minPrice":   fmt.Sprintf("%f", pair.MinPrice),
					"maxPrice":   fmt.Sprintf("%f", pair.MaxPrice),
					"tickSize":   fmt.Sprintf("%f", mathPow10(pair.PricePrecision)),
				},
				{
					"filterType": "LOT_SIZE",
					"minQty":     fmt.Sprintf("%f", pair.MinQuantity),
					"maxQty":     fmt.Sprintf("%f", pair.MaxQuantity),
					"stepSize":   fmt.Sprintf("%f", mathPow10(pair.QuantityPrecision)),
				},
				{
					"filterType": "MIN_NOTIONAL",
					"minNotional": "10",
				},
			},
		})
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data: map[string]interface{}{
			"timezone":        "UTC",
			"serverTime":      time.Now().Unix() * 1000,
			"rateLimits":      []map[string]interface{}{},
			"exchangeFilters": []interface{}{},
			"symbols":         symbols,
		},
	})
}

func mathPow10(n int) float64 {
	result := 1.0
	for i := 0; i < n; i++ {
		result *= 10
	}
	return result
}

// MarketSummaryHandler returns overall market summary
func (h *Handler) MarketSummaryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	summary := h.service.GetMarketSummary()

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data:    summary,
	})
}

// VolatilityHandler returns volatility data for a symbol
func (h *Handler) VolatilityHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   "symbol parameter required",
		})
		return
	}

	window := 100
	if w := r.URL.Query().Get("window"); w != "" {
		if parsed, err := strconv.Atoi(w); err == nil {
			window = parsed
		}
	}

	volatility, err := h.service.CalculateVolatility(symbol, window)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(PriceResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(PriceResponse{
		Success: true,
		Data: map[string]interface{}{
			"symbol":           symbol,
			"volatility_pct":   volatility,
			"window":           window,
			"calculation_time": time.Now().Unix(),
		},
	})
}

// RegisterRoutes registers all price feed routes
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
}
