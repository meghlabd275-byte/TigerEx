package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	// Server
	ServerPort string
	ServerHost string
	Mode       string // development, production

	// Database
	DBHost         string
	DBPort         int
	DBUser         string
	DBPassword     string
	DBName         string
	DBSSLMode      string
	DBMaxOpenConns int
	DBMaxIdleConns int
	DBMaxLifetime  time.Duration

	// Redis
	RedisHost     string
	RedisPort     int
	RedisPassword string
	RedisDB       int

	// JWT
	JWTSecret          string
	JWTExpireTime      time.Duration
	JWTRefreshExpireTime time.Duration
	JWTIssuer          string
	JWTAudience        string

	// Security
	BCryptCost             int
	PasswordMinLength      int
	PasswordRequireUpper   bool
	PasswordRequireLower   bool
	PasswordRequireNumber  bool
	PasswordRequireSpecial bool
	MaxLoginAttempts       int
	LockoutDuration        time.Duration
	SessionExpireTime      time.Duration

	// 2FA
	TOTPIssuer     string
	TOTPSecretSize int

	// Rate Limiting
	RateLimitEnabled           bool
	RateLimitRequestsPerMinute int
	RateLimitBurst            int

	// Logging
	LogLevel      string
	LogFormat     string
	LogOutputPath string
}

func Load() *Config {
	return &Config{
		// Server
		ServerPort: getEnv("SERVER_PORT", "8080"),
		ServerHost: getEnv("SERVER_HOST", "0.0.0.0"),
		Mode:       getEnv("MODE", "development"),

		// Database
		DBHost:         getEnv("DB_HOST", "localhost"),
		DBPort:         getEnvAsInt("DB_PORT", 5432),
		DBUser:         getEnv("DB_USER", "tigerex"),
		DBPassword:     getEnv("DB_PASSWORD", "tigerex"),
		DBName:         getEnv("DB_NAME", "tigerex"),
		DBSSLMode:      getEnv("DB_SSL_MODE", "disable"),
		DBMaxOpenConns: getEnvAsInt("DB_MAX_OPEN_CONNS", 25),
		DBMaxIdleConns: getEnvAsInt("DB_MAX_IDLE_CONNS", 10),
		DBMaxLifetime:  getEnvAsDuration("DB_MAX_LIFETIME", 5*time.Minute),

		// Redis
		RedisHost:     getEnv("REDIS_HOST", "localhost"),
		RedisPort:     getEnvAsInt("REDIS_PORT", 6379),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getEnvAsInt("REDIS_DB", 0),

		// JWT
		JWTSecret:            getEnv("JWT_SECRET", "tigerex-jwt-secret-key-change-in-production"),
		JWTExpireTime:        getEnvAsDuration("JWT_EXPIRE_TIME", 15*time.Minute),
		JWTRefreshExpireTime: getEnvAsDuration("JWT_REFRESH_EXPIRE_TIME", 7*24*time.Hour),
		JWTIssuer:            getEnv("JWT_ISSUER", "tigerex"),
		JWTAudience:         getEnv("JWT_AUDIENCE", "tigerex"),

		// Security
		BCryptCost:            getEnvAsInt("BCRYPT_COST", 12),
		PasswordMinLength:     getEnvAsInt("PASSWORD_MIN_LENGTH", 8),
		PasswordRequireUpper:  getEnvAsBool("PASSWORD_REQUIRE_UPPER", true),
		PasswordRequireLower:  getEnvAsBool("PASSWORD_REQUIRE_LOWER", true),
		PasswordRequireNumber: getEnvAsBool("PASSWORD_REQUIRE_NUMBER", true),
		PasswordRequireSpecial: getEnvAsBool("PASSWORD_REQUIRE_SPECIAL", false),
		MaxLoginAttempts:      getEnvAsInt("MAX_LOGIN_ATTEMPTS", 5),
		LockoutDuration:       getEnvAsDuration("LOCKOUT_DURATION", 15*time.Minute),
		SessionExpireTime:     getEnvAsDuration("SESSION_EXPIRE_TIME", 24*time.Hour),

		// 2FA
		TOTPIssuer:     getEnv("TOTP_ISSUER", "TigerEx"),
		TOTPSecretSize: getEnvAsInt("TOTP_SECRET_SIZE", 32),

		// Rate Limiting
		RateLimitEnabled:           getEnvAsBool("RATE_LIMIT_ENABLED", true),
		RateLimitRequestsPerMinute: getEnvAsInt("RATE_LIMIT_REQUESTS_PER_MINUTE", 60),
		RateLimitBurst:            getEnvAsInt("RATE_LIMIT_BURST", 10),

		// Logging
		LogLevel:      getEnv("LOG_LEVEL", "info"),
		LogFormat:     getEnv("LOG_FORMAT", "json"),
		LogOutputPath: getEnv("LOG_OUTPUT_PATH", "stdout"),
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsBool(key string, defaultValue bool) bool {
	valueStr := getEnv(key, "")
	if value, err := strconv.ParseBool(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsDuration(key string, defaultValue time.Duration) string {
	return getEnv(key, defaultValue.String())
}
