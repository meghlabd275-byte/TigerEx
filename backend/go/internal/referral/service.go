// Referral Service - Real-Time Path in Go
// Affiliate and referral program management

package referral

import (
	"fmt"
	"sync"
	"time"
)

// Referral tier
type Tier struct {
	Name         string
	RequiredVolume float64
	CommissionRate float64 // Percentage
	MinReferrals int
}

// Reward status
type RewardStatus int

const (
	RewardPending RewardStatus = iota
	RewardApproved
	RewardPaid
	RewardCancelled
)

// Referral
type Referral struct {
	ID           string
	ReferrerID   string  // User who invited
	RefereeID   string  // New user invited
	ReferralCode string
	Status       string  // pending, active, cancelled
	Tier        string
	CreatedAt   time.Time
	FirstTradeAt *time.Time
}

// Commission
type Commission struct {
	ID            string
	ReferralID    string
	ReferrerID    string
	Amount        float64
	Asset         string
	Status        RewardStatus
	TradeVolume   float64
	CreatedAt     time.Time
	PaidAt        *time.Time
}

// Service
type Service struct {
	// Referral tiers
	tiers []Tier
	
	// Referrals by referrer
	referrals map[string][]Referral
	// Referrals by referee (reverse index)
	refereeIndex map[string]string
	
	// Commissions
	commissions map[string]Commission
	
	// Stats
	totalReferrals   int
	totalCommission  float64
	
	mu sync.RWMutex
}

func NewService() *Service {
	svc := &Service{
		tiers: []Tier{
			{"Bronze", 0, 0.20, 0},
			{"Silver", 100000, 0.30, 5},
			{"Gold", 500000, 0.40, 20},
			{"Platinum", 2000000, 0.50, 50},
		},
		referrals: make(map[string][]Referral),
		refereeIndex: make(map[string]string),
		commissions: make(map[string]Commission),
	}
	return svc
}

// CreateReferral creates new referral link
func (s *Service) CreateReferral(referrerID, refereeID, code string) (*Referral, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	ref := Referral{
		ID:           generateID("ref"),
		ReferrerID:   referrerID,
		RefereeID:   refereeID,
		ReferralCode: code,
		Status:       "active",
		CreatedAt:    time.Now(),
	}
	
	s.referrals[referrerID] = append(s.referrals[referrerID], ref)
	s.refereeIndex[refereeID] = referrerID
	s.totalReferrals++
	
	return &ref, nil
}

// GetReferrals gets all referrals for user
func (s *Service) GetReferrals(userID string) []Referral {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return s.referrals[userID]
}

// RecordTrade records a trade for commission calculation
func (s *Service) RecordTrade(userID string, volume float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Find referrer
	referrerID, ok := s.refereeIndex[userID]
	if !ok {
		return nil // Not a referral
	}
	
	// Get referrer's tier
	tier := s.getTier(referrerID)
	
	// Calculate commission
	commission := volume * tier.CommissionRate / 100
	
	// Find existing referral
	var refID string
	for _, refs := range s.referrals {
		for _, r := range refs {
			if r.RefereeID == userID {
				refID = r.ID
				break
			}
		}
	}
	
	if refID == "" {
		return nil
	}
	
	// Create commission
	comm := Commission{
		ID:          generateID("comm"),
		ReferralID:  refID,
		ReferrerID:  referrerID,
		Amount:      commission,
		Asset:       "USDT",
		Status:      RewardPending,
		TradeVolume: volume,
		CreatedAt:   time.Now(),
	}
	
	s.commissions[comm.ID] = comm
	s.totalCommission += commission
	
	return nil
}

func (s *Service) getTier(userID string) Tier {
	refs := s.referrals[userID]
	
	// Calculate total volume from commissions
	var totalVolume float64
	for _, ref := range refs {
		for _, comm := range s.commissions {
			if comm.ReferralID == ref.ID {
				totalVolume += comm.TradeVolume
			}
		}
	}
	
	// Find appropriate tier
	for i := len(s.tiers) - 1; i >= 0; i-- {
		if totalVolume >= s.tiers[i].RequiredVolume {
			return s.tiers[i]
		}
	}
	
	return s.tiers[0]
}

// GetCommissions gets commissions for user
func (s *Service) GetCommissions(userID string) []Commission {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []Commission
	for _, comm := range s.commissions {
		if comm.ReferrerID == userID {
			result = append(result, comm)
		}
	}
	
	return result
}

// GetStats gets referral stats
func (s *Service) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return map[string]interface{}{
		"total_referrals":  s.totalReferrals,
		"total_commission": s.totalCommission,
		"active_tiers":     len(s.tiers),
	}
}

func generateID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}