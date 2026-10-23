//! Fiat on/off ramp for TigerEx.
//!
//! Tracks deposit and withdrawal requests against configured currency
//! channels. Requests are validated and recorded; settlement itself is a
//! downstream concern, so no transfer is ever reported as complete here.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct FiatChannel {
    pub currency: String,
    pub provider: String,
    pub enabled: bool,
    pub min_amount: f64,
    pub max_amount: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FiatDirection {
    Deposit,
    Withdrawal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FiatRequest {
    pub id: String,
    pub currency: String,
    pub amount: f64,
    pub direction: FiatDirection,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FiatError {
    UnsupportedCurrency(String),
    ChannelDisabled(String),
    InvalidAmount(f64),
    OutOfRange { amount: f64, min: f64, max: f64 },
}

impl std::fmt::Display for FiatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FiatError::UnsupportedCurrency(currency) => {
                write!(f, "currency {currency} is not supported")
            }
            FiatError::ChannelDisabled(currency) => {
                write!(f, "channel for {currency} is disabled")
            }
            FiatError::InvalidAmount(amount) => {
                write!(f, "amount {amount} must be positive and finite")
            }
            FiatError::OutOfRange { amount, min, max } => {
                write!(f, "amount {amount} is outside the allowed range {min}..={max}")
            }
        }
    }
}

impl std::error::Error for FiatError {}

pub struct FiatRailsService {
    channels: RwLock<HashMap<String, FiatChannel>>,
    requests: RwLock<Vec<FiatRequest>>,
}

impl Default for FiatRailsService {
    fn default() -> Self {
        Self::new()
    }
}

impl FiatRailsService {
    pub fn new() -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
            requests: RwLock::new(Vec::new()),
        }
    }

    pub fn add_channel(&self, channel: FiatChannel) -> Result<(), FiatError> {
        if !channel.min_amount.is_finite() || !channel.max_amount.is_finite() {
            return Err(FiatError::InvalidAmount(channel.min_amount));
        }
        if channel.min_amount <= 0.0 || channel.max_amount < channel.min_amount {
            return Err(FiatError::OutOfRange {
                amount: channel.max_amount,
                min: channel.min_amount,
                max: channel.max_amount,
            });
        }
        self.channels
            .write()
            .unwrap()
            .insert(channel.currency.clone(), channel);
        Ok(())
    }

    pub fn channel(&self, currency: &str) -> Option<FiatChannel> {
        self.channels.read().unwrap().get(currency).cloned()
    }

    fn validate(&self, currency: &str, amount: f64) -> Result<FiatChannel, FiatError> {
        let channel = self
            .channels
            .read()
            .unwrap()
            .get(currency)
            .cloned()
            .ok_or_else(|| FiatError::UnsupportedCurrency(currency.to_string()))?;

        if !channel.enabled {
            return Err(FiatError::ChannelDisabled(currency.to_string()));
        }
        if !amount.is_finite() || amount <= 0.0 {
            return Err(FiatError::InvalidAmount(amount));
        }
        if amount < channel.min_amount || amount > channel.max_amount {
            return Err(FiatError::OutOfRange {
                amount,
                min: channel.min_amount,
                max: channel.max_amount,
            });
        }
        Ok(channel)
    }

    fn record(&self, currency: &str, amount: f64, direction: FiatDirection) -> FiatRequest {
        let request = {
            let mut requests = self.requests.write().unwrap();
            let id = format!(
                "{}_{}",
                match direction {
                    FiatDirection::Deposit => "dep",
                    FiatDirection::Withdrawal => "wd",
                },
                requests.len()
            );
            let request = FiatRequest {
                id,
                currency: currency.to_string(),
                amount,
                direction,
                // Settlement happens downstream; this is only an accepted request.
                status: "pending".to_string(),
            };
            requests.push(request.clone());
            request
        };
        request
    }

    pub fn deposit(&self, currency: &str, amount: f64) -> Result<FiatRequest, FiatError> {
        self.validate(currency, amount)?;
        Ok(self.record(currency, amount, FiatDirection::Deposit))
    }

    pub fn withdraw(&self, currency: &str, amount: f64) -> Result<FiatRequest, FiatError> {
        self.validate(currency, amount)?;
        Ok(self.record(currency, amount, FiatDirection::Withdrawal))
    }

    pub fn request(&self, id: &str) -> Option<FiatRequest> {
        self.requests.read().unwrap().iter().find(|r| r.id == id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> FiatRailsService {
        let service = FiatRailsService::new();
        service
            .add_channel(FiatChannel {
                currency: "USD".to_string(),
                provider: "bank-wire".to_string(),
                enabled: true,
                min_amount: 10.0,
                max_amount: 100_000.0,
            })
            .unwrap();
        service
            .add_channel(FiatChannel {
                currency: "EUR".to_string(),
                provider: "sepa".to_string(),
                enabled: false,
                min_amount: 10.0,
                max_amount: 100_000.0,
            })
            .unwrap();
        service
    }

    #[test]
    fn rejects_unsupported_and_disabled_channels() {
        let service = service();
        assert!(matches!(
            service.deposit("JPY", 100.0).unwrap_err(),
            FiatError::UnsupportedCurrency(_)
        ));
        assert!(matches!(
            service.deposit("EUR", 100.0).unwrap_err(),
            FiatError::ChannelDisabled(_)
        ));
    }

    #[test]
    fn rejects_amounts_outside_channel_limits() {
        let service = service();
        assert!(matches!(
            service.deposit("USD", 5.0).unwrap_err(),
            FiatError::OutOfRange { .. }
        ));
        assert!(matches!(
            service.deposit("USD", 0.0).unwrap_err(),
            FiatError::InvalidAmount(_)
        ));
    }

    #[test]
    fn records_pending_requests() {
        let service = service();
        let deposit = service.deposit("USD", 500.0).unwrap();
        assert_eq!(deposit.status, "pending");
        assert!(deposit.id.starts_with("dep_"));

        let withdrawal = service.withdraw("USD", 250.0).unwrap();
        assert!(withdrawal.id.starts_with("wd_"));

        assert_eq!(service.request(&deposit.id).unwrap().amount, 500.0);
    }
}
