-- ============================================================================
-- TigerEx Database Schema - Users & Accounts
-- Version: 1.0.0
-- Created: 2026-05-26
-- ============================================================================

-- Users table - Core user information
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(255) NOT NULL,
    kyc_level SMALLINT DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 3),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'locked', 'closed')),
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    referral_code VARCHAR(50) UNIQUE,
    referred_by UUID REFERENCES users(id),
    risk_score SMALLINT DEFAULT 50 CHECK (risk_score BETWEEN 0 AND 100),
    risk_category VARCHAR(20) DEFAULT 'standard' CHECK (risk_category IN ('standard', 'premium', 'institutional', 'vip')),
    jurisdiction VARCHAR(3) DEFAULT 'XXX',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_kyc_level ON users(kyc_level);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- User profiles
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    nationality VARCHAR(3),
    country_of_residence VARCHAR(3),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    address TEXT,
    bio TEXT,
    avatar_url TEXT,
    language_preference VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'UTC',
    trading_experience VARCHAR(20) DEFAULT 'intermediate' CHECK (trading_experience IN ('beginner', 'intermediate', 'advanced', 'professional')),
    investment_goal TEXT[],
    annual_income VARCHAR(30),
    net_worth VARCHAR(30),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);

-- User sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255),
    ip_address INET NOT NULL,
    user_agent TEXT,
    device_id VARCHAR(255),
    location VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- Login history for security
CREATE TABLE IF NOT EXISTS login_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    location VARCHAR(255),
    success BOOLEAN DEFAULT TRUE,
    failure_reason VARCHAR(255)
);

CREATE INDEX idx_login_history_user_id ON login_history(user_id);
CREATE INDEX idx_login_history_timestamp ON login_history(login_timestamp DESC);

-- User authentication logs
CREATE TABLE IF NOT EXISTS auth_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE,
    failure_reason VARCHAR(255)
);

CREATE INDEX idx_auth_logs_user_id ON auth_logs(user_id);
CREATE INDEX idx_auth_logs_event_type ON auth_logs(event_type);
CREATE INDEX idx_auth_logs_timestamp ON auth_logs(timestamp DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();