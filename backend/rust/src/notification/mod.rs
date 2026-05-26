//! Notification Service - Rust Implementation
//! 
//! Real-time notifications - Email, SMS, Push, In-app

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// Notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub notification_type: NotificationType,
    pub title: String,
    pub message: String,
    pub data: Option<HashMap<String, String>>,
    pub read: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotificationType {
    Email,
    SMS,
    Push,
    InApp,
    Security,
}

/// Email notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailNotification {
    pub to: String,
    pub subject: String,
    pub body: String,
    pub html: Option<String>,
}

impl EmailNotification {
    pub fn new(to: &str, subject: &str, body: &str) -> Self {
        Self {
            to: to.to_string(),
            subject: subject.to_string(),
            body: body.to_string(),
            html: None,
        }
    }
}

/// Push notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushNotification {
    pub token: String,
    pub title: String,
    pub body: String,
    pub data: Option<HashMap<String, String>>,
}

pub struct NotificationService {
    notifications: HashMap<String, Notification>,
    user_notifications: HashMap<String, Vec<String>>,
    email_queue: Vec<EmailNotification>,
    push_queue: Vec<PushNotification>,
    counter: u64,
}

impl NotificationService {
    pub fn new() -> Self {
        Self {
            notifications: HashMap::new(),
            user_notifications: HashMap::new(),
            email_queue: Vec::new(),
            push_queue: Vec::new(),
            counter: 0,
        }
    }

    /// Create and send notification
    pub fn notify(&mut self, user_id: &str, notification_type: NotificationType,
                  title: &str, message: &str) -> String {
        self.counter += 1;
        
        let notification = Notification {
            id: format!("notif_{}", self.counter),
            user_id: user_id.to_string(),
            notification_type,
            title: title.to_string(),
            message: message.to_string(),
            data: None,
            read: false,
            created_at: current_timestamp_ms(),
        };

        let id = notification.id.clone();
        self.notifications.insert(id.clone(), notification);
        
        self.user_notifications.entry(user_id.to_string())
            .or_insert_with(Vec::new)
            .push(id.clone());

        id
    }

    /// Send email
    pub fn send_email(&mut self, to: &str, subject: &str, body: &str) {
        let email = EmailNotification::new(to, subject, body);
        self.email_queue.push(email);
    }

    /// Send push
    pub fn send_push(&mut self, token: &str, title: &str, body: &str) {
        let push = PushNotification {
            token: token.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            data: None,
        };
        self.push_queue.push(push);
    }

    /// Get unread count
    pub fn unread_count(&self, user_id: &str) -> usize {
        let ids = self.user_notifications.get(user_id);
        match ids {
            Some(list) => list.iter()
                .filter(|id| {
                    match self.notifications.get(*id) {
                        Some(n) => !n.read,
                        None => false,
                    }
                })
                .count(),
            None => 0,
        }
    }

    /// Mark as read
    pub fn mark_read(&mut self, user_id: &str, notification_id: &str) -> Result<(), String> {
        let notification = self.notifications.get_mut(notification_id)
            .ok_or("Notification not found")?;
        
        if notification.user_id != user_id {
            return Err("Unauthorized".to_string());
        }

        notification.read = true;
        Ok(())
    }

    /// Get user notifications
    pub fn get_notifications(&self, user_id: &str, limit: usize) -> Vec<&Notification> {
        let ids = match self.user_notifications.get(user_id) {
            Some(list) => list,
            None => return Vec::new(),
        };

        let mut notifications: Vec<&Notification> = ids.iter()
            .filter_map(|id| self.notifications.get(id))
            .collect();

        notifications.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        notifications.truncate(limit);
        notifications
    }

    /// Clear old notifications
    pub fn cleanup(&mut self, days: i64) {
        let cutoff = current_timestamp_ms() - (days * 86400000);
        
        let to_remove: Vec<String> = self.notifications.iter()
            .filter(|(_, n)| n.created_at < cutoff && n.read)
            .map(|(id, _)| id.clone())
            .collect();

        for id in to_remove {
            self.notifications.remove(&id);
        }
    }
}

fn current_timestamp_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notify() {
        let mut service = NotificationService::new();
        let id = service.notify("user1", NotificationType::InApp, "Test", "Hello");
        assert!(id.starts_with("notif_"));
    }
}