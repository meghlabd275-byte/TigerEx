/**
 * TigerEx Backend Server
 * Production-grade cryptocurrency exchange backend
 * Language: Node.js with Express
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

// Database - using in-memory store with file persistence for demo
// In production, use PostgreSQL
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Initialize database
const dbPath = process.env.DB_PATH || path.join(__dirname, 'tigerex.db');
let db;

try {
  db = new Database(dbPath);
  console.log('Database connected:', dbPath);
} catch (err) {
  console.log('Using in-memory database');
  db = new Database(':memory:');
}

// Initialize tables
initializeDatabase();

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: { success: false, error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

function initializeDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      kyc_level INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      email_verified INTEGER DEFAULT 0,
      phone_verified INTEGER DEFAULT 0,
      two_fa_enabled INTEGER DEFAULT 0,
      two_fa_secret TEXT,
      country TEXT,
      referral_code TEXT,
      referred_by TEXT
    )
  `);

  // Wallets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance REAL DEFAULT 0,
      locked REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, currency)
    )
  `);

  // Orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL,
      quantity REAL,
      filled_quantity REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      tx_hash TEXT,
      address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // API Keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key TEXT UNIQUE NOT NULL,
      secret TEXT NOT NULL,
      permissions TEXT DEFAULT 'read',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Markets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS markets (
      symbol TEXT PRIMARY KEY,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      status TEXT DEFAULT 'trading',
      min_price REAL DEFAULT 0,
      max_price REAL,
      tick_size REAL DEFAULT 0.01,
      min_quantity REAL DEFAULT 0,
      max_quantity REAL,
      step_size REAL DEFAULT 0.001
    )
  `);

  // Insert default markets
  const insertMarket = db.prepare(`
    INSERT OR IGNORE INTO markets (symbol, base_asset, quote_asset, status) VALUES (?, ?, ?, ?)
  `);
  
  const defaultMarkets = [
    ['BTCUSDT', 'BTC', 'USDT', 'trading'],
    ['ETHUSDT', 'ETH', 'USDT', 'trading'],
    ['BNBUSDT', 'BNB', 'USDT', 'trading'],
    ['TGRUSDT', 'TGR', 'USDT', 'trading'],
    ['SOLUSDT', 'SOL', 'USDT', 'trading'],
    ['XRPUSDT', 'XRP', 'USDT', 'trading'],
    ['ADAUSDT', 'ADA', 'USDT', 'trading'],
    ['DOGEUSDT', 'DOGE', 'USDT', 'trading'],
  ];
  
  defaultMarkets.forEach(m => insertMarket.run(...m));

  // Trades table (for order book)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      side TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`);

  console.log('Database tables initialized');
}

// ============================================================================
// CONFIG
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'tigerex-secret-key-change-in-production';
const PORT = process.env.PORT || 8080;
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'tigerex-refresh-secret-key';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateToken(userId, type = 'access') {
  const secret = type === 'access' ? JWT_SECRET : REFRESH_SECRET;
  const expiresIn = type === 'access' ? '24h' : '7d';
  return jwt.sign({ userId, type }, secret, { expiresIn });
}

function verifyToken(token, type = 'access') {
  try {
    const secret = type === 'access' ? JWT_SECRET : REFRESH_SECRET;
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
}

function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token, 'access');
  
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }

  req.userId = decoded.userId;
  next();
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

// Register
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { email, username, password, referralCode } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const userReferralCode = uuidv4().substring(0, 8).toUpperCase();

    // Create user
    db.prepare(`
      INSERT INTO users (id, email, username, password_hash, referral_code, referred_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, email, username, passwordHash, userReferralCode, referralCode || null);

    // Create default wallets for supported currencies
    const currencies = ['USDT', 'BTC', 'ETH', 'BNB', 'TGR'];
    const insertWallet = db.prepare(`
      INSERT INTO wallets (id, user_id, currency, balance) VALUES (?, ?, ?, ?)
    `);
    
    currencies.forEach(currency => {
      // Give new users some testnet USDT
      const initialBalance = currency === 'USDT' ? 10000 : 0;
      insertWallet.run(uuidv4(), userId, currency, initialBalance);
    });

    // Generate tokens
    const accessToken = generateToken(userId, 'access');
    const refreshToken = generateToken(userId, 'refresh');

    // Save session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, refreshToken, expiresAt);

    res.status(201).json({
      success: true,
      data: {
        user: { id: userId, email, username, kycLevel: 0 },
        accessToken,
        refreshToken,
        referralCode: userReferralCode
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Login
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Missing email or password' });
    }

    // Find user
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Generate tokens
    const accessToken = generateToken(user.id, 'access');
    const refreshToken = generateToken(user.id, 'refresh');

    // Save session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, user.id, refreshToken, expiresAt);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          kycLevel: user.kyc_level,
          emailVerified: !!user.email_verified,
          phoneVerified: !!user.phone_verified,
          twoFactorEnabled: !!user.two_fa_enabled
        },
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Refresh token
app.post('/api/v1/auth/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Missing refresh token' });
    }

    const decoded = verifyToken(refreshToken, 'refresh');
    if (!decoded) {
      return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }

    // Verify session exists
    const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > datetime("now")').get(refreshToken);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session expired' });
    }

    // Generate new tokens
    const newAccessToken = generateToken(decoded.userId, 'access');
    const newRefreshToken = generateToken(decoded.userId, 'refresh');

    // Update session
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET token = ?, expires_at = ? WHERE id = ?')
      .run(newRefreshToken, newExpiresAt, session.id);

    res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken }
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Logout
app.post('/api/v1/auth/logout', authenticateRequest, (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];

    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get current user
app.get('/api/v1/auth/me', authenticateRequest, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, username, kyc_level, country, created_at FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        kycLevel: user.kyc_level,
        country: user.country,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// WALLET ROUTES
// ============================================================================

// Get all wallets
app.get('/api/v1/wallet/balance', authenticateRequest, (req, res) => {
  try {
    const wallets = db.prepare(`
      SELECT currency, balance, locked FROM wallets WHERE user_id = ?
    `).all(req.userId);

    res.json({
      success: true,
      data: {
        balances: wallets.map(w => ({
          asset: w.currency,
          free: w.balance,
          locked: w.locked,
          total: w.balance + w.locked
        }))
      }
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get specific wallet
app.get('/api/v1/wallet/:currency', authenticateRequest, (req, res) => {
  try {
    const { currency } = req.params;
    const wallet = db.prepare(`
      SELECT * FROM wallets WHERE user_id = ? AND currency = ?
    `).get(req.userId, currency.toUpperCase());

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    res.json({
      success: true,
      data: {
        asset: wallet.currency,
        free: wallet.balance,
        locked: wallet.locked,
        total: wallet.balance + wallet.locked
      }
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Deposit (generate address simulation)
app.post('/api/v1/wallet/deposit', authenticateRequest, (req, res) => {
  try {
    const { currency, network } = req.body;

    if (!currency) {
      return res.status(400).json({ success: false, error: 'Missing currency' });
    }

    // Generate mock deposit address
    const address = `0x${uuidv4().replace(/-/g, '').substring(0, 40)}`;
    const txId = uuidv4();

    // Record transaction
    const txIdDb = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, status, tx_hash, address)
      VALUES (?, ?, 'deposit', ?, 0, 'pending', ?, ?)
    `).run(txIdDb, req.userId, currency.toUpperCase(), txId, address);

    res.json({
      success: true,
      data: {
        address,
        currency: currency.toUpperCase(),
        network: network || 'ETH',
        txId,
        url: `https://etherscan.io/tx/${txId}`
      }
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Withdraw
app.post('/api/v1/wallet/withdraw', authenticateRequest, async (req, res) => {
  try {
    const { currency, amount, address, network } = req.body;

    if (!currency || !amount || !address) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    // Check balance
    const wallet = db.prepare(`
      SELECT * FROM wallets WHERE user_id = ? AND currency = ?
    `).get(req.userId, currency.toUpperCase());

    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ success: false, error: 'Insufficient balance' });
    }

    // Deduct balance
    db.prepare(`
      UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?
    `).run(amount, wallet.id);

    // Record transaction
    const txId = uuidv4();
    const dbTxId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, status, tx_hash, address)
      VALUES (?, ?, 'withdraw', ?, ?, 'pending', ?, ?)
    `).run(dbTxId, req.userId, currency.toUpperCase(), -amount, txId, address);

    res.json({
      success: true,
      data: {
        id: dbTxId,
        currency: currency.toUpperCase(),
        amount,
        address,
        network: network || 'ETH',
        txId,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Transfer (internal)
app.post('/api/v1/wallet/transfer', authenticateRequest, async (req, res) => {
  try {
    const { currency, amount, toUsername } = req.body;

    if (!currency || !amount || !toUsername) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Find recipient
    const recipient = db.prepare('SELECT id FROM users WHERE username = ?').get(toUsername);
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'Recipient not found' });
    }

    if (recipient.id === req.userId) {
      return res.status(400).json({ success: false, error: 'Cannot transfer to yourself' });
    }

    // Check balance
    const senderWallet = db.prepare(`
      SELECT * FROM wallets WHERE user_id = ? AND currency = ?
    `).get(req.userId, currency.toUpperCase());

    if (!senderWallet || senderWallet.balance < amount) {
      return res.status(400).json({ success: false, error: 'Insufficient balance' });
    }

    // Deduct from sender
    db.prepare(`
      UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?
    `).run(amount, senderWallet.id);

    // Add to recipient
    const recipientWallet = db.prepare(`
      SELECT * FROM wallets WHERE user_id = ? AND currency = ?
    `).get(recipient.id, currency.toUpperCase());

    if (recipientWallet) {
      db.prepare(`
        UPDATE wallets SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?
      `).run(amount, recipientWallet.id);
    } else {
      db.prepare(`
        INSERT INTO wallets (id, user_id, currency, balance) VALUES (?, ?, ?, ?)
      `).run(uuidv4(), recipient.id, currency.toUpperCase(), amount);
    }

    // Record transactions
    const txId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, status, address)
      VALUES (?, ?, 'transfer_out', ?, ?, 'completed', ?)
    `).run(uuidv4(), req.userId, currency.toUpperCase(), -amount, toUsername);

    db.prepare(`
      INSERT INTO transactions (id, user_id, type, currency, amount, status, address)
      VALUES (?, ?, 'transfer_in', ?, ?, 'completed', ?)
    `).run(uuidv4(), recipient.id, currency.toUpperCase(), amount, req.body.username);

    res.json({
      success: true,
      data: { message: 'Transfer completed', amount, currency: currency.toUpperCase(), to: toUsername }
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get transaction history
app.get('/api/v1/wallet/history', authenticateRequest, (req, res) => {
  try {
    const { currency, type, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.userId];

    if (currency) {
      query += ' AND currency = ?';
      params.push(currency.toUpperCase());
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const transactions = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: {
        rows: transactions.map(t => ({
          id: t.id,
          type: t.type,
          currency: t.currency,
          amount: t.amount,
          status: t.status,
          address: t.address,
          txHash: t.tx_hash,
          createdAt: t.created_at
        })),
        total: transactions.length
      }
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// TRADING ROUTES
// ============================================================================

// Get market info
app.get('/api/v1/exchange/info', (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (symbol) {
      const market = db.prepare('SELECT * FROM markets WHERE symbol = ?').get(symbol.toUpperCase());
      if (!market) {
        return res.status(404).json({ success: false, error: 'Market not found' });
      }
      return res.json({ success: true, data: market });
    }

    const markets = db.prepare('SELECT * FROM markets').all();
    res.json({ success: true, data: markets });
  } catch (error) {
    console.error('Get exchange info error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get order book
app.get('/api/v1/orderbook', (req, res) => {
  try {
    const { symbol, limit = 100 } = req.query;

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }

    // Get recent trades to build order book
    const trades = db.prepare(`
      SELECT * FROM trades WHERE symbol = ? ORDER BY created_at DESC LIMIT ?
    `).all(symbol.toUpperCase(), parseInt(limit) * 2);

    // Build mock order book from recent trades
    const bids = [];
    const asks = [];
    
    trades.forEach(trade => {
      if (trade.side === 'buy') {
        bids.push({ price: trade.price, quantity: trade.quantity });
      } else {
        asks.push({ price: trade.price, quantity: trade.quantity });
      }
    });

    // Sort and aggregate
    const aggregate = (orders) => {
      const agg = {};
      orders.forEach(o => {
        agg[o.price] = (agg[o.price] || 0) + o.quantity;
      });
      return Object.entries(agg).map(([p, q]) => ({ price: parseFloat(p), quantity: q }));
    };

    res.json({
      success: true,
      data: {
        symbol: symbol.toUpperCase(),
        lastUpdateId: Date.now(),
        bids: aggregate(bids).sort((a, b) => b.price - a.price).slice(0, parseInt(limit)),
        asks: aggregate(asks).sort((a, b) => a.price - b.price).slice(0, parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get order book error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get recent trades
app.get('/api/v1/trades', (req, res) => {
  try {
    const { symbol, limit = 100 } = req.query;

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }

    const trades = db.prepare(`
      SELECT * FROM trades WHERE symbol = ? ORDER BY created_at DESC LIMIT ?
    `).all(symbol.toUpperCase(), parseInt(limit));

    res.json({
      success: true,
      data: trades.map(t => ({
        id: t.id,
        price: t.price,
        qty: t.quantity,
        time: new Date(t.created_at).getTime(),
        isBuyerMaker: t.side === 'sell'
      }))
    });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get klines/candlesticks
app.get('/api/v1/klines', (req, res) => {
  try {
    const { symbol, interval = '1m', limit = 500 } = req.query;

    if (!symbol) {
      return res.status(400).json({ success: false, error: 'Missing symbol' });
    }

    // Generate mock klines
    const klines = [];
    const now = Date.now();
    const intervalMs = {
      '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
      '1h': 3600000, '4h': 14400000, '1d': 86400000
    }[interval] || 60000;

    // Base price from known prices
    const basePrices = {
      'BTCUSDT': 65000, 'ETHUSDT': 3500, 'BNBUSDT': 600,
      'TGRUSDT': 1.5, 'SOLUSDT': 150, 'XRPUSDT': 0.6,
      'ADAUSDT': 0.5, 'DOGEUSDT': 0.15
    };
    let basePrice = basePrices[symbol.toUpperCase()] || 100;

    for (let i = parseInt(limit); i > 0; i--) {
      const time = now - (i * intervalMs);
      const variance = basePrice * 0.02;
      const open = basePrice + (Math.random() - 0.5) * variance;
      const close = open + (Math.random() - 0.5) * variance;
      const high = Math.max(open, close) + Math.random() * variance * 0.5;
      const low = Math.min(open, close) - Math.random() * variance * 0.5;
      const volume = Math.random() * 1000;

      klines.push([
        Math.floor(time / 1000),
        open.toFixed(2),
        high.toFixed(2),
        low.toFixed(2),
        close.toFixed(2),
        volume.toFixed(2),
        Math.floor(time / 1000),
        volume.toFixed(2),
        0, 0, 0, 0
      ]);
    }

    res.json({ success: true, data: klines });
  } catch (error) {
    console.error('Get klines error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get 24hr ticker
app.get('/api/v1/ticker/24hr', (req, res) => {
  try {
    const { symbol } = req.query;

    const basePrices = {
      'BTCUSDT': { price: 65000, change: 2.5, high: 66000, low: 64000, volume: 50000 },
      'ETHUSDT': { price: 3500, change: 1.8, high: 3600, low: 3400, volume: 100000 },
      'BNBUSDT': { price: 600, change: -0.5, high: 610, low: 590, volume: 20000 },
      'TGRUSDT': { price: 1.5, change: 5.2, high: 1.6, low: 1.4, volume: 1000000 },
      'SOLUSDT': { price: 150, change: 3.1, high: 155, low: 145, volume: 50000 },
      'XRPUSDT': { price: 0.6, change: -1.2, high: 0.62, low: 0.58, volume: 80000 },
      'ADAUSDT': { price: 0.5, change: 0.8, high: 0.52, low: 0.48, volume: 30000 },
      'DOGEUSDT': { price: 0.15, change: 4.5, high: 0.16, low: 0.14, volume: 200000 }
    };

    if (symbol) {
      const data = basePrices[symbol.toUpperCase()];
      if (!data) {
        return res.status(404).json({ success: false, error: 'Symbol not found' });
      }
      return res.json({
        success: true,
        data: {
          symbol: symbol.toUpperCase(),
          lastPrice: data.price.toString(),
          priceChange: (data.price * data.change / 100).toString(),
          priceChangePercent: data.change.toString(),
          highPrice: data.high.toString(),
          lowPrice: data.low.toString(),
          volume: data.volume.toString(),
          quoteVolume: (data.volume * data.price).toString()
        }
      });
    }

    // Return all tickers
    const tickers = Object.entries(basePrices).map(([sym, data]) => ({
      symbol: sym,
      lastPrice: data.price.toString(),
      priceChange: (data.price * data.change / 100).toString(),
      priceChangePercent: data.change.toString(),
      highPrice: data.high.toString(),
      lowPrice: data.low.toString(),
      volume: data.volume.toString(),
      quoteVolume: (data.volume * data.price).toString()
    }));

    res.json({ success: true, data: tickers });
  } catch (error) {
    console.error('Get 24hr ticker error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Place order
app.post('/api/v1/order', authenticateRequest, (req, res) => {
  try {
    const { symbol, side, type, quantity, price } = req.body;

    if (!symbol || !side || !type || !quantity) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ success: false, error: 'Invalid side' });
    }

    if (!['limit', 'market'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid order type' });
    }

    // Get user wallet for quote currency (e.g., USDT from BTCUSDT)
    const base = symbol.slice(0, -4);
    const quoteCurrency = symbol.slice(-4);
    
    const wallet = db.prepare(`
      SELECT * FROM wallets WHERE user_id = ? AND currency = ?
    `).get(req.userId, quoteCurrency);

    if (!wallet) {
      return res.status(400).json({ success: false, error: 'Wallet not found' });
    }

    // Calculate order value
    const orderPrice = type === 'market' ? 
      (basePrices[symbol.toUpperCase()]?.price || 100) : 
      parseFloat(price);
    const orderValue = orderPrice * parseFloat(quantity);

    // Check balance for buy orders
    if (side === 'buy' && wallet.balance < orderValue) {
      return res.status(400).json({ success: false, error: 'Insufficient balance' });
    }

    // Deduct balance for buy orders
    if (side === 'buy') {
      db.prepare(`
        UPDATE wallets SET balance = balance - ?, locked = locked + ?, updated_at = datetime('now') WHERE id = ?
      `).run(orderValue, orderValue, wallet.id);
    } else {
      // For sell orders, check base currency balance
      const baseWallet = db.prepare(`
        SELECT * FROM wallets WHERE user_id = ? AND currency = ?
      `).get(req.userId, base);

      if (!baseWallet || baseWallet.balance < parseFloat(quantity)) {
        return res.status(400).json({ success: false, error: 'Insufficient balance' });
      }

      db.prepare(`
        UPDATE wallets SET balance = balance - ?, locked = locked + ?, updated_at = datetime('now') WHERE id = ?
      `).run(parseFloat(quantity), parseFloat(quantity), baseWallet.id);
    }

    // Create order
    const orderId = uuidv4();
    db.prepare(`
      INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(orderId, req.userId, symbol.toUpperCase(), side, type, orderPrice, parseFloat(quantity));

    // Simulate order execution for market orders
    if (type === 'market') {
      // Execute immediately
      const tradeId = uuidv4();
      db.prepare(`
        INSERT INTO trades (id, symbol, price, quantity, side) VALUES (?, ?, ?, ?, ?)
      `).run(tradeId, symbol.toUpperCase(), orderPrice, parseFloat(quantity), side);

      // Update order status
      db.prepare(`
        UPDATE orders SET filled_quantity = quantity, status = 'filled', updated_at = datetime('now') WHERE id = ?
      `).run(orderId);

      // Update wallet balances
      if (side === 'buy') {
        // Release the locked quote currency (USDT) - the orderValue was already deducted from balance
        // and locked, now we release the lock
        db.prepare(`
          UPDATE wallets SET locked = locked - ?, updated_at = datetime('now') WHERE id = ?
        `).run(orderValue, wallet.id);
        
        // Add the base currency (BTC) to buyer
        const baseWallet = db.prepare(`
          SELECT * FROM wallets WHERE user_id = ? AND currency = ?
        `).get(req.userId, base);
        
        if (baseWallet) {
          db.prepare(`
            UPDATE wallets SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?
          `).run(parseFloat(quantity), baseWallet.id);
        } else {
          db.prepare(`
            INSERT INTO wallets (id, user_id, currency, balance) VALUES (?, ?, ?, ?)
          `).run(uuidv4(), req.userId, base, parseFloat(quantity));
        }
      } else {
        // For sell orders: release locked base currency and add quote currency
        db.prepare(`
          UPDATE wallets SET locked = locked - ?, updated_at = datetime('now') WHERE id = ?
        `).run(parseFloat(quantity), wallet.id);
        
        // Add the quote currency (USDT) to seller
        db.prepare(`
          UPDATE wallets SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?
        `).run(orderValue, wallet.id);
      }
    }

    res.json({
      success: true,
      data: {
        orderId,
        symbol: symbol.toUpperCase(),
        side,
        type,
        price: orderPrice.toString(),
        quantity: quantity.toString(),
        status: type === 'market' ? 'filled' : 'pending',
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Place order error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get open orders
app.get('/api/v1/openOrders', authenticateRequest, (req, res) => {
  try {
    const { symbol } = req.query;

    let query = 'SELECT * FROM orders WHERE user_id = ? AND status = "pending"';
    const params = [req.userId];

    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol.toUpperCase());
    }

    query += ' ORDER BY created_at DESC';

    const orders = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: orders.map(o => ({
        orderId: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: o.price,
        origQty: o.quantity,
        executedQty: o.filled_quantity,
        status: o.status,
        createdTime: new Date(o.created_at).getTime()
      }))
    });
  } catch (error) {
    console.error('Get open orders error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get order history
app.get('/api/v1/allOrders', authenticateRequest, (req, res) => {
  try {
    const { symbol, limit = 100 } = req.query;

    let query = 'SELECT * FROM orders WHERE user_id = ?';
    const params = [req.userId];

    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol.toUpperCase());
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const orders = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: orders.map(o => ({
        orderId: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: o.price,
        origQty: o.quantity,
        executedQty: o.filled_quantity,
        status: o.status,
        createdTime: new Date(o.created_at).getTime()
      }))
    });
  } catch (error) {
    console.error('Get order history error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Cancel order
app.delete('/api/v1/order', authenticateRequest, (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Missing order ID' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.userId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Order cannot be cancelled' });
    }

    // Cancel order
    db.prepare('UPDATE orders SET status = "cancelled", updated_at = datetime("now") WHERE id = ?').run(orderId);

    // Release locked funds
    const quoteCurrency = order.symbol.replace(/[A-Z]+$/, '');
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
      .get(req.userId, quoteCurrency);

    if (wallet && order.side === 'buy') {
      const lockedAmount = order.price * order.quantity;
      db.prepare(`
        UPDATE wallets SET balance = balance + ?, locked = locked - ?, updated_at = datetime('now') WHERE id = ?
      `).run(lockedAmount, lockedAmount, wallet.id);
    } else if (wallet && order.side === 'sell') {
      db.prepare(`
        UPDATE wallets SET balance = balance + ?, locked = locked - ?, updated_at = datetime('now') WHERE id = ?
      `).run(order.quantity, order.quantity, wallet.id);
    }

    res.json({ success: true, data: { orderId, status: 'cancelled' } });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// USER MANAGEMENT ROUTES
// ============================================================================

// Get user profile
app.get('/api/v1/user/profile', authenticateRequest, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        username: user.username,
        kycLevel: user.kyc_level,
        country: user.country,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update user profile
app.put('/api/v1/user/profile', authenticateRequest, (req, res) => {
  try {
    const { country } = req.body;

    db.prepare('UPDATE users SET country = ?, updated_at = datetime("now") WHERE id = ?')
      .run(country, req.userId);

    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Change password
app.post('/api/v1/user/change-password', authenticateRequest, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Missing passwords' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId);
    const validPassword = await bcrypt.compare(oldPassword, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?')
      .run(newHash, req.userId);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Enable 2FA
app.post('/api/v1/user/2fa/enable', authenticateRequest, (req, res) => {
  try {
    const { secret } = req.body;

    db.prepare('UPDATE users SET two_fa_enabled = 1, two_fa_secret = ?, updated_at = datetime("now") WHERE id = ?')
      .run(secret, req.userId);

    res.json({ success: true, message: '2FA enabled' });
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Disable 2FA
app.post('/api/v1/user/2fa/disable', authenticateRequest, async (req, res) => {
  try {
    const { password } = req.body;

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId);
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }

    db.prepare('UPDATE users SET two_fa_enabled = 0, two_fa_secret = NULL, updated_at = datetime("now") WHERE id = ?')
      .run(req.userId);

    res.json({ success: true, message: '2FA disabled' });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// API KEY MANAGEMENT
// ============================================================================

// Create API key
app.post('/api/v1/apiKey', authenticateRequest, (req, res) => {
  try {
    const { label, permissions } = req.body;

    const apiKey = uuidv4().replace(/-/g, '');
    const apiSecret = uuidv4() + uuidv4();

    const keyId = uuidv4();
    db.prepare(`
      INSERT INTO api_keys (id, user_id, key, secret, permissions) VALUES (?, ?, ?, ?, ?)
    `).run(keyId, req.userId, apiKey, apiSecret, permissions || 'read');

    res.json({
      success: true,
      data: {
        keyId,
        apiKey,
        apiSecret: apiSecret.substring(0, 8) + '****************',
        permissions: permissions || 'read',
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get API keys
app.get('/api/v1/apiKey', authenticateRequest, (req, res) => {
  try {
    const keys = db.prepare('SELECT id, key, permissions, enabled, created_at FROM api_keys WHERE user_id = ?')
      .all(req.userId);

    res.json({
      success: true,
      data: keys.map(k => ({
        keyId: k.id,
        apiKey: k.key.substring(0, 8) + '****************',
        permissions: k.permissions,
        enabled: !!k.enabled,
        createdAt: k.created_at
      }))
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Delete API key
app.delete('/api/v1/apiKey', authenticateRequest, (req, res) => {
  try {
    const { keyId } = req.body;

    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(keyId, req.userId);
    res.json({ success: true, message: 'API key deleted' });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// WEBSOCKET HANDLERS
// ============================================================================

// Store connected clients
const wsClients = new Map();

io.on('connection', (socket) => {
  console.log('WebSocket client connected:', socket.id);

  socket.on('subscribe', (data) => {
    const { channel, symbol } = data;
    socket.join(`${channel}:${symbol}`);
    console.log(`Client ${socket.id} subscribed to ${channel}:${symbol}`);
  });

  socket.on('unsubscribe', (data) => {
    const { channel, symbol } = data;
    socket.leave(`${channel}:${symbol}`);
  });

  socket.on('authenticate', (token) => {
    const decoded = verifyToken(token, 'access');
    if (decoded) {
      wsClients.set(socket.id, decoded.userId);
      socket.emit('authenticated');
    }
  });

  socket.on('disconnect', () => {
    wsClients.delete(socket.id);
    console.log('WebSocket client disconnected:', socket.id);
  });
});

// Simulate market data updates
setInterval(() => {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'TGRUSDT', 'SOLUSDT'];
  
  symbols.forEach(symbol => {
    const basePrices = { 'BTCUSDT': 65000, 'ETHUSDT': 3500, 'BNBUSDT': 600, 'TGRUSDT': 1.5, 'SOLUSDT': 150 };
    const basePrice = basePrices[symbol];
    const variance = basePrice * 0.001;
    const price = basePrice + (Math.random() - 0.5) * variance;
    
    io.emit('ticker', {
      symbol,
      lastPrice: price.toFixed(2),
      priceChange: (Math.random() - 0.5).toFixed(2),
      priceChangePercent: (Math.random() - 0.5).toFixed(2),
      highPrice: (price * 1.01).toFixed(2),
      lowPrice: (price * 0.99).toFixed(2),
      volume: (Math.random() * 10000).toFixed(2)
    });

    io.emit('depth', {
      symbol,
      bids: [
        { price: (price * 0.999).toFixed(2), quantity: (Math.random() * 10).toFixed(4) },
        { price: (price * 0.998).toFixed(2), quantity: (Math.random() * 10).toFixed(4) }
      ],
      asks: [
        { price: (price * 1.001).toFixed(2), quantity: (Math.random() * 10).toFixed(4) },
        { price: (price * 1.002).toFixed(2), quantity: (Math.random() * 10).toFixed(4) }
      ]
    });
  });
}, 1000);

// ============================================================================
// HEALTH CHECK & METRICS
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

app.get('/api/v1/time', (req, res) => {
  res.json({ 
    success: true, 
    serverTime: Date.now() 
  });
});

// ============================================================================
// ERROR HANDLERS
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// ============================================================================
// SERVER START
// ============================================================================

// Base prices for calculations
const basePrices = {
  'BTCUSDT': 65000, 'ETHUSDT': 3500, 'BNBUSDT': 600,
  'TGRUSDT': 1.5, 'SOLUSDT': 150, 'XRPUSDT': 0.6,
  'ADAUSDT': 0.5, 'DOGEUSDT': 0.15
};

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🐯 TigerEx Backend Server v1.0.0                           ║
║                                                               ║
║   Server running on port ${PORT}                               ║
║   WebSocket enabled                                           ║
║   Database: ${dbPath.includes(':memory:') ? 'In-Memory' : 'SQLite'}                                      ║
║                                                               ║
║   Endpoints:                                                  ║
║   - REST API:  http://localhost:${PORT}/api/v1/*             ║
║   - WebSocket: ws://localhost:${PORT}                         ║
║   - Health:    http://localhost:${PORT}/health               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server, db };
