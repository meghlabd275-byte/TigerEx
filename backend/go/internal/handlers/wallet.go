package handlers

import (
	"errors"
	"net/http"

	"tigerex/backend/internal/wallet"
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
	Password   string `json:"password"`
	Blockchain string `json:"blockchain"`
	Name       string `json:"name"`
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
	ToAddress  string `json:"to_address"`
	Amount     string `json:"amount"`
	Token      string `json:"token"`
	Blockchain string `json:"blockchain"`
}

// SwapRequest represents swap request
type SwapRequest struct {
	FromToken    string  `json:"from_token"`
	ToToken      string  `json:"to_token"`
	FromAmount   string  `json:"from_amount"`
	MinOutAmount string  `json:"min_out_amount"`
	Blockchain   string  `json:"blockchain"`
	Slippage     float64 `json:"slippage"`
}

// writeCustodyUnavailable reports that an operation needs the durable custody
// stack (HD derivation, signing, policy checks) that is not yet configured.
func writeCustodyUnavailable(w http.ResponseWriter) {
	WriteError(w, http.StatusServiceUnavailable, "CUSTODY_NOT_CONFIGURED",
		"This operation is unavailable until authenticated custody signing and policy controls are configured")
}

// GenerateWallet is disabled: a custody key must be derived by the wallet service
// and never returned to a caller over the API.
func (h *WalletHandler) GenerateWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	writeCustodyUnavailable(w)
}

// ImportWallet is disabled: importing a seed phrase must not echo key material back.
func (h *WalletHandler) ImportWallet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	writeCustodyUnavailable(w)
}

// GetBalance returns a balance from the authoritative ledger, or fails closed.
func (h *WalletHandler) GetBalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	userID, asset := r.URL.Query().Get("user_id"), r.URL.Query().Get("token")
	if userID == "" || asset == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_PARAMS", "user_id and token are required")
		return
	}

	bal, err := h.service.GetBalance(r.Context(), userID, asset)
	if err != nil {
		if errors.Is(err, wallet.ErrCustodyUnavailable) {
			writeCustodyUnavailable(w)
			return
		}
		WriteError(w, http.StatusBadRequest, "BALANCE_ERROR", err.Error())
		return
	}

	WriteSuccess(w, bal)
}

// GetAllBalances returns every wallet for a user, or fails closed.
func (h *WalletHandler) GetAllBalances(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		WriteError(w, http.StatusBadRequest, "MISSING_PARAMS", "user_id is required")
		return
	}

	wallets, err := h.service.GetWallets(r.Context(), userID)
	if err != nil {
		if errors.Is(err, wallet.ErrCustodyUnavailable) {
			writeCustodyUnavailable(w)
			return
		}
		WriteError(w, http.StatusBadRequest, "BALANCE_ERROR", err.Error())
		return
	}

	WriteSuccess(w, map[string]interface{}{"wallets": wallets})
}

// Transfer requests an internal transfer, which the ledger service settles atomically.
func (h *WalletHandler) Transfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	// Never sign with a source-code seed or report a transfer without a
	// user-scoped custody key, policy checks, and a verified broadcast lifecycle.
	writeCustodyUnavailable(w)
}

// Swap requests a swap, which requires authenticated signing and settlement.
func (h *WalletHandler) Swap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
	// Never fabricate a swap transaction using a source-code seed phrase.
	writeCustodyUnavailable(w)
}

// GetSupportedNetworks lists the networks a deposit address can be issued on.
func (h *WalletHandler) GetSupportedNetworks(w http.ResponseWriter, r *http.Request) {
	WriteSuccess(w, map[string]interface{}{"networks": supportedNetworks})
}

// supportedNetworks enumerates the chain families the wallet service validates
// addresses for. It is configuration, not chain connectivity.
var supportedNetworks = []string{"BTC", "ETH", "USDT", "BNB", "MATIC", "AVAX"}
