// TigerEx REST API Gateway.
//
// This gateway is an authentication and routing shell in front of the trading
// backends. It owns no market data, no order book, no balances, and no order
// state. Every read is proxied to the service that owns the data, and every
// write is proxied to the service that owns the operation. When an upstream is
// not configured or is unreachable, the endpoint answers 503 rather than
// inventing a response.
//
// The previous implementation did the opposite. It returned a hardcoded BTC
// price of 50000.00 from the ticker endpoint, a fixed deposit address, made-up
// balances of "1.0 BTC / 10000.00 USDT" for every caller, and it accepted an
// order, assigned it an id, and returned status NEW without sending it
// anywhere. A client could not tell a real fill from a fabricated one, which is
// the most dangerous thing an exchange API can do.

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

const (
	ApiVersion = "v1.0.0"
	ApiName    = "TigerEx REST API Gateway"

	// RequestsPerSecond and BurstLimit bound the per-key request rate.
	RequestsPerSecond = 1000
	BurstLimit        = 2000

	ReadTimeout  = 15 * time.Second
	WriteTimeout = 15 * time.Second
	IdleTimeout  = 60 * time.Second

	// MaxRequestSize caps the request body the gateway will read.
	MaxRequestSize = 10 * 1024 * 1024

	// MaxConcurrentReqs caps in-flight requests.
	MaxConcurrentReqs = 100000

	// maxUpstreamBody caps how much of an upstream response the gateway will
	// buffer. The gateway streams or rejects anything larger.
	maxUpstreamBody = 32 * 1024 * 1024

	// signatureWindow is how far a request timestamp may drift from now.
	signatureWindow = 5 * time.Second

	ApiKeyHeader    = "X-TigerEx-API-Key"
	SignatureHeader = "X-TigerEx-Signature"
	TimestampHeader = "X-TigerEx-Timestamp"
)

// Config is the gateway's runtime configuration. Every upstream is required;
// there are no defaults that point at a fabricated source.
type Config struct {
	HTTPAddr    string
	TLSAddr     string
	CertFile    string
	KeyFile     string
	MarketData  string
	Order       string
	Account     string
	Wallet      string
	AdminSecret string
	HMACSecret  string
	WSOrigins   []string
}

func loadConfig() (*Config, error) {
	cfg := &Config{
		HTTPAddr:    getEnv("TIGEREX_HTTP_ADDR", ":8080"),
		TLSAddr:     getEnv("TIGEREX_TLS_ADDR", ":8443"),
		CertFile:    os.Getenv("TIGEREX_TLS_CERT_FILE"),
		KeyFile:     os.Getenv("TIGEREX_TLS_KEY_FILE"),
		MarketData:  os.Getenv("TIGEREX_MARKETDATA_URL"),
		Order:       os.Getenv("TIGEREX_ORDER_SERVICE_URL"),
		Account:     os.Getenv("TIGEREX_ACCOUNT_SERVICE_URL"),
		Wallet:      os.Getenv("TIGEREX_WALLET_SERVICE_URL"),
		AdminSecret: os.Getenv("TIGEREX_ADMIN_TOKEN"),
		HMACSecret:  os.Getenv("TIGEREX_API_HMAC_SECRET"),
	}

	// TLS is mandatory: the previous server called ListenAndServeTLS("", ""),
	// which fails, and then fell through to plaintext on :8080 with no TLS at
	// all.
	if cfg.CertFile == "" || cfg.KeyFile == "" {
		return nil, errors.New("TIGEREX_TLS_CERT_FILE and TIGEREX_TLS_KEY_FILE are required")
	}
	if _, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile); err != nil {
		return nil, fmt.Errorf("loading TLS key pair: %w", err)
	}

	// A shared secret is required to verify request signatures. Without it the
	// gateway could not authenticate any write.
	if len(cfg.HMACSecret) < 32 {
		return nil, errors.New("TIGEREX_API_HMAC_SECRET must be at least 32 bytes")
	}

	for _, origin := range strings.Split(os.Getenv("TIGEREX_CORS_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" && origin != "*" {
			cfg.WSOrigins = append(cfg.WSOrigins, origin)
		}
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

var (
	rateLimiters   = make(map[string]*rate.Limiter)
	rateLimitersMu sync.RWMutex

	totalRequests uint64
	activeConns   uint64
	rejectedReqs  uint64
)

// ============================================================================
// RESPONSE SHAPES
// ============================================================================

// APIResponse is the gateway's envelope. It deliberately mirrors the common
// exchange shape so existing clients keep working.
type APIResponse struct {
	Code    int64       `json:"code"`
	Message string      `json:"msg"`
	Data    interface{} `json:"data,omitempty"`
}

func writeSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-API-Version", ApiVersion)
	_ = json.NewEncoder(w).Encode(APIResponse{Code: 0, Message: "OK", Data: data})
}

func writeError(w http.ResponseWriter, status int, code int64, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{Code: code, Message: message})
}

// ============================================================================
// UPSTREAM CLIENT
// ============================================================================

// Upstream is a single backend the gateway proxies to.
type Upstream struct {
	Name string
	base *url.URL
}

// newUpstream validates a configured base URL. A malformed URL is a
// configuration error, not a runtime surprise.
func newUpstream(name, raw string) (*Upstream, error) {
	if raw == "" {
		return nil, fmt.Errorf("%s upstream URL is not configured", name)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s upstream URL is invalid: %w", name, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%s upstream URL must be http or https", name)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("%s upstream URL has no host", name)
	}
	return &Upstream{Name: name, base: u}, nil
}

// resolve joins the upstream base with a path. It rejects a path that would
// escape the base (for example one containing ".." or "//"), so a caller cannot
// redirect the gateway at an arbitrary host.
func (u *Upstream) resolve(path string) (string, error) {
	if !strings.HasPrefix(path, "/") {
		return "", errors.New("upstream path must be absolute")
	}
	if strings.Contains(path, "..") || strings.Contains(path, "//") {
		return "", errors.New("upstream path contains a traversal segment")
	}
	ref, err := url.Parse(path)
	if err != nil {
		return "", err
	}
	return u.base.ResolveReference(ref).String(), nil
}

// ErrUpstreamNotConfigured is returned when an endpoint has no upstream.
var ErrUpstreamNotConfigured = errors.New("upstream service is not configured")

// Gateway holds the configured upstreams and the HTTP client used to reach
// them.
type Gateway struct {
	marketData *Upstream
	order      *Upstream
	account    *Upstream
	wallet     *Upstream
	client     *http.Client
}

// NewGateway builds a gateway. A nil upstream leaves the endpoints that need it
// answering 503.
func NewGateway(marketData, order, account, wallet *Upstream) *Gateway {
	return &Gateway{
		marketData: marketData,
		order:      order,
		account:    account,
		wallet:     wallet,
		client: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// proxy forwards the request to the given upstream and streams the response
// back. It never synthesises a body: on any failure the client receives 502 or
// 503 with an explicit message.
func (g *Gateway) proxy(up *Upstream, path string, w http.ResponseWriter, r *http.Request) {
	if up == nil {
		writeError(w, http.StatusServiceUnavailable, 503, ErrUpstreamNotConfigured.Error())
		return
	}

	target, err := up.resolve(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, 500, "invalid upstream path")
		return
	}

	var body io.Reader
	if r.Body != nil {
		body = io.LimitReader(r.Body, MaxRequestSize)
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, 500, "could not build upstream request")
		return
	}
	req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	req.Header.Set("Accept", "application/json")
	// Pass through the credential headers the upstream also verifies. The
	// gateway does not mint identities.
	for _, h := range []string{ApiKeyHeader, SignatureHeader, TimestampHeader, "Authorization"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}

	resp, err := g.client.Do(req)
	if err != nil {
		// A timeout or connection failure is reported as unavailable rather
		// than as an empty success.
		writeError(w, http.StatusServiceUnavailable, 503, "upstream "+up.Name+" is unavailable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		writeError(w, http.StatusServiceUnavailable, 503, "upstream "+up.Name+" returned an error")
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, maxUpstreamBody))
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

func securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("Referrer-Policy", "no-referrer")

		if r.ContentLength > MaxRequestSize {
			writeError(w, http.StatusRequestEntityTooLarge, 413, "Request too large")
			return
		}

		if atomic.LoadUint64(&activeConns) >= uint64(MaxConcurrentReqs) {
			atomic.AddUint64(&rejectedReqs, 1)
			writeError(w, http.StatusTooManyRequests, 429, "Too many requests")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		atomic.AddUint64(&totalRequests, 1)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				writeError(w, http.StatusInternalServerError, 500, "Internal server error")
				log.Printf("PANIC: %v", rec)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// rateLimitMiddleware applies a per-identity token bucket.
func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get(ApiKeyHeader)
		if key == "" {
			key = r.RemoteAddr
		}
		if !checkRateLimit(key) {
			atomic.AddUint64(&rejectedReqs, 1)
			writeError(w, http.StatusTooManyRequests, 429, "Rate limit exceeded")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func checkRateLimit(key string) bool {
	rateLimitersMu.RLock()
	limiter, exists := rateLimiters[key]
	rateLimitersMu.RUnlock()
	if exists {
		return limiter.Allow()
	}

	rateLimitersMu.Lock()
	defer rateLimitersMu.Unlock()
	if limiter, exists = rateLimiters[key]; exists {
		return limiter.Allow()
	}
	limiter = rate.NewLimiter(rate.Limit(RequestsPerSecond), BurstLimit)
	rateLimiters[key] = limiter
	return limiter.Allow()
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

// authContext carries the verified identity for the request.
type authContext struct {
	APIKey string
	UserID string
}

type ctxKey int

const authCtxKey ctxKey = 0

// verifyRequest authenticates a signed request:
//
//   - the API key header is present,
//   - the timestamp header is present and within the drift window,
//   - the signature is HMAC-SHA256 over "timestamp.method.path.body",
//   - the signature matches in constant time.
//
// The timestamp is inside the signed material, so a captured request cannot be
// replayed later with a fresh timestamp.
func verifyRequest(r *http.Request, secret []byte) (*authContext, error) {
	apiKey := r.Header.Get(ApiKeyHeader)
	sig := r.Header.Get(SignatureHeader)
	tsRaw := r.Header.Get(TimestampHeader)
	if apiKey == "" || sig == "" || tsRaw == "" {
		return nil, errors.New("missing authentication headers")
	}

	ts, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return nil, errors.New("invalid timestamp header")
	}
	drift := time.Since(time.UnixMilli(ts))
	if drift < -signatureWindow || drift > signatureWindow {
		return nil, errors.New("request timestamp outside the allowed window")
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, MaxRequestSize))
	if err != nil {
		return nil, errors.New("could not read request body")
	}
	// Restore the body so the proxy can forward it.
	r.Body = io.NopCloser(strings.NewReader(string(body)))

	mac := hmac.New(sha256.New, secret)
	fmt.Fprintf(mac, "%s\n%s\n%s\n", tsRaw, r.Method, r.URL.Path)
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))

	if subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(sig))) != 1 {
		return nil, errors.New("signature verification failed")
	}

	return &authContext{APIKey: apiKey}, nil
}

// requireSignature wraps a handler that must be signed. It is applied to every
// endpoint that reads private data or moves funds.
func (g *Gateway) requireSignature(secret []byte, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, err := verifyRequest(r, secret)
		if err != nil {
			writeError(w, http.StatusUnauthorized, 401, "unauthorized")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), authCtxKey, auth)))
	}
}

// requireAdmin gates operational endpoints on a bearer token compared in
// constant time.
func requireAdmin(token string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if token == "" {
			writeError(w, http.StatusServiceUnavailable, 503, "admin token is not configured")
			return
		}
		header := r.Header.Get("Authorization")
		presented := strings.TrimPrefix(header, "Bearer ")
		if presented == header || subtle.ConstantTimeCompare([]byte(presented), []byte(token)) != 1 {
			writeError(w, http.StatusUnauthorized, 401, "unauthorized")
			return
		}
		next(w, r)
	}
}

// ============================================================================
// PUBLIC HANDLERS
// ============================================================================

func (g *Gateway) pingHandler(w http.ResponseWriter, _ *http.Request) {
	writeSuccess(w, map[string]interface{}{})
}

func (g *Gateway) timeHandler(w http.ResponseWriter, _ *http.Request) {
	writeSuccess(w, map[string]interface{}{"serverTime": time.Now().UnixMilli()})
}

func (g *Gateway) exchangeInfoHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/api/v3/exchangeInfo", w, r)
}

func (g *Gateway) ticker24Handler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/api/v3/ticker/24hr", w, r)
}

func (g *Gateway) depthHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/api/v3/depth", w, r)
}

func (g *Gateway) tradesHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/api/v3/trades", w, r)
}

func (g *Gateway) klinesHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/api/v3/klines", w, r)
}

func (g *Gateway) fundingRateHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/fapi/v1/fundingRate", w, r)
}

func (g *Gateway) openInterestHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.marketData, "/fapi/v1/openInterest", w, r)
}

// ============================================================================
// PRIVATE HANDLERS
// ============================================================================

func (g *Gateway) newOrderHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.order, "/api/v3/order", w, r)
}

func (g *Gateway) cancelOrderHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.order, "/api/v3/order", w, r)
}

func (g *Gateway) openOrdersHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.order, "/api/v3/openOrders", w, r)
}

func (g *Gateway) accountHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.account, "/api/v3/account", w, r)
}

func (g *Gateway) marginAccountHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.account, "/sapi/v1/margin/account", w, r)
}

func (g *Gateway) marginPositionHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.account, "/sapi/v1/margin/positionRisk", w, r)
}

func (g *Gateway) depositAddressHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.wallet, "/api/v3/capital/deposit/address", w, r)
}

func (g *Gateway) withdrawHistoryHandler(w http.ResponseWriter, r *http.Request) {
	g.proxy(g.wallet, "/api/v3/capital/withdraw/history", w, r)
}

// ============================================================================
// WEBSOCKET
// ============================================================================

// wsHandler upgrades a client connection and forwards the subscription to the
// market data websocket. The gateway does not generate events of its own.
func (g *Gateway) wsHandler(w http.ResponseWriter, r *http.Request) {
	if g.marketData == nil {
		writeError(w, http.StatusServiceUnavailable, 503, ErrUpstreamNotConfigured.Error())
		return
	}

	target, err := g.marketData.resolve("/ws/" + mux.Vars(r)["stream"])
	if err != nil {
		writeError(w, http.StatusBadRequest, 400, "invalid stream")
		return
	}

	upstreamURL, err := url.Parse(target)
	if err != nil {
		writeError(w, http.StatusInternalServerError, 500, "invalid upstream stream")
		return
	}
	switch upstreamURL.Scheme {
	case "http":
		upstreamURL.Scheme = "ws"
	case "https":
		upstreamURL.Scheme = "wss"
	default:
		writeError(w, http.StatusInternalServerError, 500, "unsupported upstream scheme")
		return
	}

	upgrader := websocket.Upgrader{
		HandshakeTimeout: 10 * time.Second,
		ReadBufferSize:   4096,
		WriteBufferSize:  4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				// Non-browser clients do not send Origin; browsers always do.
				return true
			}
			for _, allowed := range allowedOrigins() {
				if origin == allowed {
					return true
				}
			}
			return false
		},
	}

	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	upstreamConn, _, err := websocket.DefaultDialer.Dial(upstreamURL.String(), nil)
	if err != nil {
		_ = clientConn.WriteMessage(websocket.TextMessage, []byte(`{"error":"market data stream unavailable"}`))
		return
	}
	defer upstreamConn.Close()

	atomic.AddUint64(&activeConns, 1)
	defer atomic.AddUint64(&activeConns, ^uint64(0))

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(2)

	// Client to upstream.
	go func() {
		defer wg.Done()
		defer cancel()
		for {
			msgType, msg, err := clientConn.ReadMessage()
			if err != nil {
				return
			}
			if err := upstreamConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// Upstream to client.
	go func() {
		defer wg.Done()
		defer cancel()
		for {
			msgType, msg, err := upstreamConn.ReadMessage()
			if err != nil {
				return
			}
			if err := clientConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	<-ctx.Done()
	_ = clientConn.Close()
	_ = upstreamConn.Close()
	wg.Wait()
}

func allowedOrigins() []string {
	var origins []string
	for _, origin := range strings.Split(os.Getenv("TIGEREX_CORS_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" && origin != "*" {
			origins = append(origins, origin)
		}
	}
	return origins
}

// ============================================================================
// ROUTER
// ============================================================================

func (g *Gateway) setupRouter(cfg *Config) *mux.Router {
	router := mux.NewRouter()
	router.Use(loggingMiddleware)
	router.Use(securityMiddleware)
	router.Use(recoveryMiddleware)
	router.Use(rateLimitMiddleware)

	// Market data: public, proxied to the market data service.
	router.HandleFunc("/api/v3/ping", g.pingHandler).Methods("GET")
	router.HandleFunc("/api/v3/time", g.timeHandler).Methods("GET")
	router.HandleFunc("/api/v3/exchangeInfo", g.exchangeInfoHandler).Methods("GET")
	router.HandleFunc("/api/v3/ticker/24hr", g.ticker24Handler).Methods("GET")
	router.HandleFunc("/api/v3/depth", g.depthHandler).Methods("GET")
	router.HandleFunc("/api/v3/trades", g.tradesHandler).Methods("GET")
	router.HandleFunc("/api/v3/klines", g.klinesHandler).Methods("GET")
	router.HandleFunc("/fapi/v1/fundingRate", g.fundingRateHandler).Methods("GET")
	router.HandleFunc("/fapi/v1/openInterest", g.openInterestHandler).Methods("GET")

	// Private endpoints: signed.
	secret := []byte(cfg.HMACSecret)
	router.HandleFunc("/api/v3/order", g.requireSignature(secret, g.newOrderHandler)).Methods("POST")
	router.HandleFunc("/api/v3/order", g.requireSignature(secret, g.cancelOrderHandler)).Methods("DELETE")
	router.HandleFunc("/api/v3/openOrders", g.requireSignature(secret, g.openOrdersHandler)).Methods("GET")
	router.HandleFunc("/api/v3/account", g.requireSignature(secret, g.accountHandler)).Methods("GET")
	router.HandleFunc("/sapi/v1/margin/account", g.requireSignature(secret, g.marginAccountHandler)).Methods("GET")
	router.HandleFunc("/sapi/v1/margin/positionRisk", g.requireSignature(secret, g.marginPositionHandler)).Methods("GET")
	router.HandleFunc("/api/v3/capital/deposit/address/{coin}", g.requireSignature(secret, g.depositAddressHandler)).Methods("GET")
	router.HandleFunc("/api/v3/capital/withdraw/history", g.requireSignature(secret, g.withdrawHistoryHandler)).Methods("GET")

	// Websocket.
	router.HandleFunc("/ws/{stream}", g.wsHandler)

	// Operational endpoints.
	router.HandleFunc("/healthz", g.healthHandler).Methods("GET")
	router.HandleFunc("/metrics", requireAdmin(cfg.AdminSecret, g.metricsHandler)).Methods("GET")

	return router
}

func (g *Gateway) healthHandler(w http.ResponseWriter, _ *http.Request) {
	status := map[string]string{
		"status":     "ok",
		"marketData": upstreamState(g.marketData),
		"order":      upstreamState(g.order),
		"account":    upstreamState(g.account),
		"wallet":     upstreamState(g.wallet),
	}
	writeSuccess(w, status)
}

func upstreamState(u *Upstream) string {
	if u == nil {
		return "not_configured"
	}
	return "configured"
}

func (g *Gateway) metricsHandler(w http.ResponseWriter, _ *http.Request) {
	writeSuccess(w, map[string]interface{}{
		"totalRequests":  atomic.LoadUint64(&totalRequests),
		"activeConns":    atomic.LoadUint64(&activeConns),
		"rejectedReqs":   atomic.LoadUint64(&rejectedReqs),
		"goroutines":     runtime.NumGoroutine(),
		"rateLimiters":   len(rateLimiters),
		"apiVersion":     ApiVersion,
		"runtimeVersion": runtime.Version(),
	})
}

// ============================================================================
// SERVER
// ============================================================================

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("Refusing to start: %v", err)
	}

	// An upstream that is not configured is logged, not defaulted. The
	// endpoints that need it answer 503.
	build := func(name, raw string) *Upstream {
		if raw == "" {
			log.Printf("%s upstream is not configured; its endpoints will answer 503", name)
			return nil
		}
		up, err := newUpstream(name, raw)
		if err != nil {
			log.Fatalf("Refusing to start: %v", err)
		}
		return up
	}

	gw := NewGateway(
		build("market data", cfg.MarketData),
		build("order", cfg.Order),
		build("account", cfg.Account),
		build("wallet", cfg.Wallet),
	)

	router := gw.setupRouter(cfg)

	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
		},
	}

	server := &http.Server{
		Addr:         cfg.TLSAddr,
		Handler:      router,
		ReadTimeout:  ReadTimeout,
		WriteTimeout: WriteTimeout,
		IdleTimeout:  IdleTimeout,
		TLSConfig:    tlsConfig,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	log.Printf("Starting %s v%s", ApiName, ApiVersion)
	log.Printf("TLS listening on %s", server.Addr)

	go func() {
		if err := server.ListenAndServeTLS(cfg.CertFile, cfg.KeyFile); err != nil && err != http.ErrServerClosed {
			log.Fatalf("TLS server error: %v", err)
		}
	}()

	<-stop
	log.Println("Shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
	log.Println("Server stopped")
}
