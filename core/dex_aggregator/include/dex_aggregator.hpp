/**
 * TigerEx DEX Aggregator
 * Cross-DEX liquidity aggregation and smart routing
 * Supports Uniswap, Curve, Balancer, SushiSwap, and more
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_DEX_AGGREGATOR_HPP
#define TIGEREX_DEX_AGGREGATOR_HPP

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
#include <numeric>
#include <random>
#include <string>
#include <set>
#include <queue>

// For JSON parsing
#include <sstream>
#include <iomanip>

namespace tigerex {
namespace dex {

// Supported DEX protocols
enum class DEXProtocol : uint8_t {
    UNISWAP_V2 = 0,
    UNISWAP_V3 = 1,
    SUSHISWAP = 2,
    CURVE = 3,
    BALANCER = 4,
    PANCAKESWAP = 5,
    QUICKSWAP = 6,
    SPIRITSWAP = 7,
    TRADERJOE = 8,
    AURORA = 9,
    RAYDIUM = 10,
    ORCA = 11,
    SERUM = 12,
    BITCOIN_COM = 13,
    GATE_IO = 14,
    BINANCE = 15,
    BYBIT = 16,
    OKX = 17,
    HUOBI = 18,
    CEX = 19
};

// Chain IDs
enum class ChainId : uint8_t {
    ETHEREUM = 1,
    POLYGON = 137,
    BSC = 56,
    AVALANCHE = 43114,
    FANTOM = 250,
    ARBITRUM = 42161,
    OPTIMISM = 10,
    SOLANA = 101,
    AURORA = 1313161554,
    NEAR = 1313161555,
    CELO = 42220,
    GNOSIS = 100
};

// Token information
struct Token {
    std::string symbol;
    std::string name;
    std::string address;
    uint8_t decimals;
    ChainId chain;
    
    Token() : decimals(18), chain(ChainId::ETHEREUM) {}
    
    bool operator==(const Token& other) const {
        return address == other.address && chain == other.chain;
    }
};

struct TokenHash {
    size_t operator()(const Token& token) const {
        return std::hash<std::string>{}(token.address);
    }
};

// Pool information
struct Pool {
    std::string pool_id;
    DEXProtocol protocol;
    ChainId chain;
    Token token_a;
    Token token_b;
    
    uint64_t reserve_a;
    uint64_t reserve_b;
    
    double fee_rate;  // e.g., 0.003 for 0.3%
    double tick_spacing;
    
    uint64_t liquidity;
    double apy;
    
    uint64_t last_update_time;
    bool is_stable;  // Stable coin pool
    
    Pool() 
        : protocol(DEXProtocol::UNISWAP_V2)
        , chain(ChainId::ETHEREUM)
        , reserve_a(0)
        , reserve_b(0)
        , fee_rate(0.003)
        , tick_spacing(1)
        , liquidity(0)
        , apy(0.0)
        , last_update_time(0)
        , is_stable(false)
    {}
};

// Quote request
struct QuoteRequest {
    Token from_token;
    Token to_token;
    uint64_t amount_in;
    uint64_t max_slippage;  // In basis points
    uint64_t deadline;
    bool force_dex;  // Force specific DEX
    DEXProtocol preferred_dex;
    uint32_t max_hops;
    
    QuoteRequest()
        : amount_in(0)
        , max_slippage(50)  // 0.5% default
        , deadline(0)
        , force_dex(false)
        , preferred_dex(DEXProtocol::UNISWAP_V2)
        , max_hops(3)
    {}
};

// Quote response
struct QuoteResponse {
    uint64_t amount_out;
    uint64_t amount_out_usd;
    double price_impact;
    double execution_price;
    uint64_t gas_estimate;
    uint64_t gas_price_usd;
    
    std::vector<RouteStep> route;
    std::vector<DEXProtocol> dexes_used;
    
    uint64_t total_fee;
    uint64_t total_gas;
    
    uint64_t timestamp;
    uint64_t expires_at;
    
    QuoteResponse()
        : amount_out(0)
        , amount_out_usd(0)
        , price_impact(0.0)
        , execution_price(0.0)
        , gas_estimate(0)
        , gas_price_usd(0)
        , total_fee(0)
        , total_gas(0)
        , timestamp(0)
        , expires_at(0)
    {}
};

// Route step
struct RouteStep {
    DEXProtocol protocol;
    ChainId chain;
    Token from_token;
    Token to_token;
    uint64_t amount_in;
    uint64_t amount_out;
    uint64_t pool_index;
    double fee;
    int32_t tick_limit;
    
    RouteStep()
        : protocol(DEXProtocol::UNISWAP_V2)
        , chain(ChainId::ETHEREUM)
        , amount_in(0)
        , amount_out(0)
        , pool_index(0)
        , fee(0.003)
        , tick_limit(0)
    {}
};

// Swap transaction
struct SwapTransaction {
    std::string transaction_id;
    Token from_token;
    Token to_token;
    uint64_t amount_in;
    uint64_t min_amount_out;
    
    std::vector<RouteStep> route;
    
    std::string data;  // Encoded swap data
    std::string to;     // Target contract
    
    uint64_t value;     // ETH value if needed
    uint64_t gas_limit;
    uint64_t gas_price;
    
    uint64_t deadline;
    uint64_t created_at;
    
    SwapTransaction()
        : amount_in(0)
        , min_amount_out(0)
        , value(0)
        , gas_limit(0)
        , gas_limit(0)
        , deadline(0)
        , created_at(0)
    {}
};

// Token price
struct TokenPrice {
    std::string symbol;
    double price_usd;
    double change_24h;
    uint64_t volume_24h;
    uint64_t last_update;
    
    TokenPrice()
        : price_usd(0.0)
        , change_24h(0.0)
        , volume_24h(0)
        , last_update(0)
    {}
};

// Market data
struct MarketData {
    std::string pool_id;
    double price;
    double price_change_24h;
    double volume_24h;
    double tvl;
    double apy;
    
    MarketData()
        : price(0.0)
        , price_change_24h(0.0)
        , volume_24h(0.0)
        , tvl(0.0)
        , apy(0.0)
    {}
};

// Uniswap V2 pricing
class UniswapV2Pricing {
public:
    // Get amount out given amount in
    static uint64_t get_amount_out(uint64_t amount_in, uint64_t reserve_in, uint64_t reserve_out, double fee_rate) {
        if (amount_in == 0 || reserve_in == 0 || reserve_out == 0) {
            return 0;
        }
        
        uint64_t amount_in_with_fee = amount_in * static_cast<uint64_t>((1.0 - fee_rate) * 1000);
        uint64_t numerator = amount_in_with_fee * reserve_out;
        uint64_t denominator = reserve_in * 1000 + amount_in_with_fee;
        
        return numerator / denominator;
    }
    
    // Get amount in given amount out
    static uint64_t get_amount_in(uint64_t amount_out, uint64_t reserve_in, uint64_t reserve_out, double fee_rate) {
        if (amount_out == 0 || reserve_in == 0 || reserve_out == 0) {
            return 0;
        }
        
        uint64_t numerator = reserve_in * amount_out * 1000;
        uint64_t denominator = (reserve_out - amount_out) * static_cast<uint64_t>((1.0 - fee_rate) * 1000);
        
        return (numerator / denominator) + 1;
    }
    
    // Get price impact
    static double calculate_price_impact(uint64_t amount_in, uint64_t amount_out, 
                                     uint64_t reserve_in, uint64_t reserve_out) {
        double mid_price = static_cast<double>(reserve_out) / static_cast<double>(reserve_in);
        double exec_price = static_cast<double>(amount_out) / static_cast<double>(amount_in);
        
        return (mid_price - exec_price) / mid_price;
    }
};

// Uniswap V3 pricing
class UniswapV3Pricing {
public:
    // Calculate amount out with V3 formula (simplified)
    static uint64_t get_amount_out(uint64_t amount_in, uint64_t sqrt_price_limit_x96, double fee_rate) {
        if (amount_in == 0 || sqrt_price_limit_x96 == 0) {
            return 0;
        }
        
        // Simplified V3 calculation
        double sqrt_price = sqrt_price_limit_x96 / (1ULL << 96);
        double amount_in_adjusted = amount_in * (1.0 - fee_rate);
        
        // Calculate output (simplified)
        double output = amount_in_adjusted * sqrt_price;
        
        return static_cast<uint64_t>(output);
    }
    
    // Get tick from sqrt price
    static int32_t get_tick_from_sqrt_price(uint64_t sqrt_price_x96) {
        double sqrt_price = sqrt_price_x96 / static_cast<double>(1ULL << 96);
        return static_cast<int32_t>(std::log(sqrt_price) * 2);
    }
    
    // Get sqrt price from tick
    static uint64_t get_sqrt_price_from_tick(int32_t tick) {
        double sqrt_price = std::exp(tick / 2.0);
        return static_cast<uint64_t>(sqrt_price * (1ULL << 96));
    }
};

// Curve pricing
class CurvePricing {
public:
    // Get amount out for stable swap (D = invariant)
    static uint64_t get_amount_out_stable(uint64_t amount_in, uint64_t reserve_in, uint64_t reserve_out,
                                       const std::vector<uint64_t>& reserves, double fee_rate) {
        // Simplified stable swap formula
        if (amount_in == 0 || reserves.empty()) {
            return 0;
        }
        
        // Simplified calculation
        uint64_t total_reserves = 0;
        for (auto r : reserves) {
            total_reserves += r;
        }
        
        uint64_t amount_out = (amount_in * reserve_out) / total_reserves;
        amount_out = amount_out * static_cast<uint64_t>((1.0 - fee_rate) * 1000) / 1000;
        
        return amount_out;
    }
};

// Smart order router
class SmartOrderRouter {
private:
    std::vector<Pool> pools_;
    std::unordered_map<std::string, std::vector<Pool>> token_pools_;
    std::unordered_map<Token, TokenPrice, TokenHash> prices_;
    mutable std::shared_mutex mutex_;
    
    // Graph for routing
    struct GraphNode {
        Token token;
        std::vector<std::pair<Token, double>> edges;  // (Token, best_price)
    };
    
    std::unordered_map<Token, GraphNode, TokenHash> graph_;
    
public:
    // Add pool
    void add_pool(const Pool& pool) {
        std::unique_lock lock(mutex_);
        
        pools_.push_back(pool);
        
        // Add to token pools map
        std::string key_a = pool.token_a.address + "_" + std::to_string(static_cast<int>(pool.chain));
        std::string key_b = pool.token_b.address + "_" + std::to_string(static_cast<int>(pool.chain));
        
        token_pools_[key_a].push_back(pool);
        token_pools_[key_b].push_back(pool);
        
        // Update graph
        graph_[pool.token_a].edges.push_back({pool.token_b, 0});
        graph_[pool.token_b].edges.push_back({pool.token_a, 0});
    }
    
    // Get quote
    QuoteResponse get_quote(const QuoteRequest& request) {
        QuoteResponse response;
        
        // Find best route
        auto route = find_best_route(request.from_token, request.to_token, request.amount_in);
        
        if (route.empty()) {
            return response;
        }
        
        // Execute route
        uint64_t amount = request.amount_in;
        double total_fee = 0;
        double total_gas = 0;
        
        for (size_t i = 0; i < route.size(); ++i) {
            const auto& step = route[i];
            
            // Find pool
            auto pool_opt = find_pool(step.protocol, step.from_token, step.to_token);
            if (!pool_opt.has_value()) {
                continue;
            }
            
            const auto& pool = pool_opt.value();
            
            // Calculate output
            uint64_t output = UniswapV2Pricing::get_amount_out(
                amount, pool.reserve_a, pool.reserve_b, pool.fee_rate
            );
            
            // Update route step
            RouteStep executed_step = step;
            executed_step.amount_out = output;
            response.route.push_back(executed_step);
            
            total_fee += pool.fee_rate;
            total_gas += 150000;  // Estimated gas per swap
            
            amount = output;
        }
        
        response.amount_out = amount;
        response.total_fee = static_cast<uint64_t>(total_fee * request.amount_in);
        response.total_gas = static_cast<uint64_t>(total_gas);
        response.timestamp = std::chrono::system_clock::now().time_since_epoch().count();
        response.expires_at = response.timestamp + 30000;  // 30 seconds
        
        return response;
    }
    
    // Find best route using Dijkstra
    std::vector<RouteStep> find_best_route(const Token& from, const Token& to, uint64_t amount_in) {
        std::vector<RouteStep> route;
        
        // Use A* or Dijkstra
        struct Node {
            Token token;
            uint64_t amount_out;
            double cost;
            std::vector<RouteStep> path;
            
            bool operator<(const Node& other) const {
                return cost > other.cost;  // For min-heap
            }
        };
        
        std::priority_queue<Node> pq;
        
        pq.push({from, amount_in, 0, {}});
        std::set<std::string> visited;
        
        while (!pq.empty()) {
            auto current = pq.top();
            pq.pop();
            
            std::string key = current.token.address + "_" + std::to_string(static_cast<int>(current.token.chain));
            if (visited.count(key)) {
                continue;
            }
            visited.insert(key);
            
            if (current.token == to) {
                return current.path;
            }
            
            // Find adjacent pools
            std::string pool_key = key;
            auto it = token_pools_.find(pool_key);
            if (it == token_pools_.end()) {
                continue;
            }
            
            for (const auto& pool : it->second) {
                Token next_token;
                if (pool.token_a == current.token) {
                    next_token = pool.token_b;
                } else if (pool.token_b == current.token) {
                    next_token = pool.token_a;
                } else {
                    continue;
                }
                
                uint64_t reserve_in = (pool.token_a == current.token) ? pool.reserve_a : pool.reserve_b;
                uint64_t reserve_out = (pool.token_a == current.token) ? pool.reserve_b : pool.reserve_a;
                
                uint64_t output = UniswapV2Pricing::get_amount_out(
                    current.amount_out, reserve_in, reserve_out, pool.fee_rate
                );
                
                // Calculate cost (minimize gas + price impact)
                double gas_cost = 150000 * 20;  // Assuming 20 gwei gas
                double price_impact = UniswapV2Pricing::calculate_price_impact(
                    current.amount_out, output, reserve_in, reserve_out
                );
                double cost = gas_cost + price_impact * output * 100;
                
                RouteStep step;
                step.protocol = pool.protocol;
                step.chain = pool.chain;
                step.from_token = current.token;
                step.to_token = next_token;
                step.amount_in = current.amount_out;
                step.amount_out = output;
                step.fee = pool.fee_rate;
                
                auto new_path = current.path;
                new_path.push_back(step);
                
                pq.push({next_token, output, cost, new_path});
            }
        }
        
        return route;
    }
    
    // Find pool
    std::optional<Pool> find_pool(DEXProtocol protocol, const Token& from, const Token& to) const {
        std::shared_lock lock(mutex_);
        
        for (const auto& pool : pools_) {
            if (pool.protocol == protocol) {
                if ((pool.token_a == from && pool.token_b == to) ||
                    (pool.token_a == to && pool.token_b == from)) {
                    return pool;
                }
            }
        }
        
        return std::nullopt;
    }
    
    // Update token prices
    void update_prices(const std::unordered_map<Token, TokenPrice, TokenHash>& prices) {
        std::unique_lock lock(mutex_);
        prices_ = prices;
    }
};

// DEX Aggregator
class DEXAggregator {
private:
    std::unique_ptr<SmartOrderRouter> router_;
    
    // DEX API clients
    struct DEXClient {
        DEXProtocol protocol;
        std::string api_endpoint;
        std::string subgraph;
        bool is_available;
        double reliability_score;
        
        DEXClient() : is_available(true), reliability_score(1.0) {}
    };
    
    std::unordered_map<DEXProtocol, DEXClient> dex_clients_;
    std::atomic<bool> running_{false};
    
    // Price cache
    struct CachedPrice {
        double price;
        uint64_t timestamp;
    };
    
    std::unordered_map<std::string, CachedPrice> price_cache_;
    mutable std::shared_mutex cache_mutex_;
    
public:
    DEXAggregator() {
        router_ = std::make_unique<SmartOrderRouter>();
        
        // Initialize DEX clients
        initialize_dex_clients();
    }
    
    // Initialize DEX clients
    void initialize_dex_clients() {
        dex_clients_[DEXProtocol::UNISWAP_V2] = {"UNISWAP_V2", "https://api.uniswap.org", "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2", true, 1.0};
        dex_clients_[DEXProtocol::UNISWAP_V3] = {"UNISWAP_V3", "https://api.uniswap.org", "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3", true, 1.0};
        dex_clients_[DEXProtocol::SUSHISWAP] = {"SUSHISWAP", "https://api.sushi.com", "https://api.thegraph.com/subgraphs/name/sushi-v3/v3-arbitrum-one", true, 0.95};
        dex_clients_[DEXProtocol::CURVE] = {"CURVE", "https://api.curve.fi", "https://api.curve.fi/subgraphs/name/curve", true, 0.98};
        dex_clients_[DEXProtocol::BALANCER] = {"BALANCER", "https://api.balancer.fi", "https://api.thegraph.com/subgraphs/name/balancer-v2/balancer", true, 0.95};
        dex_clients_[DEXProtocol::PANCAKESWAP] = {"PANCAKESWAP", "https://api.pancakeswap.finance", "https://api.pancakeswap.finance/subgraphs/v1/bsc", true, 0.9};
        dex_clients_[DEXProtocol::QUICKSWAP] = {"QUICKSWAP", "https://api.quickswap.exchange", "https://api.thegraph.com/subgraphs/name/quickswap/quickswap", true, 0.85};
        dex_clients_[DEXProtocol::SPIRITSWAP] = {"SPIRITSWAP", "https://api.spiritswap.finance", "https://api.thegraph.com/subgraphs/name/spiritswap/spiritswap", true, 0.8};
        dex_clients_[DEXProtocol::TRADERJOE] = {"TRADERJOE", "https://api.traderjo.exchange", "https://api.thegraph.com/subgraphs/name/traderjoe/v1-avalanch", true, 0.85};
        dex_clients_[DEXProtocol::RAYDIUM] = {"RAYDIUM", "https://api.raydium.io", "https://api.raydium.io/graphql", true, 0.9};
        dex_clients_[DEXProtocol::ORCA] = {"ORCA", "https://api.orca.so", "https://api.orca.so/graphql", true, 0.85};
        dex_clients_[DEXProtocol::SOLANA] = {"SOLANA", "https://api.solana.com", "", true, 0.9};
    }
    
    // Add pool
    void add_pool(const Pool& pool) {
        router_->add_pool(pool);
    }
    
    // Get quote
    QuoteResponse get_quote(const QuoteRequest& request) {
        // Check cache first
        std::string cache_key = request.from_token.symbol + "_" + request.to_token.symbol + "_" + std::to_string(request.amount_in);
        
        {
            std::shared_lock lock(cache_mutex_);
            auto it = price_cache_.find(cache_key);
            if (it != price_cache_.end()) {
                auto age = std::chrono::system_clock::now().time_since_epoch().count() - it->second.timestamp;
                if (age < 5000) {  // 5 seconds cache
                    // Return cached quote
                    QuoteResponse cached_response;
                    // (would populate from cache)
                    return cached_response;
                }
            }
        }
        
        // Get fresh quote
        auto response = router_->get_quote(request);
        
        // Cache result
        {
            std::unique_lock lock(cache_mutex_);
            price_cache_[cache_key] = {response.execution_price, response.timestamp};
        }
        
        return response;
    }
    
    // Get multi-DEX quote
    std::vector<QuoteResponse> get_multi_dex_quote(const QuoteRequest& request) {
        std::vector<QuoteResponse> responses;
        
        // Get quote from each DEX
        for (auto& [protocol, client] : dex_clients_) {
            if (!client.is_available) continue;
            
            QuoteRequest dex_request = request;
            dex_request.force_dex = true;
            dex_request.preferred_dex = protocol;
            
            auto response = get_quote(dex_request);
            if (response.amount_out > 0) {
                responses.push_back(response);
            }
        }
        
        // Sort by amount out
        std::sort(responses.begin(), responses.end(), 
            [](const QuoteResponse& a, const QuoteResponse& b) {
                return a.amount_out > b.amount_out;
            });
        
        return responses;
    }
    
    // Build swap transaction
    SwapTransaction build_swap_transaction(const QuoteResponse& quote, uint64_t user_address) {
        SwapTransaction tx;
        
        tx.from_token = quote.route[0].from_token;
        tx.to_token = quote.route.back().to_token;
        tx.amount_in = quote.route[0].amount_in;
        tx.min_amount_out = quote.amount_out * 99 / 100;  // 1% slippage protection
        tx.route = quote.route;
        tx.gas_limit = quote.total_gas;
        tx.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        tx.deadline = tx.created_at + 1800;  // 30 minutes
        
        // Build transaction data per DEX
        for (const auto& step : quote.route) {
            switch (step.protocol) {
                case DEXProtocol::UNISWAP_V2:
                    tx.data = build_uniswap_v2_data(step);
                    tx.to = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";  // Router
                    break;
                    
                case DEXProtocol::UNISWAP_V3:
                    tx.data = build_uniswap_v3_data(step);
                    tx.to = "0xE592427A0AEce92De3E94f1c4D0bA86A82cE8d3a2";  // Router
                    break;
                    
                case DEXProtocol::SUSHISWAP:
                    tx.data = build_sushiswap_data(step);
                    tx.to = "0xd9e1ce17f264c7945c6f7a8b3a7d2be6a5ed1b7a";  // Router
                    break;
                    
                case DEXProtocol::CURVE:
                    tx.data = build_curve_data(step);
                    tx.to = "0x99a58482e019d4b8b1dd5c2fe2b72c93f3c3c2a7";  // Curve swap
                    break;
                    
                default:
                    // Generic encoding
                    tx.data = build_generic_data(step);
                    tx.to = "";
            }
        }
        
        return tx;
    }
    
    // Execute swap (would call blockchain)
    std::string execute_swap(const SwapTransaction& tx) {
        // In production, would broadcast to blockchain
        return "0x" + std::string(64, '0');  // Return fake tx hash
    }
    
    // Get best price across DEXes
    double get_best_price(const Token& from, const Token& to) {
        QuoteRequest request;
        request.from_token = from;
        request.to_token = to;
        request.amount_in = 1000000000;  // 1 token
        
        auto quotes = get_multi_dex_quote(request);
        
        if (quotes.empty()) return 0;
        
        return quotes[0].execution_price;
    }
    
    // Get gas estimates
    std::unordered_map<DEXProtocol, uint64_t> get_gas_estimates() {
        std::unordered_map<DEXProtocol, uint64_t> estimates;
        
        estimates[DEXProtocol::UNISWAP_V2] = 150000;
        estimates[DEXProtocol::UNISWAP_V3] = 120000;
        estimates[DEXProtocol::SUSHISWAP] = 180000;
        estimates[DEXProtocol::CURVE] = 200000;
        estimates[DEXProtocol::BALANCER] = 150000;
        estimates[DEXProtocol::PANCAKESWAP] = 150000;
        estimates[DEXProtocol::QUICKSWAP] = 150000;
        estimates[DEXProtocol::RAYDIUM] = 10000;
        
        return estimates;
    }
    
    // Get DEX status
    std::map<DEXProtocol, bool> get_dex_status() {
        std::map<DEXProtocol, bool> status;
        
        for (auto& [protocol, client] : dex_clients_) {
            status[protocol] = client.is_available;
        }
        
        return status;
    }
    
    // Check and update DEX availability
    void check_dex_availability() {
        for (auto& [protocol, client] : dex_clients_) {
            // Would ping each DEX API
            // For now, assume available
            client.is_available = true;
        }
    }
    
private:
    // Build Uniswap V2 swap data
    std::string build_uniswap_v2_data(const RouteStep& step) {
        // Simplified - would encode proper calldata
        std::string data = "0x22b0e291";  // swapExactETHForTokens selector
        return data;
    }
    
    // Build Uniswap V3 swap data
    std::string build_uniswap_v3_data(const RouteStep& step) {
        std::string data = "0x0d66e189";  // exactInput selector
        return data;
    }
    
    // Build SushiSwap swap data
    std::string build_sushiswap_data(const RouteStep& step) {
        std::string data = "0x18cbafe5";  // swapExactTokensForTokens
        return data;
    }
    
    // Build Curve swap data
    std::string build_curve_data(const RouteStep& step) {
        std::string data = "0x5b60e651";  // exchange selector
        return data;
    }
    
    // Build generic swap data
    std::string build_generic_data(const RouteStep& step) {
        return "";
    }
};

} // namespace dex
} // namespace tigerex

#endif // TIGEREX_DEX_AGGREGATOR_HPP