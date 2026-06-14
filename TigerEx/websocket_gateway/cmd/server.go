package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"tigerEx/websocket_gateway/internal/config"
	"tigerEx/websocket_gateway/internal/models"
	"tigerEx/websocket_gateway/internal/services"
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
	// Upgrade to WebSocket
	// In production, use gorilla/websocket or nhooyr.io/websocket
	
	// For now, handle as regular HTTP with upgrade
	if r.Header.Get("Upgrade") == "" {
		// Return WebSocket connection info
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ready",
			"info":  "WebSocket endpoint ready for connections",
		})
		return
	}

	client := s.registerClient(r)

	// Handle client in production
	// - Read messages
	// - Write messages
	// - Heartbeat

	for {
		select {
		case <-r.Context().Done():
			s.unregisterClient(client)
			return
		}
	}
}

// registerClient registers a new client
func (s *Server) registerClient(r *http.Request) *Client {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.clientID++
	clientID := fmt.Sprintf("client_%d", s.clientID)

	client := &Client{
		ID:      clientID,
		UserID:  r.URL.Query().Get("userId"),
		Streams: make(map[string]bool),
		Send:    make(chan []byte, 256),
		manager: s.manager,
	}

	s.clients[client] = true
	s.manager.RegisterClient(&models.Client{
		ID:       clientID,
		UserID:   client.UserID,
		Streams: client.Streams,
	})

	log.Printf("Client connected: %s (user: %s)", clientID, client.UserID)

	return client
}

// unregisterClient unregisters a client
func (s *Server) unregisterClient(client *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.clients, client)
	s.manager.UnregisterClient(&models.Client{
		ID:     client.ID,
		UserID: client.UserID,
	})

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
	params, ok := msg.Params.([]string)
	if !ok {
		return fmt.Errorf("invalid params")
	}

	streams := make([]string, 0)
	for _, stream := range params {
		// Validate stream format
		if strings.Contains(stream, "@") {
			streams = append(streams, stream)
		}
	}

	return c.manager.Subscribe(&models.Client{
		ID:      c.ID,
		UserID:  c.UserID,
		Streams: c.Streams,
	}, streams)
}

// handleUnsubscribe handles unsubscription
func (c *Client) handleUnsubscribe(msg models.WSMessage) error {
	params, ok := msg.Params.([]string)
	if !ok {
		return fmt.Errorf("invalid params")
	}

	streams := make([]string, 0)
	for _, stream := range params {
		streams = append(streams, stream)
	}

	return c.manager.Unsubscribe(&models.Client{
		ID:      c.ID,
		UserID:  c.UserID,
		Streams: c.Streams,
	}, streams)
}

// handlePing handles ping
func (c *Client) handlePing(msg models.WSMessage) error {
	response := models.NewWSMessage("pong")
	response.ID = msg.ID
	data, _ := response.ToJSON()
	c.Send <- data
	return nil
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

import (
	"errors"
)

var (
	ErrNotAuthenticated = errors.New("not authenticated")
	ErrInvalidStream   = errors.New("invalid stream")
	ErrRateLimited     = errors.New("rate limited")
)