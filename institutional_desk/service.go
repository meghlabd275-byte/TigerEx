package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// INSTITUTIONAL DESK
// Professional trading services for institutional clients
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

// InstitutionalClient represents an institutional client
type InstitutionalClient struct {
	ID           string
	Name         string
	EntityType  EntityType
	LicenseNumber string
	Jurisdiction string
	ContactEmail string
	ContactPhone string
	AccountManager string
	Status      ClientStatus
	Tier        ClientTier
	CreatedAt   time.Time
}

type EntityType string

const (
	EntityTypeAssetManager   EntityType = "ASSET_MANAGER"
	EntityTypeHedgeFund     EntityType = "HEDGE_FUND"
	EntityTypeFamilyOffice EntityType = "FAMILY_OFFICE"
	EntityTypeCorporation  EntityType = "CORPORATION"
	EntityTypeBank         EntityType = "BANK"
	EntityTypeBroker        EntityType = "BROKER"
)

type ClientStatus string

const (
	ClientStatusPending   ClientStatus = "PENDING"
	ClientStatusActive   ClientStatus = "ACTIVE"
	ClientStatusSuspended ClientStatus = "SUSPENDED"
	ClientStatusClosed   ClientStatus = "CLOSED"
)

type ClientTier string

const (
	ClientTierBronze   ClientTier = "BRONZE"
	ClientTierSilver   ClientTier = "SILVER"
	ClientTierGold     ClientTier = "GOLD"
	ClientTierPlatinum ClientTier = "PLATINUM"
	ClientTierDiamond ClientTier = "DIAMOND"
)

// OTCQuote represents an OTC (Over-The-Counter) quote
type OTCQuote struct {
	ID            string
	ClientID     string
	Symbol       string
	Side        string
	Quantity    float64
	Price       float64
	TotalValue  float64
	Fee         float64
	Status      QuoteStatus
	ExpiresAt   time.Time
	CreatedAt   time.Time
}

type QuoteStatus string

const (
	QuoteStatusPending   QuoteStatus = "PENDING"
	QuoteStatusApproved QuoteStatus = "APPROVED"
	QuoteStatusRejected QuoteStatus = "REJECTED"
	QuoteStatusExpired  QuoteStatus = "EXPIRED"
	QuoteStatusFilled  QuoteStatus = "FILLED"
)

// BlockTrade represents a block trade
type BlockTrade struct {
	ID          string
	ClientID   string
	Symbol     string
	Side       string
	Quantity   float64
	Price      float64
	Status    TradeStatus
	Settlement string // T+0, T+1, T+2
	CreatedAt time.Time
}

type TradeStatus string

const (
	TradeStatusPending   TradeStatus = "PENDING"
	TradeStatusExecuted TradeStatus = "EXECUTED"
	TradeStatusSettled TradeStatus = "SETTLED"
	TradeStatusCancelled TradeStatus = "CANCELLED"
)

// ============================================================================
// SERVICE
// ============================================================================

type InstitutionalService struct {
	mu       sync.RWMutex
	clients map[string]*InstitutionalClient
	quotes  map[string]*OTCQuote
	trades  map[string]*BlockTrade
	
	clientCounter int64
	quoteCounter int64
	tradeCounter int64
}

func NewInstitutionalService() *InstitutionalService {
	return &InstitutionalService{
		clients: make(map[string]*InstitutionalClient),
		quotes:  make(map[string]*OTCQuote),
		trades:  make(map[string]*BlockTrade),
	}
}

// ============================================================================
// CLIENT MANAGEMENT
// ============================================================================

func (s *InstitutionalService) RegisterClient(name string, entityType EntityType, licenseNumber, jurisdiction, email, phone string) (*InstitutionalClient, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.clientCounter++
	client := &InstitutionalClient{
		ID:            fmt.Sprintf("INST%d", s.clientCounter),
		Name:          name,
		EntityType:   entityType,
		LicenseNumber: licenseNumber,
		Jurisdiction: jurisdiction,
		ContactEmail: email,
		ContactPhone: phone,
		Status:      ClientStatusPending,
		Tier:        ClientTierBronze,
		CreatedAt:   time.Now(),
	}
	
	s.clients[client.ID] = client
	return client, nil
}

func (s *InstitutionalService) ApproveClient(clientID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	client, ok := s.clients[clientID]
	if !ok {
		return fmt.Errorf("client not found")
	}
	
	client.Status = ClientStatusActive
	return nil
}

func (s *InstitutionalService) GetClient(clientID string) (*InstitutionalClient, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	client, ok := s.clients[clientID]
	if !ok {
		return nil, fmt.Errorf("client not found")
	}
	
	return client, nil
}

// ============================================================================
// OTC QUOTES
// ============================================================================

func (s *InstitutionalService) RequestOTCQuote(clientID, symbol, side string, quantity float64) (*OTCQuote, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	client, ok := s.clients[clientID]
	if !ok {
		return nil, fmt.Errorf("client not found")
	}
	
	if client.Status != ClientStatusActive {
		return nil, fmt.Errorf("client not active")
	}
	
	s.quoteCounter++
	quote := &OTCQuote{
		ID:         fmt.Sprintf("OTC%d", s.quoteCounter),
		ClientID:  clientID,
		Symbol:    symbol,
		Side:      side,
		Quantity:  quantity,
		Status:    QuoteStatusPending,
		ExpiresAt: time.Now().Add(30 * time.Minute),
		CreatedAt: time.Now(),
	}
	
	// Calculate price (mock - in production use real pricing)
	quote.Price = getOTCPrice(symbol, client.Tier)
	quote.TotalValue = quote.Price * quantity
	quote.Fee = quote.TotalValue * 0.001 // 0.1% fee for OTC
	
	s.quotes[quote.ID] = quote
	return quote, nil
}

func (s *InstitutionalService) ApproveQuote(quoteID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	quote, ok := s.quotes[quoteID]
	if !ok {
		return fmt.Errorf("quote not found")
	}
	
	if time.Now().After(quote.ExpiresAt) {
		quote.Status = QuoteStatusExpired
		return fmt.Errorf("quote expired")
	}
	
	quote.Status = QuoteStatusApproved
	return nil
}

func (s *InstitutionalService) FillQuote(quoteID string) (*BlockTrade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	quote, ok := s.quotes[quoteID]
	if !ok {
		return nil, fmt.Errorf("quote not found")
	}
	
	if quote.Status != QuoteStatusApproved {
		return nil, fmt.Errorf("quote not approved")
	}
	
	s.tradeCounter++
	trade := &BlockTrade{
		ID:        fmt.Sprintf("BLK%d", s.tradeCounter),
		ClientID:  quote.ClientID,
		Symbol:   quote.Symbol,
		Side:     quote.Side,
		Quantity: quote.Quantity,
		Price:    quote.Price,
		Status:   TradeStatusExecuted,
		Settlement: "T+0",
		CreatedAt: time.Now(),
	}
	
	s.trades[trade.ID] = trade
	quote.Status = QuoteStatusFilled
	
	return trade, nil
}

// ============================================================================
// REPORTS
// ============================================================================

func (s *InstitutionalService) GetClientReport(clientID string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var quotes []*OTCQuote
	var trades []*BlockTrade
	
	for _, q := range s.quotes {
		if q.ClientID == clientID {
			quotes = append(quotes, q)
		}
	}
	
	for _, t := range s.trades {
		if t.ClientID == clientID {
			trades = append(trades, t)
		}
	}
	
	var totalVolume float64
	for _, t := range trades {
		if t.Status == TradeStatusExecuted || t.Status == TradeStatusSettled {
			totalVolume += t.Price * t.Quantity
		}
	}
	
	return map[string]interface{}{
		"client_id":      clientID,
		"total_quotes":    len(quotes),
		"total_trades":   len(trades),
		"total_volume":   totalVolume,
		"quotes":        quotes,
		"trades":       trades,
	}
}

// ============================================================================
// HELPERS
// ============================================================================

func getOTCPrice(symbol string, tier ClientTier) float64 {
	// Mock pricing - in production use real market data with discounts based on tier
	basePrice := 50000.0 // BTC base
	
	discounts := map[ClientTier]float64{
		ClientTierBronze:   0.0,
		ClientTierSilver:   0.001,
		ClientTierGold:     0.002,
		ClientTierPlatinum: 0.003,
		ClientTierDiamond:  0.005,
	}
	
	discount := discounts[tier]
	return basePrice * (1 - discount)
}

func main() {
	fmt.Println("TigerEx Institutional Desk v1.0.0")
	
	inst := NewInstitutionalService()
	
	// Register client
	client, _ := inst.RegisterClient("Hedge Fund ABC", EntityTypeHedgeFund, "HF-2024-001", "US", "contact@hfabc.com", "+1-555-0100")
	fmt.Printf("Client: %s\n", client.Name)
	
	// Approve
	inst.ApproveClient(client.ID)
	
	// Request OTC quote
	quote, _ := inst.RequestOTCQuote(client.ID, "BTC/USDT", "BUY", 100)
	fmt.Printf("Quote: %.2f @ $%.2f\n", quote.Quantity, quote.Price)
	
	// Approve and fill
	inst.ApproveQuote(quote.ID)
	trade, _ := inst.FillQuote(quote.ID)
	fmt.Printf("Trade: %s - Volume: $%.2f\n", trade.ID, trade.Price*trade.Quantity)
}