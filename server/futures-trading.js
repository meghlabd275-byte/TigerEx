/**
 * TigerEx Phase 2 Enhancement
 * Futures Trading & Advanced Order Types Module
 * To be integrated into server/index.js
 */

// ============================================================================
// FUTURES TRADING - ADD TO DATABASE INITIALIZATION
// ============================================================================

// Add to initializeDatabase() function:

function addFuturesTables() {
  // Futures positions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS futures_positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      liquidation_price REAL NOT NULL,
      margin_used REAL NOT NULL,
      leverage INTEGER DEFAULT 1,
      unrealized_pnl REAL DEFAULT 0,
      realized_pnl REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      isolated BOOLEAN DEFAULT FALSE,
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, symbol, side, status)
    )
  `);

  // Futures orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS futures_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      order_type TEXT DEFAULT 'market',
      price REAL,
      stop_price REAL,
      take_profit_price REAL,
      quantity REAL NOT NULL,
      filled_quantity REAL DEFAULT 0,
      status TEXT DEFAULT 'new',
      reduce_only BOOLEAN DEFAULT FALSE,
      post_only BOOLEAN DEFAULT FALSE,
      time_in_force TEXT DEFAULT 'GTC',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Funding rates table (for perpetuals)
  db.exec(`
    CREATE TABLE IF NOT EXISTS funding_rates (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      funding_rate REAL NOT NULL,
      next_funding_time TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, created_at)
    )
  `);

  // Leverage settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS leverage_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      leverage INTEGER DEFAULT 1,
      margin_type TEXT DEFAULT 'cross',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, symbol)
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_futures_positions_user ON futures_positions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_futures_positions_symbol ON futures_positions(symbol)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_futures_orders_user ON futures_orders(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_futures_orders_symbol ON futures_orders(symbol)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_funding_rates_symbol ON funding_rates(symbol)`);

  console.log('✅ Futures tables created');
}

// ============================================================================
// ADVANCED ORDER TYPES ENGINE
// ============================================================================

/**
 * Calculate liquidation price for leveraged positions
 * Formula: liquidationPrice = entryPrice / (1 + leverage) for longs
 *          liquidationPrice = entryPrice * (1 - leverage) for shorts
 */
function calculateLiquidationPrice(entryPrice, leverage, side) {
  if (side === 'long') {
    return entryPrice / leverage;
  } else {
    return entryPrice * (1 - (1 / leverage));
  }
}

/**
 * Calculate unrealized PnL
 */
function calculateUnrealizedPnL(quantity, entryPrice, currentPrice, side) {
  if (side === 'long') {
    return quantity * (currentPrice - entryPrice);
  } else {
    return quantity * (entryPrice - currentPrice);
  }
}

/**
 * Check if position should be liquidated
 */
function checkLiquidationPrice(currentPrice, liquidationPrice, side) {
  if (side === 'long') {
    return currentPrice <= liquidationPrice;
  } else {
    return currentPrice >= liquidationPrice;
  }
}

/**
 * Process advanced order types (Stop-Loss, Take-Profit, OCO)
 */
function processAdvancedOrders(symbol, currentPrice) {
  try {
    // Get all active stop-loss and take-profit orders
    const stopOrders = db.prepare(`
      SELECT * FROM futures_orders
      WHERE symbol = ?
      AND status = 'new'
      AND (order_type = 'stop_loss' OR order_type = 'take_profit')
    `).all(symbol);

    stopOrders.forEach(order => {
      let shouldExecute = false;

      if (order.order_type === 'stop_loss' && order.stop_price) {
        if (order.side === 'buy' && currentPrice >= order.stop_price) {
          shouldExecute = true;
        } else if (order.side === 'sell' && currentPrice <= order.stop_price) {
          shouldExecute = true;
        }
      }

      if (order.order_type === 'take_profit' && order.take_profit_price) {
        if (order.side === 'buy' && currentPrice >= order.take_profit_price) {
          shouldExecute = true;
        } else if (order.side === 'sell' && currentPrice <= order.take_profit_price) {
          shouldExecute = true;
        }
      }

      if (shouldExecute) {
        // Auto-execute the order
        executeFuturesOrder(order.id, symbol, currentPrice);
      }
    });
  } catch (error) {
    console.error('Error processing advanced orders:', error);
  }
}

/**
 * Execute futures order
 */
function executeFuturesOrder(orderId, symbol, executionPrice) {
  try {
    const order = db.prepare('SELECT * FROM futures_orders WHERE id = ?').get(orderId);
    if (!order || order.status !== 'new') return;

    const pair = TRADING_PAIRS.find(p => p.symbol === symbol);
    if (!pair) return;

    // Update order status
    db.prepare(`
      UPDATE futures_orders SET status = 'filled', filled_quantity = quantity, updated_at = datetime('now')
      WHERE id = ?
    `).run(orderId);

    // Create or update position
    const position = db.prepare(`
      SELECT * FROM futures_positions
      WHERE user_id = ? AND symbol = ? AND side = ?
    `).get(order.user_id, symbol, order.side);

    if (position && position.status === 'open') {
      // Add to existing position
      const newQuantity = position.quantity + order.quantity;
      const newEntryPrice = (position.entry_price * position.quantity + executionPrice * order.quantity) / newQuantity;
      const liquidationPrice = calculateLiquidationPrice(newEntryPrice, position.leverage, position.side);
      const unrealizedPnL = calculateUnrealizedPnL(newQuantity, newEntryPrice, executionPrice, position.side);

      db.prepare(`
        UPDATE futures_positions
        SET quantity = ?, entry_price = ?, liquidation_price = ?, unrealized_pnl = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newQuantity, newEntryPrice, liquidationPrice, unrealizedPnL, position.id);
    } else {
      // Create new position
      const leverage = 1; // Default
      const marginUsed = (executionPrice * order.quantity) / leverage;
      const liquidationPrice = calculateLiquidationPrice(executionPrice, leverage, order.side);
      const unrealizedPnL = 0; // At entry

      const positionId = uuidv4();
      db.prepare(`
        INSERT INTO futures_positions (
          id, user_id, symbol, side, quantity, entry_price, current_price,
          liquidation_price, margin_used, leverage, unrealized_pnl, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
      `).run(
        positionId,
        order.user_id,
        symbol,
        order.side,
        order.quantity,
        executionPrice,
        executionPrice,
        liquidationPrice,
        marginUsed,
        leverage,
        unrealizedPnL
      );
    }

    console.log(`✅ Futures order executed: ${orderId}`);
  } catch (error) {
    console.error('Error executing futures order:', error);
  }
}

// ============================================================================
// FUTURES TRADING API ENDPOINTS
// ============================================================================

// Export endpoints for integration into server/index.js

const futuresEndpoints = {
  // Create futures position
  createPosition: `
    app.post('/api/v1/futures/order', authenticateRequest, (req, res) => {
      try {
        const { symbol, side, type, quantity, price, leverage = 1, orderType = 'market' } = req.body;

        if (!['long', 'short'].includes(side) || !symbol || !quantity) {
          return res.status(400).json({ success: false, error: 'Missing or invalid parameters' });
        }

        if (leverage < 1 || leverage > 125) {
          return res.status(400).json({ success: false, error: 'Leverage must be between 1x and 125x' });
        }

        const pair = TRADING_PAIRS.find(p => p.symbol === symbol);
        if (!pair) {
          return res.status(400).json({ success: false, error: 'Symbol not found' });
        }

        // Get user wallet
        const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
          .get(req.userId, pair.quote);
        if (!wallet) {
          return res.status(400).json({ success: false, error: 'Wallet not found' });
        }

        // Calculate margin required
        const orderPrice = type === 'market' ? pair.basePrice : parseFloat(price);
        const positionSize = quantity * orderPrice;
        const marginRequired = positionSize / leverage;

        if (wallet.balance < marginRequired) {
          return res.status(400).json({ success: false, error: 'Insufficient margin' });
        }

        // Lock margin
        db.prepare('UPDATE wallets SET locked = locked + ?, updated_at = datetime("now") WHERE id = ?')
          .run(marginRequired, wallet.id);

        // Create futures order
        const orderId = uuidv4();
        db.prepare(\`
          INSERT INTO futures_orders (id, user_id, symbol, side, type, quantity, price, status, order_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)
        \`).run(orderId, req.userId, symbol, side, type, quantity, orderPrice, orderType);

        // Execute if market order
        if (type === 'market') {
          executeFuturesOrder(orderId, symbol, orderPrice);
        }

        res.json({
          success: true,
          data: {
            orderId,
            symbol,
            side,
            quantity: quantity.toString(),
            leverage: leverage.toString(),
            marginRequired: marginRequired.toString(),
            estimatedLiquidationPrice: calculateLiquidationPrice(orderPrice, leverage, side).toString()
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  `,

  // Get open positions
  getPositions: \`
    app.get('/api/v1/futures/positions', authenticateRequest, (req, res) => {
      try {
        const positions = db.prepare(\`
          SELECT * FROM futures_positions
          WHERE user_id = ? AND status = 'open'
          ORDER BY updated_at DESC
        \`).all(req.userId);

        res.json({
          success: true,
          data: positions.map(p => ({
            id: p.id,
            symbol: p.symbol,
            side: p.side,
            quantity: p.quantity,
            entryPrice: p.entry_price,
            currentPrice: p.current_price,
            liquidationPrice: p.liquidation_price,
            leverage: p.leverage,
            unrealizedPnL: p.unrealized_pnl,
            marginUsed: p.margin_used,
            status: p.status
          }))
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Close position
  closePosition: \`
    app.post('/api/v1/futures/close', authenticateRequest, (req, res) => {
      try {
        const { positionId, quantity, price } = req.body;
        
        const position = db.prepare('SELECT * FROM futures_positions WHERE id = ? AND user_id = ?')
          .get(positionId, req.userId);
        if (!position) {
          return res.status(404).json({ success: false, error: 'Position not found' });
        }

        const closeQty = Math.min(quantity || position.quantity, position.quantity);
        const realizePnL = calculateUnrealizedPnL(closeQty, position.entry_price, price, position.side);

        // Update or close position
        if (closeQty >= position.quantity) {
          db.prepare('UPDATE futures_positions SET status = "closed", closed_at = datetime("now") WHERE id = ?')
            .run(positionId);
        } else {
          db.prepare('UPDATE futures_positions SET quantity = quantity - ?, unrealized_pnl = unrealized_pnl - ? WHERE id = ?')
            .run(closeQty, realizePnL, positionId);
        }

        res.json({
          success: true,
          data: {
            positionId,
            closedQuantity: closeQty.toString(),
            realizedPnL: realizePnL.toString()
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Set stop-loss and take-profit
  setTPSL: \`
    app.post('/api/v1/futures/tp-sl', authenticateRequest, (req, res) => {
      try {
        const { symbol, side, takeProfitPrice, stopLossPrice } = req.body;

        // Create take-profit order if specified
        if (takeProfitPrice) {
          const tpOrderId = uuidv4();
          db.prepare(\`
            INSERT INTO futures_orders (id, user_id, symbol, side, take_profit_price, status, order_type, quantity, type)
            VALUES (?, ?, ?, ?, ?, 'new', 'take_profit', 0, 'limit')
          \`).run(tpOrderId, req.userId, symbol, side === 'long' ? 'sell' : 'buy', takeProfitPrice);
        }

        // Create stop-loss order if specified
        if (stopLossPrice) {
          const slOrderId = uuidv4();
          db.prepare(\`
            INSERT INTO futures_orders (id, user_id, symbol, side, stop_price, status, order_type, quantity, type)
            VALUES (?, ?, ?, ?, ?, 'new', 'stop_loss', 0, 'limit')
          \`).run(slOrderId, req.userId, symbol, side === 'long' ? 'sell' : 'buy', stopLossPrice);
        }

        res.json({
          success: true,
          message: 'TP/SL orders created'
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

// ============================================================================
// FUNDING RATES (PERPETUALS)
// ============================================================================

function initializeFundingRates() {
  const symbols = TRADING_PAIRS.filter(p => p.symbol.includes('USDT')).map(p => p.symbol);
  const nowTime = new Date().toISOString();

  symbols.forEach(symbol => {
    const fundingRate = (Math.random() - 0.5) * 0.0001; // -0.005% to +0.005%
    const nextFundingTime = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8 hours from now

    try {
      db.prepare(\`
        INSERT OR IGNORE INTO funding_rates (id, symbol, funding_rate, next_funding_time)
        VALUES (?, ?, ?, ?)
      \`).run(uuidv4(), symbol, fundingRate, nextFundingTime);
    } catch (e) {
      // Already exists
    }
  });

  console.log('✅ Funding rates initialized');
}

module.exports = {
  addFuturesTables,
  calculateLiquidationPrice,
  calculateUnrealizedPnL,
  checkLiquidationPrice,
  processAdvancedOrders,
  executeFuturesOrder,
  initializeFundingRates,
  futuresEndpoints
};
