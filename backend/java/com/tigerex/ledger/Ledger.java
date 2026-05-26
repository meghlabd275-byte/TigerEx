package com.tigerex.ledger;

import java.util.concurrent.ConcurrentSkipListMap;
import java.util.TreeMap;
import java.math.BigDecimal;

public class Ledger {
    private TreeMap<Long, Entry> entries = new TreeMap<>();
    private long nextId = 0;
    
    public synchronized long addEntry(String userId, BigDecimal amount, String type, String ref) {
        long id = nextId++;
        entries.put(id, new Entry(id, userId, amount, type, ref, System.currentTimeMillis()));
        return id;
    }
    
    public Entry getEntry(long id) {
        return entries.get(id);
    }
    
    public BigDecimal getBalance(String userId) {
        BigDecimal balance = BigDecimal.ZERO;
        for (Entry e : entries.values()) {
            if (e.userId.equals(userId)) {
                if ("credit".equals(e.type)) {
                    balance = balance.add(e.amount);
                } else {
                    balance = balance.subtract(e.amount);
                }
            }
        }
        return balance;
    }
    
    public static class Entry {
        public final long id;
        public final String userId;
        public final BigDecimal amount;
        public final String type;
        public final String ref;
        public final long timestamp;
        
        public Entry(long id, String uid, BigDecimal a, String t, String r, long ts) {
            this.id = id;
            this.userId = uid;
            this.amount = a;
            this.type = t;
            this.ref = r;
            this.timestamp = ts;
        }
    }
}