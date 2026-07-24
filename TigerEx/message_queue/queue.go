// TigerEx Message Queue
// Distributed message queue for high-load systems
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Message struct {
	ID        string
	Topic     string
	Payload   interface{}
	Metadata  map[string]string
	Timestamp time.Time
	Acked     bool
}

type Consumer struct {
	ID      string
	Topics  []string
	Handler func(Message) error
}

type Topic struct {
	Name        string
	Partitions int
	Messages   []Message
	Consumers  []string
	mu         sync.RWMutex
}

type MessageQueue struct {
	mu      sync.RWMutex
	topics  map[string]*Topic
	consumers map[string]*Consumer
	stats   QueueStats
}

type QueueStats struct {
	Published   int64
	Consumed    int64
	Acknowledged int64
	Failed      int64
}

func NewMessageQueue() *MessageQueue {
	return &MessageQueue{
		topics:    make(map[string]*Topic),
		consumers: make(map[string]*Consumer),
	}
}

func (q *MessageQueue) CreateTopic(name string, partitions int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	
	if _, exists := q.topics[name]; exists {
		return fmt.Errorf("topic already exists: %s", name)
	}
	
	q.topics[name] = &Topic{
		Name: name, Partitions: partitions,
		Messages: make([]Message, 0),
		Consumers: make([]string, 0),
	}
	return nil
}

func (q *MessageQueue) Publish(ctx context.Context, topic string, payload interface{}) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	
	t, exists := q.topics[topic]
	if !exists {
		return fmt.Errorf("topic not found: %s", topic)
	}
	
	msg := Message{
		ID: generateMessageID(), Topic: topic,
		Payload: payload, Timestamp: time.Now(),
		Metadata: make(map[string]string),
	}
	
	t.Messages = append(t.Messages, msg)
	q.stats.Published++
	return nil
}

func (q *MessageQueue) Subscribe(consumerID string, topics []string, handler func(Message) error) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	
	consumer := &Consumer{
		ID: consumerID, Topics: topics, Handler: handler,
	}
	q.consumers[consumerID] = consumer
	
	for _, topic := range topics {
		if t, exists := q.topics[topic]; exists {
			t.Consumers = append(t.Consumers, consumerID)
		}
	}
	return nil
}

func (q *MessageQueue) Consume(consumerID string) (*Message, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	
	consumer, exists := q.consumers[consumerID]
	if !exists {
		return nil, fmt.Errorf("consumer not found: %s", consumerID)
	}
	
	for _, topic := range consumer.Topics {
		t := q.topics[topic]
		if t == nil || len(t.Messages) == 0 {
			continue
		}
		
		msg := t.Messages[0]
		t.Messages = t.Messages[1:]
		q.stats.Consumed++
		
		if err := consumer.Handler(msg); err != nil {
			q.stats.Failed++
			return nil, err
		}
		
		msg.Acked = true
		q.stats.Acknowledged++
		return &msg, nil
	}
	
	return nil, nil
}

func (q *MessageQueue) GetStats() QueueStats {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.stats
}

func generateMessageID() string {
	return fmt.Sprintf("MSG-%d", time.Now().UnixNano())
}

func main() {
	fmt.Println("TigerEx Message Queue")
	fmt.Println("====================")
	
	mq := NewMessageQueue()
	
	// Create topics
	mq.CreateTopic("orders", 10)
	mq.CreateTopic("trades", 10)
	mq.CreateTopic("notifications", 5)
	
	// Subscribe
	mq.Subscribe("worker-1", []string{"orders", "trades"}, func(m Message) error {
		fmt.Printf("Processing: %s\n", m.ID)
		return nil
	})
	
	// Publish messages
	mq.Publish(context.Background(), "orders", map[string]interface{}{"id": "123", "amount": 1000})
	mq.Publish(context.Background(), "orders", map[string]interface{}{"id": "124", "amount": 2000})
	mq.Publish(context.Background(), "trades", map[string]interface{}{"trade_id": "T1", "price": 50000})
	
	// Consume
	msg, _ := mq.Consume("worker-1")
	if msg != nil {
		fmt.Printf("Consumed: %s\n", msg.ID)
	}
	
	stats := mq.GetStats()
	fmt.Printf("\nStats: Published=%d, Consumed=%d, Acked=%d, Failed=%d\n",
		stats.Published, stats.Consumed, stats.Acknowledged, stats.Failed)
}
