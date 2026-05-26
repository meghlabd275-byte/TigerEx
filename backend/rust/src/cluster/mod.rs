// Cluster - Distributed Node Coordination
// Rust for cluster management and leader election

use std::collections::HashMap;

// Node status
#[derive(Debug, Clone)]
pub enum NodeStatus {
    Alive,
    Suspect,
    Dead,
}

// Cluster node
#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub address: String,
    pub port: u16,
    pub status: NodeStatus,
    pub started_at: i64,
    pub last_seen: i64,
    pub version: String,
    pub rack: String,
}

// Member list entry
#[derive(Debug, Clone)]
pub struct MemberEntry {
    pub node: Node,
    pub incarnation: u32,
    pub updated_at: i64,
}

// Gossip message
#[derive(Debug, Clone)]
pub struct GossipMessage {
    pub msg_type: String,
    pub from: String,
    pub targets: Vec<String>,
    pub members: HashMap<String, MemberEntry>,
    pub timestamp: i64,
}

// Cluster member
pub struct Cluster {
    members: HashMap<String, MemberEntry>,
    local_id: String,
    config: ClusterConfig,
}

#[derive(Debug, Clone)]
pub struct ClusterConfig {
    pub gossip_interval: i64,
    pub probe_interval: i64,
    pub probe_timeout: i64,
    pub suspicion_timeout: i64,
}

impl Cluster {
    pub fn new(local_id: &str) -> Self {
        let config = ClusterConfig {
            gossip_interval: 1000,
            probe_interval: 1000,
            probe_timeout: 3000,
            suspicion_timeout: 10000,
        };

        Cluster {
            members: HashMap::new(),
            local_id: local_id.to_string(),
            config,
        }
    }

    // Add node to cluster
    pub fn add_node(&mut self, node: Node) {
        let entry = MemberEntry {
            node: node.clone(),
            incarnation: 1,
            updated_at: now_ms(),
        };

        self.members.insert(node.id.clone(), entry);
    }

    // Remove node from cluster
    pub fn remove_node(&mut self, node_id: &str) {
        self.members.remove(node_id);
    }

    // Update node status
    pub fn update_status(&mut self, node_id: &str, status: NodeStatus) {
        if let Some(entry) = self.members.get_mut(node_id) {
            entry.node.status = status;
            entry.incarnation += 1;
            entry.updated_at = now_ms();
        }
    }

    // Get alive nodes
    pub fn get_alive_nodes(&self) -> Vec<&Node> {
        self.members
            .values()
            .filter(|e| e.node.status == NodeStatus::Alive)
            .map(|e| &e.node)
            .collect()
    }

    // Get node count
    pub fn member_count(&self) -> usize {
        self.members.len()
    }

    // Suspect node (gossip protocol)
    pub fn suspect(&mut self, node_id: &str) {
        self.update_status(node_id, NodeStatus::Suspect);
    }

    // Confirm node alive
    pub fn confirm_alive(&mut self, node_id: &str) {
        self.update_status(node_id, NodeStatus::Alive);
    }

    // Get members for gossip
    pub fn get_members(&self) -> &HashMap<String, MemberEntry> {
        &self.members
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
    fn test_cluster() {
        let mut cluster = Cluster::new("node1");

        let node = Node {
            id: "node2".to_string(),
            address: "192.168.1.2".to_string(),
            port: 8080,
            status: NodeStatus::Alive,
            started_at: now_ms(),
            last_seen: now_ms(),
            version: "1.0.0".to_string(),
            rack: "rack1".to_string(),
        };

        cluster.add_node(node);

        let alive = cluster.get_alive_nodes();
        assert_eq!(alive.len(), 1);
    }
}