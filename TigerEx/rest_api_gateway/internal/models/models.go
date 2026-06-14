package models

import (
	"encoding/json"
	"time"
)

// ============================================================================
// USER & ACCOUNT MODELS
// ============================================================================

// User represents a user account in the system
type User struct {
	ID                string          `json:"id" db:"id"`
	Email            string          `json:"email" db:"email"`
	Username         string          `json:"username" db:"username"`
	PasswordHash     string          `json:"-" db:"password_hash"`
	FirstName        string          `json:"firstName" db:"first_name"`
	LastName         string          `json:"lastName" db:"last_name"`
	Phone           string          `json:"phone" db:"phone"`
	Country         string          `json:"country" db:"country"`
	KYCStatus        KYCStatus       `json:"kycStatus" db:"kyc_status"`
	AccountStatus    AccountStatus   `json:"accountStatus" db:"account_status"`
	TwoFactorEnabled bool           `json:"twoFactorEnabled" db:"two_factor_enabled"`
	AntiPhishingCode string         `json:"antiPhishingCode" db:"anti_phishing_code"`
	CreatedAt       time.Time      `json:"createdAt" db:"created_at"`
	UpdatedAt       time.Time      `json:"updatedAt" db:"updated_at"`
	LastLoginAt     time.Time      `json:"lastLoginAt" db:"last_login_at"`
}

// KYCStatus represents the KYC verification status
type KYCStatus string

const (
	KYCStatusNone       KYCStatus = "NONE"
	KYCStatusPending  KYCStatus = "PENDING"
	KYCStatusVerified KYCStatus = "VERIFIED"
	KYCStatusRejected KYCStatus = "REJECTED"
	KYCStatusExpired KYCStatus = "EXPIRED"
)

// AccountStatus represents the account status
type AccountStatus string

const (
	AccountStatusActive   AccountStatus = "ACTIVE"
	AccountStatusLocked AccountStatus = "LOCKED"
	AccountStatusClosed AccountStatus = "CLOSED"
	AccountStatusSuspended AccountStatus = "SUSPENDED"
)

// ============================================================================
// ORDER MODELS
// ============================================================================

// Order represents a trading order
type Order struct {
	ID             string     `json:"id" db:"id"`
	UserID        string    `json:"userId" db:"user_id"`
	OrderUUID    string    `json:"orderUuid" db:"order_uuid"`
	Symbol       string    `json:"symbol" db:"symbol"`
	Side         OrderSide `json:"side" db:"side"`
	Type         OrderType `json:"type" db:"type"`
	Price        float64   `json:"price" db:"price"`
	StopPrice    float64   `json:"stopPrice" db:"stop_price"`
	Quantity    float64   `json:"quantity" db:"quantity"`
	QuoteQuantity float64 `json:"quoteQuantity" db:"quote_quantity"`
	Amount      float64   `json:"amount" db:"amount"`
	Status      OrderStatus `json:"status" db:"status"`
	FilledQty   float64   `json:"filledQty" db:"filled_qty"`
	AvgPrice   float64   `json:"avgPrice" db:"avg_price"`
	Commission float64   `json:"commission" db:"commission"`
	CreatedAt   time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time `json:"updatedAt" db:"updated_at"`
	TimeInForce TimeInForce `json:"timeInForce" db:"time_in_force"`
	IcebergQty  float64  `json:"icebergQty" db:"iceberg_qty"`
}

// OrderSide represents the side of an order
type OrderSide string

const (
	OrderSideBuy  OrderSide = "BUY"
	OrderSideSell OrderSide = "SELL"
)

// OrderType represents the type of an order
type OrderType string

const (
	OrderTypeLimit      OrderType = "LIMIT"
	OrderTypeMarket   OrderType = "MARKET"
	OrderTypeStopLoss  OrderType = "STOP_LOSS"
	OrderTypeStopLimit OrderType = "STOP_LIMIT"
	OrderTypeIceberg   OrderType = "ICEBERG"
	OrderTypeOCO      OrderType = "OCO"
	OrderTypeTrailing OrderType = "TRAILING_STOP"
)

// OrderStatus represents the status of an order
type OrderStatus string

const (
	OrderStatusPending     OrderStatus = "PENDING"
	OrderStatusNew       OrderStatus = "NEW"
	OrderStatusPartial  OrderStatus = "PARTIALLY_FILLED"
	OrderStatusFilled  OrderStatus = "FILLED"
	OrderStatusCanceled OrderStatus = "CANCELLED"
	OrderStatusRejected OrderStatus = "REJECTED"
	OrderStatusExpired  OrderStatus = "EXPIRED"
)

// TimeInForce represents the time in force for an order
type TimeInForce string

const (
	TimeInForceGTC TimeInForce = "GTC" // Good Till Cancel
	TimeInForceIOC TimeInForce = "IOC" // Immediate or Cancel
	TimeInForceFOK TimeInForce = "FOK" // Fill or Kill
)

// ============================================================================
// TRADE MODELS
// ============================================================================

// Trade represents a trade execution
type Trade struct {
	ID            string    `json:"id" db:"id"`
	OrderID       string    `json:"orderId" db:"order_id"`
	UserID        string    `json:"userId" db:"user_id"`
	Symbol        string    `json:"symbol" db:"symbol"`
	Side          OrderSide `json:"side" db:"side"`
	Price        float64   `json:"price" db:"price"`
	Quantity     float64   `json:"quantity" db:"quantity"`
	QuoteQuantity float64  `json:"quoteQuantity" db:"quote_quantity"`
	Commission   float64   `json:"commission" db:"commission"`
	CommissionAsset string `json:"commissionAsset" db:"commission_asset"`
	Maker        bool      `json:"maker" db:"maker"`
	TradeTime    time.Time `json:"tradeTime" db:"trade_time"`
}

// ============================================================================
// MARKET MODELS
// ============================================================================

// Symbol represents a trading symbol/pair
type Symbol struct {
	Symbol           string    `json:"symbol" db:"symbol"`
	BaseAsset        string    `json:"baseAsset" db:"base_asset"`
	QuoteAsset       string    `json:"quoteAsset" db:"quote_asset"`
	Status          string    `json:"status" db:"status"`
	BasePrecision   int       `json:"basePrecision" db:"base_precision"`
	QuotePrecision int       `json:"quotePrecision" db:"quote_precision"`
	MinQuantity    float64   `json:"minQuantity" db:"min_quantity"`
	MaxQuantity    float64   `json:"maxQuantity" db:"max_quantity"`
	MinPrice       float64   `json:"minPrice" db:"min_price"`
	MaxPrice       float64   `json:"maxPrice" db:"max_price"`
	MinNotional    float64   `json:"minNotional" db:"min_notional"`
	MaxNotional   float64   `json:"maxNotional" db:"max_notional"`
	MakerFee      float64   `json:"makerFee" db:"maker_fee"`
	TakerFee      float64   `json:"takerFee" db:"taker_fee"`
	IsMargin      bool      `json:"isMargin" db:"is_margin"`
	AllowSpot    bool      `json:"allowSpot" db:"allow_spot"`
	AllowMargin  bool      `json:"allowMargin" db:"allow_margin"`
	AllowFutures bool      `json:"allowFutures" db:"allow_futures"`
}

// Ticker24h represents 24h ticker data
type Ticker24h struct {
	Symbol             string  `json:"symbol"`
	PriceChange        float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	LastPrice        float64 `json:"lastPrice"`
	HighPrice        float64 `json:"highPrice"`
	LowPrice         float64 `json:"lowPrice"`
	Volume           float64 `json:"volume"`
	QuoteVolume      float64 `json:"quoteVolume"`
	OpenPrice        float64 `json:"openPrice"`
	OpenTime         int64   `json:"openTime"`
	CloseTime        int64   `json:"closeTime"`
	FirstID          int64   `json:"firstId"`
	LastID          int64   `json:"lastId"`
	Count           int64   `json:"count"`
}

// BookTicker represents best bid/ask prices
type BookTicker struct {
	Symbol     string  `json:"symbol"`
	BidPrice   float64 `json:"bidPrice"`
	BidQty    float64 `json:"bidQty"`
	AskPrice  float64 `json:"askPrice"`
	AskQty    float64 `json:"askQty"`
}

// PriceChange represents price change info
type PriceChange struct {
	Symbol          string  `json:"symbol"`
	PriceChange     float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	WeightedAvgPrice float64 `json:"weightedAvgPrice"`
	PrevClosePrice float64 `json:"prevClosePrice"`
	LastPrice      float64 `json:"lastPrice"`
	LastQty       float64 `json:"lastQty"`
	OpenPrice     float64 `json:"openPrice"`
	HighPrice    float64 `json:"highPrice"`
	LowPrice     float64 `json:"lowPrice"`
	Volume       float64 `json:"volume"`
	QuoteVolume  float64 `json:"quoteVolume"`
	OpenTime    int64   `json:"openTime"`
	CloseTime   int64   `json:"closeTime"`
	FirstID    int64   `json:"firstId"`
	LastID     int64   `json:"lastId"`
	Count      int64   `json:"count"`
}

// ============================================================================
// DEPTH/ORDER BOOK MODELS
// ============================================================================

// Depth represents order book depth
type Depth struct {
	LastUpdateID int64     `json:"lastUpdateId"`
	Bids       [][]string `json:"bids"`
	Asks       [][]string `json:"asks"`
}

// DepthStream represents depth update stream
type DepthStream struct {
	Event       string   `json:"e"`
	EventTime  int64    `json:"E"`
	Symbol     string   `json:"s"`
	FirstUpdateID int64 `json:"lastUpdateId"`
	Bids       [][]string `json:"bids"`
	Asks       [][]string `json:"asks"`
}

// ============================================================================
// KLINE/CANDLESTICK MODELS
// ============================================================================

// Kline represents candlestick data
type Kline struct {
	OpenTime     int64    `json:"openTime"`
	Open         float64  `json:"open"`
	High         float64  `json:"high"`
	Low          float64  `json:"low"`
	Close        float64  `json:"close"`
	Volume       float64  `json:"volume"`
	CloseTime    int64    `json:"closeTime"`
	QuoteVolume  float64  `json:"quoteVolume"`
	NumTrades    int64    `json:"numTrades"`
	TakerBaseVol float64  `json:"takerBuyBaseVolume"`
	TakerQuoteVol float64 `json:"takerBuyQuoteVolume"`
}

// ============================================================================
// WALLET & BALANCE MODELS
// ============================================================================

// Balance represents a wallet balance
type Balance struct {
	Asset         string  `json:"asset"`
	Free          float64 `json:"free"`
	Locked        float64 `json:"locked"`
	Freeze       float64 `json:"freeze"`
	Withdrawing  float64 `json:"withdrawing"`
	WithdrawalInhibited bool `json:"withdrawalInhibited"`
}

// Account represents user account with balances
type Account struct {
	MakerCommission    float64   `json:"makerCommission"`
	TakerCommission    float64   `json:"takerCommission"`
	BuyerCommission    float64   `json:"buyerCommission"`
	SellerCommission   float64   `json:"sellerCommission"`
	CanTrade           bool      `json:"canTrade"`
	CanWithdraw       bool      `json:"canWithdraw"`
	CanDeposit        bool      `json:"canDeposit"`
	Balances          []Balance `json:"balances"`
	AccountType       string    `json:"accountType"`
}

// ============================================================================
// MARGIN MODELS
// ============================================================================

// MarginAccount represents margin account info
type MarginAccount struct {
	TotalMargin     float64    `json:"totalMargin"`
	TotalLiability float64    `json:"totalLiability"`
	NetAsset       float64    `json:"netAsset"`
	BorrowLimit    float64    `json:"borrowLimit"`
	MarginRatio    float64    `json:"marginRatio"`
	LiabilityRatio float64    `json:"liabilityRatio"`
	Balances       []Balance  `json:"balances"`
}

// MarginOrder represents a margin order
type MarginOrder struct {
	Order
	IsolateMargin bool    `json:"isolatedMargin"`
	Margin        float64 `json:"margin"`
}

// ============================================================================
// FUTURES MODELS
// ============================================================================

// FuturesAccount represents futures account info
type FuturesAccount struct {
	TotalMarginBalance     float64 `json:"totalMarginBalance"`
	TotalWalletBalance   float64 `json:"totalWalletBalance"`
	TotalUnrealizedProfit float64 `json:"totalUnrealizedProfit"`
	TotalAvailableBalance float64 `json:"totalAvailableBalance"`
	TotalPositionMargin   float64 `json:"totalPositionMargin"`
	TotalOpenOrderMargin  float64 `json:"totalOpenOrderMargin"`
}

// FuturesPosition represents a futures position
type FuturesPosition struct {
	Symbol           string  `json:"symbol"`
	PositionAmt      float64 `json:"positionAmt"`
	EntryPrice      float64 `json:"entryPrice"`
	MarkPrice       float64 `json:"markPrice"`
	LiqPrice        float64 `json:"liquidationPrice"`
	MarginRatio     float64 `json:"marginRatio"`
	Margin          float64 `json:"margin"`
	UnrealizedPnL   float64 `json:"unrealizedPnL"`
	Isolated        bool    `json:"isolated"`
	IsolationLevel   string  `json:"isolationLevel"`
	Leverage        int     `json:"leverage"`
	PositionSide   string  `json:"positionSide"`
}

// ============================================================================
// WITHDRAWAL/DEPOSIT MODELS
// ============================================================================

// Deposit represents a deposit
type Deposit struct {
	ID          string    `json:"id"`
	UserID     string    `json:"userId"`
	Asset      string    `json:"asset"`
	Amount     float64   `json:"amount"`
	Address    string    `json:"address"`
	TxHash     string    `json:"txHash"`
	Status     string    `json:"status"`
	Confirmations int    `json:"confirmations"`
	InsertTime time.Time `json:"insertTime"`
	UpdateTime time.Time `json:"updateTime"`
}

// Withdrawal represents a withdrawal
type Withdrawal struct {
	ID        string    `json:"id"`
	UserID   string    `json:"userId"`
	Asset    string    `json:"asset"`
	Amount   float64   `json:"amount"`
	Address string    `json:"address"`
	TxHash   string    `json:"txHash"`
	Status  string    `json:"status"`
	Fee      float64  `json:"fee"`
	InsertTime time.Time `json:"insertTime"`
	UpdateTime time.Time `json:"updateTime"`
}

// ============================================================================
// API RESPONSE MODELS
// ============================================================================

// APIResponse represents a standard API response
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

// APIError represents an API error
type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ============================================================================
// WEBSOCKET MODELS
// ============================================================================

// WSMessage represents a WebSocket message
type WSMessage struct {
	Event       string          `json:"e,omitempty"`
	EventTime  int64           `json:"E,omitempty"`
	Symbol    string          `json:"s,omitempty"`
	TradeID   int64           `json:"t,omitempty"`
	Price     float64         `json:"p,omitempty"`
	Quantity  float64         `json:"q,omitempty"`
	BuyerOrderID int64        `json:"b,omitempty"`
	SellerOrderID int64       `json:"a,omitempty"`
	TradeTime int64          `json:"T,omitempty"`
	IsMaker   bool           `json:"m,omitempty"`
	IsBestMatch bool         `json:"M,omitempty"`
}

// WSAggTrade represents aggregated trade stream
type WSAggTrade struct {
	Event        string `json:"e"`
	EventTime    int64  `json:"E"`
	Symbol      string `json:"s"`
	TradeID     int64  `json:"t"`
	Price       float64 `json:"p"`
	Quantity    float64 `json:"q"`
	BuyerOrderID int64 `json:"b"`
	SellerOrderID int64 `json:"a"`
	TradeTime   int64  `json:"T"`
	IsMaker    bool   `json:"m"`
	IsBestMatch bool  `json:"M"`
}

// WSTrade represents individual trade stream
type WSTrade struct {
	Event        string `json:"e"`
	EventTime    int64  `json:"E"`
	Symbol      string `json:"s"`
	TradeID     int64  `json:"t"`
	Price       float64 `json:"p"`
	Quantity    float64 `json:"q"`
	BuyerOrderID int64 `json:"b"`
	SellerOrderID int64 `json:"a"`
	TradeTime   int64  `json:"T"`
	IsMaker    bool   `json:"m"`
	IsBestMatch bool  `json:"M"`
}

// WSTicker represents ticker stream
type WSTicker struct {
	Event                string `json:"e"`
	EventTime           int64  `json:"E"`
	Symbol              string `json:"s"`
	PriceChange         float64 `json:"p"`
	PriceChangePercent float64 `json:"P"`
	WeightedAvgPrice   float64 `json:"w"`
	PrevClosePrice     float64 `json:"c"`
	LastPrice          float64 `json:"c"`
	LastQty            float64 `json:"c"`
	OpenPrice          float64 `json:"o"`
	HighPrice          float64 `json:"h"`
	LowPrice           float64 `json:"l"`
	TotalTradedBaseVolume float64 `json:"v"`
	TotalTradedQuoteVolume float64 `json:"q"`
	StatOpenTime       int64  `json:"O"`
	StatCloseTime     int64  `json:"C"`
	FirstTradeID      int64  `json:"F"`
	LastTradeID       int64  `json:"L"`
	NumTrades        int64  `json:"n"`
}

// WSKline represents kline stream
type WSKline struct {
	Event       string `json:"e"`
	EventTime  int64  `json:"E"`
	Symbol    string `json:"s"`
	Kline      Kline  `json:"k"`
}

// ============================================================================
// MARSHAL HELPERS
// ============================================================================

// ToJSON converts the struct to JSON string
func (r *APIResponse) ToJSON() (string, error) {
	data, err := json.Marshal(r)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// NewSuccessResponse creates a success response
func NewSuccessResponse(data interface{}) *APIResponse {
	return &APIResponse{
		Success: true,
		Data:   data,
	}
}

// NewErrorResponse creates an error response
func NewErrorResponse(code int, message string) *APIResponse {
	return &APIResponse{
		Success: false,
		Error:  &APIError{Code: code, Message: message},
	}
}