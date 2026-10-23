package config

import (
"os"
"strconv"
"time"

"tigerex/backend/internal/auth"
"tigerex/backend/internal/kyc"
"tigerex/backend/internal/matching"
"tigerex/backend/internal/security"
"tigerex/backend/internal/trading"
"tigerex/backend/internal/wallet"
"tigerex/backend/pkg/crypto"
)

// The per-service configuration structs are declared next to the code that
// consumes them. They are aliased here rather than duplicated so that a field
// can never drift between the loader and the service that reads it.
type (
SecurityConfig = security.SecurityConfig
CryptoConfig   = crypto.CryptoConfig
AuthConfig     = auth.AuthConfig
KYCConfig      = kyc.KYCConfig
WalletConfig   = wallet.WalletConfig
MatchingConfig = matching.MatchingConfig
TradingConfig  = trading.TradingConfig
)

type Config struct {
ServerPort  string
EnableTLS   bool
TLSCertPath string
TLSKeyPath  string

DatabaseURL         string
DatabaseMaxConns    int
DatabaseMaxIdle     int
DatabaseConnTimeout time.Duration

RedisURL      string
RedisPassword string
RedisDB       int

JWTSecret        string
JWTExpiration    time.Duration
JWTRefreshExpiry time.Duration

SecurityConfig     SecurityConfig
CryptoConfig       CryptoConfig
RateLimitRequests  int
RateLimitWindow    time.Duration

AuthConfig     AuthConfig
KYCConfig      KYCConfig
WalletConfig   WalletConfig
MatchingConfig MatchingConfig
TradingConfig  TradingConfig
}

func Load() *Config {
return &Config{
ServerPort:          getEnv("SERVER_PORT", "8443"),
EnableTLS:           getEnvBool("ENABLE_TLS", true),
TLSCertPath:         getEnv("TLS_CERT_PATH", "/etc/tigerex/tls/cert.pem"),
TLSKeyPath:          getEnv("TLS_KEY_PATH", "/etc/tigerex/tls/key.pem"),
DatabaseURL:         getEnv("DATABASE_URL", "postgres://tigerex:password@localhost:5432/tigerex?sslmode=require"),
DatabaseMaxConns:    getEnvInt("DB_MAX_CONNS", 100),
DatabaseMaxIdle:     getEnvInt("DB_MAX_IDLE", 10),
DatabaseConnTimeout: getEnvDuration("DB_CONN_TIMEOUT", 30*time.Second),
RedisURL:            getEnv("REDIS_URL", "redis://localhost:6379"),
RedisPassword:       getEnv("REDIS_PASSWORD", ""),
RedisDB:             getEnvInt("REDIS_DB", 0),
JWTSecret:           getEnv("JWT_SECRET", ""),
JWTExpiration:       getEnvDuration("JWT_EXPIRY", 15*time.Minute),
JWTRefreshExpiry:    getEnvDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour),
RateLimitRequests:   getEnvInt("RATE_LIMIT_REQUESTS", 1200),
RateLimitWindow:     getEnvDuration("RATE_LIMIT_WINDOW", time.Minute),
SecurityConfig: SecurityConfig{
Enable2FA:           getEnvBool("ENABLE_2FA", true),
MaxLoginAttempts:    getEnvInt("MAX_LOGIN_ATTEMPTS", 5),
LockoutDuration:     getEnvDuration("LOCKOUT_DURATION", 48*time.Hour),
PasswordMinLength:   getEnvInt("PASSWORD_MIN_LENGTH", 8),
SessionTimeout:      getEnvDuration("SESSION_TIMEOUT", 24*time.Hour),
EnableIPWhitelist:   getEnvBool("ENABLE_IP_WHITELIST", false),
EnableAntiPhishing:  getEnvBool("ENABLE_ANTI_PHISHING", true),
CSRFEnabled:         getEnvBool("CSRF_ENABLED", true),
RateLimitEnabled:    getEnvBool("RATE_LIMIT_ENABLED", true),
RateLimitBurst:      getEnvInt("RATE_LIMIT_BURST", 100),
RateLimitRefill:     getEnvInt("RATE_LIMIT_REFILL", 10),
},
CryptoConfig: CryptoConfig{
EncryptionKeyPath: getEnv("ENCRYPTION_KEY_PATH", "/etc/tigerex/keys/encryption.key"),
SigningKeyPath:    getEnv("SIGNING_KEY_PATH", "/etc/tigerex/keys/signing.key"),
HashAlgorithm:     getEnv("HASH_ALGORITHM", "argon2"),
AESKeySize:        getEnvInt("AES_KEY_SIZE", 256),
RSAKeySize:        getEnvInt("RSA_KEY_SIZE", 4096),
UseHSM:            getEnvBool("USE_HSM", true),
},
AuthConfig: AuthConfig{
JWTExpiry:          getEnvDuration("JWT_EXPIRY", 15*time.Minute),
JWTRefreshExpiry:   getEnvDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour),
MaxSessionsPerUser: getEnvInt("MAX_SESSIONS_PER_USER", 5),
Enable2FA:          getEnvBool("ENABLE_2FA", true),
EnableSocialLogin:  getEnvBool("ENABLE_SOCIAL_LOGIN", true),
EnablePasskeys:     getEnvBool("ENABLE_PASSKEYS", true),
EnableBiometrics:   getEnvBool("ENABLE_BIOMETRICS", true),
},
KYCConfig: KYCConfig{
EnableKYC:           getEnvBool("ENABLE_KYC", true),
RequireKYCWithdraw:  getEnvBool("REQUIRE_KYC_WITHDRAW", true),
EnableLivenessCheck: getEnvBool("ENABLE_LIVENESS_CHECK", true),
EnableVideoKYC:      getEnvBool("ENABLE_VIDEO_KYC", true),
AMLEnabled:          getEnvBool("AML_ENABLED", true),
},
WalletConfig: WalletConfig{
HotWalletThreshold:  getEnvFloat("HOT_WALLET_THRESHOLD", 1000000),
ColdWalletThreshold: getEnvFloat("COLD_WALLET_THRESHOLD", 10000000),
AutoReplenish:       getEnvBool("AUTO_REPLENISH", true),
},
MatchingConfig: MatchingConfig{
OrderBookDepth:   getEnvInt("ORDERBOOK_DEPTH", 1000),
MaxOrdersPerPair: getEnvInt("MAX_ORDERS_PER_PAIR", 100000),
PricePrecision:   getEnvInt("PRICE_PRECISION", 8),
LatencyTarget:    getEnvDuration("LATENCY_TARGET", 100*time.Microsecond),
EngineType:       getEnv("ENGINE_TYPE", "memory"),
},
TradingConfig: TradingConfig{
EnableSpot:         getEnvBool("ENABLE_SPOT", true),
EnableFutures:      getEnvBool("ENABLE_FUTURES", true),
EnableMargin:       getEnvBool("ENABLE_MARGIN", true),
EnableOptions:      getEnvBool("ENABLE_OPTIONS", true),
MaxLeverage:        getEnvInt("MAX_LEVERAGE", 125),
DefaultLeverage:    getEnvInt("DEFAULT_LEVERAGE", 10),
MaxOrderValue:      getEnvFloat("MAX_ORDER_VALUE", 10000000),
MaxOpenOrders:      getEnvInt("MAX_OPEN_ORDERS", 1000),
EnableStopLoss:     getEnvBool("ENABLE_STOP_LOSS", true),
EnableTakeProfit:   getEnvBool("ENABLE_TAKE_PROFIT", true),
EnableOCO:          getEnvBool("ENABLE_OCO", true),
EnableTrailingStop: getEnvBool("ENABLE_TRAILING_STOP", true),
EnableGridTrading:  getEnvBool("ENABLE_GRID_TRADING", true),
EnableCopyTrading:  getEnvBool("ENABLE_COPY_TRADING", true),
},
}
}

func getEnv(key, defaultValue string) string {
if value := os.Getenv(key); value != "" {
return value
}
return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
if value := os.Getenv(key); value != "" {
return value == "true" || value == "1"
}
return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
if value := os.Getenv(key); value != "" {
if intValue, err := strconv.Atoi(value); err == nil {
return intValue
}
}
return defaultValue
}

func getEnvFloat(key string, defaultValue float64) float64 {
if value := os.Getenv(key); value != "" {
if floatValue, err := strconv.ParseFloat(value, 64); err == nil {
return floatValue
}
}
return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
if value := os.Getenv(key); value != "" {
if duration, err := time.ParseDuration(value); err == nil {
return duration
}
}
return defaultValue
}
