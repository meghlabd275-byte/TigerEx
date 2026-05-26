package common

// HTTP Status Codes
const (
	HTTP_OK            = 200
	HTTP_CREATED      = 201
	HTTP_ACCEPTED     = 202
	HTTP_NO_CONTENT   = 204
	HTTP_BAD_REQUEST = 400
	HTTP_UNAUTHORIZED = 401
	HTTP_FORBIDDEN   = 403
	HTTP_NOT_FOUND   = 404
	HTTP_CONFLICT   = 409
	HTTP_TOO_MANY   = 429
	HTTP_ERROR      = 500
	HTTP_UNAVAIL   = 503
)

// HTTP Status Codes Map
var HTTP_STATUS = map[string]int{
	"OK":             200,
	"CREATED":         201,
	"ACCEPTED":        202,
	"NO_CONTENT":      204,
	"BAD_REQUEST":     400,
	"UNAUTHORIZED":    401,
	"FORBIDDEN":      403,
	"NOT_FOUND":      404,
	"CONFLICT":      409,
	"TOO_MANY_REQ":   429,
	"INTERNAL_ERROR": 500,
	"UNAVAILABLE":   503,
}

// Order Status
var ORDER_STATUS = map[string]string{
	"PENDING":         "pending",
	"OPEN":           "open",
	"FILLED":         "filled",
	"PARTIALLY_FILLED": "partially_filled",
	"CANCELLED":      "cancelled",
	"EXPIRED":       "expired",
	"REJECTED":      "rejected",
}

// Order Side
var ORDER_SIDE = map[string]string{
	"BUY":  "buy",
	"SELL": "sell",
}

// Order Type
var ORDER_TYPE = map[string]string{
	"MARKET":       "market",
	"LIMIT":        "limit",
	"STOP_MARKET":  "stop_market",
	"STOP_LIMIT":   "stop_limit",
	"TAKE_PROFIT": "take_profit",
	"TRAILING":    "trailing",
}

// Order Time In Force
var TIME_IN_FORCE = map[string]string{
	"GTC": "good_till_cancel",
	"IOC": "immediate_or_cancel",
	"FOK": "fill_or_kill",
}

// Transaction Type
var TRANSACTION_TYPE = map[string]string{
	"DEPOSIT":    "deposit",
	"WITHDRAWAL":  "withdrawal",
	"TRANSFER":   "transfer",
	"TRADE_BUY": "trade_buy",
	"TRADE_SELL": "trade_sell",
	"FEE":      "fee",
	"REBATE":   "rebate",
	"DIVIDEND":  "dividend",
	"INTEREST":  "interest",
}

// Transaction Status
var TRANSACTION_STATUS = map[string]string{
	"PENDING":    "pending",
	"PROCESSING": "processing",
	"COMPLETED":  "completed",
	"FAILED":    "failed",
	"CANCELLED":  "cancelled",
}

// Account Status
var ACCOUNT_STATUS = map[string]string{
	"PENDING":   "pending",
	"ACTIVE":   "active",
	"SUSPENDED": "suspended",
	"FROZEN":    "frozen",
	"CLOSED":   "closed",
}

// KYC Status
var KYC_STATUS = map[string]string{
	"NOT_STARTED": "not_started",
	"PENDING":    "pending",
	"REVIEW":     "review",
	"APPROVED":   "approved",
	"REJECTED":   "rejected",
}

// Verification Level
var VERIFICATION_LEVEL = map[string]int{
	"NONE":         0,
	"EMAIL":        1,
	"PHONE":       2,
	"BASIC":        3,
	"INTERMEDIATE": 4,
	"ADVANCED":     5,
}

// Market Status
var MARKET_STATUS = map[string]string{
	"PRE_OPEN": "pre_open",
	"OPEN":    "open",
	"HALTED":   "halted",
	"CLOSED":  "closed",
	"AUCTION": "auction",
}

// Audit Action
var AUDIT_ACTION = map[string]string{
	"CREATE":           "create",
	"UPDATE":           "update",
	"DELETE":           "delete",
	"VIEW":            "view",
	"LOGIN":           "login",
	"LOGOUT":          "logout",
	"WITHDRAW":        "withdraw",
	"DEPOSIT":         "deposit",
	"TRANSFER":         "transfer",
	"TRADE":           "trade",
	"SETTINGS_CHANGE":  "settings_change",
	"PASSWORD_CHANGE": "password_change",
	"API_KEY_CREATE":  "api_key_create",
	"API_KEY_DELETE":  "api_key_delete",
}

// Role Types
var ROLE = map[string]string{
	"ADMIN":        "admin",
	"SUPER_ADMIN":   "super_admin",
	"USER":        "user",
	"TRADER":      "trader",
	"BROKER":      "broker",
	"MARKET_MAKER": "market_maker",
	"COMPLIANCE":   "compliance",
	"SUPPORT":     "support",
	"READONLY":    "readonly",
}

// Fee Types
var FEE_TYPE = map[string]string{
	"MAKER":     "maker",
	"TAKER":     "taker",
	"WITHDRAWAL": "withdrawal",
	"DEPOSIT":   "deposit",
	"CONVERSION": "conversion",
}

// Leverage Options
var LEVERAGE_OPTIONS = []int{1, 2, 3, 5, 10, 20, 25, 50, 75, 100}

// Network Types
var NETWORK = map[string]string{
	"BITCOIN":   "bitcoin",
	"ETHEREUM":  "ethereum",
	"BSC":       "bsc",
	"SOLANA":    "solana",
	"POLYGON":   "polygon",
	"ARBITRUM":  "arbitrum",
	"OPTIMISM":  "optimism",
	"AVALANCHE": "avalanche",
}

// Pagination Defaults
var PAGINATION = map[string]int{
	"DEFAULT_PAGE": 1,
	"DEFAULT_LIMIT": 20,
	"MAX_LIMIT":   100,
}

// Rate Limits (per minute)
var RATE_LIMITS = map[string]int{
	"PUBLIC_API":       1200,
	"AUTHENTICATED_API": 600,
	"TRADING_API":     100,
	"WITHDRAWAL_API":  10,
}

// Order Book Limits
var ORDER_BOOK = map[string]interface{}{
	"MAX_ORDERS":       5000,
	"MAX_PRICE_PRECISION": 8,
	"MAX_QTY_PRECISION":  8,
	"MIN_NOTIONAL":     0.0001,
}

// Trading Limits
var TRADING = map[string]interface{}{
	"MIN_ORDER_VALUE":    1.0,
	"MAX_ORDER_VALUE":  10000000.0,
	"MAX_ORDERS_PER_SEC": 100,
	"MAX_POSITIONS":     100,
}

// Wallet Limits
var WALLET = map[string]interface{}{
	"MIN_DEPOSIT":            0.0001,
	"MIN_WITHDRAWAL":         0.0001,
	"DAILY_WITHDRAWAL_LIMIT": 10000000.0,
	"MONTHLY_LIMIT":          50000000.0,
}

// Type aliases for type safety
type HttpStatus int
type OrderStatus string
type OrderSide string
type OrderType string
type TimeInForce string
type TransactionType string
type TransactionStatus string
type AccountStatus string
type KycStatus string
type MarketStatus string
type AuditAction string
type Role string
type FeeType string
type Network string