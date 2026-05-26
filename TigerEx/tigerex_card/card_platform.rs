//! TigerEx Card Platform - Crypto payment card
//! Migration from TypeScript to Rust

use std::collections::HashMap;

/// Card type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardType {
    Virtual,
    Physical,
}

/// Card tier
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardTier {
    Bronze,
    Silver,
    Gold,
    Platinum,
}

/// Card status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardStatus {
    Active,
    Frozen,
    Blocked,
}

/// Payment card
#[derive(Debug, Clone)]
pub struct Card {
    pub id: String,
    pub user_id: String,
    pub card_type: CardType,
    pub tier: CardTier,
    pub last4: String,
    pub status: CardStatus,
    pub balance: f64,
}

/// Transaction
#[derive(Debug, Clone)]
pub struct Transaction {
    pub id: String,
    pub card_id: String,
    pub amount: f64,
    pub currency: String,
    pub merchant: String,
    pub status: String,
}

/// Card platform
#[derive(Default)]
pub struct CardPlatform {
    cards: HashMap<String, Card>,
    transactions: HashMap<String, Vec<Transaction>>,
}

impl CardPlatform {
    pub fn new() -> Self {
        Self::default()
    }

    /// Issue card
    pub fn issue_card(&mut self, user_id: &str, card_type: CardType, tier: CardTier) -> Card {
        let id = format!("card_{}", self.cards.len());
        let card = Card {
            id: id.clone(),
            user_id: user_id.to_string(),
            card_type,
            tier,
            last4: "4242".to_string(),
            status: CardStatus::Active,
            balance: 0.0,
        };
        
        self.cards.insert(id.clone(), card.clone());
        self.transactions.insert(id, vec![]);
        
        card
    }

    /// Freeze card
    pub fn freeze_card(&mut self, card_id: &str) -> bool {
        if let Some(card) = self.cards.get_mut(card_id) {
            card.status = CardStatus::Frozen;
            return true;
        }
        false
    }

    /// Process payment
    pub fn process_payment(&mut self, card_id: &str, amount: f64, merchant: &str) -> Transaction {
        let tx = Transaction {
            id: format!("tx_{}", self.transactions.get(card_id).map(|v| v.len()).unwrap_or(0)),
            card_id: card_id.to_string(),
            amount,
            currency: "USD".to_string(),
            merchant: merchant.to_string(),
            status: "completed".to_string(),
        };
        
        if let Some(txs) = self.transactions.get_mut(card_id) {
            txs.push(tx.clone());
        }
        
        tx
    }

    /// Get balance
    pub fn get_balance(&self, card_id: &str) -> f64 {
        self.cards.get(card_id).map(|c| c.balance).unwrap_or(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_issue_card() {
        let mut platform = CardPlatform::new();
        
        let card = platform.issue_card("user1", CardType::Virtual, CardTier::Gold);
        
        assert_eq!(card.tier, CardTier::Gold);
    }

    #[test]
    fn test_payment() {
        let mut platform = CardPlatform::new();
        
        let card = platform.issue_card("user1", CardType::Physical, CardTier::Platinum);
        
        let tx = platform.process_payment(&card.id, 100.0, "Amazon");
        
        assert_eq!(tx.amount, 100.0);
    }
}