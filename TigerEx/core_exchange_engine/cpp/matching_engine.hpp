/**
 * TigerEx C++ Ultra-Low-Latency Components
 * 
 * C++ is used for latency-critical systems where nanoseconds matter.
 * At 5M+ orders/second, every cycle counts.
 * 
 * LANGUAGE: C++17/20
 * 
 * Why C++ for Matching Engine:
 * - Zero-cost abstractions
 * - Manual memory control
 * - SIMD optimization 
 * - Lock-free concurrency
 * - Cache-aware data structures
 * - Kernel-level tuning capability
 * 
 * COMPONENTS:
 * 
 * 1. Matching Engine (core)
 *    - Order matching at microsecond latency
 *    - Order book maintenance  
 *    - Price-time priority execution
 *    - Partial fills handling
 * 
 * 2. Lock-Free Ring Buffers
 *    - Event queues between components
 *    - Market data propagation
 *    - Inter-thread messaging
 * 
 * 3. Market Data Feed Handlers
 *    - High-frequency tick processing
 *    - Zero-allocation parsing
 *    - Orderbook depth updates
 * 
 * 4. Network Stack (DPDK integration)
 *    - Kernel bypass networking
 *    - RDMA support
 *    - Packet processing optimization
 * 
 * COMPILATION:
 * clang++ -O3 -march=native -flto -std=c++20 *.cpp -o matching_engine
 * 
 * PERFORMANCE TARGETS:
 * - < 1 microsecond order matching
 * - < 100 nanosecond network round-trip
 * - > 10 million orders/second throughput
 */

#ifndef TIGEREX_MATCHING_ENGINE_H
#define TIGEREX_MATCHING_ENGINE_H

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <map>
#include <vector>

namespace tigerex {

// Lock-free ring buffer for order/event processing
// Single-producer/single-consumer ring buffer. This is deliberately SPSC;
// sharing it between multiple producers or consumers requires external serialization.
template<typename T, size_t Capacity>
class RingBuffer {
    static_assert(Capacity >= 2, "RingBuffer capacity must be at least two");
    static constexpr size_t CACHE_LINE = 64;
    
    alignas(CACHE_LINE) std::atomic<size_t> write_idx_{0};
    alignas(CACHE_LINE) std::atomic<size_t> read_idx_{0};
    std::array<T, Capacity> buffer_;
    
public:
    bool write(const T& item) {
        size_t write_pos = write_idx_.load(std::memory_order_relaxed);
        size_t next = (write_pos + 1) % Capacity;
        if (next == read_idx_.load(std::memory_order_acquire)) return false;
        buffer_[write_pos] = item;
        write_idx_.store(next, std::memory_order_release);
        return true;
    }
    
    bool read(T& item) {
        size_t read_pos = read_idx_.load(std::memory_order_relaxed);
        if (read_pos == write_idx_.load(std::memory_order_acquire)) return false;
        item = buffer_[read_pos];
        read_idx_.store((read_pos + 1) % Capacity, std::memory_order_release);
        return true;
    }
};

// Price-Time Priority Order Book
// Uses red-black tree for O(log n) matching
struct Order {
    uint64_t order_id;
    uint64_t user_id;
    uint64_t price;        // Scaled integer price
    uint64_t quantity;   // Scaled integer quantity
    uint64_t timestamp;   // Nanosecond timestamp for tie-breaking
    bool is_buy_side;
};

class MatchingEngine {
    // Lock-free ring buffers for order flow
    RingBuffer<Order, 1048576> order_pipe_;
    RingBuffer<Order, 1048576> trade_pipe_;
    
    // std::map provides deterministic price ordering. Orders within each price
    // level are kept in insertion order to preserve FIFO time priority.
    std::map<uint64_t, std::vector<Order>> bid_orders_;
    std::map<uint64_t, std::vector<Order>> ask_orders_;
    
    std::atomic<uint64_t> last_trade_price_{0};
    std::atomic<uint64_t> volume_24h_{0};
    
public:
    // Process one order on a single-thread-owned book. Prices and quantities
    // must use validated integer ticks/lots; zero values are rejected.
    // Returns the number of fills. Production settlement must consume an
    // authoritative fill stream before balances or external side effects change.
    int process_order(Order&& order) {
        if (order.price == 0 || order.quantity == 0) return 0;

        int trade_count = 0;
        if (order.is_buy_side) {
            // Buy orders consume the cheapest asks first and never pay above
            // their limit price.
            for (auto it = ask_orders_.begin();
                 it != ask_orders_.end() && it->first <= order.price && order.quantity > 0;
                 ++it) {
                for (auto& ask : it->second) {
                    if (ask.quantity == 0) continue;
                    const uint64_t match_qty = std::min(order.quantity, ask.quantity);
                    order.quantity -= match_qty;
                    ask.quantity -= match_qty;
                    ++trade_count;
                    if (order.quantity == 0) break;
                }
            }

            for (auto it = ask_orders_.begin(); it != ask_orders_.end();) {
                auto& level = it->second;
                level.erase(std::remove_if(level.begin(), level.end(),
                    [](const Order& resting) { return resting.quantity == 0; }), level.end());
                if (level.empty()) it = ask_orders_.erase(it);
                else ++it;
            }

            if (order.quantity > 0) bid_orders_[order.price].push_back(order);
        } else {
            // Sell orders consume the highest bids first and never sell below
            // their limit price.
            for (auto it = bid_orders_.rbegin();
                 it != bid_orders_.rend() && it->first >= order.price && order.quantity > 0;
                 ++it) {
                for (auto& bid : it->second) {
                    if (bid.quantity == 0) continue;
                    const uint64_t match_qty = std::min(order.quantity, bid.quantity);
                    order.quantity -= match_qty;
                    bid.quantity -= match_qty;
                    ++trade_count;
                    if (order.quantity == 0) break;
                }
            }

            for (auto it = bid_orders_.begin(); it != bid_orders_.end();) {
                auto& level = it->second;
                level.erase(std::remove_if(level.begin(), level.end(),
                    [](const Order& resting) { return resting.quantity == 0; }), level.end());
                if (level.empty()) it = bid_orders_.erase(it);
                else ++it;
            }

            if (order.quantity > 0) ask_orders_[order.price].push_back(order);
        }
        return trade_count;
    }

    uint64_t get_best_bid() const {
        if (bid_orders_.empty()) return 0;
        return bid_orders_.rbegin()->first;
    }
    
    uint64_t get_best_ask() const {
        if (ask_orders_.empty()) return 0;
        return ask_orders_.begin()->first;
    }
};

// SIMD-optimized price calculation
inline void compute_vwap(
    const uint64_t* prices, 
    const uint64_t* quantities, 
    size_t count,
    uint64_t& out_vwap
) {
    __uint128_t weighted_sum = 0;
    __uint128_t total_qty = 0;
    
    for (size_t i = 0; i < count; i++) {
        weighted_sum += (__uint128_t)prices[i] * quantities[i];
        total_qty += quantities[i];
    }
    
    out_vwap = (total_qty > 0) ? (uint64_t)(weighted_sum / total_qty) : 0;
}

} // namespace tigerex

#endif // TIGEREX_MATCHING_ENGINE_H