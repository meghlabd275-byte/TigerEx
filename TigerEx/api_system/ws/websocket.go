// Package ws provides WebSocket server for real-time data.
package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// upgrader upgrades HTTP to WebSocket
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // In production, would check origin
	},
}

// MessageType represents WebSocket message type
type MessageType string

const (
	MsgTypePing       MessageType = "ping"
	MsgTypePong       MessageType = "pong"
	MsgTypeSubscribe   MessageType = "subscribe"
	MsgTypeUnsubscribe MessageType = "unsubscribe"
	MsgTypeEvent     MessageType = "event"
	MsgTypeError     MessageType = "error"
)

// Channel represents subscription channel
type Channel string

const (
	ChannelTicker    Channel = "ticker"
	ChannelTrades    Channel = "trades"
	ChannelDepth    Channel = "depth"
	ChannelKLine   Channel = "kline"
	ChannelAccount Channel = "account"
)

// Event represents WebSocket event
type Event struct {
	Type    string          `json:"type"`
	Channel Channel        `json:"channel"`
	Symbol string         `json:"symbol,omitempty"`
	Data   json.RawMessage `json:"data"`
}

// Subscription represents a channel subscription
type Subscription struct {
	ID      string   `json:"id"`
	Channel Channel  `json:"channel"`
	Symbol  string   `json:"symbol,omitempty"`
	Params  []string `json:"params,omitempty"`
}

// Client represents a WebSocket client
type Client struct {
	ID        string
	Conn     *websocket.Conn
	Send     chan []byte
	Groups   map[string]bool
	Mu       sync.Mutex
	RemoteIP string
	LastPing time.Time
}

// Hub manages WebSocket connections
type Hub struct {
	mu           sync.RWMutex
	clients      map[*Client]bool
	channels     map[Channel]map[*Client]bool
	register    chan *Client
	unregister   chan *Client
	broadcast   chan []byte
	ctx         context.Context
	cancel      context.CancelFunc
	msgHandlers map[Channel]MessageHandler
}

// MessageHandler handles messages for a channel
type MessageHandler interface {
	Handle(client *Client, msg []byte)
}

// TickerHandler handles ticker updates
type TickerHandler struct {
	mu      sync.RWMutex
	prices map[string]float64
}

// NewHub creates new WebSocket hub
func NewHub() *Hub {
	ctx, cancel := context.WithCancel(context.Background())

	return &Hub{
		clients:    make(map[*Client]bool),
		channels:   make(map[Channel]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast: make(chan []byte, 256),
		ctx:       ctx,
		cancel:    cancel,
	}
}

// Register adds a client
func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[client] = true
	log.Printf("Client connected: %s (total: %d)", client.ID, len(h.clients))
}

// Unregister removes a client
func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.Send)

		// Remove from all channels
		for _, channelClients := range h.channels {
			delete(channelClients, client)
		}
	}

	log.Printf("Client disconnected: %s (total: %d)", client.ID, len(h.clients))
}

// Subscribe subscribes client to channel
func (h *Hub) Subscribe(client *Client, sub Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.channels[sub.Channel] == nil {
		h.channels[sub.Channel] = make(map[*Client]bool)
	}

	h.channels[sub.Channel][client] = true
	client.Groups[string(sub.Channel)] = true
}

// Unsubscribe unsubscribes client from channel
func (h *Hub) Unsubscribe(client *Client, sub Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, ok := h.channels[sub.Channel]; ok {
		delete(clients, client)
		delete(client.Groups, string(sub.Channel))
	}
}

// Broadcast sends to all clients in channel
func (h *Hub) Broadcast(channel Channel, event Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients, ok := h.channels[channel]
	if !ok {
		return
	}

	data, _ := json.Marshal(event)

	for client := range clients {
		select {
		case client.Send <- data:
		default:
			// Skip slow clients
		}
	}
}

// SendTo sends to specific client
func (h *Hub) SendTo(client *Client, event Event) {
	data, _ := json.Marshal(event)
	client.Send <- data
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.Register(client)

		case client := <-h.unregister:
			h.Unregister(client)

		case msg := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.Send <- msg:
				default:
					h.Unregister(client)
				}
			}
			h.mu.RUnlock()

		case <-h.ctx.Done():
			return
		}
	}
}

// Stop stops the hub
func (h *Hub) Stop() {
	h.cancel()

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		client.Conn.Close()
	}
}

// HandleWebSocket handles WebSocket connection
func HandleWebSocket(h *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	client := &Client{
		ID:        uuid.New().String(),
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Groups:   make(map[string]bool),
		LastPing: time.Now(),
	}

	h.Register(client)

	go client.writePump(h)
	go client.readPump(h, conn)
}

// readPump reads messages from client
func (c *Client) readPump(h *Hub, conn *websocket.Conn) {
	defer func() {
		h.Unregister(c)
		conn.Close()
	}()

	conn.SetReadLimit(512 * 1024)
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) {
		c.LastPing = time.Now()
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		c.handleMessage(h, message)
	}
}

// writePump writes messages to client
func (c *Client) writePump(h *Hub) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case message, ok := <-c.Send:
			conn := c.Conn
			if !ok {
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			conn := c.Conn
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				return
			}

		case <-h.ctx.Done():
			return
		}
	}
}

func (c *Client) handleMessage(h *Hub, msg []byte) {
	var wrapper struct {
		Type    MessageType `json:"type"`
		Channel Channel     `json:"channel,omitempty"`
		Symbol  string      `json:"symbol,omitempty"`
		Params  []string    `json:"params,omitempty"`
	}

	if err := json.Unmarshal(msg, &wrapper); err != nil {
		c.sendError(h, "invalid message format")
		return
	}

	switch wrapper.Type {
	case MsgTypeSubscribe:
		sub := Subscription{
			ID:      c.ID,
			Channel: wrapper.Channel,
			Symbol:  wrapper.Symbol,
			Params:  wrapper.Params,
		}
		h.Subscribe(c, sub)

	case MsgTypeUnsubscribe:
		sub := Subscription{
			ID:      c.ID,
			Channel: wrapper.Channel,
			Symbol:  wrapper.Symbol,
		}
		h.Unsubscribe(c, sub)

	case MsgTypePing:
		c.LastPing = time.Now()

		event := Event{
			Type: string(MsgTypePong),
		}
		h.SendTo(c, event)
	}
}

func (c *Client) sendError(h *Hub, message string) {
	event := Event{
		Type:  string(MsgTypeError),
		Data:  json.RawMessage(fmt.Sprintf(`{"message": "%s"}`, message)),
	}
	h.SendTo(c, event)
}

// Tick provides ticker updates
func (th *TickerHandler) Tick(symbol string, price float64) {
	th.mu.Lock()
	defer th.mu.Unlock()
	th.prices[symbol] = price
}

var _ = (&websocket.Conn{}).__proto__