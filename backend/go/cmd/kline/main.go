// Package kline - K-Line/Candlestick Generator
package main

import (
	"fmt"
	"time"
)

type Candle struct {
	Open     float64
	High     float64
	Low      float64
	Close   float64
	Volume  float64
	Time    time.Time
}

type Generator struct {
	interval time.Duration
	candles  []Candle
	current  *Candle
}

func New(interval time.Duration) *Generator {
	return &Generator{
		interval: interval,
		current:  &Candle{},
	}
}

func (g *Generator) Add(price, volume float64) {
	now := time.Now()
	
	if g.current.Time.IsZero() || now.Sub(g.current.Time) >= g.interval {
		if !g.current.Time.IsZero() {
			g.candles = append(g.candles, *g.current)
		}
		*g.current = Candle{
			Open:   price,
			High:   price,
			Low:    price,
			Close:  price,
			Volume: volume,
			Time:   now,
		}
	} else {
		if price > g.current.High {
			g.current.High = price
		}
		if price < g.current.Low {
			g.current.Low = price
		}
		g.current.Close = price
		g.current.Volume += volume
	}
}

func (g *Generator) GetAll() []Candle {
	if !g.current.Time.IsZero() {
		return append(g.candles, *g.current)
	}
	return g.candles
}

func main() {
	g := New(time.Minute)
	g.Add(50000, 1.0)
	g.Add(50100, 0.5)
	fmt.Printf("%+v\n", g.GetAll())
}