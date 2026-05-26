// Package arbitrage - Cross-Exchange Arbitrage Engine
package main

import (
	"fmt"
	"math"
	"time"
)

type PricePair struct {
	Symbol    string
	Bid      float64  // Buy price
	Ask      float64 // Sell price
	Exchange string
}

type Opportunity struct {
	Symbol      string
	BuyExchange string
	SellExchange string
	BuyPrice   float64
	SellPrice  float64
	Profit     float64
	Quantity  float64
	Timestamp time.Time
}

type Scanner struct {
	minProfit float64
}

func New(minProfit float64) *Scanner {
	return &Scanner{minProfit: minProfit}
}

func (s *Scanner) Scan(pairs []PricePair) []Opportunity {
	opps := make([]Opportunity, 0)
	
	// Group by symbol
	symbolMap := make(map[string][]PricePair)
	for _, p := range pairs {
		symbolMap[p.Symbol] = append(symbolMap[p.Symbol], p)
	}
	
	for symbol, exchanges := range symbolMap {
		for i, buy := range exchanges {
			for j, sell := range exchanges {
				if i == j {
					continue
				}
				
				profit := sell.Ask - buy.Bid
				if profit > s.minProfit {
					opps = append(opps, Opportunity{
						Symbol:      symbol,
						BuyExchange: buy.Exchange,
						SellExchange: sell.Exchange,
						BuyPrice:    buy.Bid,
						SellPrice:  sell.Ask,
						Profit:     profit,
						Quantity:   0,
						Timestamp:  time.Now(),
					})
				}
			}
		}
	}
	
	return opps
}

func calculateProfit(buyPrice, sellPrice, quantity float64) float64 {
	return (sellPrice - buyPrice) * quantity
}

func main() {
	scanner := New(0.5)
	pairs := []PricePair{
		{"BTC/USDT", 50000, 50100, "binance"},
		{"BTC/USDT", 50050, 50150, "coinbase"},
		{"BTC/USDT", 50025, 50075, "bybit"},
	}
	
	opps := scanner.Scan(pairs)
	fmt.Printf("Found %d opportunities\n", len(opps))
	for _, o := range opps {
		fmt.Printf("%s: %.2f profit\n", o.Symbol, o.Profit)
	}
}