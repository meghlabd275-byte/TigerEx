package main

import (
	"fmt"
	"time"
)

// Exchange mapping to TigerEx
type Exchange struct {
	ID        string  `json:"id"`
	Name     string  `json:"name"`
	TigerExID string `json:"tigerexId"`
	Type    string  `json:"type"` // spot, futures, derivatives
}

// Market data
type Market struct {
	Symbol    string  `json:"symbol"`
	Bid       float64 `json:"bid"`
	Ask       float64 `json:"ask"`
	Last     float64 `json:"last"`
	Volume24 float64 `json:"volume24"`
}

// CCXT Compatibility layer
type CCXTCompatibility struct {
	Exchanges []*Exchange
	Markets  map[string]*Market
}

// New creates compatibility layer
func NewCCXT() *CCXTCompatibility {
	exchanges := []*Exchange{
		{"binance", "Binance", "spot_futures", "futures"},
		{"coinbase", "Coinbase Advanced", "spot_advanced", "spot"},
		{"kraken", "Kraken Pro", "spot_pro", "spot"},
		{"kucoin", "KuCoin", "spot", "spot"},
		{"bybit", "Bybit", "derivatives", "derivatives"},
		{"okx", "OKX", "okx_integration", "derivatives"},
		{"huobi", "Huobi", "huobi_integration", "spot"},
		{"gateio", "Gate.io", "gate_integration", "spot"},
	}

	return &CCXTCompatibility{
		Exchanges: exchanges,
		Markets: make(map[string]*Market),
	}
}

// Fetch order book
func (c *CCXTCompatibility) FetchOrderBook(symbol string) (*Market, error) {
	// Simulate market data
	market := &Market{
		Symbol:    symbol,
		Bid:       50000.0,
		Ask:       50001.0,
		Last:      50000.5,
		Volume24: 1234.56,
	}

	c.Markets[symbol] = market

	return market, nil
}

// Fetch ticker
func (c *CCXTCompatibility) FetchTicker(symbol string) (*Market, error) {
	market, ok := c.Markets[symbol]
	if ok {
		return market, nil
	}

	return c.FetchOrderBook(symbol)
}

// Fetch trades
func (c *CCXTCompatibility) FetchTrades(symbol string, limit int) ([]map[string]interface{}, error) {
	trades := make([]map[string]interface{}, 0)
	for i := 0; i < limit; i++ {
		trade := map[string]interface{}{
			"id":        fmt.Sprintf("trade_%d", i),
			"timestamp": time.Now().UnixMilli(),
			"side":      "buy",
			"price":     50000.0 + float64(i),
			"amount":    0.1,
		}
		trades = append(trades, trade)
	}

	return trades, nil
}

// Convert exchange
func (c *CCXTCompatibility) Convert(exchangeID string) string {
	for _, ex := range c.Exchanges {
		if ex.ID == exchangeID {
			return ex.TigerExID
		}
	}

	return ""
}

func main() {
	ccxt := NewCCXT()

	// Fetch order book
	market, err := ccxt.FetchOrderBook("BTC/USDT")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("Market: %s - Bid: $%.2f, Ask: $%.2f\n", market.Symbol, market.Bid, market.Ask)

	// Convert exchange
	tigerexID := ccxt.Convert("binance")
	fmt.Printf("Converted: binance -> %s\n", tigerexID)

	// Fetch trades
	trades, _ := ccxt.FetchTrades("BTC/USDT", 3)
	fmt.Printf("Fetched %d trades\n", len(trades))
}