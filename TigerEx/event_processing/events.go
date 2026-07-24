// TigerEx Event Processing
// Real-time event processing for high-load systems
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Event struct {
	ID        string
	Type     string
	Source   string
	Data     interface{}
	Metadata map[string]string
	Time     time.Time
}

type EventHandler func(Event) error

type EventProcessor struct {
	mu           sync.RWMutex
	subscribers  map[string][]EventHandler
	eventQueue   chan Event
	stats        ProcessorStats
	workers      int
}

type ProcessorStats struct {
	EventsProcessed int64
	EventsFailed    int64
	ProcessingTime float64
}

func NewEventProcessor(workers int, queueSize int) *EventProcessor {
	ep := &EventProcessor{
		subscribers: make(map[string][]EventHandler),
		eventQueue:   make(chan Event, queueSize),
		workers:      workers,
	}
	
	for i := 0; workers; i++ {
		go ep.worker(i)
	}
	
	return ep
}

func (ep *EventProcessor) Subscribe(eventType string, handler EventHandler) {
	ep.mu.Lock()
	defer ep.mu.Unlock()
	ep.subscribers[eventType] = append(ep.subscribers[eventType], handler)
}

func (ep *EventProcessor) Publish(event Event) {
	ep.eventQueue <- event
}

func (ep *EventProcessor) worker(id int) {
	for event := range ep.eventQueue {
		start := time.Now()
		
		handlers := ep.getHandlers(event.Type)
		
		for _, handler := range handlers {
			if err := handler(event); err != nil {
				ep.stats.EventsFailed++
			}
		}
		
		ep.stats.EventsProcessed++
		ep.stats.ProcessingTime += time.Since(start).Seconds()
	}
}

func (ep *EventProcessor) getHandlers(eventType string) []EventHandler {
	ep.mu.RLock()
	defer ep.mu.RUnlock()
	return ep.subscribers[eventType]
}

func (ep *EventProcessor) GetStats() ProcessorStats {
	return ep.stats
}

func main() {
	fmt.Println("TigerEx Event Processing")
	fmt.Println("=======================")
	
	processor := NewEventProcessor(4, 1000)
	
	// Subscribe to events
	processor.Subscribe("order.created", func(e Event) error {
		fmt.Printf("Order Created: %s\n", e.ID)
		return nil
	})
	
	processor.Subscribe("trade.executed", func(e Event) error {
		fmt.Printf("Trade Executed: %s\n", e.ID)
		return nil
	})
	
	processor.Subscribe("user.login", func(e Event) error {
		fmt.Printf("User Login: %s\n", e.ID)
		return nil
	})
	
	// Publish events
	processor.Publish(Event{
		ID: "evt-1", Type: "order.created", Source: "trading",
		Data: map[string]interface{}{"order_id": 123}, Time: time.Now(),
	})
	
	processor.Publish(Event{
		ID: "evt-2", Type: "trade.executed", Source: "matching",
		Data: map[string]interface{}{"trade_id": 456}, Time: time.Now(),
	})
	
	time.Sleep(time.Millisecond)
	
	stats := processor.GetStats()
	fmt.Printf("\nStats: Processed=%d, Failed=%d\n", stats.EventsProcessed, stats.EventsFailed)
}
