package multilang

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProbeEndpointReportsReachableBackends(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if !probeEndpoint(srv.URL) {
		t.Fatalf("probeEndpoint(%q) = false, want true", srv.URL)
	}
}

func TestProbeEndpointFailsClosed(t *testing.T) {
	// A closed port, an unsupported scheme and a malformed URL must all be
	// reported as unhealthy rather than optimistically assumed healthy.
	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := closed.URL
	closed.Close()

	cases := []string{
		closedURL,
		"ftp://example.invalid",
		"::not-a-url::",
	}
	for _, c := range cases {
		if probeEndpoint(c) {
			t.Fatalf("probeEndpoint(%q) = true, want false", c)
		}
	}
}

func TestProbeEndpointRejectsNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if probeEndpoint(srv.URL) {
		t.Fatalf("probeEndpoint(%q) = true, want false for a 500 response", srv.URL)
	}
}

func TestHealthCheckMarksUnreachableBackendUnhealthy(t *testing.T) {
	// A backend pointing at a closed port must end up unhealthy; the old
	// implementation always set HealthStatus = true.
	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := closed.URL
	closed.Close()

	router := NewRouter()
	router.RegisterAPI(APIConfig{
		Name:              "probe_api",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {Enabled: true, Endpoint: closedURL},
		},
	})

	router.HealthCheck()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m := router.GetMetrics("probe_api")[LanguageGo]
		m.mu.RLock()
		status := m.HealthStatus
		m.mu.RUnlock()
		if !status {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("backend with an unreachable endpoint stayed healthy")
}

func TestHealthCheckMarksReachableBackendHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	router := NewRouter()
	router.RegisterAPI(APIConfig{
		Name:              "live_api",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {Enabled: true, Endpoint: srv.URL},
		},
	})

	// Force the metric unhealthy first so the assertion proves the probe
	// flipped it back, not that it started healthy.
	m := router.GetMetrics("live_api")[LanguageGo]
	m.mu.Lock()
	m.HealthStatus = false
	m.mu.Unlock()

	router.HealthCheck()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.RLock()
		status := m.HealthStatus
		m.mu.RUnlock()
		if status {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("reachable backend was not marked healthy")
}
