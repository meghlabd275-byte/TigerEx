-- =============================================================================
-- TigerEx Multi-Chain Wallet & Blockchain Schema
-- =============================================================================

-- Blockchain Networks
CREATE TABLE blockchains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    chain_id INTEGER,
    chain_type VARCHAR(20) NOT NULL, -- 'evm', 'solana', 'cosmos', 'bitcoin', 'aptos', 'ton', 'pi'
    rpc_url TEXT,
    explorer_url TEXT,
    icon_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    decimals INTEGER NOT NULL DEFAULT 18,
    gas_token_symbol VARCHAR(20),
    gas_token_decimals INTEGER NOT NULL DEFAULT 18,
    min_withdraw_amount NUMERIC(30, 18) NOT NULL DEFAULT 0,
    withdraw_fee NUMERIC(30, 18) NOT NULL DEFAULT 0,
    deposit_confirmations INTEGER NOT NULL DEFAULT 6,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Tokens/Cryptocurrencies
CREATE TABLE tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blockchain_id UUID NOT NULL REFERENCES blockchains(id) ON DELETE CASCADE,
    contract_address VARCHAR(255),
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 18,
    total_supply NUMERIC(40, 0),
    is_native BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_tradable BOOLEAN NOT NULL DEFAULT TRUE,
    is_withdrawable BOOLEAN NOT NULL DEFAULT TRUE,
    is_depositable BOOLEAN NOT NULL DEFAULT TRUE,
    coin_gecko_id VARCHAR(100),
    cmc_id INTEGER,
    icon_url TEXT,
    min_deposit_amount NUMERIC(30, 18) NOT NULL DEFAULT 0,
    min_withdraw_amount NUMERIC(30, 18) NOT NULL DEFAULT 0,
    withdraw_fee NUMERIC(30, 18) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(blockchain_id, symbol)
);

CREATE INDEX idx_tokens_blockchain ON tokens(blockchain_id);
CREATE INDEX idx_tokens_symbol ON tokens(symbol);

-- User Wallets (HD Wallet - BIP39/BIP44)
CREATE TABLE user_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_type VARCHAR(20) NOT NULL DEFAULT 'user', -- 'user', 'master'
    name VARCHAR(100),
    encrypted_seed_phrase TEXT NOT NULL,
    seed_phrase_hash VARCHAR(255) NOT NULL,
    derivation_path VARCHAR(50) NOT NULL DEFAULT "m/44'/60'/0'/0/0",
    address VARCHAR(255) NOT NULL,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    public_key TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_imported BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, blockchain_id, address)
);

CREATE INDEX idx_user_wallets_user ON user_wallets(user_id);
CREATE INDEX idx_user_wallets_address ON user_wallets(address);

-- Master Wallet (Admin Controlled)
CREATE TABLE master_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    encrypted_seed_phrase TEXT NOT NULL,
    seed_phrase_hash VARCHAR(255) NOT NULL,
    address VARCHAR(255) NOT NULL UNIQUE,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    balance NUMERIC(30, 18) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- User Token Balances
CREATE TABLE token_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    balance NUMERIC(40, 0) NOT NULL DEFAULT 0,
    locked_balance NUMERIC(40, 0) NOT NULL DEFAULT 0,
    available_balance NUMERIC(40, 0) GENERATED ALWAYS AS (balance - locked_balance) STORED,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, token_id)
);

CREATE INDEX idx_token_balances_user ON token_balances(user_id);

-- Deposits
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    tx_hash VARCHAR(255) NOT NULL,
    from_address VARCHAR(255) NOT NULL,
    to_address VARCHAR(255) NOT NULL,
    amount NUMERIC(40, 0) NOT NULL,
    fee NUMERIC(30, 18) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, confirmed, credited, failed
    confirmations INTEGER NOT NULL DEFAULT 0,
    required_confirmations INTEGER NOT NULL DEFAULT 6,
    block_number INTEGER,
    block_hash VARCHAR(255),
    logged_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    credited_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(token_id, tx_hash)
);

CREATE INDEX idx_deposits_user ON deposits(user_id);
CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);

-- Withdrawals
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    to_address VARCHAR(255) NOT NULL,
    amount NUMERIC(40, 0) NOT NULL,
    fee NUMERIC(30, 18) NOT NULL DEFAULT 0,
    net_amount NUMERIC(40, 0) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, processing, signed, broadcast, confirmed, failed, cancelled
    tx_hash VARCHAR(255),
    signed_tx TEXT,
    broadcast_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);

-- Internal Transfers (Master Wallet)
CREATE TABLE internal_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    token_id UUID NOT NULL REFERENCES tokens(id),
    amount NUMERIC(40, 0) NOT NULL,
    fee NUMERIC(30, 18) NOT NULL DEFAULT 0,
    type VARCHAR(20) NOT NULL, -- 'swap', 'airdrop', 'campaign', 'bonus', 'refund', 'manual'
    reference_id VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

-- Swap Transactions
CREATE TABLE swaps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_token_id UUID NOT NULL REFERENCES tokens(id),
    to_token_id UUID NOT NULL REFERENCES tokens(id),
    from_amount NUMERIC(40, 0) NOT NULL,
    to_amount NUMERIC(40, 0) NOT NULL,
    rate NUMERIC(30, 18) NOT NULL,
    fee_amount NUMERIC(30, 18) NOT NULL DEFAULT 0,
    fee_token_id UUID REFERENCES tokens(id),
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    provider VARCHAR(50), -- 'uniswap', 'pancakeswap', '1inch', 'native'
    tx_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_swaps_user ON swaps(user_id);

-- Launchpad Projects
CREATE TABLE launchpad_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    token_symbol VARCHAR(20) NOT NULL,
    token_name VARCHAR(100) NOT NULL,
    token_address VARCHAR(255) NOT NULL,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    total_supply NUMERIC(40, 0) NOT NULL,
    sale_allocation NUMERIC(40, 0) NOT NULL,
    price_per_token NUMERIC(30, 18) NOT NULL,
    accepted_token_id UUID REFERENCES tokens(id), -- payment token
    min_purchase NUMERIC(30, 18) NOT NULL DEFAULT 0,
    max_purchase NUMERIC(30, 18) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming', -- upcoming, active, completed, cancelled
    description TEXT,
    website_url TEXT,
    whitepaper_url TEXT,
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Launchpad Subscriptions
CREATE TABLE launchpad_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES launchpad_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(40, 0) NOT NULL,
    token_amount NUMERIC(40, 0) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, confirmed, cancelled
    tx_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- Launchpool Projects
CREATE TABLE launchpool_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stake_token_id UUID NOT NULL REFERENCES tokens(id),
    reward_token_id UUID NOT NULL REFERENCES tokens(id),
    total_reward NUMERIC(40, 0) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Launchpool Stakes
CREATE TABLE launchpool_stakes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES launchpool_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staked_amount NUMERIC(40, 0) NOT NULL,
    reward_amount NUMERIC(40, 0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- IEO/IDO Sales
CREATE TABLE ieo_sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name VARCHAR(100) NOT NULL,
    token_symbol VARCHAR(20) NOT NULL,
    token_address VARCHAR(255) NOT NULL,
    blockchain_id UUID NOT NULL REFERENCES blockchains(id),
    soft_cap NUMERIC(40, 0),
    hard_cap NUMERIC(40, 0) NOT NULL,
    raised_amount NUMERIC(40, 0) NOT NULL DEFAULT 0,
    price NUMERIC(30, 18) NOT NULL,
    accepted_tokens JSONB, -- [{token_id, price}]
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- IEO Purchases
CREATE TABLE ieo_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ieo_id UUID NOT NULL REFERENCES ieo_sales(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(40, 0) NOT NULL,
    tokens_received NUMERIC(40, 0) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(ieo_id, user_id)
);

-- Perpetual Futures
CREATE TABLE perpetual_markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    base_token_id UUID NOT NULL REFERENCES tokens(id),
    quote_token_id UUID NOT NULL REFERENCES tokens(id),
    initial_margin_rate NUMERIC(10, 6) NOT NULL DEFAULT 0.01,
    maintenance_margin_rate NUMERIC(10, 6) NOT NULL DEFAULT 0.005,
    max_leverage INTEGER NOT NULL DEFAULT 125,
    maker_fee NUMERIC(10, 6) NOT NULL DEFAULT 0.0001,
    taker_fee NUMERIC(10, 6) NOT NULL DEFAULT 0.0004,
    funding_rate_interval INTEGER NOT NULL DEFAULT 28800, -- 8 hours in seconds
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Perpetual Positions
CREATE TABLE perpetual_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES perpetual_markets(id),
    side VARCHAR(10) NOT NULL, -- 'long', 'short'
    size NUMERIC(40, 0) NOT NULL DEFAULT 0,
    entry_price NUMERIC(30, 18),
    mark_price NUMERIC(30, 18),
    leverage INTEGER NOT NULL DEFAULT 1,
    margin NUMERIC(40, 0) NOT NULL DEFAULT 0,
    unrealized_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    liquidation_price NUMERIC(30, 18),
    take_profit_price NUMERIC(30, 18),
    stop_loss_price NUMERIC(30, 18),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, market_id, side)
);

-- Copy Trading
CREATE TABLE copy_traders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_trades INTEGER NOT NULL DEFAULT 0,
    win_rate NUMERIC(10, 6) NOT NULL DEFAULT 0,
    total_pnl NUMERIC(30, 18) NOT NULL DEFAULT 0,
    followers_count INTEGER NOT NULL DEFAULT 0,
    total_aum NUMERIC(40, 0) NOT NULL DEFAULT 0,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE copy_followers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trader_id UUID NOT NULL REFERENCES copy_traders(id) ON DELETE CASCADE,
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    allocation_amount NUMERIC(40, 0) NOT NULL,
    copy_ratio NUMERIC(10, 6) NOT NULL DEFAULT 1.0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(trader_id, follower_id)
);

-- Fee Configuration (Admin)
CREATE TABLE fee_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fee_type VARCHAR(50) NOT NULL, -- 'withdraw', 'swap', 'transfer', 'trade'
    token_id UUID REFERENCES tokens(id),
    network VARCHAR(50),
    fee_amount NUMERIC(30, 18) NOT NULL,
    fee_percent NUMERIC(10, 6),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Campaign/Airdrop
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    campaign_type VARCHAR(50) NOT NULL, -- 'airdrop', 'snapshot', 'claim', 'task'
    reward_token_id UUID NOT NULL REFERENCES tokens(id),
    total_reward NUMERIC(40, 0) NOT NULL,
    per_user_max NUMERIC(40, 0),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE campaign_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_amount NUMERIC(40, 0) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, claimed, failed
    claimed_at TIMESTAMP WITH TIME ZONE,
    tx_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(campaign_id, user_id)
);

-- Admin Actions Log
CREATE TABLE admin_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES users(id),
    action_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255),
    old_value JSONB,
    new_value JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Blockchain Network Insert (Top 100 Blockchains)
INSERT INTO blockchains (name, symbol, chain_id, chain_type, decimals, is_active) VALUES
('Ethereum', 'ETH', 1, 'evm', 18, TRUE),
('Bitcoin', 'BTC', 0, 'bitcoin', 8, TRUE),
('BNB Smart Chain', 'BNB', 56, 'evm', 18, TRUE),
('Polygon', 'MATIC', 137, 'evm', 18, TRUE),
('Arbitrum One', 'ETH', 42161, 'evm', 18, TRUE),
('Optimism', 'ETH', 10, 'evm', 18, TRUE),
('Avalanche C-Chain', 'AVAX', 43114, 'evm', 18, TRUE),
('Solana', 'SOL', 0, 'solana', 9, TRUE),
('Base', 'ETH', 8453, 'evm', 18, TRUE),
('Tron', 'TRX', 0, 'tron', 6, TRUE),
('Pi Network', 'PI', 0, 'pi', 18, TRUE),
('Toncoin', 'TON', 0, 'ton', 9, TRUE),
('Aptos', 'APT', 0, 'aptos', 8, TRUE),
('Cardano', 'ADA', 0, 'cardano', 6, TRUE),
('Dogecoin', 'DOGE', 0, 'dogecoin', 8, TRUE),
('Polkadot', 'DOT', 0, 'cosmos', 10, TRUE),
('Chainlink', 'LINK', 0, 'cosmos', 18, TRUE),
('Cosmos Hub', 'ATOM', 0, 'cosmos', 6, TRUE),
('Near Protocol', 'NEAR', 0, 'near', 24, TRUE),
('Aleo', 'ALEO', 0, 'aleo', 18, TRUE),
('Sui', 'SUI', 0, 'sui', 9, TRUE),
('Sei', 'SEI', 0, 'cosmos', 6, TRUE),
('Injective', 'INJ', 0, 'cosmos', 18, TRUE),
('Celestia', 'TIA', 0, 'celestia', 6, TRUE),
('Render', 'RNDR', 0, 'solana', 9, TRUE),
('Fantom', 'FTM', 250, 'evm', 18, TRUE),
('Cronos', 'CRO', 25, 'evm', 18, TRUE),
('Hedera', 'HBAR', 0, 'hedera', 18, TRUE),
('Algorand', 'ALGO', 0, 'algorand', 6, TRUE),
('VeChain', 'VET', 0, 'vet', 18, TRUE),
('Internet Computer', 'ICP', 0, 'icp', 8, TRUE),
('Stacks', 'STX', 0, 'stacks', 6, TRUE),
('MultiversX', 'EGLD', 0, 'multiversx', 18, TRUE),
('Kava', 'KAVA', 0, 'cosmos', 6, TRUE),
('THORChain', 'RUNE', 0, 'cosmos', 8, TRUE),
('Osmosis', 'OSMO', 0, 'cosmos', 6, TRUE),
('Akash Network', 'AKT', 0, 'cosmos', 6, TRUE),
('dYdX', 'DYDX', 0, 'cosmos', 18, TRUE),
('Mina Protocol', 'MINA', 0, 'mina', 9, TRUE),
('Flare', 'FLR', 0, 'flare', 18, TRUE),
('Songbird', 'SGB', 0, 'flare', 18, TRUE),
('Celo', 'CELO', 42220, 'evm', 18, TRUE),
('Moonbeam', 'GLMR', 1284, 'evm', 18, TRUE),
('Moonriver', 'MOVR', 1285, 'evm', 18, TRUE),
('Kusama', 'KSM', 0, 'kusama', 12, TRUE),
('RSK', 'RBTC', 30, 'evm', 18, TRUE),
('PulseChain', 'PLS', 369, 'evm', 18, TRUE),
('Filecoin', 'FIL', 0, 'filecoin', 18, TRUE),
('Arweave', 'AR', 0, 'arweave', 18, TRUE),
('Sia', 'SC', 0, 'sia', 24, TRUE),
('Storj', 'STORJ', 0, 'storj', 8, TRUE),
('Lido DAO', 'LDO', 0, 'cosmos', 18, TRUE),
('Rocket Pool', 'RPL', 0, 'ethereum', 18, TRUE),
('Frax Share', 'FXS', 0, 'ethereum', 18, TRUE),
('Conflux', 'CFX', 1030, 'evm', 18, TRUE),
('Gnosis', 'GNO', 100, 'evm', 18, TRUE),
('KuCoin Token', 'KCS', 0, 'kcs', 18, TRUE),
('OKB', 'OKB', 0, 'okc', 18, TRUE),
('GateToken', 'GT', 0, 'gate', 18, TRUE),
('Huobi Token', 'HT', 0, 'heco', 18, TRUE),
('USDC', 'USDC', 0, 'multi', 6, TRUE),
('Tether USD', 'USDT', 0, 'multi', 6, TRUE),
('Binance USD', 'BUSD', 0, 'multi', 18, TRUE),
('Dai', 'DAI', 1, 'evm', 18, TRUE),
('TrueUSD', 'TUSD', 0, 'multi', 18, TRUE),
('Pax Dollar', 'USDP', 0, 'multi', 18, TRUE),
('PAXG', 'PAXG', 0, 'ethereum', 18, TRUE),
('Tornado Cash', 'TORN', 0, 'ethereum', 18, TRUE),
('Loopring', 'LRC', 0, 'ethereum', 18, TRUE),
('Curve DAO', 'CRV', 0, 'ethereum', 18, TRUE),
('Uniswap', 'UNI', 0, 'ethereum', 18, TRUE),
('Maker', 'MKR', 0, 'ethereum', 18, TRUE),
('Aave', 'AAVE', 0, 'ethereum', 18, TRUE),
('Compound', 'COMP', 0, 'ethereum', 18, TRUE),
('Synthetix', 'SNX', 0, 'ethereum', 18, TRUE),
('SushiSwap', 'SUSHI', 0, 'ethereum', 18, TRUE),
('1inch', '1INCH', 0, 'ethereum', 18, TRUE),
('Balancer', 'BAL', 0, 'ethereum', 18, TRUE),
('Yearn Finance', 'YFI', 0, 'ethereum', 18, TRUE),
('Band Protocol', 'BAND', 0, 'cosmos', 6, TRUE),
('Quant', 'QNT', 0, 'ethereum', 18, TRUE),
('Flow', 'FLOW', 0, 'flow', 8, TRUE),
('Algorand', 'ALGO', 0, 'algorand', 6, TRUE),
('Helium', 'HNT', 0, 'helium', 8, TRUE),
('IOT', 'IOTA', 0, 'iota', 18, TRUE),
('Qtum', 'QTUM', 0, 'evm', 18, TRUE),
('Zcash', 'ZEC', 0, 'zcash', 8, TRUE),
('Dash', 'DASH', 0, 'dash', 8, TRUE),
('Zilliqa', 'ZIL', 0, 'evm', 12, TRUE),
('EOS', 'EOS', 0, 'eos', 4, TRUE),
('Tezos', 'XTZ', 0, 'tezos', 6, TRUE),
('Decentraland', 'MANA', 0, 'ethereum', 18, TRUE),
('The Sandbox', 'SAND', 0, 'ethereum', 18, TRUE),
('Axie Infinity', 'AXS', 0, 'ethereum', 18, TRUE),
('Enjin Coin', 'ENJ', 0, 'ethereum', 18, TRUE),
('Immutable X', 'IMX', 0, 'ethereum', 18, TRUE),
('Blur', 'BLUR', 0, 'ethereum', 18, TRUE),
('Optimism', 'OP', 0, 'optimism', 18, TRUE),
('Arbitrum', 'ARB', 0, 'arbitrum', 18, TRUE),
('Base', 'BASE', 0, 'base', 18, TRUE),
('zkSync Era', 'ZK', 0, 'zksync', 18, TRUE),
('Starknet', 'STRK', 0, 'starknet', 18, TRUE);

-- Insert default tokens for each blockchain
INSERT INTO tokens (blockchain_id, name, symbol, decimals, is_native) 
SELECT id, symbol, symbol, decimals, TRUE 
FROM blockchains 
WHERE is_active = TRUE;
