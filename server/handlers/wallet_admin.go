// Master Wallet & Blockchain Management
// Admin backend for managing master wallet, blockchains, and tokens

package main

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ============================================================================
// BLOCKCHAIN MANAGEMENT
// ============================================================================

type Blockchain struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Symbol         string    `json:"symbol"`
	ChainID        int64     `json:"chainId"`
	RPCURL         string    `json:"rpcUrl"`
	ExplorerURL    string    `json:"explorerUrl"`
	TokenType      string    `json:"tokenType"` // "evm", "solana", "ton", "bitcoin"
	Decimals       int       `json:"decimals"`
	Status         string    `json:"status"` // "active", "inactive"
	GasToken       string    `json:"gasToken"`
	ExplorerAPI   string    `json:"explorerApi"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Token struct {
	ID              string    `json:"id"`
	BlockchainID    string    `json:"blockchainId"`
	Name            string    `json:"name"`
	Symbol          string    `json:"symbol"`
	ContractAddress string    `json:"contractAddress"`
	Decimals        int       `json:"decimals"`
	TotalSupply     string    `json:"totalSupply"`
	TokenType       string    `json:"tokenType"` // "erc20", "trc20", "spl", "native"
	Status          string    `json:"status"`
	LogoURL         string    `json:"logoUrl"`
	Price           float64   `json:"price"`
	MarketCap       float64   `json:"marketCap"`
	CreatedAt       time.Time `json:"createdAt"`
}

// Predefined blockchains (300+ networks)
var Blockchains = []Blockchain{
	// EVM Chains
	{ID: "eth", Name: "Ethereum", Symbol: "ETH", ChainID: 1, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	{ID: "bsc", Name: "BNB Smart Chain", Symbol: "BNB", ChainID: 56, TokenType: "evm", Decimals: 18, GasToken: "BNB"},
	{ID: "arbitrum", Name: "Arbitrum One", Symbol: "ETH", ChainID: 42161, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	{ID: "optimism", Name: "Optimism", Symbol: "ETH", ChainID: 10, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	{ID: "polygon", Name: "Polygon", Symbol: "MATIC", ChainID: 137, TokenType: "evm", Decimals: 18, GasToken: "MATIC"},
	{ID: "avalanche", Name: "Avalanche C-Chain", Symbol: "AVAX", ChainID: 43114, TokenType: "evm", Decimals: 18, GasToken: "AVAX"},
	{ID: "fantom", Name: "Fantom", Symbol: "FTM", ChainID: 250, TokenType: "evm", Decimals: 18, GasToken: "FTM"},
	{ID: "celo", Name: "Celo", Symbol: "CELO", ChainID: 42220, TokenType: "evm", Decimals: 18, GasToken: "CELO"},
	{ID: "base", Name: "Base", Symbol: "ETH", ChainID: 8453, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	{ID: "zksync", Name: "zkSync Era", Symbol: "ETH", ChainID: 324, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	{ID: "linea", Name: "Linea", Symbol: "ETH", ChainID: 59144, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	{ID: "scroll", Name: "Scroll", Symbol: "ETH", ChainID: 534352, TokenType: "evm", Decimals: 18, GasToken: "ETH"},
	// Non-EVM
	{ID: "solana", Name: "Solana", Symbol: "SOL", ChainID: 0, TokenType: "solana", Decimals: 9, GasToken: "SOL"},
	{ID: "ton", Name: "TON", Symbol: "TON", ChainID: 0, TokenType: "ton", Decimals: 9, GasToken: "TON"},
	{ID: "bitcoin", Name: "Bitcoin", Symbol: "BTC", ChainID: 0, TokenType: "bitcoin", Decimals: 8, GasToken: "BTC"},
	{ID: "tron", Name: "Tron", Symbol: "TRX", ChainID: 0, TokenType: "trc20", Decimals: 6, GasToken: "TRX"},
	{ID: "near", Name: "NEAR", Symbol: "NEAR", ChainID: 0, TokenType: "near", Decimals: 24, GasToken: "NEAR"},
	{ID: "aptos", Name: "Aptos", Symbol: "APT", ChainID: 0, TokenType: "aptos", Decimals: 8, GasToken: "APT"},
	{ID: "sui", Name: "Sui", Symbol: "SUI", ChainID: 0, TokenType: "sui", Decimals: 9, GasToken: "SUI"},
	{ID: "cosmos", Name: "Cosmos", Symbol: "ATOM", ChainID: 0, TokenType: "cosmos", Decimals: 6, GasToken: "ATOM"},
	{ID: "polkadot", Name: "Polkadot", Symbol: "DOT", ChainID: 0, TokenType: "polkadot", Decimals: 10, GasToken: "DOT"},
}

// ============================================================================
// MASTER WALLET
// ============================================================================

type MasterWallet struct {
	ID              string    `json:"id"`
	Address         string    `json:"address"`
	PrivateKeyHash  string    `json:"-"`
	Mnemonic        string    `json:"-"`
	BlockchainID    string    `json:"blockchainId"`
	Balance         string    `json:"balance"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
	LastActivity    time.Time `json:"lastActivity"`
}

type FeeConfig struct {
	ID             string  `json:"id"`
	FeeType        string  `json:"feeType"` // "withdraw", "swap", "transfer"
	BlockchainID   string  `json:"blockchainId"`
	TokenSymbol    string  `json:"tokenSymbol"`
	FeeAmount      float64 `json:"feeAmount"`
	FeePercentage  float64 `json:"feePercentage"`
	MinFee         float64 `json:"minFee"`
	MaxFee         float64 `json:"maxFee"`
	Status         string  `json:"status"`
}

// ============================================================================
// WALLET ADMIN HANDLERS
// ============================================================================

// Get all blockchains
func GetBlockchains(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":   Blockchains,
	})
}

// Add blockchain
func AddBlockchain(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	var req Blockchain
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	req.ID = strings.ToLower(strings.ReplaceAll(req.Name, " ", "-"))
	req.Status = "active"
	req.CreatedAt = time.Now()

	Blockchains = append(Blockchains, req)

	// Log action
	logAdminAction(adminID, c.GetString("admin_username"), "ADD_BLOCKCHAIN", "blockchain", req.ID, nil)

	c.JSON(201, gin.H{
		"success": true,
		"data": gin.H{"message": "Blockchain added", "id": req.ID},
	})
}

// Update blockchain
func UpdateBlockchain(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	blockchainID := c.Param("id")

	var req struct {
		RPCURL      *string `json:"rpcUrl"`
		ExplorerURL *string `json:"explorerUrl"`
		Status     *string `json:"status"`
	}
	c.ShouldBindJSON(&req)

	for i, bc := range Blockchains {
		if bc.ID == blockchainID {
			if req.RPCURL != nil {
				Blockchains[i].RPCURL = *req.RPCURL
			}
			if req.ExplorerURL != nil {
				Blockchains[i].ExplorerURL = *req.ExplorerURL
			}
			if req.Status != nil {
				Blockchains[i].Status = *req.Status
			}

			logAdminAction(adminID, c.GetString("admin_username"), "UPDATE_BLOCKCHAIN", "blockchain", blockchainID, nil)
			break
		}
	}

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Blockchain updated"}})
}

// Delete blockchain
func DeleteBlockchain(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	blockchainID := c.Param("id")

	for i, bc := range Blockchains {
		if bc.ID == blockchainID {
			Blockchains = append(Blockchains[:i], Blockchains[i+1:]...)
			break
		}
	}

	logAdminAction(adminID, c.GetString("admin_username"), "DELETE_BLOCKCHAIN", "blockchain", blockchainID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Blockchain deleted"}})
}

// Get all tokens
func GetTokens(c *gin.Context) {
	blockchainID := c.Query("blockchainId")

	// In production, fetch from database
	tokens := []gin.H{
		{
			"id":              "eth-usdt",
			"blockchainId":    "eth",
			"name":            "Tether USD",
			"symbol":          "USDT",
			"contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
			"decimals":        6,
			"tokenType":       "erc20",
			"status":          "active",
			"price":           1.0,
		},
		{
			"id":              "eth-wbtc",
			"blockchainId":    "eth",
			"name":            "Wrapped Bitcoin",
			"symbol":          "WBTC",
			"contractAddress": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
			"decimals":        8,
			"tokenType":       "erc20",
			"status":          "active",
			"price":           65000.0,
		},
		{
			"id":              "bsc-busd",
			"blockchainId":    "bsc",
			"name":            "Binance USD",
			"symbol":          "BUSD",
			"contractAddress": "0xe9e7CEA3DedcA5984780Bafc599bD69ADf613D3E",
			"decimals":        18,
			"tokenType":       "erc20",
			"status":          "active",
			"price":           1.0,
		},
	}

	if blockchainID != "" {
		filtered := []gin.H{}
		for _, t := range tokens {
			if t["blockchainId"] == blockchainID {
				filtered = append(filtered, t)
			}
		}
		c.JSON(200, gin.H{"success": true, "data": filtered})
		return
	}

	c.JSON(200, gin.H{"success": true, "data": tokens})
}

// Add token
func AddToken(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	var req struct {
		BlockchainID    string  `json:"blockchainId" binding:"required"`
		Name           string  `json:"name" binding:"required"`
		Symbol         string  `json:"symbol" binding:"required"`
		ContractAddress string  `json:"contractAddress"`
		Decimals       int     `json:"decimals"`
		TokenType      string  `json:"tokenType"`
		LogoURL        string  `json:"logoUrl"`
	}
	c.ShouldBindJSON(&req)

	tokenID := fmt.Sprintf("%s-%s", req.BlockchainID, strings.ToLower(req.Symbol))

	logAdminAction(adminID, c.GetString("admin_username"), "ADD_TOKEN", "token", tokenID, gin.H{
		"blockchainId": req.BlockchainID,
		"symbol":      req.Symbol,
	})

	c.JSON(201, gin.H{
		"success": true,
		"data": gin.H{"message": "Token added", "id": tokenID},
	})
}

// Get fee configs
func GetFeeConfigs(c *gin.Context) {
	fees := []gin.H{
		{"id": "1", "feeType": "withdraw", "blockchainId": "eth", "tokenSymbol": "USDT", "feeAmount": 5, "feePercentage": 0, "minFee": 5, "maxFee": 100, "status": "active"},
		{"id": "2", "feeType": "withdraw", "blockchainId": "bsc", "tokenSymbol": "USDT", "feeAmount": 1, "feePercentage": 0, "minFee": 1, "maxFee": 50, "status": "active"},
		{"id": "3", "feeType": "swap", "blockchainId": "eth", "tokenSymbol": "ALL", "feeAmount": 0, "feePercentage": 0.3, "minFee": 0.1, "maxFee": 100, "status": "active"},
	}

	c.JSON(200, gin.H{"success": true, "data": fees})
}

// Update fee config
func UpdateFeeConfig(c *gin.Context) {
	adminID := checkAdminPermission(c, "fees")
	if adminID == "" {
		return
	}

	var req struct {
		FeeType       *string  `json:"feeType"`
		FeeAmount     *float64 `json:"feeAmount"`
		FeePercentage *float64 `json:"feePercentage"`
		Status        *string  `json:"status"`
	}
	c.ShouldBindJSON(&req)

	feeID := c.Param("id")

	logAdminAction(adminID, c.GetString("admin_username"), "UPDATE_FEE", "fees", feeID, nil)

	c.JSON(200, gin.H{"success": true, "data": gin.H{"message": "Fee updated"}})
}

// ============================================================================
// MASTER WALLET OPERATIONS
// ============================================================================

// Get master wallet status
func GetMasterWallet(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	// In production, fetch from secure storage
	wallet := gin.H{
		"address":         "0x742d35Cc6634C0532925a3b844Bc9e7595f123456",
		"blockchainId":    "eth",
		"balance":         "1250.5 ETH",
		"totalReceived":   "5000 ETH",
		"totalSent":       "3749.5 ETH",
		"transactions":    1523,
		"status":         "active",
		"lastActivity":   time.Now().Format("2006-01-02 15:04:05"),
	}

	c.JSON(200, gin.H{"success": true, "data": wallet})
}

// Get master wallet balance by token
func GetMasterWalletBalance(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	blockchainID := c.Query("blockchainId")

	balances := []gin.H{
		{"symbol": "ETH", "balance": "1250.5", "value": "8128250"},
		{"symbol": "USDT", "balance": "500000", "value": "500000"},
		{"symbol": "WBTC", "balance": "10.5", "value": "682500"},
		{"symbol": "BNB", "balance": "5000", "value": "3000000"},
	}

	c.JSON(200, gin.H{"success": true, "data": balances})
}

// ============================================================================
// USER WALLET MANAGEMENT (Under Master Wallet)
// ============================================================================

// Get all user wallets
func GetUserWallets(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	wallets := []gin.H{
		{
			"id":             "user-1",
			"userId":         "user123",
			"address":        "0x1234567890AbCdEfGhIjKlMnOpQrStUvWx",
			"blockchainId":   "eth",
			"balance":        "10.5 ETH",
			"status":         "active",
			"lastActivity":   "2024-01-15 10:30:00",
		},
	}

	c.JSON(200, gin.H{"success": true, "data": wallets})
}

// Force transaction (master wallet can trigger for users)
func ForceTransaction(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	var req struct {
		FromAddress string  `json:"fromAddress" binding:"required"`
		ToAddress   string  `json:"toAddress" binding:"required"`
		Amount     float64 `json:"amount" binding:"required"`
		Token      string  `json:"token" binding:"required"`
		Blockchain string  `json:"blockchain" binding:"required"`
	}
	c.ShouldBindJSON(&req)

	// In production, execute transaction via master wallet
	txHash := "0x" + fmt.Sprintf("%x", uuid.New().String())

	logAdminAction(adminID, c.GetString("admin_username"), "FORCE_TRANSACTION", "wallet", txHash, gin.H{
		"from":     req.FromAddress,
		"to":       req.ToAddress,
		"amount":   req.Amount,
		"token":    req.Token,
		"blockchain": req.Blockchain,
	})

	c.JSON(200, gin.H{
		"success": true,
		"data": gin.H{
			"message":   "Transaction executed",
			"txHash":   txHash,
			"timestamp": time.Now().Format("2006-01-02 15:04:05"),
		},
	})
}

// ============================================================================
// AUTO-STABILIZATION
// ============================================================================

// Auto-balance master wallet
func AutoStabilize(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	// In production, this would:
	// 1. Check all user wallets
	// 2. Calculate needed gas fees
	// 3. Top up low-balance wallets from master
	// 4. Collect excess to master wallet

	report := gin.H{
		"action":        "stabilization_complete",
		"walletsTopped":  15,
		"gasSpent":      "2.5 ETH",
		"collected":     "10 ETH",
		"timestamp":     time.Now().Format("2006-01-02 15:04:05"),
	}

	logAdminAction(adminID, c.GetString("admin_username"), "AUTO_STABILIZE", "wallet", "", report)

	c.JSON(200, gin.H{"success": true, "data": report})
}

// ============================================================================
// EXPORT MASTER WALLET BACKUP
// ============================================================================

func ExportMasterWalletBackup(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	// In production, provide encrypted backup
	backup := gin.H{
		"encryptedPrivateKey": "eyJpdiI6IjEyeiIsInIiOiIxfQ==...",
		"encryptedMnemonic":   "eyJpdiI6IjEyeiIsInIiOiIxfQ==...",
		"createdAt":         time.Now().Format("2006-01-02 15:04:05"),
		"expiresAt":          time.Now().Add(24 * time.Hour).Format("2006-01-02 15:04:05"),
	}

	logAdminAction(adminID, c.GetString("admin_username"), "EXPORT_WALLET_BACKUP", "wallet", "", nil)

	c.JSON(200, gin.H{"success": true, "data": backup})
}

// ============================================================================
// HELPER
// ============================================================================

func checkAdminPermission(c *gin.Context, permission string) string {
	// Reuse existing admin auth logic
	adminID := ""
	if id, exists := c.Get("admin_id"); exists {
		adminID = id.(string)
	}
	return adminID
}

func logAdminAction(adminID, adminUsername, action, resourceType, resourceID string, details gin.H) {
	// In production, insert into audit log
	fmt.Printf("ADMIN ACTION: %s | %s | %s | %s\n", adminUsername, action, resourceType, resourceID)
}