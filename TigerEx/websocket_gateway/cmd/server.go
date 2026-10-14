package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net"
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
		origin := req.Header.Get("Origin"); if origin == "" { return true }
		u, err := url.Parse(origin); if err != nil || u.Hostname() == "" { return false }
		host, _, err := net.SplitHostPort(req.Host); if err != nil { host = req.Host }
		return strings.EqualFold(u.Hostname(), host)
	}}
	conn, err := upgrader.Upgrade(w, r, nil); if err != nil { return }
	client := s.registerClient(r, conn)
	go client.writePump()
	client.readPump()
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
	close(client.Send)
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

func (c *Client) readPump() {
	defer c.owner.unregisterClient(c)
	c.socket.SetReadLimit(1 << 20)
	_ = c.socket.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.socket.SetPongHandler(func(string) error { return c.socket.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		_, data, err := c.socket.ReadMessage(); if err != nil { return }
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