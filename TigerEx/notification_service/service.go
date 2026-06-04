package notify

import (
	"fmt"
	"html/template"
	"sync"
	"time"
)

// =============================================================================
// NOTIFICATION SERVICE
// Push notifications, email, SMS alerts
// =============================================================================

// NotificationType notification type
type NotificationType string

const (
	TypeOrderFilled    NotificationType = "ORDER_FILLED"
	TypeOrderCancelled NotificationType = "ORDER_CANCELLED"
	TypeDepositComplete NotificationType = "DEPOSIT_COMPLETE"
	TypeWithdrawalComplete NotificationType = "WITHRAWAL_COMPLETE"
	TypePriceAlert     NotificationType = "PRICE_ALERT"
	TypeLiquidation   NotificationType = "LIQUIDATION"
	TypeRiskWarning  NotificationType = "RISK_WARNING"
	TypeKYCComplete NotificationType = "KYC_COMPLETE"
	TypeAnnouncement NotificationType = "ANNOUNCEMENT"
	TypeSecurity    NotificationType = "SECURITY_ALERT"
)

// Channel notification channel
type Channel string

const (
	ChannelEmail  Channel = "EMAIL"
	ChannelSMS  Channel = "SMS"
	ChannelPush Channel = "PUSH"
	ChannelInApp Channel = "IN_APP"
)

// Notification notification
type Notification struct {
	ID        string           `json:"id"`
	UserID   string           `json:"userId"`
	Type     NotificationType `json:"type"`
	Channel Channel         `json:"channel"`
	Title    string          `json:"title"`
	Body     string          `json:"body"`
	Data     map[string]string `json:"data"`
	Sent     bool            `json:"sent"`
	Read     bool            `json:"read"`
	SentAt   *time.Time      `json:"sentAt,omitempty"`
	ReadAt   *time.Time      `json:"readAt,omitempty"`
	CreatedAt time.Time     `json:"createdAt"`
}

// Template message template
type Template struct {
	ID      string
	Type    NotificationType
	Channel Channel
	Subject string // For email
	HTML    bool
	Body    string
}

// Preferences user preferences
type Preferences struct {
	UserID       string           `json:"userId"`
	EmailEnabled bool             `json:"emailEnabled"`
	SMSEnabled  bool             `json:"smsEnabled"`
	PushEnabled bool             `json:"pushEnabled"`
	InAppEnabled bool             `json:"inAppEnabled"`
	Types      map[NotificationType]bool `json:"types"`
}

// Service notification service
type Service struct {
	mu sync.RWMutex

	// Notifications
	notifications map[string]*Notification
	userNotifs map[string]map[string]*Notification // userID -> notifID -> Notif

	// Templates
	templates map[string]*Template

	// Preferences
	preferences map[string]*Preferences

	// Channels (configured providers)
	emailProvider string
	smsProvider string
	pushProvider string

	// Queues
	emailQueue chan *Notification
	smsQueue  chan *Notification
	pushQueue chan *Notification

	// Config
	MaxPerHour      int
	MaxPerDay     int
	BulkBatchSize int
}

// NewService creates notification service
func NewService() *Service {
	s := &Service{
		notifications:  make(map[string]*Notification),
		userNotifs:    make(map[string]map[string]*Notification),
		templates:    make(map[string]*Template),
		preferences: make(map[string]*Preferences),
		emailQueue: make(chan *Notification, 1000),
		smsQueue:   make(chan *Notification, 500),
		pushQueue:  make(chan *Notification, 1000),
		MaxPerHour: 50,
		MaxPerDay: 200,
	}

	s.initTemplates()

	return s
}

// Initialize default templates
func (s *Service) initTemplates() {
	s.templates = map[string]*Template{
		"order_filled": {
			ID:      "order_filled",
			Type:    TypeOrderFilled,
			Channel: ChannelEmail,
			Subject: "Order Filled - {{.Symbol}}",
			Body:    "Your {{.Side}} order of {{.Quantity}} {{.Symbol}} at {{.Price}} has been filled.",
		},
		"order_cancelled": {
			ID:      "order_cancelled",
			Type:    TypeOrderCancelled,
			Channel: ChannelEmail,
			Subject: "Order Cancelled - {{.Symbol}}",
			Body:    "Your {{.Side}} order of {{.Quantity}} {{.Symbol}} has been cancelled.",
		},
		"deposit_complete": {
			ID:      "deposit_complete",
			Type:    TypeDepositComplete,
			Channel: ChannelEmail,
			Subject: "Deposit Complete",
			Body:    "Your deposit of ${{.Amount}} has been credited to your account.",
		},
		"withdrawal_complete": {
			ID:      "withdrawal_complete",
			Type:    TypeWithdrawalComplete,
			Channel: ChannelEmail,
			Subject: "Withdrawal Complete",
			Body:    "Your withdrawal of ${{.Amount}} has been processed.",
		},
		"price_alert": {
			ID:      "price_alert",
			Type:    TypePriceAlert,
			Channel: ChannelPush,
			Subject: "{{.Symbol}} Price Alert",
			Body:    "{{.Symbol}} has reached {{.Price}}",
		},
		"liquidation": {
			ID:      "liquidation",
			Type:    TypeLiquidation,
			Channel: ChannelPush,
			Subject: "Liquidation Warning",
			Body:    "Your position is being liquidated. Action required.",
		},
		"kyc_complete": {
			ID:      "kyc_complete",
			Type:    TypeKYCComplete,
			Channel: ChannelEmail,
			Subject: "KYC Verification Complete",
			Body:    "Your identity has been verified. You now have full trading privileges.",
		},
		"security_alert": {
			ID:      "security_alert",
			Type:    TypeSecurity,
			Channel: ChannelPush,
			Subject: "Security Alert",
			Body:    "New login detected from {{.Location}}",
		},
		"announcement": {
			ID:      "announcement",
			Type:    TypeAnnouncement,
			Channel: ChannelEmail,
			Subject: "{{.Title}}",
			Body:    "{{.Body}}",
		},
	}
}

// SetPreferences sets user notification preferences
func (s *Service) SetPreferences(prefs *Preferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if prefs.Types == nil {
		prefs.Types = make(map[NotificationType]bool)
	}

	s.preferences[prefs.UserID] = prefs

	return nil
}

// GetPreferences gets preferences
func (s *Service) GetPreferences(userID string) *Preferences {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if prefs, ok := s.preferences[userID]; ok {
		return prefs
	}

	// Default preferences
	return &Preferences{
		UserID:       userID,
		EmailEnabled: true,
		SMSEnabled:  false,
		PushEnabled: true,
		InAppEnabled: true,
		Types:      defaultTypes(),
	}
}

func defaultTypes() map[NotificationType]bool {
	return map[NotificationType]bool{
		TypeOrderFilled:     true,
		TypeOrderCancelled: true,
		TypeDepositComplete: true,
		TypeWithdrawalComplete: true,
		TypePriceAlert:    true,
		TypeLiquidation:  true,
		TypeRiskWarning: true,
		TypeKYCComplete: true,
		TypeSecurity:    true,
	}
}

// Send sends notification
func (s *Service) Send(userID string, ntype NotificationType, title, body string, data map[string]string) error {
	prefs := s.GetPreferences(userID)

	// Check if type enabled
	if !prefs.Types[ntype] {
		return fmt.Errorf("notifications of this type disabled")
	}

	notif := &Notification{
		ID:       generateNotifID(),
		UserID:   userID,
		Type:    ntype,
		Title:   title,
		Body:    body,
		Data:    data,
		CreatedAt: time.Now(),
	}

	s.mu.Lock()
	s.notifications[notif.ID] = notif
	if s.userNotifs[userID] == nil {
		s.userNotifs[userID] = make(map[string]*Notification)
	}
	s.userNotifs[userID][notif.ID] = notif
	s.mu.Unlock()

	// Queue to channels
	if prefs.EmailEnabled {
		notif.Channel = ChannelEmail
		s.emailQueue <- notif
	}

	if prefs.PushEnabled {
		notif.Channel = ChannelPush
		s.pushQueue <- notif
	}

	if prefs.InAppEnabled {
		notif.Channel = ChannelInApp
		notif.Sent = true
		now := time.Now()
		notif.SentAt = &now
	}

	return nil
}

// MarkAsRead marks notification as read
func (s *Service) MarkAsRead(notifID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	notif, ok := s.notifications[notifID]
	if !ok {
		return fmt.Errorf("notification not found")
	}

	if notif.Read {
		return nil
	}

	notif.Read = true
	now := time.Now()
	notif.ReadAt = &now

	return nil
}

// GetNotifications gets user notifications
func (s *Service) GetNotifications(userID string, limit, unreadOnly int) []*Notification {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userNotifs := s.userNotifs[userID]
	if userNotifs == nil {
		return nil
	}

	var result []*Notification
	count := 0

	for _, n := range userNotifs {
		if unreadOnly == 1 && !n.Read {
			result = append(result, n)
			count++
			if limit > 0 && count >= limit {
				break
			}
			continue
		}
		if unreadOnly == 0 {
			result = append(result, n)
			count++
			if limit > 0 && count >= limit {
				break
			}
		}
	}

	return result
}

// GetUnreadCount gets unread count
func (s *Service) GetUnreadCount(userID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	userNotifs := s.userNotifs[userID]
	if userNotifs == nil {
		return 0
	}

	count := 0
	for _, n := range userNotifs {
		if !n.Read {
			count++
		}
	}

	return count
}

// RenderTemplate renders notification template
func (s *Service) RenderTemplate(templateID string, data map[string]string) (string, error) {
	s.mu.RLock()
	template, ok := s.templates[templateID]
	s.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("template not found")
	}

	// Simple template rendering
	body := template.Body
	for k, v := range data {
		placeholder := "{{." + k + "}}"
		body = replace(body, placeholder, v)
	}

	return body, nil
}

// SendBulk sends bulk notification
func (s *Service) SendBulk(userIDs []string, ntype NotificationType, title, body string) error {
	for _, userID := range userIDs {
		if err := s.Send(userID, ntype, title, body, nil); err != nil {
			continue // Continue on error
		}
	}

	return nil
}

// SendTemplate sends template notification
func (s *Service) SendTemplate(userID, templateID string, data map[string]string) error {
	body, err := s.RenderTemplate(templateID, data)
	if err != nil {
		return err
	}

	temp := s.templates[templateID]
	title := temp.Subject
	for k, v := range data {
		placeholder := "{{." + k + "}}"
		title = replace(title, placeholder, v)
	}

	return s.Send(userID, temp.Type, title, body, data)
}

// Replace helper
func replace(s, old, new string) string {
	result := s
	for {
		i := indexOf(result, old)
		if i < 0 {
			break
		}
		result = result[:i] + new + result[i+len(old):]
	}
	return result
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func generateNotifID() string {
	return fmt.Sprintf("notif_%d", time.Now().UnixNano())
}

// Template type
type htmlTemplate = *template.Template

var _ htmlTemplate = nil