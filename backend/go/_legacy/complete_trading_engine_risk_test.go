package legacy

import (
	"strings"
	"testing"
)

func newRiskTestEngine(asks, bids PriceLevels) *MatchingEngine {
	state := &MarketState{
		Symbol: "BTCUSDT",
		OrderBook: &OrderBook{
			Symbol: "BTCUSDT",
			Asks:   asks,
			Bids:   bids,
		},
	}
	engine := &MatchingEngine{
		markets:       map[string]*MarketState{"BTCUSDT": state},
		orders:        make(map[string]*Order),
		userOrders:    make(map[string]map[string]*Order),
		userPositions: make(map[string]map[string]*Position),
		positions:     make(map[string]*Position),
	}
	engine.riskManager = NewRiskManager(engine)
	return engine
}

func TestMarketOrderRiskUsesExecutableDepthNotClientPrice(t *testing.T) {
	engine := newRiskTestEngine(
		PriceLevels{
			&PriceLevel{Price: 2000, Quantity: 1000},
		},
		PriceLevels{
			&PriceLevel{Price: 1990, Quantity: 1000},
		},
	)
	order := &Order{
		UserID:   "user-1",
		Symbol:   "BTCUSDT",
		Side:     OrderSideBuy,
		Type:     OrderTypeMarket,
		Price:    0, // Market orders have no trusted client-supplied price.
		Quantity: 1000,
	}
	err := engine.riskManager.checkOrderRisk(order)
	if err == nil || !strings.Contains(err.Error(), "order value exceeds maximum") {
		t.Fatalf("expected market order notional limit rejection, got %v", err)
	}
}

func TestMarketOrderRiskFailsClosedWhenDepthIsInsufficient(t *testing.T) {
	engine := newRiskTestEngine(
		PriceLevels{
			&PriceLevel{Price: 100, Quantity: 2},
		},
		nil,
	)
	order := &Order{
		UserID:   "user-1",
		Symbol:   "BTCUSDT",
		Side:     OrderSideBuy,
		Type:     OrderTypeMarket,
		Quantity: 3,
	}
	err := engine.riskManager.checkOrderRisk(order)
	if err == nil || !strings.Contains(err.Error(), "insufficient book depth") {
		t.Fatalf("expected fail-closed depth rejection, got %v", err)
	}
}

func TestMarketOrderRiskAcceptsWithinNotionalLimit(t *testing.T) {
	engine := newRiskTestEngine(
		PriceLevels{
			&PriceLevel{Price: 100, Quantity: 10},
		},
		PriceLevels{
			&PriceLevel{Price: 99, Quantity: 10},
		},
	)
	order := &Order{
		UserID:   "user-1",
		Symbol:   "BTCUSDT",
		Side:     OrderSideBuy,
		Type:     OrderTypeMarket,
		Quantity: 10,
	}
	if err := engine.riskManager.checkOrderRisk(order); err != nil {
		t.Fatalf("expected order within notional limit to pass, got %v", err)
	}
}
