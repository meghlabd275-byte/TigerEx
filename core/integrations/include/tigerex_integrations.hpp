/**
 * TigerEx Integration Layer
 * Connects Tigerswap DEX, TigerWallet Web3, TigerSmartChain with TigerEx platform
 * Unified API for all Tiger ecosystem products
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_INTEGRATIONS_HPP
#define TIGEREX_INTEGRATIONS_HPP

#include <vector>
#include <map>
#include <unordered_map>
#include <optional>
#include <functional>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <atomic>
#include <chrono>
#include <algorithm>
#include <random>
#include <string>
#include <variant>
#include <queue>
#include <sstream>

namespace tigerex {
namespace integrations {

// ============================================================
// TigerSmartChain - EVM-Based Blockchain
// ============================================================

// Native tokens
enum class TokenStandard : uint8_t {
    ERC20 = 0,
    ERC721 = 1,
    ERC1155 = 2,
    NATIVE = 3
};

// Chain configuration
struct ChainConfig {
    std::string chain_id;
    std::string name;
    std::string rpc_url;
    std::string explorer_url;
    std::string symbol;
    uint8_t decimals;
    uint64_t block_time;
    bool is_active;
    
    ChainConfig() : decimals(18), block_time(15000), is_active(true) {}
};

// Token information
struct TokenInfo {
    std::string address;
    std::string symbol;
    std::string name;
    uint8_t decimals;
    TokenStandard standard;
    uint64_t total_supply;
    std::string icon_url;
    double price_usd;
    bool is_verified;
    bool is_trading_enabled;
    
    TokenInfo() : decimals(18), standard(TokenStandard::ERC20), total_supply(0), price_usd(0), is_verified(false), is_trading_enabled(true) {}
};

// Bridge configuration
struct BridgeConfig {
    std::string bridge_address;
    std::string source_chain;
    std::string target_chain;
    double min_amount;
    double max_amount;
    double fee_percentage;
    uint64_t estimated_time;
    bool is_active;
    
    BridgeConfig() : min_amount(0), max_amount(0), fee_percentage(0.001), estimated_time(600000), is_active(true) {}
};

// NFT information
struct NFTInfo {
    std::string contract_address;
    std::string token_id;
    std::string name;
    std::string description;
    std::string image_url;
    std::string animation_url;
    std::string external_url;
    std::string owner;
    TokenStandard standard;
    uint64_t balance;
    std::map<std::string, std::string> attributes;
    
    NFTInfo() : standard(TokenStandard::ERC721), balance(1) {}
};

// SmartChain Network
class TigerSmartChain {
private:
    std::unordered_map<std::string, ChainConfig> chains_;
    std::unordered_map<std::string, TokenInfo> tokens_;
    std::unordered_map<std::string, std::vector<BridgeConfig>> bridges_;
    std::atomic<uint64_t> next_chain_id_{1};
    mutable std::shared_mutex mutex_;
    
    // TGR token address
    std::string tgr_token_address_ = "0x000000000000000000000000000000000000TGR";
    std::string rusd_token_address_ = "0x000000000000000000000000000000000RUSD";
    
public:
    TigerSmartChain() {
        initialize_default_chains();
    }
    
    void initialize_default_chains() {
        // Tiger SmartChain Mainnet
        ChainConfig tsc_mainnet;
        tsc_mainnet.chain_id = "0x1";
        tsc_mainnet.name = "TigerSmartChain";
        tsc_mainnet.rpc_url = "https://rpc.tigersmartchain.com";
        tsc_mainnet.explorer_url = "https://explorer.tigersmartchain.com";
        tsc_mainnet.symbol = "TGR";
        tsc_mainnet.decimals = 18;
        tsc_mainnet.block_time = 15000;
        chains_["tiger_mainnet"] = tsc_mainnet;
        
        // Tiger SmartChain Testnet
        ChainConfig tsc_testnet;
        tsc_testnet.chain_id = "0x5";
        tsc_testnet.name = "TigerSmartChain Testnet";
        tsc_testnet.rpc_url = "https://rpc-testnet.tigersmartchain.com";
        tsc_testnet.explorer_url = "https://testnet-explorer.tigersmartchain.com";
        tsc_testnet.symbol = "TGR";
        tsc_testnet.decimals = 18;
        tsc_testnet.block_time = 15000;
        chains_["tiger_testnet"] = tsc_testnet;
        
        // Register TGR token
        TokenInfo tgr;
        tgr.address = tgr_token_address_;
        tgr.symbol = "TGR";
        tgr.name = "Tiger";
        tgr.decimals = 18;
        tgr.standard = TokenStandard::ERC20;
        tgr.total_supply = 1000000000 * 1e18;
        tgr.is_verified = true;
        tokens_[tgr_token_address_] = tgr;
        
        // Register RUSD stablecoin
        TokenInfo rusd;
        rusd.address = rusd_token_address_;
        rusd.symbol = "RUSD";
        rusd.name = "Royal Tiger United States Dollar";
        rusd.decimals = 6;
        rusd.standard = TokenStandard::ERC20;
        rusd.total_supply = 1000000000 * 1e6;
        rusd.price_usd = 1.0;
        rusd.is_verified = true;
        tokens_[rusd_token_address_] = rusd;
        
        // Bridges
        BridgeConfig eth_bridge;
        eth_bridge.bridge_address = "0x1234567890abcdef1234567890abcdef12345678";
        eth_bridge.source_chain = "ethereum";
        eth_bridge.target_chain = "tiger_mainnet";
        eth_bridge.min_amount = 100;
        eth_bridge.max_amount = 1000000;
        eth_bridge.fee_percentage = 0.001;
        eth_bridge.estimated_time = 600000;
        bridges_["tiger_mainnet"].push_back(eth_bridge);
        
        BridgeConfig bsc_bridge;
        bsc_bridge.bridge_address = "0xabcdef1234567890abcdef1234567890abcdef12";
        bsc_bridge.source_chain = "bsc";
        bsc_bridge.target_chain = "tiger_mainnet";
        bsc_bridge.min_amount = 50;
        bsc_bridge.max_amount = 500000;
        bsc_bridge.fee_percentage = 0.001;
        bsc_bridge.estimated_time = 600000;
        bridges_["tiger_mainnet"].push_back(bsc_bridge);
    }
    
    // Get chain configuration
    std::optional<ChainConfig> get_chain(const std::string& chain_key) const {
        std::shared_lock lock(mutex_);
        auto it = chains_.find(chain_key);
        if (it != chains_.end()) {
            return it->second;
        }
        return std::nullopt;
    }
    
    // Get all chains
    std::vector<ChainConfig> get_all_chains() const {
        std::shared_lock lock(mutex_);
        std::vector<ChainConfig> result;
        for (const auto& [key, chain] : chains_) {
            if (chain.is_active) {
                result.push_back(chain);
            }
        }
        return result;
    }
    
    // Get token info
    std::optional<TokenInfo> get_token(const std::string& address) const {
        std::shared_lock lock(mutex_);
        auto it = tokens_.find(address);
        if (it != tokens_.end()) {
            return it->second;
        }
        return std::nullopt;
    }
    
    // Get token by symbol
    std::optional<TokenInfo> get_token_by_symbol(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        for (const auto& [addr, token] : tokens_) {
            if (token.symbol == symbol) {
                return token;
            }
        }
        return std::nullopt;
    }
    
    // Get all tokens
    std::vector<TokenInfo> get_all_tokens() const {
        std::shared_lock lock(mutex_);
        std::vector<TokenInfo> result;
        for (const auto& [addr, token] : tokens_) {
            result.push_back(token);
        }
        return result;
    }
    
    // Add custom token
    bool add_token(const TokenInfo& token) {
        std::unique_lock lock(mutex_);
        tokens_[token.address] = token;
        return true;
    }
    
    // Get bridges
    std::vector<BridgeConfig> get_bridges(const std::string& chain_key) const {
        std::shared_lock lock(mutex_);
        auto it = bridges_.find(chain_key);
        if (it != bridges_.end()) {
            return it->second;
        }
        return {};
    }
    
    // Estimate bridge fee
    double estimate_bridge_fee(double amount, const std::string& from_chain, const std::string& to_chain) const {
        auto chain_bridges = get_bridges(to_chain);
        for (const auto& bridge : chain_bridges) {
            if (bridge.source_chain == from_chain) {
                return amount * bridge.fee_percentage;
            }
        }
        return amount * 0.001;  // Default 0.1%
    }
    
    // Get gas price
    double get_gas_price(const std::string& chain_key) const {
        auto chain_opt = get_chain(chain_key);
        if (!chain_opt.has_value()) {
            return 20e9;  // 20 Gwei default
        }
        
        // Dynamic gas pricing
        return 20e9;  // Would fetch from network
    }
    
    // Get TGR token address
    std::string get_tgr_token() const {
        return tgr_token_address_;
    }
    
    // Get RUSD token address
    std::string get_rusd_token() const {
        return rusd_token_address_;
    }
};

// ============================================================
// Tigerswap DEX - Multichain Decentralized Exchange
// ============================================================

// Liquidity pool
struct LiquidityPool {
    std::string pool_id;
    std::string token_a;
    std::string token_b;
    uint64_t reserve_a;
    uint64_t reserve_b;
    double fee_rate;
    double apy;
    std::string pool_type;  // "volatile" or "stable"
    uint64_t liquidity;
    uint64_t volume_24h;
    double tvl;
    
    LiquidityPool() : fee_rate(0.003), apy(0), liquidity(0), volume_24h(0), tvl(0) {}
};

// Farm staking
struct FarmStaking {
    std::string farm_id;
    std::string pool_id;
    std::string reward_token;
    uint64_t reward_rate;
    uint64_t total_staked;
    double apy;
    uint64_t lock_period;
    uint64_t start_time;
    uint64_t end_time;
    bool is_active;
    
    FarmStaking() : reward_rate(0), total_staked(0), apy(0), lock_period(0), start_time(0), end_time(0), is_active(true) {}
};

// Swap quote
struct SwapQuote {
    uint64_t amount_in;
    uint64_t amount_out;
    double price_impact;
    double execution_price;
    uint64_t gas_fee;
    std::vector<std::string> path;
    std::string pool_id;
    
    SwapQuote() : amount_in(0), amount_out(0), price_impact(0), execution_price(0), gas_fee(0) {}
};

// Tigerswap DEX
class TigerswapDEX {
private:
    std::unordered_map<std::string, LiquidityPool> pools_;
    std::unordered_map<std::string, FarmStaking> farms_;
    std::unordered_map<std::string, std::vector<std::string>> token_pools_;
    std::atomic<uint64_t> next_pool_id_{1};
    mutable std::shared_mutex mutex_;
    
    // Fee collection
    std::atomic<uint64_t> total_fees_collected_{0};
    
public:
    TigerswapDEX() {
        initialize_default_pools();
    }
    
    void initialize_default_pools() {
        // TGR/USDT pool
        LiquidityPool tgr_usdt;
        tgr_usdt.pool_id = "pool_0";
        tgr_usdt.token_a = "0xTGR";
        tgr_usdt.token_b = "0xUSDT";
        tgr_usdt.reserve_a = 1000000 * 1e18;
        tgr_usdt.reserve_b = 500000 * 1e6;
        tgr_usdt.fee_rate = 0.003;
        tgr_usdt.pool_type = "volatile";
        tgr_usdt.tvl = 500000;
        pools_[tgr_usdt.pool_id] = tgr_usdt;
        
        // RUSD/USDT pool
        LiquidityPool rusd_usdt;
        rusd_usdt.pool_id = "pool_1";
        rusd_usdt.token_a = "0xRUSD";
        rusd_usdt.token_b = "0xUSDT";
        rusd_usdt.reserve_a = 1000000 * 1e6;
        rusd_usdt.reserve_b = 1000000 * 1e6;
        rusd_usdt.fee_rate = 0.001;
        rusd_usdt.pool_type = "stable";
        rusd_usdt.tvl = 1000000;
        pools_[rusd_usdt.pool_id] = rusd_usdt;
        
        // TGR/RUSD pool
        LiquidityPool tgr_rusd;
        tgr_rusd.pool_id = "pool_2";
        tgr_rusd.token_a = "0xTGR";
        tgr_rusd.token_b = "0xRUSD";
        tgr_rusd.reserve_a = 500000 * 1e18;
        tgr_rusd.reserve_b = 250000 * 1e6;
        tgr_rusd.fee_rate = 0.003;
        tgr_rusd.pool_type = "volatile";
        tgr_rusd.tvl = 250000;
        pools_[tgr_rusd.pool_id] = tgr_rusd;
        
        // TGR/ETH pool
        LiquidityPool tgr_eth;
        tgr_eth.pool_id = "pool_3";
        tgr_eth.token_a = "0xTGR";
        tgr_eth.token_b = "0xETH";
        tgr_eth.reserve_a = 100000 * 1e18;
        tgr_eth.reserve_b = 50 * 1e18;
        tgr_eth.fee_rate = 0.003;
        tgr_eth.pool_type = "volatile";
        tgr_eth.tvl = 100000;
        pools_[tgr_eth.pool_id] = tgr_eth;
        
        // Initialize farms
        FarmStaking tgr_farm;
        tgr_farm.farm_id = "farm_0";
        tgr_farm.pool_id = "pool_0";
        tgr_farm.reward_token = "0xTGR";
        tgr_farm.reward_rate = 1000 * 1e18;  // Daily reward
        tgr_farm.apy = 0.25;  // 25% APY
        tgr_farm.start_time = std::chrono::system_clock::now().time_since_epoch().count();
        tgr_farm.end_time = tgr_farm.start_time + 365 * 24 * 60 * 60 * 1000;
        farms_[tgr_farm.farm_id] = tgr_farm;
        
        // Build token-pool mapping
        for (const auto& [pool_id, pool] : pools_) {
            token_pools_[pool.token_a].push_back(pool_id);
            token_pools_[pool.token_b].push_back(pool_id);
        }
    }
    
    // Get quote
    SwapQuote get_quote(const std::string& token_in, const std::string& token_out, uint64_t amount_in) {
        SwapQuote quote;
        quote.amount_in = amount_in;
        
        // Find pool
        auto pools_it = token_pools_.find(token_in);
        if (pools_it == token_pools_.end()) {
            return quote;
        }
        
        for (const auto& pool_id : pools_it->second) {
            auto pool_it = pools_.find(pool_id);
            if (pool_it == pools_.end()) continue;
            
            const auto& pool = pool_it->second;
            if (pool.token_b == token_out || pool.token_a == token_out) {
                uint64_t reserve_in = (pool.token_a == token_in) ? pool.reserve_a : pool.reserve_b;
                uint64_t reserve_out = (pool.token_a == token_out) ? pool.reserve_a : pool.reserve_b;
                
                // Calculate with fee
                uint64_t amount_in_with_fee = amount_in * 997 / 1000;
                uint64_t amount_out = amount_in_with_fee * reserve_out / (reserve_in * 1000 + amount_in_with_fee);
                
                quote.amount_out = amount_out;
                quote.pool_id = pool_id;
                quote.price_impact = static_cast<double>(amount_in) / static_cast<double>(reserve_in + amount_in);
                quote.execution_price = static_cast<double>(amount_out) / static_cast<double>(amount_in);
                quote.gas_fee = 150000 * 20e9;  // 150k gas * 20 gwei
                quote.path = {token_in, token_out};
                
                break;
            }
        }
        
        return quote;
    }
    
    // Add liquidity
    bool add_liquidity(const std::string& token_a, const std::string& token_b, uint64_t amount_a, uint64_t amount_b) {
        std::unique_lock lock(mutex_);
        
        // Find existing pool or create new
        for (auto& [pool_id, pool] : pools_) {
            if ((pool.token_a == token_a && pool.token_b == token_b) ||
                (pool.token_a == token_b && pool.token_b == token_a)) {
                
                pool.reserve_a += amount_a;
                pool.reserve_b += amount_b;
                pool.tvl += (amount_a + amount_b);
                
                total_fees_collected_.fetch_add(amount_a * pool.fee_rate + amount_b * pool.fee_rate);
                return true;
            }
        }
        
        // Create new pool
        std::string pool_id = "pool_" + std::to_string(next_pool_id_.fetch_add(1));
        LiquidityPool new_pool;
        new_pool.pool_id = pool_id;
        new_pool.token_a = token_a;
        new_pool.token_b = token_b;
        new_pool.reserve_a = amount_a;
        new_pool.reserve_b = amount_b;
        new_pool.fee_rate = 0.003;
        new_pool.tvl = amount_a + amount_b;
        
        pools_[pool_id] = new_pool;
        token_pools_[token_a].push_back(pool_id);
        token_pools_[token_b].push_back(pool_id);
        
        return true;
    }
    
    // Get pools for token
    std::vector<LiquidityPool> get_token_pools(const std::string& token) const {
        std::shared_lock lock(mutex_);
        
        std::vector<LiquidityPool> result;
        auto it = token_pools_.find(token);
        if (it == token_pools_.end()) {
            return result;
        }
        
        for (const auto& pool_id : it->second) {
            auto pool_it = pools_.find(pool_id);
            if (pool_it != pools_.end()) {
                result.push_back(pool_it->second);
            }
        }
        
        return result;
    }
    
    // Get all pools
    std::vector<LiquidityPool> get_all_pools() const {
        std::shared_lock lock(mutex_);
        
        std::vector<LiquidityPool> result;
        for (const auto& [id, pool] : pools_) {
            result.push_back(pool);
        }
        return result;
    }
    
    // Get farms
    std::vector<FarmStaking> get_farms() const {
        std::shared_lock lock(mutex_);
        
        std::vector<FarmStaking> result;
        for (const auto& [id, farm] : farms_) {
            if (farm.is_active) {
                result.push_back(farm);
            }
        }
        return result;
    }
    
    // Stake in farm
    bool stake(uint64_t amount, const std::string& farm_id) {
        std::unique_lock lock(mutex_);
        
        auto it = farms_.find(farm_id);
        if (it == farms_.end()) {
            return false;
        }
        
        it->second.total_staked += amount;
        return true;
    }
    
    // Unstake from farm
    bool unstake(uint64_t amount, const std::string& farm_id) {
        std::unique_lock lock(mutex_);
        
        auto it = farms_.find(farm_id);
        if (it == farms_.end()) {
            return false;
        }
        
        if (it->second.total_staked < amount) {
            return false;
        }
        
        it->second.total_staked -= amount;
        return true;
    }
    
    // Get total fees collected
    uint64_t get_total_fees() const {
        return total_fees_collected_.load();
    }
};

// ============================================================
// TigerWallet - Multichain Web3 Wallet
// ============================================================

// Wallet account
struct WalletAccount {
    std::string address;
    std::string public_key;
    std::string name;
    std::vector<std::string> chains;
    double total_balance_usd;
    uint64_t created_at;
    bool is_hardware_wallet;
    bool is_multisig;
    std::vector<std::string> signers;
    
    WalletAccount() : total_balance_usd(0), created_at(0), is_hardware_wallet(false), is_multisig(false) {}
};

// Wallet balance
struct WalletBalance {
    std::string address;
    std::string token_address;
    std::string symbol;
    double balance;
    double balance_usd;
    uint64_t last_update;
    
    WalletBalance() : balance(0), balance_usd(0), last_update(0) {}
};

// Transaction
struct WalletTransaction {
    std::string hash;
    std::string from;
    std::string to;
    std::string value;
    std::string data;
    std::string token_address;
    uint64_t amount;
    uint64_t gas_price;
    uint64_t gas_limit;
    std::string chain_id;
    uint64_t nonce;
    uint64_t timestamp;
    std::string status;
    
    WalletTransaction() : amount(0), gas_price(0), gas_limit(0), nonce(0), timestamp(0) {}
};

// TigerWallet
class TigerWallet {
private:
    std::unordered_map<std::string, WalletAccount> accounts_;
    std::unordered_map<std::string, std::vector<WalletBalance>> balances_;
    std::unordered_map<std::string, std::vector<WalletTransaction>> transactions_;
    std::atomic<uint64_t> next_wallet_id_{1};
    mutable std::shared_mutex mutex_;
    
    // Supported chains
    std::vector<std::string> supported_chains_ = {
        "tiger_mainnet", "ethereum", "polygon", "bsc", "avalanche", "arbitrum", "optimism", "base", "solana"
    };
    
public:
    TigerWallet() {
        initialize_default_wallets();
    }
    
    void initialize_default_wallets() {
        // Default wallet for platform
        WalletAccount platform_wallet;
        platform_wallet.address = "0xTigerWallet00000000000000000000000000";
        platform_wallet.name = "TigerEx Platform";
        platform_wallet.chains = supported_chains_;
        platform_wallet.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        accounts_[platform_wallet.address] = platform_wallet;
    }
    
    // Create wallet
    std::string create_wallet(const std::string& name, bool is_hardware = false) {
        std::unique_lock lock(mutex_);
        
        std::string address = "0x" + generate_address();
        std::string public_key = "0x04" + generate_public_key();
        
        WalletAccount wallet;
        wallet.address = address;
        wallet.public_key = public_key;
        wallet.name = name;
        wallet.chains = supported_chains_;
        wallet.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        wallet.is_hardware_wallet = is_hardware;
        
        accounts_[address] = wallet;
        
        return address;
    }
    
    // Get wallet
    std::optional<WalletAccount> get_wallet(const std::string& address) const {
        std::shared_lock lock(mutex_);
        
        auto it = accounts_.find(address);
        if (it != accounts_.end()) {
            return it->second;
        }
        return std::nullopt;
    }
    
    // Get all wallets for user
    std::vector<WalletAccount> get_user_wallets(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        
        std::vector<WalletAccount> result;
        for (const auto& [addr, wallet] : accounts_) {
            result.push_back(wallet);
        }
        return result;
    }
    
    // Get balance
    std::vector<WalletBalance> get_balance(const std::string& address) const {
        std::shared_lock lock(mutex_);
        
        auto it = balances_.find(address);
        if (it != balances_.end()) {
            return it->second;
        }
        return {};
    }
    
    // Update balance
    void update_balance(const std::string& address, const std::string& token, double amount, double usd_value) {
        std::unique_lock lock(mutex_);
        
        WalletBalance balance;
        balance.address = address;
        balance.token_address = token;
        balance.balance = amount;
        balance.balance_usd = usd_value;
        balance.last_update = std::chrono::system_clock::now().time_since_epoch().count();
        
        balances_[address].push_back(balance);
    }
    
    // Send transaction
    std::string send_transaction(const WalletTransaction& tx) {
        std::unique_lock lock(mutex_);
        
        std::string hash = "0x" + generate_hash();
        
        WalletTransaction new_tx = tx;
        new_tx.hash = hash;
        new_tx.timestamp = std::chrono::system_clock::now().time_since_epoch().count();
        new_tx.status = "confirmed";
        
        transactions_[tx.from].push_back(new_tx);
        
        return hash;
    }
    
    // Get transaction history
    std::vector<WalletTransaction> get_transactions(const std::string& address, uint32_t limit = 50) const {
        std::shared_lock lock(mutex_);
        
        auto it = transactions_.find(address);
        if (it == transactions_.end()) {
            return {};
        }
        
        const auto& txs = it->second;
        if (txs.size() <= limit) {
            return txs;
        }
        
        return std::vector<WalletTransaction>(txs.end() - limit, txs.end());
    }
    
    // Sign message
    std::string sign_message(const std::string& address, const std::string& message) {
        // Would sign using private key (not stored for security)
        // Return mock signature for demo
        return "0xSignature" + message.substr(0, 32);
    }
    
    // Verify signature
    bool verify_signature(const std::string& address, const std::string& message, const std::string& signature) {
        // Would verify using public key
        return true;
    }
    
    // Get supported chains
    std::vector<std::string> get_supported_chains() const {
        return supported_chains_;
    }
    
    // Add chain support
    void add_chain_support(const std::string& chain) {
        supported_chains_.push_back(chain);
    }
    
private:
    std::string generate_address() {
        // Would generate real address
        return "Tiger" + std::to_string(next_wallet_id_.fetch_add(1));
    }
    
    std::string generate_public_key() {
        return std::string(128, '0');
    }
    
    std::string generate_hash() {
        return std::string(64, '0');
    }
};

// ============================================================
// TigerEx Integration Layer - Unifies All Products
// ============================================================

class TigerExIntegration {
private:
    std::unique_ptr<TigerSmartChain> smart_chain_;
    std::unique_ptr<TigerswapDEX> tigerswap_;
    std::unique_ptr<TigerWallet> wallet_;
    
    // Fee collection
    std::atomic<uint64_t> exchange_fees_{0};
    std::atomic<uint64_t> dex_fees_{0};
    std::atomic<uint64_t> bridge_fees_{0};
    std::atomic<uint64_t> wallet_fees_{0};
    
public:
    TigerExIntegration() {
        smart_chain_ = std::make_unique<TigerSmartChain>();
        tigerswap_ = std::make_unique<TigerswapDEX>();
        wallet_ = std::make_unique<TigerWallet>();
    }
    
    // === TigerSmartChain Integration ===
    
    std::vector<ChainConfig> get_supported_chains() const {
        return smart_chain_->get_all_chains();
    }
    
    std::optional<TokenInfo> get_chain_token(const std::string& symbol) const {
        return smart_chain_->get_token_by_symbol(symbol);
    }
    
    std::vector<TokenInfo> get_all_tokens() const {
        return smart_chain_->get_all_tokens();
    }
    
    double get_gas_price(const std::string& chain = "tiger_mainnet") const {
        return smart_chain_->get_gas_price(chain);
    }
    
    double estimate_bridge_fee(double amount, const std::string& from, const std::string& to) const {
        return smart_chain_->estimate_bridge_fee(amount, from, to);
    }
    
    // === Tigerswap Integration ===
    
    SwapQuote get_swap_quote(const std::string& from, const std::string& to, uint64_t amount) {
        return tigerswap_->get_quote(from, to, amount);
    }
    
    bool add_liquidity(const std::string& token_a, const std::string& token_b, uint64_t amount_a, uint64_t amount_b) {
        return tigerswap_->add_liquidity(token_a, token_b, amount_a, amount_b);
    }
    
    std::vector<LiquidityPool> get_liquidity_pools(const std::string& token) const {
        return tigerswap_->get_token_pools(token);
    }
    
    std::vector<FarmStaking> get_farms() const {
        return tigerswap_->get_farms();
    }
    
    bool stake_in_farm(uint64_t amount, const std::string& farm_id) {
        return tigerswap_->stake(amount, farm_id);
    }
    
    // === TigerWallet Integration ===
    
    std::string create_wallet(const std::string& name) {
        return wallet_->create_wallet(name);
    }
    
    std::vector<WalletBalance> get_wallet_balance(const std::string& address) const {
        return wallet_->get_balance(address);
    }
    
    std::string send_wallet_transaction(const WalletTransaction& tx) {
        return wallet_->send_transaction(tx);
    }
    
    std::vector<WalletTransaction> get_wallet_transactions(const std::string& address, uint32_t limit = 50) const {
        return wallet_->get_transactions(address, limit);
    }
    
    // === Unified Fee Collection ===
    
    uint64_t collect_all_fees() {
        uint64_t total = 0;
        
        // Exchange fees
        total += exchange_fees_.load();
        
        // DEX fees
        total += tigerswap_->get_total_fees();
        
        // Bridge fees
        total += bridge_fees_.load();
        
        // Wallet fees
        total += wallet_fees_.load();
        
        return total;
    }
    
    uint64_t get_exchange_fees() const {
        return exchange_fees_.load();
    }
    
    uint64_t get_dex_fees() const {
        return tigerswap_->get_total_fees();
    }
    
    uint64_t get_bridge_fees() const {
        return bridge_fees_.load();
    }
    
    uint64_t get_wallet_fees() const {
        return wallet_fees_.load();
    }
    
    void add_exchange_fee(uint64_t fee) {
        exchange_fees_.fetch_add(fee);
    }
    
    void add_bridge_fee(uint64_t fee) {
        bridge_fees_.fetch_add(fee);
    }
    
    void add_wallet_fee(uint64_t fee) {
        wallet_fees_.fetch_add(fee);
    }
    
    // === Cross-Product Integration ===
    
    // Swap + Bridge: Get best route across DEX and bridge
    struct BestRoute {
        double total_output;
        double total_fee;
        std::vector<std::string> steps;
        std::string from_chain;
        std::string to_chain;
    };
    
    BestRoute get_best_route(const std::string& from_token, const std::string& to_token, 
                     uint64_t amount, const std::string& from_chain, const std::string& to_chain) {
        BestRoute route;
        route.from_chain = from_chain;
        route.to_chain = to_chain;
        
        // If different chains, bridge first
        if (from_chain != to_chain) {
            double bridge_fee = estimate_bridge_fee(amount, from_chain, to_chain);
            route.total_fee += bridge_fee;
            amount = static_cast<uint64_t>(amount * (1 - 0.001));  // After bridge fee
            route.steps.push_back("bridge:" + from_chain + "->" + to_chain);
        }
        
        // Then swap
        auto quote = get_swap_quote(from_token, to_token, amount);
        route.total_output = quote.amount_out;
        route.total_fee += quote.gas_fee;
        route.steps.push_back("swap:" + from_token + "->" + to_token);
        
        return route;
    }
    
    // Wallet + DEX: Get best swap using wallet balance
    SwapQuote get_wallet_swap_quote(const std::string& wallet_address,
                              const std::string& to_token,
                              uint64_t amount) {
        auto balances = get_wallet_balance(wallet_address);
        
        // Find source token with highest balance
        std::string best_token = "";
        double max_balance = 0;
        
        for (const auto& balance : balances) {
            if (balance.balance > max_balance) {
                max_balance = balance.balance;
                best_token = balance.token_address;
            }
        }
        
        if (!best_token.empty()) {
            return get_swap_quote(best_token, to_token, amount);
        }
        
        return {};
    }
    
    // SmartChain + Wallet: Get cross-chain balance
    double get_cross_chain_balance(const std::string& wallet_address, const std::string& token) const {
        auto wallet_balances = get_wallet_balance(wallet_address);
        
        for (const auto& balance : wallet_balances) {
            if (balance.token_address == token) {
                return balance.balance_usd;
            }
        }
        
        return 0;
    }
};

} // namespace integrations
} // namespace tigerex

#endif // TIGEREX_INTEGRATIONS_HPP