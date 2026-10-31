// TigerEx low-latency matching engine.
//
// Design notes that matter for correctness:
//   - Prices are integer ticks, never floating point. Two doubles that should
//     be equal often are not, which silently splits a price level in two.
//   - Price-time priority is exact: bids/asks are ordered maps keyed by price,
//     and each level is a FIFO deque of resting orders.
//   - The book is single-writer. It is intentionally not internally locked so
//     the hot path stays branch-light and cache friendly; the caller serialises
//     access (one matching thread per symbol). Sharing a book across threads
//     without that serialisation is a data race, not a supported mode.
//   - Unfilled remainders follow exchange semantics: GTC limit orders rest,
//     IOC orders are cancelled, market orders never rest, and FOK orders are
//     rejected whole if the book cannot fill them completely.
#pragma once

#include <algorithm>
#include <cstdint>
#include <deque>
#include <map>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace tigerex::hft {

using OrderId = uint64_t;
using UserId = uint64_t;
using Price = int64_t;    // integer ticks
using Quantity = int64_t;

enum class Side : uint8_t { Buy, Sell };
enum class OrderType : uint8_t { Limit, Market };
enum class TimeInForce : uint8_t { GTC, IOC, FOK };
enum class Status : uint8_t {
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
};

struct Order {
    OrderId id{};
    UserId user{};
    Side side{Side::Buy};
    OrderType type{OrderType::Limit};
    TimeInForce tif{TimeInForce::GTC};
    Price price{};      // ignored for market orders
    Quantity quantity{};
    Quantity filled{};
    Status status{Status::New};
};

struct Trade {
    OrderId taker{};
    OrderId maker{};
    UserId taker_user{};
    UserId maker_user{};
    Price price{};
    Quantity quantity{};
    uint64_t seq{};
};

struct SubmitResult {
    Status status{Status::Rejected};
    Quantity filled{};
    std::vector<Trade> trades{};
};

// Default cap on distinct resting price levels per side. It bounds memory so a
// client cannot exhaust the book by spraying one-tick-apart prices.
inline constexpr std::size_t DEFAULT_MAX_PRICE_LEVELS = 1'000'000;

class OrderBook {
public:
    explicit OrderBook(std::string symbol,
                       std::size_t max_price_levels = DEFAULT_MAX_PRICE_LEVELS)
        : symbol_(std::move(symbol)), max_levels_(max_price_levels) {}

    const std::string& symbol() const { return symbol_; }

    // Submit an order. The order is matched against the book first; any
    // remainder either rests or is cancelled per its time in force.
    SubmitResult submit(const Order& incoming) {
        SubmitResult result;

        if (incoming.quantity <= 0) {
            result.status = Status::Rejected;
            return result;
        }
        if (incoming.type == OrderType::Limit && incoming.price <= 0) {
            result.status = Status::Rejected;
            return result;
        }
        if (incoming.type == OrderType::Market && incoming.tif == TimeInForce::GTC) {
            // A market order has no price to rest at; treat GTC as IOC so a
            // caller cannot accidentally park an unpriced order in the book.
            Order fixed = incoming;
            fixed.tif = TimeInForce::IOC;
            return submit(fixed);
        }

        if (incoming.tif == TimeInForce::FOK &&
            available_to_fill(incoming) < incoming.quantity) {
            result.status = Status::Rejected;
            return result;
        }

        Order working = incoming;
        match(working, result);

        const Quantity remaining = working.quantity - working.filled;

        if (remaining == 0) {
            result.status = Status::Filled;
        } else if (working.tif == TimeInForce::GTC && working.type == OrderType::Limit) {
            if (!rest(working)) {
                result.status = working.filled > 0 ? Status::PartiallyFilled : Status::Rejected;
                result.filled = working.filled;
                return result;
            }
            result.status = working.filled > 0 ? Status::PartiallyFilled : Status::New;
        } else if (working.filled > 0) {
            result.status = Status::PartiallyFilled;
        } else {
            result.status = Status::Cancelled;
        }

        result.filled = working.filled;
        return result;
    }

    // Cancel a resting order by id. Returns false when the id is not resting.
    bool cancel(OrderId id) {
        auto loc = index_.find(id);
        if (loc == index_.end()) {
            return false;
        }
        if (loc->second.side == Side::Buy) {
            erase_from(bids_, loc->second.price, id);
        } else {
            erase_from(asks_, loc->second.price, id);
        }
        index_.erase(loc);
        return true;
    }

    std::optional<Price> best_bid() const {
        if (bids_.empty()) {
            return std::nullopt;
        }
        return bids_.begin()->first;
    }

    std::optional<Price> best_ask() const {
        if (asks_.empty()) {
            return std::nullopt;
        }
        return asks_.begin()->first;
    }

    Quantity bid_quantity_at(Price price) const {
        auto it = bids_.find(price);
        return it == bids_.end() ? 0 : level_quantity(it->second);
    }

    Quantity ask_quantity_at(Price price) const {
        auto it = asks_.find(price);
        return it == asks_.end() ? 0 : level_quantity(it->second);
    }

    std::size_t resting_orders() const { return index_.size(); }

    // Top `levels` of each side as (price, total quantity), best first.
    std::pair<std::vector<std::pair<Price, Quantity>>,
              std::vector<std::pair<Price, Quantity>>>
    depth(std::size_t levels) const {
        std::vector<std::pair<Price, Quantity>> bid_out;
        std::vector<std::pair<Price, Quantity>> ask_out;
        for (const auto& [price, level] : bids_) {
            if (bid_out.size() == levels) break;
            bid_out.emplace_back(price, level_quantity(level));
        }
        for (const auto& [price, level] : asks_) {
            if (ask_out.size() == levels) break;
            ask_out.emplace_back(price, level_quantity(level));
        }
        return {bid_out, ask_out};
    }

private:
    struct Resting {
        OrderId id{};
        UserId user{};
        Price price{};
        Quantity quantity{};
        Quantity filled{};
        uint64_t seq{};
        Quantity remaining() const { return quantity - filled; }
    };

    struct Location {
        Side side{};
        Price price{};
    };

    using BidLevels = std::map<Price, std::deque<Resting>, std::greater<Price>>;
    using AskLevels = std::map<Price, std::deque<Resting>, std::less<Price>>;

    static Quantity level_quantity(const std::deque<Resting>& level) {
        Quantity total = 0;
        for (const auto& r : level) {
            total += r.remaining();
        }
        return total;
    }

    // Liquidity this order could take right now, ignoring its own size.
    Quantity available_to_fill(const Order& order) const {
        Quantity available = 0;
        if (order.side == Side::Buy) {
            for (const auto& [price, level] : asks_) {
                if (order.type == OrderType::Limit && price > order.price) break;
                available += level_quantity(level);
                if (available >= order.quantity) break;
            }
        } else {
            for (const auto& [price, level] : bids_) {
                if (order.type == OrderType::Limit && price < order.price) break;
                available += level_quantity(level);
                if (available >= order.quantity) break;
            }
        }
        return available;
    }

    void match(Order& order, SubmitResult& result) {
        if (order.side == Side::Buy) {
            match_against(order, asks_, result);
        } else {
            match_against(order, bids_, result);
        }
    }

    template <typename Levels>
    void match_against(Order& order, Levels& book, SubmitResult& result) {
        const bool is_buy = order.side == Side::Buy;
        while (order.filled < order.quantity && !book.empty()) {
            auto level_it = book.begin();
            const Price level_price = level_it->first;
            if (order.type == OrderType::Limit) {
                if (is_buy && level_price > order.price) break;
                if (!is_buy && level_price < order.price) break;
            }
            auto& level = level_it->second;
            while (order.filled < order.quantity && !level.empty()) {
                Resting& maker = level.front();
                const Quantity qty = std::min(order.quantity - order.filled, maker.remaining());
                Trade trade{};
                trade.taker = order.id;
                trade.maker = maker.id;
                trade.taker_user = order.user;
                trade.maker_user = maker.user;
                trade.price = maker.price;  // resting order sets the price
                trade.quantity = qty;
                trade.seq = ++trade_seq_;
                result.trades.push_back(trade);

                maker.filled += qty;
                order.filled += qty;
                if (maker.remaining() == 0) {
                    index_.erase(maker.id);
                    level.pop_front();
                }
            }
            if (level.empty()) {
                book.erase(level_it);
            }
        }
    }

    bool rest(const Order& order) {
        const Price price = order.price;
        if (order.side == Side::Buy) {
            auto it = bids_.find(price);
            if (it == bids_.end() && bids_.size() >= max_levels_) {
                return false;
            }
            auto& level = bids_[price];
            level.push_back(Resting{order.id, order.user, price, order.quantity, order.filled, ++rest_seq_});
        } else {
            auto it = asks_.find(price);
            if (it == asks_.end() && asks_.size() >= max_levels_) {
                return false;
            }
            auto& level = asks_[price];
            level.push_back(Resting{order.id, order.user, price, order.quantity, order.filled, ++rest_seq_});
        }
        index_[order.id] = Location{order.side, price};
        return true;
    }

    template <typename Levels>
    void erase_from(Levels& book, Price price, OrderId id) {
        auto level_it = book.find(price);
        if (level_it == book.end()) {
            return;
        }
        auto& level = level_it->second;
        for (auto it = level.begin(); it != level.end(); ++it) {
            if (it->id == id) {
                level.erase(it);
                break;
            }
        }
        if (level.empty()) {
            book.erase(level_it);
        }
    }

    std::string symbol_;
    std::size_t max_levels_;
    BidLevels bids_;
    AskLevels asks_;
    std::unordered_map<OrderId, Location> index_;
    uint64_t trade_seq_{0};
    uint64_t rest_seq_{0};
};

// Routes orders for many symbols to their own book and keeps running counters.
class MatchingEngine {
public:
    explicit MatchingEngine(std::size_t max_price_levels = DEFAULT_MAX_PRICE_LEVELS)
        : max_levels_(max_price_levels) {}

    OrderBook& book(const std::string& symbol) {
        auto it = books_.find(symbol);
        if (it == books_.end()) {
            it = books_.emplace(symbol, OrderBook(symbol, max_levels_)).first;
        }
        return it->second;
    }

    SubmitResult submit(const std::string& symbol, const Order& order) {
        SubmitResult result = book(symbol).submit(order);
        ++orders_;
        if (result.status == Status::Rejected) {
            ++rejected_;
        }
        for (const auto& t : result.trades) {
            ++trades_;
            volume_ += t.quantity;
        }
        return result;
    }

    bool cancel(const std::string& symbol, OrderId id) {
        auto it = books_.find(symbol);
        if (it == books_.end()) {
            return false;
        }
        if (it->second.cancel(id)) {
            ++cancelled_;
            return true;
        }
        return false;
    }

    uint64_t orders() const { return orders_; }
    uint64_t rejected() const { return rejected_; }
    uint64_t cancelled() const { return cancelled_; }
    uint64_t trades() const { return trades_; }
    Quantity volume() const { return volume_; }

private:
    std::size_t max_levels_;
    std::unordered_map<std::string, OrderBook> books_;
    uint64_t orders_{0};
    uint64_t rejected_{0};
    uint64_t cancelled_{0};
    uint64_t trades_{0};
    Quantity volume_{0};
};

}  // namespace tigerex::hft
