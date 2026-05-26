package main

import (
	"fmt"
	"time"
)

// Property type
type PropertyType string

const (
	PropResidential PropertyType = "residential"
	PropCommercial PropertyType = "commercial"
	PropIndustrial PropertyType = "industrial"
	PropMixedUse PropertyType = "mixed_use"
	PropLand PropertyType = "land"
)

// Property status
type PropertyStatus string

const (
	PropTokenizing PropertyStatus = "tokenizing"
	PropActive PropertyStatus = "active"
	PropSold PropertyStatus = "sold"
)

// Property token
type PropertyToken struct {
	ID          string        `json:"id"`
	PropertyID  string        `json:"propertyId"`
	TotalSupply float64       `json:"totalSupply"`
	PricePerToken float64    `json:"pricePerToken"`
	Holders    int           `json:"holders"`
}

// Rental payment
type RentalPayment struct {
	PropertyID string  `json:"propertyId"`
	Amount    float64 `json:"amount"`
	PaidAt    int64   `json:"paidAt"`
}

// Property
type Property struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Type       PropertyType `json:"type"`
	Address    string        `json:"address"`
	Value      float64       `json:"value"`
	Status     PropertyStatus `json:"status"`
	TokenizedAt int64         `json:"tokenizedAt"`
}

// Real estate platform
type RealEstatePlatform struct {
	Properties map[string]*Property
	Tokens     map[string]*PropertyToken
	RentalPayments []RentalPayment
}

// New creates platform
func NewRealEstatePlatform() *RealEstatePlatform {
	return &RealEstatePlatform{
		Properties: make(map[string]*Property),
		Tokens: make(map[string]*PropertyToken),
	}
}

// Tokenize property
func (p *RealEstatePlatform) TokenizeProperty(id, name string, propType PropertyType, address string, value float64, totalSupply, pricePerToken float64) *PropertyToken {
	propID := fmt.Sprintf("prop_%d", time.Now().UnixNano())
	
	property := &Property{
		ID: propID,
		Name: name,
		Type: propType,
		Address: address,
		Value: value,
		Status: PropActive,
		TokenizedAt: time.Now().UnixMilli(),
	}
	
	token := &PropertyToken{
		ID: fmt.Sprintf("token_%d", time.Now().UnixNano()),
		PropertyID: propID,
		TotalSupply: totalSupply,
		PricePerToken: pricePerToken,
		Holders: 0,
	}
	
	p.Properties[propID] = property
	p.Tokens[token.ID] = token
	
	return token
}

// Distribute rental income
func (p *RealEstatePlatform) DistributeRental(propID string, amount float64) {
	p.RentalPayments = append(p.RentalPayments, RentalPayment{
		PropertyID: propID,
		Amount: amount,
		PaidAt: time.Now().UnixMilli(),
	})
}

// Get property value
func (p *RealEstatePlatform) GetPropertyValue(propID string) float64 {
	property := p.Properties[propID]
	if property == nil {
		return 0
	}
	return property.Value
}

func main() {
	platform := NewRealEstatePlatform()
	
	// Tokenize property
	token := platform.TokenizeProperty(
		"prop1",
		"Manhattan Office Building",
		PropCommercial,
		"123 NYC Ave, New York, NY",
		10000000, // $10M
		10000,    // 10k tokens
		1000,    // $1k per token
	)
	fmt.Printf("Tokenized: %s - Price: $%.2f\n", token.PropertyID, token.PricePerToken)
	
	// Distribute rent
	platform.DistributeRental(token.PropertyID, 50000)
	fmt.Printf("Rental payments: %d\n", len(platform.RentalPayments))
}