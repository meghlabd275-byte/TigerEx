package legacy

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRateLimiterEnforcesBurst(t *testing.T) {
	limiter := NewRateLimiter(100, 2)
	if !limiter.Allow() || !limiter.Allow() {
		t.Fatal("initial burst tokens should be available")
	}
	if limiter.Allow() {
		t.Fatal("rate limiter allowed a request after exhausting its burst")
	}
}

func TestRateLimiterRefillsAtRequestsPerSecond(t *testing.T) {
	limiter := NewRateLimiter(20, 1)
	if !limiter.Allow() {
		t.Fatal("initial token should be available")
	}
	if limiter.Allow() {
		t.Fatal("expected exhausted limiter to deny an immediate request")
	}
	time.Sleep(75 * time.Millisecond)
	if !limiter.Allow() {
		t.Fatal("expected a token to refill at 20 requests per second")
	}
}

func TestRateLimiterRejectsInvalidConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name  string
		rate  int
		burst int
	}{
		{name: "zero rate", rate: 0, burst: 1},
		{name: "negative rate", rate: -1, burst: 1},
		{name: "zero burst", rate: 1, burst: 0},
		{name: "negative burst", rate: 1, burst: -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			limiter := NewRateLimiter(tc.rate, tc.burst)
			if limiter.Allow() {
				t.Fatal("invalid limiter configuration must deny requests")
			}
			limiter.Wait() // Must return rather than hang on invalid configuration.
		})
	}
}

func TestRateLimiterIsSafeUnderConcurrentUse(t *testing.T) {
	const burst = 8
	limiter := NewRateLimiter(1, burst)
	var allowed int64
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if limiter.Allow() {
				atomic.AddInt64(&allowed, 1)
			}
		}()
	}
	wg.Wait()
	if got := atomic.LoadInt64(&allowed); got != burst {
		t.Fatalf("expected exactly %d initial burst permits, got %d", burst, got)
	}
}

func TestNilRateLimiterWaitReturns(t *testing.T) {
	var limiter *RateLimiter
	limiter.Wait()
	if limiter.Allow() {
		t.Fatal("nil limiter must deny requests")
	}
}
