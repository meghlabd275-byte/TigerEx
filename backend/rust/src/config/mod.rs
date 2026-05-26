pub mod config {
    use std::collections::HashMap;
    use serde::{Deserialize, Serialize};
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct Config {
        pub server: ServerConfig,
        pub database: DatabaseConfig,
        pub cache: CacheConfig,
        pub logging: LoggingConfig,
    }
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ServerConfig {
        pub host: String,
        pub port: u16,
        pub workers: usize,
    }
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct DatabaseConfig {
        pub host: String,
        pub port: u16,
        pub pool_size: usize,
    }
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct CacheConfig {
        pub redis_url: String,
        pub ttl_seconds: u64,
    }
    
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct LoggingConfig {
        pub level: String,
        pub output: String,
    }
    
    impl Default for Config {
        fn default() -> Self {
            Config {
                server: ServerConfig {
                    host: "0.0.0.0".to_string(),
                    port: 8080,
                    workers: 4,
                },
                database: DatabaseConfig {
                    host: "localhost".to_string(),
                    port: 5432,
                    pool_size: 10,
                },
                cache: CacheConfig {
                    redis_url: "redis://localhost:6379".to_string(),
                    ttl_seconds: 300,
                },
                logging: LoggingConfig {
                    level: "info".to_string(),
                    output: "stdout".to_string(),
                },
            }
        }
    }
}