// Package eventbus - Event Bus
package main

import (
	"fmt"
	"sync"
)

type EventHandler func(interface{})

type EventBus struct {
	mu sync.RWMutex
	subs map[string][]EventHandler
}

func NewEventBus() *EventBus {
	return &EventBus{subs: make(map[string][]EventHandler)}
}

func (eb *EventBus) Subscribe(event string, h EventHandler) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	eb.subs[event] = append(eb.subs[event], h)
}

func (eb *EventBus) Publish(event string, data interface{}) {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	for _, h := range eb.subs[event] {
		h(data)
	}
}

eb := NewEventBus()
eb.Subscribe("order.created", func(d interface{}) { fmt.Println("Order:", d) })
eb.Publish("order.created", "order_123")