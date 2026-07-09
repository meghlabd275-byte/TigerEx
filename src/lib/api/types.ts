/**
 * TigerEx TypeScript Types
 * Type definitions for API responses and data models
 */

// Generic API Response
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

// Paginated Response
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// User Types
export interface User {
  id: string;
  email: string;
  username: string;
  kyc_level: KYCLevel;
  status: UserStatus;
  country: string;
  created_at: string;
  email_verified: boolean;
  phone_verified: boolean;
  two_factor_enabled: boolean;
}

export type KYCLevel = 'none' | 'basic' | 'intermediate' | 'full' | 'institution';
export type UserStatus = 'pending' | 'active' | 'suspended' | 'banned' | 'closed';

export interface LoginRequest {
  email: string;
  password: string;
  otp?: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  require_otp?: boolean;
  user_id?: string;
  user?: User;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  country?: string;
  referral_code?: string;
}

export interface RegisterResponse {
  user_id: string;
  email: string;
  username: string;
  referral_code: string;
  verification_token?: string;
}

// Wallet Types
export interface Wallet {
  id: string;
  user_id: string;
  currency: string;
  balance: string;
  locked_balance: string;
  available_balance: string;
  wallet_type: WalletType;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
  updated_at: string;
}

export type WalletType = 'trading' | 'hot' | 'cold' | 'institutional';

export interface DepositAddress {
  id: string;
  wallet_id: string;
  address: string;
  address_tag?: string;
  network: string;
  is_primary: boolean;
  created_at: string;
}

export interface WithdrawalRequest {
  currency: string;
  network: string;
  address: string;
  address_tag?: string;
  amount: string;
  fee?: string;
}

export interface TransferRequest {
  from_wallet_type: WalletType;
  to_wallet_type: WalletType;
  currency: string;
  amount: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  wallet_id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  fee: string;
  net_amount: string;
  currency: string;
  tx_hash?: string;
  address?: string;
  network?: string;
  confirmations?: number;
  created_at: string;
  completed_at?: string;
}

export type TransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'trade' | 'fee' | 'reward' | 'bonus' | 'adjustment';
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

// Market Types
export interface Market {
  id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  status: MarketStatus;
  price_precision: number;
  quantity_precision: number;
  min_price?: string;
  max_price?: string;
  tick_size?: string;
  min_quantity?: string;
  max_quantity?: string;
  min_notional?: string;
  maker_fee: string;
  taker_fee: string;
  listed_at?: string;
}

export type MarketStatus = 'pending' | 'online' | 'suspended' | 'delisted';

export interface Ticker {
  symbol: string;
  last_price: string;
  price_change: string;
  price_change_percent: string;
  high_24h: string;
  low_24h: string;
  volume_24h: string;
  quote_volume_24h: string;
  trades_24h: number;
  updated_at: string;
}

export interface OrderBook {
  symbol: string;
  bids: [string, string][];  // [price, quantity]
  asks: [string, string][];
  timestamp: number;
  sequence: number;
}

export interface Trade {
  id: string;
  order_id: string;
  market_id: string;
  maker_order_id: string;
  taker_order_id: string;
  maker_id: string;
  taker_id: string;
  side: OrderSide;
  price: string;
  quantity: string;
  maker_fee: string;
  taker_fee: string;
  created_at: string;
}

export interface KLine {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quote_volume: string;
  trades: number;
}

// Order Types
export interface Order {
  id: string;
  order_uuid: string;
  user_id: string;
  market_id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  price?: string;
  stop_price?: string;
  quantity: string;
  filled_quantity: string;
  remaining_quantity: string;
  avg_fill_price?: string;
  status: OrderStatus;
  client_order_id?: string;
  created_at: string;
  updated_at: string;
  executed_at?: string;
  canceled_at?: string;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop_loss' | 'stop_limit' | 'take_profit' | 'trailing_stop' | 'oco' | 'iceberg' | 'twap' | 'post_only' | 'fok' | 'ioc';
export type OrderStatus = 'pending_new' | 'new' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired' | 'pending_cancel' | 'pending_modify';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'GTT';

// Create Order Request
export interface CreateOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;
  stop_price?: string;
  time_in_force?: TimeInForce;
  client_order_id?: string;
  iceberg_quantity?: string;
}

// Margin Trading Types
export interface MarginAccount {
  id: string;
  user_id: string;
  market_id: string;
  position_mode: PositionMode;
  leverage: number;
  margin_balance: string;
  reserved_margin: string;
  unrealized_pnl: string;
  realized_pnl: string;
  liquidation_price?: string;
  updated_at: string;
}

export type PositionMode = 'isolated' | 'cross' | 'leverage';

export interface Position {
  id: string;
  user_id: string;
  market_id: string;
  symbol: string;
  side: OrderSide;
  quantity: string;
  entry_price: string;
  mark_price?: string;
  leverage: number;
  unrealized_pnl: string;
  realized_pnl: string;
  liquidation_price?: string;
  margin_used: string;
  take_profit_price?: string;
  stop_loss_price?: string;
  created_at: string;
  updated_at: string;
}

// Staking Types
export interface StakingProduct {
  id: string;
  currency: string;
  product_name: string;
  product_type: string;
  apy: string;
  min_stake: string;
  max_stake?: string;
  lock_period_days?: number;
  early_unstaking_enabled: boolean;
  early_unstaking_penalty?: string;
  status: string;
}

export interface StakingPosition {
  id: string;
  user_id: string;
  product_id: string;
  amount: string;
  claimed_rewards: string;
  start_date: string;
  unlock_date?: string;
  status: string;
}

// P2P Types
export interface P2PAdvertisement {
  id: string;
  user_id: string;
  side: OrderSide;
  currency: string;
  fiat_currency: string;
  price_type: 'fixed' | 'floating';
  price_offset: string;
  min_amount: string;
  max_amount: string;
  payment_methods: string[];
  terms?: string;
  status: string;
  created_at: string;
}

export interface P2POrder {
  id: string;
  advertisement_id: string;
  maker_id: string;
  taker_id: string;
  side: OrderSide;
  currency: string;
  fiat_currency: string;
  amount: string;
  price: string;
  total_amount: string;
  status: P2POrderStatus;
  maker_payment_method?: string;
  taker_payment_method?: string;
  created_at: string;
  updated_at: string;
}

export type P2POrderStatus = 
  | 'pending' 
  | 'waiting_payment' 
  | 'paid' 
  | 'released' 
  | 'disputed' 
  | 'canceled' 
  | 'expired';

// Earn/Savings Types
export interface SavingsProduct {
  id: string;
  currency: string;
  product_name: string;
  product_type: string;
  apy: string;
  min_amount: string;
  max_amount?: string;
  term_days?: number;
  auto_renew: boolean;
  status: string;
}

export interface SavingsPosition {
  id: string;
  user_id: string;
  product_id: string;
  amount: string;
  interest_earned: string;
  start_date: string;
  maturity_date?: string;
  status: string;
}

// Notification Types
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  created_at: string;
}

// API Key Types
export interface APIKey {
  id: string;
  user_id: string;
  name: string;
  permissions: string[];
  ip_whitelist?: string[];
  enabled: boolean;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

// Fee Tiers
export interface FeeTier {
  id: string;
  tier_name: string;
  tier_level: number;
  maker_fee: string;
  taker_fee: string;
  min_volume_30d: string;
  min_holdings: string;
}

export interface UserFeeTier {
  tier: FeeTier;
  effective_from: string;
  expires_at?: string;
}
