/**
 * TigerEx C++ Matching Engine Implementation
 */

#include "matching_engine.hpp"
#include <iostream>
#include <cassert>

namespace tigerex {

// Unit tests (should be in separate file)
void run_tests() {
    std::cout << "Running Matching Engine tests...\n";
    
    // Create engine
    auto engine = EngineFactory::create("BTCUSDT", AssetClass::SPOT);
    
    // Test basic buy order
    auto result = engine->new_order(
        1, 1001, 10001,
        Side::BUY, 50000, 1000,
        OrderType::LIMIT, TimeInForce::GTC
    );
    
    assert(result.error_msg.empty());
    
    // Test sell order that crosses
    result = engine->new_order(
        2, 1002, 10001,
        Side::SELL, 50000, 500,
        OrderType::LIMIT, TimeInForce::GTC
    );
    
    assert(!result.trades.empty());
    assert(result.fully_filled);
    
    // Test market order
    result = engine->new_order(
        3, 1003, 10001,
        Side::BUY, 0, 100,
        OrderType::MARKET, TimeInForce::IOC
    );
    
    // Test cancel
    auto cancel = engine->cancel_order(1);
    assert(cancel.success);
    
    std::cout << "All tests passed!\n";
}

} // namespace tigerex

#ifdef RUN_TESTS
int main() {
    tigerex::run_tests();
    return 0;
}
#endif