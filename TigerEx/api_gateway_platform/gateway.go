package main

import (
	"fmt"
	"time"
)

// Rate limit tier
type RateLimitTier int

const (
	TierFree RateLimitTier = 100
	TierBasic RateLimitTier = 1000
	TierPro RateLimitTier = 10000
)

// Request tracked
type Request struct {
	Key    string
	Time  int64
	Count int
}

// Circuit state
type CircuitState int

const (
	CircuitClosed CircuitState = iota
	CircuitOpen
	CircuitHalfOpen
)

// API Gateway
type APIGateway struct {
	RateLimits map[string]int
	Requests  map[string][]int64
	Circuit   CircuitState
	Errors    int
}

// New creates gateway
func NewAPIGateway() *APIGateway {
	return &APIGateway{
		RateLimits: make(map[string]int),
		Requests: make(map[string][]int64),
		Circuit: CircuitClosed,
	}
}

// Check rate limit
func (g *APIGateway) CheckRateLimit(apiKey string, tier RateLimitTier) bool {
	now := time.Now().UnixMilli()
	minTime := now - 60000
	
	reqs := g.Requests[apiKey]
	var validReqs []int64
	for _, t := range reqs {
		if t > minTime {
			validReqs = append(validReqs, t)
		}
	}
	
	g.Requests[apiKey] = validReqs
	
	if len(validReqs) >= int(tier) {
		return false
	}
	
	g.Requests[apiKey] = append(validReqs, now)
	return true
}

// Circuit breaker
func (g *APIGateway) RecordError() {
	g.Errors++
	if g.Errors > 10 {
		g.Circuit = CircuitOpen
	}
}

func (g *APIGateway) Reset() {
	g.Errors = 0
	g.Circuit = CircuitClosed
}

func main() {
	gw := NewAPIGateway()
	
	ok := gw.CheckRateLimit("api_key_1", TierBasic)
	fmt.Printf("Rate limited: %v\n", !ok)
	
	gw.RecordError()
	fmt.Printf("Circuit: %d\n", gw.Circuit)
}