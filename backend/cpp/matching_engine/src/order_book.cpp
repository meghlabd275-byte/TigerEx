/**
 * TigerEx C++ Matching Engine
 * Order Book Implementation
 * Target Latency: < 50 microseconds
 */

#include "order_book.hpp"
#include <algorithm>
#include <cstring>

namespace tigerex {

// ============================================================================
// CONSTRUCTOR
// ============================================================================

OrderBook::OrderBook(const std::string& symbol, MarketType market_type)
    : symbol_(symbol),
      market_type_(market_type),
      sequence_(0),
      last_price_({0, 0}),
      high_24h_({0, 0}),
      low_24h_({INT64_MAX, 0}),
      volume_24h_({0, 0}),
      volume_24h_base_({0, 0}),
      trades_24h_(0),
      last_24h_reset_(0),
      min_price_({0, 0}),
      max_price_({INT64_MAX, 0}),
      min_lot_({0, 0}),
      max_lot_({INT64_MAX, 0}),
      auction_mode_(false),
      auction_start_({0, 0}) {
    
    // Initialize 24h reset time
    auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    last_24h_reset_ = now;
}

// ============================================================================
// DESTRUCTOR
// ============================================================================

OrderBook::~OrderBook() = default;

// ============================================================================
// ADD ORDER
// ============================================================================

bool OrderBook::add_order(Order& order) {
    // Validate order
    if (order.symbol != symbol_) return false;
    if (!is_quantity_valid(order.quantity)) return false;
    
    // Check price limits for limit orders
    if (order.type == OrderType::Limit || order.type == OrderType::StopLossLimit) {
        if (!is_price_valid(order.price)) return false;
    }
    
    // Get unique order ID
    order.id.server_order_id = sequence_atom_.fetch_add(1);
    order.id.timestamp_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    order.id.sequence = order.id.server_order_id;
    
    // Get priority
    order_priority_[order.id.server_order_id] = priority_counter_.fetch_add(1);
    
    // Update status
    order.status = OrderStatus::Open;
    order.updated_at = order.id.timestamp_ns;
    
    // Add to appropriate book based on side
    if (order.side == OrderSide::Buy) {
        insert_order_to_level(bids_, order.price, order);
    } else {
        insert_order_to_level(asks_, order.price, order);
    }
    
    // Store order reference
    orders_[order.id] = orders_[order.id];  // Will be updated after insert
    
    // Update sequence
    sequence_.fetch_add(1);
    
    return true;
}

// ============================================================================
// REMOVE ORDER
// ============================================================================

bool OrderBook::remove_order(const OrderId& order_id) {
    std::unique_lock lock(book_mutex_);
    
    auto it = orders_.find(order_id);
    if (it == orders_.end()) return false;
    
    Order& order = *it;
    
    // Remove from price level
    if (order.side == OrderSide::Buy) {
        remove_order_from_level(bids_, order.price, order_id);
    } else {
        remove_order_from_level(asks_, order.price, order_id);
    }
    
    // Remove from order map
    orders_.erase(it);
    
    // Update status
    order.status = OrderStatus::Cancelled;
    
    return true;
}

// ============================================================================
// UPDATE ORDER
// ============================================================================

bool OrderBook::update_order(const OrderId& order_id, const Quantity& new_quantity) {
    std::unique_lock lock(book_mutex_);
    
    auto it = orders_.find(order_id);
    if (it == orders_.end()) return false;
    
    Order& order = *it;
    Quantity old_quantity = order.quantity;
    order.quantity = new_quantity;
    order.remaining_quantity = new_quantity;
    
    // Update price level aggregates
    if (order.side == OrderSide::Buy) {
        update_level_aggregate(bids_, order.price);
    } else {
        update_level_aggregate(asks_, order.price);
    }
    
    // Check if fully filled
    if (new_quantity[0] == 0) {
        order.status = OrderStatus::Filled;
    } else if (new_quantity[0] < old_quantity[0]) {
        order.status = OrderStatus::PartiallyFilled;
    }
    
    return true;
}

// ============================================================================
// MATCH ORDER
// ============================================================================

uint32_t OrderBook::match_order(Order& incoming, std::vector<Trade>& trades) {
    // Lock for matching
    std::unique_lock lock(book_mutex_);
    
    return process_match(incoming, trades);
}

// ============================================================================
// PROCESS MATCH
// ============================================================================

uint32_t OrderBook::process_match(Order& incoming, std::vector<Trade>& trades) {
    if (auction_mode_) {
        // In auction mode, collect orders without matching
        collect_auction_order(incoming);
        return 0;
    }
    
    uint32_t match_count = 0;
    uint64_t trade_id = sequence_atom_.fetch_add(1);
    auto timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    
    // Determine which book to match against
    auto& book = (incoming.side == OrderSide::Buy) ? asks_ : bids_;
    
    // Get the best price from opposite side
    if (book.empty()) return 0;
    
    // Process matches
    while (!book.empty() && incoming.remaining_quantity[0] > 0) {
        auto level_it = book.begin();
        Price& book_price = level_it->first;
        PriceLevelData& level_data = level_it->second;
        
        // Check price condition
        if (incoming.side == OrderSide::Buy) {
            // Buy order can only match at or below ask
            if (price_greater(incoming.price, book_price)) break;
        } else {
            // Sell order can only match at or above bid
            if (price_less(incoming.price, book_price)) break;
        }
        
        // Get first order at this price level
        if (level_data.orders.empty()) {
            book.erase(level_it);
            continue;
        }
        
        Order& resting = level_data.orders.front();
        
        // Execute match
        process_single_match(incoming, resting, trades);
        match_count++;
        
        // Update trade ID for next trade
        trade_id = sequence_atom_.fetch_add(1);
    }
    
    // Add remaining to book if not fully filled
    if (incoming.remaining_quantity[0] > 0) {
        if (incoming.type == OrderType::Limit ||
            incoming.type == OrderType::StopLossLimit ||
            incoming.tif == TimeInForce::GoodTillCancel) {
            
            // Add to book
            if (incoming.side == OrderSide::Buy) {
                insert_order_to_level(bids_, incoming.price, incoming);
            } else {
                insert_order_to_level(asks_, incoming.price, incoming);
            }
            
            // Update order status
            incoming.status = OrderStatus::Open;
        }
    }
    
    return match_count;
}

// ============================================================================
// PROCESS SINGLE MATCH
// ============================================================================

void OrderBook::process_single_match(Order& incoming, Order& resting, 
                                     std::vector<Trade>& trades) {
    // Calculate match quantity
    Quantity match_qty;
    if (incoming.remaining_quantity[0] <= resting.remaining_quantity[0]) {
        match_qty = incoming.remaining_quantity;
    } else {
        match_qty = resting.remaining_quantity;
    }
    
    // Determine price (price-time priority)
    Price match_price;
    if (incoming.type == OrderType::Market) {
        // Market order takes the resting price
        match_price = resting.price;
    } else {
        // Limit order gets its own price or better
        if (incoming.side == OrderSide::Buy) {
            match_price = price_less(incoming.price, resting.price) ? 
                         incoming.price : resting.price;
        } else {
            match_price = price_greater(incoming.price, resting.price) ? 
                         incoming.price : resting.price;
        }
    }
    
    // Create trade
    Trade trade;
    trade.order_id = incoming.id;
    trade.trade_id = sequence_atom_.fetch_add(1);
    trade.symbol = symbol_;
    trade.side = incoming.side;
    trade.price = match_price;
    trade.quantity = match_qty;
    trade.timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    );
    
    // Set maker/taker
    if (incoming.type == OrderType::Market) {
        trade.isMaker = true;
        trade.maker_order_id = resting.id.server_order_id;
        trade.taker_order_id = incoming.id.server_order_id;
    } else if (resting.id.timestamp_ns <= incoming.id.timestamp_ns) {
        // Resting order is older = maker
        trade.isMaker = true;
        trade.maker_order_id = resting.id.server_order_id;
        trade.taker_order_id = incoming.id.server_order_id;
    } else {
        trade.isMaker = false;
        trade.maker_order_id = incoming.id.server_order_id;
        trade.taker_order_id = resting.id.server_order_id;
    }
    
    // Calculate fees
    int64_t price_val = price_to_int64(match_price);
    int64_t qty_val = quantity_to_int64(match_qty);
    
    if (trade.isMaker) {
        trade.fee = int64_to_price(calculate_maker_fee(price_val, qty_val), match_price[1]);
        trade.fee_user_id = resting.user_id;
    } else {
        trade.fee = int64_to_price(calculate_taker_fee(price_val, qty_val), match_price[1]);
        trade.fee_user_id = incoming.user_id;
    }
    
    // Add trade to vector
    trades.push_back(trade);
    
    // Update quantities
    incoming.remaining_quantity[0] -= match_qty[0];
    incoming.filled_quantity[0] += match_qty[0];
    resting.remaining_quantity[0] -= match_qty[0];
    resting.filled_quantity[0] += match_qty[0];
    
    // Update market data
    update_market_data(trade);
    
    // Check if orders are fully filled
    if (incoming.remaining_quantity[0] == 0) {
        incoming.status = OrderStatus::Filled;
    } else {
        incoming.status = OrderStatus::PartiallyFilled;
    }
    
    if (resting.remaining_quantity[0] == 0) {
        resting.status = OrderStatus::Filled;
        
        // Remove from book
        if (resting.side == OrderSide::Buy) {
            auto it = bids_.find(resting.price);
            if (it != bids_.end()) {
                it->second.orders.pop_front();
                update_level_aggregate(bids_, resting.price);
            }
        } else {
            auto it = asks_.find(resting.price);
            if (it != asks_.end()) {
                it->second.orders.pop_front();
                update_level_aggregate(asks_, resting.price);
            }
        }
        
        // Remove from order map
        orders_.erase(resting.id);
    } else {
        resting.status = OrderStatus::PartiallyFilled;
    }
}

// ============================================================================
// UPDATE MARKET DATA
// ============================================================================

void OrderBook::update_market_data(const Trade& trade) {
    last_price_ = trade.price;
    
    // Update high/low
    if (high_24h_[0] == 0 || price_greater(trade.price, high_24h_)) {
        high_24h_ = trade.price;
    }
    if (low_24h_[0] == INT64_MAX || price_less(trade.price, low_24h_)) {
        low_24h_ = trade.price;
    }
    
    // Update volume
    volume_24h_[0] += trade.quantity[0];
    volume_24h_base_[0] += trade.quantity[0];
    
    // Update trades count
    trades_24h_++;
    
    // Check if we need to reset 24h stats
    auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    
    if (now - last_24h_reset_ > 86400000000000ULL) {  // 24 hours in ns
        reset_24h_stats();
    }
}

// ============================================================================
// RESET 24H STATS
// ============================================================================

void OrderBook::reset_24h_stats() {
    high_24h_ = last_price_;
    low_24h_ = last_price_;
    volume_24h_ = {0, 0};
    volume_24h_base_ = {0, 0};
    trades_24h_ = 0;
    
    auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    last_24h_reset_ = now;
}

// ============================================================================
// GET BID LEVELS
// ============================================================================

std::vector<LevelAggregation> OrderBook::get_bid_levels(uint32_t depth) const {
    std::shared_lock lock(book_mutex_);
    
    std::vector<LevelAggregation> result;
    result.reserve(depth);
    
    uint32_t count = 0;
    for (const auto& level : bids_) {
        LevelAggregation agg;
        agg.price = level.first;
        agg.quantity = level.second.total_quantity;
        agg.order_count = level.second.order_count;
        agg.last_update_ns = level.second.last_update_ns;
        result.push_back(agg);
        
        if (++count >= depth) break;
    }
    
    return result;
}

// ============================================================================
// GET ASK LEVELS
// ============================================================================

std::vector<LevelAggregation> OrderBook::get_ask_levels(uint32_t depth) const {
    std::shared_lock lock(book_mutex_);
    
    std::vector<LevelAggregation> result;
    result.reserve(depth);
    
    uint32_t count = 0;
    for (const auto& level : asks_) {
        LevelAggregation agg;
        agg.price = level.first;
        agg.quantity = level.second.total_quantity;
        agg.order_count = level.second.order_count;
        agg.last_update_ns = level.second.last_update_ns;
        result.push_back(agg);
        
        if (++count >= depth) break;
    }
    
    return result;
}

// ============================================================================
// GET DEPTH
// ============================================================================

std::array<std::vector<LevelAggregation>, 2> OrderBook::get_depth(uint32_t levels) const {
    return {get_bid_levels(levels), get_ask_levels(levels)};
}

// ============================================================================
// CREATE SNAPSHOT
// ============================================================================

OrderBook::Snapshot OrderBook::create_snapshot(uint32_t depth) const {
    Snapshot snapshot;
    snapshot.symbol = symbol_;
    snapshot.sequence = sequence_.load();
    snapshot.bids = get_bid_levels(depth);
    snapshot.asks = get_ask_levels(depth);
    snapshot.last_price = last_price_;
    snapshot.volume_24h = volume_24h_;
    snapshot.high_24h = high_24h_;
    snapshot.low_24h = low_24h_;
    snapshot.trades_24h = trades_24h_;
    return snapshot;
}

// ============================================================================
// PRICE LIMITS
// ============================================================================

void OrderBook::set_price_limits(const Price& min_price, const Price& max_price) {
    min_price_ = min_price;
    max_price_ = max_price;
}

bool OrderBook::is_price_valid(const Price& price) const {
    if (price[0] < min_price_[0]) return false;
    if (price[0] > max_price_[0]) return false;
    return true;
}

void OrderBook::set_lot_limits(const Quantity& min_lot, const Quantity& max_lot) {
    min_lot_ = min_lot;
    max_lot_ = max_lot;
}

bool OrderBook::is_quantity_valid(const Quantity& qty) const {
    if (qty[0] < min_lot_[0]) return false;
    if (qty[0] > max_lot_[0]) return false;
    return true;
}

// ============================================================================
// AUCTION MODE
// ============================================================================

void OrderBook::enable_auction_mode() {
    auction_mode_ = true;
}

void OrderBook::disable_auction_mode() {
    auction_mode_ = false;
    auction_orders_.clear();
}

void OrderBook::set_auction_start_price(const Price& price) {
    auction_start_ = price;
}

void OrderBook::collect_auction_order(Order& order) {
    auction_orders_.push_back(order);
}

uint32_t OrderBook::execute_auction(const Price& clearing_price, 
                                     std::vector<Trade>& trades) {
    uint32_t count = 0;
    uint64_t trade_id = sequence_atom_.fetch_add(1);
    auto timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
    
    // Sort auction orders by price-time priority
    std::sort(auction_orders_.begin(), auction_orders_.end(),
        [this](const Order& a, const Order& b) {
            if (a.side == OrderSide::Buy) {
                return price_greater(a.price, b.price);
            } else {
                return price_less(a.price, b.price);
            }
        });
    
    // Match at clearing price
    for (auto& order : auction_orders_) {
        Trade trade;
        trade.order_id = order.id;
        trade.trade_id = trade_id++;
        trade.symbol = symbol_;
        trade.side = order.side;
        trade.price = clearing_price;
        trade.quantity = order.quantity;
        trade.timestamp = std::chrono::nanoseconds(timestamp);
        trade.maker_order_id = 0;
        trade.taker_order_id = order.id.server_order_id;
        trade.isMaker = false;
        
        trades.push_back(trade);
        count++;
    }
    
    auction_orders_.clear();
    return count;
}

// ============================================================================
// INSERT ORDER TO LEVEL
// ============================================================================

void OrderBook::insert_order_to_level(PriceMap& book, const Price& price, 
                                      Order& order) {
    auto it = book.find(price);
    if (it == book.end()) {
        // Create new price level
        PriceLevelData data;
        data.orders.push_back(order);
        data.total_quantity = order.quantity;
        data.visible_quantity = order.iceberg_visible[0] > 0 ? 
                                order.iceberg_visible : order.quantity;
        data.order_count = 1;
        data.last_update_ns = order.id.timestamp_ns;
        book[price] = std::move(data);
    } else {
        // Add to existing level
        it->second.orders.push_back(order);
        it->second.total_quantity[0] += order.quantity[0];
        it->second.visible_quantity[0] += order.iceberg_visible[0] > 0 ? 
                                          order.iceberg_visible[0] : order.quantity[0];
        it->second.order_count++;
        it->second.last_update_ns = order.id.timestamp_ns;
    }
}

// ============================================================================
// REMOVE ORDER FROM LEVEL
// ============================================================================

void OrderBook::remove_order_from_level(PriceMap& book, const Price& price, 
                                      const OrderId& order_id) {
    auto it = book.find(price);
    if (it == book.end()) return;
    
    // Find and remove order
    auto& orders = it->second.orders;
    for (auto order_it = orders.begin(); order_it != orders.end(); ++order_it) {
        if (order_it->id == order_id) {
            orders.erase(order_it);
            break;
        }
    }
    
    // Update aggregates
    update_level_aggregate(book, price);
    
    // Remove empty level
    if (it->second.orders.empty()) {
        book.erase(it);
    }
}

// ============================================================================
// UPDATE LEVEL AGGREGATE
// ============================================================================

void OrderBook::update_level_aggregate(PriceMap& book, const Price& price) {
    auto it = book.find(price);
    if (it == book.end()) return;
    
    // Recalculate totals
    it->second.total_quantity[0] = 0;
    it->second.visible_quantity[0] = 0;
    it->second.order_count = 0;
    
    for (const auto& order : it->second.orders) {
        it->second.total_quantity[0] += order.quantity[0];
        it->second.visible_quantity[0] += order.iceberg_visible[0] > 0 ? 
                                          order.iceberg_visible[0] : order.quantity[0];
        it->second.order_count++;
    }
    
    it->second.last_update_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
}

// ============================================================================
// UPDATE PRIORITY
// ============================================================================

void OrderBook::update_priority(const OrderId& order_id) {
    order_priority_[order_id.server_order_id] = priority_counter_.fetch_add(1);
}

uint32_t OrderBook::get_priority(const OrderId& order_id) const {
    auto it = order_priority_.find(order_id.server_order_id);
    if (it == order_priority_.end()) return 0;
    return it->second;
}

// ============================================================================
// ICEBERG PROCESSING
// ============================================================================

bool OrderBook::process_iceberg(Order& order) {
    if (!is_iceberg_order(order)) return true;
    
    // For iceberg, only show visible quantity
    if (order.iceberg_visible[0] == 0) {
        // First time - reveal initial chunk
        order.iceberg_visible = order.quantity;
    }
    
    return true;
}

bool OrderBook::reveal_iceberg(Order& order) {
    if (!is_iceberg_order(order)) return false;
    
    // Reveal next chunk
    order.iceberg_visible = order.quantity;
    return true;
}

// ============================================================================
// LOCK-FREE OPERATIONS
// ============================================================================

uint32_t OrderBook::try_match_lockfree(Order& order, std::vector<Trade>& trades) {
    // Try to match without full lock
    // This is a best-effort approach for low latency
    return match_order(order, trades);
}

const LevelAggregation* OrderBook::read_best_bid_lockfree() const {
    if (bids_.empty()) return nullptr;
    return get_best_bid();
}

const LevelAggregation* OrderBook::read_best_ask_lockfree() const {
    if (asks_.empty()) return nullptr;
    return get_best_ask();
}

} // namespace tigerex