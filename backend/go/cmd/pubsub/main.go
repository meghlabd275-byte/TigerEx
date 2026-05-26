// Package pubsub - Pub/Sub Message Broker
package main

import (
	"fmt"
	"sync"
)

type Subscriber func(topic string, msg []byte)

type PubSub struct {
	mu sync.RWMutex
	topics map[string][]Subscriber
}

func NewPubSub() *PubSub {
	return &PubSub{
		topics: make(map[string][]Subscriber),
	}
}

func (ps *PubSub) Subscribe(topic string, fn Subscriber) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	ps.topics[topic] = append(ps.topics[topic], fn)
}

func (ps *PubSub) Publish(topic string, msg []byte) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	subs, ok := ps.topics[topic]
	if !ok {
		return
	}

	for _, sub := range subs {
		sub(topic, msg)
	}
}

func (ps *PubSub) Unsubscribe(topic string, fn Subscriber) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	subs := ps.topics[topic]
	for i, s := range subs {
		if &s == &fn {
			copy(subs[i:], subs[i+1:])
			ps.topics[topic] = subs[:len(subs)-1]
			return
		}
	}
}

func main() {
	ps := NewPubSub()

	ps.Subscribe("trade", func(topic string, msg []byte) {
		fmt.Printf("Received: %s\n", msg)
	})

	ps.Publish("trade", []byte("BTC bought @ 50000"))
	ps.Publish("price", []byte("ETH @ 3000"))

	fmt.Println("PubSub done")
}