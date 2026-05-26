package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// ============================================================================
// WEBSOCKET SERVER TYPES
// ============================================================================

type WSMessage struct {
	Type    string          `json:"type"`
	Channel string          `json:"channel,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type WSSubscription struct {
	Channel string
	Filter  map[string]interface{}
}

type WSClient struct {
	ID        string
	Conn     *websocket.Conn
	Send     chan []byte
	Subs     map[string]bool
	JoinedAt int64
	Metrics  ClientMetrics
}

type ClientMetrics struct {
	MessagesSent   int64
	MessagesRecv  int64
	BytesSent     int64
	BytesRecv     int64
	LastActivity  int64
}

type WSChannel struct {
	Name      string
	Clients   map[*WSClient]bool
	Broadcast chan []byte
	Register  chan *WSClient
	Unregister chan *WSClient
	mu        sync.RWMutex
}

type WSServer struct {
	// Configuration
	Addr            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	MaxMessageSize  int64
	MaxClients      int

	// Channels
	channels map[string]*WSChannel

	// Client management
	clients    map[string]*WSClient
	clientCount int64

	// Upgrader
	upgrader websocket.Upgrader

	// Metrics
	TotalConnections int64 `json:"totalConnections"`
	ActiveClients   int64 `json:"activeClients"`
	TotalMessages   int64 `json:"totalMessages"`
	TotalBroadcasts int64 `json:"totalBroadcasts"`

	// HTTP Server
	server *http.Server

	// Running state
	running bool
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

func NewWSServer(addr string) *WSServer {
	return &WSServer{
		Addr:           addr,
		ReadTimeout:     30 * time.Second,
		WriteTimeout:    30 * time.Second,
		MaxMessageSize:  16 * 1024, // 16KB
		MaxClients:      100000,
		channels:       make(map[string]*WSChannel),
		clients:        make(map[string]*WSClient),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // In production, check origin
			},
		},
	}
}

// Initialize default channels
func (wss *WSServer) InitChannels() {
	defaultChannels := []string{
		"trades", "orders", "orderbook", "ticker",
		"account", "deposits", "withdrawals", "announcements",
	}

	for _, ch := range defaultChannels {
		wss.channels[ch] = wss.newChannel(ch)
	}
}

func (wss *WSServer) newChannel(name string) *WSChannel {
	return &WSChannel{
		Name:       name,
		Clients:   make(map[*WSClient]bool),
		Broadcast: make(chan []byte, 10000),
		Register:   make(chan *WSClient),
		Unregister: make(chan *WSClient),
	}
}

// Start the WebSocket server
func (wss *WSServer) Start() error {
	if wss.running {
		return fmt.Errorf("server already running")
	}

	wss.InitChannels()

	// Start channel broadcasters
	for _, ch := range wss.channels {
		go wss.channelBroadcaster(ch)
	}

	// HTTP handler
	http.HandleFunc("/ws", wss.handleWebSocket)
	http.HandleFunc("/health", wss.handleHealth)

	wss.server = &http.Server{
		Addr:         wss.Addr,
		ReadTimeout:  wss.ReadTimeout,
		WriteTimeout: wss.WriteTimeout,
	}

	wss.running = true

	log.Printf("WebSocket server starting on %s", wss.Addr)
	return wss.server.ListenAndServe()
}

// Stop the server
func (wss *WSServer) Stop() error {
	wss.running = false

	// Close all client connections
	for _, client := range wss.clients {
		client.Conn.Close()
	}

	if wss.server != nil {
		return wss.server.Close()
	}

	return nil
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

func (wss *WSServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Check max clients
	if atomic.LoadInt64(&wss.clientCount) >= int64(wss.MaxClients) {
		http.Error(w, "max clients reached", http.StatusServiceUnavailable)
		return
	}

	// Upgrade connection
	conn, err := wss.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	// Create client
	client := &WSClient{
		ID:        uuid.New().String(),
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Subs:     make(map[string]bool),
		JoinedAt: time.Now().UnixMilli(),
		Metrics: ClientMetrics{
			LastActivity: time.Now().UnixMilli(),
		},
	}

	// Register client
	wss.mu.Lock()
	wss.clients[client.ID] = client
	atomic.AddInt64(&wss.clientCount, 1)
	atomic.AddInt64(&wss.TotalConnections, 1)
	wss.mu.Unlock()

	// Subscribe to default channels
	for ch := range wss.channels {
		client.Subs[ch] = true
		wss.channels[ch].Register <- client
	}

	// Start goroutines
	go wss.writePump(client)
	go wss.readPump(client)

	log.Printf("Client connected: %s (total: %d)", client.ID[:8], atomic.LoadInt64(&wss.clientCount))
}

func (wss *WSServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        "ok",
		"activeClients": atomic.LoadInt64(&wss.ActiveClients),
		"totalConn":    atomic.LoadInt64(&wss.TotalConnections),
	})
}

// ============================================================================
// WEBSOCKET PUMPS
// ============================================================================

func (wss *WSServer) readPump(client *WSClient) {
	defer func() {
		wss.unregisterClient(client)
		client.Conn.Close()
	}()

	client.Conn.SetReadLimit(wss.MaxMessageSize)
	client.Conn.SetReadDeadline(time.Now().Add(wss.ReadTimeout))

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Read error: %v", err)
			}
			break
		}

		// Update metrics
		atomic.AddInt64(&client.Metrics.MessagesRecv, 1)
		atomic.AddInt64(&client.Metrics.BytesRecv, int64(len(message)))
		atomic.AddInt64(&wss.TotalMessages, 1)
		client.Metrics.LastActivity = time.Now().UnixMilli()

		// Handle message
		wss.handleMessage(client, message)
	}
}

func (wss *WSServer) writePump(client *WSClient) {
	ticker := time.NewTicker(15 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(wss.WriteTimeout))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := client.Conn.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				return
			}

			// Update metrics
			atomic.AddInt64(&client.Metrics.MessagesSent, 1)
			atomic.AddInt64(&client.Metrics.BytesSent, int64(len(message)))

		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(wss.WriteTimeout))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

func (wss *WSServer) handleMessage(client *WSClient, message []byte) {
	var msg WSMessage
	if err := json.Unmarshal(message, &msg); err != nil {
		wss.sendError(client, "invalid_message", err.Error())
		return
	}

	switch msg.Type {
	case "subscribe":
		wss.handleSubscribe(client, msg.Channel)
	case "unsubscribe":
		wss.handleUnsubscribe(client, msg.Channel)
	case "ping":
		wss.sendToClient(client, "pong", nil)
	default:
		wss.sendError(client, "unknown_type", fmt.Sprintf("unknown message type: %s", msg.Type))
	}
}

func (wss *WSServer) handleSubscribe(client *WSClient, channel string) {
	if _, ok := wss.channels[channel]; !ok {
		wss.sendError(client, "invalid_channel", fmt.Sprintf("channel %s not found", channel))
		return
	}

	client.Subs[channel] = true
	wss.channels[channel].Register <- client

	wss.sendToClient(client, "subscribed", map[string]string{"channel": channel})
}

func (wss *WSServer) handleUnsubscribe(client *WSClient, channel string) {
	if _, ok := wss.channels[channel]; !ok {
		return
	}

	delete(client.Subs, channel)
	wss.channels[channel].Unregister <- client

	wss.sendToClient(client, "unsubscribed", map[string]string{"channel": channel})
}

// ============================================================================
// BROADCASTING
// ============================================================================

func (wss *WSServer) channelBroadcaster(channel *WSChannel) {
	for {
		select {
		case message := <-channel.Broadcast:
			channel.mu.RLock()
			for client := range channel.Clients {
				select {
				case client.Send <- message:
				default:
					// Client buffer full, skip
				}
			}
			channel.mu.RUnlock()
			atomic.AddInt64(&wss.TotalBroadcasts, 1)

		case client := <-channel.Register:
			channel.mu.Lock()
			channel.Clients[client] = true
			channel.mu.Unlock()
			atomic.AddInt64(&wss.ActiveClients, 1)

		case client := <-channel.Unregister:
			channel.mu.Lock()
			if _, ok := channel.Clients[client]; ok {
				delete(channel.Clients, client)
				close(client.Send)
			}
			channel.mu.Unlock()
			atomic.AddInt64(&wss.ActiveClients, -1)
		}
	}
}

// ============================================================================
// CLIENT MANAGEMENT
// ============================================================================

func (wss *WSServer) unregisterClient(client *WSClient) {
	wss.mu.Lock()
	delete(wss.clients, client.ID)
	atomic.AddInt64(&wss.clientCount, -1)
	wss.mu.Unlock()

	// Unsubscribe from all channels
	for channel := range client.Subs {
		if ch, ok := wss.channels[channel]; ok {
			ch.Unregister <- client
		}
	}

	log.Printf("Client disconnected: %s", client.ID[:8])
}

// ============================================================================
// SEND METHODS
// ============================================================================

func (wss *WSServer) sendToClient(client *WSClient, msgType string, data interface{}) {
	msg := map[string]interface{}{
		"type": msgType,
		"data": data,
	}

	jsonMsg, err := json.Marshal(msg)
	if err != nil {
		return
	}

	select {
	case client.Send <- jsonMsg:
	default:
		// Buffer full
	}
}

func (wss *WSServer) sendError(client *WSClient, code, message string) {
	wss.sendToClient(client, "error", map[string]string{
		"code":    code,
		"message": message,
	})
}

// BroadcastToChannel sends message to all clients in channel
func (wss *WSServer) BroadcastToChannel(channel, msgType string, data interface{}) {
	ch, ok := wss.channels[channel]
	if !ok {
		return
	}

	msg := map[string]interface{}{
		"type": msgType,
		"data": data,
	}

	jsonMsg, err := json.Marshal(msg)
	if err != nil {
		return
	}

	select {
	case ch.Broadcast <- jsonMsg:
	default:
		// Channel buffer full
	}
}

// BroadcastToAll sends message to all connected clients
func (wss *WSServer) BroadcastToAll(msgType string, data interface{}) {
	for _, ch := range wss.channels {
		wss.BroadcastToChannel(ch.Name, msgType, data)
	}
}

// ============================================================================
// PUBLIC METHODS
// ============================================================================

func (wss *WSServer) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"totalConnections":  atomic.LoadInt64(&wss.TotalConnections),
		"activeClients":    atomic.LoadInt64(&wss.ActiveClients),
		"totalMessages":    atomic.LoadInt64(&wss.TotalMessages),
		"totalBroadcasts": atomic.LoadInt64(&wss.TotalBroadcasts),
		"channels":        len(wss.channels),
	}
}

// ============================================================================
// EXAMPLE TRADE BROADCAST
// ============================================================================

type TradeMessage struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Quantity  float64 `json:"quantity"`
	Side      string  `json:"side"`
	Timestamp int64   `json:"timestamp"`
}

func (wss *WSServer) BroadcastTrade(trade TradeMessage) {
	wss.BroadcastToChannel("trades", "trade", trade)
}

func (wss *WSServer) BroadcastTicker(symbol string, price, change, high, low, volume float64) {
	wss.BroadcastToChannel("ticker", "ticker", map[string]interface{}{
		"symbol":       symbol,
		"lastPrice":    price,
		"priceChange":   change,
		"high24h":      high,
		"low24h":       low,
		"volume24h":    volume,
		"timestamp":    time.Now().UnixMilli(),
	})
}

func (wss *WSServer) BroadcastOrderBook(symbol string, bids, asks [][]float64) {
	wss.BroadcastToChannel("orderbook", "orderbook", map[string]interface{}{
		"symbol":    symbol,
		"bids":      bids,
		"asks":      asks,
		"timestamp": time.Now().UnixMilli(),
	})
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx WebSocket Server (Go)")
	fmt.Println("================================\n")

	wss := NewWSServer(":8080")

	// Start in goroutine
	go func() {
		if err := wss.Start(); err != nil {
			log.Printf("Server error: %v", err)
		}
	}()

	// Simulate broadcasts
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	fmt.Println("Broadcasting sample data...")

	for i := 0; i < 5; i++ {
		select {
		case <-ticker.C:
			// Broadcast trade
			trade := TradeMessage{
				Symbol:    "BTC/USDT",
				Price:     50000 + float64(i*100),
				Quantity:  0.5 + float64(i)*0.1,
				Side:      []string{"buy", "sell"}[i%2],
				Timestamp: time.Now().UnixMilli(),
			}
			wss.BroadcastTrade(trade)

			// Broadcast ticker
			wss.BroadcastTicker("BTC/USDT", 50000+float64(i*100), float64(i*10), 51000, 49000, 15000)

			fmt.Printf("Broadcast: trade @ %.2f, ticker updated\n", trade.Price)
		}
	}

	// Get metrics
	metrics := wss.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	fmt.Println("\nWebSocket server running on :8080")
	fmt.Println("Connect with: ws://localhost:8080/ws")

	// Wait
	select {}
}