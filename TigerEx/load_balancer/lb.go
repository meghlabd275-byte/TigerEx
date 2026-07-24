// TigerEx Load Balancer
// Global load balancing for distributed systems
// Built with Go for high-load worldwide distributed systems

package main

import (
	"context"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

type Backend struct {
	ID       string
	Address  string
	Port     int
	Weight   int
	Healthy  bool
	Requests int64
	Latency  float64
	Failures int32
	mu       sync.RWMutex
}

type Pool struct {
	Name     string
	Backends []*Backend
	Strategy string
}

type LoadBalancer struct {
	mu      sync.RWMutex
	pools   map[string]*Pool
	stats   LBStats
	metrics map[string][]LatencyPoint
}

type LBStats struct {
	TotalRequests   int64
	TotalErrors    int64
	BytesSent      int64
	BytesReceived  int64
}

type LatencyPoint struct {
	Timestamp time.Time
	Latency  float64
}

func NewLoadBalancer() *LoadBalancer {
	return &LoadBalancer{
		pools:   make(map[string]*Pool),
		metrics: make(map[string][]LatencyPoint),
	}
}

func (lb *LoadBalancer) CreatePool(name string, strategy string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	lb.pools[name] = &Pool{Name: name, Strategy: strategy}
}

func (lb *LoadBalancer) AddBackend(poolName, id, addr string, port, weight int) error {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	
	pool, ok := lb.pools[poolName]
	if !ok {
		return fmt.Errorf("pool not found: %s", poolName)
	}
	
	backend := &Backend{
		ID:      id,
		Address: addr,
		Port:    port,
		Weight:  weight,
		Healthy: true,
	}
	
	pool.Backends = append(pool.Backends, backend)
	return nil
}

func (lb *LoadBalancer) GetBackend(poolName string) (*Backend, error) {
	lb.mu.RLock()
	pool, ok := lb.pools[poolName]
	lb.mu.RUnlock()
	
	if !ok {
		return nil, fmt.Errorf("pool not found: %s", poolName)
	}
	
	// Filter healthy backends
	var healthy []*Backend
	for _, b := range pool.Backends {
		b.mu.RLock()
		if b.Healthy {
			healthy = append(healthy, b)
		}
		b.mu.RUnlock()
	}
	
	if len(healthy) == 0 {
		return nil, fmt.Errorf("no healthy backends")
	}
	
	// Strategy selection
	var selected *Backend
	switch pool.Strategy {
	case "round_robin":
		selected = healthy[int(atomic.AddInt64(&lb.stats.TotalRequests, 1))%len(healthy)]
	case "least_connections":
		var min int64 = math.MaxInt64
		for _, b := range healthy {
			b.mu.RLock()
			if b.Requests < min {
				min = b.Requests
				selected = b
			}
			b.mu.RUnlock()
		}
	case "weighted":
		var totalWeight int
		for _, b := range healthy {
			b.mu.RLock()
			totalWeight += b.Weight
			b.mu.RUnlock()
		}
		r := int(atomic.AddInt64(&lb.stats.TotalRequests, 1)) % totalWeight
		for _, b := range healthy {
			b.mu.RLock()
			if r < b.Weight {
				selected = b
				b.mu.RUnlock()
				break
			}
			r -= b.Weight
			b.mu.RUnlock()
		}
	case "latency":
		var minLatency float64 = math.MaxFloat64
		for _, b := range healthy {
			b.mu.RLock()
			if b.Latency < minLatency {
				minLatency = b.Latency
				selected = b
			}
			b.mu.RUnlock()
		}
	default:
		selected = healthy[0]
	}
	
	if selected != nil {
		atomic.AddInt64(&selected.Requests, 1)
	}
	
	return selected, nil
}

func (lb *LoadBalancer) RecordLatency(backendID string, latency time.Duration) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	
	point := LatencyPoint{
		Timestamp: time.Now(),
		Latency:   latency.Seconds() * 1000,
	}
	lb.metrics[backendID] = append(lb.metrics[backendID], point)
	
	// Keep last 100 points
	if len(lb.metrics[backendID]) > 100 {
		lb.metrics[backendID] = lb.metrics[backendID][-100:]
	}
}

func (lb *LoadBalancer) RecordFailure(backendID string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	
	for _, pool := range lb.pools {
		for _, b := range pool.Backends {
			if b.ID == backendID {
				b.mu.Lock()
				b.Failures++
				if b.Failures > 5 {
					b.Healthy = false
				}
				b.mu.Unlock()
				atomic.AddInt64(&lb.stats.TotalErrors, 1)
			}
		}
	}
}

func (lb *LoadBalancer) HealthCheck() {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	
	for _, pool := range lb.pools {
		for _, b := range pool.Backends {
			b.mu.Lock()
			// Reset failures if healthy
			if b.Failures > 0 && b.Failures < 3 {
				b.Failures = 0
				b.Healthy = true
			}
			b.mu.Unlock()
		}
	}
}

func (lb *LoadBalancer) GetStats() LBStats {
	return LBStats{
		TotalRequests:  atomic.LoadInt64(&lb.stats.TotalRequests),
		TotalErrors:   atomic.LoadInt64(&lb.stats.TotalErrors),
		BytesSent:     atomic.LoadInt64(&lb.stats.BytesSent),
		BytesReceived: atomic.LoadInt64(&lb.stats.BytesReceived),
	}
}

func main() {
	fmt.Println("TigerEx Load Balancer")
	fmt.Println("====================")
	
	lb := NewLoadBalancer()
	
	// Create pools
	lb.CreatePool("api", "least_connections")
	lb.CreatePool("websocket", "latency")
	lb.CreatePool("matching", "weighted")
	
	// Add backends
	lb.AddBackend("api", "api-1", "10.0.0.1", 8080, 100)
	lb.AddBackend("api", "api-2", "10.0.0.2", 8080, 100)
	lb.AddBackend("api", "api-3", "10.0.0.3", 8080, 50)
	
	lb.AddBackend("websocket", "ws-1", "10.0.1.1", 8081, 100)
	lb.AddBackend("websocket", "ws-2", "10.0.1.2", 8081, 100)
	
	// Test routing
	for i := 0; i < 10; i++ {
		backend, err := lb.GetBackend("api")
		if err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			fmt.Printf("Request %d -> %s:%d\n", i+1, backend.Address, backend.Port)
		}
	}
	
	// Stats
	stats := lb.GetStats()
	fmt.Printf("\nStats:\n")
	fmt.Printf("  Total Requests: %d\n", stats.TotalRequests)
	fmt.Printf("  Total Errors: %d\n", stats.TotalErrors)
	
	// Record latency
	lb.RecordLatency("api-1", 15*time.Millisecond)
	lb.RecordLatency("api-2", 25*time.Millisecond)
	lb.RecordLatency("api-3", 35*time.Millisecond)
	
	// Health check
	lb.HealthCheck()
	
	fmt.Println("\nLoad Balancer ready")
}
