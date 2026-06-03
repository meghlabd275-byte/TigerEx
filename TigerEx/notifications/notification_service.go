package notifications

import (
	"fmt"
	"sync"
	"time"
)

// NotificationType represents the type of notification
type NotificationType string

const (
	TypeOrderFilled    NotificationType = "ORDER_FILLED"
	TypeOrderPartial  NotificationType = "ORDER_PARTIAL"
	TypeOrderCancelled NotificationType = "ORDER_CANCELLED"
	TypeDeposit       NotificationType = "DEPOSIT"
	TypeWithdrawal     NotificationType = "WITHDRAWAL"
	TypeTransfer      NotificationType = "TRANSFER"
	TypeSecurity      NotificationType = "SECURITY"
	TypePriceAlert    NotificationType = "PRICE_ALERT"
	TypeSystem        NotificationType = "SYSTEM"
	TypePromo         NotificationType = "PROMOTION"
	TypeMarginCall    NotificationType = "MARGIN_CALL"
	TypeLiquidation   NotificationType = "LIQUIDATION"
)

// NotificationChannel represents delivery channel
type NotificationChannel string

const (
	ChannelPush   NotificationChannel = "PUSH"
	ChannelEmail NotificationChannel = "EMAIL"
	ChannelSMS   NotificationChannel = "SMS"
	ChannelInApp NotificationChannel = "IN_APP"
	ChannelTelegram NotificationChannel = "TELEGRAM"
)

// NotificationPriority represents notification priority
type NotificationPriority string

const (
	PriorityLow    NotificationPriority = "LOW"
	PriorityNormal NotificationPriority = "NORMAL"
	PriorityHigh   NotificationPriority = "HIGH"
	PriorityUrgent NotificationPriority = "URGENT"
)

// Notification represents a notification
type Notification struct {
	ID          string               `json:"id"`
	UserID      string               `json:"user_id"`
	Type        NotificationType     `json:"type"`
	Title       string               `json:"title"`
	Message     string               `json:"message"`
	Data        map[string]string    `json:"data,omitempty"`
	Priority    NotificationPriority `json:"priority"`
	IsRead      bool                 `json:"is_read"`
	IsDelivered bool                 `json:"is_delivered"`
	Channels    []NotificationChannel `json:"channels"`
	CreatedAt   time.Time           `json:"created_at"`
	ReadAt      *time.Time          `json:"read_at,omitempty"`
	DeliveredAt *time.Time          `json:"delivered_at,omitempty"`
}

// PushToken represents a user's push notification token
type PushToken struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Token     string    `json:"token"`
	Platform  string    `json:"platform"` // IOS, ANDROID, WEB
	DeviceID  string    `json:"device_id"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// EmailSubscription represents email subscription preferences
type EmailSubscription struct {
	UserID           string    `json:"user_id"`
	Email            string    `json:"email"`
	IsVerified       bool      `json:"is_verified"`
	VerificationCode string    `json:"verification_code,omitempty"`
	VerificationSent *time.Time `json:"verification_sent,omitempty"`
	Subscribed       map[string]bool `json:"subscribed"` // type -> subscribed
	CreatedAt        time.Time `json:"created_at"`
}

// PriceAlert represents a price alert
type PriceAlert struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Symbol       string    `json:"symbol"`
	Condition    string    `json:"condition"` // ABOVE, BELOW
	TargetPrice  float64   `json:"target_price"`
	IsTriggered  bool      `json:"is_triggered"`
	IsActive     bool      `json:"is_active"`
	TriggeredAt  *time.Time `json:"triggered_at,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// NotificationPreferences represents user notification preferences
type NotificationPreferences struct {
	UserID     string          `json:"user_id"`
	Push      ChannelPrefs   `json:"push"`
	Email     ChannelPrefs   `json:"email"`
	SMS       ChannelPrefs   `json:"sms"`
	InApp     ChannelPrefs   `json:"in_app"`
	Telegram  ChannelPrefs   `json:"telegram"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// ChannelPrefs represents channel-specific preferences
type ChannelPrefs struct {
	Enabled          bool              `json:"enabled"`
	OrderFilled     bool              `json:"order_filled"`
	OrderCancelled  bool              `json:"order_cancelled"`
	Deposits        bool              `json:"deposits"`
	Withdrawals     bool              `json:"withdrawals"`
	Security        bool              `json:"security"`
	PriceAlerts     bool              `json:"price_alerts"`
	Promotions      bool              `json:"promotions"`
	Frequency       string            `json:"frequency"` // INSTANT, HOURLY, DAILY
}

// NotificationService handles notification operations
type NotificationService struct {
	mu             sync.RWMutex
	notifications  map[string][]*Notification // userID -> notifications
	unreadCount   map[string]int
	pushTokens    map[string][]*PushToken // userID -> tokens
	emailSubs     map[string]*EmailSubscription
	preferences   map[string]*NotificationPreferences
	priceAlerts   map[string][]*PriceAlert
	eventChan     chan *Notification
}

// NewNotificationService creates a new notification service
func NewNotificationService() *NotificationService {
	return &NotificationService{
		notifications: make(map[string][]*Notification),
		unreadCount:   make(map[string]int),
		pushTokens:    make(map[string][]*PushToken),
		emailSubs:     make(map[string]*EmailSubscription),
		preferences:   make(map[string]*NotificationPreferences),
		priceAlerts:   make(map[string][]*PriceAlert),
		eventChan:     make(chan *Notification, 1000),
	}
}

// SendNotification sends a notification to a user
func (s *NotificationService) SendNotification(userID string, notifType NotificationType, title, message string, data map[string]string, priority NotificationPriority) (*Notification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	notif := &Notification{
		ID:          generateID(),
		UserID:      userID,
		Type:        notifType,
		Title:       title,
		Message:     message,
		Data:        data,
		Priority:    priority,
		IsRead:      false,
		IsDelivered: false,
		Channels:    []NotificationChannel{ChannelInApp},
		CreatedAt:   time.Now(),
	}

	s.notifications[userID] = append(s.notifications[userID], notif)
	s.unreadCount[userID]++

	// Check user preferences and add additional channels
	if prefs, exists := s.preferences[userID]; exists {
		s.addChannelsBasedOnPreferences(notif, prefs)
	}

	// Send to event channel for async processing
	select {
	case s.eventChan <- notif:
	default:
	}

	return notif, nil
}

// AddChannelsBasedOnPreferences adds channels based on user preferences
func (s *NotificationService) addChannelsBasedOnPreferences(notif *Notification, prefs *NotificationPreferences) {
	// Check each channel
	if s.shouldSendToChannel(notif.Type, prefs.Push) {
		notif.Channels = append(notif.Channels, ChannelPush)
	}
	if s.shouldSendToChannel(notif.Type, prefs.Email) {
		notif.Channels = append(notif.Channels, ChannelEmail)
	}
	if s.shouldSendToChannel(notif.Type, prefs.SMS) {
		notif.Channels = append(notif.Channels, ChannelSMS)
	}
	if s.shouldSendToChannel(notif.Type, prefs.InApp) {
		notif.Channels = append(notif.Channels, ChannelInApp)
	}
	if s.shouldSendToChannel(notif.Type, prefs.Telegram) {
		notif.Channels = append(notif.Channels, ChannelTelegram)
	}
}

// ShouldSendToChannel determines if notification should be sent to a channel
func (s *NotificationService) shouldSendToChannel(notifType NotificationType, prefs ChannelPrefs) bool {
	if !prefs.Enabled {
		return false
	}

	switch notifType {
	case TypeOrderFilled, TypeOrderPartial:
		return prefs.OrderFilled
	case TypeOrderCancelled:
		return prefs.OrderCancelled
	case TypeDeposit:
		return prefs.Deposits
	case TypeWithdrawal:
		return prefs.Withdrawals
	case TypeSecurity:
		return prefs.Security
	case TypePriceAlert:
		return prefs.PriceAlerts
	case TypePromo:
		return prefs.Promotions
	}

	return true
}

// GetUserNotifications retrieves notifications for a user
func (s *NotificationService) GetUserNotifications(userID string, limit, offset int) ([]*Notification, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	notifs := s.notifications[userID]
	if notifs == nil {
		return []*Notification{}, nil
	}

	// Return notifications in reverse chronological order
	start := len(notifs) - offset - limit
	if start < 0 {
		start = 0
	}
	end := len(notifs) - offset
	if end < 0 {
		end = 0
	}

	result := make([]*Notification, 0)
	for i := len(notifs) - 1 - offset; i >= start && i >= 0; i-- {
		result = append(result, notifs[i])
		if len(result) >= limit {
			break
		}
	}

	return result, nil
}

// GetUnreadCount returns the unread notification count for a user
func (s *NotificationService) GetUnreadCount(userID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.unreadCount[userID]
}

// MarkAsRead marks notifications as read
func (s *NotificationService) MarkAsRead(userID string, notificationIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	notifs := s.notifications[userID]
	now := time.Now()

	for _, notifID := range notificationIDs {
		for _, notif := range notifs {
			if notif.ID == notifID && !notif.IsRead {
				notif.IsRead = true
				notif.ReadAt = &now
				s.unreadCount[userID]--
			}
		}
	}

	return nil
}

// MarkAllAsRead marks all notifications as read
func (s *NotificationService) MarkAllAsRead(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	notifs := s.notifications[userID]

	for _, notif := range notifs {
		if !notif.IsRead {
			notif.IsRead = true
			notif.ReadAt = &now
		}
	}

	s.unreadCount[userID] = 0

	return nil
}

// DeleteNotification deletes a notification
func (s *NotificationService) DeleteNotification(userID, notificationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	notifs := s.notifications[userID]
	for i, notif := range notifs {
		if notif.ID == notificationID {
			if !notif.IsRead {
				s.unreadCount[userID]--
			}
			s.notifications[userID] = append(notifs[:i], notifs[i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("notification not found")
}

// RegisterPushToken registers a push notification token
func (s *NotificationService) RegisterPushToken(userID, token, platform, deviceID string) (*PushToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if token already exists
	for _, existing := range s.pushTokens[userID] {
		if existing.Token == token {
			existing.IsActive = true
			existing.DeviceID = deviceID
			existing.UpdatedAt = time.Now()
			return existing, nil
		}
	}

	pushToken := &PushToken{
		ID:        generateID(),
		UserID:    userID,
		Token:     token,
		Platform:  platform,
		DeviceID:  deviceID,
		IsActive:  true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	s.pushTokens[userID] = append(s.pushTokens[userID], pushToken)
	return pushToken, nil
}

// RemovePushToken removes a push notification token
func (s *NotificationService) RemovePushToken(userID, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tokens := s.pushTokens[userID]
	for i, t := range tokens {
		if t.Token == token {
			t.IsActive = false
			s.pushTokens[userID] = append(tokens[:i], tokens[i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("token not found")
}

// GetUserPreferences returns notification preferences for a user
func (s *NotificationService) GetUserPreferences(userID string) (*NotificationPreferences, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	prefs, exists := s.preferences[userID]
	if !exists {
		// Return default preferences
		return s.getDefaultPreferences(userID), nil
	}

	return prefs, nil
}

// UpdateUserPreferences updates notification preferences
func (s *NotificationService) UpdateUserPreferences(userID string, prefs *NotificationPreferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	prefs.UserID = userID
	prefs.UpdatedAt = time.Now()
	s.preferences[userID] = prefs

	return nil
}

// GetDefaultPreferences returns default notification preferences
func (s *NotificationService) getDefaultPreferences(userID string) *NotificationPreferences {
	return &NotificationPreferences{
		UserID: userID,
		Push: ChannelPrefs{
			Enabled:         true,
			OrderFilled:     true,
			OrderCancelled:  true,
			Deposits:        true,
			Withdrawals:     true,
			Security:        true,
			PriceAlerts:     true,
			Promotions:       false,
			Frequency:        "INSTANT",
		},
		Email: ChannelPrefs{
			Enabled:         true,
			OrderFilled:      false,
			OrderCancelled:   true,
			Deposits:         true,
			Withdrawals:      true,
			Security:         true,
			PriceAlerts:      false,
			Promotions:       false,
			Frequency:        "DAILY",
		},
		SMS: ChannelPrefs{
			Enabled:         false,
			Security:         true,
			Withdrawals:      true,
			Frequency:        "INSTANT",
		},
		InApp: ChannelPrefs{
			Enabled:         true,
			OrderFilled:      true,
			OrderCancelled:   true,
			Deposits:        true,
			Withdrawals:      true,
			Security:         true,
			PriceAlerts:      true,
			Promotions:       true,
			Frequency:        "INSTANT",
		},
		Telegram: ChannelPrefs{
			Enabled:         false,
			OrderFilled:      true,
			Security:         true,
			Withdrawals:      true,
			Frequency:        "INSTANT",
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}

// CreatePriceAlert creates a price alert
func (s *NotificationService) CreatePriceAlert(userID, symbol, condition string, targetPrice float64) (*PriceAlert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	alert := &PriceAlert{
		ID:          generateID(),
		UserID:      userID,
		Symbol:      symbol,
		Condition:   condition,
		TargetPrice: targetPrice,
		IsTriggered: false,
		IsActive:    true,
		CreatedAt:   time.Now(),
	}

	s.priceAlerts[userID] = append(s.priceAlerts[userID], alert)
	return alert, nil
}

// GetPriceAlerts returns price alerts for a user
func (s *NotificationService) GetPriceAlerts(userID string) ([]*PriceAlert, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.priceAlerts[userID], nil
}

// DeletePriceAlert deletes a price alert
func (s *NotificationService) DeletePriceAlert(userID, alertID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	alerts := s.priceAlerts[userID]
	for i, alert := range alerts {
		if alert.ID == alertID {
			s.priceAlerts[userID] = append(alerts[:i], alerts[i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("alert not found")
}

// CheckPriceAlerts checks and triggers price alerts
func (s *NotificationService) CheckPriceAlerts(symbol string, currentPrice float64) []*PriceAlert {
	s.mu.Lock()
	defer s.mu.Unlock()

	var triggered []*PriceAlert

	for userID, alerts := range s.priceAlerts {
		for _, alert := range alerts {
			if alert.Symbol == symbol && alert.IsActive && !alert.IsTriggered {
				shouldTrigger := false

				if alert.Condition == "ABOVE" && currentPrice >= alert.TargetPrice {
					shouldTrigger = true
				} else if alert.Condition == "BELOW" && currentPrice <= alert.TargetPrice {
					shouldTrigger = true
				}

				if shouldTrigger {
					alert.IsTriggered = true
					now := time.Now()
					alert.TriggeredAt = &now

					// Send notification
					notif := &Notification{
						ID:          generateID(),
						UserID:      userID,
						Type:        TypePriceAlert,
						Title:       fmt.Sprintf("Price Alert: %s", symbol),
						Message:     fmt.Sprintf("%s is now %s %.2f (target: %.2f)", symbol, alert.Condition, currentPrice, alert.TargetPrice),
						Priority:    PriorityNormal,
						IsRead:      false,
						Channels:    []NotificationChannel{ChannelInApp, ChannelPush},
						CreatedAt:   time.Now(),
					}
					s.notifications[userID] = append(s.notifications[userID], notif)
					s.unreadCount[userID]++

					triggered = append(triggered, alert)
				}
			}
		}
	}

	return triggered
}

// SubscribeEmail subscribes an email address
func (s *NotificationService) SubscribeEmail(userID, email string) (*EmailSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Generate verification code
	code := generateVerificationCode()

	sub := &EmailSubscription{
		UserID:           userID,
		Email:            email,
		IsVerified:       false,
		VerificationCode:  code,
		VerificationSent:  timePtr(time.Now()),
		Subscribed: map[string]bool{
			"all":            true,
			"order_filled":   true,
			"deposits":       true,
			"withdrawals":    true,
			"security":       true,
			"promotions":     false,
		},
		CreatedAt: time.Now(),
	}

	s.emailSubs[userID] = sub
	return sub, nil
}

// VerifyEmail verifies an email address
func (s *NotificationService) VerifyEmail(userID, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, exists := s.emailSubs[userID]
	if !exists {
		return fmt.Errorf("subscription not found")
	}

	if sub.VerificationCode != code {
		return fmt.Errorf("invalid verification code")
	}

	sub.IsVerified = true
	sub.VerificationCode = ""
	return nil
}

// SendOrderNotification sends an order-related notification
func (s *NotificationService) SendOrderNotification(userID string, orderType string, symbol string, price float64, quantity float64, filledQty float64, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var notifType NotificationType
	var title, message string
	var priority NotificationPriority

	switch status {
	case "FILLED":
		notifType = TypeOrderFilled
		title = fmt.Sprintf("Order Filled: %s", symbol)
		message = fmt.Sprintf("Your %s order for %.8f %s at %.2f has been filled.", orderType, quantity-filledQty, symbol, price)
		priority = PriorityNormal
	case "PARTIAL":
		notifType = TypeOrderPartial
		title = fmt.Sprintf("Order Partial Fill: %s", symbol)
		message = fmt.Sprintf("Your %s order for %.8f %s has been partially filled (%.8f remaining).", orderType, quantity, symbol, quantity-filledQty)
		priority = PriorityNormal
	case "CANCELLED":
		notifType = TypeOrderCancelled
		title = fmt.Sprintf("Order Cancelled: %s", symbol)
		message = fmt.Sprintf("Your %s order for %.8f %s has been cancelled.", orderType, quantity, symbol)
		priority = PriorityNormal
	}

	notif := &Notification{
		ID:          generateID(),
		UserID:      userID,
		Type:        notifType,
		Title:       title,
		Message:     message,
		Data: map[string]string{
			"symbol":   symbol,
			"type":      orderType,
			"price":     fmt.Sprintf("%.2f", price),
			"quantity":  fmt.Sprintf("%.8f", quantity),
			"filled":    fmt.Sprintf("%.8f", filledQty),
			"status":    status,
		},
		Priority:    priority,
		IsRead:      false,
		Channels:    []NotificationChannel{ChannelInApp},
		CreatedAt:   time.Now(),
	}

	s.notifications[userID] = append(s.notifications[userID], notif)
	s.unreadCount[userID]++

	// Add channels based on preferences
	if prefs, exists := s.preferences[userID]; exists {
		s.addChannelsBasedOnPreferences(notif, prefs)
	}

	select {
	case s.eventChan <- notif:
	default:
	}

	return nil
}

// SendSecurityNotification sends a security-related notification
func (s *NotificationService) SendSecurityNotification(userID, eventType, message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	notif := &Notification{
		ID:       generateID(),
		UserID:   userID,
		Type:     TypeSecurity,
		Title:    fmt.Sprintf("Security Alert: %s", eventType),
		Message:  message,
		Data: map[string]string{
			"event_type": eventType,
		},
		Priority:    PriorityUrgent,
		IsRead:      false,
		Channels:    []NotificationChannel{ChannelInApp, ChannelPush, ChannelEmail, ChannelSMS},
		CreatedAt:   time.Now(),
	}

	s.notifications[userID] = append(s.notifications[userID], notif)
	s.unreadCount[userID]++

	select {
	case s.eventChan <- notif:
	default:
	}

	return nil
}

func generateID() string {
	return fmt.Sprintf("NOTIF_%d_%d", time.Now().UnixNano(), rand.Int63())
}

func generateVerificationCode() string {
	b := make([]byte, 6)
	rand.Read(b)
	return fmt.Sprintf("%X", b)[:6]
}

func timePtr(t time.Time) *time.Time {
	return &t
}
