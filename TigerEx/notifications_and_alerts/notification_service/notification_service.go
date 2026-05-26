package notification

import (
	"fmt"
	"time"
)

// Template names
var TEMPLATES = map[string]string{
	"deposit":      "Deposit Completed",
	"withdrawal":   "Withdrawal Processed",
	"order_filled": "Order Filled",
	"liquidation":  "Liquidation Warning",
	"margin_call":  "Margin Call",
}

// NotificationService handles notifications
type NotificationService struct {
	db interface{}
}

// NewNotificationService creates notification service
func NewNotificationService(db interface{}) *NotificationService {
	return &NotificationService{db: db}
}

// SendRequest represents a notification send request
type SendRequest struct {
	UserID    string                 `json:"userId"`
	Channel  string                 `json:"channel"`
	Template string                 `json:"template"`
	Data     map[string]interface{} `json:"data"`
}

// NotificationContent represents notification content
type NotificationContent struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	Subject string `json:"subject,omitempty"`
}

// Send sends a notification
func (s *NotificationService) Send(req *SendRequest) error {
	content := s.render(req.Template, req.Data)
	
	switch req.Channel {
	case "push":
		return s.sendPush(req.UserID, content)
	case "email":
		return s.sendEmail(req.UserID, content)
	case "sms":
		return s.sendSMS(req.UserID, content)
	default:
		return fmt.Errorf("unknown channel: %s", req.Channel)
	}
}

func (s *NotificationService) sendPush(userID string, content *NotificationContent) error {
	fmt.Printf("Push to %s: %s\n", userID, content.Title)
	return nil
}

func (s *NotificationService) sendEmail(userID string, content *NotificationContent) error {
	fmt.Printf("Email to %s: %s\n", userID, content.Subject)
	return nil
}

func (s *NotificationService) sendSMS(userID string, content *NotificationContent) error {
	fmt.Printf("SMS to %s: %s\n", userID, content.Body)
	return nil
}

func (s *NotificationService) render(template string, data map[string]interface{}) *NotificationContent {
	templates := map[string]*NotificationContent{
		"deposit": {
			Title:   "Deposit Completed",
			Body:    fmt.Sprintf("Your deposit of %v %v has been processed!", data["amount"], data["currency"]),
			Subject: "Deposit Completed - TigerEx",
		},
		"order_filled": {
			Title:   "Order Filled",
			Body:    fmt.Sprintf("Your %v %v %v @ %v filled.", data["side"], data["quantity"], data["symbol"], data["price"]),
			Subject: "Order Filled - TigerEx",
		},
	}
	
	if content, ok := templates[template]; ok {
		return content
	}
	
	return &NotificationContent{Title: template}
}

// PriceAlertService handles price alerts
type PriceAlertService struct {
	alerts map[string][]Alert
}

// Alert represents a price alert
type Alert struct {
	ID       string  `json:"id"`
	UserID  string  `json:"userId"`
	Symbol  string  `json:"symbol"`
	Price   float64 `json:"price"`
	Condition string `json:"condition"` // "above" or "below"
}

// NewPriceAlertService creates price alert service
func NewPriceAlertService() *PriceAlertService {
	return &PriceAlertService{
		alerts: make(map[string][]Alert),
	}
}

// Create creates a price alert
func (s *PriceAlertService) Create(userID, symbol string, price float64, condition string) (*Alert, error) {
	alert := &Alert{
		ID:        generateAlertID(),
		UserID:   userID,
		Symbol:  symbol,
		Price:   price,
		Condition: condition,
	}
	
	s.alerts[symbol] = append(s.alerts[symbol], *alert)
	return alert, nil
}

// Check checks alerts for a symbol
func (s *PriceAlertService) Check(symbol string, price float64) []Alert {
	var triggered []Alert
	
	for _, alert := range s.alerts[symbol] {
		triggeredFlag := false
		
		switch alert.Condition {
		case "above":
			if price > alert.Price {
				triggeredFlag = true
			}
		case "below":
			if price < alert.Price {
				triggeredFlag = true
			}
		}
		
		if triggeredFlag {
			triggered = append(triggered, alert)
		}
	}
	
	return triggered
}

func generateAlertID() string {
	return fmt.Sprintf("alert-%d", time.Now().UnixNano())
}