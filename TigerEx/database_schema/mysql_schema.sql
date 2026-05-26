-- =====================================================
-- TigerEx MySQL Schema
-- Alternative database for read replicas
-- =====================================================

-- USERS
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    kyc_level TINYINT DEFAULT 0,
    status ENUM('active','suspended','blocked') DEFAULT 'active',
    can_trade BOOLEAN DEFAULT FALSE,
    can_withdraw BOOLEAN DEFAULT FALSE,
    can_deposit BOOLEAN DEFAULT FALSE,
    country_code CHAR(2),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_email (email),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- SESSIONS
CREATE TABLE user_sessions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    session_token VARCHAR(500) UNIQUE NOT NULL,
    refresh_token VARCHAR(500),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_token (session_token)
) ENGINE=InnoDB;

-- WALLETS
CREATE TABLE wallets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL,
    balance DECIMAL(30,18) DEFAULT 0,
    locked_balance DECIMAL(30,18) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_user_currency (user_id, currency),
    INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- ORDERS
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    market_id BIGINT NOT NULL,
    order_type ENUM('LIMIT','MARKET','STOP_LOSS','STOP_LIMIT') NOT NULL,
    side ENUM('BUY','SELL') NOT NULL,
    quantity DECIMAL(30,18) NOT NULL,
    price DECIMAL(30,18),
    filled_quantity DECIMAL(30,18) DEFAULT 0,
    status ENUM('PENDING','FILLED','PARTIAL','CANCELLED','EXPIRED') DEFAULT 'PENDING',
    time_in_force ENUM('GTC','IOC','FOK') DEFAULT 'GTC',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_market (market_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- TRADES (filled orders)
CREATE TABLE trades (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    market_id BIGINT NOT NULL,
    maker_order_id BIGINT,
    taker_order_id BIGINT,
    side ENUM('BUY','SELL') NOT NULL,
    price DECIMAL(30,18) NOT NULL,
    quantity DECIMAL(30,18) NOT NULL,
    maker_fee DECIMAL(30,18) DEFAULT 0,
    taker_fee DECIMAL(30,18) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_market (market_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- POSITIONS (margin/futures)
CREATE TABLE positions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    market_id BIGINT NOT NULL,
    side ENUM('LONG','SHORT') NOT NULL,
    quantity DECIMAL(30,18) NOT NULL,
    entry_price DECIMAL(30,18) NOT NULL,
    unrealized_pnl DECIMAL(30,18) DEFAULT 0,
    realized_pnl DECIMAL(30,18) DEFAULT 0,
    leverage INT DEFAULT 1,
    liquidation_price DECIMAL(30,18),
    status ENUM('OPEN','CLOSED','LIQUIDATED') DEFAULT 'OPEN',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uk_user_market_open (user_id, market_id, status),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- TRANSACTIONS
CREATE TABLE transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    wallet_id BIGINT NOT NULL,
    type ENUM('DEPOSIT','WITHDRAWAL','TRANSFER','FEE','REWARD') NOT NULL,
    amount DECIMAL(30,18) NOT NULL,
    fee DECIMAL(30,18) DEFAULT 0,
    status ENUM('PENDING','CONFIRMED','COMPLETED','FAILED','REJECTED') DEFAULT 'PENDING',
    blockchain_tx_hash VARCHAR(100),
    from_address VARCHAR(255),
    to_address VARCHAR(255),
    network VARCHAR(20),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_hash (blockchain_tx_hash)
) ENGINE=InnoDB;

-- API KEYS
CREATE TABLE api_keys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    api_key VARCHAR(100) UNIQUE NOT NULL,
    api_secret_hash VARCHAR(255) NOT NULL,
    permissions SET('READ','WRITE','WITHDRAW') DEFAULT 'READ',
    ip_whitelist TEXT,
    expired_at DATETIME,
    last_used_at DATETIME,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_key (api_key)
) ENGINE=InnoDB;

-- KYC RECORDS
CREATE TABLE kyc_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNIQUE NOT NULL,
    level TINYINT DEFAULT 0,
    status ENUM('PENDING','VERIFIED','REJECTED','EXPIRED') DEFAULT 'PENDING',
    document_type VARCHAR(50),
    document_number VARCHAR(100),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    address TEXT,
    verified_at DATETIME,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- AUDIT LOG
CREATE TABLE audit_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id BIGINT,
    details JSON,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- MARKETS
CREATE TABLE markets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    min_quantity DECIMAL(30,18) DEFAULT 0.0001,
    max_quantity DECIMAL(30,18),
    min_price DECIMAL(30,18) DEFAULT 0.01,
    max_price DECIMAL(30,18),
    tick_size DECIMAL(30,18) DEFAULT 0.01,
    lot_size DECIMAL(30,18) DEFAULT 0.0001,
    maker_fee DECIMAL(10,6) DEFAULT 0.001,
    taker_fee DECIMAL(10,6) DEFAULT 0.001,
    status ENUM('TRADING','HALTED','DELISTED') DEFAULT 'TRADING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_symbol (symbol)
) ENGINE=InnoDB;

-- SHARDS (for horizontal scaling)
-- Each shard has identical schema
CREATE TABLE orders_shard_00 LIKE orders;
CREATE TABLE orders_shard_01 LIKE orders;
CREATE TABLE orders_shard_02 LIKE orders;
CREATE TABLE orders_shard_03 LIKE orders;
CREATE TABLE orders_shard_04 LIKE orders;
CREATE TABLE orders_shard_05 LIKE orders;
CREATE TABLE orders_shard_06 LIKE orders;
CREATE TABLE orders_shard_07 LIKE orders;
CREATE TABLE orders_shard_08 LIKE orders;
CREATE TABLE orders_shard_09 LIKE orders;
CREATE TABLE orders_shard_10 LIKE orders;
CREATE TABLE orders_shard_11 LIKE orders;
CREATE TABLE orders_shard_12 LIKE orders;
CREATE TABLE orders_shard_13 LIKE orders;
CREATE TABLE orders_shard_14 LIKE orders;
CREATE TABLE orders_shard_15 LIKE orders;

-- Stored procedures for high performance
DELIMITER $$

CREATE PROCEDURE get_account_balance(IN p_user_id BIGINT, IN p_currency VARCHAR(10))
BEGIN
    SELECT balance, locked_balance, balance - locked_balance AS available
    FROM wallets
    WHERE user_id = p_user_id AND currency = p_currency;
END$$

CREATE PROCEDURE create_order_high_performance(
    IN p_user_id BIGINT,
    IN p_market_id BIGINT,
    IN p_side ENUM('BUY','SELL'),
    IN p_quantity DECIMAL(30,18),
    IN p_price DECIMAL(30,18)
)
BEGIN
    INSERT INTO orders (user_id, market_id, side, quantity, price, order_type, status)
    VALUES (p_user_id, p_market_id, p_side, p_quantity, p_price, 'LIMIT', 'PENDING');
    
    SELECT LAST_INSERT_ID() AS order_id;
END$$

CREATE PROCEDURE match_orders(IN p_market_id BIGINT)
BEGIN
    -- High-performance order matching
    -- Uses queue-based matching for speed
    START TRANSACTION;
    
    -- Match logic here
    
    COMMIT;
END$$

DELIMITER ;

-- Insert default markets
INSERT INTO markets (symbol, base_currency, quote_currency, min_quantity, status) VALUES
('BTCUSDT', 'BTC', 'USDT', 0.0001, 'TRADING'),
('ETHUSDT', 'ETH', 'USDT', 0.001, 'TRADING'),
('BNBUSDT', 'BNB', 'USDT', 0.01, 'TRADING'),
('SOLUSDT', 'SOL', 'USDT', 0.01, 'TRADING'),
('XRPUSDT', 'XRP', 'USDT', 1, 'TRADING'),
('ADAUSDT', 'ADA', 'USDT', 1, 'TRADING'),
('DOGEUSDT', 'DOGE', 'USDT', 10, 'TRADING'),
('DOTUSDT', 'DOT', 'USDT', 0.1, 'TRADING'),
('MATICUSDT', 'MATIC', 'USDT', 1, 'TRADING'),
('LTCUSDT', 'LTC', 'USDT', 0.001, 'TRADING');