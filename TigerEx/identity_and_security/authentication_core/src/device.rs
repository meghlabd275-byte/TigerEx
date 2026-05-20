//! Device fingerprinting and security

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;

/// Device fingerprint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceFingerprint {
    pub device_id: String,
    pub browser: String,
    pub os: String,
    pub screen_resolution: String,
    pub timezone: String,
    pub language: String,
    pub platform: String,
    pub hardware_concurrency: u32,
    pub device_memory: Option<u64>,
    pub canvas_fingerprint: String,
    pub webgl_fingerprint: String,
}

/// Fingerprint hasher
pub struct FingerprintHasher;

impl FingerprintHasher {
    /// Generate fingerprint from components
    pub fn generate(components: &DeviceComponents) -> String {
        let mut hasher = Sha256::new();
        
        hasher.update(&components.user_agent);
        hasher.update(&components.language);
        hasher.update(&components.platform);
        hasher.update(&components.timezone);
        hasher.update(&components.screen);
        hasher.update(&components.canvas);
        
        format!("{:x}", hasher.finalize())
    }
}

#[derive(Debug)]
pub struct DeviceComponents {
    pub user_agent: String,
    pub language: String,
    pub platform: String,
    pub timezone: String,
    pub screen: String,
    pub canvas: String,
}

/// Impossible travel detector
pub struct ImpossibleTravelDetector;

impl ImpossibleTravelDetector {
    /// Check for impossible travel between two logins
    pub fn detect(
        last_login: &LoginLocation,
        current_login: &LoginLocation,
    ) -> bool {
        use std::f64::consts::EARTH_RADIUS_KM;
        
        let distance = Self::haversine_distance(
            last_login.lat, last_login.lon,
            current_login.lat, current_login.lon,
        );
        
        let time_diff_hours = (current_login.timestamp - last_login.timestamp) as f64 / 3600.0;
        
        // Assume max realistic speed: 1000 km/h (fast flight)
        let max_possible_distance = time_diff_hours * 1000.0;
        
        distance > max_possible_distance
    }
    
    fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
        let dlat = (lat2 - lat1).to_radians();
        let dlon = (lon2 - lon1).to_radians();
        
        let a = (dlat / 2.0).sin().powi(2) 
            + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().asin();
        
        6371.0 * c // Earth radius in km
    }
}

#[derive(Debug, Clone)]
pub struct LoginLocation {
    pub lat: f64,
    pub lon: f64,
    pub timestamp: i64,
    pub ip: String,
}

/// Geo-restriction checker
pub struct GeoChecker;

impl GeoChecker {
    /// Check if IP is from allowed country
    pub fn is_allowed(country: &str, allowed: &[String]) -> bool {
        allowed.is_empty() || allowed.contains(&country.to_string())
    }
    
    /// Get country from IP (simplified)
    pub fn get_country(_ip: &str) -> Option<String> {
        // Would integrate with MaxMind GeoLite2
        Some("US".to_string())
    }
}

/// Brute force protector
pub struct BruteForceProtector {
    pub max_attempts: u32,
    pub lockout_duration_secs: u64,
}

impl BruteForceProtector {
    pub fn new() -> Self {
        Self {
            max_attempts: 5,
            lockout_duration_secs: 7200, // 2 hours
        }
    }
    
    pub fn should_lockout(&self, attempts: u32) -> bool {
        attempts >= self.max_attempts
    }
}

/// Bot detector
pub struct BotDetector;

impl BotDetector {
    /// Detect if request is from a bot
    pub fn is_bot(user_agent: &str, headless: bool, automation: bool) -> bool {
        let bot_indicators = [
            "curl", "wget", "python", "scrapy", "bot", "crawler",
            "spider", "headless", "phantom", "selenium", "playwright"
        ];
        
        let lower_ua = user_agent.to_lowercase();
        
        for indicator in bot_indicators {
            if lower_ua.contains(indicator) {
                return true;
            }
        }
        
        headless || automation
    }
}

/// Captcha generator
pub struct CaptchaEngine;

impl CaptchaEngine {
    /// Generate simple math captcha
    pub fn generate() -> Captcha {
        let a = rand::random::<u32>() % 20 + 1;
        let b = rand::random::<u32>() % 20 + 1;
        let op = if rand::random::<bool>() { "+" } else { "-" };
        
        let answer = if op == "+" { a + b } else { a.saturating_sub(b) };
        
        Captcha {
            question: format!("{} {} {} = ?", a, op, b),
            answer: answer.to_string(),
            expires_at: std::time::SystemTime::now()
                .checked_add(std::time::Duration::from_secs(300))
                .unwrap(),
        }
    }
}

pub struct Captcha {
    pub question: String,
    pub answer: String,
    pub expires_at: std::time::SystemTime,
}

/// Rate limiter using token bucket
pub struct TokenBucket {
    pub capacity: u64,
    pub tokens: u64,
    pub refill_rate: u64, // tokens per second
    pub last_refill: std::time::Instant,
}

impl TokenBucket {
    pub fn new(capacity: u64, refill_rate: u64) -> Self {
        Self {
            capacity,
            tokens: capacity,
            refill_rate,
            last_refill: std::time::Instant::now(),
        }
    }
    
    pub fn try_consume(&mut self) -> bool {
        self.refill();
        
        if self.tokens >= 1 {
            self.tokens -= 1;
            true
        } else {
            false
        }
    }
    
    fn refill(&mut self) {
        let elapsed = self.last_refill.elapsed().as_secs();
        if elapsed > 0 {
            let to_add = elapsed * self.refill_rate;
            self.tokens = (self.tokens + to_add).min(self.capacity);
            self.last_refill = std::time::Instant::now();
        }
    }
}