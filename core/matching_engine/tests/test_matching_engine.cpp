/**
 * TigerEx Matching Engine Tests
 * Comprehensive test suite for order matching
 */

#include "order_book.hpp"
#include "matching_engine.hpp"
#include <iostream>
#include <cassert>
#include <chrono>
#include <random>
#include <vector>
#include <algorithm>

using namespace tigerex::matching;

// Test order book basic operations
void test_order_book_basic() {
    std::cout << "Testing order book basic operations..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    // Add buy orders
    Order buy1;
    buy1.order_id = 1;
    buy1.side = Side::BUY;
    buy1.price = 50000 * 100000000ULL;
    buy1.quantity = 1 * 100000000ULL;
    buy1.remaining_quantity = buy1.quantity;
    book.add_order(buy1);
    
    Order buy2;
    buy2.order_id = 2;
    buy2.side = Side::BUY;
    buy2.price = 49900 * 100000000ULL;
    buy2.quantity = 2 * 100000000ULL;
    buy2.remaining_quantity = buy2.quantity;
    book.add_order(buy2);
    
    // Add sell orders
    Order sell1;
    sell1.order_id = 3;
    sell1.side = Side::SELL;
    sell1.price = 50100 * 100000000ULL;
    sell1.quantity = 1 * 100000000ULL;
    sell1.remaining_quantity = sell1.quantity;
    book.add_order(sell1);
    
    Order sell2;
    sell2.order_id = 4;
    sell2.side = Side::SELL;
    sell2.price = 50200 * 100000000ULL;
    sell2.quantity = 2 * 100000000ULL;
    sell2.remaining_quantity = sell2.quantity;
    book.add_order(sell2);
    
    // Test best bid/ask
    auto [bid, bid_q] = book.best_bid();
    auto [ask, ask_q] = book.best_ask();
    
    assert(bid == 50000 * 100000000ULL);
    assert(ask == 50100 * 100000000ULL);
    
    std::cout << "  Best bid: " << bid << ", Best ask: " << ask << std::endl;
    std::cout << "  Spread: " << book.spread() << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test order matching
void test_order_matching() {
    std::cout << "Testing order matching..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    // Add existing sell order
    Order sell1;
    sell1.order_id = 1;
    sell1.side = Side::SELL;
    sell1.price = 50000 * 100000000ULL;
    sell1.quantity = 1 * 100000000ULL;
    sell1.remaining_quantity = sell1.quantity;
    book.add_order(sell1);
    
    // Add matching buy order
    Order buy1;
    buy1.order_id = 2;
    buy1.side = Side::BUY;
    buy1.type = OrderType::LIMIT;
    buy1.price = 50000 * 100000000ULL;
    buy1.quantity = 1 * 100000000ULL;
    buy1.remaining_quantity = buy1.quantity;
    
    auto trades = book.match_orders(buy1);
    
    assert(trades.size() == 1);
    assert(trades[0].price == 50000 * 100000000ULL);
    assert(trades[0].quantity == 1 * 100000000ULL);
    
    std::cout << "  Trade executed: price=" << trades[0].price 
              << ", quantity=" << trades[0].quantity << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test market order matching
void test_market_order() {
    std::cout << "Testing market order matching..." << std::endl;
    
    OrderBook book("ETHUSDT", 8, 8);
    
    // Add multiple sell orders at different prices
    for (uint64_t price = 3000; price <= 3100; price += 10) {
        Order sell;
        sell.order_id = price;
        sell.side = Side::SELL;
        sell.price = price * 100000000ULL;
        sell.quantity = 1 * 100000000ULL;
        sell.remaining_quantity = sell.quantity;
        book.add_order(sell);
    }
    
    // Market buy order
    Order market_buy;
    market_buy.order_id = 10000;
    market_buy.side = Side::BUY;
    market_buy.type = OrderType::MARKET;
    market_buy.price = 3200 * 100000000ULL;  // Will buy at any price up to this
    market_buy.quantity = 5 * 100000000ULL;
    market_buy.remaining_quantity = market_buy.quantity;
    
    auto trades = book.match_orders(market_buy);
    
    assert(trades.size() > 0);
    
    uint64_t total_qty = 0;
    for (const auto& trade : trades) {
        total_qty += trade.quantity;
    }
    
    assert(total_qty == 5 * 100000000ULL);
    
    std::cout << "  Executed " << trades.size() << " trades, total quantity: " << total_qty << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test order cancellation
void test_order_cancellation() {
    std::cout << "Testing order cancellation..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    Order order;
    order.order_id = 1;
    order.side = Side::BUY;
    order.price = 50000 * 100000000ULL;
    order.quantity = 1 * 100000000ULL;
    order.remaining_quantity = order.quantity;
    book.add_order(order);
    
    bool cancelled = book.cancel_order(1, Side::BUY);
    assert(cancelled);
    
    auto order_opt = book.get_order(1, Side::BUY);
    assert(!order_opt.has_value());
    
    std::cout << "  PASSED" << std::endl;
}

// Test order modification
void test_order_modification() {
    std::cout << "Testing order modification..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    Order order;
    order.order_id = 1;
    order.side = Side::BUY;
    order.price = 50000 * 100000000ULL;
    order.quantity = 1 * 100000000ULL;
    order.remaining_quantity = order.quantity;
    book.add_order(order);
    
    bool modified = book.modify_order(1, Side::BUY, 51000 * 100000000ULL, 2 * 100000000ULL);
    assert(modified);
    
    auto order_opt = book.get_order(1, Side::BUY);
    assert(order_opt.has_value());
    assert(order_opt->price == 51000 * 100000000ULL);
    assert(order_opt->remaining_quantity == 2 * 100000000ULL);
    
    std::cout << "  PASSED" << std::endl;
}

// Test depth retrieval
void test_depth() {
    std::cout << "Testing depth retrieval..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    // Add orders at various price levels
    for (uint64_t price = 50000; price <= 50100; price += 10) {
        Order order;
        order.order_id = price;
        order.side = (price % 20 == 0) ? Side::SELL : Side::BUY;
        order.price = price * 100000000ULL;
        order.quantity = 1 * 100000000ULL;
        order.remaining_quantity = order.quantity;
        book.add_order(order);
    }
    
    auto depth = book.get_depth(10);
    
    assert(depth.bids.size() > 0);
    assert(depth.asks.size() > 0);
    
    std::cout << "  Bids: " << depth.bids.size() << ", Asks: " << depth.asks.size() << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test order types
void test_order_types() {
    std::cout << "Testing order types..." << std::endl;
    
    // Test LIMIT
    Order limit_order;
    limit_order.type = OrderType::LIMIT;
    assert(limit_order.type == OrderType::LIMIT);
    
    // Test MARKET
    Order market_order;
    market_order.type = OrderType::MARKET;
    assert(market_order.type == OrderType::MARKET);
    
    // Test STOP_LOSS
    Order stop_order;
    stop_order.type = OrderType::STOP_LOSS;
    assert(stop_order.type == OrderType::STOP_LOSS);
    
    // Test ICEBERG
    Order iceberg_order;
    iceberg_order.type = OrderType::ICEBERG;
    assert(iceberg_order.type == OrderType::ICEBERG);
    
    // Test OCO
    Order oco_order;
    oco_order.type = OrderType::OCO;
    assert(oco_order.type == OrderType::OCO);
    
    // Test TRAILING_STOP
    Order trailing_order;
    trailing_order.type = OrderType::TRAILING_STOP;
    assert(trailing_order.type == OrderType::TRAILING_STOP);
    
    std::cout << "  PASSED" << std::endl;
}

// Test time in force
void test_time_in_force() {
    std::cout << "Testing time in force..." << std::endl;
    
    Order gtc_order;
    gtc_order.tif = TimeInForce::GTC;
    assert(gtc_order.tif == TimeInForce::GTC);
    
    Order ioc_order;
    ioc_order.tif = TimeInForce::IOC;
    assert(ioc_order.tif == TimeInForce::IOC);
    
    Order fok_order;
    fok_order.tif = TimeInForce::FOK;
    assert(fok_order.tif == TimeInForce::FOK);
    
    Order gtx_order;
    gtx_order.tif = TimeInForce::GTX;
    assert(gtx_order.tif == TimeInForce::GTX);
    
    std::cout << "  PASSED" << std::endl;
}

// Test market data manager
void test_market_data_manager() {
    std::cout << "Testing market data manager..." << std::endl;
    
    MarketDataManager mgr;
    
    // Create order book
    auto* book = mgr.get_or_create_order_book("BTCUSDT", 8, 8);
    assert(book != nullptr);
    
    // Get ticker (should be empty initially)
    auto ticker = mgr.get_ticker("BTCUSDT");
    assert(!ticker.has_value());
    
    // Add kline
    Kline kline;
    kline.symbol = "BTCUSDT";
    kline.open_time = 1000000;
    kline.close_time = 1000060;
    kline.open = 50000 * 100000000ULL;
    kline.high = 50100 * 100000000ULL;
    kline.low = 49900 * 100000000ULL;
    kline.close = 50000 * 100000000ULL;
    kline.volume = 1000 * 100000000ULL;
    kline.quote_volume = 50000 * 100000000ULL;
    kline.trades_count = 100;
    kline.is_closed = true;
    
    mgr.add_kline("BTCUSDT", kline);
    
    auto klines = mgr.get_klines("BTCUSDT", 10);
    assert(klines.size() == 1);
    
    std::cout << "  PASSED" << std::endl;
}

// Test balance manager
void test_balance_manager() {
    std::cout << "Testing balance manager..." << std::endl;
    
    BalanceManager mgr;
    
    // Initialize balance
    mgr.init_balance(1, "USDT", 10000 * 100000000ULL, 0);
    
    // Get balance
    auto balance = mgr.get_balance(1, "USDT");
    assert(balance.total == 10000 * 100000000ULL);
    
    // Lock balance
    bool locked = mgr.lock_balance(1, "USDT", 1000 * 100000000ULL);
    assert(locked);
    
    balance = mgr.get_balance(1, "USDT");
    assert(balance.free == 9000 * 100000000ULL);
    assert(balance.locked == 1000 * 100000000ULL);
    
    // Deduct balance
    bool deducted = mgr.deduct_balance(1, "USDT", 500 * 100000000ULL);
    assert(deducted);
    
    // Unlock remaining
    mgr.unlock_balance(1, "USDT", 500 * 100000000ULL);
    
    balance = mgr.get_balance(1, "USDT");
    std::cout << "  Final balance - Free: " << balance.free << ", Locked: " << balance.locked << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Test concurrent operations
void test_concurrent_operations() {
    std::cout << "Testing concurrent operations..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    const int NUM_THREADS = 4;
    const int ORDERS_PER_THREAD = 1000;
    
    auto start_time = std::chrono::high_resolution_clock::now();
    
    // Spawn threads
    std::vector<std::thread> threads;
    for (int t = 0; t < NUM_THREADS; ++t) {
        threads.emplace_back([&book, t, ORDERS_PER_THREAD]() {
            for (int i = 0; i < ORDERS_PER_THREAD; ++i) {
                Order order;
                order.order_id = t * ORDERS_PER_THREAD + i;
                order.side = (i % 2 == 0) ? Side::BUY : Side::SELL;
                order.price = (50000 + (i % 100)) * 100000000ULL;
                order.quantity = 1 * 100000000ULL;
                order.remaining_quantity = order.quantity;
                book.add_order(order);
            }
        });
    }
    
    for (auto& thread : threads) {
        thread.join();
    }
    
    auto end_time = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
    
    auto [bid, bid_q] = book.best_bid();
    auto [ask, ask_q] = book.best_ask();
    
    std::cout << "  Added " << (NUM_THREADS * ORDERS_PER_THREAD) << " orders in " 
             << duration.count() << " microseconds" << std::endl;
    std::cout << "  Best bid: " << bid << ", Best ask: " << ask << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}

// Performance benchmark
void benchmark_order_matching() {
    std::cout << "Running performance benchmark..." << std::endl;
    
    OrderBook book("BTCUSDT", 8, 8);
    
    // Add many orders
    const int NUM_ORDERS = 100000;
    
    auto start_time = std::chrono::high_resolution_clock::now();
    
    for (int i = 0; i < NUM_ORDERS; ++i) {
        Order order;
        order.order_id = i;
        order.side = (i % 2 == 0) ? Side::BUY : Side::SELL;
        order.price = (50000 + (i % 1000)) * 100000000ULL;
        order.quantity = 1 * 100000000ULL;
        order.remaining_quantity = order.quantity;
        book.add_order(order);
    }
    
    auto add_end_time = std::chrono::high_resolution_clock::now();
    auto add_duration = std::chrono::duration_cast<std::chrono::microseconds>(add_end_time - start_time);
    
    std::cout << "  Added " << NUM_ORDERS << " orders in " << add_duration.count() << " microseconds" << std::endl;
    std::cout << "  Throughput: " << (NUM_ORDERS * 1000000 / add_duration.count()) << " orders/sec" << std::endl;
    
    // Benchmark matching
    Order market_buy;
    market_buy.order_id = NUM_ORDERS + 1;
    market_buy.side = Side::BUY;
    market_buy.type = OrderType::MARKET;
    market_buy.price = 100000 * 100000000ULL;
    market_buy.quantity = 1000 * 100000000ULL;
    market_buy.remaining_quantity = market_buy.quantity;
    
    start_time = std::chrono::high_resolution_clock::now();
    auto trades = book.match_orders(market_buy);
    auto match_end_time = std::chrono::high_resolution_clock::now();
    auto match_duration = std::chrono::duration_cast<std::chrono::microseconds>(match_end_time - start_time);
    
    std::cout << "  Matched " << trades.size() << " trades in " << match_duration.count() << " microseconds" << std::endl;
    std::cout << "  Match latency: " << match_duration.count() << " μs" << std::endl;
    
    std::cout << "  PASSED" << std::endl;
}


// Test price-time priority: the earliest order at a price fills first.
void test_price_time_priority() {
    std::cout << "Testing price-time priority..." << std::endl;

    OrderBook book("BTCUSDT", 8, 8);

    // Three resting sells at the same price, in arrival order 10, 11, 12.
    for (uint64_t id : {10ULL, 11ULL, 12ULL}) {
        Order sell;
        sell.order_id = id;
        sell.side = Side::SELL;
        sell.price = 50000 * 100000000ULL;
        sell.quantity = 1 * 100000000ULL;
        sell.remaining_quantity = sell.quantity;
        book.add_order(sell);
    }

    Order buy;
    buy.order_id = 100;
    buy.side = Side::BUY;
    buy.type = OrderType::LIMIT;
    buy.price = 50000 * 100000000ULL;
    buy.quantity = 2 * 100000000ULL;
    buy.remaining_quantity = buy.quantity;

    auto trades = book.match_orders(buy);
    assert(trades.size() == 2);
    // The first arrival is consumed first.
    assert(trades[0].counter_order_id == 10);
    assert(trades[1].counter_order_id == 11);
    // The third order is untouched and still rests.
    assert(book.get_order(12, Side::SELL).has_value());

    std::cout << "  PASSED" << std::endl;
}

// Test price priority: a better price is always taken first.
void test_price_priority() {
    std::cout << "Testing price priority..." << std::endl;

    OrderBook book("BTCUSDT", 8, 8);

    // Inserted worst-first on purpose.
    for (uint64_t price : {50200ULL, 50100ULL, 50000ULL}) {
        Order sell;
        sell.order_id = price;
        sell.side = Side::SELL;
        sell.price = price * 100000000ULL;
        sell.quantity = 1 * 100000000ULL;
        sell.remaining_quantity = sell.quantity;
        book.add_order(sell);
    }

    // Best ask is the lowest price.
    assert(book.best_ask().first == 50000 * 100000000ULL);

    Order buy;
    buy.order_id = 1;
    buy.side = Side::BUY;
    buy.type = OrderType::LIMIT;
    buy.price = 50200 * 100000000ULL;
    buy.quantity = 3 * 100000000ULL;
    buy.remaining_quantity = buy.quantity;

    auto trades = book.match_orders(buy);
    assert(trades.size() == 3);
    // Cheapest seller first, most expensive last.
    assert(trades[0].price == 50000 * 100000000ULL);
    assert(trades[1].price == 50100 * 100000000ULL);
    assert(trades[2].price == 50200 * 100000000ULL);

    std::cout << "  PASSED" << std::endl;
}

// Test that a limit order never fills worse than its own price.
void test_limit_price_respected() {
    std::cout << "Testing limit price boundary..." << std::endl;

    OrderBook book("BTCUSDT", 8, 8);

    Order sell;
    sell.order_id = 1;
    sell.side = Side::SELL;
    sell.price = 50100 * 100000000ULL;
    sell.quantity = 1 * 100000000ULL;
    sell.remaining_quantity = sell.quantity;
    book.add_order(sell);

    Order buy;
    buy.order_id = 2;
    buy.side = Side::BUY;
    buy.type = OrderType::LIMIT;
    buy.price = 50000 * 100000000ULL;  // Below the ask.
    buy.quantity = 1 * 100000000ULL;
    buy.remaining_quantity = buy.quantity;

    auto trades = book.match_orders(buy);
    // The old match_limit_order was an empty body; nothing ever filled.
    assert(trades.empty());
    assert(buy.remaining_quantity == buy.quantity);

    std::cout << "  PASSED" << std::endl;
}

// Test partial fill accounting and the resulting average price.
void test_partial_fill_and_vwap() {
    std::cout << "Testing partial fill and average price..." << std::endl;

    OrderBook book("BTCUSDT", 8, 8);

    Order sell;
    sell.order_id = 1;
    sell.side = Side::SELL;
    sell.price = 50000 * 100000000ULL;
    sell.quantity = 1 * 100000000ULL;
    sell.remaining_quantity = sell.quantity;
    book.add_order(sell);

    Order buy;
    buy.order_id = 2;
    buy.side = Side::BUY;
    buy.type = OrderType::LIMIT;
    buy.price = 50000 * 100000000ULL;
    buy.quantity = 3 * 100000000ULL;
    buy.remaining_quantity = buy.quantity;

    auto trades = book.match_orders(buy);
    assert(trades.size() == 1);
    assert(buy.filled_quantity == 1 * 100000000ULL);
    assert(buy.remaining_quantity == 2 * 100000000ULL);
    assert(buy.avg_fill_price == 50000 * 100000000ULL);
    assert(buy.status == OrderStatus::PARTIALLY_FILLED);

    std::cout << "  PASSED" << std::endl;
}

// Test that the engine moves balances and emits trades when orders match.
void test_engine_settlement() {
    std::cout << "Testing engine settlement..." << std::endl;

    MatchingEngine engine;
    assert(engine.init());
    assert(engine.create_market("BTCUSDT", 8, 8));

    // The seller holds 1 BTC; the buyer holds 100,000 USDT.
    engine.set_balance(2, "BTC", 1 * 100000000ULL);
    engine.set_balance(1, "USDT", 100000 * 100000000ULL);

    std::vector<tigerex::matching::TradeNotification> received;
    engine.on_trade([&](const tigerex::matching::TradeNotification& n) {
        received.push_back(n);
    });

    // Resting sell from user 2.
    tigerex::matching::OrderRequest sell;
    sell.user_id = 2;
    sell.account_id = 2;
    sell.symbol = "BTCUSDT";
    sell.side = tigerex::matching::Side::SELL;
    sell.type = tigerex::matching::OrderType::LIMIT;
    sell.tif = tigerex::matching::TimeInForce::GTC;
    sell.price = 50000 * 100000000ULL;
    sell.quantity = 1 * 100000000ULL;
    auto sell_response = engine.process_order(sell);
    assert(sell_response.status == tigerex::matching::OrderStatus::NEW);

    // Aggressive buy from user 1 crosses it.
    tigerex::matching::OrderRequest buy = sell;
    buy.user_id = 1;
    buy.account_id = 1;
    buy.side = tigerex::matching::Side::BUY;
    auto buy_response = engine.process_order(buy);
    assert(buy_response.status == tigerex::matching::OrderStatus::FILLED);

    // The old engine moved no balances and published no trade.
    assert(received.size() == 1);
    assert(received[0].price == 50000 * 100000000ULL);

    // The buyer paid 50,000 USDT and now holds 1 BTC.
    auto buyer_btc = engine.get_balance(1, "BTC");
    auto buyer_usdt = engine.get_balance(1, "USDT");
    assert(buyer_btc.free == 1 * 100000000ULL);
    assert(buyer_usdt.free == 50000 * 100000000ULL);

    // The seller received 50,000 USDT and delivered its BTC.
    auto seller_usdt = engine.get_balance(2, "USDT");
    auto seller_btc = engine.get_balance(2, "BTC");
    assert(seller_usdt.free == 50000 * 100000000ULL);
    assert(seller_btc.free == 0);

    std::cout << "  PASSED" << std::endl;
}

// Test that symbol splitting picks the longest quote.
void test_symbol_split() {
    std::cout << "Testing symbol splitting..." << std::endl;

    auto a = MatchingEngine::split_symbol("BTCUSDT");
    assert(a.first == "BTC" && a.second == "USDT");

    auto b = MatchingEngine::split_symbol("ETHUSDC");
    assert(b.first == "ETH" && b.second == "USDC");

    auto c = MatchingEngine::split_symbol("SOLBTC");
    assert(c.first == "SOL" && c.second == "BTC");

    std::cout << "  PASSED" << std::endl;
}

int main() {
    std::cout << "TigerEx Matching Engine Test Suite" << std::endl;
    std::cout << "=======================================" << std::endl;
    
    try {
        test_order_book_basic();
        test_order_matching();
        test_market_order();
        test_order_cancellation();
        test_order_modification();
        test_depth();
        test_order_types();
        test_time_in_force();
        test_market_data_manager();
        test_balance_manager();
        test_concurrent_operations();
        test_price_time_priority();
        test_price_priority();
        test_limit_price_respected();
        test_partial_fill_and_vwap();
        test_engine_settlement();
        test_symbol_split();
        benchmark_order_matching();
        
        std::cout << "=======================================" << std::endl;
        std::cout << "All tests PASSED!" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Test FAILED: " << e.what() << std::endl;
        return 1;
    }
    
    return 0;
}