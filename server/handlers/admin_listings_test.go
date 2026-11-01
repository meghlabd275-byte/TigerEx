package handlers

import (
	"testing"
)

// A market symbol is the one listing field that ends up in URLs, log lines and
// query strings, so it is the field most worth pinning down. These cases assert
// that only BASE/QUOTE survives.
func TestValidateSymbolAcceptsOnlyBaseQuotePairs(t *testing.T) {
	valid := []string{
		"BTC/USDT",
		"ETH/USDC",
		"1000PEPE/USDT",
		"BTC-USD/PERP",
		"TGR/RUSD",
	}
	for _, symbol := range valid {
		if err := validateSymbol(symbol); err != nil {
			t.Errorf("validateSymbol(%q) = %v, want nil", symbol, err)
		}
	}

	invalid := []string{
		"",
		"BTC",
		"BTC/",
		"/USDT",
		"BTC/USDT/PERP",
		"btc/usdt",           // lowercase would not match the stored symbol
		"BTC/USDT<script>",   // markup must never reach a listing
		"BTC/USDT' OR 1=1--", // nor a quote fragment
		"BTC/USDT; DROP TABLE futures_markets;",
		"BTC /USDT",
		"BTC/US DT",
		"BTC/USDT\n",
		"BTC/RUSD\x00",
	}
	for _, symbol := range invalid {
		if err := validateSymbol(symbol); err == nil {
			t.Errorf("validateSymbol(%q) = nil, want error", symbol)
		}
	}
}

func TestValidateCurrencyBoundsAndAlphabet(t *testing.T) {
	for _, currency := range []string{"USDT", "USDC", "RUSD", "TGR", "BTC", "1000PEPE"} {
		if err := validateCurrency(currency); err != nil {
			t.Errorf("validateCurrency(%q) = %v, want nil", currency, err)
		}
	}
	for _, currency := range []string{"", "A", "usdt", "US DT", "USDT/", "USDT'", "USDT;--", "USDT<script>"} {
		if err := validateCurrency(currency); err == nil {
			t.Errorf("validateCurrency(%q) = nil, want error", currency)
		}
	}
}

func TestFuturesMarketRequestRejectsUnsafeRiskParameters(t *testing.T) {
	base := futuresMarketRequest{
		Symbol:                "BTC/USDT",
		BaseCurrency:          "BTC",
		QuoteCurrency:         "USDT",
		SettlementCurrency:    "USDT",
		ContractType:          "perpetual",
		MarginType:            "usdt_m",
		ContractSize:          1,
		PricePrecision:        2,
		QuantityPrecision:     3,
		MinQuantity:           0.001,
		MaxLeverage:           125,
		InitialMarginRate:     0.008,
		MaintenanceMarginRate: 0.005,
		LiquidationFeeRate:    0.005,
		MakerFee:              0.0002,
		TakerFee:              0.0005,
		FundingIntervalHours:  8,
		FundingRateCap:        0.01,
		OracleSource:          "tigerex-mark",
		Status:                "paused",
	}

	base.normalize()
	if err := base.validate(); err != nil {
		t.Fatalf("baseline market should validate, got: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(r *futuresMarketRequest)
	}{
		{"maintenance at or above initial margin", func(r *futuresMarketRequest) { r.MaintenanceMarginRate = r.InitialMarginRate }},
		{"zero initial margin", func(r *futuresMarketRequest) { r.InitialMarginRate = 0 }},
		{"margin rate above one", func(r *futuresMarketRequest) { r.InitialMarginRate = 1.5 }},
		{"leverage above the ceiling", func(r *futuresMarketRequest) { r.MaxLeverage = 1002 }},
		{"zero leverage", func(r *futuresMarketRequest) { r.MaxLeverage = 0 }},
		{"negative taker fee", func(r *futuresMarketRequest) { r.TakerFee = -0.01 }},
		{"negative contract size", func(r *futuresMarketRequest) { r.ContractSize = -1 }},
		{"zero min quantity", func(r *futuresMarketRequest) { r.MinQuantity = 0 }},
		{"funding cap above one", func(r *futuresMarketRequest) { r.FundingRateCap = 2 }},
		{"zero funding interval", func(r *futuresMarketRequest) { r.FundingIntervalHours = 0 }},
		{"unknown contract type", func(r *futuresMarketRequest) { r.ContractType = "swap" }},
		{"unknown margin type", func(r *futuresMarketRequest) { r.MarginType = "eur_m" }},
		{"unknown status", func(r *futuresMarketRequest) { r.Status = "live" }},
		{"blank oracle", func(r *futuresMarketRequest) { r.OracleSource = "  " }},
		{"unsafe symbol", func(r *futuresMarketRequest) { r.Symbol = "BTC/USDT; DROP TABLE futures_markets" }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := base
			tc.mutate(&candidate)
			candidate.normalize()
			if err := candidate.validate(); err == nil {
				t.Fatalf("expected validation to reject %s", tc.name)
			}
		})
	}
}

func TestMarginMarketRequestRejectsUnsafeRiskParameters(t *testing.T) {
	base := marginMarketRequest{
		Symbol:                  "BTC/USDT",
		BaseCurrency:            "BTC",
		QuoteCurrency:           "USDT",
		MarginMode:              "cross",
		MaxLeverage:             10,
		CollateralAsset:         "BTC",
		CollateralLTV:           0.7,
		LiquidationThreshold:    0.75,
		LiquidationBonus:        0.05,
		BorrowableAsset:         "USDT",
		InterestBaseAPY:         0.05,
		InterestKinkUtilization: 0.8,
		InterestJumpMultiplier:  1.5,
		Status:                  "paused",
	}

	base.normalize()
	if err := base.validate(); err != nil {
		t.Fatalf("baseline margin market should validate, got: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(r *marginMarketRequest)
	}{
		{"ltv at or above liquidation threshold", func(r *marginMarketRequest) { r.CollateralLTV = r.LiquidationThreshold }},
		{"zero ltv", func(r *marginMarketRequest) { r.CollateralLTV = 0 }},
		{"ltv of one means no collateral", func(r *marginMarketRequest) { r.CollateralLTV = 1 }},
		{"zero liquidation threshold", func(r *marginMarketRequest) { r.LiquidationThreshold = 0 }},
		{"negative liquidation bonus", func(r *marginMarketRequest) { r.LiquidationBonus = -0.1 }},
		{"negative base apy", func(r *marginMarketRequest) { r.InterestBaseAPY = -1 }},
		{"kink at one", func(r *marginMarketRequest) { r.InterestKinkUtilization = 1 }},
		{"jump multiplier below one", func(r *marginMarketRequest) { r.InterestJumpMultiplier = 0.5 }},
		{"leverage above spot margin ceiling", func(r *marginMarketRequest) { r.MaxLeverage = 21 }},
		{"unknown margin mode", func(r *marginMarketRequest) { r.MarginMode = "portfolio" }},
		{"unknown status", func(r *marginMarketRequest) { r.Status = "live" }},
		{"unsafe collateral asset", func(r *marginMarketRequest) { r.CollateralAsset = "BTC' OR 1=1" }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := base
			tc.mutate(&candidate)
			candidate.normalize()
			if err := candidate.validate(); err == nil {
				t.Fatalf("expected validation to reject %s", tc.name)
			}
		})
	}
}

// normalize() is the only thing standing between operator input and the unique
// symbol column, so it must not leave a value that would create a lookalike
// duplicate of an existing market.
func TestNormalizeUppercasesAndDefaultsStatus(t *testing.T) {
	req := futuresMarketRequest{
		Symbol:             " btc/usdt ",
		BaseCurrency:       " btc ",
		QuoteCurrency:      " usdt ",
		SettlementCurrency: " usdt ",
		ContractType:       " PERPETUAL ",
		MarginType:         " USDT_M ",
		OracleSource:       " tigerex-mark ",
	}
	req.normalize()

	if req.Symbol != "BTC/USDT" {
		t.Errorf("symbol = %q, want BTC/USDT", req.Symbol)
	}
	if req.BaseCurrency != "BTC" || req.QuoteCurrency != "USDT" || req.SettlementCurrency != "USDT" {
		t.Errorf("currencies not normalized: %q %q %q", req.BaseCurrency, req.QuoteCurrency, req.SettlementCurrency)
	}
	if req.ContractType != "perpetual" || req.MarginType != "usdt_m" {
		t.Errorf("enums not normalized: %q %q", req.ContractType, req.MarginType)
	}
	if req.Status != "paused" {
		t.Errorf("status = %q, want default paused so a new listing is not live by accident", req.Status)
	}
}
