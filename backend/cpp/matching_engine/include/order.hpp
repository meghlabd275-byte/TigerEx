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
#include <limits>
#include <string>
#include <variant>
#include <optional>
#include <array>
#include <functional>

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
    
    // Prices and quantities. These are std::array<int64_t, 2>; without the
    // braces a default-constructed Order leaves them indeterminate, so an
    // order whose quantity was never set would match on a garbage value.
    Price price{};
    Price stop_price{};
    Price trigger_price{};
    Quantity quantity{};
    Quantity filled_quantity{};
    Quantity remaining_quantity{};
    Quantity iceberg_visible{};
    
    // Time settings
    TimeInForce tif;
    std::chrono::nanoseconds created_at;
    std::chrono::nanoseconds updated_at;
    std::chrono::nanoseconds expire_time;
    
    // Fees
    int64_t fee_currency;
    Price fee_rate{};
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
    
    // Orders contain atomics for instrumentation; define value semantics so
    // snapshots and result vectors can safely copy the non-atomic fields.
    Order(const Order& other)
        : id(other.id), symbol(other.symbol), side(other.side), type(other.type),
          status(other.status), market_type(other.market_type), price(other.price),
          stop_price(other.stop_price), trigger_price(other.trigger_price),
          quantity(other.quantity), filled_quantity(other.filled_quantity),
          remaining_quantity(other.remaining_quantity), iceberg_visible(other.iceberg_visible),
          tif(other.tif), created_at(other.created_at), updated_at(other.updated_at),
          expire_time(other.expire_time), fee_currency(other.fee_currency),
          fee_rate(other.fee_rate), filled_fee(other.filled_fee), user_id(other.user_id),
          account_id(other.account_id), subaccount_id(other.subaccount_id),
          risk_group_id(other.risk_group_id), margin_required(other.margin_required),
          oco_link(other.oco_link), oco_linked_order(other.oco_linked_order),
          trailing_distance(other.trailing_distance), trailing_callback_rate(other.trailing_callback_rate),
          match_attempts(other.match_attempts.load()), last_match_ns(other.last_match_ns.load()) {}
    Order(Order&& other) : Order(static_cast<const Order&>(other)) {}
    Order& operator=(const Order& other) {
        if (this == &other) return *this;
        id=other.id; symbol=other.symbol; side=other.side; type=other.type; status=other.status;
        market_type=other.market_type; price=other.price; stop_price=other.stop_price;
        trigger_price=other.trigger_price; quantity=other.quantity; filled_quantity=other.filled_quantity;
        remaining_quantity=other.remaining_quantity; iceberg_visible=other.iceberg_visible; tif=other.tif;
        created_at=other.created_at; updated_at=other.updated_at; expire_time=other.expire_time;
        fee_currency=other.fee_currency; fee_rate=other.fee_rate; filled_fee=other.filled_fee;
        user_id=other.user_id; account_id=other.account_id; subaccount_id=other.subaccount_id;
        risk_group_id=other.risk_group_id; margin_required=other.margin_required;
        oco_link=other.oco_link; oco_linked_order=other.oco_linked_order;
        trailing_distance=other.trailing_distance; trailing_callback_rate=other.trailing_callback_rate;
        match_attempts.store(other.match_attempts.load()); last_match_ns.store(other.last_match_ns.load());
        return *this;
    }
    Order& operator=(Order&& other) { return *this = static_cast<const Order&>(other); }

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

    // Both sides of a trade are charged: the resting order pays the maker
    // fee and the incoming order pays the taker fee. Each fee names the user
    // it is billed to, so an order's own total is the fee whose user id
    // matches that order.
    Price maker_fee;
    Price taker_fee;
    uint64_t maker_fee_user_id;
    uint64_t taker_fee_user_id;
    bool isMaker;
    bool isReplaced;  // From order replacement
    std::array<uint8_t, 32> fee_hash;  // For audit

    Trade() : trade_id(0), side(OrderSide::Buy),
              maker_order_id(0), taker_order_id(0),
              maker_fee_user_id(0), taker_fee_user_id(0),
              isMaker(false), isReplaced(false) {}
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

int64_t calculate_maker_fee(int64_t price, int64_t quantity);
int64_t calculate_taker_fee(int64_t price, int64_t quantity);
bool is_iceberg_order(const Order& order);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

inline int64_t price_to_int64(const Price& price) {
    return price[0];
}

inline int64_t quantity_to_int64(const Quantity& qty) {
    return qty[0];
}

// Build a fixed-point value from an integer. The precision is clamped to the
// supported range, and a product that would overflow saturates instead of
// wrapping: int64_to_price(INT64_MAX, 8) used to multiply INT64_MAX by 1e8,
// which is undefined behaviour and produced a negative "maximum" price.
inline Price int64_to_price(int64_t value, int precision) {
    if (precision < 0) precision = 0;
    if (precision > MAX_PRICE_PRECISION) precision = MAX_PRICE_PRECISION;
    int64_t factor = 1;
    for (int i = 0; i < precision; ++i) factor *= 10;
    const __int128 scaled = static_cast<__int128>(value) * factor;
    if (scaled > std::numeric_limits<int64_t>::max()) {
        return {std::numeric_limits<int64_t>::max(), precision};
    }
    if (scaled < std::numeric_limits<int64_t>::min()) {
        return {std::numeric_limits<int64_t>::min(), precision};
    }
    return {static_cast<int64_t>(scaled), precision};
}

inline Quantity int64_to_quantity(int64_t value, int precision) {
    if (precision < 0) precision = 0;
    if (precision > MAX_QUANTITY_PRECISION) precision = MAX_QUANTITY_PRECISION;
    int64_t factor = 1;
    for (int i = 0; i < precision; ++i) factor *= 10;
    const __int128 scaled = static_cast<__int128>(value) * factor;
    if (scaled > std::numeric_limits<int64_t>::max()) {
        return {std::numeric_limits<int64_t>::max(), precision};
    }
    if (scaled < std::numeric_limits<int64_t>::min()) {
        return {std::numeric_limits<int64_t>::min(), precision};
    }
    return {static_cast<int64_t>(scaled), precision};
}

// 10^k for 0 <= k <= MAX_PRICE_PRECISION.
inline int64_t pow10_fixed(int k) {
    int64_t result = 1;
    for (int i = 0; i < k; ++i) result *= 10;
    return result;
}

// Compare a[0]/10^a[1] against b[0]/10^b[1] by cross-multiplying. The
// intermediate is widened to __int128 because the int64 product overflows for
// ordinary prices: a market max_price of 9223372036854775807 at precision 8
// times 8 wraps, which silently inverted the comparison and made
// create_market() reject a valid market.
inline bool price_less(const Price& a, const Price& b) {
    const __int128 lhs = static_cast<__int128>(a[0]) * pow10_fixed(b[1]);
    const __int128 rhs = static_cast<__int128>(b[0]) * pow10_fixed(a[1]);
    return lhs < rhs;
}

inline bool price_greater(const Price& a, const Price& b) {
    const __int128 lhs = static_cast<__int128>(a[0]) * pow10_fixed(b[1]);
    const __int128 rhs = static_cast<__int128>(b[0]) * pow10_fixed(a[1]);
    return lhs > rhs;
}

inline bool price_equal(const Price& a, const Price& b) {
    const __int128 lhs = static_cast<__int128>(a[0]) * pow10_fixed(b[1]);
    const __int128 rhs = static_cast<__int128>(b[0]) * pow10_fixed(a[1]);
    return lhs == rhs;
}

/**
 * Rescale a fixed-point value to a target precision. Returns false if the
 * rescale would overflow. A Price is [value, precision] and represents
 * value / 10^precision, so two Prices can only be combined after they share
 * a precision: adding the raw values of 1.50 (150, 2) and 2.5 (25, 1) gives
 * 175 at precision 2, which is 1.75, not 4.0.
 */
inline bool price_rescale(const Price& p, int precision, int64_t& out) {
    if (precision < 0 || precision > MAX_PRICE_PRECISION) return false;
    if (p[1] == precision) {
        out = p[0];
        return true;
    }
    if (precision > p[1]) {
        const int64_t factor = pow10_fixed(precision - p[1]);
        const __int128 scaled = static_cast<__int128>(p[0]) * factor;
        if (scaled > std::numeric_limits<int64_t>::max() ||
            scaled < std::numeric_limits<int64_t>::min()) {
            return false;
        }
        out = static_cast<int64_t>(scaled);
        return true;
    }
    out = p[0] / pow10_fixed(p[1] - precision);
    return true;
}

/**
 * Add two Prices, rescaling to the coarser precision first. Returns false on
 * overflow rather than wrapping. Writes the result to @p out.
 */
inline bool price_add(const Price& a, const Price& b, Price& out) {
    const int precision = a[1] > b[1] ? a[1] : b[1];
    int64_t av = 0;
    int64_t bv = 0;
    if (!price_rescale(a, precision, av)) return false;
    if (!price_rescale(b, precision, bv)) return false;
    const __int128 sum = static_cast<__int128>(av) + bv;
    if (sum > std::numeric_limits<int64_t>::max() ||
        sum < std::numeric_limits<int64_t>::min()) {
        return false;
    }
    out = Price{static_cast<int64_t>(sum), precision};
    return true;
}

/**
 * Subtract two Prices, rescaling to the coarser precision first. Returns
 * false on overflow. Writes the result to @p out.
 */
inline bool price_sub(const Price& a, const Price& b, Price& out) {
    const int precision = a[1] > b[1] ? a[1] : b[1];
    int64_t av = 0;
    int64_t bv = 0;
    if (!price_rescale(a, precision, av)) return false;
    if (!price_rescale(b, precision, bv)) return false;
    const __int128 diff = static_cast<__int128>(av) - bv;
    if (diff > std::numeric_limits<int64_t>::max() ||
        diff < std::numeric_limits<int64_t>::min()) {
        return false;
    }
    out = Price{static_cast<int64_t>(diff), precision};
    return true;
}

/**
 * Multiply two Prices. The product's precision is a's precision, so the raw
 * product is divided by 10^b.precision rather than by b.precision itself.
 * Returns false on overflow.
 */
inline bool price_multiply(const Price& a, const Price& b, Price& out) {
    if (b[1] < 0 || b[1] > MAX_PRICE_PRECISION) return false;
    const __int128 product = static_cast<__int128>(a[0]) * b[0] /
                             pow10_fixed(b[1]);
    if (product > std::numeric_limits<int64_t>::max() ||
        product < std::numeric_limits<int64_t>::min()) {
        return false;
    }
    out = Price{static_cast<int64_t>(product), a[1]};
    return true;
}

/**
 * Divide a Price by an integer, rounding toward zero. Returns false when the
 * divisor is zero. Writes the result to @p out.
 */
inline bool price_divide(const Price& a, int64_t divisor, Price& out) {
    if (divisor == 0) return false;
    out = Price{a[0] / divisor, a[1]};
    return true;
}

} // namespace tigerex

// OrderId equality compares client/server identifiers; the hash must use the
// same identity fields (timestamp and sequence are metadata, not identity).
namespace std {
template <> struct hash<tigerex::OrderId> {
    size_t operator()(const tigerex::OrderId& id) const noexcept {
        const size_t a = hash<uint64_t>{}(id.client_order_id);
        const size_t b = hash<uint64_t>{}(id.server_order_id);
        return a ^ (b + static_cast<size_t>(0x9e3779b97f4a7c15ULL) + (a << 6) + (a >> 2));
    }
};
} // namespace std

#endif // TIGEREX_ORDER_HPP