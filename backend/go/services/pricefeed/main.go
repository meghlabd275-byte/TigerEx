// TigerEx Price Feed Service Main Entry Point
// Standalone service for real-time price generation

package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"tigerex/services/pricefeed"
)

var (
	port    = flag.Int("port", 8080, "Server port")
	host    = flag.String("host", "0.0.0.0", "Server host")
	verbose = flag.Bool("v", false, "Verbose logging")
)

func main() {
	flag.Parse()

	log.Printf("🐯 Starting TigerEx Price Feed Service...")
	log.Printf("📊 Independent price generation system")

	// Initialize price feed service
	pfs := pricefeed.NewPriceFeedService()

	// Start price updates
	pfs.Start()
	log.Printf("✅ Price feed service started")

	// Create HTTP handler
	handler := pricefeed.NewHandler(pfs)
	mux := http.NewServeMux()

	// Register routes
	handler.RegisterRoutes(mux)

	// Add health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","service":"pricefeed"}`))
	})

	// Add root endpoint
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"name": "TigerEx Price Feed API",
			"version": "1.0.0",
			"description": "Independent price generation service",
			"endpoints": {
				"/api/v1/ticker/24hr": "24h price ticker",
				"/api/v1/ticker/price": "Current price",
				"/api/v1/depth": "Market depth",
				"/api/v1/trades": "Recent trades",
				"/api/v1/klines": "Kline/candlestick data",
				"/api/v1/orderbook": "Order book",
				"/api/v1/exchangeInfo": "Exchange configuration",
				"/api/v1/market/summary": "Market summary"
			}
		}`))
	})

	// Create server
	addr := fmt.Sprintf("%s:%d", *host, *port)
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	// Handle graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("🚀 Server running on http://%s", addr)
		log.Printf("📡 Price feed available at /api/v1/*")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-quit
	log.Println("🛑 Shutting down price feed service...")

	pfs.Stop()
	log.Println("✅ Price feed service stopped")
}
