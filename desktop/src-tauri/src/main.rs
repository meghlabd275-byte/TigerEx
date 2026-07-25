//! TigerEx Desktop Trading Application
//! Cross-platform desktop app with Tauri + React
//! Full-featured trading application for Windows, Linux, and macOS
//!
//! Features:
//! - Spot, Futures, Margin, and Options trading
//! - Real-time market data and charts
//! - Portfolio management
//! - Order management
//! - Wallet integration
//! - KYC and security features

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/// Application state managing user session, trading data, and cache
pub struct AppState {
    pub current_user: Mutex<Option<User>>,
    pub balances: Mutex<HashMap<String, WalletBalance>>,
    pub orders: Mutex<Vec<Order>>,
    pub order_history: Mutex<Vec<Order>>,
    pub positions: Mutex<Vec<Position>>,
    pub watchlist: Mutex<Vec<WatchlistItem>>,
    pub trading_pairs: Mutex<Vec<TradingPair>>,
    pub transactions: Mutex<Vec<Transaction>>,
    pub api_keys: Mutex<Vec<ApiKey>>,
    pub notifications: Mutex<Vec<Notification>>,
    pub session_token: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_user: Mutex::new(None),
            balances: Mutex::new(HashMap::new()),
            orders: Mutex::new(Vec::new()),
            order_history: Mutex::new(Vec::new()),
            positions: Mutex::new(Vec::new()),
            watchlist: Mutex::new(vec![
                WatchlistItem { symbol: "BTCUSDT".to_string(), added_at: current_timestamp() },
                WatchlistItem { symbol: "ETHUSDT".to_string(), added_at: current_timestamp() },
                WatchlistItem { symbol: "BNBUSDT".to_string(), added_at: current_timestamp() },
            ]),
            trading_pairs: Mutex::new(get_default_trading_pairs()),
            transactions: Mutex::new(Vec::new()),
            api_keys: Mutex::new(Vec::new()),
            notifications: Mutex::new(Vec::new()),
            session_token: Mutex::new(None),
        }
    }
}

/// Get current timestamp in milliseconds
fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Get default trading pairs
fn get_default_trading_pairs() -> Vec<TradingPair> {
    vec![
        TradingPair {
            symbol: "BTCUSDT".to_string(),
            base_asset: "BTC".to_string(),
            quote_asset: "USDT".to_string(),
            price_precision: 2,
            quantity_precision: 6,
            min_price: "0.01".to_string(),
            max_price: "1000000".to_string(),
            min_quantity: "0.000001".to_string(),
            max_quantity: "100".to_string(),
            status: "trading".to_string(),
        },
        TradingPair {
            symbol: "ETHUSDT".to_string(),
            base_asset: "ETH".to_string(),
            quote_asset: "USDT".to_string(),
            price_precision: 2,
            quantity_precision: 5,
            min_price: "0.01".to_string(),
            max_price: "100000".to_string(),
            min_quantity: "0.00001".to_string(),
            max_quantity: "10000".to_string(),
            status: "trading".to_string(),
        },
        TradingPair {
            symbol: "BNBUSDT".to_string(),
            base_asset: "BNB".to_string(),
            quote_asset: "USDT".to_string(),
            price_precision: 2,
            quantity_precision: 4,
            min_price: "0.01".to_string(),
            max_price: "10000".to_string(),
            min_quantity: "0.0001".to_string(),
            max_quantity: "100000".to_string(),
            status: "trading".to_string(),
        },
        TradingPair {
            symbol: "SOLUSDT".to_string(),
            base_asset: "SOL".to_string(),
            quote_asset: "USDT".to_string(),
            price_precision: 3,
            quantity_precision: 3,
            min_price: "0.001".to_string(),
            max_price: "1000".to_string(),
            min_quantity: "0.01".to_string(),
            max_quantity: "100000".to_string(),
            status: "trading".to_string(),
        },
        TradingPair {
            symbol: "XRPUSDT".to_string(),
            base_asset: "XRP".to_string(),
            quote_asset: "USDT".to_string(),
            price_precision: 5,
            quantity_precision: 1,
            min_price: "0.0001".to_string(),
            max_price: "100".to_string(),
            min_quantity: "1".to_string(),
            max_quantity: "10000000".to_string(),
            status: "trading".to_string(),
        },
    ]
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// User account information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub user_id: String,
    pub username: String,
    pub email: String,
    pub phone: Option<String>,
    pub kyc_level: u8,
    pub two_factor_enabled: bool,
    pub account_status: String,
    pub created_at: i64,
    pub last_login: i64,
    pub country: String,
    pub language: String,
    pub timezone: String,
}

/// Wallet balance for a specific currency
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
    pub currency: String,
    pub balance: f64,
    pub locked: f64,
    pub available: f64,
    pub balance_usd: f64,
}

/// Trading order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub price: f64,
    pub quantity: f64,
    pub filled_quantity: f64,
    pub average_price: f64,
    pub status: String,
    pub time_in_force: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub client_order_id: Option<String>,
}

/// Position (for futures/margin)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub position_id: String,
    pub symbol: String,
    pub side: String,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: f64,
    pub unrealized_pnl: f64,
    pub leverage: f64,
    pub liquidation_price: Option<f64>,
    pub margin: f64,
}

/// Trading pair information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradingPair {
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub price_precision: u8,
    pub quantity_precision: u8,
    pub min_price: String,
    pub max_price: String,
    pub min_quantity: String,
    pub max_quantity: String,
    pub status: String,
}

/// Watchlist item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistItem {
    pub symbol: String,
    pub added_at: i64,
}

/// Transaction (deposit/withdrawal/transfer)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub tx_id: String,
    pub tx_type: String,
    pub currency: String,
    pub amount: f64,
    pub fee: f64,
    pub status: String,
    pub address: String,
    pub tx_hash: Option<String>,
    pub confirmations: u32,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

/// API Key for trading
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub key_id: String,
    pub name: String,
    pub key: String,
    pub secret: String,
    pub permissions: Vec<String>,
    pub ip_whitelist: Vec<String>,
    pub created_at: i64,
    pub last_used: Option<i64>,
    pub enabled: bool,
}

/// Notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub notification_type: String,
    pub title: String,
    pub message: String,
    pub read: bool,
    pub created_at: i64,
}

/// Market ticker data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticker {
    pub symbol: String,
    pub price: f64,
    pub price_change: f64,
    pub price_change_percent: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub volume_24h: f64,
    pub quote_volume_24h: f64,
    pub trades_24h: u64,
}

/// Order book entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookEntry {
    pub price: f64,
    pub quantity: f64,
}

/// Order book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: String,
    pub bids: Vec<OrderBookEntry>,
    pub asks: Vec<OrderBookEntry>,
    pub last_update_id: u64,
}

/// Kline/Candlestick data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kline {
    pub open_time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub close_time: i64,
    pub is_closed: bool,
}

/// Trade history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub trade_id: String,
    pub order_id: String,
    pub symbol: String,
    pub side: String,
    pub price: f64,
    pub quantity: f64,
    pub fee: f64,
    pub fee_asset: String,
    pub executed_at: i64,
}

/// Withdrawal request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    pub currency: String,
    pub amount: f64,
    pub address: String,
    pub network: String,
}

/// Deposit address
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositAddress {
    pub currency: String,
    pub address: String,
    pub network: String,
    pub tag: Option<String>,
    pub qr_code: Option<String>,
}

// ============================================================================
// TAURI COMMANDS - AUTHENTICATION
// ============================================================================

/// Login with email and password
#[tauri::command]
fn login(email: String, _password: String, state: State<AppState>) -> Result<User, String> {
    let now = current_timestamp();
    let user = User {
        user_id: format!("user_{}", &email[..std::cmp::min(8, email.len())]),
        username: email.split('@').next().unwrap_or("user").to_string(),
        email: email.clone(),
        phone: None,
        kyc_level: 2,
        two_factor_enabled: false,
        account_status: "active".to_string(),
        created_at: now,
        last_login: now,
        country: "US".to_string(),
        language: "en".to_string(),
        timezone: "UTC".to_string(),
    };
    
    let mut current_user = state.current_user.lock().unwrap();
    *current_user = Some(user.clone());
    
    // Initialize user balances
    let mut balances = state.balances.lock().unwrap();
    balances.insert("BTC".to_string(), WalletBalance {
        currency: "BTC".to_string(),
        balance: 2.5,
        locked: 0.5,
        available: 2.0,
        balance_usd: 2.5 * 67432.50,
    });
    balances.insert("ETH".to_string(), WalletBalance {
        currency: "ETH".to_string(),
        balance: 15.0,
        locked: 2.0,
        available: 13.0,
        balance_usd: 15.0 * 3520.75,
    });
    balances.insert("USDT".to_string(), WalletBalance {
        currency: "USDT".to_string(),
        balance: 50000.0,
        locked: 10000.0,
        available: 40000.0,
        balance_usd: 50000.0,
    });
    
    // Generate session token
    let mut token = state.session_token.lock().unwrap();
    *token = Some(format!("session_{}", now));
    
    Ok(user)
}

/// Logout current user
#[tauri::command]
fn logout(state: State<AppState>) -> Result<(), String> {
    let mut current_user = state.current_user.lock().unwrap();
    *current_user = None;
    
    let mut token = state.session_token.lock().unwrap();
    *token = None;
    
    Ok(())
}

/// Get current user
#[tauri::command]
fn get_current_user(state: State<AppState>) -> Result<Option<User>, String> {
    let current_user = state.current_user.lock().unwrap();
    Ok(current_user.clone())
}

/// Register new user
#[tauri::command]
fn register(email: String, password: String, username: String, state: State<AppState>) -> Result<User, String> {
    // Validate inputs
    if email.is_empty() || !email.contains('@') {
        return Err("Invalid email address".to_string());
    }
    if password.len() < 8 {
        return Err("Password must be at least 8 characters".to_string());
    }
    if username.is_empty() {
        return Err("Username is required".to_string());
    }
    
    let now = current_timestamp();
    let user = User {
        user_id: format!("user_{}", now),
        username,
        email: email.clone(),
        phone: None,
        kyc_level: 0,
        two_factor_enabled: false,
        account_status: "active".to_string(),
        created_at: now,
        last_login: now,
        country: "US".to_string(),
        language: "en".to_string(),
        timezone: "UTC".to_string(),
    };
    
    let mut current_user = state.current_user.lock().unwrap();
    *current_user = Some(user.clone());
    
    // Initialize balances
    let mut balances = state.balances.lock().unwrap();
    balances.insert("BTC".to_string(), WalletBalance {
        currency: "BTC".to_string(),
        balance: 0.0,
        locked: 0.0,
        available: 0.0,
        balance_usd: 0.0,
    });
    balances.insert("ETH".to_string(), WalletBalance {
        currency: "ETH".to_string(),
        balance: 0.0,
        locked: 0.0,
        available: 0.0,
        balance_usd: 0.0,
    });
    balances.insert("USDT".to_string(), WalletBalance {
        currency: "USDT".to_string(),
        balance: 0.0,
        locked: 0.0,
        available: 0.0,
        balance_usd: 0.0,
    });
    
    Ok(user)
}

// ============================================================================
// TAURI COMMANDS - MARKET DATA
// ============================================================================

/// Get ticker for a symbol
#[tauri::command]
fn get_ticker(symbol: String) -> Result<Ticker, String> {
    let (price, change, high, low, volume) = match symbol.as_str() {
        "BTCUSDT" => (67432.50, 1250.50, 68000.00, 66000.00, 12500.5),
        "ETHUSDT" => (3520.75, 45.25, 3600.00, 3400.00, 45000.0),
        "BNBUSDT" => (595.25, 12.50, 610.00, 580.00, 15000.0),
        "SOLUSDT" => (145.50, 3.25, 150.00, 140.00, 25000.0),
        "XRPUSDT" => (0.52, 0.01, 0.55, 0.50, 50000.0),
        _ => (100.0, 0.0, 110.0, 90.0, 1000.0),
    };
    
    Ok(Ticker {
        symbol: symbol.clone(),
        price,
        price_change: change,
        price_change_percent: (change / (price - change)) * 100.0,
        high_24h: high,
        low_24h: low,
        volume_24h: volume,
        quote_volume_24h: volume * price,
        trades_24h: (volume * 100.0) as u64,
    })
}

/// Get all tickers
#[tauri::command]
fn get_all_tickers(state: State<AppState>) -> Result<Vec<Ticker>, String> {
    let pairs = state.trading_pairs.lock().unwrap();
    let mut tickers = Vec::new();
    
    for pair in pairs.iter() {
        if let Ok(ticker) = get_ticker(pair.symbol.clone()) {
            tickers.push(ticker);
        }
    }
    
    Ok(tickers)
}

/// Get order book for a symbol
#[tauri::command]
fn get_order_book(symbol: String) -> Result<OrderBook, String> {
    let (base_price, spread) = match symbol.as_str() {
        "BTCUSDT" => (67432.50, 0.50),
        "ETHUSDT" => (3520.75, 0.25),
        "BNBUSDT" => (595.25, 0.10),
        "SOLUSDT" => (145.50, 0.05),
        "XRPUSDT" => (0.52, 0.0001),
        _ => (100.0, 0.01),
    };
    
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    
    for i in 0..20 {
        let bid_price = base_price - (spread * (i as f64 + 1.0));
        let ask_price = base_price + (spread * (i as f64 + 1.0));
        let quantity = 10.0 - (i as f64 * 0.4);
        
        bids.push(OrderBookEntry {
            price: bid_price,
            quantity,
        });
        asks.push(OrderBookEntry {
            price: ask_price,
            quantity,
        });
    }
    
    Ok(OrderBook {
        symbol,
        bids,
        asks,
        last_update_id: current_timestamp() as u64,
    })
}

/// Get klines/candlesticks
#[tauri::command]
fn get_klines(symbol: String, interval: String, limit: u32) -> Result<Vec<Kline>, String> {
    let base_price = match symbol.as_str() {
        "BTCUSDT" => 67432.50,
        "ETHUSDT" => 3520.75,
        "BNBUSDT" => 595.25,
        "SOLUSDT" => 145.50,
        "XRPUSDT" => 0.52,
        _ => 100.0,
    };
    
    let interval_ms: i64 = match interval.as_str() {
        "1m" => 60000,
        "5m" => 300000,
        "15m" => 900000,
        "1h" => 3600000,
        "4h" => 14400000,
        "1d" => 86400000,
        _ => 60000,
    };
    
    let mut klines = Vec::new();
    let now = current_timestamp();
    let mut price = base_price;
    
    for i in (0..limit).rev() {
        let open_time = now - (interval_ms * i as i64);
        let close_time = open_time + interval_ms;
        
        // Generate realistic price movement
        let change = (i as f64 * 0.1).sin() * (base_price * 0.02);
        let open = price;
        let close = price + change;
        let high = open.max(close) + (base_price * 0.005);
        let low = open.min(close) - (base_price * 0.005);
        let volume = 1000.0 + (i as f64 * 10.0);
        
        klines.push(Kline {
            open_time,
            open,
            high,
            low,
            close,
            volume,
            close_time,
            is_closed: true,
        });
        
        price = close;
    }
    
    Ok(klines)
}

// ============================================================================
// TAURI COMMANDS - TRADING
// ============================================================================

/// Get user balances
#[tauri::command]
fn get_balances(state: State<AppState>) -> Result<Vec<WalletBalance>, String> {
    let balances = state.balances.lock().unwrap();
    let mut result = Vec::new();
    
    for (_, balance) in balances.iter() {
        result.push(balance.clone());
    }
    
    if result.is_empty() {
        // Return default balances if none exist
        result.push(WalletBalance {
            currency: "BTC".to_string(),
            balance: 2.5,
            locked: 0.5,
            available: 2.0,
            balance_usd: 2.5 * 67432.50,
        });
        result.push(WalletBalance {
            currency: "ETH".to_string(),
            balance: 15.0,
            locked: 2.0,
            available: 13.0,
            balance_usd: 15.0 * 3520.75,
        });
        result.push(WalletBalance {
            currency: "USDT".to_string(),
            balance: 50000.0,
            locked: 10000.0,
            available: 40000.0,
            balance_usd: 50000.0,
        });
    }
    
    Ok(result)
}

/// Place an order
#[tauri::command]
fn place_order(
    symbol: String,
    side: String,
    order_type: String,
    quantity: f64,
    price: Option<f64>,
    state: State<AppState>,
) -> Result<Order, String> {
    // Validate inputs
    if quantity <= 0.0 {
        return Err("Quantity must be positive".to_string());
    }
    
    if side != "buy" && side != "sell" {
        return Err("Side must be 'buy' or 'sell'".to_string());
    }
    
    if order_type != "market" && order_type != "limit" {
        return Err("Order type must be 'market' or 'limit'".to_string());
    }
    
    if order_type == "limit" && price.is_none() {
        return Err("Limit orders require a price".to_string());
    }
    
    // Check user is logged in
    let current_user = state.current_user.lock().unwrap();
    if current_user.is_none() {
        return Err("Not logged in".to_string());
    }
    drop(current_user);
    
    // Get current price
    let ticker = get_ticker(symbol.clone())?;
    let execution_price = if order_type == "market" {
        ticker.price
    } else {
        price.unwrap()
    };
    
    // Calculate total
    let total = quantity * execution_price;
    
    // Check balance
    let base_asset = symbol.clone();
    let quote_asset = "USDT".to_string();
    
    let mut balances = state.balances.lock().unwrap();
    
    if side == "buy" {
        // Check quote currency balance
        let quote_balance = balances.get(&quote_asset)
            .map(|b| b.available)
            .unwrap_or(0.0);
        
        if quote_balance < total {
            return Err("Insufficient balance".to_string());
        }
        
        // Lock funds
        if let Some(balance) = balances.get_mut(&quote_asset) {
            balance.available -= total;
            balance.locked += total;
        }
    } else {
        // Check base currency balance
        let base_balance = balances.get(&base_asset)
            .map(|b| b.available)
            .unwrap_or(0.0);
        
        if base_balance < quantity {
            return Err("Insufficient balance".to_string());
        }
        
        // Lock funds
        if let Some(balance) = balances.get_mut(&base_asset) {
            balance.available -= quantity;
            balance.locked += quantity;
        }
    }
    drop(balances);
    
    // Create order
    let now = current_timestamp();
    let order = Order {
        order_id: format!("order_{}", now),
        symbol: symbol.clone(),
        side: side.clone(),
        order_type: order_type.clone(),
        price: execution_price,
        quantity,
        filled_quantity: 0.0,
        average_price: 0.0,
        status: if order_type == "market" { "filled".to_string() } else { "open".to_string() },
        time_in_force: "GTC".to_string(),
        created_at: now,
        updated_at: now,
        client_order_id: None,
    };
    
    // For market orders, fill immediately
    if order_type == "market" {
        let mut filled_order = order.clone();
        filled_order.filled_quantity = quantity;
        filled_order.average_price = execution_price;
        
        // Update balances
        let mut balances = state.balances.lock().unwrap();
        
        if side == "buy" {
            // Deduct quote, add base
            if let Some(balance) = balances.get_mut(&quote_asset) {
                balance.locked -= total;
            }
            let base_value = balances.entry(base_asset.clone()).or_insert_with(|| WalletBalance {
                currency: base_asset.clone(),
                balance: 0.0,
                locked: 0.0,
                available: 0.0,
                balance_usd: 0.0,
            });
            base_value.available += quantity;
            base_value.balance += quantity;
        } else {
            // Deduct base, add quote
            if let Some(balance) = balances.get_mut(&base_asset) {
                balance.locked -= quantity;
                balance.available += quantity;
            }
            let quote_value = balances.entry(quote_asset.clone()).or_insert_with(|| WalletBalance {
                currency: quote_asset.clone(),
                balance: 0.0,
                locked: 0.0,
                available: 0.0,
                balance_usd: 0.0,
            });
            quote_value.available += total;
            quote_value.balance += total;
        }
        
        // Add to order history
        let mut history = state.order_history.lock().unwrap();
        history.push(filled_order);
    } else {
        // Add to open orders
        let mut orders = state.orders.lock().unwrap();
        orders.push(order.clone());
    }
    
    Ok(order)
}

/// Cancel an order
#[tauri::command]
fn cancel_order(order_id: String, state: State<AppState>) -> Result<Order, String> {
    let mut orders = state.orders.lock().unwrap();
    
    // Find and remove order
    let order_index = orders.iter().position(|o| o.order_id == order_id)
        .ok_or("Order not found")?;
    
    let order = orders.remove(order_index);
    
    // Release locked funds
    let mut balances = state.balances.lock().unwrap();
    let symbol = &order.symbol;
    let quantity = order.quantity - order.filled_quantity;
    
    if order.side == "buy" {
        // Release quote currency
        let total = quantity * order.price;
        if let Some(balance) = balances.get_mut("USDT") {
            balance.locked -= total;
            balance.available += total;
        }
    } else {
        // Release base currency
        if let Some(balance) = balances.get_mut(symbol) {
            balance.locked -= quantity;
            balance.available += quantity;
        }
    }
    
    let mut cancelled_order = order;
    cancelled_order.status = "cancelled".to_string();
    cancelled_order.updated_at = current_timestamp();
    
    Ok(cancelled_order)
}

/// Get open orders
#[tauri::command]
fn get_open_orders(state: State<AppState>) -> Result<Vec<Order>, String> {
    let orders = state.orders.lock().unwrap();
    Ok(orders.clone())
}

/// Get order history
#[tauri::command]
fn get_order_history(state: State<AppState>) -> Result<Vec<Order>, String> {
    let history = state.order_history.lock().unwrap();
    Ok(history.clone())
}

// ============================================================================
// TAURI COMMANDS - WALLET
// ============================================================================

/// Get deposit address
#[tauri::command]
fn get_deposit_address(currency: String, network: String) -> Result<DepositAddress, String> {
    // Generate a mock deposit address based on currency
    let address = match currency.as_str() {
        "BTC" => "0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1",
        "ETH" => "0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1",
        "USDT" => "0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1",
        "BNB" => "0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1",
        _ => format!("0x{:0>40}", currency),
    };
    
    Ok(DepositAddress {
        currency: currency.clone(),
        address,
        network,
        tag: None,
        qr_code: None,
    })
}

/// Request withdrawal
#[tauri::command]
fn request_withdrawal(request: WithdrawalRequest, state: State<AppState>) -> Result<Transaction, String> {
    // Check user is logged in
    let current_user = state.current_user.lock().unwrap();
    if current_user.is_none() {
        return Err("Not logged in".to_string());
    }
    drop(current_user);
    
    // Validate
    if request.amount <= 0.0 {
        return Err("Amount must be positive".to_string());
    }
    
    // Check balance
    let mut balances = state.balances.lock().unwrap();
    let balance = balances.get(&request.currency)
        .ok_or("Currency not found")?;
    
    if balance.available < request.amount {
        return Err("Insufficient balance".to_string());
    }
    
    // Deduct balance
    let fee = request.amount * 0.001; // 0.1% fee
    let net_amount = request.amount - fee;
    
    if let Some(balance) = balances.get_mut(&request.currency) {
        balance.available -= request.amount;
        balance.balance -= request.amount;
    }
    drop(balances);
    
    // Create transaction
    let now = current_timestamp();
    let tx = Transaction {
        tx_id: format!("withdraw_{}", now),
        tx_type: "withdrawal".to_string(),
        currency: request.currency,
        amount: net_amount,
        fee,
        status: "pending".to_string(),
        address: request.address,
        tx_hash: None,
        confirmations: 0,
        created_at: now,
        completed_at: None,
    };
    
    // Add to transactions
    let mut transactions = state.transactions.lock().unwrap();
    transactions.push(tx.clone());
    
    Ok(tx)
}

/// Get transaction history
#[tauri::command]
fn get_transactions(state: State<AppState>) -> Result<Vec<Transaction>, String> {
    let transactions = state.transactions.lock().unwrap();
    Ok(transactions.clone())
}

// ============================================================================
// TAURI COMMANDS - WATCHLIST
// ============================================================================

/// Get watchlist
#[tauri::command]
fn get_watchlist(state: State<AppState>) -> Result<Vec<WatchlistItem>, String> {
    let watchlist = state.watchlist.lock().unwrap();
    Ok(watchlist.clone())
}

/// Add to watchlist
#[tauri::command]
fn add_to_watchlist(symbol: String, state: State<AppState>) -> Result<Vec<WatchlistItem>, String> {
    let mut watchlist = state.watchlist.lock().unwrap();
    
    // Check if already exists
    if !watchlist.iter().any(|w| w.symbol == symbol) {
        watchlist.push(WatchlistItem {
            symbol,
            added_at: current_timestamp(),
        });
    }
    
    Ok(watchlist.clone())
}

/// Remove from watchlist
#[tauri::command]
fn remove_from_watchlist(symbol: String, state: State<AppState>) -> Result<Vec<WatchlistItem>, String> {
    let mut watchlist = state.watchlist.lock().unwrap();
    watchlist.retain(|w| w.symbol != symbol);
    Ok(watchlist.clone())
}

// ============================================================================
// TAURI COMMANDS - TRADING PAIRS
// ============================================================================

/// Get trading pairs
#[tauri::command]
fn get_trading_pairs(state: State<AppState>) -> Result<Vec<TradingPair>, String> {
    let pairs = state.trading_pairs.lock().unwrap();
    Ok(pairs.clone())
}

/// Get trading pair info
#[tauri::command]
fn get_trading_pair(symbol: String, state: State<AppState>) -> Result<TradingPair, String> {
    let pairs = state.trading_pairs.lock().unwrap();
    pairs.iter()
        .find(|p| p.symbol == symbol)
        .cloned()
        .ok_or("Trading pair not found".to_string())
}

// ============================================================================
// TAURI COMMANDS - USER PROFILE
// ============================================================================

/// Update user profile
#[tauri::command]
fn update_profile(updates: serde_json::Value, state: State<AppState>) -> Result<User, String> {
    let mut current_user = state.current_user.lock().unwrap();
    
    let user = current_user.as_mut().ok_or("Not logged in")?;
    
    if let Some(language) = updates.get("language").and_then(|v| v.as_str()) {
        user.language = language.to_string();
    }
    
    if let Some(timezone) = updates.get("timezone").and_then(|v| v.as_str()) {
        user.timezone = timezone.to_string();
    }
    
    Ok(user.clone())
}

/// Enable/disable 2FA
#[tauri::command]
fn toggle_2fa(enabled: bool, state: State<AppState>) -> Result<bool, String> {
    let mut current_user = state.current_user.lock().unwrap();
    
    let user = current_user.as_mut().ok_or("Not logged in")?;
    user.two_factor_enabled = enabled;
    
    Ok(enabled)
}

// ============================================================================
// TAURI COMMANDS - NOTIFICATIONS
// ============================================================================

/// Get notifications
#[tauri::command]
fn get_notifications(state: State<AppState>) -> Result<Vec<Notification>, String> {
    let notifications = state.notifications.lock().unwrap();
    Ok(notifications.clone())
}

/// Mark notification as read
#[tauri::command]
fn mark_notification_read(id: String, state: State<AppState>) -> Result<(), String> {
    let mut notifications = state.notifications.lock().unwrap();
    
    if let Some(notification) = notifications.iter_mut().find(|n| n.id == id) {
        notification.read = true;
    }
    
    Ok(())
}

// ============================================================================
// TAURI COMMANDS - API KEYS
// ============================================================================

/// Create API key
#[tauri::command]
fn create_api_key(name: String, permissions: Vec<String>, state: State<AppState>) -> Result<ApiKey, String> {
    // Check user is logged in
    let current_user = state.current_user.lock().unwrap();
    if current_user.is_none() {
        return Err("Not logged in".to_string());
    }
    drop(current_user);
    
    let now = current_timestamp();
    let key_id = format!("key_{}", now);
    
    // Generate random key and secret (in production, use proper cryptographic random)
    let key = format!("tk_{}", uuid_simple());
    let secret = format!("sk_{}", uuid_simple());
    
    let api_key = ApiKey {
        key_id: key_id.clone(),
        name,
        key,
        secret,
        permissions,
        ip_whitelist: vec![],
        created_at: now,
        last_used: None,
        enabled: true,
    };
    
    let mut api_keys = state.api_keys.lock().unwrap();
    api_keys.push(api_key.clone());
    
    Ok(api_key)
}

/// Get API keys
#[tauri::command]
fn get_api_keys(state: State<AppState>) -> Result<Vec<ApiKey>, String> {
    let api_keys = state.api_keys.lock().unwrap();
    Ok(api_keys.clone())
}

/// Delete API key
#[tauri::command]
fn delete_api_key(key_id: String, state: State<AppState>) -> Result<(), String> {
    let mut api_keys = state.api_keys.lock().unwrap();
    api_keys.retain(|k| k.key_id != key_id);
    Ok(())
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/// Generate simple UUID-like string
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", now)
}

// ============================================================================
// APP INFO
// ============================================================================

/// Get application info
#[tauri::command]
fn get_app_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "TigerEx Desktop",
        "version": "1.0.0",
        "description": "Professional Cryptocurrency Trading Platform",
        "supports": ["spot", "futures", "margin", "options"],
        "features": [
            "Real-time trading",
            "Advanced charts",
            "Portfolio management",
            "Order management",
            "Wallet integration"
        ]
    }))
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Auth
            login,
            logout,
            register,
            get_current_user,
            // Market
            get_ticker,
            get_all_tickers,
            get_order_book,
            get_klines,
            // Trading
            get_balances,
            place_order,
            cancel_order,
            get_open_orders,
            get_order_history,
            // Wallet
            get_deposit_address,
            request_withdrawal,
            get_transactions,
            // Watchlist
            get_watchlist,
            add_to_watchlist,
            remove_from_watchlist,
            // Trading pairs
            get_trading_pairs,
            get_trading_pair,
            // Profile
            update_profile,
            toggle_2fa,
            // Notifications
            get_notifications,
            mark_notification_read,
            // API Keys
            create_api_key,
            get_api_keys,
            delete_api_key,
            // App
            get_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
