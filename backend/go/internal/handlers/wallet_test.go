package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestGetUserIDReadsOnlyTheAuthenticatedContext(t *testing.T) {
	userID := uuid.New()

	// No authentication: absent.
	req := httptest.NewRequest(http.MethodGet, "/api/wallets/balance?user_id="+uuid.New().String(), nil)
	if got, ok := GetUserID(req); ok || got != uuid.Nil {
		t.Fatalf("GetUserID returned (%v, %v) for an unauthenticated request", got, ok)
	}

	// A query parameter must never be honoured as identity.
	req.Header.Set("X-User-ID", uuid.New().String())
	if _, ok := GetUserID(req); ok {
		t.Fatal("GetUserID trusted a client-supplied header")
	}

	// Once the middleware stores the id, it is returned.
	authed := req.WithContext(WithUserID(req.Context(), userID))
	got, ok := GetUserID(authed)
	if !ok || got != userID {
		t.Fatalf("GetUserID = (%v, %v), want (%v, true)", got, ok, userID)
	}

	// The nil UUID is not a valid identity.
	nilCtx := req.WithContext(WithUserID(req.Context(), uuid.Nil))
	if _, ok := GetUserID(nilCtx); ok {
		t.Fatal("GetUserID accepted the nil UUID as an identity")
	}
}

func TestWalletBalanceRequiresAuthentication(t *testing.T) {
	handler := &WalletHandler{}

	// A caller supplying another account's user_id must be refused, not served.
	req := httptest.NewRequest(http.MethodGet, "/api/wallets/balance?user_id="+uuid.New().String()+"&token=BTC", nil)
	rec := httptest.NewRecorder()
	handler.GetBalance(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GetBalance status = %d, want 401 for an unauthenticated request", rec.Code)
	}
}

func TestWalletBalancesRequireAuthentication(t *testing.T) {
	handler := &WalletHandler{}

	req := httptest.NewRequest(http.MethodGet, "/api/wallets?user_id="+uuid.New().String(), nil)
	rec := httptest.NewRecorder()
	handler.GetAllBalances(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GetAllBalances status = %d, want 401 for an unauthenticated request", rec.Code)
	}
}
