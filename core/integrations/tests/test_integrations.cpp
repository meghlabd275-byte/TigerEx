/**
 * TigerEx Integration Test Suite
 * Tests for Tigerswap, TigerWallet, TigerSmartChain integration
 */

#include "tigerex_integrations.hpp"
#include <iostream>
#include <cassert>
#include <chrono>

using namespace tigerex::integrations;

void test_tiger_smart_chain() {
    std::cout << "Testing TigerSmartChain..." << std::endl;
    
    TigerSmartChain chain;
    
    // Test get chains
    auto chains = chain.get_all_chains();
    std::cout << "  Supported chains: " << chains.size() << std::endl;
    assert(chains.size() > 0);
    
    // Test get tokens
    auto tokens = chain.get_all_tokens();
    std::cout << "  Registered tokens: " << tokens.size() << std::endl;
    assert(tokens.size() >= 2);  // TGR and RUSD
    
    // Test TGR token
    auto tgr = chain.get_token_by_symbol("TGR");
    assert(tgr.has_value());
    std::cout << "  TGR token: " << tgr->symbol << " (" << tgr->name << ")" << std::endl;
    
    // Test RUSD token
    auto rusd = chain.get_token_by_symbol("RUSD");
    assert(rusd.has_value());
    std::cout << "  RUSD token: " << rusd->symbol << " (" << rusd->name << ")" << std::endl;
    assert(rusd->price_usd == 1.0);  // Stablecoin
    
    // Test bridge fee
    double bridge_fee = chain.estimate_bridge_fee(1000, "ethereum", "tiger_mainnet");
    std::cout << "  Bridge fee (1000 USD): $" << bridge_fee << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

void test_tigerswap_dex() {
    std::cout << "Testing Tigerswap DEX..." << std::endl;
    
    TigerswapDEX dex;
    
    // Test get quote
    auto quote = dex.get_quote("0xTGR", "0xUSDT", 1000 * 1e18);
    std::cout << "  Quote: " << quote.amount_out << " USDT for 1000 TGR" << std::endl;
    std::cout << "  Price impact: " << (quote.price_impact * 100) << "%" << std::endl;
    
    // Test pools
    auto pools = dex.get_all_pools();
    std::cout << "  Liquidity pools: " << pools.size() << std::endl;
    assert(pools.size() > 0);
    
    // Test farms
    auto farms = dex.get_farms();
    std::cout << "  Active farms: " << farms.size() << std::endl;
    
    // Test add liquidity
    bool added = dex.add_liquidity("0xTGR", "0xETH", 1000 * 1e18, 1 * 1e18);
    std::cout << "  Add liquidity: " << (added ? "success" : "failed") << std::endl;
    
    // Test fee collection
    uint64_t fees = dex.get_total_fees();
    std::cout << "  Total fees collected: " << fees << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

void test_tiger_wallet() {
    std::cout << "Testing TigerWallet..." << std::endl;
    
    TigerWallet wallet;
    
    // Test create wallet
    std::string wallet_addr = wallet.create_wallet("Test Wallet");
    std::cout << "  Created wallet: " << wallet_addr << std::endl;
    assert(!wallet_addr.empty());
    
    // Test get wallet
    auto wallet_opt = wallet.get_wallet(wallet_addr);
    assert(wallet_opt.has_value());
    std::cout << "  Wallet name: " << wallet_opt->name << std::endl;
    
    // Test sign message
    std::string signature = wallet.sign_message(wallet_addr, "Hello TigerEx");
    std::cout << "  Signed message: " << signature << std::endl;
    assert(!signature.empty());
    
    // Test supported chains
    auto chains = wallet.get_supported_chains();
    std::cout << "  Supported chains: " << chains.size() << std::endl;
    assert(chains.size() >= 7);
    
    std::cout << "  PASSED" << std::endl;
}

void test_integration() {
    std::cout << "Testing TigerEx Integration..." << std::endl;
    
    TigerExIntegration integration;
    
    // Test SmartChain
    auto chains = integration.get_supported_chains();
    std::cout << "  Integration chains: " << chains.size() << std::endl;
    
    // Test DEX
    auto quote = integration.get_swap_quote("0xTGR", "0xRUSD", 100 * 1e18);
    std::cout << "  DEX quote: " << quote.amount_out << " RUSD for 100 TGR" << std::endl;
    
    // Test Wallet
    std::string addr = integration.create_wallet("Integration Test");
    std::cout << "  Created wallet: " << addr << std::endl;
    
    // Test fee collection
    uint64_t total_fees = integration.collect_all_fees();
    std::cout << "  Total fees collected: " << total_fees << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

void test_cross_product() {
    std::cout << "Testing Cross-Product Integration..." << std::endl;
    
    TigerExIntegration integration;
    
    // Test best route (swap + bridge)
    auto route = integration.get_best_route("0xETH", "0xTGR", 1 * 1e18, "ethereum", "tiger_mainnet");
    std::cout << "  Best route from ETH to TGR:" << std::endl;
    std::cout << "    Output: " << route.total_output << std::endl;
    std::cout << "    Fee: " << route.total_fee << std::endl;
    std::cout << "    Steps: " << route.steps.size() << std::endl;
    
    // Test DEX pools
    auto pools = integration.get_liquidity_pools("0xTGR");
    std::cout << "  TGR pools: " << pools.size() << std::endl;
    
    // Test farms
    auto farms = integration.get_farms();
    std::cout << "  Active farms: " << farms.size() << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

void test_fee_collection() {
    std::cout << "Testing Fee Collection..." << std::endl;
    
    TigerExIntegration integration;
    
    // Add fees
    integration.add_exchange_fee(1000 * 1e6);
    integration.add_bridge_fee(500 * 1e6);
    integration.add_wallet_fee(100 * 1e6);
    
    // Check fees
    uint64_t exchange_fees = integration.get_exchange_fees();
    uint64_t bridge_fees = integration.get_bridge_fees();
    uint64_t wallet_fees = integration.get_wallet_fees();
    uint64_t dex_fees = integration.get_dex_fees();
    uint64_t total = integration.collect_all_fees();
    
    std::cout << "  Exchange fees: " << exchange_fees << std::endl;
    std::cout << "  Bridge fees: " << bridge_fees << std::endl;
    std::cout << "  Wallet fees: " << wallet_fees << std::endl;
    std::cout << "  DEX fees: " << dex_fees << std::endl;
    std::cout << "  Total: " << total << std::endl;
    
    assert(total == 1600 * 1e6);
    
    std::cout << "  PASSED" << std::endl;
}

void benchmark_swap() {
    std::cout << "Running Swap Benchmark..." << std::endl;
    
    TigerExIntegration integration;
    
    const int iterations = 10000;
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (int i = 0; i < iterations; ++i) {
        integration.get_swap_quote("0xTGR", "0xUSDT", 1000 * 1e18);
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    
    std::cout << "  " << iterations << " swaps in " << duration.count() << " μs" << std::endl;
    std::cout << "  Throughput: " << (iterations * 1000000 / duration.count()) << " swaps/sec" << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

int main() {
    std::cout << "TigerEx Integration Test Suite" << std::endl;
    std::cout << "================================" << std::endl;
    
    try {
        test_tiger_smart_chain();
        test_tigerswap_dex();
        test_tiger_wallet();
        test_integration();
        test_cross_product();
        test_fee_collection();
        benchmark_swap();
        
        std::cout << "================================" << std::endl;
        std::cout << "All tests PASSED!" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Test FAILED: " << e.what() << std::endl;
        return 1;
    }
    
    return 0;
}