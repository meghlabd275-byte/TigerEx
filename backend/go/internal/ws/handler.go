// Package ws provides WebSocket handling for real-time trading
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return false
		}
		allowed := strings.Split(os.Getenv("TIGEREX_CORS_ORIGINS"), ",")
		for _, candidate := range allowed {
			if strings.TrimSpace(candidate) != "" && strings.TrimSpace(candidate) != "*" && origin == strings.TrimSpace(candidate) {
				return true
			}
		}
		return false
	},
}

const (
	MsgSubscribe   = "subscribe"
	MsgUnsubscribe = "unsubscribe"
	MsgPing       = "ping"
	MsgAuth       = "auth"
	MsgTicker     = "ticker"
	MsgTrade      = "trade"
	MsgOrderBook  = "orderbook"
	MsgKLine      = "kline"
	MsgOrder      = "order"
	MsgTradeExec  = "trade_exec"
	MsgBalance    = "balance"
	MsgPong       = "pong"
	MsgError      = "error"
)

type Channel struct {
	Symbol    string
	Name      string
	Timestamp int64
}

type Client struct {
	ID        string
	UserID    string
	Conn     *websocket.Conn
	Send     chan []byte
	Channels map[string]*Channel
	Mu       sync.RWMutex
	Authed   bool
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("Client connected: %s", client.ID)
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("Client disconnected: %s", client.ID)
		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) BroadcastToSymbol(symbol string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		client.Mu.RLock()
		for _, ch := range client.Channels {
			if ch.Name == symbol || ch.Symbol == symbol {
				select {
				case client.Send <- message:
				default:
				}
				break
			}
		}
		client.Mu.RUnlock()
	}
}

func HandleWebSocket(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade error: %v", err)
			return
		}
		client := &Client{
			ID:        uuid.New().String(),
			Conn:     conn,
			Send:     make(chan []byte, 256),
			Channels: make(map[string]*Channel),
		}
		hub.register <- client
		go client.writePump()
		go client.readPump(hub)
	}
}

func (c *Client) readPump(hub *Hub) {
	defer func() {
		hub.unregister <- c
		c.Conn.Close()
	}()
	c.Conn.SetReadLimit(512 * 1024)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
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
		c.handleMessage(message, hub)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(data []byte, hub *Hub) {
	var msg map[string]interface{}
	if err := json.Unmarshal(data, &msg); err != nil {
		c.sendError("Invalid message format")
		return
	}
	msgType, ok := msg["type"].(string)
	if !ok {
		c.sendError("Missing message type")
		return
	}
	switch msgType {
	case MsgAuth:
		c.handleAuth(msg)
	case MsgSubscribe:
		c.handleSubscribe(msg)
	case MsgUnsubscribe:
		c.handleUnsubscribe(msg)
	case MsgPing:
		c.sendPong()
	default:
		c.sendError(fmt.Sprintf("Unknown message type: %s", msgType))
	}
}

func (c *Client) handleAuth(msg map[string]interface{}) {
	rawToken, ok := msg["token"].(string)
	if !ok || strings.TrimSpace(rawToken) == "" {
		c.sendError("Missing auth token")
		return
	}
	secret := os.Getenv("TIGEREX_JWT_SECRET")
	if len(secret) < 32 {
		c.sendError("Authentication service is not configured")
		return
	}
	token, err := jwt.Parse(rawToken, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected JWT signing method")
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil || token == nil || !token.Valid {
		c.sendError("Invalid auth token")
		return
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.sendError("Invalid auth token claims")
		return
	}
	userID, ok := claims["user_id"].(string)
	if !ok || strings.TrimSpace(userID) == "" || claims["type"] == "refresh" {
		c.sendError("Invalid auth token claims")
		return
	}
	c.UserID = userID
	c.Authed = true
	c.sendMessage(map[string]interface{}{"type": "auth", "status": "success"})
}

func (c *Client) handleSubscribe(msg map[string]interface{}) {
	channels, ok := msg["channels"].([]interface{})
	if !ok || len(channels) == 0 {
		c.sendError("Missing channels")
		return
	}
	c.Mu.Lock()
	defer c.Mu.Unlock()
	for _, ch := range channels {
		channel, ok := ch.(string)
		if !ok {
			continue
		}
		var name, symbol string
		fmt.Sscanf(channel, "%[^@]@%s", &name, &symbol)
		c.Channels[channel] = &Channel{Name: name, Symbol: symbol, Timestamp: time.Now().Unix()}
	}
	c.sendMessage(map[string]interface{}{"type": "subscribe", "status": "success", "channels": channels})
}

func (c *Client) handleUnsubscribe(msg map[string]interface{}) {
	channels, ok := msg["channels"].([]interface{})
	if !ok || len(channels) == 0 {
		c.sendError("Missing channels")
		return
	}
	c.Mu.Lock()
	defer c.Mu.Unlock()
	for _, ch := range channels {
		channel, ok := ch.(string)
		if !ok {
			continue
		}
		delete(c.Channels, channel)
	}
	c.sendMessage(map[string]interface{}{"type": "unsubscribe", "status": "success", "channels": channels})
}

func (c *Client) sendMessage(msg map[string]interface{}) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.Send <- data:
	default:
	}
}

func (c *Client) sendError(errMsg string) {
	c.sendMessage(map[string]interface{}{"type": MsgError, "error": errMsg})
}

func (c *Client) sendPong() {
	c.sendMessage(map[string]interface{}{"type": MsgPong})
}

type MarketDataProvider struct {
	hub *Hub
}

func NewMarketDataProvider(hub *Hub) *MarketDataProvider {
	return &MarketDataProvider{hub: hub}
}

func (p *MarketDataProvider) BroadcastTicker(symbol string, ticker interface{}) {
	data, _ := json.Marshal(map[string]interface{}{"type": MsgTicker, "symbol": symbol, "data": ticker})
	p.hub.BroadcastToSymbol(symbol, data)
}

func (p *MarketDataProvider) BroadcastTrade(symbol string, trade interface{}) {
	data, _ := json.Marshal(map[string]interface{}{"type": MsgTrade, "symbol": symbol, "data": trade})
	p.hub.BroadcastToSymbol(symbol, data)
}

// StartDataFeeds intentionally does not synthesize prices or trades. A real feed
// adapter must call MarketDataProvider with validated exchange/chain data before
// market data is broadcast. Until then this function remains idle and cancellable.
func StartDataFeeds(ctx context.Context, hub *Hub) {
	_ = hub
	<-ctx.Done()
}