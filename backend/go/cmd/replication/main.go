// Package replication - Data Replication
package main

import (
	"fmt"
	"sync"
	"time"
)

type Replica struct {
	ID, Address string
	Status string
	LastSync time.Time
}

type ReplicationService struct {
	mu sync.RWMutex
	replicas map[string]*Replica
}

func New() *ReplicationService {
	return &ReplicationService{replicas: make(map[string]*Replica)}
}

func (rs *ReplicationService) Add(address string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.replicas[address] = &Replica{
		ID: address, Address: address, Status: "active", LastSync: time.Now()}
}

func (rs *ReplicationService) Sync(data []byte) error {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	for _, r := range rs.replicas {
		fmt.Printf("Syncing to %s\n", r.Address)
	}
	return nil
}

func main() {
	rs := New()
	rs.Add("replica1:5432")
	rs.Sync([]byte("data"))
}