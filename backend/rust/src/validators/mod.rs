//! Validators Module - Rust Implementation
//! 
//! Production-grade validation for all exchange APIs

use serde::{Serialize, Deserialize};

/// Error codes for the exchange
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    InternalError,
    ValidationError,
    NotFound,
    Unauthorized,
    Forbidden,
    InsufficientBalance,
    InvalidOrderType,
    OrderNotFound,
    OrderClosed,
    PriceOutOfRange,
    QuantityTooSmall,
    LeverageTooHigh,
    AccountNotVerified,
    KycRequired,
    AccountFrozen,
    WithdrawalDisabled,
    RiskLimitExceeded,
    MarginInsufficient,
    LiquidationImminent,
    ServiceUnavailable,
    RateLimitExceeded,
}

/// Validation error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationErr {
    pub code: ErrorCode,
    pub message: String,
    pub status_code: u16,
    pub field: Option<String>,
}

impl ValidationErr {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::ValidationError,
            message: message.into(),
            status_code: 400,
            field: None,
        }
    }

    pub fn with_field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }
}

// ============================================================================
// USER VALIDATORS
// ============================================================================

pub struct UserValidators;

impl UserValidators {
    /// Validate email format
    pub fn email(email: &str) -> Result<(), ValidationErr> {
        if !email.contains('@') || !email.contains('.') {
            return Err(ValidationErr::new("Invalid email format").with_field("email"));
        }
        
        let parts: Vec<&str> = email.split('@').collect();
        if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
            return Err(ValidationErr::new("Invalid email format").with_field("email"));
        }
        
        Ok(())
    }

    /// Validate password strength
    pub fn password(password: &str) -> Result<(), ValidationErr> {
        if password.len() < 8 {
            return Err(ValidationErr::new("Password must be at least 8 characters").with_field("password"));
        }
        
        let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
        let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
        let has_digit = password.chars().any(|c| c.is_ascii_digit());
        
        if !has_upper {
            return Err(ValidationErr::new("Password must contain uppercase").with_field("password"));
        }
        if !has_lower {
            return Err(ValidationErr::new("Password must contain lowercase").with_field("password"));
        }
        if !has_digit {
            return Err(ValidationErr::new("Password must contain number").with_field("password"));
        }
        
        Ok(())
    }

    /// Validate username
    pub fn username(username: &str) -> Result<(), ValidationErr> {
        if username.len() < 3 {
            return Err(ValidationErr::new("Username must be at least 3 characters").with_field("username"));
        }
        if username.len() > 20 {
            return Err(ValidationErr::new("Username must be at most 20 characters").with_field("username"));
        }
        if !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(ValidationErr::new("Username can only contain letters, numbers, underscore").with_field("username"));
        }
        
        Ok(())
    }
}

// ============================================================================
// TRADING VALIDATORS
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit,
    StopMarket,
    StopLimit,
    TakeProfit,
    TrailingStop,
}

pub struct TradingValidators;

impl TradingValidators {
    /// Validate order side
    pub fn order_side(side: &str) -> Result<OrderSide, ValidationErr> {
        match side.to_lowercase().as_str() {
            "buy" => Ok(OrderSide::Buy),
            "sell" => Ok(OrderSide::Sell),
            _ => Err(ValidationErr::new("Order side must be buy or sell").with_field("side")),
        }
    }

    /// Validate order type
    pub fn order_type(order_type: &str) -> Result<OrderType, ValidationErr> {
        match order_type.to_lowercase().as_str() {
            "market" => Ok(OrderType::Market),
            "limit" => Ok(OrderType::Limit),
            "stop_market" => Ok(OrderType::StopMarket),
            "stop_limit" => Ok(OrderType::StopLimit),
            "take_profit" => Ok(OrderType::TakeProfit),
            "trailing" => Ok(OrderType::TrailingStop),
            _ => Err(ValidationErr::new(format!("Invalid order type: {}", order_type)).with_field("type")),
        }
    }

    /// Validate price
    pub fn price(price: f64, min_price: f64) -> Result<(), ValidationErr> {
        if price.is_nan() || price.is_infinite() {
            return Err(ValidationErr::new("Price must be a valid number").with_field("price"));
        }
        if price <= min_price {
            return Err(ValidationErr::new(format!("Price must be greater than {}", min_price)).with_field("price"));
        }
        Ok(())
    }

    /// Validate quantity
    pub fn quantity(quantity: f64, min_qty: f64) -> Result<(), ValidationErr> {
        if quantity.is_nan() || quantity.is_infinite() {
            return Err(ValidationErr::new("Quantity must be a valid number").with_field("quantity"));
        }
        if quantity <= min_qty {
            return Err(ValidationErr::new(format!("Quantity must be greater than {}", min_qty)).with_field("quantity"));
        }
        Ok(())
    }

    /// Validate leverage
    pub fn leverage(leverage: f64) -> Result<(), ValidationErr> {
        let valid_leverages = [1.0, 2.0, 3.0, 5.0, 10.0, 20.0, 25.0, 50.0, 75.0, 100.0];
        if !valid_leverages.contains(&leverage) {
            return Err(ValidationErr::new(format!("Invalid leverage: {}", leverage)).with_field("leverage"));
        }
        Ok(())
    }
}

// ============================================================================
// WALLET VALIDATORS
// ============================================================================

pub struct WalletValidators;

impl WalletValidators {
    /// Validate wallet address (basic validation)
    pub fn address(address: &str, _network: &str) -> Result<(), ValidationErr> {
        if address.is_empty() || address.len() < 20 {
            return Err(ValidationErr::new("Invalid wallet address").with_field("address"));
        }
        Ok(())
    }

    /// Validate amount
    pub fn amount(amount: f64, min_amount: f64) -> Result<(), ValidationErr> {
        if amount.is_nan() || amount.is_infinite() {
            return Err(ValidationErr::new("Amount must be a valid number").with_field("amount"));
        }
        if amount <= min_amount {
            return Err(ValidationErr::new(format!("Amount must be greater than {}", min_amount)).with_field("amount"));
        }
        if amount > 1e15 {
            return Err(ValidationErr::new("Amount exceeds maximum").with_field("amount"));
        }
        Ok(())
    }

    /// Validate crypto address format
    pub fn crypto_address(address: &str) -> Result<(), ValidationErr> {
        // Basic Ethereum-style address check (0x followed by 40 hex chars)
        if address.starts_with("0x") {
            if address.len() != 42 {
                return Err(ValidationErr::new("Invalid Ethereum address length").with_field("address"));
            }
            let hex_part = &address[2..];
            if !hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(ValidationErr::new("Invalid Ethereum address格式").with_field("address"));
            }
            return Ok(());
        }
        
        // Bitcoin Legacy (P2PKH) starts with 1
        // Bitcoin SegWit (P2SH) starts with 3
        // Bitcoin Native SegWit (bech32) starts with bc1
        if address.starts_with('1') || address.starts_with('3') || address.starts_with("bc1") {
            return Ok(());
        }
        
        Err(ValidationErr::new("Unsupported cryptocurrency address format").with_field("address"))
    }
}

// ============================================================================
// KYC VALIDATORS  
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentType {
    Passport,
    DriversLicense,
    NationalId,
}

pub struct KycValidators;

impl KycValidators {
    /// Validate document type
    pub fn document_type(doc_type: &str) -> Result<DocumentType, ValidationErr> {
        match doc_type.to_lowercase().as_str() {
            "passport" => Ok(DocumentType::Passport),
            "drivers_license" => Ok(DocumentType::DriversLicense),
            "national_id" => Ok(DocumentType::NationalId),
            _ => Err(ValidationErr::new("Invalid document type").with_field("documentType")),
        }
    }

    /// Validate country code (ISO 3166-1 alpha-2)
    pub fn country(country: &str) -> Result<(), ValidationErr> {
        if country.is_empty() || country.len() != 2 {
            return Err(ValidationErr::new("Invalid country code").with_field("country"));
        }
        if !country.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(ValidationErr::new("Country code must be letters only").with_field("country"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_valid() {
        assert!(UserValidators::email("test@example.com").is_ok());
    }

    #[test]
    fn test_email_invalid() {
        assert!(UserValidators::email("invalid").is_err());
    }

    #[test]
    fn test_password_valid() {
        assert!(UserValidators::password("SecurePass123").is_ok());
    }

    #[test]
    fn test_password_short() {
        assert!(UserValidators::password("short").is_err());
    }

    #[test]
    fn test_order_side() {
        assert!(TradingValidators::order_side("buy").is_ok());
        assert!(TradingValidators::order_side("sell").is_ok());
    }

    #[test]
    fn test_leverage_valid() {
        assert!(TradingValidators::leverage(10.0).is_ok());
    }

    #[test]
    fn test_leverage_invalid() {
        assert!(TradingValidators::leverage(7.0).is_err());
    }

    #[test]
    fn test_crypto_address_eth() {
        assert!(WalletValidators::crypto_address("0x742d35Cc6544D86f7c5d7c3d1E3C3E3C3E3C3E3C3E3C3").is_ok());
    }
}