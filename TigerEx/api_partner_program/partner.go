package main

import (
	"fmt"
	"time"
)

type PartnerTier string
type PartnerStatus string

const (
	TierStarter PartnerTier = "starter"
	TierGrowth PartnerTier = "growth"
	TierEnterprise PartnerTier = "enterprise"
)

const (
	StatusPending PartnerStatus = "pending"
	StatusApproved PartnerStatus = "approved"
	StatusSuspended PartnerStatus = "suspended"
)

type Partner struct {
	ID        string        `json:"id"`
	Name     string        `json:"name"`
	Email    string        `json:"email"`
	Tier    PartnerTier   `json:"tier"`
	APICalls int          `json:"apiCalls"`
	Commission float64     `json:"commission"`
	Status  PartnerStatus `json:"status"`
	AppliedAt int64       `json:"appliedAt"`
}

type PartnerProgram struct {
	Partners map[string]*Partner
}

func NewProgram() *PartnerProgram {
	return &PartnerProgram{
		Partners: make(map[string]*Partner),
	}
}

func (p *PartnerProgram) Register(name, email string) *Partner {
	partner := &Partner{
		ID: fmt.Sprintf("partner_%d", time.Now().UnixNano()),
		Name: name,
		Email: email,
		Tier: TierStarter,
		Status: StatusPending,
		AppliedAt: time.Now().UnixMilli(),
	}
	
	p.Partners[partner.ID] = partner
	return partner
}

func (p *PartnerProgram) Approve(id string) bool {
	partner := p.Partners[id]
	if partner == nil {
		return false
	}
	
	partner.Status = StatusApproved
	return true
}

func (p *PartnerProgram) CalculateCommission(id string, volume float64) float64 {
	partner := p.Partners[id]
	if partner == nil {
		return 0
	}
	
	rates := map[PartnerTier]float64{
		TierStarter: 0.10,
		TierGrowth: 0.15,
		TierEnterprise: 0.20,
	}
	
	return volume * rates[partner.Tier]
}

func main() {
	prog := NewProgram()
	
	partner := prog.Register("Acme Corp", "partners@acme.com")
	fmt.Printf("Registered: %s - %s\n", partner.Name, partner.Email)
	
	prog.Approve(partner.ID)
	fmt.Printf("Status: %s\n", partner.Status)
	
	comm := prog.CalculateCommission(partner.ID, 10000)
	fmt.Printf("Commission: $%.2f\n", comm)
}