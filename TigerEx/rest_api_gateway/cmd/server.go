package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tigerEx/rest_api_gateway/internal/config"
	"tigerEx/rest_api_gateway/internal/handlers"
)

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

func main() {
	// Load configuration
	cfg := config.LoadConfig()

	// Override with environment variables
	if port := os.Getenv("PORT"); port != "" {
		cfg.Server.Port = port
	}

	log.Printf("Starting TigerEx REST API Gateway v1.0.0")
	log.Printf("Server mode: %s", cfg.Server.Mode)
	log.Printf("Listening on port: %s", cfg.Server.Port)

	// Create handler
	handler := handlers.NewHandler(cfg)
	router := handler.Router()

	// Create server
	server := &http.Server{
		Addr:           ":" + cfg.Server.Port,
		Handler:        router,
		ReadTimeout:    cfg.Server.ReadTimeout,
		WriteTimeout:  cfg.Server.WriteTimeout,
		IdleTimeout:   cfg.Server.IdleTimeout,
		MaxHeaderBytes: cfg.Server.MaxHeaderBytes,
		TLSConfig:     getTLSConfig(cfg),
	}

	// Start server in goroutine
	go func() {
		var err error
		if cfg.Server.Mode == "production" {
			// In production, use TLS
			server.TLSConfig = getTLSConfig(cfg)
			err = server.ListenAndServeTLS(
				getCertFile(),
				getKeyFile(),
			)
		} else {
			err = server.ListenAndServe()
		}
		
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

// ============================================================================
// TLS CONFIGURATION
// ============================================================================

func getTLSConfig(cfg *config.Config) *tls.Config {
	return &tls.Config{
		MinVersion:               tls.VersionTLS12,
		CurvePreferences:        []tls.CurveID{tls.CurveP256, tls.X25519},
		PreferServerCipherSuites: true,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
		},
	}
}

func getCertFile() string {
	if cert := os.Getenv("TLS_CERT_FILE"); cert != "" {
		return cert
	}
	return "server.crt"
}

func getKeyFile() string {
	if key := os.Getenv("TLS_KEY_FILE"); key != "" {
		return key
	}
	return "server.key"
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

type graceful struct {
	sync.WaitGroup
}

// Add adds a task to the graceful shutdown
func (g *graceful) Add(fn func()) {
	g.WaitGroup.Add(1)
	go func() {
		defer g.WaitGroup.Done()
		fn()
	}()
}

// Wait waits for all tasks to complete
func (g *graceful) Wait() {
	g.WaitGroup.Wait()
}

// ============================================================================
// VERSION
// ============================================================================

const (
	// Version is the API version
	Version = "1.0.0"
	// BuildTime is the build timestamp
	BuildTime = "2026-06-14"
)

// ============================================================================
// DEPENDENCIES
// ============================================================================

import (
	"sync"
)