package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"tigerex/websocket_gateway/internal/config"
	"tigerex/websocket_gateway/internal/models"
	"tigerex/websocket_gateway/internal/services"

	"github.com/gorilla/websocket"
)

// ============================================================================
// WEBSOCKET GATEWAY SERVER
// ============================================================================

// Server represents the WebSocket server
type Server struct {
	config      *config.Config
	manager    *services.StreamManager
	clients    map[*Client]bool
	clientID   int64
	mu        sync.RWMutex
}

// Client represents a WebSocket client connection
type Client struct {
	ID        string
	UserID    string
	Streams   map[string]bool
	Send      chan []byte
	manager  *services.StreamManager
	socket   *websocket.Conn
	owner    *Server
	done     chan struct{}
	rateMu sync.Mutex
	rateTokens float64
	rateLast time.Time
}

// NewServer creates a new WebSocket server
func NewServer(cfg *config.Config) *Server {
	return &Server{
		config:   cfg,
		manager: services.NewStreamManager(),
		clients: make(map[*Client]bool),
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	// Load configuration
	cfg := config.LoadConfig()

	// Override with environment variables
	if port := os.Getenv("WS_PORT"); port != "" {
		cfg.Server.Port = port
	}

	log.Printf("Starting TigerEx WebSocket Gateway v1.0.0")
	log.Printf("Server mode: %s", cfg.Server.Mode)
	log.Printf("Listening on port: %s", cfg.Server.Port)

	// Create server
	server := NewServer(cfg)

	// Create HTTP handler
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.handleWebSocket)
	mux.HandleFunc("/stream", server.handleStream)
	mux.HandleFunc("/health", server.handleHealth)

	// Start server
	go func() {
		log.Printf("WebSocket server started on :%s", cfg.Server.Port)
		if err := http.ListenAndServe(":"+cfg.Server.Port, mux); err != nil {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	log.Println("Server exited")
}

// ============================================================================
// HANDLERS
// ============================================================================

// handleWebSocket handles WebSocket connections
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet { http.Error(w, "method not allowed", http.StatusMethodNotAllowed); return }
	s.mu.RLock()
	atCapacity := s.config.Server.MaxConnections > 0 && len(s.clients) >= s.config.Server.MaxConnections
	s.mu.RUnlock()
	if atCapacity { http.Error(w, "connection capacity reached", http.StatusServiceUnavailable); return }
	upgrader := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(req *http.Request) bool {
		return isAllowedOrigin(req, req.Header.Get("Origin"))
	}}
	conn, err := upgrader.Upgrade(w, r, nil); if err != nil { return }
	client := s.registerClient(r, conn)
	go client.writePump()
	client.readPump()
}

// isAllowedOrigin enforces exact same-origin checks, or an explicit comma-separated
// WS_ALLOWED_ORIGINS allowlist when TLS terminates at a trusted reverse proxy.
func isAllowedOrigin(req *http.Request, origin string) bool {
	if origin == "" { return true } // Non-browser clients may omit Origin; authenticate private streams separately.
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return false
	}
	if req.TLS != nil && strings.EqualFold(u.Scheme, "https") && strings.EqualFold(u.Host, req.Host) {
		return true
	}
	if req.TLS == nil && strings.EqualFold(u.Scheme, "http") && strings.EqualFold(u.Host, req.Host) {
		return true
	}
	for _, configured := range strings.Split(os.Getenv("WS_ALLOWED_ORIGINS"), ",") {
		if configured = strings.TrimSpace(configured); configured != "" && strings.EqualFold(configured, origin) {
			return true
		}
	}
	return false
}

// registerClient registers a new client
func (s *Server) registerClient(r *http.Request, conn *websocket.Conn) *Client {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.clientID++
	clientID := fmt.Sprintf("client_%d", s.clientID)

	client := &Client{
		ID:      clientID,
		UserID:  "", // Never trust a client-supplied userId for private event routing.
		Streams: make(map[string]bool),
		Send:    make(chan []byte, 256),
		done:    make(chan struct{}),
		rateTokens: float64(s.config.RateLimit.BurstSize),
		rateLast: time.Now(),
		manager: s.manager,
		socket: conn,
		owner: s,
}

	s.clients[client] = true
	s.manager.RegisterClient(&models.Client{
		ID:       clientID,
		UserID:   client.UserID,
		Streams: client.Streams,
		Send:    client.Send,
	})

	log.Printf("Client connected: %s (user: %s)", clientID, client.UserID)

	return client
}

// unregisterClient unregisters a client
func (s *Server) unregisterClient(client *Client) {
	s.mu.Lock()
	if _, ok := s.clients[client]; !ok { s.mu.Unlock(); return }
	delete(s.clients, client)
	s.mu.Unlock()
	s.manager.UnregisterClient(&models.Client{ID: client.ID, UserID: client.UserID})
	close(client.done)
	_ = client.socket.Close()
	log.Printf("Client disconnected: %s", client.ID)
}

// handleStream handles stream requests
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	streams := s.manager.GetStreams()
	var streamNames []string
	for _, stream := range streams {
		streamNames = append(streamNames, stream.Name)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"streams": streamNames,
	})
}

// handleHealth handles health check
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "healthy",
		"service":       "websocket-gateway",
		"version":      "1.0.0",
		"clients":      s.manager.GetClientCount(),
		"stream_count": len(s.manager.GetStreams()),
	})
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

// handleMessage handles incoming messages
func (c *Client) handleMessage(data []byte) error {
	// Parse message
	var msg models.WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return err
	}

	switch msg.Type {
	case "subscribe":
		return c.handleSubscribe(msg)
	case "unsubscribe":
		return c.handleUnsubscribe(msg)
	case "ping":
		return c.handlePing(msg)
	default:
		return fmt.Errorf("unknown message type: %s", msg.Type)
	}
}

// handleSubscribe handles subscription
func (c *Client) handleSubscribe(msg models.WSMessage) error {
	streams, err := parseStreamParams(msg.Params)
	if err != nil {
		return err
	}

	return c.manager.Subscribe(&models.Client{
		ID:      c.ID,
		UserID:  c.UserID,
		Streams: c.Streams,
		Send: c.Send,
	}, streams)
}

// handleUnsubscribe handles unsubscription
func (c *Client) handleUnsubscribe(msg models.WSMessage) error {
	streams, err := parseStreamParams(msg.Params)
	if err != nil {
		return err
	}

	return c.manager.Unsubscribe(&models.Client{
		ID:      c.ID,
		UserID:  c.UserID,
		Streams: c.Streams,
	}, streams)
}

// parseStreamParams accepts JSON-decoded arrays while rejecting malformed or
// empty subscription names instead of silently ignoring invalid entries.
func parseStreamParams(value interface{}) ([]string, error) {
	var raw []interface{}
	switch params := value.(type) {
	case []string:
		streams := make([]string, 0, len(params))
		for _, stream := range params {
			stream = strings.TrimSpace(stream)
			if stream == "" || !strings.Contains(stream, "@") {
				return nil, fmt.Errorf("invalid stream name")
			}
			streams = append(streams, stream)
		}
		return streams, nil
	case []interface{}:
		raw = params
	default:
		return nil, fmt.Errorf("invalid params: expected array of stream names")
	}
	streams := make([]string, 0, len(raw))
	for _, item := range raw {
		stream, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("invalid params: stream names must be strings")
		}
		stream = strings.TrimSpace(stream)
		if stream == "" || !strings.Contains(stream, "@") {
			return nil, fmt.Errorf("invalid stream name")
		}
		streams = append(streams, stream)
	}
	return streams, nil
}

// handlePing handles ping
func (c *Client) handlePing(msg models.WSMessage) error {
	response := models.NewWSMessage("pong")
	response.ID = msg.ID
	data, err := response.ToJSON()
	if err != nil { return err }
	select { case c.Send <- data: return nil; default: return fmt.Errorf("outbound queue is full") }
}

// allowMessage applies a per-connection token bucket before parsing or routing client input.
func (c *Client) allowMessage(now time.Time) bool {
	rate := c.owner.config.RateLimit.MessagesPerSecond
	burst := c.owner.config.RateLimit.BurstSize
	if rate <= 0 || burst <= 0 { return false }
	c.rateMu.Lock()
	defer c.rateMu.Unlock()
	if c.rateLast.IsZero() { c.rateLast = now; c.rateTokens = float64(burst) }
	if now.Before(c.rateLast) { now = c.rateLast }
	elapsed := now.Sub(c.rateLast).Seconds()
	c.rateTokens += elapsed * float64(rate)
	if c.rateTokens > float64(burst) { c.rateTokens = float64(burst) }
	c.rateLast = now
	if c.rateTokens < 1 { return false }
	c.rateTokens--
	return true
}
func (c *Client) readPump() {
	defer c.owner.unregisterClient(c)
	c.socket.SetReadLimit(1 << 20)
	_ = c.socket.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.socket.SetPongHandler(func(string) error { return c.socket.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		_, data, err := c.socket.ReadMessage(); if err != nil { return }
		if !c.allowMessage(time.Now()) {
			var request models.WSMessage; _ = json.Unmarshal(data, &request)
			payload, marshalErr := models.NewWSError(request.ID, 429, "message rate limit exceeded").ToJSON(); if marshalErr != nil { return }
			select { case c.Send <- payload: continue; default: return }
		}
		if err := c.handleMessage(data); err != nil {
			var request models.WSMessage; _ = json.Unmarshal(data, &request)
			payload, marshalErr := models.NewWSError(request.ID, 400, err.Error()).ToJSON(); if marshalErr != nil { return }
			select { case c.Send <- payload: default: return }
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second); defer ticker.Stop()
	for {
		select {
		case <-c.done:
			_ = c.socket.WriteMessage(websocket.CloseMessage, []byte{})
			return
		case message, ok := <-c.Send:
			_ = c.socket.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if !ok { _ = c.socket.WriteMessage(websocket.CloseMessage, []byte{}); return }
			if err := c.socket.WriteMessage(websocket.TextMessage, message); err != nil { c.owner.unregisterClient(c); return }
		case <-ticker.C:
			_ = c.socket.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.socket.WriteMessage(websocket.PingMessage, nil); err != nil { c.owner.unregisterClient(c); return }
		}
	}
}

// ============================================================================
// WEBSOCKET HELPERS
// ============================================================================

func getRemoteAddr(r *http.Request) string {
	// Check X-Forwarded-For
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.Split(xff, ",")[0]
	}
	return r.RemoteAddr
}

// ============================================================================
// CONSTANTS
// ============================================================================

const (
	// Version is the API version
	Version = "1.0.0"
)

// ============================================================================
// CONTEXT
// ============================================================================


var (
	ErrNotAuthenticated = errors.New("not authenticated")
	ErrInvalidStream   = errors.New("invalid stream")
	ErrRateLimited     = errors.New("rate limited")
)