/**
 * TigerEx Futures Options Trading Engine
 * Complete options trading system with Greeks, pricing models, exercise/settlement
 * Supports American, European, and Bermudan options
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_OPTIONS_ENGINE_HPP
#define TIGEREX_OPTIONS_ENGINE_HPP

#include <cmath>
#include <complex>
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
#include <variant>

namespace tigerex {
namespace options {

// Option type
enum class OptionType : uint8_t {
    CALL = 0,
    PUT = 1
};

// Option style
enum class OptionStyle : uint8_t {
    EUROPEAN = 0,   // Can exercise only at expiry
    AMERICAN = 1,  // Can exercise any time before expiry
    BERMUDA = 2     // Can exercise on specific dates
};

// Option category
enum class OptionCategory : uint8_t {
    VANILLA = 0,
    BINARY = 1,        // Digital options
    BARRIER = 2,        // Barrier options
    ASIAN = 3,          // Average price options
    LOOKBACK = 4,       // Lookback options
    COMPOUND = 5,       // Options on options
    PERPETUAL = 6       // Never expire
};

// Exercise method
enum class ExerciseMethod : uint8_t {
    PHYSICAL = 0,      // Physical delivery
    CASH = 1,          // Cash settlement
    NETTING = 2          // Netting
};

// Position side
enum class PositionSide : uint8_t {
    LONG = 0,
    SHORT = 1
};

// Position status
enum class PositionStatus : uint8_t {
    OPEN = 0,
    EXERCISED = 1,
    EXPIRED = 2,
    CANCELLED = 3,
    SETTLED = 4
};

// Order status
enum class OrderStatus : uint8_t {
    PENDING = 0,
    NEW = 1,
    FILLED = 2,
    PARTIALLY_FILLED = 3,
    CANCELLED = 4,
    REJECTED = 5,
    EXPIRED = 6
};

// Greeks
struct Greeks {
    double delta;     // ∂V/∂S - rate of change of option price with respect to underlying price
    double gamma;   // ∂²V/∂S² - rate of change of delta
    double theta;   // ∂V/∂t - time decay (per day)
    double vega;    // ∂V/∂σ - sensitivity to volatility
    double rho;     // ∂V/∂r - sensitivity to interest rate
    double eta;     // ∂V/∂q - dividend yield sensitivity
    double lambda;  // Elasticity - percentage change in option price for 1% change in underlying
    double charm;   // ∂²V/∂S∂t - delta decay
    double vanna;  // ∂²V/∂S∂σ - sensitivity of delta to volatility
    double vomma;  // ∂²V/∂σ² - sensitivity of vega to volatility
    double speed;   // ∂³V/∂S³ - gamma convexity
    double zomma;  // ∂³V/∂S²∂σ - gamma * vega relationship
    double veta;   // ∂³V/∂S∂σ² - vega * vol relationship
    double vera;   // ∂²V/∂r∂σ
    double theta_gamma; // ∂²V/∂t∂S²
    
    Greeks()
        : delta(0), gamma(0), theta(0), vega(0), rho(0), eta(0), lambda(0)
        , charm(0), vanna(0), vomma(0), speed(0), zomma(0), veta(0), vera(0), theta_gamma(0)
    {}
};

// Option contract
struct OptionContract {
    std::string symbol;
    std::string underlying_symbol;
    OptionType type;
    OptionStyle style;
    OptionCategory category;
    
    uint64_t strike_price;
    uint64_t expiry_time;
    uint64_t exercise_dates[10];  // For Bermuda options
    uint32_t exercise_dates_count;
    
    uint64_t contract_size;
    uint64_t min_tick;
    uint64_t max_order_value;
    
    uint64_t maker_fee;
    uint64_t taker_fee;
    
    bool is_active;
    bool is_settled;
    uint64_t settlement_price;
    
    ExerciseMethod exercise_method;
    bool is_auto_exercisable;
    double auto_exercise_threshold;
    
    // Barrier properties (for barrier options)
    double barrier_price;
    double rebate;
    bool is_knock_in;
    bool is_knock_out;
    
    OptionContract()
        : type(OptionType::CALL)
        , style(OptionStyle::EUROPEAN)
        , category(OptionCategory::VANILLA)
        , strike_price(0)
        , expiry_time(0)
        , exercise_dates_count(0)
        , contract_size(1)
        , min_tick(1)
        , max_order_value(0)
        , maker_fee(0)
        , taker_fee(0)
        , is_active(true)
        , is_settled(false)
        , settlement_price(0)
        , exercise_method(ExerciseMethod::CASH)
        , is_auto_exercisable(false)
        , auto_exercise_threshold(0.0)
        , barrier_price(0.0)
        , rebate(0.0)
        , is_knock_in(false)
        , is_knock_out(false)
    {}
};

// Option position
struct OptionPosition {
    uint64_t position_id;
    uint64_t user_id;
    uint64_t account_id;
    std::string symbol;
    PositionSide side;
    PositionStatus status;

    // Contract terms. A position cannot be repriced or exercised without
    // knowing which contract it is: call or put, at what strike, expiring when.
    OptionType type;
    uint64_t strike_price;
    uint64_t expiry_time;

    uint64_t quantity;
    uint64_t filled_quantity;
    uint64_t average_price;
    uint64_t entry_price;
    uint64_t mark_price;
    
    // Signed: a losing position has a negative PnL, so an unsigned type would
    // wrap a loss into a colossal gain.
    int64_t realized_pnl;
    int64_t unrealized_pnl;

    uint64_t exercise_price;
    uint64_t exercise_time;
    
    uint64_t created_at;
    uint64_t updated_at;
    
    Greeks greeks;
    
    OptionPosition()
        : position_id(0)
        , user_id(0)
        , account_id(0)
        , side(PositionSide::LONG)
        , status(PositionStatus::OPEN)
        , type(OptionType::CALL)
        , strike_price(0)
        , expiry_time(0)
        , quantity(0)
        , filled_quantity(0)
        , average_price(0)
        , entry_price(0)
        , mark_price(0)
        , realized_pnl(0)
        , unrealized_pnl(0)
        , exercise_price(0)
        , exercise_time(0)
        , created_at(0)
        , updated_at(0)
    {}
};

// Option order
struct OptionOrder {
    uint64_t order_id;
    uint64_t user_id;
    uint64_t account_id;
    std::string symbol;
    PositionSide side;
    OrderStatus status;
    
    OptionType type;
    uint64_t strike_price;
    uint64_t quantity;
    uint64_t filled_quantity;
    uint64_t price;
    uint64_t average_fill_price;
    
    uint64_t stop_price;
    uint64_t trigger_price;
    
    uint64_t time_to_expiry;
    bool is_post_only;
    bool is_reduce_only;
    
    uint64_t created_at;
    uint64_t updated_at;
    uint64_t expire_time;
    
    std::string client_order_id;
    
    OptionOrder()
        : order_id(0)
        , user_id(0)
        , account_id(0)
        , side(PositionSide::LONG)
        , status(OrderStatus::PENDING)
        , type(OptionType::CALL)
        , strike_price(0)
        , quantity(0)
        , filled_quantity(0)
        , price(0)
        , average_fill_price(0)
        , stop_price(0)
        , trigger_price(0)
        , time_to_expiry(0)
        , is_post_only(false)
        , is_reduce_only(false)
        , created_at(0)
        , updated_at(0)
        , expire_time(0)
    {}
};

// Option trade
struct OptionTrade {
    uint64_t trade_id;
    uint64_t order_id;
    uint64_t position_id;
    std::string symbol;
    PositionSide side;
    uint64_t price;
    uint64_t quantity;
    uint64_t fee;
    uint64_t fee_deducted;
    uint64_t realized_pnl;
    uint64_t created_at;
    bool is_maker;
};

// Option market data
struct OptionMarketData {
    std::string symbol;
    uint64_t bid_price;
    uint64_t bid_quantity;
    uint64_t ask_price;
    uint64_t ask_quantity;
    uint64_t last_price;
    uint64_t last_quantity;
    uint64_t mark_price;
    uint64_t index_price;
    uint64_t mark_iv;  // Implied volatility
    double delta;
    double gamma;
    double theta;
    double vega;
    uint64_t volume24h;
    uint64_t open_interest;
    uint64_t created_at;
};

// Volatility surface
struct VolatilityPoint {
    double strike;
    double expiry;
    double volatility;
};

struct VolatilitySmile {
    std::string underlying_symbol;
    uint64_t timestamp;
    std::vector<VolatilityPoint> points;
    double base_volatility;
    double risk_reversal_call;
    double risk_reversal_put;
    double butterfly_call;
    double butterfly_put;
    double skew;
};

// Black-Scholes pricing engine
class BlackScholesModel {
public:
    // Standard normal CDF
    static double normal_cdf(double x) {
        return 0.5 * std::erfc(-x / M_SQRT2);
    }
    
    // Standard normal PDF
    static double normal_pdf(double x) {
        return std::exp(-0.5 * x * x) / std::sqrt(2 * M_PI);
    }
    
    // Cumulative normal with adjustment for extreme values
    static double normal_cdf_adjusted(double x) {
        if (x > 6.0) return 1.0;
        if (x < -6.0) return 0.0;
        return normal_cdf(x);
    }
    
    // Calculate d1 and d2
    static void calculate_d1d2(double S, double K, double T, double r, double q, double sigma, double& d1, double& d2) {
        // A non-positive spot or strike makes log(S/K) non-finite, which would
        // propagate NaN through every price and Greek.
        if (!std::isfinite(S) || !std::isfinite(K) || S <= 0.0 || K <= 0.0) {
            d1 = 0.0;
            d2 = 0.0;
            return;
        }

        if (T <= 0 || sigma <= 0) {
            d1 = (S > K) ? 1e10 : -1e10;
            d2 = d1;
            return;
        }
        
        double sqrt_T = std::sqrt(T);
        double log_term = std::log(S / K);
        
        d1 = (log_term + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrt_T);
        d2 = d1 - sigma * sqrt_T;
    }
    
    // Calculate call/put prices
    static double calculate_call_price(double S, double K, double T, double r, double q, double sigma) {
        if (!std::isfinite(S) || !std::isfinite(K) || S <= 0.0 || K <= 0.0) {
            double discount = std::exp(-r * std::max(0.0, T));
            return std::max(0.0, S - K * discount);
        }

        if (T <= 0) {
            return std::max(0.0, S - K);
        }
        
        double d1, d2;
        calculate_d1d2(S, K, T, r, q, sigma, d1, d2);
        
        double discount = std::exp(-r * T);
        double dividend_discount = std::exp(-q * T);
        
        return S * dividend_discount * normal_cdf_adjusted(d1) - K * discount * normal_cdf_adjusted(d2);
    }
    
        static double calculate_put_price(double S, double K, double T, double r, double q, double sigma) {
        if (!std::isfinite(S) || !std::isfinite(K) || S <= 0.0 || K <= 0.0) {
            double discount = std::exp(-r * std::max(0.0, T));
            return std::max(0.0, K * discount - S);
        }

        if (T <= 0) {
            return std::max(0.0, K - S);
        }
        
        double d1, d2;
        calculate_d1d2(S, K, T, r, q, sigma, d1, d2);
        
        double discount = std::exp(-r * T);
        double dividend_discount = std::exp(-q * T);
        
        return K * discount * normal_cdf_adjusted(-d2) - S * dividend_discount * normal_cdf_adjusted(-d1);
    }
    
        // Calculate Greeks
    static Greeks calculate_greeks(double S, double K, double T, double r, double q, double sigma, OptionType type) {
        Greeks g;
        
        if (T <= 0) {
            return g;
        }
        
        double d1, d2;
        calculate_d1d2(S, K, T, r, q, sigma, d1, d2);
        
        double sqrt_T = std::sqrt(T);
        double discount = std::exp(-r * T);
        double dividend_discount = std::exp(-q * T);
        double nd1 = normal_cdf_adjusted(d1);
        double nd2 = normal_cdf_adjusted(d2);
        double n_prime_d1 = normal_pdf(d1);
        
        // Common calculations
        double delta_base = dividend_discount * nd1;
        double gamma_base = dividend_discount * n_prime_d1 / (S * sigma * sqrt_T);
        double vega_base = S * dividend_discount * n_prime_d1 * sqrt_T / 100.0;
        double theta_base = -S * dividend_discount * n_prime_d1 * sigma / (2.0 * sqrt_T);
        
        if (type == OptionType::CALL) {
            // Call delta
            g.delta = delta_base;
            g.rho = K * T * discount * nd2 / 100.0;
            g.theta = theta_base + r * K * discount * nd2 - q * S * dividend_discount * nd1;
            g.theta /= 365.0;  // Per day
        } else {
            // Put delta
            g.delta = delta_base - dividend_discount;
            g.rho = -K * T * discount * normal_cdf_adjusted(-d2) / 100.0;
            g.theta = theta_base - r * K * discount * normal_cdf_adjusted(-d2) + q * S * dividend_discount * normal_cdf_adjusted(-d1);
            g.theta /= 365.0;
        }
        
        // Gamma and vega are the same for both
        g.gamma = gamma_base;
        g.vega = vega_base;
        g.eta = -T * S * dividend_discount * nd1;  // Dividend sensitivity
        
        // Calculate lambda
        double price = (type == OptionType::CALL) ? 
            calculate_call_price(S, K, T, r, q, sigma) :
            calculate_put_price(S, K, T, r, q, sigma);
        
        if (price > 0) {
            g.lambda = g.delta * S / price;
        }
        
        // Higher-order Greeks
        g.charm = dividend_discount * (nd1 - d2 * n_prime_d1 / sqrt_T) * q / S;
        g.vanna = n_prime_d1 * (d1 / sigma - d2 * sqrt_T) / 100.0;
        g.vomma = S * dividend_discount * n_prime_d1 * sqrt_T * (1 - d1 * d2) / 10000.0;
        g.speed = -dividend_discount * n_prime_d1 * (1 + d1 * d2) / (S * S * sigma * sqrt_T);
        g.zomma = gamma_base * g.vega / 100.0;
        
        return g;
    }
};

// Binomial model for American options
class BinomialModel {
private:
    static constexpr uint32_t DEFAULT_STEPS = 100;
    
public:
    // Cox-Ross-Rubinstein binomial
    static double calculate_option_price(
        double S, double K, double T, double r, double q, double sigma,
        OptionType type, OptionStyle style, uint32_t steps = DEFAULT_STEPS
    ) {
        if (steps == 0) steps = DEFAULT_STEPS;
        
        double dt = T / steps;
        double u = std::exp(sigma * std::sqrt(dt));
        double d = 1.0 / u;
        double p = (std::exp((r - q) * dt) - d) / (u - d);
        double discount = std::exp(-r * dt);
        
        // Initialize asset prices at maturity
        std::vector<double> prices(steps + 1);
        for (uint32_t i = 0; i <= steps; ++i) {
            prices[i] = S * std::pow(u, steps - i) * std::pow(d, i);
        }
        
        // Initialize option values at maturity
        std::vector<double> values(steps + 1);
        for (uint32_t i = 0; i <= steps; ++i) {
            if (type == OptionType::CALL) {
                values[i] = std::max(0.0, prices[i] - K);
            } else {
                values[i] = std::max(0.0, K - prices[i]);
            }
        }
        
        // Backward induction. The spot price at node (j, i) is
        // S * u^(j-i) * d^i; the maturity array must not be reused here or the
        // early-exercise test compares against a price from the wrong step.
        for (int32_t j = static_cast<int32_t>(steps) - 1; j >= 0; --j) {
            for (uint32_t i = 0; i <= static_cast<uint32_t>(j); ++i) {
                double node_price = S * std::pow(u, static_cast<double>(j - static_cast<int32_t>(i)))
                                      * std::pow(d, static_cast<double>(i));

                double exercise_value;
                if (type == OptionType::CALL) {
                    exercise_value = std::max(0.0, node_price - K);
                } else {
                    exercise_value = std::max(0.0, K - node_price);
                }

                double hold_value = discount * (p * values[i] + (1 - p) * values[i + 1]);

                if (style == OptionStyle::AMERICAN) {
                    values[i] = std::max(exercise_value, hold_value);
                } else {
                    values[i] = hold_value;
                }
            }
        }

                return values[0];
    }
    
    // Calculate Greeks using binomial. Finite differences on the lattice price
    // keep the Greeks consistent with the American early-exercise premium, which
    // Black-Scholes cannot represent.
    static Greeks calculate_greeks(
        double S, double K, double T, double r, double q, double sigma,
        OptionType type, OptionStyle style = OptionStyle::AMERICAN,
        uint32_t steps = DEFAULT_STEPS
    ) {
        Greeks g;
        if (S <= 0.0 || K <= 0.0 || T <= 0.0 || sigma <= 0.0) {
            return g;
        }

        double price = calculate_option_price(S, K, T, r, q, sigma, type, style, steps);
        double h = S * 1e-3;
        double up = calculate_option_price(S + h, K, T, r, q, sigma, type, style, steps);
        double down = calculate_option_price(S - h, K, T, r, q, sigma, type, style, steps);
        double vol_up = calculate_option_price(S, K, T, r, q, sigma + 1e-4, type, style, steps);
        double rate_up = calculate_option_price(S, K, T, r + 1e-4, q, sigma, type, style, steps);

        g.delta = (up - down) / (2.0 * h);
        g.gamma = (up - 2.0 * price + down) / (h * h);
        g.vega = (vol_up - price) / 100.0;
        g.rho = (rate_up - price) / 100.0;

        double dt = T / 365.0;
        if (T > dt) {
            double theta_shift = calculate_option_price(S, K, T - dt, r, q, sigma, type, style, steps);
            g.theta = (theta_shift - price) / 365.0;
        }

        if (price > 0.0) {
            g.lambda = g.delta * S / price;
        }

        return g;
    }
};

// Monte Carlo pricing engine
class MonteCarloEngine {
private:
    static constexpr uint32_t DEFAULT_PATHS = 100000;
    
public:
    static double calculate_option_price(
        double S, double K, double T, double r, double q, double sigma,
        OptionType type, uint32_t num_paths = DEFAULT_PATHS
    ) {
        std::mt19937_64 rng(std::chrono::system_clock::now().time_since_epoch().count());
        std::normal_distribution<double> dist(0.0, 1.0);
        
        double dt = T;
        double sqrt_dt = std::sqrt(dt);
        double drift = (r - q - 0.5 * sigma * sigma) * dt;
        double vol = sigma * sqrt_dt;
        
        double sum = 0.0;
        
        for (uint32_t i = 0; i < num_paths; ++i) {
            double Z = dist(rng);
            double ST = S * std::exp(drift + vol * Z);
            
            double payoff;
            if (type == OptionType::CALL) {
                payoff = std::max(0.0, ST - K);
            } else {
                payoff = std::max(0.0, K - ST);
            }
            
            sum += payoff;
        }
        
        return std::exp(-r * T) * sum / num_paths;
    }
    
    static Greeks calculate_greeks_with_mc(
        double S, double K, double T, double r, double q, double sigma,
        OptionType type, uint32_t num_paths = DEFAULT_PATHS
    ) {
        Greeks g;
        if (S <= 0.0 || K <= 0.0 || T <= 0.0 || sigma <= 0.0) {
            return g;
        }

        double price = calculate_option_price(S, K, T, r, q, sigma, type, num_paths);
        double h = S * 1e-3;
        double price_up = calculate_option_price(S + h, K, T, r, q, sigma, type, num_paths);
        double price_down = calculate_option_price(S - h, K, T, r, q, sigma, type, num_paths);
        double price_vol_up = calculate_option_price(S, K, T, r, q, sigma + 1e-4, type, num_paths);
        double price_rate_up = calculate_option_price(S, K, T, r + 1e-4, q, sigma, type, num_paths);

        g.delta = (price_up - price_down) / (2.0 * h);
        g.gamma = (price_up - 2.0 * price + price_down) / (h * h);
        g.vega = (price_vol_up - price) / 100.0;
        g.rho = (price_rate_up - price) / 100.0;

        // Theta is the sensitivity to the passage of time, so it is measured by
        // shortening T rather than by dividing the price by T.
        double dt = T / 365.0;
        if (T > dt) {
            double price_time_decay = calculate_option_price(S, K, T - dt, r, q, sigma, type, num_paths);
            g.theta = (price_time_decay - price) / 365.0;
        }

        if (price > 0.0) {
            g.lambda = g.delta * S / price;
        }

        return g;
    }
};

// Implied volatility solver
class ImpliedVolatilitySolver {
public:
    // Solve for the volatility that reproduces an observed market price.
    // Returns std::nullopt when the price is outside the no-arbitrage band
    // (below intrinsic, above the underlying) or when the iteration does not
    // converge, rather than handing back a number that does not fit the price.
    static std::optional<double> calculate_implied_volatility(
        double market_price, double S, double K, double T, double r, double q,
        OptionType type, double initial_guess = 0.3
    ) {
        if (!std::isfinite(market_price) || market_price <= 0.0) return std::nullopt;
        if (!std::isfinite(S) || !std::isfinite(K) || S <= 0.0 || K <= 0.0) return std::nullopt;
        if (!std::isfinite(T) || T <= 0.0) return std::nullopt;

        double discount_K = K * std::exp(-r * T);
        double discount_S = S * std::exp(-q * T);
        double lower_bound = (type == OptionType::CALL)
            ? std::max(0.0, discount_S - discount_K)
            : std::max(0.0, discount_K - discount_S);
        double upper_bound = (type == OptionType::CALL) ? discount_S : discount_K;

        if (market_price < lower_bound || market_price > upper_bound) {
            return std::nullopt;
        }

        double sigma = std::clamp(initial_guess, 0.01, 5.0);
        const double tol = 1e-8;
        const int max_iterations = 100;

        for (int i = 0; i < max_iterations; ++i) {
            double price = (type == OptionType::CALL)
                ? BlackScholesModel::calculate_call_price(S, K, T, r, q, sigma)
                : BlackScholesModel::calculate_put_price(S, K, T, r, q, sigma);

            double diff = market_price - price;
            if (std::abs(diff) < tol) {
                return sigma;
            }

            // vega from calculate_greeks is per 1% vol move, so scale it back to
            // a per-unit-vol sensitivity before using it as the Newton step.
            Greeks g = BlackScholesModel::calculate_greeks(S, K, T, r, q, sigma, type);
            double vega = g.vega * 100.0;

            if (!std::isfinite(vega) || std::abs(vega) < 1e-12) {
                break;
            }

            sigma += diff / vega;

            if (!std::isfinite(sigma)) {
                return std::nullopt;
            }

            sigma = std::clamp(sigma, 0.01, 5.0);
        }

        return std::nullopt;
    }
};

// Option position manager
class PositionManager {
private:
    std::unordered_map<uint64_t, OptionPosition> positions_;
    mutable std::shared_mutex mutex_;
    
public:
    // Open position
    uint64_t open_position(const OptionPosition& position) {
        std::unique_lock lock(mutex_);
        
        uint64_t position_id = position.position_id;
        positions_[position_id] = position;
        
        return position_id;
    }
    
    // Close position
    bool close_position(uint64_t position_id) {
        std::unique_lock lock(mutex_);
        
        auto it = positions_.find(position_id);
        if (it == positions_.end()) {
            return false;
        }
        
        it->second.status = PositionStatus::SETTLED;
        return true;
    }
    
    // Exercise position at the settlement price. P&L is the option's intrinsic
    // value at expiry less the premium paid, signed by the position side: a long
    // call earns max(S-K, 0) per contract, a long put earns max(K-S, 0), and a
    // short position owes the negative of that.
    bool exercise_position(uint64_t position_id, uint64_t settlement_price) {
        std::unique_lock lock(mutex_);
        
        auto it = positions_.find(position_id);
        if (it == positions_.end()) {
            return false;
        }
        
        auto& pos = it->second;
        if (pos.status != PositionStatus::OPEN) {
            return false;
        }
        if (pos.filled_quantity == 0) {
            return false;
        }

        pos.status = PositionStatus::EXERCISED;
        pos.exercise_price = settlement_price;
        pos.exercise_time = std::chrono::system_clock::now().time_since_epoch().count();
        
        int64_t intrinsic = 0;
        if (pos.type == OptionType::CALL) {
            intrinsic = settlement_price > pos.strike_price
                ? static_cast<int64_t>(settlement_price - pos.strike_price) : 0;
        } else {
            intrinsic = pos.strike_price > settlement_price
                ? static_cast<int64_t>(pos.strike_price - settlement_price) : 0;
        }
        
        int64_t gross = intrinsic * static_cast<int64_t>(pos.filled_quantity);
        int64_t premium = static_cast<int64_t>(pos.average_price) *
                          static_cast<int64_t>(pos.filled_quantity);
        pos.realized_pnl = (pos.side == PositionSide::LONG) ? gross - premium : premium - gross;
        
        return true;
    }
    
    // Get position
    std::optional<OptionPosition> get_position(uint64_t position_id) const {
        std::shared_lock lock(mutex_);
        
        auto it = positions_.find(position_id);
        if (it != positions_.end()) {
            return it->second;
        }
        
        return std::nullopt;
    }
    
    // Get user positions
    std::vector<OptionPosition> get_user_positions(uint64_t user_id) const {
        std::shared_lock lock(mutex_);

        std::vector<OptionPosition> result;
        for (const auto& [id, pos] : positions_) {
            if (pos.user_id == user_id && pos.status == PositionStatus::OPEN) {
                result.push_back(pos);
            }
        }

        return result;
    }

    // Every position that is still open, across all users. Used by settlement
    // sweeps that must reach expiry without knowing the account list.
    std::vector<OptionPosition> get_open_positions() const {
        std::shared_lock lock(mutex_);

        std::vector<OptionPosition> result;
        for (const auto& [id, pos] : positions_) {
            if (pos.status == PositionStatus::OPEN) {
                result.push_back(pos);
            }
        }

        return result;
    }

    // Reprice open positions from an observed underlying price and volatility.
    // Uses the correct model for the position's option type: pricing a put with
    // the call formula overstates its value.
    void update_mark_prices(double underlying_price, double volatility) {
        if (!std::isfinite(underlying_price) || underlying_price <= 0.0) return;
        if (!std::isfinite(volatility) || volatility < 0.0) return;

        std::unique_lock lock(mutex_);

        for (auto& [id, pos] : positions_) {
            if (pos.status != PositionStatus::OPEN) continue;

            double T = pos.expiry_time / 86400000000000.0;  // nanoseconds -> years
            double strike = pos.strike_price / 1e8;

            double price = (pos.type == OptionType::CALL)
                ? BlackScholesModel::calculate_call_price(underlying_price, strike, T, 0.05, 0.0, volatility)
                : BlackScholesModel::calculate_put_price(underlying_price, strike, T, 0.05, 0.0, volatility);

            pos.mark_price = price > 0.0 ? static_cast<uint64_t>(price * 1e8) : 0;

            int64_t mark = static_cast<int64_t>(pos.mark_price);
            int64_t entry = static_cast<int64_t>(pos.average_price);
            int64_t qty = static_cast<int64_t>(pos.filled_quantity);
            pos.unrealized_pnl = (pos.side == PositionSide::LONG)
                ? (mark - entry) * qty
                : (entry - mark) * qty;

            pos.greeks = BlackScholesModel::calculate_greeks(
                underlying_price, strike,
                T, 0.05, 0.0, volatility,
                pos.type
            );
        }
    }
};

// Volatility surface manager
class VolatilitySurfaceManager {
private:
    std::unordered_map<std::string, VolatilitySmile> surfaces_;
    mutable std::shared_mutex mutex_;
    
public:
    // Update surface
    void update_surface(const std::string& symbol, const VolatilitySmile& surface) {
        std::unique_lock lock(mutex_);
        surfaces_[symbol] = surface;
    }
    
    // Interpolate an implied volatility from observed surface points. There is
    // no default volatility: a symbol with no surface yields no answer, so the
    // caller cannot price a contract off an invented number.
    std::optional<double> get_volatility(const std::string& symbol, double strike, double expiry) const {
        std::shared_lock lock(mutex_);

        auto it = surfaces_.find(symbol);
        if (it == surfaces_.end()) {
            return std::nullopt;
        }

        const auto& surface = it->second;
        if (surface.points.empty()) {
            return std::nullopt;
        }

        // Nearest observed expiry, then linear interpolation across strikes
        // within that expiry slice.
        double best_expiry = surface.points.front().expiry;
        double best_distance = std::abs(best_expiry - expiry);
        for (const auto& point : surface.points) {
            double distance = std::abs(point.expiry - expiry);
            if (distance < best_distance) {
                best_distance = distance;
                best_expiry = point.expiry;
            }
        }

        const VolatilityPoint* lower = nullptr;
        const VolatilityPoint* upper = nullptr;
        for (const auto& point : surface.points) {
            if (point.expiry != best_expiry) continue;
            if (point.strike <= strike && (!lower || point.strike > lower->strike)) {
                lower = &point;
            }
            if (point.strike >= strike && (!upper || point.strike < upper->strike)) {
                upper = &point;
            }
        }

        if (!lower && !upper) {
            return std::nullopt;
        }
        if (!lower) return upper->volatility;
        if (!upper) return lower->volatility;
        if (lower->strike == upper->strike) return lower->volatility;

        double weight = (strike - lower->strike) / (upper->strike - lower->strike);
        return lower->volatility + weight * (upper->volatility - lower->volatility);
    }

    // Get surface
    std::optional<VolatilitySmile> get_surface(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        
        auto it = surfaces_.find(symbol);
        if (it != surfaces_.end()) {
            return it->second;
        }
        
        return std::nullopt;
    }
};

// Option order manager
class OrderManager {
private:
    std::unordered_map<uint64_t, OptionOrder> orders_;
    std::unordered_map<std::string, std::vector<uint64_t>> user_orders_;
    std::atomic<uint64_t> next_order_id_{1};
    mutable std::shared_mutex mutex_;
    
public:
    // Place order
    uint64_t place_order(const OptionOrder& order) {
        std::unique_lock lock(mutex_);

        uint64_t order_id = next_order_id_.fetch_add(1);
        OptionOrder new_order = order;
        new_order.order_id = order_id;
        new_order.status = OrderStatus::NEW;
        new_order.created_at = std::chrono::system_clock::now().time_since_epoch().count();

        orders_[order_id] = new_order;
        user_orders_[std::to_string(order.user_id)].push_back(order_id);

        return order_id;
    }

    // Cancel order. Only the owner may cancel, and only while the order is
    // still live; cancelling a filled order would silently rewrite history.
    bool cancel_order(uint64_t order_id, uint64_t user_id) {
        std::unique_lock lock(mutex_);

        auto it = orders_.find(order_id);
        if (it == orders_.end()) {
            return false;
        }

        if (it->second.user_id != user_id) {
            return false;
        }

        if (it->second.status != OrderStatus::NEW &&
            it->second.status != OrderStatus::PENDING &&
            it->second.status != OrderStatus::PARTIALLY_FILLED) {
            return false;
        }

        it->second.status = OrderStatus::CANCELLED;
        return true;
    }

    // Get order
    std::optional<OptionOrder> get_order(uint64_t order_id) const {
        std::shared_lock lock(mutex_);
        
        auto it = orders_.find(order_id);
        if (it != orders_.end()) {
            return it->second;
        }
        
        return std::nullopt;
    }
    
    // Get user orders
    std::vector<OptionOrder> get_user_orders(uint64_t user_id) const {
        std::shared_lock lock(mutex_);
        
        std::vector<OptionOrder> result;
        auto it = user_orders_.find(std::to_string(user_id));
        if (it != user_orders_.end()) {
            for (const auto& order_id : it->second) {
                auto order_it = orders_.find(order_id);
                if (order_it != orders_.end()) {
                    result.push_back(order_it->second);
                }
            }
        }
        
        return result;
    }
};

// Option trading engine
class OptionTradingEngine {
private:
    std::unique_ptr<PositionManager> position_manager_;
    std::unique_ptr<OrderManager> order_manager_;
    std::unique_ptr<VolatilitySurfaceManager> vol_surface_manager_;
    
    std::unordered_map<std::string, OptionContract> contracts_;
    std::unordered_map<std::string, OptionMarketData> market_data_;
    mutable std::shared_mutex contracts_mutex_;
    
    std::atomic<bool> running_{false};
    
public:
    OptionTradingEngine() {
        position_manager_ = std::make_unique<PositionManager>();
        order_manager_ = std::make_unique<OrderManager>();
        vol_surface_manager_ = std::make_unique<VolatilitySurfaceManager>();
    }
    
    // Initialize contract
    bool initialize_contract(const OptionContract& contract) {
        std::unique_lock lock(contracts_mutex_);
        
        if (contracts_.find(contract.symbol) != contracts_.end()) {
            return false;
        }
        
        contracts_[contract.symbol] = contract;
        return true;
    }
    
    // Place order
    uint64_t place_order(const OptionOrder& order) {
        // Validate order
        std::unique_lock lock(contracts_mutex_);
        auto it = contracts_.find(order.symbol);
        if (it == contracts_.end()) {
            return 0;
        }

        if (!it->second.is_active) {
            return 0;
        }

        if (order.quantity == 0) {
            return 0;
        }

        lock.unlock();

        return order_manager_->place_order(order);
    }

    // Cancel order
    bool cancel_order(uint64_t order_id, uint64_t user_id) {
        return order_manager_->cancel_order(order_id, user_id);
    }
    
    // Exercise option
    bool exercise_option(uint64_t position_id, uint64_t user_id, double underlying_price) {
        if (!std::isfinite(underlying_price) || underlying_price <= 0.0) {
            return false;
        }

        auto pos_opt = position_manager_->get_position(position_id);
        if (!pos_opt.has_value()) {
            return false;
        }

        if (pos_opt->user_id != user_id) {
            return false;
        }

        return position_manager_->exercise_position(
            position_id, static_cast<uint64_t>(underlying_price * 1e8));
    }

    // Auto exercise at expiry. Positions in the money beyond the contract's
    // auto-exercise threshold are settled at the observed underlying price.
    void auto_exercise_expired(double underlying_price) {
        if (!std::isfinite(underlying_price) || underlying_price <= 0.0) {
            return;
        }

        std::unique_lock lock(contracts_mutex_);

        uint64_t now = static_cast<uint64_t>(
            std::chrono::system_clock::now().time_since_epoch().count());

        for (auto& [symbol, contract] : contracts_) {
            if (!contract.is_active || !contract.is_auto_exercisable) {
                continue;
            }

            if (now < contract.expiry_time) {
                continue;
            }

            double strike = contract.strike_price / 1e8;
            double intrinsic = (contract.type == OptionType::CALL)
                ? (underlying_price - strike)
                : (strike - underlying_price);

            if (intrinsic <= contract.auto_exercise_threshold) {
                continue;
            }

            for (const auto& pos : position_manager_->get_open_positions()) {
                if (pos.symbol == symbol) {
                    position_manager_->exercise_position(
                        pos.position_id, static_cast<uint64_t>(underlying_price * 1e8));
                }
            }
        }
    }

    // Calculate option price
    double calculate_price(const std::string& symbol, double underlying_price, 
                          double time_to_expiry, double risk_free_rate = 0.05) {
        std::shared_lock lock(contracts_mutex_);
        
        auto it = contracts_.find(symbol);
        if (it == contracts_.end()) {
            return 0.0;
        }
        
        const auto& contract = it->second;
        double K = contract.strike_price / 1e8;
        double T = time_to_expiry;
        
        // Volatility is read from the observed surface at this contract's
        // strike. Without a surface there is no price to report.
        auto sigma = vol_surface_manager_->get_volatility(symbol, K, T);
        if (!sigma.has_value() || *sigma <= 0.0) {
            return 0.0;
        }
        
        if (contract.type == OptionType::CALL) {
            return BlackScholesModel::calculate_call_price(underlying_price, K, T, risk_free_rate, 0.0, *sigma);
        } else {
            return BlackScholesModel::calculate_put_price(underlying_price, K, T, risk_free_rate, 0.0, *sigma);
        }
    }
    
    // Calculate Greeks
    Greeks calculate_greeks(const std::string& symbol, double underlying_price,
                         double time_to_expiry, double risk_free_rate = 0.05) {
        std::shared_lock lock(contracts_mutex_);
        
        auto it = contracts_.find(symbol);
        if (it == contracts_.end()) {
            return {};
        }
        
        const auto& contract = it->second;
        double K = contract.strike_price / 1e8;
        double T = time_to_expiry;
        
        auto sigma = vol_surface_manager_->get_volatility(symbol, K, T);
        if (!sigma.has_value() || *sigma <= 0.0) {
            return {};
        }
        
        return BlackScholesModel::calculate_greeks(underlying_price, K, T, risk_free_rate, 0.0, *sigma, contract.type);
    }
    
    // Update market data
    void update_market_data(const OptionMarketData& data) {
        std::unique_lock lock(contracts_mutex_);
        market_data_[data.symbol] = data;
    }

    // Publish an observed volatility surface for a symbol so contracts on it can
    // be priced. Until a surface exists the engine reports no price.
    void update_volatility_surface(const std::string& symbol, const VolatilitySmile& surface) {
        vol_surface_manager_->update_surface(symbol, surface);
    }
    
    // Get market data
    std::optional<OptionMarketData> get_market_data(const std::string& symbol) const {
        std::shared_lock lock(contracts_mutex_);
        
        auto it = market_data_.find(symbol);
        if (it != market_data_.end()) {
            return it->second;
        }
        
        return std::nullopt;
    }
    
    // Get contract
    std::optional<OptionContract> get_contract(const std::string& symbol) const {
        std::shared_lock lock(contracts_mutex_);
        
        auto it = contracts_.find(symbol);
        if (it != contracts_.end()) {
            return it->second;
        }
        
        return std::nullopt;
    }
    
    // Implied volatility for a contract, from an observed market price. Returns
    // no value when the contract is unknown or the price is not consistent with
    // any volatility.
    std::optional<double> calculate_implied_volatility(const std::string& symbol, double market_price,
                                    double underlying_price, double time_to_expiry) {
        auto contract_opt = get_contract(symbol);
        if (!contract_opt.has_value()) {
            return std::nullopt;
        }
        
        const auto& contract = contract_opt.value();
        double K = contract.strike_price / 1e8;
        
        return ImpliedVolatilitySolver::calculate_implied_volatility(
            market_price, underlying_price, K, time_to_expiry, 0.0, 0.0,
            contract.type
        );
    }
};

} // namespace options
} // namespace tigerex

#endif // TIGEREX_OPTIONS_ENGINE_HPP