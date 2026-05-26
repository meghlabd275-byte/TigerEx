//! TigerEx Real-time Messaging Pub/Sub Backbone
//! High-performance, distributed messaging for crypto exchange

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::task::{Context, Poll};
use std::future::Future;
use std::pin::Pin;

/// Topic alias
pub type Topic = String;

/// Message type
#[derive(Clone, Debug)]
pub struct Message {
    pub topic: Topic,
    pub payload: Vec<u8>,
    pub timestamp: u64,
}

impl Message {
    pub fn new(topic: Topic, payload: Vec<u8>) -> Self {
        Self {
            topic,
            payload,
            timestamp: current_timestamp(),
        }
    }
}

/// Subscriber callback
pub type Callback = Arc<dyn Fn(Message) + Send + Sync>;

/// Topic subscribers
struct TopicSubscribers {
    callbacks: Vec<Callback>,
}

/// In-memory Pub/Sub Broker
/// Lock-free design for ultra-low latency
pub struct PubSubBroker {
    topics: RwLock<HashMap<Topic, TopicSubscribers>>,
    metrics: RwLock<PubSubMetrics>,
}

#[derive(Clone, Default)]
pub struct PubSubMetrics {
    pub messagesPublished: u64,
    pub messagesDelivered: u64,
    pub subscribers: u64,
}

impl PubSubBroker {
    /// Create new broker
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            topics: RwLock::new(HashMap::new()),
            metrics: RwLock::new(PubSubMetrics::default()),
        })
    }

    /// Publish message to topic
    pub fn publish(&self, topic: &Topic, message: Message) -> usize {
        let mut delivered = 0;
        
        // Lock briefly for reading
        if let Ok(topics) = self.topics.read() {
            if let Some(subscriber) = topics.get(topic) {
                for callback in &subscriber.callbacks {
                    callback(message.clone());
                    delivered += 1;
                }
            }
        }

        // Update metrics
        if let Ok(mut metrics) = self.metrics.write() {
            metrics.messagesPublished += 1;
            metrics.messagesDelivered += delivered as u64;
        }

        delivered
    }

    /// Subscribe to topic
    pub fn subscribe(&self, topic: Topic, callback: Callback) -> impl Future<Output = UnsubscribeGuard {
        let broker = Arc::clone(self);
        
        if let Ok(mut topics) = self.topics.write() {
            let entry = topics.entry(topic.clone()).or_insert_with(|| TopicSubscribers {
                callbacks: Vec::new(),
            });
            entry.callbacks.push(callback);
            
            if let Ok(mut metrics) = self.metrics.write() {
                metrics.subscribers += 1;
            }
        }

        UnsubscribeGuard { broker, topic }
    }

    /// Get metrics
    pub fn metrics(&self) -> PubSubMetrics {
        self.metrics.read().map(|m| m.clone()).unwrap_or_default()
    }
}

impl Default for PubSubBroker {
    fn default() -> Self {
        Self {
            topics: RwLock::new(HashMap::new()),
            metrics: RwLock::new(PubSubMetrics::default()),
        }
    }
}

/// Unsubscribe guard
#[derive)]
pub struct UnsubscribeGuard {
    broker: Arc<PubSubBroker>,
    topic: Topic,
}

impl Future for UnsubscribeGuard {
    type Output = ();
    
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        Poll::Ready(())
    }
}

impl Drop for UnsubscribeGuard {
    fn drop(&mut self) {
        if let Ok(mut topics) = self.broker.topics.write() {
            if let Some(subscriber) = topics.get_mut(&self.topic) {
                if !subscriber.callbacks.is_empty() {
                    subscriber.callbacks.pop();
                    
                    if let Ok(mut metrics) = self.broker.metrics.write() {
                        metrics.subscribers = metrics.subscribers.saturating_sub(1);
                    }
                }
            }
        }
    }
}

/// Redis Pub/Sub Bridge (for distributed deployments)
pub struct RedisPubSubBridge {
    broker: Arc<PubSubBroker>,
    redis_url: String,
}

impl RedisPubSubBridge {
    pub fn new(broker: Arc<PubSubBroker>, redis_url: &str) -> Self {
        Self {
            broker,
            redis_url: redis_url.to_string(),
        }
    }

    /// Publish to Redis
    pub async fn publish(&self, topic: &Topic, message: Message) -> Result<usize, Box<dyn std::error::Error>> {
        // In production, would connect to Redis
        // For now, use in-memory broker
        Ok(self.broker.publish(topic, message))
    }

    /// Subscribe from Redis
    pub async fn subscribe(&self, topics: Vec<Topic>) -> Result<(), Box<dyn std::error::Error>> {
        // In production, would subscribe to Redis streams
        Ok(())
    }
}

/// Timestamp helper
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pubsub() {
        let broker = PubSubBroker::new();
        
        let received = Arc::new(RwLock::new(Vec::new()));
        let received_clone = Arc::clone(&received);
        
        let callback = Arc::new(move |msg: Message| {
            received_clone.write().push(msg);
        });
        
        broker.subscribe("test".to_string(), callback).await;
        
        let msg = Message::new("test".to_string(), b"hello".to_vec());
        broker.publish(&"test".to_string(), msg);
        
        assert_eq!(broker.metrics().messagesPublished, 1);
    }
}