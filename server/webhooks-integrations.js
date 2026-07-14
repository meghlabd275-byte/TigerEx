/**
 * TigerEx Phase 3: Webhooks & External Integrations
 * Webhook system for real-time notifications, API integrations
 */

// ============================================================================
// WEBHOOK TABLES
// ============================================================================

function addWebhookTables() {
  // Webhook endpoints
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      api_key TEXT,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      retry_count INTEGER DEFAULT 3,
      timeout_seconds INTEGER DEFAULT 30,
      headers TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_triggered_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Webhook deliveries (for tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      attempt_count INTEGER DEFAULT 1,
      next_retry_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
    )
  `);

  // External API integrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      integration_type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      api_key TEXT,
      last_sync_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, integration_type)
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(delivered_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_integrations_user ON integrations(user_id)`);

  console.log('✅ Webhook tables created');
}

// ============================================================================
// WEBHOOK EVENTS
// ============================================================================

const WEBHOOK_EVENTS = {
  'order.created': {
    description: 'Order placed',
    payload: { orderId: 'id', symbol: 'symbol', side: 'side', quantity: 'quantity' }
  },
  'order.filled': {
    description: 'Order fully filled',
    payload: { orderId: 'id', filledQuantity: 'quantity', avgPrice: 'price' }
  },
  'order.cancelled': {
    description: 'Order cancelled',
    payload: { orderId: 'id', reason: 'string' }
  },
  'trade.executed': {
    description: 'Trade executed',
    payload: { tradeId: 'id', symbol: 'symbol', price: 'price', quantity: 'quantity' }
  },
  'position.opened': {
    description: 'Futures position opened',
    payload: { positionId: 'id', leverage: 'number', margin: 'number' }
  },
  'position.closed': {
    description: 'Futures position closed',
    payload: { positionId: 'id', pnl: 'number' }
  },
  'deposit.confirmed': {
    description: 'Deposit confirmed',
    payload: { depositId: 'id', amount: 'number', currency: 'string' }
  },
  'withdrawal.completed': {
    description: 'Withdrawal completed',
    payload: { withdrawalId: 'id', amount: 'number', txHash: 'string' }
  },
  'balance.updated': {
    description: 'Balance updated',
    payload: { currency: 'string', newBalance: 'number' }
  },
  'alert.triggered': {
    description: 'Price alert triggered',
    payload: { alertId: 'id', symbol: 'symbol', price: 'number' }
  }
};

// ============================================================================
// WEBHOOK DELIVERY ENGINE
// ============================================================================

/**
 * Trigger webhook event
 */
async function triggerWebhook(userId, eventType, payload) {
  try {
    const webhooks = db.prepare(`
      SELECT * FROM webhooks
      WHERE user_id = ? AND is_active = 1 AND events LIKE ?
    `).all(userId, `%${eventType}%`);

    for (const webhook of webhooks) {
      await deliverWebhook(webhook.id, eventType, payload);
    }
  } catch (error) {
    console.error('Webhook trigger error:', error);
  }
}

/**
 * Deliver webhook payload
 */
async function deliverWebhook(webhookId, eventType, payload) {
  try {
    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(webhookId);
    if (!webhook) return;

    const deliveryId = uuidv4();
    const timestamp = new Date().toISOString();
    const signature = generateWebhookSignature(webhook.api_key, JSON.stringify(payload), timestamp);

    const headers = {
      'Content-Type': 'application/json',
      'X-TigerEx-Event': eventType,
      'X-TigerEx-Timestamp': timestamp,
      'X-TigerEx-Signature': signature,
      ...JSON.parse(webhook.headers || '{}')
    };

    // Record delivery attempt
    db.prepare(`
      INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload)
      VALUES (?, ?, ?, ?)
    `).run(deliveryId, webhookId, eventType, JSON.stringify(payload));

    // Send webhook (in production, use async task queue)
    // For now, just record it
    db.prepare(`
      UPDATE webhooks SET last_triggered_at = datetime('now') WHERE id = ?
    `).run(webhookId);

    console.log(`✅ Webhook scheduled: ${eventType} -> ${webhook.url}`);
  } catch (error) {
    console.error('Webhook delivery error:', error);
  }
}

/**
 * Generate webhook signature for verification
 */
function generateWebhookSignature(apiKey, payload, timestamp) {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', apiKey);
  hmac.update(payload + timestamp);
  return hmac.digest('hex');
}

// ============================================================================
// EXTERNAL INTEGRATIONS
// ============================================================================

const AVAILABLE_INTEGRATIONS = {
  tradingview: {
    name: 'TradingView',
    description: 'Import signals from TradingView',
    required_params: ['webhook_url']
  },
  telegram: {
    name: 'Telegram',
    description: 'Receive alerts via Telegram',
    required_params: ['bot_token', 'chat_id']
  },
  discord: {
    name: 'Discord',
    description: 'Receive alerts via Discord',
    required_params: ['webhook_url']
  },
  email: {
    name: 'Email Notifications',
    description: 'Send alerts to email',
    required_params: ['email_address']
  },
  slack: {
    name: 'Slack',
    description: 'Post alerts to Slack',
    required_params: ['webhook_url', 'channel']
  },
  coingecko: {
    name: 'CoinGecko',
    description: 'Get market data from CoinGecko',
    required_params: ['api_key']
  },
  alpha_vantage: {
    name: 'Alpha Vantage',
    description: 'Get trading signals from Alpha Vantage',
    required_params: ['api_key']
  }
};

/**
 * Create webhook endpoint
 */
function createWebhook(userId, url, events, customHeaders = null) {
  try {
    const webhookId = uuidv4();
    const apiKey = uuidv4();
    const eventList = Array.isArray(events) ? events.join(',') : events;

    db.prepare(`
      INSERT INTO webhooks (id, user_id, api_key, url, events, headers)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(webhookId, userId, apiKey, url, eventList, customHeaders || '{}');

    return {
      success: true,
      data: {
        webhookId,
        apiKey,
        url,
        events: events
      }
    };
  } catch (error) {
    console.error('Webhook creation error:', error);
    return { success: false, error: 'Internal server error' };
  }
}

// ============================================================================
// WEBHOOK API ENDPOINTS (Add to server/index.js)
// ============================================================================

const webhookEndpoints = {
  // Create webhook
  createWebhook: \`
    app.post('/api/v1/webhooks', authenticateRequest, (req, res) => {
      try {
        const { url, events, headers } = req.body;

        if (!url || !events) {
          return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const result = createWebhook(req.userId, url, events, JSON.stringify(headers || {}));
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get webhooks
  getWebhooks: \`
    app.get('/api/v1/webhooks', authenticateRequest, (req, res) => {
      try {
        const webhooks = db.prepare(\`
          SELECT id, url, events, is_active, last_triggered_at, created_at
          FROM webhooks
          WHERE user_id = ?
          ORDER BY created_at DESC
        \`).all(req.userId);

        res.json({
          success: true,
          data: webhooks.map(w => ({
            id: w.id,
            url: w.url,
            events: w.events.split(','),
            active: !!w.is_active,
            lastTriggered: w.last_triggered_at
          }))
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Delete webhook
  deleteWebhook: \`
    app.delete('/api/v1/webhooks/:webhookId', authenticateRequest, (req, res) => {
      try {
        const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?')
          .get(req.params.webhookId, req.userId);

        if (!webhook) {
          return res.status(404).json({ success: false, error: 'Webhook not found' });
        }

        db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.webhookId);
        db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(req.params.webhookId);

        res.json({ success: true, message: 'Webhook deleted' });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get available integrations
  getIntegrations: \`
    app.get('/api/v1/integrations/available', (req, res) => {
      try {
        const integrations = Object.entries(AVAILABLE_INTEGRATIONS).map(([key, config]) => ({
          id: key,
          name: config.name,
          description: config.description,
          requiredParams: config.required_params
        }));

        res.json({ success: true, data: integrations });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Connect integration
  connectIntegration: \`
    app.post('/api/v1/integrations/connect', authenticateRequest, (req, res) => {
      try {
        const { integrationType, config } = req.body;

        if (!integrationType || !config) {
          return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        if (!AVAILABLE_INTEGRATIONS[integrationType]) {
          return res.status(400).json({ success: false, error: 'Invalid integration type' });
        }

        const integrationId = uuidv4();
        const apiKey = uuidv4();

        db.prepare(\`
          INSERT INTO integrations (id, user_id, integration_type, name, config, api_key)
          VALUES (?, ?, ?, ?, ?, ?)
        \`).run(
          integrationId,
          req.userId,
          integrationType,
          AVAILABLE_INTEGRATIONS[integrationType].name,
          JSON.stringify(config),
          apiKey
        );

        res.json({
          success: true,
          data: {
            integrationId,
            type: integrationType,
            apiKey
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get webhook deliveries (for debugging)
  getDeliveries: \`
    app.get('/api/v1/webhooks/:webhookId/deliveries', authenticateRequest, (req, res) => {
      try {
        // Verify ownership
        const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?')
          .get(req.params.webhookId, req.userId);

        if (!webhook) {
          return res.status(404).json({ success: false, error: 'Webhook not found' });
        }

        const deliveries = db.prepare(\`
          SELECT id, event_type, response_status, delivered_at, created_at
          FROM webhook_deliveries
          WHERE webhook_id = ?
          ORDER BY created_at DESC
          LIMIT 100
        \`).all(req.params.webhookId);

        res.json({ success: true, data: deliveries });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

module.exports = {
  addWebhookTables,
  WEBHOOK_EVENTS,
  AVAILABLE_INTEGRATIONS,
  triggerWebhook,
  deliverWebhook,
  generateWebhookSignature,
  createWebhook,
  webhookEndpoints
};
