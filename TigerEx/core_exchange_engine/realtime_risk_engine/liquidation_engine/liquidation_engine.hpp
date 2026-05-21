/**
 * TigerEx C++ Liquidation Engine
 * Real-time position liquidation and ADL
 */

namespace tigerex {

// ============================================================================
// Position
// ============================================================================

struct Position {
    uint64_t position_id;
    uint64_t user_id;
    uint64_t symbol;
    bool is_long;
    int64_t quantity;
    uint64_t entry_price;
    uint64_t mark_price;
    uint32_t leverage;
    uint64_t margin_initial;
    int64_t unrealized_pnl;
    uint64_t opened_at;
    std::atomic<uint8_t> status;  // 0=open, 1=partial, 2=liquidated
};

// ============================================================================
// Liquidation Calculator
// ============================================================================

class LiquidationCalculator {
public:
    static uint64_t calculate_liquidation_price(const Position& pos) {
        double mm_ratio = 0.005;
        
        if (pos.is_long) {
            return static_cast<uint64_t>(
                pos.entry_price * (1.0 - 1.0/pos.leverage + mm_ratio)
            );
        } else {
            return static_cast<uint64_t>(
                pos.entry_price * (1.0 + 1.0/pos.leverage - mm_ratio)
            );
        }
    }
    
    static bool should_liquidate(const Position& pos, uint64_t mark_price) {
        uint64_t liq_price = calculate_liquidation_price(pos);
        return pos.is_long ? (mark_price <= liq_price) : (mark_price >= liq_price);
    }
    
    static uint64_t calculate_bankruptcy_price(const Position& pos) {
        if (pos.is_long) {
            return static_cast<uint64_t>(
                pos.entry_price * (1.0 - 1.0/pos.leverage)
            );
        } else {
            return static_cast<uint64_t>(
                pos.entry_price * (1.0 + 1.0/pos.leverage)
            );
        }
    }
};

// ============================================================================
// ADL Calculator
// ============================================================================

class ADLCalculator {
public:
    static std::vector<uint64_t> calculate_adl_queue(
        const std::vector<Position>& positions
    ) {
        std::vector<std::pair<int64_t, uint64_t>> profits;
        for (const auto& p : positions) {
            profits.push_back({p.unrealized_pnl, p.position_id});
        }
        std::sort(profits.begin(), profits.end(),
            [](const auto& a, const auto& b) { return a.first > b.first; }
        );
        std::vector<uint64_t> queue;
        for (const auto& p : profits) queue.push_back(p.second);
        return queue;
    }
};

// ============================================================================
// Liquidation Engine
// ============================================================================

class LiquidationEngine {
public:
    struct LiquidateEvent {
        uint64_t position_id;
        uint64_t user_id;
        uint64_t liquidation_price;
        uint64_t mark_price;
    };
    
    std::atomic<uint64_t> total_liquidated{0};
    std::atomic<uint64_t> total_volume{0};
    
    void on_price_update(uint64_t symbol, uint64_t mark_price) {
        // Check all positions for symbol
    }
    
    void queue_liquidation(const Position& pos, uint64_t mark_price) {
        queue_.push({pos.position_id, pos.user_id, 
            LiquidationCalculator::calculate_liquidation_price(pos), mark_price});
    }
    
    bool process_liquidation() {
        if (queue_.empty()) return false;
        auto event = queue_.front(); queue_.pop();
        total_liquidated.fetch_add(1);
        return true;
    }

private:
    std::queue<LiquidateEvent> queue_;
};

// Factory
std::unique_ptr<LiquidationEngine> create() {
    return std::make_unique<LiquidationEngine>();
}

// ============================================================================
// Margin Call
// ============================================================================

class MarginCallService {
    static double calc_margin_ratio(
        uint64_t wallet, int64_t pnl, uint64_t margin
    ) {
        if (margin == 0) return INFINITY;
        return static_cast<double>(static_cast<int64_t>(wallet) + pnl) / margin;
    }
    
    // 0=OK, 1=margin call, 2=liquidate
    static uint8_t action(double ratio) {
        if (ratio < 0.10) return 2;
        if (ratio < 0.20) return 1;
        return 0;
    }
};

} // namespace tigerex