package apigateway

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The gateway must forward to the backend and return the backend's response.
// The previous implementation returned a canned 200 JSON body and never
// contacted the backend.
func TestGatewayProxiesToBackend(t *testing.T) {
	var hits int
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Path != "/api/v1/market/BTC" {
			t.Errorf("backend saw the wrong path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"price":42}`)
	}))
	defer backend.Close()

	gw := NewAPIGateway()
	gw.AddRoute("/api/v1/market/.*", backend.URL, []string{"GET"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/BTC", nil)
	rec := httptest.NewRecorder()
	gw.ServeHTTP(rec, req)

	if hits != 1 {
		t.Fatalf("backend was hit %d times, expected 1", hits)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected the backend's status 201, got %d", rec.Code)
	}
	if body := rec.Body.String(); body != `{"price":42}` {
		t.Fatalf("expected the backend's body, got %q", body)
	}
}

// An unreachable backend must surface as 502, never a fake success.
func TestGatewayReturnsBadGatewayWhenBackendDown(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	backendURL := backend.URL
	backend.Close() // nothing is listening now

	gw := NewAPIGateway()
	gw.AddRoute("/api/v1/order/.*", backendURL, []string{"POST"})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/order/new", nil)
	rec := httptest.NewRecorder()
	gw.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 when the backend is down, got %d", rec.Code)
	}
}

// An unregistered route must 404 and a wrong method must 405.
func TestGatewayRouting(t *testing.T) {
	gw := NewAPIGateway()
	gw.AddRoute("/api/v1/market/.*", "http://market-service:8080", []string{"GET"})

	req := httptest.NewRequest(http.MethodGet, "/nothing/here", nil)
	rec := httptest.NewRecorder()
	gw.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an unknown route, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/market/BTC", nil)
	rec = httptest.NewRecorder()
	gw.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for a disallowed method, got %d", rec.Code)
	}
}

// A backend URL that is not http/https must be refused rather than proxied.
func TestProxyForRejectsBadScheme(t *testing.T) {
	gw := NewAPIGateway()
	if _, err := gw.proxyFor("file:///etc/passwd"); err == nil {
		t.Fatal("a non-http backend scheme must be rejected")
	}
	if _, err := gw.proxyFor("://not a url"); err == nil {
		t.Fatal("a malformed backend URL must be rejected")
	}
}

// The rate limiter must reject once the window budget is spent.
func TestRateLimiterBlocks(t *testing.T) {
	rl := NewRateLimiter(3, 60_000_000_000) // 3 per minute

	for i := 0; i < 3; i++ {
		if !rl.Allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if rl.Allow("1.2.3.4") {
		t.Fatal("the fourth request must be rate limited")
	}
	// A different key has its own budget.
	if !rl.Allow("5.6.7.8") {
		t.Fatal("a different client must not be limited")
	}
}
