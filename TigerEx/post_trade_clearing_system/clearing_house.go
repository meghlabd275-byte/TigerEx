package main

import (
	"fmt"
	"time"
)

// Settlement status
type SettlementStatus string

const (
	StatusPending   SettlementStatus = "pending"
	StatusNovated  SettlementStatus = "novated"
	StatusInProgress SettlementStatus = "in_progress"
	StatusSettled  SettlementStatus = "settled"
	StatusFailed   SettlementStatus = "failed"
	StatusCancelled SettlementStatus = "cancelled"
)

// Settlement type
type SettlementType string

const (
	SettlementRegular      SettlementType = "regular"
	SettlementInstant     SettlementType = "instant"
	SettlementDelayed    SettlementType = "delayed"
	SettlementOTC        SettlementType = "otc"
	SettlementInstitutional SettlementType = "institutional"
)

// Execution data (input)
type ExecutionData struct {
	Symbol    string `json:"symbol"`
	BuyerID   string `json:"buyerId"`
	SellerID  string `json:"sellerId"`
	Quantity  float64 `json:"quantity"`
	Price    float64 `json:"price"`
	Commission float64 `json:"commission"`
	SettlementType SettlementType `json:"settlementType"`
	ExecutedAt int64  `json:"executedAt"`
	BuyerAccount  string `json:"buyerAccount"`
	SellerAccount string `json:"sellerAccount"`
}

// Settlement trade (internal)
type SettlementTrade struct {
	TradeID           string         `json:"tradeId"`
	Symbol           string         `json:"symbol"`
	BuyerID          string         `json:"buyerId"`
	SellerID         string         `json:"sellerId"`
	Quantity         float64        `json:"quantity"`
	Price            float64        `json:"price"`
	SettlementAmount float64       `json:"settlementAmount"`
	Commission       float64       `json:"commission"`
	Status           SettlementStatus `json:"status"`
	SettlementType  SettlementType  `json:"settlementType"`
	ExecutedAt      int64           `json:"executedAt"`
	NovatedAt        int64           `json:"novatedAt"`
	SettledAt        *int64         `json:"settledAt,omitempty"`
	SettlementDeadline int64         `json:"settlementDeadline"`
	BuyerSettlementAccount string   `json:"buyerSettlementAccount"`
	SellerSettlementAccount string `json:"sellerSettlementAccount"`
}

// Novation result
type NovationResult struct {
	TradeID      string `json:"tradeId"`
	Status      string `json:"status"`
	SettledAt   int64  `json:"settledAt"`
}

// Clearing house engine
type ClearingHouseEngine struct {
	Trades      map[string]*SettlementTrade
	NovationQueue map[string][]string
}

// New creates engine
func NewClearingHouseEngine() *ClearingHouseEngine {
	return &ClearingHouseEngine{
		Trades: make(map[string]*SettlementTrade),
		NovationQueue: make(map[string][]string),
	}
}

// Calculate settlement deadline
func (e *ClearingHouseEngine) calculateSettlementDeadline(settlementType SettlementType) int64 {
	now := time.Now()
	
	switch settlementType {
	case SettlementInstant:
		return now.UnixMilli()
	case SettlementRegular:
		return now.Add(24 * time.Hour).UnixMilli()
	case SettlementDelayed:
		return now.Add(7 * 24 * time.Hour).UnixMilli()
	default:
		return now.Add(24 * time.Hour).UnixMilli()
	}
}

// Novate trade (execution -> clearing)
func (e *ClearingHouseEngine) NovateTrade(exec ExecutionData) *NovationResult {
	tradeID := fmt.Sprintf("TRADE-%d-%s", time.Now().Unix(), 
		fmt.Sprintf("%x", time.Now().UnixNano())[:6])
	
	deadline := e.calculateSettlementDeadline(exec.SettlementType)
	now := time.Now().UnixMilli()
	
	trade := &SettlementTrade{
		TradeID: tradeID,
		Symbol: exec.Symbol,
		BuyerID: exec.BuyerID,
		SellerID: exec.SellerID,
		Quantity: exec.Quantity,
		Price: exec.Price,
		SettlementAmount: exec.Quantity * exec.Price,
		Commission: exec.Commission,
		Status: StatusNovated,
		SettlementType: exec.SettlementType,
		ExecutedAt: exec.ExecutedAt,
		NovatedAt: now,
		SettlementDeadline: deadline,
		BuyerSettlementAccount: exec.BuyerAccount,
		SellerSettlementAccount: exec.SellerAccount,
	}
	
	e.Trades[tradeID] = trade
	
	// Add to queue
	e.NovationQueue[exec.Symbol] = append(e.NovationQueue[exec.Symbol], tradeID)
	
	return &NovationResult{
		TradeID: tradeID,
		Status: string(StatusNovated),
		SettledAt: deadline,
	}
}

// Process settlement
func (e *ClearingHouseEngine) SettleTrade(tradeID string) bool {
	trade, ok := e.Trades[tradeID]
	if !ok {
		return false
	}
	
	if trade.Status != StatusNovated && trade.Status != StatusInProgress {
		return false
	}
	
	now := time.Now().UnixMilli()
	trade.Status = StatusSettled
	trade.SettledAt = &now
	
	return true
}

// Fail settlement
func (e *ClearingHouseEngine) FailTrade(tradeID, reason string) bool {
	trade, ok := e.Trades[tradeID]
	if !ok {
		return false
	}
	
	trade.Status = StatusFailed
	_ = reason
	return true
}

// Get trade
func (e *ClearingHouseEngine) GetTrade(tradeID string) *SettlementTrade {
	return e.Trades[tradeID]
}

// Get pending settlements
func (e *ClearingHouseEngine) GetPending(symbol string) []*SettlementTrade {
	var result []*SettlementTrade
	for _, id := range e.NovationQueue[symbol] {
		trade := e.Trades[id]
		if trade != nil && (trade.Status == StatusNovated || trade.Status == StatusInProgress) {
			result = append(result, trade)
		}
	}
	return result
}

func main() {
	engine := NewClearingHouseEngine()
	
	// Simulate execution
	exec := ExecutionData{
		Symbol: "BTC/USDT",
		BuyerID: "user1",
		SellerID: "user2",
		Quantity: 1.0,
		Price: 50000.0,
		Commission: 50.0,
		SettlementType: SettlementRegular,
		ExecutedAt: time.Now().UnixMilli(),
		BuyerAccount: "acc1",
		SellerAccount: "acc2",
	}
	
	// Novate
	result := engine.NovateTrade(exec)
	fmt.Printf("Novated: %s, settles at: %d\n", result.TradeID, result.SettledAt)
	
	// Settle
	engine.SettleTrade(result.TradeID)
	trade := engine.GetTrade(result.TradeID)
	fmt.Printf("Trade status: %s\n", trade.Status)
}