package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX NOTIFICATIONS SERVICE - GO
// Push notifications, SMS, Email, and In-App messaging
// ============================================================================

// ============== MODELS ==============

type Notification struct {
	ID          string    `json:"id"`
	UserID     string    `json:"user_id"`
	Type       string    `json:"type"` // push, sms, email, inapp
	Title      string    `json:"title"`
	Message    string    `json:"message"`
	Data       map[string]interface{} `json:"data,omitempty"`
	Status     string    `json:"status"` // pending, sent, delivered, read
	Priority   string    `json:"priority"` // low, normal, high, urgent
	SentAt     int64     `json:"sent_at,omitempty"`
	DeliveredAt int64    `json:"delivered_at,omitempty"`
	ReadAt     int64     `json:"read_at,omitempty"`
	CreatedAt  int64     `json:"created_at"`
}

type PushToken struct {
	UserID    string  `json:"user_id"`
	Token     string  `json:"token"`
	Platform  string  `json:"platform"` // ios, android, web
	DeviceID  string  `json:"device_id"`
	Active    bool    `json:"active"`
	UpdatedAt int64   `json:"updated_at"`
}

type EmailTemplate struct {
	ID        string  `json:"id"`
	Name     string  `json:"name"`
	Subject  string  `json:"subject"`
	Body     string  `json:"body"`
	Active   bool    `json:"active"`
}

// ============== NOTIFICATION SERVICE ==============

type NotificationService struct {
	notifications map[string]*Notification
	pushTokens    map[string][]*PushToken
	templates    map[string]*EmailTemplate
	queue       chan *Notification
}

func NewNotificationService() *NotificationService {
	s := &NotificationService{
		notifications: make(map[string]*Notification),
		pushTokens:    make(map[string][]*PushToken),
		templates:    make(map[string]*EmailTemplate),
		queue:       make(chan *Notification, 1000),
	}

	// Load default templates
	s.templates["welcome"] = &EmailTemplate{
		ID:       "welcome",
		Name:     "Welcome",
		Subject:  "Welcome to TigerEx!",
		Body:     "Start your trading journey today.",
		Active:   true,
	}

	s.templates["kyc_approved"] = &EmailTemplate{
		ID:       "kyc_approved",
		Name:     "KYC Approved",
		Subject:  "Your account is verified!",
		Body:     "Congratulations, your account is now fully verified.",
		Active:   true,
	}

	s.templates["withdraw_complete"] = &EmailTemplate{
		ID:       "withdraw_complete",
		Name:     "Withdrawal Complete",
		Subject:  "Your withdrawal is complete",
		Body:     "Your withdrawal has been processed.",
		Active:   true,
	}

	return s
}

func (s *NotificationService) Send(n *Notification) error {
	n.ID = fmt.Sprintf("ntf_%d", time.Now().UnixNano())
	n.CreatedAt = time.Now().Unix()
	n.Status = "pending"

	switch n.Type {
	case "push":
		return s.sendPush(n)
	case "email":
		return s.sendEmail(n)
	case "sms":
		return s.sendSMS(n)
	case "inapp":
		return s.sendInApp(n)
	default:
		return fmt.Errorf("unknown notification type: %s", n.Type)
	}
}

func (s *NotificationService) sendPush(n *Notification) error {
	tokens, ok := s.pushTokens[n.UserID]
	if !ok || len(tokens) == 0 {
		return fmt.Errorf("no push tokens for user")
	}

	// In production: send to FCM/APNS
	log.Printf("Sending push to user %s: %s", n.UserID, n.Title)

	for _, token := range tokens {
		if token.Active {
			// Send notification
			log.Printf("  Token: %s...", token.Token[:20])
		}
	}

	n.Status = "sent"
	n.SentAt = time.Now().Unix()
	s.notifications[n.ID] = n

	return nil
}

func (s *NotificationService) sendEmail(n *Notification) error {
	template, ok := s.templates[n.Data["template"].(string)]
	if !ok {
		template = s.templates["welcome"]
	}

	// In production: send via SendGrid/SES
	log.Printf("Sending email to user %s: %s", n.UserID, template.Subject)

	n.Status = "sent"
	n.SentAt = time.Now().Unix()
	s.notifications[n.ID] = n

	return nil
}

func (s *NotificationService) sendSMS(n *Notification) error {
	// In production: send via Twilio
	log.Printf("Sending SMS to user %s: %s", n.UserID, n.Message)

	n.Status = "sent"
	n.SentAt = time.Now().Unix()
	s.notifications[n.ID] = n

	return nil
}

func (s *NotificationService) sendInApp(n *Notification) error {
	n.Status = "sent"
	n.SentAt = time.Now().Unix()
	s.notifications[n.ID] = n

	return nil
}

// ============== USER METHODS ==============

func (s *NotificationService) RegisterPushToken(userID, token, platform, deviceID string) error {
	pt := &PushToken{
		UserID:   userID,
		Token:    token,
		Platform: platform,
		DeviceID: deviceID,
		Active:   true,
		UpdatedAt: time.Now().Unix(),
	}

	s.pushTokens[userID] = append(s.pushTokens[userID], pt)
	return nil
}

func (s *NotificationService) GetNotifications(userID string, limit int) []*Notification {
	var result []*Notification
	count := 0

	for _, n := range s.notifications {
		if n.UserID == userID {
			result = append(result, n)
			count++
			if count >= limit {
				break
			}
		}
	}

	return result
}

func (s *NotificationService) MarkAsRead(notificationID string) error {
	if n, ok := s.notifications[notificationID]; ok {
		n.ReadAt = time.Now().Unix()
		n.Status = "read"
		return nil
	}
	return fmt.Errorf("notification not found")
}

// ============== PREDEFINED NOTIFICATIONS ==============

func (s *NotificationService) NotifyTradeExecution(userID, symbol, side string, price, quantity float64) {
	msg := &Notification{
		UserID:  userID,
		Type:    "push",
		Title:   "Trade Executed",
		Message: fmt.Sprintf("Your %s order for %s has been executed at $%.2f", side, symbol, price),
		Data: map[string]interface{}{
			"symbol":   symbol,
			"side":    side,
			"price":   price,
			"quantity": quantity,
		},
		Priority: "high",
	}
	s.Send(msg)
}

func (s *NotificationService) NotifyWithdrawal(userID, currency string, amount float64, status string) {
	msg := &Notification{
		UserID:  userID,
		Type:    "push",
		Title:   "Withdrawal Update",
		Message: fmt.Sprintf("Your %s %.2f withdrawal is %s", currency, amount, status),
		Data: map[string]interface{}{
			"currency": currency,
			"amount":   amount,
			"status":   status,
		},
		Priority: "high",
	}
	s.Send(msg)
}

func (s *NotificationService) NotifyPriceAlert(userID, symbol string, price, targetPrice float64) {
	direction := "above"
	if targetPrice < price {
		direction = "below"
	}

	msg := &Notification{
		UserID:  userID,
		Type:    "push",
		Title:   "Price Alert",
		Message: fmt.Sprintf("%s is now $%.2f (%s target: $%.2f)", symbol, price, direction, targetPrice),
		Data: map[string]interface{}{
			"symbol":     symbol,
			"current":    price,
			"target":     targetPrice,
			"alert_type": "price",
		},
		Priority: "normal",
	}
	s.Send(msg)
}

func (s *NotificationService) NotifyKYCUpdate(userID string, status string) {
	msg := &Notification{
		UserID:  userID,
		Type:    "email",
		Title:   "KYC Status Update",
		Message: fmt.Sprintf("Your verification status: %s", status),
		Data: map[string]interface{}{
			"template": "kyc_" + status,
			"status":   status,
		},
		Priority: "high",
	}
	s.Send(msg)
}

func (s *NotificationService) NotifySecurityAlert(userID, alertType, message string) {
	msg := &Notification{
		UserID:  userID,
		Type:    "push",
		Title:   "Security Alert",
		Message: message,
		Data: map[string]interface{}{
			"alert_type": alertType,
			"security":   true,
		},
		Priority: "urgent",
	}
	s.Send(msg)
}

// ============== HTTP HANDLERS ==============

func SetupNotificationRoutes(r *gin.Engine, ns *NotificationService) {
	api := r.Group("/api/v1/notifications")

	api.POST("/send", func(c *gin.Context) {
		var n Notification
		if err := c.ShouldBindJSON(&n); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if err := ns.Send(&n); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(201, n)
	})

	api.GET("/user/:user_id", func(c *gin.Context) {
		userID := c.Param("user_id")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

		notifications := ns.GetNotifications(userID, limit)
		c.JSON(200, notifications)
	})

	api.POST("/tokens", func(c *gin.Context) {
		var req struct {
			UserID    string `json:"user_id" binding:"required"`
			Token    string `json:"token" binding:"required"`
			Platform string `json:"platform" binding:"required"`
			DeviceID string `json:"device_id"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		err := ns.RegisterPushToken(req.UserID, req.Token, req.Platform, req.DeviceID)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(201, gin.H{"success": true})
	})

	api.POST("/:id/read", func(c *gin.Context) {
		id := c.Param("id")
		err := ns.MarkAsRead(id)
		if err != nil {
			c.JSON(404, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"success": true})
	})

	// Predefined notifications
	api.POST("/trade/executed", func(c *gin.Context) {
		var req struct {
			UserID   string  `json:"user_id" binding:"required"`
			Symbol  string  `json:"symbol" binding:"required"`
			Side    string  `json:"side" binding:"required"`
			Price   float64 `json:"price" binding:"required"`
			Quantity float64 `json:"quantity" binding:"required"`
		}

		c.ShouldBindJSON(&req)
		ns.NotifyTradeExecution(req.UserID, req.Symbol, req.Side, req.Price, req.Quantity)
		c.JSON(201, gin.H{"success": true})
	})

	api.POST("/withdrawal/update", func(c *gin.Context) {
		var req struct {
			UserID   string  `json:"user_id" binding:"required"`
			Currency string  `json:"currency" binding:"required"`
			Amount  float64 `json:"amount" binding:"required"`
			Status  string  `json:"status" binding:"required"`
		}

		c.ShouldBindJSON(&req)
		ns.NotifyWithdrawal(req.UserID, req.Currency, req.Amount, req.Status)
		c.JSON(201, gin.H{"success": true})
	})
}

// ============== MAIN ==============

func main() {
	r := gin.Default()

	ns := NewNotificationService()
	SetupNotificationRoutes(r, ns)

	log.Println("Notification service starting on :8080")
	log.Fatal(r.Run(":8080"))
}