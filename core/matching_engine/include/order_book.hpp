/**
 * TigerEx C++ Matching Engine
 * Ultra-low latency order matching for cryptocurrency exchange
 * Target latency: <50 microseconds
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_MATCHING_ENGINE_HPP
#define TIGEREX_MATCHING_ENGINE_HPP

#include <array>
#include <atomic>
#include <cstdint>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <queue>
#include <shared_mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>
#include <functional>
#include <variant>
#include <chrono>
#include <algorithm>
#include <numeric>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <fstream>
#include <map>

// Platform-specific optimizations
#ifdef __linux__
    #include <linux/futex.h>
    #include <sys/syscall.h>
    #define likely(x) __builtin_expect(!!(x), 1)
    #define unlikely(x) __builtin_expect(!!(x), 0)
#else
    #define likely(x) (x)
    #define unlikely(x) !(x)
#endif

// Constants
namespace tigerex {
namespace matching {

constexpr size_t MAX_ORDERS_PER_MARKET = 10'000'000;
constexpr size_t MAX_PRICE_LEVELS = 100'000;
constexpr uint32_t MAX_ORDER_ID = 4'294'967'295;
constexpr uint64_t MAX_QUANTITY = 999'999'999'999'999ULL;
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 100;
constexpr size_t ORDER_POOL_SIZE = 1'000'000;

// Price precision levels
enum class PricePrecision : uint8_t {
    PRECISION_0 = 0,   // No decimal
    PRECISION_1 = 1,   // 0.1
    PRECISION_2 = 2,   // 0.01
    PRECISION_3 = 3,   // 0.001
    PRECISION_4 = 4,   // 0.0001
    PRECISION_5 = 5,   // 0.00001
    PRECISION_6 = 6,   // 0.000001
    PRECISION_7 = 7,   // 0.0000001
    PRECISION_8 = 8    // 0.00000001
};

// Order side
enum class Side : uint8_t {
    BUY = 0,
    SELL = 1
};

// Order type
enum class OrderType : uint8_t {
    MARKET = 0,
    LIMIT = 1,
    STOP_LOSS = 2,
    STOP_LIMIT = 3,
    TAKE_PROFIT = 4,
    TAKE_PROFIT_LIMIT = 5,
    OCO = 6,           // One Cancels Other
    OTO = 7,          // One Triggers Other
    TRAILING_STOP = 8,
    ICEBERG = 9,
    TWAP = 10,         // Time Weighted Average Price
    VWAP = 11,         // Volume Weighted Average Price
    GTC = 12,          // Good Till Cancel
    FOK = 13,         // Fill Or Kill
    IOC = 14           // Immediate Or Cancel
};

// Order status
enum class OrderStatus : uint8_t {
    PENDING = 0,
    NEW = 1,
    PARTIALLY_FILLED = 2,
    FILLED = 3,
    CANCELLED = 4,
    REJECTED = 5,
    EXPIRED = 6
};

// Time in force
enum class TimeInForce : uint8_t {
    GTC = 0,  // Good Till Cancel
    GTD = 1,  // Good Till Date
    IOC = 2,  // Immediate Or Cancel
    FOK = 3,  // Fill Or Kill
    GTX = 4   // Good Till Execute (Maker only)
};

// Order reject reason
enum class RejectReason : uint8_t {
    NONE = 0,
    INVALID_ORDER = 1,
    INSUFFICIENT_BALANCE = 2,
    PRICE_OUT_OF_RANGE = 3,
    QUANTITY_TOO_SMALL = 4,
    QUANTITY_TOO_LARGE = 5,
    MAX_ORDERS_EXCEEDED = 6,
    DUPLICATE_ORDER = 7,
    MARKET_CLOSED = 8,
    RISK_CHECK_FAILED = 9,
    POST_ONLY_WOULD_MATCH = 10,
    INVALID_STOP_PRICE = 11,
    CANCEL_BEFORE_FILL = 12,
    USER_NOT_FOUND = 13,
    TRADING_DISABLED = 14
};

// Trade transaction type
enum class TradeType : uint8_t {
    TRADE = 0,
    FEE = 1,
    ADJUSTMENT = 2,
    LIQUIDATION = 3,
    SETTLEMENT = 4
};

// Order ID generator with lock-free design
class OrderIdGenerator {
private:
    std::atomic<uint32_t> current_id_{0};
    std::atomic<uint64_t> sequence_{0};

public:
    uint32_t next_id() {
        uint64_t seq = sequence_.fetch_add(1, std::memory_order_relaxed);
        uint32_t id = static_cast<uint32_t>(seq);
        if (id == 0) {
            id = static_cast<uint32_t>(sequence_.fetch_add(1, std::memory_order_relaxed));
        }
        return id;
    }
    
    void set_current_id(uint32_t id) {
        uint64_t seq = static_cast<uint64_t>(id);
        sequence_.store(seq, std::memory_order_relaxed);
    }
};

// Price level in order book
struct PriceLevel {
    uint64_t price;
    uint64_t quantity;
    uint32_t orders_count;
    uint64_t last_update_time;
    
    bool operator<(const PriceLevel& other) const {
        return price < other.price;
    }
    
    bool operator>(const PriceLevel& other) const {
        return price > other.price;
    }
};

// Price level comparator for buy orders (descending)
struct BuyPriceComparator {
    bool operator()(const PriceLevel& a, const PriceLevel& b) const {
        return a.price < b.price;  // Higher price = better for buy
    }
};

// Price level comparator for sell orders (ascending)
struct SellPriceComparator {
    bool operator()(const PriceLevel& a, const PriceLevel& b) const {
        return a.price > b.price;  // Lower price = better for sell
    }
};

// Order structure - packed for cache efficiency
struct Order {
    // Order identification
    uint64_t order_id;
    uint64_t user_id;
    uint64_t account_id;
    std::string symbol;
    
    // Order details
    Side side;
    OrderType type;
    OrderStatus status;
    TimeInForce tif;
    
    // Price and quantity
    uint64_t price;
    uint64_t quantity;
    uint64_t filled_quantity;
    uint64_t remaining_quantity;
    uint64_t avg_fill_price;
    
    // Stop prices
    uint64_t stop_price;
    uint64_t trigger_price;
    
    // Iceberg order
    uint64_t visible_quantity;
    uint64_t iceberg_peak;
    
    // TWAP/VWAP
    uint64_t slice_quantity;
    uint32_t max_slice_count;
    uint32_t current_slice;
    
    // Trailing stop
    uint64_t trail_value;
    uint64_t trail_activation_price;
    uint8_t trail_type;  // 0 = percentage, 1 = absolute
    
    // OCO/OTO
    uint64_t linked_order_id;
    bool is_linked_order;
    
    // Timestamps
    uint64_t created_at;
    uint64_t updated_at;
    uint64_t expire_time;
    uint64_t last_trade_time;
    
    // Fees
    uint64_t maker_fee;
    uint64_t taker_fee;
    
    // Flags
    bool is_post_only;
    bool is_reduce_only;
    bool is_iceberg;
    bool is_oco_first;
    bool trigger_on;
    
    // Client order ID
    std::string client_order_id;
    
    // Remarks
    std::string remark;
    
    Order() 
        : order_id(0)
        , user_id(0)
        , account_id(0)
        , side(Side::BUY)
        , type(OrderType::LIMIT)
        , status(OrderStatus::PENDING)
        , tif(TimeInForce::GTC)
        , price(0)
        , quantity(0)
        , filled_quantity(0)
        , remaining_quantity(0)
        , avg_fill_price(0)
        , stop_price(0)
        , trigger_price(0)
        , visible_quantity(0)
        , iceberg_peak(0)
        , slice_quantity(0)
        , max_slice_count(0)
        , current_slice(0)
        , trail_value(0)
        , trail_activation_price(0)
        , trail_type(0)
        , linked_order_id(0)
        , is_linked_order(false)
        , created_at(0)
        , updated_at(0)
        , expire_time(0)
        , last_trade_time(0)
        , maker_fee(0)
        , taker_fee(0)
        , is_post_only(false)
        , is_reduce_only(false)
        , is_iceberg(false)
        , is_oco_first(false)
        , trigger_on(false)
    {}
};

// Trade execution
struct Trade {
    uint64_t trade_id;
    uint64_t order_id;
    uint64_t counter_order_id;
    uint64_t symbol;
    Side side;
    TradeType type;
    uint64_t price;
    uint64_t quantity;
    uint64_t fee;
    uint64_t fee_deducted;
    uint64_t realized_pnl;
    uint64_t created_at;
    bool is_maker;
    bool is_rebate;
    std::string client_order_id;
};

// Market ticker
struct Ticker {
    std::string symbol;
    uint64_t last_price;
    uint64_t bid_price;
    uint64_t ask_price;
    uint64_t bid_quantity;
    uint64_t ask_quantity;
    uint64_t volume24h;
    uint64_t quote_volume24h;
    uint64_t price_change24h;
    uint64_t price_change_percent24h;
    uint64_t high24h;
    uint64_t low24h;
    uint64_t open_price;
    uint64_t trades_count;
    uint64_t created_at;
    uint64_t updated_at;
};

// Kline/Candlestick
struct Kline {
    std::string symbol;
    uint64_t open_time;
    uint64_t close_time;
    uint64_t open;
    uint64_t high;
    uint64_t low;
    uint64_t close;
    uint64_t volume;
    uint64_t quote_volume;
    uint64_t trades_count;
    bool is_closed;
};

// Depth market
struct Depth {
    std::string symbol;
    uint64_t last_update_id;
    std::vector<PriceLevel> bids;
    std::vector<PriceLevel> asks;
};

// Order book
class OrderBook {
private:
    std::string symbol_;
    uint32_t price_precision_;
    uint32_t quantity_precision_;
    
    // Price levels - using sorted vectors for cache efficiency
    std::vector<PriceLevel> bid_levels_;
    std::vector<PriceLevel> ask_levels_;
    
    // Order maps for quick lookup
    std::unordered_map<uint64_t, Order> bid_orders_;
    std::unordered_map<uint64_t, Order> ask_orders_;
    
    // Price aggregation
    std::map<uint64_t, std::vector<uint64_t>> bid_aggregations_;
    std::map<uint64_t, std::vector<uint64_t>> ask_aggregations_;
    
    // Mutexes
    mutable std::shared_mutex bid_mutex_;
    mutable std::shared_mutex ask_mutex_;
    
    // Stats
    std::atomic<uint64_t> last_update_id_{0};
    std::atomic<uint64_t> bids_quantity_{0};
    std::atomic<uint64_t> asks_quantity_{0};
    std::atomic<uint32_t> bids_count_{0};
    std::atomic<uint32_t> asks_count_{0};
    
public:
    OrderBook(const std::string& symbol, uint32_t price_precision = 8, uint32_t quantity_precision = 8)
        : symbol_(symbol)
        , price_precision_(price_precision)
        , quantity_precision_(quantity_precision)
    {
        bid_levels_.reserve(MAX_PRICE_LEVELS);
        ask_levels_.reserve(MAX_PRICE_LEVELS);
        bid_orders_.reserve(100000);
        ask_orders_.reserve(100000);
    }
    
    // Getters
    const std::string& symbol() const { return symbol_; }
    uint32_t price_precision() const { return price_precision_; }
    uint32_t quantity_precision() const { return quantity_precision_; }
    uint64_t last_update_id() const { return last_update_id_.load(); }
    uint64_t bids_quantity() const { return bids_quantity_.load(); }
    uint64_t asks_quantity() const { return asks_quantity_.load(); }
    uint32_t bids_count() const { return bids_count_.load(); }
    uint32_t asks_count() const { return asks_count_.load(); }
    
    // Best bid/ask
    std::pair<uint64_t, uint64_t> best_bid() const {
        std::shared_lock lock(bid_mutex_);
        if (bid_levels_.empty()) return {0, 0};
        return {bid_levels_[0].price, bid_levels_[0].quantity};
    }
    
    std::pair<uint64_t, uint64_t> best_ask() const {
        std::shared_lock lock(ask_mutex_);
        if (ask_levels_.empty()) return {0, 0};
        return {ask_levels_[0].price, ask_levels_[0].quantity};
    }
    
    // Spread
    uint64_t spread() const {
        auto [bid, bid_q] = best_bid();
        auto [ask, ask_q] = best_ask();
        if (bid == 0 || ask == 0) return 0;
        return ask - bid;
    }
    
    // Mid price
    double mid_price() const {
        auto [bid, bid_q] = best_bid();
        auto [ask, ask_q] = best_ask();
        if (bid == 0 || ask == 0) return 0.0;
        return static_cast<double>(bid + ask) / 2.0;
    }
    
    // Add order
    bool add_order(Order& order) {
        if (order.side == Side::BUY) {
            std::unique_lock lock(bid_mutex_);
            return add_order_internal(order, bid_orders_, bid_levels_);
        } else {
            std::unique_lock lock(ask_mutex_);
            return add_order_internal(order, ask_orders_, ask_levels_);
        }
    }
    
    // Cancel order
    bool cancel_order(uint64_t order_id, Side side) {
        if (side == Side::BUY) {
            std::unique_lock lock(bid_mutex_);
            return cancel_order_internal(order_id, bid_orders_, bid_levels_);
        } else {
            std::unique_lock lock(ask_mutex_);
            return cancel_order_internal(order_id, ask_orders_, ask_levels_);
        }
    }
    
    // Modify order
    bool modify_order(uint64_t order_id, Side side, uint64_t new_price, uint64_t new_quantity) {
        if (side == Side::BUY) {
            std::unique_lock lock(bid_mutex_);
            return modify_order_internal(order_id, new_price, new_quantity, bid_orders_, bid_levels_);
        } else {
            std::unique_lock lock(ask_mutex_);
            return modify_order_internal(order_id, new_price, new_quantity, ask_orders_, ask_levels_);
        }
    }
    
    // Get order
    std::optional<Order> get_order(uint64_t order_id, Side side) const {
        if (side == Side::BUY) {
            std::shared_lock lock(bid_mutex_);
            auto it = bid_orders_.find(order_id);
            if (it != bid_orders_.end()) {
                return it->second;
            }
        } else {
            std::shared_lock lock(ask_mutex_);
            auto it = ask_orders_.find(order_id);
            if (it != ask_orders_.end()) {
                return it->second;
            }
        }
        return std::nullopt;
    }
    
    // Match orders - returns vector of trades
    std::vector<Trade> match_orders(Order& order) {
        std::vector<Trade> trades;
        
        if (order.side == Side::BUY) {
            std::unique_lock lock(ask_mutex_);
            match_order_internal(order, ask_orders_, ask_levels_, trades);
        } else {
            std::unique_lock lock(bid_mutex_);
            match_order_internal(order, bid_orders_, bid_levels_, trades);
        }
        
        return trades;
    }
    
    // Get depth
    Depth get_depth(uint32_t limit = 100) const {
        Depth depth;
        depth.symbol = symbol_;
        depth.last_update_id = last_update_id_.load();
        
        {
            std::shared_lock lock(bid_mutex_);
            uint32_t count = std::min(limit, static_cast<uint32_t>(bid_levels_.size()));
            depth.bids.reserve(count);
            for (uint32_t i = 0; i < count; ++i) {
                depth.bids.push_back(bid_levels_[i]);
            }
        }
        
        {
            std::shared_lock lock(ask_mutex_);
            uint32_t count = std::min(limit, static_cast<uint32_t>(ask_levels_.size()));
            depth.asks.reserve(count);
            for (uint32_t i = 0; i < count; ++i) {
                depth.asks.push_back(ask_levels_[i]);
            }
        }
        
        return depth;
    }
    
private:
    bool add_order_internal(Order& order, 
                          std::unordered_map<uint64_t, Order>& orders,
                          std::vector<PriceLevel>& levels) {
        auto it = orders.find(order.order_id);
        if (it != orders.end()) {
            return false;  // Order already exists
        }
        
        // Insert order
        orders[order.order_id] = order;
        
        // Update price level
        update_price_level(levels, order.price, order.remaining_quantity, true);
        
        last_update_id_.fetch_add(1);
        
        if (order.side == Side::BUY) {
            bids_count_.fetch_add(1);
            bids_quantity_.fetch_add(order.remaining_quantity);
        } else {
            asks_count_.fetch_add(1);
            asks_quantity_.fetch_add(order.remaining_quantity);
        }
        
        return true;
    }
    
    bool cancel_order_internal(uint64_t order_id,
                       std::unordered_map<uint64_t, Order>& orders,
                       std::vector<PriceLevel>& levels) {
        auto it = orders.find(order_id);
        if (it == orders.end()) {
            return false;
        }
        
        Order& order = it->second;
        
        // Update quantity
        update_price_level(levels, order.price, order.remaining_quantity, false);
        
        // Remove order
        orders.erase(it);
        
        last_update_id_.fetch_add(1);
        
        if (order.side == Side::BUY) {
            bids_count_.fetch_sub(1);
        } else {
            asks_count_.fetch_sub(1);
        }
        
        return true;
    }
    
    bool modify_order_internal(uint64_t order_id,
                             uint64_t new_price,
                             uint64_t new_quantity,
                             std::unordered_map<uint64_t, Order>& orders,
                             std::vector<PriceLevel>& levels) {
        auto it = orders.find(order_id);
        if (it == orders.end()) {
            return false;
        }
        
        Order& order = it->second;
        uint64_t old_price = order.price;
        uint64_t old_quantity = order.remaining_quantity;
        
        // Update price level - remove old
        update_price_level(levels, old_price, old_quantity, false);
        
        // Update order
        order.price = new_price;
        order.quantity = new_quantity;
        order.remaining_quantity = new_quantity;
        order.updated_at = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
        
        // Update price level - add new
        update_price_level(levels, new_price, new_quantity, true);
        
        last_update_id_.fetch_add(1);
        
        return true;
    }
    
    void match_order_internal(Order& order,
                          std::unordered_map<uint64_t, Order>& counter_orders,
                          std::vector<PriceLevel>& levels,
                          std::vector<Trade>& trades) {
        if (order.type == OrderType::MARKET) {
            // Market order - match at any price
            match_market_order(order, counter_orders, levels, trades);
        } else {
            // Limit order - match at limit price or better
            match_limit_order(order, counter_orders, levels, trades);
        }
    }
    
    void match_market_order(Order& order,
                         std::unordered_map<uint64_t, Order>& counter_orders,
                         std::vector<PriceLevel>& levels,
                         std::vector<Trade>& trades) {
        uint64_t remaining = order.remaining_quantity;
        
        for (auto it = levels.begin(); it != levels.end() && remaining > 0; ++it) {
            PriceLevel& level = *it;
            
            // Check if price is acceptable
            bool price_ok = (order.side == Side::BUY) ? 
                (level.price <= order.price) : 
                (level.price >= order.price);
            
            if (!price_ok) break;
            
            // Match against orders at this level
            std::vector<uint64_t> orders_to_remove;
            for (auto& [order_id, counter_order] : counter_orders) {
                if (remaining == 0) break;
                
                uint64_t match_qty = std::min(remaining, counter_order.remaining_quantity);
                
                // Create trade
                Trade trade;
                trade.trade_id = 0;  // Will be assigned by engine
                trade.order_id = order.order_id;
                trade.counter_order_id = counter_order.order_id;
                trade.symbol = 0;  // Will be assigned
                trade.side = order.side;
                trade.type = TradeType::TRADE;
                trade.price = level.price;
                trade.quantity = match_qty;
                trade.fee = 0;  // Calculated by engine
                trade.fee_deducted = 0;
                trade.realized_pnl = 0;
                trade.created_at = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()
                ).count();
                trade.is_maker = order.side == Side::SELL;
                
                trades.push_back(trade);
                
                // Update remaining quantities
                counter_order.remaining_quantity -= match_qty;
                remaining -= match_qty;
                order.filled_quantity += match_qty;
                
                if (counter_order.remaining_quantity == 0) {
                    orders_to_remove.push_back(order_id);
                }
            }
            
            // Remove fully filled orders
            for (const auto& order_id : orders_to_remove) {
                counter_orders.erase(order_id);
            }
            
            // Update level
            level.quantity = 0;
        }
        
        order.remaining_quantity = remaining;
    }
    
    void match_limit_order(Order& order,
                      std::unordered_map<uint64_t, Order>& counter_orders,
                      std::vector<PriceLevel>& levels,
                      std::vector<Trade>& trades) {
        uint64_t remaining = order.remaining_quantity;
        
        for (auto it = levels.begin(); it != levels.end() && remaining > 0; ++it) {
            PriceLevel& level = *it;
            
            // Check price priority
            bool price_ok = (order.side == Side::BUY) ?
                (level.price <= order.price) :
                (level.price >= order.price);
            
            if (!price_ok) break;
            
            // Match at level price (not order price)
            uint64_t match_price = level.price;
            
            // Similar matching logic as market order...
            // (simplified for brevity)
        }
        
        order.remaining_quantity = remaining;
    }
    
    void update_price_level(std::vector<PriceLevel>& levels, 
                         uint64_t price, 
                         uint64_t quantity, 
                         bool add) {
        if (add) {
            // Add or update price level
            bool found = false;
            for (auto& level : levels) {
                if (level.price == price) {
                    level.quantity += quantity;
                    level.orders_count += 1;
                    level.last_update_time = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch()
                    ).count();
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                PriceLevel new_level;
                new_level.price = price;
                new_level.quantity = quantity;
                new_level.orders_count = 1;
                new_level.last_update_time = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()
                ).count();
                
                // Insert in sorted order
                if (levels.empty() || price > levels[0].price) {
                    levels.insert(levels.begin(), new_level);
                } else {
                    levels.push_back(new_level);
                    std::sort(levels.begin(), levels.end(), [](const PriceLevel& a, const PriceLevel& b) {
                        return a.price > b.price;
                    });
                }
            }
        } else {
            // Remove or update price level
            for (auto it = levels.begin(); it != levels.end(); ++it) {
                if (it->price == price) {
                    if (it->quantity >= quantity) {
                        it->quantity -= quantity;
                        it->orders_count -= 1;
                    }
                    
                    if (it->quantity == 0 || it->orders_count == 0) {
                        levels.erase(it);
                    }
                    break;
                }
            }
        }
    }
};

// Market data manager
class MarketDataManager {
private:
    std::unordered_map<std::string, std::unique_ptr<OrderBook>> order_books_;
    std::unordered_map<std::string, Ticker> tickers_;
    std::unordered_map<std::string, std::deque<Kline>> klines_;
    mutable std::shared_mutex mutex_;

public:
    // Create or get order book
    OrderBook* get_or_create_order_book(const std::string& symbol, 
                                   uint32_t price_precision = 8,
                                   uint32_t quantity_precision = 8) {
        std::unique_lock lock(mutex_);
        
        auto it = order_books_.find(symbol);
        if (it != order_books_.end()) {
            return it->second.get();
        }
        
        auto order_book = std::make_unique<OrderBook>(symbol, price_precision, quantity_precision);
        OrderBook* ptr = order_book.get();
        order_books_[symbol] = std::move(order_book);
        
        return ptr;
    }
    
    // Get order book
    OrderBook* get_order_book(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        
        auto it = order_books_.find(symbol);
        if (it != order_books_.end()) {
            return it->second.get();
        }
        
        return nullptr;
    }
    
    // Update ticker
    void update_ticker(const Ticker& ticker) {
        std::unique_lock lock(mutex_);
        tickers_[ticker.symbol] = ticker;
    }
    
    // Get ticker
    std::optional<Ticker> get_ticker(const std::string& symbol) const {
        std::shared_lock lock(mutex_);
        
        auto it = tickers_.find(symbol);
        if (it != tickers_.end()) {
            return it->second;
        }
        
        return std::nullopt;
    }
    
    // Add kline
    void add_kline(const std::string& symbol, const Kline& kline) {
        std::unique_lock lock(mutex_);
        
        auto& klineDeque = klines_[symbol];
        klineDeque.push_back(kline);
        
        // Keep only last 1000 klines
        if (klineDeque.size() > 1000) {
            klineDeque.pop_front();
        }
    }
    
    // Get klines
    std::vector<Kline> get_klines(const std::string& symbol, uint32_t limit = 100) const {
        std::shared_lock lock(mutex_);
        
        auto it = klines_.find(symbol);
        if (it == klines_.end()) {
            return {};
        }
        
        std::vector<Kline> result;
        const auto& klineDeque = it->second;
        
        uint32_t count = std::min(limit, static_cast<uint32_t>(klineDeque.size()));
        result.reserve(count);
        
        auto it_start = klineDeque.end() - count;
        for (auto it = it_start; it != klineDeque.end(); ++it) {
            result.push_back(*it);
        }
        
        return result;
    }
};

// Order request
struct OrderRequest {
    uint64_t user_id;
    uint64_t account_id;
    std::string symbol;
    Side side;
    OrderType type;
    TimeInForce tif;
    uint64_t price;
    uint64_t quantity;
    uint64_t stop_price;
    uint64_t trigger_price;
    bool is_post_only;
    bool is_reduce_only;
    std::string client_order_id;
    std::string remark;
    uint64_t expire_time;
    
    OrderRequest()
        : user_id(0)
        , account_id(0)
        , side(Side::BUY)
        , type(OrderType::LIMIT)
        , tif(TimeInForce::GTC)
        , price(0)
        , quantity(0)
        , stop_price(0)
        , trigger_price(0)
        , is_post_only(false)
        , is_reduce_only(false)
        , expire_time(0)
    {}
};

// Order response
struct OrderResponse {
    uint64_t order_id;
    OrderStatus status;
    RejectReason reject_reason;
    std::string reject_text;
    uint64_t filled_quantity;
    uint64_t avg_fill_price;
    uint64_t commission;
    uint64_t created_at;
    
    OrderResponse()
        : order_id(0)
        , status(OrderStatus::PENDING)
        , reject_reason(RejectReason::NONE)
        , filled_quantity(0)
        , avg_fill_price(0)
        , commission(0)
        , created_at(0)
    {}
};

// Trade notification
struct TradeNotification {
    uint64_t order_id;
    uint64_t trade_id;
    uint64_t price;
    uint64_t quantity;
    uint64_t fee;
    uint64_t realized_pnl;
    Side side;
    uint64_t created_at;
    bool is_maker;
};

// Risk check result
struct RiskCheckResult {
    bool passed;
    std::string reason;
    uint64_t max_quantity;
    uint64_t max_order_value;
    uint8_t risk_level;
};

// User account balance
struct AccountBalance {
    uint64_t user_id;
    uint64_t account_id;
    std::string asset;
    uint64_t free;
    uint64_t locked;
    uint64_t total;
    
    AccountBalance() : user_id(0), account_id(0), free(0), locked(0), total(0) {}
};

// Balance manager
class BalanceManager {
private:
    struct AssetBalance {
        uint64_t free;
        uint64_t locked;
    };
    
    // user_id -> (asset -> balance)
    std::unordered_map<uint64_t, std::unordered_map<std::string, AssetBalance>> balances_;
    mutable std::shared_mutex mutex_;

public:
    // Get balance
    AccountBalance get_balance(uint64_t user_id, const std::string& asset) const {
        std::shared_lock lock(mutex_);
        
        AccountBalance balance;
        balance.user_id = user_id;
        balance.asset = asset;
        
        auto it = balances_.find(user_id);
        if (it != balances_.end()) {
            auto asset_it = it->second.find(asset);
            if (asset_it != it->second.end()) {
                balance.free = asset_it->second.free;
                balance.locked = asset_it->second.locked;
                balance.total = balance.free + balance.locked;
            }
        }
        
        return balance;
    }
    
    // Lock balance
    bool lock_balance(uint64_t user_id, const std::string& asset, uint64_t quantity) {
        std::unique_lock lock(mutex_);
        
        auto& user_balances = balances_[user_id];
        auto& asset_balance = user_balances[asset];
        
        if (asset_balance.free < quantity) {
            return false;
        }
        
        asset_balance.free -= quantity;
        asset_balance.locked += quantity;
        
        return true;
    }
    
    // Unlock balance
    void unlock_balance(uint64_t user_id, const std::string& asset, uint64_t quantity) {
        std::unique_lock lock(mutex_);
        
        auto it = balances_.find(user_id);
        if (it == balances_.end()) return;
        
        auto asset_it = it->second.find(asset);
        if (asset_it == it->second.end()) return;
        
        if (asset_it->second.locked >= quantity) {
            asset_it->second.locked -= quantity;
            asset_it->second.free += quantity;
        }
    }
    
    // Deduct balance
    bool deduct_balance(uint64_t user_id, const std::string& asset, uint64_t quantity) {
        std::unique_lock lock(mutex_);
        
        auto& user_balances = balances_[user_id];
        auto& asset_balance = user_balances[asset];
        
        uint64_t available = asset_balance.free + asset_balance.locked;
        if (available < quantity) {
            return false;
        }
        
        if (asset_balance.locked >= quantity) {
            asset_balance.locked -= quantity;
        } else {
            uint64_t remaining = quantity - asset_balance.locked;
            asset_balance.locked = 0;
            asset_balance.free -= remaining;
        }
        
        return true;
    }
    
    // Add balance
    void add_balance(uint64_t user_id, const std::string& asset, uint64_t quantity) {
        std::unique_lock lock(mutex_);
        
        auto& user_balances = balances_[user_id];
        auto& asset_balance = user_balances[asset];
        asset_balance.free += quantity;
    }
    
    // Initialize balance
    void init_balance(uint64_t user_id, const std::string& asset, uint64_t free, uint64_t locked = 0) {
        std::unique_lock lock(mutex_);
        
        auto& user_balances = balances_[user_id];
        auto& asset_balance = user_balances[asset];
        asset_balance.free = free;
        asset_balance.locked = locked;
    }
};

// Position
struct Position {
    uint64_t user_id;
    uint64_t account_id;
    std::string symbol;
    Side side;
    uint64_t quantity;
    uint64_t entry_price;
    uint64_t mark_price;
    uint64_t unrealized_pnl;
    uint64_t realized_pnl;
    uint64_t leverage;
    uint64_t margin;
    uint64_t liquidation_price;
    
    Position() 
        : user_id(0)
        , account_id(0)
        , side(Side::BUY)
        , quantity(0)
        , entry_price(0)
        , mark_price(0)
        , unrealized_pnl(0)
        , realized_pnl(0)
        , leverage(100)
        , margin(0)
        , liquidation_price(0)
    {}
};

} // namespace matching
} // namespace tigerex

#endif // TIGEREX_MATCHING_ENGINE_HPP