// Package resilience - Circuit Breaker
package main

import (
	"fmt"
	"sync"
	"time"
)

type State int

const (
	StateClosed State = iota
	StateOpen
	StateHalfOpen
)

type CircuitBreaker struct {
	mu         sync.RWMutex
	state      State
	failures   int
	threshold  int
	timeout   time.Duration
	lastFail  time.Time
}

func New(threshold int, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:     StateClosed,
		threshold: threshold,
		timeout:  timeout,
	}
}

func (cb *CircuitBreaker) Allow() bool {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	
	if cb.state == StateOpen {
		if time.Since(cb.lastFail) > cb.timeout {
			cb.state = StateHalfOpen
			return true
		}
		return false
	}
	return true
}

func (cb *CircuitBreaker) Success() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.state = StateClosed
	cb.failures = 0
}

func (cb *CircuitBreaker) Failure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	if cb.failures >= cb.threshold {
		cb.state = StateOpen
		cb.lastFail = time.Now()
	}
}

func main() {
	cb := New(3, 10*time.Second)
	
	for i := 0; i < 5; i++ {
		ok := cb.Allow()
		fmt.Printf("Attempt %d: %v\n", i+1, ok)
		if !ok {
			cb.Failure()
		}
	}
}