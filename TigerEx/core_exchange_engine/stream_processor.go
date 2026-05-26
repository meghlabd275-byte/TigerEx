package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// STREAM PROCESSOR TYPES
// ============================================================================

type StreamEvent struct {
	EventID     string    `json:"eventId"`
	EventType   string    `json:"eventType"`
	Market      string    `json:"market,omitempty"`
	UserID      string    `json:"userId,omitempty"`
	Data        map[string]interface{} `json:"data"`
	Timestamp   int64     `json:"timestamp"`
}

type TradeEvent struct {
	TradeID    string  `json:"tradeId"`
	Market     string  `json:"market"`
	Price      float64 `json:"price"`
	Quantity   float64 `json:"quantity"`
	Side       string  `json:"side"`
	TakerOrderID string `json:"takerOrderId"`
	MakerOrderID string `json:"makerOrderId"`
	Timestamp  int64   `json:"timestamp"`
}

type OrderBookEvent struct {
	Market      string          `json:"market"`
	Bids        []PriceLevel `json:"bids"`
	Asks        []PriceLevel `json:"asks"`
	Timestamp   int64           `json:"timestamp"`
}

type PriceLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

type TickerEvent struct {
	Market      string  `json:"market"`
	LastPrice  float64 `json:"lastPrice"`
	PriceChange float64 `json:"priceChange"`
	High24h    float64 `json:"high24h"`
	Low24h     float64 `json:"low24h"`
	Volume24h  float64 `json:"volume24h"`
	Trades24h  int64   `json:"trades24h"`
	Timestamp  int64   `json:"timestamp"`
}

// ============================================================================
// STREAM PROCESSOR
// ============================================================================

type StreamProcessor struct {
	mu sync.RWMutex

	// Event channels
	tradeChan      chan *TradeEvent
	orderBookChan chan *OrderBookEvent
	tickerChan    chan *TickerEvent
	customChan    chan *StreamEvent

	// Subscriptions
	tradeSubs      map[string]map[string]chan *TradeEvent // market -> subscriberID -> chan
	orderBookSubs map[string]map[string]chan *OrderBookEvent
	tickerSubs    map[string]map[string]chan *TickerEvent

	// Event history
	eventHistory    []StreamEvent
	maxHistorySize int

	// Processing stats
	EventsProcessed int64 `json:"eventsProcessed"`
	EventsDropped  int64 `json:"eventsDropped"`

	// Running state
	running bool
	workers int
}

func NewStreamProcessor(workers int) *StreamProcessor {
	return &StreamProcessor{
		tradeChan:      make(chan *TradeEvent, 10000),
		orderBookChan: make(chan *OrderBookEvent, 5000),
		tickerChan:    make(chan *TickerEvent, 5000),
		customChan:    make(chan *StreamEvent, 5000),

		tradeSubs:      make(map[string]map[string]chan *TradeEvent),
		orderBookSubs: make(map[string]map[string]chan *OrderBookEvent),
		tickerSubs:    make(map[string]map[string]chan *TickerEvent),

		eventHistory:    make([]StreamEvent, 0, 10000),
		maxHistorySize: 10000,

		workers: workers,
	}
}

// Start begins processing events
func (sp *StreamProcessor) Start() {
	sp.running = true

	// Start workers
	for i := 0; i < sp.workers; i++ {
		go sp.eventWorker(i)
	}

	// Start publishers
	go sp.tradePublisher()
	go sp.orderBookPublisher()
	go sp.tickerPublisher()

	log.Printf("Stream processor started with %d workers", sp.workers)
}

// Stop halts processing
func (sp *StreamProcessor) Stop() {
	sp.running = false
	close(sp.tradeChan)
	close(sp.orderBookChan)
	close(sp.tickerChan)
	close(sp.customChan)
	log.Println("Stream processor stopped")
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

func (sp *StreamProcessor) eventWorker(id int) {
	for {
		select {
		case trade, ok := <-sp.tradeChan:
			if !ok {
				return
			}
			sp.handleTradeEvent(trade)

		case book, ok := <-sp.orderBookChan:
			if !ok {
				return
			}
			sp.handleOrderBookEvent(book)

		case ticker, ok := <-sp.tickerChan:
			if !ok {
				return
			}
			sp.handleTickerEvent(ticker)

		case event, ok := <-sp.customChan:
			if !ok {
				return
			}
			sp.handleCustomEvent(event)

		case <-time.After(100 * time.Millisecond):
			// Idle
		}
	}
}

func (sp *StreamProcessor) handleTradeEvent(trade *TradeEvent) {
	// Store in history
	sp.addToHistory(StreamEvent{
		EventID:   trade.TradeID,
		EventType: "trade",
		Market:    trade.Market,
		Data: map[string]interface{}{
			"price":    trade.Price,
			"quantity": trade.Quantity,
			"side":     trade.Side,
		},
		Timestamp: trade.Timestamp,
	})

	// Notify subscribers
	sp.mu.RLock()
	if subs, ok := sp.tradeSubs[trade.Market]; ok {
		for _, ch := range subs {
			select {
			case ch <- trade:
			default:
				atomic.AddInt64(&sp.EventsDropped, 1)
			}
		}
	}
	sp.mu.RUnlock()

	atomic.AddInt64(&sp.EventsProcessed, 1)
}

func (sp *StreamProcessor) handleOrderBookEvent(book *OrderBookEvent) {
	sp.addToHistory(StreamEvent{
		EventID:   uuid.New().String(),
		EventType: "orderbook",
		Market:    book.Market,
		Data: map[string]interface{}{
			"bids": book.Bids,
			"asks": book.Asks,
		},
		Timestamp: book.Timestamp,
	})

	// Notify subscribers
	sp.mu.RLock()
	if subs, ok := sp.orderBookSubs[book.Market]; ok {
		for _, ch := range subs {
			select {
			case ch <- book:
			default:
				atomic.AddInt64(&sp.EventsDropped, 1)
			}
		}
	}
	sp.mu.RUnlock()

	atomic.AddInt64(&sp.EventsProcessed, 1)
}

func (sp *StreamProcessor) handleTickerEvent(ticker *TickerEvent) {
	sp.addToHistory(StreamEvent{
		EventID:   uuid.New().String(),
		EventType: "ticker",
		Market:    ticker.Market,
		Data: map[string]interface{}{
			"lastPrice":   ticker.LastPrice,
			"priceChange": ticker.PriceChange,
			"high24h":    ticker.High24h,
			"low24h":     ticker.Low24h,
			"volume24h":  ticker.Volume24h,
		},
		Timestamp: ticker.Timestamp,
	})

	// Notify subscribers
	sp.mu.RLock()
	if subs, ok := sp.tickerSubs[ticker.Market]; ok {
		for _, ch := range subs {
			select {
			case ch <- ticker:
			default:
				atomic.AddInt64(&sp.EventsDropped, 1)
			}
		}
	}
	sp.mu.RUnlock()

	atomic.AddInt64(&sp.EventsProcessed, 1)
}

func (sp *StreamProcessor) handleCustomEvent(event *StreamEvent) {
	sp.addToHistory(*event)
	atomic.AddInt64(&sp.EventsProcessed, 1)
}

func (sp *StreamProcessor) addToHistory(event StreamEvent) {
	sp.mu.Lock()
	defer sp.mu.Unlock()

	sp.eventHistory = append(sp.eventHistory, event)
	if len(sp.eventHistory) > sp.maxHistorySize {
		sp.eventHistory = sp.eventHistory[1:]
	}
}

// ============================================================================
// PUBLISHERS (Simulated)
// ============================================================================

func (sp *StreamProcessor) tradePublisher() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	markets := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT"}

	for {
		select {
		case <-ticker.C:
			if !sp.running {
				return
			}

			// Simulate trade event
			market := markets[time.Now().Unix()%int64(len(markets))]
			trade := &TradeEvent{
				TradeID:      uuid.New().String(),
				Market:       market,
				Price:       50000 + (time.Now().Unix() % 1000),
				Quantity:    0.1 + float64(time.Now().Unix()%100)/1000,
				Side:        []string{"buy", "sell"}[time.Now().Unix()%2],
				Timestamp:   time.Now().UnixMilli(),
			}

			select {
			case sp.tradeChan <- trade:
			default:
				atomic.AddInt64(&sp.EventsDropped, 1)
			}

		case <-time.After(10 * time.Second):
			if !sp.running {
				return
			}
		}
	}
}

func (sp *StreamProcessor) orderBookPublisher() {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	markets := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT"}

	for {
		select {
		case <-ticker.C:
			if !sp.running {
				return
			}

			market := markets[time.Now().Unix()%int64(len(markets))]
			book := &OrderBookEvent{
				Market:    market,
				Bids:      generatePriceLevels("bid"),
				Asks:      generatePriceLevels("ask"),
				Timestamp: time.Now().UnixMilli(),
			}

			select {
			case sp.orderBookChan <- book:
			default:
				atomic.AddInt64(&sp.EventsDropped, 1)
			}

		case <-time.After(10 * time.Second):
			if !sp.running {
				return
			}
		}
	}
}

func (sp *StreamProcessor) tickerPublisher() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	markets := []string{"BTC/USDT", "ETH/USDT", "SOL/USDT"}

	for {
		select {
		case <-ticker.C:
			if !sp.running {
				return
			}

			market := markets[time.Now().Unix()%int64(len(markets))]
			ticker := &TickerEvent{
				Market:      market,
				LastPrice:   50000 + float64(time.Now().Unix()%1000),
				PriceChange: float64((time.Now().Unix() % 200) - 100),
				High24h:     51000,
				Low24h:      49000,
				Volume24h:   10000 + float64(time.Now().Unix()%10000),
				Trades24h:   int64(100000 + time.Now().Unix()%10000),
				Timestamp:   time.Now().UnixMilli(),
			}

			select {
			case sp.tickerChan <- ticker:
			default:
				atomic.AddInt64(&sp.EventsDropped, 1)
			}

		case <-time.After(10 * time.Second):
			if !sp.running {
				return
			}
		}
	}
}

func generatePriceLevels(side string) []PriceLevel {
	levels := make([]PriceLevel, 5)
	basePrice := 50000.0
	if side == "ask" {
		basePrice = 50100.0
	}

	for i := 0; i < 5; i++ {
		price := basePrice + float64(i)*10
		qty := 1.0 + float64(i)*0.5
		levels[i] = PriceLevel{Price: price, Quantity: qty}
	}

	return levels
}

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

// SubscribeTrades returns channel for trade events
func (sp *StreamProcessor) SubscribeTrades(market string) chan *TradeEvent {
	sp.mu.Lock()
	defer sp.mu.Unlock()

	subID := uuid.New().String()
	ch := make(chan *TradeEvent, 100)

	if sp.tradeSubs[market] == nil {
		sp.tradeSubs[market] = make(map[string]chan *TradeEvent)
	}
	sp.tradeSubs[market][subID] = ch

	return ch
}

// SubscribeOrderBook returns channel for order book events
func (sp *StreamProcessor) SubscribeOrderBook(market string) chan *OrderBookEvent {
	sp.mu.Lock()
	defer sp.mu.Unlock()

	subID := uuid.New().String()
	ch := make(chan *OrderBookEvent, 50)

	if sp.orderBookSubs[market] == nil {
		sp.orderBookSubs[market] = make(map[string]chan *OrderBookEvent)
	}
	sp.orderBookSubs[market][subID] = ch

	return ch
}

// SubscribeTicker returns channel for ticker events
func (sp *StreamProcessor) SubscribeTicker(market string) chan *TickerEvent {
	sp.mu.Lock()
	defer sp.mu.Unlock()

	subID := uuid.New().String()
	ch := make(chan *TickerEvent, 50)

	if sp.tickerSubs[market] == nil {
		sp.tickerSubs[market] = make(map[string]chan *TickerEvent)
	}
	sp.tickerSubs[market][subID] = ch

	return ch
}

// Unsubscribe removes subscription
func (sp *StreamProcessor) Unsubscribe(market, subID string) {
	sp.mu.Lock()
	defer sp.mu.Unlock()

	if ch, ok := sp.tradeSubs[market][subID]; ok {
		close(ch)
		delete(sp.tradeSubs[market], subID)
	}
}

// ============================================================================
// PUBLIC METHODS
// ============================================================================

// PublishTrade publishes a trade event
func (sp *StreamProcessor) PublishTrade(trade *TradeEvent) {
	select {
	case sp.tradeChan <- trade:
	default:
		atomic.AddInt64(&sp.EventsDropped, 1)
	}
}

// PublishOrderBook publishes order book update
func (sp *StreamProcessor) PublishOrderBook(book *OrderBookEvent) {
	select {
	case sp.orderBookChan <- book:
	default:
		atomic.AddInt64(&sp.EventsDropped, 1)
	}
}

// PublishTicker publishes ticker update
func (sp *StreamProcessor) PublishTicker(ticker *TickerEvent) {
	select {
	case sp.tickerChan <- ticker:
	default:
		atomic.AddInt64(&sp.EventsDropped, 1)
	}
}

// GetHistory returns event history
func (sp *StreamProcessor) GetHistory(limit int) []StreamEvent {
	sp.mu.RLock()
	defer sp.mu.RUnlock()

	if limit > len(sp.eventHistory) {
		limit = len(sp.eventHistory)
	}

	history := make([]StreamEvent, limit)
	copy(history, sp.eventHistory[len(sp.eventHistory)-limit:])

	return history
}

// GetMetrics returns processing metrics
func (sp *StreamProcessor) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"eventsProcessed": atomic.LoadInt64(&sp.EventsProcessed),
		"eventsDropped":  atomic.LoadInt64(&sp.EventsDropped),
		"historySize":    len(sp.eventHistory),
		"running":        sp.running,
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Stream Processor (Go)")
	fmt.Println("================================\n")

	// Create processor with 4 workers
	sp := NewStreamProcessor(4)

	// Subscribe to BTC/USDT trades
	tradeCh := sp.SubscribeTrades("BTC/USDT")
	bookCh := sp.SubscribeOrderBook("BTC/USDT")
	tickerCh := sp.SubscribeTicker("BTC/USDT")

	// Start processing
	sp.Start()

	fmt.Println("Processing events...")

	// Listen for events
	for i := 0; i < 5; i++ {
		select {
		case trade := <-tradeCh:
			fmt.Printf("Trade: %s %.4f @ %.2f\n", trade.Market, trade.Quantity, trade.Price)

		case book := <-bookCh:
			fmt.Printf("OrderBook: %s bids=%d asks=%d\n", book.Market, len(book.Bids), len(book.Asks))

		case ticker := <-tickerCh:
			fmt.Printf("Ticker: %s %.2f (24h: %.2f-%.2f)\n", 
				ticker.Market, ticker.LastPrice, ticker.Low24h, ticker.High24h)

		case <-time.After(2 * time.Second):
			break
		}
	}

	// Get metrics
	metrics := sp.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	fmt.Printf("\nMetrics:\n%s\n", string(metricsJSON))

	// Get history
	history := sp.GetHistory(10)
	fmt.Printf("\nEvent History: %d events\n", len(history))

	// Stop
	sp.Stop()

	fmt.Println("\nStream processor stopped.")
}