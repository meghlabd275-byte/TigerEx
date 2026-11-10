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
	RiskLevelLow      = "low"
	RiskLevelMedium   = "medium"
	RiskLevelHigh     = "high"
	RiskLevelCritical = "critical"

	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusRejected = "rejected"
	StatusReview   = "review"
)

type RiskProfile struct {
	UserID           string    `json:"user_id"`
	OverallRiskScore int       `json:"overall_risk_score"`
	LoginRisk        int       `json:"login_risk"`
	TransactionRisk  int       `json:"transaction_risk"`
	WithdrawalRisk   int       `json:"withdrawal_risk"`
	LastUpdated      time.Time `json:"last_updated"`
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
	ID            string    `json:"id"`
	TransactionID string    `json:"transaction_id"`
	UserID        string    `json:"user_id"`
	FlagType      string    `json:"flag_type"`
	Reason        string    `json:"reason"`
	RiskScore     int       `json:"risk_score"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
}

type BlacklistEntry struct {
	Type      string    `json:"type"` // email, ip, phone, wallet
	Value     string    `json:"value"`
	Reason    string    `json:"reason"`
	AddedBy   string    `json:"added_by"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// transactionEvent is one observed transaction, kept so frequency and
// structuring checks operate on real history rather than an assumption.
type transactionEvent struct {
	Amount    float64
	Type      string
	Timestamp time.Time
}

// loginEvent is one observed login attempt for a user.
type loginEvent struct {
	IP        string
	DeviceID  string
	Success   bool
	Timestamp time.Time
}

type AntiFraudManager struct {
	mu           sync.RWMutex
	riskProfiles map[string]*RiskProfile
	alerts       map[string]*FraudAlert
	flags        map[string]*TransactionFlag
	blacklist    map[string]*BlacklistEntry
	txHistory    map[string][]transactionEvent
	loginHistory map[string][]loginEvent
	alertCounter int
}

func NewAntiFraudManager() *AntiFraudManager {
	return &AntiFraudManager{
		riskProfiles: make(map[string]*RiskProfile),
		alerts:       make(map[string]*FraudAlert),
		flags:        make(map[string]*TransactionFlag),
		blacklist:    make(map[string]*BlacklistEntry),
		txHistory:    make(map[string][]transactionEvent),
		loginHistory: make(map[string][]loginEvent),
	}
}

const (
	// Amounts at or above this are reportable, so a cluster of amounts just
	// below it is the classic structuring (smurfing) pattern.
	structuringThreshold = 10000.0
	structuringWindow    = time.Hour
	txVelocityWindow     = time.Hour
	loginHistoryWindow   = 30 * 24 * time.Hour
)

// RecordLogin records a login attempt so later risk analysis has real history
// to reason about.
func (afm *AntiFraudManager) RecordLogin(userID, ip, deviceID string, success bool) {
	afm.mu.Lock()
	defer afm.mu.Unlock()
	afm.loginHistory[userID] = append(afm.loginHistory[userID], loginEvent{
		IP: ip, DeviceID: deviceID, Success: success, Timestamp: time.Now(),
	})
	if len(afm.loginHistory[userID]) > 1000 {
		afm.loginHistory[userID] = afm.loginHistory[userID][len(afm.loginHistory[userID])-1000:]
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
			LoginRisk:        0,
			TransactionRisk:  0,
			WithdrawalRisk:   0,
			LastUpdated:      time.Now(),
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
			UserID:      userID,
			LastUpdated: time.Now(),
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
		CreatedAt:     time.Now(),
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

func riskLevelFor(score int) string {
	switch {
	case score >= 70:
		return RiskLevelCritical
	case score >= 50:
		return RiskLevelHigh
	case score >= 30:
		return RiskLevelMedium
	default:
		return RiskLevelLow
	}
}

// AnalyzeTransaction scores a transaction against real, recorded history:
// amount thresholds, hourly velocity, and structuring (a run of sub-threshold
// amounts whose sum crosses the reporting threshold).
func (afm *AntiFraudManager) AnalyzeTransaction(userID, txType string, amount float64, metadata map[string]string) (int, string, error) {
	if amount != amount || amount <= 0 || amount > 1e15 {
		return 0, RiskLevelLow, errors.New("transaction amount must be a finite positive value")
	}

	now := time.Now()

	afm.mu.Lock()
	windowStart := now.Add(-txVelocityWindow)
	recent := make([]transactionEvent, 0, len(afm.txHistory[userID])+1)
	for _, ev := range afm.txHistory[userID] {
		if ev.Timestamp.After(windowStart) {
			recent = append(recent, ev)
		}
	}
	afm.txHistory[userID] = append(recent, transactionEvent{Amount: amount, Type: txType, Timestamp: now})
	if len(afm.txHistory[userID]) > 5000 {
		afm.txHistory[userID] = afm.txHistory[userID][len(afm.txHistory[userID])-5000:]
	}
	afm.mu.Unlock()

	riskScore := 0

	if amount >= 10000 {
		riskScore += 20
	}
	if amount >= 50000 {
		riskScore += 30
	}
	if amount >= 250000 {
		riskScore += 20
	}

	// Velocity: a burst of transactions in the window is unusual.
	count := len(recent) + 1
	switch {
	case count >= 50:
		riskScore += 30
	case count >= 20:
		riskScore += 20
	case count >= 10:
		riskScore += 10
	}

	// Structuring: several sub-threshold amounts that together cross the
	// reporting threshold within the window.
	structuringCount := 0
	structuringSum := 0.0
	for _, ev := range recent {
		if ev.Amount < structuringThreshold {
			structuringCount++
			structuringSum += ev.Amount
		}
	}
	if amount < structuringThreshold {
		structuringCount++
		structuringSum += amount
	}
	if structuringCount >= 3 && structuringSum >= structuringThreshold {
		riskScore += 35
	}

	if riskScore > 100 {
		riskScore = 100
	}
	return riskScore, riskLevelFor(riskScore), nil
}

// AnalyzeLogin scores a login attempt against recorded history: unknown
// device, unknown IP, and a run of recent failures (credential stuffing).
func (afm *AntiFraudManager) AnalyzeLogin(userID, ip, deviceID string) (int, string, error) {
	now := time.Now()

	afm.mu.RLock()
	history := afm.loginHistory[userID]
	seenDevice, seenIP := false, false
	windowStart := now.Add(-loginHistoryWindow)
	failures := 0
	for _, ev := range history {
		if ev.DeviceID == deviceID {
			seenDevice = true
		}
		if ev.IP == ip {
			seenIP = true
		}
		if !ev.Success && ev.Timestamp.After(windowStart) {
			failures++
		}
	}
	afm.mu.RUnlock()

	riskScore := 0
	if len(history) > 0 && !seenDevice {
		riskScore += 25
	}
	if len(history) > 0 && !seenIP {
		riskScore += 20
	}
	switch {
	case failures >= 10:
		riskScore += 40
	case failures >= 5:
		riskScore += 25
	case failures >= 3:
		riskScore += 10
	}

	if riskScore > 100 {
		riskScore = 100
	}
	return riskScore, riskLevelFor(riskScore), nil
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
		"total_alerts":       len(afm.alerts),
		"pending_alerts":     pendingAlerts,
		"total_flags":        len(afm.flags),
		"blacklist_entries":  len(afm.blacklist),
		"high_risk_profiles": highRiskProfiles,
	}
}
