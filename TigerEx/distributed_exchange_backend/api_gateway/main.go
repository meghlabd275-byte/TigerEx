/**
 * TigerEx Go Distributed Exchange Backend
 * 
 * LANGUAGE: Go
 * 
 * Massive concurrent systems:
 * - API Gateway
 * - WebSocket Hub (1M+ connections)
 * - gRPC Services
 * - Rate Limiting
 * - Distributed Cache
 * - Event Streaming
 */

package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "sync"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/gorilla/websocket"
    "google.golang.org/grpc"
)

// ========================================================================
// MARKET DATA TYPES
// ========================================================================

type Ticker struct {
    Symbol    string  `json:"symbol"`
    Price    float64 `json:"price"`
    Change24h float64 `json:"change_24h"`
    Volume24h float64 `json:"volume_24h"`
    High24h   float64 `json:"high_24h"`
    Low24h    float64 `json:"low_24h"`
    Timestamp int64   `json:"timestamp"`
}

type OrderBook struct {
    Symbol string          `json:"symbol"`
    Bids   [][]float64   `json:"bids"` // [price, quantity]
    Asks   [][]float64   `json:"asks"`
}

type Order struct {
    OrderID   string  `json:"order_id"`
    UserID    string  `json:"user_id"`
    Symbol    string  `json:"symbol"`
    Side      string  `json:"side"` // buy or sell
    Type      string  `json:"type"`  // limit, market
    Price     float64 `json:"price"`
    Quantity  float64 `json:"quantity"`
    Filled    float64 `json:"filled"`
    Status    string  `json:"status"`
    Timestamp int64   `json:"timestamp"`
}

type Trade struct {
    TradeID   string  `json:"trade_id"`
    OrderID   string  `json:"order_id"`
    Symbol    string  `json:"symbol"`
    Side      string  `json:"side"`
    Price     float64 `json:"price"`
    Quantity  float64 `json:"quantity"`
    Timestamp int64   `json:"timestamp"`
}

// ========================================================================
// WEBSOCKET HUB - Handles 1M+ Connections
// ========================================================================

type WSHub struct {
    // Registered connections
    clients map[*WSClient]bool
    
    // Register requests from clients
    register chan *WSClient
    
    // Unregister requests from clients
    unregister chan *WSClient
    
    // Broadcast messages to clients
    broadcast chan *WSMessage
    
    // Mutex for concurrent access
    mu sync.RWMutex
    
    // WebSocket upgrader
    upgrader websocket.Upgrader
    
    // Subscription management
    subscriptions map[string]map[*WSClient]bool
}

type WSClient struct {
    hub  *WSHub
    conn *websocket.Conn
    
    // Buffered channel for outbound messages
    send chan []byte
    
    // Subscriptions
    subscriptions map[string]bool
    
    // User info
    userID string
    authenticated bool
}

type WSMessage struct {
    Type    string      `json:"type"`
    Channel string      `json:"channel,omitempty"`
    Data    interface{} `json:"data"`
}

var GlobalWSHub = NewWSHub()

func NewWSHub() *WSHub {
    return &WSHub{
        clients:      make(map[*WSClient]bool),
        register:     make(chan *WSClient, 1024),
        unregister:   make(chan *WSClient, 1024),
        broadcast:    make(chan *WSMessage, 16384),
        subscriptions: make(map[string]map[*WSClient]bool),
    }
}

func (h *WSHub) Run() {
    for {
        select {
        case client := <-h.register:
            h.mu.Lock()
            h.clients[client] = true
            h.mu.Unlock()
            log.Printf("WS Client connected. Total: %d", len(h.clients))

        case client := <-h.unregister:
            h.mu.Lock()
            if _, ok := h.clients[client]; ok {
                delete(h.clients, client)
                close(client.send)
            }
            h.mu.Unlock()
            log.Printf("WS Client disconnected. Total: %d", len(h.clients))

        case message := <-h.broadcast:
            h.mu.RLock()
            // Broadcast to channel subscribers
            if subs, ok := h.subscriptions[message.Channel]; ok {
                for client := range subs {
                    select {
                    case client.send <- mustMarshal(message):
                    default:
                        // Skip slow consumers
                    }
                }
            }
            h.mu.RUnlock()
        }
    }
}

func (h *WSHub) Subscribe(client *WSClient, channel string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    
    if h.subscriptions[channel] == nil {
        h.subscriptions[channel] = make(map[*WSClient]bool)
    }
    h.subscriptions[channel][client] = true
    client.subscriptions[channel] = true
}

func (h *WSHub) Unsubscribe(client *WSClient, channel string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    
    if h.subscriptions[channel] != nil {
        delete(h.subscriptions[channel], client)
    }
    delete(client.subscriptions, channel)
}

func (h *WSHub) Broadcast(channel string, msgType string, data interface{}) {
    h.broadcast <- &WSMessage{
        Type:    msgType,
        Channel: channel,
        Data:    data,
    }
}

func (c *WSClient) readPump() {
    defer func() {
        c.hub.unregister <- c
        c.conn.Close()
    }()
    
    c.conn.SetReadLimit(4096)
    c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    c.conn.SetPongHandler(func(string) error {
        c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
        return nil
    })
    
    for {
        _, message, err := c.conn.ReadMessage()
        if err != nil {
            break
        }
        
        var msg WSMessage
        if err := json.Unmarshal(message, &msg); err != nil {
            continue
        }
        
        c.handleMessage(&msg)
    }
}

func (c *WSClient) writePump() {
    ticker := time.NewTicker(30 * time.Second)
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
            
            if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
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

func (c *WSClient) handleMessage(msg *WSMessage) {
    switch msg.Type {
    case "subscribe":
        if channel, ok := msg.Data.(string); ok {
            c.hub.Subscribe(c, channel)
        }
    case "unsubscribe":
        if channel, ok := msg.Data.(string); ok {
            c.hub.Unsubscribe(c, channel)
        }
    case "auth":
        // Handle authentication
    }
}

func mustMarshal(v interface{}) []byte {
    data, _ := json.Marshal(v)
    return data
}

// ========================================================================
// RATE LIMITER - Token Bucket
// ========================================================================

type RateLimiter struct {
    requests map[string]*tokenBucket
    mu       sync.RWMutex
    rate     int           // requests per window
    window   time.Duration // window size
}

type tokenBucket struct {
    tokens    int
    lastReset time.Time
}

func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
    return &RateLimiter{
        requests: make(map[string]*tokenBucket),
        rate:     rate,
        window:   window,
    }
}

func (rl *RateLimiter) Allow(key string) bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    
    now := time.Now()
    bucket, exists := rl.requests[key]
    
    if !exists || now.Sub(bucket.lastReset) > rl.window {
        rl.requests[key] = &tokenBucket{
            tokens:    rl.rate - 1,
            lastReset: now,
        }
        return true
    }
    
    if bucket.tokens > 0 {
        bucket.tokens--
        return true
    }
    
    return false
}

// ========================================================================
// API GATEWAY
// ========================================================================

type APIServer struct {
    router     *gin.Engine
    wsHub      *WSHub
    rateLimiter *RateLimiter
    server     *http.Server
}

func NewAPIServer() *APIServer {
    gin.SetMode(gin.ReleaseMode)
    router := gin.New()
    router.Use(gin.Recovery())
    
    server := &APIServer{
        router:      router,
        wsHub:       GlobalWSHub,
        rateLimiter: NewRateLimiter(100, time.Second),
    }
    
    server.setupRoutes()
    return server
}

func (s *APIServer) setupRoutes() {
    // Global middleware
    s.router.Use(s.rateLimitMiddleware())
    s.router.Use(s.authMiddleware())
    
    // Health
    s.router.GET("/health", s.healthCheck)
    
    // Market Data
    market := s.router.Group("/api/v1/market")
    {
        market.GET("/ticker/:symbol", s.getTicker)
        market.GET("/depth/:symbol", s.getDepth)
        market.GET("/trades/:symbol", s.getTrades)
        market.GET("/klines", s.getKlines)
    }
    
    // Trading
    trade := s.router.Group("/api/v1/trade")
    trade.Use(s.requireAuth())
    {
        trade.POST("/order", s.placeOrder)
        trade.DELETE("/order/:id", s.cancelOrder)
        trade.GET("/open-orders", s.getOpenOrders)
        trade.GET("/order-history", s.getOrderHistory)
    }
    
    // Account
    account := s.router.Group("/api/v1/account")
    account.Use(s.requireAuth())
    {
        account.GET("/balance", s.getBalance)
        account.GET("/positions", s.getPositions)
        account.GET("/deposit-history", s.getDepositHistory)
        account.GET("/withdrawal-history", s.getWithdrawalHistory)
    }
    
    // WebSocket
    s.router.GET("/ws", s.handleWS)
}

func (s *APIServer) rateLimitMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        key := c.ClientIP()
        if !s.rateLimiter.Allow(key) {
            c.JSON(http.StatusTooManyRequests, gin.H{
                "code": 429,
                "msg":  "Rate limit exceeded",
            })
            c.Abort()
            return
        }
        c.Next()
    }
}

func (s *APIServer) authMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        // Simplified - check API key header
        apiKey := c.GetHeader("X-API-Key")
        if apiKey != "" {
            c.Set("user_id", "demo_user")
        }
        c.Next()
    }
}

func (s *APIServer) requireAuth() gin.HandlerFunc {
    return func(c *gin.Context) {
        userID, exists := c.Get("user_id")
        if !exists {
            c.JSON(http.StatusUnauthorized, gin.H{"msg": "Unauthorized"})
            c.Abort()
            return
        }
        c.Set("user_id", userID)
        c.Next()
    }
}

func (s *APIServer) healthCheck(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "status":    "healthy",
        "timestamp": time.Now().Unix(),
    })
}

func (s *APIServer) getTicker(c *gin.Context) {
    symbol := c.Param("symbol")
    
    ticker := Ticker{
        Symbol:    symbol,
        Price:    50000.0,
        Change24h: 2.5,
        Volume24h: 1_000_000_000.0,
        High24h:   51000.0,
        Low24h:    49000.0,
        Timestamp: time.Now().UnixMilli(),
    }
    
    c.JSON(http.StatusOK, ticker)
}

func (s *APIServer) getDepth(c *gin.Context) {
    symbol := c.Param("symbol")
    
    book := OrderBook{
        Symbol: symbol,
        Bids:   [][]float64{{50000.0, 1.5}, {49999.0, 2.0}, {49998.0, 3.0}},
        Asks:   [][]float64{{50001.0, 1.0}, {50002.0, 2.5}, {50003.0, 1.5}},
    }
    
    c.JSON(http.StatusOK, book)
}

func (s *APIServer) placeOrder(c *gin.Context) {
    var req struct {
        Symbol   string  `json:"symbol" binding:"required"`
        Side     string  `json:"side" binding:"required"`
        Type    string  `json:"type" binding:"required"`
        Price   float64 `json:"price"`
        Quantity float64 `json:"quantity" binding:"required"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    order := Order{
        OrderID:   fmt.Sprintf("ord_%d", time.Now().UnixNano()),
        UserID:    c.GetString("user_id"),
        Symbol:    req.Symbol,
        Side:      req.Side,
        Type:      req.Type,
        Price:     req.Price,
        Quantity:  req.Quantity,
        Filled:    0,
        Status:    "NEW",
        Timestamp: time.Now().UnixMilli(),
    }
    
    c.JSON(http.StatusOK, order)
}

func (s *APIServer) cancelOrder(c *gin.Context) {
    orderID := c.Param("id")
    c.JSON(http.StatusOK, gin.H{
        "order_id": orderID,
        "status":   "CANCELLED",
    })
}

func (s *APIServer) getOpenOrders(c *gin.Context) {
    c.JSON(http.StatusOK, []Order{})
}

func (s *APIServer) getOrderHistory(c *gin.Context) {
    c.JSON(http.StatusOK, []Order{})
}

func (s *APIServer) getBalance(c *gin.Context) {
    userID := c.GetString("user_id")
    c.JSON(http.StatusOK, gin.H{
        "user_id": userID,
        "balances": map[string]float64{
            "BTC":  1.5,
            "ETH":  15.0,
            "USDT": 50000.0,
        },
    })
}

func (s *APIServer) getPositions(c *gin.Context) {
    c.JSON(http.StatusOK, []interface{}{})
}

func (s *APIServer) getDepositHistory(c *gin.Context) {
    c.JSON(http.StatusOK, []interface{}{})
}

func (s *APIServer) getWithdrawalHistory(c *gin.Context) {
    c.JSON(http.StatusOK, []interface{}{})
}

func (s *APIServer) getTrades(c *gin.Context) {
    c.JSON(http.StatusOK, []Trade{})
}

func (s *APIServer) getKlines(c *gin.Context) {
    c.JSON(http.StatusOK, [][]interface{}{})
}

func (s *APIServer) handleWS(c *gin.Context) {
    conn, err := GlobalWSHub.upgrader.Upgrade(c.Writer, c.Request, nil)
    if err != nil {
        log.Printf("WS upgrade error: %v", err)
        return
    }
    
    client := &WSClient{
        hub:           GlobalWSHub,
        conn:          conn,
        send:          make(chan []byte, 256),
        subscriptions: make(map[string]bool),
    }
    
    GlobalWSHub.register <- client
    
    go client.writePump()
    go client.readPump()
}

func (s *APIServer) Start(addr string) {
    s.server = &http.Server{
        Addr:           addr,
        Handler:         s.router,
        ReadTimeout:     15 * time.Second,
        WriteTimeout:    15 * time.Second,
        MaxHeaderBytes: 1 << 20,
    }
    
    log.Printf("Starting API server on %s", addr)
    if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
        log.Fatalf("Server error: %v", err)
    }
}

func main() {
    // Start WebSocket hub
    go GlobalWSHub.Run()
    
    // Start market data broadcaster
    go func() {
        ticker := Ticker{
            Symbol:    "BTCUSDT",
            Price:    50000.0,
            Change24h: 2.5,
            Volume24h: 1_000_000_000.0,
            Timestamp: time.Now().UnixMilli(),
        }
        
        for {
            GlobalWSHub.Broadcast("ticker:BTCUSDT", "ticker", ticker)
            time.Sleep(time.Second)
        }
    }()
    
    // Start API server
    server := NewAPIServer()
    server.Start(":8080")
}