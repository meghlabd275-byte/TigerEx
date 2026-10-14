package analytics

import (
	"errors"
	"math"
	"testing"
	"time"
)

func TestAnalyticsFailsClosedWithoutAuthoritativeSource(t *testing.T) {
	manager := NewAnalyticsManager()
	checks := []struct {
		name string
		err  error
	}{
		{"trade analytics", func() error { _, err := manager.CalculateTradeAnalytics("user-1"); return err }()},
		{"portfolio save", manager.SavePortfolioSnapshot("user-1", PortfolioSnapshot{UserID: "user-1"})},
		{"portfolio history", func() error { _, err := manager.GetPortfolioHistory("user-1", 10); return err }()},
		{"market stats", func() error { _, err := manager.GetMarketStats("BTC-USD"); return err }()},
		{"market stats update", manager.UpdateMarketStats("BTC-USD", MarketStats{Symbol: "BTC-USD"})},
		{"top traders", func() error { _, err := manager.GetTopTraders(10); return err }()},
		{"volume", func() error { _, err := manager.GetTradingVolume("user-1", "1d"); return err }()},
		{"fees", func() error { _, err := manager.GetFeesPaid("user-1", "1d"); return err }()},
		{"pnl", func() error { _, err := manager.GetProfitLoss("user-1", "1d"); return err }()},
		{"allocation", func() error { _, err := manager.GetAssetAllocation("user-1"); return err }()},
		{"history", func() error { _, err := manager.GetTradingHistory("user-1", time.Now().Add(-time.Hour), time.Now()); return err }()},
		{"performance", func() error { _, err := manager.GetPerformanceMetrics("user-1"); return err }()},
		{"report", func() error { _, err := manager.GenerateReport("user-1", "trades"); return err }()},
		{"risk", func() error { _, err := manager.GetRiskMetrics("user-1"); return err }()},
		{"leaderboard", func() error { _, err := manager.GetLeaderboard("volume", 10); return err }()},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if !errors.Is(check.err, ErrAnalyticsUnavailable) {
				t.Fatalf("expected ErrAnalyticsUnavailable, got %v", check.err)
			}
		})
	}
}

func TestCalculateROI(t *testing.T) {
	manager := NewAnalyticsManager()
	got, err := manager.CalculateROI(100, 125)
	if err != nil || got != 25 { t.Fatalf("CalculateROI(100,125) = %v, %v; want 25, nil", got, err) }
	if _, err := manager.CalculateROI(0, 1); err == nil { t.Fatal("expected zero initial amount to fail") }
	if _, err := manager.CalculateROI(-1, 1); err == nil { t.Fatal("expected negative initial amount to fail") }
	if _, err := manager.CalculateROI(math.NaN(), 1); err == nil { t.Fatal("expected NaN to fail") }
}

func TestAnalyticsValidatesInputs(t *testing.T) {
	manager := NewAnalyticsManager()
	if _, err := manager.CalculateTradeAnalytics(" "); err == nil { t.Fatal("expected blank user ID to fail") }
	if _, err := manager.GetPortfolioHistory("user-1", -1); err == nil { t.Fatal("expected negative limit to fail") }
	if _, err := manager.GetTradingHistory("user-1", time.Now(), time.Now().Add(-time.Hour)); err == nil { t.Fatal("expected reversed time range to fail") }
	if _, err := manager.GetLeaderboard(" ", 1); err == nil { t.Fatal("expected blank metric to fail") }
}
