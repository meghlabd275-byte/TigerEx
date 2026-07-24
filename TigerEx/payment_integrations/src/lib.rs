// TigerEx Payment Integrations
// Built with Rust for security

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct PaymentMethod {
    pub id: String,
    pub user_id: String,
    pub method_type: String, // apple_pay, google_pay, paypal, visa
    pub token: String,
    pub last_four: String,
    pub expiry: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct Transaction {
    pub id: String,
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub method: String,
    pub status: String,
    pub tx_hash: String,
}

pub struct PaymentService {
    methods: HashMap<String, PaymentMethod>,
    transactions: HashMap<String, Transaction>,
}

impl PaymentService {
    pub fn new() -> Self {
        Self {
            methods: HashMap::new(),
            transactions: HashMap::new(),
        }
    }

    // Apple Pay
    pub fn add_apple_pay(&mut self, user_id: &str, token: &str, last_four: &str, expiry: &str) -> String {
        let id = format!("PAY_{}", self.methods.len());
        let method = PaymentMethod {
            id: id.clone(),
            user_id: user_id.to_string(),
            method_type: "apple_pay".to_string(),
            token: token.to_string(),
            last_four: last_four.to_string(),
            expiry: expiry.to_string(),
            status: "ACTIVE".to_string(),
        };
        self.methods.insert(id.clone(), method);
        id
    }

    // Google Pay
    pub fn add_google_pay(&mut self, user_id: &str, token: &str, last_four: &str, expiry: &str) -> String {
        let id = format!("PAY_{}", self.methods.len());
        let method = PaymentMethod {
            id: id.clone(),
            user_id: user_id.to_string(),
            method_type: "google_pay".to_string(),
            token: token.to_string(),
            last_four: last_four.to_string(),
            expiry: expiry.to_string(),
            status: "ACTIVE".to_string(),
        };
        self.methods.insert(id.clone(), method);
        id
    }

    // PayPal
    pub fn add_paypal(&mut self, user_id: &str, email: &str) -> String {
        let id = format!("PAY_{}", self.methods.len());
        let method = PaymentMethod {
            id: id.clone(),
            user_id: user_id.to_string(),
            method_type: "paypal".to_string(),
            token: email.to_string(),
            last_four: "".to_string(),
            expiry: "".to_string(),
            status: "ACTIVE".to_string(),
        };
        self.methods.insert(id.clone(), method);
        id
    }

    // Process payment
    pub fn charge(&mut self, user_id: &str, method_id: &str, amount: f64, currency: &str) -> Option<String> {
        let method = self.methods.get(method_id)?;
        if method.user_id != user_id || method.status != "ACTIVE" {
            return None;
        }

        let tx_id = format!("TX_{}", self.transactions.len());
        let tx = Transaction {
            id: tx_id.clone(),
            user_id: user_id.to_string(),
            amount,
            currency: currency.to_string(),
            method: method.method_type.clone(),
            status: "COMPLETED".to_string(),
            tx_hash: format!("tx_{}", tx_id),
        };
        self.transactions.insert(tx_id.clone(), tx);
        Some(tx_id)
    }

    pub fn get_methods(&self, user_id: &str) -> Vec<&PaymentMethod> {
        self.methods.values()
            .filter(|m| m.user_id == user_id)
            .collect()
    }
}

fn main() {
    println!("TigerEx Payment Integrations");
    
    let mut ps = PaymentService::new();
    
    // Add payment methods
    let apple = ps.add_apple_pay("user1", "tok_apple", "1234", "12/25");
    let google = ps.add_google_pay("user1", "tok_google", "5678", "06/26");
    let paypal = ps.add_paypal("user1", "user@email.com");
    
    println!("Added: Apple Pay {}, Google Pay {}, PayPal {}", apple, google, paypal);
    
    // Process payment
    if let Some(tx) = ps.charge("user1", &apple, 100.0, "USD") {
        println!("Payment: {}", tx);
    }
    
    // List methods
    let methods = ps.get_methods("user1");
    println!("Methods: {}", methods.len());
}
