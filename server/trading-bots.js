/**
 * TigerEx Phase 2: Trading Bots & Automated Strategies
 * Grid trading, DCA, TWAP, Signal-based trading
 */

// ============================================================================
// TRADING BOTS DATABASE TABLES
// ============================================================================

function addTradingBotTables() {
  // Trading bot configurations
  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bot_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      status TEXT DEFAULT 'stopped',
      base_asset TEXT,
      quote_asset TEXT,
      config TEXT NOT NULL,
      performance REAL DEFAULT 0,
      trades_count INTEGER DEFAULT 0,
      profit_loss REAL DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      losing_trades INTEGER DEFAULT 0,
      win_rate REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      stopped_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Bot trades executed
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_trades (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      cost REAL NOT NULL,
      fee REAL DEFAULT 0,
      profit_loss REAL DEFAULT 0,
      status TEXT DEFAULT 'executed',
      executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bot_id) REFERENCES trading_bots(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Trading signals (for signal-based bots)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trading_signals (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      strength REAL NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      INDEX idx_symbol_time (symbol, created_at)
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bots_user ON trading_bots(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bots_status ON trading_bots(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bot_trades_bot ON bot_trades(bot_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bot_trades_user ON bot_trades(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_signals_symbol ON trading_signals(symbol)`);

  console.log('✅ Trading bot tables created');
}

// ============================================================================
// BOT TYPES & CONFIGURATIONS
// ============================================================================

const BOT_TYPES = {
  GRID: {
    name: 'Grid Trading',
    description: 'Buy at grid levels, sell at higher levels',
    params: ['gridCount', 'minPrice', 'maxPrice', 'investAmount']
  },
  DCA: {
    name: 'Dollar-Cost Averaging',
    description: 'Buy fixed amount at regular intervals',
    params: ['investAmount', 'interval', 'maxPosition']
  },
  TWAP: {
    name: 'Time-Weighted Average Price',
    description: 'Execute order gradually over time',
    params: ['totalAmount', 'executionTime', 'orderSize']
  },
  SIGNAL: {
    name: 'Signal-Based',
    description: 'Trade based on technical signals',
    params: ['signalSource', 'riskPerTrade', 'maxPosition']
  },
  MOMENTUM: {
    name: 'Momentum Trading',
    description: 'Trade on price momentum',
    params: ['period', 'threshold', 'positionSize']
  }
};

// ============================================================================
// GRID TRADING ENGINE
// ============================================================================

/**
 * Create grid trading bot
 */
function createGridBot(userId, symbol, gridCount, minPrice, maxPrice, investAmount) {
  try {
    const pair = TRADING_PAIRS.find(p => p.symbol === symbol);
    if (!pair) return { success: false, error: 'Symbol not found' };

    const gridPrices = [];
    const step = (maxPrice - minPrice) / (gridCount - 1);
    for (let i = 0; i < gridCount; i++) {
      gridPrices.push(minPrice + (i * step));
    }

    const quantityPerGrid = investAmount / gridCount / minPrice;

    const config = {
      gridCount,
      minPrice,
      maxPrice,
      investAmount,
      gridPrices,
      quantityPerGrid,
      buyOrders: [],
      sellOrders: []
    };

    const botId = uuidv4();
    db.prepare(`
      INSERT INTO trading_bots (id, user_id, name, bot_type, symbol, status, config)
      VALUES (?, ?, ?, 'GRID', ?, 'stopped', ?)
    `).run(botId, userId, `Grid-${symbol}`, symbol, JSON.stringify(config));

    return {
      success: true,
      data: {
        botId,
        name: `Grid-${symbol}`,
        symbol,
        gridCount,
        investAmount: investAmount.toString(),
        gridPrices: gridPrices.map(p => p.toString())
      }
    };
  } catch (error) {
    console.error('Grid bot creation error:', error);
    return { success: false, error: 'Internal server error' };
  }
}

/**
 * Create DCA (Dollar-Cost Averaging) bot
 */
function createDCABot(userId, symbol, investAmount, intervalMinutes, maxPosition) {
  try {
    const pair = TRADING_PAIRS.find(p => p.symbol === symbol);
    if (!pair) return { success: false, error: 'Symbol not found' };

    const config = {
      investAmount,
      intervalMinutes,
      maxPosition,
      nextExecutionTime: Date.now() + intervalMinutes * 60 * 1000,
      totalInvested: 0,
      executedTrades: 0
    };

    const botId = uuidv4();
    db.prepare(`
      INSERT INTO trading_bots (id, user_id, name, bot_type, symbol, status, config)
      VALUES (?, ?, ?, 'DCA', ?, 'stopped', ?)
    `).run(botId, userId, `DCA-${symbol}`, symbol, JSON.stringify(config));

    return {
      success: true,
      data: {
        botId,
        name: `DCA-${symbol}`,
        symbol,
        investAmount: investAmount.toString(),
        interval: `${intervalMinutes} minutes`,
        maxPosition: maxPosition.toString()
      }
    };
  } catch (error) {
    console.error('DCA bot creation error:', error);
    return { success: false, error: 'Internal server error' };
  }
}

/**
 * Execute bot trade
 */
function executeBotTrade(botId, symbol, side, quantity, price) {
  try {
    const bot = db.prepare('SELECT * FROM trading_bots WHERE id = ?').get(botId);
    if (!bot || bot.status !== 'running') return;

    const tradeId = uuidv4();
    const cost = quantity * price;
    const fee = cost * 0.001; // 0.1% fee

    // Create bot trade record
    db.prepare(`
      INSERT INTO bot_trades (id, bot_id, user_id, symbol, side, price, quantity, cost, fee, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'executed')
    `).run(tradeId, botId, bot.user_id, symbol, side, price, quantity, cost, fee);

    // Update bot stats
    db.prepare(`
      UPDATE trading_bots
      SET trades_count = trades_count + 1, profit_loss = profit_loss + ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(-fee, botId);

    console.log(`✅ Bot trade executed: ${tradeId}`);
    return tradeId;
  } catch (error) {
    console.error('Bot trade execution error:', error);
    return null;
  }
}

/**
 * Process all active bots
 */
function processActiveBots() {
  try {
    const activeBots = db.prepare('SELECT * FROM trading_bots WHERE status = "running"').all();

    activeBots.forEach(bot => {
      const config = JSON.parse(bot.config);

      if (bot.bot_type === 'GRID') {
        processGridBot(bot, config);
      } else if (bot.bot_type === 'DCA') {
        processDCABot(bot, config);
      } else if (bot.bot_type === 'SIGNAL') {
        processSignalBot(bot, config);
      }
    });
  } catch (error) {
    console.error('Error processing bots:', error);
  }
}

function processGridBot(bot, config) {
  try {
    const pair = TRADING_PAIRS.find(p => p.symbol === bot.symbol);
    if (!pair) return;

    const currentPrice = pair.basePrice;
    const gridPrices = config.gridPrices;

    // Find closest grid level
    let gridIndex = 0;
    let minDistance = Math.abs(currentPrice - gridPrices[0]);

    gridPrices.forEach((price, index) => {
      const distance = Math.abs(currentPrice - price);
      if (distance < minDistance) {
        minDistance = distance;
        gridIndex = index;
      }
    });

    // Buy at lower grid levels, sell at higher
    if (gridIndex > 0 && !config.buyOrders.includes(gridIndex - 1)) {
      // Place buy order
      config.buyOrders.push(gridIndex - 1);
      executeBotTrade(bot.id, bot.symbol, 'buy', config.quantityPerGrid, gridPrices[gridIndex - 1]);
    }

    if (gridIndex < gridPrices.length - 1 && !config.sellOrders.includes(gridIndex + 1)) {
      // Place sell order
      config.sellOrders.push(gridIndex + 1);
      executeBotTrade(bot.id, bot.symbol, 'sell', config.quantityPerGrid, gridPrices[gridIndex + 1]);
    }

    db.prepare('UPDATE trading_bots SET config = ? WHERE id = ?')
      .run(JSON.stringify(config), bot.id);
  } catch (error) {
    console.error('Grid bot processing error:', error);
  }
}

function processDCABot(bot, config) {
  try {
    if (Date.now() < config.nextExecutionTime) return;

    if (config.totalInvested < config.maxPosition) {
      const pair = TRADING_PAIRS.find(p => p.symbol === bot.symbol);
      if (!pair) return;

      const quantity = config.investAmount / pair.basePrice;
      executeBotTrade(bot.id, bot.symbol, 'buy', quantity, pair.basePrice);

      config.totalInvested += config.investAmount;
      config.executedTrades += 1;
      config.nextExecutionTime = Date.now() + config.intervalMinutes * 60 * 1000;

      db.prepare('UPDATE trading_bots SET config = ? WHERE id = ?')
        .run(JSON.stringify(config), bot.id);
    }
  } catch (error) {
    console.error('DCA bot processing error:', error);
  }
}

function processSignalBot(bot, config) {
  try {
    // Get latest signals for this symbol
    const signals = db.prepare(`
      SELECT * FROM trading_signals
      WHERE symbol = ? AND expires_at > datetime('now')
      ORDER BY created_at DESC
      LIMIT 5
    `).all(bot.symbol);

    if (signals.length > 0) {
      const latestSignal = signals[0];
      const pair = TRADING_PAIRS.find(p => p.symbol === bot.symbol);
      if (!pair) return;

      if (latestSignal.direction === 'buy' && latestSignal.strength > 0.7) {
        const quantity = config.riskPerTrade / pair.basePrice;
        executeBotTrade(bot.id, bot.symbol, 'buy', quantity, pair.basePrice);
      } else if (latestSignal.direction === 'sell' && latestSignal.strength > 0.7) {
        const quantity = config.riskPerTrade / pair.basePrice;
        executeBotTrade(bot.id, bot.symbol, 'sell', quantity, pair.basePrice);
      }
    }
  } catch (error) {
    console.error('Signal bot processing error:', error);
  }
}

// ============================================================================
// BOT API ENDPOINTS (Add to server/index.js)
// ============================================================================

const botEndpoints = {
  // Create bot
  createBot: \`
    app.post('/api/v1/bots/create', authenticateRequest, (req, res) => {
      try {
        const { botType, symbol, ...params } = req.body;

        if (!botType || !symbol) {
          return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        let result;
        if (botType === 'GRID') {
          const { gridCount, minPrice, maxPrice, investAmount } = params;
          result = createGridBot(req.userId, symbol, gridCount, minPrice, maxPrice, investAmount);
        } else if (botType === 'DCA') {
          const { investAmount, intervalMinutes, maxPosition } = params;
          result = createDCABot(req.userId, symbol, investAmount, intervalMinutes, maxPosition);
        } else {
          return res.status(400).json({ success: false, error: 'Unsupported bot type' });
        }

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

  // Get bots
  getBots: \`
    app.get('/api/v1/bots', authenticateRequest, (req, res) => {
      try {
        const bots = db.prepare(\`
          SELECT id, name, bot_type, symbol, status, trades_count, profit_loss, win_rate, created_at
          FROM trading_bots
          WHERE user_id = ?
          ORDER BY created_at DESC
        \`).all(req.userId);

        res.json({
          success: true,
          data: bots.map(b => ({
            id: b.id,
            name: b.name,
            type: b.bot_type,
            symbol: b.symbol,
            status: b.status,
            tradesCount: b.trades_count,
            profitLoss: b.profit_loss.toString(),
            winRate: (b.win_rate * 100).toFixed(2) + '%'
          }))
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Start bot
  startBot: \`
    app.post('/api/v1/bots/:botId/start', authenticateRequest, (req, res) => {
      try {
        const bot = db.prepare('SELECT * FROM trading_bots WHERE id = ? AND user_id = ?')
          .get(req.params.botId, req.userId);

        if (!bot) {
          return res.status(404).json({ success: false, error: 'Bot not found' });
        }

        db.prepare('UPDATE trading_bots SET status = "running", started_at = datetime("now") WHERE id = ?')
          .run(req.params.botId);

        res.json({ success: true, message: 'Bot started' });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Stop bot
  stopBot: \`
    app.post('/api/v1/bots/:botId/stop', authenticateRequest, (req, res) => {
      try {
        const bot = db.prepare('SELECT * FROM trading_bots WHERE id = ? AND user_id = ?')
          .get(req.params.botId, req.userId);

        if (!bot) {
          return res.status(404).json({ success: false, error: 'Bot not found' });
        }

        db.prepare('UPDATE trading_bots SET status = "stopped", stopped_at = datetime("now") WHERE id = ?')
          .run(req.params.botId);

        res.json({ success: true, message: 'Bot stopped' });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

module.exports = {
  addTradingBotTables,
  BOT_TYPES,
  createGridBot,
  createDCABot,
  executeBotTrade,
  processActiveBots,
  botEndpoints
};
