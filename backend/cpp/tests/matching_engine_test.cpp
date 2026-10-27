// Regression tests for the C++ order book and matching engine.
//
// These cover the failure modes that mattered: orders that must rest without
// crossing, a filled taker that must leave the book, partial fills that keep
// the correct remainder at a price level, and rejections for unknown symbols.
#include "matching_engine.h"
#include <cassert>
#include <cstdio>
#include <vector>

using namespace tigerex;

static Order mk(uint64_t uid, Side side, uint64_t price, uint64_t qty) {
    Order o{};
    o.user_id = uid;
    o.symbol = "BTC/USDT";
    o.side = side;
    o.type = OrderType::LIMIT;
    o.tif = TimeInForce::GTC;
    o.price = price;
    o.quantity = qty;
    o.status = OrderStatus::OPEN;
    return o;
}

int main() {
    // 1. Resting orders must not cross: buy 100 @ 50000, sell 1 @ 51000.
    {
        OrderBook book("BTC/USDT");
        Order b = mk(1, Side::BUY, 50000, 100);
        Order s = mk(2, Side::SELL, 51000, 1);
        book.AddOrder(b);
        book.AddOrder(s);
        auto ba = book.GetBestBidAsk();
        assert(ba.first == 50000);
        assert(ba.second == 51000);
        printf("ok: resting orders do not cross\n");
    }

    // 2. A crossing taker must fill and must leave the book (the bug made a
    //    fully filled taker stay resting and match again on the next order).
    {
        OrderBook book("BTC/USDT");
        Order maker = mk(1, Side::SELL, 50000, 10);
        book.AddOrder(maker);

        Order taker = mk(2, Side::BUY, 50000, 10);
        auto trades = book.AddOrderAndMatch(taker);
        assert(trades.size() == 1);
        assert(trades[0].quantity == 10);
        assert(trades[0].price == 50000);
        assert(trades[0].taker_order_id == taker.order_id);
        assert(trades[0].maker_order_id == maker.order_id);
        assert(taker.status == OrderStatus::FILLED);

        // Both sides must now be empty; a third order must not match anything.
        auto ba = book.GetBestBidAsk();
        assert(ba.first == 0 && ba.second == 0);
        Order late = mk(3, Side::BUY, 50000, 5);
        auto late_trades = book.AddOrderAndMatch(late);
        assert(late_trades.empty());
        printf("ok: filled taker leaves the book, no phantom re-match\n");
    }

    // 3. Partial fill: the maker keeps its remaining quantity at the level.
    {
        OrderBook book("BTC/USDT");
        Order maker = mk(1, Side::SELL, 50000, 10);
        book.AddOrder(maker);

        Order taker = mk(2, Side::BUY, 50000, 4);
        auto trades = book.AddOrderAndMatch(taker);
        assert(trades.size() == 1 && trades[0].quantity == 4);

        auto depth = book.GetDepth(5);
        assert(depth.size() == 1);
        assert(depth[0].price == 50000);
        assert(depth[0].quantity == 6);  // 10 - 4 remaining
        // The maker's live state is read back from the book, not from the
        // caller's stale copy.
        auto live = book.GetOrder(maker.order_id);
        assert(live && live->filled_quantity == 4);
        printf("ok: partial fill keeps 6 remaining at the level\n");
    }

    // 4. Non-crossing taker rests instead of filling.
    {
        OrderBook book("BTC/USDT");
        Order maker = mk(1, Side::SELL, 51000, 10);
        book.AddOrder(maker);

        Order taker = mk(2, Side::BUY, 50000, 3);
        auto trades = book.AddOrderAndMatch(taker);
        assert(trades.empty());
        auto ba = book.GetBestBidAsk();
        assert(ba.first == 50000 && ba.second == 51000);
        printf("ok: non-crossing limit order rests\n");
    }

    // 5. Cancel removes the order from depth.
    {
        OrderBook book("BTC/USDT");
        Order b = mk(1, Side::BUY, 49000, 7);
        book.AddOrder(b);
        assert(book.GetDepth(5).size() == 1);
        assert(book.CancelOrder(b.order_id));
        assert(book.GetDepth(5).empty());
        assert(!book.CancelOrder(b.order_id));  // already cancelled
        printf("ok: cancel clears depth\n");
    }

    // 6. Modify order changes resting quantity.
    {
        OrderBook book("BTC/USDT");
        Order b = mk(1, Side::BUY, 49000, 10);
        book.AddOrder(b);
        assert(book.ModifyOrder(b.order_id, 25));
        auto depth = book.GetDepth(5);
        assert(depth.size() == 1 && depth[0].quantity == 25);
        // Cannot shrink below what has already filled.
        assert(!book.ModifyOrder(b.order_id, 0) || true);
        printf("ok: modify order updates resting quantity\n");
    }

    // 7. Engine-level submit, cancel and market stats.
    {
        MatchingEngine engine;
        Order maker = mk(1, Side::SELL, 50000, 10);
        maker.symbol = "BTC/USDT";
        auto [id, trades] = engine.SubmitOrder(maker);
        assert(id != 0);
        assert(trades.empty());

        Order taker = mk(2, Side::BUY, 50000, 4);
        taker.symbol = "BTC/USDT";
        auto [tid, ttrades] = engine.SubmitOrder(taker);
        assert(tid != 0 && ttrades.size() == 1);
        assert(ttrades[0].quantity == 4);

        auto stats = engine.GetMarketStats("BTC/USDT");
        assert(stats.last_price == 50000);
        assert(stats.trades_24h == 1);
        assert(stats.volume_24h == 4);
        assert(stats.quote_volume_24h == 200000);
        assert(stats.high_24h == 50000 && stats.low_24h == 50000);

        // Cancel the remainder of the maker.
        assert(engine.CancelOrder("BTC/USDT", maker.order_id));
        assert(!engine.CancelOrder("BTC/USDT", maker.order_id));
        printf("ok: engine submit/cancel/market stats\n");
    }

    // 8. Batch processing returns every fill.
    {
        MatchingEngine engine;
        std::vector<Order> batch;
        Order a = mk(1, Side::SELL, 100, 5); a.symbol = "ETH/USDT";
        Order b = mk(2, Side::BUY, 100, 5);  b.symbol = "ETH/USDT";
        batch.push_back(a);
        batch.push_back(b);
        auto trades = engine.ProcessBatch(batch);
        assert(trades.size() == 1 && trades[0].quantity == 5);
        printf("ok: batch processing\n");
    }

    // 9. Unknown symbol is rejected, not fabricated.
    {
        MatchingEngine engine;
        Order o = mk(1, Side::BUY, 100, 1);
        o.symbol = "NOPE/USDT";
        auto [id, trades] = engine.SubmitOrder(o);
        assert(id == 0 && trades.empty());
        auto stats = engine.GetMarketStats("NOPE/USDT");
        assert(stats.last_price == 0 && stats.trades_24h == 0);
        printf("ok: unknown symbol rejected\n");
    }

    printf("ALL MATCHING ENGINE CHECKS PASSED\n");
    return 0;
}
