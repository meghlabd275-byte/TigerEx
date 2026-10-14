package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLoadJWTSecretRejectsMissingAndPlaceholderSecrets(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	if err := LoadJWTSecret(); err == nil {
		t.Fatal("expected missing JWT_SECRET to be rejected")
	}

	t.Setenv("JWT_SECRET", "tigerex-jwt-secret-change-in-production-0123456789")
	if err := LoadJWTSecret(); err == nil {
		t.Fatal("expected placeholder JWT_SECRET to be rejected")
	}
}

func TestLoadJWTSecretAcceptsConfiguredHighEntropyLength(t *testing.T) {
	t.Setenv("JWT_SECRET", "this-is-a-test-secret-with-more-than-32-bytes")
	if err := LoadJWTSecret(); err != nil {
		t.Fatalf("expected configured secret to load, got: %v", err)
	}
	if len(JWTSecret) < 32 {
		t.Fatalf("loaded secret is too short: %d bytes", len(JWTSecret))
	}
}

func TestCORSRejectsUnlistedOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CORS_ORIGIN", "https://app.tigerex.example, https://admin.tigerex.example")

	router := gin.New()
	router.Use(CORS())
	router.GET("/health", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://attacker.example")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected unlisted origin to receive 403, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unlisted origin must not receive CORS permission, got %q", got)
	}
}

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CORS_ORIGIN", "https://app.tigerex.example, https://admin.tigerex.example")

	router := gin.New()
	router.Use(CORS())
	router.GET("/health", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://admin.tigerex.example")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected configured origin to pass, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "https://admin.tigerex.example" {
		t.Fatalf("unexpected allow-origin value: %q", got)
	}
}
