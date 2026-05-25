// MatchingEngine.cpp - Implementation
#include "matching_engine.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <thread>

namespace tigerex {

// OrderBook Implementation
OrderBook::OrderBook(const std::string& symbol) 
    : symbol_(symbol), last_trade_id_(0) {}

bool OrderBook::AddOrder(Order& order) {
    if (order.status != OrderStatus::PENDING && order.status != OrderStatus::OPEN) {
        return false;
    }
    
    std::unique_lock<std::shared_mutex> lock(mutex_);
    
    order.order_id = ++last_order_id_;
    orders_[order.order_id] = std::make_shared<Order>(order);
    
    if (order.type == OrderType::LIMIT) {
        auto& book = order.side == Side::BUY ? bids_ : asks_;
        book[order.price].push_back(orders_[order.order_id]);
    }
    
    // Try to match
    if (order.type == OrderType::MARKET || order.type == OrderType::LIMIT) {
        std::vector<Trade> trades = MatchOrder(order.order_id);
        if (!trades.empty()) {
            // Notify via callback
        }
    }
    
    return true;
}

std::vector<Trade> OrderBook::MatchOrder(uint64_t order_id) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    
    auto it = orders_.find(order_id);
    if (it == orders_.end()) {
        return {};
    }
    
    auto& order = *it->second;
    std::vector<Trade> trades;
    
    // Get opposite side book
    auto& book = order.side == Side::BUY ? asks_ : bids_;
    
    while (!order.filled_quantity >= order.quantity && !book.empty()) {
        auto level_it = book.begin();
        uint64_t level_price = level_it->first;
        auto& queue = level_it->second;
        
        // Check price condition
        bool can_match = order.side == Side::BUY 
            ? (level_price <= order.price || order.type == OrderType::MARKET)
            : (level_price >= order.price || order.type == OrderType::MARKET);
        
        if (!can_match) break;
        
        // Process orders at this level
        while (!queue.empty() && !order.filled_quantity >= order.quantity) {
            auto& matched_order = queue.front();
            
            uint64_t match_qty = std::min(
                order.quantity - order.filled_quantity,
                matched_order->quantity - matched_order->filled_quantity
            );
            
            // Update orders
            order.filled_quantity += match_qty;
            matched_order->filled_quantity += match_qty;
            
            // Calculate average price
            uint64_t exec_price = level_price;
            order.avg_price = ((order.avg_price * order.filled_quantity) + 
                           (exec_price * match_qty)) / order.quantity;
            
            // Create trade
            Trade trade = {
                ++last_trade_id_,
                order.order_id,
                matched_order->order_id,
                order.user_id,
                order.symbol,
                order.side,
                exec_price,
                match_qty,
                0, // fee calculated elsewhere
                "",
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()
                ).count()
            };
            trades.push_back(trade);
            recent_trades_.push_back(trade);
            
            // Remove fully filled orders
            if (matched_order->filled_quantity >= matched_order->quantity) {
                queue.pop_front();
                orders_.erase(matched_order->order_id);
            }
            
            if (order.filled_quantity >= order.quantity) {
                break;
            }
        }
        
        // Remove empty levels
        if (queue.empty()) {
            book.erase(level_it);
        }
    }
    
    // Update order status
    if (order.filled_quantity >= order.quantity) {
        order.status = OrderStatus::FILLED;
    } else if (order.filled_quantity > 0) {
        order.status = OrderStatus::PARTIALLY_FILLED;
    }
    
    return trades;
}

bool OrderBook::CancelOrder(uint64_t order_id) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    
    auto it = orders_.find(order_id);
    if (it == orders_.end()) {
        return false;
    }
    
    auto& order = *it->second;
    
    if (order.status == OrderStatus::FILLED || order.status == OrderStatus::CANCELLED) {
        return false;
    }
    
    // Remove from book
    auto& book = order.side == Side::BUY ? bids_ : asks_;
    auto price_it = book.find(order.price);
    if (price_it != book.end()) {
        auto& queue = price_it->second;
        queue.erase(
            std::remove_if(queue.begin(), queue.end(),
                [order_id](const std::shared_ptr<Order>& o) {
                    return o->order_id == order_id;
                }),
            queue.end()
        );
        if (queue.empty()) {
            book.erase(price_it);
        }
    }
    
    order.status = OrderStatus::CANCELLED;
    return true;
}

std::pair<uint64_t, uint64_t> OrderBook::GetBestBidAsk() const {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    
    uint64_t best_bid = 0;
    uint64_t best_ask = 0;
    
    if (!bids_.empty()) {
        best_bid = bids_.begin()->first;
    }
    if (!asks_.empty()) {
        best_ask = asks_.begin()->first;
    }
    
    return {best_bid, best_ask};
}

std::vector<PriceLevel> OrderBook::GetDepth(uint32_t levels) const {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    
    std::vector<PriceLevel> depth;
    
    uint32_t count = 0;
    for (auto& level : asks_) {
        if (count >= levels) break;
        
        uint64_t qty = 0;
        for (auto& order : level.second) {
            qty += order->quantity - order->filled_quantity;
        }
        
        depth.push_back({level.first, qty, level.second.size()});
        count++;
    }
    
    count = 0;
    for (auto& level : bids_) {
        if (count >= levels) break;
        
        uint64_t qty = 0;
        for (auto& order : level.second) {
            qty += order->quantity - order->filled_quantity;
        }
        
        depth.push_back({level.first, qty, level.second.size()});
        count++;
    }
    
    return depth;
}

std::vector<Trade> OrderBook::GetRecentTrades(uint32_t limit) const {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    
    if (recent_trades_.size() <= limit) {
        return recent_trades_;
    }
    
    return std::vector<Trade>(
        recent_trades_.end() - limit,
        recent_trades_.end()
    );
}

// MatchingEngine Implementation
MatchingEngine::MatchingEngine() : last_order_id_(0) {
    // Pre-register some symbols
    std::vector<std::string> default_symbols = {
        "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT",
        "XRP/USDT", "ADA/USDT", "AVAX/USDT", "DOT/USDT"
    };
    Initialize(default_symbols);
}

void MatchingEngine::Initialize(const std::string>& symbols) {
    std::unique_lock<std::shared_mutex> lock(mutex_);
    
    for (const auto& symbol : symbols) {
        books_[symbol] = std::make_shared<OrderBook>(symbol);
    }
}

std::shared_ptr<OrderBook> MatchingEngine::GetOrderBook(const std::string& symbol) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    
    auto it = books_.find(symbol);
    if (it != books_.end()) {
        return it->second;
    }
    return nullptr;
}

std::pair<uint64_t, std::vector<Trade>> MatchingEngine::SubmitOrder(Order& order) {
    auto book = GetOrderBook(order.symbol);
    if (!book) {
        return {0, {}};
    
    // Assign order ID
    order.order_id = ++last_order_id_;
    
    auto result = book->MatchOrder(order.order_id);
    return {order.order_id, result};
}

std::vector<std::string> MatchingEngine::GetMarkets() const {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    
    std::vector<std::string> markets;
    for (const auto& pair : books_) {
        markets.push_back(pair.first);
    }
    return markets;
}

} // namespace tigerex