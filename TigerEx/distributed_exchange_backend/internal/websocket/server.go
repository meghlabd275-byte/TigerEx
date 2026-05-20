/**
 * TigerEx Go WebSocket Server
 * Real-time market data and trading
 */

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// ============================================================================
// WebSocket Types
// ============================================================================

type WSMessage struct {
	Type    string      `json:"type"`
	Channel string      `json:"channel,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan *WSMessage
	channels map[string]bool
	userID   string
}

type Hub struct {
	channels    map[string]map[*Client]bool
	register    chan *Client
	unregister chan *Client
	broadcast  chan *WSMessage
	mutex      sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		channels:    make(map[string]map[*Client]bool),
		register:    make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *WSMessage, 256),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mutex.Lock()
			for ch := range client.channels {
				if h.channels[ch] == nil {
					h.channels[ch] = make(map[*Client]bool)
				}
				h.channels[ch][client] = true
			}
			h.mutex.Unlock()

		case client := <-h.unregister:
			h.mutex.Lock()
			for ch := range client.channels {
				if clients, ok := h.channels[ch]; ok {
					if _, ok := clients[client]; ok {
						delete(clients, client)
						close(client.send)
					}
				}
			}
			h.mutex.Unlock()

		case message := <-h.broadcast:
			h.mutex.RLock()
			if clients, ok := h.channels[message.Channel]; ok {
				for client := range clients {
					select {
					case client.send <- message:
					default:
						delete(clients, client)
					}
				}
			}
			h.mutex.RUnlock()
		}
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool { return true },
}

func wsHandler(hub *Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Println("upgrade:", err)
			return
		}

		client := &Client{
			hub:      hub,
			conn:     conn,
			send:     make(chan *WSMessage, 256),
			channels: make(map[string]bool),
		}
		hub.register <- client

		go func() {
			defer func() {
				hub.unregister <- client
				conn.Close()
			}()
			for {
				_, message, err := conn.ReadMessage()
				if err != nil {
					break
				}
				var msg WSMessage
				json.Unmarshal(message, &msg)
				if msg.Type == "subscribe" {
					if chs, ok := msg.Data.([]interface{}); ok {
						for _, ch := range chs {
							if chStr, ok := ch.(string); ok {
								client.channels[chStr] = true
							}
						}
					}
				}
			}
		}()

		for {
			select {
			case message, ok := <-client.send:
				if !ok {
					conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				data, _ := json.Marshal(message)
				conn.WriteMessage(websocket.TextMessage, data)
			}
		}
	}
}

func main() {
	hub := NewHub()
	go hub.Run()

	router := gin.Default()
	router.GET("/ws", wsHandler(hub))
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("WebSocket server starting on :8080")
	router.Run(":8080")
}