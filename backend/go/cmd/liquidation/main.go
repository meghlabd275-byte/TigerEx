// Package liquidation - Liquidation Service
package main

import (
	"fmt"
	"sync"
	"time"
)

type Position struct {
	ID string `json:"id"`
	UserID string `json:"userId"`
	Symbol string `json:"symbol"`
	Side string `json:"side"`
	EntryPrice float64 `json:"entryPrice"`
	Quantity float64 `json:"quantity"`
	Leverage float64 `json:"leverage"`
	Margin float64 `json:"margin"`
	Liquidated bool `json:"liquidated"`
}

type Liquidation struct {
	ID string `json:"id"`
	PositionID string `json:"positionId"`
	Price float64 `json:"price"`
	Reason string `json:"reason"`
	Remaining float64 `json:"remaining"`
	Time time.Time `json:"time"`
}

type LiquidationService struct {
	mu sync.RWMutex
	positions map[string]*Position
	liquidations map[string]*Liquidation
	counter uint64
}

func NewLiquidationService() *LiquidationService {
	return &LiquidationService{
		positions: make(map[string]*Position),
		liquidations: make(map[string]*Liquidation),
	}
}

func (ls *LiquidationsService) AddPosition(pos *Position) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	ls.positions[pos.ID] = pos
}

func (ls *LiquidationsService) CheckLiquidation(pos *Position, markPrice float64) (bool, float64) {
	var liqPrice float64

	if pos.Side == "long" {
		liqPrice = pos.EntryPrice * (1 - 1.0/pos.Leverage)
	} else {
		liqPrice = pos.EntryPrice * (1 + 1.0/pos.Leverage)
	}

	shouldLiquidate := false
	if pos.Side == "long" && markPrice <= liqPrice {
		shouldLiquidate = true
	} else if pos.Side == "short" && markPrice >= liqPrice {
		shouldLiquidate = true
	}

	return shouldLiquidate, liqPrice
}

func (ls *LiquidationsService) Liquidate(pos *Position, price float64) *Liquidation {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	pos.Liquidated = true
	ls.counter++

	liq := &Liquidation{
		ID: fmt.Sprintf("liq_%d", ls.counter),
		PositionID: pos.ID,
		Price: price,
		Reason: "margin_call",
		Remaining: 0,
		Time: time.Now(),
	}

	ls.liquidations[liq.ID] = liq
	return liq
}

func (ls *LiquidationsService) ProcessLiquidations(markPrices map[string]float64) int {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	count := 0
	for _, pos := range ls.positions {
		if pos.Liquidated {
			continue
		}

		markPrice, ok := markPrices[pos.Symbol]
		if !ok {
			continue
		}

		shouldLiquidate, _ := ls.CheckLiquidation(pos, markPrice)
		if shouldLiquidate {
			ls.Liquidate(pos, markPrice)
			count++
		}
	}

	return count
}

func main() {
	ls := NewLiquidationService()

	pos := &Position{
		ID: "pos_1", UserID: "user1", Symbol: "BTC/USDT",
		Side: "long", EntryPrice: 50000, Quantity: 1,
		Leverage: 10, Margin: 5000,
	}

	ls.AddPosition(pos)

	shouldLiq, liqPrice := ls.CheckLiquidation(pos, 45000)
	fmt.Printf("Should liquidate: %v @ $%.2f\n", shouldLiq, liqPrice)

	count := ls.ProcessLiquidations(map[string]float64{"BTC/USDT": 44000})
	fmt.Printf("Liquidated: %d\n", count)
}