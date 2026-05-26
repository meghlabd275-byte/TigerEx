// Package premarket provides pre-market trading services.
// Migrated from TypeScript to Go for early access trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Pre-market listing
type PreMarketListing struct {
	ID          string  `json:"id"`
	Token       string  `json:"token"`
	Name        string  `json:"name"`
	ListingDate int64   `json:"listingDate"`
	EndDate    int64   `json:"endDate"`
	Price      float64 `json:"price"`
	Status    string  `json:"status"` // upcoming, active, ended
	Type       string  `json:"type"` // ico, ido, ieo
}

// Subscription
type PreMarketSub struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	ListingID string  `json:"listingId"`
	Amount    float64 `json:"amount"`
	Allocated float64 `json:"allocated"`
	Tier     string  `json:"tier"` // bronze, silver, gold, diamond
}

// Allocation tier
type AllocationTier struct {
	Tier       string  `json:"tier"`
	Allocation float64 `json:"allocation"` // token allocation cap
	MinStake   float64 `json:"minStake"` // required holdings
}

// Distribution result
type Distribution struct {
	UserID     string  `json:"userId"`
	ListingID   string  `json:"listingId"`
	Allocated  float64 `json:"allocated"`
	PaidAmount float64 `json:"paidAmount"`
	Status    string  `json:"status"` // pending, distributed
}

// Store
type PreMarketStore struct {
	mu          sync.RWMutex
	listings    map[string]*PreMarketListing
	subscriptions map[string]*PreMarketSub
	distributions map[string]*Distribution
}

var (
	pmStore = &PreMarketStore{
		listings: make(map[string]*PreMarketListing),
		subscriptions: make(map[string]*PreMarketSub),
		distributions: make(map[string]*Distribution),
	}
)

// Initialize listings
func init() {
	listings := []*PreMarketListing{
		{ID: "listing_1", Token: "TIGER", Name: "Tiger Token", ListingDate: time.Now().UnixMilli() + 86400000*7, EndDate: 0, Price: 0.1, Status: "upcoming", Type: "ido"},
		{ID: "listing_2", Token: "DEFI", Name: "DeFi Protocol", ListingDate: time.Now().UnixMilli() + 86400000*14, EndDate: 0, Price: 0.05, Status: "upcoming", Type: "ido"},
	}

	pmStore.mu.Lock()
	defer pmStore.mu.Unlock()

	for _, l := range listings {
		pmStore.listings[l.ID] = l
	}
}

// Create subscription
func Subscribe(userID, listingID string, amount float64) (*PreMarketSub, error) {
	pmStore.mu.Lock()
	defer pmStore.mu.Unlock()

	listing, ok := pmStore.listings[listingID]
	if !ok {
		return nil, fmt.Errorf("listing not found")
	}

	if listing.Status == "ended" {
		return nil, fmt.Errorf("listing ended")
	}

	// Determine tier based on amount
	tier := "bronze"
	if amount >= 10000 {
		tier = "silver"
	} else if amount >= 50000 {
		tier = "gold"
	} else if amount >= 100000 {
		tier = "diamond"
	}

	sub := &PreMarketSub{
		ID: fmt.Sprintf("sub_%d", time.Now().UnixNano()),
		UserID: userID,
		ListingID: listingID,
		Amount: amount,
		Allocated: 0,
		Tier: tier,
	}

	pmStore.subscriptions[sub.ID] = sub

	return sub, nil
}

// Distribute tokens
func Distribute(listingID string) int {
	pmStore.mu.Lock()
	defer pmStore.mu.Unlock()

	listing, ok := pmStore.listings[listingID]
	if !ok {
		return 0
	}

	listing.Status = "ended"

	count := 0
	for _, sub := range pmStore.subscriptions {
		if sub.ListingID == listingID {
			// Calculate allocation (simplified)
			allocated := sub.Amount / listing.Price

			dist := &Distribution{
				UserID: sub.UserID,
				ListingID: listingID,
				Allocated: allocated,
				PaidAmount: sub.Amount,
				Status: "distributed",
			}

			pmStore.distributions[fmt.Sprintf("%s_%s", sub.UserID, listingID)] = dist
			sub.Allocated = allocated
			count++
		}
	}

	return count
}

// GetDistribution
func GetDistribution(userID, listingID string) (*Distribution, bool) {
	pmStore.mu.RLock()
	defer pmStore.mu.RUnlock()

	dist, ok := pmStore.distributions[fmt.Sprintf("%s_%s", userID, listingID)]
	return dist, ok
}

// GetActiveListings
func GetActiveListings() []*PreMarketListing {
	pmStore.mu.RLock()
	defer pmStore.mu.RUnlock()

	var result []*PreMarketListing
	for _, l := range pmStore.listings {
		if l.Status != "ended" {
			result = append(result, l)
		}
	}
	return result
}

func main() {
	fmt.Println("Pre-Market service initialized")

	// Get listings
	listings := GetActiveListings()
	for _, l := range listings {
		fmt.Printf("Upcoming: %s (%s) @ $%.4f\n", l.Name, l.Token, l.Price)
	}

	// Subscribe
	sub, _ := Subscribe("user_001", "listing_1", 50000)
	fmt.Printf("Subscribed: %s at %s tier ($%.2f)\n", sub.UserID, sub.Tier, sub.Amount)

	// Distribute
	count := Distribute("listing_1")
	fmt.Printf("Distributed to %d users\n", count)
}