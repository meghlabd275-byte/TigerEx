// Admin listing handlers for futures/perpetual and margin markets.
//
// These handlers are the only path that creates a tradable derivative or margin
// instrument. Every value is validated and bound as a query parameter, every
// mutation is recorded in the immutable admin audit log, and nothing is seeded
// or defaulted to a fake symbol.
package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tigerex/server/models"
)

var (
	errInvalidSymbol     = errors.New("symbol must look like BASE/QUOTE using uppercase letters, digits and dashes")
	errInvalidCurrency   = errors.New("currency must be 2-12 uppercase letters or digits")
	errUnsupportedStatus = errors.New("status must be one of active, paused or delisting")
)

var allowedListingStatuses = map[string]bool{"active": true, "paused": true, "delisting": true}
var allowedFuturesContractTypes = map[string]bool{"perpetual": true, "quarterly": true, "delivery": true}
var allowedFuturesMarginTypes = map[string]bool{"usdt_m": true, "usdc_m": true, "coin_m": true}
var allowedMarginModes = map[string]bool{"cross": true, "isolated": true}

// validateSymbol accepts only BASE/QUOTE pairs, so a crafted symbol cannot be
// used to smuggle markup or control characters into a market listing.
func validateSymbol(symbol string) error {
	if symbol == "" || len(symbol) > 50 {
		return errInvalidSymbol
	}
	parts := strings.Split(symbol, "/")
	if len(parts) != 2 {
		return errInvalidSymbol
	}
	for _, part := range parts {
		if len(part) == 0 || len(part) > 20 {
			return errInvalidSymbol
		}
		for _, r := range part {
			isUpper := r >= 'A' && r <= 'Z'
			isDigit := r >= '0' && r <= '9'
			if !isUpper && !isDigit && r != '-' {
				return errInvalidSymbol
			}
		}
	}
	return nil
}

func validateCurrency(currency string) error {
	if len(currency) < 2 || len(currency) > 12 {
		return errInvalidCurrency
	}
	for _, r := range currency {
		isUpper := r >= 'A' && r <= 'Z'
		isDigit := r >= '0' && r <= '9'
		if !isUpper && !isDigit {
			return errInvalidCurrency
		}
	}
	return nil
}

func validateStatus(status string) error {
	if !allowedListingStatuses[status] {
		return errUnsupportedStatus
	}
	return nil
}

// validateRate guards the risk parameters that decide how much leverage a
// trader may take and how much of a position is liquidated.
func validateRate(name string, value float64, allowZero, allowOne bool) error {
	if value < 0 || (value == 0 && !allowZero) {
		return fmt.Errorf("%s must be greater than zero", name)
	}
	if value > 1 || (value == 1 && !allowOne) {
		return fmt.Errorf("%s must be less than one", name)
	}
	return nil
}

type futuresMarketRequest struct {
	Symbol                string  `json:"symbol" binding:"required"`
	BaseCurrency          string  `json:"baseCurrency" binding:"required"`
	QuoteCurrency         string  `json:"quoteCurrency" binding:"required"`
	SettlementCurrency    string  `json:"settlementCurrency" binding:"required"`
	ContractType          string  `json:"contractType" binding:"required"`
	MarginType            string  `json:"marginType" binding:"required"`
	ContractSize          float64 `json:"contractSize"`
	PricePrecision        int     `json:"pricePrecision"`
	QuantityPrecision     int     `json:"quantityPrecision"`
	MinQuantity           float64 `json:"minQuantity"`
	MaxLeverage           int     `json:"maxLeverage"`
	InitialMarginRate     float64 `json:"initialMarginRate"`
	MaintenanceMarginRate float64 `json:"maintenanceMarginRate"`
	LiquidationFeeRate    float64 `json:"liquidationFeeRate"`
	MakerFee              float64 `json:"makerFee"`
	TakerFee              float64 `json:"takerFee"`
	FundingIntervalHours  int     `json:"fundingIntervalHours"`
	FundingRateCap        float64 `json:"fundingRateCap"`
	OracleSource          string  `json:"oracleSource" binding:"required"`
	Status                string  `json:"status"`
}

func (r *futuresMarketRequest) normalize() {
	r.Symbol = strings.ToUpper(strings.TrimSpace(r.Symbol))
	r.BaseCurrency = strings.ToUpper(strings.TrimSpace(r.BaseCurrency))
	r.QuoteCurrency = strings.ToUpper(strings.TrimSpace(r.QuoteCurrency))
	r.SettlementCurrency = strings.ToUpper(strings.TrimSpace(r.SettlementCurrency))
	r.ContractType = strings.ToLower(strings.TrimSpace(r.ContractType))
	r.MarginType = strings.ToLower(strings.TrimSpace(r.MarginType))
	r.OracleSource = strings.TrimSpace(r.OracleSource)
	r.Status = strings.ToLower(strings.TrimSpace(r.Status))
	if r.Status == "" {
		r.Status = "paused"
	}
}

func (r *futuresMarketRequest) validate() error {
	if err := validateSymbol(r.Symbol); err != nil {
		return err
	}
	for _, currency := range []string{r.BaseCurrency, r.QuoteCurrency, r.SettlementCurrency} {
		if err := validateCurrency(currency); err != nil {
			return err
		}
	}
	if !allowedFuturesContractTypes[r.ContractType] {
		return errors.New("contractType must be perpetual, quarterly or delivery")
	}
	if !allowedFuturesMarginTypes[r.MarginType] {
		return errors.New("marginType must be usdt_m, usdc_m or coin_m")
	}
	if err := validateStatus(r.Status); err != nil {
		return err
	}
	if r.ContractSize <= 0 {
		return errors.New("contractSize must be greater than zero")
	}
	if r.PricePrecision < 0 || r.PricePrecision > 18 || r.QuantityPrecision < 0 || r.QuantityPrecision > 18 {
		return errors.New("precision must be between 0 and 18")
	}
	if r.MinQuantity <= 0 {
		return errors.New("minQuantity must be greater than zero")
	}
	if r.MaxLeverage < 1 || r.MaxLeverage > 1001 {
		return errors.New("maxLeverage must be between 1 and 1001")
	}
	if err := validateRate("initialMarginRate", r.InitialMarginRate, false, false); err != nil {
		return err
	}
	if err := validateRate("maintenanceMarginRate", r.MaintenanceMarginRate, false, false); err != nil {
		return err
	}
	if r.MaintenanceMarginRate >= r.InitialMarginRate {
		return errors.New("maintenanceMarginRate must be lower than initialMarginRate")
	}
	if err := validateRate("liquidationFeeRate", r.LiquidationFeeRate, true, false); err != nil {
		return err
	}
	if err := validateRate("makerFee", r.MakerFee, true, false); err != nil {
		return err
	}
	if err := validateRate("takerFee", r.TakerFee, true, false); err != nil {
		return err
	}
	if r.FundingIntervalHours < 1 || r.FundingIntervalHours > 24 {
		return errors.New("fundingIntervalHours must be between 1 and 24")
	}
	if r.FundingRateCap <= 0 || r.FundingRateCap > 1 {
		return errors.New("fundingRateCap must be greater than zero and at most one")
	}
	if r.OracleSource == "" || len(r.OracleSource) > 80 {
		return errors.New("oracleSource is required and must be at most 80 characters")
	}
	return nil
}

type marginMarketRequest struct {
	Symbol                  string  `json:"symbol" binding:"required"`
	BaseCurrency            string  `json:"baseCurrency" binding:"required"`
	QuoteCurrency           string  `json:"quoteCurrency" binding:"required"`
	MarginMode              string  `json:"marginMode" binding:"required"`
	MaxLeverage             int     `json:"maxLeverage"`
	CollateralAsset         string  `json:"collateralAsset" binding:"required"`
	CollateralLTV           float64 `json:"collateralLtv"`
	LiquidationThreshold    float64 `json:"liquidationThreshold"`
	LiquidationBonus        float64 `json:"liquidationBonus"`
	BorrowableAsset         string  `json:"borrowableAsset" binding:"required"`
	InterestBaseAPY         float64 `json:"interestBaseApy"`
	InterestKinkUtilization float64 `json:"interestKinkUtilization"`
	InterestJumpMultiplier  float64 `json:"interestJumpMultiplier"`
	Status                  string  `json:"status"`
}

func (r *marginMarketRequest) normalize() {
	r.Symbol = strings.ToUpper(strings.TrimSpace(r.Symbol))
	r.BaseCurrency = strings.ToUpper(strings.TrimSpace(r.BaseCurrency))
	r.QuoteCurrency = strings.ToUpper(strings.TrimSpace(r.QuoteCurrency))
	r.CollateralAsset = strings.ToUpper(strings.TrimSpace(r.CollateralAsset))
	r.BorrowableAsset = strings.ToUpper(strings.TrimSpace(r.BorrowableAsset))
	r.MarginMode = strings.ToLower(strings.TrimSpace(r.MarginMode))
	r.Status = strings.ToLower(strings.TrimSpace(r.Status))
	if r.Status == "" {
		r.Status = "paused"
	}
}

func (r *marginMarketRequest) validate() error {
	if err := validateSymbol(r.Symbol); err != nil {
		return err
	}
	for _, currency := range []string{r.BaseCurrency, r.QuoteCurrency, r.CollateralAsset, r.BorrowableAsset} {
		if err := validateCurrency(currency); err != nil {
			return err
		}
	}
	if !allowedMarginModes[r.MarginMode] {
		return errors.New("marginMode must be cross or isolated")
	}
	if err := validateStatus(r.Status); err != nil {
		return err
	}
	if r.MaxLeverage < 1 || r.MaxLeverage > 20 {
		return errors.New("maxLeverage must be between 1 and 20 for spot margin")
	}
	if r.CollateralLTV <= 0 || r.CollateralLTV >= 1 {
		return errors.New("collateralLtv must be greater than zero and less than one")
	}
	if r.LiquidationThreshold <= 0 || r.LiquidationThreshold > 1 {
		return errors.New("liquidationThreshold must be greater than zero and at most one")
	}
	if r.CollateralLTV >= r.LiquidationThreshold {
		return errors.New("collateralLtv must be lower than liquidationThreshold")
	}
	if r.LiquidationBonus < 0 || r.LiquidationBonus >= 1 {
		return errors.New("liquidationBonus must be at least zero and less than one")
	}
	if r.InterestBaseAPY < 0 {
		return errors.New("interestBaseApy must not be negative")
	}
	if r.InterestKinkUtilization <= 0 || r.InterestKinkUtilization >= 1 {
		return errors.New("interestKinkUtilization must be greater than zero and less than one")
	}
	if r.InterestJumpMultiplier < 1 {
		return errors.New("interestJumpMultiplier must be at least one")
	}
	return nil
}

func adminUUID(c *gin.Context, adminID string) uuid.UUID {
	if parsed, err := uuid.Parse(adminID); err == nil {
		return parsed
	}
	return uuid.Nil
}

// ============ FUTURES / PERPETUAL MARKET LISTING ============

func ListFuturesMarkets(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, symbol, base_currency, quote_currency, settlement_currency, contract_type,
		       margin_type, max_leverage, funding_interval_hours, oracle_source, status, created_at, updated_at
		FROM futures_markets
		ORDER BY updated_at DESC
		LIMIT 500
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures market registry is unavailable"}})
		return
	}
	defer rows.Close()

	markets := []gin.H{}
	for rows.Next() {
		var id uuid.UUID
		var symbol, base, quote, settlement, contractType, marginType, oracleSource, status string
		var maxLeverage, fundingInterval int
		var createdAt, updatedAt interface{}
		if err := rows.Scan(&id, &symbol, &base, &quote, &settlement, &contractType, &marginType,
			&maxLeverage, &fundingInterval, &oracleSource, &status, &createdAt, &updatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures market metadata could not be read"}})
			return
		}
		markets = append(markets, gin.H{
			"id": id, "symbol": symbol, "baseCurrency": base, "quoteCurrency": quote,
			"settlementCurrency": settlement, "contractType": contractType, "marginType": marginType,
			"maxLeverage": maxLeverage, "fundingIntervalHours": fundingInterval,
			"oracleSource": oracleSource, "status": status, "createdAt": createdAt, "updatedAt": updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures market query failed"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": markets})
}

func CreateFuturesMarket(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	var req futuresMarketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	req.normalize()
	if err := req.validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	var id uuid.UUID
	err := models.Pool.QueryRow(c.Request.Context(), `
		INSERT INTO futures_markets (
			symbol, base_currency, quote_currency, settlement_currency, contract_type, margin_type,
			contract_size, price_precision, quantity_precision, min_quantity, max_leverage,
			initial_margin_rate, maintenance_margin_rate, liquidation_fee_rate, maker_fee, taker_fee,
			funding_interval_hours, funding_rate_cap, oracle_source, status, created_by, updated_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
		RETURNING id
	`, req.Symbol, req.BaseCurrency, req.QuoteCurrency, req.SettlementCurrency, req.ContractType, req.MarginType,
		req.ContractSize, req.PricePrecision, req.QuantityPrecision, req.MinQuantity, req.MaxLeverage,
		req.InitialMarginRate, req.MaintenanceMarginRate, req.LiquidationFeeRate, req.MakerFee, req.TakerFee,
		req.FundingIntervalHours, req.FundingRateCap, req.OracleSource, req.Status, adminUUID(c, adminID)).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "A futures market with that symbol already exists"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures market could not be created"}})
		return
	}

	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_FUTURES_MARKET", "futures_markets", id.String(), gin.H{"symbol": req.Symbol})
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"id": id, "symbol": req.Symbol, "status": req.Status}})
}

func UpdateFuturesMarket(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid market id"}})
		return
	}

	var req futuresMarketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	req.normalize()
	if err := req.validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	cmd, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE futures_markets SET
			symbol=$1, base_currency=$2, quote_currency=$3, settlement_currency=$4, contract_type=$5,
			margin_type=$6, contract_size=$7, price_precision=$8, quantity_precision=$9, min_quantity=$10,
			max_leverage=$11, initial_margin_rate=$12, maintenance_margin_rate=$13, liquidation_fee_rate=$14,
			maker_fee=$15, taker_fee=$16, funding_interval_hours=$17, funding_rate_cap=$18,
			oracle_source=$19, status=$20, updated_by=$21, updated_at=NOW()
		WHERE id=$22
	`, req.Symbol, req.BaseCurrency, req.QuoteCurrency, req.SettlementCurrency, req.ContractType,
		req.MarginType, req.ContractSize, req.PricePrecision, req.QuantityPrecision, req.MinQuantity,
		req.MaxLeverage, req.InitialMarginRate, req.MaintenanceMarginRate, req.LiquidationFeeRate,
		req.MakerFee, req.TakerFee, req.FundingIntervalHours, req.FundingRateCap,
		req.OracleSource, req.Status, adminUUID(c, adminID), id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "A futures market with that symbol already exists"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures market could not be updated"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Futures market not found"}})
		return
	}

	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_FUTURES_MARKET", "futures_markets", id, gin.H{"symbol": req.Symbol})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": id, "symbol": req.Symbol, "status": req.Status}})
}

func DeleteFuturesMarket(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid market id"}})
		return
	}
	cmd, err := models.Pool.Exec(c.Request.Context(),
		`UPDATE futures_markets SET status='delisting', updated_by=$1, updated_at=NOW() WHERE id=$2`,
		adminUUID(c, adminID), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Futures market could not be delisted"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Futures market not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "DELIST_FUTURES_MARKET", "futures_markets", id, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": id, "status": "delisting"}})
}

// ============ MARGIN MARKET LISTING ============

func ListMarginMarkets(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	rows, err := models.Pool.Query(c.Request.Context(), `
		SELECT id, symbol, base_currency, quote_currency, margin_mode, max_leverage,
		       collateral_asset, collateral_ltv, liquidation_threshold, liquidation_bonus,
		       borrowable_asset, interest_base_apy, interest_kink_utilization, interest_jump_multiplier,
		       status, created_at, updated_at
		FROM margin_markets
		ORDER BY updated_at DESC
		LIMIT 500
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Margin market registry is unavailable"}})
		return
	}
	defer rows.Close()

	markets := []gin.H{}
	for rows.Next() {
		var id uuid.UUID
		var symbol, base, quote, mode, collateralAsset, borrowableAsset, status string
		var maxLeverage int
		var collateralLTV, liqThreshold, liqBonus, baseAPY, kink, jump float64
		var createdAt, updatedAt interface{}
		if err := rows.Scan(&id, &symbol, &base, &quote, &mode, &maxLeverage,
			&collateralAsset, &collateralLTV, &liqThreshold, &liqBonus,
			&borrowableAsset, &baseAPY, &kink, &jump, &status, &createdAt, &updatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Margin market metadata could not be read"}})
			return
		}
		markets = append(markets, gin.H{
			"id": id, "symbol": symbol, "baseCurrency": base, "quoteCurrency": quote,
			"marginMode": mode, "maxLeverage": maxLeverage, "collateralAsset": collateralAsset,
			"collateralLtv": collateralLTV, "liquidationThreshold": liqThreshold,
			"liquidationBonus": liqBonus, "borrowableAsset": borrowableAsset,
			"interestBaseApy": baseAPY, "interestKinkUtilization": kink,
			"interestJumpMultiplier": jump, "status": status,
			"createdAt": createdAt, "updatedAt": updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Margin market query failed"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": markets})
}

func CreateMarginMarket(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	var req marginMarketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	req.normalize()
	if err := req.validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	var id uuid.UUID
	err := models.Pool.QueryRow(c.Request.Context(), `
		INSERT INTO margin_markets (
			symbol, base_currency, quote_currency, margin_mode, max_leverage, collateral_asset,
			collateral_ltv, liquidation_threshold, liquidation_bonus, borrowable_asset,
			interest_base_apy, interest_kink_utilization, interest_jump_multiplier, status, created_by, updated_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
		RETURNING id
	`, req.Symbol, req.BaseCurrency, req.QuoteCurrency, req.MarginMode, req.MaxLeverage, req.CollateralAsset,
		req.CollateralLTV, req.LiquidationThreshold, req.LiquidationBonus, req.BorrowableAsset,
		req.InterestBaseAPY, req.InterestKinkUtilization, req.InterestJumpMultiplier, req.Status, adminUUID(c, adminID)).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "A margin market with that symbol already exists"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Margin market could not be created"}})
		return
	}

	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "CREATE_MARGIN_MARKET", "margin_markets", id.String(), gin.H{"symbol": req.Symbol})
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"id": id, "symbol": req.Symbol, "status": req.Status}})
}

func UpdateMarginMarket(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid market id"}})
		return
	}

	var req marginMarketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid request body"}})
		return
	}
	req.normalize()
	if err := req.validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": err.Error()}})
		return
	}

	cmd, err := models.Pool.Exec(c.Request.Context(), `
		UPDATE margin_markets SET
			symbol=$1, base_currency=$2, quote_currency=$3, margin_mode=$4, max_leverage=$5,
			collateral_asset=$6, collateral_ltv=$7, liquidation_threshold=$8, liquidation_bonus=$9,
			borrowable_asset=$10, interest_base_apy=$11, interest_kink_utilization=$12,
			interest_jump_multiplier=$13, status=$14, updated_by=$15, updated_at=NOW()
		WHERE id=$16
	`, req.Symbol, req.BaseCurrency, req.QuoteCurrency, req.MarginMode, req.MaxLeverage,
		req.CollateralAsset, req.CollateralLTV, req.LiquidationThreshold, req.LiquidationBonus,
		req.BorrowableAsset, req.InterestBaseAPY, req.InterestKinkUtilization,
		req.InterestJumpMultiplier, req.Status, adminUUID(c, adminID), id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": gin.H{"code": 409, "message": "A margin market with that symbol already exists"}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Margin market could not be updated"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Margin market not found"}})
		return
	}

	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "UPDATE_MARGIN_MARKET", "margin_markets", id, gin.H{"symbol": req.Symbol})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": id, "symbol": req.Symbol, "status": req.Status}})
}

func DeleteMarginMarket(c *gin.Context) {
	adminID := checkAdminPermission(c, models.PermListingManagement)
	if adminID == "" {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": gin.H{"code": 400, "message": "Invalid market id"}})
		return
	}
	cmd, err := models.Pool.Exec(c.Request.Context(),
		`UPDATE margin_markets SET status='delisting', updated_by=$1, updated_at=NOW() WHERE id=$2`,
		adminUUID(c, adminID), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": gin.H{"code": 500, "message": "Margin market could not be delisted"}})
		return
	}
	if cmd.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": gin.H{"code": 404, "message": "Margin market not found"}})
		return
	}
	_ = models.LogAdminAction(adminID, c.GetString("admin_username"), "DELIST_MARGIN_MARKET", "margin_markets", id, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": id, "status": "delisting"}})
}
