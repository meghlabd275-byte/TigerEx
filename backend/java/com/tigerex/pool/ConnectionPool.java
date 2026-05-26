package com.tigerex.pool;

import java.util.concurrent.*;
import java.util.function.Supplier;

public class ConnectionPool {
    private BlockingQueue<Connection> pool;
    private int size;
    
    public ConnectionPool(int size) {
        this.size = size;
        this.pool = new LinkedBlockingQueue<>(size);
        
        for (int i = 0; i < size; i++) {
            pool.offer(new Connection());
        }
    }
    
    public Connection borrow() throws InterruptedException {
        return pool.take();
    }
    
    public void release(Connection conn) {
        pool.offer(conn);
    }
    
    public <T> T execute(Supplier<T> op) throws Exception {
        Connection conn = borrow();
        try {
            return op.get();
        } finally {
            release(conn);
        }
    }
    
    public static class Connection {
        public boolean isHealthy() { return true; }
        public void close() {}
    }
}