/**
 * TigerEx C++ Matching Engine
 * Risk Checker - Position Limits, Margin, Circuit Breakers
 * Target Latency: < 50 microseconds
 */

#include "matching_engine.hpp"
#include "risk_manager.hpp"
#include <limits>
#include <string>
#include <unordered_map>
#include <vector>

namespace tigerex {

// ============================================================================
// RISK CHECK IMPLEMENTATION
// ============================================================================

RiskCheckResult check_full_risk(RiskManager& rm, const Order& order,
                                const OrderBook& book, int64_t balance,
                                int64_t current_position, int leverage) {
    RiskCheckResult result;

    // Check user risk (status, KYC, bans, velocity).
    result = rm.check_order_risk(order);
    if (!result.allowed) return result;

    // The profile is needed for the position and concentration limits. It was
    // already required by check_order_risk, but resolve it here so a caller
    // that reordered the checks cannot reach the limit reads with a null
    // profile.
    const UserRiskProfile* profile = rm.get_profile(order.user_id);
    if (profile == nullptr) {
        result.allowed = false;
        result.reason = "User profile not found";
        return result;
    }

    // check_order_risk() above has already rejected a non-positive or
    // overflowing notional, so this product is a valid positive int64.
    const int64_t order_value = order.price[0] * order.quantity[0];

    // Check position risk against the caller-supplied position. Passing a
    // fabricated zero here would disable the position limit entirely.
    result = rm.check_position_risk(order.user_id, order.symbol,
                                    current_position, order_value);
    if (!result.allowed) return result;

    // Check margin.
    if (order.market_type == MarketType::Margin ||
        order.market_type == MarketType::Futures) {

        // A caller that does not track leverage passes 0; fall back to the
        // user's default rather than a hardcoded multiplier.
        const int effective_leverage =
            leverage > 0 ? leverage : profile->limits.default_leverage;

        const int64_t margin_required =
            rm.calculate_margin_requirement(order, effective_leverage);
        if (margin_required < 0) {
            // calculate_margin_requirement() returns -1 for invalid input;
            // treating that as a zero requirement would pass every balance.
            result.allowed = false;
            result.reason = "Invalid order or leverage";
            return result;
        }
        result.margin_required = margin_required;
        if (!rm.check_margin_availability(order.user_id, margin_required, balance)) {
            result.allowed = false;
            result.reason = "Insufficient margin";
            return result;
        }
    }

    // Check concentration against the user's own limit.
    if (!rm.check_concentration(order, book, profile->limits.max_concentration)) {
        result.allowed = false;
        result.reason = "Order concentration too high";
        return result;
    }

    // Check for anomalies.
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
