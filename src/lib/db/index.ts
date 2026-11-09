/**
 * TigerEx Database Module
 * Production-grade SQLite database layer for development
 * In production, replace with PostgreSQL using pgxpool
 */

import Database from 'better-sqlite3';
import { randomBytes, randomInt, createHash, createCipheriv, createDecipheriv } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = process.env.DB_PATH || './tigerex.db';

let db: Database.Database | null = null;

// Encryption key is required at the point of use. Never silently fall back to a public default.
function getEncryptionKey(): Buffer {
  const configuredKey = process.env.ENCRYPTION_KEY;
  if (!configuredKey || configuredKey.length < 32) {
    throw new Error('ENCRYPTION_KEY must be configured with at least 32 characters before encrypted data can be used');
  }
  return createHash('sha256').update(configuredKey, 'utf8').digest();
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  const database = db!;
  
  // Enable UUID extension
  database.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      username TEXT UNIQUE,
      display_name TEXT,
      country_code TEXT,
      timezone TEXT DEFAULT 'UTC',
      language TEXT DEFAULT 'en',
      
      -- KYC
      kyc_level TEXT DEFAULT 'none',
      kyc_status TEXT DEFAULT 'pending',
      kyc_submitted_at TEXT,
      kyc_verified_at TEXT,
      kyc_rejected_at TEXT,
      kyc_rejection_reason TEXT,
      
      -- Security
      two_factor_enabled INTEGER DEFAULT 0,
      two_factor_secret TEXT,
      two_factor_type TEXT DEFAULT 'totp',
      anti_phishing_code TEXT,
      
      -- Status
      status TEXT DEFAULT 'active',
      failed_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT,
      email_verified INTEGER DEFAULT 0,
      phone_verified INTEGER DEFAULT 0,

      -- Referral program
      referral_code TEXT UNIQUE,
      referred_by TEXT
    );

    -- User wallets
    CREATE TABLE IF NOT EXISTS wallets (
      wallet_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      network TEXT NOT NULL,
      address TEXT,
      memo TEXT,
      address_index TEXT,
      public_key TEXT,
      is_default INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Wallet balances
    CREATE TABLE IF NOT EXISTS balances (
      balance_id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      available REAL DEFAULT 0,
      locked REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE CASCADE,
      UNIQUE(wallet_id, currency)
    );

    -- Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      ip_address TEXT,
      user_agent TEXT,
      device_id TEXT,
      trusted INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_active_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- OTP codes
    CREATE TABLE IF NOT EXISTS otp_codes (
      otp_id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT,
      phone TEXT,
      code TEXT NOT NULL,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Pending second-factor login challenges.
    -- A password-correct login with 2FA enabled stores an opaque, single-use
    -- token here (digest only) instead of in the sessions table, so the token
    -- can never be used as a bearer credential before the second factor.
    CREATE TABLE IF NOT EXISTS login_challenges (
      challenge_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 5,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Login attempts tracking
    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT,
      phone TEXT,
      ip_address TEXT,
      success INTEGER DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Password reset tokens
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Trading pairs
    CREATE TABLE IF NOT EXISTS trading_pairs (
      pair_id TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      symbol TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active',
      min_price REAL,
      max_price REAL,
      tick_size REAL,
      min_quantity REAL,
      max_quantity REAL,
      min_notional REAL,
      maker_fee REAL DEFAULT 0.001,
      taker_fee REAL DEFAULT 0.001,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Orders
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pair_id TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL,
      quantity REAL,
      filled_quantity REAL DEFAULT 0,
      remaining_quantity REAL,
      average_price REAL,
      status TEXT DEFAULT 'pending',
      time_in_force TEXT DEFAULT 'GTC',
      stop_price REAL,
      iceberg_quantity REAL,
      hidden_quantity REAL DEFAULT 0,
      locked_amount REAL DEFAULT 0,
      locked_asset TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (pair_id) REFERENCES trading_pairs(pair_id) ON DELETE CASCADE
    );

    -- Order history
    CREATE TABLE IF NOT EXISTS order_history (
      history_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      pair_id TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL,
      quantity REAL,
      filled_quantity REAL,
      average_price REAL,
      fee REAL,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
    );

    -- Transactions
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_id TEXT,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      tx_hash TEXT,
      address TEXT,
      memo TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE SET NULL
    );

    -- Deposits
    CREATE TABLE IF NOT EXISTS deposits (
      deposit_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_id TEXT,
      currency TEXT NOT NULL,
      network TEXT NOT NULL,
      amount REAL NOT NULL,
      tx_hash TEXT,
      address TEXT,
      confirmations INTEGER DEFAULT 0,
      required_confirmations INTEGER DEFAULT 6,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      credited_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE SET NULL
    );

    -- Withdrawals
    CREATE TABLE IF NOT EXISTS withdrawals (
      withdrawal_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_id TEXT,
      currency TEXT NOT NULL,
      network TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      address TEXT NOT NULL,
      memo TEXT,
      tx_hash TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE SET NULL
    );

    -- API keys
    CREATE TABLE IF NOT EXISTS api_keys (
      key_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      permissions TEXT,
      ip_whitelist TEXT,
      enabled INTEGER DEFAULT 1,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Sign-in IP allowlist entries. One row per CIDR or single address the
    -- account trusts; the flag on the users table decides whether it is enforced.
    CREATE TABLE IF NOT EXISTS user_ip_allowlist (
      entry_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cidr TEXT NOT NULL,
      label TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, cidr),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_ip_allowlist_user ON user_ip_allowlist(user_id);

    -- Deposit network configuration. Which asset may be deposited on which
    -- chain, and the minimum and confirmation policy for it, is operator
    -- configuration rather than a built-in list; the deposit view reads it and
    -- an address is only issued for an asset/network listed active here.
    CREATE TABLE IF NOT EXISTS deposit_networks (
      network_id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      display_name TEXT NOT NULL,
      min_deposit REAL NOT NULL,
      confirmations INTEGER NOT NULL,
      memo_required INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(asset, network)
    );
    CREATE INDEX IF NOT EXISTS idx_deposit_networks_asset ON deposit_networks(asset);

    -- KYC documents
    CREATE TABLE IF NOT EXISTS kyc_documents (
      document_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_number TEXT,
      front_image TEXT,
      back_image TEXT,
      selfie_image TEXT,
      status TEXT DEFAULT 'pending',
      reviewed_at TEXT,
      reviewer_id TEXT,
      rejection_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Social logins
    CREATE TABLE IF NOT EXISTS social_logins (
      social_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      UNIQUE(provider, provider_user_id)
    );

    -- Single-use codes exchanged for session tokens after a social sign-in.
    -- The access token is never placed in a redirect URL; the callback redirects
    -- with an opaque code that is hashed at rest and redeemed once.
    CREATE TABLE IF NOT EXISTS oauth_login_codes (
      code_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT NOT NULL,
      redeemed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_login_codes_hash ON oauth_login_codes(code_hash);

    -- Single-use challenges for wallet-signature (EIP-191) authentication. The
    -- full message is stored so the server can rebuild exactly what was signed;
    -- it carries no long-lived secret, expires quickly, and is marked consumed on
    -- the first verification so a captured signature cannot be replayed.
    CREATE TABLE IF NOT EXISTS wallet_challenges (
      challenge_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      message TEXT NOT NULL,
      nonce_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_challenges_address ON wallet_challenges(address);

    -- Market data
    CREATE TABLE IF NOT EXISTS market_data (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      volume_24h REAL DEFAULT 0,
      change_24h REAL DEFAULT 0,
      change_percent_24h REAL DEFAULT 0,
      high_24h REAL,
      low_24h REAL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(symbol)
    );

    -- Admin users
    CREATE TABLE IF NOT EXISTS admin_users (
      admin_id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      permissions TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
    );

    -- Admin console sessions. Separate from trader sessions because an admin
    -- console session is a distinct privilege, not a second trader login.
    CREATE TABLE IF NOT EXISTS admin_sessions (
      session_id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      access_token TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (admin_id) REFERENCES admin_users(admin_id) ON DELETE CASCADE
    );

    -- Futures and perpetual contract listings. Settlement, contract type and
    -- risk parameters live with the listing so the engine can read one row.
    CREATE TABLE IF NOT EXISTS futures_markets (
      market_id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      settlement_asset TEXT NOT NULL,
      contract_type TEXT NOT NULL,
      listing_type TEXT NOT NULL DEFAULT 'perpetual',
      contract_size REAL NOT NULL,
      tick_size REAL NOT NULL,
      price_precision INTEGER NOT NULL DEFAULT 2,
      quantity_precision INTEGER NOT NULL DEFAULT 3,
      min_quantity REAL NOT NULL,
      max_quantity REAL NOT NULL,
      max_leverage INTEGER NOT NULL DEFAULT 125,
      maker_fee_bps INTEGER NOT NULL DEFAULT 2,
      taker_fee_bps INTEGER NOT NULL DEFAULT 5,
      funding_interval_hours INTEGER NOT NULL DEFAULT 8,
      funding_rate_cap REAL NOT NULL DEFAULT 0.01,
      maintenance_margin_rate REAL NOT NULL DEFAULT 0.005,
      initial_margin_rate REAL NOT NULL DEFAULT 0.008,
      liquidation_fee_rate REAL NOT NULL DEFAULT 0.005,
      insurance_fund_share REAL NOT NULL DEFAULT 0.1,
      delivery_time_ns INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_futures_markets_status
      ON futures_markets(status);

    -- Spot margin listings. One row per pair with its collateral schedule and
    -- interest model; the risk engine reads these to size loans.
    CREATE TABLE IF NOT EXISTS margin_markets (
      market_id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'cross',
      max_leverage INTEGER NOT NULL DEFAULT 10,
      collateral_ltv TEXT NOT NULL,
      borrowable_assets TEXT NOT NULL,
      interest_base_apr REAL NOT NULL DEFAULT 0.05,
      interest_kink_utilization REAL NOT NULL DEFAULT 0.8,
      interest_kink_apr REAL NOT NULL DEFAULT 0.5,
      interest_max_apr REAL NOT NULL DEFAULT 1.0,
      liquidation_thresholds TEXT NOT NULL,
      liquidation_bonus REAL NOT NULL DEFAULT 0.05,
      risk_tier TEXT NOT NULL DEFAULT 'medium',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_margin_markets_status
      ON margin_markets(status);

    -- Immutable admin audit trail. Every administrative mutation appends a row
    -- here; nothing in the application updates or deletes it.
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      entry_id TEXT PRIMARY KEY,
      admin_id TEXT,
      admin_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
      ON admin_audit_log(created_at DESC);

    -- White label clients
    CREATE TABLE IF NOT EXISTS white_label_clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      branding TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Referral program: one row per invited user, with the commission earned
    CREATE TABLE IF NOT EXISTS referrals (
      referral_id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referee_id TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tier TEXT NOT NULL DEFAULT 'Bronze',
      commission_earned REAL NOT NULL DEFAULT 0,
      commission_currency TEXT NOT NULL DEFAULT 'USDT',
      created_at TEXT DEFAULT (datetime('now')),
      activated_at TEXT,
      UNIQUE(referee_id),
      FOREIGN KEY (referrer_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (referee_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Commission ledger: every fee share credited to a referrer
    CREATE TABLE IF NOT EXISTS referral_commissions (
      commission_id TEXT PRIMARY KEY,
      referral_id TEXT NOT NULL,
      referrer_id TEXT NOT NULL,
      referee_id TEXT NOT NULL,
      trade_volume REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USDT',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      paid_at TEXT,
      FOREIGN KEY (referral_id) REFERENCES referrals(referral_id) ON DELETE CASCADE
    );

    -- Cards issued to a user (virtual or physical)
    CREATE TABLE IF NOT EXISTS cards (
      card_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT 'Visa',
      last4 TEXT,
      currency TEXT NOT NULL DEFAULT 'USDT',
      status TEXT NOT NULL DEFAULT 'requested',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    -- Card transactions: real spend records imported from the card issuer
    CREATE TABLE IF NOT EXISTS card_transactions (
      transaction_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      cashback REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (card_id) REFERENCES cards(card_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Configured fiat on/off-ramp providers. Populated by the operator when a
    -- provider contract is live; an empty table means no fiat ramp is available.
    CREATE TABLE IF NOT EXISTS fiat_providers (
      provider_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,
      payment_methods TEXT NOT NULL DEFAULT '[]',
      min_limit REAL NOT NULL DEFAULT 0,
      max_limit REAL NOT NULL DEFAULT 0,
      fee_percent REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Fiat buy/sell orders placed by users
    CREATE TABLE IF NOT EXISTS fiat_orders (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_id TEXT,
      direction TEXT NOT NULL,
      fiat_currency TEXT NOT NULL,
      crypto_currency TEXT NOT NULL,
      fiat_amount REAL NOT NULL,
      crypto_amount REAL,
      rate REAL,
      fee REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Per-user notification and preference settings, stored as a JSON document
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      notifications TEXT NOT NULL DEFAULT '{}',
      preferences TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Institutional / OTC enquiries submitted from the institutional landing page
    CREATE TABLE IF NOT EXISTS institution_inquiries (
      inquiry_id TEXT PRIMARY KEY,
      user_id TEXT,
      company_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      inquiry_type TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
    );

    -- ======================================================================
    -- Extended CEX instruments, risk, treasury and operational tables.
    -- Every table is guarded with IF NOT EXISTS because the schema is applied
    -- on every boot; nothing here seeds data.
    -- ======================================================================

    -- Options listings: one row per (underlying, expiry, strike, type).
    CREATE TABLE IF NOT EXISTS options_markets (
      market_id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      underlying TEXT NOT NULL,
      settlement_asset TEXT NOT NULL,
      option_type TEXT NOT NULL,
      strike_price REAL NOT NULL,
      expiry_ns INTEGER NOT NULL,
      exercise_style TEXT NOT NULL DEFAULT 'european',
      contract_size REAL NOT NULL DEFAULT 1,
      tick_size REAL NOT NULL,
      min_quantity REAL NOT NULL,
      max_quantity REAL NOT NULL,
      maker_fee_bps INTEGER NOT NULL DEFAULT 2,
      taker_fee_bps INTEGER NOT NULL DEFAULT 5,
      implied_volatility REAL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_options_markets_underlying
      ON options_markets(underlying, expiry_ns);

    -- Leveraged tokens / ETFs. NAV and leverage are maintained by the rebalancer.
    CREATE TABLE IF NOT EXISTS etf_markets (
      market_id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      underlying TEXT NOT NULL,
      settlement_asset TEXT NOT NULL,
      leverage INTEGER NOT NULL,
      direction TEXT NOT NULL,
      nav REAL NOT NULL,
      reference_price REAL,
      last_rebalance_ns INTEGER,
      rebalance_threshold REAL NOT NULL DEFAULT 0.05,
      management_fee_apr REAL NOT NULL DEFAULT 0.02,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_etf_markets_underlying ON etf_markets(underlying);

    -- A user's leveraged-token balance in one market. Tokens are minted on
    -- subscription at the market NAV and burned on redemption.
    CREATE TABLE IF NOT EXISTS etf_positions (
      position_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      tokens REAL NOT NULL DEFAULT 0,
      cost_basis REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_etf_positions_user ON etf_positions(user_id);

    -- Leveraged-token subscriptions and redemptions.
    CREATE TABLE IF NOT EXISTS etf_trades (
      trade_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      tokens REAL NOT NULL,
      nav REAL NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_etf_trades_user ON etf_trades(user_id, created_at DESC);

    -- A user's options position in one contract. Long is a bought option, short
    -- is a written one; both are marked and settled against the contract's
    -- Black-Scholes premium and intrinsic settlement value.
    CREATE TABLE IF NOT EXISTS options_positions (
      position_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL NOT NULL DEFAULT 0,
      premium_paid REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      settled_at TEXT,
      settlement_price REAL,
      settlement_value REAL,
      UNIQUE(user_id, market_id, side)
    );
    CREATE INDEX IF NOT EXISTS idx_options_positions_user ON options_positions(user_id);

    -- Options fills and settlements, one row per event the account can see.
    CREATE TABLE IF NOT EXISTS options_trades (
      trade_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      premium REAL NOT NULL DEFAULT 0,
      fee REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_options_trades_user ON options_trades(user_id, created_at DESC);

    -- TradFi instruments (stocks, FX, commodities, indices) traded 24/7.
    CREATE TABLE IF NOT EXISTS tradfi_markets (
      market_id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      instrument_type TEXT NOT NULL,
      settlement_asset TEXT NOT NULL,
      price_source TEXT NOT NULL,
      reference_symbol TEXT NOT NULL,
      tick_size REAL NOT NULL,
      min_quantity REAL NOT NULL,
      max_quantity REAL NOT NULL,
      max_leverage INTEGER NOT NULL DEFAULT 1,
      maker_fee_bps INTEGER NOT NULL DEFAULT 2,
      taker_fee_bps INTEGER NOT NULL DEFAULT 5,
      trading_hours TEXT NOT NULL DEFAULT '24/7',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tradfi_markets_type ON tradfi_markets(instrument_type);

    -- Per-contract insurance fund, refilled from a share of trading fees.
    CREATE TABLE IF NOT EXISTS insurance_funds (
      contract TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0,
      target_balance REAL NOT NULL DEFAULT 0,
      fee_share REAL NOT NULL DEFAULT 0.1,
      adl_enabled INTEGER NOT NULL DEFAULT 0,
      adl_threshold REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Funding rate history per perpetual contract.
    CREATE TABLE IF NOT EXISTS funding_rates (
      funding_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      funding_rate REAL NOT NULL,
      mark_price REAL NOT NULL,
      index_price REAL NOT NULL,
      premium REAL NOT NULL DEFAULT 0,
      funding_time_ns INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_funding_rates_symbol
      ON funding_rates(symbol, funding_time_ns DESC);

    -- Oracle sources configured per symbol. Mark price is the weighted median
    -- of the fresh, non-deviating sources; no single feed sets the price.
    CREATE TABLE IF NOT EXISTS oracle_sources (
      source_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      source_name TEXT NOT NULL,
      feed_reference TEXT,
      weight REAL NOT NULL DEFAULT 1,
      max_deviation REAL NOT NULL DEFAULT 0.05,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(symbol, source_name)
    );

    -- Latest observation from each oracle source.
    CREATE TABLE IF NOT EXISTS oracle_prices (
      price_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      source_name TEXT NOT NULL,
      price REAL NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      published_ns INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(symbol, source_name)
    );
    CREATE INDEX IF NOT EXISTS idx_oracle_prices_symbol ON oracle_prices(symbol);

    -- Position risk tiers per market (Binance-style leverage brackets).
    CREATE TABLE IF NOT EXISTS risk_limits (
      limit_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      tier INTEGER NOT NULL,
      max_position_notional REAL NOT NULL,
      max_leverage INTEGER NOT NULL,
      maintenance_margin_rate REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(symbol, tier)
    );

    -- Liquidation work queue. A row is the instruction to a liquidation bot;
    -- it is not a fabricated order.
    CREATE TABLE IF NOT EXISTS liquidation_queue (
      entry_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      position_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL NOT NULL,
      margin_ratio REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      executed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_liquidation_queue_status
      ON liquidation_queue(status, created_at);

    -- Exchange-wide and per-scope pause controls (circuit breakers).
    CREATE TABLE IF NOT EXISTS exchange_controls (
      scope TEXT PRIMARY KEY,
      paused INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Trading bot instances.
    CREATE TABLE IF NOT EXISTS trading_bots (
      bot_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      symbol TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'stopped',
      realized_pnl REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trading_bots_user ON trading_bots(user_id);

    -- Copy-trading leader profiles.
    CREATE TABLE IF NOT EXISTS copy_traders (
      trader_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      markets TEXT NOT NULL DEFAULT '[]',
      roi_7d REAL NOT NULL DEFAULT 0,
      roi_30d REAL NOT NULL DEFAULT 0,
      roi_90d REAL NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      followers INTEGER NOT NULL DEFAULT 0,
      max_followers INTEGER NOT NULL DEFAULT 1000,
      aum REAL NOT NULL DEFAULT 0,
      profit_share REAL NOT NULL DEFAULT 0.1,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- A follower's copy relationship with a leader.
    CREATE TABLE IF NOT EXISTS copy_follows (
      follow_id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      trader_id TEXT NOT NULL,
      copy_mode TEXT NOT NULL DEFAULT 'ratio',
      fixed_amount REAL,
      ratio REAL,
      max_position REAL,
      take_profit REAL,
      stop_loss REAL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(follower_id, trader_id)
    );

    -- One row per leader fill a follower has mirrored. The unique key makes the
    -- copy path idempotent: a scheduler that re-runs cannot place the same
    -- leader fill twice, and it needs no timestamp watermark.
    CREATE TABLE IF NOT EXISTS copy_executions (
      execution_id TEXT PRIMARY KEY,
      follow_id TEXT NOT NULL,
      follower_id TEXT NOT NULL,
      leader_history_id TEXT NOT NULL,
      follower_order_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(follow_id, leader_history_id)
    );
    CREATE INDEX IF NOT EXISTS idx_copy_exec_follower ON copy_executions(follower_id, created_at DESC);

    -- Earn products: flexible, locked, dual investment, shark fin, RYUSD vault,
    -- auto-invest and launchpool all share this table with a product_type.
    CREATE TABLE IF NOT EXISTS earn_products (
      product_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      product_type TEXT NOT NULL,
      asset TEXT NOT NULL,
      apy REAL NOT NULL,
      duration_days INTEGER,
      min_amount REAL NOT NULL DEFAULT 0,
      max_amount REAL,
      cap REAL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_earn_products_type ON earn_products(product_type);

    -- A user's subscription to an earn product.
    CREATE TABLE IF NOT EXISTS earn_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      amount REAL NOT NULL,
      accrued_reward REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT DEFAULT (datetime('now')),
      matures_at TEXT,
      redeemed_at TEXT,
      FOREIGN KEY (product_id) REFERENCES earn_products(product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_earn_subscriptions_user ON earn_subscriptions(user_id);

    -- P2P marketplace ads.
    CREATE TABLE IF NOT EXISTS p2p_offers (
      offer_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      asset TEXT NOT NULL,
      fiat TEXT NOT NULL,
      price REAL NOT NULL,
      min_amount REAL NOT NULL,
      max_amount REAL NOT NULL,
      available REAL NOT NULL,
      payment_methods TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_p2p_offers_pair ON p2p_offers(asset, fiat, side);

    -- Coupons: single-use codes that credit a fixed amount to one account.
    CREATE TABLE IF NOT EXISTS coupons (
      coupon_id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      coupon_type TEXT NOT NULL DEFAULT 'cash',
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      min_requirement REAL NOT NULL DEFAULT 0,
      expires_at TEXT,
      used_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_coupons_user ON coupons(user_id);

    -- Red packets: a funded pool split between claimers.
    CREATE TABLE IF NOT EXISTS red_packets (
      packet_id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      quantity INTEGER NOT NULL,
      packet_type TEXT NOT NULL DEFAULT 'random',
      claimed_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (creator_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_red_packets_creator ON red_packets(creator_id);

    -- One claim per account per packet; the unique key makes that structural.
    CREATE TABLE IF NOT EXISTS red_packet_claims (
      claim_id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      claimed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(packet_id, user_id),
      FOREIGN KEY (packet_id) REFERENCES red_packets(packet_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_red_packet_claims_user ON red_packet_claims(user_id);

    -- P2P escrow orders. Funds are held in escrow until release.
    CREATE TABLE IF NOT EXISTS p2p_orders (
      order_id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      fiat TEXT NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      escrow_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_p2p_orders_buyer ON p2p_orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_p2p_orders_seller ON p2p_orders(seller_id);

    CREATE TABLE IF NOT EXISTS p2p_disputes (
      dispute_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- TigerPay transfers between users, by email, phone or account id.
    CREATE TABLE IF NOT EXISTS pay_transfers (
      transfer_id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_ref TEXT NOT NULL,
      recipient_user_id TEXT,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_code TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      claimed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pay_transfers_sender ON pay_transfers(sender_id);

    -- User notifications. One row per event the venue wants to tell an account
    -- about; read_at is the only mutable column and is set by the client.
    CREATE TABLE IF NOT EXISTS notifications (
      notification_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user
      ON notifications(user_id, created_at DESC);

    -- OTC block-trade quotes. A quote is priced from the venue's own book and
    -- expires; it is never filled at a rate that did not exist.
    CREATE TABLE IF NOT EXISTS otc_quotes (
      quote_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      amount REAL NOT NULL,
      quote_price REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'quoted',
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_otc_quotes_user ON otc_quotes(user_id, created_at DESC);

    -- Cross-chain transfers. A transfer records the burn on the source chain and
    -- the mint on the destination; tx_ref carries the settlement reference.
    CREATE TABLE IF NOT EXISTS cross_chain_transfers (
      transfer_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      from_chain TEXT NOT NULL,
      to_chain TEXT NOT NULL,
      to_address TEXT NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_ref TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cross_chain_user
      ON cross_chain_transfers(user_id, created_at DESC);

    -- Treasury accounts per asset and network (hot, warm, cold).
    CREATE TABLE IF NOT EXISTS treasury_accounts (
      account_id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      address TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(asset, network, account_type)
    );

    CREATE TABLE IF NOT EXISTS treasury_movements (
      movement_id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      from_account TEXT,
      to_account TEXT,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      tx_ref TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Revenue ledger: one row per fee or interest event the exchange earned.
    CREATE TABLE IF NOT EXISTS revenue_ledger (
      entry_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      user_id TEXT,
      reference TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_revenue_ledger_category
      ON revenue_ledger(category, created_at DESC);

    -- Fee schedule by VIP level. Level 0 is the public tier.
    CREATE TABLE IF NOT EXISTS fee_schedule (
      level INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      spot_maker_bps REAL NOT NULL,
      spot_taker_bps REAL NOT NULL,
      futures_maker_bps REAL NOT NULL,
      futures_taker_bps REAL NOT NULL,
      volume_threshold REAL NOT NULL DEFAULT 0,
      tgr_holding_threshold REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Support desk.
    CREATE TABLE IF NOT EXISTS support_tickets (
      ticket_id TEXT PRIMARY KEY,
      user_id TEXT,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

    CREATE TABLE IF NOT EXISTS support_messages (
      message_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(ticket_id) ON DELETE CASCADE
    );

    -- Open derivative positions. One row per user, symbol and position side.
    CREATE TABLE IF NOT EXISTS futures_positions (
      position_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL NOT NULL,
      leverage INTEGER NOT NULL,
      margin_mode TEXT NOT NULL DEFAULT 'cross',
      position_mode TEXT NOT NULL DEFAULT 'one_way',
      margin REAL NOT NULL,
      liquidation_price REAL NOT NULL,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, symbol, side, position_mode)
    );
    CREATE INDEX IF NOT EXISTS idx_futures_positions_user ON futures_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_futures_positions_symbol ON futures_positions(symbol);

    -- Futures conditional orders: stop-loss, take-profit and trailing stops.
    -- A row parks off the book until its trigger is crossed by the mark price,
    -- at which point it is executed as a reduce-only order on the position.
    CREATE TABLE IF NOT EXISTS futures_conditional_orders (
      order_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      position_side TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      stop_price REAL,
      callback_rate REAL,
      quantity REAL NOT NULL,
      limit_price REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_price REAL,
      created_at TEXT DEFAULT (datetime('now')),
      triggered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_futures_conditional_user ON futures_conditional_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_futures_conditional_symbol ON futures_conditional_orders(symbol, status);

    -- Margin loans with accrued interest.
    CREATE TABLE IF NOT EXISTS margin_loans (
      loan_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      asset TEXT NOT NULL,
      principal REAL NOT NULL,
      interest_accrued REAL NOT NULL DEFAULT 0,
      collateral_asset TEXT NOT NULL,
      collateral_amount REAL NOT NULL,
      mode TEXT NOT NULL DEFAULT 'cross',
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_margin_loans_user ON margin_loans(user_id);

    -- Sub-accounts under a parent account.
    CREATE TABLE IF NOT EXISTS subaccounts (
      subaccount_id TEXT PRIMARY KEY,
      parent_user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      label TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(parent_user_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_subaccounts_parent ON subaccounts(parent_user_id);

    -- Launchpad projects and subscriptions.
    CREATE TABLE IF NOT EXISTS launchpad_projects (
      project_id TEXT PRIMARY KEY,
      token_symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      sale_price REAL NOT NULL,
      total_allocation REAL NOT NULL,
      raised REAL NOT NULL DEFAULT 0,
      start_ns INTEGER NOT NULL,
      end_ns INTEGER NOT NULL,
      vesting TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'upcoming',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS launchpad_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      allocation REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'committed',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id)
    );

    -- Withdrawal address whitelist. An address must be whitelisted and
    -- confirmed before a withdrawal to it is accepted.
    CREATE TABLE IF NOT EXISTS withdrawal_whitelist (
      entry_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, asset, network, address)
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawal_whitelist_user ON withdrawal_whitelist(user_id);

    -- Buyback and burn records.
    CREATE TABLE IF NOT EXISTS buyback_records (
      record_id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      amount_spent REAL NOT NULL,
      asset_bought REAL NOT NULL,
      asset_burned REAL NOT NULL,
      fee_share REAL NOT NULL,
      tx_ref TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- API rate-limit usage counters per key and window.
    CREATE TABLE IF NOT EXISTS api_rate_usage (
      key_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key_id, window_start)
    );

    -- Exchange settings as key/value pairs, edited from the admin console.
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Marketing banners served to the storefront once their window is active.
    CREATE TABLE IF NOT EXISTS banners (
      banner_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      image_url TEXT NOT NULL,
      link_url TEXT NOT NULL DEFAULT '',
      placement TEXT NOT NULL DEFAULT 'home',
      status TEXT NOT NULL DEFAULT 'draft',
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Operator announcements shown to users.
    CREATE TABLE IF NOT EXISTS announcements (
      announcement_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Executed spot trades. One row per fill, written by the settlement path
    -- when a taker order matches a resting maker order. The maker and taker
    -- user ids let a fee ledger attribute each side; nothing here is simulated.
    CREATE TABLE IF NOT EXISTS spot_trades (
      trade_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      maker_order_id TEXT NOT NULL,
      taker_order_id TEXT NOT NULL,
      maker_user_id TEXT NOT NULL,
      taker_user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      quote_quantity REAL NOT NULL,
      maker_fee REAL NOT NULL DEFAULT 0,
      taker_fee REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spot_trades_symbol ON spot_trades(symbol, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spot_trades_maker ON spot_trades(maker_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spot_trades_taker ON spot_trades(taker_user_id, created_at DESC);

    -- ======================================================================
    -- Baseline fee schedule and risk controls. These are exchange parameters
    -- (a fee schedule must exist for the fee engine to resolve a tier), not
    -- fabricated market or account data.
    -- ======================================================================
    INSERT OR IGNORE INTO fee_schedule
      (level, name, spot_maker_bps, spot_taker_bps, futures_maker_bps, futures_taker_bps, volume_threshold, tgr_holding_threshold)
    VALUES
      (0, 'VIP 0', 10, 10, 2, 5, 0, 0),
      (1, 'VIP 1', 9, 10, 1.8, 4.5, 1000000, 100),
      (2, 'VIP 2', 8, 9, 1.6, 4.2, 5000000, 500),
      (3, 'VIP 3', 7, 8, 1.4, 4, 10000000, 1000),
      (4, 'VIP 4', 6, 7, 1.2, 3.6, 50000000, 5000),
      (5, 'VIP 5', 5, 6, 1, 3.2, 100000000, 10000),
      (6, 'VIP 6', 4, 5, 0.8, 3, 500000000, 50000),
      (7, 'VIP 7', 3, 4, 0.6, 2.8, 1000000000, 100000),
      (8, 'VIP 8', 2, 3, 0.4, 2.5, 5000000000, 500000),
      (9, 'VIP 9', 0, 2, 0, 2, 10000000000, 1000000);

    INSERT OR IGNORE INTO exchange_controls (scope, paused) VALUES
      ('spot', 0), ('futures', 0), ('margin', 0), ('options', 0), ('etf', 0),
      ('tradfi', 0), ('deposits', 0), ('withdrawals', 0), ('p2p', 0), ('pay', 0),
      ('exchange', 0);

    INSERT OR IGNORE INTO system_settings (key, value, category) VALUES
      ('maintenance_mode', 'false', 'operations'),
      ('registration_enabled', 'true', 'operations'),
      ('withdrawal_enabled', 'true', 'operations'),
      ('trading_enabled', 'true', 'operations'),
      ('p2p_enabled', 'true', 'operations'),
      ('kyc_required_for_withdrawal', 'true', 'compliance');

    -- ======================================================================
    -- TigerSwap DEX. Every table below backs a real, self-contained DEX path:
    -- pools hold live reserves, farms hold real stakes, perp positions hold real
    -- margin, and the revenue ledger records where each fee went. No row is
    -- seeded with fabricated market data; pools and markets are created by an
    -- administrator through the admin API.
    -- ======================================================================
    CREATE TABLE IF NOT EXISTS dex_tokens (
      token_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 18,
      chain TEXT NOT NULL DEFAULT 'tigerex',
      contract_address TEXT,
      logo_url TEXT,
      coingecko_id TEXT,
      price_feed TEXT,
      tags TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      spam INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_pools (
      pool_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      tokens TEXT NOT NULL,
      fee REAL NOT NULL,
      amplification REAL,
      weights TEXT,
      tick_spacing INTEGER,
      sqrt_price REAL,
      liquidity REAL,
      sqrt_price_lower REAL,
      sqrt_price_upper REAL,
      reserves TEXT NOT NULL,
      total_supply REAL NOT NULL DEFAULT 0,
      tvl_usd REAL NOT NULL DEFAULT 0,
      volume_24h_usd REAL NOT NULL DEFAULT 0,
      fee_24h_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_lp_positions (
      position_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      liquidity REAL NOT NULL DEFAULT 0,
      token0 TEXT NOT NULL,
      token1 TEXT NOT NULL,
      amount0 REAL NOT NULL DEFAULT 0,
      amount1 REAL NOT NULL DEFAULT 0,
      fees_earned0 REAL NOT NULL DEFAULT 0,
      fees_earned1 REAL NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(pool_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dex_swaps (
      swap_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      price_impact REAL NOT NULL DEFAULT 0,
      route TEXT,
      sponsored INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_copy_mirrors (
      mirror_id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      follow_id TEXT NOT NULL,
      leader_swap_id TEXT NOT NULL,
      swap_id TEXT NOT NULL,
      amount_in REAL NOT NULL,
      amount_out REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(follow_id, leader_swap_id)
    );

    CREATE TABLE IF NOT EXISTS dex_farms (
      farm_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      reward_token TEXT NOT NULL,
      reward_rate REAL NOT NULL,
      apr REAL NOT NULL DEFAULT 0,
      total_staked REAL NOT NULL DEFAULT 0,
      boost_multiplier REAL NOT NULL DEFAULT 1,
      start_at TEXT,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_farm_meta (
      farm_id TEXT PRIMARY KEY,
      acc_reward_per_share REAL NOT NULL DEFAULT 0,
      last_update INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dex_farm_stakes (
      stake_id TEXT PRIMARY KEY,
      farm_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      reward_debt REAL NOT NULL DEFAULT 0,
      pending_rewards REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(farm_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dex_ve_locks (
      lock_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL DEFAULT 0,
      unlock_at TEXT NOT NULL,
      voting_power REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_gauges (
      gauge_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL UNIQUE,
      weight REAL NOT NULL DEFAULT 0,
      emission_bps INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_gauge_votes (
      vote_id TEXT PRIMARY KEY,
      gauge_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(gauge_id, user_id, epoch)
    );

    CREATE TABLE IF NOT EXISTS dex_bribes (
      bribe_id TEXT PRIMARY KEY,
      gauge_id TEXT NOT NULL,
      token TEXT NOT NULL,
      amount REAL NOT NULL,
      sponsor TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_bribe_claims (
      claim_id TEXT PRIMARY KEY,
      bribe_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      claimed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(bribe_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dex_limit_orders (
      order_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      amount_in REAL NOT NULL,
      limit_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      filled_amount_out REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_dca_plans (
      plan_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      amount_per_slice REAL NOT NULL,
      frequency TEXT NOT NULL,
      total_slices INTEGER NOT NULL DEFAULT 0,
      executed_slices INTEGER NOT NULL DEFAULT 0,
      start_at TEXT NOT NULL,
      last_run_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_twap_plans (
      plan_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      total_amount_in REAL NOT NULL,
      slices INTEGER NOT NULL,
      interval_ms INTEGER NOT NULL,
      executed_slices INTEGER NOT NULL DEFAULT 0,
      start_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_launch_projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      total_supply REAL NOT NULL,
      price REAL NOT NULL,
      raise_target REAL NOT NULL,
      raised REAL NOT NULL DEFAULT 0,
      curve_k REAL,
      soft_cap REAL,
      hard_cap REAL,
      quote_asset TEXT NOT NULL DEFAULT 'RUSD',
      start_at TEXT,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_launch_contributions (
      contribution_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      tokens REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_nft_listings (
      listing_id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      token_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      buyer_id TEXT,
      price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUSD',
      status TEXT NOT NULL DEFAULT 'listed',
      created_at TEXT DEFAULT (datetime('now')),
      sold_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dex_bridge_transfers (
      transfer_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_chain TEXT NOT NULL,
      to_chain TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      bridge_fee REAL NOT NULL DEFAULT 0,
      deposit_tx TEXT,
      release_tx TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_revenue_ledger (
      entry_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      lp_share REAL NOT NULL DEFAULT 0,
      vetgr_share REAL NOT NULL DEFAULT 0,
      treasury_share REAL NOT NULL DEFAULT 0,
      insurance_share REAL NOT NULL DEFAULT 0,
      burn_share REAL NOT NULL DEFAULT 0,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_bot_instances (
      instance_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bot_type TEXT NOT NULL,
      pool_id TEXT,
      params TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_perp_positions (
      position_id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      margin_mode TEXT NOT NULL DEFAULT 'cross',
      collateral_asset TEXT NOT NULL,
      collateral REAL NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      leverage REAL NOT NULL,
      liquidation_price REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dex_lending_markets (
      market_id TEXT PRIMARY KEY,
      asset TEXT NOT NULL UNIQUE,
      ltv REAL NOT NULL,
      liquidation_threshold REAL NOT NULL,
      liquidation_bonus REAL NOT NULL,
      base_rate REAL NOT NULL,
      kink REAL NOT NULL,
      jump_multiplier REAL NOT NULL,
      total_supply REAL NOT NULL DEFAULT 0,
      total_borrow REAL NOT NULL DEFAULT 0,
      supply_cap REAL NOT NULL,
      borrow_cap REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_accrued_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_lending_positions (
      position_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      supplied REAL NOT NULL DEFAULT 0,
      borrowed REAL NOT NULL DEFAULT 0,
      collateral_asset TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(market_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dex_blacklist (
      entry_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(kind, value)
    );

    CREATE TABLE IF NOT EXISTS dex_flash_loans (
      loan_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'repaid',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_dex_pools_kind ON dex_pools(kind, status);
    CREATE INDEX IF NOT EXISTS idx_dex_swaps_pool ON dex_swaps(pool_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dex_swaps_user ON dex_swaps(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dex_lp_user ON dex_lp_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_dex_farm_stakes_user ON dex_farm_stakes(user_id);
    CREATE INDEX IF NOT EXISTS idx_dex_perp_user ON dex_perp_positions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_dex_lending_pos_user ON dex_lending_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_dex_revenue_source ON dex_revenue_ledger(source, created_at DESC);

    -- Auto-compounding vaults. total_assets and total_supply are the share
    -- accounting inputs; a harvest raises total_assets without minting shares,
    -- which is what lifts the share price.
    CREATE TABLE IF NOT EXISTS dex_vaults (
      vault_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      pool_id TEXT NOT NULL,
      staked_token TEXT NOT NULL,
      reward_token TEXT NOT NULL,
      performance_fee_bps INTEGER NOT NULL DEFAULT 0,
      min_harvest REAL NOT NULL DEFAULT 0,
      total_assets REAL NOT NULL DEFAULT 0,
      total_supply REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_vault_positions (
      position_id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      shares REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(vault_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dex_vault_harvests (
      harvest_id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      reward_sold REAL NOT NULL,
      assets_added REAL NOT NULL,
      performance_fee REAL NOT NULL DEFAULT 0,
      share_price REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Liquid staking (stTGR). The exchange rate is derived from total_staked over
    -- total_shares, so it is never stored and can never drift from the balances.
    CREATE TABLE IF NOT EXISTS dex_liquid_staking (
      stake_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      stake_token TEXT NOT NULL,
      receipt_token TEXT NOT NULL,
      redemption_fee_bps INTEGER NOT NULL DEFAULT 0,
      total_staked REAL NOT NULL DEFAULT 0,
      total_shares REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dex_liquid_positions (
      position_id TEXT PRIMARY KEY,
      stake_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      shares REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(stake_id, user_id)
    );

    -- Private order flow. A row is written when an order commits and updated
    -- when the batch reveals; a searcher sees only the commitment until then.
    CREATE TABLE IF NOT EXISTS dex_private_orders (
      order_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      token_in TEXT NOT NULL,
      token_out TEXT NOT NULL,
      amount_in REAL NOT NULL,
      commitment TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      committed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_dex_private_batch ON dex_private_orders(batch_id, sequence);

    -- V4-style pool hooks. A hook row attaches behaviour to one pool: a dynamic
    -- fee that widens with realised volatility, an on-chain limit order, a TWAMM
    -- schedule, or an anti-MEV gate. The config is the hook's own parameters, so
    -- adding a hook kind needs no schema change.
    CREATE TABLE IF NOT EXISTS dex_pool_hooks (
      hook_id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(pool_id, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_dex_pool_hooks_pool ON dex_pool_hooks(pool_id, status);
    CREATE INDEX IF NOT EXISTS idx_dex_vault_pos_user ON dex_vault_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_dex_liquid_pos_user ON dex_liquid_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_dex_vault_harvest ON dex_vault_harvests(vault_id, created_at DESC);

    INSERT OR IGNORE INTO exchange_controls (scope, paused) VALUES
      ('dex', 0), ('dex_swaps', 0), ('dex_perps', 0), ('dex_margin', 0),
      ('dex_launchpad', 0), ('dex_bridge', 0);

    -- TigerSwap protocol parameters. These are operator settings, not market
    -- data: each has a documented default that the fee, treasury and risk
    -- engines read instead of hard-coding a constant.
    INSERT OR IGNORE INTO system_settings (key, value, category) VALUES
      ('dex_swap_fee_split_lp_bps', '7000', 'dex'),
      ('dex_swap_fee_split_vetgr_bps', '2000', 'dex'),
      ('dex_swap_fee_split_treasury_bps', '1000', 'dex'),
      ('dex_perp_fee_split_insurance_bps', '4000', 'dex'),
      ('dex_perp_fee_split_vetgr_bps', '4000', 'dex'),
      ('dex_perp_fee_split_treasury_bps', '2000', 'dex'),
      ('dex_buyback_burn_bps', '5000', 'dex'),
      ('dex_insurance_fund_target', '1000000', 'dex'),
      ('dex_max_price_impact', '0.15', 'dex'),
      ('dex_default_slippage', '0.005', 'dex'),
      ('dex_max_slippage', '0.05', 'dex'),
      ('dex_treasury_address', '', 'dex'),
      ('dex_mev_protection_enabled', 'true', 'dex'),
      ('dex_gasless_free_swaps_per_day', '3', 'dex'),
      ('dex_ve_lock_min_days', '7', 'dex'),
      ('dex_ve_lock_max_days', '1460', 'dex'),
      ('dex_zap_enabled', 'true', 'dex'),
      ('dex_vault_performance_fee_bps', '1000', 'dex'),
      ('dex_vault_min_harvest', '0', 'dex'),
      ('dex_liquid_staking_redemption_fee_bps', '0', 'dex'),
      ('dex_mev_protect_threshold', '0.005', 'dex'),
      ('dex_mev_anti_tolerance', '0.02', 'dex'),
      ('dex_snipe_window_seconds', '300', 'dex'),
      ('dex_snipe_max_impact', '0.1', 'dex'),
      ('dex_snipe_min_liquidity', '1000', 'dex'),
      ('dex_snipe_gas_multiplier', '2', 'dex'),
      ('dex_v4_dynamic_fee_max_bps', '100', 'dex'),
      ('dex_v4_volatility_ceiling', '0.05', 'dex');

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
    CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
    CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions(referrer_id);
    CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_card_transactions_user ON card_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_challenges_user ON login_challenges(user_id);
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
    CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_pair ON orders(pair_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
    CREATE INDEX IF NOT EXISTS idx_market_symbol ON market_data(symbol);
  `);

  // Do not seed fabricated markets or prices. Market metadata and prices must come from the configured live market-data service.

  // `CREATE TABLE IF NOT EXISTS` cannot add columns to a database created by an
  // earlier schema, so additive columns are applied explicitly. Each ALTER is
  // guarded by a column existence check because SQLite has no `ADD COLUMN IF
  // NOT EXISTS`.
  applyColumnMigrations(database);

  // Optional one-time bootstrap. No default admin account or password is ever created.
  const bootstrapAdminEmail = process.env.TIGEREX_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const bootstrapAdminPassword = process.env.TIGEREX_BOOTSTRAP_ADMIN_PASSWORD;
  if (bootstrapAdminEmail && bootstrapAdminPassword) {
    if (bootstrapAdminPassword.length < 16) {
      throw new Error('TIGEREX_BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters');
    }
    const adminExists = database.prepare('SELECT 1 FROM admin_users WHERE email = ?').get(bootstrapAdminEmail);
    if (!adminExists) {
      const bcrypt = require('bcryptjs');
      const adminId = uuidv4();
      const passwordHash = bcrypt.hashSync(bootstrapAdminPassword, 12);
      database.prepare(`
        INSERT INTO admin_users (admin_id, email, password_hash, role, permissions)
        VALUES (?, ?, ?, 'super_admin', '["all"]')
      `).run(adminId, bootstrapAdminEmail, passwordHash);
    }
  }

  console.log('✅ Database schema initialized');
}

// Additive column migrations for databases created before a column existed.
function applyColumnMigrations(database: Database.Database) {
  const migrations: Array<{ table: string; column: string; definition: string }> = [
    { table: 'users', column: 'referral_code', definition: 'TEXT' },
    { table: 'users', column: 'referred_by', definition: 'TEXT' },
    { table: 'orders', column: 'stop_price', definition: 'REAL' },
    { table: 'orders', column: 'iceberg_quantity', definition: 'REAL' },
    { table: 'orders', column: 'hidden_quantity', definition: 'REAL DEFAULT 0' },
    { table: 'orders', column: 'locked_amount', definition: 'REAL DEFAULT 0' },
    { table: 'orders', column: 'locked_asset', definition: 'TEXT' },
    // Bot orders are attributable to the bot that placed them, so the runner can
    // tell whether one is already resting instead of stacking duplicates.
    { table: 'orders', column: 'bot_id', definition: 'TEXT' },
    // A bot's run state (step index, last run) so a scheduled strategy resumes
    // where it left off rather than restarting on every sweep.
    { table: 'trading_bots', column: 'state', definition: "TEXT NOT NULL DEFAULT '{}'" },
    { table: 'trading_bots', column: 'last_run_ns', definition: 'INTEGER' },
    { table: 'wallets', column: 'memo', definition: 'TEXT' },
    { table: 'wallets', column: 'address_index', definition: 'TEXT' },
    // Security toggles are dedicated columns so a query that needs one does not
    // parse a blob, and so a flag can be indexed or constrained later.
    { table: 'users', column: 'anti_phishing_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'withdrawal_whitelist_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'login_alerts_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'ip_whitelist_enabled', definition: 'INTEGER DEFAULT 0' },
    { table: 'users', column: 'password_changed_at', definition: 'TEXT' },
    // KYC identity details are PII, so they are held as one encrypted blob
    // rather than as searchable plaintext columns.
    { table: 'users', column: 'kyc_personal_encrypted', definition: 'TEXT' },
    // Reference price at the last leveraged-token rebalance and the realized
    // P&L on an options position, for databases created before the columns.
    { table: 'etf_markets', column: 'reference_price', definition: 'REAL' },
    { table: 'options_positions', column: 'realized_pnl', definition: 'REAL NOT NULL DEFAULT 0' },
    // dex_farms gained an updated_at column after the table shipped, so a
    // database created before it must be altered rather than recreated.
    { table: 'dex_farms', column: 'updated_at', definition: 'TEXT' },
    // A borrow records which asset was posted as collateral, so the position
    // view can value it in the borrowed asset; without it a health factor could
    // only be reported for a position collateralised in the borrowed asset.
    { table: 'dex_lending_positions', column: 'collateral_asset', definition: 'TEXT' },
    // The lending market tracks when interest was last applied, so a keeper run
    // accrues exactly the elapsed time rather than a fixed interval.
    { table: 'dex_lending_markets', column: 'last_accrued_at', definition: 'TEXT' },
    // A launch project records the asset its raise is denominated in, so the
    // escrow that holds the raise and the payout to the project agree.
    { table: 'dex_launch_projects', column: 'quote_asset', definition: "TEXT NOT NULL DEFAULT 'RUSD'" },
    // A swap records whether the protocol sponsored it, so the daily free-swap
    // allowance counts only sponsored swaps rather than every swap the trader
    // made (which let a busy trader exhaust the allowance with paid swaps).
    { table: 'dex_swaps', column: 'sponsored', definition: 'INTEGER NOT NULL DEFAULT 0' },
  ];

  for (const { table, column, definition } of migrations) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // The unique index on users.referral_code is created after the migration so it
  // also applies to pre-existing databases. A partial index excludes the NULL
  // values of accounts that have not been assigned a code yet.
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
      ON users(referral_code) WHERE referral_code IS NOT NULL;
  `);
}

// Encryption utilities
export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Hash functions
export function hashPassword(password: string): string {
  const bcrypt = require('bcryptjs');
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(password, hash);
}

// Token generation
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateOTP(): string {
  return randomInt(100000, 1000000).toString();
}

// UUID generation
export function generateId(): string {
  return uuidv4();
}

// Referral codes are human-shareable: an uppercase alphabet without visually
// ambiguous characters (0/O, 1/I) so a code read aloud or copied by hand still
// resolves to the right account.
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReferralCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += REFERRAL_ALPHABET[randomInt(0, REFERRAL_ALPHABET.length)];
  }
  return code;
}

// Close database connection
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export default { getDb, encrypt, decrypt, hashPassword, verifyPassword, generateToken, generateOTP, generateId, closeDb };
