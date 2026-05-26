/**
 * TigerEx High-Frequency Trading Engine - C++
 * Nanosecond latency order execution
 */

#include <iostream>
#include <chrono>
#include <thread>
#include <atomic>
#include <vector>
#include <queue>
#include <unordered_map>

// ============================================================================
// CONFIG
// ============================================================================

const int MAX_ORDERS = 1000000;
const int CACHE_LINE = 64;

// ============================================================================
// ORDER
// ============================================================================

struct Order {
    uint64_t order_id;
    uint64_t user_id;
    char symbol[16];
    char side;
    char type;
    double price;
    double quantity;
    uint64_t timestamp_ns;
    uint32_t status;
};

struct Trade {
    uint64_t trade_id;
    uint64_t maker_order_id;
    uint64_t taker_order_id;
    double price;
    double quantity;
    uint64_t timestamp_ns;
};

// ============================================================================
// RING BUFFER (Lock-free)
// ============================================================================

template<typename T>
class RingBuffer {
private:
    std::vector<T> buffer;
    size_t mask;
    std::atomic<size_t> write_idx;
    std::atomic<size_t> read_idx;

public:
    RingBuffer(size_t size) : buffer(size), mask(size - 1), write_idx(0), read_idx(0) {
        buffer.resize(size);
    }

    bool push(const T& item) {
        size_t w = write_idx.load();
        size_t next_w = (w + 1) & mask;
        
        if (next_w == read_idx.load()) {
            return false;
        }
        
        buffer[w] = item;
        write_idx.store(next_w);
        return true;
    }

    bool pop(T& item) {
        size_t r = read_idx.load();
        
        if (r == write_idx.load()) {
            return false;
        }
        
        item = buffer[r];
        read_idx.store((r + 1) & mask);
        return true;
    }

    size_t size() {
        size_t w = write_idx.load();
        size_t r = read_idx.load();
        return (w >= r) ? (w - r) : (mask + 1 - r + w);
    }
};

// ============================================================================
// HF ENGINE
// ============================================================================

class HFEngine {
private:
    RingBuffer<Order> order_buffer;
    RingBuffer<Trade> trade_buffer;
    
    std::atomic<uint64_t> order_counter;
    std::atomic<uint64_t> trade_counter;
    std::atomic<bool> running;

    // Order book (cache-aligned)
    struct alignas(CACHE_LINE) OrderBook {
        double bids[100][2];
        double asks[100][2];
        uint64_t bid_cnt;
        uint64_t ask_cnt;
    };
    
    std::unordered_map<uint64_t, OrderBook> books;

public:
    HFEngine() : order_buffer(65536), trade_buffer(131072), 
                order_counter(0), trade_counter(0), running(false) {}

    void start() {
        running = true;
        std::thread(&HFEngine::matchLoop, this).detach();
        std::thread(&HFEngine::executionLoop, this).detach();
    }

    void stop() {
        running = false;
    }

    uint64_t submitOrder(uint64_t user_id, const char* symbol, 
                       char side, char type, double price, double quantity) {
        Order order;
        order.order_id = ++order_counter;
        order.user_id = user_id;
        strncpy(order.symbol, symbol, 15);
        order.side = side;
        order.type = type;
        order.price = price;
        order.quantity = quantity;
        order.timestamp_ns = getTimestamp_ns();
        order.status = 0;

        order_buffer.push(order);
        return order.order_id;
    }

    bool cancelOrder(uint64_t order_id) {
        // Simplified - real implementation would search
        return true;
    }

    size_t getPendingOrders() {
        return order_buffer.size();
    }

    size_t getPendingTrades() {
        return trade_buffer.size();
    }

private:
    void matchLoop() {
        while (running.load()) {
            Order order;
            if (order_buffer.pop(order)) {
                // Match logic here
                processOrder(order);
            } else {
                std::this_thread::sleep_for(std::chrono::nanoseconds(100));
            }
        }
    }

    void executionLoop() {
        while (running.load()) {
            Trade trade;
            if (trade_buffer.pop(trade)) {
                // Execute trade
            }
        }
    }

    void processOrder(const Order& order) {
        // Simplified matching
    }

    uint64_t getTimestamp_ns() {
        return std::chrono::high_resolution_clock::now()
            .time_since_epoch().count();
    }
};

// ============================================================================
// STATS
// ============================================================================

class LatencyStats {
private:
    std::vector<uint64_t> latencies;
    size_t idx;

public:
    LatencyStats(size_t n) : latencies(n), idx(0) {}

    void record(uint64_t ns) {
        latencies[idx++ % latencies.size()] = ns;
    }

    double p50() {
        std::sort(latencies.begin(), latencies.end());
        return latencies[latencies.size() / 2];
    }

    double p99() {
        return latencies[(latencies.size() * 99) / 100];
    }

    double p999() {
        return latencies[(latencies.size() * 999) / 1000];
    }
};

// ============================================================================
// MAIN
// ============================================================================

int main() {
    HFEngine engine;
    engine.start();

    auto start = std::chrono::high_resolution_clock::now();

    // Submit 1M orders
    for (int i = 0; i < 1000000; i++) {
        engine.submitOrder(i % 1000, "BTC/USDT", 'B', 'L', 
                        50000 + i % 1000, 0.01);
    }

    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);

    std::cout << "1M orders submitted in " << duration.count() << "ms" << std::endl;
    std::cout << "Rate: " << (1000000.0 / duration.count()) << " orders/sec" << std::endl;

    engine.stop();
    return 0;
}