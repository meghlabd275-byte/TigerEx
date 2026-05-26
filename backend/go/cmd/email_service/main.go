// Package email_service provides transactional email services.
// Migrated from TypeScript to Go for email sending.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Email template
type EmailTemplate struct {
	ID        string  `json:"id"`
	Name     string  `json:"name"`
	Subject  string  `json:"subject"`
	Body     string  `json:"body"`
	Type     string  `json:"type"` // welcome, verify, order, withdraw
}

// Sent email
type SentEmail struct {
	ID        string  `json:"id"`
	To       string  `json:"to"`
	Template string  `json:"template"`
	Subject  string  `json:"subject"`
	Status   string  `json:"status"` // sent, delivered, failed
	SentAt   int64   `json:"sentAt"`
}

// Store
type EmailStore struct {
	mu      sync.RWMutex
	templates map[string]*EmailTemplate
	sent      map[string]*SentEmail
}

var (
	emailStore = &EmailStore{
		templates: make(map[string]*EmailTemplate),
		sent: make(map[string]*SentEmail),
	}
)

// Initialize templates
func init() {
	templates := []*EmailTemplate{
		{ID: "welcome", Name: "Welcome", Subject: "Welcome to TigerEx!", Body: "Hello {{name}},\n\nWelcome..."},
		{ID: "verify_email", Name: "Verify Email", Subject: "Verify your email", Body: "Click {{link}} to verify..."},
		{ID: "order_filled", Name: "Order Filled", Subject: "Order Filled - {{symbol}}", Body: "Your order for {{symbol}} has been filled..."},
		{ID: "withdraw_complete", Name: "Withdrawal Complete", Subject: "Withdrawal Complete", Body: "Your withdrawal of {{amount}} has been processed..."},
		{ID: "kyc_approved", Name: "KYC Approved", Subject: "KYC Approved", Body: "Congratulations! Your KYC has been approved..."},
		{ID: "password_reset", Name: "Password Reset", Subject: "Reset Password", Body: "Click {{link}} to reset your password..."},
	}

	emailStore.mu.Lock()
	defer emailStore.mu.Unlock()

	for _, t := range templates {
		emailStore.templates[t.ID] = t
	}
}

// Send email
func SendEmail(to, templateID string, data map[string]string) (*SentEmail, error) {
	emailStore.mu.RLock()
	template, ok := emailStore.templates[templateID]
	emailStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("template not found")
	}

	// Process template
	subject := template.Subject
	body := template.Body

	// Replace placeholders
	for k, v := range data {
		subject = replaceAll(subject, "{{"+k+"}}", v)
		body = replaceAll(body, "{{"+k+"}}", v)
	}

	email := &SentEmail{
		ID: fmt.Sprintf("email_%d", time.Now().UnixNano()),
		To: to,
		Template: templateID,
		Subject: subject,
		Status: "sent",
		SentAt: time.Now().UnixMilli(),
	}

	emailStore.mu.Lock()
	defer emailStore.mu.Unlock()
	emailStore.sent[email.ID] = email

	return email, nil
}

// Get email status
func GetStatus(emailID string) (*SentEmail, error) {
	emailStore.mu.RLock()
	defer emailStore.mu.RUnlock()

	email, ok := emailStore.sent[emailID]
	if !ok {
		return nil, fmt.Errorf("email not found")
	}

	return email, nil
}

// Get template
func GetTemplate(templateID string) (*EmailTemplate, bool) {
	emailStore.mu.RLock()
	defer emailStore.mu.RUnlock()

	template, ok := emailStore.templates[templateID]
	return template, ok
}

func replaceAll(s, old, new string) string {
	result := s
	for len(old) > 0 && contains(result, old) {
		result = result[:index(result, old)] + new + result[index(result, old)+len(old):]
	}
	return result
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s[:len(substr)] == substr || contains(s[1:], substr))
}

func index(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func main() {
	fmt.Println("Email Service initialized")

	// Send email
	email, _ := SendEmail("user@example.com", "welcome", map[string]string{"name": "John"})
	fmt.Printf("Email sent: %s\n", email.ID)
}