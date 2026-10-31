package fiat

import (
	"context"
	"errors"
	"testing"
)

// scriptedPrice is a PriceProvider whose result the test controls, so the
// fail-closed paths can be exercised without a live market-data service.
type scriptedPrice struct {
	price float64
	err   error
}

func (s scriptedPrice) GetPrice(_ context.Context, _ string) (float64, error) {
	return s.price, s.err
}

func TestFiatOrdersFailClosedWithoutPrice(t *testing.T) {
	svc := NewService(Config{}, nil)
	svc.InitializeProviders()

	ctx := context.Background()

	if _, err := svc.CreateDepositOrder(ctx, "u1", "simplex", "BTC", "USD", 100, ""); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("deposit without a price provider: got %v, want ErrPriceUnavailable", err)
	}
	if _, err := svc.CreateWithdrawalOrder(ctx, "u1", "simplex", "BTC", "USD", 100, "bank-1"); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("withdrawal without a price provider: got %v, want ErrPriceUnavailable", err)
	}
	if _, _, _, err := svc.GetExchangeRate(ctx, "simplex", "BTC", "USD", 100); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("rate without a price provider: got %v, want ErrPriceUnavailable", err)
	}
}

func TestFiatOrdersUseProviderPrice(t *testing.T) {
	svc := NewService(Config{}, scriptedPrice{price: 50000})
	svc.InitializeProviders()

	ctx := context.Background()

	order, err := svc.CreateDepositOrder(ctx, "u1", "simplex", "BTC", "USD", 100, "")
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if order.CryptoAmount != 100.0/50000.0 {
		t.Fatalf("crypto amount: got %v, want %v", order.CryptoAmount, 100.0/50000.0)
	}
	if order.Fee != 3.5 {
		t.Fatalf("fee: got %v, want 3.5", order.Fee)
	}

	// A provider that errors must not be papered over.
	failing := NewService(Config{}, scriptedPrice{err: errors.New("feed down")})
	failing.InitializeProviders()
	if _, err := failing.CreateDepositOrder(ctx, "u1", "simplex", "BTC", "USD", 100, ""); err == nil {
		t.Fatal("deposit with a failing price provider: want error, got nil")
	}

	// A non-positive price is not a price.
	zero := NewService(Config{}, scriptedPrice{price: 0})
	zero.InitializeProviders()
	if _, err := zero.CreateDepositOrder(ctx, "u1", "simplex", "BTC", "USD", 100, ""); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("deposit with a zero price: got %v, want ErrPriceUnavailable", err)
	}
}
