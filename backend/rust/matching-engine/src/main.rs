//! TigerEx Matching Engine service entry point.
//!
//! The matching logic lives in the library crate (`src/lib.rs`). This binary
//! runs the engine as a line-oriented JSON service over stdin/stdout so it can
//! be embedded by the gateway and driven in tests without a network listener.

use std::io::{self, BufRead, Write};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use tigerex_matching_engine::{
    Market, MatchingEngine, Order, OrderStatus, OrderType, Side, TimeInForce,
};

/// A request accepted on stdin. Only `place_order` and `cancel_order` mutate
/// state; `order_book` and `stats` are read-only.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    AddMarket {
        market: Market,
    },
    PlaceOrder {
        id: String,
        user_id: String,
        market: String,
        side: Side,
        order_type: OrderType,
        price: f64,
        quantity: f64,
    },
    CancelOrder {
        order_id: String,
    },
    OrderBook {
        market: String,
        limit: usize,
    },
    Stats,
}

#[derive(Debug, Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    trades: Option<Vec<tigerex_matching_engine::Trade>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    book: Option<tigerex_matching_engine::OrderBook>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<tigerex_matching_engine::EngineStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Response {
    fn ok() -> Self {
        Self { ok: true, trades: None, book: None, stats: None, error: None }
    }

    fn error(message: impl Into<String>) -> Self {
        Self { ok: false, trades: None, book: None, stats: None, error: Some(message.into()) }
    }
}

fn handle(engine: &Arc<MatchingEngine>, request: Request) -> Response {
    match request {
        Request::AddMarket { market } => {
            engine.add_market(market);
            Response::ok()
        }
        Request::PlaceOrder { id, user_id, market, side, order_type, price, quantity } => {
            let order = Order {
                id,
                user_id,
                market,
                side,
                order_type,
                time_in_force: TimeInForce::GTC,
                price,
                stop_price: 0.0,
                trailing_delta: 0.0,
                quantity,
                filled_quantity: 0.0,
                iceberg_quantity: 0.0,
                display_quantity: 0.0,
                status: OrderStatus::New,
                client_order_id: String::new(),
                created_at: 0,
                updated_at: 0,
                expired_at: 0,
            };
            match engine.place_order(order) {
                Ok(trades) => Response { trades: Some(trades), ..Response::ok() },
                Err(e) => Response::error(e.to_string()),
            }
        }
        Request::CancelOrder { order_id } => match engine.cancel_order(&order_id) {
            Ok(()) => Response::ok(),
            Err(e) => Response::error(e.to_string()),
        },
        Request::OrderBook { market, limit } => match engine.get_order_book(&market, limit) {
            Some(book) => Response { book: Some(book), ..Response::ok() },
            None => Response::error("market not found"),
        },
        Request::Stats => Response { stats: Some(engine.get_stats()), ..Response::ok() },
    }
}

fn main() {
    tracing_subscriber::fmt::init();
    tracing::info!("TigerEx matching engine service starting");

    let engine = MatchingEngine::new();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                tracing::error!("failed to read request: {}", e);
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => handle(&engine, request),
            Err(e) => Response::error(format!("invalid request: {}", e)),
        };
        if serde_json::to_writer(&mut out, &response).is_err() || writeln!(out).is_err() {
            break;
        }
        if out.flush().is_err() {
            break;
        }
    }

    tracing::info!("TigerEx matching engine service stopped");
}
