// =============================================================================
// TIGEREX v3.0 - NOTIFICATION SERVICE
// Push, Email, SMS, Telegram
// =============================================================================

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

type NotificationType string
type NotificationChannel string

const (
	NotificationTypeOrder        NotificationType = "order"
	NotificationTypeTrade        NotificationType = "trade"
	NotificationTypeDeposit      NotificationType = "deposit"
	NotificationTypeWithdrawal   NotificationType = "withdrawal"
	NotificationTypeSecurity     NotificationType = "security"
	NotificationTypeMargin       NotificationType = "margin"
	NotificationTypeLiquidation   NotificationType = "liquidation"
	NotificationTypePromotional  NotificationType = "promotional"
	NotificationTypeSystem       NotificationType = "system"

	ChannelPush    NotificationChannel = "push"
	ChannelEmail   NotificationChannel = "email"
	ChannelSMS     NotificationChannel = "sms"
	ChannelTelegram NotificationChannel = "telegram"
	ChannelInApp   NotificationChannel = "in_app"
)

// Notification represents a notification
type Notification struct {
	NotificationID   string               `json:"notificationId"`
	UserID          string               `json:"userId"`
	Type            NotificationType      `json:"type"`
	Channel         NotificationChannel   `json:"channel"`
	Title           string               `json:"title"`
	Message         string               `json:"message"`
	Data            map[string]interface{} `json:"data,omitempty"`
	Priority        string               `json:"priority"` // low, medium, high, urgent
	Read            bool                 `json:"read"`
	ReadAt          int64                `json:"readAt,omitempty"`
	CreatedAt       int64                `json:"createdAt"`
	SentAt          int64                `json:"sentAt,omitempty"`
	FailedAt        int64                `json:"failedAt,omitempty"`
	RetryCount      int                  `json:"retryCount"`
	Error           string               `json:"error,omitempty"`
}

// Push token for mobile notifications
type PushToken struct {
	UserID    string `json:"userId"`
	Token     string `json:"token"`
	Platform  string `json:"platform"` // ios, android, web
	DeviceID  string `json:"deviceId"`
	Active    bool   `json:"active"`
	CreatedAt int64  `json:"createdAt"`
}

// Email subscription
type EmailSubscription struct {
	UserID      string    `json:"userId"`
	Email       string    `json:"email"`
	Verified    bool      `json:"verified"`
	Preferences map[string]bool `json:"preferences"` // marketing, orders, deposits, etc.
	CreatedAt   int64     `json:"createdAt"`
}

// SMS subscription
type SMSSubscription struct {
	UserID    string    `json:"userId"`
	Phone     string    `json:"phone"`
	Country   string    `json:"country"`
	Verified  bool      `json:"verified"`
	CreatedAt int64     `json:"createdAt"`
}

// Telegram subscription
type TelegramSubscription struct {
	UserID       string `json:"userId"`
	ChatID       string `json:"chatId"`
	Username     string `json:"username"`
	Active       bool   `json:"active"`
	CreatedAt    int64  `json:"createdAt"`
}

// =============================================================================
// NOTIFICATION SERVICE
// =============================================================================

type NotificationService struct {
	mu sync.RWMutex

	// Notifications
	notifications   map[string]*Notification // notificationId -> Notification
	userNotifications map[string][]*Notification // userId -> Notifications

	// Subscriptions
	pushTokens    map[string][]*PushToken // userId -> tokens
	emailSub      map[string]*EmailSubscription // userId -> subscription
	smsSub        map[string]*SMSSubscription // userId -> subscription
	telegramSub   map[string]*TelegramSubscription // userId -> subscription

	// Email templates
	templates map[string]*EmailTemplate

	// Queue
	queue      []*Notification
	processing bool

	// Configuration
	config NotificationConfig

	// Callbacks for external services
	onPushSend     func(*Notification) error
	onEmailSend    func(*Notification) error
	onSMSSend      func(*Notification) error
	onTelegramSend func(*Notification) error

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type NotificationConfig struct {
	MaxRetries      int
	RetryDelay      int64 // seconds
	BatchSize       int
	EmailFrom       string
	EmailFromName   string
	SMSFrom         string
	PushEnabled     bool
	EmailEnabled     bool
	SMSEnabled      bool
	TelegramEnabled bool
}

type EmailTemplate struct {
	TemplateID string
	Subject    string
	Body       string
	Variables  []string
}

// =============================================================================
// NOTIFICATION SERVICE METHODS
// =============================================================================

func NewNotificationService() *NotificationService {
	ctx, cancel := context.WithCancel(context.Background())

	service := &NotificationService{
		notifications:    make(map[string]*Notification),
		userNotifications: make(map[string][]*Notification),
		pushTokens:        make(map[string][]*PushToken),
		emailSub:          make(map[string]*EmailSubscription),
		smsSub:            make(map[string]*SMSSubscription),
		telegramSub:       make(map[string]*TelegramSubscription),
		templates:         make(map[string]*EmailTemplate),
		queue:             make([]*Notification, 0),
		ctx:               ctx,
		cancel:            cancel,
		config: NotificationConfig{
			MaxRetries:      3,
			RetryDelay:      60,
			BatchSize:       100,
			EmailFrom:       "noreply@tigerex.com",
			EmailFromName:   "TigerEx",
			SMSFrom:         "TigerEx",
			PushEnabled:     true,
			EmailEnabled:    true,
			SMSEnabled:      true,
			TelegramEnabled: true,
		},
	}

	// Initialize email templates
	service.initializeTemplates()

	// Start workers
	service.startWorkers()

	return service
}

func (n *NotificationService) initializeTemplates() {
	n.templates = map[string]*EmailTemplate{
		"welcome": {
			TemplateID: "welcome",
			Subject:    "Welcome to TigerEx!",
			Body:       "Hello {{name}},\n\nWelcome to TigerEx! Your account has been created successfully.\n\nGet started: {{link}}\n\nBest regards,\nTigerEx Team",
			Variables:  []string{"name", "link"},
		},
		"deposit_confirmation": {
			TemplateID: "deposit_confirmation",
			Subject:    "Deposit Confirmed - {{amount}} {{currency}}",
			Body:       "Hello {{name}},\n\nYour deposit of {{amount}} {{currency}} has been confirmed.\n\nTransaction Hash: {{txHash}}\n\nView in explorer: {{explorerLink}}\n\nBest regards,\nTigerEx",
			Variables:  []string{"name", "amount", "currency", "txHash", "explorerLink"},
		},
		"withdrawal_request": {
			TemplateID: "withdrawal_request",
			Subject:    "Withdrawal Request - Action Required",
			Body:       "Hello {{name}},\n\nA withdrawal of {{amount}} {{currency}} has been initiated from your account.\n\nTo Address: {{address}}\n\nIf you did not initiate this request, please contact support immediately.\n\nBest regards,\nTigerEx Security",
			Variables:  []string{"name", "amount", "currency", "address"},
		},
		"order_filled": {
			TemplateID: "order_filled",
			Subject:    "Order Filled - {{symbol}}",
			Body:       "Hello {{name}},\n\nYour {{side}} order for {{quantity}} {{symbol}} has been filled.\n\nPrice: {{price}}\nTotal: {{total}}\n\nBest regards,\nTigerEx",
			Variables:  []string{"name", "side", "quantity", "symbol", "price", "total"},
		},
		"margin_warning": {
			TemplateID: "margin_warning",
			Subject:    "Margin Warning - {{symbol}}",
			Body:       "Hello {{name}},\n\nYour position on {{symbol}} is approaching liquidation.\n\nMargin Ratio: {{marginRatio}}%\nLiquidation Price: {{liquidationPrice}}\n\nPlease add margin or reduce position immediately.\n\nBest regards,\nTigerEx",
			Variables:  []string{"name", "symbol", "marginRatio", "liquidationPrice"},
		},
		"security_alert": {
			TemplateID: "security_alert",
			Subject:    "Security Alert - {{event}}",
			Body:       "Hello {{name}},\n\nWe detected a {{event}} on your account.\n\nTime: {{time}}\nIP: {{ip}}\nLocation: {{location}}\n\nIf this wasn't you, please secure your account immediately.\n\nBest regards,\nTigerEx Security",
			Variables:  []string{"name", "event", "time", "ip", "location"},
		},
	}
}

func (n *NotificationService) startWorkers() {
	// Queue processor
	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-n.ctx.Done():
				return
			case <-ticker.C:
				n.processQueue()
			}
		}
	}()

	// Cleanup old notifications
	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-n.ctx.Done():
				return
			case <-ticker.C:
				n.cleanupOldNotifications()
			}
		}
	}()
}

func (n *NotificationService) Shutdown() {
	n.cancel()
	n.wg.Wait()
}

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

func (n *NotificationService) RegisterPushToken(userID, token, platform, deviceID string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	pushToken := &PushToken{
		UserID:    userID,
		Token:     token,
		Platform:  platform,
		DeviceID:  deviceID,
		Active:    true,
		CreatedAt: time.Now().UnixMilli(),
	}

	n.pushTokens[userID] = append(n.pushTokens[userID], pushToken)

	log.Printf("[INFO] Push token registered for user %s", userID)
	return nil
}

func (n *NotificationService) RegisterEmail(userID, email string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.emailSub[userID] = &EmailSubscription{
		UserID:  userID,
		Email:   email,
		Verified: false,
		Preferences: map[string]bool{
			"marketing":    true,
			"orders":       true,
			"deposits":     true,
			"withdrawals":  true,
			"security":     true,
		},
		CreatedAt: time.Now().UnixMilli(),
	}

	log.Printf("[INFO] Email registered for user %s: %s", userID, email)
	return nil
}

func (n *NotificationService) RegisterPhone(userID, phone, country string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.smsSub[userID] = &SMSSubscription{
		UserID:    userID,
		Phone:     phone,
		Country:   country,
		Verified:  false,
		CreatedAt: time.Now().UnixMilli(),
	}

	log.Printf("[INFO] Phone registered for user %s: %s", userID, phone)
	return nil
}

func (n *NotificationService) RegisterTelegram(userID, chatID, username string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.telegramSub[userID] = &TelegramSubscription{
		UserID:    userID,
		ChatID:    chatID,
		Username:  username,
		Active:    true,
		CreatedAt: time.Now().UnixMilli(),
	}

	log.Printf("[INFO] Telegram registered for user %s: %s", userID, chatID)
	return nil
}

// =============================================================================
// NOTIFICATION SENDING
// =============================================================================

func (n *NotificationService) Send(notification *Notification) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	notification.NotificationID = fmt.Sprintf("notif_%d", time.Now().UnixNano())
	notification.CreatedAt = time.Now().UnixMilli()
	notification.Read = false

	n.notifications[notification.NotificationID] = notification
	n.userNotifications[notification.UserID] = append(
		n.userNotifications[notification.UserID],
		notification,
	)

	// Add to queue for processing
	n.queue = append(n.queue, notification)

	log.Printf("[INFO] Notification queued: %s type=%s user=%s channel=%s",
		notification.NotificationID, notification.Type, notification.UserID, notification.Channel)

	return nil
}

func (n *NotificationService) SendOrderUpdate(userID string, orderData map[string]interface{}) error {
	notification := &Notification{
		UserID: userID,
		Type:   NotificationTypeOrder,
		Title:  "Order Update",
		Message: fmt.Sprintf("Your %s order for %s %s has been %s",
			orderData["side"], orderData["quantity"], orderData["symbol"], orderData["status"]),
		Data:    orderData,
		Priority: "medium",
		Channel: ChannelEmail,
	}

	return n.Send(notification)
}

func (n *NotificationService) SendDepositNotification(userID string, amount, currency, txHash string) error {
	notification := &Notification{
		UserID: userID,
		Type:   NotificationTypeDeposit,
		Title:  "Deposit Confirmed",
		Message: fmt.Sprintf("Your deposit of %s %s has been confirmed.", amount, currency),
		Data: map[string]interface{}{
			"amount":   amount,
			"currency": currency,
			"txHash":   txHash,
		},
		Priority: "medium",
		Channel: ChannelPush,
	}

	return n.Send(notification)
}

func (n *NotificationService) SendWithdrawalNotification(userID string, amount, currency, address string) error {
	notification := &Notification{
		UserID: userID,
		Type:   NotificationTypeWithdrawal,
		Title:  "Withdrawal Initiated",
		Message: fmt.Sprintf("Your withdrawal of %s %s has been initiated to address %s.", amount, currency, address),
		Data: map[string]interface{}{
			"amount":   amount,
			"currency": currency,
			"address":  address,
		},
		Priority: "high",
		Channel: ChannelPush,
	}

	return n.Send(notification)
}

func (n *NotificationService) SendSecurityAlert(userID, event, ip, location string) error {
	notification := &Notification{
		UserID: userID,
		Type:   NotificationTypeSecurity,
		Title:  "Security Alert: " + event,
		Message: fmt.Sprintf("A %s was detected on your account. If this wasn't you, please secure your account immediately.", event),
		Data: map[string]interface{}{
			"event":    event,
			"ip":       ip,
			"location": location,
			"time":     time.Now().Format("2006-01-02 15:04:05"),
		},
		Priority: "urgent",
		Channel: ChannelPush,
	}

	return n.Send(notification)
}

func (n *NotificationService) SendMarginWarning(userID string, symbol string, marginRatio float64, liqPrice float64) error {
	notification := &Notification{
		UserID: userID,
		Type:   NotificationTypeMargin,
		Title:  "Margin Warning - " + symbol,
		Message: fmt.Sprintf("Your position on %s is approaching liquidation. Margin ratio: %.2f%%", symbol, marginRatio),
		Data: map[string]interface{}{
			"symbol":          symbol,
			"marginRatio":     marginRatio,
			"liquidationPrice": liqPrice,
		},
		Priority: "high",
		Channel: ChannelPush,
	}

	return n.Send(notification)
}

func (n *NotificationService) SendLiquidationAlert(userID, symbol string, pnl float64) error {
	notification := &Notification{
		UserID: userID,
		Type:   NotificationTypeLiquidation,
		Title:  "Position Liquidated - " + symbol,
		Message: fmt.Sprintf("Your position on %s has been liquidated. PnL: %.2f", symbol, pnl),
		Data: map[string]interface{}{
			"symbol": symbol,
			"pnl":    pnl,
		},
		Priority: "urgent",
		Channel: ChannelPush,
	}

	return n.Send(notification)
}

// =============================================================================
// QUEUE PROCESSING
// =============================================================================

func (n *NotificationService) processQueue() {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.processing || len(n.queue) == 0 {
		return
	}

	n.processing = true
	defer func() { n.processing = false }()

	// Process batch
	batchSize := n.config.BatchSize
	if batchSize > len(n.queue) {
		batchSize = len(n.queue)
	}

	for i := 0; i < batchSize; i++ {
		notif := n.queue[0]
		n.queue = n.queue[1:]

		go n.sendNotification(notif)
	}
}

func (n *NotificationService) sendNotification(notif *Notification) {
	var err error

	switch notif.Channel {
	case ChannelPush:
		if n.onPushSend != nil {
			err = n.onPushSend(notif)
		}
	case ChannelEmail:
		if n.onEmailSend != nil {
			err = n.onEmailSend(notif)
		}
	case ChannelSMS:
		if n.onSMSSend != nil {
			err = n.onSMSSend(notif)
		}
	case ChannelTelegram:
		if n.onTelegramSend != nil {
			err = n.onTelegramSend(notif)
		}
	case ChannelInApp:
		// In-app notifications are stored directly
		n.mu.Lock()
		notif.SentAt = time.Now().UnixMilli()
		n.mu.Unlock()
		return
	}

	n.mu.Lock()
	defer n.mu.Unlock()

	if err != nil {
		notif.Error = err.Error()
		notif.RetryCount++

		if notif.RetryCount < n.config.MaxRetries {
			// Re-queue for retry
			n.queue = append(n.queue, notif)
		} else {
			notif.FailedAt = time.Now().UnixMilli()
		}

		log.Printf("[ERROR] Notification failed: %s error=%s retry=%d",
			notif.NotificationID, err.Error(), notif.RetryCount)
	} else {
		notif.SentAt = time.Now().UnixMilli()
		log.Printf("[INFO] Notification sent: %s", notif.NotificationID)
	}
}

// =============================================================================
// NOTIFICATION QUERIES
// =============================================================================

func (n *NotificationService) GetUserNotifications(userID string, limit int) []*Notification {
	n.mu.RLock()
	defer n.mu.RUnlock()

	notifications := n.userNotifications[userID]
	if limit > 0 && len(notifications) > limit {
		return notifications[len(notifications)-limit:]
	}
	return notifications
}

func (n *NotificationService) GetUnreadCount(userID string) int {
	n.mu.RLock()
	defer n.mu.RUnlock()

	count := 0
	for _, notif := range n.userNotifications[userID] {
		if !notif.Read {
			count++
		}
	}
	return count
}

func (n *NotificationService) MarkAsRead(notificationID string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	notif, ok := n.notifications[notificationID]
	if !ok {
		return fmt.Errorf("notification not found")
	}

	notif.Read = true
	notif.ReadAt = time.Now().UnixMilli()

	return nil
}

func (n *NotificationService) MarkAllAsRead(userID string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	for _, notif := range n.userNotifications[userID] {
		if !notif.Read {
			notif.Read = true
			notif.ReadAt = time.Now().UnixMilli()
		}
	}

	return nil
}

func (n *NotificationService) DeleteNotification(notificationID string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	delete(n.notifications, notificationID)
	return nil
}

// =============================================================================
// CLEANUP
// =============================================================================

func (n *NotificationService) cleanupOldNotifications() {
	n.mu.Lock()
	defer n.mu.Unlock()

	// Delete notifications older than 90 days
	cutoff := time.Now().AddDate(0, 0, -90).UnixMilli()

	for userID, notifications := range n.userNotifications {
		var keep []*Notification
		for _, notif := range notifications {
			if notif.CreatedAt > cutoff {
				keep = append(keep, notif)
			}
		}
		n.userNotifications[userID] = keep
	}
}

// =============================================================================
// STATS
// =============================================================================

func (n *NotificationService) GetStats() map[string]interface{} {
	n.mu.RLock()
	defer n.mu.RUnlock()

	var sent, failed, pending int
	for _, notif := range n.notifications {
		if notif.SentAt > 0 {
			sent++
		} else if notif.FailedAt > 0 {
			failed++
		} else {
			pending++
		}
	}

	return map[string]interface{}{
		"total":         len(n.notifications),
		"sent":          sent,
		"failed":        failed,
		"pending":       pending,
		"queue_size":    len(n.queue),
		"push_tokens":   len(n.pushTokens),
		"email_subs":    len(n.emailSub),
		"sms_subs":      len(n.smsSub),
		"telegram_subs": len(n.telegramSub),
	}
}

// Placeholder
var _ = json.Marshal