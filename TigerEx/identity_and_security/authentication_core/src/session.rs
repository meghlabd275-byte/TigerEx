//! Session lifecycle management.
//!
//! Sessions are the server-side record a JWT is bound to (`sid`). A token is
//! only usable while its session is valid, unexpired, and not revoked, so
//! logout and "revoke all devices" actually take effect instead of waiting for
//! the token to expire. Refreshing rotates the session id and invalidates the
//! previous one to limit refresh-token replay.

use crate::jwt::{DeviceInfo, Session};
use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;
use uuid::Uuid;

/// In-memory session store. Production deployments back this with Redis; the
/// invariants below (expiry, revocation, rotation) are what any backend must
/// preserve.
#[derive(Default)]
pub struct SessionStore {
    sessions: HashMap<Uuid, Session>,
    /// Refresh tokens are single-use: the old session id is remembered here so
    /// a replayed refresh token can be rejected.
    rotated_from: HashMap<Uuid, Uuid>,
}

/// Outcome of a refresh attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum RefreshError {
    /// The session id is unknown, expired, or already revoked.
    InvalidSession,
    /// The presented refresh token was already rotated and cannot be reused.
    TokenReuseDetected,
}

impl SessionStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a session for a freshly authenticated user.
    pub fn create(&mut self, user_id: Uuid, device: &DeviceInfo, ttl_seconds: i64) -> Session {
        let now = Utc::now();
        let session = Session {
            id: Uuid::new_v4(),
            user_id,
            created_at: now,
            expires_at: now + Duration::seconds(ttl_seconds),
            last_active_at: now,
            device_info: device.clone(),
            ip_address: device.ip.clone(),
            valid: true,
        };
        self.sessions.insert(session.id, session.clone());
        session
    }

    /// Look up a session, returning `None` if it is missing, revoked or expired.
    pub fn get_valid(&mut self, session_id: Uuid) -> Option<&Session> {
        let expired = match self.sessions.get(&session_id) {
            Some(s) => s.expires_at <= Utc::now() || !s.valid,
            None => return None,
        };
        if expired {
            // Expired/revoked sessions are dropped so they cannot be replayed.
            self.sessions.remove(&session_id);
            return None;
        }
        self.sessions.get(&session_id)
    }

    /// Touch `last_active_at` after a successful authenticated request.
    pub fn touch(&mut self, session_id: Uuid) -> bool {
        if self.get_valid(session_id).is_none() {
            return false;
        }
        if let Some(s) = self.sessions.get_mut(&session_id) {
            s.last_active_at = Utc::now();
            return true;
        }
        false
    }

    /// Rotate a session on refresh. The previous session id is invalidated and
    /// recorded so that a replay of the old refresh token is detected.
    pub fn refresh(
        &mut self,
        old_session_id: Uuid,
        ttl_seconds: i64,
    ) -> Result<Session, RefreshError> {
        if self.rotated_from.contains_key(&old_session_id) {
            return Err(RefreshError::TokenReuseDetected);
        }
        let existing = match self.sessions.get(&old_session_id) {
            Some(s) if s.valid && s.expires_at > Utc::now() => s.clone(),
            _ => return Err(RefreshError::InvalidSession),
        };
        self.sessions.remove(&old_session_id);
        self.rotated_from.insert(old_session_id, existing.user_id);

        let now = Utc::now();
        let session = Session {
            id: Uuid::new_v4(),
            user_id: existing.user_id,
            created_at: now,
            expires_at: now + Duration::seconds(ttl_seconds),
            last_active_at: now,
            device_info: existing.device_info.clone(),
            ip_address: existing.ip_address.clone(),
            valid: true,
        };
        self.sessions.insert(session.id, session.clone());
        Ok(session)
    }

    /// Revoke a single session (logout). Returns whether a live session existed.
    pub fn revoke(&mut self, session_id: Uuid) -> bool {
        match self.sessions.get_mut(&session_id) {
            Some(s) if s.valid => {
                s.valid = false;
                self.sessions.remove(&session_id);
                true
            }
            _ => false,
        }
    }

    /// Revoke every session for a user ("log out all devices" / password change).
    /// Returns the number of sessions revoked.
    pub fn revoke_all_for_user(&mut self, user_id: Uuid) -> usize {
        let ids: Vec<Uuid> = self
            .sessions
            .iter()
            .filter(|(_, s)| s.user_id == user_id && s.valid)
            .map(|(id, _)| *id)
            .collect();
        for id in &ids {
            self.sessions.remove(id);
        }
        ids.len()
    }

    /// List a user's active sessions (device management view).
    pub fn list_for_user(&self, user_id: Uuid) -> Vec<&Session> {
        let now = Utc::now();
        self.sessions
            .values()
            .filter(|s| s.user_id == user_id && s.valid && s.expires_at > now)
            .collect()
    }

    /// Remove sessions that have expired or been revoked. Returns how many were
    /// dropped.
    pub fn purge_expired(&mut self) -> usize {
        let now = Utc::now();
        let before = self.sessions.len();
        self.sessions.retain(|_, s| s.valid && s.expires_at > now);
        before - self.sessions.len()
    }

    pub fn active_count(&self) -> usize {
        self.sessions.len()
    }
}

/// Validate a bare session record (used when the store is external).
pub fn is_valid(session: &Session, now: DateTime<Utc>) -> bool {
    session.valid && session.expires_at > now
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> DeviceInfo {
        DeviceInfo {
            device_type: "desktop".into(),
            browser: "firefox".into(),
            os: "linux".into(),
            fingerprint: "fp".into(),
            ip: "10.0.0.1".into(),
        }
    }

    #[test]
    fn create_and_validate() {
        let mut store = SessionStore::new();
        let user = Uuid::new_v4();
        let s = store.create(user, &device(), 3600);
        assert!(store.get_valid(s.id).is_some());
        assert_eq!(store.list_for_user(user).len(), 1);
    }

    #[test]
    fn expired_session_is_rejected_and_purged() {
        let mut store = SessionStore::new();
        let s = store.create(Uuid::new_v4(), &device(), -1); // already expired
        assert!(store.get_valid(s.id).is_none());
        assert_eq!(store.active_count(), 0);
    }

    #[test]
    fn revoke_single_and_all() {
        let mut store = SessionStore::new();
        let user = Uuid::new_v4();
        let a = store.create(user, &device(), 3600);
        let _b = store.create(user, &device(), 3600);
        assert!(store.revoke(a.id));
        assert!(!store.revoke(a.id)); // idempotent
        assert_eq!(store.revoke_all_for_user(user), 1);
        assert!(store.list_for_user(user).is_empty());
    }

    #[test]
    fn refresh_rotates_and_detects_reuse() {
        let mut store = SessionStore::new();
        let s = store.create(Uuid::new_v4(), &device(), 3600);
        let rotated = store.refresh(s.id, 3600).unwrap();
        assert_ne!(rotated.id, s.id);
        // Replaying the old refresh token is refused.
        assert_eq!(store.refresh(s.id, 3600).unwrap_err(), RefreshError::TokenReuseDetected);
        // The new session is usable.
        assert!(store.get_valid(rotated.id).is_some());
    }

    #[test]
    fn refresh_unknown_session_fails() {
        let mut store = SessionStore::new();
        assert_eq!(store.refresh(Uuid::new_v4(), 3600).unwrap_err(), RefreshError::InvalidSession);
    }
}
