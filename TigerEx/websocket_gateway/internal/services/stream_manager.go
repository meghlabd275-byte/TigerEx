package services

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"tigerEx/websocket_gateway/internal/models"
)

// ============================================================================
// STREAM MANAGER
// ============================================================================

// StreamManager manages WebSocket streams
type StreamManager struct {
	mu        sync.RWMutex
	streams   map[string]*Stream
	clients  map[*Client]bool
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
		clients: make(map[*Client]bool),
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

	// Initialize mock prices
	sm.prices["BTC/USDT"] = 50000.0
	sm.prices["ETH/USDT"] = 3000.0
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

	for _, stream := range streams {
		if s, ok := sm.streams[stream]; ok {
			s.Subscribed++
			client.Streams[stream] = true
		}
	}

	return nil
}

// Unsubscribe unsubscribes a client from streams
func (sm *StreamManager) Unsubscribe(client *models.Client, streams []string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	for _, stream := range streams {
		if s, ok := sm.streams[stream]; ok {
			s.Subscribed--
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

	for client := range sm.clients {
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

	for client := range sm.clients {
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
	sm.mu.RLock()
	price := sm.prices[symbol]
	sm.mu.RUnlock()

	trade := &models.WSAggTrade{
		Event:       "aggTrade",
		EventTime:  time.Now().UnixMilli(),
		Symbol:     symbol,
		TradeID:    time.Now().UnixNano(),
		Price:      price + (float64(time.Now().UnixNano()%1000) - 500) * 0.001,
		Quantity:   0.001 * float64(time.Now().UnixNano()%10 + 1),
		BuyerOrderID: time.Now().UnixNano(),
		TradeTime:  time.Now().UnixMilli(),
		IsMaker:    time.Now().UnixNano()%2 == 0,
		IsBestMatch: true,
	}

	data, _ := json.Marshal(trade)
	return data
}

// GenerateKline generates a mock kline message
func (sm *StreamManager) GenerateKline(symbol, interval string) []byte {
	sm.mu.RLock()
	price := sm.prices[symbol]
	sm.mu.RUnlock()

	now := time.Now()
	openTime := now.Add(-1 * time.Minute).UnixMilli()

	kline := &models.WSKline{
		Event:     "kline",
		EventTime: now.UnixMilli(),
		Symbol:   symbol,
		Kline: &models.Kline{
			OpenTime:     openTime,
			Open:       price - 10,
			High:       price + 5,
			Low:        price - 15,
			Close:      price,
			Volume:    100,
			CloseTime: now.UnixMilli(),
			QuoteVolume: 100 * price,
			NumTrades:  100,
			TakerBaseVol: 80,
		},
	}

	data, _ := json.Marshal(kline)
	return data
}

// GenerateDepth generates a mock depth message
func (sm *StreamManager) GenerateDepth(symbol string) []byte {
	sm.mu.RLock()
	price := sm.prices[symbol]
	sm.mu.RUnlock()

	depth := &models.WSDepth{
		Event:         "depthUpdate",
		EventTime:    time.Now().UnixMilli(),
		Symbol:      symbol,
		FirstUpdateID: time.Now().UnixMilli(),
		Bids:         [][]string{},
		Asks:         [][]string{},
	}

	spread := price * 0.001
	for i := 0; i < 10; i++ {
		bidPrice := price - spread - float64(i)*price*0.0001
		bidQty := float64(10-i) * 0.5
		depth.Bids = append(depth.Bids, []string{
			fmt.Sprintf("%.8f", bidPrice),
			fmt.Sprintf("%.8f", bidQty),
		})

		askPrice := price + spread + float64(i)*price*0.0001
		askQty := float64(10-i) * 0.5
		depth.Asks = append(depth.Asks, []string{
			fmt.Sprintf("%.8f", askPrice),
			fmt.Sprintf("%.8f", askQty),
		})
	}

	data, _ := json.Marshal(depth)
	return data
}

// GenerateTicker generates a mock ticker message
func (sm *StreamManager) GenerateTicker(symbol string) []byte {
	sm.mu.RLock()
	price := sm.prices[symbol]
	sm.mu.RUnlock()

	ticker := &models.WSTicker{
		Event:               "24hrTicker",
		EventTime:          time.Now().UnixMilli(),
		Symbol:            symbol,
		PriceChange:        price * 0.02,
		PriceChangePercent: 2.0,
		LastPrice:         price,
		OpenPrice:         price * 0.98,
		HighPrice:         price * 1.05,
		LowPrice:          price * 0.95,
		TotalTradedBaseVolume: 1000000,
		NumTrades:        100000,
	}

	data, _ := json.Marshal(ticker)
	return data
}

// ============================================================================
// REGISTRATION
// ============================================================================

// RegisterClient registers a client
func (sm *StreamManager) RegisterClient(client *models.Client) {
	sm.mu.Lock()
	sm.clients[client] = true
	sm.mu.Unlock()
}

// UnregisterClient unregisters a client
func (sm *StreamManager) UnregisterClient(client *models.Client) {
	sm.mu.Lock()
	delete(sm.clients, client)
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
		result = append(result, stream)
	}

	return result
}