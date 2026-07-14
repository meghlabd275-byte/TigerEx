// TigerEx Notification Service
// Multi-channel notification system

package notification

import (
	"fmt"
	"sync"
	"time"
)

const (
	ChannelEmail  = "email"
	ChannelSMS    = "sms"
	ChannelPush   = "push"
	ChannelInApp  = "in_app"

	NotificationTypeOrder       = "order"
	NotificationTypeDeposit      = "deposit"
	NotificationTypeWithdrawal  = "withdrawal"
	NotificationTypeTrade        = "trade"
	NotificationTypeStaking      = "staking"
	NotificationTypeAlert        = "alert"
	NotificationTypeSecurity     = "security"
	NotificationTypeMarketing    = "marketing"

	PriorityLow     = "low"
	PriorityNormal  = "normal"
	PriorityHigh    = "high"
	PriorityUrgent  = "urgent"

	StatusPending   = "pending"
	StatusSent      = "sent"
	StatusDelivered = "delivered"
	StatusFailed    = "failed"
	StatusRead      = "read"
)

type Notification struct {
	ID        string            `json:"id"`
	UserID    string            `json:"user_id"`
	Type      string            `json:"type"`
	Title     string            `json:"title"`
	Message   string            `json:"message"`
	Channel   string            `json:"channel"`
	Data      map[string]string `json:"data"`
	Priority  string            `json:"priority"`
	Status    string            `json:"status"`
	CreatedAt time.Time         `json:"created_at"`
	SentAt    time.Time         `json:"sent_at"`
	ReadAt    time.Time         `json:"read_at"`
}

type NotificationPreferences struct {
	UserID                string `json:"user_id"`
	EmailEnabled         bool   `json:"email_enabled"`
	SMSEnabled           bool   `json:"sms_enabled"`
	PushEnabled          bool   `json:"push_enabled"`
	InAppEnabled         bool   `json:"in_app_enabled"`
	OrderNotifications   bool   `json:"order_notifications"`
	DepositNotifications bool   `json:"deposit_notifications"`
	SecurityAlerts       bool   `json:"security_alerts"`
	MarketingEnabled     bool   `json:"marketing_enabled"`
}

type NotificationTemplate struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Channel   string   `json:"channel"`
	Subject   string   `json:"subject"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Variables []string `json:"variables"`
	Active    bool     `json:"active"`
}

type NotificationManager struct {
	mu          sync.RWMutex
	notifications map[string]*Notification
	userNotifs  map[string][]string
	preferences map[string]*NotificationPreferences
	templates   map[string]*NotificationTemplate
	emailQueue  chan *Notification
	smsQueue    chan *Notification
	pushQueue   chan *Notification
}

func NewNotificationManager() *NotificationManager {
	nm := &NotificationManager{
		notifications: make(map[string]*Notification),
		userNotifs:    make(map[string][]string),
		preferences:   make(map[string]*NotificationPreferences),
		templates:    make(map[string]*NotificationTemplate),
		emailQueue:   make(chan *Notification, 1000),
		smsQueue:     make(chan *Notification, 1000),
		pushQueue:    make(chan *Notification, 1000),
	}
	nm.initializeTemplates()
	go nm.processQueues()
	return nm
}

func (nm *NotificationManager) initializeTemplates() {
	templates := []*NotificationTemplate{
		{ID: "order_filled", Type: NotificationTypeOrder, Channel: ChannelEmail, Subject: "Order Filled", Title: "Your order has been filled", Body: "Your order for {{symbol}} has been filled at {{price}}", Active: true},
		{ID: "deposit_success", Type: NotificationTypeDeposit, Channel: ChannelEmail, Subject: "Deposit Confirmed", Title: "Deposit successful", Body: "Your deposit of {{amount}} {{asset}} has been confirmed", Active: true},
		{ID: "withdrawal_processing", Type: NotificationTypeWithdrawal, Channel: ChannelEmail, Subject: "Withdrawal Processing", Title: "Withdrawal in progress", Body: "Your withdrawal is being processed", Active: true},
		{ID: "security_login", Type: NotificationTypeSecurity, Channel: ChannelEmail, Subject: "New Login", Title: "New login detected", Body: "A new login was detected from {{ip}}", Active: true},
		{ID: "staking_reward", Type: NotificationTypeStaking, Channel: ChannelEmail, Subject: "Staking Reward", Title: "Staking reward earned", Body: "You have earned {{amount}} in staking rewards", Active: true},
	}

	for _, t := range templates {
		nm.templates[t.ID] = t
	}
}

func (nm *NotificationManager) Send(userID, notifType, title, message string, data map[string]string, channel string, priority string) (*Notification, error) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	now := time.Now()
	notif := &Notification{
		ID:        fmt.Sprintf("NOT%d%d", now.Unix(), now.Nanosecond()),
		UserID:    userID,
		Type:      notifType,
		Title:     title,
		Message:   message,
		Channel:   channel,
		Data:      data,
		Priority:  priority,
		Status:    StatusPending,
		CreatedAt: now,
	}

	nm.notifications[notif.ID] = notif
	nm.userNotifs[userID] = append(nm.userNotifs[userID], notif.ID)

	switch channel {
	case ChannelEmail:
		nm.emailQueue <- notif
	case ChannelSMS:
		nm.smsQueue <- notif
	case ChannelPush:
		nm.pushQueue <- notif
	}

	return notif, nil
}

func (nm *NotificationManager) SendToMultiple(userIDs []string, notifType, title, message string, data map[string]string, channel string) error {
	for _, userID := range userIDs {
		_, err := nm.Send(userID, notifType, title, message, data, channel, PriorityNormal)
		if err != nil {
			return err
		}
	}
	return nil
}

func (nm *NotificationManager) GetNotification(notifID string) (*Notification, error) {
	nm.mu.RLock()
	defer nm.mu.RUnlock()

	notif, exists := nm.notifications[notifID]
	if !exists {
		return nil, fmt.Errorf("notification not found")
	}
	return notif, nil
}

func (nm *NotificationManager) GetUserNotifications(userID string, limit int) []*Notification {
	nm.mu.RLock()
	defer nm.mu.RUnlock()

	notifIDs := nm.userNotifs[userID]
	notifications := make([]*Notification, 0, len(notifIDs))

	for i := len(notifIDs) - 1; i >= 0; i-- {
		if notif, exists := nm.notifications[notifIDs[i]]; exists {
			notifications = append(notifications, notif)
		}
	}

	if limit > 0 && len(notifications) > limit {
		notifications = notifications[:limit]
	}

	return notifications
}

func (nm *NotificationManager) MarkAsRead(notifID string) error {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	notif, exists := nm.notifications[notifID]
	if !exists {
		return fmt.Errorf("notification not found")
	}

	notif.Status = StatusRead
	notif.ReadAt = time.Now()
	return nil
}

func (nm *NotificationManager) MarkAllAsRead(userID string) error {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	notifIDs := nm.userNotifs[userID]
	for _, id := range notifIDs {
		if notif, exists := nm.notifications[id]; exists {
			notif.Status = StatusRead
			notif.ReadAt = time.Now()
		}
	}
	return nil
}

func (nm *NotificationManager) SetPreferences(userID string, prefs *NotificationPreferences) error {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	prefs.UserID = userID
	nm.preferences[userID] = prefs
	return nil
}

func (nm *NotificationManager) GetPreferences(userID string) (*NotificationPreferences, error) {
	nm.mu.RLock()
	defer nm.mu.RUnlock()

	prefs, exists := nm.preferences[userID]
	if !exists {
		return &NotificationPreferences{
			UserID:             userID,
			EmailEnabled:       true,
			SMSEnabled:         false,
			PushEnabled:        true,
			InAppEnabled:       true,
			OrderNotifications: true,
			SecurityAlerts:     true,
		}, nil
	}
	return prefs, nil
}

func (nm *NotificationManager) GetUnreadCount(userID string) int {
	nm.mu.RLock()
	defer nm.mu.RUnlock()

	count := 0
	notifIDs := nm.userNotifs[userID]
	for _, id := range notifIDs {
		if notif, exists := nm.notifications[id]; exists {
			if notif.Status != StatusRead {
				count++
			}
		}
	}
	return count
}

func (nm *NotificationManager) processQueues() {
	for {
		select {
		case notif := <-nm.emailQueue:
			nm.sendEmail(notif)
		case notif := <-nm.smsQueue:
			nm.sendSMS(notif)
		case notif := <-nm.pushQueue:
			nm.sendPush(notif)
		}
	}
}

func (nm *NotificationManager) sendEmail(notif *Notification) {
	nm.mu.Lock()
	notif.Status = StatusSent
	notif.SentAt = time.Now()
	nm.mu.Unlock()
}

func (nm *NotificationManager) sendSMS(notif *Notification) {
	nm.mu.Lock()
	notif.Status = StatusSent
	notif.SentAt = time.Now()
	nm.mu.Unlock()
}

func (nm *NotificationManager) sendPush(notif *Notification) {
	nm.mu.Lock()
	notif.Status = StatusSent
	notif.SentAt = time.Now()
	nm.mu.Unlock()
}

func (nm *NotificationManager) GetTemplate(templateID string) (*NotificationTemplate, error) {
	nm.mu.RLock()
	defer nm.mu.RUnlock()

	template, exists := nm.templates[templateID]
	if !exists {
		return nil, fmt.Errorf("template not found")
	}
	return template, nil
}
