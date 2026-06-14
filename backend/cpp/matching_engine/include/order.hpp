/**
 * TigerEx C++ Matching Engine
 * High-Performance Order Management
 * Target Latency: < 50 microseconds
 * 
 * @author TigerEx Team
 * @date June 2026
 */

#ifndef TIGEREX_ORDER_HPP
#define TIGEREX_ORDER_HPP

#include <atomic>
#include <cstdint>
#include <chrono>
#include <string>
#include <variant>
#include <optional>
#include <array>

namespace tigerex {

// ============================================================================
// ORDER TYPES
// ============================================================================

enum class OrderSide : uint8_t {
    Buy = 0,
    Sell = 1
};

enum class OrderType : uint8_t {
    Market = 0,
    Limit = 1,
    StopLoss = 2,
    StopLossLimit = 3,
    TakeProfit = 4,
    TakeProfitLimit = 5,
    OCO = 6,          // One Cancels Other
    TrailingStop = 7,
    FillOrKill = 8,
    ImmediateOrCancel = 9,
    GoodTillDate = 10
};

enum class OrderStatus : uint8_t {
    Pending = 0,
    Open = 1,
    PartiallyFilled = 2,
    Filled = 3,
    Cancelled = 4,
    Rejected = 5,
    Expired = 6
};

enum class TimeInForce : uint8_t {
    GoodTillCancel = 0,
    GoodTillTime = 1,
    ImmediateOrCancel = 2,
    FillOrKill = 3,
    PostOnly = 4
};

enum class MarketType : uint8_t {
    Spot = 0,
    Margin = 1,
    Futures = 2,
    LeveragedToken = 3,
    Option = 4
};

// ============================================================================
// PRICE AND QUANTITY PRECISION
// ============================================================================

static constexpr int MAX_PRICE_PRECISION = 12;
static constexpr int MAX_QUANTITY_PRECISION = 12;

// Use fixed-point arithmetic for precision
using Price = std::array<int64_t, 2>;  // [value, precision]
using Quantity = std::array<int64_t, 2>;

// ============================================================================
// ORDER IDENTIFIER
// ============================================================================

struct OrderId {
    uint64_t client_order_id;
    uint64_t server_order_id;
    uint64_t timestamp_ns;
    uint32_t sequence;
    
    bool operator==(const OrderId& other) const {
        return client_order_id == other.client_order_id && 
               server_order_id == other.server_order_id;
    }
    
    bool operator<(const OrderId& other) const {
        return timestamp_ns < other.timestamp_ns;
    }
};

// ============================================================================
// PRICE LEVEL (for order book)
// ============================================================================

struct PriceLevel {
    Price price;
    Quantity total_quantity;
    Quantity visible_quantity;
    uint32_t order_count;
    uint64_t last_update_ns;
    
    PriceLevel() : price({0, 0}), total_quantity({0, 0}), 
                 visible_quantity({0, 0}), order_count(0), last_update_ns(0) {}
};

// ============================================================================
// ORDER DATA STRUCTURE
// ============================================================================

struct Order {
    // Identifiers
    OrderId id;
    std::string symbol;
    OrderSide side;
    OrderType type;
    OrderStatus status;
    MarketType market_type;
    
    // Prices and quantities
    Price price;
    Price stop_price;
    Price trigger_price;
    Quantity quantity;
    Quantity filled_quantity;
    Quantity remaining_quantity;
    Quantity iceberg_visible;
    
    // Time settings
    TimeInForce tif;
    std::chrono::nanoseconds created_at;
    std::chrono::nanoseconds updated_at;
    std::chrono::nanoseconds expire_time;
    
    // Fees
    int64_t fee_currency;
    Price fee_rate;
    Price filled_fee;
    
    // User info
    uint64_t user_id;
    uint32_t account_id;
    uint32_t subaccount_id;
    
    // Risk management
    uint32_t risk_group_id;
    int64_t margin_required;
    
    // OCO (One Cancels Other)
    std::optional<OrderId> oco_link;
    std::optional<OrderId> oco_linked_order;
    
    // Trailing stop
    Price trailing_distance;
    Price trailing_callback_rate;
    
    // Performance tracking
    std::atomic<uint64_t> match_attempts{0};
    std::atomic<uint64_t> last_match_ns{0};
    
    // Constructor
    Order() : 
        side(OrderSide::Buy),
        type(OrderType::Limit),
        status(OrderStatus::Pending),
        market_type(MarketType::Spot),
        tif(TimeInForce::GoodTillCancel),
        created_at(std::chrono::nanoseconds::zero()),
        updated_at(std::chrono::nanoseconds::zero()),
        expire_time(std::chrono::nanoseconds::zero()),
        fee_currency(0),
        filled_fee({0, 0}),
        user_id(0),
        account_id(0),
        subaccount_id(0),
        risk_group_id(0),
        margin_required(0) {}
};

// ============================================================================
// TRADE DATA (immutable after creation)
// ============================================================================

struct Trade {
    OrderId order_id;
    uint64_t trade_id;
    std::string symbol;
    OrderSide side;
    Price price;
    Quantity quantity;
    std::chrono::nanoseconds timestamp;
    uint64_t maker_order_id;
    uint64_t taker_order_id;
    Price fee;
    uint64_t fee_user_id;
    bool isMaker;
    bool isReplaced;  // From order replacement
    std::array<uint8_t, 32> fee_hash;  // For audit
    
    Trade() : trade_id(0), side(OrderSide::Buy), 
              maker_order_id(0), taker_order_id(0),
              fee_user_id(0), isMaker(false), isReplaced(false) {}
};

// ============================================================================
// ORDER BOOK ENTRY
// ============================================================================

struct OrderBookEntry {
    Order order;
    uint64_t insert_time_ns;
    uint32_t priority;  // For FIFO within price level
    
    bool operator<(const OrderBookEntry& other) const {
        if (order.side == OrderSide::Buy) {
            return order.price[0] > other.order.price[0];
        } else {
            return order.price[0] < other.order.price[0];
        }
    }
};

// ============================================================================
// ORDER STATISTICS
// ============================================================================

struct OrderStatistics {
    std::atomic<uint64_t> total_orders{0};
    std::atomic<uint64_t> filled_orders{0};
    std::atomic<uint64_t> cancelled_orders{0};
    std::atomic<uint64_t> rejected_orders{0};
    std::atomic<uint64_t> total_trades{0};
    std::atomic<uint64_t> total_volume{0};
    std::atomic<uint64_t> total_fees{0};
    
    // Latency tracking (nanoseconds)
    std::atomic<uint64_t> min_latency{UINT64_MAX};
    std::atomic<uint64_t> max_latency{0};
    std::atomic<uint64_t> total_latency{0};
    
    void record_latency(uint64_t latency_ns) {
        uint64_t old_min = min_latency.load();
        while (latency_ns < old_min && !min_latency.compare_exchange_weak(old_min, latency_ns)) {}
        
        uint64_t old_max = max_latency.load();
        while (latency_ns > old_max && !max_latency.compare_exchange_weak(old_max, latency_ns)) {}
        
        total_latency.fetch_add(latency_ns);
    }
    
    double average_latency() const {
        uint64_t total = total_latency.load();
        uint64_t count = filled_orders.load();
        return count > 0 ? static_cast<double>(total) / count : 0.0;
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

inline int64_t price_to_int64(const Price& price) {
    return price[0];
}

inline int64_t quantity_to_int64(const Quantity& qty) {
    return qty[0];
}

inline Price int64_to_price(int64_t value, int precision) {
    int64_t factor = 1;
    for (int i = 0; i < precision; ++i) factor *= 10;
    return {value * factor, precision};
}

inline Quantity int64_to_quantity(int64_t value, int precision) {
    int64_t factor = 1;
    for (int i = 0; i < precision; ++i) factor *= 10;
    return {value * factor, precision};
}

inline bool price_less(const Price& a, const Price& b) {
    return a[0] * b[1] < b[0] * a[1];
}

inline bool price_greater(const Price& a, const Price& b) {
    return a[0] * b[1] > b[0] * a[1];
}

inline bool price_equal(const Price& a, const Price& b) {
    return a[0] * b[1] == b[0] * a[1];
}

inline Price price_add(const Price& a, const Price& b) {
    // Simple implementation - in production use proper fixed-point arithmetic
    int64_t result = a[0] + b[0];
    return {result, a[1]};
}

inline Price price_multiply(const Price& a, const Price& b) {
    int64_t result = (a[0] * b[0]) / b[1];
    return {result, a[1]};
}

} // namespace tigerex

#endif // TIGEREX_ORDER_HPP