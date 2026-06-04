// Middleware Package - Auth, CORS, Rate Limiting
package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tigerex/server/models"
)

var JWTSecret = []byte("tigerex-jwt-secret-change-in-production")

// CORS middleware
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == "OPTIONS" {
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

func RateLimiter() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()

		v, exists := visitors[ip]
		if !exists {
			visitors[ip] = &visitor{time.Now(), 1}
		} else {
			if time.Since(v.lastSeen) > time.Minute {
				v.visits = 0
			}
			v.visits++
			if v.visits > 100 {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
				c.Abort()
				return
			}
			v.lastSeen = time.Now()
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