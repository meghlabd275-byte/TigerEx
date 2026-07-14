// TigerEx Copy Trading Service
// Follow successful traders and copy their strategies

package copytrading

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	StatusActive   = "active"
	StatusPaused   = "paused"
	StatusClosed   = "closed"
	StatusPending  = "pending"

	CopierRole = "copier"
	TraderRole = "trader"

	OrderCopyModeFull  = "full"
	OrderCopyModeRatio = "ratio"
	OrderCopyModeFixed = "fixed"

	MaxCopiersPerTrader = 10000
)

type Trader struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	Username        string    `json:"username"`
	Avatar          string    `json:"avatar"`
	Bio             string    `json:"bio"`
	TotalProfit     float64   `json:"total_profit"`
	TotalTrades     int       `json:"total_trades"`
	WinRate         float64   `json:"win_rate"`
	AvgHoldingTime  float64   `json:"avg_holding_time"`
	MaxDrawdown     float64   `json:"max_drawdown"`
	RiskScore       int       `json:"risk_score"`
	Followers       int       `json:"followers"`
	AUM             float64   `json:"aum"`
	TotalCopiers    int       `json:"total_copiers"`
	IsVerified      bool      `json:"is_verified"`
	IsPro           bool      `json:"is_pro"`
	JoinDate        time.Time `json:"join_date"`
	Status          string    `json:"status"`
	CommissionRate  float64   `json:"commission_rate"`
}

type Copier struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	TraderID        string    `json:"trader_id"`
	CopyMode        string    `json:"copy_mode"`
	CopyRatio       float64   `json:"copy_ratio"`
	FixedAmount     float64   `json:"fixed_amount"`
	MaxCopyAmount   float64   `json:"max_copy_amount"`
	StopLossPercent float64   `json:"stop_loss_percent"`
	TotalInvested   float64   `json:"total_invested"`
	TotalProfit     float64   `json:"total_profit"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type CopierPosition struct {
	ID              string    `json:"id"`
	CopierID        string    `json:"copier_id"`
	TraderOrderID   string    `json:"trader_order_id"`
	Symbol          string    `json:"symbol"`
	Side            string    `json:"side"`
	Amount          float64   `json:"amount"`
	EntryPrice      float64   `json:"entry_price"`
	CurrentPrice    float64   `json:"current_price"`
	Profit          float64   `json:"profit"`
	ProfitPercent   float64   `json:"profit_percent"`
	Status          string    `json:"status"`
	CopiedAt        time.Time `json:"copied_at"`
	ClosedAt        time.Time `json:"closed_at"`
}

type TraderOrder struct {
	ID              string    `json:"id"`
	TraderID        string    `json:"trader_id"`
	Symbol          string    `json:"symbol"`
	Side            string    `json:"side"`
	Type            string    `json:"type"`
	Amount          float64   `json:"amount"`
	Price           float64   `json:"price"`
	Status          string    `json:"status"`
	OpenCopyCount   int       `json:"open_copy_count"`
	CreatedAt       time.Time `json:"created_at"`
}

type CopyTradingManager struct {
	mu              sync.RWMutex
	traders         map[string]*Trader
	copiers         map[string]*Copier
	traderOrders    map[string]*TraderOrder
	copierPositions map[string]*CopierPosition
	userCopiers     map[string][]string
	traderCopiers   map[string][]string
}

func NewCopyTradingManager() *CopyTradingManager {
	return &CopyTradingManager{
		traders:         make(map[string]*Trader),
		copiers:         make(map[string]*Copier),
		traderOrders:    make(map[string]*TraderOrder),
		copierPositions: make(map[string]*CopierPosition),
		userCopiers:     make(map[string][]string),
		traderCopiers:   make(map[string][]string),
	}
}

func (ctm *CopyTradingManager) RegisterTrader(userID, username, bio string, commissionRate float64) (*Trader, error) {
	ctm.mu.Lock()
	defer ctm.mu.Unlock()

	for _, trader := range ctm.traders {
		if trader.UserID == userID {
			return nil, errors.New("user is already registered as trader")
		}
	}

	now := time.Now()
	trader := &Trader{
		ID:             fmt.Sprintf("TRD%d%d", now.Unix(), now.Nanosecond()),
		UserID:         userID,
		Username:       username,
		Bio:            bio,
		TotalProfit:    0,
		TotalTrades:    0,
		WinRate:        0,
		RiskScore:      5,
		Followers:      0,
		AUM:            0,
		TotalCopiers:   0,
		IsVerified:     false,
		IsPro:          false,
		JoinDate:       now,
		Status:         StatusActive,
		CommissionRate: commissionRate,
	}

	ctm.traders[trader.ID] = trader
	return trader, nil
}

func (ctm *CopyTradingManager) GetTrader(traderID string) (*Trader, error) {
	ctm.mu.RLock()
	defer ctm.mu.RUnlock()

	trader, exists := ctm.traders[traderID]
	if !exists {
		return nil, errors.New("trader not found")
	}
	return trader, nil
}

func (ctm *CopyTradingManager) GetTopTraders(limit int) []*Trader {
	ctm.mu.RLock()
	defer ctm.mu.RUnlock()

	traders := make([]*Trader, 0)
	for _, trader := range ctm.traders {
		if trader.Status == StatusActive {
			traders = append(traders, trader)
		}
	}

	for i := 0; i < len(traders)-1; i++ {
		for j := 0; j < len(traders)-i-1; j++ {
			if traders[j].TotalProfit < traders[j+1].TotalProfit {
				traders[j], traders[j+1] = traders[j+1], traders[j]
			}
		}
	}

	if limit > 0 && len(traders) > limit {
		traders = traders[:limit]
	}

	return traders
}

func (ctm *CopyTradingManager) StartCopying(userID, traderID, copyMode string, copyRatio, fixedAmount, maxCopyAmount, stopLossPercent float64) (*Copier, error) {
	ctm.mu.Lock()
	defer ctm.mu.Unlock()

	trader, exists := ctm.traders[traderID]
	if !exists {
		return nil, errors.New("trader not found")
	}

	if trader.Status != StatusActive {
		return nil, errors.New("trader is not active")
	}

	if copyRatio < 0.1 || copyRatio > 10.0 {
		return nil, errors.New("copy ratio must be between 0.1 and 10.0")
	}

	now := time.Now()
	copier := &Copier{
		ID:              fmt.Sprintf("CPY%d%d", now.Unix(), now.Nanosecond()),
		UserID:          userID,
		TraderID:        traderID,
		CopyMode:        copyMode,
		CopyRatio:       copyRatio,
		FixedAmount:     fixedAmount,
		MaxCopyAmount:   maxCopyAmount,
		StopLossPercent: stopLossPercent,
		TotalInvested:   0,
		TotalProfit:     0,
		Status:          StatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	ctm.copiers[copier.ID] = copier
	ctm.userCopiers[userID] = append(ctm.userCopiers[userID], copier.ID)
	ctm.traderCopiers[traderID] = append(ctm.traderCopiers[traderID], copier.ID)

	trader.Followers++
	trader.TotalCopiers++

	return copier, nil
}

func (ctm *CopyTradingManager) StopCopying(userID, copierID string) error {
	ctm.mu.Lock()
	defer ctm.mu.Unlock()

	copier, exists := ctm.copiers[copierID]
	if !exists {
		return errors.New("copier not found")
	}

	if copier.UserID != userID {
		return errors.New("unauthorized")
	}

	for _, pos := range ctm.copierPositions {
		if pos.CopierID == copierID && pos.Status == StatusActive {
			pos.Status = StatusClosed
			pos.ClosedAt = time.Now()
		}
	}

	trader, exists := ctm.traders[copier.TraderID]
	if exists {
		trader.Followers--
		trader.TotalCopiers--
	}

	copier.Status = StatusClosed
	return nil
}

func (ctm *CopyTradingManager) GetCopierPositions(copierID string) []*CopierPosition {
	ctm.mu.RLock()
	defer ctm.mu.RUnlock()

	var positions []*CopierPosition
	for _, pos := range ctm.copierPositions {
		if pos.CopierID == copierID {
			positions = append(positions, pos)
		}
	}
	return positions
}

func (ctm *CopyTradingManager) GetUserCopiers(userID string) []*Copier {
	ctm.mu.RLock()
	defer ctm.mu.RUnlock()

	copierIDs := ctm.userCopiers[userID]
	copiers := make([]*Copier, 0)
	for _, id := range copierIDs {
		if copier, exists := ctm.copiers[id]; exists {
			copiers = append(copiers, copier)
		}
	}
	return copiers
}

func (ctm *CopyTradingManager) GetTraderCopiers(traderID string) []*Copier {
	ctm.mu.RLock()
	defer ctm.mu.RUnlock()

	copierIDs := ctm.traderCopiers[traderID]
	copiers := make([]*Copier, 0)
	for _, id := range copierIDs {
		if copier, exists := ctm.copiers[id]; exists {
			copiers = append(copiers, copier)
		}
	}
	return copiers
}

func (t *Trader) ToJSON() (string, error) {
	data, err := json.Marshal(t)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (c *Copier) ToJSON() (string, error) {
	data, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
