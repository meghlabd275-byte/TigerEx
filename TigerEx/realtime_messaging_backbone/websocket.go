package websocket

import (
    "encoding/json"
    "log"
    "net/http"
    "sync"
    "time"
    
    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        return true
    },
}

type Client struct {
    ID       string
    UserID   string
    Symbol   string
    Conn     *websocket.Conn
    Send     chan []byte
    Hub      *Hub
    LastPing time.Time
}

type Message struct {
    Type    string          `json:"type"`
    Symbol  string          `json:"symbol,omitempty"`
    Data    json.RawMessage `json:"data,omitempty"`
}

type Hub struct {
    clients    map[*Client]bool
    rooms      map[string]map[*Client]bool
    broadcast  chan []byte
    register   chan *Client
    unregister chan *Client
    mu         sync.RWMutex
}

func NewHub() *Hub {
    return &Hub{
        clients:    make(map[*Client]bool),
        rooms:      make(map[string]map[*Client]bool),
        broadcast:  make(chan []byte),
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
            
        case client := <-h.unregister:
            h.mu.Lock()
            if _, ok := h.clients[client]; ok {
                delete(h.clients, client)
                close(client.Send)
            }
            h.mu.Unlock()
            
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

func (h *Hub) Subscribe(client *Client, symbol string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    
    if h.rooms[symbol] == nil {
        h.rooms[symbol] = make(map[*Client]bool)
    }
    h.rooms[symbol][client] = true
    client.Symbol = symbol
}

func (h *Hub) Unsubscribe(client *Client, symbol string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    
    if h.rooms[symbol] != nil {
        delete(h.rooms[symbol], client)
    }
}

func (h *Hub) BroadcastToRoom(symbol string, message []byte) {
    h.mu.RLock()
    defer h.mu.RUnlock()
    
    if room, ok := h.rooms[symbol]; ok {
        for client := range room {
            select {
            case client.Send <- message:
            default:
                close(client.Send)
                delete(h.clients, client)
            }
        }
    }
}

type WebSocketServer struct {
    hub *Hub
}

func NewWebSocketServer() *WebSocketServer {
    hub := NewHub()
    go hub.Run()
    
    return &WebSocketServer{hub: hub}
}

func (s *WebSocketServer) HandleConnections(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("Failed to upgrade connection: %v", err)
        return
    }
    
    client := &Client{
        ID:       generateID(),
        Conn:     conn,
        Send:     make(chan []byte, 256),
        Hub:      s.hub,
        LastPing: time.Now(),
    }
    
    s.hub.register <- client
    
    go s.writePump(client)
    go s.readPump(client)
}

func (s *WebSocketServer) readPump(client *Client) {
    defer func() {
        client.Hub.unregister <- client
        client.Conn.Close()
    }()
    
    client.Conn.SetReadLimit(512 * 1024)
    client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    client.Conn.SetPongHandler(func(string) error {
        client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
        client.LastPing = time.Now()
        return nil
    })
    
    for {
        _, message, err := client.Conn.ReadMessage()
        if err != nil {
            if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
                log.Printf("WebSocket error: %v", err)
            }
            break
        }
        
        var msg Message
        if err := json.Unmarshal(message, &msg); err != nil {
            continue
        }
        
        s.handleMessage(client, &msg)
    }
}

func (s *WebSocketServer) handleMessage(client *Client, msg *Message) {
    switch msg.Type {
    case "subscribe":
        if msg.Symbol != "" {
            client.Hub.Subscribe(client, msg.Symbol)
            s.sendAck(client, "subscribed", msg.Symbol)
        }
        
    case "unsubscribe":
        if msg.Symbol != "" {
            client.Hub.Unsubscribe(client, msg.Symbol)
            s.sendAck(client, "unsubscribed", msg.Symbol)
        }
        
    case "ping":
        client.LastPing = time.Now()
        client.Send <- []byte(`{"type":"pong"}`)
    }
}

func (s *WebSocketServer) writePump(client *Client) {
    ticker := time.NewTicker(54 * time.Second)
    defer func() {
        ticker.Stop()
        client.Conn.Close()
    }()
    
    for {
        select {
        case message, ok := <-client.Send:
            client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
            if !ok {
                client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            
            w, err := client.Conn.NextWriter(websocket.TextMessage)
            if err != nil {
                return
            }
            w.Write(message)
            
            if err := w.Close(); err != nil {
                return
            }
            
        case <-ticker.C:
            client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
            if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
        }
    }
}

func (s *WebSocketServer) sendAck(client *Client, action, symbol string) {
    msg := map[string]string{
        "type":    action,
        "symbol":  symbol,
        "status":  "success",
    }
    data, _ := json.Marshal(msg)
    client.Send <- data
}

func (s *WebSocketServer) BroadcastMarketUpdate(symbol string, data interface{}) {
    msg := map[string]interface{}{
        "type":   "market_update",
        "symbol": symbol,
        "data":   data,
    }
    jsonData, _ := json.Marshal(msg)
    s.hub.BroadcastToRoom(symbol, jsonData)
}

func generateID() string {
    return time.Now().Format("20060102150405") + "-" + randomString(8)
}

func randomString(n int) string {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    b := make([]byte, n)
    for i := range b {
        b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
    }
    return string(b)
}

func StartServer(port string) {
    ws := NewWebSocketServer()
    
    http.HandleFunc("/ws", ws.HandleConnections)
    http.HandleFunc("/ws/markets", ws.HandleConnections)
    
    log.Printf("WebSocket server starting on %s", port)
    if err := http.ListenAndServe(port, nil); err != nil {
        log.Fatal(err)
    }
}