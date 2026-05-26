// Package order_auction provides order auction services.
// Core exchange component for fair price discovery.
package main

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Auction Order
type AuctionOrder struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	Symbol  string  `json:"symbol"`
	Side    string  `json:"side"` // bid, ask
	Price   float64 `json:"price"`
	Size    float64 `json:"size"`
	Type    string  `json:"type"` // limit, market
	Priority int    `json:"priority"` // time priority
	Status  string  `json:"status"` // pending, filled, cancelled
	Timestamp int64 `json:"timestamp"`
}

// Auction Result
type AuctionResult struct {
	Symbol     string  `json:"symbol"`
	Price     float64 `json:"auctionPrice"`
	Volume    float64 `json:"volume"`
	StartTime int64   `json:"startTime"`
	EndTime   int64   `json:"endTime"`
}

// Store
type AuctionStore struct {
	mu    sync.RWMutex
	bids map[string][]AuctionOrder
	asks map[string][]AuctionOrder
}

var auctionStore = &AuctionStore{
	bids: make(map[string][]AuctionOrder),
	asks: make(map[string][]AuctionOrder),
}

// Submit order
func SubmitAuctionOrder(userID, symbol, side string, price, size float64, orderType string) *AuctionOrder {
	order := &AuctionOrder{
		ID: fmt.Sprintf("auct_%d", time.Now().UnixNano()),
		UserID: userID,
		Symbol: symbol,
		Side: side,
		Price: price,
		Size: size,
		Type: orderType,
		Priority: int(time.Now().UnixMilli()),
		Status: "pending",
		Timestamp: time.Now().UnixMilli(),
	}

	auctionStore.mu.Lock()
	if side == "bid" {
		auctionStore.bids[symbol] = append(auctionStore.bids[symbol], *order)
		sort.Slice(auctionStore.bids[symbol], func(i, j int) bool {
			return auctionStore.bids[symbol][i].Price > auctionStore.bids[symbol][j].Price
		})
	} else {
		auctionStore.asks[symbol] = append(auctionStore.asks[symbol], *order)
		sort.Slice(auctionStore.asks[symbol], func(i, j int) bool {
			return auctionStore.asks[symbol][i].Price < auctionStore.asks[symbol][j].Price
		})
	}
	auctionStore.mu.Unlock()

	return order
}

// Execute auction
func ExecuteAuction(symbol string, duration int64) *AuctionResult {
	auctionStore.mu.RLock()
	bids := auctionStore.bids[symbol]
	asks := auctionStore.asks[symbol]
	auctionStore.mu.RUnlock()

	startTime := time.Now().UnixMilli()

	var auctionPrice float64
	var totalVolume float64

	// Find clearing price
	for _, bid := range bids {
		for _, ask := range asks {
			if bid.Price >= ask.Price {
				minSize := bid.Size
				if ask.Size < minSize {
					minSize = ask.Size
				}
				auctionPrice = (bid.Price + ask.Price) / 2
				totalVolume += minSize
			}
		}
	}

	result := &AuctionResult{
		Symbol: symbol,
		Price: auctionPrice,
		Volume: totalVolume,
		StartTime: startTime,
		EndTime: startTime + duration,
	}

	// Clear orders
	auctionStore.mu.Lock()
	delete(auctionStore.bids, symbol)
	delete(auctionStore.asks, symbol)
	auctionStore.mu.Unlock()

	return result
}

// Cancel order
func CancelAuctionOrder(orderID, symbol string) error {
	auctionStore.mu.RLock()
	defer auctionStore.mu.RUnlock()

	for i, o := range auctionStore.bids[symbol] {
		if o.ID == orderID {
			auctionStore.bids[symbol] = append(auctionStore.bids[symbol][:i], auctionStore.bids[symbol][i+1:]...)
			return nil
		}
	}

	for i, o := range auctionStore.asks[symbol] {
		if o.ID == orderID {
			auctionStore.asks[symbol] = append(auctionStore.asks[symbol][:i], auctionStore.asks[symbol][i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("order not found")
}

func main() {
	fmt.Println("Order Auction service initialized")

	// Submit orders
	SubmitAuctionOrder("user1", "BTCUSDT", "bid", 65000, 1.0, "limit")
	SubmitAuctionOrder("user2", "BTCUSDT", "ask", 64900, 1.0, "limit")

	// Execute
	result := ExecuteAuction("BTCUSDT", 5000)
	fmt.Printf("Auction: Price=$%.2f, Volume=%.4f\n", result.Price, result.Volume)
}