// API Gateway - Real-Time Path in Go
// High-performance REST API

package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/mux"
)

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *Error      `json:"error,omitempty"`
	Status  int         `json:"-"`
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
	status := http.StatusBadRequest
	if code == "unauthorized" { status = http.StatusUnauthorized }
	if code == "unavailable" { status = http.StatusServiceUnavailable }
	return &Response{Success: false, Error: &Error{Code: code, Message: msg}, Status: status}
}

// Market handlers
func hTicker(_r *Request) *Response {
	return errorResp("unavailable", "verified market-data provider is not configured")
}

func hDepth(_r *Request) *Response {
	return errorResp("unavailable", "verified order-book provider is not configured")
}

func hTrades(_r *Request) *Response {
	return errorResp("unavailable", "verified trade feed is not configured")
}

// Trading handlers
func hCreateOrder(_r *Request) *Response {
	return errorResp("unavailable", "canonical matching engine and durable ledger are not configured")
}

func hCancelOrder(_r *Request) *Response {
	return errorResp("unavailable", "canonical order service is not configured")
}

func hGetOrder(_r *Request) *Response {
	return errorResp("unavailable", "canonical order service is not configured")
}

func hOpenOrders(_r *Request) *Response {
	return errorResp("unavailable", "persistent order service is not configured")
}

// Account handlers
func hBalance(_r *Request) *Response {
	return errorResp("unavailable", "persistent account ledger is not configured")
}

func hDepositAddr(_r *Request) *Response {
	return errorResp("unavailable", "chain-specific address derivation and custody provider are not configured")
}

func hWithdrawHistory(_r *Request) *Response {
	return errorResp("unavailable", "persistent withdrawal history service is not configured")
}

// Auth middleware
func auth(h Handler) Handler {
	return func(r *Request) *Response {
		if r.UserID == "" { return errorResp("unauthorized", "auth required") }
		return h(r)
	}
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
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" {
			allowed := false
			for _, candidate := range strings.Split(os.Getenv("CORS_ORIGIN"), ",") {
				if candidate = strings.TrimSpace(candidate); candidate != "" && candidate == origin {
					allowed = true
					break
				}
			}
			w.Header().Set("Vary", "Origin")
			if !allowed {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		req := &Request{
			Params: mux.Vars(r),
			Query: r.URL.Query(),
			// Never trust a client-supplied X-User-ID as authentication.
			// Wire a verified JWT/session middleware before enabling private routes.
			UserID: "",
		}
		resp := h(req)
		status := resp.Status
		if status == 0 { status = http.StatusOK }
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func (s *Server) Start() {
	addr := fmt.Sprintf("%s:%d", s.addr, s.port)
	log.Printf("API Gateway: %s", addr)
	log.Fatal(http.ListenAndServe(addr, s.router))
}