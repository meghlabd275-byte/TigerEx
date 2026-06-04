package notification

import (
    "crypto/rand"
    "encoding/base64"
    "errors"
    "fmt"
    "sync"
    "time"
)

type NotificationType string

const (
    TypeOrderFilled    NotificationType = "order_filled"
    TypeOrderCancelled NotificationType = "order_cancelled"
    TypeDeposit        NotificationType = "deposit"
    TypeWithdrawal     NotificationType = "withdrawal"
    TypeWithdrawalComplete NotificationType = "withdrawal_complete"
    TypeSecurity       NotificationType = "security"
    TypeKYC            NotificationType = "kyc"
    TypePromo          NotificationType = "promo"
)

type Notification struct {
    ID        string                 `json:"id"`
    UserID    string                 `json:"user_id"`
    Type      NotificationType       `json:"type"`
    Title     string                 `json:"title"`
    Message   string                 `json:"message"`
    Data      map[string]interface{} `json:"data,omitempty"`
    IsRead    bool                   `json:"is_read"`
    CreatedAt time.Time              `json:"created_at"`
}

type EmailJob struct {
    ID          string    `json:"id"`
    To          string    `json:"to"`
    Subject     string    `json:"subject"`
    Body        string    `json:"body"`
    Status      string    `json:"status"`
    Attempts    int       `json:"attempts"`
    LastAttempt *time.Time `json:"last_attempt,omitempty"`
    SentAt      *time.Time `json:"sent_at,omitempty"`
    CreatedAt   time.Time `json:"created_at"`
}

type PushSubscription struct {
    ID        string    `json:"id"`
    UserID    string    `json:"user_id"`
    Endpoint  string    `json:"endpoint"`
    Keys      map[string]string `json:"keys"`
    CreatedAt time.Time `json:"created_at"`
}

type NotificationService struct {
    mu          sync.RWMutex
    notifications map[string][]*Notification
    emailQueue    []*EmailJob
    subscriptions map[string]*PushSubscription
}

func NewNotificationService() *NotificationService {
    return &NotificationService{
        notifications: make(map[string][]*Notification),
        emailQueue:    make([]*EmailJob, 0),
        subscriptions: make(map[string]*PushSubscription),
    }
}

func (s *NotificationService) SendNotification(userID string, notifType NotificationType, title, message string, data map[string]interface{}) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    notif := &Notification{
        ID:        generateID(),
        UserID:    userID,
        Type:      notifType,
        Title:     title,
        Message:   message,
        Data:      data,
        IsRead:    false,
        CreatedAt: time.Now(),
    }
    
    s.notifications[userID] = append(s.notifications[userID], notif)
    
    return nil
}

func (s *NotificationService) GetUserNotifications(userID string, limit int) []*Notification {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    notifs := s.notifications[userID]
    if limit > 0 && len(notifs) > limit {
        return notifs[len(notifs)-limit:]
    }
    return notifs
}

func (s *NotificationService) MarkAsRead(userID, notificationID string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    notifs := s.notifications[userID]
    for _, n := range notifs {
        if n.ID == notificationID {
            n.IsRead = true
            return nil
        }
    }
    return errors.New("notification not found")
}

func (s *NotificationService) MarkAllAsRead(userID string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    notifs := s.notifications[userID]
    for _, n := range notifs {
        n.IsRead = true
    }
    return nil
}

func (s *NotificationService) GetUnreadCount(userID string) int {
    s.mu.RLock()
    defer s.mu.RUnlock()
    
    count := 0
    for _, n := range s.notifications[userID] {
        if !n.IsRead {
            count++
        }
    }
    return count
}

func (s *NotificationService) QueueEmail(to, subject, body string) *EmailJob {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    job := &EmailJob{
        ID:        generateID(),
        To:        to,
        Subject:   subject,
        Body:      body,
        Status:    "pending",
        Attempts:  0,
        CreatedAt: time.Now(),
    }
    
    s.emailQueue = append(s.emailQueue, job)
    return job
}

func (s *NotificationService) ProcessEmailQueue() error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    for _, job := range s.emailQueue {
        if job.Status != "pending" {
            continue
        }
        
        job.Attempts++
        job.LastAttempt = &time.Time{}
        *job.LastAttempt = time.Now()
        
        if err := s.sendEmail(job); err != nil {
            if job.Attempts >= 3 {
                job.Status = "failed"
            }
            continue
        }
        
        job.Status = "sent"
        now := time.Now()
        job.SentAt = &now
    }
    
    return nil
}

func (s *NotificationService) sendEmail(job *EmailJob) error {
    return nil
}

func (s *NotificationService) SubscribePush(userID, endpoint string, keys map[string]string) (*PushSubscription, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    sub := &PushSubscription{
        ID:        generateID(),
        UserID:    userID,
        Endpoint:  endpoint,
        Keys:      keys,
        CreatedAt: time.Now(),
    }
    
    s.subscriptions[userID] = sub
    return sub, nil
}

func (s *NotificationService) UnsubscribePush(userID string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    delete(s.subscriptions, userID)
    return nil
}

func (s *NotificationService) SendPushNotification(userID, title, body string) error {
    s.mu.RLock()
    sub, exists := s.subscriptions[userID]
    s.mu.RUnlock()
    
    if !exists {
        return errors.New("push subscription not found")
    }
    
    return nil
}

func (s *NotificationService) NotifyOrderFilled(userID, orderID, symbol string, price, quantity float64) {
    s.SendNotification(userID, TypeOrderFilled,
        "Order Filled",
        fmt.Sprintf("Your %s order for %s has been filled at $%.2f", symbol, formatQuantity(quantity), price),
        map[string]interface{}{
            "order_id": orderID,
            "symbol":   symbol,
            "price":    price,
            "quantity": quantity,
        },
    )
}

func (s *NotificationService) NotifyDeposit(userID, currency string, amount float64, txHash string) {
    s.SendNotification(userID, TypeDeposit,
        "Deposit Received",
        fmt.Sprintf("Your deposit of %s %s has been received", formatQuantity(amount), currency),
        map[string]interface{}{
            "currency": currency,
            "amount":   amount,
            "tx_hash": txHash,
        },
    )
}

func (s *NotificationService) NotifyWithdrawalComplete(userID, currency string, amount float64, txHash string) {
    s.SendNotification(userID, TypeWithdrawalComplete,
        "Withdrawal Complete",
        fmt.Sprintf("Your withdrawal of %s %s has been processed", formatQuantity(amount), currency),
        map[string]interface{}{
            "currency": currency,
            "amount":   amount,
            "tx_hash": txHash,
        },
    )
}

func (s *NotificationService) NotifySecurityAlert(userID, alertType, message string) {
    s.SendNotification(userID, TypeSecurity,
        "Security Alert",
        message,
        map[string]interface{}{
            "alert_type": alertType,
        },
    )
}

func generateID() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.URLEncoding.EncodeToString(b)
}

func formatQuantity(q float64) string {
    return fmt.Sprintf("%.8f", q)
}