/**
 * TigerEx Phase 2: Advanced Market Data & Trading Features
 * Includes orderbook, real-time data, copy trading, staking
 */

// ============================================================================
// ADVANCED MARKET DATA TABLES
// ============================================================================

function addMarketDataTables() {
  // Order book snapshots (for historical analysis)
  db.exec(`
    CREATE TABLE IF NOT EXISTS orderbook_snapshots (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_symbol_timestamp (symbol, timestamp)
    )
  `);

  // Kline data (candlestick data)
  db.exec(`
    CREATE TABLE IF NOT EXISTS klines (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      open_time TEXT NOT NULL,
      close_time TEXT NOT NULL,
      open_price REAL NOT NULL,
      close_price REAL NOT NULL,
      high_price REAL NOT NULL,
      low_price REAL NOT NULL,
      base_asset_volume REAL NOT NULL,
      quote_asset_volume REAL NOT NULL,
      taker_buy_base_asset_volume REAL DEFAULT 0,
      taker_buy_quote_asset_volume REAL DEFAULT 0,
      number_of_trades INTEGER DEFAULT 0,
      UNIQUE(symbol, interval, open_time)
    )
  `);

  // Copy trading followers/leaders
  db.exec(`
    CREATE TABLE IF NOT EXISTS copy_trading (
      id TEXT PRIMARY KEY,
      leader_id TEXT NOT NULL,
      follower_id TEXT NOT NULL,
      allocation_percentage REAL NOT NULL,
      status TEXT DEFAULT 'active',
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paused_at TEXT,
      performance REAL DEFAULT 0,
      FOREIGN KEY (leader_id) REFERENCES users(id),
      FOREIGN KEY (follower_id) REFERENCES users(id),
      UNIQUE(leader_id, follower_id)
    )
  `);

  // Staking positions
  db.exec(`
    CREATE TABLE IF NOT EXISTS staking_positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount REAL NOT NULL,
      staking_rate REAL NOT NULL,
      lock_days INTEGER DEFAULT 0,
      locked_until TEXT,
      earned REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Price alerts
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      target_price REAL NOT NULL,
      condition TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      triggered_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_klines_symbol_interval ON klines(symbol, interval)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_copy_trading_leader ON copy_trading(leader_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_copy_trading_follower ON copy_trading(follower_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staking_user ON staking_positions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id)`);

  console.log('✅ Market data tables created');
}

// ============================================================================
// STAKING SYSTEM
// ============================================================================

const STAKING_PRODUCTS = {
  'BTC': {
    name: 'Bitcoin Staking',
    minAmount: 0.001,
    rates: {
      flexible: 0.02,    // 2% annual
      '30days': 0.04,    // 4% annual
      '90days': 0.08,    // 8% annual
      '180days': 0.12,   // 12% annual
      '365days': 0.15    // 15% annual
    }
  },
  'ETH': {
    name: 'Ethereum Staking',
    minAmount: 0.01,
    rates: {
      flexible: 0.03,
      '30days': 0.05,
      '90days': 0.10,
      '180days': 0.14,
      '365days': 0.18
    }
  },
  'SOL': {
    name: 'Solana Staking',
    minAmount: 1,
    rates: {
      flexible: 0.04,
      '30days': 0.06,
      '90days': 0.12,
      '180days': 0.16,
      '365days': 0.20
    }
  },
  'BNBUSDT': {
    name: 'BNB Staking',
    minAmount: 0.01,
    rates: {
      flexible: 0.025,
      '30days': 0.045,
      '90days': 0.09,
      '180days': 0.13,
      '365days': 0.17
    }
  },
  'USDT': {
    name: 'USDT Lending',
    minAmount: 100,
    rates: {
      flexible: 0.08,
      '30days': 0.10,
      '90days': 0.15,
      '180days': 0.18,
      '365days': 0.22
    }
  }
};

/**
 * Create staking position
 */
function createStakingPosition(userId, asset, amount, lockDays = 0) {
  try {
    const product = STAKING_PRODUCTS[asset];
    if (!product || amount < product.minAmount) {
      return { success: false, error: 'Invalid staking product or amount' };
    }

    // Determine rate based on lock period
    let rate;
    if (lockDays === 0) {
      rate = product.rates.flexible;
    } else if (lockDays <= 30) {
      rate = product.rates['30days'];
    } else if (lockDays <= 90) {
      rate = product.rates['90days'];
    } else if (lockDays <= 180) {
      rate = product.rates['180days'];
    } else {
      rate = product.rates['365days'];
    }

    // Lock wallet balance
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
      .get(userId, asset);
    if (!wallet || wallet.balance < amount) {
      return { success: false, error: 'Insufficient balance' };
    }

    // Deduct from balance and add to locked
    db.prepare('UPDATE wallets SET balance = balance - ?, locked = locked + ? WHERE id = ?')
      .run(amount, amount, wallet.id);

    // Create staking position
    const positionId = uuidv4();
    const lockedUntil = lockDays > 0 ? new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000).toISOString() : null;

    db.prepare(`
      INSERT INTO staking_positions (id, user_id, asset, amount, staking_rate, lock_days, locked_until)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(positionId, userId, asset, amount, rate, lockDays, lockedUntil);

    return {
      success: true,
      data: {
        positionId,
        asset,
        amount: amount.toString(),
        rate: (rate * 100).toFixed(2) + '%',
        lockDays,
        estimatedDaily: (amount * rate / 365).toString()
      }
    };
  } catch (error) {
    console.error('Staking error:', error);
    return { success: false, error: 'Internal server error' };
  }
}

/**
 * Calculate and distribute staking rewards
 */
function distributeStakingRewards() {
  try {
    const positions = db.prepare('SELECT * FROM staking_positions WHERE status = "active"').all();

    positions.forEach(position => {
      // Calculate daily reward
      const dailyReward = (position.amount * position.staking_rate) / 365;

      // Update position
      db.prepare('UPDATE staking_positions SET earned = earned + ? WHERE id = ?')
        .run(dailyReward, position.id);

      // Check if lock period ended
      if (position.locked_until && new Date(position.locked_until) <= new Date()) {
        db.prepare('UPDATE staking_positions SET status = "completed", ended_at = datetime("now") WHERE id = ?')
          .run(position.id);

        // Return to wallet
        const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
          .get(position.user_id, position.asset);
        if (wallet) {
          const totalReturn = position.amount + position.earned;
          db.prepare('UPDATE wallets SET balance = balance + ?, locked = locked - ? WHERE id = ?')
            .run(totalReturn, position.amount, wallet.id);
        }
      }
    });

    console.log('✅ Staking rewards distributed');
  } catch (error) {
    console.error('Error distributing rewards:', error);
  }
}

// ============================================================================
// KLINE/CANDLESTICK DATA
// ============================================================================

/**
 * Generate kline data from trades
 */
function generateKlineData(symbol, interval = '1h') {
  try {
    // Get start time based on interval
    let intervalMs;
    switch (interval) {
      case '1m': intervalMs = 60 * 1000; break;
      case '5m': intervalMs = 5 * 60 * 1000; break;
      case '1h': intervalMs = 60 * 60 * 1000; break;
      case '4h': intervalMs = 4 * 60 * 60 * 1000; break;
      case '1d': intervalMs = 24 * 60 * 60 * 1000; break;
      default: intervalMs = 60 * 60 * 1000;
    }

    const now = new Date();
    const startTime = new Date(now.getTime() - intervalMs);

    // Get trades in this interval
    const trades = db.prepare(`
      SELECT price, quantity FROM trades
      WHERE symbol = ? AND created_at >= ?
      ORDER BY created_at ASC
    `).all(symbol, startTime.toISOString());

    if (trades.length === 0) return null;

    const openPrice = trades[0].price;
    const closePrice = trades[trades.length - 1].price;
    const prices = trades.map(t => t.price);
    const highPrice = Math.max(...prices);
    const lowPrice = Math.min(...prices);
    const volume = trades.reduce((sum, t) => sum + t.quantity, 0);
    const quoteVolume = trades.reduce((sum, t) => sum + (t.quantity * t.price), 0);

    // Save kline
    const klineId = uuidv4();
    db.prepare(`
      INSERT INTO klines (id, symbol, interval, open_time, close_time, open_price, close_price, high_price, low_price, base_asset_volume, quote_asset_volume, number_of_trades)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      klineId,
      symbol,
      interval,
      startTime.toISOString(),
      now.toISOString(),
      openPrice,
      closePrice,
      highPrice,
      lowPrice,
      volume,
      quoteVolume,
      trades.length
    );

    return {
      symbol,
      interval,
      openTime: startTime.getTime(),
      closeTime: now.getTime(),
      open: openPrice.toString(),
      high: highPrice.toString(),
      low: lowPrice.toString(),
      close: closePrice.toString(),
      volume: volume.toString(),
      quoteAssetVolume: quoteVolume.toString(),
      trades: trades.length
    };
  } catch (error) {
    console.error('Error generating kline data:', error);
    return null;
  }
}

// ============================================================================
// API ENDPOINTS FOR MARKET DATA & FEATURES (Add to server/index.js)
// ============================================================================

const marketDataEndpoints = {
  // Get staking products
  getStakingProducts: \`
    app.get('/api/v1/staking/products', (req, res) => {
      try {
        const products = Object.entries(STAKING_PRODUCTS).map(([asset, details]) => ({
          asset,
          name: details.name,
          minAmount: details.minAmount.toString(),
          rates: Object.entries(details.rates).reduce((acc, [period, rate]) => {
            acc[period] = (rate * 100).toFixed(2) + '%';
            return acc;
          }, {})
        }));

        res.json({ success: true, data: products });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Create staking position
  startStaking: \`
    app.post('/api/v1/staking/start', authenticateRequest, (req, res) => {
      try {
        const { asset, amount, lockDays = 0 } = req.body;
        const result = createStakingPosition(req.userId, asset, amount, lockDays);
        
        if (result.success) {
          res.json({ success: true, data: result.data });
        } else {
          res.status(400).json({ success: false, error: result.error });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get staking positions
  getStakingPositions: \`
    app.get('/api/v1/staking/positions', authenticateRequest, (req, res) => {
      try {
        const positions = db.prepare(\`
          SELECT * FROM staking_positions WHERE user_id = ?
          ORDER BY started_at DESC
        \`).all(req.userId);

        res.json({
          success: true,
          data: positions.map(p => ({
            id: p.id,
            asset: p.asset,
            amount: p.amount.toString(),
            earned: p.earned.toString(),
            rate: (p.staking_rate * 100).toFixed(2) + '%',
            lockDays: p.lock_days,
            lockedUntil: p.locked_until,
            status: p.status,
            startedAt: p.started_at
          }))
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get kline data
  getKlines: \`
    app.get('/api/v1/klines', (req, res) => {
      try {
        const { symbol, interval = '1h', limit = 100 } = req.query;

        if (!symbol) {
          return res.status(400).json({ success: false, error: 'Symbol required' });
        }

        const klines = db.prepare(\`
          SELECT * FROM klines
          WHERE symbol = ? AND interval = ?
          ORDER BY open_time DESC
          LIMIT ?
        \`).all(symbol.toUpperCase(), interval, Math.min(limit, 1000));

        res.json({
          success: true,
          data: klines.map(k => [
            new Date(k.open_time).getTime(),
            k.open_price.toString(),
            k.high_price.toString(),
            k.low_price.toString(),
            k.close_price.toString(),
            k.base_asset_volume.toString()
          ])
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Create price alert
  createPriceAlert: \`
    app.post('/api/v1/alerts/price', authenticateRequest, (req, res) => {
      try {
        const { symbol, targetPrice, condition = 'above' } = req.body;

        if (!symbol || !targetPrice || !['above', 'below'].includes(condition)) {
          return res.status(400).json({ success: false, error: 'Missing or invalid parameters' });
        }

        const alertId = uuidv4();
        db.prepare(\`
          INSERT INTO price_alerts (id, user_id, symbol, target_price, condition, status)
          VALUES (?, ?, ?, ?, ?, 'active')
        \`).run(alertId, req.userId, symbol.toUpperCase(), targetPrice, condition);

        res.json({
          success: true,
          data: { alertId, symbol, targetPrice, condition }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

module.exports = {
  addMarketDataTables,
  STAKING_PRODUCTS,
  createStakingPosition,
  distributeStakingRewards,
  generateKlineData,
  marketDataEndpoints
};
