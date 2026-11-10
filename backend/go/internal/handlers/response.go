package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Response represents standard API response
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *Error      `json:"error,omitempty"`
}

// Error represents API error
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Pagination represents pagination params
type Pagination struct {
	Page  int `json:"page"`
	Limit int `json:"limit"`
	Total int `json:"total"`
}

// WriteJSON writes JSON response
func WriteJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// WriteSuccess writes success response
func WriteSuccess(w http.ResponseWriter, data interface{}) {
	WriteJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    data,
	})
}

// WriteError writes error response
func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, Response{
		Success: false,
		Error: &Error{
			Code:    code,
			Message: message,
		},
	})
}

// WriteJSONError is alias for WriteError
var WriteJSONError = WriteError

// Request represents incoming request
type Request struct {
	// Common fields
	Page  int `json:"page"`
	Limit int `json:"limit"`
}

// ParseJSON parses JSON body
func ParseJSON(r *http.Request, dest interface{}) error {
	return json.NewDecoder(r.Body).Decode(dest)
}

// GetPagination returns pagination from request
func GetPagination(r *http.Request) Pagination {
	page := 1
	limit := 20

	if p := r.URL.Query().Get("page"); p != "" {
		if parsed := parseInt(p); parsed > 0 {
			page = parsed
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed := parseInt(l); parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	return Pagination{
		Page:  page,
		Limit: limit,
	}
}

// GetToken returns bearer token from header
func GetToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

// userIDContextKey is the private context key under which the authentication
// middleware stores the authenticated user's id. The zero-size struct type
// keeps the key unexported and collision-free.
type userIDContextKey struct{}

// WithUserID returns a copy of ctx carrying the authenticated user id. The
// authentication middleware calls this after verifying a session token;
// handlers read it with GetUserID instead of trusting a request field.
func WithUserID(ctx context.Context, userID uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDContextKey{}, userID)
}

// GetUserID returns the authenticated user id from the request context.
//
// It reads the value the authentication middleware stored, never a header or
// query parameter, so a caller cannot act as another user by supplying an id.
// A request that did not pass through authentication yields false.
func GetUserID(r *http.Request) (uuid.UUID, bool) {
	userID, ok := r.Context().Value(userIDContextKey{}).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		return uuid.Nil, false
	}
	return userID, true
}

// GetUserIDFromContext returns user ID from context
var GetUserIDFromContext = GetUserID

func parseInt(s string) int {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// Time utilities
func Now() time.Time {
	return time.Now()
}

func NowUnix() int64 {
	return time.Now().Unix()
}

// String utilities
func Trim(s string) string {
	return strings.TrimSpace(s)
}

func IsEmpty(s string) bool {
	return strings.TrimSpace(s) == ""
}
