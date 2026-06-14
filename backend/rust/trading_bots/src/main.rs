//! TigerEx Trading Bots Main Entry Point

use tigerex_bots::{BotManager, BotType, BotConfig, GridConfig, DCAConfig, TWAPConfig, ArbitrageConfig};
use tracing::info;
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(tracing::Level::INFO)
        .finish();
    
    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set tracing subscriber");
    
    info!("Starting TigerEx Trading Bots v1.0.0");
    
    let mut manager = BotManager::new();
    
    // Create Grid Bot
    let grid_config = BotConfig::Grid(GridConfig {
        symbol: "BTCUSDT".to_string(),
        upper_price: 52000.0,
        lower_price: 48000.0,
        grid_count: 20,
        quantity_per_grid: 0.001,
        max_position: 0.01,
        price_precision: 2,
        quantity_precision: 6,
    });
    
    let grid_bot_id = manager.create_bot(BotType::Grid, grid_config)?;
    info!("Created Grid Bot: {}", grid_bot_id);
    
    // Create DCA Bot
    let dca_config = BotConfig::Dca(DCAConfig {
        symbol: "ETHUSDT".to_string(),
        side: tigerex_bots::OrderSide::Buy,
        order_type: tigerex_bots::OrderType::Limit,
        quantity: 0.1,
        frequency_seconds: 3600,
        price_deviation_percent: 2.0,
        max_orders: 10,
        take_profit_percent: 5.0,
        stop_loss_percent: 10.0,
        price_precision: 2,
        quantity_precision: 4,
    });
    
    let dca_bot_id = manager.create_bot(BotType::Dca, dca_config)?;
    info!("Created DCA Bot: {}", dca_bot_id);
    
    // Create TWAP Bot
    let twap_config = BotConfig::Twap(TWAPConfig {
        symbol: "SOLUSDT".to_string(),
        side: tigerex_bots::OrderSide::Buy,
        total_quantity: 100.0,
        order_count: 50,
        duration_seconds: 3600,
        order_type: tigerex_bots::OrderType::Limit,
        price_limit: Some(150.0),
        price_precision: 2,
        quantity_precision: 2,
    });
    
    let twap_bot_id = manager.create_bot(BotType::Twap, twap_config)?;
    info!("Created TWAP Bot: {}", twap_bot_id);
    
    // Create Arbitrage Bot
    let arb_config = BotConfig::Arbitrage(ArbitrageConfig {
        symbol_a: "BTCUSDT".to_string(),
        symbol_b: "BTCUSDP".to_string(),
        exchange_a: "binance".to_string(),
        exchange_b: "coinbase".to_string(),
        min_profit_percent: 0.3,
        order_size: 1.0,
        max_position: 10.0,
        price_precision: 2,
        quantity_precision: 6,
    });
    
    let arb_bot_id = manager.create_bot(BotType::Arbitrage, arb_config)?;
    info!("Created Arbitrage Bot: {}", arb_bot_id);
    
    // Start all bots
    for bot in manager.get_all_bots() {
        info!("Bot: {} - Type: {:?} - Status: {:?}", 
            bot.bot_id, bot.bot_type, bot.status);
    }
    
    info!("TigerEx Trading Bots initialized successfully");
    
    // Keep running
    tokio::signal::ctrl_c().await?;
    info!("Shutting down...");
    
    Ok(())
}