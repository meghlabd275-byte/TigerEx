// Utilities - Common Helper Functions
// Rust for utility functions

use std::collections::HashMap;

// Time utilities
pub fn format_duration(ms: i64) -> String {
    if ms < 1000 {
        return format!("{}ms", ms);
    }
    if ms < 60000 {
        return format!("{}s", ms / 1000);
    }
    if ms < 3600000 {
        return format!("{}m", ms / 60000);
    }
    format!("{}h", ms / 3600000)
}

// String utilities
pub fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }
    format!("{}...", &s[..max_len-3])
}

// Validation
pub fn is_valid_email(email: &str) -> bool {
    email.contains('@') && email.contains('.')
}

pub fn is_valid_username(username: &str) -> bool {
    let len = username.len();
    len >= 3 && len <= 20 
        && username.chars().all(|c| c.is_alphanumeric() || c == '_')
}

// Network utilities
pub fn format_ip(ip: &str) -> String {
    "xxx.xxx.xxx.xxx".to_string() // Simplified
}

// Number formatting  
pub fn format_percentage(value: f64) -> String {
    format!("{:.2}%", value * 100.0)
}

pub fn format_currency(amount: f64) -> String {
    format!("${:.2}", amount)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validation() {
        assert!(is_valid_email("test@example.com"));
        assert!(is_valid_username("user_123"));
    }
}