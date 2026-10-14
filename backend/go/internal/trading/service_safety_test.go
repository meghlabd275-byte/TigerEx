package trading

import (
	"context"
	"errors"
	"math"
	"testing"
)

func TestMarketDataFailsClosedWithoutProvider(t *testing.T) {
	svc := NewService(Config{})
	ctx := context.Background()

	if got := svc.GetMarkets(ctx); len(got) != 0 {
		t.Fatalf("expected no advertised markets without authoritative metadata, got %d", len(got))
	}
	if _, err := svc.GetTicker(ctx, "BTC/USDT"); !errors.Is(err, ErrMarketDataUnavailable) {
		t.Fatalf("expected ErrMarketDataUnavailable, got %v", err)
	}
	if _, err := svc.GetOrderBookDepth(ctx, "BTC/USDT", 10); !errors.Is(err, ErrMarketDataUnavailable) {
		t.Fatalf("expected ErrMarketDataUnavailable, got %v", err)
	}
	if got := svc.GetExchangeInfo(ctx).ExchangeStatus; got != "degraded" {
		t.Fatalf("expected degraded exchange status, got %q", got)
	}
}

func TestOrderCreationFailsClosedWithoutMatchingAndLedger(t *testing.T) {
	svc := NewService(Config{})
	_, err := svc.CreateOrder(context.Background(), &OrderRequest{
		UserID: "user-1", Symbol: "BTC/USDT", Side: "buy", Type: "market", Quantity: 1,
	})
	if !errors.Is(err, ErrTradingPaused) {
		t.Fatalf("expected ErrTradingPaused, got %v", err)
	}
}

func TestOrderCreationRejectsNonFiniteValues(t *testing.T) {
	svc := NewService(Config{})
	_, err := svc.CreateOrder(context.Background(), &OrderRequest{
		UserID: "user-1", Symbol: "BTC/USDT", Side: "buy", Type: "market", Quantity: math.NaN(),
	})
	if !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("expected ErrInvalidOrder for NaN quantity, got %v", err)
	}
}

func TestYieldProductsAreNotInvented(t *testing.T) {
	svc := NewService(Config{})
	ctx := context.Background()
	if got := svc.GetStakingProducts(ctx); len(got) != 0 {
		t.Fatalf("expected no staking products without authoritative configuration, got %d", len(got))
	}
	if got := svc.GetSavingsProducts(ctx); len(got) != 0 {
		t.Fatalf("expected no savings products without authoritative configuration, got %d", len(got))
	}
	if got := svc.GetLendingProducts(ctx); len(got) != 0 {
		t.Fatalf("expected no lending products without authoritative configuration, got %d", len(got))
	}
	_, err := svc.Stake(ctx, &StakeRequest{UserID: "user-1", Asset: "ETH", Amount: 1})
	if !errors.Is(err, ErrPersistenceUnavailable) {
		t.Fatalf("expected ErrPersistenceUnavailable, got %v", err)
	}
}
