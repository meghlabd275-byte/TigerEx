package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ============================================================================
// NOTIFICATION SERVICE - PRODUCTION IMPLEMENTATION
// ============================================================================

// NotificationType represents notification type
type NotificationType string

const (
	// Account notifications
	NotificationTypeLogin         NotificationType = "login"
	NotificationTypePasswordChange NotificationType = "password_change"
	NotificationType2FAChange    NotificationType = "2fa_change"
	NotificationTypeEmailChange   NotificationType = "email_change"
	NotificationTypePhoneChange   NotificationType = "phone_change"
	NotificationTypeWithdrawal    NotificationType = "withdrawal"
	NotificationTypeDeposit       NotificationType = "deposit"
	NotificationTypeKYCApproved   NotificationType = "kyc_approved"
	NotificationTypeKYCDenied     NotificationType = "kyc_denied"
	NotificationTypeAccountLocked NotificationType = "account_locked"
	NotificationTypeAccountUnlocked NotificationType = "account_unlocked"
	
	// Trading notifications
	NotificationTypeOrderFilled   NotificationType = "order_filled"
	NotificationTypeOrderPartiallyFilled NotificationType = "order_partially_filled"
	NotificationTypeOrderCancelled NotificationType = "order_cancelled"
	NotificationTypeOrderRejected NotificationType = "order_rejected"
	NotificationTypePriceAlert   NotificationType = "price_alert"
	NotificationTypeLiquidation  NotificationType = "liquidation"
	NotificationTypeMarginCall   NotificationType = "margin_call"
	NotificationTypePositionPnl  NotificationType = "position_pnl"
	
	// Wallet notifications
	NotificationTypeTransferReceived NotificationType = "transfer_received"
	NotificationTypeTransferSent    NotificationType = "transfer_sent"
	NotificationTypeWithdrawalPending NotificationType = "withdrawal_pending"
	NotificationTypeWithdrawalCompleted NotificationType = "withdrawal_completed"
	NotificationTypeDepositPending NotificationType = "deposit_pending"
	NotificationTypeDepositConfirmed NotificationType = "deposit_confirmed"
	
	// Marketing notifications
	NotificationTypePromotion   NotificationType = "promotion"
	NotificationTypeNewsletter   NotificationType = "newsletter"
	NotificationTypeNewFeature   NotificationType = "new_feature"
	NotificationTypeMaintenance NotificationType = "maintenance"
)

// NotificationChannel represents notification channel
type NotificationChannel string

const (
	ChannelEmail    NotificationChannel = "email"
	ChannelSMS     NotificationChannel = "sms"
	ChannelPush    NotificationChannel = "push"
	ChannelInApp   NotificationChannel = "in_app"
	ChannelTelegram NotificationChannel = "telegram"
)

// NotificationPriority represents priority
type NotificationPriority string

const (
	PriorityLow      NotificationPriority = "low"
	PriorityNormal  NotificationPriority = "normal"
	PriorityHigh    NotificationPriority = "high"
	PriorityUrgent  NotificationPriority = "urgent"
)

// Notification represents a notification
type Notification struct {
	ID          string               `json:"id"`
	UserID      string               `json:"user_id"`
	Type       NotificationType      `json:"type"`
	Title      string               `json:"title"`
	Message    string               `json:"message"`
	Data       map[string]interface{} `json:"data"`
	Priority   NotificationPriority  `json:"priority"`
	Channels   []NotificationChannel `json:"channels"`
	Status     string               `json:"status"` // pending, sent, delivered, read, failed
	ReadAt     *int64              `json:"read_at,omitempty"`
	CreatedAt  int64               `json:"created_at"`
	SentAt     *int64             `json:"sent_at,omitempty"`
}

// NotificationTemplate represents a notification template
type NotificationTemplate struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Type        NotificationType        `json:"type"`
	Subject     string                 `json:"subject"`     // For email
	Title       string                 `json:"title"`       // For push/in-app
	Message     string                 `json:"message"`
	Channels    []NotificationChannel  `json:"channels"`
	Variables   []string               `json:"variables"`
	IsActive   bool                  `json:"is_active"`
	CreatedAt  int64                 `json:"created_at"`
	UpdatedAt  int64                 `json:"updated_at"`
}

// UserNotificationSettings represents user notification preferences
type UserNotificationSettings struct {
	UserID           string                       `json:"user_id"`
	EmailEnabled    bool                         `json:"email_enabled"`
	SMSEnabled      bool                         `json:"sms_enabled"`
	PushEnabled     bool                         `json:"push_enabled"`
	TelegramEnabled bool                         `json:"telegram_enabled"`
	InAppEnabled    bool                         `json:"in_app_enabled"`
	CategorySettings map[string]CategorySettings  `json:"category_settings"`
}

// CategorySettings represents category-specific settings
type CategorySettings struct {
	Enabled    bool     `json:"enabled"`
	MinPriority string  `json:"min_priority"` // Don't notify below this priority
}

// PriceAlert represents a price alert
type PriceAlert struct {
	ID           string          `json:"id"`
	UserID       string          `json:"user_id"`
	Symbol       string          `json:"symbol"`
	Condition    string          `json:"condition"` // above, below
	TargetPrice decimal.Decimal `json:"target_price"`
	IsActive    bool            `json:"is_active"`
	TriggeredAt *int64          `json:"triggered_at,omitempty"`
	CreatedAt   int64           `json:"created_at"`
}

// NotificationService manages notifications
type NotificationService struct {
	notifications   map[string]*Notification
	templates       map[string]*NotificationTemplate
	userSettings    map[string]*UserNotificationSettings
	priceAlerts    map[string]*PriceAlert
	emailQueue     chan *Notification
	smsQueue       chan *Notification
	pushQueue      chan *Notification
	webhookQueue   chan *Notification
	
	mu sync.RWMutex `json:"-"`
}

// NewNotificationService creates a new notification service
func NewNotificationService() *NotificationService {
	return &NotificationService{
		notifications:   make(map[string]*Notification),
		templates:       make(map[string]*NotificationTemplate),
		userSettings:    make(map[string]*UserNotificationSettings),
		priceAlerts:    make(map[string]*PriceAlert),
		emailQueue:     make(chan *Notification, 1000),
		smsQueue:       make(chan *Notification, 1000),
		pushQueue:      make(chan *Notification, 1000),
		webhookQueue:   make(chan *Notification, 1000),
	}
}

// InitializeDefaultTemplates initializes default notification templates
func (s *NotificationService) InitializeDefaultTemplates() {
	templates := []*NotificationTemplate{
		{
			ID:       "tpl_login",
			Name:     "Login Notification",
			Type:     NotificationTypeLogin,
			Subject:  "New Login Detected",
			Title:    "New Login",
			Message:  "A new login was detected on your account from {device} at {location}.",
			Channels: []NotificationChannel{ChannelEmail, ChannelPush, ChannelInApp},
			Variables: []string{"device", "location", "ip_address", "time"},
			IsActive: true,
		},
		{
			ID:       "tpl_withdrawal",
			Name:     "Withdrawal Notification",
			Type:     NotificationTypeWithdrawal,
			Subject:  "Withdrawal Processed",
			Title:    "Withdrawal Processed",
			Message:  "Your withdrawal of {amount} {currency} has been processed.",
			Channels: []NotificationChannel{ChannelEmail, ChannelSMS, ChannelPush},
			Variables: []string{"amount", "currency", "address", "tx_hash"},
			IsActive: true,
		},
		{
			ID:       "tpl_deposit",
			Name:     "Deposit Notification",
			Type:     NotificationTypeDeposit,
			Subject:  "Deposit Confirmed",
			Title:    "Deposit Confirmed",
			Message:  "Your deposit of {amount} {currency} has been confirmed.",
			Channels: []NotificationChannel{ChannelEmail, ChannelPush, ChannelInApp},
			Variables: []string{"amount", "currency", "tx_hash"},
			IsActive: true,
		},
		{
			ID:       "tpl_order_filled",
			Name:     "Order Filled",
			Type:     NotificationTypeOrderFilled,
			Subject:  "Order Filled",
			Title:    "Order Filled",
			Message:  "Your order to {side} {amount} {symbol} at {price} has been filled.",
			Channels: []NotificationChannel{ChannelPush, ChannelInApp},
			Variables: []string{"side", "amount", "symbol", "price", "order_id"},
			IsActive: true,
		},
		{
			ID:       "tpl_price_alert",
			Name:     "Price Alert",
			Type:     NotificationTypePriceAlert,
			Subject:  "Price Alert Triggered",
			Title:    "Price Alert: {symbol}",
			Message:  "{symbol} is now {condition} {price}.",
			Channels: []NotificationChannel{ChannelEmail, ChannelPush, ChannelSMS},
			Variables: []string{"symbol", "condition", "price", "alert_id"},
			IsActive: true,
		},
		{
			ID:       "tpl_kyc_approved",
			Name:     "KYC Approved",
			Type:     NotificationTypeKYCApproved,
			Subject:  "KYC Verification Approved",
			Title:    "KYC Approved",
			Message:  "Congratulations! Your identity verification has been approved.",
			Channels: []NotificationChannel{ChannelEmail, ChannelPush, ChannelInApp},
			Variables: []string{},
			IsActive: true,
		},
		{
			ID:       "tpl_kyc_denied",
			Name:     "KYC Denied",
			Type:     NotificationTypeKYCDenied,
			Subject:  "KYC Verification Denied",
			Title:    "KYC Verification Denied",
			Message:  "Your identity verification was denied. Reason: {reason}",
			Channels: []NotificationChannel{ChannelEmail},
			Variables: []string{"reason"},
			IsActive: true,
		},
		{
			ID:       "tpl_liquidation",
			Name:     "Liquidation Warning",
			Type:     NotificationTypeLiquidation,
			Subject:  "Liquidation Warning",
			Title:    "Liquidation Warning",
			Message:  "Your position {position_id} is at risk of liquidation.",
			Channels: []NotificationChannel{ChannelEmail, ChannelSMS, ChannelPush},
			Variables: []string{"position_id", "margin_ratio", "liquidation_price"},
			IsActive: true,
		},
	}
	
	s.mu.Lock()
	for _, tpl := range templates {
		s.templates[tpl.ID] = tpl
	}
	s.mu.Unlock()
}

// SendNotification sends a notification to a user
func (s *NotificationService) SendNotification(ctx context.Context, userID string, notifType NotificationType, data map[string]interface{}) (*Notification, error) {
	s.mu.RLock()
	template, exists := s.templates[string(notifType)]
	s.mu.RUnlock()
	
	if !exists {
		template = &NotificationTemplate{
			ID:       string(notifType),
			Type:     notifType,
			Title:    string(notifType),
			Message:  "You have a new notification.",
			Channels: []NotificationChannel{ChannelInApp},
		}
	}
	
	// Get user settings
	s.mu.RLock()
	settings, settingsExists := s.userSettings[userID]
	s.mu.RUnlock()
	
	if !settingsExists {
		settings = &UserNotificationSettings{
			UserID:           userID,
			EmailEnabled:    true,
			SMSEnabled:      true,
			PushEnabled:     true,
			TelegramEnabled: true,
			InAppEnabled:    true,
			CategorySettings: make(map[string]CategorySettings),
		}
	}
	
	// Determine channels
	channels := template.Channels
	if len(channels) == 0 {
		channels = []NotificationChannel{ChannelInApp}
	}
	
	// Filter by user preferences
	var enabledChannels []NotificationChannel
	for _, ch := range channels {
		switch ch {
		case ChannelEmail:
			if settings.EmailEnabled {
				enabledChannels = append(enabledChannels, ch)
			}
		case ChannelSMS:
			if settings.SMSEnabled {
				enabledChannels = append(enabledChannels, ch)
			}
		case ChannelPush:
			if settings.PushEnabled {
				enabledChannels = append(enabledChannels, ch)
			}
		case ChannelTelegram:
			if settings.TelegramEnabled {
				enabledChannels = append(enabledChannels, ch)
			}
		case ChannelInApp:
			if settings.InAppEnabled {
				enabledChannels = append(enabledChannels, ch)
			}
		}
	}
	
	// Parse template with variables
	message := template.Message
	title := template.Title
	for key, value := range data {
		placeholder := "{" + key + "}"
		message = strings.ReplaceAll(message, placeholder, fmt.Sprintf("%v", value))
		title = strings.ReplaceAll(title, placeholder, fmt.Sprintf("%v", value))
	}
	
	notification := &Notification{
		ID:        fmt.Sprintf("notif_%s", uuid.New().String()[:8]),
		UserID:    userID,
		Type:     notifType,
		Title:    title,
		Message:  message,
		Data:     data,
		Priority: PriorityNormal,
		Channels: enabledChannels,
		Status:   "pending",
		CreatedAt: time.Now().UnixMilli(),
	}
	
	// Save notification
	s.mu.Lock()
	s.notifications[notification.ID] = notification
	s.mu.Unlock()
	
	// Queue for delivery
	go s.queueNotification(notification)
	
	return notification, nil
}

// queueNotification queues notification for delivery
func (s *NotificationService) queueNotification(notification *Notification) {
	for _, channel := range notification.Channels {
		switch channel {
		case ChannelEmail:
			s.emailQueue <- notification
		case ChannelSMS:
			s.smsQueue <- notification
		case ChannelPush:
			s.pushQueue <- notification
		default:
			// In-app notifications handled synchronously
		}
	}
	
	// Mark as sent
	now := time.Now().UnixMilli()
	notification.SentAt = &now
	notification.Status = "sent"
}

// GetUserNotifications returns notifications for a user
func (s *NotificationService) GetUserNotifications(userID string, limit, offset int) []*Notification {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var userNotifs []*Notification
	count := 0
	
	for _, notif := range s.notifications {
		if notif.UserID == userID {
			if count >= offset && count < offset+limit {
				userNotifs = append(userNotifs, notif)
			}
			count++
		}
	}
	
	return userNotifs
}

// MarkAsRead marks notification as read
func (s *NotificationService) MarkAsRead(notificationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	notif, exists := s.notifications[notificationID]
	if !exists {
		return fmt.Errorf("notification not found")
	}
	
	now := time.Now().UnixMilli()
	notif.ReadAt = &now
	notif.Status = "read"
	
	return nil
}

// GetUnreadCount returns unread notification count
func (s *NotificationService) GetUnreadCount(userID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	count := 0
	for _, notif := range s.notifications {
		if notif.UserID == userID && notif.ReadAt == nil {
			count++
		}
	}
	
	return count
}

// CreatePriceAlert creates a price alert
func (s *NotificationService) CreatePriceAlert(userID, symbol, condition string, targetPrice decimal.Decimal) (*PriceAlert, error) {
	if condition != "above" && condition != "below" {
		return nil, fmt.Errorf("invalid condition: must be 'above' or 'below'")
	}
	
	alert := &PriceAlert{
		ID:           fmt.Sprintf("alert_%s", uuid.New().String()[:8]),
		UserID:       userID,
		Symbol:       symbol,
		Condition:    condition,
		TargetPrice:  targetPrice,
		IsActive:     true,
		CreatedAt:    time.Now().UnixMilli(),
	}
	
	s.mu.Lock()
	s.priceAlerts[alert.ID] = alert
	s.mu.Unlock()
	
	return alert, nil
}

// DeletePriceAlert deletes a price alert
func (s *NotificationService) DeletePriceAlert(alertID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if _, exists := s.priceAlerts[alertID]; !exists {
		return fmt.Errorf("alert not found")
	}
	
	delete(s.priceAlerts, alertID)
	return nil
}

// CheckPriceAlerts checks if any price alerts should trigger
func (s *NotificationService) CheckPriceAlerts(symbol string, currentPrice decimal.Decimal) []*PriceAlert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var triggered []*PriceAlert
	
	for _, alert := range s.priceAlerts {
		if !alert.IsActive || alert.Symbol != symbol {
			continue
		}
		
		shouldTrigger := false
		if alert.Condition == "above" && currentPrice.GreaterThanOrEqual(alert.TargetPrice) {
			shouldTrigger = true
		} else if alert.Condition == "below" && currentPrice.LessThanOrEqual(alert.TargetPrice) {
			shouldTrigger = true
		}
		
		if shouldTrigger {
			now := time.Now().UnixMilli()
			alert.TriggeredAt = &now
			alert.IsActive = false
			triggered = append(triggered, alert)
		}
	}
	
	return triggered
}

// UpdateUserSettings updates user notification settings
func (s *NotificationService) UpdateUserSettings(userID string, settings *UserNotificationSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	settings.UserID = userID
	s.userSettings[userID] = settings
	
	return nil
}

// GetUserSettings returns user notification settings
func (s *NotificationService) GetUserSettings(userID string) (*UserNotificationSettings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	settings, exists := s.userSettings[userID]
	if !exists {
		return &UserNotificationSettings{
			UserID:           userID,
			EmailEnabled:    true,
			SMSEnabled:      true,
			PushEnabled:     true,
			TelegramEnabled: true,
			InAppEnabled:    true,
			CategorySettings: make(map[string]CategorySettings),
		}, nil
	}
	
	return settings, nil
}

// StartEmailWorker starts email notification worker
func (s *NotificationService) StartEmailWorker(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case notif := <-s.emailQueue:
				// Send email
				// In production, would integrate with email provider (SendGrid, AWS SES, etc.)
				fmt.Printf("Sending email to user %s: %s\n", notif.UserID, notif.Title)
				time.Sleep(100 * time.Millisecond) // Simulate sending
			}
		}
	}()
}

// StartPushWorker starts push notification worker
func (s *NotificationService) StartPushWorker(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case notif := <-s.pushQueue:
				// Send push notification
				// In production, would integrate with FCM, APNS, etc.
				fmt.Printf("Sending push to user %s: %s\n", notif.UserID, notif.Title)
				time.Sleep(100 * time.Millisecond)
			}
		}
	}()
}

// ============================================================================
// ALERT SYSTEM
// ============================================================================

// Alert represents a system alert
type Alert struct {
	ID          string      `json:"id"`
	Level       string      `json:"level"` // info, warning, error, critical
	Source      string      `json:"source"`
	Message     string      `json:"message"`
	Data        json.RawMessage `json:"data"`
	Timestamp   int64       `json:"timestamp"`
	ResolvedAt  *int64     `json:"resolved_at,omitempty"`
}

// AlertService manages system alerts
type AlertService struct {
	alerts   map[string]*Alert
	channels map[string]chan *Alert
	mu       sync.RWMutex
}

// NewAlertService creates a new alert service
func NewAlertService() *AlertService {
	return &AlertService{
		alerts:   make(map[string]*Alert),
		channels: make(map[string]chan *Alert),
	}
}

// CreateAlert creates a new alert
func (a *AlertService) CreateAlert(level, source, message string, data json.RawMessage) *Alert {
	alert := &Alert{
		ID:        fmt.Sprintf("alert_%s", uuid.New().String()[:8]),
		Level:     level,
		Source:    source,
		Message:   message,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	
	a.mu.Lock()
	a.alerts[alert.ID] = alert
	
	// Broadcast to all channels
	for _, ch := range a.channels {
		ch <- alert
	}
	a.mu.Unlock()
	
	return alert
}

// Subscribe returns channel for alert notifications
func (a *AlertService) Subscribe(name string) chan *Alert {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	ch := make(chan *Alert, 100)
	a.channels[name] = ch
	
	return ch
}

// GetAlerts returns alerts with optional filters
func (a *AlertService) GetAlerts(level, source string, limit int) []*Alert {
	a.mu.RLock()
	defer a.mu.RUnlock()
	
	var result []*Alert
	count := 0
	
	for _, alert := range a.alerts {
		if level != "" && alert.Level != level {
			continue
		}
		if source != "" && alert.Source != source {
			continue
		}
		if count >= limit {
			break
		}
		result = append(result, alert)
		count++
	}
	
	return result
}

// ResolveAlert marks an alert as resolved
func (a *AlertService) ResolveAlert(alertID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	
	alert, exists := a.alerts[alertID]
	if !exists {
		return fmt.Errorf("alert not found")
	}
	
	now := time.Now().UnixMilli()
	alert.ResolvedAt = &now
	
	return nil
}
