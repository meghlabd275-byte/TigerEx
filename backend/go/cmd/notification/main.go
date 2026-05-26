// Package Notification provides notification service
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type NotificationType string
type NotificationChannel string

const (
	TypeTrade      NotificationType = "trade"
	TypeOrder     NotificationType = "order"
	TypeDeposit   NotificationType = "deposit"
	TypeWithdrawal NotificationType = "withdrawal"
	TypeSecurity  NotificationType = "security"
	TypeMarketing NotificationType = "marketing"

	ChannelEmail    NotificationChannel = "email"
	ChannelSMS     NotificationChannel = "sms"
	ChannelPush    NotificationChannel = "push"
	ChannelWebhook NotificationChannel = "webhook"
)

// ============================================================================
// NOTIFICATION
// ============================================================================

type Notification struct {
	ID          string               `json:"id"`
	UserID     string               `json:"userId"`
	Type       NotificationType     `json:"type"`
	Channel   NotificationChannel  `json:"channel"`
	Title     string              `json:"title"`
	Body      string              `json:"body"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Read      bool                `json:"read"`
	SentAt    *time.Time          `json:"sentAt,omitempty"`
	CreatedAt time.Time           `json:"createdAt"`
}

type UserPreferences struct {
	UserID       string               `json:"userId"`
	EmailEnabled bool                `json:"emailEnabled"`
	SMSEnabled  bool                `json:"smsEnabled"`
	PushEnabled bool                `json:"pushEnabled"`
	Channels   []NotificationChannel `json:"channels"`
}

// ============================================================================
// NOTIFICATION SERVICE
// ============================================================================

type NotificationService struct {
	mu           sync.RWMutex
	notifications map[string][]*Notification
	preferences  map[string]*UserPreferences
	queue        chan *Notification
	counter      uint64
}

func NewNotificationService() *NotificationService {
	ns := &NotificationService{
		notifications: make(map[string][]*Notification),
		preferences:  make(map[string]*UserPreferences),
		queue:        make(chan *Notification, 10000),
	}
	go ns.processQueue()
	return ns
}

func (ns *NotificationService) processQueue() {
	for {
		select {
		case notif := <-ns.queue:
			ns.sendNotification(notif)
		}
	}
}

func (ns *NotificationService) sendNotification(notif *Notification) {
	// Simulate sending - in production, integrate with SendGrid, Twilio, etc.
	fmt.Printf("Sending %s notification to user %s via %s\n", 
		notif.Type, notif.UserID, notif.Channel)
	
	now := time.Now()
	notif.SentAt = &now
}

// ============================================================================
// NOTIFICATION OPERATIONS
// ============================================================================

func (ns *NotificationService) Send(userID string, notifType NotificationType, 
	title, body string, data map[string]interface{}) {
	
	ns.mu.Lock()
	defer ns.mu.Unlock()

	prefs, ok := ns.preferences[userID]
	
	channels := []NotificationChannel{ChannelEmail}
	if ok {
		channels = prefs.Channels
	}

	for _, channel := range channels {
		ns.counter++
		notif := &Notification{
			ID:        fmt.Sprintf("notif_%d", ns.counter),
			UserID:    userID,
			Type:      notifType,
			Channel:   channel,
			Title:     title,
			Body:      body,
			Data:      data,
			Read:      false,
			CreatedAt: time.Now(),
		}

		// Queue for sending
		ns.queue <- notif

		// Store
		ns.notifications[userID] = append(ns.notifications[userID], notif)
	}
}

func (ns *NotificationService) SendTradeNotification(userID string, symbol string, side string, price float64, qty float64) {
	title := fmt.Sprintf("%s Order Filled", symbol)
	body := fmt.Sprintf("Your %s order for %s has been filled at $%.2f", 
		side, symbol, price)
	
	ns.Send(userID, TypeTrade, title, body, map[string]interface{}{
		"symbol": symbol,
		"side":   side,
		"price":  price,
		"qty":    qty,
	})
}

func (ns *NotificationService) SendSecurityAlert(userID, alertType, message string) {
	ns.Send(userID, TypeSecurity, "Security Alert: "+alertType, message, map[string]interface{}{
		"alertType": alertType,
	})
}

func (ns *NotificationService) GetUserNotifications(userID string, limit int) []*Notification {
	ns.mu.RLock()
	defer ns.mu.RUnlock()

	notifs := ns.notifications[userID]
	if len(notifs) > limit {
		return notifs[len(notifs)-limit:]
	}
	return notifs
}

func (ns *NotificationService) MarkAsRead(notifID, userID string) error {
	ns.mu.Lock()
	defer ns.mu.Unlock()

	for _, notif := range ns.notifications[userID] {
		if notif.ID == notifID {
			notif.Read = true
			return nil
		}
	}
	return fmt.Errorf("notification not found")
}

func (ns *NotificationService) UpdatePreferences(prefs *UserPreferences) {
	ns.mu.Lock()
	defer ns.mu.Unlock()
	ns.preferences[prefs.UserID] = prefs
}

func (ns *NotificationService) GetUnreadCount(userID string) int {
	ns.mu.RLock()
	defer ns.mu.RUnlock()

	count := 0
	for _, notif := range ns.notifications[userID] {
		if !notif.Read {
			count++
		}
	}
	return count
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	ns := NewNotificationService()

	// Set user preferences
	ns.UpdatePreferences(&UserPreferences{
		UserID:       "user123",
		EmailEnabled: true,
		SMSEnabled:  true,
		PushEnabled:  true,
		Channels:    []NotificationChannel{ChannelEmail, ChannelPush},
	})

	// Send notifications
	ns.SendTradeNotification("user123", "BTC/USDT", "BUY", 50000.0, 0.5)
	ns.SendSecurityAlert("user123", "Login", "New login from new device")

	// Get notifications
	notifs := ns.GetUserNotifications("user123", 10)
	fmt.Printf("User has %d notifications\n", len(notifs))
	
	unread := ns.GetUnreadCount("user123")
	fmt.Printf("Unread: %d\n", unread)
}