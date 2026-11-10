// Matching Engine - Ultra-Low Latency Order Matching
// C++ for microsecond-level performance (Binance quality)

#include <iostream>
#include <unordered_map>
#include <vector>
#include <queue>
#include <algorithm>
#include <chrono>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>

using namespace std::chrono;

// Order side
enum class Side { BUY, SELL };

// Order type
enum class OrderType { MARKET, LIMIT, STOP_LOSS, STOP_LIMIT };

// Order status
enum class OrderStatus { PENDING, OPEN, PARTIAL, FILLED, CANCELLED, REJECTED };

// Order
struct Order {
    uint64_t id;
    std::string symbol;
    std::string userId;
    Side side;
    OrderType type;
    double price;
    double quantity;
    double filled;
    OrderStatus status;
    uint64_t timestamp;
    double stopPrice;
};

// Order book level
struct Level {
    double price;
    double quantity;
    std::vector<uint64_t> orderIds;
};

// Trade execution
struct Trade {
    uint64_t orderId;
    uint64_t counterOrderId;
    std::string symbol;
    Side side;
    double price;
    double quantity;
    uint64_t timestamp;
};

// Order book for a symbol
class OrderBook {
private:
    std::vector<Level> bidLevels;
    std::vector<Level> askLevels;
    std::unordered_map<uint64_t, Order> orders;
    
    std::mutex bookMutex;

public:
    // Add order to book
    void addOrder(const Order& order) {
        std::lock_guard<std::mutex> lock(bookMutex);
        
        orders[order.id] = order;
        
        if (order.side == Side::BUY) {
            addLevel(bidLevels, order.price, order.quantity, order.id);
        } else {
            addLevel(askLevels, order.price, order.quantity, order.id);
        }
    }

    // Match orders - returns trades
    std::vector<Trade> match() {
        std::lock_guard<std::mutex> lock(bookMutex);
        
        std::vector<Trade> trades;
        
        // Sort: bids descending, asks ascending
        std::sort(bidLevels.begin(), bidLevels.end(), 
            [](const Level& a, const Level& b) { return a.price > b.price; });
        std::sort(askLevels.begin(), askLevels.end(),
            [](const Level& a, const Level& b) { return a.price < b.price; });
        
        // Match
        for (auto& bid : bidLevels) {
            for (auto& ask : askLevels) {
                if (bid.price >= ask.price && bid.quantity > 0 && ask.quantity > 0) {
                    double matchQty = std::min(bid.quantity, ask.quantity);
                    
                    // Get orders
                    auto& bidOrder = orders[bid.orderIds[0]];
                    auto& askOrder = orders[ask.orderIds[0]];
                    
                    // Create trade
                    Trade trade{};
                    trade.orderId = bidOrder.id;
                    trade.counterOrderId = askOrder.id;
                    trade.symbol = bidOrder.symbol;
                    trade.side = bidOrder.side;
                    trade.price = ask.price; // Aggressive side gets passive price
                    trade.quantity = matchQty;
                    trade.timestamp = (uint64_t)std::time(nullptr);
                    
                    trades.push_back(trade);
                    
                    // Update quantities
                    bid.quantity -= matchQty;
                    ask.quantity -= matchQty;
                    bidOrder.filled += matchQty;
                    askOrder.filled += matchQty;
                    
                    if (bidOrder.quantity <= bidOrder.filled) {
                        bidOrder.status = OrderStatus::FILLED;
                    }
                    if (askOrder.quantity <= askOrder.filled) {
                        askOrder.status = OrderStatus::FILLED;
                    }
                }
            }
        }
        
        return trades;
    }

    // Get best bid
    double bestBid() {
        std::lock_guard<std::mutex> lock(bookMutex);
        return bidLevels.empty() ? 0 : bidLevels[0].price;
    }

    // Get best ask
    double bestAsk() {
        std::lock_guard<std::mutex> lock(bookMutex);
        return askLevels.empty() ? 0 : askLevels[0].price;
    }

    // Get spread
    double spread() {
        return bestAsk() - bestBid();
    }

    // Cancel an order. Returns true when the order was open and is now
    // cancelled; the id is dropped from its level so it cannot match again.
    bool cancelOrder(uint64_t orderId) {
        std::lock_guard<std::mutex> lock(bookMutex);

        auto it = orders.find(orderId);
        if (it == orders.end()) return false;
        if (it->second.status == OrderStatus::FILLED ||
            it->second.status == OrderStatus::CANCELLED) {
            return false;
        }

        double remaining = it->second.quantity - it->second.filled;
        it->second.status = OrderStatus::CANCELLED;

        for (auto* levels : {&bidLevels, &askLevels}) {
            for (auto& level : *levels) {
                auto pos = std::find(level.orderIds.begin(), level.orderIds.end(), orderId);
                if (pos == level.orderIds.end()) continue;
                level.quantity -= remaining;
                if (level.quantity < 0) level.quantity = 0;
                level.orderIds.erase(pos);
            }
            levels->erase(
                std::remove_if(levels->begin(), levels->end(),
                    [](const Level& l) { return l.orderIds.empty(); }),
                levels->end());
        }
        return true;
    }

private:
    void addLevel(std::vector<Level>& levels, double price, double qty, uint64_t orderId) {
        for (auto& level : levels) {
            if (level.price == price) {
                level.quantity += qty;
                level.orderIds.push_back(orderId);
                return;
            }
        }
        Level level{};
        level.price = price;
        level.quantity = qty;
        level.orderIds.push_back(orderId);
        levels.push_back(level);
    }
};

// Global order books
class MatchingEngine {
private:
    std::unordered_map<std::string, OrderBook*> books;
    std::atomic<uint64_t> orderCounter{1000};
    std::mutex engineMutex;

public:
    MatchingEngine() {}

    // Create order
    uint64_t createOrder(const std::string& symbol, const std::string& userId, 
                       Side side, OrderType type, double price, double quantity) {
        std::lock_guard<std::mutex> lock(engineMutex);
        
        Order order{};
        order.id = orderCounter.fetch_add(1);
        order.symbol = symbol;
        order.userId = userId;
        order.side = side;
        order.type = type;
        order.price = price;
        order.quantity = quantity;
        order.filled = 0;
        order.status = OrderStatus::PENDING;
        order.timestamp = (uint64_t)std::time(nullptr);
        
        // Get or create order book
        if (books.find(symbol) == books.end()) {
            books[symbol] = new OrderBook();
        }
        
        books[symbol]->addOrder(order);
        
        return order.id;
    }

    // Process trades
    std::vector<Trade> processMatches(const std::string& symbol) {
        if (books.find(symbol) != books.end()) {
            return books[symbol]->match();
        }
        return {};
    }

    // Cancel order
    bool cancelOrder(uint64_t orderId) {
        std::lock_guard<std::mutex> lock(engineMutex);
        
        for (auto& [symbol, book] : books) {
            if (book->cancelOrder(orderId)) {
                return true;
            }
        }
        return false;
    }

    // Get market data
    std::pair<double, double> getMarketData(const std::string& symbol) {
        if (books.find(symbol) != books.end()) {
            return {books[symbol]->bestBid(), books[symbol]->bestAsk()};
        }
        return {0, 0};
    }
};

// Each non-empty, non-comment input line is:
// symbol,user,side,type,price,quantity  (side: BUY|SELL; type: MARKET|LIMIT)
static bool load_orders(const std::string& path, MatchingEngine& engine, std::vector<std::string>& symbols) {
    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "Cannot open order file: " << path << std::endl;
        return false;
    }

    std::string line;
    size_t loaded = 0;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;

        std::stringstream ss(line);
        std::string symbol, user, side_s, type_s, price_s, qty_s;
        if (!std::getline(ss, symbol, ',') || !std::getline(ss, user, ',') ||
            !std::getline(ss, side_s, ',') || !std::getline(ss, type_s, ',') ||
            !std::getline(ss, price_s, ',') || !std::getline(ss, qty_s, ',')) {
            std::cerr << "Malformed order line: " << line << std::endl;
            return false;
        }

        try {
            Side side = side_s == "BUY" ? Side::BUY : Side::SELL;
            if (side_s != "BUY" && side_s != "SELL") throw std::invalid_argument("side");
            OrderType type;
            if (type_s == "MARKET") type = OrderType::MARKET;
            else if (type_s == "LIMIT") type = OrderType::LIMIT;
            else throw std::invalid_argument("type");

            size_t c1 = 0, c2 = 0;
            double price = std::stod(price_s, &c1);
            double qty = std::stod(qty_s, &c2);
            if (c1 != price_s.size() || c2 != qty_s.size()) throw std::invalid_argument("trailing");
            if (symbol.empty() || user.empty() || qty <= 0 || (type == OrderType::LIMIT && price <= 0))
                throw std::invalid_argument("range");

            engine.createOrder(symbol, user, side, type, price, qty);
            symbols.push_back(symbol);
            ++loaded;
        } catch (const std::exception&) {
            std::cerr << "Invalid order value in line: " << line << std::endl;
            return false;
        }
    }

    if (loaded == 0) {
        std::cerr << "Order file contained no orders: " << path << std::endl;
        return false;
    }
    return true;
}

#ifndef TIGEREX_MATCHING_ENGINE_NO_MAIN
int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: matching-engine-v2 <orders.csv>" << std::endl;
        return 1;
    }

    MatchingEngine engine;
    std::vector<std::string> symbols;
    if (!load_orders(argv[1], engine, symbols)) {
        return 1;
    }

    std::sort(symbols.begin(), symbols.end());
    symbols.erase(std::unique(symbols.begin(), symbols.end()), symbols.end());

    for (const auto& symbol : symbols) {
        auto trades = engine.processMatches(symbol);
        std::cout << symbol << ": " << trades.size() << " trades" << std::endl;
        for (const auto& trade : trades) {
            std::cout << "  Trade: " << trade.symbol << " @ $" << trade.price
                      << " qty: " << trade.quantity << std::endl;
        }
        auto [bid, ask] = engine.getMarketData(symbol);
        std::cout << "  Market: bid $" << bid << " ask $" << ask << std::endl;
    }

    return 0;
}
#endif // TIGEREX_MATCHING_ENGINE_NO_MAIN