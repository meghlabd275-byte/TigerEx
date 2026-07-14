/**
 * TigerEx Phase 2: KYC & Compliance Module
 * Know Your Customer (KYC), AML, and regulatory compliance
 */

// ============================================================================
// DATABASE TABLES FOR KYC/COMPLIANCE
// ============================================================================

function addKYCTables() {
  // KYC submissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      kyc_level INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      submission_date TEXT DEFAULT CURRENT_TIMESTAMP,
      verification_date TEXT,
      expires_at TEXT,
      rejection_reason TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Personal identity documents
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_number TEXT,
      issuing_country TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      document_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Address verification
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT,
      city TEXT NOT NULL,
      state_province TEXT,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      verification_document_url TEXT,
      verification_status TEXT DEFAULT 'pending',
      verification_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // AML (Anti-Money Laundering) screening results
  db.exec(`
    CREATE TABLE IF NOT EXISTS aml_screenings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      screening_date TEXT DEFAULT CURRENT_TIMESTAMP,
      risk_level TEXT DEFAULT 'low',
      status TEXT DEFAULT 'pending',
      pep_status TEXT DEFAULT 'not_listed',
      sanctions_status TEXT DEFAULT 'not_listed',
      notes TEXT,
      provider TEXT DEFAULT 'internal',
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Transaction limits based on KYC level
  db.exec(`
    CREATE TABLE IF NOT EXISTS kyc_limits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      kyc_level INTEGER DEFAULT 0,
      daily_deposit_limit REAL DEFAULT 0,
      daily_withdrawal_limit REAL DEFAULT 0,
      daily_trading_volume_limit REAL DEFAULT 0,
      monthly_deposit_limit REAL DEFAULT 0,
      monthly_withdrawal_limit REAL DEFAULT 0,
      monthly_trading_volume_limit REAL DEFAULT 0,
      used_daily_deposits REAL DEFAULT 0,
      used_daily_withdrawals REAL DEFAULT 0,
      used_daily_volume REAL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Compliance flags and restrictions
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_flags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      reason TEXT NOT NULL,
      action_required TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user ON kyc_submissions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_submissions_status ON kyc_submissions(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_addresses_user ON kyc_addresses(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_aml_screenings_user ON aml_screenings(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_compliance_flags_user ON compliance_flags(user_id)`);

  console.log('✅ KYC tables created');
}

// ============================================================================
// KYC LEVEL DEFINITIONS
// ============================================================================

const KYC_LEVELS = {
  0: {
    name: 'Unverified',
    description: 'Basic account access',
    dailyWithdrawalLimit: 0,
    dailyDepositLimit: 0,
    tradingLimit: 0,
    requirements: []
  },
  1: {
    name: 'Basic KYC',
    description: 'Email verified, personal info submitted',
    dailyWithdrawalLimit: 500,
    dailyDepositLimit: 2000,
    tradingLimit: 5000,
    requirements: ['email_verified', 'personal_info']
  },
  2: {
    name: 'Intermediate KYC',
    description: 'ID verification complete',
    dailyWithdrawalLimit: 5000,
    dailyDepositLimit: 20000,
    tradingLimit: 100000,
    requirements: ['email_verified', 'personal_info', 'id_verified']
  },
  3: {
    name: 'Advanced KYC',
    description: 'Address & advanced verification',
    dailyWithdrawalLimit: 50000,
    dailyDepositLimit: 100000,
    tradingLimit: 1000000,
    requirements: ['email_verified', 'personal_info', 'id_verified', 'address_verified', 'aml_screening']
  },
  4: {
    name: 'Premium/Institutional',
    description: 'Full verification + legal entity',
    dailyWithdrawalLimit: 500000,
    dailyDepositLimit: 1000000,
    tradingLimit: Infinity,
    requirements: ['all']
  }
};

// ============================================================================
// KYC VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Calculate KYC level based on completed verifications
 */
function calculateKYCLevel(userId) {
  try {
    const emailVerified = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(userId).email_verified;
    const addressVerified = db.prepare('SELECT * FROM kyc_addresses WHERE user_id = ?').get(userId) ? true : false;
    const docVerified = db.prepare('SELECT * FROM kyc_documents WHERE user_id = ? AND status = "verified"')
      .get(userId) ? true : false;
    const amlPassed = db.prepare('SELECT * FROM aml_screenings WHERE user_id = ? AND risk_level IN ("low", "medium")')
      .get(userId) ? true : false;

    let level = 0;
    if (emailVerified) level = 1;
    if (emailVerified && docVerified) level = 2;
    if (emailVerified && docVerified && addressVerified) level = 3;
    if (emailVerified && docVerified && addressVerified && amlPassed) level = 4;

    return level;
  } catch (error) {
    console.error('Error calculating KYC level:', error);
    return 0;
  }
}

/**
 * Verify if user can perform transaction
 */
function checkWithdrawalLimits(userId, amount) {
  try {
    const user = db.prepare('SELECT kyc_level FROM users WHERE id = ?').get(userId);
    const limits = KYC_LEVELS[user.kyc_level] || KYC_LEVELS[0];

    if (limits.dailyWithdrawalLimit === 0) {
      return { allowed: false, reason: 'KYC level does not support withdrawals' };
    }

    if (amount > limits.dailyWithdrawalLimit) {
      return { 
        allowed: false, 
        reason: `Amount exceeds daily withdrawal limit of ${limits.dailyWithdrawalLimit}` 
      };
    }

    // Check compliance flags
    const flags = db.prepare('SELECT * FROM compliance_flags WHERE user_id = ? AND resolved_at IS NULL')
      .all(userId);
    
    if (flags && flags.length > 0) {
      return { allowed: false, reason: 'Account has compliance restrictions' };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Error checking withdrawal limits:', error);
    return { allowed: false, reason: 'System error' };
  }
}

/**
 * Perform AML screening
 */
function performAMLScreening(userId, firstName, lastName, country) {
  try {
    // Simulate AML screening (in production, connect to Sumsub or Jumio)
    // For now, use simple risk scoring

    let riskLevel = 'low';
    let pepStatus = 'not_listed';
    let sanctionsStatus = 'not_listed';

    // Simple PEP check (simulated)
    const commonPepNames = ['bin', 'trump', 'putin', 'xi', 'khan', 'macron'];
    if (commonPepNames.some(name => firstName.toLowerCase().includes(name) || lastName.toLowerCase().includes(name))) {
      pepStatus = 'potential_match';
      riskLevel = 'medium';
    }

    // Sanctions country check (simulated)
    const sanctionedCountries = ['iran', 'north korea', 'syria', 'crimea'];
    if (sanctionedCountries.some(c => country.toLowerCase().includes(c))) {
      sanctionsStatus = 'potential_match';
      riskLevel = 'high';
    }

    const screeningId = uuidv4();
    db.prepare(`
      INSERT INTO aml_screenings (id, user_id, risk_level, pep_status, sanctions_status, screening_date)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(screeningId, userId, riskLevel, pepStatus, sanctionsStatus);

    if (riskLevel === 'high') {
      db.prepare(`
        INSERT INTO compliance_flags (id, user_id, flag_type, severity, reason, action_required)
        VALUES (?, ?, 'aml_screening', 'high', 'High AML risk detected', 'manual_review')
      `).run(uuidv4(), userId);
    }

    return { screeningId, riskLevel, pepStatus, sanctionsStatus };
  } catch (error) {
    console.error('AML screening error:', error);
    return null;
  }
}

// ============================================================================
// KYC API ENDPOINTS (Add to server/index.js)
// ============================================================================

const kycEndpoints = {
  // Submit KYC data
  submitKYC: `
    app.post('/api/v1/kyc/submit', authenticateRequest, async (req, res) => {
      try {
        const { firstName, lastName, dateOfBirth, nationality, documentType, documentNumber, address, city, country, postalCode } = req.body;

        // Validate input
        if (!firstName || !lastName || !dateOfBirth || !nationality) {
          return res.status(400).json({ success: false, error: 'Missing personal information' });
        }

        // Check if already submitted
        const existing = db.prepare('SELECT * FROM kyc_submissions WHERE user_id = ?').get(req.userId);
        if (existing && existing.status === 'verified') {
          return res.status(400).json({ success: false, error: 'Already verified' });
        }

        // Create submission
        const submissionId = uuidv4();
        db.prepare(\`
          INSERT INTO kyc_submissions (id, user_id, status)
          VALUES (?, ?, 'pending')
        \`).run(submissionId, req.userId);

        // Save document
        if (documentNumber) {
          const docId = uuidv4();
          db.prepare(\`
            INSERT INTO kyc_documents (id, user_id, document_type, document_number, issuing_country, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
          \`).run(docId, req.userId, documentType || 'passport', documentNumber, nationality);
        }

        // Save address
        if (address && city && country) {
          const addrId = uuidv4();
          db.prepare(\`
            INSERT INTO kyc_addresses (id, user_id, address_line1, city, country, postal_code, verification_status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
          \`).run(addrId, req.userId, address, city, country, postalCode);
        }

        // Perform AML screening
        const amlResult = performAMLScreening(req.userId, firstName, lastName, nationality);

        // Update user with personal info
        db.prepare(\`
          UPDATE users SET country = ? WHERE id = ?
        \`).run(country, req.userId);

        res.json({
          success: true,
          data: {
            submissionId,
            status: 'pending',
            amlRiskLevel: amlResult.riskLevel,
            message: 'KYC submission received. Manual review in progress.'
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Get KYC status
  getKYCStatus: \`
    app.get('/api/v1/kyc/status', authenticateRequest, (req, res) => {
      try {
        const user = db.prepare('SELECT kyc_level, country FROM users WHERE id = ?').get(req.userId);
        const submission = db.prepare('SELECT * FROM kyc_submissions WHERE user_id = ?').get(req.userId);
        const amlResult = db.prepare('SELECT * FROM aml_screenings WHERE user_id = ? ORDER BY screening_date DESC LIMIT 1')
          .get(req.userId);
        const kycLevel = KYC_LEVELS[user.kyc_level] || KYC_LEVELS[0];

        res.json({
          success: true,
          data: {
            kycLevel: user.kyc_level,
            levelName: kycLevel.name,
            description: kycLevel.description,
            status: submission ? submission.status : 'not_submitted',
            limits: {
              dailyWithdrawal: kycLevel.dailyWithdrawalLimit,
              dailyDeposit: kycLevel.dailyDepositLimit,
              dailyTrading: kycLevel.tradingLimit
            },
            aml: amlResult ? {
              riskLevel: amlResult.risk_level,
              pepStatus: amlResult.pep_status,
              sanctionsStatus: amlResult.sanctions_status
            } : null,
            requirements: kycLevel.requirements
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`,

  // Check transaction eligibility
  checkTransactionEligibility: \`
    app.post('/api/v1/kyc/check-eligibility', authenticateRequest, (req, res) => {
      try {
        const { transactionType, amount } = req.body;

        if (!transactionType || !amount) {
          return res.status(400).json({ success: false, error: 'Missing parameters' });
        }

        let check;
        if (transactionType === 'withdrawal') {
          check = checkWithdrawalLimits(req.userId, amount);
        } else if (transactionType === 'deposit') {
          check = checkWithdrawalLimits(req.userId, amount); // Use same for now
        } else {
          return res.status(400).json({ success: false, error: 'Invalid transaction type' });
        }

        res.json({
          success: true,
          data: {
            eligible: check.allowed,
            reason: check.reason
          }
        });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });
  \`
};

module.exports = {
  addKYCTables,
  KYC_LEVELS,
  calculateKYCLevel,
  checkWithdrawalLimits,
  performAMLScreening,
  kycEndpoints
};
