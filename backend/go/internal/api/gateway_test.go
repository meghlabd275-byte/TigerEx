package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnconfiguredMarketDataFailsClosed(t *testing.T) {
	for name, handler := range map[string]Handler{
		"ticker": hTicker,
		"depth":  hDepth,
		"trades": hTrades,
	} {
		t.Run(name, func(t *testing.T) {
			resp := handler(&Request{})
			if resp.Success || resp.Status != http.StatusServiceUnavailable {
				t.Fatalf("expected unavailable response, got success=%v status=%d", resp.Success, resp.Status)
			}
		})
	}
}

func TestTradingAndLedgerOperationsFailClosed(t *testing.T) {
	for name, handler := range map[string]Handler{
		"create_order": hCreateOrder,
		"cancel_order": hCancelOrder,
		"get_order":    hGetOrder,
		"open_orders":  hOpenOrders,
		"balance":      hBalance,
		"deposit_addr": hDepositAddr,
		"withdrawals":  hWithdrawHistory,
	} {
		t.Run(name, func(t *testing.T) {
			resp := handler(&Request{UserID: "test-user"})
			if resp.Success || resp.Status != http.StatusServiceUnavailable {
				t.Fatalf("expected unavailable response, got success=%v status=%d", resp.Success, resp.Status)
			}
		})
	}
}

func TestClientSuppliedUserIDDoesNotAuthenticate(t *testing.T) {
	server := NewServer("127.0.0.1", 0)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/balance", nil)
	req.Header.Set("X-User-ID", "admin")
	recorder := httptest.NewRecorder()

	server.router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unverified identity, got %d", recorder.Code)
	}
}

func TestUnconfiguredCORSRejectsForeignOrigin(t *testing.T) {
	t.Setenv("CORS_ORIGIN", "")
	server := NewServer("127.0.0.1", 0)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ticker/BTCUSDT", nil)
	req.Header.Set("Origin", "https://attacker.example")
	recorder := httptest.NewRecorder()

	server.router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unconfigured origin, got %d", recorder.Code)
	}
}
