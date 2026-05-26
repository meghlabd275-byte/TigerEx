// Pool - Connection Pool
// Rus for database/service connection pooling

use std::collections::VecDeque;

// Pool configuration
#[derive(Debug, Clone)]
pub struct PoolConfig {
    pub min_connections: u32,
    pub max_connections: u32,
    pub max_idle_time: i64, // ms
    pub connection_timeout: i64, // ms
}

// Connection wrapper
#[derive(Debug, Clone)]
pub struct PooledConnection {
    pub id: String,
    pub created_at: i64,
    pub last_used: i64,
    pub in_use: bool,
}

// Connection pool
pub struct ConnectionPool {
    config: PoolConfig,
    available: VecDeque<PooledConnection>,
    in_use: Vec<PooledConnection>,
    total_created: u32,
}

impl ConnectionPool {
    pub fn new(config: PoolConfig) -> Self {
        ConnectionPool {
            config,
            available: VecDeque::new(),
            in_use: Vec::new(),
            total_created: 0,
        }
    }

    // Acquire connection
    pub fn acquire(&mut self) -> Result<PooledConnection, String> {
        // Try reusable connection
        while let Some(conn) = self.available.pop_front() {
            if now_ms() - conn.last_used < self.config.max_idle_time {
                let mut conn = conn;
                conn.in_use = true;
                conn.last_used = now_ms();
                self.in_use.push(conn.clone());
                return Ok(conn);
            }
        }

        // Create new connection
        if self.total_created < self.config.max_connections {
            self.total_created += 1;

            let conn = PooledConnection {
                id: format!("conn_{}", self.total_created),
                created_at: now_ms(),
                last_used: now_ms(),
                in_use: true,
            };

            self.in_use.push(conn.clone());
            return Ok(conn);
        }

        Err("pool exhausted".to_string())
    }

    // Release connection
    pub fn release(&mut self, conn_id: &str) -> Result<(), String> {
        for i in 0..self.in_use.len() {
            if self.in_use[i].id == conn_id {
                let mut conn = self.in_use.remove(i);
                conn.in_use = false;
                conn.last_used = now_ms();
                self.available.push_back(conn);
                return Ok(());
            }
        }

        Err("connection not found".to_string())
    }

    // Get stats
    pub fn stats(&self) -> (usize, usize) {
        (self.available.len(), self.in_use.len())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool() {
        let config = PoolConfig {
            min_connections: 1,
            max_connections: 10,
            max_idle_time: 60000,
            connection_timeout: 5000,
        };

        let mut pool = ConnectionPool::new(config);

        let conn = pool.acquire();
        assert!(conn.is_ok());

        pool.release("conn_1").unwrap();
    }
}