/**
 * TigerEx Database Module
 * Production-grade SQLite database layer for development
 * In production, replace with PostgreSQL using pgxpool
 */

import Database from 'better-sqlite3';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = process.env.DB_PATH || './tigerex.db';

let db: Database.Database | null = null;

// Encryption key derivation (use environment variable in production)
const ENCRYPTION_KEY = createHash('sha256').update(process.env.ENCRYPTION_KEY || 'tigerex-dev-key-change-in-production').digest();

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
      phone_verified INTEGER DEFAULT 0
    );

    -- User wallets
    CREATE TABLE IF NOT EXISTS wallets (
      wallet_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      network TEXT NOT NULL,
      address TEXT,
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

    -- White label clients
    CREATE TABLE IF NOT EXISTS white_label_clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      branding TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
    CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_pair ON orders(pair_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
    CREATE INDEX IF NOT EXISTS idx_market_symbol ON market_data(symbol);
  `);

  // Insert default trading pairs if not exist
  const defaultPairs = [
    { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', price: 45000 },
    { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', price: 2500 },
    { symbol: 'BNB/USDT', base: 'BNB', quote: 'USDT', price: 350 },
    { symbol: 'XRP/USDT', base: 'XRP', quote: 'USDT', price: 0.6 },
    { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', price: 0.5 },
    { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', price: 0.08 },
    { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', price: 100 },
    { symbol: 'DOT/USDT', base: 'DOT', quote: 'USDT', price: 7 },
    { symbol: 'MATIC/USDT', base: 'MATIC', quote: 'USDT', price: 0.8 },
    { symbol: 'LTC/USDT', base: 'LTC', quote: 'USDT', price: 70 },
  ];

  const insertPair = database.prepare(`
    INSERT OR IGNORE INTO trading_pairs (pair_id, base_currency, quote_currency, symbol, status)
    VALUES (?, ?, ?, ?, 'active')
  `);

  const insertMarket = database.prepare(`
    INSERT OR IGNORE INTO market_data (id, symbol, price, volume_24h, change_24h, change_percent_24h)
    VALUES (?, ?, ?, 0, 0, 0)
  `);

  for (const pair of defaultPairs) {
    const pairId = uuidv4();
    insertPair.run(pairId, pair.base, pair.quote, pair.symbol);
    insertMarket.run(uuidv4(), pair.symbol, pair.price);
  }

  // Create default admin if not exists
  const adminExists = database.prepare('SELECT 1 FROM admin_users WHERE email = ?').get('admin@tigerex.com');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const adminId = uuidv4();
    const passwordHash = bcrypt.hashSync('admin123', 12);
    database.prepare(`
      INSERT INTO admin_users (admin_id, email, password_hash, role, permissions)
      VALUES (?, ?, ?, 'super_admin', '["all"]')
    `).run(adminId, 'admin@tigerex.com', passwordHash);
  }

  console.log('✅ Database schema initialized');
}

// Encryption utilities
export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
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
  const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
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
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// UUID generation
export function generateId(): string {
  return uuidv4();
}

// Close database connection
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export default { getDb, encrypt, decrypt, hashPassword, verifyPassword, generateToken, generateOTP, generateId, closeDb };
