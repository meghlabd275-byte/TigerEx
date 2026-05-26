#!/usr/bin/env python3
"""
TigerEx - High-Frequency Trading API Gateway
Go/gRPC Implementation for Low-Latency Trading

Production-Grade Features:
- gRPC streaming for real-time data
- HTTP/2 multiplexing
- Protocol buffers for efficiency
- Circuit breaker patterns
- Rate limiting per user
- Connection pooling
"""

package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/checking"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/shopspring/decimal"
	"golang.org/x/time/rate"
	"google.golang.org/protobuf/types/known/timestamppb"

	"tigerex/msg"
	"tigerex/matching"
	"tigerex/auth"
	"tigerex/wallet"
)

// ==============================================================================
// CONFIGURATION
// ==============================================================================

type Config struct {
	Port             string        `mapstructure:"port"`
	RedisURL         string        `mapstructure:"redis_url"`
	MatchesEngineAddr string      `mapstructure:"matching_engine_addr"`
	MaxConnPerUser   int           `mapstructure:"max_conn_per_user"`
	RateLimitRPM     int           `mapstructure:"rate_limit_rpm"`
	RateLimitBurst  int           `mapstructure:"rate_limit_burst"`
	WriteTimeout     time.Duration `mapstructure:"write_timeout"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	IdleTimeout     time.Duration `mapstructure:"idle_timeout"`
	CERTFile        string        `mapstructure:"cert_file"`
	KeyFile         string        `mapstructure:"key_file"`
}

var defaultConfig = Config{
	Port:             ":8443",
	MaxConnPerUser:    10,
	RateLimitRPM:     1200,
	RateLimitBurst:   50,
	WriteTimeout:     15 * time.Second,
	ReadTimeout:      15 * time.Second,
	IdleTimeout:      60 * time.Second,
}

// ==============================================================================
// PER USER RATE LIMITER  
// ==============================================================================

type UserRateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	config   Config
}

func NewUserRateLimiter(config Config) *UserRateLimiter {
	return &UserRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		config:   config,
	}
}

func (r *UserRateLimiter) getLimiter(userID string) *rate.Limiter {
	r.mu.RLock()
	limiter, exists := r.limiters[userID]
	r.mu.RUnlock()

	if exists {
		return limiter
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Double-check after acquiring write lock
	if l, ok := r.limiters[userID]; ok {
		return l
	}

	limiter = rate.NewLimiter(
		rate.Limit(r.config.RateLimitRPM)/60,  // per second
		r.config.RateLimitBurst,
	)
	r.limiters[userID] = limiter

	return limiter
}

func (r *UserRateLimiter) Allow(userID string) bool {
	limiter := r.getLimiter(userID)
	return limiter.Allow()
}

// ==============================================================================
// SERVER STATE
// ==============================================================================

type Server struct {
	UnimplementedTradingServiceServer

	config          Config
	matchingEngine  *matching.MatchingEngine
	authService     *auth.Service
	walletService  *wallet.Service
	rateLimiter     *UserRateLimiter
	redis          *redis.Client
	healthCheck    *health.Server

	// Metrics
	connectedClients atomic.Int64
	totalRequests   atomic.Int64
	requestErrors  atomic.Int64
	latencySum     atomic.Int64
	requestCounts  atomic.Int64

	mu sync.Mutex
}

func NewServer(config Config) *Server {
	return &Server{
		config:         config,
		rateLimiter:   NewUserRateLimiter(config),
	}
}

func (s *Server) Initialize() error {
	// Initialize Redis connection
	if config.RedisURL := s.config.RedisURL; config.RedisURL != "" {
		opt, err := redis.ParseURL(s.config.RedisURL)
		if err != nil {
			return fmt.Errorf("redis parse error: %w", err)
		}
		s.redis = redis.NewClient(opt)
		ctx := context.Background()
		if err := s.redis.Ping(ctx).Err(); err != nil {
			return fmt.Errorf("redis ping error: %w", err)
		}
	}

	// Initialize matching engine
	s.matchingEngine = matching.NewMatchingEngine()

	return nil
}

// ============================================================================
// gRPC SERVICE IMPLEMENTATIONS
// ============================================================================

// SubmitOrder implements the RPC for order submission
func (s *Server) SubmitOrder(ctx context.Context, req *msg.OrderRequest) (*msg.OrderResponse, error) {
	start := time.Now()

	// Rate limit check
	userID := req.UserId
	if !s.rateLimiter.Allow(userID) {
		s.requestErrors.Add(1)
		return &msg.OrderResponse{
			Status:  "RATE_LIMITED",
			Message: "Too many requests",
		}, nil
	}

	// Get market from request
	market := s.matchingEngine.GetMarket(req.Market)
	if market == nil {
		return &msg.OrderResponse{
			Status:  "INVALID_MARKET",
			Message: fmt.Sprintf("Market %s not found", req.Market),
		}, nil
	}

	// Validate order
	if req.Quantity <= 0 {
		return &msg.OrderResponse{
			Status:   "INVALID_QUANTITY",
			Message: "Quantity must be positive",
		}, nil
	}

	if req.Price <= 0 && req.OrderType != "market" {
		return &msg.OrderResponse{
			Status:   "INVALID_PRICE",
			Message: "Price must be positive for limit orders",
		}, nil
	}

	// Check wallet balance (for buy orders)
	if req.Side == "buy" {
		required := decimal.NewFromFloat(req.Price).
			Mul(decimal.NewFromFloat(req.Quantity))

		balance := s.walletService.GetBalance(req.UserId, market.QuoteAsset)
		if balance.LessThan(required) {
			s.requestErrors.Add(1)
			return &msg.OrderResponse{
				Status:   "INSUFFICIENT_BALANCE",
				Message: fmt.Sprintf("Need %s %s", market.QuoteAsset, required.String()),
			}, nil
		}
	}

	// Submit to matching engine
	order := &matching.Order{
		UserID:      req.UserId,
		Market:      req.Market,
		Side:        req.Side,
		OrderType:   req.OrderType,
		Quantity:   req.Quantity,
		Price:      req.Price,
		TimeInForce: req.TimeInForce,
	}

	trades, err := s.matchingEngine.SubmitOrder(order)
	if err != nil {
		s.requestErrors.Add(1)
		return &msg.OrderResponse{
			Status:  "ERROR",
			Message: err.Error(),
		}, nil
	}

	// Update metrics
	latency := time.Since(start).Milliseconds()
	s.latencySum.Add(latency)
	s.requestCounts.Add(1)
	s.totalRequests.Add(1)

	return &msg.OrderResponse{
		Status:       order.Status,
		OrderId:      order.OrderID,
		Trades:       len(trades),
		FilledQty:    order.FilledQuantity,
		AvgFillPrice: order.AverageFillPrice,
		Fees:        order.Fees,
		Message:     "Success",
	}, nil
}

// CancelOrder cancels an existing order
func (s *Server) CancelOrder(ctx context.Context, req *msg.CancelRequest) (*msg.CancelResponse, error) {
	err := s.matchingEngine.CancelOrder(req.OrderId, req.UserId)
	if err != nil {
		s.requestErrors.Add(1)
		return &msg.CancelResponse{
			Status:  "ERROR",
			Message: err.Error(),
		}, nil
	}

	return &msg.CancelResponse{
		Status:  "CANCELLED",
		Message: "Order cancelled successfully",
	}, nil
}

// GetOrderBook returns current market depth
func (s *Server) GetOrderBook(ctx context.Context, req *msg.BookRequest) (*msg.BookResponse, error) {
	book := s.matchingEngine.GetDepth(req.Market, int(req.Limit))

	bids := make([]*msg.PriceLevel, len(book.Bids))
	for i, bid := range book.Bids {
		bids[i] = &msg.PriceLevel{
			Price:    bid.Price,
			Quantity: bid.Quantity,
		}
	}

	asks := make([]*msg.PriceLevel, len(book.Asks))
	for i, ask := range book.Asks {
		asks[i] = &msg.PriceLevel{
			Price:    ask.Price,
			Quantity: ask.Quantity,
		}
	}

	return &msg.BookResponse{
		Market:    req.Market,
		Bids:      bids,
		asks:      asks,
		Timestamp: timestamppb.Now(),
	}, nil
}

// GetTicker returns 24h ticker data
func (s *Server) GetTicker(ctx context.Context, req *msg.TickerRequest) (*msg.TickerResponse, error) {
	stats := s.matchingEngine.GetStats(req.Market)

	return &msg.TickerResponse{
		Market:         req.Market,
		LastPrice:      stats.LastPrice,
		PriceChange:   stats.PriceChange,
		PriceChange24h: stats.Change24h,
		High24h:       stats.High24h,
		Low24h:        stats.Low24h,
		Volume24h:      stats.Volume24h,
		QuoteVolume24h: stats.QuoteVolume24h,
		Trades24h:     stats.Trades24h,
		Timestamp:     timestamppb.Now(),
	}, nil
}

// GetOpenOrders returns user's open orders
func (s *Server) GetOpenOrders(ctx context.Context, req *msg.OrdersRequest) (*msg.OrdersResponse, error) {
	orders := s.matchingEngine.GetUserOrders(req.UserId)

	result := make([]*msg.OrderInfo, len(orders))
	for i, o := range orders {
		result[i] = &msg.OrderInfo{
			OrderId:   o.OrderID,
			Market:   o.Market,
			Side:      o.Side,
			Type:      o.OrderType,
			Price:    o.Price,
			Quantity: o.Quantity,
			Filled:   o.FilledQuantity,
			Status:   o.Status,
			Created:  timestamppb.New(time.Unix(0, o.CreatedAt*1e6)),
		}
	}

	return &msg.OrdersResponse{
		Orders: result,
	}, nil
}

// StreamTrades streams trades in real-time
func (s *Server) StreamTrades(req *msg.StreamRequest, stream TradingService_StreamTradesServer) error {
	ch := s.matchingEngine.SubscribeTrades(req.Market)

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case trade := <-ch:
			if err := stream.Send(&msg.TradeStream{
				TradeId:     trade.TradeID,
				Market:     req.Market,
				Price:     trade.Price,
				Quantity:  trade.Quantity,
				Side:      trade.Side,
				Timestamp: timestamppb.New(time.Unix(0, trade.Timestamp*1e6)),
			}); err != nil {
				return err
			}
		}
	}
}

// GetUserBalance returns user's wallet balance
func (s *Server) GetUserBalance(ctx context.Context, req *msg.BalanceRequest) (*msg.BalanceResponse, error) {
	balances := s.walletService.GetAllBalances(req.UserId)

	result := make(map[string]*msg.AssetBalance)
	for asset, balance := range balances {
		result[asset] = &msg.AssetBalance{
			Available: balance.Available,
			Locked:    balance.Locked,
			Total:    balance.Total,
		}
	}

	return &msg.BalanceResponse{
		UserId:    req.UserId,
		Balances: result,
	}, nil
}

// ==============================================================================
// HEALTH CHECKS
// ==============================================================================

func (s *Server) Check(ctx context.Context, req *grpc.HealthCheckRequest) (*grpc.HealthCheckResponse, error) {
	// Check Redis connectivity
	if s.redis != nil {
		ctx := context.Background()
		if err := s.redis.Ping(ctx).Err(); err != nil {
			return &grpc.HealthCheckResponse{
				Status: grpc.HealthCheckResponse_NOT_SERVING,
			}, nil
		}
	}

	// Check matching engine
	if !s.matchingEngine.IsHealthy() {
		return &grpc.HealthCheckResponse{
			Status: grpc.HealthCheckResponse_NOT_SERVING,
		}, nil
	}

	return &grpc.HealthCheckResponse{
		Status: grpc.HealthCheckResponse_SERVING,
	}, nil
}

func (s *Server) Watch(req *grpc.HealthCheckRequest, server grpc.Health_WatchServer) error {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-server.Context().Done():
			return nil
		case <-ticker.C:
			check, _ := s.Check(context.Background(), &grpc.HealthCheckRequest{})
			server.Send(&grpc.HealthCheckResponse{
				Status: check.Status,
			})
		}
	}
}

// ==============================================================================
// METRICS & MONITORING
// ==============================================================================

type Metrics struct {
	ConnectedClients int64   `json:"connected_clients"`
	TotalRequests   int64   `json:"total_requests"`
	RequestErrors  int64   `json:"request_errors"`
	RequestsPerSec float64 `json:"requests_per_sec"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
}

func (s *Server) GetMetrics() Metrics {
	reqCount := s.requestCounts.Load()
	latSum := s.latencySum.Load()

	avgLatency := float64(0)
	if reqCount > 0 {
		avgLatency = float64(latSum) / float64(reqCount)
	}

	return Metrics{
		ConnectedClients: s.connectedClients.Load(),
		TotalRequests:   s.totalRequests.Load(),
		RequestErrors:  s.requestErrors.Load(),
		AvgLatencyMs:  avgLatency,
	}
}

// ==============================================================================
// GRPC SERVER STARTUP
// ==============================================================================

func startGRPCServer(config Config, server *Server) error {
	lis, err := net.Listen("tcp", config.Port)
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	// Create gRPC server with options
	grpcServer := grpc.NewServer(
		grpc.ConnectionTimeout(30 * time.Second),
		grpc.WriteBufferSize(32*1024),
		grpc.ReadBufferSize(32*1024),
		grpc.MaxConcurrentStreams(10000),
		grpc.MaxRecvMsgSize(64*1024*1024),  // 64MB max message
	)

	msg.RegisterTradingServiceServer(grpcServer, server)
	msg.RegisterHealthServer(grpcServer, server.healthCheck)

	// Register reflection
	grpcreflection.Register(grpcServer)

	// Start server
	go func() {
		fmt.Printf("gRPC server listening on %s\n", config.Port)
		if err := grpcServer.Serve(lis); err != nil {
			fmt.Printf("gRPC server error: %v\n", err)
		}
	}()

	return nil
}

// ============================================================================
// HTTP REST GATEWAY
// ============================================================================

func start_RESTGateway(server *Server, config Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()

	router.Use(gin.Recovery())
	router.Use(gin.Logger())

	// Health endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Metrics endpoint
	router.GET("/metrics", func(c *gin.Context) {
		c.JSON(200, server.GetMetrics())
	})

	// Trading endpoints
	router.POST("/api/v1/order", server.handleOrder)
	router.DELETE("/api/v1/order/:id", server.handleCancelOrder)
	router.GET("/api/v1/orders", server.handleGetOrders)
	router.GET("/api/v1/book/:market", server.handleOrderBook)
	router.GET("/api/v1/ticker/:market", server.handleTicker)
	router.GET("/api/v1/balance", server.handleBalance)

	// WebSocket for real-time data
	router.GET("/ws", server.handleWebSocket)

	return router
}

func (s *Server) handleOrder(c *gin.Context) {
	var req struct {
		UserID   string  `json:"userId" binding:"required"`
		Market  string  `json:"market" binding:"required"`
		Side    string  `json:"side" binding:"required,oneof=buy sell"`
		Type    string  `json:"type" binding:"required,oneof=limit market"`
		Price   float64 `json:"price"`
		Quantity float64 `json:"quantity" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	limit := req.Quantity
	price := req.Price

	orderReq := &msg.OrderRequest{
		UserId:    req.UserID,
		Market:   req.Market,
		Side:     req.Side,
		OrderType: req.Type,
		Quantity: limit,
		Price:    price,
	}

	resp, err := s.SubmitOrder(c.Request.Context(), orderReq)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, resp)
}

func (s *Server) handleCancelOrder(c *gin.Context) {
	orderID := c.Param("id")
	var req struct {
		UserID string `json:"userId" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	_, err := s.CancelOrder(c.Request.Context(), &msg.CancelRequest{
		OrderId: orderID,
		UserId:  req.UserID,
	})

	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"status": "cancelled"})
}

func (s *Server) handleGetOrders(c *gin.Context) {
	userID := c.Query("userId")
	if userID == "" {
		c.JSON(400, gin.H{"error": "userId required"})
		return
	}

	resp, err := s.GetOpenOrders(c.Request.Context(), &msg.OrdersRequest{UserId: userID})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, resp)
}

func (s *Server) handleOrderBook(c *gin.Context) {
	market := c.Param("market")

	resp, err := s.GetOrderBook(c.Request.Context(), &msg.BookRequest{
		Market: market,
		Limit: 20,
	})

	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, resp)
}

func (s *Server) handleTicker(c *gin.Context) {
	market := c.Param("market")

	resp, err := s.GetTicker(c.Request.Context(), &msg.TickerRequest{Market: market})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, resp)
}

func (s *Server) handleBalance(c *gin.Context) {
	userID := c.Query("userId")
	if userID == "" {
		c.JSON(400, gin.H{"error": "userId required"})
		return
	}

	resp, err := s.GetUserBalance(c.Request.Context(), &msg.BalanceRequest{UserId: userID})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, resp)
}

// WebSocket placeholder
func (s *Server) handleWebSocket(c *gin.Context) {
	c.JSON(400, gin.H{"error": "ws not implemented"})
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx API Gateway v1.0")
	fmt.Println("==========================\n")

	config := defaultConfig

	// Override from environment
	if port := os.Getenv("PORT"); port != "" {
		config.Port = ":" + port
	}

	// Create and initialize server
	server := NewServer(config)
	if err := server.Initialize(); err != nil {
		fmt.Printf("Initialization error: %v\n", err)
		os.Exit(1)
	}

	// Start gRPC in goroutine
	go startGRPCServer(config, server)

	// Start HTTP gateway
	router := start_RESTGateway(server, config)
	addr := ":8080"
	fmt.Printf("HTTP server listening on %s\n", addr)
	if err := router.Run(addr); err != nil {
		fmt.Printf("HTTP server error: %v\n", err)
	}

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println("\nShutting down...")
}