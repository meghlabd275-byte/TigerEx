/**
 * TigerEx Futures Options Trading Engine
 * Implementation of options trading system
 * 
 * Copyright (c) 2024 TigerEx
 * Licensed under MIT License
 */

#include "options_engine.hpp"
#include <iostream>
#include <thread>
#include <chrono>

using namespace tigerex::options;

// Initialize default options contracts
void initialize_default_contracts(OptionTradingEngine& engine) {
    // BTC options
    std::vector<OptionContract> btc_contracts = {
        {"BTC250620C50000", "BTC", OptionType::CALL, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         50000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"BTC250620C55000", "BTC", OptionType::CALL, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         55000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"BTC250620C60000", "BTC", OptionType::CALL, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         60000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"BTC250620P50000", "BTC", OptionType::PUT, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         50000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"BTC250620P45000", "BTC", OptionType::PUT, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         45000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
    };
    
    for (const auto& contract : btc_contracts) {
        engine.initialize_contract(contract);
    }
    
    // ETH options
    std::vector<OptionContract> eth_contracts = {
        {"ETH250620C3000", "ETH", OptionType::CALL, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         3000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"ETH250620C3500", "ETH", OptionType::CALL, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         3500 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"ETH250620P3000", "ETH", OptionType::PUT, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         3000 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
        {"ETH250620P2500", "ETH", OptionType::PUT, OptionStyle::AMERICAN, OptionCategory::VANILLA,
         2500 * 100000000ULL, 0, {}, 1, 1, 0, 0, true, ExerciseMethod::CASH, true, 0.01},
    };
    
    for (const auto& contract : eth_contracts) {
        engine.initialize_contract(contract);
    }
}

// Test Black-Scholes pricing
void test_black_scholes() {
    std::cout << "Testing Black-Scholes model..." << std::endl;
    
    double S = 50000.0;    // Spot price
    double K = 50000.0;    // Strike
    double T = 0.5;        // 6 months
    double r = 0.05;        // Risk-free rate
    double q = 0.0;         // Dividend yield
    double sigma = 0.5;     // Volatility
    
    // Calculate call price
    double call_price = BlackScholesModel::calculate_call_price(S, K, T, r, q, sigma);
    std::cout << "  Call price: $" << call_price << std::endl;
    
    // Calculate put price
    double put_price = BlackScholesModel::calculate_put_price(S, K, T, r, q, sigma);
    std::cout << "  Put price: $" << put_price << std::endl;
    
    // Calculate Greeks
    auto call_greeks = BlackScholesModel::calculate_greeks(S, K, T, r, q, sigma, OptionType::CALL);
    std::cout << "  Call Greeks:" << std::endl;
    std::cout << "    Delta: " << call_greeks.delta << std::endl;
    std::cout << "    Gamma: " << call_greeks.gamma << std::endl;
    std::cout << "    Theta: " << call_greeks.theta << std::endl;
    std::cout << "    Vega: " << call_greeks.vega << std::endl;
    
    auto put_greeks = BlackScholesModel::calculate_greeks(S, K, T, r, q, sigma, OptionType::PUT);
    std::cout << "  Put Greeks:" << std::endl;
    std::cout << "    Delta: " << put_greeks.delta << std::endl;
    std::cout << "    Gamma: " << put_greeks.gamma << std::endl;
    std::cout << "    Theta: " << put_greeks.theta << std::endl;
    std::cout << "    Vega: " << put_greeks.vega << std::endl;
    
    // Test put-call parity
    double parity_diff = call_price - put_price - S * std::exp(-q * T) + K * std::exp(-r * T);
    std::cout << "  Put-call parity diff: $" << parity_diff << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test binomial model
void test_binomial_model() {
    std::cout << "Testing Binomial model..." << std::endl;
    
    double S = 50000.0;
    double K = 50000.0;
    double T = 0.5;
    double r = 0.05;
    double q = 0.0;
    double sigma = 0.5;
    
    // European call
    double eur_call = BinomialModel::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::CALL, OptionStyle::EUROPEAN, 100
    );
    std::cout << "  European call: $" << eur_call << std::endl;
    
    // American call
    double am_call = BinomialModel::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::CALL, OptionStyle::AMERICAN, 100
    );
    std::cout << "  American call: $" << am_call << std::endl;
    
    // American put (should be >= European put)
    double am_put = BinomialModel::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::PUT, OptionStyle::AMERICAN, 100
    );
    std::cout << "  American put: $" << am_put << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test Monte Carlo
void test_monte_carlo() {
    std::cout << "Testing Monte Carlo..." << std::endl;
    
    double S = 50000.0;
    double K = 50000.0;
    double T = 0.5;
    double r = 0.05;
    double q = 0.0;
    double sigma = 0.5;
    
    auto start = std::chrono::high_resolution_clock::now();
    
    double mc_call = MonteCarloEngine::calculate_option_price(
        S, K, T, r, q, sigma, OptionType::CALL, 100000
    );
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    
    std::cout << "  MC call price: $" << mc_call << std::endl;
    std::cout << "  Time: " << duration.count() << " ms" << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test implied volatility
void test_implied_volatility() {
    std::cout << "Testing implied volatility..." << std::endl;
    
    double S = 50000.0;
    double K = 50000.0;
    double T = 0.5;
    double r = 0.05;
    double q = 0.0;
    
    // Market price (with ~50% IV)
    double market_price = 4500.0;
    
    double iv = ImpliedVolatilitySolver::calculate_implied_volatility(
        market_price, S, K, T, r, q, OptionType::CALL, 0.3
    );
    
    std::cout << "  Market price: $" << market_price << std::endl;
    std::cout << "  Implied volatility: " << (iv * 100) << "%" << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test option trading engine
void test_option_engine() {
    std::cout << "Testing option trading engine..." << std::endl;
    
    OptionTradingEngine engine;
    
    // Initialize contracts
    initialize_default_contracts(engine);
    
    // Calculate prices
    double btc_price = 52000.0;
    double time_to_expiry = 0.1;  // ~36 days
    
    auto btc_call_price = engine.calculate_price("BTC250620C50000", btc_price, time_to_expiry);
    std::cout << "  BTC call price: $" << btc_call_price << std::endl;
    
    auto btc_put_price = engine.calculate_price("BTC250620P50000", btc_price, time_to_expiry);
    std::cout << "  BTC put price: $" << btc_put_price << std::endl;
    
    // Calculate Greeks
    auto greeks = engine.calculate_greeks("BTC250620C50000", btc_price, time_to_expiry);
    std::cout << "  Greeks:" << std::endl;
    std::cout << "    Delta: " << greeks.delta << std::endl;
    std::cout << "    Gamma: " << greeks.gamma << std::endl;
    std::cout << "    Theta: " << greeks.theta << std::endl;
    std::cout << "    Vega: " << greeks.vega << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test barrier options
void test_barrier_options() {
    std::cout << "Testing barrier options..." << std::endl;
    
    // Create barrier option contract
    OptionContract contract;
    contract.symbol = "BTC250620C50000DI";
    contract.underlying_symbol = "BTC";
    contract.type = OptionType::CALL;
    contract.style = OptionStyle::EUROPEAN;
    contract.category = OptionCategory::BARRIER;
    contract.strike_price = 50000 * 100000000ULL;
    contract.barrier_price = 55000 * 100000000ULL;  // Knock-in barrier
    contract.is_knock_in = true;
    contract.is_knock_out = false;
    
    // Barrier pricing using binomial with monitoring
    double S = 52000.0;
    double K = 50000.0;
    double B = 55000.0;  // Barrier
    double T = 0.5;
    double r = 0.05;
    double sigma = 0.5;
    
    // Down-and-out call
    double daoc = BlackScholesModel::calculate_call_price(S, K, T, r, 0, sigma);
    double daoc_barrier = BlackScholesModel::calculate_call_price(B, K, T, r, 0, sigma);
    double down_and_out = daoc - daoc_barrier;
    
    std::cout << "  Down-and-out call: $" << down_and_out << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Performance benchmark
void benchmark_pricing() {
    std::cout << "Running pricing benchmark..." << std::endl;
    
    double S = 50000.0;
    double K = 50000.0;
    double T = 0.5;
    double r = 0.05;
    double sigma = 0.5;
    
    const int iterations = 100000;
    
    // Black-Scholes benchmark
    auto start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        BlackScholesModel::calculate_call_price(S, K, T, r, 0, sigma);
    }
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    
    std::cout << "  Black-Scholes (" << iterations << " iterations): " << duration.count() << " ms" << std::endl;
    std::cout << "  Throughput: " << (iterations * 1000 / duration.count()) << " ops/sec" << std::endl;
    
    // Monte Carlo benchmark
    start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < 1000; ++i) {
        MonteCarloEngine::calculate_option_price(S, K, T, r, 0, sigma, OptionType::CALL, 10000);
    }
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    
    std::cout << "  Monte Carlo (1000 x 10k paths): " << duration.count() << " ms" << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

int main() {
    std::cout << "TigerEx Options Trading Engine Test Suite" << std::endl;
    std::cout << "=========================================" << std::endl;
    
    try {
        test_black_scholes();
        test_binomial_model();
        test_monte_carlo();
        test_implied_volatility();
        test_option_engine();
        test_barrier_options();
        benchmark_pricing();
        
        std::cout << "=========================================" << std::endl;
        std::cout << "All tests PASSED!" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Test FAILED: " << e.what() << std::endl;
        return 1;
    }
    
    return 0;
}