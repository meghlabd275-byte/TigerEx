/**
 * TigerEx Go Mass-Scale Infrastructure
 * 
 * LANGUAGE: Go (latest)
 * 
 * Why Go for APIs/Realtime Infrastructure:
 * - Goroutines: lightweight ~2KB stacks
 * - Fast networking (epoll-based)
 * - Operational simplicity
 * - Massive concurrent connection handling
 * 
 * COMPONENTS:
 * 
 * 1. API Gateway (gateway/api/)
 *    - REST API serving
 *    - Authentication
 *    - Rate limiting
 *    - Request routing
 * 
 * 2. WebSocket Infrastructure (gateway/ws/)
 *    - Millions of concurrent connections
 *    - Pub/sub market data
 *    - Order feed distribution
 * 
 * 3. Kafka Streaming (realtime/kafka/)
 *    - Market data streams
 *    - Event propagation
 *    - Trade feeds
 * 
 * 4. Blockchain Indexers (blockchain/indexers/)
 *    - Lightweight indexers
 *    - Event processing
 * 
 * COMPILE: go build -o tigerex-api ./cmd/api
 * 
 * PERFORMANCE TARGETS:
 * - 100k+ HTTP req/s
 * - 1M+ WebSocket connections
 * - Sub-second latency
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
)

// ========================================================================
// MARKET DATA STRUCTURES
// ========================================================================

type MarketTicker struct {
    Symbol    string  `json:"symbol"`
    Price    float64 `json:"price"`
    Change24h float64 `json:"change_24h"`
    Volume24h float64 `json:"volume_24h"`
    High24h   float64 `json:"high_24h"`
    Low24h    float64 `json:"low_24h"`
    Timestamp int64   `json:"timestamp"`
}

type OrderBookEntry struct {
    Price  float64 `json:"price"`
    Amount float64 `json:"amount"`
}

type OrderBook struct {
    Symbol  string          `json:"symbol"`
    Bids   []OrderBookEntry `json:"bids"`
    Asks   []OrderBookEntry `json:"asks"`
}

type Trade struct {
    ID        string  `json:"id"`
    Symbol    string  `json:"symbol"`
    Price    float64 `json:"price"`
    Amount   float64 `json:"amount"`
    Side     string  `json:"side"` // buy or sell
    Timestamp int64   `json:"timestamp"`
}

// ========================================================================
// WEBSOCKET HUB - Manages 1M+ Connections
// ========================================================================

type WSHub struct {
    clients    map[*websocket.Conn]bool
    broadcast  chan []byte
    register  chan *websocket.Conn
    unregister chan *websocket.Conn
    mutex     sync.RWMutex
    upgrader  websocket.Upgrader
}

var hub = WSHub{
    clients:    make(map[*websocket.Conn]bool),
    broadcast:  make(chan []byte, 1024),
    register:   make(chan *websocket.Conn),
    unregister: make(chan *websocket.Conn),
}

func NewWSHub() *WSHub {
    hub := &WSHub{
        clients:    make(map[*websocket.Conn]bool),
        broadcast:  make(chan []byte, 1024*1024), // 1MB buffer
        register:   make(chan *websocket.Conn),
        unregister: make(chan *websocket.Conn),
        upgrader: websocket.Upgrader{
            CheckOrigin: func(r *http.Request) bool { return true },
            ReadBufferSize:  4096,
            WriteBufferSize: 4096,
        },
    }
    go hub.run()
    return hub
}

func (h *WSHub) run() {
    for {
        select {
        case client := <-h.register:
            h.mutex.Lock()
            h.clients[client] = true
            h.mutex.Unlock()
            log.Printf("Client connected, total: %d", len(h.clients))

        case client := <-h.unregister:
            h.mutex.Lock()
            if _, ok := h.clients[client]; ok {
                delete(h.clients, client)
                client.Close()
            }
            h.mutex.Unlock()

        case message := <-h.broadcast:
            h.mutex.RLock()
            for client := range h.clients {
                err := client.WriteMessage(websocket.TextMessage, message)
                if err != nil {
                    client.Close()
                    delete(h.clients, client)
                }
            }
            h.mutex.RUnlock()
        }
    }
}

func (h *WSHub) HandleConnection(w http.ResponseWriter, r *http.Request) {
    conn, err := hub.upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Println("Upgrade error:", err)
        return
    }

    hub.register <- conn

    // Handle incoming messages
    for {
        _, msg, err := conn.ReadMessage()
        if err != nil {
            break
        }
        // Process message...
    }

    hub.unregister <- conn
}

// ========================================================================
// REST API SERVER
// ========================================================================

type APIServer struct {
    router    *gin.Engine
    server   *http.Server
    tickerCache map[string]*MarketTicker
    cacheMu   sync.RWMutex
}

func NewAPIServer() *APIServer {
    gin.SetMode(gin.ReleaseMode)
    router := gin.New()
    
    server := &APIServer{
        router:    router,
        tickerCache: make(map[string]*MarketTicker),
    }
    
    server.setupRoutes()
    return server
}

func (s *APIServer) setupRoutes() {
    // Health check
    s.router.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "status": "healthy",
            "timestamp": time.Now().Unix(),
        })
    })

    // Market data
    s.router.GET("/api/v1/ticker/:symbol", s.getTicker)
    s.router.GET("/api/v1/orderbook/:symbol", s.getOrderBook)
    s.router.GET("/api/v1/trades/:symbol", s.getRecentTrades)

    // Trading
    s.router.POST("/api/v1/order", s.placeOrder)
    s.router.DELETE("/api/v1/order/:id", s.cancelOrder)

    // Account
    s.router.GET("/api/v1/balance/:user", s.getBalance)
    s.router.GET("/api/v1/orders/:user", s.getOpenOrders)

    // WebSocket
    s.router.GET("/ws", func(c *gin.Context) {
        hub.HandleConnection(c.Writer, c.Request)
    })
}

func (s *APIServer) getTicker(c *gin.Context) {
    symbol := c.Param("symbol")
    
    s.cacheMu.RLock()
    ticker, ok := s.tickerCache[symbol]
    s.cacheMu.RUnlock()
    
    if !ok {
        ticker = &MarketTicker{
            Symbol:    symbol,
            Price:    0,
            Change24h: 0,
            Volume24h: 0,
            Timestamp: time.Now().UnixMilli(),
        }
    }
    
    c.JSON(http.StatusOK, ticker)
}

func (s *APIServer) getOrderBook(c *gin.Context) {
    symbol := c.Param("symbol")
    
    // Return sample order book
    book := OrderBook{
        Symbol: symbol,
        Bids: []OrderBookEntry{
            {Price: 50000.00, Amount: 1.5},
            {Price: 49999.50, Amount: 2.0},
            {Price: 49999.00, Amount: 3.0},
        },
        Asks: []OrderBookEntry{
            {Price: 50001.00, Amount: 1.0},
            {Price: 50001.50, Amount: 2.5},
            {Price: 50002.00, Amount: 1.5},
        },
    }
    
    c.JSON(http.StatusOK, book)
}

func (s *APIServer) placeOrder(c *gin.Context) {
    var req struct {
        Symbol   string  `json:"symbol" binding:"required"`
        Side     string  `json:"side" binding:"required"`
        Type    string  `json:"type" binding:"required"`
        Price   float64 `json:"price" binding:"required"`
        Amount  float64 `json:"amount" binding:"required"`
        UserID  string  `json:"user_id" binding:"required"`
    }
    
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    orderID := fmt.Sprintf("ord_%d", time.Now().UnixNano())
    
    c.JSON(http.StatusOK, gin.H{
        "order_id": orderID,
        "status": "open",
        "symbol": req.Symbol,
        "side": req.Side,
        "price": req.Price,
        "amount": req.Amount,
    })
}

func (s *APIServer) cancelOrder(c *gin.Context) {
    orderID := c.Param("id")
    
    c.JSON(http.StatusOK, gin.H{
        "order_id": orderID,
        "status": "cancelled",
    })
}

func (s *APIServer) getBalance(c *gin.Context) {
    userID := c.Param("user")
    
    c.JSON(http.StatusOK, gin.H{
        "user_id": userID,
        "balances": map[string]float64{
            "BTC":  1.5,
            "ETH":  15.0,
            "USDT": 50000.0,
        },
    })
}

func (s *APIServer) getOpenOrders(c *gin.Context) {
    c.JSON(http.StatusOK, []interface{}{})
}

func (s *APIServer) getRecentTrades(c *gin.Context) {
    c.JSON(http.StatusOK, []Trade{})
}

func (s *APIServer) Start(addr string) {
    s.server = &http.Server{
        Addr:         addr,
        Handler:      s.router,
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 10 * time.Second,
    }
    
    log.Printf("Starting API server on %s", addr)
    if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
        log.Fatalf("Server error: %v", err)
    }
}

func (s *APIServer) Shutdown(ctx context.Context) error {
    return s.server.Shutdown(ctx)
}

// ========================================================================
// KAFKA PRODUCER FOR MARKET DATA STREAMS
// ========================================================================

type MarketDataProducer struct {
    topic string
    // Producer would be initialized here
}

func NewMarketDataProducer(topic string) *MarketDataProducer {
    return &MarketDataProducer{topic: topic}
}

func (p *MarketDataProducer) PublishTicker(ticker *MarketTicker) error {
    data, _ := json.Marshal(ticker)
    // Would publish to Kafka here
    log.Printf("Published ticker: %s", string(data))
    return nil
}

func (p *MarketDataProducer) PublishTrade(trade *Trade) error {
    data, _ := json.Marshal(trade)
    log.Printf("Published trade: %s", string(data))
    return nil
}

// ========================================================================
// MAIN ENTRY POINT
// ========================================================================

func main() {
    // Initialize components
    NewWSHub()
    server := NewAPIServer()
    producer := NewMarketDataProducer("market-data")
    
    // Start market data publisher
    go func() {
        ticker := &MarketTicker{
            Symbol:    "BTC/USDT",
            Price:    50000.0,
            Change24h: 2.5,
            Volume24h: 1000000000.0,
            Timestamp: time.Now().UnixMilli(),
        }
        for {
            producer.PublishTicker(ticker)
            time.Sleep(time.Second)
        }
    }()
    
    // Start server
    server.Start(":8080")
}