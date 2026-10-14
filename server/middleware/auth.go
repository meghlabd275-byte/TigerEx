// Middleware Package - Auth, CORS, Rate Limiting
package middleware

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tigerex/server/models"
)

var JWTSecret []byte

// LoadJWTSecret loads the signing key after environment configuration has been loaded.
// It deliberately has no insecure development fallback: all services using this
// middleware must be configured with a unique secret of at least 32 bytes.
func LoadJWTSecret() error {
	secret := os.Getenv("JWT_SECRET")
	if len([]byte(secret)) < 32 {
		return fmt.Errorf("JWT_SECRET must be configured with at least 32 bytes")
	}
	lower := strings.ToLower(secret)
	for _, weak := range []string{"change-in-production", "change-me", "example", "default", "tigerex-secret", "tigerex-jwt-secret"} {
		if strings.Contains(lower, weak) {
			return fmt.Errorf("JWT_SECRET contains a prohibited placeholder value")
		}
	}
	JWTSecret = []byte(secret)
	return nil
}

// CORS middleware
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allowed := origin == ""
		if origin != "" {
			for _, candidate := range strings.Split(os.Getenv("CORS_ORIGIN"), ",") {
				if strings.TrimSpace(candidate) != "" && strings.TrimSpace(candidate) == origin {
					allowed = true
					break
				}
			}
			c.Header("Vary", "Origin")
			if !allowed {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Origin not allowed"})
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-Request-ID")
		c.Header("Access-Control-Max-Age", "600")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// Rate limiter (simple in-memory)
type visitor struct {
	lastSeen time.Time
	visits  int
}

var visitors = make(map[string]*visitor)
var visitorsMu sync.Mutex

func RateLimiter() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		visitorsMu.Lock()
		// Bound attacker-controlled IP cardinality; stale entries are evicted under the lock.
		if len(visitors) >= 10000 {
			for key, entry := range visitors {
				if now.Sub(entry.lastSeen) > 2*time.Minute {
					delete(visitors, key)
				}
			}
		}
		v, exists := visitors[ip]
		if !exists {
			if len(visitors) >= 10000 {
				visitorsMu.Unlock()
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limiter capacity reached"})
				c.Abort()
				return
			}
			visitors[ip] = &visitor{lastSeen: now, visits: 1}
			visitorsMu.Unlock()
			c.Next()
			return
		}
		if now.Sub(v.lastSeen) > time.Minute {
			v.visits = 0
		}
		v.visits++
		v.lastSeen = now
		limited := v.visits > 100
		visitorsMu.Unlock()

		if limited {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// Auth required middleware
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization required"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Bearer token required"})
			c.Abort()
			return
		}

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected JWT signing method: %s", token.Method.Alg())
			}
			if len(JWTSecret) < 32 {
				return nil, fmt.Errorf("JWT signing key is not configured")
			}
			return JWTSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			c.Abort()
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in token"})
			c.Abort()
			return
		}

		// Verify user exists and is active
		var count int
		err = models.Pool.QueryRow(c.Request.Context(), 
			"SELECT COUNT(*) FROM users WHERE id = $1 AND status = 'active'", userID).Scan(&count)
		
		if err != nil || count == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found or inactive"})
			c.Abort()
			return
		}

		c.Set("user_id", userID)
		c.Next()
	}
}

func GetUserID(c *gin.Context) string {
	if id, exists := c.Get("user_id"); exists {
		return id.(string)
	}
	return ""
}

func InitDB(pool *pgxpool.Pool) {
	models.Pool = pool
}

// Admin authentication middleware
func AdminAuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Authorization required"}})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Bearer token required"}})
			c.Abort()
			return
		}

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected JWT signing method: %s", token.Method.Alg())
			}
			if len(JWTSecret) < 32 {
				return nil, fmt.Errorf("JWT signing key is not configured")
			}
			return JWTSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid token"}})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Invalid claims"}})
			c.Abort()
			return
		}

		adminID, ok := claims["admin_id"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": 401, "message": "Admin ID not found"}})
			c.Abort()
			return
		}

		username, _ := claims["username"].(string)
		role, _ := claims["role"].(string)
		perms, _ := claims["permissions"].([]interface{})

		// Convert permissions to string slice
		var permStrings []string
		for _, p := range perms {
			if ps, ok := p.(string); ok {
				permStrings = append(permStrings, ps)
			}
		}

		// Set admin info in context
		c.Set("admin_id", adminID)
		c.Set("admin_username", username)
		c.Set("admin_role", role)
		c.Set("admin_permissions", permStrings)

		c.Next()
	}
}