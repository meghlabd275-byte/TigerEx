#pragma once

#include <string>
#include <vector>
#include <algorithm>
#include <map>
#include <queue>
#include <memory>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <cstdint>
#include <array>
#include <functional>
#include <optional>
#include <variant>

// Lock-free ring buffer for low-latency market data distribution
template<typename T, size_t Capacity>
class LockFreeRingBuffer {
public:
    LockFreeRingBuffer() : head_(0), tail_(0), size_(0) {
        buffer_.fill(T{});
    }

    bool push(const T& item) {
        size_t current_tail = tail_.load(std::memory_order_relaxed);
        size_t next_tail = (current_tail + 1) & (Capacity - 1);
        
        if (next_tail == head_.load(std::memory_order_acquire)) {
            return false; // Buffer full
        }
        
        buffer_[current_tail] = item;
        tail_.store(next_tail, std::memory_order_release);
        size_.fetch_add(1, std::memory_order_relaxed);
        return true;
    }

    std::optional<T> pop() {
        size_t current_head = head_.load(std::memory_order_relaxed);
        
        if (current_head == tail_.load(std::memory_order_acquire)) {
            return std::nullopt; // Buffer empty
        }
        
        T item = buffer_[current_head];
        size_t next_head = (current_head + 1) & (Capacity - 1);
        head_.store(next_head, std::memory_order_release);
        size_.fetch_sub(1, std::memory_order_relaxed);
        return item;
    }

    bool is_empty() const {
        return head_.load(std::memory_order_acquire) == tail_.load(std::memory_order_acquire);
    }

    size_t size() const {
        return size_.load(std::memory_order_relaxed);
    }

private:
    std::array<T, Capacity> buffer_;
    alignas(64) std::atomic<size_t> head_;
    alignas(64) std::atomic<size_t> tail_;
    std::atomic<size_t> size_;
};

// Price-Time priority book using red-black tree simulation with heaps
// For O(log n) insertion and removal
struct OrderBook {
    struct Order {
        std::string id;
        uint64_t user_id;
        uint64_t order_id;
        double price;
        int64_t quantity;
        int64_t filled_quantity;
        bool is_buy;
        uint64_t timestamp;
        uint32_t fees;
        
        bool is_full_fill() const { return filled_quantity >= quantity; }
        int64_t remaining() const { return quantity - filled_quantity; }
    };

    struct PriceLevel {
        double price;
        int64_t total_quantity;
        std::vector<Order> orders;
        
        PriceLevel(double p) : price(p), total_quantity(0) {}
    };

    // Min-heap for asks (ascending price), max-heap for bids (descending price)
    // Using std::priority_queue with custom comparator
    struct Bid comparator {
        bool operator()(const PriceLevel* a, const PriceLevel* b) const {
            return a->price < b->price; // Higher price first = better bid
        }
    };
    
    struct AskComparator {
        bool operator()(const PriceLevel* a, const PriceLevel* b) const {
            return a->price > b->price; // Lower price first = better ask
        }
    };

    using LevelMap = std::map<double, std::unique_ptr<PriceLevel>>;

    // Order ID index for O(1) lookup
    struct OrderIndex {
        std::unordered_map<std::string, Order*> orders;
        std::shared_mutex mtx;
        
        void insert(const std::string& id, Order* o) {
            std::unique_lock lock(mtx);
            orders[id] = o;
        }
        
        void erase(const std::string& id) {
            std::unique_lock lock(mtx);
            orders.erase(id);
        }
        
        Order* find(const std::string& id) {
            std::shared_lock lock(mtx);
            auto it = orders.find(id);
            return it != orders.end() ? it->second : nullptr;
        }
    };

    LevelMap bid_levels_;
    LevelMap ask_levels_;
    OrderIndex index_;
    
    // Market data publish ring buffer - 65536 capacity power of 2
    static constexpr size_t kMarketDataCapacity = 65536;
    LockFreeRingBuffer<MarketDataUpdate, kMarketDataCapacity> market_data_;
    
    struct MarketDataUpdate {
        uint64_t timestamp;
        double bid_price;
        double ask_price;
        int64_t bid_quantity;
        int64_t ask_quantity;
        char symbol[16];
    };

    // High-performance trade matching with price-time priority
    struct TradeResult {
        std::string order_id;
        std::string counterparty_id;
        double price;
        int64_t quantity;
        uint64_t timestamp;
        
        bool is_buyer_maker;
        bool is_taker;
        uint32_t fee;
    };

    // Thread-safe order management
    std::shared_mutex book_mutex_;

    void add_order(const Order& order) {
        std::unique_lock lock(book_mutex_);
        
        auto& levels = order.is_buy ? bid_levels_ : ask_levels_;
        auto it = levels.find(order.price);
        
        PriceLevel* level = nullptr;
        if (it == levels.end()) {
            auto ptr = std::make_unique<PriceLevel>(order.price);
            level = ptr.get();
            levels[order.price] = std::move(ptr);
        } else {
            level = it->second.get();
        }
        
        level->orders.push_back(order);
        level->total_quantity += order.quantity;
        
        auto* order_ptr = &level->orders.back();
        index_.insert(order.id, order_ptr);
        
        // Publish market data update
        publish_market_data();
    }

    std::vector<TradeResult> match() {
        std::unique_lock lock(book_mutex_);
        std::vector<TradeResult> trades;
        
        auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();

        while (!bid_levels_.empty() && !ask_levels_.empty()) {
            auto& best_bid = bid_levels_.begin()->second;
            auto& best_ask = ask_levels_.begin()->second;

            // Price crossed - match
            if (best_bid->price >= best_ask->price && !best_bid->orders.empty() && !best_ask->orders.empty()) {
                auto& bid = best_bid->orders.front();
                auto& ask = best_ask->orders.front();

                int64_t match_qty = std::min(bid.remaining(), ask.remaining());
                
                TradeResult trade;
                trade.order_id = bid.id;
                trade.counterparty_id = ask.id;
                trade.price = best_ask->price; // Aggressive side gets price improvement
                trade.quantity = match_qty;
                trade.timestamp = now;
                trade.is_buyer_maker = !bid.is_buy;
                trade.is_taker = true;
                trade.fee = calculate_fee(match_qty * trade.price);
                
                trades.push_back(trade);

                // Update quantities
                bid.filled_quantity += match_qty;
                ask.filled_quantity += match_qty;
                best_bid->total_quantity -= match_qty;
                best_ask->total_quantity -= match_qty;

                // Remove fully filled orders (FIFO by timestamp within price level)
                if (bid.is_full_fill()) {
                    index_.erase(bid.id);
                    best_bid->orders.erase(best_bid->orders.begin());
                }
                if (ask.is_full_fill()) {
                    index_.erase(ask.id);
                    best_ask->orders.erase(best_ask->orders.begin());
                }

                // Clean up empty price levels
                if (best_bid->total_quantity <= 0) {
                    bid_levels_.erase(bid_levels_.begin());
                }
                if (best_ask->total_quantity <= 0) {
                    ask_levels_.erase(ask_levels_.begin());
                }
            } else {
                break;
            }
        }
        
        return trades;
    }

    void cancel_order(const std::string& order_id) {
        std::unique_lock lock(book_mutex_);
        
        Order* order = index_.find(order_id);
        if (!order) return;

        auto& levels = order->is_buy ? bid_levels_ : ask_levels_;
        auto it = levels.find(order->price);
        
        if (it != levels.end()) {
            auto& level = it->second;
            level->total_quantity -= order->remaining();
            
            // Remove order from level
            level->orders.erase(
                std::remove_if(level->orders.begin(), level->orders.end(),
                    [&order_id](const Order& o) { return o.id == order_id; }),
                level->orders.end()
            );
            
            // Clean up empty level
            if (level->orders.empty()) {
                levels.erase(it);
            }
        }
        
        index_.erase(order_id);
    }

    void modify_order(const std::string& order_id, int64_t new_quantity, double new_price) {
        std::unique_lock lock(book_mutex_);
        
        Order* order = index_.find(order_id);
        if (!order || order->is_full_fill()) return;

        cancel_order(order_id);
        
        Order modified = *order;
        modified.quantity = new_quantity;
        if (new_price > 0) {
            modified.price = new_price;
        }
        modified.timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
        
        add_order(modified);
    }

    // Calculate fees based on volume tier
    uint32_t calculate_fee(double volume) const {
        // Tiered fee structure (0.02% - 0.1%)
        if (volume >= 1000000000) return 20;      // VIP: 0.02%
        if (volume >= 100000000) return 40;     // Premium: 0.04%
        if (volume >= 10000000) return 60;     // Standard: 0.06%
        return 100;                             // Default: 0.1%
    }

    // Market data publishing
    void publish_market_data() {
        MarketDataUpdate update;
        update.timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();

        if (!bid_levels_.empty()) {
            update.bid_price = bid_levels_.begin()->first;
            update.bid_quantity = bid_levels_.begin()->second->total_quantity;
        } else {
            update.bid_price = 0;
            update.bid_quantity = 0;
        }

        if (!ask_levels_.empty()) {
            update.ask_price = ask_levels_.begin()->first;
            update.ask_quantity = ask_levels_.begin()->second->total_quantity;
        } else {
            update.ask_price = 0;
            update.ask_quantity = 0;
        }

        market_data_.push(update);
    }

    // Get top of book for REST API
    BookTicker get_ticker() const {
        BookTicker ticker;
        
        std::shared_lock lock(book_mutex_);
        
        if (!bid_levels_.empty()) {
            ticker.bid_price = bid_levels_.begin()->first;
            ticker.bid_quantity = bid_levels_.begin()->second->total_quantity;
        }
        
        if (!ask_levels_.empty()) {
            ticker.ask_price = ask_levels_.begin()->first;
            ticker.ask_quantity = ask_levels_.begin()->second->total_quantity;
        }
        
        return ticker;
    }

    struct BookTicker {
        double bid_price = 0;
        int64_t bid_quantity = 0;
        double ask_price = 0;
        int64_t ask_quantity = 0;
        uint64_t timestamp;
    };
};

} // namespace matcher