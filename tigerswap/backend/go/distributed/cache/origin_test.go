package main

import (
	"net/http"
	"testing"
)

// req builds a request carrying the given Origin and Host headers.
func req(origin, host string) *http.Request {
	r := &http.Request{Host: host, Header: http.Header{}}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

// TestCheckOriginRejectsCrossSite is the regression this check exists for: the
// upgrader previously returned true for every Origin, so any web page could
// open a socket to the cache service (cross-site WebSocket hijacking).
func TestCheckOriginRejectsCrossSite(t *testing.T) {
	t.Setenv("TIGEREX_WS_ALLOWED_ORIGINS", "")
	if checkOrigin(req("https://evil.example", "cache.tigerex.io")) {
		t.Fatal("cross-site origin must be rejected")
	}
	if checkOrigin(req("http://attacker.test:8080", "cache.tigerex.io")) {
		t.Fatal("cross-site origin with port must be rejected")
	}
}

func TestCheckOriginAcceptsSameHost(t *testing.T) {
	t.Setenv("TIGEREX_WS_ALLOWED_ORIGINS", "")
	if !checkOrigin(req("https://cache.tigerex.io", "cache.tigerex.io")) {
		t.Fatal("same-host origin must be accepted")
	}
	if !checkOrigin(req("http://cache.tigerex.io", "cache.tigerex.io")) {
		t.Fatal("same-host origin over http must be accepted")
	}
}

// A non-browser client sends no Origin header; it cannot be driven by a web
// page, so it is allowed.
func TestCheckOriginAllowsNonBrowser(t *testing.T) {
	t.Setenv("TIGEREX_WS_ALLOWED_ORIGINS", "")
	if !checkOrigin(req("", "cache.tigerex.io")) {
		t.Fatal("missing Origin (non-browser client) must be accepted")
	}
}

func TestCheckOriginHonoursAllowlist(t *testing.T) {
	t.Setenv("TIGEREX_WS_ALLOWED_ORIGINS", "https://app.tigerex.io, https://pro.tigerex.io")
	if !checkOrigin(req("https://app.tigerex.io", "cache.tigerex.io")) {
		t.Fatal("listed origin must be accepted")
	}
	if !checkOrigin(req("https://pro.tigerex.io", "cache.tigerex.io")) {
		t.Fatal("second listed origin must be accepted")
	}
	if checkOrigin(req("https://evil.example", "cache.tigerex.io")) {
		t.Fatal("unlisted origin must be rejected even for a same-host request")
	}
}
