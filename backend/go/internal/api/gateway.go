// API Gateway - Real-Time Path in Go
// High-performance REST API

package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/gorilla/mux"
)

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *Error     `json:"error,omitempty"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Handler func(*Request) *Response

type Request struct {
	Params map[string]string
	Query  map[string][]string
	Body  map[string]interface{}
	UserID string
}

func errorResp(code, msg string) *Response {
	return &Response{Success: false, Error: &Error{Code: code, Message: msg}}
}

// Market handlers
func hTicker(r *Request) *Response {
	symbol := r.Params["symbol"]
	if symbol == "" { symbol = "BTCUSDT" }
	return &Response{Success: true, Data: map[string]interface{}{
		"symbol": symbol, "price": "50000.00", "volume_24h": "10000.5",
	}}
}

func hDepth(r *Request) *Response {
	return &Response{Success: true, Data: map[string]interface{}{
		"bids": [][]string{{"50000.00", "1.5"}},
		"asks": [][]string{{"50000.50", "1.0"}},
	}}
}

func hTrades(r *Request) *Response {
	return &Response{Success: true, Data: map[string]interface{}{
		"trades": []map[string]interface{}{
			{"id": 1, "price": "50000", "qty": "0.5"},
		},
	}}
}

// Trading handlers
func hCreateOrder(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	return &Response{Success: true, Data: map[string]interface{}{
		"id": fmt.Sprintf("ord_%d", time.Now().Unix()), "status": "new",
	}}
}

func hCancelOrder(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	return &Response{Success: true, Data: map[string]interface{}{
		"order_id": r.Params["id"], "status": "cancelled",
	}}
}

func hGetOrder(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	return &Response{Success: true, Data: map[string]interface{}{
		"id": r.Params["id"], "symbol": "BTCUSDT", "status": "new",
	}}
}

func hOpenOrders(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	return &Response{Success: true, Data: map[string]interface{}{"orders": []interface{}{}}}
}

// Account handlers
func hBalance(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	return &Response{Success: true, Data: map[string]interface{}{
		"balances": []map[string]string{
			{"asset": "USDT", "free": "10000.00"},
			{"asset": "BTC", "free": "1.00"},
		},
	}}
}

func hDepositAddr(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	asset := "BTC"
	if len(r.Query["asset"]) > 0 { asset = r.Query["asset"][0] }
	return &Response{Success: true, Data: map[string]string{
		"asset": asset, "address": "bc1q" + randStr(38),
	}}
}

func hWithdrawHistory(r *Request) *Response {
	if r.UserID == "" { return errorResp("unauthorized", "auth required") }
	return &Response{Success: true, Data: map[string]interface{}{"withdraws": []interface{}{}}}
}

// Auth middleware
func auth(h Handler) Handler {
	return func(r *Request) *Response {
		if r.UserID == "" { return errorResp("unauthorized", "auth required") }
		return h(r)
	}
}

func isValidSymbol(s string) bool {
	matched, _ := regexp.MatchString(`^[A-Z]{2,10}USDT$`, s)
	return matched || s == ""
}

func randStr(n int) string {
	const letters = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	for i := range b { b[i] = letters[i%len(letters)] }
	return string(b)
}

type Server struct {
	router *mux.Router
	addr   string
	port   int
}

func NewServer(addr string, port int) *Server {
	s := &Server{
		router: mux.NewRouter(),
		addr: addr,
		port: port,
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	// Market (public)
	s.router.HandleFunc("/api/v1/ticker/{symbol}", s.handle(hTicker)).Methods("GET")
	s.router.HandleFunc("/api/v1/depth", s.handle(hDepth)).Methods("GET")
	s.router.HandleFunc("/api/v1/trades", s.handle(hTrades)).Methods("GET")
	
	// Trading (auth)
	s.router.HandleFunc("/api/v1/order", s.handle(auth(hCreateOrder))).Methods("POST")
	s.router.HandleFunc("/api/v1/order/{id}", s.handle(auth(hCancelOrder))).Methods("DELETE")
	s.router.HandleFunc("/api/v1/order/{id}", s.handle(auth(hGetOrder))).Methods("GET")
	s.router.HandleFunc("/api/v1/openOrders", s.handle(auth(hOpenOrders))).Methods("GET")
	
	// Account (auth)
	s.router.HandleFunc("/api/v1/balance", s.handle(auth(hBalance))).Methods("GET")
	s.router.HandleFunc("/api/v1/depositAddress", s.handle(auth(hDepositAddr))).Methods("GET")
	s.router.HandleFunc("/api/v1/withdrawHistory", s.handle(auth(hWithdrawHistory))).Methods("GET")
	
	// Health
	s.router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
}

func (s *Server) handle(h Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		
		if r.Method == "OPTIONS" { w.WriteHeader(http.StatusNoContent); return }
		
		req := &Request{
			Params: mux.Vars(r),
			Query:  r.URL.Query(),
			UserID: r.Header.Get("X-User-ID"), // Simplified auth
		}
		
		resp := h(req)
		
		if resp.Error != nil { w.WriteHeader(400) }
		json.NewEncoder(w).Encode(resp)
	}
}

func (s *Server) Start() {
	addr := fmt.Sprintf("%s:%d", s.addr, s.port)
	log.Printf("API Gateway: %s", addr)
	log.Fatal(http.ListenAndServe(addr, s.router))
}