#include "matching_engine.hpp"

#include <cassert>
#include <cstdint>

using tigerex::MatchingEngine;
using tigerex::Order;

static Order order(uint64_t id, uint64_t price, uint64_t quantity, bool buy) {
    return Order{id, id, price, quantity, id, buy};
}

int main() {
    {
        MatchingEngine engine;
        assert(engine.process_order(order(1, 100, 3, false)) == 0);
        assert(engine.process_order(order(2, 101, 4, false)) == 0);
        assert(engine.get_best_ask() == 100);

        // A buy limit at 100 may consume the 100 ask, but not the 101 ask.
        assert(engine.process_order(order(3, 100, 5, true)) == 1);
        assert(engine.get_best_ask() == 101);
        assert(engine.get_best_bid() == 100);
    }

    {
        MatchingEngine engine;
        assert(engine.process_order(order(10, 101, 3, true)) == 0);
        assert(engine.process_order(order(11, 102, 1, true)) == 0);
        assert(engine.get_best_bid() == 102);

        // A sell must consume the highest bid first, respecting its limit.
        assert(engine.process_order(order(12, 101, 3, false)) == 2);
        assert(engine.get_best_bid() == 101);
        assert(engine.get_best_ask() == 0);
    }

    {
        MatchingEngine engine;
        assert(engine.process_order(order(20, 100, 0, true)) == 0);
        assert(engine.process_order(order(21, 0, 5, false)) == 0);
        assert(engine.get_best_bid() == 0);
        assert(engine.get_best_ask() == 0);
    }

    {
        tigerex::RingBuffer<uint64_t, 4> queue;
        uint64_t value = 0;
        assert(!queue.read(value));
        assert(queue.write(42));
        assert(queue.read(value));
        assert(value == 42);
        assert(!queue.read(value));
    }

    return 0;
}
