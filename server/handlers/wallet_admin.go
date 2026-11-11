// Master Wallet & Blockchain Management
// Admin backend for managing the blockchain registry, token registry, fee
// configs and the master (hot) wallet registry. Every value is read from or
// written to the database; nothing is seeded from a hard-coded network list and
// no signing material is ever produced here.
package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tigerex/server/models"
)

// ============================================================================
// BLOCKCHAIN MANAGEMENT
// ============================================================================

type Blockchain struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Symbol      string    `json:"symbol"`
	ChainID     int64     `json:"chainId"`
	RPCURL      string    `json:"rpcUrl"`
	ExplorerURL string    `json:"explorerUrl"`
	TokenType   string    `json:"tokenType"` // "evm", "solana", "ton", "bitcoin"
	Decimals    int       `json:"decimals"`
	Status      string    `json:"status"` // "active", "inactive"
	GasToken    string    `json:"gasToken"`
	ExplorerAPI string    `json:"explorerApi"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Token struct {
	ID              string    `json:"id"`
	BlockchainID    string    `json:"blockchainId"`
	Name            string    `json:"name"`
	Symbol          string    `json:"symbol"`
	ContractAddress string    `json:"contractAddress"`
	Decimals        int       `json:"decimals"`
	TokenType       string    `json:"tokenType"` // "erc20", "trc20", "spl", "native"
	Status          string    `json:"status"`
	LogoURL         string    `json:"logoUrl"`
	CreatedAt       time.Time `json:"createdAt"`
}

// ============================================================================
// MASTER WALLET
// ============================================================================

// MasterWallet is the public metadata of a hot wallet. The signing key lives in
// the custody layer and is referenced by KeyReference; it is never stored in or
// returned by the API.
type MasterWallet struct {
	ID           string    `json:"id"`
	Address      string    `json:"address"`
	KeyReference string    `json:"-"`
	BlockchainID string    `json:"blockchainId"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
	LastActivity time.Time `json:"lastActivity"`
}

type FeeConfig struct {
	ID            string  `json:"id"`
	FeeType       string  `json:"feeType"` // "withdraw", "swap", "transfer"
	BlockchainID  string  `json:"blockchainId"`
	TokenSymbol   string  `json:"tokenSymbol"`
	FeeAmount     float64 `json:"feeAmount"`
	FeePercentage float64 `json:"feePercentage"`
	MinFee        float64 `json:"minFee"`
	MaxFee        float64 `json:"maxFee"`
	Status        string  `json:"status"`
}

// ============================================================================
// WALLET ADMIN HANDLERS
// ============================================================================

// GetBlockchains lists every configured blockchain.
func GetBlockchains(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, name, symbol, chain_id, COALESCE(rpc_url, ''), COALESCE(explorer_url, ''),
		       COALESCE(explorer_api, ''), token_type, decimals, gas_token, status, created_at
		FROM blockchains
		ORDER BY name
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Blockchain registry is unavailable"}})
		return
	}
	defer rows.Close()

	blockchains := []Blockchain{}
	for rows.Next() {
		var b Blockchain
		if err := rows.Scan(&b.ID, &b.Name, &b.Symbol, &b.ChainID, &b.RPCURL, &b.ExplorerURL,
			&b.ExplorerAPI, &b.TokenType, &b.Decimals, &b.GasToken, &b.Status, &b.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Blockchain registry could not be read"}})
			return
		}
		blockchains = append(blockchains, b)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Blockchain registry could not be read"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": blockchains})
}

// AddBlockchain registers a new blockchain.
func AddBlockchain(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	var req Blockchain
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Symbol = strings.ToUpper(strings.TrimSpace(req.Symbol))
	req.GasToken = strings.ToUpper(strings.TrimSpace(req.GasToken))
	if req.Name == "" || req.Symbol == "" || req.GasToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "name, symbol and gasToken are required"}})
		return
	}
	req.ID = strings.ToLower(strings.ReplaceAll(req.Name, " ", "-"))
	if req.TokenType == "" {
		req.TokenType = "evm"
	}
	if req.Decimals <= 0 {
		req.Decimals = 18
	}
	if req.Status == "" {
		req.Status = "active"
	}

	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO blockchains (id, name, symbol, chain_id, rpc_url, explorer_url, explorer_api, token_type, decimals, gas_token, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, req.ID, req.Name, req.Symbol, req.ChainID, nullIfEmpty(req.RPCURL), nullIfEmpty(req.ExplorerURL),
		nullIfEmpty(req.ExplorerAPI), req.TokenType, req.Decimals, req.GasToken, req.Status)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "A blockchain with that id already exists"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Blockchain could not be added"}})
		return
	}

	logWalletAdminAction(adminID, c.GetString("admin_username"), "ADD_BLOCKCHAIN", "blockchain", req.ID, nil)
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"message": "Blockchain added", "id": req.ID}})
}

// UpdateBlockchain edits connection metadata for an existing blockchain.
func UpdateBlockchain(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	blockchainID := c.Param("id")

	var req struct {
		RPCURL      *string `json:"rpcUrl"`
		ExplorerURL *string `json:"explorerUrl"`
		ExplorerAPI *string `json:"explorerApi"`
		Status      *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}

	tag, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE blockchains SET
			rpc_url = COALESCE($1, rpc_url),
			explorer_url = COALESCE($2, explorer_url),
			explorer_api = COALESCE($3, explorer_api),
			status = COALESCE($4, status),
			updated_at = NOW()
		WHERE id = $5
	`, req.RPCURL, req.ExplorerURL, req.ExplorerAPI, req.Status, blockchainID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Blockchain could not be updated"}})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Blockchain not found"}})
		return
	}

	logWalletAdminAction(adminID, c.GetString("admin_username"), "UPDATE_BLOCKCHAIN", "blockchain", blockchainID, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Blockchain updated"}})
}

// DeleteBlockchain removes a blockchain. Tokens reference it with RESTRICT, so a
// blockchain that still has tokens cannot be deleted.
func DeleteBlockchain(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	blockchainID := c.Param("id")

	tag, err := models.Pool.Exec(c.Request.Context(), `DELETE FROM blockchains WHERE id = $1`, blockchainID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "Blockchain still has tokens and cannot be deleted"}})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Blockchain not found"}})
		return
	}

	logWalletAdminAction(adminID, c.GetString("admin_username"), "DELETE_BLOCKCHAIN", "blockchain", blockchainID, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Blockchain deleted"}})
}

// GetTokens lists tokens, optionally filtered by blockchain.
func GetTokens(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	blockchainID := c.Query("blockchainId")
	query := `
		SELECT id, blockchain_id, name, symbol, COALESCE(contract_address, ''), decimals, token_type,
		       COALESCE(logo_url, ''), status, created_at
		FROM tokens`
	args := []interface{}{}
	if blockchainID != "" {
		query += ` WHERE blockchain_id = $1`
		args = append(args, blockchainID)
	}
	query += ` ORDER BY symbol`

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Token registry is unavailable"}})
		return
	}
	defer rows.Close()

	tokens := []Token{}
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.ID, &t.BlockchainID, &t.Name, &t.Symbol, &t.ContractAddress,
			&t.Decimals, &t.TokenType, &t.LogoURL, &t.Status, &t.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Token registry could not be read"}})
			return
		}
		tokens = append(tokens, t)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Token registry could not be read"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": tokens})
}

// AddToken registers a token on an existing blockchain.
func AddToken(c *gin.Context) {
	adminID := checkAdminPermission(c, "blockchain")
	if adminID == "" {
		return
	}

	var req struct {
		BlockchainID    string `json:"blockchainId" binding:"required"`
		Name            string `json:"name" binding:"required"`
		Symbol          string `json:"symbol" binding:"required"`
		ContractAddress string `json:"contractAddress"`
		Decimals        int    `json:"decimals"`
		TokenType       string `json:"tokenType"`
		LogoURL         string `json:"logoUrl"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	if req.TokenType == "" {
		req.TokenType = "erc20"
	}
	if req.Decimals <= 0 {
		req.Decimals = 18
	}
	tokenID := fmt.Sprintf("%s-%s", req.BlockchainID, strings.ToLower(strings.TrimSpace(req.Symbol)))

	_, err := models.Pool.Exec(c.Request.Context(), `
		INSERT INTO tokens (id, blockchain_id, name, symbol, contract_address, decimals, token_type, logo_url, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
	`, tokenID, req.BlockchainID, req.Name, strings.ToUpper(strings.TrimSpace(req.Symbol)),
		nullIfEmpty(req.ContractAddress), req.Decimals, req.TokenType, nullIfEmpty(req.LogoURL))
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "That token already exists on this blockchain"}})
			return
		}
		if strings.Contains(err.Error(), "foreign key") {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Unknown blockchainId"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Token could not be added"}})
		return
	}

	logWalletAdminAction(adminID, c.GetString("admin_username"), "ADD_TOKEN", "token", tokenID, gin.H{
		"blockchainId": req.BlockchainID,
		"symbol":       req.Symbol,
	})
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"message": "Token added", "id": tokenID}})
}

// GetFeeConfigs lists configured withdrawal/swap fee rules.
func GetFeeConfigs(c *gin.Context) {
	adminID := checkAdminPermission(c, "fees")
	if adminID == "" {
		return
	}

	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, fee_type, COALESCE(blockchain_id, ''), token_symbol, fee_amount, fee_percentage, min_fee, max_fee, status
		FROM fee_configs
		ORDER BY fee_type, token_symbol
	`)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Fee configuration is unavailable"}})
		return
	}
	defer rows.Close()

	fees := []FeeConfig{}
	for rows.Next() {
		var f FeeConfig
		if err := rows.Scan(&f.ID, &f.FeeType, &f.BlockchainID, &f.TokenSymbol, &f.FeeAmount,
			&f.FeePercentage, &f.MinFee, &f.MaxFee, &f.Status); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Fee configuration could not be read"}})
			return
		}
		fees = append(fees, f)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Fee configuration could not be read"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": fees})
}

// UpdateFeeConfig edits a fee rule.
func UpdateFeeConfig(c *gin.Context) {
	adminID := checkAdminPermission(c, "fees")
	if adminID == "" {
		return
	}

	feeID := c.Param("id")
	if _, err := uuid.Parse(feeID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Fee config not found"}})
		return
	}

	var req struct {
		FeeAmount     *float64 `json:"feeAmount"`
		FeePercentage *float64 `json:"feePercentage"`
		MinFee        *float64 `json:"minFee"`
		MaxFee        *float64 `json:"maxFee"`
		Status        *string  `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	if req.FeeAmount != nil && *req.FeeAmount < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "feeAmount cannot be negative"}})
		return
	}
	if req.FeePercentage != nil && (*req.FeePercentage < 0 || *req.FeePercentage >= 1) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "feePercentage must be a fraction in [0, 1)"}})
		return
	}

	tag, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE fee_configs SET
			fee_amount = COALESCE($1, fee_amount),
			fee_percentage = COALESCE($2, fee_percentage),
			min_fee = COALESCE($3, min_fee),
			max_fee = COALESCE($4, max_fee),
			status = COALESCE($5, status),
			updated_at = NOW()
		WHERE id = $6
	`, req.FeeAmount, req.FeePercentage, req.MinFee, req.MaxFee, req.Status, feeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Fee config could not be updated"}})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Fee config not found"}})
		return
	}

	logWalletAdminAction(adminID, c.GetString("admin_username"), "UPDATE_FEE", "fees", feeID, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Fee updated"}})
}

// ============================================================================
// MASTER WALLET OPERATIONS
// ============================================================================

// GetMasterWallet returns the configured hot wallet metadata for a blockchain.
func GetMasterWallet(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	blockchainID := c.Query("blockchainId")
	query := `
		SELECT id, address, COALESCE(key_reference, ''), blockchain_id, status, created_at,
		       COALESCE(last_activity, created_at)
		FROM master_wallets`
	args := []interface{}{}
	if blockchainID != "" {
		query += ` WHERE blockchain_id = $1`
		args = append(args, blockchainID)
	}
	query += ` ORDER BY created_at DESC LIMIT 1`

	var w MasterWallet
	err := models.Pool.QueryRow(c.Request.Context(), query, args...).Scan(
		&w.ID, &w.Address, &w.KeyReference, &w.BlockchainID, &w.Status, &w.CreatedAt, &w.LastActivity)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "No master wallet is configured for that blockchain"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"id":           w.ID,
		"address":      w.Address,
		"blockchainId": w.BlockchainID,
		"status":       w.Status,
		"createdAt":    w.CreatedAt,
		"lastActivity": w.LastActivity,
	}})
}

// GetMasterWalletBalance reports the on-chain balance of the hot wallet. That
// requires a configured node/RPC; without one the balance is unknown, so this
// fails closed rather than returning a fabricated number.
func GetMasterWalletBalance(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "On-chain balance requires a configured node/RPC provider"}})
}

// ============================================================================
// USER WALLET MANAGEMENT (Under Master Wallet)
// ============================================================================

// GetUserWallets lists custodial wallet balances, optionally for one user.
func GetUserWallets(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	userID := c.Query("userId")
	query := `
		SELECT w.id, w.user_id, COALESCE(u.email, ''), w.currency, w.network, w.wallet_type,
		       w.balance, w.locked, w.available, w.updated_at
		FROM wallets w
		LEFT JOIN users u ON u.id = w.user_id`
	args := []interface{}{}
	if userID != "" {
		if _, err := uuid.Parse(userID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid userId"}})
			return
		}
		query += ` WHERE w.user_id = $1`
		args = append(args, userID)
	}
	query += ` ORDER BY w.updated_at DESC LIMIT 500`

	rows, err := models.Pool.Query(c.Request.Context(), query, args...)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": gin.H{"code": 503, "message": "Wallet balances are unavailable"}})
		return
	}
	defer rows.Close()

	wallets := []gin.H{}
	for rows.Next() {
		var id, walletUserID, email, currency, network, walletType string
		var balance, locked, available float64
		var updatedAt time.Time
		if err := rows.Scan(&id, &walletUserID, &email, &currency, &network, &walletType,
			&balance, &locked, &available, &updatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Wallet balances could not be read"}})
			return
		}
		wallets = append(wallets, gin.H{
			"id":           id,
			"userId":       walletUserID,
			"email":        email,
			"currency":     currency,
			"network":      network,
			"walletType":   walletType,
			"balance":      balance,
			"locked":       locked,
			"available":    available,
			"lastActivity": updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Wallet balances could not be read"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": wallets})
}

// ForceTransaction would move funds from the master wallet. Signing and
// broadcasting requires the custody layer, so this fails closed rather than
// reporting a hash for a transaction that was never sent.
func ForceTransaction(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}

	var req struct {
		FromAddress string  `json:"fromAddress" binding:"required"`
		ToAddress   string  `json:"toAddress" binding:"required"`
		Amount      float64 `json:"amount" binding:"required,gt=0"`
		Token       string  `json:"token" binding:"required"`
		Blockchain  string  `json:"blockchain" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}

	logWalletAdminAction(adminID, c.GetString("admin_username"), "FORCE_TRANSACTION_REQUESTED", "wallet", "", gin.H{
		"from":       req.FromAddress,
		"to":         req.ToAddress,
		"amount":     req.Amount,
		"token":      req.Token,
		"blockchain": req.Blockchain,
	})
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Custody signing is not implemented; no transaction was sent"}})
}

// ============================================================================
// AUTO-STABILIZATION
// ============================================================================

// AutoStabilize would rebalance gas across user wallets. That needs the custody
// layer and chain access, so it fails closed rather than reporting a summary of
// work that never ran.
func AutoStabilize(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}
	logWalletAdminAction(adminID, c.GetString("admin_username"), "AUTO_STABILIZE_REQUESTED", "wallet", "", nil)
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Wallet stabilization is not implemented; no wallets were touched"}})
}

// ============================================================================
// EXPORT MASTER WALLET BACKUP
// ============================================================================

// ExportMasterWalletBackup must never emit signing material over HTTP. Key
// backups are produced by the custody layer, not the API.
func ExportMasterWalletBackup(c *gin.Context) {
	adminID := checkAdminPermission(c, "wallet")
	if adminID == "" {
		return
	}
	logWalletAdminAction(adminID, c.GetString("admin_username"), "EXPORT_WALLET_BACKUP_REQUESTED", "wallet", "", nil)
	c.JSON(http.StatusNotImplemented, gin.H{"success": false, "error": gin.H{"code": 501, "message": "Key backups are produced by the custody layer and are never served over the API"}})
}

// ============================================================================
// HELPER
// ============================================================================

// nullIfEmpty keeps optional text columns NULL instead of storing an empty
// string, so a missing value is distinguishable from a present one.
func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func logWalletAdminAction(adminID, adminUsername, action, resourceType, resourceID string, details gin.H) {
	parsedID, err := uuid.Parse(adminID)
	if err != nil {
		fmt.Printf("ADMIN ACTION: %s | %s | %s | %s\n", adminUsername, action, resourceType, resourceID)
		return
	}
	_ = models.LogAdminAction(parsedID, adminUsername, action, resourceType, resourceID, details)
}
