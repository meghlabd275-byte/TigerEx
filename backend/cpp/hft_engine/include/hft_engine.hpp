/**
 * TigerEx High-Frequency Trading (HFT) Engine
 * Ultra-low latency trading engine for C++
 * 
 * Features:
 * - Microsecond-level order processing
 * - Lock-free data structures
 * - SIMD optimization
 * - DMA (Direct Memory Access) support
 * - Co-location ready
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_HFT_ENGINE_HPP
#define TIGEREX_HFT_ENGINE_HPP

#include <atomic>
#include <memory>
#include <array>
#include <vector>
#include <deque>
#include <unordered_map>
#include <chrono>
#include <thread>
#include <mutex>
#include <shared_mutex>
#include <condition_variable>
#include <functional>
#include <optional>
#include <cstdint>
#include <algorithm>
#include <numeric>
#include <iostream>
#include <cstring>
#include <sstream>
#include <iomanip>

namespace tigerex {
namespace hft {

// ============================================================================
// CONFIGURATION
// ============================================================================

constexpr size_t MAX_ORDERS = 1'000'000;
constexpr size_t MAX_SYMBOLS = 10'000;
constexpr size_t ORDER_POOL_SIZE = 100'000;
constexpr size_t MAX_PRICE_LEVELS = 1000;
constexpr size_t CACHE_LINE_SIZE = 64;
constexpr size_t HFT_LATENCY_TARGET_NS = 1000; // 1 microsecond target

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

using Timestamp = int64_t;
using OrderId = uint64_t;
using UserId = uint64_t;
using SymbolId = uint32_t;
using Price = int64_t;  // Scaled by 10^8
using Quantity = int64_t;

// Monotonic nanosecond clock shared by the book and the risk engine.
inline Timestamp get_timestamp_ns() {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

enum class OrderSide : uint8_t {
    Buy = 0,
    Sell = 1
};

enum class OrderType : uint8_t {
    Market = 0,
    Limit = 1,
    StopMarket = 2,
    StopLimit = 3,
    IOC = 4,    // Immediate or Cancel
    FOK = 5     // Fill or Kill
};

enum class OrderStatus : uint8_t {
    Pending = 0,
    New = 1,
    PartiallyFilled = 2,
    Filled = 3,
    Cancelled = 4,
    Rejected = 5
};

enum class TimeInForce : uint8_t {
    GTC = 0,   // Good Till Cancel
    IOC = 1,   // Immediate or Cancel
    FOK = 2,   // Fill or Kill
    GTD = 3    // Good Till Date
};

// ============================================================================
// ORDER STRUCTURES (Cache-line aligned)
// ============================================================================

struct Order {
    // 8 bytes - Critical for performance
    alignas(CACHE_LINE_SIZE) OrderId order_id;
    alignas(CACHE_LINE_SIZE) UserId user_id;
    alignas(CACHE_LINE_SIZE) SymbolId symbol_id;
    
    // 8 bytes
    Price price;
    Quantity quantity;
    Quantity filled_quantity;
    Quantity remaining_quantity;
    
    // 8 bytes
    Price stop_price;
    Price average_fill_price;
    
    // 4 bytes each
    uint32_t flags;
    uint32_t sequence;
    
    // 1 byte each
    OrderSide side;
    OrderType type;
    OrderStatus status;
    TimeInForce tif;
    
    // 8 bytes
    Timestamp created_at;
    Timestamp updated_at;
    Timestamp expires_at;
    
    // 16 bytes - Client order ID (optional)
    char client_order_id[16];
    
    // Padding to align to cache line
    char padding[CACHE_LINE_SIZE - (sizeof(OrderId) + sizeof(UserId) + sizeof(SymbolId) + 
                    sizeof(Price)*4 + sizeof(Quantity)*3 + sizeof(uint32_t)*2 + 
                    sizeof(OrderSide) + sizeof(OrderType) + sizeof(OrderStatus) + 
                    sizeof(TimeInForce) + sizeof(Timestamp)*3 + 16) % CACHE_LINE_SIZE];
    
    Order() noexcept : 
        order_id(0), user_id(0), symbol_id(0),
        price(0), quantity(0), filled_quantity(0), remaining_quantity(0),
        stop_price(0), average_fill_price(0),
        flags(0), sequence(0),
        side(OrderSide::Buy), type(OrderType::Limit), 
        status(OrderStatus::Pending), tif(TimeInForce::GTC),
        created_at(0), updated_at(0), expires_at(0) {
        memset(client_order_id, 0, sizeof(client_order_id));
    }
};

struct Trade {
    OrderId order_id;
    OrderId counter_order_id;
    SymbolId symbol_id;
    OrderSide side;
    Price price;
    Quantity quantity;
    Quantity leaves_quantity;
    Price fee;
    char fee_asset[8];
    Timestamp executed_at;
    uint64_t trade_id;
    uint32_t match_id;
    
    Trade() noexcept :
        order_id(0), counter_order_id(0), symbol_id(0), side(OrderSide::Buy),
        price(0), quantity(0), leaves_quantity(0), fee(0),
        executed_at(0), trade_id(0), match_id(0) {
        memset(fee_asset, 0, sizeof(fee_asset));
    }
};

struct OrderBookLevel {
    Price price;
    Quantity quantity;
    OrderId order_id;
    uint8_t level;  // Position in the book
    
    OrderBookLevel() noexcept : price(0), quantity(0), order_id(0), level(0) {}
};

// One resting order consumed by an incoming order.
struct Fill {
    OrderId maker_order_id;
    Price price;
    Quantity quantity;

    Fill() noexcept : maker_order_id(0), price(0), quantity(0) {}
    Fill(OrderId id, Price p, Quantity q) noexcept
        : maker_order_id(id), price(p), quantity(q) {}
};

// Flat, copyable point-in-time snapshot of a book. The live book is the
// `OrderBook` class further down.
struct OrderBookSnapshot {
    SymbolId symbol_id;
    Timestamp last_update;
    uint64_t sequence;
    
    // Price levels - using arrays for cache efficiency
    std::array<OrderBookLevel, MAX_PRICE_LEVELS> bids;
    std::array<OrderBookLevel, MAX_PRICE_LEVELS> asks;
    
    size_t bid_count;
    size_t ask_count;
    
    // Statistics
    Price last_price;
    Price high_price;
    Price low_price;
    Quantity volume;
    uint64_t trade_count;
    
    OrderBookSnapshot() noexcept : symbol_id(0), last_update(0), sequence(0),
        bid_count(0), ask_count(0), last_price(0), high_price(0), 
        low_price(0), volume(0), trade_count(0) {}
};

// ============================================================================
// LOCK-FREE ORDER POOL
// ============================================================================

class OrderPool {
private:
    std::vector<Order> orders_;
    std::atomic<size_t> current_index_;
    std::atomic<bool> initialized_;
    
public:
    OrderPool(size_t size = ORDER_POOL_SIZE) 
        : current_index_(0), initialized_(false) {
        orders_.resize(size);
        initialized_.store(true);
    }
    
    Order* allocate() {
        if (!initialized_.load()) return nullptr;
        
        size_t index = current_index_.fetch_add(1, std::memory_order_relaxed);
        if (index >= orders_.size()) {
            return nullptr;
        }
        
        return &orders_[index];
    }
    
    void reset() {
        current_index_.store(0, std::memory_order_relaxed);
    }
    
    size_t size() const { return orders_.size(); }
    size_t used() const { return current_index_.load(std::memory_order_relaxed); }
};

// ============================================================================
// SYMBOL REGISTRY
// ============================================================================

struct Symbol {
    SymbolId id;
    char symbol[16];
    char base_asset[8];
    char quote_asset[8];
    Price tick_size;
    Quantity min_quantity;
    Quantity max_quantity;
    uint8_t price_precision;
    uint8_t quantity_precision;
    bool is_trading;
    bool is_margin_enabled;
    Quantity default_min_notional;
    
    Symbol() noexcept : id(0), tick_size(1), min_quantity(1), 
        max_quantity(std::numeric_limits<Quantity>::max()),
        price_precision(2), quantity_precision(4),
        is_trading(true), is_margin_enabled(false), 
        default_min_notional(1000) {
        memset(symbol, 0, sizeof(symbol));
        memset(base_asset, 0, sizeof(base_asset));
        memset(quote_asset, 0, sizeof(quote_asset));
    }
};

class SymbolRegistry {
private:
    std::unordered_map<SymbolId, Symbol> symbols_by_id_;
    std::unordered_map<std::string, SymbolId> symbols_by_name_;
    std::atomic<SymbolId> next_id_{1};
    mutable std::shared_mutex mutex_;
    
public:
    SymbolId register_symbol(const std::string& symbol, 
                           const std::string& base,
                           const std::string& quote) {
        std::unique_lock lock(mutex_);
        
        // Check if already exists
        auto it = symbols_by_name_.find(symbol);
        if (it != symbols_by_name_.end()) {
            return it->second;
        }
        
        SymbolId id = next_id_.fetch_add(1);
        Symbol sym;
        sym.id = id;
        strncpy(sym.symbol, symbol.c_str(), sizeof(sym.symbol) - 1);
        strncpy(sym.base_asset, base.c_str(), sizeof(sym.base_asset) - 1);
        strncpy(sym.quote_asset, quote.c_str(), sizeof(sym.quote_asset) - 1);
        
        symbols_by_id_[id] = sym;
        symbols_by_name_[symbol] = id;
        
        return id;
    }
    
    std::optional<Symbol> get_symbol(SymbolId id) const {
        std::shared_lock lock(mutex_);
        auto it = symbols_by_id_.find(id);
        if (it != symbols_by_id_.end()) {
            return it->second;
        }
        return std::nullopt;
    }
    
    std::optional<SymbolId> get_symbol_id(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        auto it = symbols_by_name_.find(symbol);
        if (it != symbols_by_name_.end()) {
            return it->second;
        }
        return std::nullopt;
    }

    std::vector<Symbol> get_all_symbols() const {
        std::shared_lock lock(mutex_);
        std::vector<Symbol> out;
        out.reserve(symbols_by_id_.size());
        for (const auto& [id, sym] : symbols_by_id_) {
            (void)id;
            out.push_back(sym);
        }
        return out;
    }
};

// ============================================================================
// ORDER BOOK (Lock-free implementation)
// ============================================================================

class OrderBook {
private:
    struct PriceLevel {
        Price price;
        Quantity quantity;
        // Resting orders at this price, oldest first, with their remaining size.
        std::deque<std::pair<OrderId, Quantity>> orders;
        
        PriceLevel() : price(0), quantity(0) {}
    };
    
    std::unordered_map<Price, PriceLevel> bids_;
    std::unordered_map<Price, PriceLevel> asks_;
    mutable std::shared_mutex mutex_;
    
    SymbolId symbol_id_;
    std::atomic<uint64_t> sequence_{0};
    std::atomic<Timestamp> last_update_{0};
    
public:
    explicit OrderBook(SymbolId symbol_id) : symbol_id_(symbol_id) {}
    
    // Add order to book
    bool add_order(Order* order) {
        std::unique_lock lock(mutex_);
        
        auto& levels = order->side == OrderSide::Buy ? bids_ : asks_;
        auto& level = levels[order->price];
        
        level.price = order->price;
        level.quantity += order->remaining_quantity;
        level.orders.emplace_back(order->order_id, order->remaining_quantity);
        
        sequence_.fetch_add(1, std::memory_order_relaxed);
        last_update_.store(get_timestamp_ns(), std::memory_order_relaxed);
        
        return true;
    }
    
    // Remove order from book
    bool remove_order(OrderId order_id, Price price, OrderSide side) {
        std::unique_lock lock(mutex_);
        
        auto& levels = side == OrderSide::Buy ? bids_ : asks_;
        auto it = levels.find(price);
        
        if (it == levels.end()) return false;
        
        auto& order_ids = it->second.orders;
        for (auto it2 = order_ids.begin(); it2 != order_ids.end(); ++it2) {
            if (it2->first == order_id) {
                it->second.quantity -= it2->second;
                order_ids.erase(it2);
                break;
            }
        }
        
        // Clean up empty levels
        if (order_ids.empty()) {
            levels.erase(it);
        }
        
        sequence_.fetch_add(1, std::memory_order_relaxed);
        last_update_.store(get_timestamp_ns(), std::memory_order_relaxed);
        
        return true;
    }
    
    // Best bid: the highest bid price. The book is a hash map, so the best
    // price has to be searched for; `begin()` returns an arbitrary level.
    std::optional<std::pair<Price, Quantity>> best_bid() const {
        std::shared_lock lock(mutex_);
        std::optional<std::pair<Price, Quantity>> best;
        for (const auto& [price, level] : bids_) {
            if (level.quantity <= 0) continue;
            if (!best || price > best->first) {
                best = std::make_pair(price, level.quantity);
            }
        }
        return best;
    }

    // Best ask: the lowest ask price.
    std::optional<std::pair<Price, Quantity>> best_ask() const {
        std::shared_lock lock(mutex_);
        std::optional<std::pair<Price, Quantity>> best;
        for (const auto& [price, level] : asks_) {
            if (level.quantity <= 0) continue;
            if (!best || price < best->first) {
                best = std::make_pair(price, level.quantity);
            }
        }
        return best;
    }

    // Get depth, best prices first.
    void get_depth(size_t levels, 
                   std::vector<OrderBookLevel>& bid_levels,
                   std::vector<OrderBookLevel>& ask_levels) const {
        std::shared_lock lock(mutex_);
        
        bid_levels.clear();
        ask_levels.clear();

        std::vector<std::pair<Price, Quantity>> bid_prices;
        bid_prices.reserve(bids_.size());
        for (const auto& [price, level] : bids_) {
            if (level.quantity > 0) bid_prices.push_back({price, level.quantity});
        }
        std::sort(bid_prices.begin(), bid_prices.end(),
                  [](const auto& a, const auto& b) { return a.first > b.first; });

        std::vector<std::pair<Price, Quantity>> ask_prices;
        ask_prices.reserve(asks_.size());
        for (const auto& [price, level] : asks_) {
            if (level.quantity > 0) ask_prices.push_back({price, level.quantity});
        }
        std::sort(ask_prices.begin(), ask_prices.end(),
                  [](const auto& a, const auto& b) { return a.first < b.first; });

        for (size_t k = 0; k < bid_prices.size() && k < levels; ++k) {
            OrderBookLevel bl;
            bl.price = bid_prices[k].first;
            bl.quantity = bid_prices[k].second;
            bid_levels.push_back(bl);
        }
        for (size_t k = 0; k < ask_prices.size() && k < levels; ++k) {
            OrderBookLevel al;
            al.price = ask_prices[k].first;
            al.quantity = ask_prices[k].second;
            ask_levels.push_back(al);
        }
    }

    // Take liquidity from the opposite side, best price first, then oldest
    // order first within a level, until `qty` is filled or the side is empty.
    std::vector<Fill> take(OrderSide incoming_side, Quantity qty) {
        std::unique_lock lock(mutex_);

        auto& levels = incoming_side == OrderSide::Buy ? asks_ : bids_;
        std::vector<Fill> fills;

        while (qty > 0) {
            auto best = levels.end();
            for (auto it = levels.begin(); it != levels.end(); ++it) {
                if (it->second.quantity <= 0) continue;
                if (best == levels.end() ||
                    (incoming_side == OrderSide::Buy ? it->first < best->first
                                                     : it->first > best->first)) {
                    best = it;
                }
            }
            if (best == levels.end()) break;

            auto& level = best->second;
            while (qty > 0 && !level.orders.empty()) {
                auto& front = level.orders.front();
                Quantity take_qty = std::min(qty, front.second);

                fills.emplace_back(front.first, level.price, take_qty);
                front.second -= take_qty;
                level.quantity -= take_qty;
                qty -= take_qty;

                if (front.second <= 0) {
                    level.orders.pop_front();
                }
            }

            if (level.orders.empty()) {
                levels.erase(best);
            }
        }

        if (!fills.empty()) {
            sequence_.fetch_add(1, std::memory_order_relaxed);
            last_update_.store(get_timestamp_ns(), std::memory_order_relaxed);
        }
        return fills;
    }
    
    SymbolId symbol_id() const { return symbol_id_; }
    uint64_t sequence() const { return sequence_.load(std::memory_order_relaxed); }
    Timestamp last_update() const { return last_update_.load(std::memory_order_relaxed); }
};

// ============================================================================
// RISK ENGINE
// ============================================================================

struct RiskLimits {
    Quantity max_order_size;
    Quantity max_notional;
    Quantity max_orders_per_second;
    Quantity max_cancel_per_second;
    double max_position_delta;
    Price max_slippage;
    bool enable_delayed_trade_check;
    uint32_t risk_check_interval_ms;
    
    RiskLimits() : 
        max_order_size(1'000'000),
        max_notional(10'000'000'000),
        max_orders_per_second(1000),
        max_cancel_per_second(1000),
        max_position_delta(0.1),
        max_slippage(100),  // In price units
        enable_delayed_trade_check(true),
        risk_check_interval_ms(100) {}
};

struct UserRiskState {
    UserId user_id;
    Quantity order_count_today;
    Quantity cancel_count_today;
    Quantity total_volume_today;
    Timestamp last_order_time;
    Timestamp last_reset;
    bool is_blocked;
    std::string block_reason;
    
    UserRiskState() : user_id(0), order_count_today(0), cancel_count_today(0),
        total_volume_today(0), last_order_time(0), last_reset(0), 
        is_blocked(false) {}
};

class RiskEngine {
private:
    std::unordered_map<UserId, UserRiskState> user_states_;
    RiskLimits default_limits_;
    mutable std::shared_mutex mutex_;
    
public:
    RiskEngine() {
        // Initialize with some default values
    }
    
    void set_limits(const RiskLimits& limits) {
        std::unique_lock lock(mutex_);
        default_limits_ = limits;
    }
    
    bool check_order_risk(UserId user_id, Price price, Quantity quantity, 
                         OrderSide side) {
        std::shared_lock lock(mutex_);
        
        if (price < 0 || quantity <= 0) {
            return false;
        }

        // Size and notional limits apply to every order, including the first
        // from an account the engine has not seen before. Returning early for
        // an unknown user let it send an order of any size unchecked.
        if (quantity > default_limits_.max_order_size) {
            return false;
        }

        // A market order carries no limit price; its notional is bounded by the
        // book at execution time, so the price-based check is skipped.
        if (price > 0) {
            int64_t notional = static_cast<int64_t>(price) * static_cast<int64_t>(quantity);
            if (notional > default_limits_.max_notional) {
                return false;
            }
        }

        auto it = user_states_.find(user_id);
        if (it == user_states_.end()) {
            return true;
        }
        
        const auto& state = it->second;
        if (state.is_blocked) {
            return false;
        }
        
        // Check rate limits
        Timestamp now = get_timestamp_ns();
        if (now - state.last_order_time < 1'000'000'000 / default_limits_.max_orders_per_second) {
            return false;
        }
        
        return true;
    }
    
    void record_order(UserId user_id, Price price, Quantity quantity) {
        std::unique_lock lock(mutex_);
        
        auto& state = user_states_[user_id];
        state.user_id = user_id;
        state.order_count_today++;
        state.total_volume_today += price * quantity;
        state.last_order_time = get_timestamp_ns();
    }
    
    void record_cancel(UserId user_id) {
        std::unique_lock lock(mutex_);
        user_states_[user_id].cancel_count_today++;
    }
    
    void block_user(UserId user_id, const std::string& reason) {
        std::unique_lock lock(mutex_);
        auto& state = user_states_[user_id];
        state.is_blocked = true;
        state.block_reason = reason;
    }
    
    void unblock_user(UserId user_id) {
        std::unique_lock lock(mutex_);
        user_states_[user_id].is_blocked = false;
    }
    
    void reset_daily_limits() {
        std::unique_lock lock(mutex_);
        Timestamp now = get_timestamp_ns();
        
        for (auto& [user_id, state] : user_states_) {
            if (now - state.last_reset > 24 * 60 * 60 * 1000000000LL) {
                state.order_count_today = 0;
                state.cancel_count_today = 0;
                state.total_volume_today = 0;
                state.last_reset = now;
            }
        }
    }
};

// ============================================================================
// HFT ENGINE CORE
// ============================================================================

class HFTEngine {
private:
    // Core components
    std::unique_ptr<OrderPool> order_pool_;
    std::unique_ptr<SymbolRegistry> symbol_registry_;
    std::unique_ptr<RiskEngine> risk_engine_;
    
    // Order books per symbol
    std::unordered_map<SymbolId, std::unique_ptr<OrderBook>> order_books_;
    mutable std::shared_mutex books_mutex_;
    
    // Order storage
    std::unordered_map<OrderId, Order*> orders_by_id_;
    mutable std::shared_mutex orders_mutex_;
    
    // Performance metrics
    std::atomic<uint64_t> total_orders_{0};
    std::atomic<uint64_t> total_trades_{0};
    std::atomic<uint64_t> total_volume_{0};
    std::atomic<Timestamp> last_latency_check_{0};
    
    // Configuration
    bool running_;
    uint32_t worker_threads_;
    
    // Callbacks
    std::function<void(const Trade&)> on_trade_;
    std::function<void(const Order&)> on_order_update_;
    std::function<void(const std::string&)> on_error_;
    
public:
    HFTEngine(uint32_t worker_threads = 4) 
        : running_(false), worker_threads_(worker_threads) {
        
        // Initialize components
        order_pool_ = std::make_unique<OrderPool>();
        symbol_registry_ = std::make_unique<SymbolRegistry>();
        risk_engine_ = std::make_unique<RiskEngine>();
        
        // Register default symbols
        register_default_symbols();
    }
    
    ~HFTEngine() {
        stop();
    }
    
    // Register default trading symbols
    void register_default_symbols() {
        symbol_registry_->register_symbol("BTCUSDT", "BTC", "USDT");
        symbol_registry_->register_symbol("ETHUSDT", "ETH", "USDT");
        symbol_registry_->register_symbol("BNBUSDT", "BNB", "USDT");
        symbol_registry_->register_symbol("SOLUSDT", "SOL", "USDT");
        symbol_registry_->register_symbol("XRPUSDT", "XRP", "USDT");
    }
    
    // Start the engine
    bool start() {
        if (running_) return false;
        
        running_ = true;
        
        // Initialize order books for registered symbols
        auto symbols = symbol_registry_->get_all_symbols();
        for (const auto& sym : symbols) {
            order_books_[sym.id] = std::make_unique<OrderBook>(sym.id);
        }
        
        return true;
    }
    
    // Stop the engine
    void stop() {
        running_ = false;
    }
    
    // Submit order
    std::optional<OrderId> submit_order(
        UserId user_id,
        const std::string& symbol,
        OrderSide side,
        OrderType type,
        Quantity quantity,
        Price price = 0,
        Price stop_price = 0,
        TimeInForce tif = TimeInForce::GTC
    ) {
        if (!running_) return std::nullopt;
        
        // Get symbol ID
        auto symbol_id_opt = symbol_registry_->get_symbol_id(symbol);
        if (!symbol_id_opt) {
            if (on_error_) on_error_("Invalid symbol: " + symbol);
            return std::nullopt;
        }
        SymbolId symbol_id = *symbol_id_opt;
        
        // Check risk
        if (!risk_engine_->check_order_risk(user_id, price, quantity, side)) {
            if (on_error_) on_error_("Risk check failed for user " + std::to_string(user_id));
            return std::nullopt;
        }
        
        // Allocate order from pool
        Order* order = order_pool_->allocate();
        if (!order) {
            if (on_error_) on_error_("Order pool exhausted");
            return std::nullopt;
        }
        
        // Initialize order
        OrderId order_id = generate_order_id();
        order->order_id = order_id;
        order->user_id = user_id;
        order->symbol_id = symbol_id;
        order->side = side;
        order->type = type;
        order->quantity = quantity;
        order->remaining_quantity = quantity;
        order->price = price;
        order->stop_price = stop_price;
        order->tif = tif;
        order->status = OrderStatus::New;
        order->created_at = get_timestamp_ns();
        order->updated_at = order->created_at;
        
        // Store order
        {
            std::unique_lock lock(orders_mutex_);
            orders_by_id_[order_id] = order;
        }
        
        // Process order
        if (type == OrderType::Market) {
            return process_market_order(order);
        } else {
            return add_to_book(order) ? std::make_optional(order_id) : std::nullopt;
        }
    }
    
    // Cancel order
    bool cancel_order(OrderId order_id) {
        std::unique_lock lock(orders_mutex_);
        
        auto it = orders_by_id_.find(order_id);
        if (it == orders_by_id_.end()) {
            return false;
        }
        
        Order* order = it->second;
        
        if (order->status == OrderStatus::Filled || 
            order->status == OrderStatus::Cancelled) {
            return false;
        }
        
        // Remove from book
        if (order->status == OrderStatus::New || 
            order->status == OrderStatus::PartiallyFilled) {
            {
                std::shared_lock lock(books_mutex_);
                auto book_it = order_books_.find(order->symbol_id);
                if (book_it != order_books_.end()) {
                    book_it->second->remove_order(order_id, order->price, order->side);
                }
            }
        }
        
        order->status = OrderStatus::Cancelled;
        order->updated_at = get_timestamp_ns();
        
        risk_engine_->record_cancel(order->user_id);
        
        if (on_order_update_) on_order_update_(*order);
        
        return true;
    }
    
    // Get order
    std::optional<Order> get_order(OrderId order_id) const {
        std::shared_lock lock(orders_mutex_);
        
        auto it = orders_by_id_.find(order_id);
        if (it == orders_by_id_.end()) {
            return std::nullopt;
        }
        
        return *it->second;
    }
    
    // Get order book depth
    void get_order_book(const std::string& symbol, size_t levels,
                       std::vector<OrderBookLevel>& bids,
                       std::vector<OrderBookLevel>& asks) const {
        auto symbol_id_opt = symbol_registry_->get_symbol_id(symbol);
        if (!symbol_id_opt) return;
        
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(*symbol_id_opt);
        if (it != order_books_.end()) {
            it->second->get_depth(levels, bids, asks);
        }
    }
    
    // Get performance metrics
    struct Metrics {
        uint64_t total_orders;
        uint64_t total_trades;
        uint64_t total_volume;
        size_t active_orders;
        size_t order_pool_used;
    };
    
    Metrics get_metrics() const {
        std::shared_lock lock(orders_mutex_);
        return Metrics{
            total_orders_.load(),
            total_trades_.load(),
            total_volume_.load(),
            orders_by_id_.size(),
            order_pool_->used()
        };
    }
    
    // Set callbacks
    void set_trade_callback(std::function<void(const Trade&)> callback) {
        on_trade_ = callback;
    }
    
    void set_order_callback(std::function<void(const Order&)> callback) {
        on_order_update_ = callback;
    }
    
    void set_error_callback(std::function<void(const std::string&)> callback) {
        on_error_ = callback;
    }
    
private:
    // Generate unique order ID
    OrderId generate_order_id() {
        static std::atomic<OrderId> counter{1};
        Timestamp ts = get_timestamp_ns();
        return (ts << 20) | (counter.fetch_add(1) & 0xFFFFF);
    }
    
    // Process market order
    std::optional<OrderId> process_market_order(Order* order) {
        // The book pointer is taken under a short lock; the book then
        // synchronises its own state. Holding books_mutex_ across the trade
        // would invert the lock order used by cancel_order and risk a deadlock.
        OrderBook* book = nullptr;
        {
            std::shared_lock lock(books_mutex_);
            auto it = order_books_.find(order->symbol_id);
            if (it == order_books_.end()) {
                return std::nullopt;
            }
            book = it->second.get();
        }

        auto fills = book->take(order->side, order->remaining_quantity);

        if (fills.empty()) {
            order->status = OrderStatus::Rejected;
            order->updated_at = get_timestamp_ns();
            if (on_order_update_) on_order_update_(*order);
            return std::nullopt;
        }

        for (const auto& fill : fills) {
            execute_trade(order, fill.maker_order_id, fill.price, fill.quantity);
        }

        order->status = order->remaining_quantity > 0
            ? OrderStatus::PartiallyFilled
            : OrderStatus::Filled;
        order->updated_at = get_timestamp_ns();

        if (on_order_update_) on_order_update_(*order);

        return order->order_id;
    }

    // Add order to book
    bool add_to_book(Order* order) {
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(order->symbol_id);
        if (it == order_books_.end()) {
            return false;
        }
        
        return it->second->add_order(order);
    }
    
    // Execute trade against a resting order. The maker order is updated too,
    // and the trade counter is advanced exactly once per fill.
    void execute_trade(Order* taker, OrderId maker_order_id,
                       Price price, Quantity quantity) {
        if (quantity <= 0 || taker->remaining_quantity < quantity) {
            return;
        }

        // Average fill price must use the pre-trade filled quantity.
        taker->average_fill_price =
            ((taker->average_fill_price * taker->filled_quantity) + (price * quantity)) /
            (taker->filled_quantity + quantity);
        taker->filled_quantity += quantity;
        taker->remaining_quantity -= quantity;

        Order* maker = nullptr;
        {
            std::shared_lock lock(orders_mutex_);
            auto it = orders_by_id_.find(maker_order_id);
            if (it != orders_by_id_.end()) {
                maker = it->second;
            }
        }

        if (maker != nullptr) {
            maker->filled_quantity += quantity;
            maker->remaining_quantity -= quantity;
            maker->average_fill_price = price;
            maker->status = maker->remaining_quantity > 0
                ? OrderStatus::PartiallyFilled
                : OrderStatus::Filled;
            maker->updated_at = get_timestamp_ns();
        }

        Trade trade;
        trade.trade_id = total_trades_.fetch_add(1) + 1;
        trade.match_id = static_cast<uint32_t>(trade.trade_id);
        trade.order_id = taker->order_id;
        trade.counter_order_id = maker_order_id;
        trade.symbol_id = taker->symbol_id;
        trade.side = taker->side;
        trade.price = price;
        trade.quantity = quantity;
        trade.leaves_quantity = taker->remaining_quantity;
        trade.executed_at = get_timestamp_ns();

        total_volume_.fetch_add(static_cast<uint64_t>(price) *
                                static_cast<uint64_t>(quantity));

        risk_engine_->record_order(taker->user_id, price, quantity);

        if (on_trade_) on_trade_(trade);
        if (maker != nullptr && on_order_update_) on_order_update_(*maker);
    }
};

} // namespace hft
} // namespace tigerex

#endif // TIGEREX_HFT_ENGINE_HPP
