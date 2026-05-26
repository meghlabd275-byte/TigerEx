package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// ============================================================================
// TIGEREX WEBSOCKET SERVICE - GO (2 files)
// Real-time messaging and market data feeds
// ============================================================================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for demo
	},
}

// ============== WEBSOCKET HUB ==============

type WSHub struct {
	// Registered clients
	clients map[*WSClient]bool

	// Inbound messages from clients
	broadcast chan []byte

	// Register requests from clients
	register chan *WSClient

	// Unregister requests from clients
	unregister chan *WSClient

	// Subscribe to symbols
	subscribe chan *Subscription

	// Market data
	marketData map[string]chan []byte
}

type WSClient struct {
	hub  *WSHub
	conn *websocket.Conn
	// Buffered send channel
	send chan []byte

	// Subscribed symbols
	subscriptions map[string]bool
}

type Subscription struct {
	client  *WSClient
	symbols []string
}

func NewWSHub() *WSHub {
	return &WSHub{
		clients:    make(map[*WSClient]bool),
		broadcast:  make(chan []byte, 256),
		register:  make(chan *WSClient),
		unregister: make(chan *WSClient),
		subscribe:  make(chan *Subscription),
		marketData: make(map[string]chan []byte),
	}
}

func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			log.Printf("Client connected: %s", client.conn.RemoteAddr())

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				log.Printf("Client disconnected: %s", client.conn.RemoteAddr())
			}

		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}

		case sub := <-h.subscribe:
			for _, symbol := range sub.symbols {
				sub.client.subscriptions[symbol] = true
			}
		}
	}
}

func (h *WSHub) HandleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	client := &WSHub{
		conn:          conn,
		send:          make(chan []byte, 256),
		subscriptions: make(map[string]bool),
	}

	h.register <- client

	go client.writePump()
	client.readPump()
}

func (c *WSClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.EnableReadCompression(true)

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Error: %v", err)
			}
			break
		}

		// Handle subscription message
		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err == nil {
			if msg["type"] == "subscribe" {
				if symbols, ok := msg["symbols"].([]string); ok {
					c.hub.subscribe <- &Subscription{
						client:  c,
						symbols: symbols,
					}
				}
			}
		}
	}
}

func (c *WSClient) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ============== MARKET DATA FEEDS ==============

type MarketDataFeed struct {
	hub     *WSHub
	prices  map[string]float64
	volumes map[string]float64
}

func NewMarketDataFeed(hub *WSHub) *MarketDataFeed {
	return &MarketDataFeed{
		hub:     hub,
		prices:  make(map[string]float64),
		volumes: make(map[string]float64),
	}
}

func (m *MarketDataFeed) Start() {
	// Initial prices
	defaults := map[string]float64{
		"BTC/USDT": 43250,
		"ETH/USDT": 2650,
		"SOL/USDT": 98.5,
		"BNB/USDT": 312,
		"XRP/USDT": 0.62,
	}

	for symbol, price := range defaults {
		m.prices[symbol] = price
		m.volumes[symbol] = 1000000
	}

	// Simulate price updates
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			m.updatePrices()
		}
	}()
}

func (m *MarketDataFeed) updatePrices() {
	for symbol := range m.prices {
		// Random price movement
		change := (float64(time.Now().UnixNano()%10000) - 5000) / 10000.0
		m.prices[symbol] *= (1 + change/100)

		// Build ticker message
		msg := map[string]interface{}{
			"type": "ticker",
			"symbol": symbol,
			"price": m.prices[symbol],
			"volume": m.volumes[symbol],
			"timestamp": time.Now().Unix(),
		}

		data, _ := json.Marshal(msg)
		m.hub.broadcast <- data
	}
}

func (m *MarketDataFeed) GetTicker(symbol string) map[string]interface{} {
	return map[string]interface{}{
		"symbol":  symbol,
		"price":  m.prices[symbol],
		"volume": m.volumes[symbol],
	}
}

// ============== ORDER BOOK FEED ==============

type OrderBookFeed struct {
	hub   *WSHub
	books map[string]map[string]map[float64]float64
}

func NewOrderBookFeed(hub *WSHub) *OrderBookFeed {
	return &OrderBookFeed{
		hub:   hub,
		books: make(map[string]map[string]map[float64]float64),
	}
}

func (o *OrderBookFeed) GetDepth(symbol string) map[string]interface{} {
	book := map[string]interface{}{
		"symbol": symbol,
		"bids": [][]float64{
			{43000, 5.0},
			{42990, 3.5},
			{42980, 10.0},
		},
		"asks": [][]float64{
			{43100, 2.5},
			{43110, 7.0},
			{43120, 15.0},
		},
	}
	return book
}

// ============== TRADE FEED ==============

type TradeFeed struct {
	hub    *WSHub
	trades []map[string]interface{}
}

func NewTradeFeed(hub *WSHub) *TradeFeed {
	return &TradeFeed{
		hub:    hub,
		trades: make([]map[string]interface{}, 0),
	}
}

func (t *TradeFeed) AddTrade(trade map[string]interface{}) {
	t.trades = append(t.trades, trade)
	if len(t.trades) > 100 {
		t.trades = t.trades[len(t.trades)-100:]
	}
}

func (t *TradeFeed) GetRecentTrades(symbol string, limit int) []map[string]interface{} {
	var result []map[string]interface{}
	count := 0
	for i := len(t.trades) - 1; i >= 0 && count < limit; i-- {
		if t.trades[i]["symbol"] == symbol {
			result = append(result, t.trades[i])
			count++
		}
	}
	return result
}

// ============== HTTP HANDLERS ==============

func SetupWSRoutes(r *gin.Engine, hub *WSHub) {
	// WebSocket endpoint
	r.GET("/ws", func(c *gin.Context) {
		hub.HandleConnection(c.Writer, c.Request)
	})

	// REST endpoints for market data
	api := r.Group("/api/v1/ws")

	api.GET("/ticker/:symbol", func(c *gin.Context) {
		symbol := c.Param("symbol")
		feed := NewMarketDataFeed(hub)
		c.JSON(200, feed.GetTicker(symbol))
	})

	api.GET("/depth/:symbol", func(c *gin.Context) {
		symbol := c.Param("symbol")
		feed := NewOrderBookFeed(hub)
		c.JSON(200, feed.GetDepth(symbol))
	})

	api.GET("/trades/:symbol", func(c *gin.Context) {
		symbol := c.Param("symbol")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		feed := NewTradeFeed(hub)
		c.JSON(200, feed.GetRecentTrades(symbol, limit))
	})

	// Streaming for server-sent events
	api.GET("/stream/:channels", func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")

		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		c.SSEvent("message", map[string]interface{}{
			"timestamp": time.Now().Unix(),
		})

		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
		}
	})
}

// ============== MAIN ==============

func main() {
	r := gin.Default()

	hub := NewWSHub()
	go hub.Run()

	marketFeed := NewMarketDataFeed(hub)
	marketFeed.Start()

	SetupWSRoutes(r, hub)

	log.Println("WebSocket server starting on :8080")
	log.Fatal(r.Run(":8080"))
}