//! TigerEx FIX Protocol Engine - Rust Implementation
//! 
//! Financial Information eXchange (FIX) protocol for institutional trading
//! Low-latency FIX 4.2, 4.4, 5.0 SP2 support
//! 
//! Migration from Go to Rust for institutional-grade performance

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// FIX version
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXVersion {
    FIX42,
    FIX44,
    FIX50SP2,
}

/// FIX message type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXMsgType {
    Heartbeat,
    TestRequest,
    ResendRequest,
    Reject,
    SequenceReset,
    Logout,
    ExecutionReport,
    OrderCancelReject,
    QuoteRequest,
    Quote,
    MarketDataRequest,
    MarketDataSnapshot,
    NewOrderSingle,
    OrderCancelRequest,
    OrderCancelReplaceRequest,
}

/// FIX side
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXSide {
    Buy,
    Sell,
    SellShort,
    Cover,
}

/// FIX order type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXOrderType {
    Market,
    Limit,
    Stop,
    StopLimit,
}

/// FIX time in force
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXTimeInForce {
    Day,
    GTC,      // Good Till Cancel
    IOC,      // Immediate Or Cancel
    FOK,      // Fill Or Kill
    GTD,      // Good Till Date
}

/// FIX exec type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXExecType {
    New,
    PartialFill,
    Fill,
    Canceled,
    Replaced,
    Rejected,
    PendingCancel,
    PendingReplace,
    Restated,
}

/// FIX order status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FIXOrderStatus {
    New,
    PartialFill,
    Filled,
    DoneForDay,
    Canceled,
    PendingCancel,
    Replaced,
    Rejected,
    PendingNew,
    Expired,
}

/// FIX field tag numbers
pub mod FIXTags {
    pub const BEGIN_STRING: u16 = 8;
    pub const BODY_LENGTH: u16 = 9;
    pub const MSG_TYPE: u16 = 35;
    pub const SENDER_COMP_ID: u16 = 49;
    pub const TARGET_COMP_ID: u16 = 56;
    pub const ON_BEHALF_OF_COMP_ID: u16 = 57;
    pub const DELIVER_TO_COMP_ID: u16 = 114;
    pub const MSG_SEQ_NUM: u16 = 34;
    pub const POSSIBLE_DUP_FLAG: u16 = 43;
    pub const PUBLISH_TIME: u16 = 347;
    pub const SENDING_TIME: u16 = 52;
    pub const ORD_ID: u16 = 37;
    pub const CL_ORD_ID: u16 = 11;
    pub const ORG_CL_ORD_ID: u16 = 41;
    pub const ACCOUNT: u16 = 1;
    pub const ACCT_ID_SOURCE: u16 = 660;
    pub const SIDE: u16 = 54;
    pub const ORD_TYPE: u16 = 40;
    pub const ORD_TYPE2: u16 = 585;
    pub const PRICE: u16 = 44;
    pub const STOP_PRICE: u16 = 99;
    pub const CURL: u16 = 200;
    pub const CURRL: u16 = 15;
    pub const TIME_IN_FORCE: u16 = 59;
    pub const EXPIRE_TIME: u16 = 126;
    pub const QUANTITY: u16 = 38;
    pub const ORDER_QTY: u16 = 151;
    pub const MIN_QTY: u16 = 110;
    pub const MAX_QTY: u16 = 111;
    pub const SYMBOL: u16 = 55;
    pub const SECURITY_ID: u16 = 48;
    pub const SECURITY_ID_SOURCE: u16 = 22;
    pub const PRODUCT: u16 = 460;
    pub const EXEC_ID: u16 = 17;
    pub const EXEC_REF_ID: u16 = 19;
    pub const EXEC_TYPE: u16 = 150;
    pub const ORD_STATUS: u16 = 39;
    pub const EXEC_TRANS_TYPE: u16 = 20;
    pub const EXEC_RULE: u16 = 27;
    pub const LAST_QTY: u16 = 32;
    pub const LAST_PRICE: u16 = 31;
    pub const LAST_MONEY: u16 = 194;
    pub const LEAVE_QTY: u16 = 152;
    pub const CUM_QTY: u16 = 151;
    pub const AVG_PRICE: u16 = 6;
    pub const COMMISSION: u16 = 12;
    pub const COMM_TYPE: u16 = 13;
    pub const NET_MONEY: u16 = 118;
    pub const TEXT: u16 = 58;
    pub const ODMDQTY: u16 = 140;
    pub const ODMDQTY_TYPE: u16 = 141;
    pub const MD_ENTRY_TYPE: u16 = 269;
    pub const MD_ENTRY_PX: u16 = 270;
    pub const MD_ENTRY_SIZE: u16 = 271;
    pub const MD_ENTRY_DATE: u16 = 272;
    pub const MD_ENTRY_TIME: u16 = 273;
    pub const MD_UPDATE_ACTION: u16 = 279;
    pub const MD_PRICE_LEVEL: u16 = 270;
    pub const MD_ORIG_PRICE: u16 = 291;
    pub const MD_ORIG_SIZE: u16 = 292;
    pub const QUOTE_REQ_ID: u16 = 131;
    pub const QUOTE_ID: u16 = 117;
    pub const BID_PX: u16 = 132;
    pub const OFFER_PX: u16 = 133;
    pub const BID_SIZE: u16 = 134;
    pub const OFFER_SIZE: u16 = 135;
    pub const VALID_UNTIL_TIME: u16 = 126;
    pub const QUOTE_ACK: u16 = 297;
}

/// FIX message
#[derive(Debug, Clone)]
pub struct FIXMessage {
    pub version: FIXVersion,
    pub msg_type: FIXMsgType,
    pub sender: String,
    pub target: String,
    pub sequence: u32,
    pub sending_time: u64,
    pub fields: HashMap<u16, String>,
}

impl FIXMessage {
    pub fn new(version: FIXVersion, msg_type: FIXMsgType, sender: &str, target: &str) -> Self {
        FIXMessage {
            version,
            msg_type,
            sender: sender.to_string(),
            target: target.to_string(),
            sequence: 0,
            sending_time: current_timestamp(),
            fields: HashMap::new(),
        }
    }
    
    pub fn set_field(&mut self, tag: u16, value: &str) {
        self.fields.insert(tag, value.to_string());
    }
    
    pub fn get_field(&self, tag: u16) -> Option<&String> {
        self.fields.get(&tag)
    }
    
    pub fn to_string(&self) -> String {
        let mut parts = Vec::new();
        
        // Add standard header
        let version_str = match self.version {
            FIXVersion::FIX42 => "FIX.4.2",
            FIXVersion::FIX44 => "FIX.4.4",
            FIXVersion::FIX50SP2 => "FIX.5.0SP2",
        };
        
        parts.push(format!("{}={}", FIXTags::BEGIN_STRING, version_str));
        parts.push(format!("{}={}", FIXTags::SENDER_COMP_ID, self.sender));
        parts.push(format!("{}={}", FIXTags::TARGET_COMP_ID, self.target));
        parts.push(format!("{}={}", FIXTags::MSG_SEQ_NUM, self.sequence));
        parts.push(format!("{}={}", FIXTags::SENDING_TIME, self.sending_time));
        
        // Add message type
        let msg_type_str = match self.msg_type {
            FIXMsgType::Heartbeat => "0",
            FIXMsgType::TestRequest => "1",
            FIXMsgType::ResendRequest => "2",
            FIXMsgType::Reject => "3",
            FIXMsgType::SequenceReset => "4",
            FIXMsgType::Logout => "5",
            FIXMsgType::ExecutionReport => "8",
            FIXMsgType::OrderCancelReject => "9",
            FIXMsgType::QuoteRequest => "R",
            FIXMsgType::Quote => "S",
            FIXMsgType::MarketDataRequest => "V",
            FIXMsgType::MarketDataSnapshot => "W",
            FIXMsgType::NewOrderSingle => "D",
            FIXMsgType::OrderCancelRequest => "F",
            FIXMsgType::OrderCancelReplaceRequest => "G",
        };
        parts.push(format!("{}={}", FIXTags::MSG_TYPE, msg_type_str));
        
        // Add custom fields
        for (tag, value) in &self.fields {
            parts.push(format!("{}={}", tag, value));
        }
        
        let body = parts.join("\x01");
        let length = body.len();
        
        // Build complete message
        format!("{}{}={}\x01{}\x0110={:03}",
            format!("{}={}\x01", FIXTags::BODY_LENGTH, length),
            body,
            FIXTags::CHECKSUM,
            calculate_checksum(&body))
    }
}

fn calculate_checksum(data: &str) -> u8 {
    let sum: u8 = data.bytes().map(|b| b as u8).sum();
    sum % 256
}

/// FIX Session
pub struct FIXSession {
    version: FIXVersion,
    sender: String,
    target: String,
    sequence: u32,
    heartbeat_interval: u64,
    last_sent: u64,
    last_received: u64,
    test_request_id: Option<String>,
    logged_in: bool,
}

impl FIXSession {
    pub fn new(version: FIXVersion, sender: &str, target: &str) -> Self {
        FIXSession {
            version,
            sender: sender.to_string(),
            target: target.to_string(),
            sequence: 1,
            heartbeat_interval: 30000, // 30 seconds
            last_sent: current_timestamp(),
            last_received: current_timestamp(),
            test_request_id: None,
            logged_in: false,
        }
    }
    
    pub fn login(&mut self) -> FIXMessage {
        self.logged_in = true;
        FIXMessage::new(self.version, FIXMsgType::Heartbeat, &self.sender, &self.target)
    }
    
    pub fn logout(&mut self) -> FIXMessage {
        self.logged_in = false;
        let mut msg = FIXMessage::new(self.version, FIXMsgType::Logout, &self.sender, &self.target);
        msg.sequence = self.sequence;
        self.sequence += 1;
        msg
    }
    
    pub fn heartbeat(&mut self) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::Heartbeat, &self.sender, &self.target);
        msg.sequence = self.sequence;
        self.sequence += 1;
        self.last_sent = current_timestamp();
        msg
    }
    
    pub fn test_request(&mut self, request_id: &str) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::TestRequest, &self.sender, &self.target);
        msg.sequence = self.sequence;
        msg.set_field(112, request_id); // TestReqID
        self.test_request_id = Some(request_id.to_string());
        self.sequence += 1;
        msg
    }
    
    pub fn new_order(&mut self, cl_ord_id: &str, symbol: &str, side: FIXSide, ord_type: FIXOrderType, quantity: u64, price: Option<u64>) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::NewOrderSingle, &self.sender, &self.target);
        msg.sequence = self.sequence;
        msg.set_field(FIXTags::CL_ORD_ID, cl_ord_id);
        msg.set_field(FIXTags::SYMBOL, symbol);
        msg.set_field(FIXTags::SIDE, match side {
            FIXSide::Buy => "1",
            FIXSide::Sell => "2",
            FIXSide::SellShort => "5",
            FIXSide::Cover => "C",
        });
        msg.set_field(FIXTags::ORD_TYPE, match ord_type {
            FIXOrderType::Market => "1",
            FIXOrderType::Limit => "2",
            FIXOrderType::Stop => "3",
            FIXOrderType::StopLimit => "4",
        });
        msg.set_field(FIXTags::QUANTITY, &quantity.to_string());
        if let Some(p) = price {
            msg.set_field(FIXTags::PRICE, &p.to_string());
        }
        
        self.sequence += 1;
        msg
    }
    
    pub fn cancel_order(&mut self, cl_ord_id: &str, orig_cl_ord_id: &str, symbol: &str, side: FIXSide, quantity: u64) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::OrderCancelRequest, &self.sender, &self.target);
        msg.sequence = self.sequence;
        msg.set_field(FIXTags::CL_ORD_ID, cl_ord_id);
        msg.set_field(FIXTags::ORG_CL_ORD_ID, orig_cl_ord_id);
        msg.set_field(FIXTags::SYMBOL, symbol);
        msg.set_field(FIXTags::SIDE, match side {
            FIXSide::Buy => "1",
            FIXSide::Sell => "2",
            FIXSide::SellShort => "5",
            FIXSide::Cover => "C",
        });
        msg.set_field(FIXTags::ORDER_QTY, &quantity.to_string());
        
        self.sequence += 1;
        msg
    }
    
    pub fn replace_order(&mut self, cl_ord_id: &str, orig_cl_ord_id: &str, symbol: &str, side: FIXSide, quantity: u64, price: Option<u64>) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::OrderCancelReplaceRequest, &self.sender, &self.target);
        msg.sequence = self.sequence;
        msg.set_field(FIXTags::CL_ORD_ID, cl_ord_id);
        msg.set_field(FIXTags::ORG_CL_ORD_ID, orig_cl_ord_id);
        msg.set_field(FIXTags::SYMBOL, symbol);
        msg.set_field(FIXTags::SIDE, match side {
            FIXSide::Buy => "1",
            FIXSide::Sell => "2",
            FIXSide::SellShort => "5",
            FIXSide::Cover => "C",
        });
        msg.set_field(FIXTags::ORDER_QTY, &quantity.to_string());
        if let Some(p) = price {
            msg.set_field(FIXTags::PRICE, &p.to_string());
        }
        
        self.sequence += 1;
        msg
    }
    
    pub fn request_quote(&mut self, quote_id: &str, symbol: &str) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::QuoteRequest, &self.sender, &self.target);
        msg.sequence = self.sequence;
        msg.set_field(FIXTags::QUOTE_REQ_ID, quote_id);
        msg.set_field(FIXTags::SYMBOL, symbol);
        
        self.sequence += 1;
        msg
    }
    
    pub fn request_market_data(&mut self, request_id: &str, symbol: &str) -> FIXMessage {
        let mut msg = FIXMessage::new(self.version, FIXMsgType::MarketDataRequest, &self.sender, &self.target);
        msg.sequence = self.sequence;
        msg.set_field(262, request_id); // MDReqID
        msg.set_field(263, "1");       // SubscriptionRequestType (Snapshot + Updates)
        msg.set_field(264, "0");       // MarketDepth
        msg.set_field(FIXTags::SYMBOL, symbol);
        
        self.sequence += 1;
        msg
    }
    
    pub fn parse_message(&mut self, data: &str) -> Result<FIXMessage, String> {
        let mut fields = HashMap::new();
        
        for part in data.split('\x01') {
            if let Some(eq_pos) = part.find('=') {
                let tag: u16 = part[..eq_pos].parse().map_err(|_| "Invalid tag")?;
                let value = &part[eq_pos + 1..];
                fields.insert(tag, value.to_string());
            }
        }
        
        let version = match fields.get(&FIXTags::BEGIN_STRING).map(|s| s.as_str()) {
            Some("FIX.4.2") => FIXVersion::FIX42,
            Some("FIX.4.4") => FIXVersion::FIX44,
            Some("FIX.5.0SP2") => FIXVersion::FIX50SP2,
            _ => return Err("Unknown FIX version".to_string()),
        };
        
        let msg_type = match fields.get(&FIXTags::MSG_TYPE).map(|s| s.as_str()) {
            Some("0") => FIXMsgType::Heartbeat,
            Some("1") => FIXMsgType::TestRequest,
            Some("2") => FIXMsgType::ResendRequest,
            Some("3") => FIXMsgType::Reject,
            Some("4") => FIXMsgType::SequenceReset,
            Some("5") => FIXMsgType::Logout,
            Some("8") => FIXMsgType::ExecutionReport,
            Some("9") => FIXMsgType::OrderCancelReject,
            Some("R") => FIXMsgType::QuoteRequest,
            Some("S") => FIXMsgType::Quote,
            Some("V") => FIXMsgType::MarketDataRequest,
            Some("W") => FIXMsgType::MarketDataSnapshot,
            Some("D") => FIXMsgType::NewOrderSingle,
            Some("F") => FIXMsgType::OrderCancelRequest,
            Some("G") => FIXMsgType::OrderCancelReplaceRequest,
            _ => return Err("Unknown message type".to_string()),
        };
        
        let sender = fields.get(&FIXTags::SENDER_COMP_ID).cloned().unwrap_or_default();
        let target = fields.get(&FIXTags::TARGET_COMP_ID).cloned().unwrap_or_default();
        let sequence: u32 = fields.get(&FIXTags::MSG_SEQ_NUM).and_then(|s| s.parse().ok()).unwrap_or(0);
        
        self.last_received = current_timestamp();
        
        Ok(FIXMessage {
            version,
            msg_type,
            sender,
            target,
            sequence,
            sending_time: current_timestamp(),
            fields,
        })
    }
}

/// FIX Engine - manages multiple sessions
pub struct FIXEngine {
    sessions: HashMap<String, FIXSession>,
    default_version: FIXVersion,
}

impl FIXEngine {
    pub fn new() -> Self {
        FIXEngine {
            sessions: HashMap::new(),
            default_version: FIXVersion::FIX44,
        }
    }
    
    pub fn create_session(&mut self, session_id: &str, sender: &str, target: &str) -> &FIXSession {
        self.sessions.insert(session_id.to_string(), FIXSession::new(self.default_version, sender, target));
        self.sessions.get(session_id).unwrap()
    }
    
    pub fn get_session(&self, session_id: &str) -> Option<&FIXSession> {
        self.sessions.get(session_id)
    }
    
    pub fn get_session_mut(&mut self, session_id: &str) -> Option<&mut FIXSession> {
        self.sessions.get_mut(session_id)
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_create_new_order() {
        let mut engine = FIXEngine::new();
        engine.create_session("s1", "CLIENT", "EXCHANGE");
        
        let session = engine.get_session_mut("s1").unwrap();
        let msg = session.new_order("CL123", "BTCUSDT", FIXSide::Buy, FIXOrderType::Limit, 100, Some(50000));
        
        let msg_str = msg.to_string();
        assert!(msg_str.contains("35=D"));
    }
    
    #[test]
    fn test_cancel_order() {
        let mut engine = FIXEngine::new();
        engine.create_session("s1", "CLIENT", "EXCHANGE");
        
        let session = engine.get_session_mut("s1").unwrap();
        let msg = session.cancel_order("CL456", "CL123", "BTCUSDT", FIXSide::Buy, 50);
        
        let msg_str = msg.to_string();
        assert!(msg_str.contains("35=F"));
    }
    
    #[test]
    fn test_market_data_request() {
        let mut engine = FIXEngine::new();
        engine.create_session("s1", "CLIENT", "EXCHANGE");
        
        let session = engine.get_session_mut("s1").unwrap();
        let msg = session.request_market_data("MD123", "BTCUSDT");
        
        let msg_str = msg.to_string();
        assert!(msg_str.contains("35=V"));
    }
}