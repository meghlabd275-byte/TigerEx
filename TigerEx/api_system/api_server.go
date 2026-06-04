package main

import (
    "encoding/json"
    "log"
    "net/http"
    "time"
)

type APIResponse struct {
    Success bool        `json:"success"`
    Data    interface{} `json:"data,omitempty"`
    Error   string      `json:"error,omitempty"`
    Message string      `json:"message,omitempty"`
}

type HealthResponse struct {
    Status    string    `json:"status"`
    Timestamp time.Time `json:"timestamp"`
    Version   string    `json:"version"`
    Uptime    int64     `json:"uptime_seconds"`
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
    resp := HealthResponse{
        Status:    "healthy",
        Timestamp: time.Now(),
        Version:   "1.0.0",
        Uptime:    int64(time.Since(startTime).Seconds()),
    }
    writeJSON(w, http.StatusOK, resp)
}

func handleMarkets(w http.ResponseWriter, r *http.Request) {
    markets := []map[string]interface{}{
        {"symbol": "BTCUSDT", "baseCurrency": "BTC", "quoteCurrency": "USDT", "price": 67543.21, "change24h": 2.34, "volume24h": 1234567890},
        {"symbol": "ETHUSDT", "baseCurrency": "ETH", "quoteCurrency": "USDT", "price": 3456.78, "change24h": 1.56, "volume24h": 987654321},
        {"symbol": "BNBUSDT", "baseCurrency": "BNB", "quoteCurrency": "USDT", "price": 567.89, "change24h": -0.45, "volume24h": 456789012},
        {"symbol": "SOLUSDT", "baseCurrency": "SOL", "quoteCurrency": "USDT", "price": 178.45, "change24h": 5.67, "volume24h": 345678901},
        {"symbol": "XRPUSDT", "baseCurrency": "XRP", "quoteCurrency": "USDT", "price": 0.5678, "change24h": -1.23, "volume24h": 234567890},
    }
    writeJSON(w, http.StatusOK, markets)
}

func handleOrders(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        orders := []map[string]interface{}{}
        writeJSON(w, http.StatusOK, orders)
    case http.MethodPost:
        var order map[string]interface{}
        if err := json.NewDecoder(r.Body).Decode(&order); err != nil {
            writeJSON(w, http.StatusBadRequest, APIResponse{Success: false, Error: "Invalid request"})
            return
        }
        order["id"] = generateID()
        order["createdAt"] = time.Now().Format(time.RFC3339)
        order["status"] = "new"
        writeJSON(w, http.StatusCreated, order)
    default:
        w.WriteHeader(http.StatusMethodNotAllowed)
    }
}

func handleWallets(w http.ResponseWriter, r *http.Request) {
    wallets := []map[string]interface{}{
        {"currency": "BTC", "balance": 0.52345678, "availableBalance": 0.5, "lockedBalance": 0.02345678, "usdValue": 35367.89},
        {"currency": "ETH", "balance": 4.87654321, "availableBalance": 4.5, "lockedBalance": 0.37654321, "usdValue": 16859.12},
        {"currency": "USDT", "balance": 25000, "availableBalance": 25000, "lockedBalance": 0, "usdValue": 25000},
        {"currency": "BNB", "balance": 45.67, "availableBalance": 40, "lockedBalance": 5.67, "usdValue": 25923.45},
    }
    writeJSON(w, http.StatusOK, wallets)
}

func handleTransactions(w http.ResponseWriter, r *http.Request) {
    transactions := []map[string]interface{}{
        {"id": "tx001", "type": "deposit", "currency": "BTC", "amount": 0.5, "status": "completed", "date": "2026-06-01T10:30:00Z", "txHash": "0x1234567890abcdef"},
        {"id": "tx002", "type": "trade", "currency": "ETH", "amount": 2.5, "status": "completed", "date": "2026-06-02T14:22:00Z"},
        {"id": "tx003", "type": "withdrawal", "currency": "USDT", "amount": 5000, "status": "pending", "date": "2026-06-03T08:15:00Z"},
    }
    writeJSON(w, http.StatusOK, transactions)
}

func handleUserRegister(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        w.WriteHeader(http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }
    
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, http.StatusBadRequest, APIResponse{Success: false, Error: "Invalid request"})
        return
    }
    
    user := map[string]interface{}{
        "id":         generateID(),
        "email":      req.Email,
        "kycLevel":   0,
        "status":     "active",
        "createdAt":  time.Now().Format(time.RFC3339),
    }
    
    writeJSON(w, http.StatusCreated, user)
}

func handleUserLogin(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        w.WriteHeader(http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }
    
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, http.StatusBadRequest, APIResponse{Success: false, Error: "Invalid request"})
        return
    }
    
    token := generateToken()
    resp := map[string]interface{}{
        "accessToken":  token,
        "refreshToken": generateToken(),
        "expiresIn":    3600,
        "tokenType":    "Bearer",
    }
    
    writeJSON(w, http.StatusOK, resp)
}

func handleKYCSubmit(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        w.WriteHeader(http.StatusMethodNotAllowed)
        return
    }
    
    writeJSON(w, http.StatusCreated, map[string]interface{}{
        "status":    "submitted",
        "message":   "KYC documents submitted successfully",
        "createdAt": time.Now().Format(time.RFC3339),
    })
}

func handleAdminUsers(w http.ResponseWriter, r *http.Request) {
    users := []map[string]interface{}{
        {"id": "usr001", "email": "user1@example.com", "kycLevel": 2, "kycStatus": "approved", "status": "active", "country": "US", "lastLogin": "2026-06-04T10:00:00Z"},
        {"id": "usr002", "email": "user2@example.com", "kycLevel": 1, "kycStatus": "pending", "status": "active", "country": "UK", "lastLogin": "2026-06-03T15:30:00Z"},
        {"id": "usr003", "email": "user3@example.com", "kycLevel": 0, "kycStatus": "pending", "status": "suspended", "country": "DE", "lastLogin": "2026-06-02T09:45:00Z"},
    }
    writeJSON(w, http.StatusOK, users)
}

func handleAdminOrders(w http.ResponseWriter, r *http.Request) {
    orders := []map[string]interface{}{
        {"id": "ord001", "userId": "usr001", "symbol": "BTCUSDT", "side": "buy", "price": 67500, "quantity": 0.1, "filled": 0.1, "status": "filled", "createdAt": "2026-06-04T10:30:00Z"},
        {"id": "ord002", "userId": "usr002", "symbol": "ETHUSDT", "side": "sell", "price": 3500, "quantity": 1, "filled": 0.5, "status": "partially_filled", "createdAt": "2026-06-04T11:15:00Z"},
    }
    writeJSON(w, http.StatusOK, orders)
}

func handleAdminMarkets(w http.ResponseWriter, r *http.Request) {
    markets := []map[string]interface{}{
        {"symbol": "BTCUSDT", "status": "trading", "makerFee": 0.001, "takerFee": 0.001},
        {"symbol": "ETHUSDT", "status": "trading", "makerFee": 0.001, "takerFee": 0.001},
        {"symbol": "BNBUSDT", "status": "halted", "makerFee": 0.001, "takerFee": 0.002},
    }
    writeJSON(w, http.StatusOK, markets)
}

func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
    })
}

func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if r.Method == http.MethodOptions {
            w.WriteHeader(http.StatusOK)
            return
        }
        next.ServeHTTP(w, r)
    })
}

var startTime = time.Now()

func main() {
    mux := http.NewServeMux()
    
    // Health
    mux.HandleFunc("/health", handleHealth)
    
    // Auth
    mux.HandleFunc("/api/register", handleUserRegister)
    mux.HandleFunc("/api/login", handleUserLogin)
    
    // Trading
    mux.HandleFunc("/api/markets", handleMarkets)
    mux.HandleFunc("/api/orders", handleOrders)
    
    // Wallet
    mux.HandleFunc("/api/wallets", handleWallets)
    mux.HandleFunc("/api/transactions", handleTransactions)
    
    // KYC
    mux.HandleFunc("/api/kyc/submit", handleKYCSubmit)
    
    // Admin
    mux.HandleFunc("/api/admin/users", handleAdminUsers)
    mux.HandleFunc("/api/admin/orders", handleAdminOrders)
    mux.HandleFunc("/api/admin/markets", handleAdminMarkets)
    
    handler := loggingMiddleware(corsMiddleware(mux))
    
    log.Println("TigerEx API Server starting on :8080")
    if err := http.ListenAndServe(":8080", handler); err != nil {
        log.Fatal(err)
    }
}

func generateID() string {
    return time.Now().Format("20060102150405") + "-" + randomString(8)
}

func generateToken() string {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    b := make([]byte, 32)
    for i := range b {
        b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
    }
    return string(b)
}

func randomString(n int) string {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    b := make([]byte, n)
    for i := range b {
        b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
    }
    return string(b)
}