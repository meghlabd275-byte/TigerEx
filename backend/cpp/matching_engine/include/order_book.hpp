/**
 * TigerEx C++ Matching Engine
 * Order Book - High-Performance Data Structure
 * Target Latency: < 50 microseconds
 * 
 * @author TigerEx Team
 * @date June 2026
 */

#ifndef TIGEREX_ORDER_BOOK_HPP
#define TIGEREX_ORDER_BOOK_HPP

#include "order.hpp"
#include <array>
#include <deque>
#include <list>
#include <unordered_map>
#include <vector>
#include <memory>
#include <shared_mutex>
#include <atomic>
#include <functional>

namespace tigerex {

// ============================================================================
// ORDER BOOK CONFIGURATION
// ============================================================================

static constexpr uint32_t MAX_PRICE_LEVELS = 10000;
static constexpr uint32_t MAX_ORDERS_PER_PRICE = 1000;
static constexpr uint32_t PRICE_BUCKET_COUNT = 1000;

// ============================================================================
// PRICE LEVEL AGGREGATION
// ============================================================================

struct LevelAggregation {
    Price price;
    Quantity quantity;
    uint32_t order_count;
    uint64_t last_update_ns;
    
    bool operator<(const LevelAggregation& other) const {
        return price_less(price, other.price);
    }
};

// ============================================================================
// ORDER BOOK
// ============================================================================

class OrderBook {
public:
    // Constructor
    OrderBook(const std::string& symbol, MarketType market_type);
    ~OrderBook();
    
    // Prevent copying
    OrderBook(const OrderBook&) = delete;
    OrderBook& operator=(const OrderBook&) = delete;
    
    // Allow moving
    OrderBook(OrderBook&&) = default;
    OrderBook& operator=(OrderBook&&) = default;
    
    // ============================================================================
    // ORDER OPERATIONS
    // ============================================================================
    
    /**
     * Add order to the book
     * @param order Order to add
     * @return true if successful
     */
    bool add_order(Order& order);
    
    /**
     * Remove order from the book
     * @param order_id Order identifier
     * @return true if found and removed
     */
    bool remove_order(const OrderId& order_id);
    
    /**
     * Update order quantity (partial fill)
     * @param order_id Order identifier
     * @param new_quantity New remaining quantity
     * @return true if successful
     */
    bool update_order(const OrderId& order_id, const Quantity& new_quantity);
    
    /**
     * Get order by ID
     * @param order_id Order identifier
     * @return Pointer to order or nullptr
     */
    Order* get_order(const OrderId& order_id);
    
    /**
     * Check if order exists
     */
    bool has_order(const OrderId& order_id) const;
    
    // ============================================================================
    // MATCHING OPERATIONS
    // ============================================================================
    
    /**
     * Match incoming order against the book
     * @param incoming Incoming order
     * @param trades Vector to store generated trades
     * @return Number of trades generated
     */
    uint32_t match_order(Order& incoming, std::vector<Trade>& trades);
    
    /**
     * Process match and generate trades
     */
    uint32_t process_match(Order& incoming, std::vector<Trade>& trades);
    
    // ============================================================================
    // PRICE LEVEL QUERIES
    // ============================================================================
    
    /**
     * Get best bid (highest buy price)
     * @return Price level or nullptr if empty
     */
    const LevelAggregation* get_best_bid() const;
    
    /**
     * Get best ask (lowest sell price)
     * @return Price level or nullptr if empty
     */
    const LevelAggregation* get_best_ask() const;
    
    /**
     * Get bid levels (sorted by price descending)
     * @param depth Number of levels to return
     * @return Vector of price levels
     */
    std::vector<LevelAggregation> get_bid_levels(uint32_t depth) const;
    
    /**
     * Get ask levels (sorted by price ascending)
     * @param depth Number of levels to return
     * @return Vector of price levels
     */
    std::vector<LevelAggregation> get_ask_levels(uint32_t depth) const;
    
    /**
     * Get spread (best bid to best ask)
     * @return Spread or empty if book is empty
     */
    std::optional<std::array<Price, 2>> get_spread() const;
    
    /**
     * Get mid price
     * @return Mid price or empty
     */
    std::optional<Price> get_mid_price() const;
    
    /**
     * Get order book depth
     * @param levels Number of levels
     * @return Array of [bids, asks]
     */
    std::array<std::vector<LevelAggregation>, 2> get_depth(uint32_t levels) const;
    
    // ============================================================================
    // MARKET DATA
    // ============================================================================
    
    /**
     * Get last traded price
     */
    Price get_last_price() const { return last_price_; }
    
    /**
     * Get 24h volume
     */
    Quantity get_24h_volume() const { return volume_24h_; }
    
    /**
     * Get 24h high
     */
    Price get_24h_high() const { return high_24h_; }
    
    /**
     * Get 24h low
     */
    Price get_24h_low() const { return low_24h_; }
    
    /**
     * Get 24h trades count
     */
    uint64_t get_24h_trades() const { return trades_24h_; }
    
    // ============================================================================
    // STATISTICS
    // ============================================================================
    
    /**
     * Total orders in book
     */
    uint32_t order_count() const { return orders_.size(); }
    
    /**
     * Total bid quantity
     */
    Quantity total_bid_quantity() const;
    
    /**
     * Total ask quantity
     */
    Quantity total_ask_quantity() const;
    
    /**
     * Get symbol
     */
    const std::string& symbol() const { return symbol_; }
    
    /**
     * Get market type
     */
    MarketType market_type() const { return market_type_; }
    
    /**
     * Check if book is empty
     */
    bool empty() const { return orders_.empty(); }
    
    /**
     * Check if auction mode
     */
    bool auction_mode() const { return auction_mode_; }
    
    /**
     * Get sequence number for optimistic locking
     */
    uint64_t sequence() const { return sequence_.load(); }
    
    // ============================================================================
    // PRICE LIMITS
    // ============================================================================
    
    /**
     * Set price limits
     */
    void set_price_limits(const Price& min_price, const Price& max_price);
    
    /**
     * Check if price is within limits
     */
    bool is_price_valid(const Price& price) const;
    
    /**
     * Set lot size limits
     */
    void set_lot_limits(const Quantity& min_lot, const Quantity& max_lot);
    
    /**
     * Check if quantity is within limits
     */
    bool is_quantity_valid(const Quantity& qty) const;
    
    // ============================================================================
    // AUCTION MODE
    // ============================================================================
    
    /**
     * Enable auction mode (opening/closing)
     */
    void enable_auction_mode();
    
    /**
     * Disable auction mode and match
     */
    void disable_auction_mode();
    
    /**
     * Get auction start price
     */
    const Price& auction_start_price() const { return auction_start_; }
    
    /**
     * Set auction start price
     */
    void set_auction_start_price(const Price& price);
    
    /**
     * Collect auction orders without matching
     */
    void collect_auction_order(Order& order);
    
    /**
     * Execute auction at clearing price
     */
    uint32_t execute_auction(const Price& clearing_price, std::vector<Trade>& trades);
    
    // ============================================================================
    // ORDER PRIORITY (for price-time priority)
    // ============================================================================
    
    /**
     * Update order priority (called on each match)
     */
    void update_priority(const OrderId& order_id);
    
    /**
     * Get order priority
     */
    uint32_t get_priority(const OrderId& order_id) const;
    
    // ============================================================================
    // ICEBERG ORDERS
    // ============================================================================
    
    /**
     * Process iceberg order
     */
    bool process_iceberg(Order& order);
    
    /**
     * Reveal next iceberg chunk
     */
    bool reveal_iceberg(Order& order);
    
    // ============================================================================
    // SNAPSHOT
    // ============================================================================
    
    /**
     * Create full snapshot
     */
    struct Snapshot {
        std::string symbol;
        uint64_t sequence;
        std::vector<LevelAggregation> bids;
        std::vector<LevelAggregation> asks;
        Price last_price;
        Quantity volume_24h;
        Price high_24h;
        Price low_24h;
        uint64_t trades_24h;
    };
    
    Snapshot create_snapshot(uint32_t depth = 100) const;
    
    // ============================================================================
    // LOCK-FREE OPERATIONS (for hot path)
    // ============================================================================
    
    /**
     * Try to match order without locking (best effort)
     * @return Number of matches attempted
     */
    uint32_t try_match_lockfree(Order& order, std::vector<Trade>& trades);
    
    /**
     * Read-best-bid without locking
     */
    const LevelAggregation* read_best_bid_lockfree() const;
    
    /**
     * Read-best-ask without locking
     */
    const LevelAggregation* read_best_ask_lockfree() const;
    
private:
    // ============================================================================
    // INTERNAL DATA STRUCTURES
    // ============================================================================
    
    // Price-level map: price -> list of orders
    struct PriceLevelData {
        std::list<Order> orders;
        Quantity total_quantity;
        Quantity visible_quantity;
        uint32_t order_count;
        uint64_t last_update_ns;
        
        PriceLevelData() : order_count(0), last_update_ns(0) {}
    };
    
    using PriceMap = std::map<Price, PriceLevelData>;
    using OrderMap = std::unordered_map<OrderId, std::list<Order>::iterator>;
    
    // ============================================================================
    // ORDER MAP (by ID for O(1) lookup)
    // ============================================================================
    
    OrderMap orders_;
    
    // ============================================================================
    // BID ORDER BOOK (price ascending for easy max finding)
    // ============================================================================
    
    std::map<Price, PriceLevelData, std::greater<Price>> bids_;
    
    // ============================================================================
    // ASK ORDER BOOK (price ascending)
    // ============================================================================
    
    std::map<Price, PriceLevelData> asks_;
    
    // ============================================================================
    // AUCTION COLLECTION
    // ============================================================================
    
    std::vector<Order> auction_orders_;
    
    // ============================================================================
    // ORDER ID MAPPING
    // ============================================================================
    
    std::unordered_map<uint64_t, OrderId> order_id_map_;
    std::unordered_map<uint64_t, OrderId> client_order_id_map_;
    
    // ============================================================================
    // METADATA
    // ============================================================================
    
    std::string symbol_;
    MarketType market_type_;
    uint64_t sequence_;
    std::atomic<uint64_t> sequence_atom_{0};
    
    // ============================================================================
    // MARKET DATA
    // ============================================================================
    
    Price last_price_;
    Price high_24h_;
    Price low_24h_;
    Quantity volume_24h_;
    Quantity volume_24h_base_;
    uint64_t trades_24h_;
    uint64_t last_24h_reset_;
    
    // ============================================================================
    // PRICE LIMITS
    // ============================================================================
    
    Price min_price_;
    Price max_price_;
    Quantity min_lot_;
    Quantity max_lot_;
    
    // ============================================================================
    // AUCTION MODE
    // ============================================================================
    
    bool auction_mode_;
    Price auction_start_;
    
    // ============================================================================
    // PRIORITY COUNTER (for FIFO within price level)
    // ============================================================================
    
    std::atomic<uint32_t> priority_counter_{0};
    std::unordered_map<uint64_t, uint32_t> order_priority_;
    
    // ============================================================================
    // MUTEXES (for different operation types)
    // ============================================================================
    
    mutable std::shared_mutex book_mutex_;
    mutable std::mutex stats_mutex_;
    
    // ============================================================================
    // INTERNAL HELPERS
    // ============================================================================
    
    /**
     * Find price level in bid book
     */
    auto find_bid_level(const Price& price) -> decltype(bids_.begin()) {
        return bids_.find(price);
    }
    
    /**
     * Find price level in ask book
     */
    auto find_ask_level(const Price& price) -> decltype(asks_.begin()) {
        return asks_.find(price);
    }
    
    /**
     * Insert order into price level
     */
    void insert_order_to_level(PriceMap& book, const Price& price, Order& order);
    
    /**
     * Remove order from price level
     */
    void remove_order_from_level(PriceMap& book, const Price& price, const OrderId& order_id);
    
    /**
     * Update level aggregates
     */
    void update_level_aggregate(PriceMap& book, const Price& price);
    
    /**
     * Process single match
     */
    void process_single_match(Order& incoming, Order& resting, std::vector<Trade>& trades);
    
    /**
     * Update market data after trade
     */
    void update_market_data(const Trade& trade);
    
    /**
     * Reset 24h statistics
     */
    void reset_24h_stats();
};

// ============================================================================
// INLINE IMPLEMENTATIONS
// ============================================================================

inline const LevelAggregation* OrderBook::get_best_bid() const {
    if (bids_.empty()) return nullptr;
    auto it = bids_.begin();
    static LevelAggregation level;
    level.price = it->first;
    level.quantity = it->second.total_quantity;
    level.order_count = it->second.order_count;
    level.last_update_ns = it->second.last_update_ns;
    return &level;
}

inline const LevelAggregation* OrderBook::get_best_ask() const {
    if (asks_.empty()) return nullptr;
    auto it = asks_.begin();
    static LevelAggregation level;
    level.price = it->first;
    level.quantity = it->second.total_quantity;
    level.order_count = it->second.order_count;
    level.last_update_ns = it->second.last_update_ns;
    return &level;
}

inline std::optional<std::array<Price, 2>> OrderBook::get_spread() const {
    const auto* bid = get_best_bid();
    const auto* ask = get_best_ask();
    if (!bid || !ask) return std::nullopt;
    return std::array<Price, 2>{{bid->price, ask->price}};
}

inline std::optional<Price> OrderBook::get_mid_price() const {
    const auto* bid = get_best_bid();
    const auto* ask = get_best_ask();
    if (!bid || !ask) return std::nullopt;
    // (bid + ask) / 2
    return price_add(bid->price, ask->price);
}

inline Quantity OrderBook::total_bid_quantity() const {
    Quantity total = {0, 0};
    for (const auto& level : bids_) {
        total[0] += level.second.total_quantity[0];
    }
    return total;
}

inline Quantity OrderBook::total_ask_quantity() const {
    Quantity total = {0, 0};
    for (const auto& level : asks_) {
        total[0] += level.second.total_quantity[0];
    }
    return total;
}

inline bool OrderBook::has_order(const OrderId& order_id) const {
    return orders_.find(order_id) != orders_.end();
}

inline Order* OrderBook::get_order(const OrderId& order_id) {
    auto it = orders_.find(order_id);
    if (it == orders_.end()) return nullptr;
    return &(it->second);
}

} // namespace tigerex

#endif // TIGEREX_ORDER_BOOK_HPP