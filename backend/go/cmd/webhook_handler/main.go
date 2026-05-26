// Package webhook_handler provides webhook processing services.
// Migrated from TypeScript to Go for webhook integrations.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Webhook subscription
type Subscription struct {
	ID        string  `json:"id"`
	UserID   string  `json:"userId"`
	URL      string  `json:"url"`
	Events   []string `json:"events"` // deposit, withdraw, trade, order
	Secret   string  `json:"secret"`
	Status   string  `json:"status"` // active, paused
	RetryPolicy string `json:"retryPolicy"` // exponential, linear
	MaxRetries int    `json:"maxRetries"`
}

// Webhook delivery
type Delivery struct {
	ID        string  `json:"id"`
	SubID   string  `json:"subId"`
	Event   string  `json:"event"`
	Payload string  `json:"payload"`
	Status string  `json:"status"` // pending, delivered, failed
	Tries   int    `json:"tries"`
	DeliveredAt int64  `json:"deliveredAt"`
}

// Store
type WebhookStore struct {
	mu         sync.RWMutex
	subs       map[string]*Subscription
	deliveries map[string]*Delivery
}

var (
	whStore = &WebhookStore{
		subs: make(map[string]*Subscription),
		deliveries: make(map[string]*Delivery),
	}
)

// Subscribe
func Subscribe(userID, url string, events []string, secret string) *Subscription {
	sub := &Subscription{
		ID: fmt.Sprintf("whsub_%d", time.Now().UnixNano()),
		UserID: userID,
		URL: url,
		Events: events,
		Secret: secret,
		Status: "active",
		RetryPolicy: "exponential",
		MaxRetries: 5,
	}

	whStore.mu.Lock()
	defer whStore.mu.Unlock()
	whStore.subs[sub.ID] = sub

	return sub
}

// Generate signature
func GenerateSignature(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// Verify signature
func VerifySignature(payload, secret, signature string) bool {
	expected := GenerateSignature(payload, secret)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// Deliver webhook
func Deliver(subID, event, payload string) (*Delivery, error) {
	whStore.mu.RLock()
	sub, ok := whStore.subs[subID]
	whStore.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("subscription not found")
	}

	if sub.Status != "active" {
		return nil, fmt.Errorf("subscription not active")
	}

	// Generate signature
	signature := GenerateSignature(payload, sub.Secret)

	// In real impl: HTTP POST to sub.URL

	delivery := &Delivery{
		ID: fmt.Sprintf("whdel_%d", time.Now().UnixNano()),
		SubID: subID,
		Event: event,
		Payload: payload,
		Status: "delivered",
		Tries: 1,
		DeliveredAt: time.Now().UnixMilli(),
	}

	whStore.mu.Lock()
	defer whStore.mu.Unlock()
	whStore.deliveries[delivery.ID] = delivery

	return delivery, nil
}

// Retry failed delivery
func RetryDelivery(deliveryID string) error {
	whStore.mu.RLock()
	delivery, ok := whStore.deliveries[deliveryID]
	sub, subOk := whStore.subs[delivery.SubID]
	whStore.mu.RUnlock()

	if !ok {
		return fmt.Errorf("delivery not found")
	}

	if delivery.Tries >= sub.MaxRetries {
		return fmt.Errorf("max retries exceeded")
	}

	// Backoff delay
	delay := time.Duration(1<<delivery.Tries) * time.Second

	time.Sleep(delay)

	delivery.Tries++
	delivery.Status = "delivered"

	return nil
}

// Parse events
func ParseEvents(events string) []string {
	return strings.Split(events, ",")
}

func main() {
	fmt.Println("Webhook Handler service initialized")

	// Subscribe
	sub := Subscribe("user_001", "https://callback.example.com/webhook", 
		[]string{"deposit", "withdraw"}, "secret_key_123")
	fmt.Printf("Subscribed to %s: %v\n", sub.Event, sub.Events)

	// Deliver
	payload := `{"event": "deposit", "amount": 5000, "txHash": "0xabc123"}`
	delivery, _ := Deliver(sub.ID, "deposit", payload)
	fmt.Printf("Delivered: %s (%s)\n", delivery.ID, delivery.Status)

	// Verify
	sig := GenerateSignature(payload, "secret_key_123")
	valid := VerifySignature(payload, "secret_key_123", sig)
	fmt.Printf("Signature valid: %v\n", valid)
}