// TigerEx WebSocket API - Real-time Data Streaming
package ws

import (
"context"
"crypto/rand"
"encoding/hex"
"encoding/json"
"fmt"
"log"
"net/http"
"strings"
"sync"
"time"

"github.com/gin-gonic/gin"
"github.com/golang-jwt/jwt/v5"
"github.com/google/uuid"
"github.com/gorilla/websocket"
)

const (
// Time allowed to write a message to the peer
writeWait = 10 * time.Second

// Time allowed to read the next pong message from the peer
pongWait = 60 * time.Second

// Send pings to peer with this period (must be less than pongWait)
pingPeriod = (pongWait * 9) / 10

// Maximum message size allowed from peer
maxMessageSize = 8192

// Maximum buffered messages per connection
maxBufferMessages = 256
)

// WebSocket Server
type Server struct {
hub           *Hub
upgrader      websocket.Upgrader
authRequired bool
jwtSecret    string
}

func NewServer(authRequired bool, jwtSecret string) *Server {
return &Server{
hub:        NewHub(),
upgrader: websocket.Upgrader{
ReadBufferSize:  1024,
WriteBufferSize: 1024,
CheckOrigin: func(r *http.Request) bool {
return true
},
},
authRequired: authRequired,
jwtSecret:   jwtSecret,
}
}

// Hub maintains the set of active clients and broadcasts messages
type Hub struct {
clients    map[*Client]bool
broadcast  chan []byte
register  chan *Client
unregister chan *Client
mutex     sync.RWMutex
}

func NewHub() *Hub {
return &Hub{
clients:    make(map[*Client]bool),
broadcast:  make(chan []byte, 256),
register:  make(chan *Client),
unregister: make(chan *Client),
}
}

func (h *Hub) Run() {
for {
select {
case client := <-h.register:
h.mutex.Lock()
h.clients[client] = true
h.mutex.Unlock()
case client := <-h.unregister:
h.mutex.Lock()
if _, ok := h.clients[client]; ok {
delete(h.clients, client)
close(client.send)
}
h.mutex.Unlock()
case message := <-h.broadcast:
h.mutex.RLock()
for client := range h.clients {
select {
case client.send <- message:
default:
close(client.send)
delete(h.clients, client)
}
}
h.mutex.RUnlock()
}
}
}

// Client is a middleman between the websocket connection and the hub
type Client struct {
hub     *Hub
conn    *websocket.Conn
send    chan []byte
userID  string
streams map[string]bool
}

func (c *Client) readPump() {
defer func() {
c.hub.unregister <- c
c.conn.Close()
}()
c.conn.SetReadLimit(maxMessageSize)
c.conn.SetReadDeadline(time.Now().Add(pongWait))
c.conn.SetPongHandler(func(string) error {
c.conn.SetReadDeadline(time.Now().Add(pongWait))
return nil
})
for {
_, message, err := c.conn.ReadMessage()
if err != nil {
if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
log.Printf("WebSocket error: %v", err)
}
break
}
var msg map[string]interface{}
json.Unmarshal(message, &msg)

// Handle subscription
if method, ok := msg["method"].(string); ok {
switch method {
case "SUBSCRIBE":
if params, ok := msg["params"].([]interface{}); ok {
for _, stream := range params {
if streamName, ok := stream.(string); ok {
c.streams[streamName] = true
}
}
}
case "UNSUBSCRIBE":
if params, ok := msg["params"].([]interface{}); ok {
for _, stream := range params {
if streamName, ok := stream.(string); ok {
delete(c.streams, streamName)
}
}
}
case "Ping":
c.send <- []byte(`{"e":"Pong"}`)
}
}
}
}

func (c *Client) writePump() {
ticker := time.NewTicker(pingPeriod)
defer func() {
ticker.Stop()
c.conn.Close()
}()
for {
select {
case message, ok := <-c.send:
c.conn.SetWriteDeadline(time.Now().Add(writeWait))
if !ok {
c.conn.WriteMessage(websocket.CloseMessage, []byte{})
return
}
w, err := c.conn.NextWriter(websocket.TextMessage)
if err != nil {
return
}
w.Write(message)
if err := w.Close(); err != nil {
return
}
case <-ticker.C:
c.conn.SetWriteDeadline(time.Now().Add(writeWait))
if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
return
}
}
}
}

func (c *Client) Send(msg []byte) {
select {
case c.send <- msg:
default:
log.Printf("client send buffer full")
}
}

// Stream Types
type StreamType string

const (
StreamTicker      StreamType = "@ticker"
StreamKline       StreamType = "@kline"
StreamTrade       StreamType = "@trade"
StreamDepth      StreamType = "@depth"
StreamBookTicker StreamType = "@bookTicker"
StreamAggTrade   StreamType = "@aggTrade"
StreamLiquidation StreamType = "@liquidation"
StreamFunding    StreamType = "@funding"
StreamMarkPrice  StreamType = "@markPrice"
StreamIndexPrice StreamType = "@indexPrice"
)

// Stream Manager
type StreamManager struct {
streams map[string]map[*Client]bool
mutex   sync.RWMutex
}

func NewStreamManager() *StreamManager {
return &StreamManager{
streams: make(map[string]map[*Client]bool),
}
}

func (sm *StreamManager) Subscribe(client *Client, stream string) {
sm.mutex.Lock()
defer sm.mutex.Unlock()
if sm.streams[stream] == nil {
sm.streams[stream] = make(map[*Client]bool)
}
sm.streams[stream][client] = true
}

func (sm *StreamManager) Unsubscribe(client *Client, stream string) {
sm.mutex.Lock()
defer sm.mutex.Unlock()
if sm.streams[stream] != nil {
delete(sm.streams[stream], client)
}
}

func (sm *StreamManager) Broadcast(stream string, data []byte) {
sm.mutex.RLock()
defer sm.mutex.RUnlock()
for client := range sm.streams[stream] {
select {
case client.send <- data:
default:
log.Printf("stream broadcast failed")
}
}
}

// Handlers
func (s *Server) HandleStream() gin.HandlerFunc {
return func(c *gin.Context) {
// Authentication check
if s.authRequired {
token := c.GetHeader("Authorization")
if token == "" {
token = c.Query("api_key")
}
if token == "" {
c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Unauthorized"}})
return
}
token = strings.TrimPrefix(token, "Bearer ")
_, err := jwt.Parse(token, func(token *jwt.Token) (interface{}, error) {
return []byte(s.jwtSecret), nil
})
if err != nil {
c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
return
}
}

conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
if err != nil {
log.Printf("WebSocket upgrade error: %v", err)
return
}

client := &Client{
hub:     s.hub,
conn:   conn,
send:   make(chan []byte, maxBufferMessages),
streams: make(map[string]bool),
}
s.hub.register <- client

go client.writePump()
go client.readPump()
}
}

func (s *Server) HandleSpotStream() gin.HandlerFunc { return s.HandleStream() }
func (s *Server) HandleFuturesStream() gin.HandlerFunc { return s.HandleStream() }
func (s *Server) HandleDeliveryStream() gin.HandlerFunc { return s.HandleStream() }
func (s *Server) HandleOptionsStream() gin.HandlerFunc { return s.HandleStream() }

// Market Data Generators
type MarketDataGenerator struct {
streamManager *StreamManager
stopCh       chan struct{}
}

func NewMarketDataGenerator(sm *StreamManager) *MarketDataGenerator {
return &MarketDataGenerator{
streamManager: sm,
stopCh:     make(chan struct{}),
}
}

func (g *MarketDataGenerator) Start(symbol string) {
ticker := time.NewTicker(time.Second)
defer ticker.Stop()

basePrice := 50000.0
if strings.HasPrefix(symbol, "ETH") {
basePrice = 3000.0
}

for {
select {
case <-ticker.C:
price := basePrice + (rand.Float64()-0.5)*basePrice*0.001
data, _ := json.Marshal(map[string]interface{}{
"e": "24hrTicker",
"s": symbol,
"c": fmt.Sprintf("%.2f", price),
"p": fmt.Sprintf("%.2f", price-basePrice),
"h": fmt.Sprintf("%.2f", basePrice*1.02),
"l": fmt.Sprintf("%.2f", basePrice*0.98),
"v": fmt.Sprintf("%.0f", rand.Float64()*1000000),
})
g.streamManager.Broadcast(symbol+"@"+string(StreamTicker), data)
case <-g.stopCh:
return
}
}
}

func (g *MarketDataGenerator) Stop() {
close(g.stopCh)
}

// Combined Stream Handler
func (s *Server) HandleCombinedStream() gin.HandlerFunc {
return func(c *gin.Context) {
conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
if err != nil {
log.Printf("WebSocket upgrade error: %v", err)
return
}

client := &Client{
hub:     s.hub,
conn:   conn,
send:   make(chan []byte, maxBufferMessages),
streams: make(map[string]bool),
}
s.hub.register <- client

go client.writePump()
go client.readPump()
}
}

// V2/V3/V4/V5 Stream Handlers
func (s *Server) HandleStreamV2() gin.HandlerFunc { return s.HandleStream() }
func (s *Server) HandleStreamV3() gin.HandlerFunc { return s.HandleStream() }
func (s *Server) HandleStreamV4() gin.HandlerFunc { return s.HandleStream() }
func (s *Server) HandleStreamV5() gin.HandlerFunc { return s.HandleCombinedStream() }

// Mini Stream
func (s *Server) HandleMiniStream() gin.HandlerFunc {
return func(c *gin.Context) {
conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
if err != nil {
return
}
client := &Client{hub: s.hub, conn: conn, send: make(chan []byte), streams: make(map[string]bool)}
s.hub.register <- client
go client.writePump()
go client.readPump()
}
}

// FX Stream
func (s *Server) HandleFXStream() gin.HandlerFunc {
return func(c *gin.Context) {
conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
if err != nil {
return
}
client := &Client{hub: s.hub, conn: conn, send: make(chan []byte), streams: make(map[string]bool)}
s.hub.register <- client
go client.writePump()
go client.readPump()
}
}

// NFT Stream
func (s *Server) HandleNFTStream() gin.HandlerFunc {
return func(c *gin.Context) {
conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
if err != nil {
return
}
client := &Client{hub: s.hub, conn: conn, send: make(chan []byte), streams: make(map[string]bool)}
s.hub.register <- client
go client.writePump()
go client.readPump()
}
}

// Helper
func randomHex(n int) string {
b := make([]byte, n)
rand.Read(b)
return hex.EncodeToString(b)
}
