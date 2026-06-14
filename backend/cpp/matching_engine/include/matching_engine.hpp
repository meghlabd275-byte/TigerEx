/**
 * TigerEx C++ Matching Engine
 * Core Matching Engine - Multi-Market Support
 * Target Latency: < 50 microseconds
 * 
 * @author TigerEx Team
 * @date June 2026
 */

#ifndef TIGEREX_MATCHING_ENGINE_HPP
#define TIGEREX_MATCHING_ENGINE_HPP

#include "order.hpp"
#include "order_book.hpp"
#include <unordered_map>
#include <shared_mutex>
#include <atomic>
#include <memory>
#include <functional>
#include <queue>
#include <stack>

namespace tigerex {

// ============================================================================
// MATCHING ENGINE CONFIGURATION
// ============================================================================

struct EngineConfig {
    // Performance settings
    uint32_t max_orders_per_market{1000000};
    uint32_t max_price_levels{10000};
    uint32_t max_trades_per_match{10000};
    uint32_t worker_threads{4};
    
    // Latency targets (nanoseconds)
    uint64_t target_latency_ns{50000};  // 50 microseconds
    uint64_t max_latency_ns{100000};    // 100 microseconds
    
    // Risk limits
    int64_t max_position_size{100000000000};  // $1B max position
    int64_t max_order_value{100000000};       // $100M max order
    int64_t min_order_value{100};             // $0.01 min order
    
    // Circuit breaker
    bool circuit_breaker_enabled{true};
    int64_t circuit_breaker_threshold{1000000000};  // 10% move
    uint64_t circuit_breaker_cooldown_ns{60000000000};  // 60 seconds
    
    // Market hours
    bool trading_24_7{true};
    
    // Fee settings
    int32_t maker_fee_bps{2};   // 0.02%
    int32_t taker_fee_bps{4};    // 0.04%
};

// ============================================================================
// MARKET STATE
// ============================================================================

enum class MarketState {
    PreOpen = 0,
    Open = 1,
    Halted = 2,
    Closed = 3,
    Auction = 4
};

// ============================================================================
// MARKET INFO
// ============================================================================

struct MarketInfo {
    std::string symbol;
    std::string base_asset;
    std::string quote_asset;
    MarketType market_type;
    MarketState state;
    
    // Price info
    int price_precision{8};
    int quantity_precision{8};
    Price min_price;
    Price max_price;
    Quantity min_quantity;
    Quantity max_quantity;
    Quantity tick_size;
    Quantity lot_size;
    
    // Trading rules
    bool allow_margin{false};
    bool allow_short{false};
    int max_leverage{1};
    
    // Fee tiers
    int32_t maker_fee_bps{2};
    int32_t taker_fee_bps{4};
    
    // Timestamps
    uint64_t created_at;
    uint64_t updated_at;
};

// ============================================================================
// MATCH RESULT
// ============================================================================

struct MatchResult {
    bool success{false};
    std::vector<Trade> trades;
    std::string error_message;
    uint64_t latency_ns{0};
    
    // Statistics
    uint32_t orders_added{0};
    uint32_t orders_cancelled{0};
    uint32_t trades_generated{0};
    int64_t total_volume{0};
    int64_t total_fees{0};
};

// ============================================================================
// ORDER RESULT
// ============================================================================

struct OrderResult {
    bool success{false};
    OrderId order_id;
    OrderStatus status;
    std::vector<Trade> trades;
    std::string error_message;
    
    // Execution info
    Price avg_fill_price;
    Quantity filled_quantity;
    Price fee;
    
    // Timestamps
    uint64_t created_at{0};
    uint64_t updated_at{0};
};

// ============================================================================
// RISK CHECK RESULT
// ============================================================================

struct RiskCheckResult {
    bool allowed{false};
    std::string reason;
    int64_t margin_required{0};
    int64_t position_value{0};
    int64_t available_balance{0};
};

// ============================================================================
// MATCHING ENGINE
// ============================================================================

class MatchingEngine {
public:
    // ============================================================================
    // CONSTRUCTION
    // ============================================================================
    
    /**
     * Constructor with configuration
     */
    explicit MatchingEngine(const EngineConfig& config);
    
    /**
     * Destructor
     */
    ~MatchingEngine();
    
    // Prevent copying
    MatchingEngine(const MatchingEngine&) = delete;
    MatchingEngine& operator=(const MatchingEngine&) = delete;
    
    // ============================================================================
    // MARKET MANAGEMENT
    // ============================================================================
    
    /**
     * Create new market
     * @param info Market information
     * @return true if successful
     */
    bool create_market(const MarketInfo& info);
    
    /**
     * Remove market
     * @param symbol Market symbol
     * @return true if successful
     */
    bool remove_market(const std::string& symbol);
    
    /**
     * Get market info
     * @param symbol Market symbol
     * @return Pointer to market info or nullptr
     */
    MarketInfo* get_market(const std::string& symbol);
    
    /**
     * Check if market exists
     */
    bool has_market(const std::string& symbol) const;
    
    /**
     * Set market state
     */
    bool set_market_state(const std::string& symbol, MarketState state);
    
    /**
     * Get all markets
     */
    std::vector<std::string> get_all_markets() const;
    
    // ============================================================================
    // ORDER PROCESSING
    // ============================================================================
    
    /**
     * Submit order
     * @param order Order to submit
     * @return Order result with execution details
     */
    OrderResult submit_order(Order& order);
    
    /**
     * Submit order async (for high frequency)
     * @param order Order to submit
     * @return true if queued
     */
    bool submit_order_async(Order& order);
    
    /**
     * Cancel order
     * @param symbol Market symbol
     * @param order_id Order to cancel
     * @return true if successful
     */
    bool cancel_order(const std::string& symbol, const OrderId& order_id);
    
    /**
     * Cancel all orders for user
     * @param symbol Market symbol (empty for all)
     * @param user_id User ID
     * @return Number of orders cancelled
     */
    uint32_t cancel_all_orders(const std::string& symbol, uint64_t user_id);
    
    /**
     * Replace order
     * @param symbol Market symbol
     * @param old_order_id Old order ID
     * @param new_order New order
     * @return Order result
     */
    OrderResult replace_order(const std::string& symbol, 
                           const OrderId& old_order_id,
                           Order& new_order);
    
    /**
     * Get order
     * @param symbol Market symbol
     * @param order_id Order ID
     * @return Pointer to order or nullptr
     */
    Order* get_order(const std::string& symbol, const OrderId& order_id);
    
    /**
     * Get user orders
     * @param symbol Market symbol (empty for all)
     * @param user_id User ID
     * @return Vector of orders
     */
    std::vector<Order> get_user_orders(const std::string& symbol, 
                                   uint64_t user_id) const;
    
    // ============================================================================
    // MARKET DATA
    // ============================================================================
    
    /**
     * Get order book
     * @param symbol Market symbol
     * @return Pointer to order book or nullptr
     */
    OrderBook* get_order_book(const std::string& symbol);
    
    /**
     * Get order book snapshot
     * @param symbol Market symbol
     * @param depth Depth to fetch
     * @return Snapshot
     */
    typename OrderBook::Snapshot get_order_book_snapshot(
        const std::string& symbol, 
        uint32_t depth = 100) const;
    
    /**
     * Get ticker
     * @param symbol Market symbol
     * @return Ticker data
     */
    struct Ticker {
        Price last_price;
        Price change_24h;
        Price change_percent_24h;
        Price high_24h;
        Price low_24h;
        Quantity volume_24h;
        Quantity quote_volume_24h;
        uint64_t trades_24h;
        Price best_bid;
        Price best_ask;
        Quantity bid_quantity;
        Quantity ask_quantity;
    };
    
    Ticker get_ticker(const std::string& symbol) const;
    
    /**
     * Get recent trades
     * @param symbol Market symbol
     * @param limit Number of trades
     * @return Vector of trades
     */
    std::vector<Trade> get_recent_trades(const std::string& symbol, 
                                         uint32_t limit = 100) const;
    
    // ============================================================================
    // TRADING OPERATIONS
    // ============================================================================
    
    /**
     * Enable trading for market
     */
    bool enable_trading(const std::string& symbol);
    
    /**
     * Disable trading for market
     */
    bool disable_trading(const std::string& symbol);
    
    /**
     * Halt market (emergency)
     */
    bool halt_market(const std::string& symbol, const std::string& reason);
    
    // ============================================================================
    // RISK MANAGEMENT
    // ============================================================================
    
    /**
     * Check risk for order
     * @param order Order to check
     * @return Risk check result
     */
    RiskCheckResult check_risk(const Order& order);
    
    /**
     * Update user balance
     * @param user_id User ID
     * @param symbol Trading symbol
     * @param balance New balance
     */
    void update_balance(uint64_t user_id, const std::string& symbol,
                        int64_t balance);
    
    /**
     * Get user balance
     * @param user_id User ID
     * @param symbol Trading symbol
     * @return Balance
     */
    int64_t get_balance(uint64_t user_id, const std::string& symbol) const;
    
    /**
     * Get user position
     * @param user_id User ID
     * @param symbol Trading symbol
     * @return Position size (positive = long, negative = short)
     */
    int64_t get_position(uint64_t user_id, const std::string& symbol) const;
    
    // ============================================================================
    // CIRCUIT BREAKER
    // ============================================================================
    
    /**
     * Get circuit breaker state
     * @param symbol Market symbol
     * @return true if triggered
     */
    bool is_circuit_breaker_triggered(const std::string& symbol) const;
    
    /**
     * Trigger circuit breaker manually
     */
    void trigger_circuit_breaker(const std::string& symbol);
    
    /**
     * Reset circuit breaker
     */
    void reset_circuit_breaker(const std::string& symbol);
    
    // ============================================================================
    // STATISTICS
    // ============================================================================
    
    /**
     * Get engine statistics
     */
    struct EngineStats {
        std::atomic<uint64_t> total_orders{0};
        std::atomic<uint64_t> total_trades{0};
        std::atomic<uint64_t> total_volume{0};
        std::atomic<uint64_t> total_fees{0};
        
        // Latency (nanoseconds)
        std::atomic<uint64_t> min_latency{UINT64_MAX};
        std::atomic<uint64_t> max_latency{0};
        std::atomic<uint64_t> total_latency{0};
        
        // Market count
        uint32_t market_count{0};
        uint64_t order_count{0};
    };
    
    EngineStats get_stats() const;
    
    /**
     * Get average latency
     */
    double average_latency() const;
    
    /**
     * Get p99 latency
     */
    uint64_t p99_latency() const;
    
    // ============================================================================
    // BATCH OPERATIONS
    // ============================================================================
    
    /**
     * Submit batch of orders
     * @param orders Vector of orders
     * @return Vector of results
     */
    std::vector<OrderResult> submit_batch(std::vector<Order>& orders);
    
    /**
     * Process queued orders
     * @return Number of orders processed
     */
    uint32_t process_queue();
    
    // ============================================================================
    // CALLBACKS
    // ============================================================================
    
    using TradeCallback = std::function<void(const Trade&)>;
    using OrderCallback = std::function<void(const Order&)>;
    using MarketCallback = std::function<void(const std::string&, MarketState)>;
    
    void set_trade_callback(TradeCallback callback);
    void set_order_callback(OrderCallback callback);
    void set_market_callback(MarketCallback callback);
    
    // ============================================================================
    // MAINTENANCE
    // ============================================================================
    
    /**
     * Clean up expired orders
     * @return Number of orders cleaned
     */
    uint32_t cleanup_expired_orders();
    
    /**
     * Compact order books (memory optimization)
     */
    void compact_order_books();
    
    /**
     * Force sync to storage
     */
    void sync_to_storage();
    
private:
    // ============================================================================
    // INTERNAL DATA
    // ============================================================================
    
    // Configuration
    EngineConfig config_;
    
    // Markets
    std::unordered_map<std::string, MarketInfo> markets_;
    std::unordered_map<std::string, std::unique_ptr<OrderBook>> order_books_;
    
    // Orders by market and user
    std::unordered_map<std::string, std::unordered_map<OrderId, Order>> orders_;
    
    // User balances (symbol -> balance)
    std::unordered_map<uint64_t, std::unordered_map<std::string, int64_t>> balances_;
    
    // User positions (symbol -> position)
    std::unordered_map<uint64_t, std::unordered_map<std::string, int64_t>> positions_;
    
    // Circuit breaker state
    struct CircuitBreakerState {
        bool triggered{false};
        uint64_t trigger_time{0};
        Price trigger_price;
        std::string reason;
    };
    std::unordered_map<std::string, CircuitBreakerState> circuit_breakers_;
    
    // Statistics
    EngineStats stats_;
    
    // Order queue (for async processing)
    std::queue<Order> order_queue_;
    
    // Recent trades (for get_recent_trades)
    std::unordered_map<std::string, std::deque<Trade>> recent_trades_;
    
    // Callbacks
    TradeCallback trade_callback_;
    OrderCallback order_callback_;
    MarketCallback market_callback_;
    
    // Mutexes
    mutable std::shared_mutex engine_mutex_;
    mutable std::mutex balance_mutex_;
    mutable std::mutex stats_mutex_;
    
    // ============================================================================
    // INTERNAL HELPERS
    // ============================================================================
    
    /**
     * Validate order
     */
    bool validate_order(const Order& order, std::string& error);
    
    /**
     * Process order
     */
    OrderResult process_order(Order& order);
    
    /**
     * Execute match
     */
    MatchResult execute_match(Order& order);
    
    /**
     * Update position
     */
    void update_position(const Trade& trade);
    
    /**
     * Check circuit breaker
     */
    bool check_circuit_breaker(const std::string& symbol, const Price& price);
    
    /**
     * Update statistics
     */
    void update_stats(const Trade& trade, uint64_t latency_ns);
    
    /**
     * Get or create order book
     */
    OrderBook* get_or_create_book(const std::string& symbol);
};

} // namespace tigerex

#endif // TIGEREX_MATCHING_ENGINE_HPP