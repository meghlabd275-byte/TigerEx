//! Account and tax reporting.
//!
//! The previous implementation returned filename-shaped strings
//! (`"report_<type>.json"`, `"tax_<user>_<year>.pdf"`) without producing any
//! report or validating its inputs, so a caller received a plausible name and
//! no data.

use std::collections::HashMap;

/// A single realised gain or loss.
#[derive(Debug, Clone, PartialEq)]
pub struct RealizedGain {
    pub asset: String,
    /// Proceeds received.
    pub proceeds: f64,
    /// Cost basis of the disposed quantity.
    pub cost_basis: f64,
    /// Caller-supplied acquisition timestamp, in milliseconds since the epoch.
    pub acquired_at_ms: u64,
    /// Caller-supplied disposal timestamp.
    pub disposed_at_ms: u64,
}

impl RealizedGain {
    pub fn gain(&self) -> f64 {
        self.proceeds - self.cost_basis
    }

    /// Holding period in whole days.
    pub fn holding_days(&self) -> u64 {
        self.disposed_at_ms.saturating_sub(self.acquired_at_ms) / 86_400_000
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaxStatement {
    pub user_id: String,
    pub year: u32,
    pub gains: Vec<RealizedGain>,
    pub total_proceeds: f64,
    pub total_cost_basis: f64,
    pub total_gain: f64,
    /// Gains on positions held longer than a year.
    pub long_term_gain: f64,
    /// Gains on positions held a year or less.
    pub short_term_gain: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PortfolioSummary {
    pub user_id: String,
    /// asset -> quantity held.
    pub holdings: Vec<(String, f64)>,
    /// asset -> price used to value the holding.
    pub prices: HashMap<String, f64>,
    pub total_value: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReportError {
    EmptyUser,
    InvalidYear(u32),
    InvalidAmount(f64),
    InvalidPeriod,
    MissingPrice(String),
    InvalidPrice(f64),
}

impl std::fmt::Display for ReportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReportError::EmptyUser => write!(f, "user id must not be empty"),
            ReportError::InvalidYear(y) => write!(f, "year {y} is out of range"),
            ReportError::InvalidAmount(a) => write!(f, "amount {a} must be finite and non-negative"),
            ReportError::InvalidPeriod => write!(f, "disposal cannot precede acquisition"),
            ReportError::MissingPrice(s) => write!(f, "no price supplied for {s}"),
            ReportError::InvalidPrice(p) => write!(f, "price {p} must be finite and positive"),
        }
    }
}

impl std::error::Error for ReportError {}

pub struct ReportService;

impl ReportService {
    pub fn new() -> Self {
        Self
    }

    /// Build a tax statement for a year from realised gains.
    ///
    /// Only disposals falling in `year` (UTC) are included. A gain is long
    /// term when the position was held for more than 365 days.
    pub fn tax_statement(
        &self,
        user_id: &str,
        year: u32,
        gains: Vec<RealizedGain>,
    ) -> Result<TaxStatement, ReportError> {
        if user_id.trim().is_empty() {
            return Err(ReportError::EmptyUser);
        }
        if !(1970..=9999).contains(&year) {
            return Err(ReportError::InvalidYear(year));
        }

        let year_start = Self::year_start_ms(year);
        let year_end = Self::year_start_ms(year + 1);

        let mut included = Vec::new();
        for gain in gains {
            if !gain.proceeds.is_finite()
                || !gain.cost_basis.is_finite()
                || gain.proceeds < 0.0
                || gain.cost_basis < 0.0
            {
                return Err(ReportError::InvalidAmount(gain.proceeds));
            }
            if gain.disposed_at_ms < gain.acquired_at_ms {
                return Err(ReportError::InvalidPeriod);
            }
            if gain.disposed_at_ms >= year_start && gain.disposed_at_ms < year_end {
                included.push(gain);
            }
        }

        let total_proceeds = included.iter().map(|g| g.proceeds).sum();
        let total_cost_basis = included.iter().map(|g| g.cost_basis).sum();
        let total_gain = included.iter().map(|g| g.gain()).sum();
        let long_term_gain = included
            .iter()
            .filter(|g| g.holding_days() > 365)
            .map(|g| g.gain())
            .sum();
        let short_term_gain = total_gain - long_term_gain;

        Ok(TaxStatement {
            user_id: user_id.to_string(),
            year,
            gains: included,
            total_proceeds,
            total_cost_basis,
            total_gain,
            long_term_gain,
            short_term_gain,
        })
    }

    /// Value a portfolio from holdings and current prices.
    pub fn portfolio_summary(
        &self,
        user_id: &str,
        holdings: Vec<(String, f64)>,
        prices: &HashMap<String, f64>,
    ) -> Result<PortfolioSummary, ReportError> {
        if user_id.trim().is_empty() {
            return Err(ReportError::EmptyUser);
        }

        let mut total_value = 0.0;
        for (asset, quantity) in &holdings {
            if !quantity.is_finite() || *quantity < 0.0 {
                return Err(ReportError::InvalidAmount(*quantity));
            }
            let price = *prices
                .get(asset)
                .ok_or_else(|| ReportError::MissingPrice(asset.clone()))?;
            if !price.is_finite() || price <= 0.0 {
                return Err(ReportError::InvalidPrice(price));
            }
            total_value += quantity * price;
        }

        Ok(PortfolioSummary {
            user_id: user_id.to_string(),
            holdings,
            prices: prices.clone(),
            total_value,
        })
    }

    /// The tax year as a label, e.g. "2026".
    pub fn report_name(&self, report_type: &str, year: u32) -> Result<String, ReportError> {
        if report_type.trim().is_empty() {
            return Err(ReportError::EmptyUser);
        }
        if !(1970..=9999).contains(&year) {
            return Err(ReportError::InvalidYear(year));
        }
        Ok(format!("{report_type}_{year}"))
    }

    /// Milliseconds at the start of a UTC year.
    ///
    /// Counts leap years from 1970 rather than assuming 365 days.
    fn year_start_ms(year: u32) -> u64 {
        let years = (year - 1970) as u64;
        let leap_days = (1970..year).filter(|y| Self::is_leap(*y)).count() as u64;
        let days = years * 365 + leap_days;
        days * 86_400_000
    }

    fn is_leap(year: u32) -> bool {
        (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
    }
}

impl Default for ReportService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day_ms(year: u32, month: u32, day: u32) -> u64 {
        // Simple conversion for test dates after 1970.
        let mut days = 0u64;
        for y in 1970..year {
            days += if ReportService::is_leap(y) { 366 } else { 365 };
        }
        let month_lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        for m in 0..(month - 1) as usize {
            days += month_lengths[m] as u64;
        }
        if month > 2 && ReportService::is_leap(year) {
            days += 1;
        }
        days += (day - 1) as u64;
        days * 86_400_000
    }

    #[test]
    fn a_tax_statement_totals_realised_gains() {
        let svc = ReportService::new();
        let gains = vec![
            RealizedGain {
                asset: "BTC".to_string(),
                proceeds: 60_000.0,
                cost_basis: 50_000.0,
                acquired_at_ms: day_ms(2024, 1, 1),
                disposed_at_ms: day_ms(2026, 3, 1),
            },
            RealizedGain {
                asset: "ETH".to_string(),
                proceeds: 2_000.0,
                cost_basis: 3_000.0,
                acquired_at_ms: day_ms(2025, 6, 1),
                disposed_at_ms: day_ms(2026, 7, 1),
            },
        ];

        let statement = svc.tax_statement("alice", 2026, gains).unwrap();
        assert_eq!(statement.gains.len(), 2);
        assert_eq!(statement.total_proceeds, 62_000.0);
        assert_eq!(statement.total_cost_basis, 53_000.0);
        assert_eq!(statement.total_gain, 9_000.0);
        // Both lots were held for more than 365 days.
        assert_eq!(statement.long_term_gain, 9_000.0);
        assert_eq!(statement.short_term_gain, 0.0);
    }

    #[test]
    fn a_short_holding_is_classified_as_short_term() {
        let svc = ReportService::new();
        let gains = vec![RealizedGain {
            asset: "ETH".to_string(),
            proceeds: 2_000.0,
            cost_basis: 3_000.0,
            acquired_at_ms: day_ms(2026, 1, 1),
            disposed_at_ms: day_ms(2026, 6, 1),
        }];

        let statement = svc.tax_statement("alice", 2026, gains).unwrap();
        assert_eq!(statement.long_term_gain, 0.0);
        assert_eq!(statement.short_term_gain, -1_000.0);
    }

    #[test]
    fn only_disposals_in_the_year_are_included() {
        let svc = ReportService::new();
        let gains = vec![
            RealizedGain {
                asset: "BTC".to_string(),
                proceeds: 1.0,
                cost_basis: 0.0,
                acquired_at_ms: day_ms(2025, 1, 1),
                disposed_at_ms: day_ms(2025, 12, 31),
            },
            RealizedGain {
                asset: "BTC".to_string(),
                proceeds: 2.0,
                cost_basis: 0.0,
                acquired_at_ms: day_ms(2026, 1, 1),
                disposed_at_ms: day_ms(2026, 12, 31),
            },
        ];

        let statement = svc.tax_statement("alice", 2026, gains).unwrap();
        assert_eq!(statement.gains.len(), 1);
        assert_eq!(statement.total_proceeds, 2.0);
    }

    #[test]
    fn invalid_gains_are_rejected() {
        let svc = ReportService::new();
        let negative = RealizedGain {
            asset: "BTC".to_string(),
            proceeds: -1.0,
            cost_basis: 0.0,
            acquired_at_ms: day_ms(2026, 1, 1),
            disposed_at_ms: day_ms(2026, 2, 1),
        };
        assert!(svc.tax_statement("alice", 2026, vec![negative]).is_err());

        let reversed = RealizedGain {
            asset: "BTC".to_string(),
            proceeds: 1.0,
            cost_basis: 0.0,
            acquired_at_ms: day_ms(2026, 5, 1),
            disposed_at_ms: day_ms(2026, 2, 1),
        };
        assert!(matches!(
            svc.tax_statement("alice", 2026, vec![reversed]).unwrap_err(),
            ReportError::InvalidPeriod
        ));
    }

    #[test]
    fn a_portfolio_is_valued_from_supplied_prices() {
        let svc = ReportService::new();
        let prices = HashMap::from([
            ("BTC".to_string(), 50_000.0),
            ("ETH".to_string(), 3_000.0),
        ]);
        let summary = svc
            .portfolio_summary(
                "alice",
                vec![("BTC".to_string(), 0.5), ("ETH".to_string(), 2.0)],
                &prices,
            )
            .unwrap();

        assert_eq!(summary.total_value, 25_000.0 + 6_000.0);
    }

    #[test]
    fn missing_prices_are_rejected() {
        let svc = ReportService::new();
        let prices = HashMap::from([("BTC".to_string(), 50_000.0)]);
        assert!(matches!(
            svc.portfolio_summary(
                "alice",
                vec![("DOGE".to_string(), 1_000.0)],
                &prices
            )
            .unwrap_err(),
            ReportError::MissingPrice(_)
        ));
    }

    #[test]
    fn invalid_identifiers_are_rejected() {
        let svc = ReportService::new();
        assert!(svc.tax_statement("", 2026, vec![]).is_err());
        assert!(svc.tax_statement("alice", 0, vec![]).is_err());
        assert!(svc.portfolio_summary("", vec![], &HashMap::new()).is_err());
        assert!(svc.report_name("", 2026).is_err());
    }

    #[test]
    fn leap_years_are_accounted_for() {
        // 2024 is a leap year, so the 2025 boundary is one day further.
        let start_2025 = ReportService::year_start_ms(2025);
        let days = start_2025 / 86_400_000;
        // 55 years from 1970 to 2025, of which 14 are leap years.
        assert_eq!(days, 55 * 365 + 14);
    }
}
