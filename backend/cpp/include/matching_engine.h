#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>
#include <queue>
#include <mutex>
#include <shared_mutex>

namespace tigerex {

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
    TAKE_PROFIT = 3
};

// Time in force
enum class TimeInForce : uint8_t {
    GTC = 0, // Good till cancelled
    IOC = 1, // Immediate or cancel
    FOK = 2   // Fill or kill
};

// Order status
enum class OrderStatus : uint8_t {
    PENDING = 0,
    OPEN = 1,
    PARTIALLY_FILLED = 2,
    FILLED = 3,
    CANCELLED = 4,
    REJECTED = 5
};

// Price level in order book
struct PriceLevel {
    uint64_t price;
    uint64_t quantity;
    uint64_t orders_count;
};

// Order representation
struct Order {
    uint64_t order_id;
    uint64_t user_id;
    std::string symbol;
    Side side;
    OrderType type;
    TimeInForce tif;
    uint64_t price;
    uint64_t quantity;
    uint64_t filled_quantity;
    uint64_t avg_fill_price;
    uint64_t stop_price;
    std::string client_order_id;
    OrderStatus status;
    uint64_t created_at;
    uint64_t updated_at;
};

// Trade execution record
struct Trade {
    uint64_t trade_id;
    uint64_t order_id;
    uint64_t maker_order_id;
    uint64_t taker_order_id;
    uint64_t user_id;
    std::string symbol;
    Side side;
    uint64_t price;
    uint64_t quantity;
    uint64_t fee;
    std::string fee_currency;
    uint64_t timestamp;
};

// Market statistics
struct MarketStats {
    std::string symbol;
    uint64_t last_price;
    uint64_t price_change_24h;
    uint64_t high_24h;
    uint64_t low_24h;
    uint64_t volume_24h;
    uint64_t quote_volume_24h;
    uint64_t trades_24h;
    uint64_t timestamp;
};

// Order book for a single symbol
class OrderBook {
public:
    OrderBook(const std::string& symbol);
    ~OrderBook() = default;

    // Add order to book
    bool AddOrder(Order& order);

    // Cancel order
    bool CancelOrder(uint64_t order_id);

    // Modify order
    bool ModifyOrder(uint64_t order_id, uint64_t new_quantity);

    // Execute market order
    std::vector<Trade> ExecuteMarketOrder(Order& order);

    // Execute limit order
    bool ExecuteLimitOrder(Order& order);

    // Get order by ID
    std::shared_ptr<Order> GetOrder(uint64_t order_id);

    // Get best bid/ask
    std::pair<uint64_t, uint64_t> GetBestBidAsk() const;

    // Get order book depth
    std::vector<PriceLevel> GetDepth(uint32_t levels) const;

    // Get recent trades
    std::vector<Trade> GetRecentTrades(uint32_t limit) const;

private:
    std::string symbol_;
    std::unordered_map<uint64_t, std::shared_ptr<Order>> orders_;
    
    // Price-time priority queues
    std::multimap<uint64_t, std::deque<std::shared_ptr<Order>>> bids_;      // Price -> Orders (ascending)
    std::multimap<uint64_t, std::deque<std::shared_ptr<Order>>> asks_;     // Price -> Orders (ascending)
    
    // Quick lookup by order ID
    std::unordered_map<uint64_t, std::multimap<uint64_t, std::deque<std::shared_ptr<Order>>>::iterator> bid_iterators_;
    std::unordered_map<uint64_t, std::multimap<uint64_t, std::deque<std::shared_ptr<Order>>>::iterator> ask_iterators_;
    
    mutable std::shared_mutex mutex_;
    std::vector<Trade> recent_trades_;
    std::atomic<uint64_t> last_trade_id_{0};
};

// Matching engine
class MatchingEngine {
public:
    MatchingEngine();
    ~MatchingEngine() = default;

    // Initialize with symbols
    void Initialize(const std::vector<std::string>& symbols);

    // Submit order
    std::pair<uint64_t, std::vector<Trade>> SubmitOrder(Order& order);

    // Cancel order
    bool CancelOrder(const std::string& symbol, uint64_t order_id);

    // Modify order
    bool ModifyOrder(const std::string& symbol, uint64_t order_id, uint64_t new_quantity);

    // Get order book
    std::shared_ptr<OrderBook> GetOrderBook(const std::string& symbol);

    // Get market statistics
    MarketStats GetMarketStats(const std::string& symbol);

    // Process batch orders
    std::vector<Trade> ProcessBatch(std::vector<Order>& orders);

    // Get all markets
    std::vector<std::string> GetMarkets() const;

private:
    std::unordered_map<std::string, std::shared_ptr<OrderBook>> books_;
    std::atomic<uint64_t> last_order_id_{0};
    mutable std::shared_mutex mutex_;
};

} // namespace tigerex