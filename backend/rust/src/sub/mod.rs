// Sub - Sub Account Management
// Rust for institutional subaccounts

use std::collections::HashMap;

// Sub account
#[derive(Debug, Clone)]
pub struct SubAcc {
    pub id: String,
    pub parent_id: String,
    pub name: String,
    pub permissions: Vec<String>,
    pub status: String,
}

impl SubAcc {
    pub fn new(parent_id: &str, name: &str, perms: Vec<String>) -> Self {
        SubAcc {
            id: format!("sub_{}", now_ms()),
            parent_id: parent_id.to_string(),
            name: name.to_string(),
            permissions: perms,
            status: "active".to_string(),
        }
    }

    pub fn freeze(&mut self) {
        self.status = "frozen".to_string();
    }

    pub fn close(&mut self) {
        self.status = "closed".to_string();
    }
}

// API Key
#[derive(Debug, Clone)]
pub struct APIKey {
    pub key: String,
    pub sub_id: String,
    pub created_at: i64,
    pub permissions: Vec<String>,
}

// Usage tracker
#[derive(Debug, Clone)]
pub struct Usage {
    pub sub_id: String,
    pub daily_used: f64,
    pub monthly_used: f64,
    pub daily_limit: f64,
    pub monthly_limit: f64,
}

impl Usage {
    pub fn new(sub_id: &str, daily: f64, monthly: f64) -> Self {
        Usage {
            sub_id: sub_id.to_string(),
            daily_used: 0.0,
            monthly_used: 0.0,
            daily_limit: daily,
            monthly_limit: monthly,
        }
    }

    pub fn check(&self, amount: f64) -> bool {
        self.daily_used + amount <= self.daily_limit &&
        self.monthly_used + amount <= self.monthly_limit
    }

    pub fn record(&mut self, amount: f64) {
        self.daily_used += amount;
        self.monthly_used += amount;
    }
}

// Manager
pub struct SubManager {
    subs: HashMap<String, SubAcc>,
    api_keys: HashMap<String, APIKey>,
    usage: HashMap<String, Usage>,
}

impl SubManager {
    pub fn new() -> Self {
        SubManager {
            subs: HashMap::new(),
            api_keys: HashMap::new(),
            usage: HashMap::new(),
        }
    }

    pub fn create_sub(&mut self, parent_id: &str, name: &str, perms: Vec<String>, daily: f64, monthly: f64) -> String {
        let sub = SubAcc::new(parent_id, name, perms.clone());
        let id = sub.id.clone();

        self.subs.insert(id.clone(), sub);
        self.usage.insert(id.clone(), Usage::new(&id, daily, monthly));

        id
    }

    pub fn generate_key(&mut self, sub_id: &str) -> Option<String> {
        if let Some(sub) = self.subs.get(sub_id) {
            if sub.status != "active" {
                return None;
            }

            let key = format!("sk_{}", now_ms());

            self.api_keys.insert(key.clone(), APIKey {
                key: key.clone(),
                sub_id: sub_id.to_string(),
                created_at: now_ms(),
                permissions: sub.permissions.clone(),
            });

            Some(key)
        } else {
            None
        }
    }

    pub fn verify_trade(&self, sub_id: &str, amount: f64) -> bool {
        self.usage.get(sub_id).map(|u| u.check(amount)).unwrap_or(false)
    }

    pub fn record_trade(&mut self, sub_id: &str, amount: f64) -> Result<(), String> {
        if let Some(usage) = self.usage.get_mut(sub_id) {
            if usage.check(amount) {
                usage.record(amount);
                Ok(())
            } else {
                Err("quota exceeded".to_string())
            }
        } else {
            Err("sub not found".to_string())
        }
    }

    pub fn freeze(&mut self, sub_id: &str) -> Result<(), String> {
        if let Some(sub) = self.subs.get_mut(sub_id) {
            sub.freeze();
            Ok(())
        } else {
            Err("sub not found".to_string())
        }
    }

    pub fn reset_daily(&mut self) {
        for usage in self.usage.values_mut() {
            usage.daily_used = 0.0;
        }
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
    fn test_sub() {
        let mut mgr = SubManager::new();

        let id = mgr.create_sub("p1", "trader", vec!["trade".to_string()], 10000.0, 100000.0);

        assert!(!id.is_empty());
    }
}