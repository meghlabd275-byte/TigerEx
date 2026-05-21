/**
 * TigerEx C++ Ultra-Low-Latency Matching Engine
 * 
 * THE HEART OF THE EXCHANGE - nanosecond execution
 * 
 * This is where elite exchanges compete:
 * - Every microsecond is hundreds of thousands of dollars
 * - Cache locality, SIMD, lock-free queues
 * - Deterministic latency (no GC pauses allowed)
 */

#pragma once

#include <cstdint>
#include <array>
#include <atomic>
#include <vector>
#include <algorithm>
#include <numeric>

namespace tigerex {
namespace matching {

// ========================================================================
// LOCK-FREE RING BUFFER - Sub-microsecond messaging
// ========================================================================

constexpr size_t CACHE_LINE_SIZE = 64;
constexpr size_t DEFAULT_RING_CAPACITY = 1048576;  // 1M entries

template<typename T>
requires std::is_trivially_destructible_v<T>
struct alignas(CACHE_LINE_SIZE) LockFreeRingBuffer {
private:
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> write_pos_{0};
    alignas(CACHE_LINE_SIZE) std::atomic<size_t> read_pos_{0};
    std::vector<T> buffer_;
    const size_t capacity_;
    
public:
    explicit LockFreeRingBuffer(size_t cap = DEFAULT_RING_CAPACITY)
        : buffer_(cap), capacity_(cap) {}
    
    // Single-producer-single-consumer lock-free write
    bool write(const T& item) noexcept {
        size_t write_pos = write_pos_.load(std::memory_order_relaxed);
        size_t next_pos = (write_pos + 1) % capacity_;
        
        if (next_pos == read_pos_.load(std::memory_order_acquire)) {
            return false;  // Full
        }
        
        buffer_[write_pos] = item;
        write_pos_.store(next_pos, std::memory_order_release);
        return true;
    }
    
    // Single-producer-single-consumer lock-free read
    bool read(T& item) noexcept {
        size_t read_pos = read_pos_.load(std::memory_order_relaxed);
        
        if (read_pos == write_pos_.load(std::memory_order_acquire)) {
            return false;  // Empty
        }
        
        item = buffer_[read_pos];
        read_pos_.store((read_pos + 1) % capacity_, std::memory_order_release);
        return true;
    }
    
    size_t available() const noexcept {
        size_t wp = write_pos_.load(std::memory_order_relaxed);
        size_t rp = read_pos_.load(std::memory_order_relaxed);
        return (wp >= rp) ? (wp - rp) : (capacity_ - rp + wp);
    }
};

// ========================================================================
// PRICE-PRIORITY ORDER BOOK
// ========================================================================

struct alignas(32) PriceLevel {
    uint64_t price;           // Scaled integer price
    uint64_t quantity;      // Total quantity at this price
    uint32_t order_count;   // Number of orders
    
    bool operator<(const PriceLevel& other) const { return price < other.price; }
};

// Order with microsecond timestamps for FIFO
struct Order {
    uint64_t order_id;
    uint64_t user_id;
    uint64_t price;          // Scaled: price * 10^8
    uint64_t remaining;      // Remaining quantity
    uint64_t filled;        // Filled quantity
    uint64_t timestamp_ns;  // Nanosecond timestamp for price-time priority
    bool is_buy;
    char padding[7];
};

class OrderBook {
    // Red-black tree would be used in production
    std::vector<Order> bids_;   // Sorted descending
    std::vector<Order> asks_;   // Sorted ascending
    
    std::atomic<uint64_t> last_price_{0};
    std::atomic<uint64_t> volume_24h_{0};
    
    // Statistics
    std::atomic<uint64_t> trades_today_{0};
    std::atomic<uint64_t> volume_today_{0};
    
public:
    // Main matching function - returns number of trades
    int match(Order order) noexcept {
        if (order.is_buy) {
            return match_against_asks(order);
        } else {
            return match_against_bids(order);
        }
    }
    
private:
    int match_against_asks(Order& order) noexcept {
        int trade_count = 0;
        auto& book = asks_;
        uint64_t fill_price = 0;
        
        for (size_t i = 0; i < book.size() && order.remaining > 0; ++i) {
            Order& ask = book[i];
            
            if (ask.price > order.price) break;  // No more crosses
            if (ask.remaining == 0) continue;
            
            // Calculate fill
            uint64_t match_qty = std::min(order.remaining, ask.remaining);
            
            order.remaining -= match_qty;
            order.filled += match_qty;
            ask.remaining -= match_qty;
            ask.filled += match_qty;
            
            fill_price = ask.price;
            trade_count++;
            
            // Update atomic stats (batch for perf)
            volume_today_.fetch_add(match_qty, std::memory_order_relaxed);
        }
        
        if (fill_price > 0) {
            last_price_.store(fill_price, std::memory_order_release);
        }
        
        return trade_count;
    }
    
    int match_against_bids(Order& order) noexcept {
        int trade_count = 0;
        auto& book = bids_;
        uint64_t fill_price = 0;
        
        for (size_t i = 0; i < book.size() && order.remaining > 0; ++i) {
            Order& bid = book[i];
            
            if (bid.price < order.price) break;
            if (bid.remaining == 0) continue;
            
            uint64_t match_qty = std::min(order.remaining, bid.remaining);
            
            order.remaining -= match_qty;
            order.filled += match_qty;
            bid.remaining -= match_qty;
            bid.filled += match_qty;
            
            fill_price = bid.price;
            trade_count++;
            
            volume_today_.fetch_add(match_qty, std::memory_order_relaxed);
        }
        
        if (fill_price > 0) {
            last_price_.store(fill_price, std::memory_order_release);
        }
        
        return trade_count;
    }
};

// ========================================================================
// SIMD VOLUME-WEIGHTED AVERAGE PRICE
// ========================================================================

#ifdef __AVX2__
#include <immintrin.h>

inline void simd_vwap(
    const double* prices,
    const double* quantities,
    size_t count,
    double& out_vwap,
    double& out_volume
) {
    __m256d sum_weighted = _mm256_setzero_pd();
    __m256d sum_qty = _mm256_setzero_pd();
    
    for (size_t i = 0; i < count; i += 4) {
        __m256d price_vec = _mm256_loadu_pd(&prices[i]);
        __m256d qty_vec = _mm256_loadu_pd(&quantities[i]);
        
        sum_weighted = _mm256_fmadd_pd(price_vec, qty_vec, sum_weighted);
        sum_qty = _mm256_add_pd(sum_qty, qty_vec);
    }
    
    double weighted[4], qty[4];
    _mm256_storeu_pd(weighted, sum_weighted);
    _mm256_storeu_pd(qty, sum_qty);
    
    double total_weighted = weighted[0] + weighted[1] + weighted[2] + weighted[3];
    double total_qty = qty[0] + qty[1] + qty[2] + qty[3];
    
    out_vwap = total_qty > 0 ? (total_weighted / total_qty) : 0;
    out_volume = total_qty;
}
#else
// Fallback for non-SIMD
inline void simd_vwap(
    const double* prices,
    const double* quantities,
    size_t count,
    double& out_vwap,
    double& out_volume
) {
    double weighted_sum = 0;
    double total_qty = 0;
    
    for (size_t i = 0; i < count; ++i) {
        weighted_sum += prices[i] * quantities[i];
        total_qty += quantities[i];
    }
    
    out_vwap = total_qty > 0 ? weighted_sum / total_qty : 0;
    out_volume = total_qty;
}
#endif

// ========================================================================
// DETERMINISTIC TIMESTAMPING
// ========================================================================

inline uint64_t get_timestamp_ns() {
#if defined(__linux__) && defined(CLOCK_MONOTONIC)
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ULL + ts.tv_nsec;
#else
    return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
#endif
}

// ========================================================================
// MEMORY POOL FOR LOW-LATENCY ALLOCATION
// ========================================================================

template<typename T, size_t PoolSize = 16384>
class MemoryPool {
    alignas(64) std::atomic<size_t> next_free_{0};
    std::array<T, PoolSize> pool_;
    std::vector<T*> free_list_;
    
public:
    MemoryPool() {
        for (size_t i = 0; i < PoolSize - 1; ++i) {
            free_list_.push_back(&pool_[i]);
        }
        next_free_.store(PoolSize - 1, std::memory_order_relaxed);
    }
    
    T* allocate() {
        size_t idx = next_free_.fetch_sub(1, std::memory_order_acq_rel);
        if (idx >= PoolSize) return nullptr;
        return &pool_[idx];
    }
    
    void deallocate(T* ptr) {
        size_t idx = next_free_.fetch_add(1, std::memory_order_acq_rel);
        if (idx < PoolSize) {
            // Return to free list - simplified
        }
    }
};

} // namespace matching
} // namespace tigerex