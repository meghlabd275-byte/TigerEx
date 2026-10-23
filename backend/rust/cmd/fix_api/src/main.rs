//! TigerEx FIX API server entrypoint.

use std::sync::Arc;

use tigerex_fix_api::{AccountStatus, AccountType, FixApiServer, FixCredentials, FixVersion};

#[tokio::main]
async fn main() -> Result<(), String> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    // Credentials are supplied by the operator; there are no defaults.
    let credentials = FixCredentials {
        username: std::env::var("FIX_API_USERNAME")
            .map_err(|_| "FIX_API_USERNAME must be set".to_string())?,
        password: std::env::var("FIX_API_PASSWORD")
            .map_err(|_| "FIX_API_PASSWORD must be set".to_string())?,
        api_key: std::env::var("FIX_API_KEY")
            .map_err(|_| "FIX_API_KEY must be set".to_string())?,
    };

    let server = Arc::new(FixApiServer::new());

    // Institutional accounts are provisioned by the operator.
    if let Ok(account_id) = std::env::var("FIX_INSTITUTIONAL_ACCOUNT_ID") {
        let organization =
            std::env::var("FIX_INSTITUTIONAL_ORG").unwrap_or_else(|_| account_id.clone());
        server
            .add_account(tiger_ex_account(&account_id, &organization))
            .await?;
    }

    let sender = std::env::var("FIX_SENDER_COMP_ID").unwrap_or_else(|_| "CLIENT1".to_string());
    let target = std::env::var("FIX_TARGET_COMP_ID").unwrap_or_else(|_| "TIGEREX".to_string());

    let session = server
        .create_session(&sender, &target, credentials.clone(), FixVersion::Fix44)
        .await?;
    server.logon(&session.session_id, &credentials).await?;

    tracing::info!(
        "FIX API ready; session {} is {}",
        session.session_id,
        "logged in"
    );

    Ok(())
}

fn tiger_ex_account(account_id: &str, organization: &str) -> tigerex_fix_api::InstitutionalAccount {
    tigerex_fix_api::InstitutionalAccount {
        account_id: account_id.to_string(),
        account_type: AccountType::Institutional,
        account_name: organization.to_string(),
        organization: organization.to_string(),
        status: AccountStatus::Active,
        margin_enabled: true,
    }
}
