// Package dark_pool provides dark pool trading services.
// Anonymous large block trades.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Dark Pool Order (hidden from public orderbook)
type DarkOrder struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Symbol  string  `json:"symbol"`
	Side    string  `json:"side"` // bid, ask
	Quantity float64 `json:"quantity"`
	LimitPrice float64 `json:"limitPrice"`
	Iceberg   bool    `json:"iceberg"` // show only displayed size
	DisplaySize float64 `json:"displaySize"`
	Status    string  `json:"status"` // pending, partially_filled, filled, cancelled
	Filled   float64 `json:"filled"`
}

// Dark Pool Match
type DarkMatch struct {
	ID        string  `json:"id"`
	BuyOrderID string  `json:"buyOrderId"`
	SellOrderID string `json:"sellOrderId"`
	Quantity float64 `json:"quantity"`
	Price    float64 `json:"price"`
	Time     int64   `json:"time"`
}

// Store
type DPStore struct {
	mu      sync.RWMutex
	orders  map[string]*DarkOrder
	matches map[string]*DarkMatch
}

var dpStore = &DPStore{
	orders: make(map[string]*DarkOrder),
	matches: make(map[string]*DarkMatch),
}

// Submit dark order
func SubmitDarkOrder(userID, symbol, side string, qty, price float64, iceberg bool, display float64) *DarkOrder {
	order := &DarkOrder{
		ID: fmt.Sprintf("dark_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Quantity: qty,
		LimitPrice: price,
		Iceberg: iceberg,
		DisplaySize: display,
		Status: "pending",
		Filled: 0,
	}

	dpStore.mu.Lock()
	dpStore.orders[order.ID] = order
	dpStore.mu.Unlock()

	return order
}

// Match dark orders (cross internal)
func MatchDarkOrders(symbol string) []*DarkMatch {
	dpStore.mu.RLock()

	var bids []*DarkOrder
	var asks []*DarkOrder

	for _, o := range dpStore.orders {
		if o.Symbol == symbol && o.Status != "filled" && o.Status != "cancelled" {
			if o.Side == "bid" {
				bids = append(bids, o)
			} else {
				asks = append(asks, o)
			}
		}
	}

	dpStore.mu.RUnlock()

	var matches []*DarkMatch

	for _, bid := range bids {
		for _, ask := range asks {
			if bid.LimitPrice >= ask.LimitPrice {
				qty := min(bid.Quantity-bid.Filled, ask.Quantity-ask.Filled)

				match := &DarkMatch{
					ID: fmt.Sprintf("dm_%d", time.Now().UnixNano()),
					BuyOrderID: bid.ID,
					SellOrderID: ask.ID,
					Quantity: qty,
					Price: (bid.LimitPrice + ask.LimitPrice) / 2,
					Time: time.Now().UnixMilli(),
				}

				matches = append(matches, match)

				// Update orders
				dpStore.mu.Lock()
				bid.Filled += qty
				ask.Filled += qty

				if bid.Filled >= bid.Quantity {
					bid.Status = "filled"
				} else {
					bid.Status = "partially_filled"
				}

				if ask.Filled >= ask.Quantity {
					ask.Status = "filled"
				} else {
					ask.Status = "partially_filled"
				}
				dpStore.mu.Unlock()

				break
			}
		}
	}

	dpStore.mu.Lock()
	for _, m := range matches {
		dpStore.matches[m.ID] = m
	}
	dpStore.mu.Unlock()

	return matches
}

// Get order (anonymized - no limit price revealed until fill)
func GetDarkOrder(orderID string) (string, float64, float64, error) {
	dpStore.mu.RLock()
	order, ok := dpStore.orders[orderID]
	dpStore.mu.RUnlock()

	if !ok {
		return "", 0, 0, fmt.Errorf("order not found")
	}

	// Return anonymous info
	return order.Symbol, order.Quantity - order.Filled, order.Filled, nil
}

func main() {
	fmt.Println("Dark Pool service initialized")

	// Submit dark orders
	o1 := SubmitDarkOrder("user1", "BTCUSDT", "bid", 100, 65000, false, 0)
	o2 := SubmitDarkOrder("user2", "BTCUSDT", "ask", 100, 64900, false, 0)

	fmt.Printf("Dark orders: %s / %s\n", o1.ID, o2.ID)

	// Match
	matches := MatchDarkOrders("BTCUSDT")
	fmt.Printf("Matches: %d\n", len(matches))
}