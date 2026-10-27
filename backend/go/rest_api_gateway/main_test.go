package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"golang.org/x/time/rate"
)

// The upstreams in these tests are real HTTP servers. The gateway is exercised
// end to end: a request enters through the router, is authenticated, is
// forwarded over a socket, and the upstream's body comes back to the client.

const testSecret = "0123456789abcdef0123456789abcdef"

// newUpstreamServer starts a test server that echoes a canned JSON body and
// records the path and headers it received.
func newUpstreamServer(t *testing.T, body string) (*httptest.Server, *recordedRequests) {
	t.Helper()
	rec := &recordedRequests{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.add(r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, rec
}

type recordedRequests struct {
	method string
	path   string
	header http.Header
	count  int
}

func (r *recordedRequests) add(req *http.Request) {
	r.method = req.Method
	r.path = req.URL.Path
	r.header = req.Header.Clone()
	r.count++
}

func mustUpstream(t *testing.T, name, raw string) *Upstream {
	t.Helper()
	up, err := newUpstream(name, raw)
	if err != nil {
		t.Fatalf("newUpstream(%s): %v", name, err)
	}
	return up
}

func newTestGateway(t *testing.T, marketData, order, account, wallet *Upstream) (*Gateway, *mux.Router) {
	t.Helper()
	g := NewGateway(marketData, order, account, wallet)
	cfg := &Config{HMACSecret: testSecret, AdminSecret: "admin-token"}
	return g, g.setupRouter(cfg)
}

// sign builds the signature the gateway expects for a request.
func sign(secret, method, path, body string, ts int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d\n%s\n%s\n", ts, method, path)
	mac.Write([]byte(body))
	return hex.EncodeToString(mac.Sum(nil))
}

func signedRequest(t *testing.T, method, path, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	ts := time.Now().UnixMilli()
	req.Header.Set(ApiKeyHeader, "key_1")
	req.Header.Set(TimestampHeader, strconv.FormatInt(ts, 10))
	req.Header.Set(SignatureHeader, sign(testSecret, method, path, body, ts))
	return req
}

// decodeEnvelope reads the gateway's APIResponse envelope.
func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) (int64, string) {
	t.Helper()
	var resp APIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode envelope: %v (body %s)", err, rec.Body.String())
	}
	return resp.Code, resp.Message
}

// TestPublicMarketDataIsProxied checks that a public read reaches the market
// data upstream and its body comes back unchanged. This is the regression test
// for the hardcoded 50000.00 ticker.
func TestPublicMarketDataIsProxied(t *testing.T) {
	body := `{"symbol":"BTCUSDT","lastPrice":"61000.00"}`
	md, rec := newUpstreamServer(t, body)
	_, router := newTestGateway(t, mustUpstream(t, "market data", md.URL), nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v3/ticker/24hr", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status: got %d", res.Code)
	}
	if rec.count != 1 {
		t.Fatalf("upstream was not called: %d", rec.count)
	}
	if !strings.Contains(res.Body.String(), "61000.00") {
		t.Fatalf("upstream body did not reach the client: %s", res.Body.String())
	}
	if strings.Contains(res.Body.String(), "50000") {
		t.Fatal("the fabricated price is still present")
	}
}

// TestMarketDataUnavailableWhenNotConfigured checks the fail-closed path.
func TestMarketDataUnavailableWhenNotConfigured(t *testing.T) {
	_, router := newTestGateway(t, nil, nil, nil, nil)

	for _, path := range []string{
		"/api/v3/exchangeInfo", "/api/v3/ticker/24hr", "/api/v3/depth",
		"/api/v3/trades", "/api/v3/klines", "/fapi/v1/fundingRate", "/fapi/v1/openInterest",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s: want 503, got %d", path, res.Code)
		}
	}
}

// TestUpstreamErrorBecomesUnavailable checks that a failing upstream is
// reported, not masked.
func TestUpstreamErrorBecomesUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, router := newTestGateway(t, mustUpstream(t, "market data", srv.URL), nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v3/ticker/24hr", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", res.Code)
	}
}

// TestOrderIsProxiedAndNotFabricated is the regression test for orders being
// accepted and returned as NEW without being sent anywhere.
func TestOrderIsProxiedAndNotFabricated(t *testing.T) {
	body := `{"symbol":"BTCUSDT","orderId":4242,"status":"FILLED"}`
	order, rec := newUpstreamServer(t, body)
	_, router := newTestGateway(t, nil, mustUpstream(t, "order", order.URL), nil, nil)

	payload := `{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","quantity":"1"}`
	req := signedRequest(t, http.MethodPost, "/api/v3/order", payload)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status: got %d body %s", res.Code, res.Body.String())
	}
	if rec.count != 1 || rec.method != http.MethodPost {
		t.Fatalf("order upstream was not reached: count=%d method=%s", rec.count, rec.method)
	}
	// The body must have been forwarded so the upstream can read it.
	if !strings.Contains(res.Body.String(), "4242") {
		t.Fatalf("order upstream response did not reach the client: %s", res.Body.String())
	}
	// The gateway must pass the caller's credentials through rather than
	// minting its own identity.
	if rec.header.Get(ApiKeyHeader) != "key_1" {
		t.Fatal("API key was not forwarded")
	}
}

// TestOrderUnavailableWhenNotConfigured checks that an order cannot be accepted
// when there is nowhere to send it.
func TestOrderUnavailableWhenNotConfigured(t *testing.T) {
	_, router := newTestGateway(t, nil, nil, nil, nil)

	payload := `{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","quantity":"1"}`
	req := signedRequest(t, http.MethodPost, "/api/v3/order", payload)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", res.Code)
	}
	if strings.Contains(res.Body.String(), "NEW") {
		t.Fatal("the gateway fabricated an order status")
	}
}

// TestUnsignedPrivateRequestsRejected checks that every private endpoint
// demands a valid signature.
func TestUnsignedPrivateRequestsRejected(t *testing.T) {
	order, _ := newUpstreamServer(t, `{}`)
	account, _ := newUpstreamServer(t, `{}`)
	wallet, _ := newUpstreamServer(t, `{}`)
	_, router := newTestGateway(t, nil, mustUpstream(t, "order", order.URL),
		mustUpstream(t, "account", account.URL), mustUpstream(t, "wallet", wallet.URL))

	cases := []struct{ method, path string }{
		{http.MethodPost, "/api/v3/order"},
		{http.MethodDelete, "/api/v3/order"},
		{http.MethodGet, "/api/v3/openOrders"},
		{http.MethodGet, "/api/v3/account"},
		{http.MethodGet, "/sapi/v1/margin/account"},
		{http.MethodGet, "/sapi/v1/margin/positionRisk"},
		{http.MethodGet, "/api/v3/capital/deposit/address/BTC"},
		{http.MethodGet, "/api/v3/capital/withdraw/history"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: want 401, got %d", tc.method, tc.path, res.Code)
		}
	}
}

// TestForgedSignatureRejected checks that a wrong signature is refused.
func TestForgedSignatureRejected(t *testing.T) {
	order, _ := newUpstreamServer(t, `{}`)
	_, router := newTestGateway(t, nil, mustUpstream(t, "order", order.URL), nil, nil)

	body := `{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","quantity":"1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v3/order", strings.NewReader(body))
	req.Header.Set(ApiKeyHeader, "key_1")
	req.Header.Set(TimestampHeader, strconv.FormatInt(time.Now().UnixMilli(), 10))
	req.Header.Set(SignatureHeader, strings.Repeat("ab", 32))

	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", res.Code)
	}
}

// TestSignatureBoundToTimestampAndBody checks that a captured signature cannot
// be replayed with a different timestamp or body.
func TestSignatureBoundToTimestampAndBody(t *testing.T) {
	order, _ := newUpstreamServer(t, `{}`)
	_, router := newTestGateway(t, nil, mustUpstream(t, "order", order.URL), nil, nil)

	body := `{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","quantity":"1"}`
	ts := time.Now().UnixMilli()
	good := sign(testSecret, http.MethodPost, "/api/v3/order", body, ts)

	// Same signature, different body.
	req := httptest.NewRequest(http.MethodPost, "/api/v3/order", strings.NewReader(`{"quantity":"999"}`))
	req.Header.Set(ApiKeyHeader, "key_1")
	req.Header.Set(TimestampHeader, strconv.FormatInt(ts, 10))
	req.Header.Set(SignatureHeader, good)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("altered body: want 401, got %d", res.Code)
	}

	// Same signature, different timestamp.
	req = httptest.NewRequest(http.MethodPost, "/api/v3/order", strings.NewReader(body))
	req.Header.Set(ApiKeyHeader, "key_1")
	req.Header.Set(TimestampHeader, strconv.FormatInt(ts+1000, 10))
	req.Header.Set(SignatureHeader, good)
	res = httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("altered timestamp: want 401, got %d", res.Code)
	}
}

// TestStaleTimestampRejected checks the replay window.
func TestStaleTimestampRejected(t *testing.T) {
	order, _ := newUpstreamServer(t, `{}`)
	_, router := newTestGateway(t, nil, mustUpstream(t, "order", order.URL), nil, nil)

	body := `{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","quantity":"1"}`
	ts := time.Now().Add(-time.Hour).UnixMilli()

	req := httptest.NewRequest(http.MethodPost, "/api/v3/order", strings.NewReader(body))
	req.Header.Set(ApiKeyHeader, "key_1")
	req.Header.Set(TimestampHeader, strconv.FormatInt(ts, 10))
	req.Header.Set(SignatureHeader, sign(testSecret, http.MethodPost, "/api/v3/order", body, ts))

	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", res.Code)
	}
}

// TestAccountIsProxied checks the account read reaches its upstream rather than
// returning made-up balances.
func TestAccountIsProxied(t *testing.T) {
	body := `{"balances":[{"asset":"BTC","free":"0.00000000"}]}`
	account, rec := newUpstreamServer(t, body)
	_, router := newTestGateway(t, nil, nil, mustUpstream(t, "account", account.URL), nil)

	req := signedRequest(t, http.MethodGet, "/api/v3/account", "")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status: got %d", res.Code)
	}
	if rec.count != 1 {
		t.Fatal("account upstream was not reached")
	}
	if strings.Contains(res.Body.String(), "10000.00") {
		t.Fatal("the fabricated balance is still present")
	}
}

// TestDepositAddressIsProxied is the regression test for the hardcoded address.
func TestDepositAddressIsProxied(t *testing.T) {
	body := `{"coin":"BTC","address":"bc1qrealaddress"}`
	wallet, rec := newUpstreamServer(t, body)
	_, router := newTestGateway(t, nil, nil, nil, mustUpstream(t, "wallet", wallet.URL))

	req := signedRequest(t, http.MethodGet, "/api/v3/capital/deposit/address/BTC", "")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status: got %d", res.Code)
	}
	if rec.path != "/api/v3/capital/deposit/address" {
		t.Fatalf("upstream path: got %q", rec.path)
	}
	if !strings.Contains(res.Body.String(), "bc1qrealaddress") {
		t.Fatalf("wallet upstream response did not reach the client: %s", res.Body.String())
	}
	if strings.Contains(res.Body.String(), "0x742d35Cc6634C0532925a3b00BcF12fA2a5d5aE1") {
		t.Fatal("the fabricated address is still present")
	}
}

// TestPingAndTimeAreServed checks the two endpoints the gateway owns.
func TestPingAndTimeAreServed(t *testing.T) {
	_, router := newTestGateway(t, nil, nil, nil, nil)

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v3/ping", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("ping: got %d", res.Code)
	}

	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v3/time", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("time: got %d", res.Code)
	}
	var resp APIResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data, ok := resp.Data.(map[string]interface{})
	if !ok || data["serverTime"] == nil {
		t.Fatalf("time response has no serverTime: %s", res.Body.String())
	}
}

// TestHealthReportsUpstreamState checks the health endpoint is honest about
// what is configured.
func TestHealthReportsUpstreamState(t *testing.T) {
	md, _ := newUpstreamServer(t, `{}`)
	_, router := newTestGateway(t, mustUpstream(t, "market data", md.URL), nil, nil, nil)

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("health: got %d", res.Code)
	}
	body := res.Body.String()
	if !strings.Contains(body, `"marketData":"configured"`) {
		t.Fatalf("market data not reported as configured: %s", body)
	}
	if !strings.Contains(body, `"order":"not_configured"`) {
		t.Fatalf("order not reported as unconfigured: %s", body)
	}
}

// TestMetricsRequireAdmin checks the metrics endpoint is gated.
func TestMetricsRequireAdmin(t *testing.T) {
	_, router := newTestGateway(t, nil, nil, nil, nil)

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("no token: want 401, got %d", res.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	res = httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: want 401, got %d", res.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer admin-token")
	res = httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("valid token: want 200, got %d", res.Code)
	}
}

// TestPathTraversalRejected checks that a stream name cannot escape the
// upstream base.
func TestPathTraversalRejected(t *testing.T) {
	md, _ := newUpstreamServer(t, `{}`)
	up := mustUpstream(t, "market data", md.URL)

	for _, bad := range []string{"/../admin", "/a//b", "relative"} {
		if _, err := up.resolve(bad); err == nil {
			t.Fatalf("path %q was accepted", bad)
		}
	}
	if _, err := up.resolve("/ws/btcusdt"); err != nil {
		t.Fatalf("valid path rejected: %v", err)
	}
}

// TestNewUpstreamValidation checks the configuration validation.
func TestNewUpstreamValidation(t *testing.T) {
	for _, bad := range []string{"", "not a url", "ftp://example.com", "http://"} {
		if _, err := newUpstream("x", bad); err == nil {
			t.Fatalf("upstream %q was accepted", bad)
		}
	}
	if _, err := newUpstream("x", "https://api.example.com"); err != nil {
		t.Fatalf("valid upstream rejected: %v", err)
	}
}

// TestLoadConfigRequiresSecrets checks that the gateway refuses to start
// without TLS material and a signing secret.
func TestLoadConfigRequiresSecrets(t *testing.T) {
	t.Setenv("TIGEREX_TLS_CERT_FILE", "")
	t.Setenv("TIGEREX_TLS_KEY_FILE", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("missing TLS files were accepted")
	}

	t.Setenv("TIGEREX_TLS_CERT_FILE", "cert.pem")
	t.Setenv("TIGEREX_TLS_KEY_FILE", "key.pem")
	t.Setenv("TIGEREX_API_HMAC_SECRET", "short")
	if _, err := loadConfig(); err == nil {
		t.Fatal("a short HMAC secret was accepted")
	}
}

// TestRateLimitAppliesPerKey checks the limiter is keyed on the API key.
func TestRateLimitAppliesPerKey(t *testing.T) {
	rateLimitersMu.Lock()
	rateLimiters = make(map[string]*rate.Limiter)
	rateLimitersMu.Unlock()

	if !checkRateLimit("key_a") {
		t.Fatal("first request for a key was rejected")
	}
	// A different key gets its own bucket.
	if !checkRateLimit("key_b") {
		t.Fatal("a second key shared the first key's bucket")
	}
}

// TestWebsocketUnavailableWithoutUpstream checks the fail-closed path.
func TestWebsocketUnavailableWithoutUpstream(t *testing.T) {
	_, router := newTestGateway(t, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/ws/btcusdt", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d", res.Code)
	}
}
