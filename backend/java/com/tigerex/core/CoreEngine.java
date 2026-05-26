package com.tigerex.core;

import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;

public class CoreEngine {
    private static CoreEngine instance;
    private ConcurrentHashMap<String, Market> markets = new ConcurrentHashMap<>();
    private ConcurrentHashMap<String, User> users = new ConcurrentHashMap<>();
    
    private CoreEngine() {}
    
    public static CoreEngine getInstance() {
        if (instance == null) {
            synchronized (CoreEngine.class) {
                if (instance == null) {
                    instance = new CoreEngine();
                }
            }
        }
        return instance;
    }
    
    public void addMarket(String symbol, Market market) {
        markets.put(symbol, market);
    }
    
    public Market getMarket(String symbol) {
        return markets.get(symbol);
    }
    
    public static class Market {
        public final String symbol;
        public final double price;
        public final double volume;
        
        public Market(String s, double p, double v) {
            this.symbol = s;
            this.price = p;
            this.volume = v;
        }
    }
    
    public static class User {
        public final String id;
        public final double balance;
        
        public User(String id, double balance) {
            this.id = id;
            this.balance = balance;
        }
    }
}