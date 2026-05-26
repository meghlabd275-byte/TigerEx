#ifndef ENGINE_H
#define ENGINE_H

#include <string>
#include <vector>
#include <unordered_map>

namespace engine {

struct Order {
    std::string id;
    std::string symbol;
    double price;
    int quantity;
    std::string side;
};

struct Trade {
    std::string order_id;
    double price;
    int quantity;
};

class CoreEngine {
private:
    std::vector<Order> orders;
    std::vector<Trade> trades;
    std::unordered_map<std::string, double> prices;
    
public:
    void addOrder(const Order& order);
    bool matchOrders();
    double getPrice(const std::string& symbol);
    std::vector<Trade> getTrades() { return trades; }
};

} // namespace engine

#endif