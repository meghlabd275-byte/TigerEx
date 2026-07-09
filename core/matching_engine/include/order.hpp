#ifndef TIGEREX_ORDER_HPP
#define TIGEREX_ORDER_HPP

#include <string>
#include <cstdint>
#include <memory>
#include <chrono>

namespace tigerex {

// Order Types
enum class OrderType : uint8_t {
    MARKET,
    LIMIT,
    STOP_LOSS,
    STOP_LIMIT,
    TAKE_PROFIT,
    TRAILING_STOP,
    OCO,        // One Cancels the Other
    OTO,        // One Triggers the Other
    ICEBERG,
    TWAP,
    POST_ONLY,
    FOK,        // Fill or Kill
    IOC         // Immediate or Cancel
};

// Order Side
enum class OrderSide : uint8_t {
    BUY,
    SELL
};

// Order Status
enum class OrderStatus : uint8_t {
    PENDING_NEW,
    NEW,
    PARTIALLY_FILLED,
    FILLED,
    CANCELED,
    REJECTED,
    EXPIRED,
    PENDING_CANCEL,
    PENDING_MODIFY
};

// Time in Force
enum class TimeInForce : uint8_t {
    GTC,    // Good Till Cancel
    IOC,    // Immediate or Cancel
    FOK,    // Fill or Kill
    GTX,    // Good Till Cross
    GTT     // Good Till Time
};

// Order represents a trading order in the matching engine
class Order {
public:
    Order() = default;
    
    Order(uint64_t order_id,
          uint64_t user_id,
          const std::string& symbol,
          OrderSide side,
          OrderType type,
          TimeInForce tif,
          int64_t price,
          int64_t quantity,
          int64_t stop_price = 0);

    // Getters
    uint64_t get_order_id() const { return order_id_; }
    uint64_t get_user_id() const { return user_id_; }
    const std::string& get_symbol() const { return symbol_; }
    OrderSide get_side() const { return side_; }
    OrderType get_type() const { return type_; }
    TimeInForce get_tif() const { return tif_; }
    int64_t get_price() const { return price_; }
    int64_t get_quantity() const { return quantity_; }
    int64_t get_filled_quantity() const { return filled_quantity_; }
    int64_t get_remaining_quantity() const { return quantity_ - filled_quantity_; }
    int64_t get_stop_price() const { return stop_price_; }
    int64_t get_avg_fill_price() const { return avg_fill_price_; }
    OrderStatus get_status() const { return status_; }
    uint64_t get_timestamp() const { return timestamp_; }
    uint64_t get_sequence() const { return sequence_; }
    int64_t get_iceberg_quantity() const { return iceberg_quantity_; }
    int64_t get_filled_iceberg() const { return filled_iceberg_; }
    bool is_marketable() const;
    
    // Setters
    void set_status(OrderStatus status) { status_ = status; }
    void add_filled_quantity(int64_t qty, int64_t price);
    void set_canceled(const std::string& reason = "");
    void set_rejected(const std::string& reason = "");
    void set_sequence(uint64_t seq) { sequence_ = seq; }

private:
    uint64_t order_id_;
    uint64_t user_id_;
    std::string symbol_;
    OrderSide side_;
    OrderType type_;
    TimeInForce tif_;
    int64_t price_;
    int64_t quantity_;
    int64_t filled_quantity_ = 0;
    int64_t avg_fill_price_ = 0;
    int64_t stop_price_ = 0;
    OrderStatus status_ = OrderStatus::PENDING_NEW;
    uint64_t timestamp_;
    uint64_t sequence_ = 0;
    int64_t iceberg_quantity_ = 0;
    int64_t filled_iceberg_ = 0;
    std::string cancel_reason_;
    std::string reject_reason_;
};

// Trade represents an executed trade
struct Trade {
    uint64_t trade_id;
    uint64_t maker_order_id;
    uint64_t taker_order_id;
    uint64_t maker_user_id;
    uint64_t taker_user_id;
    std::string symbol;
    OrderSide side;
    int64_t price;
    int64_t quantity;
    int64_t maker_fee;
    int64_t taker_fee;
    uint64_t timestamp;
    uint64_t sequence;
};

// Order book level
struct PriceLevel {
    int64_t price;
    int64_t quantity;
    uint64_t timestamp;
    
    bool operator<(const PriceLevel& other) const {
        return price < other.price;
    }
    bool operator>(const PriceLevel& other) const {
        return price > other.price;
    }
};

// Comparison operators for price priority
struct BuyPriceComparator {
    bool operator()(const Order* a, const Order* b) const {
        // Higher price has priority for buy orders (price-time priority)
        if (a->get_price() != b->get_price()) {
            return a->get_price() > b->get_price();
        }
        // Earlier timestamp has priority
        return a->get_timestamp() < b->get_timestamp();
    }
};

struct SellPriceComparator {
    bool operator()(const Order* a, const Order* b) const {
        // Lower price has priority for sell orders (price-time priority)
        if (a->get_price() != b->get_price()) {
            return a->get_price() < b->get_price();
        }
        // Earlier timestamp has priority
        return a->get_timestamp() < b->get_timestamp();
    }
};

} // namespace tigerex

#endif // TIGEREX_ORDER_HPP
