package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"tigerex-api/internal/wallet"
)

// WalletHandler handles wallet API requests
type WalletHandler struct {
	service *wallet.Service
}

// NewWalletHandler creates new wallet handler
func NewWalletHandler(svc *wallet.Service) *WalletHandler {
	return &WalletHandler{service: svc}
}

// GenerateWalletRequest represents generate wallet request
type GenerateWalletRequest struct {
	Password    string `json:"password"`
	Blockchain  string `json:"blockchain"`
	Name        string `json:"name"`
}

// ImportWalletRequest represents import wallet request
type ImportWalletRequest struct {
	SeedPhrase string `json:"seed_phrase"`
	Password   string `json:"password"`
	Blockchain string `json:"blockchain"`
	Name       string `json:"name"`
}

// TransferRequest represents transfer request
type TransferRequest struct {
	ToAddress string `json:"to_address"`
	Amount    string `json:"amount"`
	Token     string `json:"token"`
	Blockchain string `json:"blockchain"`
}

// SwapRequest represents swap request
type SwapRequest struct {
	FromToken   string `json:"from_token"`
	ToToken     string `json:"to_token"`
	FromAmount  string `json:"from_amount"`
	MinOutAmount string `json:"min_out_amount"`
	Blockchain  string `json:"blockchain"`
	Slippage    float64 `json:"slippage"`
}

// GenerateWallet generates new wallet
func (h *WalletHandler) GenerateWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req GenerateWalletRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Password == "" {
		WriteError(w, http.StatusBadRequest, "PASSWORD_REQUIRED", "Password is required")
		return
	}

	// Generate 24-word seed phrase
	gen := wallet.NewSeedPhraseGenerator()
	seedPhrase, err := gen.Generate24WordSeed()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "GENERATION_FAILED", "Failed to generate wallet")
		return
	}

	// Encrypt seed phrase
	encryptedSeed, err := h.service.EncryptSeedPhrase(seedPhrase, req.Password)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ENCRYPTION_FAILED", "Failed to encrypt wallet")
		return
	}

	// Generate address
	address, _, err := h.service.GenerateAddress(seedPhrase, req.Blockchain)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ADDRESS_GENERATION_FAILED", "Failed to generate address")
		return
	}

	// Hash seed for verification
	seedHash := h.service.HashSeedPhrase(seedPhrase)

	WriteSuccess(w, map[string]interface{}{
		"seed_phrase":   seedPhrase, // Only returned once!
		"encrypted_key": encryptedSeed,
		"address":       address,
		"blockchain":    req.Blockchain,
		"derivation_path": "m/44'/60'/0'/0/0",
	})
}

// ImportWallet imports existing wallet
func (h *WalletHandler) ImportWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req ImportWalletRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.SeedPhrase == "" || req.Password == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "Seed phrase and password required")
		return
	}

	// Validate seed phrase (check word count)
	words := strings.Fields(req.SeedPhrase)
	if len(words) != 12 && len(words) != 24 {
		WriteError(w, http.StatusBadRequest, "INVALID_SEED", "Invalid seed phrase length")
		return
	}

	// Encrypt seed phrase
	encryptedSeed, err := h.service.EncryptSeedPhrase(req.SeedPhrase, req.Password)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ENCRYPTION_FAILED", "Failed to encrypt wallet")
		return
	}

	// Generate address
	address, _, err := h.service.GenerateAddress(req.SeedPhrase, req.Blockchain)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ADDRESS_GENERATION_FAILED", "Failed to generate address")
		return
	}

	seedHash := h.service.HashSeedPhrase(req.SeedPhrase)

	WriteSuccess(w, map[string]interface{}{
		"encrypted_key":   encryptedSeed,
		"address":         address,
		"blockchain":      req.Blockchain,
		"seed_phrase_hash": seedHash,
	})
}

// GetBalance returns wallet balance
func (h *WalletHandler) GetBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	address := r.URL.Query().Get("address")
	token := r.URL.Query().Get("token")
	blockchain := r.URL.Query().Get("blockchain")

	if address == "" || token == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_PARAMS", "Address and token required")
		return
	}

	balance, err := h.service.GetBalance(address, blockchain, token)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "BALANCE_ERROR", "Failed to get balance")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"address":   address,
		"token":     token,
		"balance":   balance.String(),
		"blockchain": blockchain,
	})
}

// GetAllBalances returns all balances
func (h *WalletHandler) GetAllBalances(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	address := r.URL.Query().Get("address")
	blockchain := r.URL.Query().Get("blockchain")

	// Get all supported blockchains and their balances
	blockchains := h.service.GetSupportedBlockchains()
	balances := make([]map[string]interface{}, 0)

	for _, chain := range blockchains {
		// Get native token balance
		balance, _ := h.service.GetBalance(address, chain, "")
		balances = append(balances, map[string]interface{}{
			"blockchain": chain,
			"balance":    balance.String(),
		})
	}

	WriteSuccess(w, map[string]interface{}{
		"address":  address,
		"balances": balances,
	})
}

// Transfer handles transfer request
func (h *WalletHandler) Transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req TransferRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.ToAddress == "" || req.Amount == "" || req.Token == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "Missing required fields")
		return
	}

	// Get user wallet seed from database
	// For demo, use mock
	masterSeed := "demo seed phrase"

	tx, err := h.service.SignAndBroadcast(&wallet.SendTransaction{
		From:       "0xDemo",
		To:         req.ToAddress,
		Amount:     stringToBigInt(req.Amount),
		Token:      req.Token,
		Blockchain: req.Blockchain,
	}, masterSeed)

	if err != nil {
		WriteError(w, http.StatusInternalServerError, "TRANSFER_FAILED", "Transfer failed")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"tx_hash":   tx,
		"from":      "0xDemo",
		"to":        req.ToAddress,
		"amount":    req.Amount,
		"token":     req.Token,
		"blockchain": req.Blockchain,
	})
}

// Swap handles swap request
func (h *WalletHandler) Swap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	var req SwapRequest
	if err := ParseJSON(r, &req); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.FromToken == "" || req.ToToken == "" || req.FromAmount == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_FIELDS", "Missing required fields")
		return
	}

	userSeed := "demo seed phrase"

	swapReq := &wallet.SwapRequest{
		FromToken:    req.FromToken,
		ToToken:      req.ToToken,
		FromAmount:   stringToBigInt(req.FromAmount),
		MinOutAmount: stringToBigInt(req.MinOutAmount),
		Blockchain:   req.Blockchain,
		Slippage:     req.Slippage,
	}

	tx, err := h.service.ExecuteSwap(swapReq, userSeed)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SWAP_FAILED", "Swap failed")
		return
	}

	WriteSuccess(w, map[string]interface{}{
		"tx_hash":     tx,
		"from_token":  req.FromToken,
		"to_token":    req.ToToken,
		"from_amount": req.FromAmount,
		"blockchain":  req.Blockchain,
	})
}

// GetSupportedNetworks returns supported networks
func (h *WalletHandler) GetSupportedNetworks(w http.ResponseWriter, r *http.Request) {
	blockchains := h.service.GetSupportedBlockchains()
	WriteSuccess(w, map[string]interface{}{
		"networks": blockchains,
		"count":    len(blockchains),
	})
}

func stringToBigInt(s string) interface{} {
	// Simplified - in production use big.Int
	return s
}
