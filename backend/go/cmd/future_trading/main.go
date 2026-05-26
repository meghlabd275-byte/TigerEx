// Package future_trading provides futures trading services.
// Migrated from TypeScript to Go for crypto futures trading.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Futures Contract
type FuturesContract struct {
	ID           string  `json:"id"`
	Symbol       string  `json:"symbol"`
	Underlying   string  `json:"underlying"` // BTC, ETH
	Expiry      int64   `json:"expiry"` // timestamp, 0 = perpetual
	StrikePrice float64 `json:"strikePrice"`
	MarkPrice   float64 `json:"markPrice"`
	IndexPrice  float64 `json:"indexPrice"`
	Status      string  `json:"status"` // active, suspended, expired
	ContractSize float64 `json:"contractSize"`
	MinSize    float64 `json:"minSize"`
	MaxSize    float64 `json:"maxSize"`
	LotSize    float64 `json:"lotSize"`
}

// Future Position
type FuturesPosition struct {
	ID          string  `json:"id"`
	UserID      string  `json:"userId"`
	ContractID  string  `json:"contractId"`
	Side       string  `json:"side"` // long, short
	Size       float64 `json:"size"`
	EntryPrice float64 `json:"entryPrice"`
	Liquidation float64 `json:"liquidation"`
	MarginUsed float64 `json:"marginUsed"`
	UnrealizedPNL float64 `json:"unrealizedPnL"`
}

// Futures Order
type FuturesOrder struct {
	ID         string  `json:"id"`
	UserID    string  `json:"userId"`
	ContractID string `json:"contractId"`
	Side      string `json:"side"`
	Type      string `json:"type"` // limit, market, stop
	Price     float64 `json:"price"`
	Size      float64 `json:"size"`
	OrderType string `json:"orderType"` // open, close, liquidate
	Status   string `json:"status"` // pending, filled, cancelled
	Filled    float64 `json:"filled"`
	TIF       string `json:"tif"` // GTC, IOC, FOK
	TriggerPrice float64 `json:"triggerPrice"`
}

// Funding Rate
type FundingRate struct {
	Symbol      string  `json:"symbol"`
	Rate        float64 `json:"rate"`
	NextFunding int64   `json:"nextFunding"`
	Predicted  float64 `json:"predicted"` // predicted next rate
}

// Store
type FuturesStore struct {
	mu        sync.RWMutex
	contracts map[string]*FuturesContract
	positions map[string]*FuturesPosition
	orders    map[string]*FuturesOrder
	funding   map[string]*FundingRate
}

var (
	futuresStore = &FuturesStore{
		contracts: make(map[string]*FuturesContract),
		positions: make(map[string]*FuturesPosition),
		orders: make(map[string]*FuturesOrder),
		funding: make(map[string]*FundingRate),
	}
)

// Initialize contracts
func init() {
	contracts := []*FuturesContract{
		{Symbol: "BTC-USD-PERP", Underlying: "BTC", Expiry: 0, MarkPrice: 65000, IndexPrice: 64980, Status: "active", ContractSize: 1, MinSize: 0.001, MaxSize: 100, LotSize: 0.001},
		{Symbol: "ETH-USD-PERP", Underlying: "ETH", Expiry: 0, MarkPrice: 3480, IndexPrice: 3475, Status: "active", ContractSize: 1, MinSize: 0.01, MaxSize: 1000, LotSize: 0.01},
		{Symbol: "SOL-USD-PERP", Underlying: "SOL", Expiry: 0, MarkPrice: 145, IndexPrice: 144, Status: "active", ContractSize: 1, MinSize: 0.1, MaxSize: 10000, LotSize: 0.1},
		{Symbol: "BTC-USD-250626", Underlying: "BTC",Expiry: 1750896000000, StrikePrice: 65000, MarkPrice: 65200, IndexPrice: 64980, Status: "active", ContractSize: 1, MinSize: 0.001, MaxSize: 100, LotSize: 0.001},
	}

	futuresStore.mu.Lock()
	defer futuresStore.mu.Unlock()

	for _, c := range contracts {
		futuresStore.contracts[c.Symbol] = c
	}
}

// Get contract
func GetContract(symbol string) (*FuturesContract, error) {
	futuresStore.mu.RLock()
	defer futuresStore.mu.RUnlock()

	if c, ok := futuresStore.contracts[symbol]; ok {
		return c, nil
	}
	return nil, fmt.Errorf("contract not found")
}

// Get mark price
func GetMarkPrice(symbol string) float64 {
	if c, err := GetContract(symbol); err == nil {
		return c.MarkPrice
	}
	return 0
}

// Place order
func PlaceFuturesOrder(userID, contractID, side, orderType string, price, size float64, tif string) (*FuturesOrder, error) {
	futuresStore.mu.RLock()
	_, ok := futuresStore.contracts[contractID]
	futuresStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("contract not found")
	}

	margin := calculateMargin(price, size)
	if margin < 100 { // minimum margin
		return nil, fmt.Errorf("margin below minimum")
	}

	order := &FuturesOrder{
		ID: fmt.Sprintf("forder_%d", time.Now().UnixNano()),
		UserID: userID,
		ContractID: contractID,
		Side: side,
		Type: "limit",
		Price: price,
		Size: size,
		OrderType: orderType,
		Status: "pending",
		Filled: 0,
		TIF: tif,
	}

	futuresStore.mu.Lock()
	defer futuresStore.mu.Unlock()
	futuresStore.orders[order.ID] = order

	return order, nil
}

// Fill order
func FillOrder(orderID string, fillPrice float64, fillSize float64) error {
	futuresStore.mu.RLock()
	order, ok := futuresStore.orders[orderID]
	futuresStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("order not found")
	}

	futuresStore.mu.Lock()
	defer futuresStore.mu.Unlock()

	order.Status = "filled"
	order.Filled = fillSize

	// Create/update position
	posKey := fmt.Sprintf("%s:%s", order.UserID, order.ContractID)
	position, posOk := futuresStore.positions[posKey]

	if posOk {
		if position.Side == order.Side {
			position.Size += fillSize
		} else {
			if fillSize >= position.Size {
				position.Size = fillSize - position.Size
				position.Side = order.Side
			} else {
				position.Size -= fillSize
			}
		}
	} else {
		liq := calculateLiquidation(fillPrice, order.Side)
		futuresStore.positions[posKey] = &FuturesPosition{
			ID: fmt.Sprintf("fpos_%d", time.Now().UnixNano()),
			UserID: order.UserID,
			ContractID: order.ContractID,
			Side: order.Side,
			Size: fillSize,
			EntryPrice: fillPrice,
			Liquidation: liq,
			MarginUsed: calculateMargin(fillPrice, fillSize),
		}
	}

	return nil
}

// Calculate liquidation price
func calculateLiquidation(price float64, side string) float64 {
	if side == "long" {
		return price * 0.85 // 15% maintenance margin
	}
	return price * 1.15
}

// Calculate margin
func calculateMargin(price, size float64) float64 {
	return price * size * 0.01 // 1% initial margin
}

// Get position
func GetPosition(userID, contractID string) (*FuturesPosition, bool) {
	futuresStore.mu.RLock()
	defer futuresStore.mu.RUnlock()

	posKey := fmt.Sprintf("%s:%s", userID, contractID)
	position, ok := futuresStore.positions[posKey]
	return position, ok
}

// Get funding rate
func GetFundingRate(symbol string) (*FundingRate, bool) {
	futuresStore.mu.RLock()
	defer futuresStore.mu.RUnlock()

	rate, ok := futuresStore.funding[symbol]
	return rate, ok
}

// Update mark price
func UpdateMarkPrice(symbol, indexPrice string) error {
	futuresStore.mu.RLock()
	contract, ok := futuresStore.contracts[symbol]
	futuresStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("contract not found")
	}

	contract.IndexPrice = indexPrice
	contract.MarkPrice = indexPrice // In real impl: TWAP

	return nil
}

func main() {
	fmt.Println("Futures Trading service initialized")

	// Get contract
	contract, _ := GetContract("BTC-USD-PERP")
	fmt.Printf("Contract: %s Price: $%.2f\n", contract.Symbol, contract.MarkPrice)

	// Place order
	order, _ := PlaceFuturesOrder("user_001", "BTC-USD-PERP", "long", "open", 65000, 0.1, "GTC")
	fmt.Printf("Order placed: %s\n", order.ID)
}