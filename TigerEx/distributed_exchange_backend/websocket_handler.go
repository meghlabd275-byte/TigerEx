package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Client connection
type WSClient struct {
	ID            string
	Subscriptions map[string]bool
	ConnectedAt   time.Time
}

// WebSocket message
type WSMessage struct {
	Method string   `json:"method"`
	Params []string `json:"params,omitempty"`
}

// Stream message for broadcasting
type StreamMessage struct {
	Stream string      `json:"stream"`
	Data  interface{} `json:"data"`
}

// WebSocket Handler
type WSHandler struct {
	mu         sync.RWMutex
	Clients    map[string]*WSClient
	Channels  map[string]map[string]bool // channel -> clients
}

// NewWSHandler creates new WebSocket handler
func NewWSHandler() *WSHandler {
	return &WSHandler{
		Clients:  make(map[string]*WSClient),
		Channels: make(map[string]map[string]bool),
	}
}

// Generate client ID
func (h *WSHandler) generateID() string {
	return fmt.Sprintf("ws_%d", time.Now().UnixNano())
}

// Handle new connection
func (h *WSHandler) OnConnect() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	clientID := h.generateID()
	h.Clients[clientID] = &WSClient{
		ID:            clientID,
		Subscriptions: make(map[string]bool),
		ConnectedAt:   time.Now(),
	}
	
	return clientID
}

// Handle disconnect
func (h *WSHandler) OnDisconnect(clientID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	client, ok := h.Clients[clientID]
	if !ok {
		return
	}
	
	// Remove from all channels
	for ch := range client.Subscriptions {
		if channelClients, exists := h.Channels[ch]; exists {
			delete(channelClients, clientID)
		}
	}
	
	delete(h.Clients, clientID)
}

// Subscribe to channels
func (h *WSHandler) Subscribe(clientID string, channels []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	client, ok := h.Clients[clientID]
	if !ok {
		return
	}
	
	for _, ch := range channels {
		client.Subscriptions[ch] = true
		
		// Add to channel
		if _, exists := h.Channels[ch]; !exists {
			h.Channels[ch] = make(map[string]bool)
		}
		h.Channels[ch][clientID] = true
	}
}

// Unsubscribe from channels
func (h *WSHandler) Unsubscribe(clientID string, channels []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	client, ok := h.Clients[clientID]
	if !ok {
		return
	}
	
	for _, ch := range channels {
		delete(client.Subscriptions, ch)
		
		if channelClients, exists := h.Channels[ch]; exists {
			delete(channelClients, clientID)
		}
	}
}

// Broadcast to channel
func (h *WSHandler) Broadcast(channel string, data interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	clients, ok := h.Channels[channel]
	if !ok {
		return
	}
	
	msg := StreamMessage{
		Stream: channel,
		Data:   data,
	}
	
	msgBytes, _ := json.Marshal(msg)
	_ = msgBytes // Would send via WebSocket in real implementation
	
	// In real implementation, send to each client
	for clientID := range clients {
		// client.ws.Send(msgBytes)
		_ = clientID
	}
}

// Handle message
func (h *WSHandler) OnMessage(clientID string, data []byte) error {
	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return err
	}
	
	switch msg.Method {
	case "SUBSCRIBE":
		h.Subscribe(clientID, msg.Params)
	case "UNSUBSCRIBE":
		h.Unsubscribe(clientID, msg.Params)
	}
	
	return nil
}

// Count clients
func (h *WSHandler) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	return len(h.Clients)
}

// Subscribed channels
func (h *WSHandler) GetSubscriptions(clientID string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	client, ok := h.Clients[clientID]
	if !ok {
		return nil
	}
	
	chans := make([]string, 0, len(client.Subscriptions))
	for ch := range client.Subscriptions {
		chans = append(chans, ch)
	}
	
	return chans
}

// Stream constants
const (
	StreamTicker    = "%s@ticker"
	StreamTrade    = "%s@trade"
	StreamDepth   = "%s@depth"
	StreamKline  = "%s@kline_%s"
	StreamUser   = "%s@user"
)

// Build stream name
func BuildStream(symbol, streamType string) string {
	return fmt.Sprintf("%s@%s", symbol, streamType)
}

// Main
func main() {
	handler := NewWSHandler()
	
	// Simulate connection
	clientID := handler.OnConnect()
	fmt.Println("Client connected:", clientID)
	
	// Subscribe to streams
	handler.Subscribe(clientID, []string{
		"btcusdt@ticker",
		"ethusdt@trade",
	})
	
	subscriptions := handler.GetSubscriptions(clientID)
	fmt.Println("Subscriptions:", subscriptions)
	
	// Broadcast
	handler.Broadcast("btcusdt@ticker", map[string]interface{}{
		"price": 50000.00,
		"quantity": 0.5,
	})
	
	// Disconnect
	handler.OnDisconnect(clientID)
	fmt.Println("Client disconnected, total clients:", handler.ClientCount())
}