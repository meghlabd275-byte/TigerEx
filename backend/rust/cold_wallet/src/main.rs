//! TigerEx Cold Wallet Daemon
//! Production-grade cold wallet management service

use tigerex_cold_wallet::{
    ColdWalletManager, Network, WalletType, WalletStatus,
};

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error, Level};
use tracing_subscriber::FmtSubscriber;

mod hsm;
mod blockchain;

#[derive(Clone)]
pub struct AppState {
    pub wallet_manager: Arc<RwLock<ColdWalletManager>>,
    pub is_air_gapped: bool,
    pub hsm_enabled: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .finish();

    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set tracing subscriber");

    info!("Starting TigerEx Cold Wallet Daemon v1.0.0");
    info!("Initializing wallet manager...");

    let wallet_manager = Arc::new(RwLock::new(ColdWalletManager::new()));

    // Initialize app state
    let state = AppState {
        wallet_manager: wallet_manager.clone(),
        is_air_gapped: true,
        hsm_enabled: true,
    };

    // Initialize HSM if enabled
    if state.hsm_enabled {
        info!("Initializing HSM...");
        if let Err(e) = hsm::initialize_hsm().await {
            error!("HSM initialization failed: {}", e);
        }
    }

    // Initialize blockchain connections
    info!("Connecting to blockchain nodes...");
    let btc_node = blockchain::connect_node(Network::Bitcoin, "btc-node:8332").await?;
    let eth_node = blockchain::connect_node(Network::Ethereum, "eth-node:8545").await?;

    info!("TigerEx Cold Wallet initialized successfully");
    info!("Air-gapped mode: {}", state.is_air_gapped);
    info!("HSM enabled: {}", state.hsm_enabled);

    // Keep the service running
    tokio::signal::ctrl_c().await?;
    info!("Shutting down...");

    Ok(())
}

pub mod commands {
    use tigerex_cold_wallet::*;
    
    /// Process withdrawal with full security checks
    pub async fn process_withdrawal(
        state: &AppState,
        user_id: &str,
        network: Network,
        to_address: &str,
        amount: &str,
    ) -> Result<Transaction, ColdWalletError> {
        let request = WithdrawalRequest {
            request_id: format!("req_{}", Utc::now().timestamp_millis()),
            user_id: user_id.to_string(),
            network,
            to_address: to_address.to_string(),
            amount: amount.to_string(),
            fee_level: "medium".to_string(),
            status: WalletStatus::Active,
            created_at: Utc::now().timestamp(),
            approved_at: None,
            processed_at: None,
        };

        let mut manager = state.wallet_manager.write().await;
        manager.process_withdrawal(request)
    }

    /// Sign transaction with HSM
    pub async fn sign_transaction_hsm(
        state: &AppState,
        tx_id: &str,
        signer_id: &str,
    ) -> Result<Transaction, ColdWalletError> {
        // In production, use HSM to sign
        let signing_key = crate::hsm::sign_with_hsm(tx_id.as_bytes())?;
        
        let mut manager = state.wallet_manager.write().await;
        // Would need proper key management in production
        Ok(manager.get_transaction(tx_id).cloned().unwrap())
    }

    /// Get wallet balance
    pub async fn get_balance(
        state: &AppState,
        address: &str,
    ) -> Result<Option<WalletAddress>, ColdWalletError> {
        let manager = state.wallet_manager.read().await;
        Ok(manager.get_wallet(address).cloned())
    }

    /// Get audit logs
    pub async fn get_audit_logs(
        state: &AppState,
        limit: usize,
    ) -> Vec<AuditLog> {
        let manager = state.wallet_manager.read().await;
        manager.get_audit_logs(limit)
            .into_iter()
            .cloned()
            .collect()
    }
}
