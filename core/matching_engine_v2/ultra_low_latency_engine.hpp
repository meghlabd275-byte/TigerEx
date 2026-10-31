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
#include <bit>
#include <deque>
#include <map>
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

// Memory pool with fixed-capacity allocation. The free list is guarded by a
// mutex: the previous lock-free Treiber stack was ABA-prone and could hand the
// same node to two callers, which would corrupt any object built on it.
template<typename T, size_t PoolSize = 65536>
class MemoryPool {
private:
    struct Node {
        alignas(alignof(T)) unsigned char storage[sizeof(T)];
        Node* next;
    };

    std::vector<Node> storage_;
    Node* free_head_;
    size_t allocated_;
    mutable std::mutex mutex_;

public:
    MemoryPool() : storage_(PoolSize), free_head_(nullptr), allocated_(0) {
        for (size_t i = 0; i < PoolSize; ++i) {
            storage_[i].next = free_head_;
            free_head_ = &storage_[i];
        }
    }

    MemoryPool(const MemoryPool&) = delete;
    MemoryPool& operator=(const MemoryPool&) = delete;

    // Returns storage for one T, or nullptr when the pool is exhausted. The
    // caller is responsible for constructing the object with placement new.
    T* allocate() noexcept {
        std::lock_guard lock(mutex_);
        if (!free_head_) {
            return nullptr;
        }
        Node* node = free_head_;
        free_head_ = node->next;
        ++allocated_;
        return reinterpret_cast<T*>(node->storage);
    }

    // Returns a pointer previously handed out by allocate().
    void deallocate(T* ptr) noexcept {
        if (!ptr) return;
        std::lock_guard lock(mutex_);
        Node* node = reinterpret_cast<Node*>(ptr);
        node->next = free_head_;
        free_head_ = node;
        --allocated_;
    }

    size_t allocated() const noexcept {
        std::lock_guard lock(mutex_);
        return allocated_;
    }

    size_t capacity() const noexcept { return PoolSize; }
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

// Bounded multi-producer / multi-consumer queue (Vyukov). Each slot carries a
// sequence number so producers and consumers agree on ownership without a lock.
template<typename T, size_t Capacity = 4096>
class alignas(64) MPMCRingBuffer {
private:
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be power of 2");
    static_assert(Capacity >= 2, "Capacity must be at least 2");

    struct alignas(64) Cell {
        std::atomic<size_t> sequence;
        T data;
    };

    alignas(64) Cell buffer_[Capacity];
    alignas(64) std::atomic<size_t> enqueue_pos_{0};
    alignas(64) std::atomic<size_t> dequeue_pos_{0};

public:
    MPMCRingBuffer() {
        for (size_t i = 0; i < Capacity; ++i) {
            buffer_[i].sequence.store(i, std::memory_order_relaxed);
        }
    }

    MPMCRingBuffer(const MPMCRingBuffer&) = delete;
    MPMCRingBuffer& operator=(const MPMCRingBuffer&) = delete;

    HOT bool push(T&& item) noexcept {
        size_t pos = enqueue_pos_.load(std::memory_order_relaxed);
        for (;;) {
            Cell& cell = buffer_[pos & (Capacity - 1)];
            size_t seq = cell.sequence.load(std::memory_order_acquire);
            intptr_t diff = static_cast<intptr_t>(seq) - static_cast<intptr_t>(pos);

            if (diff == 0) {
                if (enqueue_pos_.compare_exchange_weak(pos, pos + 1,
                        std::memory_order_relaxed, std::memory_order_relaxed)) {
                    cell.data = std::move(item);
                    cell.sequence.store(pos + 1, std::memory_order_release);
                    return true;
                }
            } else if (diff < 0) {
                return false;  // Full
            } else {
                pos = enqueue_pos_.load(std::memory_order_relaxed);
            }
        }
    }

    HOT bool pop(T& item) noexcept {
        size_t pos = dequeue_pos_.load(std::memory_order_relaxed);
        for (;;) {
            Cell& cell = buffer_[pos & (Capacity - 1)];
            size_t seq = cell.sequence.load(std::memory_order_acquire);
            intptr_t diff = static_cast<intptr_t>(seq) - static_cast<intptr_t>(pos + 1);

            if (diff == 0) {
                if (dequeue_pos_.compare_exchange_weak(pos, pos + 1,
                        std::memory_order_relaxed, std::memory_order_relaxed)) {
                    item = std::move(cell.data);
                    cell.sequence.store(pos + Capacity, std::memory_order_release);
                    return true;
                }
            } else if (diff < 0) {
                return false;  // Empty
            } else {
                pos = dequeue_pos_.load(std::memory_order_relaxed);
            }
        }
    }

    bool empty() const noexcept {
        size_t pos = dequeue_pos_.load(std::memory_order_relaxed);
        const Cell& cell = buffer_[pos & (Capacity - 1)];
        size_t seq = cell.sequence.load(std::memory_order_acquire);
        return static_cast<intptr_t>(seq) - static_cast<intptr_t>(pos + 1) < 0;
    }
};

// Price-time priority order book. It is mutex-guarded rather than lock-free:
// the previous bucket-array version sorted level arrays on every insert, never
// tracked resting order identity, and could not represent more than one order
// per price. Correctness is preferred over the claim of a lock-free structure.
template<typename Price, typename Quantity>
class OrderBook {
public:
    struct Order {
        uint64_t order_id;
        uint64_t user_id;
        uint64_t account_id;
        uint8_t side;      // 0 = buy, 1 = sell
        uint8_t type;      // 0 = limit, 1 = market
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
    struct RestingLevel {
        Quantity quantity{0};
        std::deque<uint64_t> order_ids;  // FIFO for time priority
    };

    std::map<Price, RestingLevel, std::greater<Price>> bids_;
    std::map<Price, RestingLevel, std::less<Price>> asks_;
    std::unordered_map<uint64_t, Order> orders_;
    std::vector<Trade> trades_;

    mutable std::shared_mutex mutex_;

    std::atomic<uint64_t> total_trades_{0};
    std::atomic<uint64_t> next_trade_id_{1};
    std::atomic<double> total_volume_{0.0};
    std::atomic<uint64_t> max_latency_ns_{0};
    std::atomic<uint64_t> min_latency_ns_{~0ULL};

    TimestampCounter timestamp_;

public:
    OrderBook() = default;

    // Submit an order. Returns true when the order was accepted (whether it
    // rested or fully/partially matched). Market orders never rest.
    bool insert_order(const Order& order) {
        const uint64_t start_ns = timestamp_.monotonic_ns();

        if (order.quantity == 0) {
            return false;
        }

        std::unique_lock lock(mutex_);

        if (orders_.count(order.order_id) != 0) {
            return false;  // Duplicate order id
        }

        Quantity remaining = order.quantity;
        Order working = order;
        working.filled = 0;

        if (order.side == 0) {
            remaining = match_against(asks_, working, remaining, /*is_market=*/order.type != 0);
        } else {
            remaining = match_against(bids_, working, remaining, /*is_market=*/order.type != 0);
        }

        working.filled = static_cast<Quantity>(order.quantity - remaining);

        // A limit order with residual quantity rests on the book.
        if (remaining > 0 && order.type == 0) {
            if (order.side == 0) {
                auto& level = bids_[order.price];
                level.quantity = static_cast<Quantity>(level.quantity + remaining);
                level.order_ids.push_back(order.order_id);
            } else {
                auto& level = asks_[order.price];
                level.quantity = static_cast<Quantity>(level.quantity + remaining);
                level.order_ids.push_back(order.order_id);
            }
            orders_[order.order_id] = working;
        }

        const uint64_t latency = timestamp_.monotonic_ns() - start_ns;
        update_latency_stats(latency);

        return true;
    }

    // Cancel a resting order. Returns false when the order is unknown or already
    // fully filled.
    bool cancel_order(uint64_t order_id) {
        std::unique_lock lock(mutex_);

        auto it = orders_.find(order_id);
        if (it == orders_.end()) {
            return false;
        }

        Order& order = it->second;
        Quantity outstanding = static_cast<Quantity>(order.quantity - order.filled);
        if (outstanding == 0) {
            return false;
        }

        if (order.side == 0) {
            remove_from_level(bids_, order.price, order_id, outstanding);
        } else {
            remove_from_level(asks_, order.price, order_id, outstanding);
        }

        order.filled = order.quantity;
        return true;
    }

    Price get_best_bid() const {
        std::shared_lock lock(mutex_);
        return bids_.empty() ? Price{0} : bids_.begin()->first;
    }

    Price get_best_ask() const {
        std::shared_lock lock(mutex_);
        return asks_.empty() ? Price{0} : asks_.begin()->first;
    }

    // Spread is undefined unless both sides are populated.
    std::optional<Price> get_spread() const {
        std::shared_lock lock(mutex_);
        if (bids_.empty() || asks_.empty()) {
            return std::nullopt;
        }
        return asks_.begin()->first - bids_.begin()->first;
    }

    std::optional<Order> get_order(uint64_t order_id) const {
        std::shared_lock lock(mutex_);
        auto it = orders_.find(order_id);
        if (it == orders_.end()) {
            return std::nullopt;
        }
        return it->second;
    }

    std::vector<Trade> get_trades() const {
        std::shared_lock lock(mutex_);
        return trades_;
    }

    uint64_t get_total_trades() const noexcept {
        return total_trades_.load(std::memory_order_relaxed);
    }

    double get_total_volume() const noexcept {
        return total_volume_.load(std::memory_order_relaxed);
    }

    std::pair<uint64_t, uint64_t> get_latency_stats() const noexcept {
        return {min_latency_ns_.load(std::memory_order_relaxed),
                max_latency_ns_.load(std::memory_order_relaxed)};
    }

private:
    // Walk the opposite side in price priority, filling `working` until it is
    // exhausted or no further price is acceptable.
    template<typename OppositeSide>
    Quantity match_against(OppositeSide& opposite, Order& working, Quantity remaining, bool is_market) {
        while (remaining > 0 && !opposite.empty()) {
            auto level_it = opposite.begin();
            Price level_price = level_it->first;

            if (!is_market) {
                bool acceptable = (working.side == 0) ? (working.price >= level_price)
                                                      : (working.price <= level_price);
                if (!acceptable) {
                    break;
                }
            }

            RestingLevel& level = level_it->second;

            while (remaining > 0 && !level.order_ids.empty()) {
                uint64_t resting_id = level.order_ids.front();
                auto resting_it = orders_.find(resting_id);
                if (resting_it == orders_.end()) {
                    level.order_ids.pop_front();
                    continue;
                }

                Order& resting = resting_it->second;
                Quantity available = static_cast<Quantity>(resting.quantity - resting.filled);
                if (available == 0) {
                    level.order_ids.pop_front();
                    continue;
                }

                Quantity match = std::min(remaining, available);

                Trade trade{};
                trade.trade_id = next_trade_id_.fetch_add(1, std::memory_order_relaxed);
                trade.price = level_price;
                trade.quantity = match;
                trade.timestamp = timestamp_.monotonic_ns();
                if (working.side == 0) {
                    trade.buy_order_id = working.order_id;
                    trade.sell_order_id = resting_id;
                    trade.maker_side = 1;
                } else {
                    trade.buy_order_id = resting_id;
                    trade.sell_order_id = working.order_id;
                    trade.maker_side = 0;
                }

                trades_.push_back(trade);
                total_trades_.fetch_add(1, std::memory_order_relaxed);
                total_volume_.fetch_add(static_cast<double>(level_price) *
                                        static_cast<double>(match),
                                        std::memory_order_relaxed);

                resting.filled = static_cast<Quantity>(resting.filled + match);
                level.quantity = static_cast<Quantity>(level.quantity - match);
                remaining = static_cast<Quantity>(remaining - match);

                if (resting.filled == resting.quantity) {
                    level.order_ids.pop_front();
                }
            }

            if (level.quantity == 0) {
                opposite.erase(level_it);
            }
        }

        return remaining;
    }

    template<typename Side>
    void remove_from_level(Side& side, Price price, uint64_t order_id, Quantity outstanding) {
        auto it = side.find(price);
        if (it == side.end()) {
            return;
        }

        auto& ids = it->second.order_ids;
        for (auto id_it = ids.begin(); id_it != ids.end(); ++id_it) {
            if (*id_it == order_id) {
                ids.erase(id_it);
                break;
            }
        }

        it->second.quantity = static_cast<Quantity>(it->second.quantity - outstanding);
        if (it->second.quantity == 0 || it->second.order_ids.empty()) {
            side.erase(it);
        }
    }

    void update_latency_stats(uint64_t latency) {
        uint64_t current = max_latency_ns_.load(std::memory_order_relaxed);
        while (latency > current &&
               !max_latency_ns_.compare_exchange_weak(current, latency,
               std::memory_order_relaxed, std::memory_order_relaxed));

        current = min_latency_ns_.load(std::memory_order_relaxed);
        while (latency < current &&
               !min_latency_ns_.compare_exchange_weak(current, latency,
               std::memory_order_relaxed, std::memory_order_relaxed));
    }
};

// Latency histogram. Percentiles are derived from a log2-bucketed histogram so
// they reflect recorded samples instead of being stored as never-updated fields.
struct LatencySnapshot {
    uint64_t count = 0;
    uint64_t min_ns = 0;
    uint64_t max_ns = 0;
    uint64_t p50_ns = 0;
    uint64_t p95_ns = 0;
    uint64_t p99_ns = 0;
    uint64_t p999_ns = 0;
    double mean_ns = 0.0;
};

struct alignas(64) LatencyStats {
    static constexpr size_t kBuckets = 66;

    std::atomic<uint64_t> count{0};
    std::atomic<uint64_t> sum{0};
    std::atomic<uint64_t> min_latency{~0ULL};
    std::atomic<uint64_t> max_latency{0};
    std::array<std::atomic<uint64_t>, kBuckets> histogram{};

    LatencyStats() {
        for (auto& bucket : histogram) {
            bucket.store(0, std::memory_order_relaxed);
        }
    }

    LatencyStats(const LatencyStats&) = delete;
    LatencyStats& operator=(const LatencyStats&) = delete;

    static size_t bucket_index(uint64_t latency_ns) {
        if (latency_ns == 0) return 0;
        return static_cast<size_t>(std::bit_width(latency_ns));
    }

    void record(uint64_t latency_ns) {
        count.fetch_add(1, std::memory_order_relaxed);
        sum.fetch_add(latency_ns, std::memory_order_relaxed);
        histogram[bucket_index(latency_ns)].fetch_add(1, std::memory_order_relaxed);

        uint64_t current = min_latency.load(std::memory_order_relaxed);
        while (latency_ns < current &&
               !min_latency.compare_exchange_weak(current, latency_ns,
               std::memory_order_relaxed, std::memory_order_relaxed));

        current = max_latency.load(std::memory_order_relaxed);
        while (latency_ns > current &&
               !max_latency.compare_exchange_weak(current, latency_ns,
               std::memory_order_relaxed, std::memory_order_relaxed));
    }

    LatencySnapshot snapshot() const {
        LatencySnapshot out;
        uint64_t samples = count.load(std::memory_order_relaxed);
        if (samples == 0) {
            return out;
        }

        out.count = samples;
        out.min_ns = min_latency.load(std::memory_order_relaxed);
        out.max_ns = max_latency.load(std::memory_order_relaxed);
        out.mean_ns = static_cast<double>(sum.load(std::memory_order_relaxed)) /
                      static_cast<double>(samples);

        auto percentile = [&](uint64_t numerator, uint64_t denominator) -> uint64_t {
            uint64_t rank = (samples * numerator + denominator - 1) / denominator;
            uint64_t cumulative = 0;
            for (size_t i = 0; i < kBuckets; ++i) {
                cumulative += histogram[i].load(std::memory_order_relaxed);
                if (cumulative >= rank) {
                    return i == 0 ? 0 : (1ULL << (i - 1));
                }
            }
            return out.max_ns;
        };

        out.p50_ns = percentile(50, 100);
        out.p95_ns = percentile(95, 100);
        out.p99_ns = percentile(99, 100);
        out.p999_ns = percentile(999, 1000);

        return out;
    }
};

// Per-order risk limits and per-account risk state.
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
    mutable std::shared_mutex risk_mutex_;

public:
    explicit RiskEngine(RiskLimits limits) : limits_(limits) {}

    // Evaluate a prospective order. An account with no recorded risk state is
    // rejected: margin cannot be verified for an account the engine has not seen.
    bool check_order_risk(uint64_t account_id, T order_value, T additional_exposure) {
        if (!std::isfinite(static_cast<double>(order_value)) || order_value <= T{0}) {
            return false;
        }
        if (order_value < limits_.min_order_size) {
            return false;
        }
        if (order_value > limits_.max_order_value) {
            return false;
        }
        if (limits_.max_leverage <= T{0}) {
            return false;
        }

        std::shared_lock lock(risk_mutex_);

        auto it = account_risks_.find(account_id);
        if (it == account_risks_.end()) {
            return false;
        }

        const AccountRisk& risk = it->second;

        if (risk.total_exposure + additional_exposure > limits_.max_position_size) {
            return false;
        }

        T notional = order_value + additional_exposure;
        T required_margin = notional / limits_.max_leverage;
        if (required_margin > risk.available_balance) {
            return false;
        }

        return true;
    }

    void update_account_risk(uint64_t account_id, const AccountRisk& risk) {
        std::unique_lock lock(risk_mutex_);
        account_risks_[account_id] = risk;
    }

    std::optional<AccountRisk> get_account_risk(uint64_t account_id) const {
        std::shared_lock lock(risk_mutex_);
        auto it = account_risks_.find(account_id);
        if (it == account_risks_.end()) {
            return std::nullopt;
        }
        return it->second;
    }
};

// Order execution against a book, with risk gating.
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
    OrderBook<double, double> order_book_;
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

    OrderBook<double, double>& book() { return order_book_; }

    ExecutionReport execute_market_order(uint64_t account_id, uint64_t order_id,
                                         uint8_t side, double quantity) {
        const uint64_t start_ns = timestamp_.monotonic_ns();

        ExecutionReport report{
            .order_id = order_id,
            .trade_id = 0,
            .success = false,
            .price = 0.0,
            .quantity = 0.0,
            .latency_ns = 0,
            .error_message = {}
        };

        if (quantity <= 0.0) {
            report.error_message = "Invalid quantity";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        // Price the order off the opposite side before the risk check, because
        // the notional value depends on it.
        double price = side == 0 ? order_book_.get_best_ask() : order_book_.get_best_bid();
        if (price <= 0.0) {
            report.error_message = "No liquidity";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        if (!risk_engine_.check_order_risk(account_id, price * quantity, price * quantity)) {
            report.error_message = "Risk check failed";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        OrderBook<double, double>::Order order{};
        order.order_id = order_id;
        order.user_id = account_id;
        order.account_id = account_id;
        order.side = side;
        order.type = 1;  // market
        order.price = price;
        order.quantity = quantity;
        order.filled = 0.0;
        order.timestamp = start_ns;
        order.flags = 0;

        if (!order_book_.insert_order(order)) {
            report.error_message = "Order rejected";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        report.success = true;
        report.trade_id = order_id;
        report.price = price;
        report.quantity = quantity;
        report.latency_ns = timestamp_.monotonic_ns() - start_ns;

        return report;
    }
};

// Main matching engine. Symbols are registered explicitly; there is no built-in
// instrument list.
class UltraLowLatencyMatchingEngine {
private:
    std::unordered_map<std::string, std::unique_ptr<OrderBook<double, double>>> order_books_;
    mutable std::shared_mutex books_mutex_;

    RiskEngine<double> risk_engine_;
    TimestampCounter timestamp_;

    alignas(64) LatencyStats order_latency_;

public:
    UltraLowLatencyMatchingEngine()
        : risk_engine_(RiskEngine<double>::RiskLimits{
              .max_order_value = 1'000'000.0,
              .max_position_size = 10'000'000.0,
              .max_leverage = 125.0,
              .min_order_size = 0.0001,
              .max_orders_per_second = 1000,
              .daily_volume_limit = 100'000'000.0
          }) {}

    ~UltraLowLatencyMatchingEngine() = default;

    // Register a tradable symbol.
    bool register_symbol(const std::string& symbol) {
        std::unique_lock lock(books_mutex_);
        if (order_books_.count(symbol) != 0) {
            return false;
        }
        order_books_[symbol] = std::make_unique<OrderBook<double, double>>();
        return true;
    }

    bool has_symbol(const std::string& symbol) const {
        std::shared_lock lock(books_mutex_);
        return order_books_.count(symbol) != 0;
    }

    RiskEngine<double>& risk_engine() { return risk_engine_; }

    // Synchronous order entry. Validates the symbol, gates on risk, and inserts
    // into the book, reporting the real latency of that work.
    TradeExecutor::ExecutionReport place_order(
        uint64_t account_id,
        uint64_t order_id,
        const std::string& symbol,
        uint8_t side,
        uint8_t type,
        double price,
        double quantity
    ) {
        const uint64_t start_ns = timestamp_.monotonic_ns();

        TradeExecutor::ExecutionReport report{
            .order_id = order_id,
            .trade_id = 0,
            .success = false,
            .price = 0.0,
            .quantity = 0.0,
            .latency_ns = 0,
            .error_message = {}
        };

        if (quantity <= 0.0 || !std::isfinite(price) || price <= 0.0) {
            report.error_message = "Invalid order parameters";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        if (!risk_engine_.check_order_risk(account_id, price * quantity, price * quantity)) {
            report.error_message = "Risk check failed";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        OrderBook<double, double>::Order order{};
        order.order_id = order_id;
        order.user_id = account_id;
        order.account_id = account_id;
        order.side = side;
        order.type = type;
        order.price = price;
        order.quantity = quantity;
        order.filled = 0.0;
        order.timestamp = start_ns;
        order.flags = 0;

        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            report.error_message = "Symbol not found";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        if (!it->second->insert_order(order)) {
            report.error_message = "Order rejected";
            report.latency_ns = timestamp_.monotonic_ns() - start_ns;
            return report;
        }

        const uint64_t latency = timestamp_.monotonic_ns() - start_ns;
        order_latency_.record(latency);

        report.success = true;
        report.trade_id = order_id;
        report.price = price;
        report.quantity = quantity;
        report.latency_ns = latency;

        return report;
    }

    bool cancel_order(const std::string& symbol, uint64_t order_id) {
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            return false;
        }
        return it->second->cancel_order(order_id);
    }

    std::optional<double> get_mid_price(const std::string& symbol) const {
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            return std::nullopt;
        }

        double bid = it->second->get_best_bid();
        double ask = it->second->get_best_ask();
        if (bid <= 0.0 || ask <= 0.0) {
            return std::nullopt;
        }

        return (bid + ask) / 2.0;
    }

    std::optional<double> get_spread(const std::string& symbol) const {
        std::shared_lock lock(books_mutex_);
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            return std::nullopt;
        }
        return it->second->get_spread();
    }

    LatencySnapshot get_order_latency_stats() const { return order_latency_.snapshot(); }

private:
};

} // namespace tigerex

#endif // TIGEREX_ULTRA_LOW_LATENCY_ENGINE_HPP
