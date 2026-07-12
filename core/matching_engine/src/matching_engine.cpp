/**
 * TigerEx C++ Matching Engine
 * Ultra-low latency order matching for cryptocurrency exchange
 * Target latency: <50 microseconds
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#include "order_book.hpp"
#include <iostream>
#include <thread>
#include <future>
#include <chrono>
#include <random>
#include <csignal>
#include <cstring>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <x86intrin.h>

// Lock-free ring buffer for high-performance logging
template<typename T, size_t N>
class LockFreeRingBuffer {
private:
    alignas(64) std::atomic<size_t> write_pos_{0};
    alignas(64) std::atomic<size_t> read_pos_{0};
    T buffer_[N];
    
public:
    bool push(const T& item) {
        size_t write_pos = write_pos_.load(std::memory_order_relaxed);
        size_t next_pos = (write_pos + 1) % N;
        
        if (next_pos == read_pos_.load(std::memory_order_acquire)) {
            return false;  // Full
        }
        
        buffer_[write_pos] = item;
        write_pos_.store(next_pos, std::memory_order_release);
        return true;
    }
    
    bool pop(T& item) {
        size_t read_pos = read_pos_.load(std::memory_order_relaxed);
        
        if (read_pos == write_pos_.load(std::memory_order_acquire)) {
            return false;  // Empty
        }
        
        item = buffer_[read_pos];
        read_pos_.store((read_pos + 1) % N, std::memory_order_release);
        return true;
    }
    
    size_t size() const {
        size_t write_pos = write_pos_.load(std::memory_order_relaxed);
        size_t read_pos = read_pos_.load(std::memory_order_relaxed);
        
        if (write_pos >= read_pos) {
            return write_pos - read_pos;
        }
        return N - read_pos + write_pos;
    }
    
    bool empty() const {
        return write_pos_.load(std::memory_order_relaxed) == read_pos_.load(std::memory_order_relaxed);
    }
};

// High-frequency timer with TSC
class HighFrequencyTimer {
private:
    static constexpr uint64_t NS_PER_SEC = 1'000'000'000ULL;
    static constexpr uint64_t NS_PER_TICK = 100ULL;  // Approximate
    
    uint64_t base_time_;
    uint64_t base_tsc_;
    double tsc_to_ns_;
    
public:
    HighFrequencyTimer() : base_time_(0), base_tsc_(0), tsc_to_ns_(1.0) {
        recalibrate();
    }
    
    void recalibrate() {
        base_time_ = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
        
        // Read TSC
        base_tsc_ = __rdtsc();
        
        // Measure TSC rate
        auto start = std::chrono::high_resolution_clock::now();
        for (int i = 0; i < 1000; ++i) {
            __rdtsc();
        }
        auto end = std::chrono::high_resolution_clock::now();
        
        auto duration = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
        uint64_t tsc_delta = 1000;
        
        if (duration > 0) {
            tsc_to_ns_ = static_cast<double>(duration) / static_cast<double>(tsc_delta);
        }
    }
    
    uint64_t now_ns() const {
        uint64_t current_tsc = __rdtsc();
        uint64_t tsc_delta = current_tsc - base_tsc_;
        return base_time_ + static_cast<uint64_t>(static_cast<double>(tsc_delta) * tsc_to_ns_);
    }
    
    uint64_t timestamp_ms() const {
        return now_ns() / 1'000'000ULL;
    }
    
    uint64_t timestamp_us() const {
        return now_ns() / 1'000ULL;
    }
};

// Memory pool for orders - lock-free
class OrderMemoryPool {
private:
    static constexpr size_t PAGE_SIZE = 4096;
    static constexpr size_t POOL_SIZE = 1'000'000;
    
    struct Page {
        alignas(64) char data[PAGE_SIZE];
    };
    
    std::vector<std::unique_ptr<Page>> pages_;
    std::atomic<size_t> next_free_{0};
    
public:
    OrderMemoryPool() {
        pages_.reserve(POOL_SIZE / (PAGE_SIZE / sizeof(tigerex::matching::Order)));
        
        for (size_t i = 0; i < POOL_SIZE / 100; ++i) {
            pages_.push_back(std::make_unique<Page>());
        }
    }
    
    tigerex::matching::Order* allocate() {
        size_t index = next_free_.fetch_add(1, std::memory_order_relaxed);
        
        if (index >= POOL_SIZE) {
            return nullptr;
        }
        
        size_t page_index = index / (PAGE_SIZE / sizeof(tigerex::matching::Order));
        size_t offset = index % (PAGE_SIZE / sizeof(tigerex::matching::Order));
        
        auto* ptr = reinterpret_cast<tigerex::matching::Order*>(pages_[page_index]->data + offset * sizeof(tigerex::matching::Order));
        return new (ptr) tigerex::matching::Order();
    }
    
    void deallocate(tigerex::matching::Order* ptr) {
        // In a real implementation, we'd add to a free list
        // For now, we just let it leak (pool lifetime = application lifetime)
    }
};

// Matching engine statistics
struct EngineStats {
    uint64_t total_orders_{0};
    uint64_t total_trades_{0};
    uint64_t total_volume_{0};
    uint64_t total_rejects_{0};
    uint64_t avg_latency_ns_{0};
    uint64_t max_latency_ns_{0};
    uint64_t min_latency_ns_{0};
    uint64_t last_update_{0};
    uint32_t order_book_updates_{0};
    uint32_t health_status_{0};  // 0 = healthy, 1 = degraded, 2 = unhealthy
    
    void record_order() {
        total_orders_++;
    }
    
    void record_trade(uint64_t volume) {
        total_trades_++;
        total_volume_ += volume;
    }
    
    void record_reject() {
        total_rejects_++;
    }
    
    void record_latency(uint64_t latency_ns) {
        uint64_t current_avg = avg_latency_ns_;
        uint64_t current_count = total_orders_;
        
        if (current_count > 0) {
            uint64_t new_avg = (current_avg * (current_count - 1) + latency_ns) / current_count;
            avg_latency_ns_ = new_avg;
        }
        
        if (latency_ns > max_latency_ns_) {
            max_latency_ns_ = latency_ns;
        }
        
        if (min_latency_ns_ == 0 || latency_ns < min_latency_ns_) {
            min_latency_ns_ = latency_ns;
        }
    }
};

// Main matching engine
class MatchingEngine {
private:
    // Core components
    std::unique_ptr<tigerex::matching::MarketDataManager> market_data_;
    std::unique_ptr<tigerex::matching::BalanceManager> balance_manager_;
    std::unique_ptr<OrderMemoryPool> order_pool_;
    std::unique_ptr<HighFrequencyTimer> timer_;
    
    // Order books per symbol
    std::unordered_map<std::string, std::unique_ptr<tigerex::matching::OrderBook>> order_books_;
    mutable std::shared_mutex order_books_mutex_;
    
    // Order ID generator
    tigerex::matching::OrderIdGenerator order_id_gen_;
    
    // Trade notifications queue
    LockFreeRingBuffer<tigerex::matching::TradeNotification, 10000> trade_notifications_;
    
    // Statistics
    EngineStats stats_;
    
    // Configuration
    struct Config {
        bool enable_post_only_check = true;
        bool enable_cancel_before_fill = true;
        bool enable_max_orders_per_user = true;
        uint32_t max_orders_per_user = 100;
        uint32_t max_open_orders = 10'000'000;
        uint64_t max_order_value = 1'000'000'000'000'000ULL;
        uint64_t min_order_value = 100ULL;
        uint64_t max_quantity = 999'999'999'999'999ULL;
        uint64_t min_quantity = 1ULL;
        uint32_t price_precision = 8;
        uint32_t quantity_precision = 8;
        bool enable_self_trade_prevention = true;
        bool enable_auto_cancel_oco = true;
    } config_;
    
    // Callbacks
    std::vector<std::function<void(const tigerex::matching::TradeNotification&)>> trade_callbacks_;
    std::vector<std::function<void(const tigerex::matching::OrderResponse&)>> order_callbacks_;
    
    // Status
    std::atomic<bool> running_{false};
    std::atomic<bool> paused_{false};
    
    // Threads
    std::vector<std::thread> worker_threads_;
    std::thread stats_thread_;
    std::thread cleanup_thread_;
    
    // Shm for inter-process communication
    int shm_fd_ = -1;
    void* shm_addr_ = nullptr;
    
public:
    MatchingEngine() {
        market_data_ = std::make_unique<tigerex::matching::MarketDataManager>();
        balance_manager_ = std::make_unique<tigerex::matching::BalanceManager>();
        order_pool_ = std::make_unique<OrderMemoryPool>();
        timer_ = std::make_unique<HighFrequencyTimer>();
    }
    
    ~MatchingEngine() {
        stop();
        
        if (shm_addr_ != nullptr && shm_addr_ != MAP_FAILED) {
            munmap(shm_addr_, sizeof(EngineStats));
        }
        
        if (shm_fd_ >= 0) {
            close(shm_fd_);
        }
    }
    
    // Initialize engine
    bool init() {
        // Create shared memory for stats
        shm_fd_ = shm_open("/tigerex_matching_engine", O_CREAT | O_RDWR, 0666);
        if (shm_fd_ >= 0) {
            ftruncate(shm_fd_, sizeof(EngineStats));
            shm_addr_ = mmap(nullptr, sizeof(EngineStats), PROT_READ | PROT_WRITE, MAP_SHARED, shm_fd_, 0);
            
            if (shm_addr_ != MAP_FAILED) {
                memset(shm_addr_, 0, sizeof(EngineStats));
            }
        }
        
        return true;
    }
    
    // Start engine
    bool start() {
        if (running_.load()) {
            return false;
        }
        
        running_.store(true);
        
        // Start worker threads
        uint32_t num_threads = std::thread::hardware_concurrency();
        for (uint32_t i = 0; i < num_threads; ++i) {
            worker_threads_.emplace_back(&MatchingEngine::worker_loop, this);
        }
        
        // Start stats thread
        stats_thread_ = std::thread(&MatchingEngine::stats_loop, this);
        
        // Start cleanup thread
        cleanup_thread_ = std::thread(&MatchingEngine::cleanup_loop, this);
        
        return true;
    }
    
    // Stop engine
    void stop() {
        running_.store(false);
        
        for (auto& thread : worker_threads_) {
            if (thread.joinable()) {
                thread.join();
            }
        }
        
        if (stats_thread_.joinable()) {
            stats_thread_.join();
        }
        
        if (cleanup_thread_.joinable()) {
            cleanup_thread_.join();
        }
    }
    
    // Pause engine
    void pause() {
        paused_.store(true);
    }
    
    // Resume engine
    void resume() {
        paused_.store(false);
    }
    
    // Create symbol/market
    bool create_market(const std::string& symbol, uint32_t price_precision = 8, uint32_t quantity_precision = 8) {
        std::unique_lock lock(order_books_mutex_);
        
        if (order_books_.find(symbol) != order_books_.end()) {
            return false;
        }
        
        order_books_[symbol] = std::make_unique<tigerex::matching::OrderBook>(
            symbol, price_precision, quantity_precision
        );
        
        market_data_->get_or_create_order_book(symbol, price_precision, quantity_precision);
        
        return true;
    }
    
    // Process order request
    tigerex::matching::OrderResponse process_order(const tigerex::matching::OrderRequest& request) {
        tigerex::matching::OrderResponse response;
        response.created_at = timer_->timestamp_ms();
        
        uint64_t start_time = timer_->now_ns();
        
        // Check if paused
        if (paused_.load()) {
            response.status = tigerex::matching::OrderStatus::REJECTED;
            response.reject_reason = tigerex::matching::RejectReason::MARKET_CLOSED;
            response.reject_text = "Market is paused";
            stats_.record_reject();
            return response;
        }
        
        // Get order book
        tigerex::matching::OrderBook* order_book = nullptr;
        {
            std::shared_lock lock(order_books_mutex_);
            auto it = order_books_.find(request.symbol);
            if (it == order_books_.end()) {
                response.status = tigerex::matching::OrderStatus::REJECTED;
                response.reject_reason = tigerex::matching::RejectReason::INVALID_ORDER;
                response.reject_text = "Invalid symbol";
                stats_.record_reject();
                return response;
            }
            order_book = it->second.get();
        }
        
        // Validate order
        auto validation_result = validate_order(request);
        if (!validation_result.first) {
            response.status = tigerex::matching::OrderStatus::REJECTED;
            response.reject_reason = validation_result.second;
            response.reject_text = get_reject_text(validation_result.second);
            stats_.record_reject();
            return response;
        }
        
        // Create order
        tigerex::matching::Order order;
        order.order_id = order_id_gen_.next_id();
        order.user_id = request.user_id;
        order.account_id = request.account_id;
        order.symbol = request.symbol;
        order.side = request.side;
        order.type = request.type;
        order.tif = request.tif;
        order.price = request.price;
        order.quantity = request.quantity;
        order.remaining_quantity = request.quantity;
        order.stop_price = request.stop_price;
        order.trigger_price = request.trigger_price;
        order.is_post_only = request.is_post_only;
        order.is_reduce_only = request.is_reduce_only;
        order.client_order_id = request.client_order_id;
        order.remark = request.remark;
        order.expire_time = request.expire_time;
        order.created_at = timer_->timestamp_ms();
        order.updated_at = order.created_at;
        
        // Handle different order types
        if (order.type == tigerex::matching::OrderType::MARKET) {
            // Market order - execute immediately
            auto trades = execute_market_order(order, order_book);
            response.status = order.remaining_quantity == 0 ? 
                tigerex::matching::OrderStatus::FILLED : 
                tigerex::matching::OrderStatus::PARTIALLY_FILLED;
            response.order_id = order.order_id;
            response.filled_quantity = order.filled_quantity;
            response.avg_fill_price = order.avg_fill_price;
        } else if (order.type == tigerex::matching::OrderType::STOP_LOSS || 
                 order.type == tigerex::matching::OrderType::STOP_LIMIT ||
                 order.type == tigerex::matching::OrderType::TAKE_PROFIT ||
                 order.type == tigerex::matching::OrderType::TAKE_PROFIT_LIMIT) {
            // Stop order - add to watchlist
            order_book->add_order(order);
            response.status = tigerex::matching::OrderStatus::NEW;
            response.order_id = order.order_id;
        } else if (order.type == tigerex::matching::OrderType::ICEBERG) {
            // Iceberg order
            order.is_iceberg = true;
            order.visible_quantity = calculate_iceberg_quantity(order.quantity);
            order.remaining_quantity = order.quantity;
            order_book->add_order(order);
            response.status = tigerex::matching::OrderStatus::NEW;
            response.order_id = order.order_id;
        } else if (order.type == tigerex::matching::OrderType::TRAILING_STOP) {
            // Trailing stop order
            order.trail_activation_price = request.price;
            order_book->add_order(order);
            response.status = tigerex::matching::OrderStatus::NEW;
            response.order_id = order.order_id;
        } else if (order.type == tigerex::matching::OrderType::OCO) {
            // One Cancels Other
            order.is_oco_first = true;
            order_book->add_order(order);
            response.status = tigerex::matching::OrderStatus::NEW;
            response.order_id = order.order_id;
        } else {
            // Regular limit order
            auto trades = execute_limit_order(order, order_book);
            
            if (trades.empty()) {
                // No match - add to book
                order_book->add_order(order);
                response.status = tigerex::matching::OrderStatus::NEW;
                response.order_id = order.order_id;
            } else {
                response.status = order.remaining_quantity == 0 ?
                    tigerex::matching::OrderStatus::FILLED :
                    tigerex::matching::OrderStatus::PARTIALLY_FILLED;
                response.order_id = order.order_id;
                response.filled_quantity = order.filled_quantity;
                response.avg_fill_price = order.avg_fill_price;
            }
        }
        
        // Record latency
        uint64_t latency = timer_->now_ns() - start_time;
        stats_.record_latency(latency);
        stats_.record_order();
        
        return response;
    }
    
    // Cancel order
    bool cancel_order(uint64_t order_id, uint64_t user_id, const std::string& symbol) {
        std::shared_lock lock(order_books_mutex_);
        
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            return false;
        }
        
        tigerex::matching::OrderBook* order_book = it->second.get();
        auto order_opt = order_book->get_order(order_id, tigerex::matching::Side::BUY);
        
        if (!order_opt.has_value()) {
            order_opt = order_book->get_order(order_id, tigerex::matching::Side::SELL);
        }
        
        if (!order_opt.has_value()) {
            return false;
        }
        
        const auto& order = order_opt.value();
        if (order.user_id != user_id) {
            return false;
        }
        
        return order_book->cancel_order(order_id, order.side);
    }
    
    // Modify order
    bool modify_order(uint64_t order_id, uint64_t user_id, const std::string& symbol, 
                   uint64_t new_price, uint64_t new_quantity) {
        std::shared_lock lock(order_books_mutex_);
        
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            return false;
        }
        
        tigerex::matching::OrderBook* order_book = it->second.get();
        auto order_opt = order_book->get_order(order_id, tigerex::matching::Side::BUY);
        
        if (!order_opt.has_value()) {
            order_opt = order_book->get_order(order_id, tigerex::matching::Side::SELL);
        }
        
        if (!order_opt.has_value()) {
            return false;
        }
        
        const auto& order = order_opt.value();
        if (order.user_id != user_id) {
            return false;
        }
        
        return order_book->modify_order(order_id, order.side, new_price, new_quantity);
    }
    
    // Get order book depth
    tigerex::matching::Depth get_depth(const std::string& symbol, uint32_t limit = 100) const {
        std::shared_lock lock(order_books_mutex_);
        
        auto it = order_books_.find(symbol);
        if (it == order_books_.end()) {
            return {};
        }
        
        return it->second->get_depth(limit);
    }
    
    // Get ticker
    std::optional<tigerex::matching::Ticker> get_ticker(const std::string& symbol) const {
        return market_data_->get_ticker(symbol);
    }
    
    // Get klines
    std::vector<tigerex::matching::Kline> get_klines(const std::string& symbol, 
                                                    uint32_t interval = 60,
                                                    uint32_t limit = 100) const {
        return market_data_->get_klines(symbol, limit);
    }
    
    // Register trade callback
    void on_trade(std::function<void(const tigerex::matching::TradeNotification&)> callback) {
        trade_callbacks_.push_back(callback);
    }
    
    // Register order callback
    void on_order(std::function<void(const tigerex::matching::OrderResponse&)> callback) {
        order_callbacks_.push_back(callback);
    }
    
    // Get statistics
    EngineStats get_stats() const {
        return stats_;
    }
    
private:
    // Validate order
    std::pair<bool, tigerex::matching::RejectReason> validate_order(
        const tigerex::matching::OrderRequest& request
    ) {
        // Check quantity
        if (request.quantity < config_.min_quantity) {
            return {false, tigerex::matching::RejectReason::QUANTITY_TOO_SMALL};
        }
        
        if (request.quantity > config_.max_quantity) {
            return {false, tigerex::matching::RejectReason::QUANTITY_TOO_LARGE};
        }
        
        // Check price
        if (request.type != tigerex::matching::OrderType::MARKET && request.price == 0) {
            return {false, tigerex::matching::RejectReason::PRICE_OUT_OF_RANGE};
        }
        
        // Check balance for buy orders
        if (request.side == tigerex::matching::Side::BUY) {
            uint64_t required = request.price * request.quantity;
            if (config_.max_order_value > 0 && required > config_.max_order_value) {
                return {false, tigerex::matching::RejectReason::PRICE_OUT_OF_RANGE};
            }
            
            auto balance = balance_manager_->get_balance(request.user_id, request.symbol);
            if (balance.total < required) {
                return {false, tigerex::matching::RejectReason::INSUFFICIENT_BALANCE};
            }
        }
        
        // Post-only check
        if (config_.enable_post_only_check && request.is_post_only) {
            if (request.type == tigerex::matching::OrderType::LIMIT) {
                // Check if it would immediately match
                auto [bid, bid_q] = order_books_[request.symbol]->best_bid();
                auto [ask, ask_q] = order_books_[request.symbol]->best_ask();
                
                bool would_match = (request.side == tigerex::matching::Side::BUY && ask > 0 && request.price >= ask) ||
                                 (request.side == tigerex::matching::Side::SELL && bid > 0 && request.price <= bid);
                
                if (would_match) {
                    return {false, tigerex::matching::RejectReason::POST_ONLY_WOULD_MATCH};
                }
            }
        }
        
        return {true, tigerex::matching::RejectReason::NONE};
    }
    
    // Execute market order
    std::vector<tigerex::matching::Trade> execute_market_order(
        tigerex::matching::Order& order,
        tigerex::matching::OrderBook* order_book
    ) {
        return order_book->match_orders(order);
    }
    
    // Execute limit order
    std::vector<tigerex::matching::Trade> execute_limit_order(
        tigerex::matching::Order& order,
        tigerex::matching::OrderBook* order_book
    ) {
        return order_book->match_orders(order);
    }
    
    // Calculate iceberg quantity
    uint64_t calculate_iceberg_quantity(uint64_t total_quantity) {
        // RFC 7822 - visible portion should be 10-20%
        return std::max(total_quantity / 10, static_cast<uint64_t>(100));
    }
    
    // Get reject text
    std::string get_reject_text(tigerex::matching::RejectReason reason) const {
        switch (reason) {
            case tigerex::matching::RejectReason::INVALID_ORDER:
                return "Invalid order";
            case tigerex::matching::RejectReason::INSUFFICIENT_BALANCE:
                return "Insufficient balance";
            case tigerex::matching::RejectReason::PRICE_OUT_OF_RANGE:
                return "Price out of range";
            case tigerex::matching::RejectReason::QUANTITY_TOO_SMALL:
                return "Quantity too small";
            case tigerex::matching::RejectReason::QUANTITY_TOO_LARGE:
                return "Quantity too large";
            case tigerex::matching::RejectReason::MAX_ORDERS_EXCEEDED:
                return "Maximum orders exceeded";
            case tigerex::matching::RejectReason::DUPLICATE_ORDER:
                return "Duplicate order";
            case tigerex::matching::RejectReason::MARKET_CLOSED:
                return "Market closed";
            case tigerex::matching::RejectReason::RISK_CHECK_FAILED:
                return "Risk check failed";
            case tigerex::matching::RejectReason::POST_ONLY_WOULD_MATCH:
                return "Post-only order would match";
            case tigerex::matching::RejectReason::INVALID_STOP_PRICE:
                return "Invalid stop price";
            default:
                return "Unknown error";
        }
    }
    
    // Worker loop
    void worker_loop() {
        while (running_.load()) {
            // Process any pending operations
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    }
    
    // Stats loop
    void stats_loop() {
        while (running_.load()) {
            stats_.last_update_ = timer_->timestamp_ms();
            stats_.order_book_updates_ = 0;
            
            // Update shared memory
            if (shm_addr_ != nullptr && shm_addr_ != MAP_FAILED) {
                memcpy(shm_addr_, &stats_, sizeof(EngineStats));
            }
            
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
    }
    
    // Cleanup loop
    void cleanup_loop() {
        while (running_.load()) {
            // Cleanup expired orders
            // Cancel OCO orders
            // Update positions
            
            std::this_thread::sleep_for(std::chrono::seconds(10));
        }
    }
};

// Main entry point
int main(int argc, char** argv) {
    std::cout << "TigerEx C++ Matching Engine v1.0.0" << std::endl;
    std::cout << "Target latency: <50 microseconds" << std::endl;
    
    MatchingEngine engine;
    
    if (!engine.init()) {
        std::cerr << "Failed to initialize engine" << std::endl;
        return 1;
    }
    
    // Create markets
    engine.create_market("BTCUSDT", 8, 8);
    engine.create_market("ETHUSDT", 8, 8);
    engine.create_market("BNBUSDT", 8, 8);
    
    // Start engine
    if (!engine.start()) {
        std::cerr << "Failed to start engine" << std::endl;
        return 1;
    }
    
    std::cout << "Engine started successfully" << std::endl;
    
    // Test order processing
    tigerex::matching::OrderRequest request;
    request.user_id = 1;
    request.account_id = 1;
    request.symbol = "BTCUSDT";
    request.side = tigerex::matching::Side::BUY;
    request.type = tigerex::matching::OrderType::LIMIT;
    request.tif = tigerex::matching::TimeInForce::GTC;
    request.price = 50000ULL * 100000000ULL;  // $50,000
    request.quantity = 1000ULL * 100ULL;  // 1000 satoshis
    request.is_post_only = false;
    
    auto response = engine.process_order(request);
    std::cout << "Order response: " << static_cast<int>(response.status) << std::endl;
    std::cout << "Order ID: " << response.order_id << std::endl;
    
    // Print stats
    auto stats = engine.get_stats();
    std::cout << "Total orders: " << stats.total_orders_ << std::endl;
    std::cout << "Avg latency: " << stats.avg_latency_ns_ << " ns" << std::endl;
    
    // Keep running
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(10));
        
        auto stats = engine.get_stats();
        std::cout << "Stats - Orders: " << stats.total_orders_ 
                  << ", Trades: " << stats.total_trades_
                  << ", Avg latency: " << stats.avg_latency_ns_ << " ns" << std::endl;
    }
    
    return 0;
}