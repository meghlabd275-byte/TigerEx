// Package push_notification provides push notification services.
// Migrated from TypeScript to Go for mobile push notifications.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Push token
type PushToken struct {
	ID       string `json:"id"`
	UserID  string `json:"userId"`
	Token   string `json:"token"`
	Platform string `json:"platform"` // ios, android, web
	Status  string `json:"status"` // active, revoked
}

// Notification payload
type PushPayload struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Data     map[string]string `json:"data"`
	Priority string `json:"priority"` // high, normal
	Sound    string `json:"sound"`
}

// Push delivery
type PushDelivery struct {
	ID         string  `json:"id"`
	TokenID   string  `json:"tokenId"`
	Payload  PushPayload `json:"payload"`
	Status   string  `json:"status"` // sent, delivered, failed
	SentAt   int64   `json:"sentAt"`
	DeliveredAt int64  `json:"deliveredAt"`
}

// Store
type PushStore struct {
	mu      sync.RWMutex
	tokens  map[string]*PushToken
	delivery map[string]*PushDelivery
}

var (
	pushStore = &PushStore{
		tokens: make(map[string]*PushToken),
		delivery: make(map[string]*PushDelivery),
	}
)

// Register token
func RegisterToken(userID, token, platform string) *PushToken {
	ptoken := &PushToken{
		ID: fmt.Sprintf("pt_%d", time.Now().UnixNano()),
		UserID: userID,
		Token: token,
		Platform: platform,
		Status: "active",
	}

	pushStore.mu.Lock()
	defer pushStore.mu.Unlock()
	pushStore.tokens[ptoken.ID] = ptoken

	return ptoken
}

// Send notification
func SendNotification(tokenID string, payload PushPayload) (*PushDelivery, error) {
	pushStore.mu.RLock()
	ptoken, ok := pushStore.tokens[tokenID]
	pushStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("token not found")
	}

	if ptoken.Status != "active" {
		return nil, fmt.Errorf("token inactive")
	}

	// In real impl: send via FCM/APNs

	delivery := &PushDelivery{
		ID: fmt.Sprintf("pd_%d", time.Now().UnixNano()),
		TokenID: tokenID,
		Payload: payload,
		Status: "sent",
		SentAt: time.Now().UnixMilli(),
		DeliveredAt: time.Now().UnixMilli(),
	}

	pushStore.mu.Lock()
	defer pushStore.mu.Unlock()
	pushStore.delivery[delivery.ID] = delivery

	return delivery, nil
}

// Send to user (all devices)
func SendToUser(userID string, payload PushPayload) []*PushDelivery {
	pushStore.mu.RLock()
	var userTokens []*PushToken
	
	for _, t := range pushStore.tokens {
		if t.UserID == userID && t.Status == "active" {
			userTokens = append(userTokens, t)
		}
	}
	pushStore.mu.RUnlock()

	var deliveries []*PushDelivery

	for _, t := range userTokens {
		d, _ := SendNotification(t.ID, payload)
		if d != nil {
			deliveries = append(deliveries, d)
		}
	}

	return deliveries
}

// Revoke token
func RevokeToken(tokenID string) error {
	pushStore.mu.Lock()
	defer pushStore.mu.Unlock()

	if ptoken, ok := pushStore.tokens[tokenID]; ok {
		ptoken.Status = "revoked"
		return nil
	}

	return fmt.Errorf("token not found")
}

func main() {
	fmt.Println("Push Notification service initialized")

	// Register device
	token := RegisterToken("user_001", "device_token_abc123", "ios")
	fmt.Printf("Device registered: %s (%s)\n", token.Platform, token.Status)

	// Send notification
	payload := PushPayload{
		Title: "TigerEx",
		Body: "Your order has been filled!",
		Data: map[string]string{"type": "order_filled"},
		Priority: "high",
		Sound: "default",
	}

	delivery, _ := SendNotification(token.ID, payload)
	fmt.Printf("Notification sent: %s\n", delivery.ID)
}