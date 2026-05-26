package main

import (
	"fmt"
	"net/http"
	"sync"
)

// ============================================================================
// WEBHOOK HANDLER - Go Implementation
// Event-driven webhook callbacks for TigerEx
// ============================================================================

// WebhookHandler is the webhook handler function type
type WebhookHandler func(map[string]interface{}) error

// Webhook manages webhook registrations and triggers
type Webhook struct {
	mu       sync.RWMutex
	handlers map[string]WebhookHandler
	stats    map[string]int
}

// NewWebhook creates a new webhook handler
func NewWebhook() *Webhook {
	return &Webhook{
		handlers: make(map[string]WebhookHandler),
		stats:    make(map[string]int),
	}
}

// Register registers a webhook handler for an event
func (w *Webhook) Register(event string, handler WebhookHandler) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.handlers[event] = handler
}

// Unregister removes a webhook handler
func (w *Webhook) Unregister(event string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.handlers, event)
}

// Trigger triggers a webhook event asynchronously
func (w *Webhook) Trigger(event string, data map[string]interface{}) {
	w.mu.RLock()
	handler, ok := w.handlers[event]
	w.mu.RUnlock()

	if !ok {
		fmt.Printf("No handler for event: %s\n", event)
		return
	}

	go func() {
		if err := handler(data); err != nil {
			fmt.Printf("Webhook error for %s: %v\n", event, err)
		}
		w.mu.Lock()
		w.stats[event]++
		w.mu.Unlock()
	}()
}

// TriggerSync triggers a webhook synchronously
func (w *Webhook) TriggerSync(event string, data map[string]interface{}) error {
	w.mu.RLock()
	handler, ok := w.handlers[event]
	w.mu.RUnlock()

	if !ok {
		return fmt.Errorf("no handler for event: %s", event)
	}

	if err := handler(data); err != nil {
		return err
	}

	w.mu.Lock()
	w.stats[event]++
	w.mu.Unlock()

	return nil
}

// HasHandler checks if handler exists
func (w *Webhook) HasHandler(event string) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	_, ok := w.handlers[event]
	return ok
}

// ListEvents lists registered events
func (w *Webhook) ListEvents() []string {
	w.mu.RLock()
	defer w.mu.RUnlock()

	events := make([]string, 0, len(w.handlers))
	for e := range w.handlers {
		events = append(events, e)
	}
	return events
}

// Stats returns trigger statistics
func (w *Webhook) Stats() map[string]int {
	w.mu.RLock()
	defer w.mu.RUnlock()

	statsCopy := make(map[string]int)
	for k, v := range w.stats {
		statsCopy[k] = v
	}
	return statsCopy
}

// ============================================================================
// WEBHOOK SERVER
// ============================================================================

// WebhookServer provides HTTP webhook endpoints
type WebhookServer struct {
	webhook *Webhook
	server  *http.Server
}

// NewWebhookServer creates a new webhook server
func NewWebhookServer(addr string) *WebhookServer {
	wh := NewWebhook()
	mux := http.NewServeMux()

	mux.HandleFunc("/webhook/trigger", func(w http.ResponseWriter, r *http.Request) {
		event := r.URL.Query().Get("event")
		if event == "" {
			http.Error(w, "event required", http.StatusBadRequest)
			return
		}
		wh.Trigger(event, map[string]interface{}{"request": "triggered"})
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/webhook/list", func(w http.ResponseWriter, r *http.Request) {
		events := wh.ListEvents()
		fmt.Fprintf(w, "Registered events: %v\n", events)
	})

	return &WebHookServer{
		webhook: wh,
		server: &http.Server{
			Addr:    addr,
			Handler: mux,
		},
	}
}

// Start starts the webhook server
func (s *WebhookServer) Start() error {
	return s.server.ListenAndServe()
}

// Shutdown shuts down the server
func (s *WebhookServer) Shutdown() error {
	return s.server.Shutdown()
}

// ============================================================================
// EXAMPLE HANDLERS
// ============================================================================

// OrderFilledHandler handles order filled events
func OrderFilledHandler(data map[string]interface{}) error {
	orderID, _ := data["orderId"].(string)
	fmt.Printf("Order filled: %s\n", orderID)
	return nil
}

// PriceAlertHandler handles price alert events
func PriceAlertHandler(data map[string]interface{}) error {
	symbol, _ := data["symbol"].(string)
	price, _ := data["price"].(float64)
	fmt.Printf("Price alert: %s at %.2f\n", symbol, price)
	return nil
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	wh := NewWebhook()

	// Register handlers
	wh.Register("order.filled", OrderFilledHandler)
	wh.Register("price.alert", PriceAlertHandler)

	// List events
	fmt.Printf("Registered events: %v\n", wh.ListEvents())

	// Trigger events
	wh.Trigger("order.filled", map[string]interface{}{
		"orderId": "ORD-12345",
		"symbol": "BTC/USDT",
		"price":  50000.0,
	})

	wh.Trigger("price.alert", map[string]interface{}{
		"symbol": "ETH/USDT",
		"price":  3000.0,
	})

	// Sync trigger
	err := wh.TriggerSync("order.filled", map[string]interface{}{
		"orderId": "ORD-SYNC",
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	}

	// Stats
	fmt.Printf("Stats: %v\n", wh.Stats())

	// Check handler exists
	fmt.Printf("Has order.filled: %v\n", wh.HasHandler("order.filled"))
	fmt.Printf("Has unknown: %v\n", wh.HasHandler("unknown"))
}