// Package discovery - Service Discovery
package main

import (
	"fmt"
	"sync"
	"time"
)

type Service struct {
	Name, Address string
	LastSeen time.Time
}

type Registry struct {
	mu sync.RWMutex
	services map[string]*Service
}

func New() *Registry {
	return &Registry{services: make(map[string]*Service)}
}

func (r *Registry) Register(name, addr string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.services[name] = &Service{Name: name, Address: addr, LastSeen: time.Now()}
}

func (r *Registry) Discover(name string) *Service {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.services[name]
}

func (r *Registry) Heartbeat(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.services[name]; ok {
		s.LastSeen = time.Now()
	}
}

func main() {
	r := New()
	r.Register("api-gateway", "10.0.0.1:8080")
	svc := r.Discover("api-gateway")
	fmt.Println(svc.Address)
}