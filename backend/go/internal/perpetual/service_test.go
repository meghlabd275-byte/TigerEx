package perpetual

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/google/uuid"
)

func TestTradingOperationsFailClosedWithoutDurableEngine(t *testing.T) {
	s := NewService()
	ctx := context.Background()
	s.InitializeDefaultMarkets()
	if markets := s.GetMarkets(ctx); len(markets) != 0 {
		t.Fatalf("GetMarkets returned %d seeded markets without a market registry", len(markets))
	}

	if err := s.CreateMarket(ctx, &Market{Symbol: "BTC/USDT"}); !errors.Is(err, ErrServiceUnavailable) {
		t.Fatalf("CreateMarket error = %v, want ErrServiceUnavailable", err)
	}
	if err := s.OpenPosition(ctx, &Position{Leverage: 1}); !errors.Is(err, ErrServiceUnavailable) {
		t.Fatalf("OpenPosition error = %v, want ErrServiceUnavailable", err)
	}
	if _, err := s.ClosePosition(ctx, uuid.New(), big.NewInt(1)); !errors.Is(err, ErrServiceUnavailable) {
		t.Fatalf("ClosePosition error = %v, want ErrServiceUnavailable", err)
	}
	if _, err := s.GetFundingRate(ctx, uuid.New()); !errors.Is(err, ErrServiceUnavailable) {
		t.Fatalf("GetFundingRate error = %v, want ErrServiceUnavailable", err)
	}
	if err := s.CreateOrder(ctx, &Order{}); !errors.Is(err, ErrServiceUnavailable) {
		t.Fatalf("CreateOrder error = %v, want ErrServiceUnavailable", err)
	}
}

func TestRiskCalculationsHandleMissingMarketData(t *testing.T) {
	s := NewService()
	if got := s.CalculateUnrealizedPNL(nil, big.NewInt(1)); got != nil {
		t.Fatalf("CalculateUnrealizedPNL with nil position = %v, want nil", got)
	}
	if s.CheckLiquidation(&Position{Status: PositionOpen, Side: PositionLong}) {
		t.Fatal("CheckLiquidation reported liquidation without mark/liquidation prices")
	}
}
