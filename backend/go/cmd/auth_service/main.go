package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
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

	// TODO: In production, query database for user
	// For now, return a mock response for testing
	loginResp := LoginResponse{
		AccessToken:  "mock_access_token_" + time.Now().Format("20060102150405"),
		RefreshToken: "mock_refresh_token_" + time.Now().Format("20060102150405"),
		ExpiresAt:    time.Now().Add(15 * time.Minute).Unix(),
		TokenType:    "Bearer",
		User: &UserResponse{
			ID:        "user_123",
			Email:     req.Email,
			Username:  "testuser",
			KYCLevel:  1,
			Status:    "active",
		},
	}

	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    loginResp,
	})
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

	// TODO: In production, create user in database
	// For now, return a mock response
	loginResp := LoginResponse{
		AccessToken:  "mock_access_token_" + time.Now().Format("20060102150405"),
		RefreshToken: "mock_refresh_token_" + time.Now().Format("20060102150405"),
		ExpiresAt:    time.Now().Add(15 * time.Minute).Unix(),
		TokenType:    "Bearer",
		User: &UserResponse{
			ID:        "user_" + time.Now().Format("20060102150405"),
			Email:     req.Email,
			Username:  req.Username,
			KYCLevel:  0,
			Status:    "active",
		},
	}

	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    loginResp,
	})
}

// HealthCheckHandler health check
func HealthCheckHandler(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, APIResponse{
		Success: true,
		Data:    map[string]string{"status": "healthy", "service": "auth-service"},
	})
}

func main() {
	// Get environment variables
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "tigerex-default-secret-change-in-production"
	}
	jwtRefreshSecret := os.Getenv("JWT_REFRESH_SECRET")
	if jwtRefreshSecret == "" {
		jwtRefreshSecret = "tigerex-default-refresh-secret-change-in-production"
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
