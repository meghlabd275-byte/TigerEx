package main

import (
	"fmt"
	"time"
)

// Event type
type EventType string

const (
	EventTrade EventType = "trade"
	EventOrderPlaced EventType = "order_placed"
	EventOrderCancelled EventType = "order_cancelled"
	EventDeposit EventType = "deposit"
	EventWithdrawal EventType = "withdrawal"
	EventTransfer EventType = "transfer"
	EventLogin EventType = "login"
	EventLogout EventType = "logout"
)

// Analytics event
type AnalyticsEvent struct {
	ID        string
	Type     EventType
	UserID   string
	SessionID string
	Metadata map[string]interface{}
	Timestamp int64
}

// User metrics
type UserMetrics struct {
	UserID          string
	TotalTrades     int64
	TotalVolume    float64
	TotalFees     float64
	LastActive    int64
	DepositCount  int64
	WithdrawalCount int64
}

// Trading metrics
type TradingMetrics struct {
	Period            string
	TotalVolume     float64
	TotalFees      float64
	TradeCount     int64
	ActiveUsers   int64
	NewUsers     int64
	AvgTradeSize float64
}

// Analytics platform
type AnalyticsPlatform struct {
	Events    map[string]*AnalyticsEvent
	UserMetrics map[string]*UserMetrics
}

// New creates platform
func NewAnalyticsPlatform() *AnalyticsPlatform {
	return &AnalyticsPlatform{
		Events: make(map[string]*AnalyticsEvent),
		UserMetrics: make(map[string]*UserMetrics),
	}
}

// Track event
func (p *AnalyticsPlatform) Track(eventType EventType, userID, sessionID string, metadata map[string]interface{}) *AnalyticsEvent {
	id := fmt.Sprintf("evt_%d", time.Now().UnixNano())
	
	event := &AnalyticsEvent{
		ID: id,
		Type: eventType,
		UserID: userID,
		SessionID: sessionID,
		Metadata: metadata,
		Timestamp: time.Now().UnixMilli(),
	}
	
	p.Events[id] = event
	
	// Update user metrics
	if userID != "" {
		p.updateUserMetrics(userID, eventType)
	}
	
	return event
}

// Update user metrics
func (p *AnalyticsPlatform) updateUserMetrics(userID string, eventType EventType) {
	metrics, exists := p.UserMetrics[userID]
	if !exists {
		metrics = &UserMetrics{UserID: userID}
		p.UserMetrics[userID] = metrics
	}
	
	metrics.LastActive = time.Now().UnixMilli()
	
	switch eventType {
	case EventTrade:
		metrics.TotalTrades++
	case EventDeposit:
		metrics.DepositCount++
	case EventWithdrawal:
		metrics.WithdrawalCount++
	}
}

// Get user metrics
func (p *AnalyticsPlatform) GetUserMetrics(userID string) *UserMetrics {
	return p.UserMetrics[userID]
}

// Get trading metrics
func (p *AnalyticsPlatform) GetTradingMetrics(period string) *TradingMetrics {
	var totalVolume float64
	var totalFees float64
	var tradeCount int64
	var activeUsers int64
	
	for _, event := range p.Events {
		if event.Timestamp > time.Now().Add(-24 * time.Hour).UnixMilli() {
			switch event.Type {
			case EventTrade:
				totalVolume += 50000 // Simplified
				totalFees += 50
				tradeCount++
			case EventLogin, EventOrderPlaced:
				activeUsers++
			}
		}
	}
	
	return &TradingMetrics{
		Period: period,
		TotalVolume: totalVolume,
		TotalFees: totalFees,
		TradeCount: tradeCount,
		ActiveUsers: activeUsers,
		NewUsers: 100,
		AvgTradeSize: totalVolume / float64(tradeCount+1),
	}
}

func main() {
	platform := NewAnalyticsPlatform()
	
	// Track events
	platform.Track(EventTrade, "user1", "session1", nil)
	platform.Track(EventDeposit, "user1", "session1", nil)
	platform.Track(EventLogin, "user2", "session2", nil)
	
	// Get user metrics
	metrics := platform.GetUserMetrics("user1")
	fmt.Printf("User1 trades: %d\n", metrics.TotalTrades)
	
	// Get trading metrics
	tm := platform.GetTradingMetrics("24h")
	fmt.Printf("Volume: %.2f, Fees: %.2f\n", tm.TotalVolume, tm.TotalFees)
}