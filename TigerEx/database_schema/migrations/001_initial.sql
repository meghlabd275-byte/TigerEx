-- Migration 001

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    kyc_level INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active'
);

CREATE TABLE wallets (
    id UUID PRIMARY KEY,
    user_id UUID,
    currency TEXT,
    balance DECIMAL(32,16) DEFAULT 0
);

CREATE TABLE orders (
    id UUID PRIMARY KEY,
    user_id UUID,
    symbol TEXT,
    side TEXT,
    type TEXT,
    quantity DECIMAL(32,16),
    price DECIMAL(32,16),
    status TEXT DEFAULT 'pending'
);