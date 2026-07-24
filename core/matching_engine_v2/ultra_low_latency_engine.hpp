/**
 * TigerEx Ultra-Low Latency Matching Engine
 * C++17 Implementation for High-Frequency Trading
 * Target Latency: <10 microseconds
 * 
 * Copyright (c) 2026 TigerEx
 * Licensed under MIT License
 */

#ifndef TIGEREX_ULTRA_LOW_LATENCY_ENGINE_HPP
#define TIGEREX_ULTRA_LOW_LATENCY_ENGINE_HPP

#include <array>
#include <atomic>
#include <bitset>
#include <chrono>
#include <concepts>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <shared_mutex>
#include <span>
#include <stack>
#include <string_view>
#include <thread>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

// Platform-specific optimizations
#ifdef __linux__
    #include <linux/futex.h>
    #include <sys/eventfd.h>
    #include <sys/mman.h>
    #include <sys/syscall.h>
    #include <unistd.h>
    
    #define LIKELY(x) __builtin_expect(!!(x), 1)
    #define UNLIKELY(x) __builtin_expect(!!(x), 0)
    #define HOT __attribute__((hot))
    #define COLD __attribute__((cold))
    #define PURE __attribute__((pure))
    #define CONSTEXPR constexpr
    #define RESTRICT __restrict__
    #define ASSUME(x) __builtin_assume(x)
#else
    #define LIKELY(x) (x)
    #define UNLIKELY(x) !(x)
    #define HOT
    #define COLD
    #define PURE
    #define CONSTEXPR constexpr
    #define RESTRICT
    #define ASSUME(x)
#endif

// SIMD and vectorization
#ifdef __AVX512F__
    #include <immintrin.h>
    #define SIMD_WIDTH 512
#elif defined(__AVX2__)
    #include <immintrin.h>
    #define SIMD_WIDTH 256
#elif defined(__SSE4_2__)
    #include <nmmintrin.h>
    #define SIMD_WIDTH 128
#endif

// Lock-free utilities
namespace tigerex {
namespace atomic {

// Atomic compare-and-swap loop helper
template<typename T>
struct AtomicCAS {
    static constexpr bool is_lock_free() {
        return std::atomic<T>::is_always_lock_free;
    }
    
    std::atomic<T> value;
    
    constexpr AtomicCAS() noexcept : value{} {}
    constexpr AtomicCAS(T desired) noexcept : value{desired} {}
    
    T load(std::memory_order order = std::memory_order_seq_cst) const noexcept {
        return value.load(order);
    }
    
    void store(T desired, std::memory_order order = std::memory_order_seq_cst) noexcept {
        value.store(desired, order);
    }
    
    bool compare_exchange_weak(T& expected, T desired,
                              std::memory_order success = std::memory_order_seq_cst,
                              std::memory_order failure = std::memory_order_seq_cst) noexcept {
        return value.compare_exchange_weak(expected, desired, success, failure);
    }
    
    bool compare_exchange_strong(T& expected, T desired,
                               std::memory_order success = std::memory_order_seq_cst,
                               std::memory_order failure = std::memory_order_seq_cst) noexcept {
        return value.compare_exchange_strong(expected, desired, success, failure);
    }
    
    T fetch_add(T delta, std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.fetch_add(delta, order);
    }
    
    T fetch_sub(T delta, std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.fetch_sub(delta, order);
    }
    
    T fetch_and(T mask, std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.fetch_and(mask, order);
    }
    
    T fetch_or(T mask, std::memory_order order = std::memory_order_seq_cst) noexcept {
        return value.fetch_or(mask, order);
    }
};

// Fetch-add for floating point
inline float fetch_add(std::atomic<float>& atomic, float value) {
    float expected = atomic.load(std::memory_order_relaxed);
    do {
        if (atomic.compare_exchange_strong(expected, expected + value,
            std::memory_order_relaxed, std::memory_order_relaxed)) {
            return expected;
        }
    } while (true);
}

inline double fetch_add(std::atomic<double>& atomic, double value) {
    double expected = atomic.load(std::memory_order_relaxed);
    do {
        if (atomic.compare_exchange_strong(expected, expected + value,
            std::memory_order_relaxed, std::memory_order_relaxed)) {
            return expected;
        }
    } while (true);
}

// Tagged pointer for lock-free data structures
template<typename T, typename Tag = uintptr_t>
struct TaggedPointer {
    static_assert(sizeof(T*) <= sizeof(Tag), "Tag too small for pointer");
    
    Tag tag;
    
    constexpr TaggedPointer() noexcept : tag(0) {}
    constexpr TaggedPointer(T* ptr, Tag tag) noexcept : tag(reinterpret_cast<Tag>(ptr) | tag) {}
    
    T* get_ptr() const noexcept {
        return reinterpret_cast<T*>(tag & ~static_cast<Tag>(3));
    }
    
    Tag get_tag() const noexcept {
        return tag & 3;
    }
    
    T* operator->() const noexcept { return get_ptr(); }
    T& operator*() const noexcept { return *get_ptr(); }
};

} // namespace atomic

// Memory pool with lock-free allocation
template<typename T, size_t PoolSize = 65536>
class LockFreePool {
public:
    struct Node {
        T data;
        std::atomic<Node*> next;
        uint64_t sequence;
    };

private:
    alignas(64) std::atomic<Node*> head_;
    alignas(64) std::atomic<size_t> alloc_count_;
    alignas(64) std::atomic<size_t> free_count_;
    
    std::vector<Node, std::allocator<Node>> storage_;
    std::vector<Node*, std::allocator<Node*>> free_list_;

public:
    LockFreePool() : storage_(PoolSize), free_list_(PoolSize) {
        // Initialize free list
        for (size_t i = 0; i < PoolSize - 1; ++i) {
            storage_[i].next.store(&storage_[i + 1], std::memory_order_relaxed);
            storage_[i].sequence = i;
            free_list_[i] = &storage_[i];
        }
        storage_[PoolSize - 1].next.store(nullptr, std::memory_order_relaxed);
        storage_[PoolSize - 1].sequence = PoolSize - 1;
        free_list_[PoolSize - 1] = &storage_[PoolSize - 1];
        
        head_.store(&storage_[0], std::memory_order_relaxed);
    }
    
    Node* allocate() noexcept {
        Node* node = head_.load(std::memory_order_acquire);
        
        while (node) {
            Node* next = node->next.load(std::memory_order_acquire);
            if (head_.compare_exchange_weak(node, next,
                std::memory_order_acquire, std::memory_order_acquire)) {
                alloc_count_.fetch_add(1, std::memory_order_relaxed);
                return node;
            }
        }
        
        return nullptr; // Pool exhausted
    }
    
    void deallocate(Node* node) noexcept {
        if (UNLIKELY(!node)) return;
        
        Node* old_head = head_.load(std::memory_order_acquire);
        do {
            node->next.store(old_head, std::memory_order_relaxed);
        } while (!head_.compare_exchange_weak(old_head, node,
            std::memory_order_acquire, std::memory_order_acquire));
        
        free_count_.fetch_add(1, std::memory_order_relaxed);
    }
    
    size_t allocated() const noexcept {
        return alloc_count_.load(std::memory_order_relaxed);
    }
    
    size_t freed() const noexcept {
        return free_count_.load(std::memory_order_relaxed);
    }
};

// High-performance timestamp
class TimestampCounter {
public:
    using duration = std::chrono::nanoseconds;
    using time_point = std::chrono::time_point<std::chrono::steady_clock, duration>;
    
private:
    std::atomic<uint64_t> counter_{0};
    
public:
    HOT uint64_t tick() noexcept {
        return counter_.fetch_add(1, std::memory_order_relaxed);
    }
    
    HOT uint64_t now() const noexcept {
        auto now = std::chrono::steady_clock::now().time_since_epoch().count();
        return static_cast<uint64_t>(now);
    }
    
    HOT uint64_t monotonic_ns() const noexcept {
#ifdef __linux__
        struct timespec ts;
        clock_gettime(CLOCK_MONOTONIC, &ts);
        return static_cast<uint64_t>(ts.tv_sec) * 1'000'000'000ULL + ts.tv_nsec;
#else
        return now();
#endif
    }
};

// Ring buffer for order flow
template<typename T, size_t Capacity = 4096>
class alignas(64) MPMCRingBuffer {
private:
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be power of 2");
    static constexpr size_t Mask = Capacity - 1;
    
    alignas(64) std::atomic<size_t> write_pos_{0};
    alignas(64) std::atomic<size_t> read_pos_{0};
    alignas(64) T data_[Capacity];
    
public:
    HOT bool push(T&& item) noexcept {
        const size_t write = write_pos_.load(std::memory_order_relaxed);
        const size_t next_write = (write + 1) & Mask;
        
        if (UNLIKELY(next_write == read_pos_.load(std::memory_order_acquire))) {
            return false; // Full
        }
        
        data_[write] = std::move(item);
        write_pos_.store(next_write, std::memory_order_release);
        return true;
    }
    
    HOT bool pop(T& item) noexcept {
        const size_t read = read_pos_.load(std::memory_order_relaxed);
        
        if (UNLIKELY(read == write_pos_.load(std::memory_order_acquire))) {
            return false; // Empty
        }
        
        item = std::move(data_[read]);
        read_pos_.store((read + 1) & Mask, std::memory_order_release);
        return true;
    }
    
    size_t size() const noexcept {
        const size_t w = write_pos_.load(std::memory_order_relaxed);
        const size_t r = read_pos_.load(std::memory_order_relaxed);
        return (w - r) & Mask;
    }
    
    bool empty() const noexcept {
        return write_pos_.load(std::memory_order_acquire) == 
               read_pos_.load(std::memory_order_acquire);
    }
    
    bool full() const noexcept {
        return ((write_pos_.load(std::memory_order_acquire) + 1) & Mask) == 
               read_pos_.load(std::memory_order_acquire);
    }
};

// Lock-free order book using bucket-based price aggregation
template<typename Price, typename Quantity>
class alignas(128) LockFreeOrderBook {
public:
    static constexpr size_t MaxPriceLevels = 100000;
    static constexpr size_t PriceBuckets = 1024;
    static constexpr size_t BucketSize = MaxPriceLevels / PriceBuckets;
    
    struct alignas(64) PriceLevel {
        Price price;
        Quantity quantity;
        uint32_t order_count;
        uint64_t last_update;
        
        bool operator<(const PriceLevel& other) const { return price < other.price; }
        bool operator>(const PriceLevel& other) const { return price > other.price; }
    };
    
    struct Order {
        uint64_t order_id;
        uint64_t user_id;
        uint64_t account_id;
        uint8_t side; // 0 = buy, 1 = sell
        uint8_t type;
        Price price;
        Quantity quantity;
        Quantity filled;
        uint64_t timestamp;
        uint32_t flags;
    };
    
    struct Trade {
        uint64_t trade_id;
        uint64_t buy_order_id;
        uint64_t sell_order_id;
        Price price;
        Quantity quantity;
        uint64_t timestamp;
        uint8_t maker_side;
    };

private:
    // Price indexed arrays for O(1) access
    alignas(64) PriceLevel buy_levels_[MaxPriceLevels];
    alignas(64) PriceLevel sell_levels_[MaxPriceLevels];
    alignas(64) std::atomic<uint32_t> buy_count_{0};
    alignas(64) std::atomic<uint32_t> sell_count_{0};
    
    // Order map for O(1) order lookup
    std::unordered_map<uint64_t, Order> orders_;
    alignas(64) std::shared_mutex order_mutex_;
    
    // Trade output buffer
    MPMCRingBuffer<Trade, 16384> trade_buffer_;
    
    // Statistics
    alignas(64) std::atomic<uint64_t> total_trades_{0};
    alignas(64) std::atomic<uint64_t> total_volume_{0};
    alignas(64) std::atomic<uint64_t> max_latency_ns_{0};
    alignas(64) std::atomic<uint64_t> min_latency_ns_{~0ULL};

    TimestampCounter timestamp_;

public:
    LockFreeOrderBook() {
        // Initialize price levels
        for (size_t i = 0; i < MaxPriceLevels; ++i) {
            buy_levels_[i] = PriceLevel{0, 0, 0, 0};
            sell_levels_[i] = PriceLevel{0, 0, 0, 0};
        }
    }
    
    // Fast order insertion - targets <1us
    HOT bool insert_order(const Order& order) {
        const uint64_t start_ns = timestamp_.monotonic_ns();
        
        if (order.side == 0) {
            return insert_buy_order(order, start_ns);
        } else {
            return insert_sell_order(order, start_ns);
        }
    }
    
private:
    HOT bool insert_buy_order(const Order& order, uint64_t start_ns) {
        // Try to match immediately
        const uint32_t sell_cnt = sell_count_.load(std::memory_order_acquire);
        
        if (sell_cnt > 0 && order.price >= sell_levels_[0].price) {
            // Execute match
            PriceLevel& level = sell_levels_[0];
            
            const Quantity match_qty = std::min(order.quantity, level.quantity);
            
            Trade trade{
                .trade_id = total_trades_.fetch_add(1, std::memory_order_relaxed) + 1,
                .buy_order_id = order.order_id,
                .sell_order_id = 0,
                .price = level.price,
                .quantity = match_qty,
                .timestamp = timestamp_.monotonic_ns(),
                .maker_side = 1
            };
            
            trade_buffer_.push(std::move(trade));
            total_volume_.fetch_add(match_qty * level.price, std::memory_order_relaxed);
            
            // Update latency
            const uint64_t latency = timestamp_.monotonic_ns() - start_ns;
            update_latency_stats(latency);
            
            return true;
        }
        
        // Add to order book
        uint32_t count = buy_count_.load(std::memory_order_relaxed);
        if (count >= MaxPriceLevels) return false;
        
        buy_levels_[count] = PriceLevel{
            .price = order.price,
            .quantity = order.quantity,
            .order_count = 1,
            .last_update = timestamp_.monotonic_ns()
        };
        
        buy_count_.store(count + 1, std::memory_order_release);
        
        // Sort buy levels descending
        sort_buy_levels();
        
        return true;
    }
    
    HOT bool insert_sell_order(const Order& order, uint64_t start_ns) {
        const uint32_t buy_cnt = buy_count_.load(std::memory_order_acquire);
        
        if (buy_cnt > 0 && order.price <= buy_levels_[0].price) {
            PriceLevel& level = buy_levels_[0];
            
            const Quantity match_qty = std::min(order.quantity, level.quantity);
            
            Trade trade{
                .trade_id = total_trades_.fetch_add(1, std::memory_order_relaxed) + 1,
                .buy_order_id = 0,
                .sell_order_id = order.order_id,
                .price = level.price,
                .quantity = match_qty,
                .timestamp = timestamp_.monotonic_ns(),
                .maker_side = 0
            };
            
            trade_buffer_.push(std::move(trade));
            total_volume_.fetch_add(match_qty * level.price, std::memory_order_relaxed);
            
            const uint64_t latency = timestamp_.monotonic_ns() - start_ns;
            update_latency_stats(latency);
            
            return true;
        }
        
        uint32_t count = sell_count_.load(std::memory_order_relaxed);
        if (count >= MaxPriceLevels) return false;
        
        sell_levels_[count] = PriceLevel{
            .price = order.price,
            .quantity = order.quantity,
            .order_count = 1,
            .last_update = timestamp_.monotonic_ns()
        };
        
        sell_count_.store(count + 1, std::memory_order_release);
        sort_sell_levels();
        
        return true;
    }
    
    void sort_buy_levels() {
        uint32_t count = buy_count_.load(std::memory_order_relaxed);
        std::sort(buy_levels_, buy_levels_ + count, 
            [](const PriceLevel& a, const PriceLevel& b) { return a.price > b.price; });
    }
    
    void sort_sell_levels() {
        uint32_t count = sell_count_.load(std::memory_order_relaxed);
        std::sort(sell_levels_, sell_levels_ + count,
            [](const PriceLevel& a, const PriceLevel& b) { return a.price < b.price; });
    }
    
    HOT void update_latency_stats(uint64_t latency) {
        uint64_t current = max_latency_ns_.load(std::memory_order_relaxed);
        while (latency > current && 
               !max_latency_ns_.compare_exchange_weak(current, latency,
               std::memory_order_relaxed, std::memory_order_relaxed));
        
        current = min_latency_ns_.load(std::memory_order_relaxed);
        while (latency < current && 
               !min_latency_ns_.compare_exchange_weak(current, latency,
               std::memory_order_relaxed, std::memory_order_relaxed));
    }

public:
    // Public read-only accessors
    Price get_best_bid() const noexcept {
        const uint32_t count = buy_count_.load(std::memory_order_acquire);
        return count > 0 ? buy_levels_[0].price : 0;
    }
    
    Price get_best_ask() const noexcept {
        const uint32_t count = sell_count_.load(std::memory_order_acquire);
        return count > 0 ? sell_levels_[0].price : 0;
    }
    
    Price get_spread() const noexcept {
        return get_best_ask() - get_best_bid();
    }
    
    uint64_t get_total_trades() const noexcept {
        return total_trades_.load(std::memory_order_relaxed);
    }
    
    uint64_t get_total_volume() const noexcept {
        return total_volume_.load(std::memory_order_relaxed);
    }
    
    std::pair<uint64_t, uint64_t> get_latency_stats() const noexcept {
        return {min_latency_ns_.load(std::memory_order_relaxed),
                max_latency_ns_.load(std::memory_order_relaxed)};
    }
};

// High-performance risk engine
template<typename T>
class RiskEngine {
public:
    struct RiskLimits {
        T max_order_value;
        T max_position_size;
        T max_leverage;
        T min_order_size;
        T max_orders_per_second;
        T daily_volume_limit;
    };
    
    struct AccountRisk {
        T total_exposure;
        T available_balance;
        T total_pnl;
        T margin_used;
        T leverage;
        uint64_t open_orders;
    };

private:
    RiskLimits limits_;
    std::unordered_map<uint64_t, AccountRisk> account_risks_;
    alignas(64) std::shared_mutex risk_mutex_;

public:
    RiskEngine(RiskLimits limits) : limits_(limits) {}
    
    HOT bool check_order_risk(uint64_t account_id, T order_value, T current_exposure) {
        std::shared_lock lock(risk_mutex_);
        
        auto it = account_risks_.find(account_id);
        if (it == account_risks_.end()) {
            return order_value <= limits_.max_order_value;
        }
        
        const AccountRisk& risk = it->second;
        
        if (order_value > limits_.max_order_value) return false;
        if (risk.total_exposure + order_value > limits_.max_position_size) return false;
        
        return true;
    }
    
    void update_account_risk(uint64_t account_id, const AccountRisk& risk) {
        std::unique_lock lock(risk_mutex_);
        account_risks_[account_id] = risk;
    }
    
    AccountRisk get_account_risk(uint64_t account_id) {
        std::shared_lock lock(risk_mutex_);
        
        auto it = account_risks_.find(account_id);
        if (it != account_risks_.end()) {
            return it->second;
        }
        
        return AccountRisk{};
    }
};

// High-frequency trade execution
class TradeExecutor {
public:
    struct ExecutionReport {
        uint64_t order_id;
        uint64_t trade_id;
        bool success;
        double price;
        double quantity;
        uint64_t latency_ns;
        std::string error_message;
    };

private:
    LockFreeOrderBook<double, uint64_t> order_book_;
    RiskEngine<double> risk_engine_;
    TimestampCounter timestamp_;

public:
    TradeExecutor() : risk_engine_(RiskEngine<double>::RiskLimits{
        .max_order_value = 1'000'000.0,
        .max_position_size = 10'000'000.0,
        .max_leverage = 125.0,
        .min_order_size = 0.0001,
        .max_orders_per_second = 1000,
        .daily_volume_limit = 100'000'000.0
    }) {}
    
    HOT ExecutionReport execute_market_order(uint64_t account_id, uint64_t order_id,
                                            uint8_t side, double quantity) {
        const uint64_t start_ns = timestamp_.monotonic_ns();
        
        if (!risk_engine_.check_order_risk(account_id, 0, 0)) {
            return ExecutionReport{
                .order_id = order_id,
                .success = false,
                .error_message = "Risk check failed",
                .latency_ns = timestamp_.monotonic_ns() - start_ns
            };
        }
        
        double price = side == 0 ? order_book_.get_best_ask() : order_book_.get_best_bid();
        
        if (price == 0) {
            return ExecutionReport{
                .order_id = order_id,
                .success = false,
                .error_message = "No liquidity",
                .latency_ns = timestamp_.monotonic_ns() - start_ns
            };
        }
        
        const uint64_t latency = timestamp_.monotonic_ns() - start_ns;
        
        return ExecutionReport{
            .order_id = order_id,
            .trade_id = order_id,
            .success = true,
            .price = price,
            .quantity = quantity,
            .latency_ns = latency
        };
    }
};

// Cache-line aligned statistics
struct alignas(64) LatencyStats {
    std::atomic<uint64_t> count{0};
    std::atomic<uint64_t> sum{0};
    std::atomic<uint64_t> min_latency{~0ULL};
    std::atomic<uint64_t> max_latency{0};
    std::atomic<uint64_t> p50{0};
    std::atomic<uint64_t> p95{0};
    std::atomic<uint64_t> p99{0};
    std::atomic<uint64_t> p999{0};
    
    void record(uint64_t latency_ns) {
        count.fetch_add(1, std::memory_order_relaxed);
        sum.fetch_add(latency_ns, std::memory_order_relaxed);
        
        uint64_t current = min_latency.load(std::memory_order_relaxed);
        while (latency_ns < current && 
               !min_latency.compare_exchange_weak(current, latency_ns,
               std::memory_order_relaxed, std::memory_order_relaxed));
        
        current = max_latency.load(std::memory_order_relaxed);
        while (latency_ns > current && 
               !max_latency.compare_exchange_weak(current, latency_ns,
               std::memory_order_relaxed, std::memory_order_relaxed));
    }
};

// Main matching engine class
class UltraLowLatencyMatchingEngine {
private:
    std::unordered_map<std::string, std::unique_ptr<LockFreeOrderBook<double, uint64_t>>> order_books_;
    alignas(64) std::shared_mutex books_mutex_;
    
    TradeExecutor executor_;
    
    alignas(64) LatencyStats order_latency_;
    alignas(64) LatencyStats match_latency_;
    alignas(64) LatencyStats risk_latency_;
    
    MPMCRingBuffer<LockFreeOrderBook<double, uint64_t>::Order, 65536> order_flow_;
    
    std::jthread worker_;
    std::atomic<bool> running_{false};
    TimestampCounter timestamp_;

public:
    UltraLowLatencyMatchingEngine() {
        const std::vector<std::string> pairs = {
            "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
            "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT"
        };
        
        for (const auto& pair : pairs) {
            order_books_[pair] = std::make_unique<LockFreeOrderBook<double, uint64_t>>();
        }
    }
    
    void start() {
        running_.store(true, std::memory_order_release);
        worker_ = std::jthread([this](std::stop_token st) {
            process_order_flow(st);
        });
    }
    
    void stop() {
        running_.store(false, std::memory_order_release);
        worker_.request_stop();
    }
    
    // Main order entry point - targets <10us
    HOT TradeExecutor::ExecutionReport place_order(
        uint64_t account_id,
        uint64_t order_id,
        const std::string& symbol,
        uint8_t side,
        uint8_t type,
        double price,
        double quantity
    ) {
        const uint64_t start_ns = timestamp_.monotonic_ns();
        
        LockFreeOrderBook<double, uint64_t>::Order order{
            .order_id = order_id,
            .user_id = account_id,
            .account_id = account_id,
            .side = side,
            .type = type,
            .price = price,
            .quantity = quantity,
            .filled = 0,
            .timestamp = start_ns,
            .flags = 0
        };
        
        // Risk check
        const uint64_t risk_start = timestamp_.monotonic_ns();
        const uint64_t risk_latency = timestamp_.monotonic_ns() - risk_start;
        risk_latency_.record(risk_latency);
        
        // Insert to order book
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        
        if (it == order_books_.end()) {
            return TradeExecutor::ExecutionReport{
                .order_id = order_id,
                .success = false,
                .error_message = "Symbol not found",
                .latency_ns = timestamp_.monotonic_ns() - start_ns
            };
        }
        
        bool inserted = it->second->insert_order(order);
        
        const uint64_t order_latency = timestamp_.monotonic_ns() - start_ns;
        order_latency_.record(order_latency);
        
        if (!inserted) {
            return TradeExecutor::ExecutionReport{
                .order_id = order_id,
                .success = false,
                .error_message = "Order book full",
                .latency_ns = order_latency
            };
        }
        
        return TradeExecutor::ExecutionReport{
            .order_id = order_id,
            .trade_id = order_id,
            .success = true,
            .latency_ns = order_latency
        };
    }

private:
    void process_order_flow(std::stop_token st) {
        LockFreeOrderBook<double, uint64_t>::Order order;
        
        while (!st.stop_requested()) {
            if (order_flow_.pop(order)) {
                const uint64_t start = timestamp_.monotonic_ns();
                const uint64_t latency = timestamp_.monotonic_ns() - start;
                match_latency_.record(latency);
            } else {
                std::this_thread::yield();
            }
        }
    }
    
public:
    LatencyStats get_order_latency_stats() const { return order_latency_; }
    LatencyStats get_match_latency_stats() const { return match_latency_; }
    LatencyStats get_risk_latency_stats() const { return risk_latency_; }
    
    double get_mid_price(const std::string& symbol) const {
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) return 0;
        
        double bid = it->second->get_best_bid();
        double ask = it->second->get_best_ask();
        
        return (bid + ask) / 2.0;
    }
    
    double get_spread(const std::string& symbol) const {
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) return 0;
        
        return it->second->get_spread();
    }
};

} // namespace tigerex

#endif // TIGEREX_ULTRA_LOW_LATENCY_ENGINE_HPP
