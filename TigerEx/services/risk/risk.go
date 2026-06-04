package risk

import (
    "errors"
    "sync"
    "time"
)

var (
    ErrPositionLimitExceeded  = errors.New("position limit exceeded")
    ErrWithdrawalLimitExceeded = errors.New("withdrawal limit exceeded")
    ErrMarginRatioBreached     = errors.New("margin ratio breached")
    ErrPriceManipulation       = errors.New("potential price manipulation detected")
    ErrInsufficientMargin      = errors.New("insufficient margin")
)

type RiskLevel string

const (
    RiskLow    RiskLevel = "low"
    RiskMedium RiskLevel = "medium"
    RiskHigh   RiskLevel = "high"
    RiskCritical RiskLevel = "critical"
)

type Position struct {
    ID              string  `json:"id"`
    UserID          string  `json:"user_id"`
    Symbol          string  `json:"symbol"`
    Side            string  `json:"side"`
    Quantity        float64 `json:"quantity"`
    EntryPrice      float64 `json:"entry_price"`
    MarkPrice       float64 `json:"mark_price"`
    LiquidationPrice float64 `json:"liquidation_price"`
    Leverage        int     `json:"leverage"`
    UnrealizedPnL   float64 `json:"unrealized_pnl"`
    IsolatedMargin  float64 `json:"isolated_margin"`
}

type RiskAccount struct {
    UserID           string    `json:"user_id"`
    TotalEquity      float64   `json:"total_equity"`
    TotalPnL         float64   `json:"total_pnl"`
    MarginBalance    float64   `json:"margin_balance"`
    AvailableMargin  float64   `json:"available_margin"`
    TotalPosition    int       `json:"total_position"`
    RiskLevel        RiskLevel `json:"risk_level"`
    WithdrawalLimit  float64   `json:"withdrawal_limit"`
    DailyWithdrawn   float64   `json:"daily_withdrawn"`
    LastResetAt      time.Time `json:"last_reset_at"`
}

type CircuitBreaker struct {
    Symbol       string    `json:"symbol"`
    TriggerPrice float64   `json:"trigger_price"`
    TriggeredAt  time.Time `json:"triggered_at"`
    Status       string    `json:"status"`
}

type RiskService struct {
    mu        sync.RWMutex
    accounts  map[string]*RiskAccount
    positions map[string]*Position
    breakers  map[string]*CircuitBreaker
    limits    *RiskLimits
}

type RiskLimits struct {
    MaxPositionSize    float64
    MaxLeverage        int
    MinMarginRatio     float64
    LiquidationBuffer  float64
    DailyWithdrawalLimit float64
    MaxOrdersPerMin    int
}

func NewRiskService() *RiskService {
    return &RiskService{
        accounts:  make(map[string]*RiskAccount),
        positions: make(map[string]*Position),
        breakers:  make(map[string]*CircuitBreaker),
        limits: &RiskLimits{
            MaxPositionSize:     1000000,
            MaxLeverage:         125,
            MinMarginRatio:      1.1,
            LiquidationBuffer:   0.05,
            DailyWithdrawalLimit: 100000,
            MaxOrdersPerMin:     600,
        },
    }
}

func (rs *RiskService) GetOrCreateAccount(userID string) *RiskAccount {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    if rs.accounts[userID] == nil {
        rs.accounts[userID] = &RiskAccount{
            UserID:          userID,
            TotalEquity:     0,
            MarginBalance:   0,
            AvailableMargin: 0,
            RiskLevel:       RiskLow,
            WithdrawalLimit: rs.limits.DailyWithdrawalLimit,
            DailyWithdrawn:  0,
            LastResetAt:     time.Now(),
        }
    }
    return rs.accounts[userID]
}

func (rs *RiskService) CheckWithdrawalLimit(userID string, amount float64) error {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    account := rs.GetOrCreateAccount(userID)
    
    if time.Since(account.LastResetAt) > 24*time.Hour {
        account.DailyWithdrawn = 0
        account.LastResetAt = time.Now()
    }
    
    totalDaily := account.DailyWithdrawn + amount
    if totalDaily > account.WithdrawalLimit {
        return ErrWithdrawalLimitExceeded
    }
    
    return nil
}

func (rs *RiskService) CheckMargin(position *Position) error {
    marginRatio := (position.MarkPrice * position.Quantity) / position.IsolatedMargin
    
    if marginRatio < rs.limits.MinMarginRatio {
        return ErrMarginRatioBreached
    }
    
    return nil
}

func (rs *RiskService) CalculateLiquidationPrice(position *Position) float64 {
    if position.Side == "long" {
        return position.EntryPrice * (1 - (1.0/float64(position.Leverage)))
    }
    return position.EntryPrice * (1 + (1.0/float64(position.Leverage)))
}

func (rs *RiskService) CheckLeverage(userID string, leverage int) error {
    if leverage > rs.limits.MaxLeverage {
        return errors.New("leverage exceeds maximum allowed")
    }
    return nil
}

func (rs *RiskService) UpdatePositionMargin(userID, symbol string, addedMargin float64) error {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    key := userID + symbol
    position, exists := rs.positions[key]
    if !exists {
        return errors.New("position not found")
    }
    
    position.IsolatedMargin += addedMargin
    
    if err := rs.CheckMargin(position); err != nil {
        return err
    }
    
    return nil
}

func (rs *RiskService) CalculateUnrealizedPnL(position *Position) float64 {
    if position.Side == "long" {
        return (position.MarkPrice - position.EntryPrice) * position.Quantity
    }
    return (position.EntryPrice - position.MarkPrice) * position.Quantity
}

func (rs *RiskService) AssessAccountRisk(userID string) RiskLevel {
    rs.mu.RLock()
    defer rs.mu.RUnlock()
    
    account := rs.accounts[userID]
    if account == nil {
        return RiskLow
    }
    
    var totalExposure float64
    for _, pos := range rs.positions {
        if pos.UserID == userID {
            totalExposure += pos.Quantity * pos.MarkPrice
        }
    }
    
    if account.TotalEquity > 0 {
        leverage := totalExposure / account.TotalEquity
        
        switch {
        case leverage > 10:
            return RiskCritical
        case leverage > 5:
            return RiskHigh
        case leverage > 2:
            return RiskMedium
        }
    }
    
    return RiskLow
}

func (rs *RiskService) TriggerCircuitBreaker(symbol string, price float64) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    rs.breakers[symbol] = &CircuitBreaker{
        Symbol:       symbol,
        TriggerPrice: price,
        TriggeredAt:  time.Now(),
        Status:       "active",
    }
}

func (rs *RiskService) GetCircuitBreaker(symbol string) *CircuitBreaker {
    rs.mu.RLock()
    defer rs.mu.RUnlock()
    
    return rs.breakers[symbol]
}

func (rs *RiskService) ClearCircuitBreaker(symbol string) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    if breaker, exists := rs.breakers[symbol]; exists {
        breaker.Status = "cleared"
    }
}

func (rs *RiskService) CheckOrderRateLimit(userID string) (bool, int) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    return true, rs.limits.MaxOrdersPerMin
}

func (rs *RiskService) DetectPriceManipulation(symbol string, trades []Trade) (bool, string) {
    if len(trades) < 10 {
        return false, ""
    }
    
    var prices []float64
    for _, t := range trades {
        prices = append(prices, t.Price)
    }
    
    avgPrice := calculateAverage(prices)
    priceVariance := calculateVariance(prices, avgPrice)
    
    if priceVariance > 0.05 {
        return true, "High price variance detected"
    }
    
    return false, ""
}

func (rs *RiskService) LiquidatePosition(userID, symbol string) error {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    
    key := userID + symbol
    position, exists := rs.positions[key]
    if !exists {
        return errors.New("position not found")
    }
    
    position.Quantity = 0
    
    return nil
}

type Trade struct {
    Price float64
    Time  time.Time
}

func calculateAverage(prices []float64) float64 {
    var sum float64
    for _, p := range prices {
        sum += p
    }
    return sum / float64(len(prices))
}

func calculateVariance(prices []float64, mean float64) float64 {
    var sum float64
    for _, p := range prices {
        diff := p - mean
        sum += diff * diff
    }
    return sum / float64(len(prices))
}

func (a *RiskAccount) UpdateEquity(balance, unrealizedPnL float64) {
    a.TotalEquity = balance + unrealizedPnL
    a.TotalPnL = unrealizedPnL
    a.MarginBalance = balance
    a.AvailableMargin = balance - unrealizedPnL
}