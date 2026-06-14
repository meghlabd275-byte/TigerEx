package models

import (
	"encoding/json"
	"time"
)

// ============================================================================
// WEBSOCKET MESSAGE MODELS
// ============================================================================

// WSMessage represents a WebSocket message
type WSMessage struct {
	Event       string          `json:"e,omitempty"`
	EventTime  int64           `json:"E,omitempty"`
	Symbol    string          `json:"s,omitempty"`
	Type      string          `json:"type"`
	ID        int64           `json:"id,omitempty"`
	Result    interface{}     `json:"result,omitempty"`
	Error    *WSError       `json:"error,omitempty"`
}

// WSError represents a WebSocket error
type WSError struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
}

// ============================================================================
// STREAM MESSAGES
// ============================================================================

// WSAggTrade represents aggregated trade
type WSAggTrade struct {
	Event        string `json:"e"`
	EventTime   int64  `json:"E"`
	Symbol      string `json:"s"`
	TradeID    int64  `json:"t"`
	Price      float64 `json:"p"`
	Quantity   float64 `json:"q"`
	BuyerOrderID int64 `json:"b"`
	SellerOrderID int64 `json:"a"`
	TradeTime  int64  `json:"T"`
	IsMaker   bool   `json:"m"`
	IsBestMatch bool  `json:"M"`
}

// WSTrade represents individual trade
type WSTrade struct {
	Event        string `json:"e"`
	EventTime   int64  `json:"E"`
	Symbol     string `json:"s"`
	TradeID    int64  `json:"t"`
	Price      float64 `json:"p"`
	Quantity  float64 `json:"q"`
	BuyerOrderID int64 `json:"b"`
	SellerOrderID int64 `json:"a"`
	TradeTime  int64  `json:"T"`
	IsMaker   bool   `json:"m"`
	IsBestMatch bool  `json:"M"`
}

// WSKline represents kline/candlestick
type WSKline struct {
	Event      string `json:"e"`
	EventTime int64  `json:"E"`
	Symbol   string `json:"s"`
	Kline    *Kline `json:"k"`
}

// Kline represents kline data
type Kline struct {
	OpenTime     int64   `json:"t"`
	Open        float64 `json:"o"`
	High        float64 `json:"h"`
	Low         float64 `json:"l"`
	Close       float64 `json:"c"`
	Volume      float64 `json:"v"`
	CloseTime   int64   `json:"T"`
	QuoteVolume float64 `json:"q"`
	NumTrades   int64   `json:"n"`
	TakerBaseVol float64 `json:"x"`
}

// WSTicker represents 24h ticker
type WSTicker struct {
	Event               string `json:"e"`
	EventTime          int64  `json:"E"`
	Symbol            string `json:"s"`
	PriceChange       float64 `json:"p"`
	PriceChangePercent float64 `json:"P"`
	WeightedAvgPrice  float64 `json:"w"`
	PrevClosePrice    float64 `json:"c"`
	LastPrice        float64 `json:"c"`
	LastQty          float64 `json:"c"`
	OpenPrice        float64 `json:"o"`
	HighPrice       float64 `json:"h"`
	LowPrice        float64 `json:"l"`
	TotalTradedBaseVolume float64 `json:"v"`
	TotalTradedQuoteVolume float64 `json:"q"`
	StatOpenTime    int64  `json:"O"`
	StatCloseTime  int64  `json:"C"`
	FirstTradeID  int64  `json:"F"`
	LastTradeID   int64  `json:"L"`
	NumTrades   int64  `json:"n"`
}

// WSDepth represents depth update
type WSDepth struct {
	Event        string   `json:"e"`
	EventTime  int64    `json:"E"`
	Symbol    string   `json:"s"`
	FirstUpdateID int64 `json:"lastUpdateId"`
	Bids       [][]string `json:"bids"`
	Asks       [][]string `json:"asks"`
}

// WSDepthLevel represents depth level
type WSDepthLevel struct {
	Price  float64 `json:"price"`
	Quantity float64 `json:"quantity"`
}

// ============================================================================
// USER STREAM MESSAGES
// ============================================================================

// WSAccountUpdate represents account update
type WSAccountUpdate struct {
	Event        string     `json:"e"`
	EventTime   int64      `json:"E"`
	Asset     string     `json:"a"`
	Delta     float64   `json:"d"`
	Lock      float64   `json:"L"`
	Account  int64      `json:"ac"`
	EventCode int64     `json:"eid"`
}

// WSOrderUpdate represents order update
type WSOrderUpdate struct {
	Event          string  `json:"e"`
	EventTime     int64  `json:"E"`
	Symbol       string  `json:"s"`
	ClientOrderID string `json:"c"`
	Side         string  `json:"S"`
	Type         string  `json:"o"`
	Price        float64 `json:"p"`
	Quantity     float64 `json:"q"`
	Status      string  `json:"X"`
	OrderID     int64   `json:"i"`
	TradeTime   int64   `json:"T"`
	Maker       bool    `json:"m"`
	Commission float64 `json:"m"`
}

// WSTradeV5 represents user trade
type WSTradeV5 struct {
	Event        string `json:"e"`
	EventTime   int64  `json:"E"`
	Symbol     string `json:"s"`
	TradeID    int64  `json:"t"`
	OrderID    int64  `json:"o"`
	Side      string `json:"S"`
	Price     float64 `json:"p"`
	Quantity  float64 `json:"q"`
	Commission float64 `json:"commission"`
	Asset      string `json:"commissionAsset"`
	TradeTime  int64  `json:"T"`
	IsMaker   bool   `json:"m"`
}

// ============================================================================
// SUBSCRIPTION
// ============================================================================


// WSSubscribeRequest represents subscribe request
type WSSubscribeRequest struct {
	Method string   `json:"method"`
	Params []string `json:"params"`
	ID    int64    `json:"id"`
}

// WSUnsubscribeRequest represents unsubscribe request
type WSUnsubscribeRequest struct {
	Method string   `json:"method"`
	Params []string `json:"params"`
	ID    int64    `json:"id"`
}

// WSSubscribeResult represents subscribe result
type WSSubscribeResult struct {
	Result []string `json:"result"`
	ID     int64    `json:"id"`
}

// ============================================================================
// CONNECTION
// ============================================================================

// Client represents a WebSocket client
type Client struct {
	ID        string
	UserID   string
	Socket  interface{} // *websocket.Conn
	Streams map[string]bool
	Auth    bool
}

// NewClient creates a new client
func NewClient(id, userID string) *Client {
	return &Client{
		ID:      id,
		UserID:  userID,
		Streams: make(map[string]bool),
		Auth:    false,
	}
}

// ============================================================================
// MARSHAL HELPERS
// ============================================================================

// ToJSON converts to JSON
func (m *WSMessage) ToJSON() ([]byte, error) {
	return json.Marshal(m)
}

// NewWSMessage creates a new WebSocket message
func NewWSMessage(msgType string) *WSMessage {
	return &WSMessage{
		Type:      msgType,
		EventTime: time.Now().UnixMilli(),
	}
}

// NewWSError creates a new error message
func NewWSError(id int64, code int, message string) *WSMessage {
	return &WSMessage{
		Type:      "error",
		ID:       id,
		EventTime: time.Now().UnixMilli(),
		Error:    &WSError{Code: code, Message: message},
	}
}

// NewWSSuccess creates a new success message
func NewWSSuccess(id int64, result interface{}) *WSMessage {
	return &WSMessage{
		Type:      "success",
		ID:       id,
		EventTime: time.Now().UnixMilli(),
		Result:   result,
	}
}