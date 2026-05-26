#pragma once

#include <string>
#include <vector>
#include <algorithm>
#include <map>

namespace matcher {

struct OrderBook {
    std::vector<Order> bids;
    std::vector<Order> asks;
    
    struct Order {
        std::string id;
        double price;
        int quantity;
        bool is_buy;
    };
    
    void addOrder(const Order& order) {
        if (order.is_buy) {
            bids.push_back(order);
            std::sort(bids.begin(), bids.end(), 
                [](const Order& a, const Order& b) { return a.price > b.price; });
        } else {
            asks.push_back(order);
            std::sort(asks.begin(), asks.end(),
                [](const Order& a, const Order& b) { return a.price < b.price; });
        }
    }
    
    std::vector<Trade> match() {
        std::vector<Trade> trades;
        
        while (!bids.empty() && !asks.empty()) {
            Order& bid = bids.back();
            Order& ask = asks.back();
            
            if (bid.price >= ask.price) {
                Trade trade;
                trade.price = ask.price;
                trade.quantity = std::min(bid.quantity, ask.quantity);
                trades.push_back(trade);
                
                bid.quantity -= trade.quantity;
                ask.quantity -= trade.quantity;
                
                if (bid.quantity == 0) bids.pop_back();
                if (ask.quantity == 0) asks.pop_back();
            } else {
                break;
            }
        }
        
        return trades;
    }
    
    struct Trade {
        double price;
        int quantity;
    };
};

} // namespace matcher