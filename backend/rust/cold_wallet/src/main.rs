//! TigerEx Cold Wallet Daemon
//!
//! Resident process that owns the in-memory cold-wallet manager. Configuration
//! comes from the environment; there are no compiled-in defaults that could
//! silently stand in for real settings.

use std::sync::Arc;

use tigerex_cold_wallet::ColdWalletManager;
use tokio::sync::RwLock;
use tracing::{error, info, Level};
use tracing_subscriber::FmtSubscriber;

/// Shared state handed to command handlers.
#[derive(Clone)]
pub struct AppState {
    pub wallet_manager: Arc<RwLock<ColdWalletManager>>,
    pub is_air_gapped: bool,
}

/// Parse a boolean environment flag. An unset flag keeps the caller's default;
/// an unparsable value is a hard error rather than a silent fallback.
fn env_flag(name: &str, default: bool) -> Result<bool, String> {
    match std::env::var(name) {
        Ok(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(true),
            "0" | "false" | "no" | "off" => Ok(false),
            other => Err(format!("{name}: expected a boolean, got {other:?}")),
        },
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(e) => Err(format!("{name}: {e}")),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set tracing subscriber");

    let is_air_gapped = env_flag("TIGEREX_AIR_GAPPED", true)?;

    info!("Starting TigerEx Cold Wallet Daemon v1.0.0");
    info!("Air-gapped mode: {is_air_gapped}");

    let state = AppState {
        wallet_manager: Arc::new(RwLock::new(ColdWalletManager::new())),
        is_air_gapped,
    };

    if !state.is_air_gapped {
        error!(
            "TIGEREX_AIR_GAPPED is disabled. A cold wallet daemon must remain \
             offline; refusing to start."
        );
        return Err("refusing to start a non-air-gapped cold wallet daemon".into());
    }

    info!("Cold wallet manager ready");

    tokio::signal::ctrl_c().await?;
    info!("Shutting down...");

    Ok(())
}

/// Operator commands exposed by the daemon.
pub mod commands {
    use super::AppState;
    use tigerex_cold_wallet::{AuditLog, ColdWalletError, Transaction, WalletAddress};

    /// Look up a wallet address.
    pub async fn get_wallet(
        state: &AppState,
        address: &str,
    ) -> Result<Option<WalletAddress>, ColdWalletError> {
        let manager = state.wallet_manager.read().await;
        Ok(manager.get_wallet(address).cloned())
    }

    /// Look up a transaction by id.
    pub async fn get_transaction(
        state: &AppState,
        tx_id: &str,
    ) -> Result<Option<Transaction>, ColdWalletError> {
        let manager = state.wallet_manager.read().await;
        Ok(manager.get_transaction(tx_id).cloned())
    }

    /// Return the most recent audit log entries.
    pub async fn get_audit_logs(state: &AppState, limit: usize) -> Vec<AuditLog> {
        let manager = state.wallet_manager.read().await;
        manager
            .get_audit_logs(limit)
            .into_iter()
            .cloned()
            .collect()
    }
}
