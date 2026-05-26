package com.tigerex.wallet;

import java.util.concurrent.ConcurrentHashMap;
import java.math.BigDecimal;

public class WalletManager {
    private ConcurrentHashMap<String, Wallet> wallets = new ConcurrentHashMap<>();
    
    public Wallet getOrCreate(String userId) {
        return wallets.computeIfAbsent(userId, k -> new Wallet(k));
    }
    
    public boolean debit(String userId, BigDecimal amount) {
        Wallet w = wallets.get(userId);
        return w != null && w.debit(amount);
    }
    
    public boolean credit(String userId, BigDecimal amount) {
        Wallet w = wallets.get(userId);
        if (w != null) {
            w.credit(amount);
            return true;
        }
        return false;
    }
    
    public static class Wallet {
        public final String userId;
        public BigDecimal balance;
        
        public Wallet(String userId) {
            this.userId = userId;
            this.balance = BigDecimal.ZERO;
        }
        
        public synchronized boolean debit(BigDecimal amount) {
            if (balance.compareTo(amount) >= 0) {
                balance = balance.subtract(amount);
                return true;
            }
            return false;
        }
        
        public synchronized void credit(BigDecimal amount) {
            balance = balance.add(amount);
        }
        
        public BigDecimal getBalance() {
            return balance;
        }
    }
}