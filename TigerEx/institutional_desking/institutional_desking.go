package main

import (
	"fmt"
	"time"
)

// Impact level
type ImpactLevel string

const (
	ImpactHigh ImpactLevel = "high"
	ImpactMedium ImpactLevel = "medium"
	ImpactLow ImpactLevel = "low"
)

// News item
type NewsItem struct {
	Headline string     `json:"headline"`
	Source   string     `json:"source"`
	Time     int64       `json:"time"`
	Impact   ImpactLevel `json:"impact"`
	Symbols  []string   `json:"symbols,omitempty"`
}

// Economic event
type EconEvent struct {
	Event    string  `json:"event"`
	Date     int64   `json:"date"`
	Forecast float64 `json:"forecast"`
	Actual   float64 `json:"actual"`
}

// Technical analysis
type TechAnalysis struct {
	RSI   float64 `json:"rsi"`
	MACD  string  `json:"macd"`
	Trend string  `json:"trend"`
	SMA20 float64 `json:"sma20"`
	SMA50 float64 `json:"sma50"`
}

// Screener result
type ScreenerResult struct {
	Symbol string  `json:"symbol"`
	Score  float64 `json:"score"`
}

// Terminal data
type TerminalData struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Change    float64 `json:"change"`
	Volume    float64 `json:"volume"`
	DayHigh   float64 `json:"dayHigh"`
	DayLow    float64 `json:"dayLow"`
}

// Institutional desk
type InstitutionalDesk struct {
	News   map[string]*NewsItem
	Economics map[string]*EconEvent
	ScreenerHistory []ScreenerResult
}

// New creates desk
func NewInstitutionalDesk() *InstitutionalDesk {
	return &InstitutionalDesk{
		News: make(map[string]*NewsItem),
		Economics: make(map[string]*EconEvent),
	}
}

// Get terminal data
func (d *InstitutionalDesk) GetTerminalData(symbol string) *TerminalData {
	return &TerminalData{
		Symbol: symbol,
		Price: 50000,
		Change: 2.5,
		Volume: 1000000,
		DayHigh: 51000,
		DayLow: 49000,
	}
}

// Technical analysis
func (d *InstitutionalDesk) GetTechnicalAnalysis(symbol string) *TechAnalysis {
	return &TechAnalysis{
		RSI: 65,
		MACD: "bullish",
		Trend: "uptrend",
		SMA20: 48500,
		SMA50: 47000,
	}
}

// Run screener
func (d *InstitutionalDesk) RunScreener(minVolume float64, sector string) []*ScreenerResult {
	// Simplified screening
	results := []*ScreenerResult{
		{Symbol: "BTC/USDT", Score: 85},
		{Symbol: "ETH/USDT", Score: 78},
		{Symbol: "SOL/USDT", Score: 72},
	}
	
	var filtered []*ScreenerResult
	for _, r := range results {
		if r.Score > 70 {
			filtered = append(filtered, r)
		}
	}
	
	d.ScreenerHistory = append(d.ScreenerHistory, filtered...)
	return filtered
}

// Add news
func (d *InstitutionalDesk) AddNews(headline, source string, impact ImpactLevel, symbols []string) {
	id := fmt.Sprintf("news_%d", time.Now().UnixNano())
	d.News[id] = &NewsItem{
		Headline: headline,
		Source: source,
		Time: time.Now().UnixMilli(),
		Impact: impact,
		Symbols: symbols,
	}
}

func main() {
	desk := NewInstitutionalDesk()
	
	// Terminal data
	data := desk.GetTerminalData("BTC/USDT")
	fmt.Printf("Price: %.2f, Change: %.2f%%\n", data.Price, data.Change)
	
	// Technical analysis
	tech := desk.GetTechnicalAnalysis("BTC/USDT")
	fmt.Printf("RSI: %.0f, Trend: %s\n", tech.RSI, tech.Trend)
	
	// Screener
	results := desk.RunScreener(1000000, "crypto")
	fmt.Printf("Matches: %d\n", len(results))
}