/**
 * TigerEx Phase 2: Payment Gateway & Fiat Integration
 * Deposit/withdrawal with Stripe, SEPA, bank transfers
 */

// ============================================================================
// PAYMENT GATEWAY TABLES
// ============================================================================

function addPaymentTables() {
  // Payment methods
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      method_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      account_holder TEXT,
      account_number TEXT,
      routing_number TEXT,
      bank_name TEXT,
      iban TEXT,
      swift_code TEXT,
      card_last_four TEXT,
      card_brand TEXT,
      status TEXT DEFAULT 'active',
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Deposit records
  db.exec(`
    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      usd_value REAL,
      method_type TEXT NOT NULL,
      provider TEXT,
      payment_method_id TEXT,
      transaction_id TEXT,
      reference_code TEXT,
      status TEXT DEFAULT 'pending',
      network TEXT,
      address TEXT,
      confirmations INTEGER DEFAULT 0,
      required_confirmations INTEGER DEFAULT 1,
      fee REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      confirmed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
    )
  `);

  // Withdrawal records
  db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      usd_value REAL,
      method_type TEXT NOT NULL,
      provider TEXT,
      payment_method_id TEXT,
      transaction_id TEXT,
      reference_code TEXT,
      status TEXT DEFAULT 'pending',
      network TEXT,
      destination_address TEXT,
      destination_tag TEXT,
      fee REAL DEFAULT 0,
      net_amount REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
    )
  `);

  // Price history for fiat conversion
  db.exec(`
    CREATE TABLE IF NOT EXISTS fiat_prices (
      id TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      usd_price REAL NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      source TEXT DEFAULT 'coingecko'
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status)`);

  console.log('✅ Payment tables created');
}

// ============================================================================
// PAYMENT PROCESSORS CONFIGURATION
// ============================================================================

const PAYMENT_PROVIDERS = {
  stripe: {
    name: 'Stripe',
    types: ['card', 'bank_transfer', 'ach'],
    fees: {
      card: 0.029,        // 2.9% + $0.30
      bank_transfer: 0.01, // 1%
      ach: 0.008          // 0.8%
    },
    limits: {
      min: 10,
      max: 100000
    }
  },
  sepa: {
    name: 'SEPA Transfer',
    types: ['bank_transfer'],
    fees: {
      bank_transfer: 0.005 // 0.5%
    },
    limits: {
      min: 50,
      max: 250000
    }
  },
  swift: {
    name: 'International Wire',
    types: ['bank_transfer'],
    fees: {
      bank_transfer: 0.01  // 1%
    },
    limits: {
      min: 1000,
      max: 1000000
    }
  },
  crypto: {
    name: 'Blockchain',
    types: ['deposit', 'withdrawal'],
    fees: {
      deposit: 0,          // No fee for deposits
      withdrawal: 0.001    // 0.1% network fee
    },
    limits: {
      min: 0.00000001,
      max: 100
    }
  }
};

// ============================================================================
// FIAT DEPOSIT/WITHDRAWAL FUNCTIONS
// ============================================================================

/**
 * Calculate fee for transaction
 */
function calculateFee(amount, provider, methodType) {
  const providerConfig = PAYMENT_PROVIDERS[provider];
  if (!providerConfig) return 0;

  const feeRate = providerConfig.fees[methodType] || 0;
  let fee = amount * feeRate;

  // Add fixed fees for certain providers
  if (provider === 'stripe' && methodType === 'card') {
    fee += 0.30; // $0.30 fixed fee
  }

  return parseFloat(fee.toFixed(8));
}

/**
 * Process fiat deposit
 */
function processFiatDeposit(userId, currency, amount, provider, methodId) {
  try {
    if (currency !== 'USD' && currency !== 'EUR' && currency !== 'GBP') {
      return { success: false, error: 'Unsupported fiat currency' };
    }

    const providerConfig = PAYMENT_PROVIDERS[provider];
    if (!providerConfig) {
      return { success: false, error: 'Invalid payment provider' };
    }

    if (amount < providerConfig.limits.min || amount > providerConfig.limits.max) {
      return { 
        success: false, 
        error: `Amount must be between ${providerConfig.limits.min} and ${providerConfig.limits.max}` 
      };
    }

    // Calculate fee
    const fee = calculateFee(amount, provider, 'bank_transfer');
    const netAmount = amount - fee;

    // Create deposit record
    const depositId = uuidv4();
    const referenceCode = `DEP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    db.prepare(`
      INSERT INTO deposits (id, user_id, currency, amount, method_type, provider, payment_method_id, reference_code, status, fee)
      VALUES (?, ?, ?, ?, 'bank_transfer', ?, ?, ?, 'pending', ?)
    `).run(depositId, userId, currency, amount, provider, methodId, referenceCode, fee);

    return {
      success: true,
      data: {
        depositId,
        referenceCode,
        status: 'pending',
        amount: amount.toString(),
        fee: fee.toString(),
        netCredit: netAmount.toString(),
        provider,
        estimatedCompletion: '1-2 business days'
      }
    };
  } catch (error) {
    console.error('Fiat deposit error:', error);
    return { success: false, error: 'Internal server error' };
  }
}

/**
 * Process crypto withdrawal
 */
function processCryptoWithdrawal(userId, currency, amount, toAddress, toTag = null) {
  try {
    // Get user wallet
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? AND currency = ?')
      .get(userId, currency);
    
    if (!wallet || wallet.balance < amount) {
      return { success: false, error: 'Insufficient balance' };
    }

    // Calculate network fee (simulated)
    const networkFee = amount * 0.001; // 0.1%
    const netAmount = amount - networkFee;

    // Deduct from wallet
    db.prepare('UPDATE wallets SET balance = balance - ? WHERE id = ?')
      .run(amount, wallet.id);

    // Create withdrawal record
    const withdrawalId = uuidv4();
    const referenceCode = `WD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    db.prepare(`
      INSERT INTO withdrawals (
        id, user_id, currency, amount, method_type, provider, 
        destination_address, destination_tag, fee, net_amount, 
        reference_code, status
      ) VALUES (?, ?, ?, ?, 'blockchain', 'crypto', ?, ?, ?, ?, ?, 'pending')
    `).run(withdrawalId, userId, currency, amount, toAddress, toTag, networkFee, netAmount, referenceCode);

    return {
      success: true,
      data: {
        withdrawalId,
        referenceCode,
        status: 'pending',
        amount: amount.toString(),
        networkFee: networkFee.toString(),
        netAmount: netAmount.toString(),
        destination: toAddress,
        estimatedConfirmation: '10-30 minutes',
        network: currency === 'BTC' ? 'Bitcoin' : currency === 'ETH' ? 'Ethereum' : 'Other'
      }
    };
  } catch (error) {
    console.error('Crypto withdrawal error:', error);
    return { success: false, error: 'Internal server error' };
  }
}

// ============================================================================
// PAYMENT API ENDPOINTS (Add to server/index.js)
// ============================================================================

const paymentEndpoints = {
  // Get payment methods
  getPaymentMethods: \`
    app.get('/api/v1/payment/methods', authenticateRequest, (req, res) => {
      try {
        const methods = db.prepare(\`
          SELECT id, method_type, provider, account_holder, card_last_four, card_brand, 
                 bank_name, status, verified, created_at
          FROM payment_methods
          WHERE user_id = ?
          ORDER BY created_at DESC
        \`).all(req.userId);

        res.json({ success: true, data: methods });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Add payment method
  addPaymentMethod: \`
    app.post('/api/v1/payment/methods/add', authenticateRequest, (req, res) => {
      try {
        const { methodType, provider, accountHolder, iban, swiftCode, bankName } = req.body;

        if (!methodType || !provider) {
          return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const methodId = uuidv4();
        db.prepare(\`
          INSERT INTO payment_methods (
            id, user_id, method_type, provider, account_holder, iban, swift_code, bank_name, verified
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        \`).run(methodId, req.userId, methodType, provider, accountHolder, iban, swiftCode, bankName);

        res.json({
          success: true,
          data: {
            methodId,
            message: 'Payment method added. Verification pending.'
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Deposit fiat
  depositFiat: \`
    app.post('/api/v1/deposit/fiat', authenticateRequest, (req, res) => {
      try {
        const { currency, amount, provider, methodId } = req.body;
        
        if (!currency || !amount || !provider) {
          return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const result = processFiatDeposit(req.userId, currency, amount, provider, methodId);
        
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

  // Get deposit status
  getDepositStatus: \`
    app.get('/api/v1/deposit/status/:depositId', authenticateRequest, (req, res) => {
      try {
        const deposit = db.prepare(\`
          SELECT * FROM deposits WHERE id = ? AND user_id = ?
        \`).get(req.params.depositId, req.userId);

        if (!deposit) {
          return res.status(404).json({ success: false, error: 'Deposit not found' });
        }

        res.json({
          success: true,
          data: {
            id: deposit.id,
            currency: deposit.currency,
            amount: deposit.amount.toString(),
            fee: deposit.fee.toString(),
            status: deposit.status,
            referenceCode: deposit.reference_code,
            createdAt: deposit.created_at,
            confirmedAt: deposit.confirmed_at
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Withdraw crypto
  withdrawCrypto: \`
    app.post('/api/v1/withdraw/crypto', authenticateRequest, (req, res) => {
      try {
        const { currency, amount, address, tag } = req.body;

        if (!currency || !amount || !address) {
          return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const result = processCryptoWithdrawal(req.userId, currency, amount, address, tag);

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

  // Get withdrawal history
  getWithdrawalHistory: \`
    app.get('/api/v1/withdraw/history', authenticateRequest, (req, res) => {
      try {
        const withdrawals = db.prepare(\`
          SELECT * FROM withdrawals
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 50
        \`).all(req.userId);

        res.json({
          success: true,
          data: withdrawals.map(w => ({
            id: w.id,
            currency: w.currency,
            amount: w.amount.toString(),
            status: w.status,
            destination: w.destination_address,
            fee: w.fee.toString(),
            referenceCode: w.reference_code,
            createdAt: w.created_at,
            completedAt: w.completed_at
          }))
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get payment providers
  getProviders: \`
    app.get('/api/v1/payment/providers', (req, res) => {
      try {
        const providers = Object.entries(PAYMENT_PROVIDERS).map(([key, config]) => ({
          id: key,
          name: config.name,
          types: config.types,
          fees: Object.entries(config.fees).reduce((acc, [type, rate]) => {
            acc[type] = (rate * 100).toFixed(2) + '%';
            return acc;
          }, {}),
          limits: {
            min: config.limits.min.toString(),
            max: config.limits.max.toString()
          }
        }));

        res.json({ success: true, data: providers });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

module.exports = {
  addPaymentTables,
  PAYMENT_PROVIDERS,
  calculateFee,
  processFiatDeposit,
  processCryptoWithdrawal,
  paymentEndpoints
};
