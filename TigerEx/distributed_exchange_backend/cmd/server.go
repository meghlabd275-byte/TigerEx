package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"tigerex-backend/internal/handlers"
	"tigerex-backend/internal/middleware"
	"tigerex-backend/internal/repository"
	"tigerex-backend/internal/service"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Initialize PostgreSQL
	db, err := gorm.Open(postgres.Open(os.Getenv("DATABASE_URL")), &gorm.Config{})
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}

	// Auto-migrate
	db.AutoMigrate(
		&repository.User{},
		&repository.Session{},
		&repository.Order{},
		&repository.Wallet{},
	)

	// Initialize Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_URL", "localhost:6379"),
		Password: os.Getenv("REDIS_PASSWORD", ""),
		DB:       0,
	})

	// Initialize services
	userService := service.NewUserService(db, rdb)
	orderService := service.NewOrderService(db, rdb)
	walletService := service.NewWalletService(db, rdb)
	authService := service.NewAuthService(db, rdb)

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(authService)
	userHandler := handlers.NewUserHandler(userService)
	orderHandler := handlers.NewOrderHandler(orderService)
	walletHandler := handlers.NewWalletHandler(walletService)

	// Setup Gin
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(middleware.RequestLogger())
	router.Use(middleware.CORS())
	router.Use(middleware.RateLimiter(rdb))

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// API v1 routes
	v1 := router.Group("/api/v1")
	{
		// Public routes
		v1.POST("/auth/register", authHandler.Register)
		v1.POST("/auth/login", authHandler.Login)
		v1.POST("/auth/refresh", authHandler.RefreshToken)

		// Protected routes
		protected := v1.Group("")
		protected.Use(middleware.AuthRequired())
		{
			// User routes
			protected.GET("/user/profile", userHandler.GetProfile)
			protected.PUT("/user/profile", userHandler.UpdateProfile)
			protected.PUT("/user/preferences", userHandler.UpdatePreferences)

			// Order routes
			protected.POST("/orders", orderHandler.CreateOrder)
			protected.GET("/orders", orderHandler.ListOrders)
			protected.DELETE("/orders/:id", orderHandler.CancelOrder)
			protected.GET("/orders/:id", orderHandler.GetOrder)

			// Wallet routes
			protected.GET("/wallets", walletHandler.ListWallets)
			protected.POST("/wallets/deposit", walletHandler.Deposit)
			protected.POST("/wallets/withdraw", walletHandler.Withdraw)
			protected.GET("/wallets/:currency/balance", walletHandler.GetBalance)
		}

		// WebSocket
		v1.GET("/ws", handlers.WebSocketHandler())
	}

	// Graceful shutdown
	srv := &http.Server{
		Addr:    ":" + os.Getenv("PORT", "8080"),
		Handler: router,
	}

	go func() {
		log.Printf("Server starting on port %s", os.Getenv("PORT", "8080"))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited properly")
}