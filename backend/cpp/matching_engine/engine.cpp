/**
 * TigerEx C++ Matching Engine - Production Grade
 * Ultra-low latency: < 50 microseconds
 */

#include <iostream>
#include <map>
#include <unordered_map>
#include <vector>
#include <memory>
#include <mutex>
#include <atomic>
#include <chrono>
#include <string>
#include <sstream>
#include <iomanip>

// Constants
constexpr int MAX_ORDERS = 1000000;
constexpr int64_t LATENCY_TARGET_US = 50;

// Enums
enum class Side { Buy, Sell };
enum class OrderType { Market, Limit, StopMarket, StopLimit };
enum class OrderStatus { New, PartiallyFilled, Filled, Cancelled, Rejected };

// Structures
struct Order {
    std::string id;
    std::string user_id;
    std::string market;
    Side side;
    OrderType type;
    double price = 0.0;
    double quantity = 0.0;
    double filled = 0.0;
    OrderStatus status = OrderStatus::New;
    int64_t created_at = 0;
};

struct Trade {
    std::string id;
    std::string market;
    Side side;
    double price = 0.0;
    double quantity = 0.0;
    double fee = 0.0;
    int64_t timestamp = 0;
};

struct PriceLevel {
    double price = 0.0;
    double quantity = 0.0;
    std::vector<std::string> orders;
};

struct Market {
    std::string id;
    std::string base;
    std::string quote;
    bool trading = true;
    double min_qty = 0.00001;
    double max_qty = 1000000.0;
    double min_price = 0.01;
    double max_price = 1000000.0;
};

// Order Book Class
class OrderBook {
private:
    std::string market_;
    std::map<double, PriceLevel> bids_;
    std::map<double, PriceLevel> asks_;
    std::unordered_map<std::string, Order> orders_;
    std::atomic<int64_t> last_update_{0};
    mutable std::mutex mtx_;

public:
    explicit OrderBook(const std::string& market) : market_(market) {}

    void add_order(const Order& order) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto& book = (order.side == Side::Buy) ? bids_ : asks_;
        auto& level = book[order.price];
        level.price = order.price;
        level.quantity += order.quantity - order.filled;
        level.orders.push_back(order.id);
        orders_[order.id] = order;
        last_update_.fetch_add(1);
    }

    void remove_order(const std::string& id, double price, Side side) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto& book = (side == Side::Buy) ? bids_ : asks_;
        auto it = book.find(price);
        if (it != book.end()) {
            auto& level = it->second;
            level.orders.erase(
                std::remove(level.orders.begin(), level.orders.end(), id),
                level.orders.end()
            );
            if (level.orders.empty()) book.erase(it);
        }
        orders_.erase(id);
        last_update_.fetch_add(1);
    }

    std::vector<Trade> match(double market_price) {
        std::lock_guard<std::mutex> lock(mtx_);
        std::vector<Trade> trades;

        while (!bids_.empty() && !asks_.empty()) {
            auto bid = bids_.begin();
            auto ask = asks_.begin();

            double best_bid = bid->first;
            double best_ask = ask->first;

            if (best_bid < best_ask) break;

            PriceLevel& bid_level = bid->second;
            PriceLevel& ask_level = ask->second;

            double qty = std::min(bid_level.quantity, ask_level.quantity);
            if (qty <= 0.00000001) {
                if (bid_level.quantity <= 0.00000001) bids_.erase(bid);
                if (ask_level.quantity <= 0.00000001) asks_.erase(ask);
                continue;
            }

            Trade trade;
            trade.id = "trade_" + std::to_string(generate_id());
            trade.market = market_;
            trade.side = Side::Buy;
            trade.price = best_ask;
            trade.quantity = qty;
            trade.fee = qty * best_ask * 0.001;
            trade.timestamp = current_time();
            trades.push_back(trade);

            bid_level.quantity -= qty;
            ask_level.quantity -= qty;
        }

        // Clean empty levels
        for (auto it = bids_.begin(); it != bids_.end();) {
            if (it->second.quantity <= 0.00000001 || it->second.orders.empty())
                it = bids_.erase(it);
            else ++it;
        }

        for (auto it = asks_.begin(); it != asks_.end();) {
            if (it->second.quantity <= 0.00000001 || it->second.orders.empty())
                it = asks_.erase(it);
            else ++it;
        }

        last_update_.fetch_add(1);
        return trades;
    }

    double best_bid() const {
        std::lock_guard<std::mutex> lock(mtx_);
        return bids_.empty() ? 0.0 : bids_.begin()->first;
    }

    double best_ask() const {
        std::lock_guard<std::mutex> lock(mtx_);
        return asks_.empty() ? 0.0 : asks_.begin()->first;
    }

    double spread() const { return best_ask() - best_bid(); }
    int64_t last_update() const { return last_update_.load(); }
};

// Matching Engine
class MatchingEngine {
private:
    std::unordered_map<std::string, std::shared_ptr<OrderBook>> books_;
    std::unordered_map<std::string, Market> markets_;
    std::vector<Trade> trades_;
    std::atomic<uint64_t> total_orders_{0};
    std::atomic<uint64_t> total_trades_{0};
    std::atomic<uint64_t> total_volume_{0};
    std::atomic<int64_t> avg_latency_{0};

public:
    MatchingEngine() {
        add_market({"BTC/USDT", "BTC", "USDT"});
        add_market({"ETH/USDT", "ETH", "USDT"});
    }

    void add_market(const Market& m) {
        markets_[m.id] = m;
        books_[m.id] = std::make_shared<OrderBook>(m.id);
    }

    std::pair<Trade*, std::string> place_order(Order& order) {
        auto start = std::chrono::high_resolution_clock::now();

        auto mit = markets_.find(order.market);
        if (mit == markets_.end()) return {nullptr, "Market not found"};
        
        const Market& m = mit->second;
        if (!m.trading) return {nullptr, "Trading disabled"};

        order.status = OrderStatus::New;
        order.created_at = current_time();

        if (order.type == OrderType::Limit) {
            books_[order.market]->add_order(order);
        }

        auto trade_vec = books_[order.market]->match(order.price);

        total_orders_.fetch_add(1);

        auto end = std::chrono::high_resolution_clock::now();
        int64_t lat = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
        update_latency(lat);

        if (!trade_vec.empty()) {
            for (auto& t : trade_vec) {
                trades_.push_back(t);
                total_trades_.fetch_add(1);
                total_volume_.fetch_add((uint64_t)(t.price * t.quantity));
            }
            return {&trades_.back(), ""};
        }

        return {nullptr, ""};
    }

    struct Snapshot {
        double best_bid = 0.0;
        double best_ask = 0.0;
        double spread = 0.0;
        int64_t last_update = 0;
        std::vector<std::pair<double,double>> bids;
        std::vector<std::pair<double,double>> asks;
    };

    Snapshot snapshot(const std::string& market, int levels = 20) {
        Snapshot s;
        auto& book = books_[market];
        s.best_bid = book->best_bid();
        s.best_ask = book->best_ask();
        s.spread = book->spread();
        s.last_update = book->last_update();

        int count = 0;
        for (auto& p : book->bids_) {
            if (count++ >= levels) break;
            s.bids.emplace_back(p.first, p.second.quantity);
        }

        count = 0;
        for (auto& p : book->asks_) {
            if (count++ >= levels) break;
            s.asks.emplace_back(p.first, p.second.quantity);
        }

        return s;
    }

    struct Stats {
        uint64_t orders = 0;
        uint64_t trades = 0;
        uint64_t volume = 0;
        int64_t latency_us = 0;
        size_t markets = 0;
    };

    Stats stats() const {
        return {
            total_orders_.load(),
            total_trades_.load(),
            total_volume_.load(),
            avg_latency_.load() / 1000,
            markets_.size()
        };
    }

private:
    void update_latency(int64_t ns) {
        auto current = avg_latency_.load();
        auto count = total_orders_.load();
        if (count > 0) {
            avg_latency_.store((current * (count - 1) + ns) / count);
        }
    }

    static int64_t generate_id() {
        static std::atomic<int64_t> cnt{0};
        return ++cnt;
    }

    static int64_t current_time() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
    }
};

int main() {
    std::cout << "TigerEx C++ Matching Engine v1.0" << std::endl;
    std::cout << "=============================" << std::endl;

    MatchingEngine engine;

    engine.add_market({"BNB/USDT", "BNB", "USDT"});
    engine.add_market({"XRP/USDT", "XRP", "USDT"});

    // Test orders
    std::vector<Order> test_orders = {
        {"1", "user1", "BTC/USDT", Side::Buy, OrderType::Limit, 45000.0, 0.5, 0.0, OrderStatus::New, 0},
        {"2", "user2", "BTC/USDT", Side::Sell, OrderType::Limit, 45000.0, 0.3, 0.0, OrderStatus::New, 0},
        {"3", "user1", "ETH/USDT", Side::Buy, OrderType::Limit, 2500.0, 2.0, 0.0, OrderStatus::New, 0},
    };

    for (auto& o : test_orders) {
        auto [trade, err] = engine.place_order(o);
        if (!err.empty()) {
            std::cerr << "Error: " << err << std::endl;
        } else if (trade) {
            std::cout << "Trade: " << trade->quantity << " @ " << trade->price << std::endl;
        }
    }

    auto snap = engine.snapshot("BTC/USDT", 5);
    std::cout << "\nBTC/USDT Order Book:" << std::endl;
    std::cout << "Bid: " << snap.best_bid << " Ask: " << snap.best_ask << " Spread: " << snap.spread << std::endl;

    auto st = engine.stats();
    std::cout << "\nEngine Stats:" << std::endl;
    std::cout << "Orders: " << st.orders << std::endl;
    std::cout << "Trades: " << st.trades << std::endl;
    std::cout << "Volume: " << st.volume << std::endl;
    std::cout << "Avg Latency: " << st.latency_us << " us" << std::endl;

    return 0;
}