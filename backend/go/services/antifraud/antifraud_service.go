// TigerEx Anti-Fraud Service
// Fraud detection and prevention

package antifraud

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	RiskLevelLow    = "low"
	RiskLevelMedium = "medium"
	RiskLevelHigh   = "high"
	RiskLevelCritical = "critical"

	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusRejected = "rejected"
	StatusReview   = "review"
)

type RiskProfile struct {
	UserID           string  `json:"user_id"`
	OverallRiskScore int    `json:"overall_risk_score"`
	LoginRisk       int    `json:"login_risk"`
	TransactionRisk int    `json:"transaction_risk"`
	WithdrawalRisk  int    `json:"withdrawal_risk"`
	LastUpdated     time.Time `json:"last_updated"`
}

type FraudAlert struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Type        string    `json:"type"`
	Severity    string    `json:"severity"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	ResolvedBy  string    `json:"resolved_by"`
	CreatedAt   time.Time `json:"created_at"`
	ResolvedAt  time.Time `json:"resolved_at"`
}

type TransactionFlag struct {
	ID          string    `json:"id"`
	TransactionID string  `json:"transaction_id"`
	UserID      string    `json:"user_id"`
	FlagType    string    `json:"flag_type"`
	Reason      string    `json:"reason"`
	RiskScore   int       `json:"risk_score"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

type BlacklistEntry struct {
	Type      string    `json:"type"` // email, ip, phone, wallet
	Value     string    `json:"value"`
	Reason    string    `json:"reason"`
	AddedBy   string    `json:"added_by"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type AntiFraudManager struct {
	mu            sync.RWMutex
	riskProfiles  map[string]*RiskProfile
	alerts        map[string]*FraudAlert
	flags         map[string]*TransactionFlag
	blacklist     map[string]*BlacklistEntry
	alertCounter  int
}

func NewAntiFraudManager() *AntiFraudManager {
	return &AntiFraudManager{
		riskProfiles: make(map[string]*RiskProfile),
		alerts:       make(map[string]*FraudAlert),
		flags:        make(map[string]*TransactionFlag),
		blacklist:    make(map[string]*BlacklistEntry),
	}
}

func (afm *AntiFraudManager) GetRiskProfile(userID string) (*RiskProfile, error) {
	afm.mu.RLock()
	defer afm.mu.RUnlock()

	profile, exists := afm.riskProfiles[userID]
	if !exists {
		return &RiskProfile{
			UserID:           userID,
			OverallRiskScore: 0,
			LoginRisk:       0,
			TransactionRisk: 0,
			WithdrawalRisk:  0,
			LastUpdated:     time.Now(),
		}, nil
	}
	return profile, nil
}

func (afm *AntiFraudManager) UpdateRiskProfile(userID string, score int, riskType string) error {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	profile, exists := afm.riskProfiles[userID]
	if !exists {
		profile = &RiskProfile{
			UserID:       userID,
			LastUpdated:  time.Now(),
		}
		afm.riskProfiles[userID] = profile
	}

	switch riskType {
	case "login":
		profile.LoginRisk = score
	case "transaction":
		profile.TransactionRisk = score
	case "withdrawal":
		profile.WithdrawalRisk = score
	}

	// Calculate overall score
	profile.OverallRiskScore = (profile.LoginRisk + profile.TransactionRisk + profile.WithdrawalRisk) / 3
	profile.LastUpdated = time.Now()

	return nil
}

func (afm *AntiFraudManager) CreateAlert(userID, alertType, severity, description string) (*FraudAlert, error) {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	now := time.Now()
	afm.alertCounter++

	alert := &FraudAlert{
		ID:          fmt.Sprintf("ALERT%d%d", now.Unix(), afm.alertCounter),
		UserID:      userID,
		Type:        alertType,
		Severity:    severity,
		Description: description,
		Status:      StatusPending,
		CreatedAt:   now,
	}

	afm.alerts[alert.ID] = alert
	return alert, nil
}

func (afm *AntiFraudManager) GetAlerts(userID string) []*FraudAlert {
	afm.mu.RLock()
	defer afm.mu.RUnlock()

	var userAlerts []*FraudAlert
	for _, alert := range afm.alerts {
		if alert.UserID == userID {
			userAlerts = append(userAlerts, alert)
		}
	}
	return userAlerts
}

func (afm *AntiFraudManager) ResolveAlert(alertID, resolverID, resolution string) error {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	alert, exists := afm.alerts[alertID]
	if !exists {
		return errors.New("alert not found")
	}

	alert.Status = resolution
	alert.ResolvedBy = resolverID
	alert.ResolvedAt = time.Now()

	return nil
}

func (afm *AntiFraudManager) FlagTransaction(txID, userID, flagType, reason string, riskScore int) (*TransactionFlag, error) {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	flag := &TransactionFlag{
		ID:            fmt.Sprintf("FLAG%d%d", time.Now().Unix(), time.Now().Nanosecond()),
		TransactionID: txID,
		UserID:        userID,
		FlagType:      flagType,
		Reason:        reason,
		RiskScore:     riskScore,
		Status:        StatusPending,
		CreatedAt:    time.Now(),
	}

	afm.flags[txID] = flag
	return flag, nil
}

func (afm *AntiFraudManager) ApproveTransaction(txID string) error {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	flag, exists := afm.flags[txID]
	if !exists {
		return errors.New("flag not found")
	}

	flag.Status = StatusApproved
	return nil
}

func (afm *AntiFraudManager) RejectTransaction(txID string) error {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	flag, exists := afm.flags[txID]
	if !exists {
		return errors.New("flag not found")
	}

	flag.Status = StatusRejected
	return nil
}

func (afm *AntiFraudManager) CheckBlacklist(entryType, value string) (bool, error) {
	afm.mu.RLock()
	defer afm.mu.RUnlock()

	key := entryType + ":" + value
	entry, exists := afm.blacklist[key]
	if !exists {
		return false, nil
	}

	// Check if expired
	if !entry.ExpiresAt.IsZero() && time.Now().After(entry.ExpiresAt) {
		return false, nil
	}

	return true, nil
}

func (afm *AntiFraudManager) AddToBlacklist(entryType, value, reason, addedBy string, expiresInDays int) error {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	key := entryType + ":" + value

	var expiresAt *time.Time
	if expiresInDays > 0 {
		t := time.Now().AddDate(0, 0, expiresInDays)
		expiresAt = &t
	}

	entry := &BlacklistEntry{
		Type:      entryType,
		Value:     value,
		Reason:    reason,
		AddedBy:   addedBy,
		CreatedAt: time.Now(),
	}

	if expiresAt != nil {
		entry.ExpiresAt = *expiresAt
	}

	afm.blacklist[key] = entry
	return nil
}

func (afm *AntiFraudManager) RemoveFromBlacklist(entryType, value string) error {
	afm.mu.Lock()
	defer afm.mu.Unlock()

	key := entryType + ":" + value
	delete(afm.blacklist, key)
	return nil
}

func (afm *AntiFraudManager) AnalyzeTransaction(userID, txType string, amount float64, metadata map[string]string) (int, string, error) {
	riskScore := 0
	var reasons []string

	// Check amount thresholds
	if amount > 10000 {
		riskScore += 20
		reasons = append(reasons, "large_amount")
	}
	if amount > 50000 {
		riskScore += 30
		reasons = append(reasons, "very_large_amount")
	}

	// Check transaction frequency
	// In production, check recent transaction count

	// Check for suspicious patterns
	// In production, check for layering, smurfing, etc.

	riskLevel := RiskLevelLow
	if riskScore >= 70 {
		riskLevel = RiskLevelCritical
	} else if riskScore >= 50 {
		riskLevel = RiskLevelHigh
	} else if riskScore >= 30 {
		riskLevel = RiskLevelMedium
	}

	return riskScore, riskLevel, nil
}

func (afm *AntiFraudManager) AnalyzeLogin(userID, ip, deviceID string) (int, string, error) {
	riskScore := 0

	// Check for new device
	// Check for new IP location
	// Check for multiple failed attempts

	riskLevel := RiskLevelLow
	if riskScore >= 50 {
		riskLevel = RiskLevelHigh
	}

	return riskScore, riskLevel, nil
}

func (afm *AntiFraudManager) GetStats() map[string]interface{} {
	afm.mu.RLock()
	defer afm.mu.RUnlock()

	pendingAlerts := 0
	highRiskProfiles := 0

	for _, alert := range afm.alerts {
		if alert.Status == StatusPending {
			pendingAlerts++
		}
	}

	for _, profile := range afm.riskProfiles {
		if profile.OverallRiskScore >= 70 {
			highRiskProfiles++
		}
	}

	return map[string]interface{}{
		"total_alerts":        len(afm.alerts),
		"pending_alerts":     pendingAlerts,
		"total_flags":        len(afm.flags),
		"blacklist_entries":  len(afm.blacklist),
		"high_risk_profiles": highRiskProfiles,
	}
}
