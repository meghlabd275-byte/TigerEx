/**
 * TigerEx Matching Engine - standalone daemon.
 *
 * This is the process entry point for the engine. The engine itself lives in
 * matching_engine.cpp, which is also linked into the test and benchmark
 * binaries, so it must not define main().
 */

#include "matching_engine.hpp"
#include <chrono>
#include <iostream>
#include <thread>

using namespace tigerex::matching;

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