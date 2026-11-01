/**
 * TigerEx C++ Matching Engine
 * Risk Checker - Position Limits, Margin, Circuit Breakers
 * Target Latency: < 50 microseconds
 */

#include "matching_engine.hpp"
#include "risk_manager.hpp"
#include <unordered_map>
#include <vector>
#include <limits>

namespace tigerex {

// check_full_risk() and the RiskManager implementation. The manager itself
// is declared in include/risk_manager.hpp so the engine and gateway can use it.

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