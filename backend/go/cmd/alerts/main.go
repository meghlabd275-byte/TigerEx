// Package alerts provides alerting services.
// Migrated from TypeScript to Go for monitoring and alerts.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Alert type
type AlertType struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Severity   string  `json:"severity"` // info, warning, critical
	Condition string  `json:"condition"`
	Threshold float64 `json:"threshold"`
}

// Alert
type Alert struct {
	ID         string  `json:"id"`
	TypeID    string  `json:"typeId"`
	UserID   string  `json:"userId"`
	Message string  `json:"message"`
	Severity string  `json:"severity"`
	Status  string  `json:"status"` // active, acknowledged, resolved
	CreatedAt int64  `json:"createdAt"`
	ResolvedAt int64 `json:"resolvedAt"`
}

// Subscription
type AlertSubscription struct {
	UserID     string  `json:"userId"`
	TypeIds    []string `json:"typeIds"`
	Channels  []string `json:"channels"` // email, sms, telegram, push
}

// Store
type AlertStore struct {
	mu             sync.RWMutex
	alertTypes     map[string]*AlertType
	alerts        map[string]*Alert
	subscriptions map[string]*AlertSubscription
}

var (
	alertStore = &AlertStore{
		alertTypes: make(map[string]*AlertType),
		alerts: make(map[string]*Alert),
		subscriptions: make(map[string]*AlertSubscription),
	}
)

// Initialize default alert types
func init() {
	types := []*AlertType{
		{ID: "price_drop", Name: "Price Drop Alert", Severity: "warning", Condition: "price_change", Threshold: -5.0},
		{ID: "price_spike", Name: "Price Spike Alert", Severity: "warning", Condition: "price_change", Threshold: 5.0},
		{ID: "volume_spike", Name: "Volume Spike", Severity: "info", Condition: "volume_change", Threshold: 10.0},
		{ID: "withdrawal_large", Name: "Large Withdrawal", Severity: "critical", Condition: "amount", Threshold: 10000},
		{ID: "login_new_device", Name: "New Device Login", Severity: "warning", Condition: "login", Threshold: 1},
		{ID: "liquidation_warning", Name: "Liquidation Warning", Severity: "critical", Condition: "margin", Threshold: 0.15},
	}

	alertStore.mu.Lock()
	defer alertStore.mu.Unlock()

	for _, t := range types {
		alertStore.alertTypes[t.ID] = t
	}
}

// Create alert
func CreateAlert(alertTypeID, userID, message string) *Alert {
	alertType, _ := alertStore.alertTypes[alertTypeID]

	alert := &Alert{
		ID: fmt.Sprintf("alert_%d", time.Now().UnixNano()),
		TypeID: alertTypeID,
		UserID: userID,
		Message: message,
		Severity: alertType.Severity,
		Status: "active",
		CreatedAt: time.Now().UnixMilli(),
	}

	alertStore.mu.Lock()
	defer alertStore.mu.Unlock()
	alertStore.alerts[alert.ID] = alert

	return alert
}

// Resolve alert
func ResolveAlert(alertID string) error {
	alertStore.mu.Lock()
	defer alertStore.mu.Unlock()

	alert, ok := alertStore.alerts[alertID]
	if !ok {
		return fmt.Errorf("alert not found")
	}

	alert.Status = "resolved"
	alert.ResolvedAt = time.Now().UnixMilli()

	return nil
}

// Subscribe to alerts
func Subscribe(userID string, typeIDs, channels []string) *AlertSubscription {
	sub := &AlertSubscription{
		UserID: userID,
		TypeIds: typeIDs,
		Channels: channels,
	}

	alertStore.mu.Lock()
	defer alertStore.mu.Unlock()
	alertStore.subscriptions[userID] = sub

	return sub
}

// Get user alerts
func GetUserAlerts(userID string) []*Alert {
	alertStore.mu.RLock()
	defer alertStore.mu.RUnlock()

	var result []*Alert
	for _, a := range alertStore.alerts {
		if a.UserID == userID && a.Status == "active" {
			result = append(result, a)
		}
	}
	return result
}

// Check threshold (simulated price monitoring)
func CheckPriceAlert(symbol string, priceChange float64) {
	alertStore.mu.RLock()
	defer alertStore.mu.RUnlock()

	for _, t := range alertStore.alertTypes {
		if t.Condition == "price_change" {
			switch t.ID {
			case "price_drop":
				if priceChange < -t.Threshold {
					CreateAlert(t.ID, "system", fmt.Sprintf("Price dropped %.2f%% on %s", priceChange, symbol))
				}
			case "price_spike":
				if priceChange > t.Threshold {
					CreateAlert(t.ID, "system", fmt.Sprintf("Price spiked %.2f%% on %s", priceChange, symbol))
				}
			}
		}
	}
}

func main() {
	fmt.Println("Alerts service initialized")

	// Show alert types
	for _, t := range alertStore.alertTypes {
		fmt.Printf("Type: %s - %s [%s]\n", t.ID, t.Name, t.Severity)
	}

	// Subscribe
	sub := Subscribe("user_001", []string{"price_drop", "price_spike"}, []string{"email", "push"})
	fmt.Printf("Subscribed to %d alert types\n", len(sub.TypeIds))

	// Create alert
	alert := CreateAlert("withdrawal_large", "user_002", "Large withdrawal request: $15,000")
	fmt.Printf("Alert: %s - %s\n", alert.Message, alert.Severity)

	// User alerts
	userAlerts := GetUserAlerts("user_002")
	fmt.Printf("User alerts: %d active\n", len(userAlerts))
}