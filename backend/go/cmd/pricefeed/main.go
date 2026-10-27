// TigerEx Price Feed Service entry point.
//
// Serves the exchange's market data over HTTP by reading through to the
// authoritative market data service. It refuses to start without a configured
// upstream rather than serving invented prices.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tigerex/backend/services/pricefeed"
)

var (
	port   = flag.Int("port", 8080, "Server port")
	host   = flag.String("host", "0.0.0.0", "Server host")
	source = flag.String("source-url", os.Getenv("TIGEREX_MARKETDATA_URL"),
		"Base URL of the TigerEx market data service (env TIGEREX_MARKETDATA_URL)")
)

func main() {
	flag.Parse()

	if *source == "" {
		log.Fatal("no market data source configured: set -source-url or TIGEREX_MARKETDATA_URL to the TigerEx market data service")
	}

	log.Printf("Starting TigerEx Price Feed Service")
	log.Printf("Market data source: %s", *source)

	svc := pricefeed.NewPriceFeedService(pricefeed.NewHTTPSource(*source))
	svc.Start()
	defer svc.Stop()

	handler := pricefeed.NewHandler(svc)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", *host, *port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("Server running on http://%s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down price feed service")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Shutdown error: %v", err)
	}
}
