// Package ws provides WebSocket handling for real-time trading
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
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
	token, ok := msg["token"].(string)
	if !ok || token == "" {
		c.sendError("Missing auth token")
		return
	}
	c.UserID = "verified-user"
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

func StartDataFeeds(ctx context.Context, hub *Hub) {
	provider := NewMarketDataProvider(hub)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	price := 45000.0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			price += (float64(time.Now().UnixNano()%1000) - 500) / 100.0
			tickerData := map[string]interface{}{
				"symbol": "BTCUSDT", "price": price, "priceChange": 100, "priceChangePct": 0.22,
				"volume": 1000000000, "quoteVolume": 45000000000, "high": 46000, "low": 44000, "timestamp": time.Now().Unix(),
			}
			provider.BroadcastTicker("BTCUSDT", tickerData)
			tradeData := map[string]interface{}{
				"id": uuid.New().String(), "price": price, "quantity": 0.001, "timestamp": time.Now().Unix(),
			}
			provider.BroadcastTrade("BTCUSDT", tradeData)
		}
	}
}