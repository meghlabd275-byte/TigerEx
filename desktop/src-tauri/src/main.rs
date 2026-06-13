//! TigerEx Desktop Trading Application
// Cross-platform desktop app with Tauri + React

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct AppState {
    pub current_user: Mutex<Option<User>>,
    pub balances: Mutex<HashMap<String, f64>>,
    pub orders: Mutex<Vec<Order>>,
    pub watchlist: Mutex<Vec<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_user: Mutex::new(None),
            balances: Mutex::new(HashMap::new()),
            orders: Mutex::new(Vec::new()),
            watchlist: Mutex::new(vec!["BTCUSDT".to_string(), "ETHUSDT".to_string()]),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub user_id: String,
    pub username: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id: String,
    pub symbol: String,
    pub side: String,
    pub price: f64,
    pub quantity: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub currency: String,
    pub balance: f64,
    pub locked: f64,
}

#[tauri::command]
fn login(email: String, _password: String, state: State<AppState>) -> Result<User, String> {
    let user = User {
        user_id: "user001".to_string(),
        username: "trader001".to_string(),
        email: email.clone(),
    };
    let mut current_user = state.current_user.lock().unwrap();
    *current_user = Some(user.clone());
    let mut balances = state.balances.lock().unwrap();
    balances.insert("BTC".to_string(), 2.5);
    balances.insert("ETH".to_string(), 15.0);
    balances.insert("USDT".to_string(), 50000.0);
    Ok(user)
}

#[tauri::command]
fn logout(state: State<AppState>) -> Result<(), String> {
    let mut current_user = state.current_user.lock().unwrap();
    *current_user = None;
    Ok(())
}

#[tauri::command]
fn get_ticker(symbol: String) -> Result<serde_json::Value, String> {
    let (price, change) = match symbol.as_str() {
        "BTCUSDT" => (67432.50, 1.89),
        "ETHUSDT" => (3520.75, 1.30),
        "BNBUSDT" => (595.25, 2.15),
        _ => (100.0, 0.0),
    };
    Ok(serde_json::json!({
        "symbol": symbol,
        "price": price,
        "priceChangePercent": change
    }))
}

#[tauri::command]
fn get_balances(state: State<AppState>) -> Result<Vec<Wallet>, String> {
    let balances = state.balances.lock().unwrap();
    Ok(vec![
        Wallet { currency: "BTC".to_string(), balance: *balances.get("BTC").unwrap_or(&0.0), locked: 0.5 },
        Wallet { currency: "ETH".to_string(), balance: *balances.get("ETH").unwrap_or(&0.0), locked: 2.0 },
        Wallet { currency: "USDT".to_string(), balance: *balances.get("USDT").unwrap_or(&0.0), locked: 10000.0 },
    ])
}

#[tauri::command]
fn get_app_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "TigerEx Desktop",
        "version": "1.0.0"
    }))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            login, logout, get_ticker, get_balances, get_app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
