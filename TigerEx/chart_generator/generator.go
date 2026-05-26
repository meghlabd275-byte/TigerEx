package main

import (
	"fmt"
	"time"
)

// ============================================================================
// CHART GENERATOR - Go Implementation
// OHLCV chart generation for TigerEx
// ============================================================================

// Candle represents an OHLCV candle
type Candle struct {
	Open    float64   `json:"open"`
	High    float64   `json:"high"`
	Low     float64   `json:"low"`
	Close   float64   `json:"close"`
	Volume  float64   `json:"volume"`
	Time    int64    `json:"time"`
}

// NewCandle creates a new candle
func NewCandle(open float64, volume float64, timestamp int64) *Candle {
	return &Candle{
		Open:   open,
		High:   open,
		Low:    open,
		Close:  open,
		Volume: volume,
		Time:   timestamp,
	}
}

// ChartGenerator generates OHLCV candles
type ChartGenerator struct {
	interval time.Duration
	candles  []*Candle
	current  *Candle
}

// NewChartGenerator creates a new chart generator
func NewChartGenerator(intervalSec int) *ChartGenerator {
	return &ChartGenerator{
		interval: time.Duration(intervalSec) * time.Second,
		candles:  make([]*Candle, 0),
		current: nil,
	}
}

// Add adds price data
func (cg *ChartGenerator) Add(price, volume float64) {
	now := time.Now().Unix()

	if cg.current == nil || now-cg.current.Time >= int64(cg.interval.Seconds()) {
		if cg.current != nil {
			cg.candles = append(cg.candles, cg.current)
		}
		cg.current = NewCandle(price, volume, now)
	} else {
		// Update current candle
		if price > cg.current.High {
			cg.current.High = price
		}
		if price < cg.current.Low {
			cg.current.Low = price
		}
		cg.current.Close = price
		cg.current.Volume += volume
	}
}

// GetAll returns all candles
func (cg *ChartGenerator) GetAll() []*Candle {
	if cg.current != nil {
		return append(cg.candles, cg.current)
	}
	return cg.candles
}

// GetCandles returns closed candles only
func (cg *ChartGenerator) GetCandles() []*Candle {
	return cg.candles
}

// Count returns number of candles
func (cg *ChartGenerator) Count() int {
	if cg.current != nil {
		return len(cg.candles) + 1
	}
	return len(cg.candles)
}

// LastCandle returns the last candle
func (cg *ChartGenerator) LastCandle() *Candle {
	if cg.current != nil {
		return cg.current
	}
	if len(cg.candles) > 0 {
		return cg.candles[len(cg.candles)-1]
	}
	return nil
}

// Reset clears all candles
func (cg *ChartGenerator) Reset() {
	cg.candles = make([]*Candle, 0)
	cg.current = nil
}

// ============================================================================
// CHART BUILDER
// ============================================================================

// Builder provides fluent chart building
type Builder struct {
	interval int
	symbol  string
}

// NewBuilder creates a new builder
func NewBuilder() *Builder {
	return &Builder{
		interval: 60,
	}
}

// WithInterval sets interval
func (b *Builder) WithInterval(sec int) *Builder {
	b.interval = sec
	return b
}

// WithSymbol sets symbol
func (b *Builder) WithSymbol(sym string) *Builder {
	b.symbol = sym
	return b
}

// Build builds the generator
func (b *Builder) Build() *ChartGenerator {
	return NewChartGenerator(b.interval)
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	cg := NewChartGenerator(60)

	// Add price data
	cg.Add(50000.0, 1.0)
	cg.Add(50100.0, 0.5)
	cg.Add(49900.0, 2.0)
	cg.Add(50200.0, 0.8)

	// Get candles
	candles := cg.GetAll()
	fmt.Printf("Number of candles: %d\n", len(candles))

	for i, c := range candles {
		fmt.Printf("Candle %d: O=%.2f H=%.2f L=%.2f C=%.2f V=%.2f\n",
			i, c.Open, c.High, c.Low, c.Close, c.Volume)
	}

	// Get last candle
	last := cg.LastCandle()
	if last != nil {
		fmt.Printf("Last: %.2f\n", last.Close)
	}

	// Use builder
	gen := NewBuilder().WithInterval(300).Build()
	gen.Add(100.0, 10.0)
	fmt.Printf("5min candles: %d\n", gen.Count())
}