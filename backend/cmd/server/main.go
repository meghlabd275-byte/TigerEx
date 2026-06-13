// TigerEx Core Backend - Go Microservices
// Main entry point for all backend services

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tigerex/backend/internal/api"
	"tigerex/backend/internal/auth"
	"tigerex/backend/internal/config"
	"tigerex/backend/internal/kyc"
	"tigerex/backend/internal/matching"
	"tigerex/backend/internal/security"
	"tigerex/backend/internal/trading"
	"tigerex/backend/internal/wallet"
	"tigerex/backend/pkg/crypto"
)

func main() {
	log.Println("TigerEx Backend Starting...")
	log.Println("Version: 1.0.0")
	log.Println("Build: Production")
	log.Println("")

	// Load configuration
	cfg := config.Load()

	// Initialize cryptographic services
	cryptoManager := crypto.NewCryptoManager(cfg.CryptoConfig)
	log.Println("Cryptographic services initialized")

	// Initialize security layer
	securityLayer := security.NewSecurityLayer(cfg.SecurityConfig, cryptoManager)
	log.Println("Security layer initialized")

	// Initialize authentication service
	authService := auth.NewAuthService(cfg.AuthConfig, securityLayer)
	log.Println("Authentication service initialized")

	// Initialize KYC service
	kycService := kyc.NewKYCService(cfg.KYCConfig, securityLayer)
	log.Println("KYC service initialized")

	// Initialize wallet service
	walletService := wallet.NewWalletService(cfg.WalletConfig, securityLayer, cryptoManager)
	log.Println("Wallet service initialized")

	// Initialize matching engine (high-performance)
	matchingEngine := matching.NewEngine(cfg.MatchingConfig)
	log.Println("Matching engine initialized")

	// Initialize trading service
	tradingService := trading.NewTradingService(cfg.TradingConfig, matchingEngine, walletService, securityLayer)
	log.Println("Trading service initialized")

	// Initialize HTTP servers
	router := api.NewRouter(api.RouterConfig{
		AuthService:    authService,
		KYCService:     kycService,
		WalletService:  walletService,
		TradingService: tradingService,
		SecurityLayer:  securityLayer,
		Config:         cfg,
	})

	// Create HTTP server with timeouts
	srv := &http.Server{
		Addr:         ":" + cfg.ServerPort,
		Handler:      router.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Printf("Server listening on port %s", cfg.ServerPort)
		log.Printf("TLS enabled: %v", cfg.EnableTLS)
		
		if cfg.EnableTLS {
			log.Printf("TLS Certificate: %s", cfg.TLSCertPath)
		}
		
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	// Shutdown services
	matchingEngine.Shutdown()
	walletService.Shutdown()
	securityLayer.Shutdown()

	log.Println("TigerEx Backend stopped gracefully")
}
