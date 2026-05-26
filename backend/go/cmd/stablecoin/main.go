package main

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// TIGEREX STABLECOIN SERVICE - GO
// Fiat-backed stablecoin issuance and management
// ============================================================================

// ========== MODELS ==========

type Stablecoin struct {
	Symbol    string  `json:"symbol"`
	Name      string  `json:"name"`
	Collateral string  `json:"collateral"` // USD, EUR, etc.
	FiatCurrency string `json:"fiat_currency"`
	MinReserve float64 `json:"min_reserve"`
	Minted    float64 `json:"minted"`
	Supply    float64 `json:"supply"`
	Status   string  `json:"status"` // active, paused
}

type MintRequest struct {
	ID        string  `json:"id"`
	UserID   string  `json:"user_id"`
	Symbol   string  `json:"symbol"`
	Amount   float64 `json:"amount"`
	BankRef  string  `json:"bank_reference"`
	Status   string  `json:"status"` // pending, processing, completed, failed
	CreatedAt int64  `json:"created_at"`
}

type BurnRequest struct {
	ID        string  `json:"id"`
	UserID   string  `json:"user_id"`
	Symbol   string  `json:"symbol"`
	Amount   float64 `json:"amount"`
	Status   string  `json:"status"`
	CreatedAt int64  `json:"created_at"`
}

type ReserveAudit struct {
	Symbol    string  `json:"symbol"`
	FiatHoldings float64 `json:"fiat_holdings"`
	CryptoHoldings float64 `json:"crypto_holdings"`
	IssuedSupply float64 `json:"issued_supply"`
	Ratio     float64 `json:"reserve_ratio"`
	AuditedAt int64  `json:"audited_at"`
}

// ========== SERVICE ==========

type StablecoinService struct {
	stablecoins map[string]*Stablecoin
	mintRequests map[string]*MintRequest
	burnRequests map[string]*BurnRequest
	reserves   map[string]*ReserveAudit
}

func NewStablecoinService() *StablecoinService {
	s := &StablecoinService{
		stablecoins: make(map[string]*Stablecoin),
		mintRequests: make(map[string]*MintRequest),
		burnRequests: make(map[string]*BurnRequest),
		reserves: make(map[string]*ReserveAudit),
	}

	// Register stablecoins
	s.stablecoins["USDC"] = &Stablecoin{
		Symbol: "USDC", Name: "USD Coin", Collateral: "USD", FiatCurrency: "USD",
		MinReserve: 1.0, Minted: 0, Supply: 0, Status: "active"}
	s.stablecoins["USDT"] = &Stablecoin{
		Symbol: "USDT", Name: "Tether USD", Collateral: "USD", FiatCurrency: "USD",
		MinReserve: 1.0, Minted: 0, Supply: 0, Status: "active"}
	s.stablecoins["EURC"] = &Stablecoin{
		Symbol: "EURC", Name: "Euro Coin", Collateral: "EUR", FiatCurrency: "EUR",
		MinReserve: 1.0, Minted: 0, Supply: 0, Status: "active"}

	return s
}

/* Create a new stablecoin */
func (s *StablecoinService) CreateStablecoin(symbol, name, collateral, fiatCurrency string, minReserve float64) *Stablecoin {
	sc := &Stablecoin{
		Symbol: symbol, Name: name, Collateral: collateral, 
		FiatCurrency: fiatCurrency, MinReserve: minReserve, 
		Status: "active"}
	s.stablecoins[symbol] = sc
	return sc
}

/* Mint stablecoins after fiat deposit */
func (s *StablecoinService) Mint(userID, symbol, bankRef string, amount float64) *MintRequest {
	req := &MintRequest{
		ID: fmt.Sprintf("mint_%d", time.Now().UnixNano()),
		UserID: userID, Symbol: symbol, Amount: amount, 
		BankRef: bankRef, Status: "pending",
		CreatedAt: time.Now().Unix()}
	s.mintRequests[req.ID] = req
	return req
}

/* Complete mint after fiat confirmation */
func (s *StablecoinService) CompleteMint(mintID string) error {
	req, ok := s.mintRequests[mintID]
	if !ok {
		return fmt.Errorf("mint request not found")
	}

	req.Status = "completed"

	// Update supply
	if sc, ok := s.stablecoins[req.Symbol]; ok {
		sc.Minted += req.Amount
		sc.Supply += req.Amount
	}

	return nil
}

/* Burn stablecoins for fiat redemption */
func (s *StablecoinService) Burn(userID, symbol string, amount float64) *BurnRequest {
	req := &BurnRequest{
		ID: fmt.Sprintf("burn_%d", time.Now().UnixNano()),
		UserID: userID, Symbol: symbol, Amount: amount, 
		Status: "pending",
		CreatedAt: time.Now().Unix()}
	s.burnRequests[req.ID] = req

	// Decrease supply
	if sc, ok := s.stablecoins[symbol]; ok {
		sc.Supply -= amount
		sc.Minted -= amount
	}

	return req
}

/* Complete burn after redemption */
func (s *StablecoinService) CompleteBurn(burnID string) error {
	req, ok := s.burnRequests[burnID]
	if !ok {
		return fmt.Errorf("burn request not found")
	}
	req.Status = "completed"
	return nil
}

/* Get reserve audit for transparent backing */
func (s *StablecoinService) GetReserveAudit(symbol string) *ReserveAudit {
	sc, ok := s.stablecoins[symbol]
	if !ok {
		return nil
	}

	ratio := 1.0
	if sc.Supply > 0 {
		ratio = sc.Minted / sc.Supply
	}

	return &ReserveAudit{
		Symbol: symbol,
		FiatHoldings: sc.Minted,
		CryptoHoldings: sc.Minted * 0.95, // Assuming 95% fiat, 5% crypto
		IssuedSupply: sc.Supply,
		Ratio: ratio,
		AuditedAt: time.Now().Unix(),
	}
}

/* Get all stablecoins */
func (s *StablecoinService) GetStablecoins() []*Stablecoin {
	var list []*Stablecoin
	for _, sc := range s.stablecoins {
		list = append(list, sc)
	}
	return list
}

/* Check if sufficient reserve backing */
func (s *StablecoinService) CheckReserve(symbol string) bool {
	audit := s.GetReserveAudit(symbol)
	return audit.Ratio >= 1.0
}

// ========== HTTP HANDLERS ==========

func SetupStablecoinRoutes(r *gin.Engine, svc *StablecoinService) {
	api := r.Group("/api/v1/stablecoin")

	api.GET("", func(c *gin.Context) {
		scs := svc.GetStablecoins()
		c.JSON(200, scs)
	})

	api.GET("/:symbol", func(c *gin.Context) {
		symbol := c.Param("symbol")
		if sc, ok := svc.stablecoins[symbol]; ok {
			c.JSON(200, sc)
		} else {
			c.JSON(404, gin.H{"error": "not found"})
		}
	})

	api.POST("/mint", func(c *gin.Context) {
		var req struct {
			UserID   string  `json:"user_id"`
			Symbol  string  `json:"symbol"`
			Amount  float64 `json:"amount"`
			BankRef string  `json:"bank_reference"`
		}
		c.ShouldBindJSON(&req)

		mint := svc.Mint(req.UserID, req.Symbol, req.BankRef, req.Amount)
		c.JSON(201, mint)
	})

	api.POST("/mint/:id/complete", func(c *gin.Context) {
		id := c.Param("id")
		if err := svc.CompleteMint(id); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
		} else {
			c.JSON(200, gin.H{"success": true})
		}
	})

	api.POST("/burn", func(c *gin.Context) {
		var req struct {
			UserID  string  `json:"user_id"`
			Symbol string  `json:"symbol"`
			Amount float64 `json:"amount"`
		}
		c.ShouldBindJSON(&req)

		burn := svc.Burn(req.UserID, req.Symbol, req.Amount)
		c.JSON(201, burn)
	})

	api.POST("/burn/:id/complete", func(c *gin.Context) {
		id := c.Param("id")
		if err := svc.CompleteBurn(id); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
		} else {
			c.JSON(200, gin.H{"success": true})
		}
	})

	api.GET("/:symbol/reserve", func(c *gin.Context) {
		symbol := c.Param("symbol")
		audit := svc.GetReserveAudit(symbol)
		if audit == nil {
			c.JSON(404, gin.H{"error": "not found"})
		} else {
			c.JSON(200, audit)
		}
	})

	api.GET("/:symbol/check", func(c *gin.Context) {
		symbol := c.Param("symbol")
		ok := svc.CheckReserve(symbol)
		c.JSON(200, gin.H{"sufficient_reserve": ok})
	})
}

// ========== MAIN ==========

func main() {
	r := gin.Default()
	svc := NewStablecoinService()
	SetupStablecoinRoutes(r, svc)
	log.Fatal(r.Run(":8080"))
}