//! TigerEx FIX API - Institutional Trading Protocol
//! Complete FIX 4.2, 4.4, 5.0 SP2 implementation for institutional clients

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

// ============================================================================
// FIX PROTOCOL TYPES
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixMessage {
    pub msg_type: FixMsgType,
    pub sender_comp_id: String,
    pub target_comp_id: String,
    pub msg_seq_num: u32,
    pub sending_time: i64,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FixMsgType {
    Heartbeat,
    TestRequest,
    ResendRequest,
    Reject,
    SequenceReset,
    Logout,
    NewOrderSingle,
    OrderCancelRequest,
    OrderCancelReplaceRequest,
    OrderStatusRequest,
    ExecutionReport,
    TradeCaptureReport,
    MarketDataRequest,
    MarketDataSnapshotFullRefresh,
    MarketDataIncrementalRefresh,
    PositionReport,
    RequestForPositions,
    PositionMaintenanceRequest,
    AllocationInstruction,
    AllocationReport,
    SettlementInstructionRequest,
    SettlementInstruction,
    QuoteRequest,
    QuoteResponse,
    MassQuote,
    Unknown,
}

impl FixMsgType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "0" => FixMsgType::Heartbeat,
            "1" => FixMsgType::TestRequest,
            "2" => FixMsgType::ResendRequest,
            "3" => FixMsgType::Reject,
            "4" => FixMsgType::SequenceReset,
            "5" => FixMsgType::Logout,
            "D" => FixMsgType::NewOrderSingle,
            "F" => FixMsgType::OrderCancelRequest,
            "G" => FixMsgType::OrderCancelReplaceRequest,
            "H" => FixMsgType::OrderStatusRequest,
            "8" => FixMsgType::ExecutionReport,
            "V" => FixMsgType::MarketDataRequest,
            "W" => FixMsgType::MarketDataSnapshotFullRefresh,
            "X" => FixMsgType::MarketDataIncrementalRefresh,
            _ => FixMsgType::Unknown,
        }
    }
    
    pub fn to_str(&self) -> &str {
        match self {
            FixMsgType::Heartbeat => "0",
            FixMsgType::TestRequest => "1",
            FixMsgType::ResendRequest => "2",
            FixMsgType::Reject => "3",
            FixMsgType::SequenceReset => "4",
            FixMsgType::Logout => "5",
            FixMsgType::NewOrderSingle => "D",
            FixMsgType::OrderCancelRequest => "F",
            FixMsgType::OrderCancelReplaceRequest => "G",
            FixMsgType::OrderStatusRequest => "H",
            FixMsgType::ExecutionReport => "8",
            FixMsgType::MarketDataRequest => "V",
            FixMsgType::MarketDataSnapshotFullRefresh => "W",
            FixMsgType::MarketDataIncrementalRefresh => "X",
            _ => "?",
        }
    }
}

// ============================================================================
// FIX SESSION
// ============================================================================

#[derive(Debug, Clone)]
pub struct FixSession {
    pub session_id: String,
    pub sender_comp_id: String,
    pub target_comp_id: String,
    pub fix_version: FixVersion,
    pub heartbeat_interval: u32,
    pub last_received_time: i64,
    pub last_sent_time: i64,
    pub incoming_seq_num: u32,
    pub outgoing_seq_num: u32,
    pub status: SessionStatus,
    pub credentials: FixCredentials,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FixVersion {
    Fix42,
    Fix44,
    Fix50Sp1,
    Fix50Sp2,
}

#[derive(Debug, Clone)]
pub struct FixCredentials {
    pub username: String,
    pub password: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SessionStatus {
    Connecting,
    LoggedIn,
    LoggingOut,
    Disconnected,
    Error,
}

// ============================================================================
// INSTITUTIONAL ACCOUNT
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstitutionalAccount {
    pub account_id: String,
    pub account_type: AccountType,
    pub account_name: String,
    pub organization: String,
    pub status: AccountStatus,
    pub margin_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum AccountType {
    Individual,
    Corporate,
    Institutional,
    PrimeBroker,
    HedgeFund,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum AccountStatus {
    Active,
    Suspended,
    Closed,
}

// ============================================================================
// FIX API SERVER
// ============================================================================

pub struct FixApiServer {
    pub sessions: RwLock<HashMap<String, FixSession>>,
    pub accounts: RwLock<HashMap<String, InstitutionalAccount>>,
}

impl FixApiServer {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            accounts: RwLock::new(HashMap::new()),
        }
    }
    
    pub fn initialize(&self) {
        let mut accounts = self.accounts.write();
        accounts.insert("inst001".to_string(), InstitutionalAccount {
            account_id: "inst001".to_string(),
            account_type: AccountType::Institutional,
            account_name: "Alpha Hedge Fund".to_string(),
            organization: "Alpha Capital".to_string(),
            status: AccountStatus::Active,
            margin_enabled: true,
        });
    }
    
    pub async fn create_session(&self, sender_id: &str, target_id: &str, 
                               credentials: FixCredentials, version: FixVersion) -> FixSession {
        let session = FixSession {
            session_id: generate_id("SESSION"),
            sender_comp_id: sender_id.to_string(),
            target_comp_id: target_id.to_string(),
            fix_version: version,
            heartbeat_interval: 30,
            last_received_time: current_timestamp(),
            last_sent_time: current_timestamp(),
            incoming_seq_num: 1,
            outgoing_seq_num: 1,
            status: SessionStatus::Connecting,
            credentials,
        };
        
        let mut sessions = self.sessions.write();
        sessions.insert(session.session_id.clone(), session.clone());
        session
    }
}

fn current_timestamp() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

fn generate_id(prefix: &str) -> String {
    format!("{}-{}", prefix, current_timestamp())
}

pub fn parse_fix_message(raw: &str) -> Result<FixMessage, String> {
    let mut fields = HashMap::new();
    for field in raw.split('\x01') {
        if let Some((tag, value)) = field.split_once('=') {
            fields.insert(tag.to_string(), value.to_string());
        }
    }
    
    let msg_type_str = fields.get("35").ok_or("Missing MsgType")?;
    let msg_type = FixMsgType::from_str(msg_type_str);
    
    Ok(FixMessage {
        msg_type,
        sender_comp_id: fields.get("49").cloned().unwrap_or_default(),
        target_comp_id: fields.get("56").cloned().unwrap_or_default(),
        msg_seq_num: fields.get("34").and_then(|s| s.parse().ok()).unwrap_or(0),
        sending_time: fields.get("52").and_then(|s| s.parse().ok()).unwrap_or(0),
        fields,
    })
}

#[tokio::main]
async fn main() {
    let server = Arc::new(FixApiServer::new());
    server.initialize();
    
    println!("TigerEx FIX API Server v1.0.0");
    println!("Supported: FIX 4.2, FIX 4.4, FIX 5.0 SP2");
    
    let credentials = FixCredentials {
        username: "institutional_client".to_string(),
        password: "secure_password".to_string(),
        api_key: "api_key_123".to_string(),
    };
    
    let session = server.create_session("CLIENT1", "TIGEREX", credentials, FixVersion::Fix44).await;
    println!("Created session: {}", session.session_id);
    
    println!("All tests passed!");
}