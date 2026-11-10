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
		if !router.GetMetrics("probe_api")[LanguageGo].HealthStatus {
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
	m := router.metrics["live_api"][LanguageGo]
	m.mu.Lock()
	m.HealthStatus = false
	m.mu.Unlock()

	router.HealthCheck()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if router.GetMetrics("live_api")[LanguageGo].HealthStatus {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("reachable backend was not marked healthy")
}

func TestRecordRequestSnapshotReportsAggregates(t *testing.T) {
	router := NewRouter()
	router.RegisterAPI(APIConfig{
		Name:              "agg_api",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {Enabled: true, Endpoint: "http://localhost:9999"},
		},
	})

	router.RecordRequest("agg_api", LanguageGo, 10*time.Millisecond, true, "")
	router.RecordRequest("agg_api", LanguageGo, 30*time.Millisecond, true, "")
	router.RecordRequest("agg_api", LanguageGo, 20*time.Millisecond, false, "boom")

	snap := router.GetMetrics("agg_api")[LanguageGo]
	if snap.TotalRequests != 3 || snap.SuccessCount != 2 || snap.FailureCount != 1 {
		t.Fatalf("counters wrong: %+v", snap)
	}
	if snap.AvgLatencyNs != int64(20*time.Millisecond) {
		t.Fatalf("avg latency = %d, want %d", snap.AvgLatencyNs, int64(20*time.Millisecond))
	}
	if snap.MinLatency != int64(10*time.Millisecond) || snap.MaxLatency != int64(30*time.Millisecond) {
		t.Fatalf("min/max wrong: %+v", snap)
	}
	if snap.HealthStatus {
		t.Fatal("a failed request must mark the backend unhealthy")
	}
	if snap.LastError != "boom" {
		t.Fatalf("last error = %q, want boom", snap.LastError)
	}
}

func TestHealthCheckHandlerReportsDegradedWhenBackendDown(t *testing.T) {
	router := NewRouter()
	router.RegisterAPI(APIConfig{
		Name:              "down_api",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {Enabled: true, Endpoint: "http://127.0.0.1:1"},
		},
	})

	// A failed probe/request must surface as degraded, not as a false "healthy".
	router.RecordRequest("down_api", LanguageGo, time.Millisecond, false, "unreachable")

	payload, code := healthPayload(router)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status code = %d, want 503", code)
	}
	if payload["status"] != "degraded" {
		t.Fatalf("status = %v, want degraded", payload["status"])
	}
}

func TestHealthCheckHandlerHealthyWhenAllBackendsUp(t *testing.T) {
	router := NewRouter()
	router.RegisterAPI(APIConfig{
		Name:              "up_api",
		Category:          CategoryHighPerformance,
		PreferredLanguage: LanguageGo,
		AvailableLanguages: map[Language]LanguageConfig{
			LanguageGo: {Enabled: true, Endpoint: "http://localhost:9999"},
		},
	})

	router.RecordRequest("up_api", LanguageGo, time.Millisecond, true, "")

	payload, code := healthPayload(router)
	if code != http.StatusOK {
		t.Fatalf("status code = %d, want 200", code)
	}
	if payload["status"] != "healthy" {
		t.Fatalf("status = %v, want healthy", payload["status"])
	}
}
