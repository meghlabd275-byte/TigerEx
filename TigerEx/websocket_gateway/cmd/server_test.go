package main

import (
	"testing"
	"time"

	"tigerex/websocket_gateway/internal/config"
)

func TestClientTokenBucketEnforcesBurstAndRefills(t *testing.T) {
	cfg := &config.Config{RateLimit: config.RateLimitConfig{MessagesPerSecond: 2, BurstSize: 3}}
	client := &Client{owner: &Server{config: cfg}, rateTokens: 3, rateLast: time.Unix(100, 0)}
	now := time.Unix(100, 0)
	for i := 0; i < 3; i++ {
		if !client.allowMessage(now) {
			t.Fatalf("message %d within burst was rejected", i+1)
		}
	}
	if client.allowMessage(now) {
		t.Fatal("message beyond burst was accepted")
	}
	if !client.allowMessage(now.Add(500 * time.Millisecond)) {
		t.Fatal("one token should have refilled after 500ms at 2 messages/second")
	}
	if client.allowMessage(now.Add(500 * time.Millisecond)) {
		t.Fatal("second message at same timestamp should be rate-limited")
	}
}

func TestClientTokenBucketFailsClosedForInvalidLimits(t *testing.T) {
	for _, cfg := range []*config.Config{
		{RateLimit: config.RateLimitConfig{MessagesPerSecond: 0, BurstSize: 5}},
		{RateLimit: config.RateLimitConfig{MessagesPerSecond: 5, BurstSize: 0}},
	} {
		client := &Client{owner: &Server{config: cfg}, rateTokens: 5, rateLast: time.Unix(100, 0)}
		if client.allowMessage(time.Unix(100, 0)) {
			t.Fatal("message accepted with invalid rate-limit configuration")
		}
	}
}
