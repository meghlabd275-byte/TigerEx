// TigerEx Main Entry Point - Go + Rust Backend
// Complete exchange: Spot, Futures, Margin, Options, P2P, Earn, Staking, Admin
package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// Import all routes and services
	"tigerex/server/handlers"
	"tigerex/server/middleware"
	"tigerex/server/models"

// @title TigerEx API
// @version 1.0
// @description Professional Cryptocurrency Exchange API
// @termsOfService http://tigerex.com/terms

func main() {
	// Load .env
	godotenv.Load()

	// Initialize database
	if err := models.InitDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer models.CloseDB()

	// Seed default data
	models.SeedMarkets()

	// Setup router
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.RateLimiter())

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "timestamp": "2024-01-01"})
	})
	r.GET("/api/v1/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"pong": true})
	})

	// Public routes
	api := r.Group("/api/v1")
	{
		// Markets (public)
		api.GET("/markets", handlers.GetMarkets)
		api.GET("/markets/:symbol/ticker", handlers.GetTicker)
		api.GET("/markets/:symbol/orderbook", handlers.GetOrderBook)
		api.GET("/markets/:symbol/klines", handlers.GetKlines)
		api.GET("/markets/:symbol/trades", handlers.GetRecentTrades)

		// Auth
		auth := api.Group("/auth")
		{
			auth.POST("/register", handlers.Register)
			auth.POST("/login", handlers.Login)
			auth.POST("/2fa/setup", handlers.Setup2FA)
			auth.POST("/2fa/enable", handlers.Enable2FA)
			auth.POST("/2fa/verify", handlers.Verify2FA)
			auth.POST("/metamask/login", handlers.MetaMaskLogin)
			auth.POST("/social/login", handlers.SocialLogin)
			auth.POST("/biometric/login", handlers.BiometricLogin)
			auth.POST("/refresh", handlers.RefreshToken)
			auth.POST("/logout", handlers.Logout)
		}

		// Spot Trading
		spot := api.Group("/spot")
		{
			spot.POST("/order", handlers.PlaceSpotOrder)
			spot.DELETE("/order/:orderId", handlers.CancelOrder)
			spot.GET("/open-orders", handlers.GetOpenOrders)
			spot.GET("/orders", handlers.GetOrderHistory)
			spot.GET("/my-trades", handlers.GetMyTrades)
			spot.POST("/quote", handlers.QuoteOrder)
		}

		// Futures
		futures := api.Group("/futures")
		{
			futures.GET("/contracts", handlers.GetFuturesContracts)
			futures.POST("/position", handlers.OpenFuturesPosition)
			futures.DELETE("/position/:id", handlers.CloseFuturesPosition)
			futures.GET("/positions", handlers.GetFuturesPositions)
			futures.POST("/quote", handlers.QuoteFutures)
		}

		// Margin
		margin := api.Group("/margin")
		{
			margin.GET("/accounts", handlers.GetMarginAccount)
			margin.POST("/borrow", handlers.BorrowMargin)
			margin.POST("/repay", handlers.RepayMargin)
			margin.GET("/positions", handlers.GetMarginPositions)
		}

		// Options
		options := api.Group("/options")
		{
			options.GET("/contracts", handlers.GetOptionsContracts)
			options.POST("/trade", handlers.TradeOptions)
			options.GET("/positions", handlers.GetOptionsPositions)
		}

		// P2P
		p2p := api.Group("/p2p")
		{
			p2p.GET("/ads", handlers.GetP2PAds)
			p2p.POST("/ad", handlers.CreateP2PAd)
			p2p.PUT("/ad/:id", handlers.UpdateP2PAd)
			p2p.DELETE("/ad/:id", handlers.DeleteP2PAd)
			p2p.POST("/trade", handlers.CreateP2PTrade)
			p2p.POST("/trade/:id/confirm", handlers.ConfirmP2PTrade)
			p2p.POST("/trade/:id/dispute", handlers.DisputeP2PTrade)
		}

		// Earn/Staking
		earn := api.Group("/earn")
		{
			earn.GET("/products", handlers.GetEarnProducts)
			earn.POST("/subscribe", handlers.SubscribeEarn)
			earn.GET("/positions", handlers.GetEarnPositions)
		}

		staking := api.Group("/staking")
		{
			staking.GET("/pools", handlers.GetStakingPools)
			staking.POST("/stake", handlers.Stake)
			staking.POST("/unstake", handlers.Unstake)
			staking.GET("/positions", handlers.GetStakingPositions)
		}

		// Launchpad
		launchpad := api.Group("/launchpad")
		{
			launchpad.GET("/projects", handlers.GetLaunchpadProjects)
			launchpad.POST("/subscribe", handlers.SubscribeLaunchpad)
		}

		// Convert
		convert := api.Group("/convert")
		{
			convert.POST("", handlers.Convert)
		}

		// Transfer
		transfer := api.Group("/transfer")
		{
			transfer.POST("", handlers.InternalTransfer)
		}

		// Rewards
		rewards := api.Group("/rewards")
		{
			rewards.GET("/coupons", handlers.GetCoupons)
			rewards.POST("/claim", handlers.ClaimCoupon)
			rewards.GET("/red-packets", handlers.GetRedPackets)
			rewards.POST("/open-red-packet", handlers.OpenRedPacket)
		}
	}

	// Protected routes (require auth)
	protected := api.Group("")
	protected.Use(middleware.AuthRequired())
	{
		// Wallet
		wallet := protected.Group("/wallet")
		{
			wallet.GET("/balances", handlers.GetBalances)
			wallet.GET("/assets", handlers.GetTotalAssets)
			wallet.GET("/deposit/address", handlers.GetDepositAddress)
			wallet.POST("/deposit/address", handlers.GenerateDepositAddress)
			wallet.GET("/addresses", handlers.GetAddresses)
			wallet.POST("/withdraw", handlers.Withdraw)
			wallet.POST("/transfer", handlers.Transfer)
			wallet.POST("/deposit", handlers.Deposit)
			wallet.GET("/history", handlers.GetTransactionHistory)
			wallet.GET("/fees", handlers.GetNetworkFees)
		}

		// User profile
		user := protected.Group("/user")
		{
			user.GET("/profile", handlers.GetProfile)
			user.PUT("/profile", handlers.UpdateProfile)
			user.POST("/kyc", handlers.SubmitKYC)
			user.GET("/kyc/status", handlers.GetKYCStatus)
			user.POST("/change-password", handlers.ChangePassword)
		}
	}

	// Admin routes (separate domain /app)
	admin := r.Group("/admin")
	{
		admin.POST("/login", handlers.AdminLogin)
		admin.POST("/logout", handlers.AdminLogout)

		// Admin middleware for protected routes
		adminAuth := admin.Group("")
		adminAuth.Use(middleware.AdminAuthRequired())
		{
			// Admin Management
			adminAuth.GET("/admins", handlers.GetAllAdmins)
			adminAuth.POST("/admins", handlers.CreateAdmin)
			adminAuth.PUT("/admins/:adminId", handlers.UpdateAdmin)
			adminAuth.DELETE("/admins/:adminId", handlers.DeleteAdmin)

			// User Management
			adminAuth.GET("/users", handlers.GetAllUsers)
			adminAuth.GET("/users/:userId", handlers.GetUserDetail)
			adminAuth.PUT("/users/:userId", handlers.UpdateUser)
			adminAuth.DELETE("/users/:userId", handlers.DeleteUser)
			adminAuth.POST("/users/:userId/reset-password", handlers.ForceResetPassword)

			// KYC Management
			adminAuth.GET("/kyc", handlers.GetAllKYCDocuments)
			adminAuth.PUT("/kyc/:docId", handlers.ApproveKYC)

			// Pairs Management
			adminAuth.GET("/pairs", handlers.GetAllPairs)
			adminAuth.POST("/pairs", handlers.CreatePair)
			adminAuth.PUT("/pairs/:pairId", handlers.UpdatePair)
			adminAuth.DELETE("/pairs/:pairId", handlers.DeletePair)
			adminAuth.POST("/pairs/import", handlers.ImportPairsFromCEX)

			// Fees Management
			adminAuth.GET("/fees", handlers.GetAllFeeStructures)
			adminAuth.POST("/fees", handlers.CreateFeeStructure)

			// Withdrawals
			adminAuth.GET("/withdrawals", handlers.GetAllWithdrawals)
			adminAuth.PUT("/withdrawals/:withdrawalId", handlers.ProcessWithdrawal)

			// Support Tickets
			adminAuth.GET("/tickets", handlers.GetAllTickets)
			adminAuth.PUT("/tickets/:ticketId", handlers.RespondToTicket)

			// Analytics
			adminAuth.GET("/analytics", handlers.GetAnalytics)

			// API Keys
			adminAuth.GET("/api-keys", handlers.GetAPIManagement)
			adminAuth.PUT("/api-keys/:keyId/revoke", handlers.RevokeAPIKey)

			// Tokens
			adminAuth.POST("/tokens", handlers.CreateToken)

			// NFTs
			adminAuth.POST("/nfts", handlers.CreateNFTCollection)

			// Cloud Mining
			adminAuth.GET("/cloud-mining", handlers.GetCloudMiningProducts)
			adminAuth.POST("/cloud-mining", handlers.CreateCloudMiningProduct)

			// Audit Log
			adminAuth.GET("/audit-log", handlers.GetAuditLog)
		}
	}

	// WebSocket
	go handlers.StartWebSocketServer()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("Shutting down server...")
		os.Exit(0)
	}()

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("🐯 TigerEx API Server starting on port %s", port)
	r.Run(":" + port)
}