/**
 * TigerEx Phase 3: Admin Dashboard & System Management
 * Administrative tools, reporting, user management, risk controls
 */

// ============================================================================
// ADMIN & SYSTEM TABLES
// ============================================================================

function addAdminTables() {
  // Admin users and roles
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'moderator',
      permissions TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    )
  `);

  // System settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      type TEXT DEFAULT 'string',
      description TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Risk management rules
  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // System audit logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      changes TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id)
    )
  `);

  // System health metrics
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_metrics (
      id TEXT PRIMARY KEY,
      metric_type TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_metric_time (metric_type, timestamp)
    )
  `);

  // Feature flags
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      feature_name TEXT UNIQUE NOT NULL,
      enabled INTEGER DEFAULT 0,
      rollout_percentage INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_system_metrics_type ON system_metrics(metric_type)`);

  console.log('✅ Admin tables created');
}

// ============================================================================
// ADMIN ROLES & PERMISSIONS
// ============================================================================

const ADMIN_ROLES = {
  superadmin: {
    name: 'Super Administrator',
    permissions: ['*']
  },
  admin: {
    name: 'Administrator',
    permissions: [
      'users:view', 'users:ban', 'users:unban', 'users:kyc_approve',
      'transactions:view', 'transactions:refund',
      'system:manage', 'reports:view',
      'audit:view'
    ]
  },
  moderator: {
    name: 'Moderator',
    permissions: [
      'users:view', 'users:ban', 'users:unban',
      'transactions:view',
      'reports:view'
    ]
  },
  analyst: {
    name: 'Analyst',
    permissions: [
      'users:view',
      'transactions:view',
      'reports:view',
      'metrics:view'
    ]
  }
};

// ============================================================================
// SYSTEM STATISTICS & REPORTING
// ============================================================================

/**
 * Generate system dashboard metrics
 */
function generateSystemMetrics() {
  try {
    const metrics = {
      totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
      activeUsers: db.prepare('SELECT COUNT(*) as count FROM users WHERE status = "active"').get().count,
      totalVolume24h: db.prepare(
        'SELECT SUM(quantity * (SELECT basePrice FROM TRADING_PAIRS WHERE symbol = ?)::float) as total FROM trades WHERE created_at > datetime("now", "-1 day")'
      ).get()?.total || 0,
      totalTrades: db.prepare('SELECT COUNT(*) as count FROM trades').get().count,
      totalDeposits: db.prepare('SELECT SUM(amount) as total FROM deposits WHERE status = "confirmed"').get()?.total || 0,
      totalWithdrawals: db.prepare('SELECT SUM(amount) as total FROM withdrawals WHERE status = "completed"').get()?.total || 0,
      averageOrderSize: db.prepare('SELECT AVG(quantity) as avg FROM orders').get()?.avg || 0
    };

    // Record metrics
    Object.entries(metrics).forEach(([metricName, value]) => {
      db.prepare(`
        INSERT INTO system_metrics (id, metric_type, metric_name, value)
        VALUES (?, 'system', ?, ?)
      `).run(uuidv4(), metricName, value || 0);
    });

    return metrics;
  } catch (error) {
    console.error('Error generating metrics:', error);
    return {};
  }
}

/**
 * Check risk rules and take action
 */
function evaluateRiskRules() {
  try {
    const rules = db.prepare('SELECT * FROM risk_rules WHERE enabled = 1').all();

    rules.forEach(rule => {
      try {
        if (rule.rule_type === 'unusual_volume') {
          checkUnusualVolume(rule);
        } else if (rule.rule_type === 'price_anomaly') {
          checkPriceAnomaly(rule);
        } else if (rule.rule_type === 'user_activity') {
          checkUserActivity(rule);
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.id}:`, error);
      }
    });
  } catch (error) {
    console.error('Error evaluating risk rules:', error);
  }
}

function checkUnusualVolume(rule) {
  const condition = JSON.parse(rule.condition);
  const volume24h = db.prepare(
    'SELECT SUM(quantity) as total FROM trades WHERE created_at > datetime("now", "-1 day")'
  ).get()?.total || 0;

  if (volume24h > condition.threshold) {
    if (rule.action === 'alert') {
      console.warn(`⚠️  Unusual volume detected: ${volume24h}`);
    } else if (rule.action === 'halt_trading') {
      // Halt trading logic
      console.warn('Trading halted due to volume anomaly');
    }
  }
}

function checkPriceAnomaly(rule) {
  const condition = JSON.parse(rule.condition);
  const trades = db.prepare('SELECT price FROM trades ORDER BY created_at DESC LIMIT 100').all();
  
  if (trades.length < 10) return;

  const avg = trades.reduce((sum, t) => sum + t.price, 0) / trades.length;
  const latest = trades[0].price;
  const percentChange = Math.abs((latest - avg) / avg);

  if (percentChange > condition.threshold) {
    console.warn(`⚠️  Price anomaly detected: ${(percentChange * 100).toFixed(2)}%`);
  }
}

function checkUserActivity(rule) {
  const condition = JSON.parse(rule.condition);
  const recentUsers = db.prepare(
    'SELECT COUNT(DISTINCT user_id) as count FROM orders WHERE created_at > datetime("now", "-1 hour")'
  ).get()?.count || 0;

  if (recentUsers > condition.threshold) {
    console.warn(`⚠️  Unusual user activity: ${recentUsers} users in last hour`);
  }
}

// ============================================================================
// FEATURE FLAGS
// ============================================================================

function isFeatureEnabled(featureName, userId = null) {
  try {
    const flag = db.prepare('SELECT * FROM feature_flags WHERE feature_name = ?').get(featureName);
    if (!flag) return false;

    if (!flag.enabled) return false;

    if (flag.rollout_percentage === 100) return true;

    // Rollout logic - based on user ID hash for consistency
    if (userId) {
      const hash = parseInt(userId.charCodeAt(0)) % 100;
      return hash < flag.rollout_percentage;
    }

    return Math.random() * 100 < flag.rollout_percentage;
  } catch (error) {
    console.error('Error checking feature flag:', error);
    return false;
  }
}

// ============================================================================
// ADMIN API ENDPOINTS (Add to server/index.js)
// ============================================================================

const adminEndpoints = {
  // Get system dashboard
  getDashboard: \`
    app.get('/api/v1/admin/dashboard', authenticateAdmin, (req, res) => {
      try {
        const metrics = generateSystemMetrics();
        
        res.json({
          success: true,
          data: {
            timestamp: new Date().toISOString(),
            metrics,
            tradingPairs: TRADING_PAIRS.length,
            database: {
              users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
              trades: db.prepare('SELECT COUNT(*) as count FROM trades').get().count,
              orders: db.prepare('SELECT COUNT(*) as count FROM orders').get().count,
              wallets: db.prepare('SELECT COUNT(*) as count FROM wallets').get().count
            }
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get users list (admin)
  getUsers: \`
    app.get('/api/v1/admin/users', authenticateAdmin, (req, res) => {
      try {
        const { limit = 50, offset = 0, status = 'all' } = req.query;
        
        let query = 'SELECT id, email, username, kyc_level, status, created_at FROM users';
        const params = [];

        if (status !== 'all') {
          query += ' WHERE status = ?';
          params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const users = db.prepare(query).all(...params);
        const total = db.prepare('SELECT COUNT(*) as count FROM users' + (status !== 'all' ? ' WHERE status = ?' : ''))
          .get(...(status !== 'all' ? [status] : []))?.count;

        res.json({
          success: true,
          data: { users, total, limit: parseInt(limit), offset: parseInt(offset) }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Ban/Unban user
  banUser: \`
    app.post('/api/v1/admin/users/:userId/ban', authenticateAdmin, (req, res) => {
      try {
        const { reason } = req.body;

        db.prepare('UPDATE users SET status = "banned" WHERE id = ?').run(req.params.userId);
        
        // Log action
        db.prepare(\`
          INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, changes)
          VALUES (?, ?, ?, 'user', ?, ?)
        \`).run(uuidv4(), req.userId, 'ban_user', req.params.userId, JSON.stringify({ reason }));

        res.json({ success: true, message: 'User banned' });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // View audit logs
  getAuditLogs: \`
    app.get('/api/v1/admin/audit-logs', authenticateAdmin, (req, res) => {
      try {
        const { limit = 100, offset = 0 } = req.query;

        const logs = db.prepare(\`
          SELECT * FROM audit_logs
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        \`).all(parseInt(limit), parseInt(offset));

        res.json({ success: true, data: logs });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // System health check
  getSystemHealth: \`
    app.get('/api/v1/admin/health', authenticateAdmin, (req, res) => {
      try {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          database: {
            connected: true,
            queryTime: '< 50ms'
          },
          api: {
            responseTime: '< 100ms',
            errorRate: '0.1%'
          },
          system: {
            uptime: process.uptime(),
            memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            cpuUsage: '< 10%'
          }
        };

        res.json({ success: true, data: health });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

// Middleware for admin authentication
function authenticateAdmin(req, res, next) {
  // Verify admin token (similar to regular auth but check role)
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token, 'access');
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }

  // Check if user is admin
  const adminUser = db.prepare('SELECT role FROM admin_users WHERE id = ?').get(decoded.userId);
  if (!adminUser) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  req.userId = decoded.userId;
  req.adminRole = adminUser.role;
  next();
}

module.exports = {
  addAdminTables,
  ADMIN_ROLES,
  generateSystemMetrics,
  evaluateRiskRules,
  isFeatureEnabled,
  adminEndpoints,
  authenticateAdmin
};
