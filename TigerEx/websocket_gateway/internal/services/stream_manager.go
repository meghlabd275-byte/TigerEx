package services

import (
	"fmt"
	"sync"

	"tigerEx/websocket_gateway/internal/models"
)

// ============================================================================
// STREAM MANAGER
// ============================================================================

// StreamManager manages WebSocket streams
type StreamManager struct {
	mu        sync.RWMutex
	streams   map[string]*Stream
	clients  map[string]*models.Client
	prices   map[string]float64
}

// Stream represents a stream
type Stream struct {
	Name        string
	Type        string
	Symbol     string
	Subscribed int
}

// NewStreamManager creates a new stream manager
func NewStreamManager() *StreamManager {
	sm := &StreamManager{
		streams: make(map[string]*Stream),
		clients: make(map[string]*models.Client),
		prices: make(map[string]float64),
	}

	// Initialize default streams
	sm.initializeStreams()

	return sm
}

// initializeStreams initializes default streams
func (sm *StreamManager) initializeStreams() {
	// Market data streams
	streams := []string{
		"btcusdt@trade",
		"btcusdt@kline_1m",
		"btcusdt@depth",
		"btcusdt@ticker",
		"ethusdt@trade",
		"ethusdt@kline_1m",
		"ethusdt@depth",
		"ethusdt@ticker",
	}

	for _, stream := range streams {
		sm.streams[stream] = &Stream{
			Name: stream,
			Type: getStreamType(stream),
		}
	}

}

func getStreamType(stream string) string {
	for i := len(stream) - 1; i >= 0; i-- {
		if stream[i] == '@' {
			return stream[i+1:]
		}
	}
	return ""
}

// ============================================================================
// SUBSCRIPTION
// ============================================================================

// Subscribe subscribes a client to streams
func (sm *StreamManager) Subscribe(client *models.Client, streams []string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if client == nil || client.Streams == nil {
		return fmt.Errorf("client subscription state is required")
	}
	for _, stream := range streams {
		if _, ok := sm.streams[stream]; !ok {
			return fmt.Errorf("unsupported stream: %s", stream)
		}
	}
	for _, stream := range streams {
		if !client.Streams[stream] {
			sm.streams[stream].Subscribed++
			client.Streams[stream] = true
		}
	}
	return nil
}

// Unsubscribe unsubscribes a client from streams
func (sm *StreamManager) Unsubscribe(client *models.Client, streams []string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if client == nil || client.Streams == nil {
		return fmt.Errorf("client subscription state is required")
	}
	for _, stream := range streams {
		if client.Streams[stream] {
			if s, ok := sm.streams[stream]; ok && s.Subscribed > 0 {
				s.Subscribed--
			}
			delete(client.Streams, stream)
		}
	}
	return nil
}

// GetSubscribedStreams gets subscribed streams for a client
func (sm *StreamManager) GetSubscribedStreams(client *models.Client) []string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	var result []string
	for stream := range client.Streams {
		result = append(result, stream)
	}

	return result
}

// ============================================================================
// BROADCAST
// ============================================================================

// Broadcast sends a message to all subscribed clients
func (sm *StreamManager) Broadcast(stream string, message []byte) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	for _, client := range sm.clients {
		if client.Streams[stream] {
			// Send to client (implementation would use websocket connection)
			_ = message
		}
	}
}

// BroadcastToUser sends a message to a specific user
func (sm *StreamManager) BroadcastToUser(userID string, message []byte) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	for _, client := range sm.clients {
		if client.UserID == userID {
			// Send to client
			_ = message
		}
	}
}

// ============================================================================
// MARKET DATA
// ============================================================================

// GetPrice gets current price for a symbol
func (sm *StreamManager) GetPrice(symbol string) float64 {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	return sm.prices[symbol]
}

// UpdatePrice updates price for a symbol
func (sm *StreamManager) UpdatePrice(symbol string, price float64) {
	sm.mu.Lock()
	sm.prices[symbol] = price
	sm.mu.Unlock()
}

// GenerateTrade generates a mock trade message
func (sm *StreamManager) GenerateTrade(symbol string) []byte {
	// Trade events must come from a verified matching-engine event stream.
	// No synthetic trades are emitted by this gateway.
	_ = symbol
	return nil
}

// GenerateKline generates a mock kline message
func (sm *StreamManager) GenerateKline(symbol, interval string) []byte {
	// Candles must be built from persisted/verified trades by the market-data service.
	_ = symbol
	_ = interval
	return nil
}

// GenerateDepth generates a mock depth message
func (sm *StreamManager) GenerateDepth(symbol string) []byte {
	// Order-book snapshots must be supplied by the authoritative matching engine.
	_ = symbol
	return nil
}

// GenerateTicker generates a mock ticker message
func (sm *StreamManager) GenerateTicker(symbol string) []byte {
	// Tickers must be derived from verified market-data events, never generated.
	_ = symbol
	return nil
}

// ============================================================================
// REGISTRATION
// ============================================================================

// RegisterClient registers a client
func (sm *StreamManager) RegisterClient(client *models.Client) {
	sm.mu.Lock()
	sm.clients[client.ID] = client
	sm.mu.Unlock()
}

// UnregisterClient unregisters a client
func (sm *StreamManager) UnregisterClient(client *models.Client) {
	sm.mu.Lock()
	delete(sm.clients, client.ID)
	sm.mu.Unlock()
}

// GetClientCount gets number of connected clients
func (sm *StreamManager) GetClientCount() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	return len(sm.clients)
}

// ============================================================================
// STREAMS
// ============================================================================

// GetStreams gets all available streams
func (sm *StreamManager) GetStreams() []*Stream {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	var result []*Stream
	for _, stream := range sm.streams {
		copy := *stream
		result = append(result, &copy)
	}

	return result
}