package p2p

import (
	"context"
	"errors"
	"testing"
)

// fakeOracle returns a fixed price so the test can assert the arithmetic.
type fakeOracle struct {
	price float64
	err   error
}

func (f fakeOracle) ReferencePrice(_ context.Context, _, _ string) (float64, error) {
	return f.price, f.err
}

func newTestService() *Service {
	return NewService(Config{MinOrderAmount: 1, MaxOrderAmount: 1000000})
}

func activeAd(priceType string, price, margin float64) *Ad {
	return &Ad{
		ID:             "ad-1",
		UserID:         "seller-1",
		Type:           "sell",
		Asset:          "BTC",
		FiatCurrency:   "USD",
		PriceType:      priceType,
		FixedPrice:     price,
		PriceMargin:    margin,
		MinAmount:      1,
		MaxAmount:      100,
		Status:         "active",
		PaymentMethods: []string{"bank_transfer"},
	}
}

// TestFixedPriceAdUsesItsOwnPrice checks the fixed-price path.
func TestFixedPriceAdUsesItsOwnPrice(t *testing.T) {
	svc := newTestService()
	ctx := context.Background()

	ad := activeAd(PriceFixed, 50000, 0)
	svc.ads[ad.ID] = ad

	order, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 2)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if order.FiatAmount != 100000 {
		t.Fatalf("fiat amount: got %v, want 100000", order.FiatAmount)
	}
}

// TestFloatingPriceAdUsesOracle is the regression test for the hard-coded
// 45,000 price that priced every floating ad at the same invented rate.
func TestFloatingPriceAdUsesOracle(t *testing.T) {
	svc := newTestService().WithPriceOracle(fakeOracle{price: 68000})
	ctx := context.Background()

	ad := activeAd(PriceFloating, 0, 0)
	svc.ads[ad.ID] = ad

	order, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 2)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if order.FiatAmount != 136000 {
		t.Fatalf("fiat amount: got %v, want 136000", order.FiatAmount)
	}
}

// TestFloatingPriceAppliesMargin checks the margin arithmetic.
func TestFloatingPriceAppliesMargin(t *testing.T) {
	svc := newTestService().WithPriceOracle(fakeOracle{price: 100000})
	ctx := context.Background()

	ad := activeAd(PriceFloating, 0, 2.5)
	svc.ads[ad.ID] = ad

	order, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 1)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	// 100000 * 1.025 is not exactly representable in binary floating point.
	if diff := order.FiatAmount - 102500; diff > 0.0001 || diff < -0.0001 {
		t.Fatalf("fiat amount: got %v, want 102500", order.FiatAmount)
	}
}

// TestFloatingPriceWithoutOracleIsRefused checks that a missing oracle blocks
// the order instead of fabricating a price.
func TestFloatingPriceWithoutOracleIsRefused(t *testing.T) {
	svc := newTestService()
	ctx := context.Background()

	ad := activeAd(PriceFloating, 0, 0)
	svc.ads[ad.ID] = ad

	if _, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 1); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("expected ErrPriceUnavailable, got %v", err)
	}
}

// TestFloatingPriceWithFailingOracleIsRefused checks oracle errors.
func TestFloatingPriceWithFailingOracleIsRefused(t *testing.T) {
	svc := newTestService().WithPriceOracle(fakeOracle{err: errors.New("feed down")})
	ctx := context.Background()

	ad := activeAd(PriceFloating, 0, 0)
	svc.ads[ad.ID] = ad

	if _, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 1); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("expected ErrPriceUnavailable, got %v", err)
	}
}

// TestFloatingPriceWithZeroOracleIsRefused checks a nonsensical price.
func TestFloatingPriceWithZeroOracleIsRefused(t *testing.T) {
	svc := newTestService().WithPriceOracle(fakeOracle{price: 0})
	ctx := context.Background()

	ad := activeAd(PriceFloating, 0, 0)
	svc.ads[ad.ID] = ad

	if _, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 1); !errors.Is(err, ErrPriceUnavailable) {
		t.Fatalf("expected ErrPriceUnavailable, got %v", err)
	}
}

// TestOrderAmountBounds checks the min and max checks.
func TestOrderAmountBounds(t *testing.T) {
	svc := newTestService()
	ctx := context.Background()

	ad := activeAd(PriceFixed, 100, 0)
	ad.MinAmount = 1
	ad.MaxAmount = 10
	svc.ads[ad.ID] = ad

	if _, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 0.5); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("expected ErrInvalidAmount below the minimum, got %v", err)
	}
	if _, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 11); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("expected ErrInvalidAmount above the maximum, got %v", err)
	}
}

// TestInactiveAdIsRefused checks the status guard.
func TestInactiveAdIsRefused(t *testing.T) {
	svc := newTestService()
	ctx := context.Background()

	ad := activeAd(PriceFixed, 100, 0)
	ad.Status = "paused"
	svc.ads[ad.ID] = ad

	if _, err := svc.CreateOrder(ctx, "buyer-1", ad.ID, 5); !errors.Is(err, ErrStatusInvalid) {
		t.Fatalf("expected ErrStatusInvalid, got %v", err)
	}
}

// TestUnknownAdIsRefused checks the lookup.
func TestUnknownAdIsRefused(t *testing.T) {
	svc := newTestService()
	if _, err := svc.CreateOrder(context.Background(), "buyer-1", "nope", 5); !errors.Is(err, ErrAdNotFound) {
		t.Fatalf("expected ErrAdNotFound, got %v", err)
	}
}
