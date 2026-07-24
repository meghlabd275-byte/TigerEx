/**
 * TigerEx Super Admin RBAC (Role-Based Access Control)
 * 
 * Security-focused access control with ultra-low latency
 * Built with Rust for maximum security and performance
 * 
 * Copyright (c) 2024 TigerEx
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// =============================================================================
// TYPES
// =============================================================================

/// Permission types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Permission {
    // User Management
    UserRead,
    UserCreate,
    UserUpdate,
    UserDelete,
    UserKyc,
    
    // Wallet Management
    WalletRead,
    WalletCreate,
    WalletDelete,
    WalletFreeze,
    
    // Trading
    TradingRead,
    TradingExecute,
    TradingCancel,
    TradingViewOrders,
    
    // Finance
    FinanceRead,
    FinanceWithdraw,
    FinanceDeposit,
    FinanceRefund,
    
    // Admin
    AdminRead,
    AdminWrite,
    AdminSettings,
    AdminRoles,
    
    // Technical
    TechnicalRead,
    TechnicalWrite,
    TechnicalDebug,
    TechnicalDeploy,
    
    // Reports
    ReportsRead,
    ReportsWrite,
    ReportsExport,
    
    // Compliance
    ComplianceRead,
    ComplianceWrite,
    ComplianceExport,
    ComplianceApprove,
    
    // Audit
    AuditRead,
    AuditWrite,
}

/// Role definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub description: String,
    pub permissions: Vec<Permission>,
    pub is_system: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

/// User role assignment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRole {
    pub user_id: String,
    pub role_id: String,
    pub assigned_at: u64,
    pub assigned_by: String,
    pub expires_at: Option<u64>,
}

/// Access policy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessPolicy {
    pub id: String,
    pub name: String,
    pub resource: String,
    pub action: String,
    pub conditions: Vec<PolicyCondition>,
    pub enabled: bool,
}

/// Policy condition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyCondition {
    pub field: String,
    pub operator: String,
    pub value: serde_json::Value,
}

/// Audit entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub user_id: String,
    pub action: String,
    pub resource: String,
    pub resource_id: Option<String>,
    pub result: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub timestamp: u64,
}

/// Session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub role_ids: Vec<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub last_activity: u64,
    pub ip_address: String,
    pub user_agent: String,
    pub active: bool,
}

// =============================================================================
// RBAC ENGINE
// =============================================================================

pub struct RBACEngine {
    roles: RwLock<HashMap<String, Role>>,
    user_roles: RwLock<HashMap<String, Vec<UserRole>>>,
    policies: RwLock<HashMap<String, AccessPolicy>>,
    sessions: RwLock<HashMap<String, Session>>,
    audit_log: RwLock<Vec<AuditEntry>>,
    permission_cache: RwLock<HashMap<String, Vec<Permission>>>,
}

impl RBACEngine {
    pub fn new() -> Self {
        let engine = Self {
            roles: RwLock::new(HashMap::new()),
            user_roles: RwLock::new(HashMap::new()),
            policies: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            audit_log: RwLock::new(Vec::new()),
            permission_cache: RwLock::new(HashMap::new()),
        };
        
        engine.init_system_roles();
        engine
    }
    
    fn init_system_roles(&self) {
        let system_roles = vec![
            Role {
                id: "SUPER_ADMIN".to_string(),
                name: "Super Admin".to_string(),
                description: "Full system access".to_string(),
                permissions: vec![
                    Permission::UserRead, Permission::UserCreate, Permission::UserUpdate, Permission::UserDelete, Permission::UserKyc,
                    Permission::WalletRead, Permission::WalletCreate, Permission::WalletDelete, Permission::WalletFreeze,
                    Permission::TradingRead, Permission::TradingExecute, Permission::TradingCancel, Permission::TradingViewOrders,
                    Permission::FinanceRead, Permission::FinanceWithdraw, Permission::FinanceDeposit, Permission::FinanceRefund,
                    Permission::AdminRead, Permission::AdminWrite, Permission::AdminSettings, Permission::AdminRoles,
                    Permission::TechnicalRead, Permission::TechnicalWrite, Permission::TechnicalDebug, Permission::TechnicalDeploy,
                    Permission::ReportsRead, Permission::ReportsWrite, Permission::ReportsExport,
                    Permission::ComplianceRead, Permission::ComplianceWrite, Permission::ComplianceExport, Permission::ComplianceApprove,
                    Permission::AuditRead, Permission::AuditWrite,
                ],
                is_system: true,
                created_at: current_time(),
                updated_at: current_time(),
            },
            Role {
                id: "ADMIN".to_string(),
                name: "Administrator".to_string(),
                description: "Administrative access".to_string(),
                permissions: vec![
                    Permission::UserRead, Permission::UserUpdate, Permission::UserKyc,
                    Permission::WalletRead, Permission::WalletFreeze,
                    Permission::TradingRead, Permission::TradingViewOrders,
                    Permission::FinanceRead,
                    Permission::AdminRead, Permission::AdminSettings,
                    Permission::ReportsRead, Permission::ReportsExport,
                    Permission::ComplianceRead, Permission::ComplianceApprove,
                    Permission::AuditRead,
                ],
                is_system: true,
                created_at: current_time(),
                updated_at: current_time(),
            },
        ];
        
        let mut roles = self.roles.write().unwrap();
        for role in system_roles {
            roles.insert(role.id.clone(), role);
        }
    }
    
    pub fn create_role(&self, name: String, description: String, permissions: Vec<Permission>) -> Result<Role, String> {
        let id = format!("ROLE_{}", generate_id());
        
        let role = Role {
            id: id.clone(),
            name,
            description,
            permissions,
            is_system: false,
            created_at: current_time(),
            updated_at: current_time(),
        };
        
        let mut roles = self.roles.write().unwrap();
        roles.insert(id, role.clone());
        
        self.invalidate_cache();
        Ok(role)
    }
    
    pub fn assign_role(&self, user_id: String, role_id: String, assigned_by: String, expires_at: Option<u64>) -> Result<UserRole, String> {
        {
            let roles = self.roles.read().unwrap();
            if !roles.contains_key(&role_id) {
                return Err("Role not found".to_string());
            }
        }
        
        let user_role = UserRole {
            user_id: user_id.clone(),
            role_id: role_id.clone(),
            assigned_at: current_time(),
            assigned_by,
            expires_at,
        };
        
        let mut user_roles = self.user_roles.write().unwrap();
        user_roles.entry(user_id).or_insert_with(Vec::new).push(user_role.clone());
        
        self.invalidate_user_cache(&user_id);
        Ok(user_role)
    }
    
    pub fn has_permission(&self, user_id: &str, permission: &Permission) -> Result<bool, String> {
        let permissions = {
            let cache = self.permission_cache.read().unwrap();
            if let Some(perms) = cache.get(user_id) {
                perms.clone()
            } else {
                drop(cache);
                self.build_user_cache(user_id)?
            }
        };
        
        Ok(permissions.contains(permission))
    }
    
    pub fn get_user_permissions(&self, user_id: &str) -> Result<Vec<Permission>, String> {
        self.build_user_cache(user_id)
    }
    
    pub fn log_audit(&self, user_id: String, action: String, resource: String, resource_id: Option<String>, result: String, ip_address: Option<String>, user_agent: Option<String>, metadata: Option<serde_json::Value>) {
        let entry = AuditEntry {
            id: format!("AUDIT_{}", generate_id()),
            user_id,
            action,
            resource,
            resource_id,
            result,
            ip_address,
            user_agent,
            metadata,
            timestamp: current_time(),
        };
        
        let mut audit_log = self.audit_log.write().unwrap();
        audit_log.push(entry);
        
        if audit_log.len() > 10000 {
            audit_log.drain(0..1000);
        }
    }
    
    pub fn get_audit_log(&self, user_id: Option<&str>, limit: usize) -> Vec<AuditEntry> {
        let audit_log = self.audit_log.read().unwrap();
        
        let filtered: Vec<AuditEntry> = match user_id {
            Some(uid) => audit_log.iter().filter(|e| e.user_id == uid).cloned().collect(),
            None => audit_log.clone(),
        };
        
        filtered.into_iter().rev().take(limit).collect()
    }
    
    pub fn create_session(&self, user_id: String, role_ids: Vec<String>, ip_address: String, user_agent: String, ttl_seconds: u64) -> Result<Session, String> {
        let now = current_time();
        let session = Session {
            id: format!("SESSION_{}", generate_id()),
            user_id: user_id.clone(),
            role_ids,
            created_at: now,
            expires_at: now + ttl_seconds,
            last_activity: now,
            ip_address,
            user_agent,
            active: true,
        };
        
        let mut sessions = self.sessions.write().unwrap();
        sessions.insert(session.id.clone(), session.clone());
        
        Ok(session)
    }
    
    pub fn validate_session(&self, session_id: &str) -> Result<Session, String> {
        let sessions = self.sessions.read().unwrap();
        
        if let Some(session) = sessions.get(session_id) {
            let now = current_time();
            if session.active && session.expires_at > now {
                return Ok(session.clone());
            }
        }
        
        Err("Invalid or expired session".to_string())
    }
    
    fn build_user_cache(&self, user_id: &str) -> Result<Vec<Permission>, String> {
        let roles = self.get_user_roles(user_id);
        
        let mut permissions = Vec::new();
        for role in roles {
            for perm in role.permissions {
                if !permissions.contains(&perm) {
                    permissions.push(perm);
                }
            }
        }
        
        let mut cache = self.permission_cache.write().unwrap();
        cache.insert(user_id.to_string(), permissions.clone());
        
        Ok(permissions)
    }
    
    fn get_user_roles(&self, user_id: &str) -> Vec<Role> {
        let user_roles = self.user_roles.read().unwrap();
        let roles = self.roles.read().unwrap();
        
        let mut result = Vec::new();
        if let Some(assigned) = user_roles.get(user_id) {
            for ar in assigned {
                if let Some(role) = roles.get(&ar.role_id) {
                    if let Some(expires) = ar.expires_at {
                        if expires > current_time() {
                            result.push(role.clone());
                        }
                    } else {
                        result.push(role.clone());
                    }
                }
            }
        }
        
        result
    }
    
    fn invalidate_cache(&self) {
        let mut cache = self.permission_cache.write().unwrap();
        cache.clear();
    }
    
    fn invalidate_user_cache(&self, user_id: &str) {
        let mut cache = self.permission_cache.write().unwrap();
        cache.remove(user_id);
    }
}

fn current_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp)
}

fn main() {
    println!("TigerEx Super Admin RBAC");
    println!("========================");
    
    let rbac = RBACEngine::new();
    
    let custom_role = rbac.create_role(
        "Compliance Officer".to_string(),
        "Compliance team access".to_string(),
        vec![
            Permission::UserRead,
            Permission::ReportsRead,
            Permission::ComplianceRead,
            Permission::ComplianceWrite,
        ],
    ).unwrap();
    
    println!("\nCreated Role: {}", custom_role.name);
    
    let _ = rbac.assign_role(
        "user-123".to_string(),
        custom_role.id.clone(),
        "admin".to_string(),
        None,
    );
    
    let has_compliance = rbac.has_permission("user-123", &Permission::ComplianceRead);
    println!("\nUser has ComplianceRead: {:?}", has_compliance);
    
    rbac.log_audit(
        "user-123".to_string(),
        "VIEW_REPORT".to_string(),
        "REPORTS".to_string(),
        Some("report-456".to_string()),
        "SUCCESS".to_string(),
        Some("192.168.1.1".to_string()),
        Some("Mozilla/5.0".to_string()),
        None,
    );
    
    let audit = rbac.get_audit_log(None, 10);
    println!("\nAudit Entries: {}", audit.len());
}
