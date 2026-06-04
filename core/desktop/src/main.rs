// TigerEx Desktop - Main Entry Point
// Uses Tauri + Next.js frontend

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, Window, AppHandle, Emitter};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

pub struct AppState {
    pub is_authenticated: Mutex<bool>,
    pub user_id: Mutex<Option<String>>,
    pub theme: Mutex<String>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            is_authenticated: Mutex::new(false),
            user_id: Mutex::new(None),
            theme: Mutex::new("dark".to_string()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[tauri::command]
async fn login(identifier: String, password: String, state: tauri::State<'_, AppState>) -> Result<ApiResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("http://localhost:8080/api/v1/auth/login")
        .json(&serde_json::json!({"identifier": identifier, "password": password}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    if result["success"].as_bool().unwrap_or(false) {
        let mut auth = state.is_authenticated.lock().unwrap();
        *auth = true;
    }
    
    Ok(ApiResponse {
        success: result["success"].as_bool().unwrap_or(false),
        data: result["data"].clone(),
        error: result["error"].as_ref().and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()),
    })
}

#[tauri::command]
async fn logout(state: tauri::State<'_, AppState>) -> Result<ApiResponse, String> {
    let mut auth = state.is_authenticated.lock().unwrap();
    *auth = false;
    Ok(ApiResponse { success: true, data: None, error: None })
}

#[tauri::command]
async fn get_markets() -> Result<ApiResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("http://localhost:8080/api/v1/markets")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(ApiResponse { success: true, data: result.get("data").cloned(), error: None })
}

#[tauri::command]
async fn get_orderbook(symbol: String) -> Result<ApiResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(&format!("http://localhost:8080/api/v1/markets/{}/orderbook", symbol))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(ApiResponse { success: true, data: result.get("data").cloned(), error: None })
}

#[tauri::command]
fn toggle_theme(state: tauri::State<'_, AppState>) -> String {
    let mut current = state.theme.lock().unwrap();
    if *current == "dark" { *current = "light".to_string(); } 
    else { *current = "dark".to_string(); }
    current.clone()
}

#[tauri::command]
fn minimize_window(window: Window) { window.minimize().unwrap(); }

#[tauri::command]
fn maximize_window(window: Window) {
    if window.is_maximized().unwrap() { window.unmaximize().unwrap(); } 
    else { window.maximize().unwrap(); }
}

#[tauri::command]
fn close_window(window: Window) { window.close().unwrap(); }

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            login, logout, get_markets, get_orderbook, toggle_theme,
            minimize_window, maximize_window, close_window
        ])
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            window.set_title("TigerEx").unwrap();
            window.set_min_size(Some(tauri::LogicalSize::new(1200.0, 800.0))).unwrap();
            window.set_theme(Some(tauri::Theme::Dark)).unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}