// TigerEx Fraud Detection
// Real-time fraud detection and prevention
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"
)

type Transaction struct {
	ID          string
	UserID     string
	Amount     float64
	Currency   string
	Type       string
	IPAddress  string
	DeviceID   string
	Location   string
	Timestamp  time.Time
	RiskScore  float64
	Flags      []string
}

type FraudRule struct {
	ID          string
	Name        string
	Type        string
	Threshold   float64
	Weight      float64
	Enabled     bool
}

type FraudAlert struct {
	ID          string
	UserID     string
	TransactionID string
	Severity   string
	RuleID     string
	Description string
	Timestamp  time.Time
	Status     string
}

type FraudDetector struct {
	mu           sync.RWMutex
	rules        map[string]*FraudRule
	transactions map[string]*Transaction
	alerts       map[string]*FraudAlert
	userProfiles map[string]*UserProfile
	stats        FraudStats
}

type UserProfile struct {
	UserID          string
	AvgTransaction  float64
	MaxTransaction   float64
	TotalVolume     float64
	TransactionCount int
	Locations       map[string]int
	Devices         map[string]int
	LoginIPs        map[string]int
}

type FraudStats struct {
	TransactionsChecked int64
	FraudDetected      int64
	AlertsGenerated    int64
	FalsePositives     int64
}

func NewFraudDetector() *FraudDetector {
	fd := &FraudDetector{
		rules:        make(map[string]*FraudRule),
		transactions: make(map[string]*Transaction),
		alerts:       make(map[string]*FraudAlert),
		userProfiles: make(map[string]*UserProfile),
	}
	
	fd.initRules()
	return fd
}

func (fd *FraudDetector) initRules() {
	rules := []*FraudRule{
		{ID: "R001", Name: "Large Transaction", Type: "amount", Threshold: 10000, Weight: 30, Enabled: true},
		{ID: "R002", Name: "Velocity Check", Type: "frequency", Threshold: 10, Weight: 25, Enabled: true},
		{ID: "R003", Name: "New Device", Type: "device", Threshold: 1, Weight: 20, Enabled: true},
		{ID: "R004", Name: "New Location", Type: "location", Threshold: 1, Weight: 15, Enabled: true},
		{ID: "R005", Name: "Impossible Travel", Type: "location", Threshold: 0, Weight: 40, Enabled: true},
		{ID: "R006", Name: "Account Takeover", Type: "behavior", Threshold: 0, Weight: 50, Enabled: true},
	}
	
	for _, r := range rules {
		fd.rules[r.ID] = r
	}
}

func (fd *FraudDetector) AnalyzeTransaction(tx *Transaction) *Transaction {
	fd.mu.Lock()
	defer fd.mu.Unlock()
	
	fd.stats.TransactionsChecked++
	
	riskScore := 0.0
	flags := []string{}
	
	// Get user profile
	profile := fd.getOrCreateProfile(tx.UserID)
	
	// Rule 1: Large Transaction
	if tx.Amount > 10000 {
		riskScore += 30
		flags = append(flags, "LARGE_TRANSACTION")
	}
	
	// Rule 2: Velocity (multiple transactions in short time)
	if profile.TransactionCount > 10 {
		riskScore += 25
		flags = append(flags, "HIGH_VELOCITY")
	}
	
	// Rule 3: New Device
	if _, exists := profile.Devices[tx.DeviceID]; !exists && tx.DeviceID != "" {
		riskScore += 20
		flags = append(flags, "NEW_DEVICE")
	}
	
	// Rule 4: New Location
	if _, exists := profile.Locations[tx.Location]; !exists && tx.Location != "" {
		riskScore += 15
		flags = append(flags, "NEW_LOCATION")
	}
	
	// Rule 5: Unusual Amount
	if tx.Amount > profile.AvgTransaction*10 {
		riskScore += 25
		flags = append(flags, "UNUSUAL_AMOUNT")
	}
	
	// Update profile
	profile.TransactionCount++
	profile.TotalVolume += tx.Amount
	profile.AvgTransaction = profile.TotalVolume / float64(profile.TransactionCount)
	
	if tx.Amount > profile.MaxTransaction {
		profile.MaxTransaction = tx.Amount
	}
	
	if tx.Location != "" {
		profile.Locations[tx.Location]++
	}
	
	if tx.DeviceID != "" {
		profile.Devices[tx.DeviceID]++
	}
	
	// Store transaction
	tx.RiskScore = riskScore
	tx.Flags = flags
	fd.transactions[tx.ID] = tx
	
	// Generate alert if high risk
	if riskScore >= 50 {
		fd.stats.FraudDetected++
		alert := &FraudAlert{
			ID:             fmt.Sprintf("ALERT_%d", time.Now().Unix()),
			UserID:         tx.UserID,
			TransactionID:  tx.ID,
			Severity:       "HIGH",
			RuleID:         "MULTIPLE",
			Description:    fmt.Sprintf("High risk score: %.2f", riskScore),
			Timestamp:      time.Now(),
			Status:         "OPEN",
		}
		fd.alerts[alert.ID] = alert
		fd.stats.AlertsGenerated++
	}
	
	return tx
}

func (fd *FraudDetector) getOrCreateProfile(userID string) *UserProfile {
	if profile, exists := fd.userProfiles[userID]; exists {
		return profile
	}
	
	profile := &UserProfile{
		UserID:     userID,
		Locations:  make(map[string]int),
		Devices:    make(map[string]int),
		LoginIPs:   make(map[string]int),
	}
	
	fd.userProfiles[userID] = profile
	return profile
}

func (fd *FraudDetector) GetAlerts(status string) []*FraudAlert {
	fd.mu.RLock()
	defer fd.mu.RUnlock()
	
	var result []*FraudAlert
	for _, alert := range fd.alerts {
		if status == "" || alert.Status == status {
			result = append(result, alert)
		}
	}
	
	return result
}

func (fd *FraudDetector) ResolveAlert(alertID, resolution string) error {
	fd.mu.Lock()
	defer fd.mu.Unlock()
	
	if alert, exists := fd.alerts[alertID]; exists {
		alert.Status = "RESOLVED"
		return nil
	}
	
	return fmt.Errorf("alert not found")
}

func (fd *FraudDetector) GetStats() FraudStats {
	fd.mu.RLock()
	defer fd.mu.RUnlock()
	return fd.stats
}

func main() {
	fmt.Println("TigerEx Fraud Detection")
	fmt.Println("=====================")
	
	detector := NewFraudDetector()
	
	// Analyze transactions
	tx1 := &Transaction{
		ID: "TX001", UserID: "user1", Amount: 5000, Currency: "USD",
		Location: "US", DeviceID: "device1", Timestamp: time.Now(),
	}
	detector.AnalyzeTransaction(tx1)
	
	tx2 := &Transaction{
		ID: "TX002", UserID: "user1", Amount: 50000, Currency: "USD",
		Location: "CN", DeviceID: "device2", Timestamp: time.Now(),
	}
	detector.AnalyzeTransaction(tx2)
	
	tx3 := &Transaction{
		ID: "TX003", UserID: "user1", Amount: 150000, Currency: "USD",
		Location: "RU", DeviceID: "device3", Timestamp: time.Now(),
	}
	detector.AnalyzeTransaction(tx3)
	
	// Check alerts
	alerts := detector.GetAlerts("")
	fmt.Printf("\nAlerts: %d\n", len(alerts))
	for _, a := range alerts {
		fmt.Printf("  [%s] %s - %s\n", a.Severity, a.TransactionID, a.Description)
	}
	
	// Stats
	stats := detector.GetStats()
	fmt.Printf("\nStats:\n")
	fmt.Printf("  Checked: %d\n", stats.TransactionsChecked)
	fmt.Printf("  Detected: %d\n", stats.FraudDetected)
	fmt.Printf("  Alerts: %d\n", stats.AlertsGenerated)
}
