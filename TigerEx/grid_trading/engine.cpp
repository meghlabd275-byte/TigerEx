#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <atomic>
#include <mutex>
#include <cmath>

struct GridOrder {
    std::string id;
    double price;
    double quantity;
    std::string side;
    bool filled;
};

struct GridBot {
    std::string id;
    std::string symbol;
    std::string user_id;
    double lower_price;
    double upper_price;
    int grid_levels;
    double quantity_per_grid;
    double grid_spacing;
    std::string status;
    std::vector<GridOrder> orders;
    double total_profit;
};

class GridTradingEngine {
private:
    std::map<std::string, GridBot> bots;
    std::atomic<uint64_t> order_count{0};
    std::mutex mutex;

public:
    std::string createGridBot(std::string symbol, std::string user_id, double lower, double upper, int levels, double qty) {
        std::lock_guard<std::mutex> lock(mutex);
        
        GridBot bot;
        bot.id = "GRID_" + std::to_string(bots.size() + 1);
        bot.symbol = symbol;
        bot.user_id = user_id;
        bot.lower_price = lower;
        bot.upper_price = upper;
        bot.grid_levels = levels;
        bot.quantity_per_grid = qty;
        bot.grid_spacing = (upper - lower) / levels;
        bot.status = "ACTIVE";
        bot.total_profit = 0.0;
        
        // Generate grid orders
        for (int i = 0; i <= levels; i++) {
            double price = lower + (i * bot.grid_spacing);
            GridOrder buy_order;
            buy_order.id = "ORD_" + std::to_string(++order_count);
            buy_order.price = price;
            buy_order.quantity = qty;
            buy_order.side = "BUY";
            buy_order.filled = false;
            bot.orders.push_back(buy_order);
            
            GridOrder sell_order;
            sell_order.id = "ORD_" + std::to_string(++order_count);
            sell_order.price = price * 1.001; // 0.1% profit
            sell_order.quantity = qty;
            sell_order.side = "SELL";
            sell_order.filled = false;
            bot.orders.push_back(sell_order);
        }
        
        bots[bot.id] = bot;
        return bot.id;
    }

    void fillOrder(std::string bot_id, std::string order_id) {
        std::lock_guard<std::mutex> lock(mutex);
        
        auto it = bots.find(bot_id);
        if (it == bots.end()) return;
        
        for (auto& order : it->second.orders) {
            if (order.id == order_id && !order.filled) {
                order.filled = true;
                double profit = (order.side == "SELL") ? order.quantity * order.price * 0.001 : 0;
                it->second.total_profit += profit;
                break;
            }
        }
    }

    GridBot* getBot(std::string bot_id) {
        std::lock_guard<std::mutex> lock(mutex);
        auto it = bots.find(bot_id);
        return (it != bots.end()) ? &it->second : nullptr;
    }

    void stopBot(std::string bot_id) {
        std::lock_guard<std::mutex> lock(mutex);
        if (auto it = bots.find(bot_id); it != bots.end()) {
            it->second.status = "STOPPED";
        }
    }

    void resumeBot(std::string bot_id) {
        std::lock_guard<std::mutex> lock(mutex);
        if (auto it = bots.find(bot_id); it != bots.end()) {
            it->second.status = "ACTIVE";
        }
    }
};

int main() {
    std::cout << "TigerEx Grid Trading Engine\n";
    
    GridTradingEngine engine;
    
    // Create grid bot
    std::string bot_id = engine.createGridBot("BTC/USDT", "user1", 45000, 55000, 10, 0.01);
    std::cout << "Created Bot: " << bot_id << "\n";
    
    // Get bot info
    GridBot* bot = engine.getBot(bot_id);
    if (bot) {
        std::cout << "Symbol: " << bot->symbol << "\n";
        std::cout << "Range: " << bot->lower_price << " - " << bot->upper_price << "\n";
        std::cout << "Levels: " << bot->grid_levels << "\n";
        std::cout << "Orders: " << bot->orders.size() << "\n";
    }
    
    // Fill some orders
    engine.fillOrder(bot_id, "ORD_1");
    engine.fillOrder(bot_id, "ORD_2");
    
    bot = engine.getBot(bot_id);
    if (bot) {
        std::cout << "Total Profit: $" << bot->total_profit << "\n";
    }
    
    return 0;
}
