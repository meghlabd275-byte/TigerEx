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

struct RouteStep;

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
enum class ChainId : uint32_t {
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
        , gas_price(0)
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

// Fixed-point denominator for fee arithmetic. Using 1e6 keeps more fee-rate
// precision than the canonical 1e3 constant, which silently truncates rates
// finer than 0.1%.
constexpr uint64_t kFeeDenominator = 1000000;

// Uniswap V2 pricing (constant product x*y=k)
class UniswapV2Pricing {
public:
    // Get amount out given amount in
    static uint64_t get_amount_out(uint64_t amount_in, uint64_t reserve_in,
                                   uint64_t reserve_out, double fee_rate) {
        if (amount_in == 0 || reserve_in == 0 || reserve_out == 0) {
            return 0;
        }
        if (!std::isfinite(fee_rate) || fee_rate < 0.0 || fee_rate >= 1.0) {
            return 0;
        }

        uint64_t fee_factor = static_cast<uint64_t>((1.0 - fee_rate) * kFeeDenominator);
        uint64_t amount_in_with_fee = amount_in * fee_factor;
        uint64_t numerator = amount_in_with_fee * reserve_out;
        uint64_t denominator = reserve_in * kFeeDenominator + amount_in_with_fee;

        if (denominator == 0) {
            return 0;
        }

        return numerator / denominator;
    }

    // Get amount in required for a desired amount out
    static uint64_t get_amount_in(uint64_t amount_out, uint64_t reserve_in,
                                  uint64_t reserve_out, double fee_rate) {
        if (amount_out == 0 || reserve_in == 0 || reserve_out == 0) {
            return 0;
        }
        if (!std::isfinite(fee_rate) || fee_rate < 0.0 || fee_rate >= 1.0) {
            return 0;
        }
        // The pool cannot pay out its entire reserve.
        if (amount_out >= reserve_out) {
            return 0;
        }

        uint64_t fee_factor = static_cast<uint64_t>((1.0 - fee_rate) * kFeeDenominator);
        if (fee_factor == 0) {
            return 0;
        }

        unsigned __int128 numerator =
            static_cast<unsigned __int128>(reserve_in) * amount_out * kFeeDenominator;
        unsigned __int128 denominator =
            static_cast<unsigned __int128>(reserve_out - amount_out) * fee_factor;

        return static_cast<uint64_t>(numerator / denominator) + 1;
    }

    // Get price impact as a signed fraction of the mid price.
    static double calculate_price_impact(uint64_t amount_in, uint64_t amount_out,
                                         uint64_t reserve_in, uint64_t reserve_out) {
        if (amount_in == 0 || reserve_in == 0 || reserve_out == 0) {
            return 0.0;
        }

        double mid_price = static_cast<double>(reserve_out) / static_cast<double>(reserve_in);
        if (mid_price <= 0.0) {
            return 0.0;
        }
        double exec_price = static_cast<double>(amount_out) / static_cast<double>(amount_in);

        return (mid_price - exec_price) / mid_price;
    }
};

// Uniswap V3 pricing. Output depends on in-range liquidity and the current pool
// price, so both are required inputs; the previous signature could not express
// a real swap.
class UniswapV3Pricing {
public:
    // Exact input for token0 -> token1 within a single tick range.
    //   sqrtP_next = L * sqrtP / (L + amount_in * sqrtP)
    //   amount_out = L * (sqrtP - sqrtP_next)
    static uint64_t get_amount_out_token0_in(uint64_t amount_in, uint64_t liquidity,
                                             double sqrt_price, double fee_rate) {
        if (amount_in == 0 || liquidity == 0 || sqrt_price <= 0.0) {
            return 0;
        }
        if (!std::isfinite(fee_rate) || fee_rate < 0.0 || fee_rate >= 1.0) {
            return 0;
        }

        double amount_in_after_fee = static_cast<double>(amount_in) * (1.0 - fee_rate);
        double L = static_cast<double>(liquidity);
        double sqrt_next = L * sqrt_price / (L + amount_in_after_fee * sqrt_price);

        double out = L * (sqrt_price - sqrt_next);
        return out > 0.0 ? static_cast<uint64_t>(out) : 0;
    }

    // Exact input for token1 -> token0 within a single tick range.
    //   sqrtP_next = sqrtP + amount_in / L
    //   amount_out = L * (1/sqrtP - 1/sqrtP_next)
    static uint64_t get_amount_out_token1_in(uint64_t amount_in, uint64_t liquidity,
                                             double sqrt_price, double fee_rate) {
        if (amount_in == 0 || liquidity == 0 || sqrt_price <= 0.0) {
            return 0;
        }
        if (!std::isfinite(fee_rate) || fee_rate < 0.0 || fee_rate >= 1.0) {
            return 0;
        }

        double amount_in_after_fee = static_cast<double>(amount_in) * (1.0 - fee_rate);
        double L = static_cast<double>(liquidity);
        double sqrt_next = sqrt_price + amount_in_after_fee / L;

        double out = L * (1.0 / sqrt_price - 1.0 / sqrt_next);
        return out > 0.0 ? static_cast<uint64_t>(out) : 0;
    }

    // Tick for a given sqrt price (Q64.96).
    static int32_t get_tick_from_sqrt_price(uint64_t sqrt_price_x96) {
        if (sqrt_price_x96 == 0) {
            return 0;
        }
        double sqrt_price = static_cast<double>(sqrt_price_x96) / static_cast<double>(1ULL << 96);
        if (sqrt_price <= 0.0) {
            return 0;
        }
        return static_cast<int32_t>(std::log(sqrt_price) / std::log(std::sqrt(1.0001)));
    }

    // Sqrt price (Q64.96) for a given tick.
    static uint64_t get_sqrt_price_from_tick(int32_t tick) {
        double sqrt_price = std::pow(1.0001, static_cast<double>(tick) / 2.0);
        return static_cast<uint64_t>(sqrt_price * static_cast<double>(1ULL << 96));
    }
};

// Curve StableSwap pricing (invariant D over an n-coin pool).
class CurvePricing {
public:
    // Compute D via Newton's method from the pool balances.
    static double compute_invariant(const std::vector<uint64_t>& balances, int64_t amplification) {
        size_t n = balances.size();
        if (n == 0) {
            return 0.0;
        }

        double sum = 0.0;
        for (auto b : balances) {
            sum += static_cast<double>(b);
        }
        if (sum == 0.0) {
            return 0.0;
        }

        double ann = static_cast<double>(amplification) * static_cast<double>(n);
        double d = sum;

        for (int i = 0; i < 255; ++i) {
            double d_product = d;
            double s = 0.0;
            for (auto b : balances) {
                double bal = static_cast<double>(b);
                d_product = d_product * d / (bal * static_cast<double>(n));
                s += bal;
            }

            double d_prev = d;
            // d = (Ann*S + n*Dp) * D / ((Ann-1)*D + (n+1)*Dp)
            d = (ann * sum + static_cast<double>(n) * d_product) * d /
                ((ann - 1.0) * d + static_cast<double>(n + 1) * d_product);

            if (std::abs(d - d_prev) <= 1.0) {
                return d;
            }
        }

        return d;
    }

    // Solve for the new balance of the output coin after depositing `amount_in`
    // into coin `index_in`, using the StableSwap invariant.
    static double compute_y(const std::vector<uint64_t>& balances, int64_t amplification,
                            size_t index_in, size_t index_out, double new_in_balance) {
        size_t n = balances.size();
        if (n == 0 || index_in >= n || index_out >= n || index_in == index_out) {
            return 0.0;
        }

        double d = compute_invariant(balances, amplification);
        if (d <= 0.0) {
            return 0.0;
        }

        double ann = static_cast<double>(amplification) * static_cast<double>(n);
        double s = new_in_balance;
        double c = d;
        for (size_t i = 0; i < n; ++i) {
            if (i == index_out) continue;
            double bal = (i == index_in) ? new_in_balance : static_cast<double>(balances[i]);
            s += bal;
            c = c * d / (bal * static_cast<double>(n));
        }
        c = c * d / (ann * static_cast<double>(n));

        double b = s + d / ann;
        double y = d;
        for (int i = 0; i < 255; ++i) {
            double y_prev = y;
            y = (y * y + c) / (2.0 * y + b - d);
            if (std::abs(y - y_prev) <= 1.0) {
                return y;
            }
        }

        return y;
    }

    // Amount out for a swap between two coins of a stable pool.
    static uint64_t get_amount_out_stable(uint64_t amount_in, size_t index_in, size_t index_out,
                                          const std::vector<uint64_t>& balances, double fee_rate) {
        if (amount_in == 0 || balances.size() < 2) {
            return 0;
        }
        if (index_in >= balances.size() || index_out >= balances.size() || index_in == index_out) {
            return 0;
        }
        if (!std::isfinite(fee_rate) || fee_rate < 0.0 || fee_rate >= 1.0) {
            return 0;
        }

        // Curve's A parameter is scaled by n^n * 100 in the canonical contracts.
        int64_t amplification = 100;
        double new_in_balance = static_cast<double>(balances[index_in]) +
                                static_cast<double>(amount_in) * (1.0 - fee_rate);
        double y = compute_y(balances, amplification, index_in, index_out, new_in_balance);

        double balance_out = static_cast<double>(balances[index_out]);
        if (y >= balance_out) {
            return 0;
        }

        return static_cast<uint64_t>(balance_out - y);
    }
};

// Smart order router. Routes on realised output amount computed from the
// registered pool state; it holds no assumed gas price and no placeholder graph.
class SmartOrderRouter {
public:
    // Reports gas units for a protocol. Supplied by the deployment so the router
    // never invents a gas cost.
    using GasEstimator = std::function<std::optional<uint64_t>(DEXProtocol)>;

private:
    std::vector<Pool> pools_;
    std::unordered_map<std::string, std::vector<size_t>> token_pools_;
    mutable std::shared_mutex mutex_;
    GasEstimator gas_estimator_;

    static std::string token_key(const Token& token) {
        return token.address + "_" + std::to_string(static_cast<uint32_t>(token.chain));
    }

public:
    void set_gas_estimator(GasEstimator estimator) { gas_estimator_ = std::move(estimator); }

    // Add pool
    void add_pool(const Pool& pool) {
        std::unique_lock lock(mutex_);

        size_t index = pools_.size();
        pools_.push_back(pool);

        token_pools_[token_key(pool.token_a)].push_back(index);
        token_pools_[token_key(pool.token_b)].push_back(index);
    }

    // Quote the best route for a request. The quote is empty when no pool can
    // connect the two tokens.
    QuoteResponse get_quote(const QuoteRequest& request) {
        std::shared_lock lock(mutex_);

        QuoteResponse response;

        if (request.amount_in == 0) {
            return response;
        }

        auto route = find_best_route_locked(request.from_token, request.to_token, request.amount_in);
        if (route.empty()) {
            return response;
        }

        // The route already carries the realised output of each hop; the final
        // hop's output is the quote amount.
        uint64_t amount = route.back().amount_out;
        if (amount == 0) {
            return response;
        }

        response.route = route;
        response.amount_out = amount;
        response.execution_price = static_cast<double>(amount) /
                                   static_cast<double>(request.amount_in);

        // Aggregate fee paid across hops, denominated in the input token.
        double fee_fraction = 0.0;
        uint64_t hop_in = request.amount_in;
        uint64_t total_fee = 0;
        for (const auto& step : route) {
            total_fee += static_cast<uint64_t>(static_cast<double>(hop_in) * step.fee);
            hop_in = step.amount_out;
            fee_fraction += step.fee;
        }
        response.total_fee = total_fee;

        if (gas_estimator_) {
            uint64_t total_gas = 0;
            bool have_all = true;
            for (const auto& step : route) {
                auto gas = gas_estimator_(step.protocol);
                if (!gas.has_value()) {
                    have_all = false;
                    break;
                }
                total_gas += *gas;
            }
            if (have_all) {
                response.total_gas = total_gas;
                response.gas_estimate = total_gas;
            }
        }

        // Price impact is measured against the pool mid price on the first hop.
        const auto& first = route.front();
        for (const auto& pool : pools_) {
            if (pool.protocol != first.protocol) continue;
            if (!((pool.token_a == first.from_token && pool.token_b == first.to_token) ||
                  (pool.token_b == first.from_token && pool.token_a == first.to_token))) {
                continue;
            }
            uint64_t reserve_in = (pool.token_a == first.from_token) ? pool.reserve_a : pool.reserve_b;
            uint64_t reserve_out = (pool.token_a == first.from_token) ? pool.reserve_b : pool.reserve_a;
            response.price_impact = UniswapV2Pricing::calculate_price_impact(
                first.amount_in, first.amount_out, reserve_in, reserve_out);
            break;
        }

        response.timestamp = static_cast<uint64_t>(
            std::chrono::system_clock::now().time_since_epoch().count());
        response.expires_at = response.timestamp + 30000;

        return response;
    }

    // Find best route by maximising output. A best-first search keyed on the
    // realised output of each partial route; the first time the destination is
    // reached the route is optimal because every hop is monotonically
    // decreasing in output.
    std::vector<RouteStep> find_best_route(const Token& from, const Token& to, uint64_t amount_in) {
        std::shared_lock lock(mutex_);
        return find_best_route_locked(from, to, amount_in);
    }

    // Find pool by protocol and token pair (first match).
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

private:
    struct RouteNode {
        Token token;
        uint64_t amount_out;
        std::vector<RouteStep> path;

        // std::priority_queue is a max-heap by default; compare so the node with
        // the largest output comes first.
        bool operator<(const RouteNode& other) const {
            return amount_out < other.amount_out;
        }
    };

    // Output of a single hop, using the pricing model that matches the pool.
    static uint64_t hop_output(const Pool& pool, const Token& from_token,
                               uint64_t amount_in, uint64_t reserve_in, uint64_t reserve_out) {
        if (amount_in == 0 || reserve_in == 0 || reserve_out == 0) {
            return 0;
        }

        if (pool.is_stable) {
            // Stable pools are priced by the StableSwap invariant. The coin order
            // must match the pool's declaration.
            size_t index_in = (pool.token_a == from_token) ? 0 : 1;
            size_t index_out = 1 - index_in;
            std::vector<uint64_t> balances = {pool.reserve_a, pool.reserve_b};
            return CurvePricing::get_amount_out_stable(
                amount_in, index_in, index_out, balances, pool.fee_rate);
        }

        return UniswapV2Pricing::get_amount_out(amount_in, reserve_in, reserve_out, pool.fee_rate);
    }

    std::vector<RouteStep> find_best_route_locked(const Token& from, const Token& to,
                                                  uint64_t amount_in) {
        std::vector<RouteStep> empty;

        if (from == to || amount_in == 0) {
            return empty;
        }

        std::priority_queue<RouteNode> queue;
        queue.push({from, amount_in, {}});

        // Track the best output seen per token so a worse route to the same token
        // is not expanded.
        std::unordered_map<std::string, uint64_t> best_output;
        best_output[token_key(from)] = amount_in;

        while (!queue.empty()) {
            RouteNode current = queue.top();
            queue.pop();

            if (current.token == to) {
                return current.path;
            }

            auto known = best_output.find(token_key(current.token));
            if (known != best_output.end() && current.amount_out < known->second) {
                continue;
            }

            auto it = token_pools_.find(token_key(current.token));
            if (it == token_pools_.end()) {
                continue;
            }

            for (size_t pool_index : it->second) {
                const Pool& pool = pools_[pool_index];

                Token next_token;
                uint64_t reserve_in;
                uint64_t reserve_out;
                if (pool.token_a == current.token) {
                    next_token = pool.token_b;
                    reserve_in = pool.reserve_a;
                    reserve_out = pool.reserve_b;
                } else if (pool.token_b == current.token) {
                    next_token = pool.token_a;
                    reserve_in = pool.reserve_b;
                    reserve_out = pool.reserve_a;
                } else {
                    continue;
                }

                uint64_t output = hop_output(pool, current.token, current.amount_out,
                                             reserve_in, reserve_out);
                if (output == 0) {
                    continue;
                }

                auto seen = best_output.find(token_key(next_token));
                if (seen != best_output.end() && output <= seen->second) {
                    continue;
                }
                best_output[token_key(next_token)] = output;

                RouteStep step;
                step.protocol = pool.protocol;
                step.chain = pool.chain;
                step.from_token = current.token;
                step.to_token = next_token;
                step.amount_in = current.amount_out;
                step.amount_out = output;
                step.pool_index = pool_index;
                step.fee = pool.fee_rate;

                auto new_path = current.path;
                new_path.push_back(step);

                queue.push({next_token, output, new_path});
            }
        }

        return empty;
    }
};

// DEX Aggregator. Routing is performed over pools the operator registers from
// on-chain state. The aggregator holds no third-party endpoints, no invented
// reliability scores, and no hardcoded router addresses: swap calldata is
// produced by an injected encoder, and broadcasting by an injected submitter.
class DEXAggregator {
public:
    // Encodes a route step into target-contract calldata. Supplied by the
    // deployment so the aggregator carries no baked-in ABI constants.
    using CalldataEncoder = std::function<std::optional<std::pair<std::string, std::string>>(
        const RouteStep&)>;

    // Broadcasts a signed transaction and returns the transaction hash.
    using TransactionSubmitter = std::function<std::optional<std::string>(const SwapTransaction&)>;

private:
    std::unique_ptr<SmartOrderRouter> router_;

    // A DEX becomes routable only once its pools have been registered.
    struct DEXClient {
        DEXProtocol protocol;
        bool is_available;
        double reliability_score;

        DEXClient() : protocol(DEXProtocol::UNISWAP_V2), is_available(false), reliability_score(0.0) {}
    };

    std::unordered_map<DEXProtocol, DEXClient> dex_clients_;
    std::atomic<bool> running_{false};

    // Cache entry keeps the whole quote so a hit can be returned unchanged.
    struct CachedPrice {
        double price;
        uint64_t timestamp;
        QuoteResponse response;
    };

    std::unordered_map<std::string, CachedPrice> price_cache_;
    mutable std::shared_mutex cache_mutex_;

    CalldataEncoder calldata_encoder_;
    TransactionSubmitter submitter_;

public:
    DEXAggregator() {
        router_ = std::make_unique<SmartOrderRouter>();
        // The router reads gas units from this aggregator's observed table, so a
        // protocol with no recorded estimate contributes no gas figure.
        router_->set_gas_estimator([this](DEXProtocol protocol) {
            return get_gas_estimate(protocol);
        });
    }

    // Register a DEX as routable with an operator-supplied reliability score.
    void register_dex(DEXProtocol protocol, double reliability_score) {
        DEXClient client;
        client.protocol = protocol;
        client.is_available = true;
        client.reliability_score = reliability_score;
        dex_clients_[protocol] = client;
    }

    // Reflect an observed availability change.
    void set_dex_available(DEXProtocol protocol, bool available) {
        dex_clients_[protocol].is_available = available;
    }

    void set_calldata_encoder(CalldataEncoder encoder) { calldata_encoder_ = std::move(encoder); }
    void set_transaction_submitter(TransactionSubmitter submitter) { submitter_ = std::move(submitter); }

    void add_pool(const Pool& pool) { router_->add_pool(pool); }

    // Get quote
    QuoteResponse get_quote(const QuoteRequest& request) {
        std::string cache_key = request.from_token.symbol + "_" + request.to_token.symbol + "_" +
                                std::to_string(request.amount_in);

        {
            std::shared_lock lock(cache_mutex_);
            auto it = price_cache_.find(cache_key);
            if (it != price_cache_.end()) {
                auto now = static_cast<uint64_t>(
                    std::chrono::system_clock::now().time_since_epoch().count());
                if (now < it->second.timestamp + 5000) {
                    return it->second.response;
                }
            }
        }

        auto response = router_->get_quote(request);

        if (response.amount_out > 0) {
            std::unique_lock lock(cache_mutex_);
            price_cache_[cache_key] = {response.execution_price, response.timestamp, response};
        }

        return response;
    }

    // Get multi-DEX quote
    std::vector<QuoteResponse> get_multi_dex_quote(const QuoteRequest& request) {
        std::vector<QuoteResponse> responses;

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

        std::sort(responses.begin(), responses.end(),
            [](const QuoteResponse& a, const QuoteResponse& b) {
                return a.amount_out > b.amount_out;
            });

        return responses;
    }

    // Build a swap transaction from a quote. Returns no value when there is no
    // route or no calldata encoder, rather than fabricating calldata.
    std::optional<SwapTransaction> build_swap_transaction(const QuoteResponse& quote, uint64_t user_address) {
        if (quote.route.empty()) {
            return std::nullopt;
        }

        SwapTransaction tx;
        tx.from_token = quote.route.front().from_token;
        tx.to_token = quote.route.back().to_token;
        tx.amount_in = quote.route.front().amount_in;
        tx.min_amount_out = quote.amount_out * 99 / 100;  // 1% slippage protection
        tx.route = quote.route;
        tx.gas_limit = quote.total_gas;
        tx.created_at = static_cast<uint64_t>(
            std::chrono::system_clock::now().time_since_epoch().count());
        tx.deadline = tx.created_at + 1800;

        // A multi-step route cannot be represented by a single (to, data) pair;
        // require a single-step route so the encoder output is unambiguous.
        if (quote.route.size() != 1) {
            return std::nullopt;
        }

        if (!calldata_encoder_) {
            return std::nullopt;
        }

        auto encoded = calldata_encoder_(quote.route.front());
        if (!encoded.has_value()) {
            return std::nullopt;
        }

        tx.to = encoded->first;
        tx.data = encoded->second;
        tx.value = 0;

        return tx;
    }

    // Broadcast a swap. Fails closed until a submitter is injected, so a caller
    // can never mistake a fabricated hash for settlement.
    std::optional<std::string> execute_swap(const SwapTransaction& tx) {
        if (!submitter_) {
            return std::nullopt;
        }
        return submitter_(tx);
    }

    // Get best price across registered DEXes
    double get_best_price(const Token& from, const Token& to, uint64_t amount_in) {
        QuoteRequest request;
        request.from_token = from;
        request.to_token = to;
        request.amount_in = amount_in;

        auto quotes = get_multi_dex_quote(request);

        if (quotes.empty()) return 0.0;

        return quotes.front().execution_price;
    }

    // Gas estimates are observed per chain and injected, not hardcoded.
    void update_gas_estimate(DEXProtocol protocol, uint64_t gas_units) {
        gas_estimates_[protocol] = gas_units;
    }

    std::optional<uint64_t> get_gas_estimate(DEXProtocol protocol) const {
        auto it = gas_estimates_.find(protocol);
        if (it == gas_estimates_.end()) {
            return std::nullopt;
        }
        return it->second;
    }

    std::map<DEXProtocol, bool> get_dex_status() const {
        std::map<DEXProtocol, bool> status;
        for (const auto& [protocol, client] : dex_clients_) {
            status[protocol] = client.is_available;
        }
        return status;
    }

private:
    std::unordered_map<DEXProtocol, uint64_t> gas_estimates_;
};

} // namespace dex
} // namespace tigerex

#endif // TIGEREX_DEX_AGGREGATOR_HPP