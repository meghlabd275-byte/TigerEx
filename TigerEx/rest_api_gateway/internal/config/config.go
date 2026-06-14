package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the REST API Gateway
type Config struct {
	Server   ServerConfig
	Auth    AuthConfig
	RateLimit RateLimitConfig
	Database DatabaseConfig
	Redis   RedisConfig
	JWT     JWTConfig
	APIKeys  APIKeysConfig
}

// ServerConfig holds server-specific configuration
type ServerConfig struct {
	Port            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout    time.Duration
	MaxHeaderBytes int
	Mode           string // "production", "development"
}

// AuthConfig holds authentication configuration  
type AuthConfig struct {
	Required            bool
	SessionExpiry       time.Duration
	MaxSessionsPerUser int
	AllowMultipleLogin bool
}

// RateLimitConfig holds rate limiting configuration
type RateLimitConfig struct {
	Enabled             bool
	RequestsPerMinute   int
	BurstSize          int
	WhiteList         []string
	BlockDuration     time.Duration
}

// DatabaseConfig holds database configuration
type DatabaseConfig struct {
	Host            string
	Port            string
	User            string
	Password        string
	DBName          string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// RedisConfig holds Redis configuration
type RedisConfig struct {
	Host            string
	Port            string
	Password        string
	DB              int
	PoolSize        int
	MinIdleConns    int
	ConnMaxIdleTime time.Duration
	ConnMaxLifetime time.Duration
}

// JWTConfig holds JWT configuration
type JWTConfig struct {
	Secret           string
	Expiry           time.Duration
	RefreshExpiry    time.Duration
	Issuer           string
	Audience         string
}

// APIKeysConfig holds API keys configuration
type APIKeysConfig struct {
	Enabled     bool
	MaxPerUser  int
	RateLimits  map[string]int // tier -> requests per minute
}

// LoadConfig loads configuration from environment variables
func LoadConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port:            getEnv("API_PORT", "8080"),
			ReadTimeout:     getDuration("API_READ_TIMEOUT", 30*time.Second),
			WriteTimeout:    getDuration("API_WRITE_TIMEOUT", 30*time.Second),
			IdleTimeout:    getDuration("API_IDLE_TIMEOUT", 120*time.Second),
			MaxHeaderBytes: getInt("API_MAX_HEADER_BYTES", 1<<20),
			Mode:           getEnv("API_MODE", "production"),
		},
		Auth: AuthConfig{
			Required:            getBool("API_AUTH_REQUIRED", true),
			SessionExpiry:       getDuration("API_SESSION_EXPIRY", 24*time.Hour),
			MaxSessionsPerUser:  getInt("API_MAX_SESSIONS_PER_USER", 5),
			AllowMultipleLogin:  getBool("API_ALLOW_MULTIPLE_LOGIN", true),
		},
		RateLimit: RateLimitConfig{
			Enabled:           getBool("API_RATE_LIMIT_ENABLED", true),
			RequestsPerMinute: getInt("API_RATE_LIMIT_RPM", 1200),
			BurstSize:        getInt("API_RATE_LIMIT_BURST", 100),
			WhiteList:        getSlice("API_RATE_LIMIT_WHITELIST"),
			BlockDuration:    getDuration("API_RATE_LIMIT_BLOCK_DURATION", 15*time.Minute),
		},
		Database: DatabaseConfig{
			Host:            getEnv("API_DB_HOST", "localhost"),
			Port:            getEnv("API_DB_PORT", "5432"),
			User:            getEnv("API_DB_USER", "tigerex"),
			Password:        getEnv("API_DB_PASSWORD", ""),
			DBName:          getEnv("API_DB_NAME", "tigerex"),
			MaxOpenConns:    getInt("API_DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:   getInt("API_DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime: getDuration("API_DB_CONN_MAX_LIFETIME", 5*time.Minute),
		},
		Redis: RedisConfig{
			Host:            getEnv("API_REDIS_HOST", "localhost"),
			Port:            getEnv("API_REDIS_PORT", "6379"),
			Password:        getEnv("API_REDIS_PASSWORD", ""),
			DB:              getInt("API_REDIS_DB", 0),
			PoolSize:        getInt("API_REDIS_POOL_SIZE", 100),
			MinIdleConns:    getInt("API_REDIS_MIN_IDLE_CONNS", 10),
			ConnMaxIdleTime: getDuration("API_REDIS_CONN_MAX_IDLE_TIME", 5*time.Minute),
			ConnMaxLifetime: getDuration("API_REDIS_CONN_MAX_LIFETIME", 10*time.Minute),
		},
		JWT: JWTConfig{
			Secret:        getEnv("API_JWT_SECRET", "tigerex-secret-key-change-in-production"),
			Expiry:        getDuration("API_JWT_EXPIRY", 1*time.Hour),
			RefreshExpiry: getDuration("API_JWT_REFRESH_EXPIRY", 7*24*time.Hour),
			Issuer:        getEnv("API_JWT_ISSUER", "tigerex"),
			Audience:     getEnv("API_JWT_AUDIENCE", "tigerex-api"),
		},
		APIKeys: APIKeysConfig{
			Enabled:    getBool("API_KEYS_ENABLED", true),
			MaxPerUser: getInt("API_KEYS_MAX_PER_USER", 10),
			RateLimits: map[string]int{
				"free":     1200,
				"basic":    12000,
				"pro":     120000,
				"enterprise": -1, // unlimited
			},
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		return value == "true" || value == "1" || value == "yes"
	}
	return defaultValue
}

func getDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

func getSlice(key string) []string {
	if value := os.Getenv(key); value != "" {
		var result []string
		for _, v := range splitAndTrim(value, ",") {
			result = append(result, v)
		}
		return result
	}
	return nil
}

func splitAndTrim(s, sep string) []string {
	var result []string
	for _, part := range split(s, sep) {
		trimmed := trim(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func split(s, sep string) []string {
	result := []string{}
	start := 0
	for i := 0; i < len(s); i++ {
		if i+len(sep) <= len(s) && s[i:i+len(sep)] == sep {
			result = append(result, s[start:i])
			start = i + len(sep)
			i += len(sep) - 1
		}
	}
	result = append(result, s[start:])
	return result
}

func trim(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}