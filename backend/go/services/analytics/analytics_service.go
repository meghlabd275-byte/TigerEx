// Package analytics exposes exchange analytics only when backed by authoritative data.
//
// This package intentionally does not synthesize trading, portfolio, or risk data.
// A durable implementation must be wired to the canonical trade ledger, wallet
// ledger, and market-data store before these methods can return results.
package analytics

import (
	"errors"
	"math"
	"strings"
	"time"
)

var ErrAnalyticsUnavailable = errors.New("analytics unavailable: authoritative data source is not configured")

type TradeAnalytics struct {
	TotalTrades   int     `json:"total_trades"`
	WinningTrades int     `json:"winning_trades"`
	LosingTrades  int     `json:"losing_trades"`
	WinRate       float64 `json:"win_rate"`
	TotalVolume   float64 `json:"total_volume"`
	TotalFees     float64 `json:"total_fees"`
	NetProfit     float64 `json:"net_profit"`
	AvgTradeSize  float64 `json:"avg_trade_size"`
	LargestWin    float64 `json:"largest_win"`
	LargestLoss   float64 `json:"largest_loss"`
}

type PortfolioSnapshot struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	TotalValue float64   `json:"total_value"`
	Assets     []Asset   `json:"assets"`
	Timestamp  time.Time `json:"timestamp"`
}

type Asset struct {
	Symbol   string  `json:"symbol"`
	Balance  float64 `json:"balance"`
	Value    float64 `json:"value"`
	PctAlloc float64 `json:"pct_alloc"`
}

type MarketStats struct {
	Symbol         string  `json:"symbol"`
	Volume24h      float64 `json:"volume_24h"`
	Trades24h      int     `json:"trades_24h"`
	High24h        float64 `json:"high_24h"`
	Low24h         float64 `json:"low_24h"`
	PriceChange24h float64 `json:"price_change_24h"`
	BuyVolume24h   float64 `json:"buy_volume_24h"`
	SellVolume24h  float64 `json:"sell_volume_24h"`
}

// AnalyticsManager does not keep authoritative balances or trades itself.
// Configure the exchange's durable analytics repository before serving results.
type AnalyticsManager struct{}

func NewAnalyticsManager() *AnalyticsManager { return &AnalyticsManager{} }

func (am *AnalyticsManager) CalculateTradeAnalytics(userID string) (TradeAnalytics, error) {
	if strings.TrimSpace(userID) == "" { return TradeAnalytics{}, errors.New("user ID is required") }
	return TradeAnalytics{}, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) SavePortfolioSnapshot(userID string, snapshot PortfolioSnapshot) error {
	if strings.TrimSpace(userID) == "" { return errors.New("user ID is required") }
	if snapshot.UserID != "" && snapshot.UserID != userID { return errors.New("snapshot user does not match requested user") }
	return ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetPortfolioHistory(userID string, limit int) ([]PortfolioSnapshot, error) {
	if strings.TrimSpace(userID) == "" { return nil, errors.New("user ID is required") }
	if limit < 0 { return nil, errors.New("limit cannot be negative") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetMarketStats(symbol string) (*MarketStats, error) {
	if strings.TrimSpace(symbol) == "" { return nil, errors.New("symbol is required") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) UpdateMarketStats(symbol string, stats MarketStats) error {
	if strings.TrimSpace(symbol) == "" || !strings.EqualFold(strings.TrimSpace(symbol), strings.TrimSpace(stats.Symbol)) {
		return errors.New("market stats symbol mismatch")
	}
	return ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetTopTraders(limit int) ([]map[string]interface{}, error) {
	if limit < 0 { return nil, errors.New("limit cannot be negative") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetTradingVolume(userID, period string) (float64, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(period) == "" { return 0, errors.New("user ID and period are required") }
	return 0, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetFeesPaid(userID, period string) (float64, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(period) == "" { return 0, errors.New("user ID and period are required") }
	return 0, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetProfitLoss(userID, period string) (float64, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(period) == "" { return 0, errors.New("user ID and period are required") }
	return 0, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetAssetAllocation(userID string) ([]Asset, error) {
	if strings.TrimSpace(userID) == "" { return nil, errors.New("user ID is required") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetTradingHistory(userID string, start, end time.Time) ([]map[string]interface{}, error) {
	if strings.TrimSpace(userID) == "" { return nil, errors.New("user ID is required") }
	if start.IsZero() || end.IsZero() || end.Before(start) { return nil, errors.New("valid start and end times are required") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetPerformanceMetrics(userID string) (map[string]interface{}, error) {
	if strings.TrimSpace(userID) == "" { return nil, errors.New("user ID is required") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GenerateReport(userID, reportType string) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(reportType) == "" { return "", errors.New("user ID and report type are required") }
	return "", ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) GetRiskMetrics(userID string) (map[string]interface{}, error) {
	if strings.TrimSpace(userID) == "" { return nil, errors.New("user ID is required") }
	return nil, ErrAnalyticsUnavailable
}

func (am *AnalyticsManager) CalculateROI(initialAmount, currentAmount float64) (float64, error) {
	if math.IsNaN(initialAmount) || math.IsInf(initialAmount, 0) || math.IsNaN(currentAmount) || math.IsInf(currentAmount, 0) {
		return 0, errors.New("ROI amounts must be finite numbers")
	}
	if initialAmount <= 0 { return 0, errors.New("initial amount must be greater than zero") }
	return ((currentAmount - initialAmount) / initialAmount) * 100, nil
}

func (am *AnalyticsManager) GetLeaderboard(metric string, limit int) ([]map[string]interface{}, error) {
	if strings.TrimSpace(metric) == "" { return nil, errors.New("leaderboard metric is required") }
	if limit < 0 { return nil, errors.New("limit cannot be negative") }
	return nil, ErrAnalyticsUnavailable
}
