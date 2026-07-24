/**
 * TigerEx Market Data Feed Handler
 * Built with C++ for ultra-low latency
 */

#include <iostream>
#include <atomic>
#include <thread>
#include <chrono>
#include <vector>
#include <map>
#include <string>
#include <functional>

constexpr int MAX_MARKETS = 1000;
constexpr int MAX_SUBSCRIPTIONS = 10000;

struct MarketTick {
    uint32_t market_id;
    uint64_t price;
    uint64_t volume;
    uint64_t timestamp;
};

struct TradeUpdate {
    uint64_t trade_id;
    uint32_t market_id;
    uint64_t price;
    uint64_t quantity;
    uint64_t timestamp;
};

class MarketDataFeed {
private:
    std::atomic<bool> running_;
    std::thread worker_thread_;
    std::atomic<uint64_t> messages_received_{0};
    std::atomic<uint64_t> bytes_received_{0};
    std::vector<std::function<void(const MarketTick&)>> tick_callbacks_;
    std::vector<std::function<void(const TradeUpdate&)>> trade_callbacks_;
    
public:
    MarketDataFeed() : running_(false) {}
    
    void onTick(std::function<void(const MarketTick&)> callback) {
        tick_callbacks_.push_back(callback);
    }
    
    void onTrade(std::function<void(const TradeUpdate&)> callback) {
        trade_callbacks_.push_back(callback);
    }
    
    void start() {
        running_ = true;
        worker_thread_ = std::thread([this]() { processFeed(); });
    }
    
    void stop() {
        running_ = false;
        if (worker_thread_.joinable()) worker_thread_.join();
    }
    
    void processFeed() {
        while (running_) {
            messages_received_.fetch_add(1);
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    }
    
    void subscribe(uint32_t market_id) {
        std::cout << "Subscribed to market: " << market_id << "\n";
    }
    
    void printStats() {
        std::cout << "Messages: " << messages_received_.load() << "\n";
    }
};

int main() {
    std::cout << "TigerEx Market Data Feed Handler\n";
    
    MarketDataFeed feed;
    feed.onTick([](const MarketTick& t) { });
    feed.onTrade([](const TradeUpdate& t) { });
    
    feed.subscribe(1);
    feed.start();
    std::this_thread::sleep_for(std::chrono::seconds(1));
    feed.stop();
    feed.printStats();
    
    return 0;
}
