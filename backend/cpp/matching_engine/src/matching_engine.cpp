/**
 * TigerEx C++ Matching Engine
 * Core Matching Engine Implementation
 * Target Latency: < 50 microseconds
 */

#include "matching_engine.hpp"
#include <algorithm>
#include <chrono>

namespace tigerex {

// ============================================================================
// CONSTRUCTOR
// ============================================================================

MatchingEngine::MatchingEngine(const EngineConfig& config)
    : config_(config) {
    
    // Initialize stats
    stats_.market_count = 0;
}

MatchingEngine::~MatchingEngine() = default;

// ============================================================================
// MARKET MANAGEMENT
// ============================================================================

bool MatchingEngine::create_market(const MarketInfo& info) {
    std::unique_lock lock(engine_mutex_);
    
    // Check if market already exists
    if (markets_.find(info.symbol) != markets_.end()) {
        return false;
    }
    
    // Create market info
    MarketInfo market = info;
    market.created_at = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    market.updated_at = market.created_at;
    
    // Create order book
    auto book = std::make_unique<OrderBook>(info.symbol, info.market_type);
    book->set_price_limits(market.min_price, market.max_price);
    book->set_lot_limits(market.min_quantity, market.max_quantity);
    
    // Store
    markets_[info.symbol] = market;
    order_books_[info.symbol] = std::move(book);
    stats_.market_count++;
    
    // Initialize circuit breaker
    CircuitBreakerState cb_state;
    circuit_breakers_[info.symbol] = cb_state;
    
    return true;
}

bool MatchingEngine::remove_market(const std::string& symbol) {
    std::unique_lock lock(engine_mutex_);
    
    auto market_it = markets_.find(symbol);
    if (market_it == markets_.end()) {
        return false;
    }
    
    // Check if market has no orders
    auto book_it = order_books_.find(symbol);
    if (book_it != order_books_.end() && !book_it->second->empty()) {
        return false;
    }
    
    // Remove
    markets_.erase(market_it);
    order_books_.erase(book_it);
    circuit_breakers_.erase(symbol);
    stats_.market_count--;
    
    return true;
}

MarketInfo* MatchingEngine::get_market(const std::string& symbol) {
    std::shared_lock lock(engine_mutex_);
    
    auto it = markets_.find(symbol);
    if (it == markets_.end()) return nullptr;
    return &it->second;
}

bool MatchingEngine::has_market(const std::string& symbol) const {
    std::shared_lock lock(engine_mutex_);
    return markets_.find(symbol) != markets_.end();
}

bool MatchingEngine::set_market_state(const std::string& symbol, MarketState state) {
    std::unique_lock lock(engine_mutex_);
    
    auto it = markets_.find(symbol);
    if (it == markets_.end()) return false;
    
    MarketState old_state = it->second.state;
    it->second.state = state;
    it->second.updated_at = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    
    // Handle state transitions
    if (old_state != MarketState::Open && state == MarketState::Open) {
        // Market opened - enable trading
        auto book_it = order_books_.find(symbol);
        if (book_it != order_books_.end()) {
            book_it->second->disable_auction_mode();
        }
    } else if (old_state == MarketState::Open && state == MarketState::Halted) {
        // Market halted - pause trading
    }
    
    // Trigger callback
    if (market_callback_) {
        market_callback_(symbol, state);
    }
    
    return true;
}

std::vector<std::string> MatchingEngine::get_all_markets() const {
    std::shared_lock lock(engine_mutex_);
    
    std::vector<std::string> result;
    result.reserve(markets_.size());
    
    for (const auto& market : markets_) {
        result.push_back(market.first);
    }
    
    return result;
}

// ============================================================================
// ORDER PROCESSING
// ============================================================================

OrderResult MatchingEngine::submit_order(Order& order) {
    auto start_time = std::chrono::steady_clock::now();
    
    // Validate order
    std::string error;
    if (!validate_order(order, error)) {
        OrderResult result;
        result.success = false;
        result.status = OrderStatus::Rejected;
        result.error_message = error;
        return result;
    }
    
    // Process order
    OrderResult result = process_order(order);
    
    // Calculate latency
    auto end_time = std::chrono::steady_clock::now();
    auto latency = std::chrono::duration_cast<std::chrono::nanoseconds>(
        end_time - start_time
    ).count();
    
    result.trades[0].timestamp = std::chrono::nanoseconds(
        std::chrono::duration_cast<std::chrono::nanoseconds>(end_time.time_since_epoch()).count()
    );
    
    // Update stats
    if (result.success) {
        stats_.total_orders.fetch_add(1);
        stats_.total_latency.fetch_add(latency);
        
        uint64_t old_min = stats_.min_latency.load();
        while (latency < old_min && !stats_.min_latency.compare_exchange_weak(old_min, latency)) {}
        
        uint64_t old_max = stats_.max_latency.load();
        while (latency > old_max && !stats_.max_latency.compare_exchange_weak(old_max, latency)) {}
    }
    
    return result;
}

bool MatchingEngine::submit_order_async(Order& order) {
    std::unique_lock lock(engine_mutex_);
    order_queue_.push(order);
    return true;
}

bool MatchingEngine::cancel_order(const std::string& symbol, const OrderId& order_id) {
    std::unique_lock lock(engine_mutex_);
    
    // Get order book
    auto book_it = order_books_.find(symbol);
    if (book_it == order_books_.end()) return false;
    
    // Cancel on order book
    bool result = book_it->second->remove_order(order_id);
    
    if (result) {
        stats_.total_orders.fetch_sub(1);
    }
    
    return result;
}

uint32_t MatchingEngine::cancel_all_orders(const std::string& symbol, uint64_t user_id) {
    std::unique_lock lock(engine_mutex_);
    
    uint32_t count = 0;
    
    if (symbol.empty()) {
        // Cancel all orders for user across all markets
        for (auto& book_pair : order_books_) {
            auto orders = book_pair.second->get_user_orders(user_id);
            for (const auto& order : orders) {
                if (book_pair.second->remove_order(order.id)) {
                    count++;
                }
            }
        }
    } else {
        // Cancel orders for specific market
        auto book_it = order_books_.find(symbol);
        if (book_it != order_books_.end()) {
            auto orders = book_it->second->get_user_orders(user_id);
            for (const auto& order : orders) {
                if (book_it->second->remove_order(order.id)) {
                    count++;
                }
            }
        }
    }
    
    stats_.total_orders.fetch_sub(count);
    return count;
}

OrderResult MatchingEngine::replace_order(const std::string& symbol,
                                       const OrderId& old_order_id,
                                       Order& new_order) {
    // First cancel old order
    if (!cancel_order(symbol, old_order_id)) {
        OrderResult result;
        result.success = false;
        result.error_message = "Old order not found";
        return result;
    }
    
    // Then submit new order
    return submit_order(new_order);
}

Order* MatchingEngine::get_order(const std::string& symbol, const OrderId& order_id) {
    std::shared_lock lock(engine_mutex_);
    
    auto book_it = order_books_.find(symbol);
    if (book_it == order_books_.end()) return nullptr;
    
    return book_it->second->get_order(order_id);
}

std::vector<Order> MatchingEngine::get_user_orders(const std::string& symbol,
                                                   uint64_t user_id) const {
    std::shared_lock lock(engine_mutex_);
    
    std::vector<Order> result;
    
    if (symbol.empty()) {
        // Get orders from all markets
        for (const auto& book_pair : order_books_) {
            auto orders = book_pair.second->get_user_orders(user_id);
            result.insert(result.end(), orders.begin(), orders.end());
        }
    } else {
        // Get orders from specific market
        auto book_it = order_books_.find(symbol);
        if (book_it != order_books_.end()) {
            result = book_it->second->get_user_orders(user_id);
        }
    }
    
    return result;
}

// ============================================================================
// MARKET DATA
// ============================================================================

OrderBook* MatchingEngine::get_order_book(const std::string& symbol) {
    std::shared_lock lock(engine_mutex_);
    
    auto it = order_books_.find(symbol);
    if (it == order_books_.end()) return nullptr;
    return it->second.get();
}

typename OrderBook::Snapshot MatchingEngine::get_order_book_snapshot(
    const std::string& symbol, 
    uint32_t depth) const {
    
    std::shared_lock lock(engine_mutex_);
    
    auto it = order_books_.find(symbol);
    if (it == order_books_.end()) {
        return typename OrderBook::Snapshot();
    }
    
    return it->second->create_snapshot(depth);
}

MatchingEngine::Ticker MatchingEngine::get_ticker(const std::string& symbol) const {
    std::shared_lock lock(engine_mutex_);
    
    Ticker ticker;
    
    auto book_it = order_books_.find(symbol);
    if (book_it == order_books_.end()) return ticker;
    
    const auto* book = book_it->second.get();
    
    // Get order book data
    auto depth = book->get_depth(1);
    
    if (!depth[0].empty()) {
        ticker.best_bid = depth[0][0].price;
        ticker.bid_quantity = depth[0][0].quantity;
    }
    
    if (!depth[1].empty()) {
        ticker.best_ask = depth[1][0].price;
        ticker.ask_quantity = depth[1][0].quantity;
    }
    
    ticker.last_price = book->get_last_price();
    ticker.high_24h = book->get_24h_high();
    ticker.low_24h = book->get_24h_low();
    ticker.volume_24h = book->get_24h_volume();
    ticker.trades_24h = book->get_24h_trades();
    
    return ticker;
}

std::vector<Trade> MatchingEngine::get_recent_trades(const std::string& symbol,
                                               uint32_t limit) const {
    std::shared_lock lock(engine_mutex_);
    
    auto it = recent_trades_.find(symbol);
    if (it == recent_trades_.end()) return {};
    
    std::vector<Trade> result;
    result.reserve(limit);
    
    uint32_t count = 0;
    for (auto rit = it->second.rbegin(); 
         rit != it->second.rend() && count < limit; 
         ++rit, ++count) {
        result.push_back(*rit);
    }
    
    return result;
}

// ============================================================================
// TRADING OPERATIONS
// ============================================================================

bool MatchingEngine::enable_trading(const std::string& symbol) {
    return set_market_state(symbol, MarketState::Open);
}

bool MatchingEngine::disable_trading(const std::string& symbol) {
    return set_market_state(symbol, MarketState::Closed);
}

bool MatchingEngine::halt_market(const std::string& symbol, const std::string& reason) {
    std::unique_lock lock(engine_mutex_);
    
    // Trigger circuit breaker
    auto cb_it = circuit_breakers_.find(symbol);
    if (cb_it != circuit_breakers_.end()) {
        cb_it->second.triggered = true;
        cb_it->second.trigger_time = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
        cb_it->second.reason = reason;
    }
    
    return set_market_state(symbol, MarketState::Halted);
}

// ============================================================================
// RISK MANAGEMENT
// ============================================================================

RiskCheckResult MatchingEngine::check_risk(const Order& order) {
    RiskCheckResult result;
    result.allowed = true;
    
    // Check circuit breaker
    if (is_circuit_breaker_triggered(order.symbol)) {
        result.allowed = false;
        result.reason = "Circuit breaker triggered";
        return result;
    }
    
    // Check market state
    auto market_it = markets_.find(order.symbol);
    if (market_it != markets_.end()) {
        if (market_it->second.state != MarketState::Open) {
            result.allowed = false;
            result.reason = "Market not open";
            return result;
        }
    }
    
    // Check order value
    int64_t order_value = order.price[0] * order.quantity[0];
    
    if (order_value > config_.max_order_value) {
        result.allowed = false;
        result.reason = "Order value exceeds maximum";
        return result;
    }
    
    if (order_value < config_.min_order_value) {
        result.allowed = false;
        result.reason = "Order value below minimum";
        return result;
    }
    
    // Check position limit
    int64_t current_position = get_position(order.user_id, order.symbol);
    int64_t new_position = current_position + order.quantity[0];
    
    if (std::abs(new_position) > config_.max_position_size) {
        result.allowed = false;
        result.reason = "Position limit exceeded";
        return result;
    }
    
    // Calculate margin requirement
    if (order.market_type == MarketType::Margin || 
        order.market_type == MarketType::Futures) {
        
        // For margin trading, calculate margin requirement
        int leverage = market_it != markets_.end() ? 
                      market_it->second.max_leverage : 1;
        
        result.margin_required = order_value / leverage;
        result.position_value = std::abs(new_position) * order.price[0];
        
        // Check balance
        int64_t balance = get_balance(order.user_id, order.symbol);
        if (result.margin_required > balance) {
            result.allowed = false;
            result.reason = "Insufficient margin";
            return result;
        }
        
        result.available_balance = balance - result.margin_required;
    }
    
    return result;
}

void MatchingEngine::update_balance(uint64_t user_id, const std::string& symbol,
                                  int64_t balance) {
    std::unique_lock lock(balance_mutex_);
    balances_[user_id][symbol] = balance;
}

int64_t MatchingEngine::get_balance(uint64_t user_id, const std::string& symbol) const {
    std::unique_lock lock(balance_mutex_);
    
    auto user_it = balances_.find(user_id);
    if (user_it == balances_.end()) return 0;
    
    auto symbol_it = user_it->second.find(symbol);
    if (symbol_it == user_it->second.end()) return 0;
    
    return symbol_it->second;
}

int64_t MatchingEngine::get_position(uint64_t user_id, const std::string& symbol) const {
    std::unique_lock lock(balance_mutex_);
    
    auto user_it = positions_.find(user_id);
    if (user_it == positions_.end()) return 0;
    
    auto symbol_it = user_it->second.find(symbol);
    if (symbol_it == user_it->second.end()) return 0;
    
    return symbol_it->second;
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

bool MatchingEngine::is_circuit_breaker_triggered(const std::string& symbol) const {
    std::shared_lock lock(engine_mutex_);
    
    auto it = circuit_breakers_.find(symbol);
    if (it == circuit_breakers_.end()) return false;
    
    if (!it->second.triggered) return false;
    
    // Check cooldown
    auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    
    if (now - it->second.trigger_time > config_.circuit_breaker_cooldown_ns) {
        // Cooldown passed - reset
        return false;
    }
    
    return true;
}

void MatchingEngine::trigger_circuit_breaker(const std::string& symbol) {
    std::unique_lock lock(engine_mutex_);
    
    auto it = circuit_breakers_.find(symbol);
    if (it != circuit_breakers_.end()) {
        it->second.triggered = true;
        it->second.trigger_time = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
    }
}

void MatchingEngine::reset_circuit_breaker(const std::string& symbol) {
    std::unique_lock lock(engine_mutex_);
    
    auto it = circuit_breakers_.find(symbol);
    if (it != circuit_breakers_.end()) {
        it->second.triggered = false;
        it->second.reason.clear();
    }
}

// ============================================================================
// STATISTICS
// ============================================================================

MatchingEngine::EngineStats MatchingEngine::get_stats() const {
    EngineStats stats = stats_;
    stats.market_count = markets_.size();
    stats.order_count = order_books_.empty() ? 0 : order_books_.begin()->second->order_count();
    return stats;
}

double MatchingEngine::average_latency() const {
    uint64_t total = stats_.total_latency.load();
    uint64_t count = stats_.total_orders.load();
    return count > 0 ? static_cast<double>(total) / count : 0.0;
}

uint64_t MatchingEngine::p99_latency() const {
    // Simplified p99 calculation
    return stats_.max_latency.load();
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

std::vector<OrderResult> MatchingEngine::submit_batch(std::vector<Order>& orders) {
    std::vector<OrderResult> results;
    results.reserve(orders.size());
    
    for (auto& order : orders) {
        results.push_back(submit_order(order));
    }
    
    return results;
}

uint32_t MatchingEngine::process_queue() {
    std::unique_lock lock(engine_mutex_);
    
    uint32_t count = 0;
    std::vector<Order> orders;
    
    while (!order_queue_.empty()) {
        orders.push_back(order_queue_.front());
        order_queue_.pop();
        count++;
    }
    
    lock.unlock();
    
    // Process orders
    for (auto& order : orders) {
        submit_order(order);
    }
    
    return count;
}

// ============================================================================
// CALLBACKS
// ============================================================================

void MatchingEngine::set_trade_callback(TradeCallback callback) {
    trade_callback_ = callback;
}

void MatchingEngine::set_order_callback(OrderCallback callback) {
    order_callback_ = callback;
}

void MatchingEngine::set_market_callback(MarketCallback callback) {
    market_callback_ = callback;
}

// ============================================================================
// MAINTENANCE
// ============================================================================

uint32_t MatchingEngine::cleanup_expired_orders() {
    std::unique_lock lock(engine_mutex_);
    
    uint32_t count = 0;
    auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    
    for (auto& book_pair : order_books_) {
        auto& book = book_pair.second;
        
        // Get all orders and check expiration
        std::vector<OrderId> expired_ids;
        
        // Note: In production, implement proper iteration
        // For now, just return count
        (void)now;
    }
    
    return count;
}

void MatchingEngine::compact_order_books() {
    std::unique_lock lock(engine_mutex_);
    
    for (auto& book_pair : order_books_) {
        // In production, implement compaction
        (void)book_pair;
    }
}

void MatchingEngine::sync_to_storage() {
    // In production, implement persistence
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

bool MatchingEngine::validate_order(const Order& order, std::string& error) {
    // Check market exists
    if (!has_market(order.symbol)) {
        error = "Market not found";
        return false;
    }
    
    // Check market is open
    auto* market = get_market(order.symbol);
    if (!market) {
        error = "Market not found";
        return false;
    }
    
    if (market->state != MarketState::Open) {
        error = "Market not open for trading";
        return false;
    }
    
    // Check circuit breaker
    if (is_circuit_breaker_triggered(order.symbol)) {
        error = "Circuit breaker triggered";
        return false;
    }
    
    // Validate price
    if (order.price[0] <= 0) {
        error = "Invalid price";
        return false;
    }
    
    // Validate quantity
    if (order.quantity[0] <= 0) {
        error = "Invalid quantity";
        return false;
    }
    
    return true;
}

OrderResult MatchingEngine::process_order(Order& order) {
    OrderResult result;
    
    // Check risk
    RiskCheckResult risk = check_risk(order);
    if (!risk.allowed) {
        result.success = false;
        result.status = OrderStatus::Rejected;
        result.error_message = risk.reason;
        return result;
    }
    
    // Execute match
    MatchResult match = execute_match(order);
    
    if (!match.success) {
        result.success = false;
        result.status = OrderStatus::Rejected;
        result.error_message = match.error_message;
        return result;
    }
    
    // Build result
    result.success = true;
    result.order_id = order.id;
    result.status = order.status;
    result.trades = std::move(match.trades);
    result.avg_fill_price = order.price;
    result.filled_quantity = order.filled_quantity;
    
    // Calculate fees
    int64_t total_fee = 0;
    for (const auto& trade : result.trades) {
        total_fee += trade.fee[0];
    }
    result.fee = int64_to_price(total_fee, result.filled_quantity[1]);
    
    result.created_at = order.created_at.count();
    result.updated_at = order.updated_at.count();
    
    // Update positions
    for (const auto& trade : result.trades) {
        update_position(trade);
    }
    
    // Trigger callbacks
    if (order_callback_) {
        order_callback_(order);
    }
    
    for (const auto& trade : result.trades) {
        if (trade_callback_) {
            trade_callback_(trade);
        }
        
        // Store in recent trades
        recent_trades_[trade.symbol].push_back(trade);
        if (recent_trades_[trade.symbol].size() > 1000) {
            recent_trades_[trade.symbol].pop_front();
        }
    }
    
    return result;
}

MatchResult MatchingEngine::execute_match(Order& order) {
    MatchResult result;
    result.success = true;
    
    // Get order book
    auto book_it = order_books_.find(order.symbol);
    if (book_it == order_books_.end()) {
        result.success = false;
        result.error_message = "Market not found";
        return result;
    }
    
    auto* book = book_it->second.get();
    
    // Process match based on order type
    switch (order.type) {
        case OrderType::Market:
        case OrderType::Limit:
        case OrderType::StopLossLimit:
        case OrderType::TakeProfitLimit: {
            // Standard matching
            uint32_t count = book->match_order(order, result.trades);
            result.trades_generated = count;
            
            // Calculate volume
            for (const auto& trade : result.trades) {
                result.total_volume += trade.quantity[0] * trade.price[0];
                result.total_fees += trade.fee[0];
            }
            break;
        }
        
        case OrderType::StopLoss:
        case OrderType::TakeProfit: {
            // Stop orders - add to watch list
            // In production, implement stop order processing
            result.success = true;
            break;
        }
        
        case OrderType::OCO: {
            // One Cancels Other - implement OCO logic
            result.success = true;
            break;
        }
        
        case OrderType::TrailingStop: {
            // Trailing stop - implement trailing logic
            result.success = true;
            break;
        }
        
        default:
            result.success = false;
            result.error_message = "Unsupported order type";
            return result;
    }
    
    return result;
}

void MatchingEngine::update_position(const Trade& trade) {
    std::unique_lock lock(balance_mutex_);
    
    int64_t position_change = trade.quantity[0];
    if (trade.side == OrderSide::Sell) {
        position_change = -position_change;
    }
    
    positions_[trade.fee_user_id][trade.symbol] += position_change;
}

bool MatchingEngine::check_circuit_breaker(const std::string& symbol, const Price& price) {
    // Check price movement
    auto book_it = order_books_.find(symbol);
    if (book_it == order_books_.end()) return false;
    
    const auto* book = book_it->second.get();
    Price last_price = book->get_last_price();
    
    if (last_price[0] == 0) return false;
    
    // Calculate price change percentage
    int64_t change = std::abs(price[0] - last_price[0]) * 100 / last_price[0];
    
    if (change > config_.circuit_breaker_threshold) {
        trigger_circuit_breaker(symbol);
        return true;
    }
    
    return false;
}

void MatchingEngine::update_stats(const Trade& trade, uint64_t latency_ns) {
    stats_.total_trades.fetch_add(1);
    stats_.total_volume.fetch_add(trade.quantity[0] * trade.price[0]);
    stats_.total_fees.fetch_add(trade.fee[0]);
    
    // Update latency
    uint64_t old_min = stats_.min_latency.load();
    while (latency_ns < old_min && !stats_.min_latency.compare_exchange_weak(old_min, latency_ns)) {}
    
    uint64_t old_max = stats_.max_latency.load();
    while (latency_ns > old_max && !stats_.max_latency.compare_exchange_weak(old_max, latency_ns)) {}
    
    stats_.total_latency.fetch_add(latency_ns);
}

OrderBook* MatchingEngine::get_or_create_book(const std::string& symbol) {
    auto it = order_books_.find(symbol);
    if (it != order_books_.end()) {
        return it->second.get();
    }
    
    // Create new book
    auto book = std::make_unique<OrderBook>(symbol, MarketType::Spot);
    OrderBook* book_ptr = book.get();
    order_books_[symbol] = std::move(book);
    
    return book_ptr;
}

} // namespace tigerex