package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// ============================================================================
// TIGEREX ORACLE SERVICE - GO (1 file)
// Price feeds, data aggregation, and external integrations
// ============================================================================

// ============== ORACLE PROVIDER ==============

type OracleProvider struct {
	Name         string  `json:"name"`
	URL          string  `json:"url"`
	Weight      float64 `json:"weight"`
	LastPrice   float64 `json:"last_price"`
	LastUpdate  int64   `json:"last_update"`
	ResponseTime int64  `json:"response_time"`
	Status      string  `json:"status"`
}

type PriceOracle struct {
	mu          sync.RWMutex
	Symbol      string
	Providers   map[string]*OracleProvider
	Aggregated  float64
	Confidence float64
	UpdatedAt  int64
}

func NewPriceOracle(symbol string) *PriceOracle {
	o := &PriceOracle{
		Symbol:    symbol,
		Providers: make(map[string]*OracleProvider),
	}

	// Register default providers
	o.RegisterProvider("binance", "https://api.binance.com/api/v3/ticker/price", 1.0)
	o.RegisterProvider("coinbase", "https://api.coinbase.com/v2/prices/", 1.0)
	o.RegisterProvider("kraken", "https://api.kraken.com/0/public/Ticker", 0.8)

	return o
}

func (o *PriceOracle) RegisterProvider(name, url string, weight float64) {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.Providers[name] = &OracleProvider{
		Name:   name,
		URL:    url,
		Weight: weight,
		Status: "active",
	}
}

// Fetch price from provider (simulated)
func (o *PriceOracle) FetchPrice(provider string) (float64, error) {
	start := time.Now()

	// Simulated prices from different providers
	prices := map[string]float64{
		"binance":  43250 + float64(time.Now().Unix()%1000),
		"coinbase": 43248 + float64(time.Now().Unix()%1000),
		"kraken":  43252 + float64(time.Now().Unix()%1000),
	}

	price, ok := prices[provider]
	if !ok {
		return 0, fmt.Errorf("provider not found")
	}

	responseTime := time.Since(start).Milliseconds()

	o.mu.Lock()
	defer o.mu.Unlock()

	if p, exists := o.Providers[provider]; exists {
		p.LastPrice = price
		p.LastUpdate = time.Now().Unix()
		p.ResponseTime = responseTime
	}

	return price, nil
}

// Aggregate prices using weighted median
func (o *PriceOracle) Aggregate() (float64, float64, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	type priceData struct {
		provider string
		price   float64
		weight float64
	}

	var validPrices []priceData

	for name, provider := range o.Providers {
		if provider.Status != "active" {
			continue
		}

		if provider.LastUpdate == 0 {
			continue
		}

		// Price staleness check (5 minutes)
		if time.Now().Unix()-provider.LastUpdate > 300 {
			continue
		}

		validPrices = append(validPrices, priceData{
			provider: name,
			price:   provider.LastPrice,
			weight: provider.Weight,
		})
	}

	if len(validPrices) == 0 {
		return 0, 0, fmt.Errorf("no valid prices")
	}

	// Sort by price
	sort.Slice(validPrices, func(i, j int) bool {
		return validPrices[i].price < validPrices[j].price
	})

	// Weighted median
	middle := len(validPrices) / 2
	o.Aggregated = validPrices[middle].price

	// Calculate confidence based on provider agreement
	var totalWeight float64
	for _, p := range validWeights {
		totalWeight += p.weight
	}

	o.Confidence = math.Min(totalWeight*100, 100)
	o.UpdatedAt = time.Now().Unix()

	return o.Aggregated, o.Confidence, nil
}

// ============== DATA AGGREGATOR ==============

type DataAggregator struct {
	mu        sync.RWMutex
	Oracles   map[string]*PriceOracle
	Cache     *redis.Client
}

func NewDataAggregator() *DataAggregator {
	a := &DataAggregator{
		Oracles: make(map[string]*PriceOracle),
	}

	// Initialize oracles for major pairs
	pairs := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"}

	for _, pair := range pairs {
		a.Oracles[pair] = NewPriceOracle(pair)
	}

	return a
}

func (a *DataAggregator) GetPrice(symbol string) (float64, float64, error) {
	o, ok := a.Oracles[symbol]
	if !ok {
		return 0, 0, fmt.Errorf("oracle not found for %s", symbol)
	}

	return o.Aggregate()
}

func (a *DataAggregator) GetAllPrices() map[string]map[string]interface{} {
	o.mu.RLock()
	defer o.mu.RUnlock()

	result := make(map[string]map[string]interface{})

	for symbol, oracle := range a.Oracles {
		price, confidence, _ := oracle.Aggregate()

		result[symbol] = map[string]interface{}{
			"symbol":     symbol,
			"price":     price,
			"confidence": confidence,
			"updated":  oracle.UpdatedAt,
		}
	}

	return result
}

// ============== HISTORICAL DATA ==============

type HistoricalPrice struct {
	Symbol    string  `json:"symbol"`
	Open     float64 `json:"open"`
	High     float64 `json:"high"`
	Low      float64 `json:"low"`
	Close    float64 `json:"close"`
	Volume   float64 `json:"volume"`
	Timestamp int64  `json:"timestamp"`
}

type HistoricalData struct {
	mu     sync.RWMutex
	Symbol string
	Data   []HistoricalPrice
}

func NewHistoricalData(symbol string) *HistoricalData {
	return &HistoricalData{
		Symbol: symbol,
		Data:   make([]HistoricalPrice, 0),
	}
}

func (h *HistoricalData) AddPrice(price float64) {
	h.mu.Lock()
	defer h.mu.Unlock()

	ohlc := HistoricalPrice{
		Symbol:    h.Symbol,
		Open:     price,
		High:     price,
		Low:      price,
		Close:    price,
		Volume:  1000000,
		Timestamp: time.Now().Unix(),
	}

	h.Data = append(h.Data, ohlc)

	// Keep last 1000 candles
	if len(h.Data) > 1000 {
		h.Data = h.Data[len(h.Data)-1000:]
	}
}

func (h *HistoricalData) GetOHLC(interval string, limit int) []HistoricalPrice {
	h.mu.RLock()
	defer h.mu.RUnlock()

	start := len(h.Data) - limit
	if start < 0 {
		start = 0
	}

	return h.Data[start:]
}

// ============== PRICE ALERT ==============

type PriceAlert struct {
	ID          string  `json:"id"`
	Symbol     string  `json:"symbol"`
	Condition  string  `json:"condition"` // above, below
	TargetPrice float64 `json:"target_price"`
	UserID     string  `json:"user_id"`
	Triggered  bool    `json:"triggered"`
	CreatedAt  int64   `json:"created_at"`
}

type AlertService struct {
	mu     sync.RWMutex
	Alerts map[string][]*PriceAlert
}

func NewAlertService() *AlertService {
	return &AlertService{
		Alerts: make(map[string][]*PriceAlert),
	}
}

func (s *AlertService) CreateAlert(symbol, condition, userID string, targetPrice float64) *PriceAlert {
	alert := &PriceAlert{
		ID:          fmt.Sprintf("alert_%d", time.Now().UnixNano()),
		Symbol:     symbol,
		Condition:  condition,
		TargetPrice: targetPrice,
		UserID:     userID,
		Triggered:  false,
		CreatedAt:  time.Now().Unix(),
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.Alerts[symbol] = append(s.Alerts[symbol], alert)

	return alert
}

func (s *AlertService) CheckAlerts(symbol string, currentPrice float64) []*PriceAlert {
	s.mu.Lock()
	defer s.mu.Unlock()

	var triggered []*PriceAlert

	for _, alert := range s.Alerts[symbol] {
		if alert.Triggered {
			continue
		}

		shouldTrigger := false
		if alert.Condition == "above" && currentPrice >= alert.TargetPrice {
			shouldTrigger = true
		} else if alert.Condition == "below" && currentPrice <= alert.TargetPrice {
			shouldTrigger = true
		}

		if shouldTrigger {
			alert.Triggered = true
			triggered = append(triggered, alert)
		}
	}

	return triggered
}

// ============== HTTP HANDLERS ==============

func SetupOracleRoutes(r *gin.Engine, aggregator *DataAggregator, alerts *AlertService) {
	api := r.Group("/api/v1/oracle")

	api.GET("/prices", func(c *gin.Context) {
		prices := aggregator.GetAllPrices()
		c.JSON(200, prices)
	})

	api.GET("/prices/:symbol", func(c *gin.Context) {
		symbol := c.Param("symbol")
		price, confidence, err := aggregator.GetPrice(symbol)
		if err != nil {
			c.JSON(404, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"symbol":     symbol,
			"price":     price,
			"confidence": confidence,
		})
	})

	api.GET("/prices/:symbol/history", func(c *gin.Context) {
		symbol := c.Param("symbol")
		interval := c.DefaultQuery("interval", "1h")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))

		hist := NewHistoricalData(symbol)
		ohlc := hist.GetOHLC(interval, limit)

		c.JSON(200, ohlc)
	})

	api.POST("/alerts", func(c *gin.Context) {
		var req struct {
			Symbol     string  `json:"symbol" binding:"required"`
			Condition  string  `json:"condition" binding:"required,oneof=above below"`
			TargetPrice float64 `json:"target_price" binding:"required"`
			UserID     string  `json:"user_id" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		alert := alerts.CreateAlert(req.Symbol, req.Condition, req.UserID, req.TargetPrice)
		c.JSON(201, alert)
	})

	api.GET("/alerts/user/:user_id", func(c *gin.Context) {
		userID := c.Param("user_id")
		var userAlerts []PriceAlert

		for _, alerts := range alerts.Alerts {
			for _, a := range alerts {
				if a.UserID == userID {
					userAlerts = append(userAlerts, *a)
				}
			}
		}

		c.JSON(200, userAlerts)
	})

	api.GET("/providers", func(c *gin.Context) {
		var providers []OracleProvider
		for _, oracle := range aggregator.Oracles {
			for _, p := range oracle.Providers {
				providers = append(providers, *p)
			}
		}

		c.JSON(200, providers)
	})
}

// ============== MAIN ==============

func main() {
	r := gin.Default()

	aggregator := NewDataAggregator()
	alertService := NewAlertService()

	SetupOracleRoutes(r, aggregator, alertService)

	log.Println("Oracle service starting on :8080")
	log.Fatal(r.Run(":8080"))
}