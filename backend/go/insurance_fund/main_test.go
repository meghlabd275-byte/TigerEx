package main

import (
	"math"
	"testing"
)

func TestNewInsuranceFundStartsEmpty(t *testing.T) {
	fund := NewInsuranceFund()
	if len(fund.GetReserves()) != 0 {
		t.Fatalf("reserves = %+v, want empty so coverage is not overstated", fund.GetReserves())
	}
	if fund.TotalValueUSD != 0 {
		t.Fatalf("total value = %v, want 0", fund.TotalValueUSD)
	}
}

func TestDepositRejectsInvalidAmounts(t *testing.T) {
	fund := NewInsuranceFund()
	for _, amount := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if err := fund.Deposit("USDT", amount); err == nil {
			t.Errorf("Deposit(USDT, %v) = nil, want error", amount)
		}
	}
	if err := fund.Deposit("", 10); err == nil {
		t.Error("Deposit with empty asset = nil, want error")
	}
	if len(fund.GetReserves()) != 0 {
		t.Fatal("a rejected deposit must not change reserves")
	}
}

func TestDepositAndClaimFlow(t *testing.T) {
	fund := NewInsuranceFund()
	if err := fund.Deposit("USDT", 1_000_000); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := fund.GetReserves()["USDT"]; got != 1_000_000 {
		t.Fatalf("USDT reserves = %v, want 1000000", got)
	}
	if fund.TotalValueUSD != 1_000_000 {
		t.Fatalf("total value = %v, want 1000000", fund.TotalValueUSD)
	}

	claimID := fund.SubmitClaim("user-1", "USDT", 250_000, "exploit reimbursement")
	if err := fund.ProcessClaim(claimID); err == nil {
		t.Fatal("expected an unapproved claim to be rejected")
	}
	if err := fund.ApproveClaim(claimID, "risk-admin"); err != nil {
		t.Fatalf("unexpected approve error: %v", err)
	}
	if err := fund.ProcessClaim(claimID); err != nil {
		t.Fatalf("unexpected process error: %v", err)
	}
	if got := fund.GetReserves()["USDT"]; got != 750_000 {
		t.Fatalf("USDT reserves = %v, want 750000", got)
	}
}

func TestProcessClaimRejectsInsufficientReserves(t *testing.T) {
	fund := NewInsuranceFund()
	if err := fund.Deposit("BTC", 1); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	claimID := fund.SubmitClaim("user-1", "BTC", 5, "over-claim")
	if err := fund.ApproveClaim(claimID, "risk-admin"); err != nil {
		t.Fatalf("unexpected approve error: %v", err)
	}
	if err := fund.ProcessClaim(claimID); err == nil {
		t.Fatal("expected an under-reserved claim to be rejected")
	}
}
