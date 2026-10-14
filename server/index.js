/**
 * TigerEx Enhanced Backend Server v2.0
 * - Real order matching engine
 * - 100+ trading pairs
 * - Advanced trading logic
 * - Production-ready
 */

require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.REFRESH_SECRET;
const PORT = Number(process.env.PORT || 8080);
const isProduction = process.env.NODE_ENV === "production";

function assertRuntimeConfiguration() {
  const weakSecret = (value) => !value || Buffer.byteLength(value, "utf8") < 32 ||
    /change-in-production|change-me|example|default|tigerex-secret/i.test(value);
  if (weakSecret(JWT_SECRET)) {
    throw new Error("JWT_SECRET must be a unique, high-entropy secret of at least 32 bytes.");
  }
  if (weakSecret(REFRESH_SECRET) || REFRESH_SECRET === JWT_SECRET) {
    throw new Error("JWT_REFRESH_SECRET must be a different, unique secret of at least 32 bytes.");
  }
  if (!process.env.DATABASE_URL &&
      !(process.env.DB_USER && process.env.DB_HOST && process.env.DB_NAME && process.env.DB_PASSWORD)) {
    throw new Error("Configure DATABASE_URL or DB_USER, DB_HOST, DB_NAME, and DB_PASSWORD.");
  }
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    throw new Error("Configure REDIS_URL or REDIS_HOST explicitly.");
  }
  if (isProduction && !process.env.CORS_ORIGIN) {
    throw new Error("CORS_ORIGIN must be explicitly configured in production.");
  }
  if (isProduction && !process.env.REDIS_URL && !process.env.REDIS_PASSWORD) {
    throw new Error("REDIS_PASSWORD is required for production Redis connections.");
  }
}
assertRuntimeConfiguration();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const Redis = require("ioredis");
const path = require("path");
const WebSocket = require("ws");

// ============================================================================
// INITIALIZATION
// ============================================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Database
const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT || 5432),
      max: 20,
      connectionTimeoutMillis: 5000,
    });

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

console.log("✅ PostgreSQL Database pool initialized");

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, enableOfflineQueue: false })
  : new Redis({
      port: Number(process.env.REDIS_PORT || 6379),
      host: process.env.REDIS_HOST,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });

redis.on("connect", () => console.log("✅ Redis client connected"));
redis.on("error", (err) => console.error("❌ Redis client error", err));

// ============================================================================
// CONSTANTS & CONFIG

const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws";

// Function to connect to Binance WebSocket and subscribe to aggTrade streams
function connectBinanceWebSocket() {
  const ws = new WebSocket(BINANCE_WS_URL);

  ws.onopen = () => {
    console.log("✅ Connected to Binance WebSocket");
    const subscriptionPayload = {
      method: "SUBSCRIBE",
      params: TRADING_PAIRS.map(pair => `${pair.symbol.toLowerCase()}@aggTrade`),
      id: 1
    };
    ws.send(JSON.stringify(subscriptionPayload));
    console.log(`Subscribed to aggTrade streams for ${TRADING_PAIRS.length} pairs`);
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    // Process the message, e.g., update Redis cache or emit to clients via Socket.IO
    // For now, just log it
    // console.log("Received from Binance WS:", message);
    if (message.e === 'aggTrade') {
      io.to(message.s).emit('aggTrade', message);
      // Further processing to update database or Redis for historical data/analytics
    }
  };

  ws.onerror = (error) => {
    console.error("❌ Binance WebSocket error:", error);
  };

  ws.onclose = () => {
    console.log("🔌 Disconnected from Binance WebSocket. Reconnecting...");
    setTimeout(connectBinanceWebSocket, 5000); // Reconnect after 5 seconds
  };
}
// ============================================================================

// Secrets and port are validated before service initialization.

// Market metadata is loaded from the durable market configuration; no symbols or prices are fabricated.
let TRADING_PAIRS = [];

async function loadTradingPairs() {
  const result = await pool.query(
    "SELECT symbol, base_asset, quote_asset FROM markets WHERE status = 'trading' ORDER BY display_priority ASC"
  );
  TRADING_PAIRS = result.rows.map((market) => ({
    symbol: String(market.symbol).toUpperCase(),
    base_asset: String(market.base_asset).toUpperCase(),
    quote_asset: String(market.quote_asset).toUpperCase(),
  }));
  return TRADING_PAIRS;
}

// Initialize all tables
// initializeDatabase(); // Now handled by migration script

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(morgan("combined"));
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb", parameterLimit: 100 }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, error: "Rate limit exceeded" }
});
app.use("/api/", limiter);



// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

async function initializeDatabase() {
  try {
    const client = await pool.connect();
    // Run migration script
    const migrate = require("./db/migrate.js");
    await migrate();
    client.release();
    console.log("✅ Database initialized with PostgreSQL");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
    process.exit(1);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateToken(userId, type = "access") {
  const secret = type === "access" ? JWT_SECRET : REFRESH_SECRET;
  const expiresIn = type === "access" ? "24h" : "7d";
  return jwt.sign({ userId, type }, secret, { expiresIn });
}

function verifyToken(token, type = "access") {
  try {
    const secret = type === "access" ? JWT_SECRET : REFRESH_SECRET;
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
}

async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  const decoded = verifyToken(token, "access");
  if (!decoded) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }

  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(401).json({ success: false, error: "Session ID not provided" });
  }

  const cachedSession = await redis.get(`session:${decoded.userId}:${sessionId}`);
  if (!cachedSession) {
    return res.status(401).json({ success: false, error: "Invalid or expired session" });
  }

  req.userId = decoded.userId;
  req.sessionId = sessionId;
  next();
}

// Real order matching engine - Production grade
async function matchOrders(symbol, side, price, quantity, userId, orderId) {
  try {
    const oppositeSide = side === "buy" ? "sell" : "buy";
    const market = TRADING_PAIRS.find(p => p.symbol === symbol);
    if (!market) return { filledQuantity: 0, filledValue: 0 };

    let remainingQuantity = quantity;
    let totalFilledQuantity = 0;
    let totalCost = 0;

    // Find best matching orders (price priority, then time)
    const orderSort = side === "buy" ? "price ASC" : "price DESC";

    let query = `
      SELECT * FROM orders
      WHERE symbol = $1
      AND side = $2
      AND status IN (
        'new',
        'partially_filled'
      )
      AND user_id != $3
    `;
    const queryParams = [symbol, oppositeSide, userId];

    if (side === "buy") {
      query += " AND price <= $4";
    } else {
      query += " AND price >= $4";
    }
    queryParams.push(price);

    query += `
      ORDER BY ${orderSort}, created_at ASC
      LIMIT 100
    `;

    const matchingOrders = (await pool.query(query, queryParams)).rows;

    for (const matchOrder of matchingOrders) {
      if (remainingQuantity <= 0) break;

      const availableQty = matchOrder.quantity - matchOrder.filled_quantity;
      if (availableQty <= 0) continue;

      const fillQty = Math.min(remainingQuantity, availableQty);
      const fillPrice = matchOrder.price;
      const fillCost = fillQty * fillPrice;
      const makerFee = fillCost * 0.001;
      const takerFee = fillCost * 0.001;

      // Record trade
      const tradeId = uuidv4();
      await pool.query(
        `INSERT INTO trades (id, symbol, maker_id, taker_id, maker_order_id, taker_order_id, side, price, quantity, fee, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          tradeId,
          symbol,
          matchOrder.user_id,
          userId,
          matchOrder.id,
          orderId,
          side,
          fillPrice,
          fillQty,
          takerFee,
        ]
      );

      // Update maker order status
      const makerNewFilledQty = matchOrder.filled_quantity + fillQty;
      const makerStatus = makerNewFilledQty >= matchOrder.quantity ? "filled" : "partially_filled";
      await pool.query(
        `UPDATE orders SET filled_quantity = $1, status = $2, updated_at = NOW()
        WHERE id = $3`,
        [makerNewFilledQty, makerStatus, matchOrder.id]
      );

      // Handle maker wallet: if they were selling, credit them; if buying, credit them base
      if (oppositeSide === "sell") {
        // Maker was selling, credit with quote
          const quoteWallet = (await pool.query(
            "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
            [matchOrder.user_id, market.quote_asset]
          )).rows[0];

        if (quoteWallet) {
          await pool.query(
            `UPDATE wallets SET balance = balance + $1, locked = locked - $2, updated_at = NOW()
            WHERE id = $3`,
            [fillCost - makerFee, fillQty, quoteWallet.id]
          );
        }
      } else {
        // Maker was buying, credit with base
          const baseWallet = (await pool.query(
            "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
            [matchOrder.user_id, market.base_asset]
          )).rows[0];

        if (baseWallet) {
          await pool.query(
            `UPDATE wallets SET balance = balance + $1, locked = locked - $2, updated_at = NOW()
            WHERE id = $3`,
            [fillQty, fillCost, baseWallet.id]
          );
        }
      }

      remainingQuantity -= fillQty;
      totalFilledQuantity += fillQty;
      totalCost += fillCost;
    }

    // Update taker order
    const takerStatus = remainingQuantity <= 0 ? "filled" : (totalFilledQuantity > 0 ? "partially_filled" : "new");
    await pool.query(
      `UPDATE orders SET filled_quantity = $1, status = $2, updated_at = NOW()
      WHERE id = $3`,
      [totalFilledQuantity, takerStatus, orderId]
    );

    // Update taker wallet for filled
    if (side === "buy" && totalFilledQuantity > 0) {
      // Buyer gets base, release locked quote
      const baseWallet = (await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
        [userId, market.base_asset]
      )).rows[0];

      if (baseWallet) {
        await pool.query(
          `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
          WHERE id = $2`,
          [totalFilledQuantity, baseWallet.id]
        );
      }
    } else if (side === "sell" && totalFilledQuantity > 0) {
      // Seller gets quote, locked base already deducted
      const quoteWallet = (await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
        [userId, market.quote_asset]
      )).rows[0];

      if (quoteWallet) {
        await pool.query(
          `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
          WHERE id = $2`,
          [totalCost - takerFee, quoteWallet.id]
        );
      }
    }

    // Release locked for unfilled
    const unfilledQty = remainingQuantity;
    if (unfilledQty > 0) {
      if (side === "buy") {
        const quoteWallet = (await pool.query(
          "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
          [userId, market.quote_asset]
        )).rows[0];

        if (quoteWallet) {
          await pool.query(
            `UPDATE wallets SET locked = locked - $1, updated_at = NOW()
            WHERE id = $2`,
            [unfilledQty * price, quoteWallet.id]
          );
        }
      } else {
        const baseWallet = (await pool.query(
          "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
          [userId, market.base_asset]
        )).rows[0];

        if (baseWallet) {
          await pool.query(
            `UPDATE wallets SET locked = locked - $1, updated_at = NOW()
            WHERE id = $2`,
            [unfilledQty, baseWallet.id]
          );
        }
      }
    }

    return { filledQuantity: totalFilledQuantity, filledValue: totalCost };
  } catch (error) {
    console.error("Order matching error:", error);
    return { filledQuantity: 0, filledValue: 0 };
  }
}

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get("/api/v1/health", (req, res) => {
  res.json({ success: true, message: "Server is healthy" });
});

// User registration
app.post("/api/v1/auth/register", async (req, res) => {
  try {
    const { email, username, password, referralCode } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    }

    const existingUser = (await pool.query("SELECT id FROM users WHERE email = $1 OR username = $2", [email, username])).rows[0];
    if (existingUser) {
      return res.status(400).json({ success: false, error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const userReferralCode = uuidv4().substring(0, 8).toUpperCase();

        await pool.query(
      `INSERT INTO users (id, email, username, password_hash, referral_code, referred_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, username, passwordHash, userReferralCode, referralCode || null]
    );

    // Wallet records start at zero. Deposits must be credited only by the
    // verified blockchain/fiat deposit pipeline, never by registration.
    const currencies = [...new Set(TRADING_PAIRS.flatMap((market) => [market.base_asset, market.quote_asset]))];
    for (const currency of currencies) {
      await pool.query(
        `INSERT INTO wallets (id, user_id, currency, balance) VALUES ($1, $2, $3, $4)`,
        [uuidv4(), userId, currency, 0]
      );
    }

    const accessToken = generateToken(userId, "access");
    const refreshToken = generateToken(userId, "refresh");

    // Create session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO user_sessions (id, user_id, refresh_token, expires_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())`,
      [sessionId, userId, refreshToken, expiresAt]
    );

    // Cache session in Redis
    await redis.set(`session:${userId}:${sessionId}`, refreshToken, "EX", 7 * 24 * 60 * 60);

    res.status(201).json({
      success: true,
      data: {
        user: { id: userId, email, username, kycLevel: 0 },
        accessToken,
        refreshToken,
        sessionId,
        referralCode: userReferralCode
      }
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Login
app.post("/api/v1/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Missing email or password" });
    }

    const user = (await pool.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const accessToken = generateToken(user.id, "access");
    const refreshToken = generateToken(user.id, "refresh");

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO user_sessions (id, user_id, refresh_token, expires_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())`,
      [sessionId, user.id, refreshToken, expiresAt]
    );

    // Cache session in Redis
    await redis.set(`session:${user.id}:${sessionId}`, refreshToken, "EX", 7 * 24 * 60 * 60);

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
        refreshToken,
        sessionId
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Logout
app.post("/api/v1/auth/logout", authenticateRequest, async (req, res) => {
  try {
    const { userId, sessionId } = req;

    // Invalidate session in PostgreSQL
    await pool.query(
      `DELETE FROM user_sessions WHERE user_id = $1 AND id = $2`,
      [userId, sessionId]
    );

    // Invalidate session in Redis
    await redis.del(`session:${userId}:${sessionId}`);

    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get current user
app.get("/api/v1/auth/me", authenticateRequest, async (req, res) => {
  try {
    const user = (await pool.query("SELECT id, email, username, kyc_level, country, created_at FROM users WHERE id = $1", [req.userId])).rows[0];
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    console.error("Auth me error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// KYC ROUTES
// ============================================================================

// Submit KYC information
app.post("/api/v1/kyc/submit", authenticateRequest, async (req, res) => {
  try {
    const { firstName, lastName, dateOfBirth, nationality, countryOfResidence, addressLine1, addressLine2, city, state, postalCode, country, documentType, documentNumber, documentExpiry, documentFrontUrl, documentBackUrl, selfieUrl } = req.body;

    // Basic validation
    if (!firstName || !lastName || !dateOfBirth || !nationality || !countryOfResidence || !addressLine1 || !city || !postalCode || !country || !documentType || !documentNumber || !documentFrontUrl || !selfieUrl) {
      return res.status(400).json({ success: false, error: "Missing required KYC fields" });
    }

    // Check if a KYC record already exists for the user
    const existingKyc = (await pool.query("SELECT id FROM kyc_records WHERE user_id = $1", [req.userId])).rows[0];

    if (existingKyc) {
      // Update existing KYC record
      await pool.query(
        `UPDATE kyc_records SET
          first_name = $1, last_name = $2, date_of_birth = $3, nationality = $4, country_of_residence = $5,
          address_line1 = $6, address_line2 = $7, city = $8, state = $9, postal_code = $10, country = $11,
          document_type = $12, document_number = $13, document_expiry = $14, document_front_url = $15, document_back_url = $16, selfie_url = $17,
          status = 'pending', updated_at = NOW()
        WHERE user_id = $18`,
        [firstName, lastName, dateOfBirth, nationality, countryOfResidence, addressLine1, addressLine2, city, state, postalCode, country, documentType, documentNumber, documentExpiry, documentFrontUrl, documentBackUrl, selfieUrl, req.userId]
      );
    } else {
      // Insert new KYC record
      await pool.query(
        `INSERT INTO kyc_records (
          user_id, first_name, last_name, date_of_birth, nationality, country_of_residence,
          address_line1, address_line2, city, state, postal_code, country,
          document_type, document_number, document_expiry, document_front_url, document_back_url, selfie_url,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pending')`,
        [req.userId, firstName, lastName, dateOfBirth, nationality, countryOfResidence, addressLine1, addressLine2, city, state, postalCode, country, documentType, documentNumber, documentExpiry, documentFrontUrl, documentBackUrl, selfieUrl]
      );
    }

    // Update user's kyc_status to pending
    await pool.query("UPDATE users SET kyc_status = 'pending', updated_at = NOW() WHERE id = $1", [req.userId]);

    res.json({ success: true, message: "KYC information submitted successfully for review" });
  } catch (error) {
    console.error("KYC submission error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get KYC status
app.get("/api/v1/kyc/status", authenticateRequest, async (req, res) => {
  try {
    const kycRecord = (await pool.query("SELECT kyc_level, status FROM kyc_records WHERE user_id = $1", [req.userId])).rows[0];
    if (!kycRecord) {
      return res.json({ success: true, data: { kycLevel: 0, kycStatus: "none" } });
    }
    res.json({ success: true, data: { kycLevel: kycRecord.kyc_level, kycStatus: kycRecord.status } });
  } catch (error) {
    console.error("Get KYC status error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// FUTURES TRADING ROUTES
// ============================================================================

// Futures order execution is disabled until the canonical risk engine, margin ledger,
// matching engine, and liquidation pipeline are connected.
app.post("/api/v1/futures/position/open", authenticateRequest, async (_req, res) => {
  return res.status(503).json({
    success: false,
    error: "Futures trading unavailable: canonical risk and execution services are not configured",
  });
});

// // Futures closing is disabled until canonical margin, risk, matching, and settlement services exist.
app.post("/api/v1/futures/position/close", authenticateRequest, async (_req, res) => {
  return res.status(503).json({
    success: false,
    error: "Futures closing unavailable: canonical risk and execution services are not configured",
  });
});

// // Get all open futures positions for a user
app.get("/api/v1/futures/positions", authenticateRequest, async (req, res) => {
  try {
    const positions = (await pool.query("SELECT * FROM futures_positions WHERE user_id = $1 AND status = 'open'", [req.userId])).rows;
    res.json({ success: true, data: positions });
  } catch (error) {
    console.error("Get futures positions error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// MARGIN TRADING ROUTES
// ============================================================================

// Margin transfers are fail-closed until a canonical, transactionally safe
// ledger-backed collateral transfer service is configured.
app.post("/api/v1/margin/deposit", authenticateRequest, async (_req, res) => {
  return res.status(503).json({
    success: false,
    error: "Margin collateral transfers are unavailable until the ledger service is configured",
  });
});

// Margin withdrawals remain disabled until atomic ledger transfers and
// collateral reconciliation are wired into the canonical accounting service.
app.post("/api/v1/margin/withdraw", authenticateRequest, async (_req, res) => {
  return res.status(503).json({
    success: false,
    error: "Margin collateral transfers are unavailable until the ledger service is configured",
  });
});

// Get margin account balance
app.get("/api/v1/margin/balance", authenticateRequest, async (req, res) => {
  try {
    const marginAccounts = (await pool.query("SELECT currency, balance FROM margin_accounts WHERE user_id = $1", [req.userId])).rows;
    res.json({ success: true, data: marginAccounts });
  } catch (error) {
    console.error("Get margin balance error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// WALLET ROUTES
// ============================================================================

// Never return fabricated UUIDs as blockchain deposit addresses. Enable this
// endpoint only after a real custody/address-derivation provider is integrated.
app.post("/api/v1/wallet/address", authenticateRequest, async (_req, res) => {
  return res.status(503).json({
    success: false,
    error: "Deposit address generation is unavailable: no verified custody provider is configured",
  });
});

// Initiate a deposit
app.post("/api/v1/wallet/deposit", authenticateRequest, async (req, res) => {
  try {
    const { currency, network, amount, txid, address } = req.body;

    if (!currency || !network || !amount || !txid || !address) {
      return res.status(400).json({ success: false, error: "Missing required deposit fields" });
    }

    // In a real system, you would verify the transaction on the blockchain
    // and ensure the address belongs to the user.

    const depositId = uuidv4();
    await pool.query(
      `INSERT INTO deposits (id, user_id, currency, network, amount, txid, address, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())`,
      [depositId, req.userId, currency, network, amount, txid, address]
    );

    res.json({ success: true, message: "Deposit initiated successfully. Awaiting confirmation." });
  } catch (error) {
    console.error("Deposit error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Initiate a withdrawal
// Outbound transfers require an audited custody signer, idempotent request
// handling, policy checks, and atomic ledger reservations. Fail closed until
// that complete pipeline is configured.
app.post("/api/v1/wallet/withdrawal", authenticateRequest, async (_req, res) => {
  return res.status(503).json({
    success: false,
    error: "Withdrawals are unavailable: the verified custody and ledger pipeline is not configured",
  });
});

// Get all wallets
app.get("/api/v1/wallet/balance", authenticateRequest, async (req, res) => {
  try {
    const wallets = (await pool.query(
      `SELECT currency, balance, locked FROM wallets WHERE user_id = $1`,
      [req.userId]
    )).rows;
    res.json({ success: true, data: wallets });
  } catch (error) {
    console.error("Wallet balance error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// TRADING ROUTES - REAL ORDER MATCHING
// ============================================================================

// Get all markets
app.get("/api/v1/exchange/info", async (req, res) => {
  try {
    const markets = (await pool.query("SELECT * FROM markets LIMIT 150")).rows;
    res.json({ success: true, data: markets });
  } catch (error) {
    console.error("Exchange info error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get ticker with real data
app.get("/api/v1/ticker/24hr", async (req, res) => {
  try {
    const { symbol } = req.query;

    if (symbol) {
      const ticker = (await pool.query(
        `SELECT
          symbol,
          MAX(price) AS high,
          MIN(price) AS low,
          (SELECT price FROM trades WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1) AS last_price,
          SUM(quantity) AS volume,
          (SELECT price * quantity FROM trades WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1) AS quote_volume
        FROM trades
        WHERE symbol = $1 AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY symbol`,
        [symbol.toUpperCase()]
      )).rows[0];

      if (ticker) {
        res.json({ success: true, data: ticker });
      } else {
        res.status(404).json({ success: false, error: "Ticker not found" });
      }
    } else {
      const tickers = (await pool.query(
        `SELECT
          symbol,
          MAX(price) AS high,
          MIN(price) AS low,
          (SELECT price FROM trades WHERE symbol = t.symbol ORDER BY created_at DESC LIMIT 1) AS last_price,
          SUM(quantity) AS volume,
          (SELECT price * quantity FROM trades WHERE symbol = t.symbol ORDER BY created_at DESC LIMIT 1) AS quote_volume
        FROM trades t
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY symbol`
      )).rows;
      res.json({ success: true, data: tickers });
    }
  } catch (error) {
    console.error("Ticker 24hr error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Place order with REAL matching
app.post("/api/v1/order", authenticateRequest, async (req, res) => {
  try {
    const { symbol, side, type, quantity, price } = req.body;

    if (!symbol || !side || !type || !quantity) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const market = TRADING_PAIRS.find(p => p.symbol === symbol.toUpperCase());
    if (!market) {
      return res.status(400).json({ success: false, error: "Invalid trading pair" });
    }

    const orderPrice = parseFloat(price);
    const orderQuantity = parseFloat(quantity);

    if (isNaN(orderPrice) || isNaN(orderQuantity) || orderPrice <= 0 || orderQuantity <= 0) {
      return res.status(400).json({ success: false, error: "Invalid price or quantity" });
    }

    // Check wallet balance and lock funds
    let wallet;
    let baseWallet;
    let orderValue = orderPrice * orderQuantity;

    if (side === "buy") {
      wallet = (await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
        [req.userId, market.quote_asset]
      )).rows[0];

      if (!wallet || wallet.balance < orderValue) {
        return res.status(400).json({ success: false, error: "Insufficient quote currency balance" });
      }

      // Lock quote currency for buy
      await pool.query(
        `UPDATE wallets SET locked = locked + $1, updated_at = NOW() WHERE id = $2`,
        [orderValue, wallet.id]
      );
      await pool.query(
        `UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
        [orderValue, wallet.id]
      );
    } else {
      wallet = (await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
        [req.userId, market.base_asset]
      )).rows[0];

      if (!wallet || wallet.balance < orderQuantity) {
        return res.status(400).json({ success: false, error: "Insufficient base currency balance" });
      }

      // Lock base currency for sell
      await pool.query(
        `UPDATE wallets SET locked = locked + $1, updated_at = NOW() WHERE id = $2`,
        [orderQuantity, wallet.id]
      );
      await pool.query(
        `UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
        [orderQuantity, wallet.id]
      );
    }

    const orderId = uuidv4();
    await pool.query(
      `INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, filled_quantity, status, time_in_force, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 'GTC', NOW(), NOW())`,
      [orderId, req.userId, symbol.toUpperCase(), side, type, orderPrice, parseFloat(quantity), 0]
    );

    // Match orders (real order matching engine)
    const matchResult = await matchOrders(symbol.toUpperCase(), side, orderPrice, parseFloat(quantity), req.userId, orderId);

    // Get updated order
    const updatedOrder = (await pool.query("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];

    res.json({
      success: true,
      data: {
        orderId,
        symbol: updatedOrder.symbol,
        side: updatedOrder.side,
        type: updatedOrder.type,
        price: updatedOrder.price,
        quantity: updatedOrder.quantity,
        filledQuantity: updatedOrder.filled_quantity,
        status: updatedOrder.status,
        createdAt: updatedOrder.created_at,
        matchResult
      }
    });
  } catch (error) {
    console.error("Order placement error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get open orders
app.get("/api/v1/openOrders", authenticateRequest, async (req, res) => {
  try {
    const { symbol } = req.query;
    let query = "SELECT id, symbol, side, type, price, quantity, filled_quantity, status, created_at FROM orders WHERE user_id = $1 AND status IN ('new', 'partially_filled')";
    const params = [req.userId];

    if (symbol) {
      query += " AND symbol = $2";
      params.push(symbol.toUpperCase());
    }

    query += " ORDER BY created_at DESC LIMIT 100";
    const orders = (await pool.query(query, params)).rows;

    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: parseFloat(o.price),
        quantity: parseFloat(o.quantity),
        filledQuantity: parseFloat(o.filled_quantity),
        status: o.status,
        createdAt: o.created_at
      }))
    });
  } catch (error) {
    console.error("Get open orders error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get order history
app.get("/api/v1/orderHistory", authenticateRequest, async (req, res) => {
  try {
    const { symbol, limit = 100, offset = 0 } = req.query;
    let query = "SELECT id, symbol, side, type, price, quantity, filled_quantity, status, created_at FROM orders WHERE user_id = $1";
    const params = [req.userId];
    let paramIndex = 2;

    if (symbol) {
      query += ` AND symbol = $${paramIndex++}`;
      params.push(symbol.toUpperCase());
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const orders = (await pool.query(query, params)).rows;

    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: parseFloat(o.price),
        quantity: parseFloat(o.quantity),
        filledQuantity: parseFloat(o.filled_quantity),
        status: o.status,
        createdAt: o.created_at
      }))
    });
  } catch (error) {
    console.error("Get order history error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get trade history
app.get("/api/v1/tradeHistory", authenticateRequest, async (req, res) => {
  try {
    const { symbol, limit = 100, offset = 0 } = req.query;
    let query = "SELECT id, symbol, side, price, quantity, fee, created_at FROM trades WHERE taker_id = $1 OR maker_id = $1";
    const params = [req.userId];
    let paramIndex = 2;

    if (symbol) {
      query += ` AND symbol = $${paramIndex++}`;
      params.push(symbol.toUpperCase());
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const trades = (await pool.query(query, params)).rows;

    res.json({
      success: true,
      data: trades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        price: parseFloat(t.price),
        quantity: parseFloat(t.quantity),
        fee: parseFloat(t.fee),
        createdAt: t.created_at
      }))
    });
  } catch (error) {
    console.error("Get trade history error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Cancel order
app.delete("/api/v1/order/:orderId", authenticateRequest, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = (await pool.query("SELECT * FROM orders WHERE id = $1 AND user_id = $2 LIMIT 1", [orderId, req.userId])).rows[0];

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found or not authorized" });
    }

    if (order.status === "filled" || order.status === "cancelled") {
      return res.status(400).json({ success: false, error: "Cannot cancel a filled or already cancelled order" });
    }

    // Release locked funds
    let wallet;
    if (order.side === "buy") {
      wallet = (await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
        [req.userId, TRADING_PAIRS.find(p => p.symbol === order.symbol).quote_asset]
      )).rows[0];
      if (wallet) {
        const amountToUnlock = order.price * (order.quantity - order.filled_quantity);
        await pool.query(
          `UPDATE wallets SET balance = balance + $1, locked = locked - $2, updated_at = NOW()
          WHERE id = $3`,
          [amountToUnlock, amountToUnlock, wallet.id]
        );
      }
    } else {
      wallet = (await pool.query(
        "SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 LIMIT 1",
        [req.userId, TRADING_PAIRS.find(p => p.symbol === order.symbol).base_asset]
      )).rows[0];
      if (wallet) {
        const amountToUnlock = order.quantity - order.filled_quantity;
        await pool.query(
          `UPDATE wallets SET balance = balance + $1, locked = locked - $2, updated_at = NOW()
          WHERE id = $3`,
          [amountToUnlock, amountToUnlock, wallet.id]
        );
      }
    }

    await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderId]
    );

    res.json({ success: true, message: "Order cancelled successfully" });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ============================================================================
// WEBSOCKETS
// ============================================================================

io.on("connection", (socket) => {
  console.log("⚡️ User connected:", socket.id);

  // Room membership is restricted to configured, active markets. Never let a
  // client create arbitrary rooms or use malformed symbols as room names.
  const resolveActiveMarket = (value) => {
    if (typeof value !== "string" || value.length > 32 ||
        !/^[A-Z0-9]{2,32}(?:[_-][A-Z0-9]{2,20})?$/.test(value)) {
      return null;
    }
    return TRADING_PAIRS.find((pair) => pair.symbol === value) || null;
  };

  socket.on("joinMarket", (symbol) => {
    const market = resolveActiveMarket(symbol);
    if (!market) {
      socket.emit("marketError", { code: "INVALID_OR_INACTIVE_MARKET" });
      return;
    }
    socket.join(market.symbol);
  });

  socket.on("leaveMarket", (symbol) => {
    const market = resolveActiveMarket(symbol);
    if (!market) {
      socket.emit("marketError", { code: "INVALID_OR_INACTIVE_MARKET" });
      return;
    }
    socket.leave(market.symbol);
  });

  socket.on("disconnect", () => {
    console.log("🔌 User disconnected:", socket.id);
  });
});

// ============================================================================
// START SERVER
// ============================================================================

async function startServer() {
  await initializeDatabase();
  await loadTradingPairs();
  if (TRADING_PAIRS.length > 0 && process.env.MARKET_DATA_WS_URL) {
    console.warn("MARKET_DATA_WS_URL is configured, but the legacy Node server does not provide a verified market-data ingestion pipeline; no provider is connected.");
  } else if (TRADING_PAIRS.length === 0) {
    console.warn("No active markets are configured. Trading and market endpoints must remain unavailable until markets are provisioned.");
  }
  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║             TigerEx Backend Server is running!             ║
║             http://localhost:${PORT}                     ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
  });
}

startServer();

module.exports = { app, server, io, pool };
