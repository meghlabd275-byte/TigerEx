package main

import (
	"encoding/json"
	"encoding/base64"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// API Response generic
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Order representation
type Order struct {
	OrderID    string `json:"orderId"`
	UserID    string `json:"userId"`
	Symbol    string `json:"symbol"`
	Side      string `json:"side"`
	Type      string `json:"type"`
	Quantity float64 `json:"quantity"`
	Price     float64 `json:"price,omitempty"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"createdAt"`
}

// Trade representation  
type Trade struct {
	ID        string  `json:"id"`
	Symbol    string  `json:"symbol"`
	Side      string  `json:"side"`
	Price     float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Time      int64   `json:"time"`
}

// Deposit representation
type Deposit struct {
	ID     string  `json:"id"`
	Asset  string  `json:"asset"`
	Amount float64 `json:"amount"`
	Status string  `json:"status"`
	Time   int64   `json:"time"`
}

// Withdrawal representation
type Withdrawal struct {
	ID     string  `json:"id"`
	Asset  string  `json:"asset"`
	Amount float64 `json:"amount"`
	Status string  `json:"status"`
	Time   int64   `json:"time"`
}

// Wallet info
type WalletInfo struct {
	TotalMargin      float64 `json:"totalMargin"`
	AvailableMargin float64 `json:"availableMargin"`
}

// Position info
type Position struct {
	PositionAmt float64 `json:"positionAmt"`
	EntryPrice float64 `json:"entryPrice"`
	LiqPrice   float64 `json:"liqPrice"`
	Margin     float64 `json:"margin"`
}

// Ticker data
type Ticker struct {
	PriceChange  float64 `json:"priceChange"`
	PriceChangePercent float64 `json:"priceChangePercent"`
	LastPrice  float64 `json:"lastPrice"`
	Volume    float64 `json:"volume"`
	HighPrice float64 `json:"highPrice"`
	LowPrice  float64 `json:"lowPrice"`
}

// Book ticker
type BookTicker struct {
	Bid float64 `json:"bid"`
	Ask float64 `json:"ask"`
}

// Average price
type AvgPrice struct {
	Mins  int     `json:"mins"`
	Price float64 `json:"price"`
}

// Depth (order book)
type Depth struct {
	Bids [][]string `json:"bids"`
	Asks [][]string `json:"asks"`
}

// REST API Gateway
type RESTAPIGateway struct {
	orders      map[string]Order
	deposits    map[string]Deposit
	withdrawals map[string]Withdrawal
	counter    int64
}

func NewRESTAPIGateway() *RESTAPIGateway {
	return &RESTAPIGateway{
		orders:      make(map[string]Order),
		deposits:    make(map[string]Deposit),
		withdrawals: make(map[string]Withdrawal),
		counter:    0,
	}
}

// Get commissions (fees)
func (g *RESTAPIGateway) GetCommissions() map[string]float64 {
	return map[string]float64{"maker": 0.001, "taker": 0.001}
}

// Get account info
func (g *RESTAPIGateway) GetAccount(userID string) APIResponse {
	return APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"userId":  userID,
			"created": time.Now().UnixMilli(),
		},
	}
}

// Get trade history
func (g *RESTAPIGateway) GetHistory(userID string, startTime, endTime int64, limit int) APIResponse {
	now := time.Now().UnixMilli()
	return APIResponse{
		Success: true,
		Data: []Trade{
			{ID: "ord_001", Symbol: "BTC/USDT", Side: "BUY", Price: 50000, Quantity: 0.1, Time: now - 86400000},
			{ID: "ord_002", Symbol: "ETH/USDT", Side: "BUY", Price: 3000, Quantity: 1, Time: now - 172800000},
		},
	}
}

// Get deposit address
func (g *RESTAPIGateway) GetDepositAddress(userID, network string) APIResponse {
	addr := generateRandomAddress()
	return APIResponse{
		Success: true,
		Data: map[string]string{
			"address": addr,
			"tag":     "",
		},
	}
}

// Get deposit history
func (g *RESTAPIGateway) GetDepositHistory(userID string) APIResponse {
	now := time.Now().UnixMilli()
	return APIResponse{
		Success: true,
		Data: []Deposit{
			{ID: "dep_001", Asset: "BTC", Amount: 1.5, Status: "COMPLETED", Time: now - 86400000},
			{ID: "dep_002", Asset: "ETH", Amount: 10, Status: "COMPLETED", Time: now - 172800000},
		},
	}
}

// Get withdrawal history
func (g *RESTAPIGateway) GetWithdrawHistory(userID string) APIResponse {
	now := time.Now().UnixMilli()
	return APIResponse{
		Success: true,
		Data: []Withdrawal{
			{ID: "wd_001", Asset: "USDT", Amount: 5000, Status: "COMPLETED", Time: now - 86400000},
		},
	}
}

// Process withdrawal
func (g *RESTAPIGateway) Withdraw(userID, asset, amount float64, address, network string) APIResponse {
	g.counter++
	id := fmt.Sprintf("WD_%d", g.counter)
	g.withdrawals[id] = Withdrawal{
		ID: id, Asset: asset, Amount: amount,
		Status: "processing", Time: time.Now().UnixMilli(),
	}
	return APIResponse{
		Success: true,
		Data: map[string]interface{}{"id": id, "status": "processing"},
	}
}

// Get order
func (g *RESTAPIGateway) GetOrder(orderID string) APIResponse {
	if order, ok := g.orders[orderID]; ok {
		return APIResponse{Success: true, Data: order}
	}
	return APIResponse{Success: true, Data: nil}
}

// Create order
func (g *RESTAPIGateway) CreateOrder(userID, symbol, side, orderType string, quantity, price float64) APIResponse {
	g.counter++
	id := fmt.Sprintf("ORD_%d", g.counter)
	order := Order{
		OrderID: id, UserID: userID, Symbol: symbol,
		Side: side, Type: orderType, Quantity: quantity,
		Price: price, Status: "FILLED", CreatedAt: time.Now().UnixMilli(),
	}
	g.orders[id] = order
	return APIResponse{
		Success: true,
		Data: map[string]interface{}{"orderId": id, "status": "FILLED"},
	}
}

// Cancel order
func (g *RESTAPIGateway) CancelOrder(orderID string) APIResponse {
	if order, ok := g.orders[orderID]; ok {
		order.Status = "CANCELLED"
		g.orders[orderID] = order
		return APIResponse{Success: true, Data: map[string]string{"orderId": orderID, "status": "CANCELLED"}}
	}
	return APIResponse{Success: true, Data: map[string]string{"orderId": orderID, "status": "not_found"}}
}

// Get my trades
func (g *RESTAPIGateway) GetMyTrades(orderID string) APIResponse {
	return APIResponse{Success: true, Data: []Trade{}}
}

// Get average price
func (g *RESTAPIGateway) GetAvgPrice(symbol string) APIResponse {
	return APIResponse{
		Success: true,
		Data: AvgPrice{Mins: 5, Price: 50000},
	}
}

// Get margin account
func (g *RESTAPIGateway) GetMarginAccount(userID string) APIResponse {
	return APIResponse{
		Success: true,
		Data: WalletInfo{TotalMargin: 0, AvailableMargin: 0},
	}
}

// Get position
func (g *RESTAPIGateway) GetPosition(symbol string) APIResponse {
	return APIResponse{
		Success: true,
		Data: Position{PositionAmt: 0},
	}
}

// Get futures account
func (g *RESTAPIGateway) GetFuturesAccount(userID string) APIResponse {
	return APIResponse{
		Success: true,
		Data: map[string]float64{"equity": 0, "availableBalance": 0},
	}
}

// Get price
func (g *RESTAPIGateway) GetPrice(symbol string) APIResponse {
	return APIResponse{
		Success: true,
		Data: map[string]float64{"price": 50000},
	}
}

// Get book ticker
func (g *RESTAPIGateway) GetBookTicker(symbol string) APIResponse {
	return APIResponse{
		Success: true,
		Data: BookTicker{Bid: 49990, Ask: 50010},
	}
}

// Get 24hr ticker
func (g *RESTAPIGateway) Get24hrTicker(symbol string) APIResponse {
	return APIResponse{
		Success: true,
		Data: Ticker{PriceChange: 0, Volume: 1000000},
	}
}

// Get depth (order book)
func (g *RESTAPIGateway) GetDepth(symbol string, limit int) APIResponse {
	return APIResponse{
		Success: true,
		Data: Depth{Bids: [][]string{}, Asks: [][]string{}},
	}
}

// Get trades
func (g *RESTAPIGateway) GetTrades(symbol string) APIResponse {
	return APIResponse{Success: true, Data: []Trade{}}
}

// Get klines (candlesticks)
func (g *RESTAPIGateway) GetKlines(symbol, interval string) APIResponse {
	return APIResponse{Success: true, Data: [][]interface{}{}}
}

// Get exchange info
func (g *RESTAPIGateway) GetExchangeInfo() APIResponse {
	return APIResponse{
		Success: true,
		Data: map[string][]string{"symbols": {}},
	}
}

// Helper: generate random address
func generateRandomAddress() string {
	b := make([]byte, 20)
	rand.Read(b)
	return "0x" + base64.URLEncoding.EncodeToString(b)[:40]
}

// WebSocket Stream Manager
type WebSocketStream struct {
	connections map[string]bool
}

func NewWebSocketStream() *WebSocketStream {
	return &WebSocketStream{connections: make(map[string]bool)}
}

func (ws *WebSocketStream) Subscribe(streams []string) APIResponse {
	return APIResponse{
		Success: true,
		Data: map[string]string{"subscribed": strings.Join(streams, ",")},
	}
}

func (ws *WebSocketStream) Unsubscribe(streams []string) APIResponse {
	return APIResponse{Success: true, Data: map[string]bool{}}
}

// Rate Limiter
type RateLimiter struct {
	limits map[string]int64
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{limits: make(map[string]int64)}
}

func (rl *RateLimiter) Check(apiKey string) APIResponse {
	Remaining := 1000 - rl.limits[apiKey]
	return APIResponse{
		Success: true,
		Data: map[string]interface{}{"allowed": true, "remaining": Remaining},
	}
}

func (rl *RateLimiter) GetStatus(apiKey string) APIResponse {
	return APIResponse{
		Success: true,
		Data: map[string]int64{"requests": rl.limits[apiKey], "remaining": 1000 - rl.limits[apiKey]},
	}
}

// HTTP Handlers
var gateway = NewRESTAPIGateway()

func commisionsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gateway.GetCommissions())
}

func accountHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("userId")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gateway.GetAccount(userID))
}

func orderHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	if r.Method == "GET" {
		orderID := r.URL.Query().Get("orderId")
		json.NewEncoder(w).Encode(gateway.GetOrder(orderID))
	} else if r.Method == "POST" {
		json.NewEncoder(w).Encode(gateway.CreateOrder(
			r.FormValue("userId"),
			r.FormValue("symbol"),
			r.FormValue("side"),
			r.FormValue("type"),
			parseFloat(r.FormValue("quantity")),
			parseFloat(r.FormValue("price")),
		))
	}
}

func tickerHandler(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gateway.Get24hrTicker(symbol))
}

func depthHandler(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	limit := parseInt(r.URL.Query().Get("limit"), 100)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gateway.GetDepth(symbol, limit))
}

// Helper parsers
func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

func parseInt(s string, def int) int {
	i, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return i
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	
	// Register routes
	http.HandleFunc("/api/v1/commission", commisionsHandler)
	http.HandleFunc("/api/v1/account", accountHandler)
	http.HandleFunc("/api/v1/order", orderHandler)
	http.HandleFunc("/api/v1/ticker/24hr", tickerHandler)
	http.HandleFunc("/api/v1/depth", depthHandler)
	
	fmt.Printf("REST API Gateway starting on port %s\n", port)
	
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		fmt.Printf("Server error: %v\n", err)
		os.Exit(1)
	}
}