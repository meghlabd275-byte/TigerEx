package main

import (
	"testing"
	"time"
	"net/http"
	"net/http/httptest"
	"os"

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

func TestOriginValidationRequiresExactOriginOrExplicitAllowlist(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://exchange.example/ws", nil)
	if !isAllowedOrigin(req, "http://exchange.example") {
		t.Fatal("same origin should be allowed")
	}
	if isAllowedOrigin(req, "http://exchange.example:8080") {
		t.Fatal("same hostname on a different port must not be allowed")
	}
	if isAllowedOrigin(req, "https://exchange.example") {
		t.Fatal("scheme mismatch must not be allowed without explicit configuration")
	}
	if isAllowedOrigin(req, "http://exchange.example.evil.invalid") {
		t.Fatal("lookalike origin must not be allowed")
	}
	if isAllowedOrigin(req, "http://exchange.example/path") {
		t.Fatal("non-origin URL path must not be accepted")
	}
	if !isAllowedOrigin(req, "") {
		t.Fatal("native clients without Origin should remain supported")
	}

	t.Setenv("WS_ALLOWED_ORIGINS", "https://trade.example, https://admin.example")
	if !isAllowedOrigin(req, "https://trade.example") {
		t.Fatal("explicitly configured reverse-proxy origin should be allowed")
	}
	if isAllowedOrigin(req, "https://attacker.example") {
		t.Fatal("origin outside allowlist must be rejected")
	}
	_ = os.Getenv("WS_ALLOWED_ORIGINS")
}
