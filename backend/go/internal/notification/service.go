// Notification Service - Real-Time Path in Go
// Handles billions of notifications

package notification

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

// Notification type
type NotificationType int

const (
	NotificationTypeEmail NotificationType = iota
	NotificationTypeSMS
	NotificationTypePush
	NotificationTypeInApp
)

// Priority
type Priority int

const (
	PriorityLow Priority = iota
	PriorityMedium
	PriorityHigh
	PriorityCritical
)

// Notification status
type Status int

const (
	StatusPending Status = iota
	StatusSent
	StatusDelivered
	StatusFailed
	StatusClicked
)

// Template
type Template struct {
	ID        string
	Name      string
	Subject   string
	Body      string
	Variables []string
}

// Notification
type Notification struct {
	ID         string
	Type      NotificationType
	Recipient string
	Subject   string
	Body      string
	Priority  Priority
	Status    Status
	Metadata  map[string]string
	CreatedAt time.Time
	SentAt    *time.Time
	ClickedAt *time.Time
	Error     string
}

// Channel handler interface
type ChannelHandler interface {
	Send(n *Notification) error
	GetName() string
}

// Email handler
type EmailHandler struct {
	smtpHost string
	smtpPort int
	from     string
}

func NewEmailHandler() *EmailHandler {
	return &EmailHandler{
		smtpHost: "smtp.example.com",
		smtpPort: 587,
		from:     "noreply@tigerex.com",
	}
}

func (e *EmailHandler) Send(n *Notification) error {
	// Production: integrate with SendGrid, AWS SES, etc.
	log.Printf("[EMAIL] Sending to %s: %s", n.Recipient, n.Subject)
	return nil
}

func (e *EmailHandler) GetName() string { return "email" }

// SMS handler
type SMSHandler struct {
	provider string
}

func NewSMSHandler() *SMSHandler {
	return &SMSHandler{provider: "twilio"}
}

func (s *SMSHandler) Send(n *Notification) error {
	log.Printf("[SMS] Sending to %s", n.Recipient)
	return nil
}

func (s *SMSHandler) GetName() string { return "sms" }

// Push handler
type PushHandler struct {
	fcmKey string
}

func NewPushHandler() *PushHandler {
	return &PushHandler{fcmKey: "firebase-key"}
}

func (p *PushHandler) Send(n *Notification) error {
	log.Printf("[PUSH] Sending to %s", n.Recipient)
	return nil
}

func (p *PushHandler) GetName() string { return "push" }

// Notification Service
type Service struct {
	// Channels
	channels map[NotificationType]ChannelHandler
	
	// Queue
	queue    chan *Notification
	workers  int
	
	// Templates
	templates map[string]*Template
	
	// Stats
	sent     int64
	failed   int64
	clicked  int64
	
	mu       sync.RWMutex
	stopCh   chan bool
}

// NewService creates notification service
func NewService(workers int) *Service {
	svc := &Service{
		channels: make(map[NotificationType]ChannelHandler),
		queue:    make(chan *Notification, 10000),
		workers:  workers,
		templates: make(map[string]*Template),
		stopCh:   make(chan bool),
	}
	
	// Register channels
	svc.channels[NotificationTypeEmail] = NewEmailHandler()
	svc.channels[NotificationTypeSMS] = NewSMSHandler()
	svc.channels[NotificationTypePush] = NewPushHandler()
	
	// Load default templates
	svc.loadTemplates()
	
	return svc
}

func (s *Service) loadTemplates() {
	s.templates["welcome"] = &Template{
		ID:      "welcome",
		Name:    "Welcome",
		Subject: "Welcome to TigerEx",
		Body:    "Hello {{name}}, welcome to TigerEx!",
	}
	
	s.templates["order_filled"] = &Template{
		ID:      "order_filled",
		Name:    "Order Filled",
		Subject: "Your order has been filled",
		Body:    "Your {{side}} order of {{quantity}} {{symbol}} has been filled at {{price}}",
	}
	
	s.templates["withdrawal"] = &Template{
		ID:      "withdrawal",
		Name:    "Withdrawal",
		Subject: "Withdrawal processed",
		Body:    "Your withdrawal of {{amount}} {{asset}} has been processed",
	}
	
	s.templates["security_alert"] = &Template{
		ID:      "security_alert",
		Name:    "Security Alert",
		Subject: "Security Alert: {{event}}",
		Body:    "We detected a {{event}} on your account at {{time}}",
	}
}

// Start begins processing notifications
func (s *Service) Start() {
	for i := 0; i < s.workers; i++ {
		go s.worker(i)
	}
	log.Printf("Notification service started with %d workers", s.workers)
}

// Stop stops the service
func (s *Service) Stop() {
	close(s.stopCh)
}

// Send queues notification
func (s *Service) Send(notif *Notification) error {
	select {
	case s.queue <- notif:
		return nil
	default:
		return fmt.Errorf("queue full")
	}
}

// SendTemplate sends notification using template
func (s *Service) SendTemplate(recipient string, templateID string, vars map[string]string, priority Priority) error {
	tpl, ok := s.templates[templateID]
	if !ok {
		return fmt.Errorf("template not found: %s", templateID)
	}
	
	body := tpl.Body
	subject := tpl.Subject
	
	// Replace variables
	for k, v := range vars {
		body = replace(body, "{{"+k+"}}", v)
		subject = replace(subject, "{{"+k+"}}", v)
	}
	
	notif := &Notification{
		ID:        generateID("notif"),
		Type:      NotificationTypeEmail,
		Recipient: recipient,
		Subject:   subject,
		Body:      body,
		Priority:  priority,
		Status:    StatusPending,
		Metadata:  vars,
		CreatedAt: time.Now(),
	}
	
	return s.Send(notif)
}

func (s *Service) worker(id int) {
	for {
		select {
		case <-s.stopCh:
			return
		case notif := <-s.queue:
			s.process(notif)
		}
	}
}

func (s *Service) process(n *Notification) {
	handler, ok := s.channels[n.Type]
	if !ok {
		n.Status = StatusFailed
		n.Error = "no handler"
		s.failed++
		return
	}
	
	if err := handler.Send(n); err != nil {
		n.Status = StatusFailed
		n.Error = err.Error()
		s.failed++
		return
	}
	
	now := time.Now()
	n.Status = StatusSent
	n.SentAt = &now
	s.sent++
}

// SendBatch sends multiple notifications
func (s *Service) SendBatch(notifications []*Notification) (sent, failed int) {
	for _, n := range notifications {
		if err := s.Send(n); err != nil {
			failed++
		} else {
			sent++
		}
	}
	return
}

// GetStats returns service statistics
func (s *Service) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return map[string]interface{}{
		"sent":    s.sent,
		"failed":  s.failed,
		"clicked": s.clicked,
		"queue":   len(s.queue),
	}
}

// Replace utility
func replace(s, old, new string) string {
	result := s
	for {
		if idx := find(result, old); idx >= 0 {
			result = result[:idx] + new + result[idx+len(old):]
		} else {
			break
		}
	}
	return result
}

func find(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func generateID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}