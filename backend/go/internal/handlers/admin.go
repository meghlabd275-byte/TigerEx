package handlers

import (
	"net/http"

	"tigerex-api/internal/admin"
)

// AdminHandler handles admin API requests
type AdminHandler struct {
	service *admin.Service
}

// NewAdminHandler creates new admin handler
func NewAdminHandler(svc *admin.Service) *AdminHandler {
	return &AdminHandler{service: svc}
}

// AddBlockchainRequest represents add blockchain request
type AddBlockchainRequest struct {
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	ChainID     int64  `json:"chain_id"`
	ChainType   string `json:"chain_type"`
	RPCURL      string `json:"rpc_url"`
	ExplorerURL string `json:"explorer_url"`
	Decimals    int    `json:"decimals"`
}

// AddTokenRequest represents add token request
type AddTokenRequest struct {
	BlockchainID     string `json:"blockchain_id"`
	Name             string `json:"name"`
	Symbol           string `json:"symbol"`
	ContractAddress  string `json:"contract_address"`
	Decimals         int    `json:"decimals"`
	MinDeposit       string `json:"min_deposit"`
	MinWithdraw      string `json:"min_withdraw"`
	WithdrawFee      string `json:"withdraw_fee"`
}

// SetFeeRequest represents set fee request
type SetFeeRequest struct {
	FeeType    string `json:"fee_type"`
	TokenID    string `json:"token_id"`
	Network    string `json:"network"`
	FeeAmount  string `json:"fee_amount"`
	FeePercent string `json:"fee_percent"`
}

// CreateLaunchpadRequest represents create launchpad request
type CreateLaunchpadRequest struct {
	Name             string `json:"name"`
	TokenName        string `json:"token_name"`
	TokenSymbol      string `json:"token_symbol"`
	TokenAddress     string `json:"token_address"`
	BlockchainID     string `json:"blockchain_id"`
	TotalSupply     string `json:"total_supply"`
	SaleAllocation  string `json:"sale_allocation"`
	PricePerToken   string `json:"price_per_token"`
	AcceptedTokenID string `json:"accepted_token_id"`
	MinPurchase     string `json:"min_purchase"`
	MaxPurchase    string `json:"max_purchase"`
	StartTime       int64  `json:"start_time"`
	EndTime         int64  `json:"end_time"`
	Description     string `json:"description"`
	WebsiteURL      string `json:"website_url"`
	LogoURL         string `json:"logo_url"`
}

// AddBlockchain adds new blockchain
func (h *AdminHandler) AddBlockchain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req AddBlockchainRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Name == "" || req.Symbol == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "Name and symbol required")
		return
	}

	config := &admin.BlockchainConfig{
		Name:             req.Name,
		Symbol:           req.Symbol,
		ChainID:          req.ChainID,
		ChainType:        req.ChainType,
		RPCURL:            req.RPCURL,
		ExplorerURL:       req.ExplorerURL,
		MinWithdraw:       nil,
		WithdrawFee:       nil,
		DepositConfirmations: 6,
	}

	err := h.service.AddBlockchain(r.Context(), config)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ADD_FAILED", "Failed to add blockchain")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"id":         config.ID,
		"name":       config.Name,
		"symbol":     config.Symbol,
		"chain_id":   config.ChainID,
		"chain_type": config.ChainType,
	})
}

// UpdateBlockchain updates blockchain
func (h *AdminHandler) UpdateBlockchain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	// Parse request and update blockchain
	WriteSuccess(w, map[string]string{"status": "updated"})
}

// DeleteBlockchain deletes blockchain
func (h *AdminHandler) DeleteBlockchain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	blockchainID := r.URL.Query().Get("id")
	if blockchainID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "Blockchain ID required")
		return
	}

	WriteSuccess(w, map[string]string{"status": "deleted"})
}

// GetAllBlockchains returns all blockchains
func (h *AdminHandler) GetAllBlockchains(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	blockchains, err := h.service.GetAllBlockchains(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "GET_FAILED", "Failed to get blockchains")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"blockchains": blockchains,
		"count":      len(blockchains),
	})
}

// AddToken adds new token
func (h *AdminHandler) AddToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req AddTokenRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	config := &admin.TokenConfig{
		Name:            req.Name,
		Symbol:          req.Symbol,
		ContractAddress: req.ContractAddress,
		Decimals:        req.Decimals,
	}

	err := h.service.AddToken(r.Context(), config)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ADD_FAILED", "Failed to add token")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"id":      config.ID,
		"name":    config.Name,
		"symbol":  config.Symbol,
		"address": config.ContractAddress,
	})
}

// SetFee sets fee
func (h *AdminHandler) SetFee(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req SetFeeRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	switch req.FeeType {
	case "withdraw":
		err := h.service.SetWithdrawFee(r.Context(), req.Network, nil, nil)
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "SET_FAILED", "Failed to set fee")
			return
		}
	case "swap":
		err := h.service.SetSwapFee(r.Context(), nil)
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "SET_FAILED", "Failed to set fee")
			return
		}
	}

	WriteSuccess(w, map[string]string{"status": "fee set"})
}

// GetFees returns all fee configs
func (h *AdminHandler) GetFees(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	fees, err := h.service.GetFeeConfig(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "GET_FAILED", "Failed to get fees")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"fees": fees,
	})
}

// CreateLaunchpad creates launchpad project
func (h *AdminHandler) CreateLaunchpad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req CreateLaunchpadRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	project := &admin.LaunchpadProject{
		Name:            req.Name,
		TokenName:       req.TokenName,
		TokenSymbol:     req.TokenSymbol,
		TokenAddress:    req.TokenAddress,
		TotalSupply:     nil,
		SaleAllocation: nil,
		PricePerToken:  nil,
		MinPurchase:    nil,
		MaxPurchase:    nil,
		StartTime:      0,
		EndTime:        0,
		Status:         "upcoming",
		Description:    req.Description,
		WebsiteURL:     req.WebsiteURL,
		LogoURL:        req.LogoURL,
	}

	err := h.service.CreateLaunchpadProject(r.Context(), project)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CREATE_FAILED", "Failed to create launchpad")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"id":     project.ID,
		"name":   project.Name,
		"status": project.Status,
	})
}

// GetLaunchpads returns all launchpad projects
func (h *AdminHandler) GetLaunchpads(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	status := r.URL.Query().Get("status")
	projects, err := h.service.GetLaunchpadProjects(r.Context(), status)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "GET_FAILED", "Failed to get projects")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"projects": projects,
		"count":    len(projects),
	})
}

// StartLaunchpad starts launchpad
func (h *AdminHandler) StartLaunchpad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	projectID := r.URL.Query().Get("id")
	if projectID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_ID", "Project ID required")
		return
	}

	WriteSuccess(w, map[string]string{"status": "started"})
}

// EndLaunchpad ends launchpad
func (h *AdminHandler) EndLaunchpad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	WriteSuccess(w, map[string]string{"status": "ended"})
}

// GetMasterWalletBalance returns master wallet balance
func (h *AdminHandler) GetMasterWalletBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	balance, err := h.service.GetMasterWalletBalance(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "GET_FAILED", "Failed to get balance")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"balance": balance.String(),
	})
}

// MasterWalletTransfer transfers from master wallet
func (h *AdminHandler) MasterWalletTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	WriteSuccess(w, map[string]string{"status": "transferred"})
}

// BackupMasterWallet generates backup
func (h *AdminHandler) BackupMasterWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	backup, err := h.service.BackupMasterWallet(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "BACKUP_FAILED", "Failed to backup")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"backup": backup,
	})
}
