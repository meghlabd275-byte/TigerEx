// Package notifications provides notification services
package notifications

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"tigerex-api/internal/api"
)

var ErrNotFound = errors.New("not found")

type Config struct {
	EmailEnabled bool
	SMSEnabled bool
	PushEnabled bool
	TelegramEnabled bool
}

type Notification struct {
	ID        string
	UserID   string
	Type    string
	Title   string
	Body    string
	Channel string
	Status  string
	Data    map[string]interface{}
	SentAt  int64
	ReadAt  int64
}

type EmailTemplate struct {
	ID        string
	Name     string
	Subject string
	Body     string
	Type    string
}

type Service struct {
	config    Config
	templates map[string]*EmailTemplate
	queue    map[string][]*Notification
}

func NewService(config Config) *Service {
	return &Service{
		config: config,
		templates: make(map[string]*EmailTemplate),
		queue: make(map[string][]*Notification),
	}
}

func (s *Service) InitializeTemplates() {
	templates := []*EmailTemplate{
		{ID: "welcome", Name: "Welcome", Subject: "Welcome to TigerEx", Body: "Welcome {{username}}!", Type: "transactional"},
		{ID: "verify_email", Name: "Verify Email", Subject: "Verify Your Email", Body: "Your verification code is: {{code}}", Type: "verification"},
		{ID: "reset_password", Name: "Reset Password", Subject: "Reset Your Password", Body: "Click here to reset: {{link}}", Type: "security"},
		{ID: "deposit", Name: "Deposit", Subject: "Deposit Confirmed", Body: "Your deposit of {{amount}} {{asset}} has been confirmed", Type: "transactional"},
		{ID: "withdrawal", Name: "Withdrawal", Subject: "Withdrawal Processed", Body: "Your withdrawal of {{amount}} {{asset}} has been processed", Type: "transactional"},
		{ID: "order_fill", Name: "Order Filled", Subject: "Order Filled", Body: "Your order for {{amount}} {{symbol}} has been filled at {{price}}", Type: "trading"},
		{ID: "liquidation", Name: "Liquidation", Subject: "Position Liquidated", Body: "Your position has been liquidated", Type: "trading"},
		{ID: "margin_call", Name: "Margin Call", Subject: "Margin Call", Body: "Your position is at risk of liquidation", Type: "trading"},
		{ID: "security_alert", Name: "Security Alert", Subject: "Security Alert", Body: "New login from {{ip}}", Type: "security"},
		{ID: "kyc_approved", Name: "KYC Approved", Subject: "KYC Approved", Body: "Your identity verification has been approved", Type: "compliance"},
		{ID: "kyc_rejected", Name: "KYC Rejected", Subject: "KYC Rejected", Body: "Your identity verification was rejected: {{reason}}", Type: "compliance"},
	}
	for _, t := range templates {
		s.templates[t.ID] = t
	}
}

func (s *Service) SendEmail(ctx context.Context, userID, templateID string, data map[string]interface{}) error {
	template, ok := s.templates[templateID]
	if !ok {
		return ErrNotFound
	}
	notification := &Notification{
		ID: uuid.New().String(),
		UserID: userID,
		Type: "email",
		Title: template.Subject,
		Body: template.Body,
		Channel: "email",
		Status: "queued",
		Data: data,
		SentAt: api.Now(),
	}
	s.queue[userID] = append(s.queue[userID], notification)
	return nil
}

func (s *Service) SendSMS(ctx context.Context, userID, message string) error {
	notification := &Notification{
		ID: uuid.New().String(),
		UserID: userID,
		Type: "sms",
		Title: "TigerEx",
		Body: message,
		Channel: "sms",
		Status: "queued",
		SentAt: api.Now(),
	}
	s.queue[userID] = append(s.queue[userID], notification)
	return nil
}

func (s *Service) SendPush(ctx context.Context, userID, title, body string, data map[string]interface{}) error {
	notification := &Notification{
		ID: uuid.New().String(),
		UserID: userID,
		Type: "push",
		Title: title,
		Body: body,
		Channel: "push",
		Status: "queued",
		Data: data,
		SentAt: api.Now(),
	}
	s.queue[userID] = append(s.queue[userID], notification)
	return nil
}

func (s *Service) GetNotifications(userID string) []*Notification {
	return s.queue[userID]
}

func (s *Service) MarkAsRead(userID, notificationID string) error {
	for _, n := range s.queue[userID] {
		if n.ID == notificationID {
			n.ReadAt = api.Now()
			return nil
		}
	}
	return ErrNotFound
}