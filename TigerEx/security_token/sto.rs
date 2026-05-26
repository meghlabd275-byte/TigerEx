//! Security Token (STO)
//! Tokenized securities compliance
//! Migration: TypeScript -> Rust (security)

use std::collections::HashMap;
use std::sync::Mutex;

/// Security token type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityType {
    Equity,
    Debt,
    Derivative,
    Fund,
    REIT,
}

/// Investor accreditation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Accreditation {
    Unverified,
    Accredited,
    QualifiedPurchaser,
}

/// Security token
#[derive(Debug, Clone)]
pub struct SecurityToken {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub security_type: SecurityType,
    pub total_supply: f64,
    pub price: f64,
    pub accredited_required: Accreditation,
}

/// Investor record
#[derive(Debug, Clone)]
pub struct Investor {
    pub id: String,
    pub wallet: String,
    pub accreditation: Accreditation,
    pub holdings: f64,
    pub kyc_verified: bool,
}

/// STO platform
pub struct STOPlatform {
    tokens: Mutex<Vec<SecurityToken>>,
    investors: Mutex<HashMap<String, Investor>>,
    transactions: Mutex<Vec<Transaction>>,
}

/// Transaction record
#[derive(Debug, Clone)]
pub struct Transaction {
    pub id: String,
    pub token_id: String,
    pub investor_id: String,
    pub amount: f64,
    pub timestamp: i64,
    pub status: String,
}

impl STOPlatform {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(Vec::new()),
            investors: Mutex::new(HashMap::new()),
            transactions: Mutex::new(Vec::new()),
        }
    }

    /// Issue security token
    pub fn issue_token(&self, name: &str, symbol: &str, sec_type: SecurityType, supply: f64, price: f64, accredited: Accreditation) -> SecurityToken {
        let token = SecurityToken {
            id: format!("sto_{}", self.tokens.lock().unwrap().len()),
            name: name.to_string(),
            symbol: symbol.to_string(),
            security_type: sec_type,
            total_supply: supply,
            price,
            accredited_required: accredited,
        };
        
        self.tokens.lock().unwrap().push(token.clone());
        
        token
    }

    /// Register investor
    pub fn register_investor(&self, wallet: &str, accreditation: Accreditation, kyc: bool) -> Investor {
        let investor = Investor {
            id: format!("inv_{}", self.investors.lock().unwrap().len()),
            wallet: wallet.to_string(),
            accreditation,
            holdings: 0.0,
            kyc_verified: kyc,
        };
        
        self.investors.lock().unwrap().insert(investor.id.clone(), investor.clone());
        
        investor
    }

    /// Transfer security token
    pub fn transfer(&self, token_id: &str, investor_id: &str, amount: f64) -> Result<Transaction, &'static str> {
        // Verify accreditation
        let investors = self.investors.lock().unwrap();
        let investor = investors.get(investor_id).ok_or("Investor not found")?;
        
        if !investor.kyc_verified {
            return Err("KYC required");
        }
        
        drop(investors);
        
        // Verify availability
        let tokens = self.tokens.lock().unwrap();
        let token = tokens.iter().find(|t| t.id == token_id).ok_or("Token not found")?;
        
        if token.accredited_required == Accreditation::Accredited && investor.accreditation != Accreditation::Accredited {
            return Err(" accreditation required");
        }
        
        drop(tokens);
        
        let tx = Transaction {
            id: format!("tx_{}", self.transactions.lock().unwrap().len()),
            token_id: token_id.to_string(),
            investor_id: investor_id.to_string(),
            amount,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
            status: "completed".to_string(),
        };
        
        self.transactions.lock().unwrap().push(tx.clone());
        
        Ok(tx)
    }

    /// Compliance check
    pub fn check_compliance(&self, token_id: &str, investor_id: &str) -> bool {
        let investors = self.investors.lock().unwrap();
        
        if let Some(inv) = investors.get(investor_id) {
            let tokens = self.tokens.lock().unwrap();
            
            if let Some(tok) = tokens.iter().find(|t| t.id == token_id) {
                return inv.kyc_verified && 
                    inv.accreditation >= tok.accredited_required;
            }
        }
        
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_issue() {
        let sto = STOPlatform::new();
        
        let token = sto.issue_token("Apple Inc", "AAPL", SecurityType::Equity, 1_000_000.0, 150.0, Accreditation::Unverified);
        
        assert_eq!(token.name, "Apple Inc");
    }

    #[test]
    fn test_transfer() {
        let sto = STOPlatform::new();
        
        let token = sto.issue_token("Test", "TST", SecurityType::Equity, 1_000_000.0, 10.0, Accreditation::Accredited);
        let investor = sto.register_investor("0x123", Accreditation::Accredited, true);
        
        let result = sto.transfer(&token.id, &investor.id, 100.0);
        
        assert!(result.is_ok());
    }
}