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

#include "tigerex/crypto.hpp"
#include "tigerex/market_data.hpp"

namespace tigerex {
namespace integrations {

/// Token amounts and pool reserves are held in 128 bits. A single reserve can
/// legitimately exceed 64 bits (1,000,000 TGR at 18 decimals is 10^24), and
/// truncating it to uint64_t would silently lose value.
using Amount = unsigned __int128;

/// Parse a whole-number base-unit amount from a JSON value. A string is the
/// preferred form because a JSON number of 10^24 loses precision before it is
/// ever parsed. Rejects fractions, signs and any other non-digit input.
inline Amount parse_amount(const nlohmann::json& value, const std::string& field) {
    std::string text;
    if (value.is_string()) {
        text = value.get<std::string>();
    } else if (value.is_number_unsigned()) {
        text = value.dump();
    } else {
        throw std::runtime_error(field + " must be a decimal amount or a decimal string");
    }
    if (text.empty() || text.find_first_not_of("0123456789") != std::string::npos) {
        throw std::runtime_error(field + " must be a whole number of base units, got \"" + text + "\"");
    }
    Amount result = 0;
    for (char c : text) {
        Amount next = result * 10 + static_cast<unsigned>(c - '0');
        if (next < result) {
            throw std::runtime_error(field + " overflows 128 bits: " + text);
        }
        result = next;
    }
    return result;
}

/// Read `field` from `object` as an amount.
inline Amount amount_field(const nlohmann::json& object, const std::string& field,
                           const Amount& fallback) {
    auto it = object.find(field);
    if (it == object.end()) {
        return fallback;
    }
    return parse_amount(*it, field);
}

/// Render an amount as a decimal string.
inline std::string amount_to_string(Amount value) {
    if (value == 0) {
        return "0";
    }
    std::string out;
    while (value > 0) {
        out.push_back(static_cast<char>('0' + static_cast<unsigned>(value % 10)));
        value /= 10;
    }
    std::reverse(out.begin(), out.end());
    return out;
}

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
    
    ChainConfig() : chain_id("0x0"), name(""), rpc_url(""), explorer_url(""), symbol(""), decimals(18), block_time(15000), is_active(true) {}
    
    ChainConfig(const std::string& id, const std::string& n, const std::string& rpc, const std::string& exp, const std::string& sym, uint8_t dec, uint64_t time, bool active)
        : chain_id(id), name(n), rpc_url(rpc), explorer_url(exp), symbol(sym), decimals(dec), block_time(time), is_active(active) {}
};

// Token information
struct TokenInfo {
    std::string address;
    std::string symbol;
    std::string name;
    uint8_t decimals;
    TokenStandard standard;
    Amount total_supply;
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

// SmartChain Network - Dynamic & Scalable
class TigerSmartChain {
private:
    std::unordered_map<std::string, ChainConfig> chains_;
    // Keyed by contract address, or by symbol for a native coin that has no
    // contract. symbol_index_ maps a symbol to that key.
    std::unordered_map<std::string, TokenInfo> tokens_;
    std::unordered_map<std::string, std::string> symbol_index_;
    std::unordered_map<std::string, std::vector<BridgeConfig>> bridges_;
    std::atomic<uint64_t> next_chain_id_{1};
    mutable std::shared_mutex mutex_;
    
    // Addresses of the Tiger ecosystem contracts. These are deployment
    // parameters, not constants: an unconfigured deployment has none, and
    // get_tgr_token()/get_rusd_token() return an empty string rather than a
    // plausible-looking placeholder.
    std::string tgr_token_address_;
    std::string rusd_token_address_;

    // Live price oracle. Prices are fetched on demand and never invented.
    mutable tigerex::market_data::CoinGeckoOracle price_oracle_;
    // Maps a symbol to its aggregator id, set from configuration. A symbol
    // with no id has no price.
    std::unordered_map<std::string, std::string> price_ids_;
    
    // Dynamic chain/token counters
    std::atomic<uint64_t> total_chains_{0};
    std::atomic<uint64_t> total_tokens_{0};
    std::atomic<uint64_t> total_bridges_{0};
    
public:
    TigerSmartChain() {
        initialize_default_chains();
    }
    
    /**
     * Register the chains, tokens and bridges this deployment is configured to
     * serve.
     *
     * Nothing here is invented. Chains come from `chains.json` in
     * TIGEREX_CONFIG_DIR (rpc_url, chain_id, explorer, symbol, decimals and
     * block_time are operator-supplied deployment facts), and token prices come
     * from the live aggregator. A deployment with no configuration file simply
     * serves no chains until an operator adds them through add_evm_chain() or
     * add_nonevm_chain().
     */
    void initialize_default_chains() {
        load_chains_from_config();
        load_bridges_from_config();
    }

    /// Path of the chain/bridge configuration file, honouring TIGEREX_CONFIG_DIR.
    static std::string config_path() {
        const char* dir = std::getenv("TIGEREX_CONFIG_DIR");
        std::string base = (dir != nullptr && *dir != '\0') ? std::string(dir) : std::string(".");
        return base + "/chains.json";
    }

    void load_chains_from_config() {
        std::ifstream file(config_path());
        if (!file.is_open()) {
            // No configuration deployed yet; serve no chains rather than a
            // fabricated list.
            return;
        }

        nlohmann::json config;
        try {
            file >> config;
        } catch (const std::exception& e) {
            throw std::runtime_error("chains.json is not valid JSON: " + std::string(e.what()));
        }

        if (!config.contains("chains") || !config["chains"].is_array()) {
            throw std::runtime_error("chains.json must contain a \"chains\" array");
        }

        for (const auto& entry : config["chains"]) {
            ChainConfig chain;
            chain.chain_id = entry.value("chain_id", "");
            chain.name = entry.value("name", "");
            chain.rpc_url = entry.value("rpc_url", "");
            chain.explorer_url = entry.value("explorer_url", "");
            chain.symbol = entry.value("symbol", "");
            chain.decimals = static_cast<uint8_t>(entry.value("decimals", 18));
            chain.block_time = entry.value("block_time", 0);
            chain.is_active = entry.value("is_active", true);
            if (chain.chain_id.empty() || chain.name.empty()) {
                throw std::runtime_error("every chain needs a chain_id and a name");
            }
            chains_[chain.name] = chain;
            total_chains_.fetch_add(1);
        }

        if (config.contains("tgr_token_address")) {
            tgr_token_address_ = config["tgr_token_address"].get<std::string>();
        }
        if (config.contains("rusd_token_address")) {
            rusd_token_address_ = config["rusd_token_address"].get<std::string>();
        }

        if (config.contains("tokens") && config["tokens"].is_array()) {
            for (const auto& entry : config["tokens"]) {
                TokenInfo token;
                token.address = entry.value("address", "");
                token.symbol = entry.value("symbol", "");
                token.name = entry.value("name", "");
                token.decimals = static_cast<uint8_t>(entry.value("decimals", 18));
                token.standard = entry.value("native", false) ? TokenStandard::NATIVE : TokenStandard::ERC20;
                token.total_supply = amount_field(entry, "total_supply", 0);
                token.icon_url = entry.value("icon_url", "");
                token.is_verified = entry.value("verified", false);
                token.is_trading_enabled = entry.value("trading_enabled", true);
                if (token.symbol.empty()) {
                    throw std::runtime_error("every token needs a symbol");
                }
                // price_usd stays 0 here: it is filled from the live oracle on
                // demand by get_token()/get_token_by_symbol(), never baked in.
                if (symbol_index_.count(token.symbol) != 0) {
                    throw std::runtime_error("duplicate token symbol: " + token.symbol);
                }
                std::string key = token.address.empty() ? token.symbol : token.address;
                tokens_[key] = token;
                symbol_index_[token.symbol] = key;
                total_tokens_.fetch_add(1);
            }
        }
    }

    void load_bridges_from_config() {
        std::ifstream file(config_path());
        if (!file.is_open()) {
            return;
        }
        nlohmann::json config;
        try {
            file >> config;
        } catch (const std::exception&) {
            return;
        }
        if (!config.contains("bridges") || !config["bridges"].is_array()) {
            return;
        }
        for (const auto& entry : config["bridges"]) {
            BridgeConfig bridge;
            bridge.bridge_address = entry.value("bridge_address", "");
            bridge.source_chain = entry.value("source_chain", "");
            bridge.target_chain = entry.value("target_chain", "");
            bridge.min_amount = tigerex::market_data::json_uint64_field(entry, "min_amount", 0);
            bridge.max_amount = tigerex::market_data::json_uint64_field(entry, "max_amount", 0);
            if (bridge.max_amount < bridge.min_amount) {
                throw std::runtime_error("bridge max_amount is below min_amount");
            }
            bridge.fee_percentage = entry.value("fee_percentage", 0.0);
            bridge.estimated_time =
                tigerex::market_data::json_uint64_field(entry, "estimated_time", 0);
            if (bridge.bridge_address.empty() || bridge.target_chain.empty()) {
                throw std::runtime_error("every bridge needs a bridge_address and a target_chain");
            }
            bridges_[bridge.target_chain].push_back(bridge);
            total_bridges_.fetch_add(1);
        }
    }

    /// Set the TGR/RUSD contract addresses (operator action after deployment).
    void set_tgr_token_address(const std::string& address) {
        std::unique_lock lock(mutex_);
        tgr_token_address_ = address;
    }

    void set_rusd_token_address(const std::string& address) {
        std::unique_lock lock(mutex_);
        rusd_token_address_ = address;
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
    
    // Get token info by contract address or native-coin key.
    std::optional<TokenInfo> get_token(const std::string& address) const {
        std::shared_lock lock(mutex_);
        auto it = tokens_.find(address);
        if (it == tokens_.end()) {
            return std::nullopt;
        }
        TokenInfo result = it->second;
        auto id = price_ids_.find(result.symbol);
        if (id != price_ids_.end()) {
            if (auto price = price_oracle_.price(id->second)) {
                result.price_usd = *price;
            }
        }
        return result;
    }

    // Get token by symbol. When the symbol has a configured aggregator id the
    // price is fetched live; otherwise it stays 0, which callers must read as
    // "no price available".
    std::optional<TokenInfo> get_token_by_symbol(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        auto key = symbol_index_.find(symbol);
        if (key == symbol_index_.end()) {
            return std::nullopt;
        }
        auto it = tokens_.find(key->second);
        if (it == tokens_.end()) {
            return std::nullopt;
        }
        TokenInfo result = it->second;
        auto id = price_ids_.find(symbol);
        if (id != price_ids_.end()) {
            if (auto price = price_oracle_.price(id->second)) {
                result.price_usd = *price;
            }
        }
        return result;
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
    
    // Register a token. Returns false when the symbol is already registered, so
    // a caller cannot silently shadow an existing listing.
    bool add_token(const TokenInfo& token) {
        std::unique_lock lock(mutex_);
        if (symbol_index_.count(token.symbol) != 0) {
            return false;
        }
        std::string key = token.address.empty() ? token.symbol : token.address;
        tokens_[key] = token;
        symbol_index_[token.symbol] = key;
        total_tokens_.fetch_add(1);
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
        for (const auto& bridge : get_bridges(to_chain)) {
            if (bridge.source_chain == from_chain) {
                return amount * bridge.fee_percentage;
            }
        }
        throw std::runtime_error("no configured bridge from " + from_chain + " to " + to_chain);
    }
    
    // Get gas price
    // Current gas price in wei, read from the chain's own RPC endpoint.
    // Throws when the chain is unknown or the node does not answer.
    double get_gas_price(const std::string& chain_key) const {
        auto chain_opt = get_chain(chain_key);
        if (!chain_opt.has_value()) {
            throw std::runtime_error("unknown chain: " + chain_key);
        }
        if (chain_opt->rpc_url.empty()) {
            throw std::runtime_error("chain " + chain_key + " has no rpc_url configured");
        }
        return tigerex::market_data::evm_gas_price(chain_opt->rpc_url);
    }
    
    // Get TGR token address
    std::string get_tgr_token() const {
        return tgr_token_address_;
    }
    
    // Get RUSD token address
    std::string get_rusd_token() const {
        return rusd_token_address_;
    }
    
    // ==================== DYNAMIC CHAIN MANAGEMENT ====================
    
    /**
     * Add a new EVM blockchain dynamically at runtime
     * Supports unlimited chains addition
     */
    bool add_evm_chain(const std::string& key, const std::string& name, const std::string& chain_id,
                       const std::string& rpc_url, const std::string& explorer, const std::string& symbol,
                       uint8_t decimals, uint64_t block_time = 15000) {
        std::unique_lock lock(mutex_);
        
        ChainConfig config;
        config.chain_id = chain_id;
        config.name = name;
        config.rpc_url = rpc_url;
        config.explorer_url = explorer;
        config.symbol = symbol;
        config.decimals = decimals;
        config.block_time = block_time;
        config.is_active = true;
        
        chains_[key] = config;
        total_chains_.fetch_add(1);
        
        return true;
    }
    
    /**
     * Add a new Non-EVM blockchain dynamically at runtime
     * Supports Solana, Near, Aptos, Cosmos ecosystem, etc.
     */
    bool add_nonevm_chain(const std::string& key, const std::string& name, const std::string& chain_id,
                         const std::string& rpc_url, const std::string& explorer, const std::string& symbol,
                         uint8_t decimals, uint64_t block_time = 3000) {
        std::unique_lock lock(mutex_);
        
        ChainConfig config;
        config.chain_id = chain_id;
        config.name = name;
        config.rpc_url = rpc_url;
        config.explorer_url = explorer;
        config.symbol = symbol;
        config.decimals = decimals;
        config.block_time = block_time;
        config.is_active = true;
        
        chains_[key] = config;
        total_chains_.fetch_add(1);
        
        return true;
    }
    
    /**
     * Add a new token dynamically at runtime
     * Supports unlimited token addition
     */
    bool add_token(const std::string& address, const std::string& symbol, const std::string& name,
                   uint8_t decimals, TokenStandard standard, Amount supply,
                   double price_usd = 0.0) {
        TokenInfo token;
        token.address = address;
        token.symbol = symbol;
        token.name = name;
        token.decimals = decimals;
        token.standard = standard;
        token.total_supply = supply;
        // A supplied price is an operator input, not a discovered one; it is
        // kept only when the caller explicitly passes one.
        token.price_usd = price_usd;
        token.is_verified = true;
        token.is_trading_enabled = true;
        return add_token(token);
    }
    
    /**
     * Add a new bridge connection dynamically
     */
    bool add_bridge(const std::string& chain_key, const std::string& bridge_addr,
                    const std::string& source, const std::string& target,
                    double min_amt, double max_amt, double fee_pct, uint64_t time_est) {
        std::unique_lock lock(mutex_);
        
        BridgeConfig bridge;
        bridge.bridge_address = bridge_addr;
        bridge.source_chain = source;
        bridge.target_chain = target;
        bridge.min_amount = min_amt;
        bridge.max_amount = max_amt;
        bridge.fee_percentage = fee_pct;
        bridge.estimated_time = time_est;
        bridge.is_active = true;
        
        bridges_[chain_key].push_back(bridge);
        total_bridges_.fetch_add(1);
        
        return true;
    }
    
    /**
     * Remove a chain (deactivate)
     */
    bool deactivate_chain(const std::string& key) {
        std::unique_lock lock(mutex_);
        
        auto it = chains_.find(key);
        if (it != chains_.end()) {
            it->second.is_active = false;
            return true;
        }
        return false;
    }
    
    /**
     * Reactivate a chain
     */
    bool activate_chain(const std::string& key) {
        std::unique_lock lock(mutex_);
        
        auto it = chains_.find(key);
        if (it != chains_.end()) {
            it->second.is_active = true;
            return true;
        }
        return false;
    }
    
    /**
     * Get statistics
     */
    uint64_t get_total_chains() const { return total_chains_.load(); }
    uint64_t get_total_tokens() const { return total_tokens_.load(); }
    uint64_t get_total_bridges() const { return total_bridges_.load(); }
    
    /**
     * Get all active chains (filter)
     */
    std::vector<std::pair<std::string, ChainConfig>> get_active_chains() const {
        std::shared_lock lock(mutex_);
        std::vector<std::pair<std::string, ChainConfig>> result;
        
        for (const auto& [key, chain] : chains_) {
            if (chain.is_active) {
                result.push_back({key, chain});
            }
        }
        return result;
    }
    
    /**
     * Search chains by name or symbol
     */
    std::vector<std::pair<std::string, ChainConfig>> search_chains(const std::string& query) const {
        std::shared_lock lock(mutex_);
        std::vector<std::pair<std::string, ChainConfig>> result;
        
        std::string lower_query = query;
        std::transform(lower_query.begin(), lower_query.end(), lower_query.begin(), ::tolower);
        
        for (const auto& [key, chain] : chains_) {
            std::string lower_name = chain.name;
            std::transform(lower_name.begin(), lower_name.end(), lower_name.begin(), ::tolower);
            
            std::string lower_symbol = chain.symbol;
            std::transform(lower_symbol.begin(), lower_symbol.end(), lower_symbol.begin(), ::tolower);
            
            if (lower_name.find(lower_query) != std::string::npos ||
                lower_symbol.find(lower_query) != std::string::npos) {
                result.push_back({key, chain});
            }
        }
        return result;
    }
    
    /**
     * Get chain by symbol
     */
    std::optional<ChainConfig> get_chain_by_symbol(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        
        for (const auto& [key, chain] : chains_) {
            if (chain.symbol == symbol) {
                return chain;
            }
        }
        return std::nullopt;
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
    Amount reserve_a;
    Amount reserve_b;
    double fee_rate;
    double apy;
    std::string pool_type;  // "volatile" or "stable"
    Amount liquidity;
    Amount volume_24h;
    double tvl;
    
    LiquidityPool()
        : reserve_a(0), reserve_b(0), fee_rate(0.003), apy(0), liquidity(0), volume_24h(0), tvl(0) {}
};

// Farm staking
struct FarmStaking {
    std::string farm_id;
    std::string pool_id;
    std::string reward_token;
    Amount reward_rate;
    Amount total_staked;
    double apy;
    uint64_t lock_period;
    uint64_t start_time;
    uint64_t end_time;
    bool is_active;
    
    FarmStaking() : reward_rate(0), total_staked(0), apy(0), lock_period(0), start_time(0), end_time(0), is_active(true) {}
};

// Swap quote
struct SwapQuote {
    Amount amount_in;
    Amount amount_out;
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
    
    /**
     * Load liquidity pools and farms from `dex.json` in TIGEREX_CONFIG_DIR.
     *
     * A pool's reserves are real state: they exist because liquidity was
     * deposited. With no configuration file the DEX therefore starts empty and
     * pools appear only through add_liquidity(), instead of pre-seeded reserves
     * that no one ever deposited.
     */
    void initialize_default_pools() {
        const char* dir = std::getenv("TIGEREX_CONFIG_DIR");
        std::string base = (dir != nullptr && *dir != '\0') ? std::string(dir) : std::string(".");
        std::ifstream file(base + "/dex.json");
        if (!file.is_open()) {
            return;
        }

        nlohmann::json config;
        try {
            file >> config;
        } catch (const std::exception& e) {
            throw std::runtime_error("dex.json is not valid JSON: " + std::string(e.what()));
        }

        if (config.contains("pools") && config["pools"].is_array()) {
            for (const auto& entry : config["pools"]) {
                std::string pool_id = entry.value("pool_id", "");
                std::string token_a = entry.value("token_a", "");
                std::string token_b = entry.value("token_b", "");
                Amount reserve_a = amount_field(entry, "reserve_a", 0);
                Amount reserve_b = amount_field(entry, "reserve_b", 0);
                if (pool_id.empty() || token_a.empty() || token_b.empty()) {
                    throw std::runtime_error("every pool needs a pool_id, token_a and token_b");
                }
                if (reserve_a == 0 || reserve_b == 0) {
                    throw std::runtime_error("pool " + pool_id + " has a zero reserve");
                }
                LiquidityPool pool;
                pool.pool_id = pool_id;
                pool.token_a = token_a;
                pool.token_b = token_b;
                pool.reserve_a = reserve_a;
                pool.reserve_b = reserve_b;
                pool.fee_rate = entry.value("fee_rate", 0.003);
                pool.pool_type = entry.value("pool_type", "volatile");
                // TVL is a display value; the reserves themselves stay exact.
                pool.tvl = static_cast<double>(reserve_a + reserve_b);
                pools_[pool_id] = pool;
                token_pools_[token_a].push_back(pool_id);
                token_pools_[token_b].push_back(pool_id);
            }
        }

        if (config.contains("farms") && config["farms"].is_array()) {
            for (const auto& entry : config["farms"]) {
                FarmStaking farm;
                farm.farm_id = entry.value("farm_id", "");
                farm.pool_id = entry.value("pool_id", "");
                farm.reward_token = entry.value("reward_token", "");
                farm.reward_rate = amount_field(entry, "reward_rate", 0);
                farm.apy = entry.value("apy", 0.0);
                farm.start_time = tigerex::market_data::json_uint64_field(entry, "start_time", 0);
                farm.end_time = tigerex::market_data::json_uint64_field(entry, "end_time", 0);
                if (farm.farm_id.empty() || pools_.find(farm.pool_id) == pools_.end()) {
                    throw std::runtime_error("farm " + farm.farm_id + " references an unknown pool");
                }
                farms_[farm.farm_id] = farm;
            }
        }
    }

    
    // Get quote
    // Constant-product quote. Throws when the pair has no pool or the input is
    // not a positive amount, so a caller can never mistake an empty quote for a
    // priced one.
    SwapQuote get_quote(const std::string& token_in, const std::string& token_out, Amount amount_in) {
        if (amount_in == 0) {
            throw std::invalid_argument("quote amount must be greater than zero");
        }
        if (token_in == token_out) {
            throw std::invalid_argument("cannot quote a swap of a token for itself");
        }

        std::shared_lock lock(mutex_);

        SwapQuote quote;
        quote.amount_in = amount_in;

        auto pools_it = token_pools_.find(token_in);
        if (pools_it == token_pools_.end()) {
            throw std::runtime_error("no pool trades " + token_in);
        }

        for (const auto& pool_id : pools_it->second) {
            auto pool_it = pools_.find(pool_id);
            if (pool_it == pools_.end()) continue;

            const auto& pool = pool_it->second;
            if (pool.token_b == token_out || pool.token_a == token_out) {
                Amount reserve_in = (pool.token_a == token_in) ? pool.reserve_a : pool.reserve_b;
                Amount reserve_out = (pool.token_a == token_out) ? pool.reserve_a : pool.reserve_b;
                if (reserve_in == 0 || reserve_out == 0) {
                    throw std::runtime_error("pool " + pool_id + " has an empty reserve");
                }

                // x * y = k. fee_rate is a fraction, so the fee is applied in
                // basis points to keep the amount exact: fee is floor(amount_in * fee_bps / 10000).
                Amount fee_bps = static_cast<Amount>(pool.fee_rate * 10000.0 + 0.5);
                Amount amount_in_with_fee = amount_in - (amount_in * fee_bps / 10000);
                Amount denominator = reserve_in + amount_in_with_fee;
                Amount amount_out = amount_in_with_fee * reserve_out / denominator;
                if (amount_out == 0) {
                    throw std::runtime_error("quote for " + token_in + " -> " + token_out + " rounds to zero");
                }

                quote.amount_out = amount_out;
                quote.pool_id = pool_id;
                quote.price_impact = static_cast<double>(amount_in_with_fee) /
                                     static_cast<double>(denominator);
                quote.execution_price = static_cast<double>(amount_out) /
                                        static_cast<double>(amount_in);
                // Gas is chain- and time-dependent; the caller fills this from
                // get_gas_price() once the target chain is known.
                quote.gas_fee = 0;
                quote.path = {token_in, token_out};

                return quote;
            }
        }

        throw std::runtime_error("no pool trades the pair " + token_in + "/" + token_out);
    }

    
    // Add liquidity
    bool add_liquidity(const std::string& token_a, const std::string& token_b, Amount amount_a, Amount amount_b) {
        if (amount_a == 0 || amount_b == 0) {
            throw std::invalid_argument("liquidity amounts must both be greater than zero");
        }
        std::unique_lock lock(mutex_);
        
        // Find existing pool or create new
        for (auto& [pool_id, pool] : pools_) {
            if ((pool.token_a == token_a && pool.token_b == token_b) ||
                (pool.token_a == token_b && pool.token_b == token_a)) {
                
                pool.reserve_a += amount_a;
                pool.reserve_b += amount_b;
                pool.tvl = static_cast<double>(pool.reserve_a + pool.reserve_b);
                
                // Depositing liquidity is not a trade: no fee is charged here.
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
        new_pool.tvl = static_cast<double>(amount_a + amount_b);
        
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
    
    // ==================== DYNAMIC TOKEN/POOL MANAGEMENT ====================
    
    /**
     * Create a new liquidity pool for any token pair
     * Dynamically add new trading pairs
     */
    bool create_pool(const std::string& token_a, const std::string& token_b, double fee_rate = 0.003) {
        std::unique_lock lock(mutex_);
        
        std::string pool_id = "pool_" + std::to_string(next_pool_id_.fetch_add(1));
        
        LiquidityPool pool;
        pool.pool_id = pool_id;
        pool.token_a = token_a;
        pool.token_b = token_b;
        pool.fee_rate = fee_rate;
        pool.pool_type = "volatile";
        
        pools_[pool_id] = pool;
        
        // Add to token pools mapping
        token_pools_[token_a].push_back(pool_id);
        token_pools_[token_b].push_back(pool_id);
        
        return true;
    }
    
    /**
     * Remove/deactivate a pool
     */
    bool deactivate_pool(const std::string& pool_id) {
        std::unique_lock lock(mutex_);
        
        auto it = pools_.find(pool_id);
        if (it != pools_.end()) {
            it->second.fee_rate = 0;  // Mark as inactive
            return true;
        }
        return false;
    }
    
    /**
     * Update pool fee rate dynamically
     */
    bool update_pool_fee(const std::string& pool_id, double new_fee) {
        std::unique_lock lock(mutex_);
        
        auto it = pools_.find(pool_id);
        if (it != pools_.end()) {
            it->second.fee_rate = new_fee;
            return true;
        }
        return false;
    }
    
    /**
     * Get all pools for a token
     */
    std::vector<LiquidityPool> get_all_pools_for_token(const std::string& token) const {
        std::shared_lock lock(mutex_);
        
        std::vector<LiquidityPool> result;
        auto pools = get_token_pools(token);
        
        for (const auto& p : pools) {
            if (p.fee_rate > 0) {
                result.push_back(p);
            }
        }
        return result;
    }
    
    /**
     * Get all active pools
     */
    std::vector<LiquidityPool> get_active_pools() const {
        std::shared_lock lock(mutex_);
        
        std::vector<LiquidityPool> result;
        for (const auto& [id, pool] : pools_) {
            if (pool.fee_rate > 0) {
                result.push_back(pool);
            }
        }
        return result;
    }
    
    /**
     * Get pool count
     */
    uint64_t get_pool_count() const {
        return next_pool_id_.load();
    }
    
    /**
     * Get active farm count
     */
    uint64_t get_farm_count() const {
        uint64_t count = 0;
        for (const auto& [id, farm] : farms_) {
            if (farm.is_active) count++;
        }
        return count;
    }
    
    /**
     * Create new farm
     */
    bool create_farm(const std::string& pool_id, const std::string& reward_token, 
                    uint64_t reward_rate, double apy, uint64_t duration_days) {
        std::unique_lock lock(mutex_);
        
        std::string farm_id = "farm_" + std::to_string(farms_.size() + 1);
        
        FarmStaking farm;
        farm.farm_id = farm_id;
        farm.pool_id = pool_id;
        farm.reward_token = reward_token;
        farm.reward_rate = reward_rate;
        farm.apy = apy;
        farm.lock_period = duration_days * 24 * 60 * 60 * 1000;
        farm.start_time = std::chrono::system_clock::now().time_since_epoch().count();
        farm.end_time = farm.start_time + farm.lock_period;
        farm.is_active = true;
        
        farms_[farm_id] = farm;
        return true;
    }
    
    /**
     * End farm
     */
    bool end_farm(const std::string& farm_id) {
        std::unique_lock lock(mutex_);
        
        auto it = farms_.find(farm_id);
        if (it != farms_.end()) {
            it->second.is_active = false;
            return true;
        }
        return false;
    }
};

// ============================================================
// TigerWallet - Multichain Web3 Wallet
// ============================================================

// Wallet account
struct WalletAccount {
    std::string address;
    std::string user_id;
    std::string public_key;              // uncompressed, hex
    std::string public_key_compressed;   // compressed, hex
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
    uint64_t confirmations;
    
    WalletTransaction() : amount(0), gas_price(0), gas_limit(0), nonce(0), timestamp(0), confirmations(0) {}
};

// TigerWallet
class TigerWallet {
private:
    std::unordered_map<std::string, WalletAccount> accounts_;
    std::unordered_map<std::string, std::vector<WalletBalance>> balances_;
    std::unordered_map<std::string, std::vector<WalletTransaction>> transactions_;
    std::unordered_map<std::string, std::string> key_material_;
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
        // The platform wallet is derived from a freshly generated key pair, so
        // its address is a real checksummed EVM address rather than a label.
        WalletAccount platform_wallet;
        // The platform wallet belongs to the exchange itself, not to a user.
        platform_wallet.user_id = "tigerex-platform";
        platform_wallet.name = "TigerEx Platform";
        platform_wallet.chains = supported_chains_;
        platform_wallet.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        register_wallet(platform_wallet);
    }

    /// Derive address and public keys for `wallet`, store the key material and
    /// return the address.
    std::string register_wallet(WalletAccount& wallet) {
        crypto::KeyPair kp = crypto::generate_secp256k1_keypair();
        wallet.public_key = crypto::to_hex(kp.public_key_uncompressed);
        wallet.public_key_compressed = crypto::to_hex(kp.public_key_compressed);
        wallet.address = crypto::evm_address_from_public_key(kp.public_key_uncompressed);
        accounts_[wallet.address] = wallet;
        // A hardware wallet's key never leaves the device, so this process keeps
        // no copy of it and cannot sign on the device's behalf.
        if (!wallet.is_hardware_wallet) {
            key_material_[wallet.address] = kp.private_key_hex;
        }
        return wallet.address;
    }
    
    // Create wallet
    // Create a wallet owned by `user_id`. The owner is recorded so that
    // get_user_wallets() can return exactly that user's wallets.
    std::string create_wallet(const std::string& user_id, const std::string& name,
                              bool is_hardware = false) {
        std::unique_lock lock(mutex_);

        WalletAccount wallet;
        wallet.user_id = user_id;
        wallet.name = name;
        wallet.chains = supported_chains_;
        wallet.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        wallet.is_hardware_wallet = is_hardware;

        return register_wallet(wallet);
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
            if (wallet.user_id == user_id) {
                result.push_back(wallet);
            }
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
    
    // Record a transaction the network has already accepted.
    //
    // This class holds no node connection: it cannot broadcast, and it cannot
    // observe confirmations. Marking a locally-built transaction "confirmed"
    // would fabricate state, so the caller supplies the on-chain hash and the
    // status the network reported. A "confirmed" status is only accepted with a
    // hash and at least one confirmation.
    std::string record_transaction(const WalletTransaction& tx) {
        std::unique_lock lock(mutex_);

        if (tx.hash.empty()) {
            throw std::invalid_argument("transaction hash is required: this wallet does not broadcast");
        }
        if (tx.status == "confirmed" && tx.confirmations == 0) {
            throw std::invalid_argument("a confirmed transaction must carry at least one confirmation");
        }

        WalletTransaction new_tx = tx;
        new_tx.timestamp = std::chrono::system_clock::now().time_since_epoch().count();
        transactions_[tx.from].push_back(new_tx);
        return tx.hash;
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
    
    // Sign a message with the wallet's own key. Returns an empty string when
    // the wallet is unknown or is a hardware wallet, whose key never leaves
    // the device and so cannot be used by this process.
    std::string sign_message(const std::string& address, const std::string& message) {
        std::shared_lock lock(mutex_);
        
        auto acct = accounts_.find(address);
        if (acct == accounts_.end() || acct->second.is_hardware_wallet) {
            return {};
        }
        auto key = key_material_.find(address);
        if (key == key_material_.end()) {
            return {};
        }
        try {
            return crypto::sign_message_secp256k1(key->second, message);
        } catch (const std::exception&) {
            return {};
        }
    }
    
    // Verify a signature against the stored public key of `address`.
    bool verify_signature(const std::string& address, const std::string& message, const std::string& signature) {
        std::shared_lock lock(mutex_);
        
        auto acct = accounts_.find(address);
        if (acct == accounts_.end()) {
            return false;
        }
        auto pub = crypto::from_hex(acct->second.public_key);
        return crypto::verify_message_secp256k1(pub, message, signature);
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
    /// keccak256 over the canonical transaction fields, so a hash is
    /// reproducible from the transaction instead of being a constant.
    static std::string transaction_hash(const WalletTransaction& tx) {
        std::ostringstream oss;
        oss << tx.from << '|' << tx.to << '|' << tx.value << '|' << tx.data << '|'
            << tx.token_address << '|' << tx.amount << '|' << tx.gas_price << '|'
            << tx.gas_limit << '|' << tx.chain_id << '|' << tx.nonce;
        auto digest = crypto::keccak256(oss.str());
        return crypto::to_hex(digest.data(), digest.size());
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
    
    std::string create_wallet(const std::string& user_id, const std::string& name) {
        return wallet_->create_wallet(user_id, name);
    }

    std::vector<WalletAccount> get_user_wallets(const std::string& user_id) const {
        return wallet_->get_user_wallets(user_id);
    }
    
    std::vector<WalletBalance> get_wallet_balance(const std::string& address) const {
        return wallet_->get_balance(address);
    }
    
    std::string record_wallet_transaction(const WalletTransaction& tx) {
        return wallet_->record_transaction(tx);
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
        total += dex_fees_.load();
        
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
        return dex_fees_.load();
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

    void add_dex_fee(uint64_t fee) {
        dex_fees_.fetch_add(fee);
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
        
        if (best_token.empty()) {
            throw std::runtime_error("wallet " + wallet_address + " holds no balance to swap");
        }
        return get_swap_quote(best_token, to_token, amount);
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