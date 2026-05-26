// Package balancer - Load Balancer
package main

import (
	"fmt"
	"sync"
)

type Backend struct {
	URL      string
	Weight   int
	Active   int
}

type Balancer struct {
	mu       sync.RWMutex
	backends []*Backend
}

func New() *Balancer {
	return &Balancer{}
}

func (b *Balancer) AddBackend(url string, weight int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.backends = append(b.backends, &Backend{URL: url, Weight: weight})
}

func (b *Balancer) Next() *Backend {
	b.mu.Lock()
	defer b.mu.Unlock()
	
	var best *Backend
	var min int = 999999
	
	for _, be := range b.backends {
		if be.Active < min {
			min = be.Active
			best = be
		}
	}
	
	if best != nil {
		best.Active++
	}
	
	return best
}

func (b *Balancer) Release(be *Backend) {
	b.mu.Lock()
	defer b.mu.Unlock()
	be.Active--
}

func main() {
	lb := New()
	lb.AddBackend("server1:8080", 10)
	lb.AddBackend("server2:8080", 5)
	
	next := lb.Next()
	fmt.Println("Selected:", next.URL)
}