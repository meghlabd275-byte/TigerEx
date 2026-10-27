// MatchingEngine.cpp - Implementation
#include "matching_engine.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <limits>
#include <thread>

namespace tigerex {

// OrderBook Implementation
OrderBook::OrderBook(const std::string& symbol)
    : symbol_(symbol), last_trade_id_(0) {}

bool OrderBook::AddOrder(Order& order) {
    if (order.status != OrderStatus::PENDING && order.status != OrderStatus::OPEN) {
        return false;
    }

    std::unique_lock<std::shared_mutex> lock(mutex_);

    order.order_id = ++last_order_id_;
    orders_[order.order_id] = std::make_shared<Order>(order);

    if (order.type == OrderType::LIMIT) {
        auto& book = order.side == Side::BUY ? bids_ : asks_;
        // A new price needs a level created before the order is appended.
        auto level = book.find(order.price);
        if (level == book.end()) {
            level = book.emplace(order.price, std::deque<std::shared_ptr<Order>>{});
        }
        level->second.push_back(orders_[order.order_id]);
    }

    return true;
}

std::vector<Trade> OrderBook::AddOrderAndMatch(Order& order) {
    if (!AddOrder(order)) {
        return {};
    }

    auto trades = MatchOrder(order.order_id);

    // Matching works on the book's own copy, so publish the resulting fills,
    // average price and status back to the caller's order.
    auto it = orders_.find(order.order_id);
    if (it != orders_.end()) {
        order.filled_quantity = it->second->filled_quantity;
        order.avg_fill_price = it->second->avg_fill_price;
        order.status = it->second->status;
    }

    return trades;
}

std::vector<Trade> OrderBook::MatchOrder(uint64_t order_id) {
    std::unique_lock<std::shared_mutex> lock(mutex_);

    auto it = orders_.find(order_id);
    if (it == orders_.end()) {
        return {};
    }

    auto& order = *it->second;
    std::vector<Trade> trades;

    // Get opposite side book
    auto& book = order.side == Side::BUY ? asks_ : bids_;

    while (order.filled_quantity < order.quantity && !book.empty()) {
        auto level_it = book.begin();
        uint64_t level_price = level_it->first;
        auto& queue = level_it->second;

        // Check price condition
        bool can_match = order.side == Side::BUY
            ? (level_price <= order.price || order.type == OrderType::MARKET)
            : (level_price >= order.price || order.type == OrderType::MARKET);

        if (!can_match) break;

        // Process orders at this level
        while (!queue.empty() && order.filled_quantity < order.quantity) {
            auto& matched_order = queue.front();

            uint64_t match_qty = std::min(
                order.quantity - order.filled_quantity,
                matched_order->quantity - matched_order->filled_quantity
            );

            // Update orders
            order.filled_quantity += match_qty;
            matched_order->filled_quantity += match_qty;

            // Weighted average fill price across every fill so far.
            uint64_t exec_price = level_price;
            if (order.filled_quantity > 0) {
                order.avg_fill_price =
                    (order.avg_fill_price * (order.filled_quantity - match_qty) +
                     exec_price * match_qty) / order.filled_quantity;
            }

            // Create trade
            Trade trade = {
                ++last_trade_id_,
                order.order_id,
                matched_order->order_id,
                order.order_id,
                order.user_id,
                order.symbol,
                order.side,
                exec_price,
                match_qty,
                0, // fee is charged by the ledger, not the book
                "",
                static_cast<uint64_t>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch()
                    ).count())
            };
            trades.push_back(trade);
            recent_trades_.push_back(trade);

            // Remove fully filled orders
            if (matched_order->filled_quantity >= matched_order->quantity) {
                queue.pop_front();
                orders_.erase(matched_order->order_id);
            }

            if (order.filled_quantity >= order.quantity) {
                break;
            }
        }

        // Remove empty levels
        if (queue.empty()) {
            book.erase(level_it);
        }
    }

    // Update order status
    if (order.filled_quantity >= order.quantity) {
        order.status = OrderStatus::FILLED;
        // Remove the filled taker from its own side, otherwise the next
        // submission would match against it a second time.
        auto& own_book = order.side == Side::BUY ? bids_ : asks_;
        auto own_level = own_book.find(order.price);
        if (own_level != own_book.end()) {
            auto& own_queue = own_level->second;
            own_queue.erase(
                std::remove_if(own_queue.begin(), own_queue.end(),
                    [order_id](const std::shared_ptr<Order>& o) {
                        return o->order_id == order_id;
                    }),
                own_queue.end()
            );
            if (own_queue.empty()) {
                own_book.erase(own_level);
            }
        }
    } else if (order.filled_quantity > 0) {
        order.status = OrderStatus::PARTIALLY_FILLED;
    }

    return trades;
}

bool OrderBook::CancelOrder(uint64_t order_id) {
    std::unique_lock<std::shared_mutex> lock(mutex_);

    auto it = orders_.find(order_id);
    if (it == orders_.end()) {
        return false;
    }

    auto& order = *it->second;

    if (order.status == OrderStatus::FILLED || order.status == OrderStatus::CANCELLED) {
        return false;
    }

    // Remove from book
    auto& book = order.side == Side::BUY ? bids_ : asks_;
    auto price_it = book.find(order.price);
    if (price_it != book.end()) {
        auto& queue = price_it->second;
        queue.erase(
            std::remove_if(queue.begin(), queue.end(),
                [order_id](const std::shared_ptr<Order>& o) {
                    return o->order_id == order_id;
                }),
            queue.end()
        );
        if (queue.empty()) {
            book.erase(price_it);
        }
    }

    order.status = OrderStatus::CANCELLED;
    return true;
}

std::pair<uint64_t, uint64_t> OrderBook::GetBestBidAsk() const {
    std::shared_lock<std::shared_mutex> lock(mutex_);

    uint64_t best_bid = 0;
    uint64_t best_ask = 0;

    if (!bids_.empty()) {
        best_bid = bids_.begin()->first;
    }
    if (!asks_.empty()) {
        best_ask = asks_.begin()->first;
    }

    return {best_bid, best_ask};
}

std::vector<PriceLevel> OrderBook::GetDepth(uint32_t levels) const {
    std::shared_lock<std::shared_mutex> lock(mutex_);

    std::vector<PriceLevel> depth;

    uint32_t count = 0;
    for (auto& level : asks_) {
        if (count >= levels) break;

        uint64_t qty = 0;
        for (auto& order : level.second) {
            qty += order->quantity - order->filled_quantity;
        }

        depth.push_back({level.first, qty, level.second.size()});
        count++;
    }

    count = 0;
    for (auto& level : bids_) {
        if (count >= levels) break;

        uint64_t qty = 0;
        for (auto& order : level.second) {
            qty += order->quantity - order->filled_quantity;
        }

        depth.push_back({level.first, qty, level.second.size()});
        count++;
    }

    return depth;
}

std::vector<Trade> OrderBook::GetRecentTrades(uint32_t limit) const {
    std::shared_lock<std::shared_mutex> lock(mutex_);

    if (recent_trades_.size() <= limit) {
        return recent_trades_;
    }

    return std::vector<Trade>(
        recent_trades_.end() - limit,
        recent_trades_.end()
    );
}

// MatchingEngine Implementation
MatchingEngine::MatchingEngine() {
    // Pre-register some symbols
    std::vector<std::string> default_symbols = {
        "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT",
        "XRP/USDT", "ADA/USDT", "AVAX/USDT", "DOT/USDT"
    };
    Initialize(default_symbols);
}

void MatchingEngine::Initialize(const std::vector<std::string>& symbols) {
    std::unique_lock<std::shared_mutex> lock(mutex_);

    for (const auto& symbol : symbols) {
        books_[symbol] = std::make_shared<OrderBook>(symbol);
    }
}

std::shared_ptr<OrderBook> MatchingEngine::GetOrderBook(const std::string& symbol) {
    std::shared_lock<std::shared_mutex> lock(mutex_);

    auto it = books_.find(symbol);
    if (it != books_.end()) {
        return it->second;
    }
    return nullptr;
}

std::pair<uint64_t, std::vector<Trade>> MatchingEngine::SubmitOrder(Order& order) {
    auto book = GetOrderBook(order.symbol);
    if (!book) {
        return {0, {}};
    }

    // AddOrderAndMatch assigns the order id, rests the order, and matches it.
    auto trades = book->AddOrderAndMatch(order);
    return {order.order_id, trades};
}

std::vector<std::string> MatchingEngine::GetMarkets() const {
    std::shared_lock<std::shared_mutex> lock(mutex_);

    std::vector<std::string> markets;
    for (const auto& pair : books_) {
        markets.push_back(pair.first);
    }
    return markets;
}

bool MatchingEngine::CancelOrder(const std::string& symbol, uint64_t order_id) {
    auto book = GetOrderBook(symbol);
    if (!book) {
        return false;
    }
    return book->CancelOrder(order_id);
}

bool MatchingEngine::ModifyOrder(const std::string& symbol, uint64_t order_id,
                                 uint64_t new_quantity) {
    auto book = GetOrderBook(symbol);
    if (!book) {
        return false;
    }
    return book->ModifyOrder(order_id, new_quantity);
}

std::vector<Trade> MatchingEngine::ProcessBatch(std::vector<Order>& orders) {
    std::vector<Trade> all;
    for (auto& order : orders) {
        auto [id, trades] = SubmitOrder(order);
        if (id == 0) {
            continue;
        }
        all.insert(all.end(), trades.begin(), trades.end());
    }
    return all;
}

MarketStats MatchingEngine::GetMarketStats(const std::string& symbol) {
    MarketStats stats{};
    stats.symbol = symbol;

    auto book = GetOrderBook(symbol);
    if (!book) {
        return stats;
    }

    auto trades = book->GetRecentTrades(std::numeric_limits<uint32_t>::max());
    auto now_ms = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch())
            .count());
    constexpr uint64_t DAY_MS = 24ull * 60 * 60 * 1000;

    stats.timestamp = now_ms;
    stats.last_price = trades.empty() ? 0 : trades.back().price;

    for (const auto& t : trades) {
        if (now_ms > t.timestamp && now_ms - t.timestamp > DAY_MS) {
            continue;
        }
        stats.trades_24h++;
        stats.volume_24h += t.quantity;
        stats.quote_volume_24h += t.price * t.quantity;
        if (stats.high_24h == 0 || t.price > stats.high_24h) {
            stats.high_24h = t.price;
        }
        if (stats.low_24h == 0 || t.price < stats.low_24h) {
            stats.low_24h = t.price;
        }
    }

    if (!trades.empty() && stats.last_price > trades.front().price) {
        stats.price_change_24h = stats.last_price - trades.front().price;
    }

    return stats;
}

std::vector<Trade> OrderBook::ExecuteMarketOrder(Order& order) {
    order.type = OrderType::MARKET;
    return AddOrderAndMatch(order);
}

bool OrderBook::ExecuteLimitOrder(Order& order) {
    order.type = OrderType::LIMIT;
    AddOrderAndMatch(order);
    return order.status != OrderStatus::REJECTED;
}

std::shared_ptr<Order> OrderBook::GetOrder(uint64_t order_id) {
    std::shared_lock<std::shared_mutex> lock(mutex_);
    auto it = orders_.find(order_id);
    return it == orders_.end() ? nullptr : it->second;
}

bool OrderBook::ModifyOrder(uint64_t order_id, uint64_t new_quantity) {
    std::unique_lock<std::shared_mutex> lock(mutex_);

    auto it = orders_.find(order_id);
    if (it == orders_.end()) {
        return false;
    }

    auto& order = *it->second;
    if (order.status == OrderStatus::FILLED ||
        order.status == OrderStatus::CANCELLED) {
        return false;
    }
    if (new_quantity < order.filled_quantity) {
        return false;  // cannot shrink below what already executed
    }

    auto& book = order.side == Side::BUY ? bids_ : asks_;
    auto level = book.find(order.price);
    if (level == book.end()) {
        return false;
    }

    // The resting order in the level queue is the same object held in
    // orders_, so updating it here keeps price-time priority position.
    order.quantity = new_quantity;
    return true;
}

} // namespace tigerex