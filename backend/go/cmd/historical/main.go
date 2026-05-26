// Package historical - Historical Data Store
package main

import (
	"fmt"
	"time"
)

type Candle struct {
	Open     float64
	High     float64
	Low      float64
	Close    float64
	Volume   float64
	Time     time.Time
}

type Store struct {
	candles map[string][]Candle
}

func New() *Store {
	return &Store{candles: make(map[string][]Candle)}
}

func (s *Store) Add(symbol string, candle Candle) {
	s.candles[symbol] = append(s.candles[symbol], candle)
}

func (s *Store) Get(symbol string, from, to time.Time) []Candle {
	var result []Candle
	for _, c := range s.candles[symbol] {
		if c.Time.After(from) && c.Time.Before(to) {
			result = append(result, c)
		}
	}
	return result
}

func main() {
	store := New()
	store.Add("BTC", Candle{Open: 50000, High: 51000, Low: 49000, Close: 50000, Volume: 100, Time: time.Now()})
	fmt.Println(store.Get("BTC", time.Time{}, time.Now()))
}