// TigerEx Sub-Account Service - Master Account Management
// Go-based sub-account management with permissions and transfers

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// DATA STRUCTURES
// ============================================================================

type (
	// Account types
	AccountType string
	AccountStatus string
	Permission string

	const (
		AccountTypeMaster AccountType = "MASTER"
		AccountTypeSub     AccountType = "SUB"
		AccountTypeAPIKey  AccountType = "API_KEY"

		AccountStatusActive    AccountStatus = "ACTIVE"
		AccountStatusFrozen  AccountStatus = "FROZEN"
		AccountStatusClosed  AccountStatus = "CLOSED"
		AccountStatusLocked AccountStatus = "LOCKED"
	)

	// Account
	Account struct {
		ID           string       `json:"id"`
		Email        string       `json:"email"`
		AccountType  AccountType  `json:"accountType"`
		ParentID     *string      `json:"parentId,omitempty"`
		Status       AccountStatus `json:"status"`
		Permissions  []Permission `json:"permissions"`
		CreatedAt    int64        `json:"createdAt"`
		UpdatedAt    int64        `json:"updatedAt"`
		APIKeys      []APIKey     `json:"apiKeys,omitempty"`
		TransferEnabled bool      `json:"transferEnabled"`
		TradingEnabled bool      `json:"tradingEnabled"`
		WithdrawalEnabled bool   `json:"withdrawalEnabled"`
	}

	// API Key
	APIKey struct {
		ID           string    `json:"id"`
		Name         string    `json:"name"`
		Key          string    `json:"key"`
		Permissions  []Permission `json:"permissions"`
		IPWhitelist  []string  `json:"ipWhitelist,omitempty"`
		Enabled      bool      `json:"enabled"`
		LastUsed     *int64    `json:"lastUsed,omitempty"`
		ExpiresAt   *int64    `json:"expiresAt,omitempty"`
		CreatedAt    int64     `json:"createdAt"`
	}

	// Transfer
	Transfer struct {
		ID          string    `json:"id"`
		FromAccount string    `json:"fromAccount"`
		ToAccount   string    `json:"toAccount"`
		Asset       string    `json:"asset"`
		Amount      float64   `json:"amount"`
		Status      string    `json:"status"`
		ApprovedBy   *string   `json:"approvedBy,omitempty"`
		CreatedAt   int64     `json:"createdAt"`
		ProcessedAt *int64    `json:"processedAt,omitempty"`
	}

	// Permission constants
	PermissionView      Permission = "VIEW"
	PermissionTrade    Permission = "TRADE"
	PermissionWithdraw Permission = "WITHDRAW"
	PermissionTransfer Permission = "TRANSFER"
	PermissionAPI     Permission = "API"
	PermissionAdmin   Permission = "ADMIN"
)

// ============================================================================
// SERVICE
// ============================================================================

type SubAccountService struct {
	mu         sync.RWMutex
	accounts   map[string]*Account
	transfers  map[string]*Transfer
	apiKeys    map[string]*APIKey
}

func NewSubAccountService() *SubAccountService {
	return &SubAccountService{
		accounts: make(map[string]*Account),
		transfers: make(map[string]*Transfer),
		apiKeys:  make(map[string]*APIKey),
	}
}

// Create master account
func (s *SubAccountService) CreateMasterAccount(email string) *Account {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UnixMilli()
	account := &Account{
		ID:           generateID("master"),
		Email:        email,
		AccountType:  AccountTypeMaster,
		Status:       AccountStatusActive,
		Permissions:  []Permission{PermissionView, PermissionTrade, PermissionWithdraw, PermissionTransfer, PermissionAPI, PermissionAdmin},
		CreatedAt:    now,
		UpdatedAt:    now,
		TransferEnabled: true,
		TradingEnabled: true,
		WithdrawalEnabled: true,
	}

	s.accounts[account.ID] = account
	return account
}

// Create sub-account
func (s *SubAccountService) CreateSubAccount(parentID, email string, permissions []Permission) (*Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	parent, exists := s.accounts[parentID]
	if !exists {
		return nil, fmt.Errorf("parent account not found")
	}

	if parent.AccountType != AccountTypeMaster {
		return nil, fmt.Errorf("only master accounts can create sub-accounts")
	}

	now := time.Now().UnixMilli()
	account := &Account{
		ID:           generateID("sub"),
		Email:        email,
		AccountType:  AccountTypeSub,
		ParentID:     &parentID,
		Status:       AccountStatusActive,
		Permissions:  permissions,
		CreatedAt:    now,
		UpdatedAt:    now,
		TransferEnabled: contains(permissions, PermissionTransfer),
		TradingEnabled: contains(permissions, PermissionTrade),
		WithdrawalEnabled: contains(permissions, PermissionWithdraw),
	}

	s.accounts[account.ID] = account
	return account, nil
}

// Get account
func (s *SubAccountService) GetAccount(id string) (*Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	acc, exists := s.accounts[id]
	return acc, exists
}

// Get sub-accounts for master
func (s *SubAccountService) GetSubAccounts(masterID string) []*Account {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var subs []*Account
	for _, acc := range s.accounts {
		if acc.ParentID != nil && *acc.ParentID == masterID {
			subs = append(subs, acc)
		}
	}
	return subs
}

// Enable/disable sub-account
func (s *SubAccountService) SetSubAccountStatus(id string, status AccountStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	account, exists := s.accounts[id]
	if !exists {
		return fmt.Errorf("account not found")
	}

	account.Status = status
	account.UpdatedAt = time.Now().UnixMilli()
	return nil
}

// Update sub-account permissions
func (s *SubAccountService) UpdatePermissions(id string, permissions []Permission) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	account, exists := s.accounts[id]
	if !exists {
		return fmt.Errorf("account not found")
	}

	account.Permissions = permissions
	account.TransferEnabled = contains(permissions, PermissionTransfer)
	account.TradingEnabled = contains(permissions, PermissionTrade)
	account.WithdrawalEnabled = contains(permissions, PermissionWithdraw)
	account.UpdatedAt = time.Now().UnixMilli()
	return nil
}

// Create API key
func (s *SubAccountService) CreateAPIKey(accountID, name string, permissions []Permission, ipWhitelist []string) (*APIKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	account, exists := s.accounts[accountID]
	if !exists {
		return nil, fmt.Errorf("account not found")
	}

	key := generateAPIKey()
	keyHash := hashKey(key)

	now := time.Now().UnixMilli()
	apiKey := &APIKey{
		ID:          generateID("apikey"),
		Name:        name,
		Key:         keyHash,
		Permissions: permissions,
		IPWhitelist: ipWhitelist,
		Enabled:     true,
		CreatedAt:   now,
	}

	account.APIKeys = append(account.APIKeys, *apiKey)
	s.apiKeys[apiKey.ID] = apiKey

	// Return full key only once
	apiKey.Key = key
	return apiKey, nil
}

// Transfer between accounts
func (s *SubAccountService) Transfer(fromID, toID, asset string, amount float64) (*Transfer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	from, exists := s.accounts[fromID]
	if !exists {
		return nil, fmt.Errorf("from account not found")
	}

	if !from.TransferEnabled {
		return nil, fmt.Errorf("transfers not enabled for this account")
	}

	to, exists := s.accounts[toID]
	if !exists {
		return nil, fmt.Errorf("to account not found")
	}

	now := time.Now().UnixMilli()
	transfer := &Transfer{
		ID:          generateID("transfer"),
		FromAccount: fromID,
		ToAccount:   toID,
		Asset:      asset,
		Amount:     amount,
		Status:     "PENDING",
		CreatedAt:  now,
	}

	s.transfers[transfer.ID] = transfer
	return transfer, nil
}

// Approve transfer
func (s *SubAccountService) ApproveTransfer(transferID, approvedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	transfer, exists := s.transfers[transferID]
	if !exists {
		return fmt.Errorf("transfer not found")
	}

	now := time.Now().UnixMilli()
	transfer.Status = "COMPLETED"
	transfer.ApprovedBy = &approvedBy
	transfer.ProcessedAt = &now
	return nil
}

// Get transfers
func (s *SubAccountService) GetTransfers(accountID string) []*Transfer {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Transfer
	for _, t := range s.transfers {
		if t.FromAccount == accountID || t.ToAccount == accountID {
			result = append(result, t)
		}
	}
	return result
}

// ============================================================================
// HELPERS
// ============================================================================

func generateID(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixMilli(), time.Now().Nanosecond()%10000)
}

func generateAPIKey() string {
	data := fmt.Sprintf("%d%d%s", time.Now().UnixNano(), os.Getpid(), "tigerex")
	hash := sha256.Sum256([]byte(data))
	return "tx" + hex.EncodeToString(hash[:])[:48]
}

func hashKey(key string) string {
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:])
}

func contains(s []Permission, e Permission) bool {
	for _, v := range s {
		if v == e {
			return true
		}
	}
	return false
}

// ============================================================================
// API ROUTES
// ============================================================================

func setupRoutes(r *gin.Engine, svc *SubAccountService) {
	api := r.Group("/api/v1/subaccounts")
	{
		// Create master account
		api.POST("/master", func(c *gin.Context) {
			var req struct{ Email string }
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}
			account := svc.CreateMasterAccount(req.Email)
			c.JSON(200, account)
		})

		// Create sub-account
		api.POST("/sub", func(c *gin.Context) {
			var req struct {
				ParentID    string       `json:"parentId"`
				Email       string       `json:"email"`
				Permissions []Permission `json:"permissions"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}
			account, err := svc.CreateSubAccount(req.ParentID, req.Email, req.Permissions)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, account)
		})

		// Get account
		api.GET("/:id", func(c *gin.Context) {
			id := c.Param("id")
			account, found := svc.GetAccount(id)
			if !found {
				c.JSON(404, gin.H{"error": "Account not found"})
				return
			}
			c.JSON(200, account)
		})

		// Get sub-accounts
		api.GET("/master/:id/subaccounts", func(c *gin.Context) {
			id := c.Param("id")
			subs := svc.GetSubAccounts(id)
			c.JSON(200, subs)
		})

		// Update status
		api.PUT("/:id/status", func(c *gin.Context) {
			id := c.Param("id")
			var req struct{ Status AccountStatus }
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}
			if err := svc.SetSubAccountStatus(id, req.Status); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, gin.H{"success": true})
		})

		// Update permissions
		api.PUT("/:id/permissions", func(c *gin.Context) {
			id := c.Param("id")
			var req struct{ Permissions []Permission }
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}
			if err := svc.UpdatePermissions(id, req.Permissions); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, gin.H{"success": true})
		})

		// Create API key
		api.POST("/:id/apikey", func(c *gin.Context) {
			id := c.Param("id")
			var req struct {
				Name         string       `json:"name"`
				Permissions  []Permission `json:"permissions"`
				IPWhitelist  []string    `json:"ipWhitelist"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}
			apiKey, err := svc.CreateAPIKey(id, req.Name, req.Permissions, req.IPWhitelist)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, apiKey)
		})

		// Transfer
		api.POST("/transfer", func(c *gin.Context) {
			var req struct {
				FromAccount string  `json:"fromAccount"`
				ToAccount   string  `json:"toAccount"`
				Asset      string  `json:"asset"`
				Amount     float64 `json:"amount"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid request"})
				return
			}
			transfer, err := svc.Transfer(req.FromAccount, req.ToAccount, req.Asset, req.Amount)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, transfer)
		})

		// Get transfers
		api.GET("/:id/transfers", func(c *gin.Context) {
			id := c.Param("id")
			transfers := svc.GetTransfers(id)
			c.JSON(200, transfers)
		})
	}
}

// ============================================================================
// MAIN
// ============================================================================

func main() {
	fmt.Println("TigerEx Sub-Account Service v1.0.0")

	svc := NewSubAccountService()

	r := gin.Default()
	setupRoutes(r, svc)

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		fmt.Println("Sub-Account API listening on :8446")
		r.Run(":8446")
	}()

	<-stop
	fmt.Println("Shutting down...")
}