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

  // AML watchlists. Screening compares a customer's name and country against
  // these tables. Operators load them from an official source (OFAC SDN, EU
  // consolidated list, UN Security Council list, PEP registers) through
  // importWatchlistEntries; nothing is inferred from a built-in name list.
  db.exec(`
    CREATE TABLE IF NOT EXISTS aml_watchlist (
      id TEXT PRIMARY KEY,
      list_type TEXT NOT NULL,
      full_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      country TEXT,
      source TEXT NOT NULL,
      external_id TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(list_type, source, external_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sanctioned_jurisdictions (
      country_code TEXT PRIMARY KEY,
      country_name TEXT NOT NULL,
      program TEXT NOT NULL,
      source TEXT NOT NULL,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user ON kyc_submissions(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_submissions_status ON kyc_submissions(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kyc_addresses_user ON kyc_addresses(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_aml_screenings_user ON aml_screenings(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_compliance_flags_user ON compliance_flags(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_aml_watchlist_norm ON aml_watchlist(normalized_name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_aml_watchlist_type ON aml_watchlist(list_type)`);

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
    const userRow = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(userId);
    const emailVerified = Boolean(userRow && userRow.email_verified);
    const addressVerified = Boolean(
      db.prepare('SELECT id FROM kyc_addresses WHERE user_id = ? AND verification_status = "verified"').get(userId),
    );
    const docVerified = Boolean(
      db.prepare('SELECT id FROM kyc_documents WHERE user_id = ? AND status = "verified"').get(userId),
    );
    // Only a completed screening with a low or medium outcome counts as passed;
    // an unavailable or high-risk screening does not raise the level.
    const amlPassed = Boolean(
      db.prepare(
        'SELECT id FROM aml_screenings WHERE user_id = ? AND status = "completed" AND risk_level IN ("low", "medium")',
      ).get(userId),
    );

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
 * Normalize a personal or entity name for comparison: strip diacritics,
 * punctuation and case, and collapse whitespace.
 */
function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Import (or refresh) watchlist entries from an official source.
 *
 * Nothing is hardcoded: an operator supplies the parsed rows. Entries are
 * upserted on (list_type, source, external_id) so a refresh replaces the
 * previous load from the same source.
 *
 * @param {Array<{listType: string, fullName: string, country?: string,
 *   source: string, externalId?: string}>} entries
 */
function importWatchlistEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('importWatchlistEntries requires a non-empty array of entries');
  }
  const insert = db.prepare(`
    INSERT INTO aml_watchlist (id, list_type, full_name, normalized_name, country, source, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(list_type, source, external_id) DO UPDATE SET
      full_name = excluded.full_name,
      normalized_name = excluded.normalized_name,
      country = excluded.country,
      added_at = CURRENT_TIMESTAMP
  `);
  let imported = 0;
  const tx = db.transaction((rows) => {
    for (const entry of rows) {
      if (!entry || !entry.listType || !entry.fullName || !entry.source) {
        throw new Error('each entry needs listType, fullName and source');
      }
      insert.run(
        uuidv4(),
        entry.listType,
        entry.fullName,
        normalizeName(entry.fullName),
        entry.country ? normalizeName(entry.country) : null,
        entry.source,
        entry.externalId || null,
      );
      imported += 1;
    }
  });
  tx(entries);
  return { imported };
}

/**
 * Record the jurisdictions a sanctions program covers.
 *
 * @param {Array<{countryCode: string, countryName: string, program: string,
 *   source: string}>} jurisdictions
 */
function importSanctionedJurisdictions(jurisdictions) {
  if (!Array.isArray(jurisdictions) || jurisdictions.length === 0) {
    throw new Error('importSanctionedJurisdictions requires a non-empty array');
  }
  const insert = db.prepare(`
    INSERT INTO sanctioned_jurisdictions (country_code, country_name, program, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(country_code) DO UPDATE SET
      country_name = excluded.country_name,
      program = excluded.program,
      source = excluded.source
  `);
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      if (!row || !row.countryCode || !row.countryName || !row.program || !row.source) {
        throw new Error('each jurisdiction needs countryCode, countryName, program and source');
      }
      insert.run(
        String(row.countryCode).toUpperCase(),
        row.countryName,
        row.program,
        row.source,
      );
    }
  });
  tx(jurisdictions);
  return { imported: jurisdictions.length };
}

/**
 * Screen a customer against the loaded watchlists.
 *
 * Returns a measured result. A name or country that matches nothing on the
 * loaded lists is reported as `no_match`, which is the honest reading of "not
 * on the lists we hold" - it is not an assertion that the customer is clean.
 * An empty watchlist yields `not_screened` so the caller can hold the
 * submission for review instead of treating it as a pass.
 */
function performAMLScreening(userId, firstName, lastName, country) {
  const fullName = normalizeName(`${firstName || ''} ${lastName || ''}`);
  if (!fullName) {
    throw new Error('AML screening requires a first and last name');
  }

  const watchlistCount = db.prepare('SELECT COUNT(*) AS n FROM aml_watchlist').get().n;
  const jurisdictionCount = db.prepare('SELECT COUNT(*) AS n FROM sanctioned_jurisdictions').get().n;

  if (watchlistCount === 0 && jurisdictionCount === 0) {
    const screeningId = uuidv4();
    db.prepare(`
      INSERT INTO aml_screenings (id, user_id, risk_level, status, pep_status, sanctions_status, notes)
      VALUES (?, ?, 'unknown', 'not_screened', 'unknown', 'unknown', ?)
    `).run(screeningId, userId, 'No watchlist data loaded; screening could not be performed');
    db.prepare(`
      INSERT INTO compliance_flags (id, user_id, flag_type, severity, reason, action_required)
      VALUES (?, ?, 'aml_screening', 'medium', ?, 'manual_review')
    `).run(uuidv4(), userId, 'AML screening unavailable: no watchlist loaded');
    return {
      screeningId,
      riskLevel: 'unknown',
      pepStatus: 'unknown',
      sanctionsStatus: 'unknown',
      screened: false,
    };
  }

  // Exact normalized-name match against the sanctions/PEP lists.
  const nameMatches = db.prepare(`
    SELECT list_type, source, external_id, full_name
    FROM aml_watchlist
    WHERE normalized_name = ?
  `).all(fullName);

  const sanctionsMatch = nameMatches.filter((m) => m.list_type === 'sanctions');
  const pepMatch = nameMatches.filter((m) => m.list_type === 'pep');

  const normalizedCountry = normalizeName(country);
  const jurisdiction = normalizedCountry
    ? db.prepare(`
        SELECT country_name, program FROM sanctioned_jurisdictions
        WHERE LOWER(country_name) = ? OR country_code = ?
      `).get(normalizedCountry, String(country || '').toUpperCase())
    : null;

  let riskLevel = 'low';
  if (sanctionsMatch.length > 0 || jurisdiction) {
    riskLevel = 'high';
  } else if (pepMatch.length > 0) {
    riskLevel = 'medium';
  }

  const pepStatus = pepMatch.length > 0 ? 'match' : 'no_match';
  const sanctionsStatus =
    sanctionsMatch.length > 0 || jurisdiction ? 'match' : 'no_match';

  const notes = [
    sanctionsMatch.length > 0
      ? `sanctions name match: ${sanctionsMatch.map((m) => `${m.full_name} (${m.source})`).join('; ')}`
      : null,
    jurisdiction
      ? `sanctioned jurisdiction: ${jurisdiction.country_name} (${jurisdiction.program})`
      : null,
    pepMatch.length > 0
      ? `PEP name match: ${pepMatch.map((m) => `${m.full_name} (${m.source})`).join('; ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const screeningId = uuidv4();
  db.prepare(`
    INSERT INTO aml_screenings (id, user_id, risk_level, status, pep_status, sanctions_status, notes)
    VALUES (?, ?, ?, 'completed', ?, ?, ?)
  `).run(screeningId, userId, riskLevel, pepStatus, sanctionsStatus, notes || null);

  if (riskLevel === 'high') {
    db.prepare(`
      INSERT INTO compliance_flags (id, user_id, flag_type, severity, reason, action_required)
      VALUES (?, ?, 'aml_screening', 'high', ?, 'manual_review')
    `).run(uuidv4(), userId, notes || 'High AML risk detected');
  }

  return { screeningId, riskLevel, pepStatus, sanctionsStatus, screened: true };
}

module.exports = {
  addKYCTables,
  KYC_LEVELS,
  calculateKYCLevel,
  checkWithdrawalLimits,
  performAMLScreening,
  importWatchlistEntries,
  importSanctionedJurisdictions,
  normalizeName,
};
