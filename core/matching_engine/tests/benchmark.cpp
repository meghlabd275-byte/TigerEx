/**
 * TigerEx Matching Engine Benchmark
 * Performance testing and profiling
 */

#include "order_book.hpp"
#include <iostream>
#include <chrono>
#include <random>
#include <vector>
#include <algorithm>
#include <thread>
#include <atomic>
#include <iomanip>

using namespace tigerex::matching;

// Benchmark configuration
struct BenchmarkConfig {
    uint32_t num_orders = 1000000;
    uint32_t num_iterations = 100;
    uint32_t num_threads = std::thread::hardware_concurrency();
    bool verbose = false;
};

// Results structure
struct BenchmarkResults {
    double avg_latency_us;
    double p50_latency_us;
    double p95_latency_us;
    double p99_latency_us;
    double max_latency_us;
    double min_latency_us;
    double throughput_ops;
    uint64_t total_operations;
    double duration_ms;
};

// Generate random orders
std::vector<Order> generate_random_orders(uint32_t count, uint64_t base_price = 50000 * 100000000ULL) {
    std::vector<Order> orders;
    orders.reserve(count);
    
    std::mt19937_64 rng(42);
    std::uniform_int_distribution<uint64_t> price_dist(base_price - 1000 * 100000000ULL, base_price + 1000 * 100000000ULL);
    std::uniform_int_distribution<uint64_t> qty_dist(1 * 10000000ULL, 100 * 100000000ULL);
    std::uniform_int_distribution<uint32_t> side_dist(0, 1);
    
    for (uint32_t i = 0; i < count; ++i) {
        Order order;
        order.order_id = i;
        order.side = side_dist(rng) == 0 ? Side::BUY : Side::SELL;
        order.price = price_dist(rng);
        order.quantity = qty_dist(rng);
        order.remaining_quantity = order.quantity;
        
        orders.push_back(order);
    }
    
    return orders;
}

// Benchmark order book add operations
BenchmarkResults benchmark_add_orders(OrderBook& book, const std::vector<Order>& orders, bool verbose = false) {
    BenchmarkResults results;
    std::vector<double> latencies;
    latencies.reserve(orders.size());
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (const auto& order : orders) {
        auto order_start = std::chrono::high_resolution_clock::now();
        book.add_order(const_cast<Order&>(order));
        auto order_end = std::chrono::high_resolution_clock::now();
        
        double latency = std::chrono::duration<double, std::micro>(order_end - order_start).count();
        latencies.push_back(latency);
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    results.duration_ms = std::chrono::duration<double, std::milli>(end - start).count();
    results.total_operations = orders.size();
    
    // Calculate statistics
    std::sort(latencies.begin(), latencies.end());
    
    results.min_latency_us = latencies.front();
    results.max_latency_us = latencies.back();
    results.avg_latency_us = std::accumulate(latencies.begin(), latencies.end(), 0.0) / latencies.size();
    results.p50_latency_us = latencies[latencies.size() * 0.50];
    results.p95_latency_us = latencies[latencies.size() * 0.95];
    results.p99_latency_us = latencies[latencies.size() * 0.99];
    results.throughput_ops = results.total_operations / (results.duration_ms / 1000.0);
    
    if (verbose) {
        std::cout << "Add Orders Benchmark:" << std::endl;
        std::cout << "  Total operations: " << results.total_operations << std::endl;
        std::cout << "  Duration: " << std::fixed << std::setprecision(2) << results.duration_ms << " ms" << std::endl;
        std::cout << "  Throughput: " << std::fixed << std::setprecision(0) << results.throughput_ops << " ops/sec" << std::endl;
        std::cout << "  Latency (avg): " << std::fixed << std::setprecision(2) << results.avg_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p50): " << std::fixed << std::setprecision(2) << results.p50_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p95): " << std::fixed << std::setprecision(2) << results.p95_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p99): " << std::fixed << std::setprecision(2) << results.p99_latency_us << " μs" << std::endl;
        std::cout << "  Latency (max): " << std::fixed << std::setprecision(2) << results.max_latency_us << " μs" << std::endl;
    }
    
    return results;
}

// Benchmark order matching
BenchmarkResults benchmark_matching(OrderBook& book, const std::vector<Order>& orders, bool verbose = false) {
    BenchmarkResults results;
    std::vector<double> latencies;
    std::vector<Trade> all_trades;
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (const auto& order : orders) {
        Order mutable_order = order;
        mutable_order.type = OrderType::MARKET;
        mutable_order.remaining_quantity = mutable_order.quantity;
        
        auto order_start = std::chrono::high_resolution_clock::now();
        auto trades = book.match_orders(mutable_order);
        auto order_end = std::chrono::high_resolution_clock::now();
        
        double latency = std::chrono::duration<double, std::micro>(order_end - order_start).count();
        latencies.push_back(latency);
        
        for (const auto& trade : trades) {
            all_trades.push_back(trade);
        }
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    results.duration_ms = std::chrono::duration<double, std::milli>(end - start).count();
    results.total_operations = orders.size();
    
    // Calculate statistics
    std::sort(latencies.begin(), latencies.end());
    
    results.min_latency_us = latencies.front();
    results.max_latency_us = latencies.back();
    results.avg_latency_us = std::accumulate(latencies.begin(), latencies.end(), 0.0) / latencies.size();
    results.p50_latency_us = latencies[latencies.size() * 0.50];
    results.p95_latency_us = latencies[latencies.size() * 0.95];
    results.p99_latency_us = latencies[latencies.size() * 0.99];
    results.throughput_ops = results.total_operations / (results.duration_ms / 1000.0);
    
    if (verbose) {
        std::cout << "Order Matching Benchmark:" << std::endl;
        std::cout << "  Total operations: " << results.total_operations << std::endl;
        std::cout << "  Total trades: " << all_trades.size() << std::endl;
        std::cout << "  Duration: " << std::fixed << std::setprecision(2) << results.duration_ms << " ms" << std::endl;
        std::cout << "  Throughput: " << std::fixed << std::setprecision(0) << results.throughput_ops << " ops/sec" << std::endl;
        std::cout << "  Latency (avg): " << std::fixed << std::setprecision(2) << results.avg_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p50): " << std::fixed << std::setprecision(2) << results.p50_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p95): " << std::fixed << std::setprecision(2) << results.p95_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p99): " << std::fixed << std::setprecision(2) << results.p99_latency_us << " μs" << std::endl;
    }
    
    return results;
}

// Benchmark concurrent operations
BenchmarkResults benchmark_concurrent(OrderBook& book, uint32_t num_threads, uint32_t orders_per_thread, bool verbose = false) {
    BenchmarkResults results;
    std::atomic<uint64_t> total_ops{0};
    
    auto start = std::chrono::high_resolution_clock::now();
    
    std::vector<std::thread> threads;
    for (uint32_t t = 0; t < num_threads; ++t) {
        threads.emplace_back([&book, t, orders_per_thread, &total_ops]() {
            std::mt19937_64 rng(t);
            std::uniform_int_distribution<uint64_t> price_dist(50000 * 100000000ULL - 1000 * 100000000ULL, 50000 * 100000000ULL + 1000 * 100000000ULL);
            std::uniform_int_distribution<uint64_t> qty_dist(1 * 10000000ULL, 100 * 100000000ULL);
            std::uniform_int_distribution<uint32_t> side_dist(0, 1);
            
            for (uint32_t i = 0; i < orders_per_thread; ++i) {
                Order order;
                order.order_id = t * orders_per_thread + i;
                order.side = side_dist(rng) == 0 ? Side::BUY : Side::SELL;
                order.price = price_dist(rng);
                order.quantity = qty_dist(rng);
                order.remaining_quantity = order.quantity;
                book.add_order(order);
            }
            
            total_ops.fetch_add(orders_per_thread);
        });
    }
    
    for (auto& thread : threads) {
        thread.join();
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    results.duration_ms = std::chrono::duration<double, std::milli>(end - start).count();
    results.total_operations = total_ops.load();
    results.throughput_ops = results.total_operations / (results.duration_ms / 1000.0);
    
    if (verbose) {
        std::cout << "Concurrent Operations Benchmark:" << std::endl;
        std::cout << "  Threads: " << num_threads << std::endl;
        std::cout << "  Total operations: " << results.total_operations << std::endl;
        std::cout << "  Duration: " << std::fixed << std::setprecision(2) << results.duration_ms << " ms" << std::endl;
        std::cout << "  Throughput: " << std::fixed << std::setprecision(0) << results.throughput_ops << " ops/sec" << std::endl;
    }
    
    return results;
}

// Benchmark order book depth retrieval
BenchmarkResults benchmark_depth(OrderBook& book, uint32_t num_requests, uint32_t depth_limit = 100, bool verbose = false) {
    BenchmarkResults results;
    std::vector<double> latencies;
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (uint32_t i = 0; i < num_requests; ++i) {
        auto req_start = std::chrono::high_resolution_clock::now();
        auto depth = book.get_depth(depth_limit);
        auto req_end = std::chrono::high_resolution_clock::now();
        
        double latency = std::chrono::duration<double, std::micro>(req_end - req_start).count();
        latencies.push_back(latency);
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    results.duration_ms = std::chrono::duration<double, std::milli>(end - start).count();
    results.total_operations = num_requests;
    
    // Calculate statistics
    std::sort(latencies.begin(), latencies.end());
    
    results.min_latency_us = latencies.front();
    results.max_latency_us = latencies.back();
    results.avg_latency_us = std::accumulate(latencies.begin(), latencies.end(), 0.0) / latencies.size();
    results.p50_latency_us = latencies[latencies.size() * 0.50];
    results.p95_latency_us = latencies[latencies.size() * 0.95];
    results.p99_latency_us = latencies[latencies.size() * 0.99];
    results.throughput_ops = results.total_operations / (results.duration_ms / 1000.0);
    
    if (verbose) {
        std::cout << "Depth Retrieval Benchmark:" << std::endl;
        std::cout << "  Total operations: " << results.total_operations << std::endl;
        std::cout << "  Duration: " << std::fixed << std::setprecision(2) << results.duration_ms << " ms" << std::endl;
        std::cout << "  Throughput: " << std::fixed << std::setprecision(0) << results.throughput_ops << " ops/sec" << std::endl;
        std::cout << "  Latency (avg): " << std::fixed << std::setprecision(2) << results.avg_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p50): " << std::fixed << std::setprecision(2) << results.p50_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p95): " << std::fixed << std::setprecision(2) << results.p95_latency_us << " μs" << std::endl;
        std::cout << "  Latency (p99): " << std::fixed << std::setprecision(2) << results.p99_latency_us << " μs" << std::endl;
    }
    
    return results;
}

// Run all benchmarks
void run_benchmarks(const BenchmarkConfig& config) {
    std::cout << "TigerEx Matching Engine Benchmark Suite" << std::endl;
    std::cout << "=================================" << std::endl;
    std::cout << "Configuration:" << std::endl;
    std::cout << "  Orders: " << config.num_orders << std::endl;
    std::cout << "  Threads: " << config.num_threads << std::endl;
    std::cout << "=================================" << std::endl << std::endl;
    
    // Generate test orders
    std::cout << "Generating test orders..." << std::endl;
    auto orders = generate_random_orders(config.num_orders);
    std::cout << "Generated " << orders.size() << " orders" << std::endl << std::endl;
    
    // Test 1: Add orders
    std::cout << "Test 1: Add Orders" << std::endl;
    {
        OrderBook book("BTCUSDT", 8, 8);
        benchmark_add_orders(book, orders, config.verbose);
    }
    std::cout << std::endl;
    
    // Test 2: Order matching
    std::cout << "Test 2: Order Matching" << std::endl;
    {
        OrderBook book("BTCUSDT", 8, 8);
        // Add counter orders first
        for (size_t i = 0; i < orders.size() / 2; ++i) {
            orders[i].side = Side::SELL;
            book.add_order(orders[i]);
        }
        benchmark_matching(book, orders, config.verbose);
    }
    std::cout << std::endl;
    
    // Test 3: Concurrent operations
    std::cout << "Test 3: Concurrent Operations" << std::endl;
    {
        OrderBook book("BTCUSDT", 8, 8);
        benchmark_concurrent(book, config.num_threads, config.num_orders / config.num_threads, config.verbose);
    }
    std::cout << std::endl;
    
    // Test 4: Depth retrieval
    std::cout << "Test 4: Depth Retrieval" << std::endl;
    {
        OrderBook book("BTCUSDT", 8, 8);
        // Populate with orders
        for (size_t i = 0; i < orders.size(); ++i) {
            book.add_order(orders[i]);
        }
        benchmark_depth(book, config.num_iterations, 100, config.verbose);
    }
    std::cout << std::endl;
    
    // Summary
    std::cout << "=================================" << std::endl;
    std::cout << "Benchmark Complete" << std::endl;
    std::cout << "=================================" << std::endl;
}

int main(int argc, char** argv) {
    BenchmarkConfig config;
    
    // Parse command line arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        
        if (arg == "--orders" && i + 1 < argc) {
            config.num_orders = std::stoul(argv[++i]);
        } else if (arg == "--threads" && i + 1 < argc) {
            config.num_threads = std::stoul(argv[++i]);
        } else if (arg == "--verbose") {
            config.verbose = true;
        } else if (arg == "--help") {
            std::cout << "Usage: " << argv[0] << " [options]" << std::endl;
            std::cout << "Options:" << std::endl;
            std::cout << "  --orders N     Number of orders (default: " << config.num_orders << ")" << std::endl;
            std::cout << "  --threads N   Number of threads (default: " << config.num_threads << ")" << std::endl;
            std::cout << "  --verbose     Verbose output" << std::endl;
            std::cout << "  --help        Show this help" << std::endl;
            return 0;
        }
    }
    
    run_benchmarks(config);
    
    return 0;
}