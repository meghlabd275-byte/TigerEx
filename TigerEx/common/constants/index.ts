/**
 * Constants
 * 
 * Status codes, enums and constants
 */

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

// Order Status
export const ORDER_STATUS = {
  PENDING: 'pending',
  OPEN: 'open',
  FILLED: 'filled',
  PARTIALLY_FILLED: 'partially_filled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  REJECTED: 'rejected'
} as const;

// Order Side
export const ORDER_SIDE = {
  BUY: 'buy',
  SELL: 'sell'
} as const;

// Order Type
export const ORDER_TYPE = {
  MARKET: 'market',
  LIMIT: 'limit',
  STOP_MARKET: 'stop_market',
  STOP_LIMIT: 'stop_limit',
  TAKE_PROFIT: 'take_profit',
  TRAILING_STOP: 'trailing'
} as const;

// Order Time In Force
export const TIME_IN_FORCE = {
  GTC: 'good_till_cancel',
  IOC: 'immediate_or_cancel',
  FOK: 'fill_or_kill'
} as const;

// Transaction Type
export const TRANSACTION_TYPE = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  TRANSFER: 'transfer',
  TRADE_BUY: 'trade_buy',
  TRADE_SELL: 'trade_sell',
  FEE: 'fee',
  REBATE: 'rebate',
  DIVIDEND: 'dividend',
  INTEREST: 'interest'
} as const;

// Transaction Status
export const TRANSACTION_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

// Account Status
export const ACCOUNT_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  FROZEN: 'frozen',
  CLOSED: 'closed'
} as const;

// KYC Status
export const KYC_STATUS = {
  NOT_STARTED: 'not_started',
  PENDING: 'pending',
  REVIEW: 'review',
  APPROVED: 'approved',
  REJECTED: 'rejected'
} as const;

// Verification Level
export const VERIFICATION_LEVEL = {
  NONE: 0,
  EMAIL: 1,
  PHONE: 2,
  BASIC: 3,
  INTERMEDIATE: 4,
  ADVANCED: 5
} as const;

// Market Status
export const MARKET_STATUS = {
  PRE_OPEN: 'pre_open',
  OPEN: 'open',
  HALTED: 'halted',
  CLOSED: 'closed',
  AUCTION: 'auction'
} as const;

// Operation Type (for audit)
export const AUDIT_ACTION = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  VIEW: 'view',
  LOGIN: 'login',
  LOGOUT: 'logout',
  WITHDRAW: 'withdraw',
  DEPOSIT: 'deposit',
  TRANSFER: 'transfer',
  TRADE: 'trade',
  SETTINGS_CHANGE: 'settings_change',
  PASSWORD_CHANGE: 'password_change',
  API_KEY_CREATE: 'api_key_create',
  API_KEY_DELETE: 'api_key_delete'
} as const;

// Role Types
export const ROLE = {
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
  USER: 'user',
  TRADER: 'trader',
  BROKER: 'broker',
  MARKET_MAKER: 'market_maker',
  COMPLIANCE: 'compliance',
  SUPPORT: 'support',
  READONLY: 'readonly'
} as const;

// Fee Types
export const FEE_TYPE = {
  MAKER: 'maker',
  TAKER: 'taker',
  WITHDRAWAL: 'withdrawal',
  DEPOSIT: 'deposit',
  CONVERSION: 'conversion'
} as const;

// Leverage Options
export const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100] as const;

// Network Types
export const NETWORK = {
  BITCOIN: 'bitcoin',
  ETHEREUM: 'ethereum',
  BSC: 'bsc',
  SOLANA: 'solana',
  POLYGON: 'polygon',
  ARBITRUM: 'arbitrum',
  OPTIMISM: 'optimism',
  AVALANCHE: 'avalanche'
} as const;

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100
} as const;

// Rate Limits
export const RATE_LIMITS = {
  PUBLIC_API: 1200,      // 1200 requests/minute
  AUTHENTICATED_API: 600,  // 600 requests/minute
  TRADING_API: 100,       // 100 requests/minute
  WITHDRAWAL_API: 10     // 10 requests/minute
} as const;

// Order Book Limits
export const ORDER_BOOK = {
  MAX_ORDERS: 5000,
  MAX_PRICE_PRECISION: 8,
  MAX_QUANTITY_PRECISION: 8,
  MIN_NOTIONAL: 0.0001
} as const;

// Trading Limits
export const TRADING = {
  MIN_ORDER_VALUE: 1,           // USD
  MAX_ORDER_VALUE: 10000000,     // USD
  MAX_ORDERS_PER_SECOND: 100,
  MAX_POSITIONS: 100
} as const;

// Wallet Limits
export const WALLET = {
  MIN_DEPOSIT: 0.0001,
  MIN_WITHDRAWAL: 0.0001,
  DAILY_WITHDRAWAL_LIMIT: 10000000,
  MONTHLY_WITHDRAWAL_LIMIT: 50000000
} as const;

// Export all as const type
export type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];
export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];
export type OrderSide = typeof ORDER_SIDE[keyof typeof ORDER_SIDE];
export type OrderType = typeof ORDER_TYPE[keyof typeof ORDER_TYPE];
export type TimeInForce = typeof TIME_IN_FORCE[keyof typeof TIME_IN_FORCE];
export type TransactionType = typeof TRANSACTION_TYPE[keyof typeof TRANSACTION_TYPE];
export type TransactionStatus = typeof TRANSACTION_STATUS[keyof typeof TRANSACTION_STATUS];
export type AccountStatus = typeof ACCOUNT_STATUS[keyof typeof ACCOUNT_STATUS];
export type KycStatus = typeof KYC_STATUS[keyof typeof KYC_STATUS];
export type MarketStatus = typeof MARKET_STATUS[keyof typeof MARKET_STATUS];
export type AuditAction = typeof AUDIT_ACTION[keyof typeof AUDIT_ACTION];
export type Role = typeof ROLE[keyof typeof ROLE];
export type FeeType = typeof FEE_TYPE[keyof typeof FEE_TYPE];
export type Network = typeof NETWORK[keyof typeof NETWORK];