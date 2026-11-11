//! REST API Gateway - Rust Implementation
//!
//! Thin REST facade over an in-memory order/transaction store. Every handler
//! returns data that was actually written through this gateway: it never
//! invents an address, a balance or a fill. Handlers whose backing data lives
//! in another subsystem (deposit address derivation, custody) fail closed
//! rather than returning a placeholder.

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// API Response wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<APIError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIError {
    pub code: i32,
    pub message: String,
}

impl APIError {
    fn new(code: i32, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

/// A recorded order. The gateway only stores what a caller submitted; it does
/// not match, so a newly accepted order is `new`, never `filled`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayOrder {
    pub order_id: String,
    pub user_id: String,
    pub params: serde_json::Value,
    pub status: String,
}

/// A recorded deposit or withdrawal request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayTransaction {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub asset: String,
    pub amount: f64,
    pub status: String,
}

/// Endpoint handlers
pub struct RESTGateway {
    orders: HashMap<String, GatewayOrder>,
    transactions: Vec<GatewayTransaction>,
    counter: u64,
}

impl RESTGateway {
    pub fn new() -> Self {
        Self {
            orders: HashMap::new(),
            transactions: Vec::new(),
            counter: 0,
        }
    }

    /// GET /api/v1/account
    ///
    /// Account metadata is owned by the identity service; without it this
    /// gateway cannot answer, so it fails closed instead of guessing a level.
    pub fn get_account(&self, user_id: &str) -> APIResponse<serde_json::Value> {
        if user_id.trim().is_empty() {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(400, "user id is required")),
            };
        }
        APIResponse {
            success: false,
            data: None,
            error: Some(APIError::new(
                503,
                "account metadata is served by the identity service",
            )),
        }
    }

    /// GET /api/v1/commissions
    pub fn get_commissions(&self, maker: f64, taker: f64) -> APIResponse<serde_json::Value> {
        if !(0.0..1.0).contains(&maker) || !(0.0..1.0).contains(&taker) {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(400, "fee must be a fraction in [0, 1)")),
            };
        }
        APIResponse {
            success: true,
            data: Some(serde_json::json!({ "maker": maker, "taker": taker })),
            error: None,
        }
    }

    /// POST /api/v1/order
    pub fn create_order(&mut self, user_id: &str, params: serde_json::Value) -> APIResponse<serde_json::Value> {
        if user_id.trim().is_empty() {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(400, "user id is required")),
            };
        }

        self.counter += 1;
        let order_id = format!("ORD_{}", self.counter);

        let order = GatewayOrder {
            order_id: order_id.clone(),
            user_id: user_id.to_string(),
            params,
            status: "new".to_string(),
        };
        self.orders.insert(order_id.clone(), order);

        APIResponse {
            success: true,
            data: Some(serde_json::json!({
                "orderId": order_id,
                "status": "new"
            })),
            error: None,
        }
    }

    /// GET /api/v1/history
    pub fn get_history(&self, user_id: &str) -> APIResponse<Vec<serde_json::Value>> {
        let mut history: Vec<serde_json::Value> = self
            .orders
            .values()
            .filter(|o| o.user_id == user_id)
            .map(|o| {
                serde_json::json!({
                    "id": o.order_id,
                    "status": o.status,
                    "params": o.params,
                })
            })
            .collect();
        history.sort_by(|a, b| {
            a.get("id").and_then(|v| v.as_str()).cmp(&b.get("id").and_then(|v| v.as_str()))
        });

        APIResponse {
            success: true,
            data: Some(history),
            error: None,
        }
    }

    /// GET /api/v1/deposit/address
    ///
    /// Address derivation belongs to the custody layer. Returning a constant
    /// here would send a user's funds to an address the venue does not control,
    /// so this fails closed.
    pub fn get_deposit_address(&self, _user_id: &str, _network: &str) -> APIResponse<serde_json::Value> {
        APIResponse {
            success: false,
            data: None,
            error: Some(APIError::new(
                503,
                "deposit address derivation is served by the custody service",
            )),
        }
    }

    /// GET /api/v1/deposit/history
    pub fn get_deposits(&self, user_id: &str) -> APIResponse<Vec<serde_json::Value>> {
        self.transactions_for(user_id, "deposit")
    }

    /// GET /api/v1/withdraw/history
    pub fn get_withdrawals(&self, user_id: &str) -> APIResponse<Vec<serde_json::Value>> {
        self.transactions_for(user_id, "withdrawal")
    }

    fn transactions_for(&self, user_id: &str, kind: &str) -> APIResponse<Vec<serde_json::Value>> {
        let rows: Vec<serde_json::Value> = self
            .transactions
            .iter()
            .filter(|t| t.user_id == user_id && t.kind == kind)
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "asset": t.asset,
                    "amount": t.amount,
                    "status": t.status,
                })
            })
            .collect();

        APIResponse {
            success: true,
            data: Some(rows),
            error: None,
        }
    }

    /// POST /api/v1/withdraw
    ///
    /// Records a withdrawal request. It is `pending` until the custody layer
    /// signs and broadcasts it; the gateway does not mark it processing.
    pub fn withdraw(&mut self, user_id: &str, asset: &str, amount: f64) -> APIResponse<serde_json::Value> {
        if user_id.trim().is_empty() {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(400, "user id is required")),
            };
        }
        if !amount.is_finite() || amount <= 0.0 {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(400, "amount must be positive and finite")),
            };
        }

        self.counter += 1;
        let wd_id = format!("WD_{}", self.counter);
        self.transactions.push(GatewayTransaction {
            id: wd_id.clone(),
            user_id: user_id.to_string(),
            kind: "withdrawal".to_string(),
            asset: asset.to_string(),
            amount,
            status: "pending".to_string(),
        });

        APIResponse {
            success: true,
            data: Some(serde_json::json!({
                "id": wd_id,
                "status": "pending"
            })),
            error: None,
        }
    }

    /// Record a confirmed deposit. Used by the custody webhook path; the
    /// amount must come from a chain observation, never a default.
    pub fn record_deposit(&mut self, user_id: &str, asset: &str, amount: f64) -> Option<String> {
        if user_id.trim().is_empty() || !amount.is_finite() || amount <= 0.0 {
            return None;
        }
        self.counter += 1;
        let id = format!("DEP_{}", self.counter);
        self.transactions.push(GatewayTransaction {
            id: id.clone(),
            user_id: user_id.to_string(),
            kind: "deposit".to_string(),
            asset: asset.to_string(),
            amount,
            status: "completed".to_string(),
        });
        Some(id)
    }

    /// GET /api/v1/order/{orderId}
    pub fn get_order(&self, order_id: &str) -> APIResponse<serde_json::Value> {
        match self.orders.get(order_id) {
            Some(order) => APIResponse {
                success: true,
                data: Some(serde_json::json!({
                    "orderId": order.order_id,
                    "status": order.status,
                    "params": order.params,
                })),
                error: None,
            },
            None => APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(404, "Order not found")),
            },
        }
    }

    /// DELETE /api/v1/order/{orderId}
    ///
    /// Only an order that exists and is still open can be cancelled.
    pub fn cancel_order(&mut self, user_id: &str, order_id: &str) -> APIResponse<serde_json::Value> {
        let order = match self.orders.get_mut(order_id) {
            Some(o) => o,
            None => {
                return APIResponse {
                    success: false,
                    data: None,
                    error: Some(APIError::new(404, "Order not found")),
                }
            }
        };

        if order.user_id != user_id {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(403, "Order belongs to another user")),
            };
        }

        if order.status != "new" && order.status != "partially_filled" {
            return APIResponse {
                success: false,
                data: None,
                error: Some(APIError::new(409, "Order is not cancellable in its current state")),
            };
        }

        order.status = "cancelled".to_string();
        let order_id = order.order_id.clone();

        APIResponse {
            success: true,
            data: Some(serde_json::json!({
                "orderId": order_id,
                "status": "cancelled"
            })),
            error: None,
        }
    }
}

impl Default for RESTGateway {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_lookup_fails_closed() {
        let gateway = RESTGateway::new();
        let response = gateway.get_account("user1");
        assert!(!response.success);
        assert!(response.error.is_some());
    }

    #[test]
    fn deposit_address_is_never_fabricated() {
        let gateway = RESTGateway::new();
        let response = gateway.get_deposit_address("user1", "ERC20");
        assert!(!response.success);
        assert!(response.data.is_none());
    }

    #[test]
    fn accepted_order_is_new_not_filled() {
        let mut gateway = RESTGateway::new();
        let response = gateway.create_order("user1", serde_json::json!({"symbol": "BTC/USDT"}));
        assert!(response.success);
        assert_eq!(response.data.unwrap()["status"], "new");
    }

    #[test]
    fn history_only_returns_own_orders() {
        let mut gateway = RESTGateway::new();
        gateway.create_order("user1", serde_json::json!({"symbol": "BTC/USDT"}));
        gateway.create_order("user2", serde_json::json!({"symbol": "ETH/USDT"}));

        let history = gateway.get_history("user1");
        assert_eq!(history.data.unwrap().len(), 1);
    }

    #[test]
    fn history_is_empty_without_orders() {
        let gateway = RESTGateway::new();
        let history = gateway.get_history("user1");
        assert!(history.success);
        assert!(history.data.unwrap().is_empty());
    }

    #[test]
    fn withdraw_records_pending_and_rejects_bad_amount() {
        let mut gateway = RESTGateway::new();
        let bad = gateway.withdraw("user1", "USDT", 0.0);
        assert!(!bad.success);

        let ok = gateway.withdraw("user1", "USDT", 5000.0);
        assert!(ok.success);
        assert_eq!(ok.data.unwrap()["status"], "pending");
        assert_eq!(gateway.get_withdrawals("user1").data.unwrap().len(), 1);
    }

    #[test]
    fn cancel_requires_ownership_and_open_state() {
        let mut gateway = RESTGateway::new();
        let created = gateway.create_order("user1", serde_json::json!({"symbol": "BTC/USDT"}));
        let order_id = created.data.unwrap()["orderId"].as_str().unwrap().to_string();

        assert!(!gateway.cancel_order("user2", &order_id).success);
        assert!(gateway.cancel_order("user1", &order_id).success);
        assert!(!gateway.cancel_order("user1", &order_id).success);
        assert!(!gateway.cancel_order("user1", "ORD_missing").success);
    }

    #[test]
    fn commissions_reject_invalid_fees() {
        let gateway = RESTGateway::new();
        assert!(gateway.get_commissions(0.001, 0.001).success);
        assert!(!gateway.get_commissions(1.0, 0.001).success);
    }
}
