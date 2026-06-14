/**
 * TigerEx C++ Matching Engine
 * Risk Checker - Position Limits, Margin, Circuit Breakers
 * Target Latency: < 50 microseconds
 */

#include "matching_engine.hpp"
#include <unordered_map>
#include <vector>

namespace tigerex {

// ============================================================================
// RISK LIMITS
// ============================================================================

struct RiskLimits {
    // Position limits
    int64_t max_position{100000000000};  // $1B
    int64_t max_order_size{10000000000};   // $100M
    int64_t min_order_size{100};            // $0.01
    
    // Margin requirements
    int64_t initial_margin_rate{1000000};  // 10% default
    int64_t maintenance_margin_rate{500000};  // 5% maintenance
    int64_t margin_call_level{300000};  // 3% maintenance margin
    
    // Leverage
    int max_leverage{125};  // 125x max (0.8% margin)
    int default_leverage{10}; // 10x default
    
    // Concentration limits
    double max_concentration{0.1};  // 10% of order book
    double max_order_book_share{0.05};  // 5% of book depth
    
    // Velocity limits
    uint32_t orders_per_second{1000};
    uint32_t orders_per_minute{10000};
    uint32_t orders_per_hour{100000};
    
    // Cancel limits
    uint32_t cancels_per_minute{100};
    
    // IP limits
    uint32_t connections_per_ip{100};
};

// ============================================================================
// USER RISK PROFILE
// ============================================================================

struct UserRiskProfile {
    uint64_t user_id;
    
    // Tier levels
    int tier{0};  // 0=basic, 1=verified, 2=premium, 3=vip
    
    // Limits
    RiskLimits limits;
    
    // Usage tracking
    uint32_t orders_this_second{0};
    uint32_t orders_this_minute{0};
    uint32_t orders_this_hour{0};
    uint32_t cancels_this_minute{0};
    
    // Timestamps
    uint64_t last_order_time{0};
    uint64_t last_cancel_time{0};
    uint64_t account_created{0};
    uint64_t last_activity{0};
    
    // Risk flags
    bool kyc_verified{false};
    bool ban_status{false};
    bool withdrawal_lock{false};
    bool trading_lock{false};
    
    // IP tracking
    std::vector<std::string> recent_ips;
};

// ============================================================================
// RISK MANAGER
// ============================================================================

class RiskManager {
public:
    RiskManager() = default;
    ~RiskManager() = default;
    
    // ============================================================================
    // USER RISK PROFILES
    // ============================================================================
    
    /**
     * Create user risk profile
     */
    void create_user_profile(uint64_t user_id, int tier) {
        UserRiskProfile profile;
        profile.user_id = user_id;
        profile.tier = tier;
        profile.account_created = std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
        profiles_[user_id] = profile;
    }
    
    /**
     * Get user profile
     */
    UserRiskProfile* get_profile(uint64_t user_id) {
        auto it = profiles_.find(user_id);
        if (it == profiles_.end()) return nullptr;
        return &it->second;
    }
    
    /**
     * Check if user is restricted
     */
    bool is_user_restricted(uint64_t user_id) {
        auto* profile = get_profile(user_id);
        if (!profile) return true;
        return profile->ban_status || profile->trading_lock;
    }
    
    // ============================================================================
    // ORDER RISK CHECKS
    // ============================================================================
    
    /**
     * Check order risk
     */
    RiskCheckResult check_order_risk(const Order& order) {
        RiskCheckResult result;
        result.allowed = true;
        
        auto* profile = get_profile(order.user_id);
        if (!profile) {
            result.allowed = false;
            result.reason = "User profile not found";
            return result;
        }
        
        // Check ban status
        if (profile->ban_status) {
            result.allowed = false;
            result.reason = "Account suspended";
            return result;
        }
        
        // Check trading lock
        if (profile->trading_lock) {
            result.allowed = false;
            result.reason = "Trading locked";
            return result;
        }
        
        // Check velocity limits
        if (!check_velocity_limits(*profile, order.type)) {
            result.allowed = false;
            result.reason = "Rate limit exceeded";
            return result;
        }
        
        // Check order size
        int64_t order_value = order.price[0] * order.quantity[0];
        if (order_value > profile->limits.max_order_size) {
            result.allowed = false;
            result.reason = "Order size exceeds limit";
            return result;
        }
        
        if (order_value < profile->limits.min_order_size) {
            result.allowed = false;
            result.reason = "Order size below minimum";
            return result;
        }
        
        return result;
    }
    
    /**
     * Check position risk
     */
    RiskCheckResult check_position_risk(uint64_t user_id, const std::string& symbol,
                                     int64_t position, int64_t order_value) {
        RiskCheckResult result;
        result.allowed = true;
        
        auto* profile = get_profile(user_id);
        if (!profile) {
            result.allowed = false;
            result.reason = "User profile not found";
            return result;
        }
        
        // Check position limit
        int64_t new_position = position + order_value;
        if (std::abs(new_position) > profile->limits.max_position) {
            result.allowed = false;
            result.reason = "Position limit exceeded";
            return result;
        }
        
        // Check margin
        result.margin_required = order_value * profile->limits.initial_margin_rate / 1000000;
        result.position_value = std::abs(new_position);
        
        return result;
    }
    
    // ============================================================================
    // MARGIN CHECKS
    // ============================================================================
    
    /**
     * Calculate margin requirement
     */
    int64_t calculate_margin_requirement(const Order& order, int leverage) {
        int64_t order_value = order.price[0] * order.quantity[0];
        return order_value / leverage;
    }
    
    /**
     * Check margin availability
     */
    bool check_margin_availability(uint64_t user_id, int64_t required_margin,
                                  int64_t available_balance) {
        return available_balance >= required_margin;
    }
    
    /**
     * Check margin call
     */
    bool check_margin_call(int64_t position_value, int64_t margin_balance) {
        int64_t margin_ratio = margin_balance * 100 / position_value;
        return margin_ratio < 500000;  // 5% = 500000 in bps
    }
    
    /**
     * Check liquidation
     */
    bool check_liquidation(int64_t position_value, int64_t margin_balance) {
        int64_t margin_ratio = margin_balance * 100 / position_value;
        return margin_ratio < 300000;  // 3% = 300000 in bps
    }
    
    // ============================================================================
    // CONCENTRATION CHECKS
    // ============================================================================
    
    /**
     * Check order book concentration
     */
    bool check_concentration(const Order& order, const OrderBook& book,
                          double max_share) {
        // Get depth at price level
        auto depth = book.get_depth(10);
        
        // Calculate total quantity at price levels
        int64_t total_qty = 0;
        for (const auto& level : (order.side == OrderSide::Buy ? depth[1] : depth[0])) {
            total_qty += level.quantity[0];
        }
        
        if (total_qty == 0) return true;
        
        double share = static_cast<double>(order.quantity[0]) / total_qty;
        return share <= max_share;
    }
    
    // ============================================================================
    // VELOCITY LIMITS
    // ============================================================================
    
    /**
     * Check velocity limits
     */
    bool check_velocity_limits(const UserRiskProfile& profile, OrderType type) {
        if (profile.orders_this_second >= profile.limits.orders_per_second) {
            return false;
        }
        
        if (profile.orders_this_minute >= profile.limits.orders_per_minute) {
            return false;
        }
        
        if (profile.orders_this_hour >= profile.limits.orders_per_hour) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Update velocity counters
     */
    void update_velocity(const UserRiskProfile& profile, OrderType type) {
        // Update counters
        // In production, implement proper counter updates
        (void)profile;
        (void)type;
    }
    
    // ============================================================================
    // CIRCUIT BREAKER
    // ============================================================================
    
    /**
     * Check circuit breaker
     */
    bool check_circuit_breaker(const std::string& symbol, const Price& last_price,
                              const Price& current_price) {
        if (last_price[0] == 0) return false;
        
        int64_t change = std::abs(current_price[0] - last_price[0]) * 100 / last_price[0];
        
        // 10% move triggers circuit breaker
        return change > 10;
    }
    
    /**
     * Calculate price band
     */
    std::array<Price, 2> calculate_price_band(const Price& reference_price,
                                            double percentage) {
        std::array<Price, 2> band;
        
        int64_t offset = reference_price[0] * percentage / 100;
        band[0][0] = reference_price[0] - offset;
        band[0][1] = reference_price[1];
        band[1][0] = reference_price[0] + offset;
        band[1][1] = reference_price[1];
        
        return band;
    }
    
    // ============================================================================
    // ANOMALY DETECTION
    // ============================================================================
    
    /**
     * Detect wash trading
     */
    bool detect_wash_trading(uint64_t user_id, const std::vector<Trade>& trades) {
        if (trades.size() < 10) return false;
        
        // Check for circular trading
        for (size_t i = 0; i < trades.size() - 1; ++i) {
            if (trades[i].maker_order_id == trades[i + 1].taker_order_id ||
                trades[i].taker_order_id == trades[i + 1].maker_order_id) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Detect spoofing
     */
    bool detect_spoofing(const Order& order, const OrderBook& book) {
        // Large order with minimal intention to fill
        if (order.quantity[0] > 10000000000 && order.type == OrderType::Limit) {
            // Check if there's matching liquidity
            auto depth = book.get_depth(5);
            int64_t liquidity = 0;
            
            for (const auto& level : (order.side == OrderSide::Buy ? depth[1] : depth[0])) {
                liquidity += level.quantity[0];
            }
            
            // If no liquidity, suspicious
            return liquidity == 0;
        }
        
        return false;
    }
    
    /**
     * Detect layering
     */
    bool detect_layering(const Order& order, const OrderBook& book) {
        // Multiple orders at similar price levels
        auto depth = book.get_depth(10);
        
        int count = 0;
        for (const auto& level : (order.side == OrderSide::Buy ? depth[0] : depth[1])) {
            if (std::abs(level.price[0] - order.price[0]) < order.price[0] / 1000) {
                count++;
            }
        }
        
        return count >= 3;
    }
    
    // ============================================================================
    // TIER MANAGEMENT
    // ============================================================================
    
    /**
     * Update user tier
     */
    void update_user_tier(uint64_t user_id, int tier) {
        auto* profile = get_profile(user_id);
        if (profile) {
            profile->tier = tier;
            
            // Update limits based on tier
            switch (tier) {
                case 0:  // Basic
                    profile->limits.max_position = 1000000000;  // $10K
                    profile->limits.max_order_size = 100000000;   // $1K
                    profile->limits.max_leverage = 3;
                    break;
                case 1:  // Verified
                    profile->limits.max_position = 100000000000;  // $100K
                    profile->limits.max_order_size = 10000000000;   // $100K
                    profile->limits.max_leverage = 10;
                    break;
                case 2:  // Premium
                    profile->limits.max_position = 1000000000000ULL;  // $1M
                    profile->limits.max_order_size = 100000000000;  // $1M
                    profile->limits.max_leverage = 50;
                    break;
                case 3:  // VIP
                    profile->limits.max_position = 10000000000000ULL;  // $10M
                    profile->limits.max_order_size = 1000000000000ULL;  // $10M
                    profile->limits.max_leverage = 125;
                    break;
            }
        }
    }
    
    /**
     * Lock user account
     */
    void lock_user(uint64_t user_id, bool trading, bool withdrawal) {
        auto* profile = get_profile(user_id);
        if (profile) {
            profile->trading_lock = trading;
            profile->withdrawal_lock = withdrawal;
        }
    }
    
    /**
     * Ban user
     */
    void ban_user(uint64_t user_id) {
        auto* profile = get_profile(user_id);
        if (profile) {
            profile->ban_status = true;
        }
    }
    
private:
    std::unordered_map<uint64_t, UserRiskProfile> profiles_;
};

// ============================================================================
// RISK CHECK IMPLEMENTATION
// ============================================================================

RiskCheckResult check_full_risk(RiskManager& rm, const Order& order,
                                const OrderBook& book, int64_t balance) {
    RiskCheckResult result;
    
    // Check user risk
    result = rm.check_order_risk(order);
    if (!result.allowed) return result;
    
    // Check position risk
    int64_t position = 0;  // Get from position manager
    result = rm.check_position_risk(order.user_id, order.symbol, 
                                    position, order.price[0] * order.quantity[0]);
    if (!result.allowed) return result;
    
    // Check margin
    if (order.market_type == MarketType::Margin ||
        order.market_type == MarketType::Futures) {
        
        int64_t margin_required = rm.calculate_margin_requirement(order, 10);
        if (!rm.check_margin_availability(order.user_id, margin_required, balance)) {
            result.allowed = false;
            result.reason = "Insufficient margin";
            return result;
        }
    }
    
    // Check concentration
    if (!rm.check_concentration(order, book, 0.1)) {
        result.allowed = false;
        result.reason = "Order concentration too high";
        return result;
    }
    
    // Check for anomalies
    if (rm.detect_spoofing(order, book)) {
        result.allowed = false;
        result.reason = "Suspicious order pattern detected";
        return result;
    }
    
    if (rm.detect_layering(order, book)) {
        result.allowed = false;
        result.reason = "Layering detected";
        return result;
    }
    
    result.allowed = true;
    return result;
}

} // namespace tigerex