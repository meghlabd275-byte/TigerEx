package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/golang-jwt/jwt/v5"
)

// =============================================================================
// WEBSOCKET SERVICE - Complete Production Implementation
// =============================================================================

// WebSocketService handles real-time connections
type WebSocketService struct {
 upgrader       websocket.Upgrader
 connections   map[string]*WSConnection
 subscriptionMgr *SubscriptionManager
 messageChan   chan *WSMessage
 stats         *WSStats
 mutex         sync.RWMutex
}

type WSStats struct {
	Connections   int64
	MessagesIn   int64
	MessagesOut int64
	Errors      int64
}

const (
	// Message types
	WSMsgSubscribe   = "subscribe"
	WSMsgUnsubscribe = "unsubscribe"
	WSMsgPing        = "ping"
	WSMsgPong        = "pong"
	WSMsgError       = "error"
	
	// Stream names
	StreamTicker     = "ticker"
	StreamTrade     = "trade"
	StreamDepth     = "depth"
	StreamKline    = "kline"
	StreamOrderbook = "orderbook"
	StreamAccount  = "account"
	StreamOrder    = "order"
)

// =============================================================================
// CONNECTION
// =============================================================================

type WSConnection struct {
	ID        string
	Conn     *websocket.Conn
	UserID   string
	Token    string
	IsAuth   bool
	Streams  map[string]bool
	CreatedAt time.Time
	LastPing time.Time
	
	service *WebSocketService
	send    chan []byte
	done    chan struct{}
}

func NewConnection(conn *websocket.Conn, service *WebSocketService) *WSConnection {
	return &WSConnection{
		ID:        uuid.New().String(),
		Conn:     conn,
		Streams:  make(map[string]bool),
		CreatedAt: time.Now(),
		LastPing: time.Now(),
		service:  service,
		send:    make(chan []byte, 256),
		done:    make(chan struct{}),
	}
}

// ReadLoop reads messages from connection
func (c *WSConnection) ReadLoop() {
	defer func() {
		c.service.removeConnection(c.ID)
		close(c.done)
		c.Conn.Close()
	}()
	
	c.Conn.SetReadLimit(4096)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.LastPing = time.Now()
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}
		
		c.service.handleMessage(c, message)
	}
}

// WriteLoop writes messages to connection
func (c *WSConnection) WriteLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
			
		case <-ticker.C:
			if err := c.Conn.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
				return
			}
		}
	}
}

// Send sends message to connection
func (c *WSConnection) Send(data interface{}) error {
	msg, err := json.Marshal(data)
	if err != nil {
		return err
	}
	
	select {
	case c.send <- msg:
		return nil
	case <-c.done:
		return fmt.Errorf("connection closed")
	default:
		return fmt.Errorf("send buffer full")
	}
}

// =============================================================================
// SUBSCRIPTION MANAGER
// =============================================================================

type SubscriptionManager struct {
	mu         sync.RWMutex
	subscribers map[string]map[string]*WSConnection // stream -> connection ID -> connection
	
	// Redis pub/sub for distributed messaging
	redisPubSub bool
}

func NewSubscriptionManager() *SubscriptionManager {
	return &SubscriptionManager{
		subscribers: make(map[string]map[string]*WSConnection),
	}
}

// Subscribe adds connection to stream
func (sm *SubscriptionManager) Subscribe(conn *WSConnection, stream string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	if _, ok := sm.subscribers[stream]; !ok {
		sm.subscribers[stream] = make(map[string]*WSConnection)
	}
	
	sm.subscribers[stream][conn.ID] = conn
	conn.Streams[stream] = true
}

// Unsubscribe removes connection from stream
func (sm *SubscriptionManager) Unsubscribe(conn *WSConnection, stream string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	if subs, ok := sm.subscribers[stream]; ok {
		delete(subs, conn.ID)
		delete(conn.Streams, stream)
	}
}

// UnsubscribeAll removes all subscriptions
func (sm *SubscriptionManager) UnsubscribeAll(conn *WSConnection) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	
	for stream := range conn.Streams {
		if subs, ok := sm.subscribers[stream]; ok {
			delete(subs, conn.ID)
		}
	}
	
	conn.Streams = make(map[string]bool)
}

// Broadcast sends message to all subscribers of a stream
func (sm *SubscriptionManager) Broadcast(stream string, message interface{}) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	
	subs, ok := sm.subscribers[stream]
	if !ok {
		return
	}
	
	msg, err := json.Marshal(message)
	if err != nil {
		return
	}
	
	for _, conn := range subs {
		select {
		case conn.send <- msg:
		default:
			// Buffer full, skip
		}
	}
}

// GetSubscriberCount returns number of subscribers
func (sm *SubscriptionManager) GetSubscriberCount(stream string) int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	
	if subs, ok := sm.subscribers[stream]; ok {
		return len(subs)
	}
	return 0
}

// =============================================================================
// WEBSOCKET SERVICE
// =============================================================================

// NewWebSocketService creates new WebSocket service
func NewWebSocketService() *WebSocketService {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
            origin := strings.TrimSpace(r.Header.Get("Origin"))
            // Non-browser clients commonly omit Origin. Browser origins must
            // match an explicit administrator-managed allowlist.
            if origin == "" { return true }
            for _, candidate := range strings.Split(os.Getenv("TIGEREX_WS_ALLOWED_ORIGINS"), ",") {
                if strings.TrimSpace(candidate) != "" && strings.TrimSpace(candidate) == origin { return true }
            }
            return false
		},
	}
	
	return &WebSocketService{
		upgrader:       upgrader,
		connections:    make(map[string]*WSConnection),
		subscriptionMgr: NewSubscriptionManager(),
		messageChan:   make(chan *WSMessage, 10000),
		stats:       &WSStats{},
	}
}

// HandleConnection handles WebSocket upgrade
func (ws *WebSocketService) HandleConnection(w http.ResponseWriter, r *http.Request) {
    // Query-string bearer tokens leak into proxy/access logs. Use an
    // Authorization header or a secure HttpOnly access-token cookie instead.
    if r.URL.Query().Get("token") != "" {
        http.Error(w, "query-string tokens are not accepted", http.StatusBadRequest)
        return
    }
    token := ""
    if header := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(header, "Bearer ") {
        token = strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
    }
    if token == "" {
        if cookie, err := r.Cookie("tigerex_access_token"); err == nil { token = strings.TrimSpace(cookie.Value) }
    }

    userID := ""
    if token != "" {
        var err error
        userID, err = ws.authenticate(r.Context(), token)
        if err != nil {
            http.Error(w, "invalid or unavailable authentication", http.StatusUnauthorized)
            return
        }
    }

    conn, err := ws.upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("WebSocket upgrade error: %v", err)
        return
    }
    wsConn := NewConnection(conn, ws)
    if token != "" {
        wsConn.UserID = userID
        wsConn.Token = token
        wsConn.IsAuth = true
    }
    ws.addConnection(wsConn)

    go wsConn.ReadLoop()
    go wsConn.WriteLoop()
    wsConn.Send(map[string]interface{}{"type": "connected", "id": wsConn.ID, "time": time.Now().Unix(), "authenticated": wsConn.IsAuth})
}

// addConnection adds connection to service
func (ws *WebSocketService) addConnection(conn *WSConnection) {
	ws.mutex.Lock()
	defer ws.mutex.Unlock()
	
	ws.connections[conn.ID] = conn
	ws.stats.Connections = int64(len(ws.connections))
}

// removeConnection removes connection from service
func (ws *WebSocketService) removeConnection(id string) {
	ws.mutex.Lock()
	defer ws.mutex.Unlock()
	
	if conn, ok := ws.connections[id]; ok {
		ws.subscriptionMgr.UnsubscribeAll(conn)
		delete(ws.connections, id)
		ws.stats.Connections = int64(len(ws.connections))
	}
}

// handleMessage handles incoming message
func (ws *WebSocketService) handleMessage(conn *WSConnection, data []byte) {
	ws.mutex.Lock(); ws.stats.MessagesIn++; ws.mutex.Unlock()
	
	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		ws.mutex.Lock(); ws.stats.Errors++; ws.mutex.Unlock()
		conn.Send(WSError("Invalid message format"))
		return
	}
	
	switch msg.Type {
	case WSMsgSubscribe:
		ws.handleSubscribe(conn, msg.Streams)
		
	case WSMsgUnsubscribe:
		ws.handleUnsubscribe(conn, msg.Streams)
		
	case WSMsgPing:
		conn.Send(WSMessage{Type: WSMsgPong, Time: time.Now().Unix()})
		
	default:
		ws.mutex.Lock(); ws.stats.Errors++; ws.mutex.Unlock()
		conn.Send(WSError("Unknown message type"))
	}
}

// handleSubscribe handles subscription
func (ws *WebSocketService) handleSubscribe(conn *WSConnection, streams []string) {
    accepted := make([]string, 0, len(streams))
    for _, stream := range streams {
        stream = strings.TrimSpace(stream)
        if stream == "" || len(stream) > 256 {
            conn.Send(WSError("invalid stream name"))
            continue
        }
        streamType := getStreamType(stream)
        if streamType == "" {
            conn.Send(WSError("unsupported stream"))
            continue
        }
        if strings.HasSuffix(stream, "@account") || strings.HasSuffix(stream, "@order") {
            owner := strings.TrimSuffix(strings.TrimSuffix(stream, "@account"), "@order")
            if !conn.IsAuth || owner == "" || owner != conn.UserID {
                conn.Send(WSError("authenticated owner access is required for private streams"))
                continue
            }
        }
        ws.subscriptionMgr.Subscribe(conn, stream)
        accepted = append(accepted, stream)
        ws.sendInitialData(conn, stream)
    }
    conn.Send(map[string]interface{}{
        "type": "subscription", "success": len(accepted) > 0,
        "streams": accepted, "timestamp": time.Now().Unix(),
    })
}

// handleUnsubscribe handles unsubscription
func (ws *WebSocketService) handleUnsubscribe(conn *WSConnection, streams []string) {
	for _, stream := range streams {
		ws.subscriptionMgr.Unsubscribe(conn, stream)
	}
	
	conn.Send(map[string]interface{}{
		"type":    "unsubscription",
		"success": true,
		"streams": streams,
	})
}

// sendInitialData sends initial data for stream
func (ws *WebSocketService) sendInitialData(conn *WSConnection, stream string) {
    // Do not manufacture snapshots. Live broadcasts can be published by a
    // configured market-data provider; initial snapshots require that provider.
    conn.Send(WSError("initial snapshot provider is not configured; no synthetic data is returned"))
}

// =============================================================================
// STREAM BROADCASTING
// =============================================================================

// BroadcastTicker broadcasts ticker update
func (ws *WebSocketService) BroadcastTicker(symbol string, ticker interface{}) {
	stream := fmt.Sprintf("%s@ticker", symbol)
	ws.subscriptionMgr.Broadcast(stream, map[string]interface{}{
		"type": stream,
		"data": ticker,
	})
}

// BroadcastTrade broadcasts new trade
func (ws *WebSocketService) BroadcastTrade(symbol string, trade interface{}) {
	stream := fmt.Sprintf("%s@trade", symbol)
	ws.subscriptionMgr.Broadcast(stream, map[string]interface{}{
		"type": stream,
		"data": trade,
	})
}

// BroadcastDepth broadcasts order book update
func (ws *WebSocketService) BroadcastDepth(symbol string, depth interface{}) {
	stream := fmt.Sprintf("%s@depth", symbol)
	ws.subscriptionMgr.Broadcast(stream, map[string]interface{}{
		"type": stream,
		"data": depth,
	})
}

// BroadcastKline broadcasts kline/candlestick update
func (ws *WebSocketService) BroadcastKline(symbol, interval string, kline interface{}) {
	stream := fmt.Sprintf("%s@kline_%s", symbol, interval)
	ws.subscriptionMgr.Broadcast(stream, map[string]interface{}{
		"type": stream,
		"data": kline,
	})
}

// BroadcastAccount broadcasts account update
func (ws *WebSocketService) BroadcastAccount(userID string, account interface{}) {
	stream := fmt.Sprintf("%s@account", userID)
	ws.subscriptionMgr.Broadcast(stream, map[string]interface{}{
		"type": stream,
		"data": account,
	})
}

// BroadcastOrder broadcasts order update
func (ws *WebSocketService) BroadcastOrder(userID string, order interface{}) {
	stream := fmt.Sprintf("%s@order", userID)
	ws.subscriptionMgr.Broadcast(stream, map[string]interface{}{
		"type": stream,
		"data": order,
	})
}

// =============================================================================
// MESSAGE TYPES
// =============================================================================

type WSMessage struct {
    Type string `json:"type,omitempty"`
    Streams []string `json:"streams,omitempty"`
    Time int64 `json:"time,omitempty"`
    Stream string `json:"stream,omitempty"`
    Data interface{} `json:"data,omitempty"`
}

func WSError(message string) map[string]interface{} {
	return map[string]interface{}{
		"type":    WSMsgError,
		"message": message,
		"time":    time.Now().Unix(),
	}
}

// =============================================================================
// STREAM TYPE PARSING
// =============================================================================

func getStreamType(stream string) string {
    switch {
    case strings.HasSuffix(stream, "@ticker"): return StreamTicker
    case strings.HasSuffix(stream, "@trade"): return StreamTrade
    case strings.HasSuffix(stream, "@depth"): return StreamDepth
    case strings.Contains(stream, "@kline_"): return StreamKline
    case strings.HasSuffix(stream, "@orderbook"): return StreamOrderbook
    case strings.HasSuffix(stream, "@account"): return StreamAccount
    case strings.HasSuffix(stream, "@order"): return StreamOrder
    default: return ""
    }
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

func (ws *WebSocketService) authenticate(ctx context.Context, tokenString string) (string, error) {
    secret := []byte(os.Getenv("JWT_SECRET"))
    if len(secret) < 32 {
        return "", fmt.Errorf("JWT_SECRET must be configured with at least 32 bytes")
    }
    parsed, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if token.Method != jwt.SigningMethodHS256 {
            return nil, fmt.Errorf("unexpected JWT signing method")
        }
        return secret, nil
    }, jwt.WithValidMethods([]string{"HS256"}))
    if err != nil || parsed == nil || !parsed.Valid {
        return "", fmt.Errorf("invalid token")
    }
    claims, ok := parsed.Claims.(jwt.MapClaims)
    if !ok {
        return "", fmt.Errorf("invalid claims")
    }
    exp, err := claims.GetExpirationTime()
    if err != nil || exp == nil {
        return "", fmt.Errorf("token expiration is required")
    }
    userID, ok := claims["user_id"].(string)
    if !ok || strings.TrimSpace(userID) == "" {
        return "", fmt.Errorf("user_id claim is required")
    }
    return userID, nil
}

// =============================================================================
// HTTP HANDLERS
// =============================================================================

// Handler returns HTTP handler for WebSocket
func (ws *WebSocketService) Handler() http.Handler {
	return http.HandlerFunc(ws.HandleConnection)
}

// =============================================================================
// STATS
// =============================================================================

// GetStats returns WebSocket statistics
func (ws *WebSocketService) GetStats() map[string]interface{} {
	ws.mutex.RLock()
	defer ws.mutex.RUnlock()
	
	return map[string]interface{}{
		"connections":    ws.stats.Connections,
		"messagesIn":     ws.stats.MessagesIn,
		"messagesOut":    ws.stats.MessagesOut,
		"errors":        ws.stats.Errors,
		"subscriptions":  ws.getSubscriptionCounts(),
	}
}

func (ws *WebSocketService) getSubscriptionCounts() map[string]int {
	ws.subscriptionMgr.mu.RLock()
	defer ws.subscriptionMgr.mu.RUnlock()
	
	counts := make(map[string]int)
	for stream, subs := range ws.subscriptionMgr.subscribers {
		counts[stream] = len(subs)
	}
	
	return counts
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	log.Println("TigerEx WebSocket Service v1.0")
	
	ws := NewWebSocketService()
	
	// Start message processor
	go ws.processMessages()
	
	// Start broadcast scheduler
	go ws.startBroadcastScheduler()
	
	// HTTP handler
	http.HandleFunc("/ws", ws.Handler())
	http.HandleFunc("/ws/v1", ws.Handler())
	
	// Stats endpoint
	http.HandleFunc("/ws/stats", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(ws.GetStats())
	})
	
	log.Println("WebSocket server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

// processMessages processes messages from channel
func (ws *WebSocketService) processMessages() {
	for {
		msg := <-ws.messageChan
		
		ws.subscriptionMgr.Broadcast(msg.Stream, map[string]interface{}{
			"type": msg.Stream,
			"data": msg.Data,
		})
	}
}

var (
	_ = websocket.Upgrader{}
	_ = json.Marshal
	_ = uuid.New
	_ = sync.Mutex{}
)
