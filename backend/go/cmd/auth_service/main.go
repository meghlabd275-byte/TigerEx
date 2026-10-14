package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/cors"
)

var (
	dbPool    *pgxpool.Pool
	authSvc   *AuthService
)

// AuthService wraps authentication logic
type AuthService struct {
	jwtSecret        []byte
	jwtRefreshSecret []byte
}

// NewAuthService creates auth service
func NewAuthService(jwtSecret, jwtRefreshSecret string) *AuthService {
	return &AuthService{
		jwtSecret:        []byte(jwtSecret),
		jwtRefreshSecret: []byte(jwtRefreshSecret),
	}
}

// APIResponse standard API response
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError  `json:"error,omitempty"`
}

// APIError standard error
type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// LoginRequest login request
type LoginRequest struct {
	Email         string `json:"email"`
	Password      string `json:"password"`
	TwoFactorCode string `json:"twoFactorCode,omitempty"`
	DeviceID      string `json:"deviceId,omitempty"`
	IPAddress     string `json:"ipAddress,omitempty"`
	UserAgent     string `json:"userAgent,omitempty"`
}

// LoginResponse login response
type LoginResponse struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresAt    int64         `json:"expires_at"`
	TokenType    string        `json:"token_type"`
	User         *UserResponse `json:"user,omitempty"`
}

// UserResponse user info for response
type UserResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Username  string `json:"username"`
	KYCLevel  int    `json:"kyc_level"`
	Status   string `json:"status"`
}

// WriteJSON writes JSON response
func WriteJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// LoginHandler handles user login
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSON(w, http.StatusMethodNotAllowed, APIResponse{
			Success: false,
			Error:   &APIError{Code: 405, Message: "Method not allowed"},
		})
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid request body"},
		})
		return
	}

	// Validate input
	if req.Email == "" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Email is required"},
		})
		return
	}
	if req.Password == "" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Password is required"},
		})
		return
	}

	WriteJSON(w, http.StatusServiceUnavailable, APIResponse{
		Success: false,
		Error: &APIError{
			Code:    http.StatusServiceUnavailable,
			Message: "Authentication persistence is not configured; refusing to issue placeholder credentials",
		},
	})
	return
}

// RegisterHandler handles user registration
func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSON(w, http.StatusMethodNotAllowed, APIResponse{
			Success: false,
			Error:   &APIError{Code: 405, Message: "Method not allowed"},
		})
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Username string `json:"username"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Invalid request body"},
		})
		return
	}

	// Validate input
	if req.Email == "" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Email is required"},
		})
		return
	}
	if req.Username == "" {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Username is required"},
		})
		return
	}
	if len(req.Password) < 8 {
		WriteJSON(w, http.StatusBadRequest, APIResponse{
			Success: false,
			Error:   &APIError{Code: 400, Message: "Password must be at least 8 characters"},
		})
		return
	}

	WriteJSON(w, http.StatusServiceUnavailable, APIResponse{
		Success: false,
		Error: &APIError{
			Code:    http.StatusServiceUnavailable,
			Message: "Authentication persistence is not configured; refusing to issue placeholder credentials",
		},
	})
	return
}

// HealthCheckHandler health check
func HealthCheckHandler(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    map[string]string{"status": "healthy", "service": "auth-service"},
	})
}

func main() {
	// Load signing keys from deployment secrets only. Never start with a known default.
	jwtSecret := os.Getenv("JWT_SECRET")
	jwtRefreshSecret := os.Getenv("JWT_REFRESH_SECRET")
	if len([]byte(jwtSecret)) < 32 {
		log.Fatal("JWT_SECRET must be configured with at least 32 bytes")
	}
	if len([]byte(jwtRefreshSecret)) < 32 || jwtRefreshSecret == jwtSecret {
		log.Fatal("JWT_REFRESH_SECRET must be a distinct secret of at least 32 bytes")
	}
	for _, weak := range []string{"change-in-production", "change-me", "example", "default", "tigerex-secret"} {
		if strings.Contains(strings.ToLower(jwtSecret), weak) || strings.Contains(strings.ToLower(jwtRefreshSecret), weak) {
			log.Fatal("JWT secrets must not contain known placeholder values")
		}
	}

	// Initialize auth service
	authSvc = NewAuthService(jwtSecret, jwtRefreshSecret)

	// Setup router
	mux := http.NewServeMux()

	// CORS middleware
	corsMiddleware := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
	}).Handler

	// Routes
	mux.HandleFunc("/health", HealthCheckHandler)
	mux.HandleFunc("/api/v1/auth/login", LoginHandler)
	mux.HandleFunc("/api/v1/auth/register", RegisterHandler)

	// Apply CORS
	handler := corsMiddleware(mux)

	// Server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Printf("Auth service starting on port %s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}
