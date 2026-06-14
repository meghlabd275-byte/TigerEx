package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the WebSocket Gateway
type Config struct {
	Server      ServerConfig
	RateLimit  RateLimitConfig
	Auth       AuthConfig
	Heartbeat  HeartbeatConfig
	Buffer     BufferConfig
}

// ServerConfig holds server-specific configuration
type ServerConfig struct {
	Port            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	MaxConnections int
	Mode           string
}

// AuthConfig holds authentication configuration
type AuthConfig struct {
	Required      bool
	AllowAnonymous bool
}

// HeartbeatConfig holds heartbeat configuration
type HeartbeatConfig struct {
	Interval    time.Duration
	Timeout    time.Duration
}

// BufferConfig holds buffer configuration
type BufferConfig struct {
	WriteTimeout time.Duration
	QueueSize   int
}

// LoadConfig loads configuration from environment variables
func LoadConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port:         getEnv("WS_PORT", "8081"),
			ReadTimeout:  60 * time.Second,
			WriteTimeout: 60 * time.Second,
			MaxConnections: getInt("WS_MAX_CONNECTIONS", 10000),
			Mode:        getEnv("WS_MODE", "production"),
		},
		RateLimit: RateLimitConfig{
			MessagesPerSecond: getInt("WS_RATE_LIMIT_MPS", 100),
			BurstSize:       getInt("WS_RATE_LIMIT_BURST", 200),
		},
		Auth: AuthConfig{
			Required:      getBool("WS_AUTH_REQUIRED", true),
			AllowAnonymous: getBool("WS_ALLOW_ANONYMOUS", false),
		},
		Heartbeat: HeartbeatConfig{
			Interval: getDuration("WS_HEARTBEAT_INTERVAL", 30*time.Second),
			Timeout: getDuration("WS_HEARTBEAT_TIMEOUT", 60*time.Second),
		},
		Buffer: BufferConfig{
			WriteTimeout: getDuration("WS_BUFFER_WRITE_TIMEOUT", 5*time.Second),
			QueueSize:   getInt("WS_BUFFER_QUEUE_SIZE", 100),
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