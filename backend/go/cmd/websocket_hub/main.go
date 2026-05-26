// Package websocket_hub provides high-performance WebSocket handling.
// Migrated from TypeScript to Go for real-time trading.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// WebSocket message
type WSMessage struct {
	Type    string          `json:"type"`
	Payload interface{}   `json:"payload,omitempty"`
	Timestamp int64         `json:"timestamp"`
}

// Subscription
type Subscription struct {
	UserID   string
	Channels []string
}

// WebSocket client
type WSClient struct {
	ID        string
	Conn     interface{} // *websocket.Conn in real impl
	UserID   string
	Channels []string
	LastPing int64
	Active  bool
}

// Channel subscriber
type ChannelSubscriber struct {
	clientIDs map[string]bool // client ID -> subscribed
	mu       sync.RWMutex
}

// Hub manages all WebSocket connections
type WSHub struct {
	mu          sync.RWMutex
	clients     map[string]*WSClient
	channels   map[string]*ChannelSubscriber
	broadcast   chan *WSMessage
	register   chan *WSClient
	unregister chan *WSClient
	stats      HubStats
}

// Hub statistics
type HubStats struct {
	Connections  int
	MessagesIn  int64
	MessagesOut int64
	ErrCount   int64
}

var (
	hub = &WSHub{
		clients:   make(map[string]*WSClient),
		channels: make(map[string]*ChannelSubscriber),
		broadcast: make(chan *WSMessage, 10000),
		register: make(chan *WSClient, 100),
		unregister: make(chan *WSClient, 100),
	}
)

// Initialize hub with goroutines
func init() {
	go hub.run()
}

// Main hub loop
func (h *WSHub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.stats.Connections = len(h.clients)
			h.mu.Unlock()
			
			fmt.Printf("Client connected: %s (total: %d)\n", client.ID, h.stats.Connections)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				
				// Unsubscribe from all channels
				for _, ch := range client.Channels {
					h.unsubscribe(ch, client.ID)
				}
			}
			h.stats.Connections = len(h.clients)
			h.mu.Unlock()
			
			fmt.Printf("Client disconnected: %s (total: %d)\n", client.ID, h.stats.Connections)

		case msg := <-h.broadcast:
			h.mu.RLock()
			defer h.mu.RUnlock()
			
			// Broadcast to all clients subscribed to the message type channel
			ch, ok := h.channels[msg.Type]
			if !ok {
				continue
			}
			
			ch.mu.RLock()
			for clientID := range ch.clientIDs {
				if client, ok := h.clients[clientID]; ok && client.Active {
					// In production, actually send via websocket
					h.stats.MessagesOut++
				}
			}
			ch.mu.RUnlock()
			h.stats.MessagesIn++
		}
	}
}

// Subscribe client to channel
func (h *WSHub) subscribe(channel, clientID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	ch, ok := h.channels[channel]
	if !ok {
		ch = &ChannelSubscriber{
			clientIDs: make(map[string]bool),
		}
		h.channels[channel] = ch
	}

	ch.mu.Lock()
	ch.clientIDs[clientID] = true
	ch.mu.Unlock()
}

// Unsubscribe client from channel
func (h *WSHub) unsubscribe(channel, clientID string) {
	ch, ok := h.channels[channel]
	if !ok {
		return
	}

	ch.mu.Lock()
	defer ch.mu.Unlock()
	delete(ch.clientIDs, clientID)
}

// Broadcast to channel
func Broadcast(channel string, payload interface{}) {
	msg := &WSMessage{
		Type:      channel,
		Payload:  payload,
		Timestamp: time.Now().UnixMilli(),
	}
	hub.broadcast <- msg
}

// Subscribe for trading pairs
func SubscribeTrades(clientID string, pairs []string) {
	for _, pair := range pairs {
		hub.subscribe(fmt.Sprintf("trades:%s", pair), clientID)
	}
}

// Subscribe for order book
func SubscribeOrderBook(clientID string, pairs []string) {
	for _, pair := range pairs {
		hub.subscribe(fmt.Sprintf("orderbook:%s", pair), clientID)
	}
}

// Subscribe for ticker
func SubscribeTicker(clientID string, pairs []string) {
	for _, pair := range pairs {
		hub.subscribe(fmt.Sprintf("ticker:%s", pair), clientID)
	}
}

// Subscribe for user orders
func SubscribeUserOrders(clientID, userID string) {
	h := getHub()
	h.mu.Lock()
	defer h.mu.Unlock()

	if client, ok := h.clients[clientID]; ok {
		client.UserID = userID
		h.subscribe(fmt.Sprintf("user:%s:orders", userID), clientID)
	}
}

// Get hub stats
func GetStats() HubStats {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	return hub.stats
}

func getHub() *WSHub {
	return hub
}

// Health check
func HealthCheck() map[string]interface{} {
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	return map[string]interface{}{
		"connections":   len(hub.clients),
		"channels":    len(hub.channels),
		"messages_in":  hub.stats.MessagesIn,
		"messages_out": hub.stats.MessagesOut,
		"errors":     hub.stats.ErrCount,
	}
}

// Handle WebSocket connection (simplified HTTP upgrade)
func HandleWS(w http.ResponseWriter, r *http.Request) {
	// In production, upgrade to WebSocket
	// For now, return placeholder
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "connected",
	})
}

func main() {
	fmt.Println("WebSocket Hub initialized")
	
	// Demo subscriptions
	clientID := "client_001"
	
	SubscribeTrades(clientID, []string{"BTC/USDT", "ETH/USDT"})
	SubscribeTicker(clientID, []string{"BTC/USDT"})
	
	// Broadcast demo
	Broadcast("ticker:BTC/USDT", map[string]interface{}{
		"price": 65000.0,
		"change": 2.5,
	})
	
	// Stats
	stats := HealthCheck()
	jsonStats, _ := json.Marshal(stats)
	fmt.Printf("Hub stats: %s\n", string(jsonStats))
}