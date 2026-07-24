/**
 * TigerEx High-Frequency Trading Engine
 * Ultra-low latency order execution
 * Built with C++ for maximum performance
 */

#include <iostream>
#include <vector>
#include <map>
#include <string>
#include <atomic>
#include <mutex>
#include <chrono>
#include <cmath>

constexpr int MAX_ORDERS = 1000000;
constexpr int CACHE_LINE_SIZE = 64;

struct Order {
    uint64_t order_id;
    uint64_t user_id;
    uint32_t market_id;
    uint8_t side;
    uint8_t type;
    uint64_t quantity;
    uint64_t price;
    uint64_t filled;
    uint8_t status;
    uint64_t timestamp;
};

struct Market {
    uint32_t id;
    std::string symbol;
    uint8_t status;
    uint64_t last_price;
    uint64_t volume_24h;
};

struct Trade {
    uint64_t trade_id;
    uint64_t order_id;
    uint32_t market_id;
    uint64_t price;
    uint64_t quantity;
    uint64_t fee;
};

class alignas(CACHE_LINE_SIZE) OrderBook {
private:
    uint64_t best_bid_;
    uint64_t best_ask_;
    uint64_t mid_price_;
    std::mutex mutex_;
    
public:
    OrderBook() : best_bid_(0), best_ask_(0), mid_price_(0) {}
    
    void addBid(uint64_t price, uint64_t qty) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (price > best_bid_ || best_bid_ == 0) {
            best_bid_ = price;
            mid_price_ = (best_bid_ + best_ask_) / 2;
        }
    }
    
    void addAsk(uint64_t price, uint64_t qty) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (best_ask_ == 0 || price < best_ask_) {
            best_ask_ = price;
            mid_price_ = (best_bid_ + best_ask_) / 2;
        }
    }
    
    uint64_t getBestBid() { return best_bid_; }
    uint64_t getBestAsk() { return best_ask_; }
    uint64_t getMidPrice() { return mid_price_; }
};

class HFTradingEngine {
private:
    std::atomic<uint64_t> order_counter_{0};
    std::atomic<uint64_t> trade_counter_{0};
    std::atomic<uint64_t> orders_processed_{0};
    std::atomic<uint64_t> orders_rejected_{0};
    std::atomic<uint64_t> total_latency_ns_{0};
    
    std::map<uint32_t, Market> markets_;
    std::map<uint64_t, Order> orders_;
    std::map<uint32_t, std::unique_ptr<OrderBook>> order_books_;
    
public:
    HFTradingEngine() {
        markets_[1] = {1, "BTC/USDT", 1, 50000000000, 1000000000};
        markets_[2] = {2, "ETH/USDT", 1, 2500000000, 50000000};
        order_books_[1] = std::make_unique<OrderBook>();
        order_books_[2] = std::make_unique<OrderBook>();
    }
    
    uint64_t submitOrder(uint64_t user_id, uint32_t market_id, uint8_t side, 
                        uint8_t type, uint64_t quantity, uint64_t price) {
        auto start = std::chrono::high_resolution_clock::now();
        
        if (markets_.find(market_id) == markets_.end()) {
            orders_rejected_.fetch_add(1);
            return 0;
        }
        
        uint64_t order_id = order_counter_.fetch_add(1) + 1;
        Order order = {order_id, user_id, market_id, side, type, quantity, price, 0, 0,
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count()};
        
        orders_[order_id] = order;
        
        if (type == 1) {
            if (side == 0) order_books_[market_id]->addBid(price, quantity);
            else order_books_[market_id]->addAsk(price, quantity);
        }
        
        orders_processed_.fetch_add(1);
        auto end = std::chrono::high_resolution_clock::now();
        total_latency_ns_.fetch_add(std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count());
        
        return order_id;
    }
    
    void printStats() {
        std::cout << "\n=== Trading Engine Stats ===\n";
        std::cout << "Orders: " << orders_processed_.load() << "\n";
        std::cout << "Rejected: " << orders_rejected_.load() << "\n";
        uint64_t count = orders_processed_.load();
        if (count > 0) {
            std::cout << "Avg Latency: " << (total_latency_ns_.load() / count / 1000) << " us\n";
        }
    }
};

int main() {
    std::cout << "TigerEx High-Frequency Trading Engine\n";
    std::cout << "====================================\n";
    
    HFTradingEngine engine;
    
    std::cout << "\nMarkets:\n";
    for (auto& m : engine.submitOrder(0, 0, 0, 0, 0, 0)) { } // Placeholder
    
    uint64_t o1 = engine.submitOrder(1, 1, 0, 1, 100000000, 50500000000);
    std::cout << "Order 1 (BUY LIMIT): " << o1 << "\n";
    
    uint64_t o2 = engine.submitOrder(2, 1, 1, 1, 50000000, 51000000000);
    std::cout << "Order 2 (SELL LIMIT): " << o2 << "\n";
    
    uint64_t o3 = engine.submitOrder(3, 1, 0, 0, 10000000, 0);
    std::cout << "Order 3 (MARKET BUY): " << o3 << "\n";
    
    engine.printStats();
    
    return 0;
}
