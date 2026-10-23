package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tigerex/backend/internal/auth"
	"tigerex/backend/internal/config"
	"tigerex/backend/internal/kyc"
	"tigerex/backend/internal/matching"
	"tigerex/backend/internal/security"
	"tigerex/backend/internal/trading"
	"tigerex/backend/internal/wallet"
	"tigerex/backend/pkg/crypto"
)

type testAuthSecurity struct{}

func (testAuthSecurity) HashPassword(p string) (string, error)  { return "hash:" + p, nil }
func (testAuthSecurity) ValidatePassword(p string) error        { return nil }
func (testAuthSecurity) VerifyPassword(p, h string) (bool, error) { return h == "hash:"+p, nil }
func (testAuthSecurity) GenerateAntiPhishingCode(string) string { return "code" }
func (testAuthSecurity) HandleFailedLogin(string, string) error { return nil }
func (testAuthSecurity) IsAccountLocked(string) bool            { return false }
func (testAuthSecurity) ResetFailedLogins(string)               {}

func newTestRouter(t *testing.T) *Router {
	t.Helper()

	secCfg := config.SecurityConfig{
		Enable2FA:          true,
		PasswordMinLength:  8,
		RateLimitEnabled:   false,
		CSRFEnabled:        false,
		EnableIPWhitelist:  false,
		EnableAntiPhishing: true,
		SessionTimeout:     time.Hour,
	}
	cryptoManager := crypto.NewCryptoManager(config.CryptoConfig{AESKeySize: 256, RSAKeySize: 2048})
	securityLayer := security.NewSecurityLayer(secCfg, cryptoManager)

	authService := auth.NewAuthService(config.AuthConfig{
		JWTExpiry:        time.Hour,
		JWTRefreshExpiry: time.Hour,
	}, testAuthSecurity{})

	kycService := kyc.NewKYCService(config.KYCConfig{EnableKYC: true}, securityLayer)
	walletService := wallet.NewWalletService(config.WalletConfig{}, securityLayer, cryptoManager)
	matchingEngine := matching.NewEngine(config.MatchingConfig{OrderBookDepth: 100})
	tradingService := trading.NewTradingService(config.TradingConfig{EnableSpot: true}, matchingEngine, walletService, securityLayer)

	return NewRouter(RouterConfig{
		AuthService:    authService,
		KYCService:     kycService,
		WalletService:  walletService,
		TradingService: tradingService,
		SecurityLayer:  securityLayer,
		Config:         &config.Config{SecurityConfig: secCfg},
	})
}

// registerAndLogin creates a user and returns an access token.
func registerAndLogin(t *testing.T, r *Router) string {
	t.Helper()

	body := `{"email":"alice@example.com","username":"trader","password":"correct-horse"}`
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("register returned %d: %s", rec.Code, rec.Body.String())
	}

	login := `{"login":"alice@example.com","password":"correct-horse"}`
	rec = httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(login)))
	if rec.Code != http.StatusOK {
		t.Fatalf("login returned %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if resp.AccessToken == "" {
		t.Fatalf("login did not return an access token: %s", rec.Body.String())
	}
	return resp.AccessToken
}

// Protected endpoints must reject unauthenticated callers. Previously every
// handler acted on a hardcoded "user-id".
func TestProtectedRoutesRequireAuthentication(t *testing.T) {
	r := newTestRouter(t)

	protected := []struct{ method, path string }{
		{"GET", "/api/v1/wallet/balance"},
		{"POST", "/api/v1/wallet/withdraw"},
		{"GET", "/api/v1/kyc/status"},
		{"POST", "/api/v1/trading/order"},
		{"GET", "/api/v1/trading/orders"},
		{"POST", "/api/v1/auth/2fa/enable"},
	}

	for _, tc := range protected {
		rec := httptest.NewRecorder()
		r.Handler().ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}")))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a token returned %d, want 401", tc.method, tc.path, rec.Code)
		}
	}
}

func TestInvalidBearerTokenRejected(t *testing.T) {
	r := newTestRouter(t)

	req := httptest.NewRequest("GET", "/api/v1/wallet/balance", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token returned %d, want 401", rec.Code)
	}
}

func TestValidTokenGrantsAccess(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	req := httptest.NewRequest("GET", "/api/v1/trading/orders", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated request returned %d: %s", rec.Code, rec.Body.String())
	}
}

// The identity used by a handler must come from the token, not from a header
// or a constant.
func TestIdentityComesFromToken(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	req := httptest.NewRequest("GET", "/api/v1/trading/orders", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-User-ID", "someone-else")
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("request returned %d: %s", rec.Code, rec.Body.String())
	}
}

// Placing a limit order must reach the matching engine and produce a restable
// order rather than a canned identifier.
func TestPlaceLimitOrderIsPersisted(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	order := `{"symbol":"BTC/RUSD","side":"buy","type":"limit","price":100,"quantity":2}`
	req := httptest.NewRequest("POST", "/api/v1/trading/order", strings.NewReader(order))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("place order returned %d: %s", rec.Code, rec.Body.String())
	}

	var placed struct {
		Order struct {
			OrderID string `json:"OrderID"`
		} `json:"order"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &placed); err != nil {
		t.Fatalf("decode order response: %v", err)
	}
	if placed.Order.OrderID == "" || placed.Order.OrderID == "order-123" {
		t.Fatalf("order id was not generated by the engine: %q", placed.Order.OrderID)
	}

	// The order must be visible through the list endpoint.
	req = httptest.NewRequest("GET", "/api/v1/trading/orders", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	var listed struct {
		Orders []struct {
			OrderID string `json:"OrderID"`
		} `json:"orders"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode orders response: %v", err)
	}
	if len(listed.Orders) != 1 || listed.Orders[0].OrderID != placed.Order.OrderID {
		t.Fatalf("placed order not returned by list: %+v", listed.Orders)
	}
}

// The ticker must not invent a price. With no trades the endpoint reports 404.
func TestTickerWithoutTradesReturnsNotFound(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	req := httptest.NewRequest("GET", "/api/v1/market/ticker?symbol=BTC/RUSD", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("ticker without trades returned %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "67000") {
		t.Fatal("ticker returned a fabricated price")
	}
}

// A matched pair must surface the traded price through the ticker.
func TestTickerReflectsMatchedTrade(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	place := func(body string) {
		t.Helper()
		req := httptest.NewRequest("POST", "/api/v1/trading/order", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		r.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("place order returned %d: %s", rec.Code, rec.Body.String())
		}
	}

	place(`{"symbol":"BTC/RUSD","side":"sell","type":"limit","price":100,"quantity":1}`)
	place(`{"symbol":"BTC/RUSD","side":"buy","type":"limit","price":100,"quantity":1}`)

	req := httptest.NewRequest("GET", "/api/v1/market/ticker?symbol=BTC/RUSD", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("ticker returned %d: %s", rec.Code, rec.Body.String())
	}

	var ticker struct {
		Price float64 `json:"price"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ticker); err != nil {
		t.Fatalf("decode ticker: %v", err)
	}
	if ticker.Price != 100 {
		t.Fatalf("ticker price = %v, want 100", ticker.Price)
	}
}

// Endpoints with no backing implementation must fail closed rather than
// returning fabricated success.
func TestUnimplementedEndpointsFailClosed(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	cases := []struct {
		method, path string
	}{
		{"GET", "/api/v1/wallet/history"},
		{"POST", "/api/v1/wallet/internal-transfer"},
		{"POST", "/api/v1/account/contact-change"},
		{"POST", "/api/v1/account/delete-request"},
		{"POST", "/api/v1/auth/2fa/reset"},
		{"POST", "/api/v1/auth/verify-code"},
		{"POST", "/api/v1/auth/identifier/check"},
		{"GET", "/api/v1/market/trades"},
		{"GET", "/api/v1/market/klines"},
		{"POST", "/api/v1/products/operate"},
		{"GET", "/ws"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		r.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Errorf("%s %s returned %d, want 501: %s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
}

// Provider logins cannot be verified in this build, so they must not report a
// bound session.
func TestProviderAuthFailsClosed(t *testing.T) {
	r := newTestRouter(t)

	for _, path := range []string{"/api/v1/auth/social", "/api/v1/auth/metamask", "/api/v1/auth/passkey", "/api/v1/auth/biometric"} {
		req := httptest.NewRequest("POST", path, strings.NewReader(`{"token":"x"}`))
		rec := httptest.NewRecorder()
		r.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Errorf("%s returned %d, want 501: %s", path, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), `"session_bound":true`) {
			t.Errorf("%s claimed a bound session", path)
		}
	}
}

// KYC liveness must report the recorded application state, not a fixed score.
func TestKYCLivenessReportsRecordedState(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	submit := `{"document_type":"passport","document_id":"X123"}`
	req := httptest.NewRequest("POST", "/api/v1/kyc/submit", strings.NewReader(submit))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("kyc submit returned %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest("POST", "/api/v1/kyc/liveness", strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("kyc liveness returned %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode liveness response: %v", err)
	}
	if _, ok := resp["liveness_score"]; ok {
		t.Fatal("liveness handler returned a fabricated score")
	}
	if resp["liveness"] != string(kyc.LivenessPending) {
		t.Fatalf("liveness = %v, want %q", resp["liveness"], kyc.LivenessPending)
	}
}

// Order placement must validate its inputs rather than trusting the payload.
func TestPlaceOrderValidatesInput(t *testing.T) {
	r := newTestRouter(t)
	token := registerAndLogin(t, r)

	cases := []string{
		`{"symbol":"","side":"buy","type":"limit","price":1,"quantity":1}`,
		`{"symbol":"BTC/RUSD","side":"hold","type":"limit","price":1,"quantity":1}`,
		`{"symbol":"BTC/RUSD","side":"buy","type":"limit","price":0,"quantity":1}`,
		`{"symbol":"BTC/RUSD","side":"buy","type":"limit","price":1,"quantity":0}`,
		`{"symbol":"BTC/RUSD","side":"buy","type":"stop_loss","price":1,"quantity":1}`,
	}

	for _, body := range cases {
		req := httptest.NewRequest("POST", "/api/v1/trading/order", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		r.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s returned %d, want 400", body, rec.Code)
		}
	}
}
