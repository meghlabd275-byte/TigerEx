/*!
 * TigerEx Ultra Low Latency Core
 * Lock-free data structures
 */

#include <atomic>
#include <cstdint>
#include <array>

namespace tigerex {

// Lock-Free Ring Buffer
template<typename T, size_t N>
class LockFreeRingBuffer {
    alignas(64) std::atomic<uint64_t> head_{0};
    alignas(64) std::atomic<uint64_t> tail_{0};
    alignas(64) std::array<T, N> buffer_;
    
public:
    bool push(const T& item) {
        uint64_t head = head_.load(std::memory_order_relaxed);
        uint64_t next = (head + 1) % N;
        
        if (next == tail_.load(std::memory_order_acquire)) {
            return false;  // Full
        }
        
        buffer_[head] = item;
        head_.store(next, std::memory_order_release);
        return true;
    }
    
    bool pop(T& item) {
        uint64_t tail = tail_.load(std::memory_order_relaxed);
        
        if (tail == head_.load(std::memory_order_acquire)) {
            return false;  // Empty
        }
        
        item = buffer_[tail];
        tail_.store((tail + 1) % N, std::memory_order_release);
        return true;
    }
};

// Disruptor Pattern
template<typename Event>
class Disruptor {
    static constexpr size_t BUFFER_SIZE = 4096;
    LockFreeRingBuffer<Event, BUFFER_SIZE> ring_;
    
public:
    bool publish(const Event& e) { return ring_.push(e); }
    bool consume(Event& e) { return ring_.pop(e); }
};

// Cache-Line Padded Counter
struct PaddedCounter {
    alignas(64) std::atomic<uint64_t> value{0};
    
    void increment() { value.fetch_add(1, std::memory_order_relaxed); }
    uint64_t get() const { return value.load(std::memory_order_relaxed); }
};

// SPDX-License-Identifier: MIT
} // namespace tigerex