-- ============================================================================
-- TigerEx Database Schema - Wallets & Balances
-- Version: 1.0.0
-- Created: 2026-05-26
-- ============================================================================

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_type VARCHAR(20) NOT NULL CHECK (wallet_type IN ('hot', 'cold', 'funding', 'reserved', 'fee', 'collateral', 'operating', 'custody')),
    wallet_subtype VARCHAR(50),
    asset_symbol VARCHAR(20) NOT NULL,
    balance DECIMAL(24, 8) DEFAULT 0,
    locked_balance DECIMAL(24, 8) DEFAULT 0,
    available_balance DECIMAL(24, 8) GENERATED ALWAYS AS (balance - locked_balance) STORED,
    pending_deposits DECIMAL(24, 8) DEFAULT 0,
    pending_withdrawals DECIMAL(24, 8) DEFAULT 0,
    unsettled_balance DECIMAL(24, 8) DEFAULT 0,
    unsettled_count INTEGER DEFAULT 0,
    total_deposits DECIMAL(24, 8) DEFAULT 0,
    total_withdrawals DECIMAL(24, 8) DEFAULT 0,
    total_trades DECIMAL(24, 8) DEFAULT 0,
    last_transaction_at TIMESTAMP WITH TIME ZONE,
    last_deposit_at TIMESTAMP WITH TIME ZONE,
    last_withdrawal_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, wallet_type, asset_symbol)
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_wallet_type ON wallets(wallet_type);
CREATE INDEX idx_wallets_asset_symbol ON wallets(asset_symbol);

-- Wallet addresses (deposit addresses)
CREATE TABLE IF NOT EXISTS wallet_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_symbol VARCHAR(20) NOT NULL,
    blockchain VARCHAR(50) NOT NULL,
    address VARCHAR(255) UNIQUE NOT NULL,
    address_tag VARCHAR(255),
    address_type VARCHAR(20) DEFAULT 'standard' CHECK (address_type IN ('standard', 'multi_sig', 'smart_contract', 'legacy', 'segwit', 'native')),
    path VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    is_internal BOOLEAN DEFAULT FALSE,
    label VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated', 'compromised')),
    memo_required BOOLEAN DEFAULT FALSE,
    deposit_enabled BOOLEAN DEFAULT TRUE,
    confirmations_required SMALLINT DEFAULT 6,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_addresses_user_id ON wallet_addresses(user_id);
CREATE INDEX idx_wallet_addresses_address ON wallet_addresses(address);
CREATE INDEX idx_wallet_addresses_asset_symbol ON wallet_addresses(asset_symbol);
CREATE INDEX idx_wallet_addresses_blockchain ON wallet_addresses(blockchain);

-- Transactions (deposits, withdrawals, transfers)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(id),
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'transfer', 'adjustment', 'fee', 'reward', 'bonus', 'rebate', 'settlement', 'liquidation')),
    transaction_status VARCHAR(20) DEFAULT 'pending' CHECK (transaction_status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'rejected', 'timeout')),
    asset_symbol VARCHAR(20) NOT NULL,
    amount DECIMAL(24, 8) NOT NULL,
    fee_amount DECIMAL(24, 8) DEFAULT 0,
    net_amount DECIMAL(24, 8) GENERATED ALWAYS AS (amount - fee_amount) STORED,
    from_address VARCHAR(255),
    to_address VARCHAR(255),
    tx_hash VARCHAR(255),
    block_hash VARCHAR(255),
    block_number BIGINT,
    confirmation_count SMALLINT DEFAULT 0,
    confirmations_required SMALLINT DEFAULT 6,
   Blockchain VARCHAR(50),
    network_fee DECIMAL(24, 8) DEFAULT 0,
    processing_fee DECIMAL(24, 8) DEFAULT 0,
    fee_tier VARCHAR(20),
    source_type VARCHAR(50),
    destination_type VARCHAR(50),
    reference_id VARCHAR(100),
    bank_reference VARCHAR(100),
    payment_method VARCHAR(50),
    bank_name VARCHAR(100),
    bank_country VARCHAR(3),
    account_number VARCHAR(50),
    routing_number VARCHAR(50),
    swift_code VARCHAR(20),
    iban VARCHAR(50),
    beneficiary_name VARCHAR(100),
    beneficiary_bank VARCHAR(100),
    rejection_reason TEXT,
    failure_reason TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_transaction_id ON transactions(transaction_id);
CREATE INDEX idx_transactions_tx_hash ON transactions(tx_hash);
CREATE INDEX idx_transactions_asset_symbol ON transactions(asset_symbol);
CREATE INDEX idx_transactions_status ON transactions(transaction_status);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- Deposits (specific tracking)
CREATE TABLE IF NOT EXISTS deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deposit_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(id),
    asset_symbol VARCHAR(20) NOT NULL,
    amount DECIMAL(24, 8) NOT NULL,
    fee_amount DECIMAL(24, 8) DEFAULT 0,
    net_amount DECIMAL(24, 8),
    from_address VARCHAR(255),
    to_address VARCHAR(255),
    tx_hash VARCHAR(255),
    block_hash VARCHAR(255),
    block_number BIGINT,
    confirmations SMALLINT DEFAULT 0,
    confirmations_required SMALLINT DEFAULT 6,
   Blockchain VARCHAR(50),
    deposit_type VARCHAR(30) DEFAULT 'blockchain' CHECK (deposit_type IN ('blockchain', 'bank', 'card', 'p2p', 'internal', 'airdrop', 'reward', 'refund')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'credited', 'completed', 'failed', 'flagged', 'investigating')),
    flagged_reason TEXT,
    manual_review BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    credited_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_deposit_id ON deposits(deposit_id);
CREATE INDEX idx_deposits_tx_hash ON deposits(tx_hash);
CREATE INDEX idx_deposits_status ON deposits(status);

-- Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(id),
    asset_symbol VARCHAR(20) NOT NULL,
    amount DECIMAL(24, 8) NOT NULL,
    fee_amount DECIMAL(24, 8) DEFAULT 0,
    net_amount DECIMAL(24, 8),
    to_address VARCHAR(255),
    tx_hash VARCHAR(255),
    block_hash VARCHAR(255),
    block_number BIGINT,
    confirmations SMALLINT DEFAULT 0,
   Blockchain VARCHAR(50),
    withdrawal_type VARCHAR(30) DEFAULT 'blockchain' CHECK (withdrawal_type IN ('blockchain', 'bank', 'card', 'p2p', 'internal')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'approved', 'scheduled', 'submitted', 'confirmed', 'completed', 'failed', 'rejected', 'cancelled')),
    rejection_reason TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_withdrawal_id ON withdrawals(withdrawal_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);

-- Balance snapshots (for auditing)
CREATE TABLE IF NOT EXISTS balance_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_symbol VARCHAR(20) NOT NULL,
    balance DECIMAL(24, 8) NOT NULL,
    locked_balance DECIMAL(24, 8),
    snapshot_type VARCHAR(20) DEFAULT 'periodic' CHECK (snapshot_type IN ('periodic', 'manual', 'opening', 'closing', 'settlement')),
    snapshot_reason VARCHAR(255),
    reference_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_balance_snapshots_user_id ON balance_snapshots(user_id);
CREATE INDEX idx_balance_snapshots_asset ON balance_snapshots(asset_symbol);
CREATE INDEX idx_balance_snapshots_created ON balance_snapshots(created_at DESC);

-- Trigger for wallet timestamps
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE wallets IS 'User wallet balances by type';
COMMENT ON TABLE wallet_addresses IS 'Deposit addresses';
COMMENT ON TABLE transactions IS 'All financial transactions';