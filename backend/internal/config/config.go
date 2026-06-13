package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	ServerPort  string
	EnableTLS   bool
	TLSCertPath string
	TLSKeyPath  string

	DatabaseURL        string
	DatabaseMaxConns   int
	DatabaseMaxIdle    int
	DatabaseConnTimeout time.Duration

	RedisURL      string
	RedisPassword string
	RedisDB       int

	JWTSecret        string
	JWTExpiration    time.Duration
	JWTRefreshExpiry time.Duration

	SecurityConfig     SecurityConfig
	CryptoConfig      CryptoConfig
	RateLimitRequests int
	RateLimitWindow   time.Duration

	AuthConfig     AuthConfig
	KYCConfig      KYCConfig
	WalletConfig   WalletConfig
	MatchingConfig MatchingConfig
	TradingConfig  TradingConfig
}

type SecurityConfig struct {
	Enable2FA            bool
	MaxLoginAttempts    int
	LockoutDuration     time.Duration
	PasswordMinLength   int
	PasswordRequireUpper bool
	PasswordRequireLower bool
	PasswordRequireNumber bool
	PasswordRequireSpecial bool
	SessionTimeout       time.Duration
	EnableIPWhitelist    bool
	EnableAntiPhishing  bool
	CSRFEnabled         bool
	CORSAllowedOrigins  []string
	RateLimitEnabled    bool
	RateLimitBurst      int
	RateLimitRefill     int
}

type CryptoConfig struct {
	EncryptionKeyPath    string
	SigningKeyPath     string
	HashAlgorithm      string
	AESKeySize         int
	RSAKeySize         int
	UseHardwareSecurity bool
	HSMEnabled         bool
	HSMConfig          string
}

type AuthConfig struct {
	EmailRequired       bool
	PhoneRequired       bool
	EnableSocialLogin   bool
	EnablePasswordless  bool
	EnablePasskeys     bool
	EnableBiometrics   bool
	SocialProviders    []string
	OAuthClientID      string
	OAuthClientSecret  string
	MetaMaskEnabled    bool
	TelegramEnabled    bool
}

type KYCConfig struct {
	EnableKYC            bool
	RequireKYCWithdraw  bool
	RequireKYCDeposit   bool
	EnableLivenessCheck bool
	EnableVideoKYC      bool
	AMLEnabled           bool
	SanctionsCheckEnabled bool
	MinAge              int
	AllowedCountries    []string
	MaxRetryAttempts   int
	ReviewQueueEnabled  bool
}

type WalletConfig struct {
	EnableWallet         bool
	HotWalletThreshold   float64
	ColdWalletThreshold  float64
	AutoReplenish       bool
	MultiSigEnabled     bool
	MPCEnabled          bool
	HardwareWalletEnabled bool
	SupportedChains     []string
	FeeConfig           map[string]float64
	MinWithdrawAmount   map[string]float64
}

type MatchingConfig struct {
	OrderBookDepth     int
	MaxOrdersPerPair  int
	MaxPriceDeviation float64
	PricePrecision     int
	QuantityPrecision  int
	LatencyTarget     time.Duration
	EngineType         string
	EnableMatch        bool
}

type TradingConfig struct {
	EnableSpot          bool
	EnableFutures      bool
	EnableMargin       bool
	EnableOptions      bool
	MaxLeverage        int
	DefaultLeverage    int
	MaxOrderValue     float64
	MaxOpenOrders     int
	EnableStopLoss    bool
	EnableTakeProfit  bool
	EnableOCO         bool
	EnableTrailingStop bool
	EnableGridTrading  bool
	EnableCopyTrading  bool
}

func Load() *Config {
	return &Config{
		ServerPort:         getEnv("SERVER_PORT", "8443"),
		EnableTLS:          getEnvBool("ENABLE_TLS", true),
		TLSCertPath:        getEnv("TLS_CERT_PATH", "/etc/tigerex/tls/cert.pem"),
		TLSKeyPath:         getEnv("TLS_KEY_PATH", "/etc/tigerex/tls/key.pem"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://tigerex:password@localhost:5432/tigerex?sslmode=require"),
		DatabaseMaxConns:   getEnvInt("DB_MAX_CONNS", 100),
		DatabaseMaxIdle:    getEnvInt("DB_MAX_IDLE", 10),
		DatabaseConnTimeout: getEnvDuration("DB_CONN_TIMEOUT", 30*time.Second),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		RedisPassword:      getEnv("REDIS_PASSWORD", ""),
		RedisDB:            getEnvInt("REDIS_DB", 0),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		JWTExpiration:       getEnvDuration("JWT_EXPIRY", 15*time.Minute),
		JWTRefreshExpiry:   getEnvDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour),
		SecurityConfig: SecurityConfig{
			Enable2FA:            getEnvBool("ENABLE_2FA", true),
			MaxLoginAttempts:     getEnvInt("MAX_LOGIN_ATTEMPTS", 5),
			LockoutDuration:      getEnvDuration("LOCKOUT_DURATION", 48*time.Hour),
			PasswordMinLength:    getEnvInt("PASSWORD_MIN_LENGTH", 8),
			PasswordRequireUpper:  getEnvBool("PASSWORD_REQUIRE_UPPER", true),
			PasswordRequireLower:  getEnvBool("PASSWORD_REQUIRE_LOWER", true),
			PasswordRequireNumber: getEnvBool("PASSWORD_REQUIRE_NUMBER", true),
			PasswordRequireSpecial: getEnvBool("PASSWORD_REQUIRE_SPECIAL", true),
			SessionTimeout:       getEnvDuration("SESSION_TIMEOUT", 24*time.Hour),
			EnableIPWhitelist:    getEnvBool("ENABLE_IP_WHITELIST", false),
			EnableAntiPhishing:   getEnvBool("ENABLE_ANTI_PHISHING", true),
			CSRFEnabled:         getEnvBool("CSRF_ENABLED", true),
			RateLimitEnabled:     getEnvBool("RATE_LIMIT_ENABLED", true),
		},
		CryptoConfig: CryptoConfig{
			EncryptionKeyPath: getEnv("ENCRYPTION_KEY_PATH", "/etc/tigerex/keys/encryption.key"),
			SigningKeyPath:   getEnv("SIGNING_KEY_PATH", "/etc/tigerex/keys/signing.key"),
			HashAlgorithm:   getEnv("HASH_ALGORITHM", "argon2"),
			AESKeySize:      getEnvInt("AES_KEY_SIZE", 256),
			RSAKeySize:      getEnvInt("RSA_KEY_SIZE", 4096),
			UseHardwareSecurity: getEnvBool("USE_HSM", true),
			HSMEnabled:       getEnvBool("HSM_ENABLED", true),
		},
		AuthConfig: AuthConfig{
			EmailRequired:     getEnvBool("EMAIL_REQUIRED", true),
			PhoneRequired:   getEnvBool("PHONE_REQUIRED", true),
			EnableSocialLogin: getEnvBool("ENABLE_SOCIAL_LOGIN", true),
			EnablePasswordless: getEnvBool("ENABLE_PASSWORDLESS", true),
			EnablePasskeys:   getEnvBool("ENABLE_PASSKEYS", true),
			EnableBiometrics: getEnvBool("ENABLE_BIOMETRICS", true),
			MetaMaskEnabled:  getEnvBool("METAMASK_ENABLED", true),
			TelegramEnabled:  getEnvBool("TELEGRAM_ENABLED", true),
		},
		KYCConfig: KYCConfig{
			EnableKYC:             getEnvBool("ENABLE_KYC", true),
			RequireKYCWithdraw:    getEnvBool("REQUIRE_KYC_WITHDRAW", true),
			RequireKYCDeposit:    getEnvBool("REQUIRE_KYC_DEPOSIT", false),
			EnableLivenessCheck:   getEnvBool("ENABLE_LIVENESS_CHECK", true),
			EnableVideoKYC:       getEnvBool("ENABLE_VIDEO_KYC", true),
			AMLEnabled:            getEnvBool("AML_ENABLED", true),
			SanctionsCheckEnabled: getEnvBool("SANCTIONS_CHECK_ENABLED", true),
		},
		WalletConfig: WalletConfig{
			EnableWallet:         getEnvBool("ENABLE_WALLET", true),
			HotWalletThreshold:   getEnvFloat("HOT_WALLET_THRESHOLD", 1000000),
			ColdWalletThreshold:  getEnvFloat("COLD_WALLET_THRESHOLD", 10000000),
			AutoReplenish:        getEnvBool("AUTO_REPLENISH", true),
			MultiSigEnabled:     getEnvBool("MULTISIG_ENABLED", true),
			MPCEnabled:          getEnvBool("MPC_ENABLED", true),
			HardwareWalletEnabled: getEnvBool("HW_ENABLED", true),
		},
		MatchingConfig: MatchingConfig{
			OrderBookDepth:    getEnvInt("ORDERBOOK_DEPTH", 1000),
			MaxOrdersPerPair: getEnvInt("MAX_ORDERS_PER_PAIR", 100000),
			PricePrecision:   getEnvInt("PRICE_PRECISION", 8),
			QuantityPrecision: getEnvInt("QTY_PRECISION", 8),
			LatencyTarget:    getEnvDuration("LATENCY_TARGET", 100*time.Microsecond),
			EngineType:      getEnv("ENGINE_TYPE", "memory"),
			EnableMatch:     getEnvBool("ENABLE_MATCH", true),
		},
		TradingConfig: TradingConfig{
			EnableSpot:         getEnvBool("ENABLE_SPOT", true),
			EnableFutures:     getEnvBool("ENABLE_FUTURES", true),
			EnableMargin:      getEnvBool("ENABLE_MARGIN", true),
			EnableOptions:     getEnvBool("ENABLE_OPTIONS", true),
			MaxLeverage:       getEnvInt("MAX_LEVERAGE", 125),
			DefaultLeverage:   getEnvInt("DEFAULT_LEVERAGE", 10),
			EnableStopLoss:    getEnvBool("ENABLE_STOP_LOSS", true),
			EnableTakeProfit:  getEnvBool("ENABLE_TAKE_PROFIT", true),
			EnableOCO:         getEnvBool("ENABLE_OCO", true),
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
