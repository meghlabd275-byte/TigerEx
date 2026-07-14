// TigerEx Referral Service
// Referral program management

package referral

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"
)

type Referral struct {
	ID           string    `json:"id"`
	ReferrerID   string    `json:"referrer_id"`
	ReferralCode string    `json:"referral_code"`
	ReferredID    string    `json:"referred_id"`
	Status        string    `json:"status"`
	CommissionRate float64  `json:"commission_rate"`
	CommissionPaid float64  `json:"commission_paid"`
	CreatedAt     time.Time `json:"created_at"`
}

type ReferralProgram struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	ReferrerReward      float64   `json:"referrer_reward"`
	ReferrerRewardType  string    `json:"referrer_reward_type"` // percentage, fixed
	ReferredReward     float64   `json:"referred_reward"`
	ReferredRewardType string    `json:"referred_reward_type"`
	MinDeposit         float64   `json:"min_deposit"`
	MinTradingVolume   float64   `json:"min_trading_volume"`
	ValidDays          int       `json:"valid_days"`
	MaxReferrals       int       `json:"max_referrals"`
	Active             bool      `json:"active"`
	StartDate          time.Time `json:"start_date"`
	EndDate            time.Time `json:"end_date"`
}

type ReferralStats struct {
	TotalReferrals      int     `json:"total_referrals"`
	ActiveReferrals     int     `json:"active_referrals"`
	TotalCommissionPaid float64 `json:"total_commission_paid"`
	TopReferrers        int     `json:"top_referrers"`
}

type ReferralManager struct {
	mu           sync.RWMutex
	referrals    map[string]*Referral
	referralCodes map[string]string // code -> referralID
	userReferrals map[string]string // userID -> referralID
	programs     map[string]*ReferralProgram
}

func NewReferralManager() *ReferralManager {
	rm := &ReferralManager{
		referrals:      make(map[string]*Referral),
		referralCodes: make(map[string]string),
		userReferrals:  make(map[string]string),
		programs:       make(map[string]*ReferralProgram),
	}
	rm.initializePrograms()
	return rm
}

func (rm *ReferralManager) initializePrograms() {
	now := time.Now()
	programs := []*ReferralProgram{
		{
			ID:                  "STD",
			Name:                "Standard Referral Program",
			ReferrerReward:      20,
			ReferrerRewardType:  "percentage",
			ReferredReward:      10,
			ReferredRewardType:  "percentage",
			MinDeposit:          100,
			MinTradingVolume:   1000,
			ValidDays:           30,
			MaxReferrals:        100,
			Active:              true,
			StartDate:          now,
			EndDate:            now.AddDate(1, 0, 0),
		},
		{
			ID:                  "VIP",
			Name:                "VIP Referral Program",
			ReferrerReward:      30,
			ReferrerRewardType:  "percentage",
			ReferredReward:      15,
			ReferredRewardType:  "percentage",
			MinDeposit:          1000,
			MinTradingVolume:   10000,
			ValidDays:           60,
			MaxReferrals:        50,
			Active:              true,
			StartDate:          now,
			EndDate:            now.AddDate(1, 0, 0),
		},
	}

	for _, p := range programs {
		rm.programs[p.ID] = p
	}
}

func (rm *ReferralManager) CreateReferralCode(userID string) (string, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	// Check if user already has a code
	if existingCode, exists := rm.userReferrals[userID]; exists {
		return existingCode, nil
	}

	code, err := generateReferralCode()
	if err != nil {
		return "", err
	}

	now := time.Now()
	referral := &Referral{
		ID:            fmt.Sprintf("REF%d%d", now.Unix(), now.Nanosecond()),
		ReferrerID:    userID,
		ReferralCode:  code,
		Status:        "active",
		CommissionRate: 20,
		CommissionPaid: 0,
		CreatedAt:     now,
	}

	rm.referrals[referral.ID] = referral
	rm.referralCodes[code] = referral.ID
	rm.userReferrals[userID] = code

	return code, nil
}

func (rm *ReferralManager) GetReferralCode(userID string) (string, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	code, exists := rm.userReferrals[userID]
	if !exists {
		return "", errors.New("referral code not found")
	}
	return code, nil
}

func (rm *ReferralManager) GetReferralByCode(code string) (*Referral, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	referralID, exists := rm.referralCodes[code]
	if !exists {
		return nil, errors.New("referral code not found")
	}

	return rm.referrals[referralID], nil
}

func (rm *ReferralManager) RegisterReferral(referrerID, referredID string) (*Referral, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	// Check if referrer exists
	referrerCode, exists := rm.userReferrals[referrerID]
	if !exists {
		return nil, errors.New("referrer not found")
	}

	referralID := rm.referralCodes[referrerCode]
	referral, exists := rm.referrals[referralID]
	if !exists {
		return nil, errors.New("referral not found")
	}

	// Check if already referred
	if referral.ReferredID != "" {
		return nil, errors.New("user already referred")
	}

	referral.ReferredID = referredID
	referral.Status = "completed"

	return referral, nil
}

func (rm *ReferralManager) GetReferrals(referrerID string) ([]*Referral, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	var refs []*Referral
	for _, ref := range rm.referrals {
		if ref.ReferrerID == referrerID {
			refs = append(refs, ref)
		}
	}
	return refs, nil
}

func (rm *ReferralManager) GetReferredUsers(referrerID string) []string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	var users []string
	for _, ref := range rm.referrals {
		if ref.ReferrerID == referrerID && ref.ReferredID != "" {
			users = append(users, ref.ReferredID)
		}
	}
	return users
}

func (rm *ReferralManager) CalculateCommission(referrerID string, volume float64) (float64, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	referrerCode, exists := rm.userReferrals[referrerID]
	if !exists {
		return 0, errors.New("referrer not found")
	}

	referralID := rm.referralCodes[referrerCode]
	referral, exists := rm.referrals[referralID]
	if !exists {
		return 0, errors.New("referral not found")
	}

	commission := volume * (referral.CommissionRate / 100)
	return commission, nil
}

func (rm *ReferralManager) PayCommission(referrerID string, amount float64) error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	referrerCode, exists := rm.userReferrals[referrerID]
	if !exists {
		return errors.New("referrer not found")
	}

	referralID := rm.referralCodes[referrerCode]
	referral, exists := rm.referrals[referralID]
	if !exists {
		return errors.New("referral not found")
	}

	referral.CommissionPaid += amount
	return nil
}

func (rm *ReferralManager) GetPrograms() []*ReferralProgram {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	programs := make([]*ReferralProgram, 0, len(rm.programs))
	for _, p := range rm.programs {
		programs = append(programs, p)
	}
	return programs
}

func (rm *ReferralManager) GetProgram(programID string) (*ReferralProgram, error) {
	rm.mu.RLock()
	defer cm.mu.RUnlock()

	program, exists := rm.programs[programID]
	if !exists {
		return nil, errors.New("program not found")
	}
	return program, nil
}

func (rm *ReferralManager) GetStats() ReferralStats {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	stats := ReferralStats{
		TotalReferrals:      len(rm.referrals),
		ActiveReferrals:     0,
		TotalCommissionPaid: 0,
		TopReferrers:        0,
	}

	for _, ref := range rm.referrals {
		if ref.Status == "completed" {
			stats.ActiveReferrals++
		}
		stats.TotalCommissionPaid += ref.CommissionPaid
	}

	// Count unique referrers
	uniqueReferrers := make(map[string]bool)
	for _, ref := range rm.referrals {
		uniqueReferrers[ref.ReferrerID] = true
	}
	stats.TopReferrers = len(uniqueReferrers)

	return stats
}

func (rm *ReferralManager) ValidateReferral(code string) (bool, error) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	referralID, exists := rm.referralCodes[code]
	if !exists {
		return false, errors.New("referral code not found")
	}

	referral, exists := rm.referrals[referralID]
	if !exists {
		return false, errors.New("referral not found")
	}

	// Check if code is still valid (within valid days)
	daysValid := 30 // Default from program
	if referral.Status == "completed" {
		validUntil := referral.CreatedAt.AddDate(0, 0, daysValid)
		if time.Now().After(validUntil) {
			return false, errors.New("referral code expired")
		}
	}

	return true, nil
}

func generateReferralCode() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes)[:8], nil
}
