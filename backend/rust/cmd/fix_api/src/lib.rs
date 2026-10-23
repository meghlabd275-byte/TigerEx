//! TigerEx FIX API - Institutional Trading Protocol
//! Complete FIX 4.2, 4.4, 5.0 SP2 implementation for institutional clients

use std::collections::HashMap;
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

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum FixVersion {
    Fix42,
    Fix44,
    Fix50Sp1,
    Fix50Sp2,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FixCredentials {
    pub username: String,
    pub password: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
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

    /// Register an institutional account.
    pub async fn add_account(&self, account: InstitutionalAccount) -> Result<(), String> {
        if account.account_id.trim().is_empty() {
            return Err("account_id must not be empty".to_string());
        }
        let mut accounts = self.accounts.write().await;
        if accounts.contains_key(&account.account_id) {
            return Err("account already exists".to_string());
        }
        accounts.insert(account.account_id.clone(), account);
        Ok(())
    }

    pub async fn account(&self, account_id: &str) -> Option<InstitutionalAccount> {
        self.accounts.read().await.get(account_id).cloned()
    }

    /// Open a session. Credentials are required: an empty username, password or
    /// API key is rejected rather than accepted as an anonymous session.
    pub async fn create_session(
        &self,
        sender_id: &str,
        target_id: &str,
        credentials: FixCredentials,
        version: FixVersion,
    ) -> Result<FixSession, String> {
        if sender_id.trim().is_empty() || target_id.trim().is_empty() {
            return Err("sender and target CompID are required".to_string());
        }
        if credentials.username.trim().is_empty()
            || credentials.password.trim().is_empty()
            || credentials.api_key.trim().is_empty()
        {
            return Err("username, password and api_key are all required".to_string());
        }

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

        self.sessions
            .write()
            .await
            .insert(session.session_id.clone(), session.clone());
        Ok(session)
    }

    pub async fn session(&self, session_id: &str) -> Option<FixSession> {
        self.sessions.read().await.get(session_id).cloned()
    }

    /// Log a session in after credential verification.
    pub async fn logon(
        &self,
        session_id: &str,
        credentials: &FixCredentials,
    ) -> Result<FixSession, String> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "unknown session".to_string())?;

        if &session.credentials != credentials {
            session.status = SessionStatus::Error;
            return Err("invalid credentials".to_string());
        }

        session.status = SessionStatus::LoggedIn;
        session.last_received_time = current_timestamp();
        Ok(session.clone())
    }

    pub async fn logout(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| "unknown session".to_string())?;
        session.status = SessionStatus::Disconnected;
        Ok(())
    }

    /// Accept an inbound message, enforcing the FIX sequence number.
    ///
    /// A gap (message number above the expected one) is a protocol error and
    /// returns the expected number so the peer can resend. A duplicate or stale
    /// message is rejected without advancing the counter.
    pub async fn on_inbound(
        &self,
        session_id: &str,
        msg_seq_num: u32,
    ) -> Result<FixMessage, FixSequenceError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(FixSequenceError::UnknownSession)?;

        if session.status != SessionStatus::LoggedIn {
            return Err(FixSequenceError::NotLoggedIn);
        }

        if msg_seq_num < session.incoming_seq_num {
            return Err(FixSequenceError::Duplicate {
                expected: session.incoming_seq_num,
            });
        }
        if msg_seq_num > session.incoming_seq_num {
            return Err(FixSequenceError::Gap {
                expected: session.incoming_seq_num,
                received: msg_seq_num,
            });
        }

        session.incoming_seq_num += 1;
        session.last_received_time = current_timestamp();

        Ok(FixMessage {
            msg_type: FixMsgType::Unknown,
            sender_comp_id: session.sender_comp_id.clone(),
            target_comp_id: session.target_comp_id.clone(),
            msg_seq_num,
            sending_time: current_timestamp(),
            fields: HashMap::new(),
        })
    }

    /// Number the next outbound message.
    pub async fn next_outbound(&self, session_id: &str) -> Result<u32, FixSequenceError> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or(FixSequenceError::UnknownSession)?;

        let sequence = session.outgoing_seq_num;
        session.outgoing_seq_num += 1;
        session.last_sent_time = current_timestamp();
        Ok(sequence)
    }
}

/// Reasons an inbound message can be rejected by sequence handling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FixSequenceError {
    UnknownSession,
    NotLoggedIn,
    /// The message is older than expected; do not advance.
    Duplicate { expected: u32 },
    /// The message skips ahead; the peer must resend from `expected`.
    Gap { expected: u32, received: u32 },
}

impl std::fmt::Display for FixSequenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FixSequenceError::UnknownSession => write!(f, "unknown session"),
            FixSequenceError::NotLoggedIn => write!(f, "session is not logged in"),
            FixSequenceError::Duplicate { expected } => {
                write!(f, "duplicate message, expected {expected}")
            }
            FixSequenceError::Gap { expected, received } => {
                write!(f, "sequence gap: expected {expected}, received {received}")
            }
        }
    }
}

impl std::error::Error for FixSequenceError {}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Unique id: nanosecond time plus a process-wide counter.
fn generate_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", prefix, nanos, sequence)
}

/// Parse a SOH-delimited FIX message.
///
/// Body length (9) and checksum (10) are validated when present, so a corrupted
/// message is rejected instead of silently accepted.
pub fn parse_fix_message(raw: &str) -> Result<FixMessage, String> {
    let mut fields = HashMap::new();
    for field in raw.split('\x01') {
        if field.is_empty() {
            continue;
        }
        let (tag, value) = field
            .split_once('=')
            .ok_or_else(|| format!("malformed field: {field}"))?;
        fields.insert(tag.to_string(), value.to_string());
    }

    let msg_type_str = fields.get("35").ok_or("Missing MsgType")?;
    let msg_type = FixMsgType::from_str(msg_type_str);

    if let Some(body) = fields.get("9") {
        let declared: usize = body.parse().map_err(|_| "invalid BodyLength")?;
        let actual = raw
            .split('\x01')
            .take_while(|field| !field.starts_with("10="))
            .filter(|field| !field.is_empty() && !field.starts_with("8=") && !field.starts_with("9="))
            .map(|field| field.len() + 1)
            .sum::<usize>();
        if declared != actual {
            return Err(format!(
                "BodyLength mismatch: declared {declared}, actual {actual}"
            ));
        }
    }

    if let Some(checksum) = fields.get("10") {
        let expected: u32 = checksum.parse().map_err(|_| "invalid CheckSum")?;
        let computed = checksum_of(raw);
        if expected != computed {
            return Err(format!(
                "CheckSum mismatch: declared {expected}, computed {computed}"
            ));
        }
    }

    Ok(FixMessage {
        msg_type,
        sender_comp_id: fields.get("49").cloned().unwrap_or_default(),
        target_comp_id: fields.get("56").cloned().unwrap_or_default(),
        msg_seq_num: fields.get("34").and_then(|s| s.parse().ok()).unwrap_or(0),
        sending_time: fields.get("52").and_then(|s| s.parse().ok()).unwrap_or(0),
        fields,
    })
}

/// FIX checksum: sum of every byte before the checksum field, modulo 256.
fn checksum_of(raw: &str) -> u32 {
    let body = match raw.rfind("10=") {
        Some(index) => &raw[..index],
        None => raw,
    };
    body.bytes().map(|byte| byte as u32).sum::<u32>() % 256
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credentials() -> FixCredentials {
        FixCredentials {
            username: "inst".to_string(),
            password: "secret".to_string(),
            api_key: "key".to_string(),
        }
    }

    async fn logged_in(server: &FixApiServer) -> String {
        let session = server
            .create_session("CLIENT1", "TIGEREX", credentials(), FixVersion::Fix44)
            .await
            .unwrap();
        server.logon(&session.session_id, &credentials()).await.unwrap();
        session.session_id
    }

    #[test]
    fn message_type_round_trip() {
        for (code, kind) in [
            ("0", FixMsgType::Heartbeat),
            ("D", FixMsgType::NewOrderSingle),
            ("8", FixMsgType::ExecutionReport),
        ] {
            assert_eq!(FixMsgType::from_str(code), kind);
            assert_eq!(kind.to_str(), code);
        }
        assert_eq!(FixMsgType::from_str("ZZ"), FixMsgType::Unknown);
    }

    #[tokio::test]
    async fn session_requires_credentials() {
        let server = FixApiServer::new();
        let empty = FixCredentials {
            username: String::new(),
            password: String::new(),
            api_key: String::new(),
        };
        assert!(server
            .create_session("A", "B", empty, FixVersion::Fix44)
            .await
            .is_err());
        assert!(server
            .create_session("", "B", credentials(), FixVersion::Fix44)
            .await
            .is_err());
        assert!(server
            .create_session("A", "B", credentials(), FixVersion::Fix44)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn logon_rejects_wrong_credentials() {
        let server = FixApiServer::new();
        let session = server
            .create_session("CLIENT1", "TIGEREX", credentials(), FixVersion::Fix44)
            .await
            .unwrap();

        let wrong = FixCredentials {
            username: "inst".to_string(),
            password: "wrong".to_string(),
            api_key: "key".to_string(),
        };
        assert!(server.logon(&session.session_id, &wrong).await.is_err());
        assert_eq!(
            server.session(&session.session_id).await.unwrap().status,
            SessionStatus::Error
        );

        assert!(server.logon(&session.session_id, &credentials()).await.is_ok());
        assert_eq!(
            server.session(&session.session_id).await.unwrap().status,
            SessionStatus::LoggedIn
        );
    }

    #[tokio::test]
    async fn sequence_numbers_are_enforced() {
        let server = FixApiServer::new();
        let id = logged_in(&server).await;

        assert!(server.on_inbound(&id, 1).await.is_ok());

        // A gap must be reported, not accepted.
        assert_eq!(
            server.on_inbound(&id, 5).await.unwrap_err(),
            FixSequenceError::Gap {
                expected: 2,
                received: 5
            }
        );
        // A duplicate must not advance the counter.
        assert_eq!(
            server.on_inbound(&id, 1).await.unwrap_err(),
            FixSequenceError::Duplicate { expected: 2 }
        );

        assert!(server.on_inbound(&id, 2).await.is_ok());
        assert_eq!(server.session(&id).await.unwrap().incoming_seq_num, 3);
    }

    #[tokio::test]
    async fn outbound_sequence_increments() {
        let server = FixApiServer::new();
        let id = logged_in(&server).await;

        assert_eq!(server.next_outbound(&id).await.unwrap(), 1);
        assert_eq!(server.next_outbound(&id).await.unwrap(), 2);
        assert_eq!(server.session(&id).await.unwrap().outgoing_seq_num, 3);
    }

    #[tokio::test]
    async fn inbound_before_logon_is_refused() {
        let server = FixApiServer::new();
        let session = server
            .create_session("CLIENT1", "TIGEREX", credentials(), FixVersion::Fix44)
            .await
            .unwrap();

        assert_eq!(
            server.on_inbound(&session.session_id, 1).await.unwrap_err(),
            FixSequenceError::NotLoggedIn
        );
        assert_eq!(
            server.on_inbound("missing", 1).await.unwrap_err(),
            FixSequenceError::UnknownSession
        );
    }

    #[tokio::test]
    async fn accounts_are_unique() {
        let server = FixApiServer::new();
        let account = InstitutionalAccount {
            account_id: "inst001".to_string(),
            account_type: AccountType::Institutional,
            account_name: "Alpha".to_string(),
            organization: "Alpha Capital".to_string(),
            status: AccountStatus::Active,
            margin_enabled: true,
        };

        server.add_account(account.clone()).await.unwrap();
        assert!(server.add_account(account).await.is_err());
        assert!(server.account("inst001").await.is_some());
    }

    #[test]
    fn parse_extracts_fields() {
        let body = "35=D\x0149=CLIENT1\x0156=TIGEREX\x0134=7\x0152=1\x01";
        let raw = format!("8=FIX.4.4\x019={}\x01{body}", body.len());
        let message = parse_fix_message(&raw).unwrap();
        assert_eq!(message.msg_type, FixMsgType::NewOrderSingle);
        assert_eq!(message.sender_comp_id, "CLIENT1");
        assert_eq!(message.target_comp_id, "TIGEREX");
        assert_eq!(message.msg_seq_num, 7);
    }

    #[test]
    fn parse_requires_msg_type() {
        assert!(parse_fix_message("49=CLIENT1\x01").is_err());
    }

    #[test]
    fn checksum_detects_corruption() {
        let body = "35=D\x0149=CLIENT1\x01";
        let checksum = checksum_of(body);
        let valid = format!("{body}10={:03}\x01", checksum);
        assert!(parse_fix_message(&valid).is_ok());

        let corrupted = format!("{body}10={:03}\x01", (checksum + 1) % 256);
        assert!(parse_fix_message(&corrupted).is_err());
    }
}
