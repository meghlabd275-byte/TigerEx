// Queue - Message Queue Implementation
// Rust for async message queuing

use std::collections::{VecDeque, HashMap};
use std::sync::Arc;

// Message metadata
#[derive(Debug, Clone)]
pub struct MessageMeta {
    pub id: String,
    pub topic: String,
    pub key: Option<String>,
    pub partition: u32,
    pub timestamp: i64,
    pub headers: HashMap<String, String>,
}

// Queue message
#[derive(Debug, Clone)]
pub struct QueueMessage {
    pub meta: MessageMeta,
    pub payload: Vec<u8>,
    pub offset: u64,
}

// Consumer group
#[derive(Debug, Clone)]
pub struct ConsumerGroup {
    pub id: String,
    pub topics: Vec<String>,
    pub committed: HashMap<String, u64>, // topic -> offset
}

// Message queue
pub struct MessageQueue {
    partitions: HashMap<u32, VecDeque<QueueMessage>>,
    topics: HashMap<String, Vec<u32>>, // topic -> partitions
    consumer_groups: HashMap<String, ConsumerGroup>,
    offsets: HashMap<u32, u64>, // partition -> next offset
    config: QueueConfig,
}

#[derive(Debug, Clone)]
pub struct QueueConfig {
    pub retention_ms: i64,
    pub max_size_bytes: u64,
    pub cleanup_policy: String, // delete, compact
}

impl MessageQueue {
    pub fn new() -> Self {
        let config = QueueConfig {
            retention_ms: 604800000, // 7 days
            max_size_bytes: 10_000_000_000,
            cleanup_policy: "delete".to_string(),
        };

        MessageQueue {
            partitions: HashMap::new(),
            topics: HashMap::new(),
            consumer_groups: HashMap::new(),
            offsets: HashMap::new(),
            config,
        }
    }

    // Create topic
    pub fn create_topic(&mut self, topic: &str, partitions: u32) {
        for p in 0..partitions {
            self.partitions.insert(p, VecDeque::new());
        }

        let mut parts = Vec::new();
        for p in 0..partitions {
            parts.push(p);
        }

        self.topics.insert(topic.to_string(), parts);
    }

    // Produce message
    pub fn produce(&mut self, topic: &str, payload: Vec<u8>, key: Option<String>) -> Result<u64, String> {
        let parts = self.topics.get(topic)
            .ok_or("topic not found")?;

        // Partition by key
        let partition = if let Some(ref k) = key {
            let hash = k.as_bytes().iter().fold(0u32, |acc, b| acc.wrapping_add(*b as u32));
            parts[(hash as usize) % parts.len()]
        } else {
            parts[0]
        };

        let offset = *self.offsets.get(&partition).unwrap_or(&0);

        let msg = QueueMessage {
            meta: MessageMeta {
                id: format!("msg_{}", offset),
                topic: topic.to_string(),
                key: key.clone(),
                partition,
                timestamp: now_ms(),
                headers: HashMap::new(),
            },
            payload,
            offset,
        };

        let deque = self.partitions.entry(partition).or_insert_with(VecDeque::new);
        deque.push_back(msg);

        self.offsets.insert(partition, offset + 1);

        Ok(offset)
    }

    // Consume message
    pub fn consume(&mut self, topic: &str, partition: u32, offset: u64) -> Option<QueueMessage> {
        let deque = self.partitions.get(&partition)?;

        for msg in deque.iter() {
            if msg.offset >= offset && msg.meta.topic == topic {
                return Some(msg.clone());
            }
        }

        None
    }

    // Commit offset
    pub fn commit_offset(&mut self, group_id: &str, topic: &str, offset: u64) {
        let group = self.consumer_groups
            .entry(group_id.to_string())
            .or_insert_with(|| {
                ConsumerGroup {
                    id: group_id.to_string(),
                    topics: vec![],
                    committed: HashMap::new(),
                }
            });

        group.committed.insert(topic.to_string(), offset);
    }

    // Get latest offset
    pub fn latest_offset(&self, partition: u32) -> u64 {
        self.offsets.get(&partition).copied().unwrap_or(0)
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
    fn test_queue() {
        let mut queue = MessageQueue::new();

        queue.create_topic("orders", 1);

        queue.produce("orders".to_string(), b"order1".to_vec(), None).unwrap();

        assert!(queue.latest_offset(0) > 0);
    }
}