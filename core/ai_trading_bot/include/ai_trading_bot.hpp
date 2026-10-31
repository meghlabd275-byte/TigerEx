/**
 * TigerEx AI Trading Bot
 * ML-based trading signals and automated trading
 * 
 * Copyright (c) 2024 TigerEx
 */

#ifndef TIGEREX_AI_TRADING_BOT_HPP
#define TIGEREX_AI_TRADING_BOT_HPP

#include <vector>
#include <map>
#include <unordered_map>
#include <optional>
#include <memory>
#include <mutex>
#include <shared_mutex>
#include <atomic>
#include <chrono>
#include <string>
#include <cmath>
#include <functional>
#include <deque>
#include <stdexcept>

namespace tigerex {
namespace aibot {

enum class BotStrategy { GRID = 0, DCA = 1, MOMENTUM = 2, MEAN_REVERSION = 3, TREND_FOLLOWING = 4, ARBITRAGE = 5, SCALPING = 6 };
enum class BotStatus { INACTIVE = 0, ACTIVE = 1, PAUSED = 2, ERROR = 3 };

struct BotConfig {
    std::string bot_id;
    std::string user_id;
    std::string symbol;
    BotStrategy strategy;
    BotStatus status;
    double base_quantity;
    double min_price;
    double max_price;
    double grid_levels;
    double investment_amount;
    double take_profit;
    double stop_loss;
    bool auto_restart;
    uint64_t created_at;
    BotConfig() : strategy(BotStrategy::GRID), status(BotStatus::INACTIVE), base_quantity(0), min_price(0), max_price(0), grid_levels(10), investment_amount(0), take_profit(0), stop_loss(0), auto_restart(true), created_at(0) {}
};

struct BotState {
    std::string bot_id;
    double current_price;
    double total_invested;
    double total_profit;
    double total_trades;
    double current_position;
    double average_entry;
    double unrealized_pnl;
    uint64_t last_trade_time;
    double win_rate;
    // Last grid level the bot acted on, so a flat price does not re-trade.
    int last_grid_level;
    BotState() : current_price(0), total_invested(0), total_profit(0), total_trades(0), current_position(0), average_entry(0), unrealized_pnl(0), last_trade_time(0), win_rate(0), last_grid_level(-1) {}
};

struct TradingSignal {
    std::string signal_id;
    std::string symbol;
    std::string direction;  // BUY, SELL, HOLD
    double confidence;
    double target_price;
    double stop_loss;
    double take_profit;
    std::string reason;
    uint64_t timestamp;
    TradingSignal() : confidence(0), target_price(0), stop_loss(0), take_profit(0), timestamp(0) {}
};

struct MarketAnalysis {
    std::string symbol;
    std::string trend;  // bullish, bearish, neutral
    double support_level;
    double resistance_level;
    double rsi;
    double macd;
    double signal_line;
    double volatility;
    double sentiment_score;
    std::vector<double> predictions;  // Next 7 days
    MarketAnalysis() : support_level(0), resistance_level(0), rsi(50), macd(0), signal_line(0), volatility(0), sentiment_score(0.5) {}
};

class AITradingBot {
private:
    std::unordered_map<std::string, BotConfig> bots_;
    std::unordered_map<std::string, BotState> bot_states_;
    std::atomic<uint64_t> next_bot_id_{1};
    mutable std::shared_mutex mutex_;

    // Observed price history per symbol. Indicators are computed from these
    // samples; a symbol with too little history yields no signal rather than a
    // randomly generated one.
    static constexpr size_t kMinHistory = 26;
    std::unordered_map<std::string, std::deque<double>> history_;

public:
    AITradingBot() = default;

    /// Records an observed trade or mark price. Feed this from the real market
    // data stream before requesting signals.
    void ingest_price(const std::string& symbol, double price) {
        if (!std::isfinite(price) || price <= 0.0) {
            throw std::invalid_argument("ingest_price: price must be finite and positive");
        }
        std::unique_lock lock(mutex_);
        auto& series = history_[symbol];
        series.push_back(price);
        while (series.size() > 512) series.pop_front();
    }
    
    // Create bot
    std::string create_bot(const std::string& user_id, const std::string& symbol, BotStrategy strategy,
                          double investment, double min_price, double max_price) {
        std::unique_lock lock(mutex_);
        
        std::string bot_id = "BOT_" + std::to_string(next_bot_id_.fetch_add(1));
        
        BotConfig config;
        config.bot_id = bot_id;
        config.user_id = user_id;
        config.symbol = symbol;
        config.strategy = strategy;
        config.status = BotStatus::ACTIVE;
        config.investment_amount = investment;
        config.min_price = min_price;
        config.max_price = max_price;
        config.grid_levels = 10;
        config.created_at = std::chrono::system_clock::now().time_since_epoch().count();
        
        bots_[bot_id] = config;
        
        BotState state;
        state.bot_id = bot_id;
        state.total_invested = 0;
        state.total_profit = 0;
        state.total_trades = 0;
        bot_states_[bot_id] = state;
        
        return bot_id;
    }
    
    // Start bot
    bool start_bot(const std::string& bot_id) {
        std::unique_lock lock(mutex_);
        
        auto it = bots_.find(bot_id);
        if (it == bots_.end()) return false;
        
        it->second.status = BotStatus::ACTIVE;
        return true;
    }
    
    // Stop bot
    bool stop_bot(const std::string& bot_id) {
        std::unique_lock lock(mutex_);
        
        auto it = bots_.find(bot_id);
        if (it == bots_.end()) return false;
        
        it->second.status = BotStatus::PAUSED;
        return true;
    }
    
    // Get bot
    std::optional<BotConfig> get_bot(const std::string& bot_id) const {
        std::shared_lock lock(mutex_);
        auto it = bots_.find(bot_id);
        if (it != bots_.end()) return it->second;
        return std::nullopt;
    }
    
    // Get bot state
    std::optional<BotState> get_bot_state(const std::string& bot_id) const {
        std::shared_lock lock(mutex_);
        auto it = bot_states_.find(bot_id);
        if (it != bot_states_.end()) return it->second;
        return std::nullopt;
    }
    
    // Get user bots
    std::vector<BotConfig> get_user_bots(const std::string& user_id) const {
        std::shared_lock lock(mutex_);
        std::vector<BotConfig> result;
        for (const auto& [id, bot] : bots_) {
            if (bot.user_id == user_id) result.push_back(bot);
        }
        return result;
    }
    
    // Generate a trading signal from observed price history. Returns nullopt
    // when there is not enough real data to compute one; callers must not trade
    // on a fabricated signal.
    std::optional<TradingSignal> generate_signal(const std::string& symbol, double current_price) {
        std::unique_lock lock(mutex_);

        auto it = history_.find(symbol);
        if (it == history_.end() || it->second.size() < kMinHistory) {
            return std::nullopt;
        }
        if (!std::isfinite(current_price) || current_price <= 0.0) {
            return std::nullopt;
        }

        const std::deque<double>& series = it->second;

        TradingSignal signal;
        signal.signal_id = "SIG_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count());
        signal.symbol = symbol;
        signal.timestamp = std::chrono::system_clock::now().time_since_epoch().count();

        double rsi = compute_rsi(series);
        auto [macd, signal_line] = compute_macd(series);

        // Trend follows the real moving-average relationship: fast above slow is
        // bullish, below is bearish, and a MACD/RSSI agreement sets confidence.
        double fast = sma(series, 12);
        double slow = sma(series, 26);

        if (fast > slow && macd > signal_line && rsi > 50.0) {
            signal.direction = "BUY";
            signal.confidence = clamp01(0.5 + std::fabs(macd) / (slow > 0 ? slow : 1.0));
            signal.target_price = current_price * (1.0 + 0.02 + std::fabs(macd) / slow);
            signal.stop_loss = current_price * (1.0 - 0.01);
            signal.take_profit = current_price * (1.0 + 0.05);
            signal.reason = "Fast MA above slow MA with MACD above signal line";
        } else if (fast < slow && macd < signal_line && rsi < 50.0) {
            signal.direction = "SELL";
            signal.confidence = clamp01(0.5 + std::fabs(macd) / (slow > 0 ? slow : 1.0));
            signal.target_price = current_price * (1.0 - 0.02 - std::fabs(macd) / slow);
            signal.stop_loss = current_price * (1.0 + 0.01);
            signal.take_profit = current_price * (1.0 - 0.05);
            signal.reason = "Fast MA below slow MA with MACD below signal line";
        } else {
            signal.direction = "HOLD";
            signal.confidence = 0.5;
            signal.reason = "Moving averages, MACD and RSI do not agree; no trend";
        }

        return signal;
    }

    // Analyze a market from observed price history. Returns nullopt when there
    // is not enough real data.
    std::optional<MarketAnalysis> analyze_market(const std::string& symbol, double price) {
        std::shared_lock lock(mutex_);

        auto it = history_.find(symbol);
        if (it == history_.end() || it->second.size() < kMinHistory) {
            return std::nullopt;
        }
        if (!std::isfinite(price) || price <= 0.0) {
            return std::nullopt;
        }

        const std::deque<double>& series = it->second;

        MarketAnalysis analysis;
        analysis.symbol = symbol;

        analysis.rsi = compute_rsi(series);
        auto [macd, signal_line] = compute_macd(series);
        analysis.macd = macd;
        analysis.signal_line = signal_line;
        analysis.volatility = compute_volatility(series);

        // Support and resistance are the observed extremes of the window.
        auto [lo, hi] = std::minmax_element(series.begin(), series.end());
        analysis.support_level = *lo;
        analysis.resistance_level = *hi;

        // Sentiment is the position of the last price within that range.
        double range = analysis.resistance_level - analysis.support_level;
        analysis.sentiment_score = range > 0.0
            ? clamp01((series.back() - analysis.support_level) / range)
            : 0.5;

        if (macd > signal_line && analysis.rsi > 50.0) {
            analysis.trend = "bullish";
        } else if (macd < signal_line && analysis.rsi < 50.0) {
            analysis.trend = "bearish";
        } else {
            analysis.trend = "neutral";
        }

        return analysis;
    }

    static double clamp01(double v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

    static double sma(const std::deque<double>& series, size_t period) {
        if (series.size() < period || period == 0) return 0.0;
        double sum = 0.0;
        for (size_t i = series.size() - period; i < series.size(); ++i) sum += series[i];
        return sum / static_cast<double>(period);
    }

    static double ema(const std::vector<double>& series, size_t period) {
        if (series.empty() || period == 0) return 0.0;
        double k = 2.0 / (static_cast<double>(period) + 1.0);
        double value = series.front();
        for (size_t i = 1; i < series.size(); ++i) {
            value = series[i] * k + value * (1.0 - k);
        }
        return value;
    }

    static double compute_rsi(const std::deque<double>& series, size_t period = 14) {
        if (series.size() < period + 1) return 50.0;
        double gain = 0.0, loss = 0.0;
        size_t start = series.size() - period;
        for (size_t i = start; i < series.size(); ++i) {
            double change = series[i] - series[i - 1];
            if (change >= 0.0) gain += change; else loss -= change;
        }
        double avg_gain = gain / static_cast<double>(period);
        double avg_loss = loss / static_cast<double>(period);
        if (avg_loss == 0.0) return avg_gain == 0.0 ? 50.0 : 100.0;
        double rs = avg_gain / avg_loss;
        return 100.0 - (100.0 / (1.0 + rs));
    }

    static std::pair<double, double> compute_macd(const std::deque<double>& series) {
        std::vector<double> data(series.begin(), series.end());
        if (data.size() < 26) return {0.0, 0.0};
        double macd = ema(data, 12) - ema(data, 26);

        // Signal line is the EMA of the MACD series itself.
        std::vector<double> macd_series;
        for (size_t i = 26; i <= data.size(); ++i) {
            std::vector<double> window(data.begin(), data.begin() + i);
            macd_series.push_back(ema(window, 12) - ema(window, 26));
        }
        double signal_line = ema(macd_series, 9);
        return {macd, signal_line};
    }

    static double compute_volatility(const std::deque<double>& series) {
        if (series.size() < 2) return 0.0;
        std::vector<double> returns;
        for (size_t i = 1; i < series.size(); ++i) {
            if (series[i - 1] > 0.0) {
                returns.push_back((series[i] - series[i - 1]) / series[i - 1]);
            }
        }
        if (returns.empty()) return 0.0;
        double mean = 0.0;
        for (double r : returns) mean += r;
        mean /= static_cast<double>(returns.size());
        double var = 0.0;
        for (double r : returns) var += (r - mean) * (r - mean);
        var /= static_cast<double>(returns.size());
        return std::sqrt(var);
    }

    // Execute grid bot
    bool execute_grid_bot(const std::string& bot_id, double current_price) {
        auto it = bots_.find(bot_id);
        if (it == bots_.end() || it->second.status != BotStatus::ACTIVE) return false;
        
        auto& config = it->second;
        auto& state = bot_states_[bot_id];
        
        if (!std::isfinite(current_price) || current_price <= 0.0) return false;
        if (config.max_price <= config.min_price || config.grid_levels <= 0.0) return false;

        // Grid arithmetic: split the configured range into levels and act only
        // when the price crosses into a new level, so a flat price does not
        // generate a stream of trades.
        double price_range = config.max_price - config.min_price;
        double grid_size = price_range / config.grid_levels;
        if (grid_size <= 0.0) return false;

        int current_level = static_cast<int>((current_price - config.min_price) / grid_size);
        if (current_level < 0) current_level = 0;
        if (current_level >= static_cast<int>(config.grid_levels)) {
            current_level = static_cast<int>(config.grid_levels) - 1;
        }

        if (state.last_grid_level < 0) {
            state.last_grid_level = current_level;
            state.current_price = current_price;
            return true;
        }
        if (current_level == state.last_grid_level) {
            state.current_price = current_price;
            return true;
        }

        double unit = config.base_quantity > 0.0
            ? config.base_quantity
            : (config.investment_amount / config.grid_levels) / current_price;
        if (unit <= 0.0) return false;

        int steps = std::abs(current_level - state.last_grid_level);
        for (int step = 0; step < steps; ++step) {
            if (current_level < state.last_grid_level) {
                // Price fell a level: buy one grid unit.
                double cost = unit * current_price;
                double new_position = state.current_position + unit;
                state.average_entry = new_position > 0.0
                    ? (state.average_entry * state.current_position + cost) / new_position
                    : 0.0;
                state.current_position = new_position;
                state.total_invested += cost;
            } else {
                // Price rose a level: sell one grid unit and book the profit.
                double sold = std::min(unit, state.current_position);
                if (sold > 0.0) {
                    state.total_profit += (current_price - state.average_entry) * sold;
                    state.current_position -= sold;
                    if (state.current_position <= 0.0) {
                        state.current_position = 0.0;
                        state.average_entry = 0.0;
                    }
                }
            }
            state.total_trades += 1.0;
        }

        state.last_grid_level = current_level;
        state.current_price = current_price;
        state.unrealized_pnl = state.current_position > 0.0
            ? (current_price - state.average_entry) * state.current_position
            : 0.0;
        state.last_trade_time = std::chrono::system_clock::now().time_since_epoch().count();
        return true;
    }
    
    // Execute DCA bot
    bool execute_dca_bot(const std::string& bot_id, double current_price) {
        auto it = bots_.find(bot_id);
        if (it == bots_.end() || it->second.status != BotStatus::ACTIVE) return false;

        auto& config = it->second;
        auto& state = bot_states_[bot_id];

        if (!std::isfinite(current_price) || current_price <= 0.0) return false;
        if (config.investment_amount <= 0.0 || config.grid_levels <= 0.0) return false;
        if (config.min_price <= 0.0) return false;

        // Take profit on the existing position first. Evaluating it after the
        // buy would fire at break-even whenever take_profit is unset, closing
        // every position on the tick it was opened.
        if (config.take_profit > 0.0 && state.average_entry > 0.0 && state.current_position > 0.0) {
            if (current_price >= state.average_entry * (1.0 + config.take_profit)) {
                state.total_profit += (current_price - state.average_entry) * state.current_position;
                state.current_position = 0.0;
                state.average_entry = 0.0;
            }
        }

        // Buy a fixed slice at prices near the configured floor.
        if (current_price <= config.min_price * 1.1) {
            double buy_amount = config.investment_amount / config.grid_levels;
            double quantity = buy_amount / current_price;

            double new_position = state.current_position + quantity;
            state.average_entry = new_position > 0.0
                ? (state.average_entry * state.current_position + buy_amount) / new_position
                : 0.0;
            state.current_position = new_position;
            state.total_invested += buy_amount;
            state.total_trades += 1.0;
            state.last_trade_time = std::chrono::system_clock::now().time_since_epoch().count();
        }

        state.current_price = current_price;
        state.unrealized_pnl = state.current_position > 0.0
            ? (current_price - state.average_entry) * state.current_position
            : 0.0;
        return true;
    }
    
    // Get statistics
    uint64_t get_active_bots_count() const {
        uint64_t count = 0;
        for (const auto& [id, bot] : bots_) {
            if (bot.status == BotStatus::ACTIVE) count++;
        }
        return count;
    }
};

} // namespace aibot
} // namespace tigerex

#endif // TIGEREX_AI_TRADING_BOT_HPP