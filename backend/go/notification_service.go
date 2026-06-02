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
// TIGGEREX v3.0 - NOTIFICATION SERVICE
// Complete notification system: Push, Email, SMS, Telegram, In-App
// =============================================================================

// =============================================================================
// NOTIFICATION SERVICE
// =============================================================================

type NotificationService struct {
	db interface{}
	
	// Providers
	emailProvider EmailProvider
	smsProvider SMSProvider
	pushProvider PushProvider
	telegramProvider TelegramProvider
	webSocketHub *WebSocketHub
	
	// Queue
	queue *NotificationQueue
	
	// Templates
	templates map[string]*NotificationTemplate
	
	// Preferences
	preferences map[string]*UserNotificationPreferences
	
	config NotificationConfig
	
	mu sync.RWMutex
}

type NotificationConfig struct {
	// Email
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPassword string
	SMTPFrom string
	UseTLS bool
	
	// SMS
	TwilioAccountSID string
	TwilioAuthToken string
	TwilioFromNumber string
	
	// Push
	FCMServerKey string
	APNSEnabled bool
	APNSKeyPath string
	APNSKeyID string
	APNSTeamID string
	APNSBundleID string
	
	// Telegram
	TelegramBotToken string
	
	// Queue
	QueueWorkers int
	QueueCapacity int
	
	// Retry
	MaxRetries int
	RetryDelay time.Duration
}

type EmailProvider interface {
	Send(ctx context.Context, email *Email) error
}

type SMSProvider interface {
	Send(ctx context.Context, sms *SMS) error
}

type PushProvider interface {
	Send(ctx context.Context, push *PushNotification) error
}

type TelegramProvider interface {
	Send(ctx context.Context, msg *TelegramMessage) error
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

type Notification struct {
	NotificationID string
	UserID string
	
	Type NotificationType
	Channel NotificationChannel
	
	// Content
	Title string
	Body string
	Data map[string]interface{}
	
	// Recipients
	Email string
	Phone string
	DeviceTokens []string
	TelegramChatID string
	
	// Status
	Status NotificationStatus
	SentAt *time.Time
	DeliveredAt *time.Time
	ReadAt *time.Time
	
	// Tracking
	Opens int
	Clicks int
	
	CreatedAt time.Time
	UpdatedAt time.Time
}

type NotificationType string

const (
	NotificationOrder NotificationType = "order"
	NotificationTrade NotificationType = "trade"
	NotificationDeposit NotificationType = "deposit"
	NotificationWithdrawal NotificationType = "withdrawal"
	NotificationTransfer NotificationType = "transfer"
	NotificationSecurity NotificationType = "security"
	NotificationKYC NotificationType = "kyc"
	NotificationMarketing NotificationType = "marketing"
	NotificationSystem NotificationType = "system"
	NotificationPriceAlert NotificationType = "price_alert"
	NotificationLiquidation NotificationType = "liquidation"
	NotificationMarginCall NotificationType = "margin_call"
	NotificationReferral NotificationType = "referral"
	NotificationStaking NotificationType = "staking"
	NotificationSavings NotificationType = "savings"
)

type NotificationChannel string

const (
	ChannelEmail NotificationChannel = "email"
	ChannelSMS NotificationChannel = "sms"
	ChannelPush NotificationChannel = "push"
	ChannelTelegram NotificationChannel = "telegram"
	ChannelInApp NotificationChannel = "in_app"
	ChannelAll NotificationChannel = "all"
)

type NotificationStatus string

const (
	StatusPending NotificationStatus = "pending"
	StatusQueued NotificationStatus = "queued"
	StatusSending NotificationStatus = "sending"
	StatusSent NotificationStatus = "sent"
	StatusDelivered NotificationStatus = "delivered"
	StatusRead NotificationStatus = "read"
	StatusFailed NotificationStatus = "failed"
	StatusBounced NotificationStatus = "bounced"
	StatusUnsubscribed NotificationStatus = "unsubscribed"
)

// Email
type Email struct {
	To string
	From string
	Subject string
	Body string
	HTMLBody string
	TemplateID string
	TemplateData map[string]interface{}
	Attachments []Attachment
	
	Headers map[string]string
}

type Attachment struct {
	Filename string
	Content []byte
	ContentType string
}

// SMS
type SMS struct {
	To string
	From string
	Body string
}

// Push Notification
type PushNotification struct {
	Tokens []string
	Title string
	Body string
	Data map[string]interface{}
	
	Badge int
	Sound string
	ContentAvailable bool
	MutableContent bool
	
	// iOS specific
	Category string
	ThreadID string
	
	// Android specific
	ChannelID string
	Icon string
	Color string
	Tag string
}

// Telegram
type TelegramMessage struct {
	ChatID string
	Text string
	ParseMode string
	DisableWebPagePreview bool
	DisableNotification bool
	ReplyToMessageID int64
	
	Keyboard TelegramKeyboard
}

type TelegramKeyboard struct {
	InlineKeyboard [][]TelegramInlineButton
	Keyboard [][]TelegramKeyboardButton
}

type TelegramInlineButton struct {
	Text string
	URL string
	CallbackData string
}

type TelegramKeyboardButton struct {
	Text string
	RequestContact bool
	RequestLocation bool
}

// =============================================================================
// TEMPLATES
// =============================================================================

type NotificationTemplate struct {
	TemplateID string
	Name string
	Description string
	
	// Channels
	EmailTemplate *EmailTemplate
	SMSTemplate *SMSTemplate
	PushTemplate *PushTemplate
	TelegramTemplate *TelegramTemplate
	
	// Status
	IsActive bool
	
	CreatedAt time.Time
	UpdatedAt time.Time
}

type EmailTemplate struct {
	Subject string
	Body string
	HTMLBody string
	
	Preheader string
}

type SMSTemplate struct {
	Body string
}

type PushTemplate struct {
	Title string
	Body string
}

type TelegramTemplate struct {
	Text string
}

// =============================================================================
// USER PREFERENCES
// =============================================================================

type UserNotificationPreferences struct {
	UserID string
	
	// Channels
	EmailEnabled bool
	SMSEnabled bool
	PushEnabled bool
	TelegramEnabled bool
	InAppEnabled bool
	
	// Categories
	OrderNotifications bool
	TradeNotifications bool
	DepositNotifications bool
	WithdrawalNotifications bool
	SecurityNotifications bool
	KYCNotifications bool
	MarketingNotifications bool
	SystemNotifications bool
	PriceAlertNotifications bool
	LiquidationNotifications bool
	
	// Settings
	QuietHoursStart time.Time
	QuietHoursEnd time.Time
	Timezone string
	
	Language string
	
	// Email specific
	EmailFrequency EmailFrequency
	
	// Push specific
	PushSound string
	PushBadge bool
	
	UpdatedAt time.Time
}

type EmailFrequency string

const (
	FrequencyInstant EmailFrequency = "instant"
	FrequencyDaily EmailFrequency = "daily"
	FrequencyWeekly EmailFrequency = "weekly"
	FrequencyNone EmailFrequency = "none"
)

// =============================================================================
// NOTIFICATION QUEUE
// =============================================================================

type NotificationQueue struct {
	queue chan *NotificationJob
	jobs map[string]*NotificationJob
	
	workers int
	maxRetries int
	
	wg sync.WaitGroup
	ctx context.Context
	cancel context.CancelFunc
}

type NotificationJob struct {
	JobID string
	Notification *Notification
	
	Attempts int
	MaxAttempts int
	
	ScheduledAt time.Time
	StartedAt *time.Time
	CompletedAt *time.Time
	
	Error string
	
	mu sync.RWMutex
}

func NewNotificationQueue(workers, capacity int) *NotificationQueue {
	ctx, cancel := context.WithCancel(context.Background())
	
	q := &NotificationQueue{
		queue: make(chan *NotificationJob, capacity),
		jobs: make(map[string]*NotificationJob),
		workers: workers,
		maxRetries: 3,
		ctx: ctx,
		cancel: cancel,
	}
	
	// Start workers
	for i := 0; i < workers; i++ {
		q.wg.Add(1)
		go q.worker(i)
	}
	
	return q
}

func (q *NotificationQueue) Enqueue(notification *Notification) error {
	job := &NotificationJob{
		JobID: generateJobID(),
		Notification: notification,
		MaxAttempts: q.maxRetries,
		ScheduledAt: time.Now(),
	}
	
	select {
	case q.queue <- job:
		q.jobs[job.JobID] = job
		return nil
	default:
		return fmt.Errorf("queue is full")
	}
}

func (q *NotificationQueue) worker(id int) {
	defer q.wg.Done()
	
	for {
		select {
		case <-q.ctx.Done():
			return
		case job := <-q.queue:
			q.processJob(job)
		}
	}
}

func (q *NotificationQueue) processJob(job *NotificationJob) {
	job.mu.Lock()
	job.StartedAt = new(time.Time)
	*job.StartedAt = time.Now()
	job.mu.Unlock()
	
	// Process notification based on channel
	var err error
	notification := job.Notification
	
	switch notification.Channel {
	case ChannelEmail:
		err = sendEmail(notification)
	case ChannelSMS:
		err = sendSMS(notification)
	case ChannelPush:
		err = sendPush(notification)
	case ChannelTelegram:
		err = sendTelegram(notification)
	case ChannelInApp:
		err = sendInApp(notification)
	case ChannelAll:
		// Send to all channels
		err = sendToAllChannels(notification)
	}
	
	if err != nil {
		job.mu.Lock()
		job.Attempts++
		job.Error = err.Error()
		job.mu.Unlock()
		
		if job.Attempts < job.MaxAttempts {
			// Retry with delay
			time.Sleep(time.Duration(job.Attempts) * time.Minute)
			q.queue <- job
		}
	}
	
	job.mu.Lock()
	now := time.Now()
	job.CompletedAt = &now
	if err == nil {
		job.Notification.Status = StatusSent
	}
	job.mu.Unlock()
}

func sendEmail(notification *Notification) error {
	// Would use email provider
	return nil
}

func sendSMS(notification *Notification) error {
	// Would use SMS provider
	return nil
}

func sendPush(notification *Notification) error {
	// Would use push provider
	return nil
}

func sendTelegram(notification *Notification) error {
	// Would use Telegram provider
	return nil
}

func sendInApp(notification *Notification) error {
	// Would store in database for in-app retrieval
	return nil
}

func sendToAllChannels(notification *Notification) error {
	err := sendEmail(notification)
	if err != nil {
		return err
	}
	
	err = sendPush(notification)
	if err != nil {
		return err
	}
	
	return sendInApp(notification)
}

// =============================================================================
// WEBSOCKET HUB
// =============================================================================

type WebSocketHub struct {
	clients map[string]*WebSocketClient
	rooms map[string]map[string]*WebSocketClient
	
	register chan *WebSocketClient
	unregister chan *WebSocketClient
	broadcast chan *WebSocketMessage
	
	mu sync.RWMutex
}

type WebSocketClient struct {
	ID string
	UserID string
	
	Conn interface{}
	Send chan []byte
	
	Rooms []string
	
	CreatedAt time.Time
	LastActivity time.Time
}

type WebSocketMessage struct {
	Room string
	Type string
	Data interface{}
}

func NewWebSocketHub() *WebSocketHub {
	hub := &WebSocketHub{
		clients: make(map[string]*WebSocketClient),
		rooms: make(map[string]map[string]*WebSocketClient),
		register: make(chan *WebSocketClient),
		unregister: make(chan *WebSocketClient),
		broadcast: make(chan *WebSocketMessage, 256),
	}
	
	go hub.run()
	
	return hub
}

func (h *WebSocketHub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
				
				// Remove from rooms
				for room := range h.rooms {
					delete(h.rooms[room], client.ID)
				}
			}
			h.mu.Unlock()
			
		case message := <-h.broadcast:
			h.mu.RLock()
			clients := h.rooms[message.Room]
			for _, client := range clients {
				select {
				case client.Send <- marshalMessage(message):
				default:
					close(client.Send)
					delete(h.clients, client.ID)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *WebSocketHub) JoinRoom(clientID, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	if _, ok := h.rooms[room]; !ok {
		h.rooms[room] = make(map[string]*WebSocketClient)
	}
	
	if client, ok := h.clients[clientID]; ok {
		h.rooms[room][clientID] = client
		client.Rooms = append(client.Rooms, room)
	}
}

func (h *WebSocketHub) LeaveRoom(clientID, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	if clients, ok := h.rooms[room]; ok {
		delete(clients, clientID)
	}
	
	if client, ok := h.clients[clientID]; ok {
		// Remove room from client's rooms
		for i, r := range client.Rooms {
			if r == room {
				client.Rooms = append(client.Rooms[:i], client.Rooms[i+1:]...)
			}
		}
	}
}

func (h *WebSocketHub) SendToUser(userID string, message *WebSocketMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	for _, client := range h.clients {
		if client.UserID == userID {
			select {
			case client.Send <- marshalMessage(message):
			default:
			}
		}
	}
}

func marshalMessage(msg *WebSocketMessage) []byte {
	data, _ := json.Marshal(msg)
	return data
}

// =============================================================================
// NOTIFICATION TEMPLATES
// =============================================================================

var defaultTemplates = map[string]*NotificationTemplate{
	"order_placed": {
		TemplateID: "order_placed",
		Name: "Order Placed",
		Description: "Sent when a user places an order",
		EmailTemplate: &EmailTemplate{
			Subject: "Order Placed - {{symbol}}",
			Body: "Your order for {{symbol}} has been placed.",
			HTMLBody: "<h2>Order Placed</h2><p>Your {{side}} order for {{quantity}} {{symbol}} at {{price}} has been placed.</p>",
		},
		PushTemplate: &PushTemplate{
			Title: "Order Placed",
			Body: "{{side}} {{quantity}} {{symbol}} at {{price}}",
		},
	},
	
	"order_filled": {
		TemplateID: "order_filled",
		Name: "Order Filled",
		Description: "Sent when an order is fully or partially filled",
		EmailTemplate: &EmailTemplate{
			Subject: "Order Filled - {{symbol}}",
			Body: "Your order for {{symbol}} has been filled.",
			HTMLBody: "<h2>Order Filled</h2><p>Your {{side}} order for {{quantity}} {{symbol}} at {{price}} has been filled.</p>",
		},
		PushTemplate: &PushTemplate{
			Title: "Order Filled! 🎉",
			Body: "{{filled_quantity}}/{{quantity}} {{symbol}} at {{price}}",
		},
	},
	
	"deposit_received": {
		TemplateID: "deposit_received",
		Name: "Deposit Received",
		Description: "Sent when a deposit is confirmed",
		EmailTemplate: &EmailTemplate{
			Subject: "Deposit Received - +{{amount}} {{currency}}",
			Body: "Your deposit of {{amount}} {{currency}} has been confirmed.",
			HTMLBody: "<h2>Deposit Received</h2><p>We received your deposit of <strong>{{amount}} {{currency}}</strong>.</p><p>Transaction Hash: {{tx_hash}}</p>",
		},
		PushTemplate: &PushTemplate{
			Title: "Deposit Received! 💰",
			Body: "+{{amount}} {{currency}} confirmed",
		},
	},
	
	"withdrawal_processed": {
		TemplateID: "withdrawal_processed",
		Name: "Withdrawal Processed",
		Description: "Sent when a withdrawal is processed",
		EmailTemplate: &EmailTemplate{
			Subject: "Withdrawal Processed - {{amount}} {{currency}}",
			Body: "Your withdrawal of {{amount}} {{currency}} has been processed.",
			HTMLBody: "<h2>Withdrawal Processed</h2><p>Your withdrawal of <strong>{{amount}} {{currency}}</strong> to address {{address}} has been broadcast.</p><p>Transaction Hash: {{tx_hash}}</p>",
		},
		PushTemplate: &PushTemplate{
			Title: "Withdrawal Sent",
			Body: "{{amount}} {{currency}} sent to {{address}}",
		},
	},
	
	"security_alert": {
		TemplateID: "security_alert",
		Name: "Security Alert",
		Description: "Sent for security-related events",
		EmailTemplate: &EmailTemplate{
			Subject: "⚠️ Security Alert - {{event}}",
			Body: "Security alert: {{event}}",
			HTMLBody: "<h2 style='color:red'>⚠️ Security Alert</h2><p>{{event}}</p><p>IP: {{ip}}</p><p>Time: {{time}}</p>",
		},
		PushTemplate: &PushTemplate{
			Title: "⚠️ Security Alert",
			Body: "{{event}} from {{ip}}",
		},
	},
	
	"price_alert": {
		TemplateID: "price_alert",
		Name: "Price Alert",
		Description: "Sent when price reaches target",
		EmailTemplate: &EmailTemplate{
			Subject: "{{symbol}} Price Alert - {{price}}",
			Body: "{{symbol}} has reached {{price}}",
			HTMLBody: "<h2>Price Alert</h2><p>{{symbol}} is now trading at <strong>{{price}}</strong></p>",
		},
		PushTemplate: &PushTemplate{
			Title: "📈 Price Alert: {{symbol}}",
			Body: "Now at {{price}} ({{change}})",
		},
	},
	
	"liquidation_warning": {
		TemplateID: "liquidation_warning",
		Name: "Liquidation Warning",
		Description: "Sent when position is at risk of liquidation",
		EmailTemplate: &EmailTemplate{
			Subject: "⚠️ Liquidation Warning - {{symbol}}",
			Body: "Your {{symbol}} position is at risk of liquidation.",
			HTMLBody: "<h2 style='color:orange'>⚠️ Liquidation Warning</h2><p>Your {{side}} position in {{symbol}} is at risk.</p><p>Margin Ratio: {{margin_ratio}}%</p><p>Liquidation Price: {{liquidation_price}}</p>",
		},
		PushTemplate: &PushTemplate{
			Title: "⚠️ Liquidation Warning",
			Body: "{{symbol}} position at risk. Margin: {{margin_ratio}}%",
		},
	},
}

// =============================================================================
// SERVICE METHODS
// =============================================================================

func NewNotificationService(db interface{}, config NotificationConfig) *NotificationService {
	s := &NotificationService{
		db: db,
		queue: NewNotificationQueue(config.QueueWorkers, config.QueueCapacity),
		templates: defaultTemplates,
		preferences: make(map[string]*UserNotificationPreferences),
		config: config,
		webSocketHub: NewWebSocketHub(),
	}
	
	return s
}

// SendNotification sends a notification to a user
func (s *NotificationService) SendNotification(ctx context.Context, userID string, notification *Notification) error {
	notification.NotificationID = generateNotificationID()
	notification.UserID = userID
	notification.Status = StatusPending
	notification.CreatedAt = time.Now()
	notification.UpdatedAt = time.Now()
	
	// Check user preferences
	prefs, exists := s.preferences[userID]
	if exists {
		if !s.shouldSend(notification, prefs) {
			return nil
		}
	}
	
	// Queue for sending
	return s.queue.Enqueue(notification)
}

// SendTemplatedNotification sends a notification using a template
func (s *NotificationService) SendTemplatedNotification(ctx context.Context, userID, templateID string, data map[string]interface{}) error {
	template, exists := s.templates[templateID]
	if !exists {
		return fmt.Errorf("template not found: %s", templateID)
	}
	
	notification := &Notification{
		Type: getNotificationType(templateID),
		Channel: ChannelAll,
		Data: data,
	}
	
	// Fill template
	if template.EmailTemplate != nil {
		notification.Title = fillTemplate(template.EmailTemplate.Subject, data)
		notification.Body = fillTemplate(template.EmailTemplate.Body, data)
	}
	
	if template.PushTemplate != nil {
		// Override with push template
	}
	
	return s.SendNotification(ctx, userID, notification)
}

func (s *NotificationService) shouldSend(notification *Notification, prefs *UserNotificationPreferences) bool {
	// Check channel
	switch notification.Channel {
	case ChannelEmail:
		if !prefs.EmailEnabled {
			return false
		}
	case ChannelSMS:
		if !prefs.SMSEnabled {
			return false
		}
	case ChannelPush:
		if !prefs.PushEnabled {
			return false
		}
	case ChannelTelegram:
		if !prefs.TelegramEnabled {
			return false
		}
	case ChannelInApp:
		if !prefs.InAppEnabled {
			return false
		}
	}
	
	// Check quiet hours
	now := time.Now()
	if prefs.QuietHoursStart.Before(prefs.QuietHoursEnd) {
		if now.After(prefs.QuietHoursStart) && now.Before(prefs.QuietHoursEnd) {
			return false
		}
	}
	
	// Check category
	switch notification.Type {
	case NotificationOrder:
		return prefs.OrderNotifications
	case NotificationTrade:
		return prefs.TradeNotifications
	case NotificationDeposit:
		return prefs.DepositNotifications
	case NotificationWithdrawal:
		return prefs.WithdrawalNotifications
	case NotificationSecurity:
		return prefs.SecurityNotifications
	case NotificationKYC:
		return prefs.KYCNotifications
	case NotificationMarketing:
		return prefs.MarketingNotifications
	case NotificationSystem:
		return prefs.SystemNotifications
	case NotificationPriceAlert:
		return prefs.PriceAlertNotifications
	case NotificationLiquidation:
		return prefs.LiquidationNotifications
	}
	
	return true
}

// GetUserNotifications gets notifications for a user
func (s *NotificationService) GetUserNotifications(ctx context.Context, userID string, limit, offset int) ([]*Notification, int64, error) {
	// Would query database
	return []*Notification{}, 0, nil
}

// MarkAsRead marks a notification as read
func (s *NotificationService) MarkAsRead(ctx context.Context, notificationID, userID string) error {
	// Would update database
	return nil
}

// UpdatePreferences updates user notification preferences
func (s *NotificationService) UpdatePreferences(ctx context.Context, userID string, prefs *UserNotificationPreferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	prefs.UpdatedAt = time.Now()
	s.preferences[userID] = prefs
	
	return nil
}

// =============================================================================
// HELPERS
// =============================================================================

func generateNotificationID() string {
	return fmt.Sprintf("NOTIF_%d", time.Now().UnixNano())
}

func generateJobID() string {
	return fmt.Sprintf("JOB_%d", time.Now().UnixNano())
}

func getNotificationType(templateID string) NotificationType {
	switch templateID {
	case "order_placed", "order_filled":
		return NotificationOrder
	case "deposit_received":
		return NotificationDeposit
	case "withdrawal_processed":
		return NotificationWithdrawal
	case "security_alert":
		return NotificationSecurity
	case "price_alert":
		return NotificationPriceAlert
	case "liquidation_warning", "margin_call":
		return NotificationLiquidation
	default:
		return NotificationSystem
	}
}

func fillTemplate(template string, data map[string]interface{}) string {
	result := template
	for key, value := range data {
		placeholder := "{{" + key + "}}"
		result = replaceAll(result, placeholder, fmt.Sprintf("%v", value))
	}
	return result
}

func replaceAll(s, old, new string) string {
	for {
		idx := indexOf(s, old)
		if idx == -1 {
			break
		}
		s = s[:idx] + new + s[idx+len(old):]
	}
	return s
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func new(t time.Time) *time.Time {
	return &t
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Println("TigerEx Notification Service v3.0 starting...")
	
	config := NotificationConfig{
		SMTPHost: "smtp.example.com",
		SMTPPort: 587,
		SMTPUseTLS: true,
		
		TwilioAccountSID: "",
		TwilioFromNumber: "",
		
		FCMServerKey: "",
		
		TelegramBotToken: "",
		
		QueueWorkers: 10,
		QueueCapacity: 10000,
		
		MaxRetries: 3,
		RetryDelay: time.Minute,
	}
	
	service := NewNotificationService(nil, config)
	
	log.Printf("[NOTIFICATION] Service started with %d workers", config.QueueWorkers)
	
	// Create templates
	log.Printf("[NOTIFICATION] Templates loaded: %d", len(service.templates))
	for id := range service.templates {
		log.Printf("  - %s", id)
	}
}