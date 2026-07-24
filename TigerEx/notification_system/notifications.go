// TigerEx Notification System
// Built with Go for high-load worldwide distributed systems

package main

import (
	"fmt"
	"sync"
	"time"
)

type Notification struct {
	ID        string
	UserID   string
	Type     string
	Title    string
	Message  string
	Channel  string
	Status   string
	SentAt   *time.Time
	CreatedAt time.Time
}

type Subscriber struct {
	ID      string
	UserID  string
	Channels []string
}

type NotificationService struct {
	mu           sync.RWMutex
	notifications map[string]*Notification
	subscribers   map[string]*Subscriber
	channels     []string
	stats        NotificationStats
}

type NotificationStats struct {
	TotalSent    int64
	TotalFailed  int64
	EmailSent    int64
	SMSsent      int64
	PushSent     int64
}

func NewNotificationService() *NotificationService {
	return &NotificationService{
		notifications: make(map[string]*Notification),
		subscribers:   make(map[string]*Subscriber),
		channels:     []string{"email", "sms", "push", "telegram"},
	}
}

func (ns *NotificationService) Send(userID, notifType, title, message, channel string) *Notification {
	ns.mu.Lock()
	defer ns.mu.Unlock()
	
	notif := &Notification{
		ID: generateNotifID(),
		UserID: userID,
		Type: notifType,
		Title: title,
		Message: message,
		Channel: channel,
		Status: "SENT",
		CreatedAt: time.Now(),
	}
	
	// Simulate sending
	ns.notifications[notif.ID] = notif
	ns.stats.TotalSent++
	
	switch channel {
	case "email":
		ns.stats.EmailSent++
	case "sms":
		ns.stats.SMSsent++
	case "push":
		ns.stats.PushSent++
	}
	
	now := time.Now()
	notif.SentAt = &now
	
	return notif
}

func (ns *NotificationService) SendBatch(userIDs []string, notifType, title, message, channel string) {
	for _, userID := range userIDs {
		ns.Send(userID, notifType, title, message, channel)
	}
}

func (ns *NotificationService) Subscribe(userID string, channels []string) {
	ns.mu.Lock()
	defer ns.mu.Unlock()
	
	sub := &Subscriber{
		ID: generateSubID(),
		UserID: userID,
		Channels: channels,
	}
	
	ns.subscribers[userID] = sub
}

func (ns *NotificationService) GetUserNotifications(userID string) []*Notification {
	ns.mu.RLock()
	defer ns.mu.RUnlock()
	
	var result []*Notification
	for _, n := range ns.notifications {
		if n.UserID == userID {
			result = append(result, n)
		}
	}
	
	return result
}

func (ns *NotificationService) GetStats() NotificationStats {
	ns.mu.RLock()
	defer ns.mu.RUnlock()
	return ns.stats
}

func generateNotifID() string {
	return fmt.Sprintf("NOTIF_%d", time.Now().UnixNano())
}

func generateSubID() string {
	return fmt.Sprintf("SUB_%d", time.Now().UnixNano())
}

func main() {
	fmt.Println("TigerEx Notification System")
	fmt.Println("==========================")
	
	ns := NewNotificationService()
	
	// Subscribe user
	ns.Subscribe("user1", []string{"email", "push"})
	ns.Subscribe("user2", []string{"telegram", "sms"})
	
	// Send notifications
	ns.Send("user1", "deposit", "Deposit Confirmed", "Your deposit of 1 BTC has been confirmed", "email")
	ns.Send("user1", "withdrawal", "Withdrawal Processed", "Your withdrawal of 0.5 BTC is being processed", "push")
	ns.Send("user2", "alert", "Price Alert", "BTC has reached $55,000", "telegram")
	
	// Batch send
	users := []string{"user1", "user2", "user3"}
	ns.SendBatch(users, "system", "Maintenance", "System maintenance in 1 hour", "email")
	
	// Get notifications
	notifs := ns.GetUserNotifications("user1")
	fmt.Printf("\nUser1 Notifications: %d\n", len(notifs))
	for _, n := range notifs {
		fmt.Printf("  - [%s] %s: %s\n", n.Type, n.Title, n.Status)
	}
	
	// Stats
	stats := ns.GetStats()
	fmt.Printf("\nStats:\n")
	fmt.Printf("  Total: %d\n", stats.TotalSent)
	fmt.Printf("  Email: %d\n", stats.EmailSent)
	fmt.Printf("  Push: %d\n", stats.PushSent)
}
