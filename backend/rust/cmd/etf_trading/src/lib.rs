//! Leveraged and basket ETF trading.
//!
//! The previous implementation computed an ETF's NAV as the plain sum of its
//! holdings' quantities, ignoring price entirely, so a basket of 1 BTC and
//! 1 USDT reported a NAV of 2. It also accepted any quantity when trading.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, PartialEq)]
pub struct ETF {
    pub ticker: String,
    /// Net asset value per share.
    pub nav: f64,
    /// Holding symbol -> quantity.
    pub holdings: Vec<(String, f64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EtfError {
    EmptyTicker,
    EmptyHoldings,
    MissingPrice(String),
    InvalidPrice(f64),
    InvalidQuantity(f64),
    UnknownEtf(String),
    DuplicateTicker(String),
}

impl std::fmt::Display for EtfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EtfError::EmptyTicker => write!(f, "ticker must not be empty"),
            EtfError::EmptyHoldings => write!(f, "an ETF needs at least one holding"),
            EtfError::MissingPrice(s) => write!(f, "no price supplied for {s}"),
            EtfError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
            EtfError::InvalidQuantity(q) => write!(f, "quantity {q} must be finite and positive"),
            EtfError::UnknownEtf(t) => write!(f, "unknown ETF: {t}"),
            EtfError::DuplicateTicker(t) => write!(f, "ETF {t} already exists"),
        }
    }
}

impl std::error::Error for EtfError {}

pub struct ETFTradingService {
    etfs: RwLock<HashMap<String, ETF>>,
}

impl ETFTradingService {
    pub fn new() -> Self {
        Self {
            etfs: RwLock::new(HashMap::new()),
        }
    }

    /// Create an ETF from its holdings and current market prices.
    ///
    /// NAV is the market value of the basket: the sum of quantity times price.
    /// Every holding needs a price; nothing is assumed.
    pub fn create(
        &self,
        ticker: &str,
        holdings: Vec<(String, f64)>,
        prices: &HashMap<String, f64>,
    ) -> Result<ETF, EtfError> {
        if ticker.trim().is_empty() {
            return Err(EtfError::EmptyTicker);
        }
        if holdings.is_empty() {
            return Err(EtfError::EmptyHoldings);
        }

        let mut nav = 0.0;
        for (symbol, quantity) in &holdings {
            if !quantity.is_finite() || *quantity <= 0.0 {
                return Err(EtfError::InvalidQuantity(*quantity));
            }
            let price = *prices
                .get(symbol)
                .ok_or_else(|| EtfError::MissingPrice(symbol.clone()))?;
            if !price.is_finite() || price <= 0.0 {
                return Err(EtfError::InvalidPrice(price));
            }
            nav += quantity * price;
        }

        let etf = ETF {
            ticker: ticker.to_string(),
            nav,
            holdings,
        };

        let mut etfs = self.etfs.write().unwrap();
        if etfs.contains_key(ticker) {
            return Err(EtfError::DuplicateTicker(ticker.to_string()));
        }
        etfs.insert(ticker.to_string(), etf.clone());
        Ok(etf)
    }

    /// Value a trade of `quantity` shares at NAV.
    pub fn trade(&self, ticker: &str, quantity: f64) -> Result<f64, EtfError> {
        if !quantity.is_finite() || quantity <= 0.0 {
            return Err(EtfError::InvalidQuantity(quantity));
        }
        let etfs = self.etfs.read().unwrap();
        let etf = etfs
            .get(ticker)
            .ok_or_else(|| EtfError::UnknownEtf(ticker.to_string()))?;
        Ok(etf.nav * quantity)
    }

    /// Recompute NAV from fresh prices and store it.
    pub fn revalue(
        &self,
        ticker: &str,
        prices: &HashMap<String, f64>,
    ) -> Result<f64, EtfError> {
        let mut etfs = self.etfs.write().unwrap();
        let etf = etfs
            .get_mut(ticker)
            .ok_or_else(|| EtfError::UnknownEtf(ticker.to_string()))?;

        let mut nav = 0.0;
        for (symbol, quantity) in &etf.holdings {
            let price = *prices
                .get(symbol)
                .ok_or_else(|| EtfError::MissingPrice(symbol.clone()))?;
            if !price.is_finite() || price <= 0.0 {
                return Err(EtfError::InvalidPrice(price));
            }
            nav += quantity * price;
        }
        etf.nav = nav;
        Ok(nav)
    }

    pub fn etf(&self, ticker: &str) -> Option<ETF> {
        self.etfs.read().unwrap().get(ticker).cloned()
    }
}

impl Default for ETFTradingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prices() -> HashMap<String, f64> {
        HashMap::from([
            ("BTC".to_string(), 50_000.0),
            ("ETH".to_string(), 3_000.0),
        ])
    }

    #[test]
    fn nav_is_the_market_value_of_the_basket() {
        let svc = ETFTradingService::new();
        let holdings = vec![("BTC".to_string(), 0.01), ("ETH".to_string(), 1.0)];
        let etf = svc.create("TIGER10", holdings, &prices()).unwrap();

        // The old implementation summed quantities and returned 1.01.
        assert_eq!(etf.nav, 0.01 * 50_000.0 + 3_000.0);
        assert_eq!(svc.trade("TIGER10", 2.0).unwrap(), etf.nav * 2.0);
    }

    #[test]
    fn every_holding_needs_a_price() {
        let svc = ETFTradingService::new();
        let holdings = vec![("BTC".to_string(), 0.01), ("DOGE".to_string(), 1_000.0)];
        // The old implementation silently ignored the missing price.
        assert!(matches!(
            svc.create("TIGER10", holdings, &prices()).unwrap_err(),
            EtfError::MissingPrice(_)
        ));
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let svc = ETFTradingService::new();
        assert!(svc.create("", vec![("BTC".to_string(), 1.0)], &prices()).is_err());
        assert!(svc.create("X", vec![], &prices()).is_err());
        assert!(svc.create("X", vec![("BTC".to_string(), -1.0)], &prices()).is_err());

        svc.create("X", vec![("BTC".to_string(), 1.0)], &prices()).unwrap();
        assert!(svc.trade("X", -1.0).is_err());
        assert!(svc.trade("X", f64::NAN).is_err());
        assert!(svc.trade("NOPE", 1.0).is_err());
    }

    #[test]
    fn duplicate_tickers_are_rejected() {
        let svc = ETFTradingService::new();
        svc.create("X", vec![("BTC".to_string(), 1.0)], &prices()).unwrap();
        assert!(matches!(
            svc.create("X", vec![("BTC".to_string(), 1.0)], &prices()).unwrap_err(),
            EtfError::DuplicateTicker(_)
        ));
    }

    #[test]
    fn revaluing_updates_the_nav() {
        let svc = ETFTradingService::new();
        svc.create("X", vec![("BTC".to_string(), 1.0)], &prices()).unwrap();
        assert_eq!(svc.etf("X").unwrap().nav, 50_000.0);

        let updated = HashMap::from([("BTC".to_string(), 60_000.0)]);
        assert_eq!(svc.revalue("X", &updated).unwrap(), 60_000.0);
        assert_eq!(svc.etf("X").unwrap().nav, 60_000.0);
    }
}
