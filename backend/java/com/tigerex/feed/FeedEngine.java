package com.tigerex.feed;

import java.util.*;
import java.util.concurrent.*;

public class FeedEngine {
    private ConcurrentHashMap<String, Double> prices = new ConcurrentHashMap<>();
    private BlockingQueue<PriceUpdate> queue = new LinkedBlockingQueue<>();
    
    public void update(String symbol, double price) {
        prices.put(symbol, price);
        queue.offer(new PriceUpdate(symbol, price, System.currentTimeMillis()));
    }
    
    public Double getPrice(String symbol) {
        return prices.get(symbol);
    }
    
    public PriceUpdate poll() {
        return queue.poll();
    }
    
    public static class PriceUpdate {
        public final String symbol;
        public final double price;
        public final long timestamp;
        
        public PriceUpdate(String s, double p, long t) {
            this.symbol = s;
            this.price = p;
            this.timestamp = t;
        }
    }
}