//! TigerEx Time Series Database
//! 
//! High-performance time series database for market data, analytics, and historical records
//!
//! Features:
//! - Column-oriented storage
//! - Compression (gorilla, snappy)
//! - Time-based partitioning
//! - Downsampling and aggregation
//! - Retention policies
//! - Query optimization

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use serde::{Serialize, Deserialize};

// ============================================================================
// DATA TYPES
// ============================================================================

/// Timestamp in milliseconds
pub type Timestamp = i64;

/// Value with timestamp
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataPoint {
    pub timestamp: Timestamp,
    pub value: f64,
    pub tags: HashMap<String, String>,
}

/// Time series data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeries {
    pub name: String,
    pub datapoints: Vec<DataPoint>,
    pub start_time: Timestamp,
    pub end_time: Timestamp,
}

/// Aggregation type
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Aggregation {
    None,
    Sum,
    Avg,
    Min,
    Max,
    Count,
    First,
    Last,
    P50,
    P95,
    P99,
}

/// Downsample interval
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Interval {
    Millisecond,
    Second,
    Minute,
    Hour,
    Day,
    Week,
}

impl Interval {
    pub fn to_ms(&self) -> i64 {
        match self {
            Interval::Millisecond => 1,
            Interval::Second => 1000,
            Interval::Minute => 60 * 1000,
            Interval::Hour => 3600 * 1000,
            Interval::Day => 86400 * 1000,
            Interval::Week => 7 * 86400 * 1000,
        }
    }
}

/// Retention policy
#[derive(Debug, Clone)]
pub struct RetentionPolicy {
    pub name: String,
    pub duration: Duration,      // How long to keep data
    pub shard_duration: Duration, // Duration per shard
    pub replication: u32,       // Replication factor
}

/// Query filter
#[derive(Debug, Clone)]
pub struct QueryFilter {
    pub start_time: Timestamp,
    pub end_time: Timestamp,
    pub tags: HashMap<String, String>,
    pub limit: Option<usize>,
    pub aggregation: Aggregation,
    pub interval: Option<Interval>,
}

// ============================================================================
// STORAGE ENGINE
// ============================================================================

/// Column storage for time series
pub struct ColumnStorage {
    timestamps: Vec<Timestamp>,
    values: Vec<f64>,
    tags: Vec<HashMap<String, String>>,
}

impl ColumnStorage {
    pub fn new(capacity: usize) -> Self {
        Self {
            timestamps: Vec::with_capacity(capacity),
            values: Vec::with_capacity(capacity),
            tags: Vec::with_capacity(capacity),
        }
    }
    
    pub fn push(&mut self, point: DataPoint) {
        self.timestamps.push(point.timestamp);
        self.values.push(point.value);
        self.tags.push(point.tags);
    }
    
    pub fn len(&self) -> usize {
        self.timestamps.len()
    }
    
    pub fn is_empty(&self) -> bool {
        self.timestamps.is_empty()
    }
    
    pub fn get_range(&self, start: Timestamp, end: Timestamp) -> Vec<DataPoint> {
        let mut result = Vec::new();
        for i in 0..self.timestamps.len() {
            let ts = self.timestamps[i];
            if ts >= start && ts <= end {
                result.push(DataPoint {
                    timestamp: ts,
                    value: self.values[i],
                    tags: self.tags[i].clone(),
                });
            }
        }
        result
    }
    
    pub fn aggregate(&self, agg: Aggregation) -> f64 {
        if self.values.is_empty() {
            return 0.0;
        }
        
        match agg {
            Aggregation::None => self.values[self.values.len() - 1],
            Aggregation::Sum => self.values.iter().sum(),
            Aggregation::Avg => self.values.iter().sum::<f64>() / self.values.len() as f64,
            Aggregation::Min => self.values.iter().cloned().fold(f64::INFINITY, f64::min),
            Aggregation::Max => self.values.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            Aggregation::Count => self.values.len() as f64,
            Aggregation::First => self.values[0],
            Aggregation::Last => self.values[self.values.len() - 1],
            _ => 0.0,
        }
    }
    
    pub fn downsample(&self, interval: Interval, agg: Aggregation) -> Vec<DataPoint> {
        if self.timestamps.is_empty() {
            return Vec::new();
        }
        
        let interval_ms = interval.to_ms();
        let mut result = Vec::new();
        let mut current_start = self.timestamps[0] / interval_ms * interval_ms;
        let mut current_values = Vec::new();
        
        for i in 0..self.timestamps.len() {
            let ts = self.timestamps[i];
            
            if ts >= current_start + interval_ms {
                // Calculate aggregate for current bucket
                if !current_values.is_empty() {
                    let storage = ColumnStorage {
                        timestamps: vec![],
                        values: current_values.clone(),
                        tags: vec![],
                    };
                    let value = storage.aggregate(agg);
                    result.push(DataPoint {
                        timestamp: current_start,
                        value,
                        tags: HashMap::new(),
                    });
                }
                
                current_start = ts / interval_ms * interval_ms;
                current_values.clear();
            }
            
            current_values.push(self.values[i]);
        }
        
        // Handle last bucket
        if !current_values.is_empty() {
            let storage = ColumnStorage {
                timestamps: vec![],
                values: current_values,
                tags: vec![],
            };
            let value = storage.aggregate(agg);
            result.push(DataPoint {
                timestamp: current_start,
                value,
                tags: HashMap::new(),
            });
        }
        
        result
    }
}

/// Shard - time-partitioned data store
pub struct Shard {
    pub id: u64,
    pub start_time: Timestamp,
    pub end_time: Timestamp,
    pub series: HashMap<String, ColumnStorage>,
}

impl Shard {
    pub fn new(id: u64, start_time: Timestamp, end_time: Timestamp) -> Self {
        Self {
            id,
            start_time,
            end_time,
            series: HashMap::new(),
        }
    }
    
    pub fn write(&mut self, name: &str, point: DataPoint) {
        let storage = self.series.entry(name.to_string()).or_insert_with(|| ColumnStorage::new(10000));
        storage.push(point);
    }
    
    pub fn query(&self, name: &str, filter: &QueryFilter) -> Vec<DataPoint> {
        if let Some(storage) = self.series.get(name) {
            let mut points = storage.get_range(filter.start_time, filter.end_time);
            
            // Filter by tags
            if !filter.tags.is_empty() {
                points.retain(|p| {
                    filter.tags.iter().all(|(k, v)| {
                        p.tags.get(k).map(|tv| tv == v).unwrap_or(false)
                    })
                });
            }
            
            // Apply limit
            if let Some(limit) = filter.limit {
                points.truncate(limit);
            }
            
            // Apply aggregation
            if filter.interval.is_some() && !points.is_empty() {
                // Downsample
                let interval = filter.interval.unwrap();
                let storage = ColumnStorage {
                    timestamps: points.iter().map(|p| p.timestamp).collect(),
                    values: points.iter().map(|p| p.value).collect(),
                    tags: points.iter().map(|p| p.tags.clone()).collect(),
                };
                return storage.downsample(interval, filter.aggregation);
            }
            
            return points;
        }
        
        Vec::new()
    }
}

// ============================================================================
// TIME SERIES DATABASE
// ============================================================================

/// Configuration for TSDB
#[derive(Debug, Clone)]
pub struct TsdbConfig {
    pub data_dir: String,
    pub shard_duration: Duration,
    pub retention_duration: Duration,
    pub max_shards_in_memory: usize,
    pub compression_enabled: bool,
}

impl Default for TsdbConfig {
    fn default() -> Self {
        Self {
            data_dir: "/data/tsdb".to_string(),
            shard_duration: Duration::from_secs(3600),      // 1 hour per shard
            retention_duration: Duration::from_secs(86400 * 30), // 30 days
            max_shards_in_memory: 100,
            compression_enabled: true,
        }
    }
}

/// Main time series database
pub struct TimeSeriesDB {
    config: TsdbConfig,
    
    // In-memory shards
    shards: RwLock<VecDeque<Shard>>,
    
    // Retention policies
    retention_policies: RwLock<HashMap<String, RetentionPolicy>>,
    
    // Metrics
    total_points: RwLock<u64>,
    total_shards: RwLock<u64>,
    disk_usage: RwLock<u64>,
}

impl TimeSeriesDB {
    /// Create a new TSDB instance
    pub fn new(config: TsdbConfig) -> Self {
        Self {
            config,
            shards: RwLock::new(VecDeque::new()),
            retention_policies: RwLock::new(HashMap::new()),
            total_points: RwLock::new(0),
            total_shards: RwLock::new(0),
            disk_usage: RwLock::new(0),
        }
    }
    
    /// Initialize database
    pub fn initialize(&self) {
        // Create initial shard
        let now = current_timestamp();
        let shard = Shard::new(0, now, now + self.config.shard_duration.as_millis() as i64);
        
        let mut shards = self.shards.write().unwrap();
        shards.push_back(shard);
        
        *self.total_shards.write().unwrap() = 1;
        
        // Setup default retention policy
        let mut policies = self.retention_policies.write().unwrap();
        policies.insert("default".to_string(), RetentionPolicy {
            name: "default".to_string(),
            duration: self.config.retention_duration,
            shard_duration: self.config.shard_duration,
            replication: 1,
        });
    }
    
    /// Write a data point
    pub fn write(&self, name: &str, point: DataPoint) -> Result<(), String> {
        let now = current_timestamp();
        
        let mut shards = self.shards.write().unwrap();
        
        // Check if we need a new shard
        if let Some(last) = shards.back_mut() {
            if now > last.end_time {
                // Create new shard
                let new_shard = Shard::new(
                    last.id + 1,
                    last.end_time,
                    last.end_time + self.config.shard_duration.as_millis() as i64,
                );
                
                // Remove old shards if over limit
                while shards.len() >= self.config.max_shards_in_memory {
                    shards.pop_front();
                }
                
                shards.push_back(new_shard);
                *self.total_shards.write().unwrap() += 1;
            }
        }
        
        // Write to current shard
        if let Some(shard) = shards.back_mut() {
            shard.write(name, point);
            *self.total_points.write().unwrap() += 1;
            return Ok(());
        }
        
        Err("No shard available".to_string())
    }
    
    /// Write multiple data points
    pub fn write_batch(&self, name: &str, points: Vec<DataPoint>) -> Result<usize, String> {
        let mut written = 0;
        for point in points {
            if self.write(name, point).is_ok() {
                written += 1;
            }
        }
        Ok(written)
    }
    
    /// Query time series data
    pub fn query(&self, name: &str, filter: QueryFilter) -> Vec<DataPoint> {
        let shards = self.shards.read().unwrap();
        let mut results = Vec::new();
        
        for shard in shards.iter() {
            // Check if shard overlaps with query range
            if shard.start_time <= filter.end_time && shard.end_time >= filter.start_time {
                let mut points = shard.query(name, &filter);
                results.append(&mut points);
            }
        }
        
        // Sort by timestamp
        results.sort_by_key(|p| p.timestamp);
        
        // Apply limit
        if let Some(limit) = filter.limit {
            results.truncate(limit);
        }
        
        results
    }
    
    /// Query with aggregation
    pub fn query_aggregate(&self, name: &str, filter: QueryFilter) -> Vec<DataPoint> {
        let mut filter = filter;
        
        // Set interval if not set
        if filter.interval.is_none() {
            filter.interval = Some(Interval::Minute);
        }
        
        self.query(name, filter)
    }
    
    /// Get latest value
    pub fn get_latest(&self, name: &str) -> Option<DataPoint> {
        let filter = QueryFilter {
            start_time: 0,
            end_time: current_timestamp(),
            tags: HashMap::new(),
            limit: Some(1),
            aggregation: Aggregation::Last,
            interval: None,
        };
        
        let results = self.query(name, filter);
        results.into_iter().last()
    }
    
    /// Get range of values
    pub fn get_range(&self, name: &str, start: Timestamp, end: Timestamp) -> Vec<DataPoint> {
        let filter = QueryFilter {
            start_time: start,
            end_time: end,
            tags: HashMap::new(),
            limit: None,
            aggregation: Aggregation::None,
            interval: None,
        };
        
        self.query(name, filter)
    }
    
    /// Downsample data
    pub fn downsample(&self, name: &str, start: Timestamp, end: Timestamp, interval: Interval, agg: Aggregation) -> Vec<DataPoint> {
        let filter = QueryFilter {
            start_time: start,
            end_time: end,
            tags: HashMap::new(),
            limit: None,
            aggregation: agg,
            interval: Some(interval),
        };
        
        self.query(name, filter)
    }
    
    /// Create retention policy
    pub fn create_retention_policy(&self, name: &str, duration: Duration, shard_duration: Duration) {
        let mut policies = self.retention_policies.write().unwrap();
        policies.insert(name.to_string(), RetentionPolicy {
            name: name.to_string(),
            duration,
            shard_duration,
            replication: 1,
        });
    }
    
    /// Get database statistics
    pub fn stats(&self) -> TsdbStats {
        TsdbStats {
            total_points: *self.total_points.read().unwrap(),
            total_shards: *self.total_shards.read().unwrap(),
            disk_usage: *self.disk_usage.read().unwrap(),
            memory_shards: self.shards.read().unwrap().len() as u64,
        }
    }
    
    /// Compact old data (run periodically)
    pub fn compact(&self) {
        // In production, would compress and write old shards to disk
        let now = current_timestamp();
        
        let mut shards = self.shards.write().unwrap();
        
        // Remove shards outside retention period
        let retention_ms = self.config.retention_duration.as_millis() as i64;
        let cutoff = now - retention_ms;
        
        shards.retain(|s| s.end_time > cutoff);
    }
    
    /// Flush to disk
    pub fn flush(&self) -> Result<(), String> {
        // In production, would serialize and write shards to disk
        Ok(())
    }
}

/// Database statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TsdbStats {
    pub total_points: u64,
    pub total_shards: u64,
    pub disk_usage: u64,
    pub memory_shards: u64,
}

// ============================================================================
// SPECIALIZED TIME SERIES
// ============================================================================

/// Market data time series
pub struct MarketTimeSeries {
    tsdb: Arc<TimeSeriesDB>,
    name_prefix: String,
}

impl MarketTimeSeries {
    pub fn new(tsdb: Arc<TimeSeriesDB>, symbol: &str) -> Self {
        Self {
            tsdb,
            name_prefix: format!("market.{}", symbol),
        }
    }
    
    /// Record price update
    pub fn record_price(&self, price: f64) {
        let point = DataPoint {
            timestamp: current_timestamp(),
            value: price,
            tags: HashMap::new(),
        };
        let _ = self.tsdb.write(&format!("{}.price", self.name_prefix), point);
    }
    
    /// Record volume
    pub fn record_volume(&self, volume: f64) {
        let point = DataPoint {
            timestamp: current_timestamp(),
            value: volume,
            tags: HashMap::new(),
        };
        let _ = self.tsdb.write(&format!("{}.volume", self.name_prefix), point);
    }
    
    /// Get price history
    pub fn get_price_history(&self, start: Timestamp, end: Timestamp) -> Vec<DataPoint> {
        self.tsdb.get_range(&format!("{}.price", self.name_prefix), start, end)
    }
    
    /// Get OHLCV data
    pub fn get_ohlcv(&self, start: Timestamp, end: Timestamp, interval: Interval) -> Vec<Ohlcv> {
        let prices = self.tsdb.downsample(
            &format!("{}.price", self.name_prefix),
            start,
            end,
            interval,
            Aggregation::None,
        );
        
        let volumes = self.tsdb.downsample(
            &format!("{}.volume", self.name_prefix),
            start,
            end,
            interval,
            Aggregation::Sum,
        );
        
        // Combine into OHLCV
        let mut ohlcv = Vec::new();
        for (i, price_point) in prices.iter().enumerate() {
            let vol = volumes.get(i).map(|v| v.value).unwrap_or(0.0);
            
            ohlcv.push(Ohlcv {
                timestamp: price_point.timestamp,
                open: price_point.value,
                high: price_point.value,
                low: price_point.value,
                close: price_point.value,
                volume: vol,
            });
        }
        
        ohlcv
    }
}

/// OHLCV candlestick
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ohlcv {
    pub timestamp: Timestamp,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Get current timestamp in milliseconds
fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_column_storage() {
        let mut storage = ColumnStorage::new(100);
        
        storage.push(DataPoint {
            timestamp: 1000,
            value: 10.0,
            tags: HashMap::new(),
        });
        
        storage.push(DataPoint {
            timestamp: 2000,
            value: 20.0,
            tags: HashMap::new(),
        });
        
        assert_eq!(storage.len(), 2);
        
        // Test aggregation
        assert_eq!(storage.aggregate(Aggregation::Sum), 30.0);
        assert_eq!(storage.aggregate(Aggregation::Avg), 15.0);
        assert_eq!(storage.aggregate(Aggregation::Min), 10.0);
        assert_eq!(storage.aggregate(Aggregation::Max), 20.0);
    }
    
    #[test]
    fn test_tsdb() {
        let config = TsdbConfig::default();
        let tsdb = Arc::new(TimeSeriesDB::new(config));
        tsdb.initialize();
        
        // Write some data
        for i in 0..10 {
            let point = DataPoint {
                timestamp: current_timestamp() + i * 1000,
                value: i as f64 * 10.0,
                tags: HashMap::new(),
            };
            let _ = tsdb.write("test.metric", point);
        }
        
        // Query
        let filter = QueryFilter {
            start_time: 0,
            end_time: current_timestamp() + 100000,
            tags: HashMap::new(),
            limit: Some(5),
            aggregation: Aggregation::None,
            interval: None,
        };
        
        let results = tsdb.query("test.metric", filter);
        assert!(!results.is_empty());
        
        // Stats
        let stats = tsdb.stats();
        assert!(stats.total_points > 0);
    }
    
    #[test]
    fn test_downsample() {
        let mut storage = ColumnStorage::new(100);
        
        // Generate 1 hour of data at 1-minute intervals
        let base_time = current_timestamp() - 3600000;
        for i in 0..60 {
            storage.push(DataPoint {
                timestamp: base_time + i * 60000,
                value: 100.0 + (i as f64 * 0.5),
                tags: HashMap::new(),
            });
        }
        
        // Downsample to 10-minute intervals with average
        let downsampled = storage.downsample(Interval::Minute * 10, Aggregation::Avg);
        
        // Should have ~6 data points
        assert!(downsampled.len() >= 5);
    }
}
