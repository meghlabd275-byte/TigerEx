package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port            string
	Environment    string
	JWTSecret       string
	MongoURI        string
	MongoDatabase   string
	RedisAddress   string
	HMACSecret     string
	LogLevel       string
	RateLimit      int
	RequestTimeout int
}

func Load() *Config {
	return &Config{
		Port:            getEnv("PORT", "8080"),
		Environment:    getEnv("ENVIRONMENT", "development"),
		JWTSecret:      getEnv("JWT_SECRET", "tigerex-secret-key-change-in-production"),
		MongoURI:       getEnv("MONGO_URI", "mongodb://localhost:27017"),
		MongoDatabase:  getEnv("MONGO_DATABASE", "tigerex"),
		RedisAddress:   getEnv("REDIS_ADDRESS", "localhost:6379"),
		HMACSecret:    getEnv("HMAC_SECRET", "hmac-secret-key"),
		LogLevel:      getEnv("LOG_LEVEL", "info"),
		RateLimit:     100,  // requests per minute
		RequestTimeout: 30, // seconds
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func (c *Config) GetDSN() string {
	return fmt.Sprintf("%s/%s", c.MongoURI, c.MongoDatabase)
}