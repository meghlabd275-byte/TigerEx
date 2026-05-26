package com.tigerex.trading;

import java.util.*;
import java.time.Instant;

// ============================================================================
// ENUMS
// ============================================================================

enum OrderSide { BUY, SELL }
enum OrderType { MARKET, LIMIT, STOP_LOSS, TAKE_PROFIT }
enum OrderStatus { PENDING, OPEN, PARTIAL_FILLED, FILLED, CANCELLED, REJECTED }

// ============================================================================
// ORDER CLASS
// ============================================================================

public class OrderMatchingEngine {
    
    // Order class
    static class Order {
        String id;
        String userId;
        String symbol;
        OrderSide side;
        OrderType type;
        double quantity;
        double price;
        double filledQty;
        double avgPrice;
        OrderStatus status;
        long createdAt;
        long updatedAt;
        
        Order(String id, String userId, String symbol, OrderSide side, 
             OrderType type, double quantity, double price) {
            this.id = id;
            this.userId = userId;
            this.symbol = symbol;
            this.side = side;
            this.type = type;
            this.quantity = quantity;
            this.price = price;
            this.filledQty = 0;
            this.avgPrice = 0;
            this.status = OrderStatus.PENDING;
            this.createdAt = Instant.now().toEpochMilli();
            this.updatedAt = this.createdAt;
        }
        
        double remainingQty() { return quantity - filledQty; }
    }
    
    // Trade class
    static class Trade {
        String id;
        String makerOrderId;
        String takerOrderId;
        String symbol;
        OrderSide side;
        double price;
        double quantity;
        long timestamp;
        
        Trade(String id, String mid, String tid, String sym, OrderSide sd, 
             double px, double qty) {
            this.id = id;
            this.makerOrderId = mid;
            this.takerOrderId = tid;
            this.symbol = sym;
            this.side = sd;
            this.price = px;
            this.quantity = qty;
            this.timestamp = Instant.now().toEpochMilli();
        }
    }
    
    // Private fields
    private final Map<String, Order> orders = new HashMap<>();
    private final Map<String, List<Order>> orderBook = new HashMap<>();
    private final List<Trade> trades = new ArrayList<>();
    private long orderCounter = 0;
    private long tradeCounter = 0;
    
    // ============================================================================
    // ORDER MANAGEMENT
    // ============================================================================
    
    public Order createOrder(String userId, String symbol, OrderSide side,
                        OrderType type, double quantity, double price) {
        orderCounter++;
        String id = "ORD-" + orderCounter;
        
        Order order = new Order(id, userId, symbol, side, type, quantity, price);
        
        if (type == OrderType.MARKET) {
            order.status = OrderStatus.OPEN;
        }
        
        orders.put(id, order);
        
        // Add to order book
        String key = symbol + "-" + side;
        orderBook.computeIfAbsent(key, k -> new ArrayList<>()).add(order);
        
        return order;
    }
    
    public boolean cancelOrder(String orderId, String userId) {
        Order order = orders.get(orderId);
        if (order == null || !order.userId.equals(userId)) {
            return false;
        }
        if (order.status == OrderStatus.FILLED || order.status == OrderStatus.CANCELLED) {
            return false;
        }
        
        order.status = OrderStatus.CANCELLED;
        order.updatedAt = Instant.now().toEpochMilli();
        return true;
    }
    
    public Order getOrder(String orderId) {
        return orders.get(orderId);
    }
    
    // ============================================================================
    // MATCHING LOGIC
    // ============================================================================
    
    public List<Trade> matchOrders(String symbol, double marketPrice) {
        List<Trade> executedTrades = new ArrayList<>();
        
        List<Order> buys = getOrders(symbol, OrderSide.BUY);
        List<Order> sells = getOrders(symbol, OrderSide.SELL);
        
        // Sort: buys descending by price, sells ascending by price
        buys.sort((a, b) -> Double.compare(b.price, a.price));
        sells.sort(Comparator.comparingDouble(a -> a.price));
        
        for (Order buy : buys) {
            if (buy.status != OrderStatus.OPEN) continue;
            
            double executePrice = buy.type == OrderType.MARKET ? marketPrice : buy.price;
            
            for (Order sell : sells) {
                if (sell.status != OrderStatus.OPEN) continue;
                if (executePrice >= sell.price) {
                    // Match!
                    double matchQty = Math.min(buy.remainingQty(), sell.remainingQty());
                    
                    tradeCounter++;
                    Trade trade = new Trade(
                        "TRD-" + tradeCounter,
                        sell.id, // Maker (sell)
                        buy.id,  // Taker (buy)
                        symbol,
                        buy.side,
                        sell.price,
                        matchQty
                    );
                    trades.add(trade);
                    
                    // Update orders
                    buy.filledQty += matchQty;
                    sell.filledQty += matchQty;
                    
                    double totalCost = (buy.filledQty - matchQty) * buy.avgPrice + matchQty * sell.price;
                    buy.avgPrice = totalCost / buy.filledQty;
                    
                    sell.avgPrice = sell.price;
                    
                    if (buy.remainingQty() == 0) {
                        buy.status = OrderStatus.FILLED;
                    } else {
                        buy.status = OrderStatus.PARTIAL_FILLED;
                    }
                    
                    if (sell.remainingQty() == 0) {
                        sell.status = OrderStatus.FILLED;
                    } else {
                        sell.status = OrderStatus.PARTIAL_FILLED;
                    }
                    
                    buy.updatedAt = Instant.now().toEpochMilli();
                    sell.updatedAt = Instant.now().toEpochMilli();
                    
                    executedTrades.add(trade);
                    
                    break; // One match per buy order
                }
            }
        }
        
        return executedTrades;
    }
    
    // ============================================================================
    // QUERIES
    // ============================================================================
    
    private List<Order> getOrders(String symbol, OrderSide side) {
        String key = symbol + "-" + side;
        List<Order> result = orderBook.get(key);
        return result != null ? result : Collections.emptyList();
    }
    
    public List<Order> getOpenOrders(String symbol) {
        List<Order> result = new ArrayList<>();
        for (Order o : orders.values()) {
            if (o.symbol.equals(symbol) && 
                (o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIAL_FILLED)) {
                result.add(o);
            }
        }
        return result;
    }
    
    public List<Trade> getRecentTrades(String symbol, int limit) {
        List<Trade> symbolTrades = new ArrayList<>();
        for (Trade t : trades) {
            if (t.symbol.equals(symbol)) {
                symbolTrades.add(t);
            }
        }
        // Return most recent
        int from = Math.max(0, symbolTrades.size() - limit);
        return symbolTrades.subList(from, symbolTrades.size());
    }
    
    // ============================================================================
    // STATS
    // ============================================================================
    
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalOrders", orders.size());
        stats.put("totalTrades", trades.size());
        
        long openOrders = orders.values().stream()
            .filter(o -> o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIAL_FILLED)
            .count();
        stats.put("openOrders", openOrders);
        
        return stats;
    }
    
    // ============================================================================
    // MAIN
    // ============================================================================
    
    public static void main(String[] args) {
        OrderMatchingEngine engine = new OrderMatchingEngine();
        
        // Create orders
        engine.createOrder("user1", "BTC/USDT", OrderSide.BUY, OrderType.LIMIT, 0.5, 50000);
        engine.createOrder("user2", "BTC/USDT", OrderSide.BUY, OrderType.LIMIT, 0.3, 50100);
        engine.createOrder("user3", "BTC/USDT", OrderSide.SELL, OrderType.LIMIT, 0.4, 50000);
        engine.createOrder("user4", "BTC/USDT", OrderSide.SELL, OrderType.LIMIT, 0.2, 49900);
        
        System.out.println("Before matching: " + engine.getStats());
        
        // Match
        List<Trade> matched = engine.matchOrders("BTC/USDT", 50000);
        System.out.println("Matched " + matched.size() + " trades");
        
        System.out.println("After matching: " + engine.getStats());
        
        for (Trade t : matched) {
            System.out.printf("Trade: %s @ $%.2f qty: %.2f\n", 
                          t.id, t.price, t.quantity);
        }
    }
}