// Package notification_service handles push notifications.
// Migrated from TypeScript to Go for real-time notifications.
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Notification type
type NotificationType string

const (
	TypeOrderFilled   NotificationType = "order_filled"
	TypeOrderCancelled NotificationType = "order_cancelled"
	TypePriceAlert   NotificationType = "price_alert"
	TypeDeposits     NotificationType = "deposit"
	TypeWithdrawal  NotificationType = "withdrawal"
	TypeSecurity   NotificationType = "security"
	TypeMarketing NotificationType = "marketing"
)

// Notification represents a notification
type Notification struct {
	ID        string            `json:"id"`
	UserID   string            `json:"userId"`
	Type     NotificationType `json:"type"`
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Data    map[string]interface{} `json:"data,omitempty"`
	Read    bool              `json:"read"`
	SentAt  int64             `json:"sentAt"`
}

// Push token for mobile devices
type PushToken struct {
	UserID   string `json:"userId"`
	Token   string `json:"token"`
	Device  string `json:"device"` // ios, android, web
	Active  bool   `json:"active"`
}

// Preferences for notifications
type NotificationPrefs struct {
	UserID           string `json:"userId"`
	OrderNotifications bool `json:"orderNotifications"`
	PriceAlerts     bool   `json:"priceAlerts"`
	Deposits        bool   `json:"deposits"`
	Withdrawals     bool   `json:"withdrawals"`
	Marketing      bool   `json:"marketing"`
	EmailDigest    bool   `json:"emailDigest"`
	SMS            bool   `json:"sms"`
}

// Store for notifications
type NotifStore struct {
	mu          sync.RWMutex
	notifications map[string][]*Notification
	tokens       map[string][]*PushToken
	prefs        map[string]*NotificationPrefs
}

var (
	nStore = &NotifStore{
		notifications: make(map[string][]*Notification),
		tokens:       make(map[string][]*PushToken),
		prefs:        make(map[string]*NotificationPrefs),
	}
)

// Send notification
func SendNotification(userID string, notif *Notification) {
	notif.SentAt = time.Now().UnixMilli()

	nStore.mu.Lock()
	defer nStore.mu.Unlock()
	nStore.notifications[userID] = append(nStore.notifications[userID], notif)

	// Here we would integrate with FCM/APNs
	fmt.Printf("Sent notification to %s: %s\n", userID, notif.Title)
}

// Register push token
func RegisterToken(userID string, token *PushToken) {
	nStore.mu.Lock()
	defer nStore.mu.Unlock()
	nStore.tokens[userID] = append(nStore.tokens[userID], token)
}

// Get notifications for user
func GetNotifications(userID string) []*Notification {
	nStore.mu.RLock()
	defer nStore.mu.RUnlock()

	return nStore.notifications[userID]
}

// Mark as read
func MarkRead(userID, notifID string) error {
	nStore.mu.Lock()
	defer nStore.mu.Unlock()

	list := nStore.notifications[userID]
	for _, n := range list {
		if n.ID == notifID {
			n.Read = true
			return nil
		}
	}
	return fmt.Errorf("notification not found")
}

// Get unread count
func GetUnreadCount(userID string) int {
	nStore.mu.RLock()
	defer nStore.mu.RUnlock()

	count := 0
	for _, n := range nStore.notifications[userID] {
		if !n.Read {
			count++
		}
	}
	return count
}

// Set preferences
func SetPreferences(prefs *NotificationPrefs) {
	nStore.mu.Lock()
	defer nStore.mu.Unlock()
	nStore.prefs[prefs.UserID] = prefs
}

// Get preferences
func GetPreferences(userID string) *NotificationPrefs {
	nStore.mu.RLock()
	defer nStore.mu.RUnlock()

	return nStore.prefs[userID]
}

// Factory methods for common notifications
func NotifyOrderFilled(userID string, pair string, side string, qty float64) {
	notif := &Notification{
		ID:   fmt.Sprintf("notif_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: TypeOrderFilled,
		Title: "Order Filled",
		Body:  fmt.Sprintf("Your %s order for %s %s has been filled", pair, qty, side),
		Data: map[string]interface{}{
			"pair": pair,
			"side": side,
			"qty": qty,
		},
	}
	SendNotification(userID, notif)
}

func NotifyPriceAlert(userID string, pair string, targetPrice float64, currentPrice float64) {
	direction := "above"
	if currentPrice < targetPrice {
		direction = "below"
	}

	notif := &Notification{
		ID:   fmt.Sprintf("notif_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: TypePriceAlert,
		Title: "Price Alert",
		Body:  fmt.Sprintf("%s is now %s your target of $%.2f", pair, direction, targetPrice),
		Data: map[string]interface{}{
			"pair":      pair,
			"target":   targetPrice,
			"current":  currentPrice,
		},
	}
	SendNotification(userID, notif)
}

func NotifyDeposit(userID string, amount float64, currency string) {
	notif := &Notification{
		ID:   fmt.Sprintf("notif_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: TypeDeposits,
		Title: "Deposit Confirmed",
		Body:  fmt.Sprintf("Your deposit of %.2f %s has been confirmed", amount, currency),
	}
	SendNotification(userID, notif)
}

func NotifySecurityAlert(userID string, message string) {
	notif := &Notification{
		ID:   fmt.Sprintf("notif_%d", time.Now().UnixNano()),
		UserID: userID,
		Type: TypeSecurity,
		Title: "Security Alert",
		Body:  message,
	}
	SendNotification(userID, notif)
}

func main() {
	fmt.Println("Notification service initialized")

	// Demo
	userID := "user_demo"

	// Set preferences
	prefs := &NotificationPrefs{
		UserID:             userID,
		OrderNotifications: true,
		PriceAlerts:        true,
		Deposits:           true,
		Withdrawals:        true,
		Marketing:          false,
		EmailDigest:        true,
		SMS:                false,
	}
	SetPreferences(prefs)

	// Send demo notification
	NotifyOrderFilled(userID, "BTC/USDT", "buy", 0.5)
	fmt.Printf("Unread count: %d\n", GetUnreadCount(userID))
}