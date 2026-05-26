package main

import (
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// DERIVATIVES OTC DESK - Production Ready
// Over-the-counter derivatives trading for institutions
// =============================================================================

// InstrumentType represents instrument type
type InstrumentType int

const (
	InstSwap InstrumentType = iota
	InstForward
	InstOption
	InstStructured
)

// Instrument represents OTC instrument
type Instrument struct {
	ID           string         `json:"id"`
	Type         InstrumentType `json:"type"`
	Name         string        `json:"name"`
	Underlying   string        `json:"underlying"`
	Notional    float64       `json:"notional"`
	Strike      float64       `json:"strike,omitempty"`
	Maturity    int64         `json:"maturity"`
	Counterparty string      `json:"counterparty"`
	Status     string        `json:"status"`
}

// TradeStatus trade status
type TradeStatus int

const (
	TradePending TradeStatus = iota
	TradeAccepted
	TradeConfirmed
	TradeSettled
	TradeCancelled
)

// OTCTrade represents OTC trade
type OTCTrade struct {
	ID             string    `json:"id"`
	InstrumentID  string   `json:"instrumentId"`
	Buyer         string   `json:"buyer"`
	Seller        string   `json:"seller"`
	Notional      float64  `json:"notional"`
	Price         float64  `json:"price"`
	Mtm           float64  `json:"mtm"`
	Status        TradeStatus `json:"status"`
	TradeDate     int64    `json:"tradeDate"`
	SettlementDate int64   `json:"settlementDate"`
	Terms         string  `json:"terms"`
}

// Counterparty entity
type Counterparty struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Rating     string  `json:"rating"`
	Limit      float64 `json:"limit"`
	Used       float64 `json:"used"`
	CreditLine float64 `json:"creditLine"`
	Status    string  `json:"status"`
}

// PricingQuote pricing
type PricingQuote struct {
	Bid       float64 `json:"bid"`
	Ask      float64 `json:"ask"`
	Mid      float64 `json:"mid"`
	Spread   float64 `json:"spread"`
	Expiry   int64  `json:"expiry"`
	Timestamp int64 `json:"timestamp"`
}

// OTCDesk main
type OTCDesk struct {
	mu              sync.RWMutex
	instruments     map[string]*Instrument
	trades         map[string]*OTCTrade
	counterparties map[string]*Counterparty
	prices         map[string]*PricingQuote
	globalLimit          float64
	concentrationLimit  float64
}

// NewOTCDesk creates desk
func NewOTCDesk() *OTCDesk {
	return &OTCDesk{
		instruments:     make(map[string]*Instrument),
		trades:        make(map[string]*OTCTrade),
		counterparties: make(map[string]*Counterparty),
		prices:        make(map[string]*PricingQuote),
		globalLimit:        1e9,
		concentrationLimit: 1e8,
	}
}

// RegisterCounterparty registers party
func (d *OTCDesk) RegisterCounterparty(cp *Counterparty) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if _, exists := d.counterparties[cp.ID]; exists {
		return fmt.Errorf("exists")
	}

	d.counterparties[cp.ID] = cp
	return nil
}

// CreateTrade creates trade
func (d *OTCDesk) CreateTrade(trade *OTCTrade) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	buyer := d.counterparties[trade.Buyer]
	seller := d.counterparties[trade.Seller]

	if buyer != nil && buyer.Used+trade.Notional > buyer.CreditLine {
		return fmt.Errorf("buyer limit")
	}

	if seller != nil && seller.Used+trade.Notional > seller.CreditLine {
		return fmt.Errorf("seller limit")
	}

	if buyer != nil {
		buyer.Used += trade.Notional
	}
	if seller != nil {
		seller.Used += trade.Notional
	}

	trade.Status = TradePending
	trade.TradeDate = time.Now().UnixMilli()
	d.trades[trade.ID] = trade

	return nil
}

// QuotePrice gets quote
func (d *OTCDesk) QuotePrice(instrumentID string, spotPrice float64) *PricingQuote {
	d.mu.RLock()
	defer d.mu.RUnlock()

	inst, ok := d.instruments[instrumentID]
	if !ok {
		return nil
	}

	spread := 0.01
	quote := &PricingQuote{
		Bid:      spotPrice * (1 - spread/2),
		Ask:     spotPrice * (1 + spread/2),
		Mid:     spotPrice,
		Spread:  spread,
		Expiry:  5000,
		Timestamp: time.Now().UnixMilli(),
	}

	d.prices[instrumentID] = quote
	_ = inst
	return quote
}

// ExecuteTrade executes trade
func (d *OTCDesk) ExecuteTrade(tradeID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	trade, ok := d.trades[tradeID]
	if !ok {
		return fmt.Errorf("not found")
	}

	trade.Status = TradeConfirmed
	return nil
}

// SettleTrade settles trade
func (d *OTCDesk) SettleTrade(tradeID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	trade, ok := d.trades[tradeID]
	if !ok {
		return fmt.Errorf("not found")
	}

	trade.Status = TradeSettled
	return nil
}

// CalculateMtM calculates MTM
func (d *OTCDesk) CalculateMtM(tradeID string, currentPrice float64) float64 {
	d.mu.RLock()
	defer d.mu.RUnlock()

	trade, ok := d.trades[tradeID]
	if !ok {
		return 0
	}

	trade.Mtm = (currentPrice - trade.Price) * trade.Notional
	return trade.Mtm
}

// GetCreditExposure gets exposure
func (d *OTCDesk) GetCreditExposure() float64 {
	d.mu.RLock()
	defer d.mu.RUnlock()

	total := 0.0
	for _, cp := range d.counterparties {
		total += cp.Used
	}
	return total
}

// Main
func main() {
	fmt.Println("=== TigerEx Derivatives OTC Desk ===")

	desk := NewOTCDesk()

	// Register parties
	parties := []*Counterparty{
		{ID: "GS", Name: "Goldman", CreditLine: 1e8},
		{ID: "JPM", Name: "JP Morgan", CreditLine: 1e8},
	}

	for _, p := range parties {
		desk.RegisterCounterparty(p)
		fmt.Printf("✓ Registered: %s\n", p.Name)
	}

	// Create trade
	trade := &OTCTrade{
		ID:          "T001",
		Buyer:       "GS",
		Seller:      "JPM",
		Notional:    1e7,
		Price:       50000,
	}

	if err := desk.CreateTrade(trade); err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("✓ Trade: $%.0f @ $%.0f\n", trade.Notional, trade.Price)
	}

	// Execute
	desk.ExecuteTrade(trade.ID)
	quote := desk.QuotePrice("BTC", 50000)
	if quote != nil {
		fmt.Printf("✓ Quote: Bid $%.0f, Ask $%.0f\n", quote.Bid, quote.Ask)
	}

	// MTM
	mtm := desk.CalculateMtM(trade.ID, 52000)
	fmt.Printf("✓ MTM: $%.0f\n", mtm)

	// Exposure
	exp := desk.GetCreditExposure()
	fmt.Printf("✓ Exposure: $%.0f\n", exp)

	fmt.Println("\n=== OTC Ready ===")
}